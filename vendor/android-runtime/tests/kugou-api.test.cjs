'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const runtime = path.resolve(__dirname, '../src/main/assets/sources-runtime');
const { deviceCookies, cookieObject, apiModule, fullAudio, songUrl } = require(path.join(runtime, 'plugin-kugou-api.cjs'));

test('every concrete upstream Kugou route loads its shipped API module without a server entry', () => {
  const source = fs.readFileSync(path.join(runtime, 'plugins/kugou.js'), 'utf8').split('\n').filter(line => !line.trimStart().startsWith('//')).join('\n');
  const methods = new Set([...source.matchAll(/\bget\(\s*['"]([a-z0-9/]+)['"]/g)].map(match => match[1].replaceAll('/', '_')));
  assert.equal(methods.size, 51);
  for (const method of methods) assert.equal(typeof apiModule(method), 'function', method);
  assert.equal(apiModule('missing_fixture_method'), undefined);
  assert.equal(Object.keys(require.cache).some(file => /[\\/]kugoumusicapi[\\/](?:main|server)\.js$/.test(file)), false);
});

test('Kugou device cookies are generated per instance and do not store login credentials', () => {
  const first = deviceCookies();
  assert.match(first.KUGOU_API_GUID, /^[a-f0-9]{32}$/);
  assert.match(first.KUGOU_API_MID, /^\d+$/);
  assert.match(first.KUGOU_API_DEV, /^[A-Z0-9]{10}$/);
  assert.match(first.KUGOU_API_WEBGL, /^\d+$/);
  assert.equal(first.KUGOU_API_MAC, '02:00:00:00:00:00');
  assert.equal(deviceCookies(first), first);
  assert.notEqual(deviceCookies().KUGOU_API_GUID, first.KUGOU_API_GUID);
  assert.deepEqual(Object.keys(first).sort(), ['KUGOU_API_DEV', 'KUGOU_API_GUID', 'KUGOU_API_MAC', 'KUGOU_API_MID', 'KUGOU_API_WEBGL']);
  assert.deepEqual(cookieObject('token=test=value; userid=42; dfid=local-device'), { token: 'test=value', userid: '42', dfid: 'local-device' });
});

test('Kugou playback selects the highest full authorized quality and keeps album identity and device cookies', async () => {
  const calls = [], cookie = { userid: '17', token: 'fixture', dfid: 'device' };
  const result = await songUrl({ hash: 'abc', album: { id: '123' }, mxid: '456', cookie }, async (method, params) => {
    calls.push({ method, params });
    return { status: 200, body: params.quality === 'high' ? { status: 1, url: [] } : { status: 1, url: 'https://audio.invalid/full.flac', volume: -9 } };
  });
  assert.deepEqual(calls.map(call => call.params.quality), ['high', 'flac']);
  assert.equal(calls[0].params.album_id, '123'); assert.equal(calls[0].params.album_audio_id, '456');
  assert.equal(calls[0].params.free_part, 0); assert.equal(calls[0].params.cookie, cookie);
  assert.deepEqual(result.body.url, ['https://audio.invalid/full.flac']); assert.deepEqual(result.body.backupUrl, []);
});

test('Kugou playback rejects trial audio, supports backup-only URLs and does not retry network failures', async () => {
  assert.equal(fullAudio({ status: 1, url: ['https://audio.invalid/part/test.mp3'] }), false);
  assert.equal(fullAudio({ status: 1, url: ['https://audio.invalid/full.mp3'], is_free_part: 1 }), false);
  const calls=[];
  const result=await songUrl({hash:'abc'}, async (_method, params)=>{
    calls.push(params.quality);
    return {status:200,body:params.quality==='128'?{status:1,backup_url:['https://audio.invalid/full.mp3']}:{status:1,url:[]}};
  });
  assert.deepEqual(calls,['high','flac','320','128']);assert.deepEqual(result.body.backupUrl,['https://audio.invalid/full.mp3']);
  let attempts=0;
  await assert.rejects(songUrl({hash:'abc'},async()=>{attempts++;throw Object.assign(new Error('offline'),{code:'ECONNRESET'})}),{code:'ECONNRESET'});
  assert.equal(attempts,1);
});

test('logged-in Kugou sessions can use the documented authorization endpoint only after ordinary full URLs are unavailable', async () => {
  const calls=[],cookie={token:'fixture-token',userid:'17',dfid:'fixture-device'};
  const result=await songUrl({hash:'abc',cookie},async(method,params)=>{
    calls.push({method,params});
    const body=method==='user_verify'?{status:1,data:{auth:'user-authorization'}}
      :method==='song_auth'?{status:1,data:{auth:'song-authorization',open_time:123}}
      :{status:1,url:method==='song_url_auth'&&params.quality==='128'?['https://audio.invalid/authorized.mp3']:[],backupUrl:[]};
    return {status:200,body};
  });
  assert.deepEqual(calls.slice(0,4).map(call=>call.method),Array(4).fill('song_url'));
  assert.deepEqual(calls.slice(4,6).map(call=>call.method),['user_verify','song_auth']);
  const authorized=calls.filter(call=>call.method==='song_url_auth');
  assert.deepEqual(authorized.map(call=>call.params.quality),['high','flac','320','128']);
  for(const call of authorized){assert.equal(call.params.auth,'song-authorization');assert.equal(call.params.open_time,123);assert.equal(call.params.cookie,cookie);assert.equal(call.params.free_part,0);}
  assert.deepEqual(result.body.url,['https://audio.invalid/authorized.mp3']);
});
