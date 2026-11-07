'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const os = require('os');
const http = require('http');
const tempRoot = os.tmpdir();
const runtime = path.resolve(__dirname, '../src/main/assets/sources-runtime');
const { createPluginHost, redact, validId, brandResult, accountScope } = require(path.join(runtime, 'plugin-host.cjs'));
const contract = require(path.join(runtime, 'plugin-contract.cjs'));
function host(options={}) {
  const root = fs.mkdtempSync(path.join(tempRoot, 'vutron-plugin-host-'));
  const previousTmp = process.env.TMPDIR;
  const instance = createPluginHost({ root, builtins: path.join(runtime, 'plugins'), workerFile:path.join(runtime,'plugin-worker.cjs'), validateMeta:contract.validateMeta, validateResult:contract.validateResult,...options });
  return { ...instance, root, previousTmp };
}
async function finish(instance) {
  try { instance.close(); await new Promise(resolve=>setTimeout(resolve,100)); }
  finally {
    if (instance.previousTmp === undefined) delete process.env.TMPDIR;
    else process.env.TMPDIR = instance.previousTmp;
    fs.rmSync(instance.root,{recursive:true,force:true});
  }
}
const source = `exports.meta={name:'Fixture',type:'stream',capabilities:{getLyric:true}};
let initialized='';api.store.get('value').then(v=>{initialized=v||'ready'});
exports.systemPing=async()=>({code:200,status:initialized==='ready'?'login':'logout'});
exports.getAccount=async()=>({code:200,baseUrl:'',userName:await api.store.get('value')||'',pwd:''});
exports.doLogin=async p=>{await api.store.set('value',p.userName);await api.db.set('PluginData',{token:p.userName});return {code:200}};
exports.search=async p=>{const value=await api.http.get(p.url);return {code:200,data:[],count:value.value,sourceContext:{cursor:'opaque'}}};`;

test('instance identity brands music objects while preserving explicit mixed sources and opaque contexts',()=>{
 const opaque={pluginId:'',nested:{cursor:'private'}};
 const value={data:[{pluginId:'',sourceContext:opaque,album:{pluginId:''}},{pluginId:'other',sourceContext:{any:'value'}}]};
 const result=brandResult(value,'navidrome:home');
 assert.equal(result.data[0].pluginId,'navidrome:home');assert.equal(result.data[0].album.pluginId,'navidrome:home');assert.equal(result.data[1].pluginId,'other');
 assert.equal(result.data[0].sourceContext,opaque);assert.equal(value.data[0].pluginId,'');
});
test('public account scopes separate servers and accounts without depending on tokens or passwords',()=>{
 const first=accountScope('emby',false,'https://host/library',{userId:'7',token:'one'},0);
 assert.equal(first,accountScope('emby',false,'https://host:443/library/',{userId:'7',token:'two',pwd:'new'},9));
 assert.notEqual(first,accountScope('emby',false,'https://host/library',{userId:'8'},0));
 assert.notEqual(first,accountScope('emby',false,'https://other/library',{userId:'7'},0));
 assert.equal(accountScope('local',true,'',{},0),accountScope('local',true,'https://unused',{userId:'9'},4));
});

test('all seven upstream manifests are present and listing does not evaluate plugin code', async()=>{
  const instance=host();
  try { assert.equal(instance.list().plugins.length,7);assert.ok(instance.list().plugins.every(row=>row.enabled===false));assert.deepEqual(instance.list().catalog.map(x=>x.id).sort(),['demo','emby','jellyfin','kugou','local','navidrome','netease']); assert.equal(fs.existsSync(path.join(instance.root,'netease.state.json')),false); }
  finally { await finish(instance); }
});
test('failed plugin imports and successful previews remove temporary initialized state', async()=>{
  const instance=host();
  try {
    const before=fs.readdirSync(instance.root).sort();
    await assert.rejects(instance.manage({action:'import',source:"api.store.set('temporary','private');exports.meta={name:'Invalid',type:'invalid'};"}));
    assert.deepEqual(fs.readdirSync(instance.root).sort(),before);
    const preview=await instance.manage({action:'inspect',source});assert.equal(preview.plugin.name,'Fixture');
    assert.deepEqual(fs.readdirSync(instance.root).sort(),before);
  }finally{await finish(instance)}
});
test('import, initialization, isolated instances, disable and durable credentials', async()=>{
  const instance=host();
  try {
    const imported=await instance.manage({action:'import',source});const id=imported.plugin.id;
    assert.equal((await instance.call(id,'systemPing',{},false)).status,'login');
    await instance.call(id,'doLogin',{userName:'first'},false);
    const copy=await instance.manage({action:'instance',id,name:'Second'});
    assert.equal((await instance.call(copy.plugin.id,'getAccount',{},false)).userName,'');
    assert.equal((await instance.call(id,'getAccount',{},false)).userName,'first');
    await instance.manage({action:'disable',id});await assert.rejects(instance.call(id,'systemPing',{},false),{code:'PLUGIN_DISABLED'});
    await instance.manage({action:'enable',id});assert.equal((await instance.call(id,'getAccount',{},false)).userName,'first');
    await assert.rejects(instance.manage({action:'remove',id}),{code:'PLUGIN_INSTANCES'});
    await instance.manage({action:'remove',id:copy.plugin.id});await instance.manage({action:'remove',id});
    assert.equal(instance.list().plugins.some(x=>x.id===id),false);
  } finally { await finish(instance); }
});
test('a queued scoped call cannot report to the account that logged in ahead of it',async()=>{
  const instance=host();
  try {
    const id=(await instance.manage({action:'import',source})).plugin.id;
    await instance.call(id,'doLogin',{userName:'first'},false);
    const scope=instance.list().plugins.find(plugin=>plugin.id===id).accountScope;
    const login=instance.handle({action:'call',id,method:'doLogin',params:{userName:'second'},allowNetwork:false});
    const rejected=assert.rejects(instance.handle({action:'call',id,method:'getAccount',params:{},allowNetwork:false,expectedAccountScope:scope}),{code:'PLUGIN_ACCOUNT_CHANGED'});
    await login;await rejected;
    assert.equal((await instance.call(id,'getAccount',{},false)).userName,'second');
  }finally{await finish(instance)}
});

test('an idempotent enable during a source check retains the completed status update',async()=>{
 const instance=host();
 try{
  const id=(await instance.manage({action:'import',source:"exports.meta={name:'Check',type:'library'};exports.systemPing=async()=>({code:200,status:'login'});"})).plugin.id;
  const check=instance.call(id,'systemPing',{},false);
  await instance.manage({action:'enable',id});await check;
  assert.equal(instance.list().plugins.find(row=>row.id===id).status,'login');
 }finally{await finish(instance)}
});
test('HTTP follows the configured origin, preserves sourceContext and obeys offline mode', async()=>{
  const server=http.createServer((request,response)=>{response.setHeader('Content-Type','application/json');response.end('{"value":2}');});
  await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));const baseUrl='http://127.0.0.1:'+server.address().port;
  const instance=host();
  try {
    const id=(await instance.manage({action:'import',source})).plugin.id;
    await instance.manage({action:'configure',id,baseUrl});
    const result=await instance.call(id,'search',{url:baseUrl+'/search'},true);assert.equal(result.count,2);assert.deepEqual(result.sourceContext,{cursor:'opaque'});
    await assert.rejects(instance.call(id,'search',{url:'https://example.com'},true),{code:'PLUGIN_DOMAIN'});
    await assert.rejects(instance.call(id,'search',{url:baseUrl+'/search'},false),{code:'PLUGIN_OFFLINE'});
    assert.equal(instance.list().plugins.find(x=>x.id===id).baseUrl,baseUrl);
  } finally { await finish(instance);await new Promise(resolve=>server.close(resolve)); }
});
test('path and embedded lyric helpers use separate authorized resources',async()=>{
  const instance=host();
  try {
    const plugin=`exports.meta={name:'Lyric helpers',type:'local',capabilities:{getLyric:true}};
exports.getLyric=async p=>({code:200,data:p.embedded?await api.utils.getEmbeddedLyric(p.filePath):await api.utils.getPathLyric(p.filePath)});`;
    const id=(await instance.manage({action:'import',source:plugin})).plugin.id;
    const line=text=>[{start:1,end:2,lyric:{text}}];
    await instance.manage({action:'resources',id,resources:{
      'content://authorized/Song.mp3':{exists:true,embeddedLyrics:line('Embedded')},
      'content://authorized/Song.lrc':{exists:true,pathLyrics:line('Sidecar')}
    }});
    assert.equal((await instance.call(id,'getLyric',{filePath:'content://authorized/Song.mp3',embedded:true},false)).data[0].lyric.text,'Embedded');
    assert.equal((await instance.call(id,'getLyric',{filePath:'content://authorized/Song.lrc'},false)).data[0].lyric.text,'Sidecar');
    assert.deepEqual((await instance.call(id,'getLyric',{filePath:'content://authorized/Song.lrc',embedded:true},false)).data,[]);
    assert.deepEqual((await instance.call(id,'getLyric',{filePath:'content://not-authorized/Song.mp3',embedded:true},false)).data,[]);
    assert.deepEqual((await instance.call(id,'getLyric',{filePath:'content://authorized/Song.mp3'},false)).data,[]);
  }finally{await finish(instance)}
});
test('result schema violations fail explicitly; uninstalled sources cannot mutate; identities cannot traverse paths',async()=>{
  const instance=host();
  try {
    const id=(await instance.manage({action:'import',source:`exports.meta={name:'Invalid',type:'library'};exports.search=()=>({code:200,data:'bad'})`})).plugin.id;
    await assert.rejects(instance.call(id,'search',{},false));
    await assert.rejects(instance.manage({action:'remove',id:'local'}),{code:'PLUGIN_BUILTIN_PROVIDED'});
    assert.throws(()=>validId('../private'));
    assert.equal(redact('token=abcdef password=xyz https://example.com/private'),'[private] [private] [url]');
    assert.equal(redact('{"cookie":"private-cookie", "pwd":"private-password"}'),'{[private], [private]}');
    await assert.rejects(instance.call('constructor','systemPing',{},false),{code:'PLUGIN_NOT_FOUND'});
  } finally { await finish(instance); }
});
test('local table CRUD retains playlist entries, reorder, likes and exact sourceContext',async()=>{
  const instance=host();
  try {
    const id=(await instance.manage({action:'import',source:`exports.meta={name:'DB',type:'local'};
exports.doLogin=async()=>{await api.db.set('Track',{id:'1',name:'A',liked:true});await api.db.set('Playlist',{id:'p',name:'P'});await api.db.set('PlaylistEntry',{playlistId:'p',pluginId:'local',sourceContext:{id:'1',privateField:{cursor:'abc'}}});return {code:200}};
exports.getAccount=async()=>{const rows=await api.db.get('Track',{ids:['1']});const entries=await api.db.get('PlaylistEntry',{playlistId:'p'});return {code:200,baseUrl:'',userName:rows.songs[0].name,pwd:entries[0].sourceContext}};`})).plugin.id;
    await instance.call(id,'doLogin',{},false);const account=await instance.call(id,'getAccount',{},false);
    assert.equal(account.userName,'A');assert.deepEqual(JSON.parse(account.pwd),{id:'1',privateField:{cursor:'abc'}});
  } finally { await finish(instance); }
});

test('a stuck method is terminated at its deadline and a fresh worker can recover',async()=>{
 const instance=host({callTimeoutMs:120});
 try{
  const id=(await instance.manage({action:'import',source:`exports.meta={name:'Stuck',type:'library'};exports.systemPing=()=>{while(true){}};exports.getAccount=()=>({code:200,baseUrl:'',userName:'recovered',pwd:''})`})).plugin.id;
  await assert.rejects(instance.call(id,'systemPing',{},false),{code:'PLUGIN_TIMEOUT'});
  assert.equal((await instance.call(id,'getAccount',{},false)).userName,'recovered');
 }finally{await finish(instance)}
});

test('all bundled upstream plugins initialize their metadata and private stores offline',async()=>{
 const instance=host();
 try{
  for(const id of ['local','netease','kugou','navidrome','emby','jellyfin','demo']){
   await instance.manage({action:'enable',id});
   let result;try{result=await instance.call(id,'getAccount',{},false)}catch(error){error.message=id+': '+error.message;throw error}
   assert.equal(typeof result.code,'number',id);
  }
 }finally{await finish(instance)}
});

test('the original NetEase virtual API dispatches in-process with only its own cookie',async()=>{
 const reads=[];const instance=host({neteaseApi:{
  top_artists:async params=>{reads.push({method:'top_artists',cookie:params.cookie});return {body:{code:200,artists:[]},status:200,cookie:[]}},
  banner:async params=>{reads.push({method:'banner',cookie:params.cookie});return {body:{code:200,banners:[]},status:200,cookie:[]}}
 }});
 try{
  await instance.manage({action:'enable',id:'netease'});
  fs.writeFileSync(path.join(instance.root,'netease.state.json'),JSON.stringify({store:{baseUrl:'http://localhost:41830/netease'},db:{PluginData:{userId:7,cookie:'plugin-session-only'}}}));
  const result=await instance.call('netease','getBanner',{},true);
  assert.equal(result.code,200);assert.deepEqual(result.data,[]);
  assert.ok(reads.some(x=>x.method==='banner'));assert.ok(reads.every(x=>x.cookie==='plugin-session-only'));
 }finally{await finish(instance)}
});

test('rescanning local tracks preserves likes and playback statistics but removes revoked recordings',async()=>{
 const instance=host();
 try{
  await instance.manage({action:'enable',id:'local'});
  await instance.manage({action:'syncLocalLibrary',id:'local',fingerprint:'authorized-first',tables:{Track:[{id:'1',name:'A',duration:10000},{id:'2',name:'B',duration:10000}],Album:[],Artist:[]}});
  const stateFile=path.join(instance.root,'local.state.json'),state=JSON.parse(fs.readFileSync(stateFile,'utf8'));
  state.db.Track[0]={...state.db.Track[0],liked:true,playCount:8,lastPlayed:99};
  state.db.Playlist=[{id:'p',name:'Preserve'}];state.db.PlaylistEntry=[{id:'e',playlistId:'p',sourceContext:'{"id":"1"}'}];
  fs.writeFileSync(stateFile,JSON.stringify(state));
  const unchanged=await instance.manage({action:'syncLocalLibrary',id:'local',fingerprint:'authorized-first',tables:{Track:[]}});
  assert.equal(unchanged.changed,false);assert.equal(JSON.parse(fs.readFileSync(stateFile,'utf8')).db.Track.length,2);
  await instance.manage({action:'syncLocalLibrary',id:'local',fingerprint:'authorized-second',tables:{Track:[{id:'1',name:'Renamed',duration:10000}],Album:[],Artist:[]}});
  const result=JSON.parse(fs.readFileSync(stateFile,'utf8'));
  assert.equal(result.db.Track.length,1);assert.equal(result.db.Track[0].name,'Renamed');assert.equal(result.db.Track[0].playCount,8);assert.equal(result.db.Track[0].lastPlayed,99);assert.equal(result.db.Track[0].liked,true);
  assert.equal(result.db.Playlist[0].name,'Preserve');assert.equal(result.db.PlaylistEntry.length,1);
 }finally{await finish(instance)}
});

test('the original NetEase fallback retains provider headers through the signed runtime media URL',async()=>{
 let fallbacks=0;const gatewayUrl='http://127.0.0.1:49152/media/'+ 'a'.repeat(48);
 const instance=host({neteaseApi:{
  top_artists:async()=>({body:{code:200,artists:[]}}),
  song_url:async()=>({body:{code:200,data:[{url:null,freeTrialInfo:null,gain:0,peak:1}]}})
 },fallbackSongUrl:async id=>{assert.equal(id,'7');fallbacks++;return {code:200,url:gatewayUrl}}});
 try{
  await instance.manage({action:'enable',id:'netease'});
  const result=await instance.call('netease','songUrl',{id:'7'},true);
  assert.equal(result.data.url[0],'vutron://get-online-music/'+gatewayUrl);assert.equal(fallbacks,1);
  await assert.rejects(instance.call('netease','songUrl',{id:'7'},true,false));assert.equal(fallbacks,1,'The disabled fallback policy must not invoke the matcher');
 }finally{await finish(instance)}
});
