const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),vm=require('node:vm'),ts=require('typescript'),vue=require('vue')
function loader(plugin,extra={}) {
 const cache=new Map()
 function load(relative){
  const filename=path.resolve(__dirname,'../src',relative)
  if(cache.has(filename))return cache.get(filename).exports
  const module={exports:{}};cache.set(filename,module)
  vm.runInNewContext(ts.transpileModule(fs.readFileSync(filename,'utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022}}).outputText,{
   module,exports:module.exports,require:name=>name==='vue'?vue:name.includes('vutronPlugin')?{vutronPlugin:plugin}:name.includes('/i18n')?{translate:key=>key}:name.includes('liveSettingsLifecycle')?{registerLiveSettingsFlusher(){},flushRegisteredLiveSettings:async()=>{}}:name.includes('androidShell')?{useAndroidShellStore:()=>({playback:{}})}:name.includes('sleepTimer')?{}:load(path.relative(path.resolve(__dirname,'../src'),path.resolve(path.dirname(filename),name+'.ts'))),
   console,setTimeout,clearTimeout,setInterval,clearInterval,document:{visibilityState:'visible'},...extra
  });return module.exports
 }
 return load
}
test('unchanged cache settings skip native calls, identical in-flight writes share one request and failed values can retry',async()=>{
 let writes=0,fail=false,release
 let native={capacityMb:2048,artworkCapacityMb:128,enabled:true,usedBytes:0,trackCount:0}
 const plugin={getCacheStatus:async()=>({...native}),setCacheEnabled:async({enabled})=>{writes++;native.enabled=enabled;return {...native}},setCacheCapacity:async({capacityMb})=>{writes++;if(release)await new Promise(resolve=>release=resolve);if(fail){fail=false;throw new Error('quota')}native.capacityMb=capacityMb;return {...native}},setArtworkCacheCapacity:async({capacityMb})=>{writes++;native.artworkCapacityMb=capacityMb;return {...native}}}
 const scope=vue.effectScope(),error=vue.ref(''),cache=scope.run(()=>loader(plugin)('stores/domains/shellCache.ts').createShellCache({activeTab:vue.ref('player'),playback:vue.ref({}),onlineAvailable:vue.ref(false),error,t:key=>key,formatError:(_e,key)=>key,resolveCacheTrack(){},loadOfflinePlaylists(){}}))
 await cache.loadCacheStatus(true,false)
 await cache.setAutomaticCache(true);await cache.setCacheCapacity();await cache.setArtworkCacheCapacity();assert.equal(writes,0)
 cache.cacheCapacityMb.value=3072;release=true
 const first=cache.setCacheCapacity(),same=cache.setCacheCapacity()
 await Promise.resolve();await Promise.resolve();assert.equal(writes,1);release();release=undefined;await Promise.all([first,same]);assert.equal(writes,1)
 await cache.setCacheCapacity();assert.equal(writes,1)
 fail=true;cache.cacheCapacityMb.value=4096;await cache.setCacheCapacity();assert.equal(writes,2);assert.equal(cache.cacheStatus.value.capacityMb,3072)
 await cache.setCacheCapacity();assert.equal(writes,3);assert.equal(cache.cacheStatus.value.capacityMb,4096)
 scope.stop()
})
function cacheFixture(plugin) {
 const scope = vue.effectScope(), error = vue.ref('')
 const cache = scope.run(() => loader(plugin)('stores/domains/shellCache.ts').createShellCache({
  activeTab: vue.ref('settings'), playback: vue.ref({}), onlineAvailable: vue.ref(false), error,
  t: key => key, formatError: error => error.message, resolveCacheTrack() {}, loadOfflinePlaylists() {},
 }))
 return { cache, error, dispose: () => scope.stop() }
}

for (const first of ['capacity', 'enable']) {
 test(`concurrent cache settings keep both confirmed results when ${first} is delayed`, async () => {
  const native = { capacityMb: 2048, artworkCapacityMb: 128, enabled: true, artworkFull: true, usedBytes: 0, trackCount: 0 }
  let release
  const held = new Promise(resolve => { release = resolve })
  const writes = []
  const bridge = (field, save) => async options => {
   writes.push(field)
   if (field === first) await held
   save(options)
   return { ...native }
  }
  const { cache, dispose } = cacheFixture({
   getCacheStatus: async () => ({ ...native }),
   setArtworkCacheCapacity: bridge('capacity', ({ capacityMb }) => { native.artworkCapacityMb = capacityMb; native.artworkFull = false }),
   setCacheEnabled: bridge('enable', ({ enabled }) => { native.enabled = enabled }),
  })
  try {
   await cache.loadCacheStatus(true, false)
   cache.artworkCacheCapacityMb.value = 256
   const save = { capacity: () => cache.setArtworkCacheCapacity(), enable: () => cache.setAutomaticCache(false) }
   const second = first === 'capacity' ? 'enable' : 'capacity'
   const one = save[first](), two = save[second](), duplicate = save[second]()
   await Promise.resolve(); await Promise.resolve()
   const startedBeforeRelease = writes.slice()
   cache.artworkCacheCapacityMb.value = 288 // A newer preview, not yet submitted.
   release(); await Promise.all([one, two, duplicate])
   assert.equal(cache.cacheStatus.value.artworkCapacityMb, 256)
   assert.equal(cache.cacheStatus.value.artworkFull, false)
   assert.equal(cache.cacheStatus.value.enabled, false)
   assert.equal(cache.artworkCacheCapacityMb.value, 288)
   assert.deepEqual(startedBeforeRelease, [first], 'The next write cannot observe a partial status')
   assert.deepEqual(writes, [first, second], 'Repeated in-flight values still need only one native write')
  } finally { release(); dispose() }
 })
}

test('an explicit cache read during a write keeps the confirmed capacity and the newer slider preview', async () => {
 const native = { capacityMb: 2048, artworkCapacityMb: 128, usedBytes: 0, trackCount: 0 }
 let allowWrite, allowRead, holdRead = false, reads = 0
 const writing = new Promise(resolve => { allowWrite = resolve }), reading = new Promise(resolve => { allowRead = resolve })
 const { cache, dispose } = cacheFixture({
  getCacheStatus: async () => { reads++; const snapshot = { ...native }; if (holdRead) await reading; return snapshot },
  setArtworkCacheCapacity: async ({ capacityMb }) => { await writing; native.artworkCapacityMb = capacityMb; return { ...native } },
 })
 try {
  await cache.loadCacheStatus(true, false)
  cache.artworkCacheCapacityMb.value = 256
  const save = cache.setArtworkCacheCapacity()
  holdRead = true
  const refresh = cache.loadCacheStatus(true, false)
  cache.artworkCacheCapacityMb.value = 288
  allowWrite(); await save
  assert.equal(cache.cacheStatus.value.artworkCapacityMb, 256, 'The confirmed status is available before a cache read completes')
  allowRead(); await refresh
  assert.equal(reads, 2)
  assert.equal(cache.cacheStatus.value.artworkCapacityMb, 256)
  assert.equal(cache.artworkCacheCapacityMb.value, 288)
 } finally { allowWrite(); allowRead(); dispose() }
})

test('a stale cache poll cannot undo a second change to the same slider', async () => {
 const native = { capacityMb: 2048, artworkCapacityMb: 128, usedBytes: 0, trackCount: 0 }
 const writes = []
 let allowWrite, returnPoll, holdPoll = false
 const writing = new Promise(resolve => { allowWrite = resolve })
 const reading = new Promise(resolve => { returnPoll = resolve })
 const { cache, dispose } = cacheFixture({
  getCacheStatus: async () => holdPoll ? reading : { ...native },
  setArtworkCacheCapacity: async ({ capacityMb }) => {
   writes.push(capacityMb)
   if (capacityMb === 256) await writing
   native.artworkCapacityMb = capacityMb
   return { ...native }
  },
 })
 try {
  await cache.loadCacheStatus(true, false)
  holdPoll = true
  const latePoll = cache.loadCacheStatus(false, false)
  const stale = { ...native }
  cache.artworkCacheCapacityMb.value = 256
  const first = cache.setArtworkCacheCapacity()
  cache.artworkCacheCapacityMb.value = 128 // Return to the old value while the first edit is still saving.
  const second = cache.setArtworkCacheCapacity()
  allowWrite(); await first
  assert.equal(cache.cacheStatus.value.artworkCapacityMb, 256)
  await second
  returnPoll({ ...stale, artworkCapacityMb: 64 })
  await latePoll
  assert.deepEqual(writes, [256, 128])
  assert.equal(native.artworkCapacityMb, 128)
  assert.equal(cache.cacheStatus.value.artworkCapacityMb, 128)
  assert.equal(cache.artworkCacheCapacityMb.value, 128)
 } finally { allowWrite(); returnPoll({ ...native }); dispose() }
})

test('invalidated cache reads leave the current state alone and clearing still refreshes usage', async () => {
 const native = { capacityMb: 2048, artworkCapacityMb: 128, artworkBytes: 128 * 1024 * 1024, artworkFull: true, usedBytes: 42, trackCount: 1 }
 let deliverStale, holdRead = false
 const stale = new Promise(resolve => { deliverStale = resolve })
 const { cache, dispose } = cacheFixture({
  getCacheStatus: async () => holdRead ? stale : { ...native },
  clearCache: async () => Object.assign(native, { usedBytes: 0, trackCount: 0, artworkBytes: 0, artworkFull: false }),
 })
 try {
  await cache.loadCacheStatus(true, false)
  holdRead = true
  const oldRead = cache.loadCacheStatus(true, false)
  cache.bumpCacheReadRevision() // The shell invalidates pending reads at logout.
  deliverStale({ ...native, artworkCapacityMb: 32, usedBytes: 99 })
  await oldRead
  assert.equal(cache.cacheStatus.value.artworkCapacityMb, 128)
  assert.equal(cache.cacheStatus.value.usedBytes, 42)
  holdRead = false
  await cache.clearCache()
  assert.equal(cache.cacheStatus.value.usedBytes, 0)
  assert.equal(cache.cacheStatus.value.artworkFull, false)
 } finally { dispose() }
})

test('same overlay, volume and delay values do not write again, while a failed draft remains retryable',async()=>{
 let writes=0,fail=false
 const write=async()=>{writes++;if(fail){fail=false;throw new Error('disk')}}
 const plugin={updateLyricOverlaySettings:async({settings})=>{await write();return settings},setLyricOffset:write,setTrackVolume:write,setPlaylistVolume:write}
 const playback=vue.ref({trackId:1,title:'Track',track:{id:1,name:'Track',playlistVolumeKey:'p'},trackVolumePercent:100,playlistVolumePercent:100}),error=vue.ref('')
 const state=loader(plugin)('stores/domains/shellOverlay.ts').createShellOverlay({playback,error,t:key=>key,formatError:(_e,key)=>key,playbackTrackKey:()=>String(playback.value.trackId)})
 await state.updateOverlayField('translation',true);await state.setCurrentTrackVolume(100);await state.setCurrentPlaylistVolume(100);await state.updateOverlayField('playedColor',0xff37cf88|0);assert.equal(writes,0)
 await state.updateOverlayField('translation',false);await state.updateOverlayField('translation',false);assert.equal(writes,1)
 await state.updateCurrentLyricOffset(120);await state.updateCurrentLyricOffset(120);assert.equal(writes,2)
 await state.setCurrentTrackVolume(75);await state.setCurrentTrackVolume(75);await state.setCurrentPlaylistVolume(80);await state.setCurrentPlaylistVolume(80);assert.equal(writes,4)
 fail=true;await state.updateOverlayField('shadowEnabled',false);assert.equal(writes,5)
 await state.updateOverlayField('shadowEnabled',false);assert.equal(writes,6)
 await state.flushLiveSettings();assert.equal(writes,6)
})
test('unchanged playback speed, pitch and prefetch preserve zero writes and failed same-value edits retry',async()=>{
 let writes=0,fail=false
 const current={speed:1,pitch:1,prefetchWifi:false,actualSpeed:1,actualPitch:1,warning:''}
 const plugin={getPlaybackTuning:async()=>({...current}),updatePlaybackTuning:async patch=>{writes++;if(fail){fail=false;throw new Error('native')}Object.assign(current,patch);return {...current,actualSpeed:current.speed,actualPitch:current.pitch}}}
 const state=loader(plugin)('composables/playbackTuning.ts').usePlaybackTuning()
 await state.load();state.update({speed:1,pitch:1,prefetchWifi:false});await state.flush();assert.equal(writes,0)
 state.update({speed:1.2});await state.flush();state.update({speed:1.2});await state.flush();assert.equal(writes,1)
 fail=true;state.update({pitch:1.3});await state.flush();assert.equal(writes,2);assert.equal(state.pending.value,true)
 state.update({pitch:1.3});await state.flush();assert.equal(writes,3);assert.equal(state.pending.value,false)
})
