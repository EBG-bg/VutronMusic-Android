"use strict";
const assert = require('node:assert/strict');
const { EventEmitter } = require('node:events');
const { Readable } = require('node:stream');
const test = require('node:test');
const { createMediaDnsResolver } = require('../src/main/assets/sources-runtime/media-dns.cjs');

const host = 'fsmobile.tx.kugou.com';
const cname = 'cdn.example.com.';
function mockRequest(reply) {
  const calls = [];
  const open = new Set();
  function request(options, listener) {
    assert.equal(options.hostname, 'dns.alidns.com');
    assert.equal(options.servername, 'dns.alidns.com');
    assert.equal(options.headers.accept, 'application/dns-json');
    assert.equal(options.rejectUnauthorized, true, 'DoH requires TLS certificate verification');
    const query = new URL(options.path, 'https://dns.alidns.com');
    assert.equal(query.pathname, '/resolve');
    const parsed = { name: query.searchParams.get('name'), type: query.searchParams.get('type') };
    options.lookup(options.hostname, {}, (error, address, family) => {
      assert.ifError(error); assert.equal(family, 4); parsed.bootstrap = address;
    });
    calls.push(parsed);
    const client = new EventEmitter();
    open.add(client);
    client.destroy = () => { open.delete(client); client.emit('close'); };
    client.end = () => queueMicrotask(() => {
      if (!open.has(client)) return;
      const result = reply(parsed);
      if (!result) return;
      const response = Readable.from([Buffer.from(result.body || '')]);
      response.statusCode = result.status || 200;
      listener(response);
    });
    return client;
  }
  return { calls, request, open };
}
function answer(name, type, rows, extras = {}) {
  return JSON.stringify({Status:0,Question:{name:`${name}.`,type},Answer:rows,...extras});
}
const row = (name, type, data) => ({name,type,data});

test('DoH returns matching A and AAAA records and validated CNAME ownership only', async () => {
  const fixture = mockRequest(({name,type}) => ({body: type === 'A'
    ? answer(name,1,[row('unrelated.example.',1,'8.8.4.4'),row(name,5,cname),row(cname,1,'8.8.8.8'),row(cname,1,'8.8.8.8'),row(cname,1,'::1')])
    : answer(name,28,[row(name,28,'2606:4700:4700::1111'),row(name,1,'1.1.1.1')])}));
  const resolve = createMediaDnsResolver({request:fixture.request});
  assert.deepEqual(await resolve(host), [{address:'8.8.8.8',family:4},{address:'2606:4700:4700::1111',family:6}]);
  assert.deepEqual(fixture.calls, [{name:host,type:'A',bootstrap:'223.5.5.5'},{name:host,type:'AAAA',bootstrap:'223.5.5.5'}]);
  assert.equal(fixture.open.size, 0);
});

test('only the requested family uses the backup DoH endpoint when the primary times out', async () => {
  const fixture = mockRequest(({ name,bootstrap }) => bootstrap === '223.5.5.5' ? null : {body:answer(name,28,[row(name,28,'2606:4700:4700::1111')])});
  const resolve = createMediaDnsResolver({request:fixture.request,timeoutMs:25,overallMs:220});
  assert.deepEqual(await resolve(host, { family:6 }), [{address:'2606:4700:4700::1111',family:6}]);
  assert.deepEqual(fixture.calls.map(({bootstrap,type})=>[bootstrap,type]), [['223.5.5.5','AAAA'],['223.6.6.6','AAAA']]);
  assert.equal(fixture.open.size,0);
});

test('redirects, truncated, wrong-question and oversized replies cannot become addresses', async () => {
  const cases = [{status:302,body:answer(host,1,[row(host,1,'1.1.1.1')])},
    {body:answer(host,1,[row(host,1,'1.1.1.1')],{TC:true})},
    {body:answer('elsewhere.example',1,[row(host,1,'1.1.1.1')])},
    {body:answer(host,1,[row(host,1,'1.1.1.1')])+' '.repeat(8192)}];
  for (const result of cases) {
    const fixture = mockRequest(() => result);
    const resolve = createMediaDnsResolver({request:fixture.request});
    assert.deepEqual(await resolve(host, { family:4 }), []);
    assert.equal(fixture.open.size, 0);
  }
});

test('strict input cannot append a query, contact a literal address, or request other DNS record types', async () => {
  const fixture = mockRequest(() => { throw new Error('unexpected DNS lookup'); });
  const resolve = createMediaDnsResolver({request:fixture.request});
  for(const [name,family] of [['8.8.8.8',4],['http://a.example/path',4],['a.example&token=supply',4],['::1',6],['.',4],['a.example',99]])
    assert.deepEqual(await resolve(name, { family }), []);
  assert.deepEqual(fixture.calls, []);
});

test('aborting a closed media hop destroys DoH work and cannot start backup queries', async () => {
  const fixture = mockRequest(() => null);
  const controller = new AbortController();
  const resolve = createMediaDnsResolver({request:fixture.request,timeoutMs:1000,overallMs:2000});
  const pending = resolve(host, {signal:controller.signal});
  assert.equal(fixture.calls.length,2);
  controller.abort();
  assert.deepEqual(await pending, []);
  assert.equal(fixture.open.size,0);
  assert.equal(fixture.calls.length,2);
});
