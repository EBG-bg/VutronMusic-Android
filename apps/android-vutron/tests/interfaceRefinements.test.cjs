const test = require('node:test'), assert = require('node:assert/strict')
const fs = require('node:fs'), path = require('node:path'), vm = require('node:vm'), ts = require('typescript'), vue = require('vue')
function load(name, storage = new Map()) {
  const file = path.resolve(__dirname, '../src', name), module = { exports: {} }, listeners = new Map(), styles = new Map()
  const code = ts.transpileModule(fs.readFileSync(file, 'utf8'), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText
  vm.runInNewContext(code, { module, exports: module.exports, require: () => vue, Intl, Date,
    localStorage: { getItem: k => storage.get(k) ?? null, setItem: (k,v) => storage.set(k,v) },
    document: { documentElement: { style: { setProperty: (k,v) => styles.set(k,v) } } },
    window: { addEventListener: (k,v) => listeners.set(k,v) } }, { filename: file })
  return { api: module.exports, listeners, storage, styles }
}
test('sleep timer uses one native deadline and advances between IPC samples', () => {
  const { api } = load('utils/sleepTimer.ts')
  const deadline = api.timerDeadline({ remainingMs: 10000, deadlineMs: 12000 }, 2000)
  assert.equal(deadline, 12000)
  assert.equal(api.timerRemaining(deadline, 2250), 9750)
  assert.equal(api.timerRemaining(deadline, 3000), 9000)
  assert.equal(api.timerLabel(61000), '1:01'); assert.equal(api.timerLabel(60000), '1:00')
  assert.equal(api.timerLabel(1), '0:01'); assert.equal(api.timerRemaining(deadline, 14000), 0)
  assert.equal(api.timerDeadline({ remainingMs: 0, deadlineMs: 12000 }), 0)
  assert.equal(api.timerDeadline({ remainingMs: 5000 }, 1000), 6000)
})

test('seconds carry and borrow minutes with one normalized duration, including typed values', () => {
  const {api}=load('utils/sleepTimer.ts')
  assert.equal(api.editTimerPart(59,'seconds',60),60)
  assert.equal(api.editTimerPart(60,'seconds',-1),59)
  assert.equal(api.editTimerPart(119,'seconds',61),121)
  assert.equal(api.editTimerPart(119,'minutes',300),18000)
  assert.equal(api.editTimerPart(1,'seconds',0),1)
  assert.equal(api.editTimerPart(18000,'seconds',1),18000)
  assert.deepEqual({...api.timerParts(60.001)},{minutes:1,seconds:1})
  assert.deepEqual({...api.timerParts(60)},{minutes:1,seconds:0})
  assert.deepEqual({...api.timerParts(59.999)},{minutes:1,seconds:0})
  assert.equal(api.wheelLabel(59,60),59)
  assert.equal(api.wheelLabel(60,60),0)
  assert.equal(api.wheelLabel(61,60),1)
  assert.equal(api.wheelLabel(120,60),0)
})
test('interface settings restore immediately, clamp font size, and retain separate lyric sizes', async () => {
  const fixture = load('platform/interfacePreferences.ts'), { api } = fixture
  assert.equal(api.fontScale.value,100); api.fontScale.value = 150
  assert.equal(fixture.styles.get('--ui-font-scale'), '1.5')
  api.fontScale.value = 999; assert.equal(api.fontScale.value,150)
  fixture.storage.set('vutron:font-scale','125');fixture.storage.set('vutron:player-lyrics','true');fixture.storage.set('vutron:timer-preset','75')
  fixture.listeners.get('vutron-backup-restored')();await vue.nextTick()
  assert.equal(api.fontScale.value,125);assert.equal(api.playerLyrics.value,true);assert.equal(api.timerPreset.value,75)
  assert.equal(fixture.storage.has('fontSize'),false)
  const recreated=load('platform/interfacePreferences.ts',fixture.storage)
  assert.equal(recreated.api.fontScale.value,125);assert.equal(recreated.api.timerPreset.value,75)
})
test('playlist name, creation and recent sorting are stable and do not mutate source', () => {
  const { api }=load('composables/playlistOrdering.ts')
  const items=[{key:'a',name:'Beta',createTime:10},{key:'b',name:'Alpha',createTime:30},{key:'c',name:'Alpha',createTime:30},{key:'d',name:'Unknown'}]
  const order=mode=>({mode,keys:[],recent:{a:50,b:60}})
  assert.deepEqual(Array.from(api.applyPlaylistOrder(items,order('name')),x=>x.key),['b','c','a','d'])
  assert.deepEqual(Array.from(api.applyPlaylistOrder(items,order('created')),x=>x.key),['b','c','a','d'])
  assert.deepEqual(Array.from(api.applyPlaylistOrder(items,order('recent')),x=>x.key),['b','a','c','d'])
  assert.deepEqual(items.map(x=>x.key),['a','b','c','d'])
})
test('playlist custom order and actual-play history persist per owner across recreation and restore', async () => {
  const fixture=load('composables/playlistOrdering.ts'),{api}=fixture, scope=vue.effectScope()
  const owner=vue.ref('netease:1'),items=vue.ref([{key:'1:10',name:'A'},{key:'1:11',name:'B'}])
  const state=scope.run(()=>api.usePlaylistOrder(items,owner));state.commit(['1:11','1:10'])
  assert.equal(state.ordered.value[0].name,'B')
  owner.value='netease:2';await vue.nextTick();assert.equal(state.mode.value,'original')
  api.recordPlaylistPlayback('netease:1','1:10',100)
  assert.equal(state.mode.value,'original','old queue updates its captured owner only')
  owner.value='netease:1';await vue.nextTick();state.mode.value='recent';assert.equal(state.ordered.value[0].name,'A')
  const recreated=load('composables/playlistOrdering.ts',fixture.storage)
  const second=scope.run(()=>recreated.api.usePlaylistOrder(items,owner));assert.equal(second.mode.value,'recent');assert.equal(second.ordered.value[0].name,'A')
  second.commit(['deleted','1:11','1:10']);items.value.push({key:'1:12',name:'New'})
  assert.deepEqual(Array.from(second.ordered.value,x=>x.name),['B','A','New'])
  second.restore();assert.equal(second.ordered.value[0].name,'A');scope.stop()
})
test('playlist backup rejects paths, malformed scopes, invalid sort and unsafe recent timestamps', () => {
  const {api}=load('composables/playlistOrdering.ts')
  const safe=api.sanitizePlaylistOrders({'netease:1':{mode:'custom',keys:['1:1','1:1','C:/private/music'],recent:{'1:1':42,'1:2':-1,'1:3':'secret'}},'cookie':{mode:'recent'},'netease:2':{mode:'arbitrary'}})
  assert.deepEqual(Object.keys(safe),['netease:1']);assert.deepEqual(Array.from(safe['netease:1'].keys),['1:1'])
  assert.deepEqual(Object.keys(safe['netease:1'].recent),['1:1'])
})
