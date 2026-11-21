const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),vm=require('node:vm'),ts=require('typescript'),vue=require('vue')
const inspectUserBackup=async()=>({requestId:'test-import',archive:false,collectionCount:0,trackCount:0,cacheItems:0,audioItems:0,hasAccounts:false})
test('export includes scoped online track orders and restore merges them with existing and restored local orders',async()=>{
 const key='vutron:collection-orders:v1',existing={'netease:8:playlist:42':{mode:'title',keys:[]},'bundle:existing':{mode:'custom',keys:['a']}}
 const storage=new Map([[key,JSON.stringify(existing)]]),captured=[],restored={'netease:7:playlist:42':{mode:'custom',keys:['netease:2','netease:1']}}
 const store={flushLiveSettings:async()=>{},reloadManagedLibrary:async()=>{},loadOverlaySettings:async()=>{},loadSourceSettings:async()=>{},loadCacheStatus:async()=>{}}
 let offlineRefreshed=0;store.loadOfflinePlaylists=async()=>{offlineRefreshed++}
 let receipt={frontend:{[key]:JSON.stringify(restored)},orders:{'backup:new':{mode:'custom',keys:['restored']}},collectionCount:1,collectionSkipped:0,cacheItems:3,cacheSkipped:1}
 const translations=[]
 const plugin={exportUserBackup:async value=>{captured.push(value);return{collectionCount:0}},inspectUserBackup,completeUserBackupImport:async()=>receipt}
 const deps={
  '../platform/vutronPlugin':{vutronPlugin:plugin},'../platform/actionDialog':{askAction:async()=> 'confirm'},'../platform/i18n':{appLocale:vue.ref('zh'),translate:(key,values)=>{translations.push([key,values]);return key},setAppLocale:()=>{}},
  '../platform/appearance':{appearance:vue.ref('light'),accent:vue.ref('#000000')},'../platform/motion':{motionPreference:vue.ref('full')},'../platform/libraryLayout':{playlistView:vue.ref('cards'),playlistColumns:vue.ref(3)},
  './localTrackOrdering':{ORDER_STORAGE_KEY:key},'../platform/interfacePreferences':{INTERFACE_KEYS:[]},'./playlistOrdering':{PLAYLIST_ORDER_KEY:'vutron:playlist-orders:v1',sanitizePlaylistOrders:value=>value},
  './collectionOrderHistory':{ORDER_HISTORY_STORAGE_KEY:'vutron:collection-order-history:v1',exportCollectionOrderHistories:()=>({}),restoreCollectionOrderHistories:()=>{}},
  '../platform/libraryActivity':{libraryMutationBusy:vue.ref(false)},'../stores/androidShell':{useAndroidShellStore:()=>store},'./playbackTuning':{usePlaybackTuning:()=>({load:async()=>{}})}
 }
 const file=path.join(__dirname,'../src/composables/userBackup.ts'),module={exports:{}}
 vm.runInNewContext(ts.transpileModule(fs.readFileSync(file,'utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022}}).outputText,{module,exports:module.exports,require:name=>name==='vue'?vue:deps[name],localStorage:{getItem:key=>storage.get(key)??null,setItem:(key,value)=>storage.set(key,value)},window:{dispatchEvent:()=>{}},Event:class{},console})
 const state=module.exports.useUserBackup();await state.exportBackup();assert.deepEqual(JSON.parse(captured[0].frontend[key]),existing)
 assert.equal(captured[0].includePrivacy,undefined);assert.equal(captured[0].includeCache,undefined)
 await state.exportBackup({includePrivacy:true,includeCache:true})
 assert.equal(captured[1].includePrivacy,true);assert.equal(captured[1].includeCache,true)
 await state.importBackup();assert.deepEqual(JSON.parse(storage.get(key)),{...existing,...restored,'backup:new':{mode:'custom',keys:['restored']}})
 assert.equal(state.message.value,'mobile.backup.imported · mobile.backup.importedCache');assert.equal(offlineRefreshed,1)
 assert.deepEqual(JSON.parse(JSON.stringify(translations.slice(-2))), [['mobile.backup.imported',{count:1}],['mobile.backup.importedCache',{cache:3,skipped:1}]])
 receipt={frontend:{},orders:{},collectionCount:0,collectionSkipped:2}
 await state.importBackup()
 assert.equal(state.message.value,'mobile.backup.imported · mobile.backup.importedDuplicates')
 assert.deepEqual(JSON.parse(JSON.stringify(translations.slice(-2))), [['mobile.backup.imported',{count:0}],['mobile.backup.importedDuplicates',{count:2}]])
 assert.equal(offlineRefreshed,1,'A metadata-only import must not refresh the cache list')
})

test('backup keeps named permanent history, merges duplicate sequences and refreshes per-account and restored local scopes',async()=>{
 const key='vutron:collection-order-history:v1',orderKey='vutron:collection-orders:v1',scope='netease:7:playlist:42',other='netease:8:playlist:42';
 const pinned={id:'saved-a',createdAt:200,mode:'custom',keys:['netease:1','netease:2'],customAt:200,name:'My evening',pinned:true,cookie:'secret'};
 const initial={
  [scope]:{limit:4,legacyMigrated:true,entries:[pinned,{id:'old-b',createdAt:100,mode:'title',keys:['netease:2','netease:1']}]},
  [other]:{limit:9,entries:[{id:'other-a',createdAt:50,mode:'custom',keys:['netease:9'],customAt:50}]}
 };
 const incoming={
  [scope]:{limit:1,legacyMigrated:true,entries:[{id:'new-c',createdAt:400,mode:'title',keys:['netease:3','netease:1','netease:2']},
   {id:'duplicate-a',createdAt:300,mode:'album',keys:['netease:1','netease:2'],customAt:300,pinned:true}]},
  'restored:one':{limit:3,legacyMigrated:true,entries:[{id:'local-a',createdAt:123,mode:'custom',keys:['a'.repeat(64)],customAt:123,name:'Practice',pinned:true}]}
 };
 const storage=new Map([[key,JSON.stringify(initial)],[orderKey,JSON.stringify({'bundle:existing':{mode:'custom',keys:['old-key']}})]]),captured=[],events=new Map();
 const window={addEventListener:(name,listener)=>events.set(name,[...(events.get(name)||[]),listener]),dispatchEvent:event=>{for(const listener of events.get(event.type)||[])listener(event)}};
 const environment={localStorage:{getItem:key=>storage.get(key)??null,setItem:(key,value)=>storage.set(key,value),removeItem:key=>storage.delete(key)},window,Event:class{constructor(type){this.type=type}},console};
 function load(file,deps){const module={exports:{}};vm.runInNewContext(ts.transpileModule(fs.readFileSync(path.join(__dirname,'../src/composables/',file),'utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022}}).outputText,{...environment,module,exports:module.exports,require:name=>name==='vue'?vue:deps[name]});return module.exports}
 const history=load('collectionOrderHistory.ts',{});
 assert.equal(history.getCollectionOrderHistory(scope).limit,4);
 const store={flushLiveSettings:async()=>{},reloadManagedLibrary:async()=>{},loadOverlaySettings:async()=>{},loadSourceSettings:async()=>{},loadCacheStatus:async()=>{}};
  const plugin={exportUserBackup:async request=>{captured.push(request);return{collectionCount:0}},inspectUserBackup,completeUserBackupImport:async()=>({frontend:{[key]:JSON.stringify(incoming)},orders:{'restored:one':{mode:'custom',keys:['a'.repeat(64)]}},collectionCount:1})};
 const dependencies={
  '../platform/vutronPlugin':{vutronPlugin:plugin},'../platform/actionDialog':{askAction:async()=> 'confirm'},'../platform/i18n':{appLocale:vue.ref('zh'),translate:key=>key,setAppLocale:()=>{}},
  '../platform/appearance':{appearance:vue.ref('light'),accent:vue.ref('#000000')},'../platform/motion':{motionPreference:vue.ref('full')},'../platform/libraryLayout':{playlistView:vue.ref('cards'),playlistColumns:vue.ref(3)},
  './localTrackOrdering':{ORDER_STORAGE_KEY:orderKey},'./collectionOrderHistory':history,'../platform/interfacePreferences':{INTERFACE_KEYS:[]},'./playlistOrdering':{PLAYLIST_ORDER_KEY:'vutron:playlist-orders:v1',sanitizePlaylistOrders:value=>value},
  '../platform/libraryActivity':{libraryMutationBusy:vue.ref(false)},'../stores/androidShell':{useAndroidShellStore:()=>store},'./playbackTuning':{usePlaybackTuning:()=>({load:async()=>{}})}
 };
 const state=load('userBackup.ts',dependencies).useUserBackup();await state.exportBackup();
 const exported=JSON.parse(captured[0].frontend[key]);assert.equal(exported[scope].entries[0].name,'My evening');assert.equal(exported[scope].entries[0].pinned,true);assert.equal(captured[0].frontend[key].includes('secret'),false);
 await state.importBackup();
 const restored=JSON.parse(JSON.stringify(history.exportCollectionOrderHistories()));assert.deepEqual(restored[other],exported[other]);assert.equal(restored[scope].limit,1);assert.equal(restored[scope].entries.length,2);
 const kept=restored[scope].entries.find(row=>row.keys.join(',')==='netease:1,netease:2');assert.equal(kept.name,'My evening');assert.equal(kept.pinned,true);assert.equal(kept.customAt,300);assert.equal(kept.mode,'album');
 assert.equal(restored['restored:one'].entries[0].name,'Practice');assert.equal(restored['restored:one'].legacyMigrated,true);
 assert.equal(history.getCollectionOrderHistory(scope).limit,1,'Existing reactive consumers reread the imported history');
 assert.deepEqual(JSON.parse(storage.get(orderKey)),{'bundle:existing':{mode:'custom',keys:['old-key']},'restored:one':{mode:'custom',keys:['a'.repeat(64)]}});
 assert.equal(state.busy.value,false);
});


test('backup merges playlist positions and newer listening times without replacing destination-only entries', async () => {
  const key = 'vutron:playlist-orders:v1'
  const initial = {
    'local:device': { mode: 'custom', keys: ['bundle:local-two', 'bundle:local-one'], recent: { 'bundle:local-one': 900 } },
    'netease:7': { mode: 'custom', keys: ['7:44', '7:42'], recent: { '7:44': 700, '7:42': 800, '7:43': 100 } },
    'netease:8': { mode: 'name', keys: [], recent: { '8:42': 500 } },
  }
  // Native restore already remapped local backup keys to the restored collection IDs.
  const incoming = {
    'local:device': { mode: 'custom', keys: ['restored:second', 'restored:first'], recent: { 'restored:first': 200 } },
    'netease:7': { mode: 'recent', keys: ['7:42', '7:43'], recent: { '7:42': 200, '7:43': 500 } },
  }
  const storage = new Map([[key, JSON.stringify(initial)]]), listeners = new Map(), writes = []
  const localStorage = { getItem: k => storage.get(k) ?? null, setItem: (k, value) => { storage.set(k, value); writes.push([k, value]) } }
  const window = {
    addEventListener: (type, listener) => listeners.set(type, listener),
    dispatchEvent: event => listeners.get(event.type)?.(event),
  }
  function load(name, deps) {
    const filename = path.join(__dirname, '../src/composables', `${name}.ts`), module = { exports: {} }
    vm.runInNewContext(ts.transpileModule(fs.readFileSync(filename, 'utf8'), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText,
      { module, exports: module.exports, localStorage, window, Event: class { constructor(type) { this.type = type } }, require: id => id === 'vue' ? vue : deps[id], console }, { filename })
    return module.exports
  }
  const ordering = load('playlistOrdering', {})
  const noop = async () => {}
  const store = { flushLiveSettings: noop, reloadManagedLibrary: noop, loadOverlaySettings: noop, loadSourceSettings: noop, loadCacheStatus: noop }
  const plugin = { inspectUserBackup, completeUserBackupImport: async () => ({ frontend: { [key]: JSON.stringify(incoming) }, orders: {}, collectionCount: 2 }) }
  const backup = load('userBackup', {
    '../platform/vutronPlugin': { vutronPlugin: plugin }, '../platform/actionDialog': { askAction: async () => 'confirm' }, '../platform/i18n': { appLocale: vue.ref('zh'), translate: value => value },
    '../platform/appearance': {}, '../platform/motion': {}, '../platform/libraryLayout': {}, '../platform/interfacePreferences': { INTERFACE_KEYS: [] },
    '../platform/libraryActivity': { libraryMutationBusy: vue.ref(false) }, '../stores/androidShell': { useAndroidShellStore: () => store }, './playbackTuning': { usePlaybackTuning: () => ({ load: noop }) },
    './localTrackOrdering': { ORDER_STORAGE_KEY: 'vutron:collection-orders:v1' }, './collectionOrderHistory': { ORDER_HISTORY_STORAGE_KEY: 'vutron:collection-order-history:v1' },
    './playlistOrdering': ordering,
  }).useUserBackup()
  const mounted = vue.effectScope()
  try {
    const rows = keys => vue.ref(keys.map(key => ({ key, name: key, count: 1 })))
    const keys = order => Array.from(order.ordered.value, row => row.key)
    const local = mounted.run(() => ordering.usePlaylistOrder(rows(['bundle:local-one', 'bundle:local-two', 'restored:first', 'restored:second']), vue.ref('local:device')))
    const online = mounted.run(() => ordering.usePlaylistOrder(rows(['7:43', '7:44', '7:42']), vue.ref('netease:7')))
    await backup.importBackup()
    assert.deepEqual(keys(local), ['restored:second', 'restored:first', 'bundle:local-two', 'bundle:local-one'])
    assert.deepEqual(keys(online), ['7:42', '7:44', '7:43'], 'An older backup cannot rewind the most recent playlist playback')
    const restored = JSON.parse(storage.get(key))
    assert.deepEqual(restored['netease:8'], initial['netease:8'])
    assert.deepEqual(restored['local:device'].recent, { 'bundle:local-one': 900, 'restored:first': 200 })
    const afterFirst = writes.length
    await backup.importBackup()
    assert.equal(writes.length, afterFirst, 'Importing the same order again performs no writes')
  } finally { mounted.stop() }
})
