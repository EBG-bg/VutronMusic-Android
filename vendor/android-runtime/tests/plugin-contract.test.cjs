const test = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const vm = require('node:vm')
const http = require('node:http')
const crypto = require('node:crypto')
const runtime = path.resolve(__dirname, '../src/main/assets/sources-runtime')
const { PluginResultSchema, defaultMap, validateMeta, validateResult } = require(path.join(runtime, 'plugin-contract.cjs'))
const { parseLyric } = require(path.join(runtime, 'plugin-lyrics.cjs'))
const manifest = require(path.join(runtime, 'plugins/builtin-index.json'))
const load = (id, api = {}) => {
  const exports = {}
  vm.runInNewContext(fs.readFileSync(path.join(runtime, 'plugins', id + '.js'), 'utf8'), {
    api, exports, URL, URLSearchParams, Buffer,
    console: { debug() {}, log() {}, error() {}, warn() {} }
  }, { timeout: 1000 })
  return exports
}

test('all original metadata and method defaults satisfy the shared contract', () => {
  assert.equal(manifest.length, 7)
  for (const item of manifest) {
    assert.equal(validateMeta(item).name, item.name)
    for (const method of item.methods) assert.ok(PluginResultSchema[method], item.id + '.' + method)
  }
  for (const [method, fallback] of Object.entries(defaultMap)) assert.doesNotThrow(() => validateResult(method, fallback), method)
})

test('the unchanged original demo executes every exported method with validated defaults', async () => {
  const plugin = load('demo')
  let methods = 0
  for (const [method, value] of Object.entries(plugin)) if (typeof value === 'function') {
    methods++
  }
  // Evaluate promises outside assert.doesNotThrow so rejected async calls cannot escape.
  for (const [method, value] of Object.entries(plugin)) if (typeof value === 'function') validateResult(method, await value({}))
  assert.equal(methods, 62)
})

test('literal upstream unsupported stubs remain exported but are identified without hiding conditional methods', async () => {
  const find = id => manifest.find(plugin => plugin.id === id)
  assert.ok(find('kugou').unsupportedMethods.includes('editPlaylist'))
  assert.ok(find('demo').unsupportedMethods.includes('createPlaylist'))
  assert.ok(find('local').unsupportedMethods.includes('getRecommendTracks'))
  assert.ok(!find('kugou').unsupportedMethods.includes('subscribePlaylist'))
  assert.ok(!find('local').unsupportedMethods.includes('createPlaylist'))
  assert.ok(!find('netease').unsupportedMethods.includes('getPlaylistTracks'))
  for (const item of manifest) {
    const absent = async () => ({})
    const plugin = load(item.id, {
      db: { get: absent, set() {} }, store: { get: absent, set() {} },
      http: { get: absent, post: absent, delete: absent }, log() {}, utils: {}
    })
    await new Promise(resolve => setImmediate(resolve))
    for (const method of item.unsupportedMethods) {
      assert.ok(item.methods.includes(method), item.id + '.' + method)
      assert.equal((await plugin[method]({})).code, 404, item.id + '.' + method)
    }
  }
})

test('successful malformed results fail; known legacy account fields and boolean methods adapt narrowly', () => {
  assert.throws(() => validateResult('search', { code: 200, data: 'wrong', count: 0, sourceContext: {} }))
  assert.throws(() => validateResult('notAMethod', { code: 200 }))
  assert.equal(validateResult('systemPing', true).status, 'login')
  assert.equal(validateResult('doLogin', true).code, 200)
  const account = validateResult('getAccount', { code: 200, baseUrl: 'https://example.invalid', scanDir: ['content://authorized'] })
  assert.equal(account.userName, '')
  assert.equal(account.pwd, '')
  assert.deepEqual(account.scanDir, ['content://authorized'])
})

test('lyric adapter preserves line seconds, word milliseconds, translation and enhanced timing', () => {
  const lines = parseLyric({ yrc: { lyric: '[1000,2000](1000,1000,0)One(2000,1000,0)Two' }, ytlrc: { lyric: '[00:01.00]译文' } })
  assert.equal(lines[0].start, 1)
  assert.equal(lines[0].lyric.info[0].start, 1000)
  assert.equal(lines[0].lyric.info[1].end, 3000)
  assert.equal(lines[0].tlyric.text, '译文')
  const enhanced = parseLyric('[00:01.00]<00:01.00>One<00:02.00>Two\n[00:03.00]End')
  assert.equal(enhanced[0].lyric.info[1].start, 2000)
})

test('original Navidrome runs login, native pagination, Subsonic search, lyrics and audio on a synthetic server', async t => {
  const calls = []
  const song = { id: 'song-1', title: 'Song', artist: 'Artist', artistId: 'artist-1', album: 'Album', albumId: 'album-1', duration: 120, trackNumber: 1, playCount: 3, createdAt: '2026-01-01T00:00:00Z' }
  const server = http.createServer((request, response) => {
    const url = new URL(request.url, 'http://localhost')
    calls.push({ path: url.pathname, query: Object.fromEntries(url.searchParams), auth: request.headers['x-nd-authorization'] })
    response.setHeader('content-type', 'application/json')
    response.setHeader('x-total-count', '1')
    if (url.pathname === '/auth/login') response.end(JSON.stringify({ id: 'client-1', token: 'test-token' }))
    else if (url.pathname === '/api/song') response.end(JSON.stringify([song]))
    else if (url.pathname === '/rest/search3') response.end(JSON.stringify({ 'subsonic-response': { status: 'ok', searchResult3: { song: [song] } } }))
    else if (url.pathname === '/rest/getLyricsBySongId.view') response.end(JSON.stringify({ 'subsonic-response': { status: 'ok', lyricsList: { structuredLyrics: [{ line: [{ start: 1000, value: 'Line' }] }] } } }))
    else if (url.pathname === '/rest/ping') response.end(JSON.stringify({ 'subsonic-response': { status: 'ok' } }))
    else { response.statusCode = 404; response.end(JSON.stringify({ error: 'unexpected test endpoint' })) }
  })
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve))
  t.after(() => new Promise(resolve => server.close(resolve)))
  const base = 'http://127.0.0.1:' + server.address().port
  const data = new Map()
  const request = async (method, rawUrl, values, headers, raw) => {
    const url = new URL(rawUrl)
    if (method === 'GET') for (const [key, value] of Object.entries(values || {})) url.searchParams.set(key, String(value))
    const response = await fetch(url, { method, headers, ...(method === 'GET' ? {} : { body: JSON.stringify(values) }) })
    const body = await response.json()
    return raw ? { data: body, status: response.status, headers: Object.fromEntries(response.headers) } : body
  }
  const plugin = load('navidrome', {
    store: { get: async () => ({}), set(key, value) { data.set(key, value) } },
    db: { get: async () => ({}), set(key, value) { data.set(key, JSON.parse(JSON.stringify(value))) } },
    http: { get: (...args) => request('GET', ...args), post: (...args) => request('POST', ...args), delete: (...args) => request('DELETE', ...args) },
    log() {}, utils: { parseLyric, generateSalt: () => '0123456789ab', generateToken: (password, salt) => crypto.createHash('md5').update(password + salt).digest('hex') }
  })
  await new Promise(resolve => setImmediate(resolve))
  assert.equal(validateResult('updateBaseUrl', await plugin.updateBaseUrl({ url: base })).code, 200)
  assert.equal(validateResult('doLogin', await plugin.doLogin({ userName: 'listener', pwd: 'test-only' })).data.nickname, 'listener')
  const library = validateResult('getAllTracks', await plugin.getAllTracks({ reset: true, pageSize: 50, sort: 'name', order: 'ASC' }))
  assert.equal(library.data[0].id, 'song-1')
  assert.equal(library.count, 1)
  assert.equal(calls.find(call => call.path === '/api/song').auth, 'Bearer test-token')
  assert.equal(calls.find(call => call.path === '/api/song').query._end, '50')
  const search = validateResult('search', await plugin.search({ tab: 'tracks', keywords: 'Song', reset: true }))
  assert.equal(search.data[0].sourceContext.id, 'song-1')
  const audio = validateResult('songUrl', await plugin.songUrl(search.data[0].sourceContext))
  const stream = new URL(audio.data.url[0])
  assert.equal(stream.pathname, '/rest/stream')
  assert.equal(stream.searchParams.get('id'), 'song-1')
  assert.equal(stream.searchParams.get('u'), 'listener')
  assert.equal(stream.searchParams.get('t'), crypto.createHash('md5').update('test-only0123456789ab').digest('hex'))
  const lyric = validateResult('getLyric', await plugin.getLyric(search.data[0].sourceContext))
  assert.equal(lyric.data[0].start, 1)
  assert.equal(validateResult('systemPing', await plugin.systemPing()).status, 'login')
})
