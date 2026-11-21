"use strict";
const https = require('node:https');
const net = require('node:net');

const DNS_HOST = 'dns.alidns.com';
const BOOTSTRAPS = ['223.5.5.5', '223.6.6.6'];
const MAX_RESPONSE_BYTES = 8192;
const MAX_ANSWERS = 32;
const DNS_NAME = /^(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?$/;

function canonicalName(value) {
  if (typeof value !== 'string' || value.length > 254) return '';
  const name = value.toLowerCase().replace(/\.$/, '');
  return DNS_NAME.test(name) ? name : '';
}

function parseAnswer(body, name, family) {
  let data;
  try { data = JSON.parse(body); } catch { return []; }
  const type = family === 4 ? 1 : 28;
  // AliDNS's JSON endpoint may use a single question object rather than the
  // array used by some DoH JSON services.
  const question = Array.isArray(data?.Question) ? data.Question[0] : data?.Question;
  if (data?.Status !== 0 || data.TC || canonicalName(question?.name) !== name || question?.type !== type
      || !Array.isArray(data.Answer) || data.Answer.length > MAX_ANSWERS) return [];
  const owners = new Set([name]);
  // Honor only addresses in the actual answer chain, never unrelated records.
  for (let i = 0; i < 8; i++) {
    const previous = owners.size;
    for (const row of data.Answer) {
      if (row?.type !== 5 || !owners.has(canonicalName(row.name))) continue;
      const next = canonicalName(row.data);
      if (next) owners.add(next);
    }
    if (owners.size === previous) break;
  }
  const addresses = new Set();
  for (const row of data.Answer)
    if (row?.type === type && owners.has(canonicalName(row.name)) && typeof row.data === 'string' && net.isIP(row.data) === family)
      addresses.add(row.data);
  return [...addresses].slice(0, 8).map(address => ({ address, family }));
}

/** Called only by the media gateway for an eligible CDN's rejected OS answer. */
function createMediaDnsResolver({request = https.request, timeoutMs = 900, overallMs = 2000} = {}) {
  function query(host, family, bootstrap, remaining, signal) {
    return new Promise(resolve => {
      let client, timer, finished = false;
      function done(result = []) {
        if (finished) return;
        finished = true;
        clearTimeout(timer);
        signal?.removeEventListener('abort', onAbort);
        client?.destroy();
        resolve(result);
      }
      const onAbort = () => done();
      if (signal?.aborted) { done(); return; }
      signal?.addEventListener('abort', onAbort, { once: true });
      timer = setTimeout(done, Math.min(remaining, timeoutMs));
      try {
        client = request({
          hostname: DNS_HOST, port: 443, servername: DNS_HOST, method: 'GET', agent: false, rejectUnauthorized: true,
          headers: { accept: 'application/dns-json' },
          path: '/resolve?name=' + encodeURIComponent(host) + '&type=' + (family === 4 ? 'A' : 'AAAA'),
          // Fixed resolver endpoint, ordinary TLS trust and DNS-name verification.
          lookup(_host, options, callback) {
            if (options.all) callback(null, [{ address: bootstrap, family: 4 }]);
            else callback(null, bootstrap, 4);
          },
        }, response => {
          response.once('error', () => done());
          response.once('aborted', () => done());
          if (response.statusCode !== 200) { done(); return; }
          const data = [];
          let size = 0;
          response.on('data', chunk => {
            size += chunk.length;
            if (size > MAX_RESPONSE_BYTES) done();
            else data.push(chunk);
          });
          response.once('end', () => done(parseAnswer(Buffer.concat(data), host, family)));
        });
        client.once('error', () => done());
        client.once('close', () => { if (!finished) done(); });
        client.end();
      } catch { done(); }
    });
  }

  return async function resolveMediaHost(hostname, { family = 0, signal } = {}) {
    const name = canonicalName(hostname);
    if (!name || net.isIP(name) || signal?.aborted || ![0, 4, 6].includes(family)) return [];
    const deadline = Date.now() + overallMs;
    const types = family ? [family] : [4, 6];
    // Only query the backup resolver for families which the primary did not
    // resolve. Both families, when requested, share the same overall budget.
    return (await Promise.all(types.map(async requested => {
      for (const bootstrap of BOOTSTRAPS) {
        const remaining = deadline - Date.now();
        if (remaining <= 0 || signal?.aborted) break;
        const addresses = await query(name, requested, bootstrap, remaining, signal);
        if (signal?.aborted) return [];
        if (addresses.length) return addresses;
      }
      return [];
    }))).flat();
  };
}

module.exports = { createMediaDnsResolver, resolveMediaHost: createMediaDnsResolver() };
