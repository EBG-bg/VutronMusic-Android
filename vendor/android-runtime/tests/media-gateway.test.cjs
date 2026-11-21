const test = require('node:test');
const assert = require('node:assert/strict');
const http = require('node:http');
const { createMediaGateway, publicAddress, mediaUrl } = require('../src/main/assets/sources-runtime/media-gateway.cjs');
const listen = server => new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
const close = server => new Promise(resolve => { server.closeAllConnections(); server.close(resolve); });
const get = (url, options = {}) => new Promise((resolve, reject) => {
  http.get(url, options, res => { const chunks = []; res.on('data', x => chunks.push(x)); res.once('error', reject); res.on('end', () => resolve({ status: res.statusCode, headers: res.headers, body: Buffer.concat(chunks) })); }).on('error', reject);
});
test('media gateway preserves bytes, ranges, HEAD and required media headers', async () => {
  const bytes = Buffer.from('original FLAC bytes without transcoding'); const requests = [];
  const origin = http.createServer((req, res) => {
    requests.push({ method: req.method, headers: req.headers });
    if (req.url === '/redirect') { res.writeHead(302, { location: 'http://public.example/audio' }); res.end(); return; }
    const range = /bytes=(\d+)-(\d+)/.exec(req.headers.range || '');
    const body = range ? bytes.subarray(Number(range[1]), Number(range[2]) + 1) : bytes;
    res.writeHead(range ? 206 : 200, { 'content-type': 'audio/flac', 'content-length': body.length, 'accept-ranges': 'bytes', ...(range ? { 'content-range': 'bytes 3-8/' + bytes.length } : {}) });
    res.end(req.method === 'HEAD' ? undefined : body);
  });
  await listen(origin);
  // Substitute only the external transport; production public DNS validation stays enabled.
  const gateway = createMediaGateway({ request: (url, options, callback) => http.request('http://127.0.0.1:' + origin.address().port + url.pathname, { method: options.method, headers: options.headers }, callback) });
  const server = http.createServer((req, res) => { if (!gateway.handle(req, res, new URL(req.url, 'http://127.0.0.1'))) { res.writeHead(403); res.end(); } });
  await listen(server);
  try {
    const path = gateway.register({ url: 'http://public.example/redirect', headers: { Referer: 'https://required.example/', Cookie: 'private-cookie', Authorization: 'private-auth' } });
    const url = 'http://127.0.0.1:' + server.address().port + path;
    const full = await get(url); assert.deepEqual(full.body, bytes); assert.equal(full.status, 200);
    const part = await get(url, { headers: { range: 'bytes=3-8' } });
    assert.equal(part.status, 206); assert.deepEqual(part.body, bytes.subarray(3, 9)); assert.equal(part.headers['content-range'], 'bytes 3-8/' + bytes.length);
    const head = await get(url, { method: 'HEAD' }); assert.equal(head.body.length, 0); assert.equal(Number(head.headers['content-length']), bytes.length);
    assert.equal(requests.at(-1).headers.referer, 'https://required.example/');
    assert.equal(requests.at(-1).headers.cookie, undefined); assert.equal(requests.at(-1).headers.authorization, undefined);
    assert.equal((await get('http://127.0.0.1:' + server.address().port + '/media/not-a-token')).status, 404);
    assert.equal((await get('http://127.0.0.1:' + server.address().port + '/media/register')).status, 403);
  } finally { await close(server); await close(origin); }
});

test('media start reports stalled connections and empty buffers without waiting for the streaming idle timer', { timeout: 3000 }, async () => {
  const bytes = Buffer.from('first audio bytes');
  const origin = http.createServer((req, res) => {
    if (req.url === '/no-headers') return;
    res.writeHead(200, { 'content-type': 'audio/mpeg', 'content-length': bytes.length });
    if (req.url === '/no-bytes') { res.flushHeaders(); return; }
    res.end(bytes);
  });
  await listen(origin);
  const gateway = createMediaGateway({ startTimeoutMs: 80, idleTimeoutMs: 2000,
    request: (url, options, callback) => http.request('http://127.0.0.1:' + origin.address().port + url.pathname, { method: options.method, headers: options.headers }, callback) });
  const server = http.createServer((req, res) => gateway.handle(req, res, new URL(req.url, 'http://127.0.0.1')));
  await listen(server);
  const local = path => `http://127.0.0.1:${server.address().port}${path}`;
  try {
    const noHeaders = gateway.register({ url: 'http://public.example/no-headers?key=private' });
    const noBytes = gateway.register({ url: 'http://public.example/no-bytes' });
    assert.deepEqual(gateway.describe(noHeaders), { phase: 'registered' });
    assert.equal(gateway.describe(noHeaders + '?x=1'), null);
    for (const response of await Promise.all([get(local(noHeaders)), get(local(noBytes))])) {
      assert.equal(response.status, 502);
      assert.equal(response.body.length, 0);
    }
    assert.deepEqual(gateway.describe(noHeaders), { phase: 'failed', range: false, bytes: false, reason: 'headers_timeout' });
    assert.deepEqual(gateway.describe(noBytes), { phase: 'failed', status: 200, range: false, bytes: false, reason: 'first_byte_timeout' });

    const healthy = gateway.register({ url: 'http://public.example/healthy' });
    assert.deepEqual((await get(local(healthy))).body, bytes);
    assert.equal((await get(local(healthy), { method: 'HEAD' })).status, 200);
    assert.deepEqual(gateway.describe(healthy), { phase: 'complete', status: 200, range: false, bytes: true });
    assert.equal((await get(local(healthy), { headers: { range: 'bytes=4-' } })).status, 502);
    assert.deepEqual(gateway.describe(healthy), { phase: 'failed', status: 200, range: true, bytes: false, reason: 'range' });
  } finally { await close(server); await close(origin); }
});

test('a stalled redirect body cannot interrupt the new streaming hop', { timeout: 3000 }, async () => {
  const bytes = Buffer.from('12345678abcdefgh');
  const requests = [];
  const origin = http.createServer((req, res) => {
    requests.push([req.url, req.headers.range]);
    if (req.url === '/redirect') {
      res.writeHead(302, { location: 'http://public.example/audio', 'content-length': 32 });
      res.flushHeaders(); // The origin stalls before sending the unused redirect body.
      return;
    }
    res.writeHead(206, { 'content-type': 'audio/mpeg', 'content-length': bytes.length, 'content-range': 'bytes 0-15/16' });
    res.write(bytes.subarray(0, 8));
    const end = setTimeout(() => res.end(bytes.subarray(8)), 240);
    res.once('close', () => clearTimeout(end));
  });
  await listen(origin);
  const gateway = createMediaGateway({ request: (url, options, callback) => {
    const hop = http.request({ hostname: '127.0.0.1', port: origin.address().port, path: url.pathname,
      agent: false, method: options.method, headers: options.headers }, callback);
    if (url.pathname === '/redirect') {
      const setTimeout = hop.setTimeout.bind(hop);
      hop.setTimeout = (ms, onTimeout) => setTimeout(ms === 0 ? 0 : 40, onTimeout);
    }
    return hop;
  } });
  const server = http.createServer((req, res) => gateway.handle(req, res, new URL(req.url, 'http://127.0.0.1')));
  await listen(server);
  try {
    const path = gateway.register({ url: 'http://public.example/redirect' });
    const result = await get('http://127.0.0.1:' + server.address().port + path, { agent: false, headers: { range: 'bytes=0-15' } });
    assert.equal(result.status, 206);
    assert.deepEqual(result.body, bytes);
    assert.deepEqual(requests, [['/redirect', 'bytes=0-15'], ['/audio', 'bytes=0-15']]);
  } finally { await close(server); await close(origin); }
});
test('media connects only to the pinned public DNS answers on each hop', { timeout: 3000 }, async () => {
  const hosts = [], accepted = [], arrived = [];
  const v4 = { family: 4, address: '8.8.8.8' }, v6 = { family: 6, address: '2606:4700:4700::1111' };
  const synthetic = { family: 4, address: '198.18.0.1' }, privateV6 = { family: 6, address: 'fd00::1' };
  const replies = {
    'start.example': [synthetic, v4, privateV6, v6],
    'redirect.example': [synthetic, v4, privateV6, v6],
    'private.example': [synthetic, privateV6],
    'wrong-family.example': [v4, privateV6],
  };
  const origin = http.createServer((request, response) => {
    arrived.push(request.url);
    if (request.url === '/start') {
      response.writeHead(302, { location: 'http://redirect.example/finish' }); response.end(); return;
    }
    response.end('original audio bytes');
  });
  await listen(origin);
  const gateway = createMediaGateway({
    lookup(hostname, options, callback) {
      hosts.push(hostname);
      assert.equal(options.all, true);
      callback(null, replies[hostname]);
    },
    request(url, options, callback) {
      return http.request({
        hostname: url.hostname, port: origin.address().port, path: url.pathname, method: options.method, headers: options.headers,
        autoSelectFamily: false, agent: false,
        lookup(hostname, _options, connect) {
          const family = hostname === 'redirect.example' || hostname === 'wrong-family.example' ? 'IPv6' : undefined;
          options.lookup(hostname, { all: !family, family }, (error, addresses, singleFamily) => {
            if (error) { connect(error); return; }
            accepted.push([hostname, addresses, singleFamily]);
            // Only the fixture transport maps a checked public endpoint to the local origin.
            connect(null, '127.0.0.1', 4);
          });
        },
      }, callback);
    },
  });
  const server = http.createServer((req, res) => gateway.handle(req, res, new URL(req.url, 'http://127.0.0.1')));
  await listen(server);
  const local = url => `http://127.0.0.1:${server.address().port}${gateway.register({ url })}`;
  try {
    const result = await get(local('http://start.example/start'));
    assert.equal(result.status, 200);
    assert.equal(result.body.toString(), 'original audio bytes');
    assert.equal((await get(local('http://private.example/blocked'))).status, 502);
    assert.equal((await get(local('http://wrong-family.example/blocked'))).status, 502);
    assert.deepEqual(accepted, [['start.example', [v4, v6], undefined], ['redirect.example', v6.address, v6.family]]);
    assert.deepEqual(hosts, ['start.example', 'redirect.example', 'private.example', 'wrong-family.example']);
    assert.deepEqual(arrived, ['/start', '/finish']);
  } finally { await close(server); await close(origin); }
});
test('media registration rejects private and credential-bearing URLs', () => {
  for (const address of ['127.0.0.1', '10.1.2.3', '192.168.1.2', '169.254.169.254', '::1', 'fc00::1', '::ffff:127.0.0.1', '0:0:0:0:0:ffff:7f00:1', 'fe80::1%12',
    '198.19.255.255', '2001:0002:0000:1000::1', '2001:2:0:1:2:3:4:5']) assert.equal(publicAddress(address), false);
  assert.equal(publicAddress('8.8.8.8'), true);
  for (const url of ['http://127.0.0.1/a', 'http://localhost/a', 'http://[::1]/a', 'file:///private/a', 'http://user:secret@example.com/a']) assert.throws(() => mediaUrl(url));
  assert.equal(mediaUrl('https://cdn.example.com/song?key=signed').protocol, 'https:');
});

test('the Node 18 gateway tries the next checked DNS address when the first connection fails', { timeout: 3000 }, async () => {
  const allowed = [{ address: '8.8.8.8', family: 4 }, { address: '1.1.1.1', family: 4 }];
  let netRequestedAll;
  const origin = http.createServer((req, res) => res.end('matched audio'));
  await listen(origin);
  const gateway = createMediaGateway({
    lookup(_host, _options, callback) { callback(null, allowed); },
    request(url, options, callback) {
      return http.request({ ...options, agent: false, host: url.hostname, port: origin.address().port,
        lookup(host, lookupOptions, connect) {
          netRequestedAll = lookupOptions.all === true;
          options.lookup(host, lookupOptions, (error, addresses) => {
            if (error) return connect(error);
            // Map the checked public fixture endpoints to a closed then open
            // local endpoint. Node still performs its actual connection logic.
            if (lookupOptions.all) {
              assert.deepEqual(addresses, allowed);
              connect(null, [{ address: '127.0.0.2', family: 4 }, { address: '127.0.0.1', family: 4 }]);
            } else {
              assert.equal(addresses, allowed[0].address);
              connect(null, '127.0.0.2', 4);
            }
          });
        },
      }, callback);
    },
  });
  const server = http.createServer((req, res) => gateway.handle(req, res, new URL(req.url, 'http://127.0.0.1')));
  await listen(server);
  try {
    const mediaPath = gateway.register({ url: 'http://public.example/audio' });
    const result = await get(`http://127.0.0.1:${server.address().port}${mediaPath}`);
    assert.equal(netRequestedAll, true);
    assert.equal(result.status, 200);
    assert.equal(result.body.toString(), 'matched audio');
  } finally { await close(server); await close(origin); }
});


test('KuGou audio DNS recovery preserves the original host and pins only eligible addresses', { timeout: 5000 }, async () => {
  const cdn = 'fsmobile.kugou.com', backup = 'fsandroid.tx.kugou.com';
  const fakeV4 = { address: '198.18.8.7', family: 4 }, fakeV6 = { address: '2001:0002:0000:12::34', family: 6 };
  const privateV4 = { address: '10.0.0.1', family: 4 };
  const publicV4 = { address: '8.8.4.4', family: 4 }, publicV6 = { address: '2400:3200::1', family: 6 };
  let system = [fakeV4], recovered = [privateV4, publicV4, fakeV6, publicV6], network = true, family = 0;
  const calls = [], pinned = [], arrived = [];
  const origin = http.createServer((req, res) => {
    if (req.url === '/redirect') { res.writeHead(302, { location: 'https://unrelated.example/audio' }); res.end(); return; }
    if (req.url === '/backup') { res.writeHead(302, { location: `https://${backup}/audio` }); res.end(); return; }
    arrived.push(req.headers.host);
    res.end('audio');
  });
  await listen(origin);
  const gateway = createMediaGateway({
    lookup(_hostname, _options, callback) { callback(null, system); },
    allowKugouDns: id => network && id === 'kugou',
    async resolveKugouDns(hostname, options) { calls.push([hostname, options.family]); return recovered; },
    request(url, options, callback) {
      return http.request({ hostname: url.hostname, port: origin.address().port, path: url.pathname, agent: false,
        lookup(hostname, _options, connect) {
          options.lookup(hostname, { all: true, family }, (error, allowed) => {
            if (error) return connect(error);
            pinned.push([hostname, allowed]);
            // Preserve the Host header while mapping verified public IPs to the local fixture.
            connect(null, '127.0.0.1', 4);
          });
        },
      }, callback);
    },
  });
  const server = http.createServer((req, res) => gateway.handle(req, res, new URL(req.url, 'http://127.0.0.1')));
  await listen(server);
  async function play(url = `https://${cdn}/audio`, id = 'kugou') {
    const path = gateway.register({ url }, id);
    const response = await get(`http://127.0.0.1:${server.address().port}${path}`);
    return [response.status, gateway.describe(path)];
  }
  try {
    for (const answers of [[fakeV4], [fakeV4, fakeV6]]) {
      system = answers;
      assert.deepEqual(await play(), [200, { phase: 'complete', range: false, bytes: true, recoveredDns: true, status: 200 }]);
      assert.deepEqual(pinned.at(-1), [cdn, [publicV4, publicV6]]);
      assert.equal(arrived.at(-1), `${cdn}:${origin.address().port}`);
    }
    family = 'IPv6';
    assert.equal((await play())[0], 200);
    assert.deepEqual(pinned.at(-1), [cdn, [publicV6]]);
    assert.deepEqual(calls.at(-1), [cdn, 6]);
    system = [publicV4, fakeV6]; // A valid OS address of the wrong family does not authorize a fallback.
    assert.equal((await play())[1].reason, 'address');
    family = 0;
    assert.equal((await play())[1].recoveredDns, undefined);
    assert.deepEqual(pinned.at(-1), [cdn, [publicV4]]);
    system = [fakeV4, fakeV6, privateV4];
    assert.equal((await play())[1].reason, 'address');
    system = [fakeV4, fakeV6];
    network = false;
    assert.equal((await play())[1].reason, 'address');
    network = true;
    for (const [url, id] of [[`https://${cdn}/audio`, ''], [`https://${cdn}:8443/audio`, 'kugou'], ['https://unrelated.example/audio', 'kugou']])
      assert.equal((await play(url, id))[1].reason, 'address');
    assert.equal(calls.length, 3);
    assert.equal((await play(`https://${cdn}/redirect`))[1].reason, 'address');
    assert.deepEqual(calls.slice(3), [[cdn, 0]]);
    assert.equal((await play(`https://${cdn}/backup`))[0], 200);
    assert.deepEqual(calls.slice(4), [[cdn, 0], [backup, 0]]);
    assert.equal(arrived.at(-1), `${backup}:${origin.address().port}`);
    recovered = [privateV4, fakeV6];
    assert.equal((await play())[1].reason, 'address_recovery');
  } finally { await close(server); await close(origin); }
});

test('disconnecting the playback client aborts an in-flight KuGou DNS recovery', { timeout: 3000 }, async () => {
  let notifyStarted;
  const started = new Promise(resolve => { notifyStarted = resolve; });
  const gateway = createMediaGateway({
    lookup(_host, _options, callback) { callback(null, [{ address: '198.18.8.7', family: 4 }]); },
    allowKugouDns: () => true,
    resolveKugouDns(_host, { signal }) {
      notifyStarted(signal);
      return new Promise(resolve => signal.addEventListener('abort', () => resolve([]), { once: true }));
    },
  });
  const server = http.createServer((req, res) => gateway.handle(req, res, new URL(req.url, 'http://127.0.0.1')));
  await listen(server);
  const path = gateway.register({ url: 'https://fsmobile.kugou.com/audio' }, 'kugou');
  const request = http.get(`http://127.0.0.1:${server.address().port}${path}`);
  request.once('error', () => {});
  try {
    const signal = await started;
    const cancelled = new Promise(resolve => signal.addEventListener('abort', resolve, { once: true }));
    request.destroy();
    await cancelled;
    assert.equal(signal.aborted, true);
  } finally { request.destroy(); await close(server); }
});
