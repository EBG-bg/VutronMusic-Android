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
