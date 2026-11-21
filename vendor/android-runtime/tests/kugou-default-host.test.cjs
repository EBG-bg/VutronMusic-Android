'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const http = require('node:http');
const runtime = path.resolve(__dirname, '../src/main/assets/sources-runtime');
const { createPluginHost } = require(path.join(runtime, 'plugin-host.cjs'));
const contract = require(path.join(runtime, 'plugin-contract.cjs'));
const temporaryRoot = os.tmpdir();

function response(body) { return { body, status: 200, cookie: [] }; }
function stubApi(overrides = {}) {
  const calls = [];
  const handlers = {
    register_dev: () => ({ status: 1, data: { dfid: 'fixture-device' } }),
    login_qr_key: () => ({ status: 1, data: { qrcode: 'fixture-key' } }),
    login_qr_check: () => ({ status: 1, data: { status: 1 } }),
    user_detail: () => ({ status: 1, data: {} }),
    artist_lists: () => ({ status: 1, data: { list: [] } }),
    user_follow: () => ({ status: 1, data: { lists: [] } }),
    user_vip_detail: params => ({ status: 1, data: { userid: Number(cookieFields(params.cookie).userid) || 0, busi_vip: [] } }),
    user_playlist: () => ({ status: 1, data: { info: [] } }),
    login_token: params => ({ status: 1, data: { token: params.token } }),
    ...overrides
  };
  const api = Object.fromEntries(Object.entries(handlers).map(([method, handler]) => [method, async params => {
    calls.push({ method, params: structuredClone(params) });
    return response(await handler(params));
  }]));
  return { api, calls };
}
function fixture(t, options = {}) {
  const root = fs.mkdtempSync(path.join(temporaryRoot, 'vutron-kugou-default-'));
  // Android/Linux permit ':' in instance state filenames. A narrow Win32-only
  // fixture mapping avoids NTFS alternate streams without changing runtime IDs.
  const methods = ['readFileSync', 'writeFileSync', 'statSync', 'existsSync', 'unlinkSync', 'renameSync'];
  const original = Object.fromEntries(methods.map(method => [method, fs[method]]));
  const portable = file => {
    if (process.platform !== 'win32' || typeof file !== 'string') return file;
    const absolute = path.resolve(file), prefix = root + path.sep;
    return absolute.startsWith(prefix) ? prefix + absolute.slice(prefix.length).replaceAll(':', '%3A') : file;
  };
  if (process.platform === 'win32') for (const method of methods) fs[method] = function (file, ...args) {
    if (method === 'renameSync') args[0] = portable(args[0]);
    return original[method].call(fs, portable(file), ...args);
  };
  const previousTmp = process.env.TMPDIR;
  const open = () => createPluginHost({ root, builtins: path.join(runtime, 'plugins'), workerFile: path.join(runtime, 'plugin-worker.cjs'), validateMeta: contract.validateMeta, validateResult: contract.validateResult, ...options });
  let host = open();
  t.after(async () => {
    host.close();
    await new Promise(resolve => setTimeout(resolve, 60));
    if (previousTmp === undefined) delete process.env.TMPDIR;
    else process.env.TMPDIR = previousTmp;
    try { fs.rmSync(root, { recursive: true, force: true }); }
    finally { for (const method of methods) fs[method] = original[method]; }
  });
  return {
    root, current: () => host,
    async restart() { host.close(); await new Promise(resolve => setTimeout(resolve, 60)); host = open(); return host; },
    state(id) {
      try { return JSON.parse(fs.readFileSync(path.join(root, id + '.state.json'), 'utf8')); }
      catch (error) { if (error.code === 'ENOENT') return {}; throw error; }
    },
    write(id, data) { fs.writeFileSync(path.join(root, id + '.state.json'), JSON.stringify(data)); }
  };
}
test('rank details start at page one and KuGou reports rows dropped by its original playlist filter', async t => {
  const stub = stubApi({
    rank_info: () => ({ status: 1, data: { rankid: 12, rankname: 'Fixture ranking' } }),
    rank_audio: () => ({ status: 1, data: { songlist: [] } }),
    playlist_track_all: () => ({ status: 1, data: { songs: [{ shield: true, hash: 'blocked' }, { shield: false }] } })
  });
  const host = fixture(t, { kugouApi: stub.api }).current();
  await host.manage({ action: 'enable', id: 'kugou' });
  const first = await host.call('kugou', 'getPlaylistDetail', { id: 12, type: 'rank' }, true);
  assert.equal(first.code, 200);
  assert.equal(first.data.sourceContext.page, 2);
  await host.call('kugou', 'getPlaylistTracks', first.data.sourceContext, true);
  assert.deepEqual(stub.calls.filter(item => item.method === 'rank_audio').map(item => Number(item.params.page)), [1, 2]);
  const rows = await host.call('kugou', 'getPlaylistTracks', { id: 'fixture', page: 1 }, true);
  assert.equal(rows.code, 200);
  assert.equal(rows.data.length, 0);
  assert.equal(rows.skippedUnavailableTracks, 2);
});

function row(host, id = 'kugou') { return host.list().plugins.find(plugin => plugin.id === id); }
function cookieFields(cookie) {
  if (cookie && typeof cookie === 'object') return cookie;
  return Object.fromEntries(String(cookie || '').split(';').map(part => part.trim()).filter(Boolean).map(part => {
    const split = part.indexOf('='); return [part.slice(0, split), part.slice(split + 1)];
  }));
}

test('the original Kugou QR flow uses the built-in API without storing a default server or changing anonymous scope', async t => {
  const stub = stubApi();
  const f = fixture(t, { kugouApi: stub.api }), host = f.current();
  const scope = row(host).accountScope;
  assert.equal(row(host).baseUrl, '');
  assert.equal(stub.calls.length, 0, 'Listing sources is metadata-only');
  await host.manage({ action: 'enable', id: 'kugou' });
  assert.equal(stub.calls.length, 0, 'Enabling a source does not initialize its API');
  const account = await host.call('kugou', 'getAccount', {}, false);
  assert.equal(account.code, 200);
  assert.equal(account.baseUrl, '', 'The public account result keeps the user configuration, not the virtual routing URL');
  assert.equal(stub.calls.length, 0, 'An offline account read makes no platform requests');
  const qr = await host.call('kugou', 'loginQrKey', {}, true);
  assert.equal(qr.code, 200);
  assert.equal(qr.data.qrcode, 'fixture-key');
  assert.equal(new URL(qr.data.url).searchParams.get('qrcode'), 'fixture-key');
  assert.equal(stub.calls.filter(call => call.method === 'login_qr_key').length, 1);
  assert.equal(row(host).baseUrl, '');
  assert.equal(row(host).accountScope, scope);
  assert.equal(f.state('kugou').store?.baseUrl || '', '');
  const device = f.state('kugou').kugouDevice;
  assert.match(device.KUGOU_API_GUID, /^[a-f0-9]{32}$/);
  const restored = await f.restart();
  assert.equal(row(restored).baseUrl, '');
  assert.equal(row(restored).accountScope, scope);
  assert.equal((await restored.call('kugou', 'loginQrKey', {}, true)).code, 200);
  assert.deepEqual(f.state('kugou').kugouDevice, device, 'The same instance keeps its private device identity across restarts');
});

test('a worker initialized offline registers its playback device once and recovers from unavailable high quality', async t => {
  const stub = stubApi({ song_url: params => ({ status: 1, url: params.quality === '128' ? ['https://audio.invalid/full.mp3'] : [], backupUrl: [] }) });
  const f=fixture(t,{kugouApi:stub.api}),host=f.current();
  await host.manage({action:'enable',id:'kugou'});
  await host.call('kugou','getAccount',{},false);
  assert.equal(stub.calls.length,0);
  const source={hash:'fixture-hash',album:{id:'123'},mxid:'456'};
  const first=await host.call('kugou','songUrl',source,true);
  assert.equal(first.code,200);assert.deepEqual(first.data.url,['https://audio.invalid/full.mp3']);
  const urls=stub.calls.filter(call=>call.method==='song_url');
  assert.deepEqual(urls.map(call=>call.params.quality),['high','flac','320','128']);
  for(const call of urls){assert.equal(call.params.cookie.dfid,'fixture-device');assert.equal(call.params.album_id,'123');assert.equal(call.params.album_audio_id,'456');}
  assert.equal(f.state('kugou').kugouDevice.dfid,'fixture-device');
  await host.call('kugou','songUrl',source,true);
  assert.equal(stub.calls.filter(call=>call.method==='register_dev').length,1);
});

test('real Kugou QR polling retains its waiting, confirmation and expiry states and persists only successful login', async t => {
  const statuses = [1, 2, 0, 4];
  const stub = stubApi({ login_qr_check: () => ({ status: 1, data: { status: statuses.shift(), userid: 101, token: 'fixture-token-a', nickname: 'Fixture A', pic: 'https://artwork.invalid/a.png' } }) });
  const f = fixture(t, { kugouApi: stub.api }), host = f.current();
  await host.manage({ action: 'enable', id: 'kugou' });
  const before = row(host).accountScope;
  for (const code of [801, 802, 800]) {
    const value = await host.call('kugou', 'loginQrCodeCheck', { key: 'fixture-key', qrcode: 'fixture-key' }, true);
    assert.equal(value.code, code);
    assert.equal(f.state('kugou').db?.PluginData?.token, undefined);
    assert.equal(row(host).accountScope, before);
  }
  const success = await host.call('kugou', 'loginQrCodeCheck', { key: 'fixture-key', qrcode: 'fixture-key' }, true);
  assert.equal(success.code, 803);
  assert.equal(success.user.userId, 101);
  assert.equal(f.state('kugou').db.PluginData.token, 'fixture-token-a');
  assert.equal(row(host).status, 'login');
  assert.notEqual(row(host).accountScope, before);
  const after = row(host).accountScope;
  const restored = await f.restart();
  assert.equal(row(restored).accountScope, after);
  assert.equal(row(restored).status, 'login');
  assert.equal(f.state('kugou').db.PluginData.userId, 101);
  assert.equal((await restored.call('kugou', 'getAccount', {}, false)).baseUrl, '');
  assert.equal(f.state('kugou').db.PluginData.token, 'fixture-token-a');
});

test('default Kugou instances retain independent credentials and forward only their own platform cookie', async t => {
  const stub = stubApi({ login_qr_check: params => {
    const first = params.key === 'key-a';
    return { status: 1, data: { status: 4, userid: first ? 101 : 202, token: first ? 'fixture-token-a' : 'fixture-token-b', nickname: 'Fixture', pic: '' } };
  } });
  const f = fixture(t, { kugouApi: stub.api }), host = f.current();
  await host.manage({ action: 'enable', id: 'kugou' });
  const second = (await host.manage({ action: 'instance', id: 'kugou', name: 'Second account' })).plugin.id;
  assert.equal(row(host, second).baseUrl, '');
  assert.equal((await host.call('kugou', 'loginQrCodeCheck', { key: 'key-a' }, true)).code, 803);
  const secondResult = await host.call(second, 'loginQrCodeCheck', { key: 'key-b' }, true);
  assert.equal(secondResult.code, 803, 'The additional instance uses the same built-in routing: ' + JSON.stringify({ logs: await host.manage({ action: 'logs', id: second }), calls: stub.calls.map(call => call.method) }));
  assert.equal(f.state('kugou').db.PluginData.token, 'fixture-token-a');
  assert.equal(f.state(second).db.PluginData.token, 'fixture-token-b');
  assert.notEqual(row(host).accountScope, row(host, second).accountScope);
  await host.call('kugou', 'loginQrKey', {}, true);
  await host.call(second, 'loginQrKey', {}, true);
  const calls = stub.calls.filter(call => call.method === 'login_qr_key');
  assert.equal(calls.length, 2);
  assert.deepEqual(cookieFields(calls[0].params.cookie).token, 'fixture-token-a');
  assert.deepEqual(cookieFields(calls[1].params.cookie).token, 'fixture-token-b');
  assert.equal(cookieFields(calls[0].params.cookie).userid, '101');
  assert.equal(cookieFields(calls[1].params.cookie).userid, '202');
  assert.notEqual(cookieFields(calls[0].params.cookie).KUGOU_API_GUID, cookieFields(calls[1].params.cookie).KUGOU_API_GUID);
});

test('closed or offline Kugou cannot enter the built-in API and opening configuration does not clear an account', async t => {
  const stub = stubApi();
  const f = fixture(t, { kugouApi: stub.api }), host = f.current();
  const old = { store: { baseUrl: '' }, db: { PluginData: { userId: 17, token: 'saved-fixture-token' } }, accountGeneration: 8 };
  f.write('kugou', old);
  const bytes = fs.readFileSync(path.join(f.root, 'kugou.state.json'));
  await assert.rejects(host.call('kugou', 'loginQrKey', {}, true), { code: 'PLUGIN_DISABLED' });
  assert.equal(stub.calls.length, 0);
  await host.manage({ action: 'enable', id: 'kugou' });
  assert.equal(stub.calls.length, 0);
  assert.equal((await host.call('kugou', 'getAccount', {}, false)).baseUrl, '');
  assert.equal((await host.call('kugou', 'loginQrKey', {}, false)).code, 404);
  assert.equal(stub.calls.length, 0);
  assert.deepEqual(fs.readFileSync(path.join(f.root, 'kugou.state.json')), bytes);
});

test('existing custom Kugou APIs keep their address and account; explicitly clearing the override selects the built-in API', async t => {
  const paths = [];
  const server = http.createServer((request, result) => {
    const url = new URL(request.url, 'http://fixture.invalid'); paths.push(url.pathname);
    result.setHeader('Content-Type', 'application/json');
    result.end(JSON.stringify(url.pathname.endsWith('/login/qr/key') ? { status: 1, data: { qrcode: 'custom-fixture-key' } } : { status: 1, data: { dfid: 'custom-device' } }));
  });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  t.after(() => new Promise(resolve => server.close(resolve)));
  const address = 'http://127.0.0.1:' + server.address().port + '/custom';
  const stub = stubApi(), f = fixture(t, { kugouApi: stub.api }), host = f.current();
  const old = { store: { baseUrl: address }, db: { PluginData: { userId: 17, token: 'saved-fixture-token' } }, accountGeneration: 8 };
  f.write('kugou', old);
  const bytes = fs.readFileSync(path.join(f.root, 'kugou.state.json'));
  const oldScope = row(host).accountScope;
  await host.manage({ action: 'enable', id: 'kugou' });
  assert.equal((await host.call('kugou', 'getAccount', {}, false)).baseUrl, address);
  assert.equal(row(host).accountScope, oldScope);
  assert.deepEqual(fs.readFileSync(path.join(f.root, 'kugou.state.json')), bytes);
  const custom = await host.call('kugou', 'loginQrKey', {}, true);
  assert.equal(custom.data.qrcode, 'custom-fixture-key');
  assert.equal(stub.calls.length, 0);
  assert.ok(paths.includes('/custom/login/qr/key'));
  await host.manage({ action: 'configure', id: 'kugou', baseUrl: '' });
  const customRequestCount = paths.length;
  const builtin = await host.call('kugou', 'loginQrKey', {}, true);
  assert.equal(builtin.data.qrcode, 'fixture-key');
  assert.equal(paths.length, customRequestCount);
  assert.equal(row(host).baseUrl, '');
  assert.equal(f.state('kugou').db.PluginData.token, 'saved-fixture-token');
  assert.equal(f.state('kugou').db.PluginData.userId, 17);
  assert.ok(stub.calls.some(call => call.method === 'login_qr_key'));
});

test('switching off the source cancels an in-flight built-in API request', { timeout: 5000 }, async t => {
  let started;
  const reached = new Promise(resolve => { started = resolve; });
  const server = http.createServer((request, result) => { started(); request.on('close', () => result.destroy()); });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  t.after(() => new Promise(resolve => server.close(resolve)));
  const stub = stubApi({ login_qr_key: () => new Promise((resolve, reject) => {
    const request = http.request('http://127.0.0.1:' + server.address().port + '/pending', result => {
      result.resume(); result.on('end', () => resolve({ status: 1, data: { qrcode: 'late-key' } }));
    });
    request.on('error', reject); request.end();
  }) });
  const f = fixture(t, { kugouApi: stub.api }), host = f.current();
  await host.manage({ action: 'enable', id: 'kugou' });
  const pending = host.call('kugou', 'loginQrKey', {}, true);
  const rejected = assert.rejects(pending, { code: 'PLUGIN_CANCELLED' });
  await reached;
  await host.manage({ action: 'disable', id: 'kugou' });
  await rejected;
  assert.equal(row(host).enabled, false);
  assert.equal(f.state('kugou').db?.PluginData?.token, undefined);
});

test('Kugou platform rejection objects report HTTP failure without masquerading as expired QR codes or exposing credentials', async t => {
  let failing = true;
  const stub = stubApi({ login_qr_check: () => {
    if (failing) throw { status: 502, body: { error_code: 50001, msg: 'Platform unavailable token=fixture-private-token https://private.invalid/session', token: 'ignored-private-body-token' }, cookie: ['token=ignored-private-cookie'] };
    return { status: 1, data: { status: 0 } };
  } });
  const f = fixture(t, { kugouApi: stub.api }), host = f.current();
  await host.manage({ action: 'enable', id: 'kugou' });
  await assert.rejects(host.call('kugou', 'loginQrCodeCheck', { key: 'fixture-key' }, true), error => {
    assert.equal(error.code, 'PLUGIN_HTTP');
    assert.equal(error.response.status, 502);
    assert.equal(error.response.error_code, 50001);
    assert.match(error.message, /Platform unavailable/);
    assert.match(error.message, /HTTP 502/);
    assert.doesNotMatch(JSON.stringify(error.response), /fixture-private|ignored-private|private\.invalid/);
    return true;
  });
  const logs = JSON.stringify((await host.manage({ action: 'logs', id: 'kugou' })).logs);
  assert.match(logs, /login_qr_check/);
  assert.match(logs, /HTTP 502/);
  assert.doesNotMatch(logs, /fixture-private|ignored-private|private\.invalid/);
  assert.equal(f.state('kugou').db?.PluginData?.token, undefined);
  failing = false;
  assert.equal((await host.call('kugou', 'loginQrCodeCheck', { key: 'fixture-key' }, true)).code, 800, 'A subsequent real expiry is not replaced by a stale transport failure');
  assert.equal((await host.call('kugou', 'loginQrKey', {}, true)).code, 200, 'The failed polling route does not contaminate new QR generation');
});

test('Kugou network Errors preserve diagnostic codes while keeping QR polling errors distinct from expiry', async t => {
  let failing = true;
  const stub = stubApi({ login_qr_check: () => {
    if (failing) throw Object.assign(new Error('Connection reset token=network-private-token https://network-private.invalid/session'), { code: 'ECONNRESET' });
    return { status: 1, data: { status: 1 } };
  } });
  const f = fixture(t, { kugouApi: stub.api }), host = f.current();
  await host.manage({ action: 'enable', id: 'kugou' });
  await assert.rejects(host.call('kugou', 'loginQrCodeCheck', { key: 'fixture-key' }, true), error => {
    assert.equal(error.code, 'ECONNRESET');
    assert.equal(error.response.status, undefined);
    assert.match(error.message, /Connection reset/);
    assert.doesNotMatch(JSON.stringify(error.response), /network-private/);
    return true;
  });
  const logs = JSON.stringify((await host.manage({ action: 'logs', id: 'kugou' })).logs);
  assert.match(logs, /login_qr_check/);
  assert.doesNotMatch(logs, /network-private/);
  assert.equal(f.state('kugou').db?.PluginData?.token, undefined);
  failing = false;
  assert.equal((await host.call('kugou', 'loginQrCodeCheck', { key: 'fixture-key' }, true)).code, 801, 'A recovered request can continue waiting for the same QR code');
});

test('built-in Kugou preserves playback rejection status and transport timeout', async t => {
  let sample = 'expired';
  const stub = stubApi({ song_url: params => {
    assert.equal(params.free_part, 0);
    if (sample === 'expired') throw { status: 502, body: { status: 0, error_code: 20018, msg: 'Session expired' } };
    if (sample === 'timeout') throw { status: 502, body: { status: 0, msg: Object.assign(new Error('Read timed out'), { code: 'ETIMEDOUT' }) } };
    if (sample === 'denied') return { status: 2 };
    return { status: 1, url: ['https://music.invalid/primary.mp3'], backupUrl: ['https://music.invalid/backup.mp3'] };
  } });
  const host = fixture(t, { kugouApi: stub.api }).current();
  await host.manage({ action: 'enable', id: 'kugou' });
  const input = { hash: 'fixture', album: { id: '123' }, mxid: '456' };
  for (const [name, code] of [['expired', 'PLUGIN_AUTH'], ['timeout', 'ETIMEDOUT']]) {
    sample = name;
    const before = stub.calls.filter(item => item.method === 'song_url').length;
    await assert.rejects(host.call('kugou', 'songUrl', input, true), { code });
    assert.equal(stub.calls.filter(item => item.method === 'song_url').length, before + 1);
  }
  sample = 'denied';
  assert.deepEqual((await host.call('kugou', 'songUrl', input, true)).data.url, []);
  sample = 'normal';
  assert.deepEqual((await host.call('kugou', 'songUrl', input, true)).data.url, ['https://music.invalid/primary.mp3', 'https://music.invalid/backup.mp3']);
});


test('CDN DNS recovery requires the built-in KuGou API and active networking', async t => {
  const host = fixture(t, { kugouApi: stubApi().api }).current();
  assert.equal(host.canRecoverKugouDns('kugou'), false);
  await host.manage({ action: 'enable', id: 'kugou' });
  assert.equal(host.canRecoverKugouDns('kugou'), true);
  host.policy(false);
  assert.equal(host.canRecoverKugouDns('kugou'), false);
  host.policy(true);
  await host.manage({ action: 'configure', id: 'kugou', baseUrl: 'https://custom.example/' });
  assert.equal(host.canNetwork('kugou'), true);
  assert.equal(host.canRecoverKugouDns('kugou'), false);
  await host.manage({ action: 'configure', id: 'kugou', baseUrl: '' });
  assert.equal(host.canRecoverKugouDns('kugou'), true);
  await host.manage({ action: 'enable', id: 'emby' });
  assert.equal(host.canRecoverKugouDns('emby'), false);
});
