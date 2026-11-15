const test = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const vm = require('node:vm')
const path = require('node:path')
const ts = require('typescript')
const vue = require('vue')
function load(storage = new Map()) {
  const modules = new Map()
  function file(name) {
    if (modules.has(name)) return modules.get(name).exports
    const filename = path.join(__dirname, '../src/composables/' + name + '.ts'), module = { exports: {} }
    modules.set(name, module)
    const code = ts.transpileModule(fs.readFileSync(filename, 'utf8'), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText
    vm.runInNewContext(code, { module, exports: module.exports, require: name => name === 'vue' ? vue : name === '../platform/undo' ? { offerUndo() {} } : name === '../platform/undoMessages' ? { undoText: key => key } : file(name.slice(2)),
      localStorage: { getItem: key => storage.get(key) ?? null, setItem: (key, value) => storage.set(key, value), removeItem: key => storage.delete(key) }, Intl })
    return module.exports
  }
  return file('localTrackOrdering')
}
test('custom order is scoped per collection and survives component recreation', async () => {
  const storage = new Map(), api = load(storage), scope = vue.effectScope()
  const tracks = vue.ref([{ id: 1, name: 'A', localKey: 'a' }, { id: 1, name: 'B', localKey: 'b' }, { id: 2, name: 'C', localKey: 'c' }])
  const key = vue.ref('bundle:one'), source = vue.computed(() => tracks.value)
  const state = scope.run(() => api.useCollectionTrackOrder(source, key))
  state.commit(['c', 'a', 'b'])
  assert.deepEqual(Array.from(state.ordered.value, x => x.name), ['C', 'A', 'B'])
  state.saveDraft()
  key.value = 'folder:two'; await vue.nextTick()
  assert.deepEqual(Array.from(state.ordered.value, x => x.name), ['A', 'B', 'C'])
  state.commit(['b', 'a', 'c']); state.saveDraft(); key.value = 'bundle:one'; await vue.nextTick()
  const restored = scope.run(() => load(storage).useCollectionTrackOrder(source, key))
  assert.deepEqual(Array.from(restored.ordered.value, x => x.name), ['C', 'A', 'B'])
  restored.restore()
  assert.deepEqual(Array.from(restored.ordered.value, x => x.name), ['A', 'B', 'C'])
  scope.stop()
})
test('reordering never mutates source data and missing/new songs reconcile stably', () => {
  const { applyCollectionOrder, moveTrackKey } = load()
  const keys = ['a', 'b', 'c'], moved = moveTrackKey(keys, 'c', 'a')
  assert.deepEqual(Array.from(moved), ['c', 'a', 'b']); assert.deepEqual(keys, ['a', 'b', 'c'])
  const source = ['a', 'c', 'new'].map((key, id) => ({ id, localKey: key, name: key }))
  const sorted = applyCollectionOrder(source, { mode: 'custom', keys: ['c', 'deleted', 'a'] })
  assert.deepEqual(Array.from(sorted, x => x.name), ['c', 'a', 'new'])
  const filtered = sorted.filter(x => x.name === 'a')
  assert.equal(filtered.length, 1); assert.equal(sorted.length, 3)
  assert.deepEqual(source.map(x => x.name), ['a', 'c', 'new'])
})
test('switching to a named mode with the same visible sequence never marks a remote reorder or creates another history',()=>{
 const storage=new Map(),api=load(storage),scope=vue.effectScope()
 const rows=vue.ref([{id:1,name:'B',localKey:'b'},{id:2,name:'C',localKey:'c'},{id:3,name:'A',localKey:'a'}]),source=vue.computed(()=>rows.value)
 const state=scope.run(()=>api.useCollectionTrackOrder(source,vue.ref('bundle:one')))
 state.commit(['a','b','c']);state.saveDraft()
 rows.value=[rows.value[1],rows.value[2],rows.value[0]]
 const historyBefore=JSON.stringify([...storage].filter(([key])=>key!==api.ORDER_STORAGE_KEY))
 state.mode.value='title';assert.equal(state.dirty.value,false);assert.equal(state.sequenceDirty.value,false)
 assert.equal(state.prepareDraftSave(),false);assert.equal(state.saveDraft(),false);assert.equal(state.savedMode.value,'title')
 assert.equal(JSON.stringify([...storage].filter(([key])=>key!==api.ORDER_STORAGE_KEY)),historyBefore)
 assert.deepEqual(rows.value.map(row=>row.localKey),['c','a','b']);scope.stop()
})
test('drag cancellation only discards gesture state; actual component isolates drag from row menu', () => {
  const source = fs.readFileSync(path.join(__dirname, '../src/components/LocalTrackList.vue'), 'utf8')
  assert.match(source, /@pointercancel="cancelDrag"/)
  assert.match(source, /@pointerdown\.stop\.prevent="startDrag/)
  assert.match(source, /@lostpointercapture="cancelDrag"/)
  assert.match(source, /requestAnimationFrame\(autoscroll\)/)
  assert.match(source, /emit\('play', track, playable\.value\)/)
  assert.match(source, /!row\.missingLocal && \(!props\.localOnly \|\| !row\.onlineOnly\)/)
})

test('collection artist keys are scoped to one sort and preserve ties and source identity', () => {
  const { applyCollectionOrder } = load()
  let joins = 0
  const source = Array.from({ length: 180 }, (_, id) => {
    const artists = ['Artist ' + (179 - id)]
    artists.join = function (separator) { joins++; return Array.prototype.join.call(this, separator) }
    return { id, name: 'Track ' + id, artists }
  })
  const saved = { mode: 'artist', keys: [] }
  assert.equal(applyCollectionOrder(source, saved)[0], source[179])
  assert.ok(joins <= source.length)
  source[0].artists[0] = 'AAA'
  assert.equal(applyCollectionOrder(source, saved)[0], source[0])
  assert.equal(applyCollectionOrder(source, { mode: 'original', keys: [] }), source)
  const tied = [{ id: 1, name: 'Track 10', artists: [] }, { id: 2, name: 'Track 2' }, { id: 3, name: 'Track 2', artists: [] }]
  assert.deepEqual(Array.from(applyCollectionOrder(tied, saved), item => item.id), [2, 3, 1])
})

test('switching title and custom modes preserves custom keys across recreation and account scopes', async () => {
  const storage = new Map(), api = load(storage), scope = vue.effectScope()
  const tracks = vue.ref([{ id: 1, name: 'Alpha', localUri: 'file:///old-cache' }, { id: 2, name: 'Beta' }])
  const identify = track => 'netease:' + track.id, key = vue.ref('netease:7:playlist:42'), source = vue.computed(() => tracks.value)
  const state = scope.run(() => api.useCollectionTrackOrder(source, key, identify))
  state.commit(['netease:2', 'netease:1']);state.mode.value='title'
  assert.deepEqual(Array.from(state.ordered.value, row => row.id), [1, 2])
  state.mode.value='custom';tracks.value[0].localUri='file:///new-cache'
  assert.deepEqual(Array.from(state.ordered.value, row => row.id), [2, 1])
  state.saveDraft();key.value='netease:8:playlist:42';await vue.nextTick();assert.equal(state.mode.value,'original')
  key.value='netease:7:playlist:42';await vue.nextTick()
  const restored=scope.run(()=>load(storage).useCollectionTrackOrder(source,key,identify))
  assert.deepEqual(Array.from(restored.ordered.value, row=>row.id),[2,1]);scope.stop()
})
