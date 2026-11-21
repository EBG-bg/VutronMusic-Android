'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const http = require('node:http');
const { setTimeout: delay } = require('node:timers/promises');
const { createMediaGateway } = require('../src/main/assets/sources-runtime/media-gateway.cjs');

const listen = server => new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
const close = server => new Promise(resolve => { server.closeAllConnections(); server.close(resolve); });
const watch = (gateway, path) => new Promise(resolve => gateway.watchStartFailure(path, resolve));
const cdn = 'https://fsmobile.kugou.com';

async function withGateway(upstream, options, verify) {
  const origin = http.createServer(upstream);
  await listen(origin);
  const gateway = createMediaGateway({
    allowKugouDns: owner => owner === 'kugou', startFailureSettleMs: 25, startFailureWaitMs: 800,
    request: (url, settings, callback) => http.request({ hostname: '127.0.0.1', port: origin.address().port,
      path: url.pathname, method: settings.method, headers: settings.headers, agent: false }, callback),
    ...options,
  });
  const server = http.createServer((req, res) => gateway.handle(req, res, new URL(req.url, 'http://127.0.0.1')));
  await listen(server);
  const get = (path, options = {}) => new Promise((resolve, reject) => {
    http.get(`http://127.0.0.1:${server.address().port}${path}`, { agent: false, ...options }, res => {
      const chunks = [];
      res.on('data', chunk => chunks.push(chunk));
      res.once('error', reject);
      res.once('end', () => resolve({ status: res.statusCode, body: Buffer.concat(chunks).toString() }));
    }).once('error', reject);
  });
  try { await verify(gateway, get); }
  finally { await close(server); await close(origin); }
}

test('initial KuGou GET failure remains available when playback precedes the watch', { timeout: 3000 }, async () => {
  await withGateway((_req, res) => { res.writeHead(403); res.end('upstream error body'); }, {}, async (gateway, get) => {
    const path = gateway.register({ url: `${cdn}/audio` }, 'kugou');
    assert.equal(gateway.hasStartFailureWatch(path), true);
    assert.deepEqual(await get(path, { headers: { range: 'bytes=0-' } }), { status: 403, body: '' });
    assert.deepEqual(await watch(gateway, path), { phase: 'failed', reason: 'http', status: 403, range: true, bytes: false });
    assert.equal(await watch(gateway, path), null, 'A registration can report startup only once');
  });
});

test('a competing GET that can still deliver audio takes precedence over a confirmed startup failure', { timeout: 3000 }, async () => {
  let releaseSecond, secondSeen;
  const waitingForSecond = new Promise(resolve => { secondSeen = resolve; });
  await withGateway((req, res) => {
    if (req.headers.range === 'bytes=4-') {
      releaseSecond = () => { res.writeHead(206, { 'content-range': 'bytes 4-8/9' }); res.end('audio'); };
      secondSeen();
      return;
    }
    res.writeHead(404); res.end();
  }, {}, async (gateway, get) => {
    const path = gateway.register({ url: `${cdn}/audio` }, 'kugou');
    let notified = false;
    const watched = watch(gateway, path).then(value => { notified = true; return value; });
    const competing = get(path, { headers: { range: 'bytes=4-' } });
    await waitingForSecond;
    assert.equal((await get(path)).status, 404);
    await delay(75);
    assert.equal(notified, false, 'The watch stays pending while another GET can still deliver bytes');
    releaseSecond();
    assert.deepEqual(await competing, { status: 206, body: 'audio' });
    assert.equal(await watched, null);
    assert.equal((await get(path)).status, 404);
    assert.equal(await watch(gateway, path), null, 'Later errors cannot revive a completed startup watch');
  });
});

test('an immediate successful start retry cancels the failure during the settle window', { timeout: 3000 }, async () => {
  let requests = 0;
  await withGateway((_req, res) => {
    if (++requests === 1) { res.writeHead(410); res.end(); }
    else { res.end('audio'); }
  }, { startFailureSettleMs: 250 }, async (gateway, get) => {
    const path = gateway.register({ url: `${cdn}/audio` }, 'kugou');
    const watched = watch(gateway, path);
    assert.equal((await get(path)).status, 410);
    assert.deepEqual(await get(path), { status: 200, body: 'audio' });
    assert.equal(await watched, null);
  });
});

test('an older initial failure cannot override a newer ambiguous probing result', { timeout: 3000 }, async () => {
  let releaseFirst, firstSeen;
  const waitingForFirst = new Promise(resolve => { firstSeen = resolve; });
  await withGateway((req, res) => {
    if (req.headers.range === 'bytes=-4') { res.writeHead(416); res.end(); return; }
    const reject = () => { res.writeHead(403); res.end(); };
    if (releaseFirst) { reject(); return; }
    releaseFirst = reject;
    firstSeen();
  }, {}, async (gateway, get) => {
    const path = gateway.register({ url: `${cdn}/audio` }, 'kugou');
    let notified = false;
    const watched = watch(gateway, path).then(value => { notified = true; return value; });
    const first = get(path);
    await waitingForFirst;
    assert.equal((await get(path, { headers: { range: 'bytes=-4' } })).status, 416);
    releaseFirst();
    assert.equal((await first).status, 403);
    await delay(75);
    assert.equal(notified, false);
    assert.equal((await get(path, { headers: { range: 'bytes=0-4' } })).status, 403);
    assert.deepEqual(await watched, { phase: 'failed', reason: 'http', status: 403, range: true, bytes: false });
  });
});

test('HEAD, noninitial ranges, uncertain HTTP errors and slow responses do not report failure', { timeout: 3000 }, async () => {
  await withGateway((req, res) => {
    if (req.url === '/stall') return;
    if (req.url === '/slow') {
      res.writeHead(200); res.flushHeaders();
      setTimeout(() => res.end('audio'), 60);
      return;
    }
    res.writeHead(Number(req.url.slice(1))); res.end();
  }, { startTimeoutMs: 180, startFailureWaitMs: 300 }, async (gateway, get) => {
    const scenarios = [
      ['/403', { method: 'HEAD' }, 403],
      ['/403', { headers: { range: 'bytes=4-' } }, 403],
      ['/403', { headers: { range: 'bytes=-2' } }, 403],
      ['/403', { headers: { range: 'bytes=0-3,9-12' } }, 403],
      ['/416', {}, 416], ['/503', {}, 503], ['/stall', {}, 502], ['/slow', {}, 200],
    ];
    await Promise.all(scenarios.map(async ([upstreamPath, options, status]) => {
      const path = gateway.register({ url: cdn + upstreamPath }, 'kugou');
      const watched = watch(gateway, path);
      assert.equal((await get(path, options)).status, status);
      assert.equal(await watched, null, upstreamPath + JSON.stringify(options));
    }));
  });
});

test('watch cancellation, expiry and registration eviction discard pending startup signals', { timeout: 3000 }, async () => {
  let clock = 0;
  await withGateway((_req, res) => { res.writeHead(401); res.end(); }, { now: () => clock }, async (gateway, get) => {
    const register = () => gateway.register({ url: `${cdn}/audio` }, 'kugou');
    const cancelled = register();
    let notified = false;
    const cancel = gateway.watchStartFailure(cancelled, () => { notified = true; });
    assert.equal(await watch(gateway, cancelled), null, 'A second listener does not replace the active one');
    cancel();
    assert.equal((await get(cancelled)).status, 401);
    await delay(60);
    assert.equal(notified, false);
    assert.equal(await watch(gateway, cancelled), null);

    const expired = register();
    const expiration = watch(gateway, expired);
    assert.equal((await get(expired)).status, 401);
    clock += 6 * 60 * 60 * 1000 + 1;
    assert.equal(await expiration, null, 'Expiry is rechecked before publishing the failure');
    assert.equal(gateway.describe(expired), null);

    const evicted = register();
    const eviction = watch(gateway, evicted);
    for (let i = 0; i < 64; i++) gateway.register({ url: 'https://example.com/audio' });
    assert.equal(await eviction, null);
    assert.equal(gateway.describe(evicted), null);
  });
});
