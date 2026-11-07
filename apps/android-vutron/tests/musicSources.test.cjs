const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),vm=require('node:vm'),ts=require('typescript'),vue=require('vue')
const app=path.resolve(__dirname,'..')
const compile=name=>ts.transpileModule(fs.readFileSync(path.join(app,'src/plugins',name),'utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022}}).outputText
const protocolModule={exports:{}}
vm.runInNewContext(compile('protocol.ts'),{module:protocolModule,exports:protocolModule.exports})
const source=compile('useMusicSources.ts')
const plain=value=>JSON.parse(JSON.stringify(value))
const deferred=()=>{let resolve,reject;const promise=new Promise((yes,no)=>{resolve=yes;reject=no});return{promise,resolve,reject}}
const tick=()=>new Promise(resolve=>setImmediate(resolve))
const plugin=(id,patch={})=>({id,baseId:id,name:id,type:'stream',enabled:true,builtIn:true,methods:['getAllTracks','search'],accountScope:'account-a',...patch})
function fixture(rows=[],selection){
 let handler=async()=>({plugins:rows})
 const calls=[],api={listMusicPlugins(){calls.push('list');return handler()},callMusicPlugin(){assert.fail('Registry state must not execute source/account code')},manageMusicPlugin(){assert.fail('Registry state must not change a source')}}
 const module={exports:{}}
 vm.runInNewContext(source,{module,exports:module.exports,require:name=>name==='vue'?vue:name==='./protocol'?protocolModule.exports:name==='./bridge'?{musicPluginBridge:api}:(()=>{throw new Error('Unexpected dependency '+name)})(),Error})
 const scope=vue.effectScope(),state=scope.run(()=>module.exports.useMusicSources(api,selection))
 return {state,scope,calls,api,notify:module.exports.notifyMusicSourcesChanged,setHandler(value){handler=value}}
}

test('cold source metadata never executes plugins or accounts and excludes duplicate defaults and stub-only sources',async()=>{
 const f=fixture([
  plugin('netease'),plugin('local',{type:'local'}),plugin('demo'),plugin('kugou'),plugin('emby'),
  plugin('disabled',{enabled:false}),plugin('uninstalled',{installed:false}),
  plugin('account-only',{methods:['getAccount','systemPing','getLyric','getComments']}),
  plugin('stub-only',{methods:['search','getAllTracks'],unsupportedMethods:['search','getAllTracks']}),
  plugin('external-only-search',{builtIn:false,methods:['search']}),
  plugin('netease:other',{baseId:'netease',builtIn:false}),
  plugin('local:other',{baseId:'local',builtIn:false,type:'local'})])
 assert.deepEqual(f.calls,[]);assert.equal(f.state.loaded.value,false);assert.equal(f.state.selectedId.value,'')
 assert.equal(await f.state.refresh(),true);assert.deepEqual(f.calls,['list'])
 assert.deepEqual(plain(f.state.sources.value.map(row=>row.id)),['kugou','emby','external-only-search','netease:other','local:other'])
 assert.equal(f.state.plugins.value.length,12);assert.equal(f.state.error.value,'');f.scope.stop()
})

test('explicit external compatibility sources and separately named instances remain distinguishable',async()=>{
 const rows=[plugin('netease',{builtIn:false,name:'External NetEase'}),plugin('emby:one',{baseId:'emby',builtIn:false,name:'Music server'}),plugin('emby:two',{baseId:'emby',builtIn:false,name:'Music server'}),plugin('local:extra',{baseId:'local',builtIn:false,name:'Local music'})]
 const f=fixture(rows);await f.state.refresh()
 assert.deepEqual(plain(f.state.sources.value.map(row=>row.name)),['External NetEase','Music server · emby:one','Music server · emby:two','Local music · local:extra'])
 assert.deepEqual(rows.map(row=>row.name),['External NetEase','Music server','Music server','Local music'])
 assert.deepEqual(plain(f.state.plugins.value.map(row=>row.name)),rows.map(row=>row.name));f.scope.stop()
})

test('an external session Ref survives the initial load and rejects invalid navigation once metadata is known',async()=>{
 const selected=vue.ref('emby'),f=fixture([plugin('emby')],selected)
 assert.equal(f.state.selectedId,selected);assert.equal(selected.value,'emby');assert.equal(f.state.selected.value,undefined)
 await f.state.refresh();assert.equal(f.state.selected.value.id,'emby');assert.equal(f.state.hasSource(''),true)
 selected.value='deleted-history';assert.equal(selected.value,'');assert.equal(f.state.select('missing'),false)
 assert.equal(f.state.select('emby'),true);assert.equal(selected.value,'emby');assert.equal(f.state.select(''),true);assert.equal(selected.value,'');f.scope.stop()
})

test('disabled, removed and no-longer-capable current sources synchronously fall back to the native entry',async()=>{
 for(const replacement of [[],[plugin('emby',{enabled:false})],[plugin('emby',{methods:['getAccount']})]]){
  const selected=vue.ref('emby'),f=fixture([plugin('emby')],selected);await f.state.refresh()
  f.notify(replacement);assert.equal(selected.value,'');assert.equal(f.state.selected.value,undefined);assert.equal(f.state.selectionKey.value,'');assert.equal(f.calls.length,1);f.scope.stop()
 }
})

test('account-scope changes invalidate a selected page key without changing its source or calling the account',async()=>{
 const f=fixture([plugin('emby')]);await f.state.refresh();f.state.select('emby')
 const key=f.state.selectionKey.value;assert.equal(key,JSON.stringify(['emby','account-a']))
 f.notify([plugin('emby',{accountScope:'account-b'})]);assert.equal(f.state.selectedId.value,'emby');assert.notEqual(f.state.selectionKey.value,key);assert.equal(f.state.selectionKey.value,JSON.stringify(['emby','account-b']))
 assert.deepEqual(f.calls,['list']);f.scope.stop()
})

test('a late successful list cannot replace a newer list and cannot finish its loading state',async()=>{
 const old=deferred(),next=deferred(),f=fixture();let reads=0;f.setHandler(()=>++reads===1?old.promise:next.promise)
 const first=f.state.refresh(),second=f.state.refresh();old.resolve({plugins:[plugin('old')]});assert.equal(await first,false)
 assert.equal(f.state.loading.value,true);assert.equal(f.state.plugins.value.length,0)
 next.resolve({plugins:[plugin('new')]});assert.equal(await second,true);assert.deepEqual(plain(f.state.sources.value.map(row=>row.id)),['new']);assert.equal(f.state.loading.value,false);f.scope.stop()
})

test('a registry notification defeats an older list and a no-argument event only reloads metadata',async()=>{
 const old=deferred(),f=fixture();f.setHandler(()=>old.promise);const read=f.state.refresh()
 f.notify([plugin('current')]);assert.equal(f.state.loading.value,false);assert.equal(f.state.sources.value[0].id,'current')
 old.resolve({plugins:[plugin('old')]});assert.equal(await read,false);assert.equal(f.state.sources.value[0].id,'current')
 f.setHandler(async()=>({plugins:[plugin('after-event')]}));f.notify();await tick();assert.equal(f.calls.length,2);assert.equal(f.state.sources.value[0].id,'after-event');f.scope.stop()
})

test('a failed refresh keeps the current source and retryable metadata and ignores an old failure',async()=>{
 const f=fixture([plugin('emby')]);await f.state.refresh();f.state.select('emby')
 f.setHandler(async()=>{throw new Error('Registry read failed')});assert.equal(await f.state.refresh(),false)
 assert.equal(f.state.error.value,'Registry read failed');assert.equal(f.state.selectedId.value,'emby');assert.equal(f.state.sources.value[0].id,'emby');assert.equal(f.state.loading.value,false)
 const old=deferred();f.setHandler(()=>old.promise);const read=f.state.refresh();f.notify([plugin('emby',{accountScope:'new-account'})]);old.reject(new Error('Old failure'));await read
 assert.equal(f.state.error.value,'');assert.equal(f.state.selected.value.accountScope,'new-account');f.scope.stop()
})

test('stopping the owner cancels subscriptions, external selection watching and late list responses',async()=>{
 const selected=vue.ref('emby'),old=deferred(),f=fixture([plugin('emby')],selected);await f.state.refresh()
 f.setHandler(()=>old.promise);const read=f.state.refresh();f.scope.stop();assert.equal(f.state.loading.value,false)
 f.notify([]);f.notify();old.resolve({plugins:[]});assert.equal(await read,false);assert.equal(f.calls.length,2)
 assert.equal(f.state.sources.value[0].id,'emby');selected.value='navigation-after-dispose';assert.equal(selected.value,'navigation-after-dispose');assert.equal(await f.state.refresh(),false);assert.equal(f.state.select('emby'),false)
})

test('published registry rows are snapshotted until an explicit refresh or management event',async()=>{
 const row=plugin('emby'),f=fixture([row]);await f.state.refresh();f.state.select('emby')
 row.enabled=false;row.methods.length=0;assert.equal(f.state.sources.value.length,1);assert.equal(f.state.selectedId.value,'emby')
 f.notify([row]);assert.equal(f.state.sources.value.length,0);assert.equal(f.state.selectedId.value,'');f.scope.stop()
})
