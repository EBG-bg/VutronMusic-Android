const test = require('node:test'), assert = require('node:assert/strict')
const fs = require('node:fs'), path = require('node:path'), vm = require('node:vm'), ts = require('typescript'), vue = require('vue')
function fixture() {
  const scrolls = [], browser = { scrollY: 360, scrollTo: ({ top }) => scrolls.push(top) }, scope = vue.effectScope()
  const plugin = { id: 'a', accountScope: 'account-a', type: 'stream', enabled: true, methods: ['getAllTracks', 'search'] }
  let reload, calls = 0
  const make = (count, prefix) => Array.from({ length: count }, (_, id) => ({ id: prefix + id, name: prefix + id, sourceContext: {} }))
  const first = make(5_000, 'first'), second = make(4_000, 'second')
  const bridge = { listMusicPlugins: async () => ({ plugins: [plugin, { ...plugin, id: 'b', accountScope: 'account-b' }] }), callMusicPlugin: async ({ method }) => {
    if (method === 'getAllTracks') { if (++calls > 1) return await new Promise(resolve => { reload = resolve }); return { code: 200, data: first, count: first.length } }
    return { code: 200, data: second, count: second.length }
  } }
  function read(name, deps = {}) {
    const module = { exports: {} }
    vm.runInNewContext(ts.transpileModule(fs.readFileSync(path.join(__dirname, '../src/plugins', name), 'utf8'), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText,
      { module, exports: module.exports, require: name => name === 'vue' ? vue : deps[name], window: browser, console, Error })
    return module.exports
  }
  const exports = read('usePluginLibrary.ts', { './bridge': { musicPluginBridge: bridge }, './protocol': read('protocol.ts') })
  const id = vue.ref('a'), api = scope.run(() => exports.usePluginLibrary(id, vue.ref(false), bridge, vue.ref('library')))
  return { ...exports, api, scope, id, scrolls, finish() { reload({ code: 200, data: first, count: first.length }) } }
}
const page = rows => ({ kind: 'tracks', rows, count: rows.length, more: false, context: {}, method: 'getAllTracks', params: {}, scrollY: 360, view: {} })
const flush = async () => { for (let i = 0; i < 8; i++) await vue.nextTick() }

test('page budget counts shared item objects once and releases evicted detail track arrays', () => {
  const f = fixture(), a = { id: 1, name: 'one', sourceContext: {} }, b = { id: 2, name: 'two', sourceContext: {} }
  const current = page([a]), shared = page([a]), old = page([b]); old.detail = { id: 'album', name: 'album', sourceContext: {}, tracks: old.rows }
  const result = f.trimLibraryPageCache([current, shared, old], { items: 1, estimatedBytes: 100_000 })
  assert.equal(result.retainedItems, 1); assert.equal(result.evictedPages, 1)
  assert.equal(shared.rows[0], a); assert.equal(old.rows.length, 0); assert.equal(old.reload, true)
  assert.equal(old.cachedRowCount, 1); assert.equal(old.detail.tracks, undefined); f.scope.stop()
})

test('current page remains intact even if it alone exceeds the cache budget', () => {
  const f = fixture(), current = page(Array.from({ length: 20 }, (_, id) => ({ id, name: 'Track', sourceContext: {} })))
  f.trimLibraryPageCache([current], { items: 1, estimatedBytes: 20 })
  assert.equal(current.rows.length, 20); assert.equal(current.reload, undefined); f.scope.stop()
})

test('an evicted history page reloads before restoring its deep scroll position', async () => {
  const f = fixture(); await f.api.initialize(); await f.api.list('search', 'tracks', {})
  assert.equal(f.api.history.value[0].rows.length, 0); assert.equal(f.api.history.value[0].reload, true)
  assert.equal(f.api.back(), true); await vue.nextTick()
  assert.equal(f.api.rows.value.length, 0); assert.deepEqual(f.scrolls, [])
  f.finish(); await flush(); assert.equal(f.api.rows.value.length, 5_000); assert.deepEqual(f.scrolls, [360]); f.scope.stop()
})

test('a stale reloaded page cannot repopulate or scroll a newly selected source', async () => {
  const f = fixture(); await f.api.initialize(); await f.api.list('search', 'tracks', {}); f.api.back()
  f.id.value = 'b'; f.api.cancelReads(); f.finish(); await flush()
  assert.equal(f.api.rows.value.length, 0); assert.deepEqual(f.scrolls, []); f.scope.stop()
})
