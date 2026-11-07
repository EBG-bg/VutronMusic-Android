const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),vm=require('node:vm')
const ts=require('typescript'),vue=require('vue'),{parse}=require('@vue/compiler-sfc')
const component=path.join(__dirname,'../src/components/PluginManagerView.vue')
const protocolModule={exports:{}}
vm.runInNewContext(ts.transpileModule(fs.readFileSync(path.join(__dirname,'../src/plugins/protocol.ts'),'utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022}}).outputText,{module:protocolModule,exports:protocolModule.exports})
const original=parse(fs.readFileSync(component,'utf8')).descriptor.scriptSetup.content
const source=ts.createSourceFile(component,original,ts.ScriptTarget.Latest,true,ts.ScriptKind.TS)
const script=source.statements.filter(node=>!ts.isImportDeclaration(node)).map(node=>node.getFullText(source)).join('\n')
const exposed='plugins,sourceGroups,canExecute,selected,mode,baseUrl,userName,password,cookie,checked,nextId,nextPanel,busy,error,notice,qrStatus,sourceState,sourceHint,mark,profileConfirmed,toggle,remove,importPlugin,setupNext,nextLabel,checkSource,openDialog,saveAddress,submit,logout,createQr,close,refresh'
function fixture(overrides={}){
 const calls=[],events=[],props={localOnly:false},data={plugins:[],catalog:[]},timers=[]
 const bridge={
  listMusicPlugins:async()=>({plugins:data.plugins,catalog:data.catalog}),
  manageMusicPlugin:async query=>{calls.push(query);if(query.action==='enable'||query.action==='disable')data.plugins.find(row=>row.id===query.id).enabled=query.action==='enable';if(query.action==='configure')data.plugins.find(row=>row.id===query.id).baseUrl=query.baseUrl;if(query.action==='reset')data.plugins.find(row=>row.id===query.id).enabled=false;return{plugins:data.plugins,catalog:data.catalog}},
  callMusicPlugin:async query=>{calls.push(query);return{code:200}},...overrides
 }
 const sandbox={...vue,onMounted:()=>{},onUnmounted:()=>{},bridge,notifyMusicSourcesChanged:()=>{},hasPluginMethod:protocolModule.exports.hasPluginMethod,declaresPluginMethod:protocolModule.exports.declaresPluginMethod,defineProps:()=>props,defineEmits:()=> (...args)=>events.push(args),defineExpose:()=>{},useI18n:()=>({t:key=>key}),actionDialog:vue.ref(),askAction:async()=> 'confirm',useModalFocus:()=>{},useModalIsolation:()=>{},useSheetDrag:()=>{},setTimeout:fn=>{timers.push(fn);return timers.length},clearTimeout:()=>{},document:{visibilityState:'visible'},URL,Error,Number,console}
 vm.runInNewContext(ts.transpileModule(script+'\nglobalThis.api={'+exposed+'}',{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022}}).outputText,sandbox)
 return{api:sandbox.api,bridge,calls,events,props,data,timers}
}
const plugin=(fields={})=>({id:'server',name:'Server',type:'stream',enabled:true,builtIn:true,baseUrl:'https://music.invalid',accountScope:'server-1',methods:['getAccount','updateBaseUrl','doLogin','doLogout','systemPing'],...fields})
test('provided sources load without an install action, server probe or login dialog',async()=>{
 const s=fixture();s.data.plugins=[plugin({enabled:false}),plugin({id:'netease'}),plugin({id:'local',type:'local'}),plugin({id:'demo'})];await s.api.refresh();assert.equal(s.api.plugins.value.length,4);assert.equal(s.api.mode.value,undefined);assert.equal(s.calls.length,0);assert.deepEqual(Array.from(s.api.sourceGroups.value,row=>row.plugins.length),[1,2,1]);assert.equal(s.api.sourceState(s.api.plugins.value[0]),'disabled')
})
test('the existing local source is immediately usable, while a server without an address requires configuration',async()=>{
 const s=fixture(),local=plugin({id:'local',type:'local',baseUrl:'',methods:[]});s.api.setupNext(local);assert.deepEqual(s.events,[['open','local']]);assert.equal(s.api.sourceState(local),'localReady');assert.equal(s.api.sourceState(plugin({baseUrl:''})),'needsConfig');assert.equal(s.calls.length,0)
 assert.equal(s.api.sourceState(plugin({id:'netease',baseUrl:''})),'needsLogin','NetEase has a built-in API default and does not require an external server')
})
test('saved metadata is not proof of current login and validation belongs to one account scope',()=>{
 const {api}=fixture(),p=plugin({status:'login'});assert.equal(api.sourceState(p),'savedLogin');api.mark(p,'ready');assert.equal(api.sourceState(p),'ready');assert.equal(api.sourceState({...p,accountScope:'server-2'}),'savedLogin');assert.equal(api.sourceState({...p,enabled:false}),'disabled')
 assert.equal(api.sourceHint({...p,id:'netease'}),'neteaseSavedLoginHint')
})
test('only a real nonempty profile userId confirms sign-in',()=>{
 const {api}=fixture();for(const value of [null,{},[],{userId:0},{userId:''},{userId:'0'},{userId:NaN},{userId:Infinity}])assert.equal(api.profileConfirmed(value),false)
 for(const value of [{userId:42},{userId:'emby-user'}])assert.equal(api.profileConfirmed(value),true)
})
test('a manual check never mistakes the original NetEase constant ping for login',async()=>{
 const s=fixture({callMusicPlugin:async query=>{s.calls.push(query);return query.method==='systemPing'?{code:200,status:'login'}:{code:200,baseUrl:'http://localhost:41830/netease'}}}),p=plugin({id:'netease',type:'library'})
 await s.api.checkSource(p);assert.equal(s.calls[0].method,'getAccount');assert.equal(s.api.sourceState(p),'unverified');assert.match(s.api.notice.value,/checkUnknownHint$/)
 s.api.mark(p,'ready');await s.api.checkSource(p);assert.equal(s.api.sourceState(p),'ready','A configuration-only check cannot revoke real login proof')
 s.api.checked.value={};const saved={...p,status:'login'};await s.api.checkSource(saved);assert.equal(s.api.sourceState(saved),'savedLogin');assert.match(s.api.notice.value,/neteaseSavedLoginHint$/)
})
test('check failures and non-authenticated statuses cannot show verified login',async()=>{
 for(const response of [{code:401},{code:403},{code:500},{code:200,status:'logout'},{code:200,status:'offline'},{code:200}]){
  const s=fixture({callMusicPlugin:async()=>response}),p=plugin();s.api.mark(p,'ready');await s.api.checkSource(p);assert.notEqual(s.api.sourceState(p),'ready',JSON.stringify(response))
 }
 const s=fixture({callMusicPlugin:async()=>({code:200,status:'login'})}),p=plugin();await s.api.checkSource(p);assert.equal(s.api.sourceState(p),'ready');s.props.localOnly=true;const previous=s.api.checked.value;await s.api.checkSource(p);assert.equal(s.api.checked.value,previous)
})
test('failed account reads and login/exit mutations preserve a recoverable dialog',async()=>{
 const s=fixture({callMusicPlugin:async()=>({code:403,message:'denied'})}),p=plugin();s.data.plugins=[p];await s.api.openDialog(p,'account');assert.equal(s.api.error.value,'denied');assert.equal(s.api.mode.value,'account');await s.api.submit(true);assert.equal(s.api.mode.value,'account');assert.equal(s.api.sourceState(p),'needsLogin');await s.api.logout();assert.equal(s.api.mode.value,'account');assert.equal(s.api.error.value,'denied')
})
test('successful configuration alone does not sign in; a login requires a profile',async()=>{
 const s=fixture(),p=plugin();s.data.plugins=[p];await s.api.refresh();await s.api.openDialog(p,'account');await s.api.submit(true);assert.equal(s.api.mode.value,'account');assert.equal(s.api.sourceState(p),'unverified');assert.match(s.api.error.value,/checkUnknownHint$/)
 s.bridge.callMusicPlugin=async()=>({code:200,data:{userId:'user'}});await s.api.submit(true);assert.equal(s.api.sourceState(p),'ready');assert.equal(s.api.mode.value,undefined)
})
test('a stale getAccount denial cannot overwrite the next dialog',async()=>{
 let finish;const s=fixture({callMusicPlugin:()=>new Promise(resolve=>finish=resolve)}),p=plugin();const pending=s.api.openDialog(p,'account');s.api.close();finish({code:403});await pending;assert.equal(s.api.error.value,'');assert.equal(s.api.sourceState(p),'needsLogin');assert.equal(Object.keys(s.api.checked.value).length,0)
})
test('a delayed public account read cannot replace an address or name already being edited',async()=>{
 let finish;const s=fixture({callMusicPlugin:()=>new Promise(resolve=>finish=resolve)}),p=plugin();const pending=s.api.openDialog(p,'account');s.api.baseUrl.value='https://edited.invalid';s.api.userName.value='edited';finish({code:200,baseUrl:'https://old.invalid',userName:'old'});await pending;assert.equal(s.api.baseUrl.value,'https://edited.invalid');assert.equal(s.api.userName.value,'edited')
})
test('QR only accepts explicit 803 success and keeps other failures visible',async()=>{
 for(const code of [200,401,803]){
  const s=fixture(),p=plugin({methods:['loginQrKey','loginQrCodeCheck']});s.data.plugins=[p];s.bridge.callMusicPlugin=async query=>query.method==='loginQrKey'?{code:200,data:{url:'https://music.invalid/qr',qrcode:'key'}}:{code}
  await s.api.openDialog(p,'account');await s.api.createQr();assert.equal(s.timers.length,1);await s.timers.shift()();assert.equal(s.api.sourceState(p)==='ready',code===803);assert.equal(s.api.mode.value===undefined,code===803)
 }
})

test('a disabled source can save its address offline without executing plugin code',async()=>{
 const s=fixture(),p=plugin({enabled:false});s.data.plugins=[p];s.props.localOnly=true;await s.api.openDialog(p,'account');assert.equal(s.calls.length,0);assert.equal(s.api.canExecute.value,false);s.api.baseUrl.value='https://edited.invalid';await s.api.submit(false);assert.equal(s.calls.length,1);assert.equal(s.calls[0].action,'configure');assert.equal(s.calls[0].baseUrl,'https://edited.invalid');assert.equal(p.enabled,false);assert.equal(s.api.mode.value,undefined)
 await s.api.openDialog(p,'account');await s.api.createQr();await s.api.logout();await s.api.checkSource(p);assert.equal(s.calls.length,1)
})
test('provided rows reset only after confirmation; switching on does not call plugin code',async()=>{
 const s=fixture(),p=plugin({enabled:false}),instance=plugin({id:'server:other',baseId:'server',builtIn:false});s.data.plugins=[p,instance];await s.api.toggle(p);assert.equal(p.enabled,true);assert.equal(s.calls[0].action,'enable');await s.api.remove(p);assert.equal(s.calls[1].action,'reset');assert.equal(p.enabled,false);assert.equal(s.data.plugins.length,2);assert.equal(instance.enabled,true)
})
