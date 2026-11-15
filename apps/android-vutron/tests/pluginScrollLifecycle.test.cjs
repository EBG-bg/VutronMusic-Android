const test = require('node:test'), assert = require('node:assert/strict')
const fs = require('node:fs'), path = require('node:path'), vm = require('node:vm'), ts = require('typescript'), vue = require('vue')

function fixture() {
  const frames = new Map(), scrolls = [], scope = vue.effectScope(); let frameId = 0
  const browser = { scrollY: 120, scrollTo: options => scrolls.push(options.top) }
  function read(name, deps = {}) {
    const module = { exports: {} }, file = path.join(__dirname, '../src/plugins', name)
    vm.runInNewContext(ts.transpileModule(fs.readFileSync(file, 'utf8'), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText, {
      module, exports: module.exports, require: name => name === 'vue' ? vue : deps[name], window: browser, console, Error,
      requestAnimationFrame: callback => { frames.set(++frameId, callback); return frameId }, cancelAnimationFrame: id => frames.delete(id)
    })
    return module.exports
  }
  const plugin = { id: 'a', accountScope: 'account-a', type: 'stream', enabled: true, name: 'Fixture', methods: ['getAllTracks', 'search'] }
  const id = vue.ref('a'), view = vue.ref('library'), bridge = { listMusicPlugins: async () => ({ plugins: [plugin, { ...plugin, id: 'b' }] }), callMusicPlugin: async () => ({ code: 200, data: [] }) }
  const factory = read('usePluginLibrary.ts', { './bridge': { musicPluginBridge: bridge }, './protocol': read('protocol.ts') }).usePluginLibrary
  const api = scope.run(() => factory(id, vue.ref(false), bridge, view))
  return { api, scope, id, view, frames, scrolls, browser, flush() { for (const [id, callback] of [...frames]) { frames.delete(id); callback() } } }
}

test('leaving a plugin page cancels its pending back-scroll restoration', async () => {
  const f = fixture(); await f.api.initialize(); await f.api.list('search', 'tracks', { keywords: 'fixture' })
  assert.equal(f.api.back(), true); assert.deepEqual(f.scrolls, [])
  f.scope.stop(); await vue.nextTick(); assert.equal(f.frames.size, 0); assert.deepEqual(f.scrolls, [])
})

test('back scroll restores the previous page but cannot scroll a newly selected source', async () => {
  const f = fixture(); await f.api.initialize(); await f.api.list('search', 'tracks', {})
  assert.equal(f.api.back(), true); await vue.nextTick(); assert.deepEqual(f.scrolls, [120])
  await f.api.list('search', 'tracks', {}); assert.equal(f.api.back(), true)
  f.id.value = 'b'; await vue.nextTick(); assert.deepEqual(f.scrolls, [120]); f.scope.stop()
})
