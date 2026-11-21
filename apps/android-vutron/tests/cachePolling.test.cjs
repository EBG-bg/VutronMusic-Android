const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),vm=require('node:vm'),ts=require('typescript'),vue=require('vue');
test('settings polls usage without reloading hidden audio rows; library and explicit refresh retain rows',async()=>{
  let now=10000,statusCalls=0,rowCalls=0;
  const scope=vue.effectScope(),tab=vue.ref('settings'),module={exports:{}};
  const plugin={getCacheStatus:async()=>{statusCalls++;return {capacityMb:512,usedBytes:100,trackCount:2,artworkBytes:50}},getCachedTracks:async()=>{rowCalls++;return {tracks:[{id:1,name:'One'},{id:2,name:'Two'}]}}};
  class Clock extends Date{static now(){return now}}
  vm.runInNewContext(ts.transpileModule(fs.readFileSync(path.join(__dirname,'../src/stores/domains/shellCache.ts'),'utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022}}).outputText,{module,exports:module.exports,require:name=>name==='vue'?vue:name.includes('vutronPlugin')?{vutronPlugin:plugin}:{},Date:Clock,document:{visibilityState:'visible'},setInterval,clearInterval});
  const cache=scope.run(()=>module.exports.createShellCache({activeTab:tab,playback:vue.ref({}),onlineAvailable:vue.ref(false),error:vue.ref(''),t:key=>key,formatError:String,resolveCacheTrack(){},loadOfflinePlaylists(){}}));
  const tick=async()=>{for(let i=0;i<6;i++)await Promise.resolve()};
  cache.pollCacheStatus();await tick();now+=6000;cache.pollCacheStatus();await tick();
  assert.equal(statusCalls,2);assert.equal(rowCalls,0);assert.equal(cache.cacheStatus.value.artworkBytes,50);
  tab.value='library';now+=6000;cache.pollCacheStatus();await tick();assert.equal(rowCalls,1);assert.equal(cache.cachedTracks.value.length,2);
  tab.value='settings';await cache.loadCacheStatus();assert.equal(rowCalls,2,'Explicit refresh/clear still updates the cache library');
  tab.value='player';now+=6000;cache.pollCacheStatus();await tick();assert.equal(statusCalls,4);scope.stop();
});

function deferred() {
 let resolve
 const promise = new Promise(done => { resolve = done })
 return { promise, resolve }
}
function load(relative, dependencies) {
 const source = fs.readFileSync(path.join(__dirname, '../src', relative), 'utf8'), module = { exports: {} }
 vm.runInNewContext(ts.transpileModule(source,{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022}}).outputText,{
  module, exports:module.exports, require:name=>name==='vue'?vue:dependencies[name],
  document:{visibilityState:'visible'}, setInterval, clearInterval,
 })
 return module.exports
}
function cacheFixture(plugin, activeTab = 'library') {
 const scope = vue.effectScope(), error = vue.ref(''), tab = vue.ref(activeTab)
 const { createShellCache } = load('stores/domains/shellCache.ts', { '../../platform/vutronPlugin': { vutronPlugin: plugin } })
 const cache = scope.run(() => createShellCache({ activeTab: tab, playback: vue.ref({}), onlineAvailable: vue.ref(false), error,
  t:key=>key, formatError:String, resolveCacheTrack(){}, loadOfflinePlaylists(){} }))
 return { cache, error, dispose:()=>scope.stop() }
}
const song = { id: 1, name: 'Cached song', cached: true }
const beforeDelete = { capacityMb: 512, usedBytes: 100, trackCount: 1 }
const afterDelete = { ...beforeDelete, usedBytes: 0, trackCount: 0 }

test('clearing while cache usage is in flight immediately publishes the fresh usage and rows', async () => {
 const oldUsage = deferred()
 let cleared = false, reads = 0
 const { cache, dispose } = cacheFixture({
  getCacheStatus: async () => ++reads === 2 ? oldUsage.promise : cleared ? afterDelete : beforeDelete,
  getCachedTracks: async () => ({ tracks: cleared ? [] : [song] }),
  clearCache: async () => { cleared = true },
 }, 'settings')
 try {
  await cache.loadCacheStatus()
  const old = cache.loadCacheStatus(false, false)
  await cache.clearCache()
  assert.equal(cache.cacheStatus.value.usedBytes, 0, 'An outstanding usage read cannot delay the confirmed clear')
  assert.equal(cache.cachedTracks.value.length, 0)
  oldUsage.resolve(beforeDelete)
  await old
  assert.equal(cache.cacheStatus.value.usedBytes, 0, 'The old usage response cannot undo the clear')
  assert.equal(reads, 3)
 } finally { oldUsage.resolve(beforeDelete); dispose() }
})

test('single-track deletion supersedes an older cached-row read without weakening routine read dedupe', async () => {
 const oldRows = deferred(), freshUsage = deferred(), enteredFreshRead = deferred()
 let deleted = false, statusReads = 0, rowsReads = 0
 const plugin = {
  getCacheStatus: async () => { statusReads++; if (!deleted) return beforeDelete; enteredFreshRead.resolve(); return freshUsage.promise },
  getCachedTracks: async () => ({ tracks: ++rowsReads === 2 ? await oldRows.promise : deleted ? [] : [song] }),
  deleteCachedTrack: async ({ trackId }) => { assert.equal(trackId, song.id); deleted = true; return { removed:true } },
 }
 const { cache, dispose } = cacheFixture(plugin)
 const store = { ...cache, error:'', queueNotice:'' }
 const { useLibraryManagement } = load('composables/libraryManagement.ts', {
  '../platform/vutronPlugin': { vutronPlugin:plugin }, '../stores/androidShell': { useAndroidShellStore:()=>store },
  '../platform/libraryActivity': { libraryMutationBusy:vue.ref(false) }, '../platform/i18n': { translate:key=>key },
  '../platform/actionDialog': { askAction:async()=> 'confirm' }, '../platform/undo': {}, '../platform/undoMessages': {},
 })
 try {
  await cache.loadCacheStatus()
  const old = cache.loadCacheStatus(false)
  for (let i=0;i<4;i++) await Promise.resolve()
  assert.equal(rowsReads, 2)
  const removal = useLibraryManagement().deleteCachedTrack(song)
  // The original code finishes the mutation without issuing a replacement read.
  const next = await Promise.race([enteredFreshRead.promise.then(()=> 'refresh'), removal.then(()=> 'removal')])
  assert.equal(next, 'refresh')
  oldRows.resolve([{ ...song, id: 2 }]); await old
  assert.equal(cache.cachedTracks.value[0]?.id, 1, 'The invalidated scan cannot apply new rows')
  const duplicate = cache.loadCacheStatus(false) // The obsolete read must not release the current in-flight marker.
  assert.equal(statusReads, 3)
  freshUsage.resolve(afterDelete)
  assert.equal(await removal, true)
  await duplicate
  assert.equal(cache.cacheStatus.value.usedBytes, 0)
  assert.equal(cache.cachedTracks.value.length, 0)
 } finally { oldRows.resolve([song]); freshUsage.resolve(afterDelete); dispose() }
})


test('a usage-only refresh keeps any audio rows already requested, then falls back to status only', async () => {
 const oldRows = deferred()
 let rowsReads = 0, latest = false
 const { cache, dispose } = cacheFixture({
  getCacheStatus: async () => latest ? afterDelete : beforeDelete,
  getCachedTracks: async () => ({ tracks: ++rowsReads === 2 ? await oldRows.promise : latest ? [] : [song] }),
 })
 try {
  await cache.loadCacheStatus()
  const old = cache.loadCacheStatus(false)
  for (let i=0;i<4;i++) await Promise.resolve()
  assert.equal(rowsReads, 2)
  latest = true
  await cache.refreshCacheAfterMutation(false)
  assert.equal(cache.cachedTracks.value.length, 0, 'Superseding a rows read must not make its requester wait for the next poll')
  oldRows.resolve([song]); await old
  await cache.refreshCacheAfterMutation(false)
  assert.equal(cache.cachedTracks.value.length, 0)
  assert.equal(rowsReads, 3, 'A standalone usage-only refresh still skips audio rows')
 } finally { oldRows.resolve([song]); dispose() }
})
