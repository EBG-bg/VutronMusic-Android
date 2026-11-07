const entries=[
 {id:'local',name:'Local music',type:'local',baseUrl:'',methods:['getAllTracks']},
 {id:'emby',name:'Emby',type:'stream',baseUrl:'',methods:['getAccount','updateBaseUrl','doLogin','doLogout','systemPing','getAllTracks']},
 {id:'netease',name:'NetEase Cloud Music',type:'library',baseUrl:'http://localhost:41830/netease',methods:['getAccount','updateBaseUrl','doLogin','doLogout','systemPing','loginQrKey','loginQrCodeCheck','getAllTracks']},
 {id:'kugou',name:'Kugou',type:'library',baseUrl:'https://kugou.invalid',methods:['getAllTracks','getLyric']},
 {id:'jellyfin',name:'Jellyfin',type:'stream',baseUrl:'',methods:['getAccount','updateBaseUrl','doLogin','systemPing','getAllTracks']},
 {id:'navidrome',name:'Navidrome',type:'stream',baseUrl:'',methods:['getAccount','updateBaseUrl','doLogin','systemPing','getAllTracks']},
 {id:'demo',name:'Demo',type:'local',baseUrl:'',methods:['getAllTracks']}
]
const clone=value=>JSON.parse(JSON.stringify(value))
export const onboardingBackend={plugins:entries.map(row=>({...clone(row),baseId:row.id,builtIn:true,enabled:false,status:'logout',accountScope:'initial-'+row.id})),calls:[],responses:{},scope:0,holdAccount:false,pendingAccount:undefined,
 snapshot(){return{plugins:clone(this.plugins),catalog:entries.map(row=>({...clone(row),builtIn:true,installed:this.plugins.some(plugin=>plugin.id===row.id)}))}},
 respond(method,response){this.responses[method]=response},clear(){this.responses={}},
 async call(query){
  this.calls.push(clone(query));const plugin=this.plugins.find(row=>row.id===query.pluginId)
  if(!plugin?.enabled)throw new Error('Disabled source code must not execute')
  if(this.holdAccount&&query.method==='getAccount')return new Promise(resolve=>this.pendingAccount=resolve)
  if(query.method in this.responses)return clone(this.responses[query.method])
  if(query.method==='getAccount')return{code:200,baseUrl:plugin.baseUrl,userName:''}
  if(query.method==='updateBaseUrl'){plugin.baseUrl=query.params.url;return{code:200}}
  if(query.method==='doLogin'){plugin.status='login';plugin.accountScope='account-'+ ++this.scope;return{code:200,data:{userId:'fixture-user'}}}
  if(query.method==='doLogout'){plugin.status='logout';plugin.accountScope='account-'+ ++this.scope;return{code:200}}
  if(query.method==='systemPing')return{code:200,status:'login'}
  if(query.method==='loginQrKey')return{code:200,data:{url:'https://fixture.invalid/qr',qrcode:'fixture-key'}}
  if(query.method==='loginQrCodeCheck'){plugin.status='login';plugin.accountScope='account-'+ ++this.scope;return{code:803}}
  return{code:200}
 }
}
export const musicPluginBridge={
 listMusicPlugins:async()=>onboardingBackend.snapshot(),
 importMusicPlugin:async()=>{const plugin={...clone(entries[1]),id:'external',baseId:'external',name:'Imported source',builtIn:false,enabled:true};onboardingBackend.plugins.push(plugin);return{plugin,...onboardingBackend.snapshot()}},
 async manageMusicPlugin(query){
  onboardingBackend.calls.push(clone(query));let plugin=onboardingBackend.plugins.find(row=>row.id===query.id)
  if(query.action==='install')return onboardingBackend.snapshot()
  if(query.action==='enable'||query.action==='disable')plugin.enabled=query.action==='enable'
  if(query.action==='configure')plugin.baseUrl=query.baseUrl
  if(query.action==='reset'){plugin.enabled=false;plugin.baseUrl='';plugin.status='logout';plugin.accountScope='reset-'+ ++onboardingBackend.scope}
  if(query.action==='remove'){if(plugin.builtIn)throw new Error('Provided source cannot be removed');onboardingBackend.plugins=onboardingBackend.plugins.filter(row=>row.id!==query.id)}
  return onboardingBackend.snapshot()
 },
 callMusicPlugin:query=>onboardingBackend.call(query)
}
