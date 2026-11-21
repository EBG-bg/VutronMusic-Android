'use strict';
const http = require('http');
const https = require('https');
const dns = require('dns');
const net = require('net');
const crypto = require('crypto');

function addressKind(address) {
  const version = net.isIP(address);
  let a, b;
  if (version === 4) {
    [a, b] = address.split('.').map(Number);
  } else if (version === 6 && !address.includes('%')) {
    const value = new URL(`http://[${address}]/`).hostname.slice(1, -1);
    const mapped = /^::ffff:([0-9a-f]+):[0-9a-f]+$/.exec(value);
    if (!mapped) {
      if (/^2001:2:(?::|0:)/.test(value)) return 'synthetic';
      return value.startsWith('::') || /^(fc|fd|fe[89ab]|ff)/.test(value) ? 'blocked' : 'public';
    }
    // The mapped address can be written in hex as well as dotted IPv4.
    const high = parseInt(mapped[1], 16);
    a = high >>> 8;
    b = high & 255;
  } else {
    return 'blocked';
  }
  if (a === 198 && (b === 18 || b === 19)) return 'synthetic';
  return a === 0 || a === 10 || a === 127 || a >= 224 || a === 169 && b === 254 || a === 172 && b >= 16 && b <= 31
    || a === 192 && [0, 168].includes(b) || a === 100 && b >= 64 && b <= 127 ? 'blocked' : 'public';
}
function publicAddress(address) { return addressKind(address) === 'public'; }
const KUGOU_AUDIO_CDNS = new Set(['fsandroid.kugou.com', 'fsandroid.tx.kugou.com', 'fsmobile.kugou.com', 'fsmobile.tx.kugou.com']);
const kugouAudioUrl = url => !url.port && KUGOU_AUDIO_CDNS.has(url.hostname);
function syntheticAddress({ address, family }) {
  return net.isIP(address) === family && addressKind(address) === 'synthetic';
}
function publicLookup(hostname, options, callback, lookup, recover) {
  const requested = typeof options === 'number' ? options : options?.family;
  const family = requested === 'IPv4' ? 4 : requested === 'IPv6' ? 6 : requested;
  lookup(hostname, { all: true, verbatim: true }, (error, addresses) => {
    if (error) return callback(error);
    // DNS may return a synthetic/private record and a public address together.
    // Pass only the validated concrete addresses into net.connect; it must not
    // fall back to a new lookup or an unchecked record.
    const publicAnswers = entries => entries.filter(item => (item.family === 4 || item.family === 6)
      && (!family || family === item.family) && net.isIP(item.address) === item.family && publicAddress(item.address));
    const available = publicAnswers(addresses);
    const send = entries => options?.all ? callback(null, entries) : callback(null, entries[0].address, entries[0].family);
    if (available.length) return send(available);
    const reject = attempted => callback(Object.assign(new Error('No eligible public media address'),
      { code: attempted ? 'MEDIA_ADDRESS_RECOVERY_FAILED' : 'MEDIA_ADDRESS_REJECTED' }));
    // A real public answer of another family or an actual private address
    // must not trigger recovery. Only known synthetic ranges qualify.
    if (!recover || !addresses.length || !addresses.every(syntheticAddress)) return reject(false);
    Promise.resolve().then(() => recover(family || 0)).then(result => {
      const verified = publicAnswers(result || []);
      if (verified.length) send(verified);
      else reject(result !== undefined);
    }, () => reject(true));
  });
}
function mediaUrl(value) {
  const url = new URL(value);
  if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password || url.hash
      || url.hostname === 'localhost' || url.hostname.endsWith('.localhost')
      || net.isIP(url.hostname.replace(/^\[|\]$/g, '')) && !publicAddress(url.hostname.replace(/^\[|\]$/g, ''))) throw new Error('Invalid media URL');
  return url;
}

const mediaPath = /^\/media\/([a-f0-9]{48})$/;
const START_FAILURE_REASONS = new Set(['address', 'address_recovery', 'dns', 'connection']);
const START_FAILURE_HTTP = new Set([401, 403, 404, 410]);
function confirmedStartFailure(state) {
  if (state.bytes || !(START_FAILURE_REASONS.has(state.reason) || state.reason === 'http' && START_FAILURE_HTTP.has(state.status))) return null;
  return { phase: 'failed', reason: state.reason, range: state.range, bytes: false,
    ...(state.status !== undefined ? { status: state.status } : {}), ...(state.recoveredDns ? { recoveredDns: true } : {}) };
}
function createMediaGateway({ request = (url, options, callback) => (url.protocol === 'https:' ? https : http).request(url, options, callback), now = Date.now, lookup = dns.lookup,
  resolveKugouDns = (hostname, options) => require('./media-dns.cjs').resolveMediaHost(hostname, options),
  allowKugouDns = () => false, startTimeoutMs = 8000, idleTimeoutMs = 20000, startFailureWaitMs = 12000, startFailureSettleMs = 250 } = {}) {
  const sources = new Map();
  function finishStartup(source, result = null) {
    const startup = source.startup;
    if (!startup) return;
    source.startup = null;
    clearTimeout(startup.settle);
    clearTimeout(startup.deadline);
    const notify = startup.notify;
    startup.notify = null;
    notify?.(result);
  }
  function forget(id) {
    const source = sources.get(id);
    sources.delete(id);
    finishStartup(source);
  }
  function findSource(path) {
    const id = mediaPath.exec(path)?.[1], source = id && sources.get(id);
    if (!source || source.expires >= now()) return source;
    forget(id);
  }
  function settleStartup(source, startup) {
    if (!startup.notify || startup.active || !startup.failure) return;
    clearTimeout(startup.settle);
    // Let the player issue an immediate retry before treating a failed probe
    // as terminal for this registration. Other GETs can still deliver audio.
    startup.settle = setTimeout(() => {
      finishStartup(source, source.expires >= now() && allowKugouDns(source.kugouId) ? startup.failure : null);
    }, startFailureSettleMs);
  }
  function hasStartFailureWatch(path) { return !!findSource(path)?.startup; }
  function watchStartFailure(path, notify) {
    const source = findSource(path), startup = source?.startup;
    if (!startup || startup.notify || !allowKugouDns(source.kugouId)) { notify(null); return; }
    startup.notify = notify;
    startup.deadline = setTimeout(() => finishStartup(source), Math.min(startFailureWaitMs, source.expires - now() + 1));
    settleStartup(source, startup);
    return () => {
      if (source.startup !== startup) return;
      startup.notify = null;
      finishStartup(source);
    };
  }
  function revokeStartFailures(kugouId) {
    for (const source of sources.values()) if (!kugouId || source.kugouId === kugouId) finishStartup(source);
  }
  function register(value, kugouId = '') {
    const url = mediaUrl(value.url);
    const headers = {};
    // These are media-provider headers, never the user's account credentials.
    for (const [name, item] of Object.entries(value.headers || {})) {
      if (!['referer', 'origin', 'user-agent', 'accept'].includes(name.toLowerCase())) continue;
      if (typeof item !== 'string' || /[\r\n]/.test(item) || item.length > 4096) throw new Error('Invalid media header');
      headers[name.toLowerCase()] = item;
    }
    for (const [key, item] of sources) if (item.expires < now()) forget(key);
    while (sources.size >= 64) forget(sources.keys().next().value);
    const id = crypto.randomBytes(24).toString('hex');
    const owner = kugouAudioUrl(url) ? kugouId : '';
    const startup = owner && allowKugouDns(owner) ? { active: 0, read: 0, failure: null } : null;
    sources.set(id, { url, headers, kugouId: owner, startup, expires: now() + 6 * 60 * 60 * 1000, playback: { phase: 'registered' } });
    return '/media/' + id;
  }
  function describe(path) {
    const source = findSource(path);
    return source ? { ...source.playback } : null;
  }
  function handle(incoming, outgoing, target) {
    if (!target.pathname.startsWith('/media/') || target.pathname === '/media/register') return false;
    const source = findSource(target.pathname);
    if (!['GET', 'HEAD'].includes(incoming.method) || !source) {
      outgoing.writeHead(404); outgoing.end(); return true;
    }
    const range = incoming.headers.range;
    const offset = Number(/^bytes=(\d+)-\d*$/i.exec(range || '')?.[1]);
    const state = { phase: 'connecting', range: Boolean(range), bytes: false };
    let startup, read;
    const initial = range === undefined || offset === 0;
    if (incoming.method === 'GET') {
      source.playback = state;
      startup = source.startup;
      if (startup) {
        read = ++startup.read;
        startup.failure = null;
        startup.active++;
        clearTimeout(startup.settle);
      }
    }
    function finishRead(result = null) {
      if (!startup || source.startup !== startup) return;
      startup.active--;
      // A newer GET may be testing a different range. An older failed start
      // cannot override the outcome of that newer probe.
      if (read === startup.read && initial) startup.failure = result && confirmedStartFailure(result);
      settleStartup(source, startup);
      startup = undefined;
    }
    let current, ended = false, lookupCancel;
    const deadline = setTimeout(() => fail(state.phase === 'headers' ? 'first_byte_timeout' : 'headers_timeout'), startTimeoutMs);
    function fail(reason, code = 502, headers = {}) {
      if (ended || outgoing.destroyed || outgoing.writableEnded) return;
      ended = true;
      clearTimeout(deadline);
      state.phase = 'failed'; state.reason = reason;
      finishRead(state);
      lookupCancel?.abort();
      current?.destroy(); current = undefined;
      if (outgoing.headersSent) { outgoing.destroy(); return; }
      outgoing.writeHead(code, { 'cache-control': 'no-store', ...headers }); outgoing.end();
    }
    outgoing.once('close', () => {
      clearTimeout(deadline);
      finishRead();
      ended = true;
      lookupCancel?.abort();
      current?.destroy(); current = undefined;
    });
    function forward(url, redirects) {
      if (ended || outgoing.destroyed) return;
      const headers = { ...source.headers, 'accept-encoding': 'identity' };
      if (range) headers.range = range;
      if (incoming.headers['if-range']) headers['if-range'] = incoming.headers['if-range'];
      const resolve = (hostname, options, callback) => publicLookup(hostname, options, callback, lookup,
        source.kugouId && kugouAudioUrl(url) && hostname === url.hostname ? async family => {
          if (ended || !allowKugouDns(source.kugouId)) return undefined;
          lookupCancel = new AbortController();
          state.recoveredDns = true;
          const result = await resolveKugouDns(hostname, { family, signal: lookupCancel.signal });
          return !ended && allowKugouDns(source.kugouId) ? result : [];
        } : undefined);
      try {
        // Node 18 defaults to a single DNS answer. Try the checked set if the first address fails.
        const hop = request(url, { method: incoming.method, headers, lookup: resolve, autoSelectFamily: true }, response => {
          if (ended || current !== hop || outgoing.destroyed) { response.destroy(); return; }
          if ([301, 302, 303, 307, 308].includes(response.statusCode) && response.headers.location) {
            try {
              if (redirects >= 5) { fail('redirect'); return; }
              forward(mediaUrl(new URL(response.headers.location, url).href), redirects + 1);
            } catch { fail('redirect'); }
            finally { response.destroy(); } // An unused redirect body must not keep its socket alive.
            return;
          }
          const status = response.statusCode || 502;
          state.status = status;
          if (status < 200 || status >= 300) {
            // The player needs the status, never an upstream HTML/login body.
            const contentRange = response.headers['content-range'];
            fail('http', status >= 400 ? status : 502, status === 416 && contentRange ? { 'content-range': contentRange } : {});
            return;
          }
          if (offset > 0 && (status !== 206 || Number(/^bytes (\d+)-\d+\/(?:\d+|\*)$/i.exec(response.headers['content-range'] || '')?.[1]) !== offset)) {
            // MediaHTTPConnection reopens the stream at this offset for a seek.
            fail('range'); return;
          }
          const resultHeaders = { 'cache-control': 'no-store' };
          for (const name of ['content-type', 'content-length', 'content-range', 'accept-ranges', 'content-encoding', 'etag', 'last-modified']) {
            if (response.headers[name] !== undefined) resultHeaders[name] = response.headers[name];
          }
          state.phase = 'headers';
          response.once('error', () => { if (current === hop) fail('truncated'); });
          if (incoming.method === 'HEAD') {
            clearTimeout(deadline);
            ended = true; current = undefined;
            outgoing.writeHead(status, resultHeaders); outgoing.end(); response.resume();
            return;
          }
          // Only release successful headers with the first audio data. The same
          // start deadline covers the entire redirect chain and the first byte.
          response.once('data', () => {
            if (ended || current !== hop || outgoing.destroyed) return;
            clearTimeout(deadline);
            state.phase = 'streaming'; state.bytes = true;
            if (startup && source.startup === startup) finishStartup(source);
            startup = undefined;
            outgoing.writeHead(status, resultHeaders);
          });
          response.once('end', () => {
            if (ended || current !== hop) return;
            if (!state.bytes) { fail('empty'); return; }
            state.phase = 'complete'; ended = true; current = undefined;
          });
          response.pipe(outgoing);
        });
        current = hop;
        hop.setTimeout(idleTimeoutMs, () => { if (current === hop) fail('idle_timeout'); });
        hop.once('error', error => {
          if (current !== hop) return;
          fail(error.code === 'MEDIA_ADDRESS_REJECTED' ? 'address' : error.code === 'MEDIA_ADDRESS_RECOVERY_FAILED' ? 'address_recovery'
            : ['ENOTFOUND', 'EAI_AGAIN', 'EAI_FAIL'].includes(error.code) ? 'dns' : 'connection');
        });
        hop.end();
      } catch { fail('connection'); }
    }
    forward(source.url, 0);
    return true;
  }
  return { register, handle, describe, hasStartFailureWatch, watchStartFailure, revokeStartFailures };
}
module.exports = { createMediaGateway, publicAddress, mediaUrl };
