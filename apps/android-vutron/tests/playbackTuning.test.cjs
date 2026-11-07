const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),vm=require('node:vm'),ts=require('typescript'),vue=require('vue');
const mobileI18n=require('./helpers/i18n.cjs').loadMobileI18n();
const deferred=()=>{let resolve,reject;const promise=new Promise((yes,no)=>{resolve=yes;reject=no});return {promise,resolve,reject}};
function fixture(){
 const state={speed:1,pitch:1,prefetchWifi:false,actualSpeed:1,actualPitch:1,warning:''},store={playback:{}},writes=[];
 let read=async()=>({...state}),write=async patch=>{Object.assign(state,patch);state.actualSpeed=state.speed;state.actualPitch=state.pitch;return {...state}};
 function evaluate(name,deps){const module={exports:{}};vm.runInNewContext(ts.transpileModule(fs.readFileSync(path.join(__dirname,'../src',name),'utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022}}).outputText,{module,exports:module.exports,require:id=>{if(!(id in deps))throw new Error('Unexpected '+id);return deps[id]},setTimeout,clearTimeout,Date,Number,Map,Promise,Error});return module.exports}
 const live=evaluate('platform/liveSettingWrites.ts',{});
  const lifecycle=evaluate('platform/liveSettingsLifecycle.ts',{});
 const plugin={getPlaybackTuning:()=>read(),updatePlaybackTuning:patch=>{writes.push({...patch});return write(patch)}};
  const tuning=evaluate('composables/playbackTuning.ts',{'vue':vue,'../platform/i18n':mobileI18n,'../platform/vutronPlugin':{vutronPlugin:plugin},'../platform/liveSettingWrites':live,'../platform/liveSettingsLifecycle':lifecycle,'../stores/androidShell':{useAndroidShellStore:()=>store}}).usePlaybackTuning();
  return {tuning,state,store,writes,lifecycle,read:handler=>read=handler,write:handler=>write=handler};
}
test('speed and pitch edits merge into serialized native writes and retain the final value',async()=>{
 const f=fixture();await f.tuning.load();f.tuning.update({speed:1.25});f.tuning.update({pitch:1.12});f.tuning.update({speed:1.5});await f.tuning.flush();
 assert.deepEqual(f.writes,[{speed:1.5,pitch:1.12}]);assert.equal(f.tuning.settings.speed,1.5);assert.equal(f.store.playback.rate,1.5);assert.equal(f.store.playback.pitch,1.12);
});
test('a late native response cannot overwrite a newer slider draft',async()=>{
 const f=fixture();await f.tuning.load();const pending=deferred(),started=deferred();let calls=0;
 f.write(async patch=>{if(++calls===1){started.resolve();await pending.promise}Object.assign(f.state,patch);return {...f.state,actualSpeed:f.state.speed,actualPitch:f.state.pitch}});
 f.tuning.update({speed:1.25});const flushing=f.tuning.flush();await started.promise;f.tuning.update({speed:1.75,pitch:.9});pending.resolve();await flushing;
 assert.equal(f.tuning.settings.speed,1.75);assert.equal(f.tuning.settings.pitch,.9);assert.equal(f.writes.length,2);assert.equal(f.store.playback.rate,1.75);
});
test('a delayed settings read preserves an edit and a failed write retries only on an explicit flush',async()=>{
 const f=fixture();await f.tuning.load();const reading=deferred();f.read(()=>reading.promise);const load=f.tuning.load();f.tuning.update({pitch:1.15});reading.resolve({...f.state});await load;assert.equal(f.tuning.settings.pitch,1.15);
 let calls=0;f.write(async patch=>{if(++calls===1)throw new Error('native write failed');Object.assign(f.state,patch);return {...f.state}});
 await f.tuning.flush();assert.match(f.tuning.error.value,/native write failed/);assert.equal(f.tuning.settings.pitch,1.15);assert.equal(calls,1);
 await f.tuning.flush();assert.equal(calls,2);assert.equal(f.tuning.error.value,'');
});
test('the application lifecycle flush saves a slider draft without waiting for change or unmount',async()=>{
  const f=fixture();await f.tuning.load();f.tuning.update({speed:1.37,pitch:.92});
  await f.lifecycle.flushRegisteredLiveSettings();
  assert.equal(f.state.speed,1.37);assert.equal(f.state.pitch,.92);assert.equal(f.writes.length,1);
});
