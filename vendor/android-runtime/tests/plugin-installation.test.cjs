'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),os=require('node:os');
const runtime=path.resolve(__dirname,'../src/main/assets/sources-runtime'),{createPluginHost}=require(path.join(runtime,'plugin-host.cjs')),contract=require(path.join(runtime,'plugin-contract.cjs')),builtins=require(path.join(runtime,'plugins/builtin-index.json'));
const tempRoot=os.tmpdir(),builtinIds=builtins.map(row=>row.id).sort(),ids=value=>value.plugins.map(row=>row.id).sort(),row=(host,id)=>host.list().plugins.find(value=>value.id===id),statePath=(root,id)=>path.join(root,id+'.state.json');
const account=()=>({store:{baseUrl:'http://synthetic.invalid/library'},db:{PluginData:{userId:'fixture-user',userName:'Listener',pwd:'fixture-password',token:'fixture-token'},Track:[{id:'1',liked:1}],Playlist:[{id:'p',name:'Kept playlist'}],PlaylistEntry:[]},accountGeneration:8});
const writeState=(root,id,value)=>fs.writeFileSync(statePath(root,id),JSON.stringify(value,null,2));
function setup(t,seed,options={}){
 const directory=fs.mkdtempSync(path.join(tempRoot,'vutron-plugin-installation-')),root=path.join(directory,'music-plugins-v1'),previousTmp=process.env.TMPDIR;fs.mkdirSync(root);seed?.(root,directory);
 const open=()=>createPluginHost({root,builtins:path.join(runtime,'plugins'),workerFile:path.join(runtime,'plugin-worker.cjs'),validateMeta:contract.validateMeta,validateResult:contract.validateResult,...options});let host=open();
 t.after(async()=>{host.close();await new Promise(resolve=>setTimeout(resolve,100));if(previousTmp===undefined)delete process.env.TMPDIR;else process.env.TMPDIR=previousTmp;fs.rmSync(directory,{recursive:true,force:true})});
 return {directory,root,current:()=>host,restart:()=>{host.close();host=open();return host}};
}

test('fresh format3 provides seven closed sources without running code or initializing accounts',async t=>{
 let requests=0;const f=setup(t,undefined,{workerFile:path.join(tempRoot,'must-not-start-a-worker.js'),neteaseApi:new Proxy({},{get(){requests++;throw new Error('No API should initialize')}})}),host=f.current();
 assert.deepEqual(ids(host.list()),builtinIds);assert.equal(host.list().format,3);assert.ok(host.list().plugins.every(value=>value.enabled===false&&value.status==='logout'));
 assert.ok(host.list().catalog.every(value=>value.installed===true&&!('accountScope'in value)&&!('baseUrl'in value)));
 for(const id of builtinIds){await host.manage({action:'install',id});await host.manage({action:'enable',id});assert.equal(row(host,id).enabled,true);await host.manage({action:'disable',id})}
 assert.equal(requests,0);assert.deepEqual(fs.readdirSync(f.root).filter(name=>name.endsWith('.state.json')),[]);assert.equal(JSON.parse(fs.readFileSync(path.join(f.root,'registry.json'))).format,3);
});

test('closed defaults reject invocation, local index synchronization and resource writes before workers start',async t=>{
 const f=setup(t,undefined,{workerFile:path.join(tempRoot,'must-not-start-a-worker.js')}),host=f.current();
 await assert.rejects(host.call('emby','getAccount',{},false),{code:'PLUGIN_DISABLED'});
 for(const request of [{action:'syncLocalLibrary',id:'local',tables:{Track:[]}},{action:'resources',id:'local',resources:{}}])await assert.rejects(host.manage(request),{code:'PLUGIN_DISABLED'});
 await host.manage({action:'configure',id:'emby',baseUrl:'http://synthetic.invalid'});assert.equal(row(host,'emby').enabled,false);assert.equal(row(host,'emby').baseUrl,'http://synthetic.invalid');
 await host.manage({action:'enable',id:'emby'});await assert.rejects(host.manage({action:'syncLocalLibrary',id:'emby',tables:{Track:[]}}),{code:'PLUGIN_NOT_LOCAL'});
 assert.equal(fs.existsSync(statePath(f.root,'local')),false);
});

for(const format of [1,2])test('format'+format+' preserves registered accounts, flags, instances and imported code while missing defaults stay closed',t=>{
 const bytes=Buffer.from(JSON.stringify(account(),null,2)),f=setup(t,root=>{
  const netease=builtins.find(value=>value.id==='netease'),emby=builtins.find(value=>value.id==='emby');
  const plugins={netease:{...netease,enabled:false,status:'login',name:'Original account',createdAt:17},'emby:home':{...emby,id:'emby:home',baseId:'emby',builtIn:false,enabled:true,status:'login'},user_saved:{id:'user_saved',baseId:'user_saved',builtIn:false,type:'stream',name:'Imported',methods:['getAccount'],enabled:true}};
  fs.writeFileSync(path.join(root,'registry.json'),JSON.stringify({format,plugins}));for(const id of Object.keys(plugins))writeState(root,id,account());fs.writeFileSync(path.join(root,'user_saved.js'),'exports.meta={name:"Imported",type:"stream"};');
 });
 assert.deepEqual(ids(f.current().list()),[...builtinIds,'emby:home','user_saved'].sort());assert.equal(row(f.current(),'netease').enabled,false);assert.equal(row(f.current(),'netease').name,'Original account');assert.equal(row(f.current(),'netease').status,'login');assert.equal(row(f.current(),'emby').enabled,false);assert.equal(row(f.current(),'emby:home').enabled,true);
 for(const id of ['netease','emby:home','user_saved'])assert.deepEqual(fs.readFileSync(statePath(f.root,id)),bytes);
 assert.equal(fs.readFileSync(path.join(f.root,'user_saved.js'),'utf8'),'exports.meta={name:"Imported",type:"stream"};');assert.deepEqual(ids(f.restart().list()),[...builtinIds,'emby:home','user_saved'].sort());
});

for(const format of [1,2,3])test('format'+format+' never reuses an unregistered old account and preserves its unique isolated bytes',t=>{
 const bytes=Buffer.from(JSON.stringify(account(),null,2)),f=setup(t,root=>{fs.writeFileSync(path.join(root,'registry.json'),JSON.stringify({format,plugins:{}}));writeState(root,'navidrome',account());fs.mkdirSync(path.join(root,'inactive-orphans'));fs.writeFileSync(path.join(root,'inactive-orphans/navidrome.saved.state.json'),'older-unique-copy')});
 assert.equal(row(f.current(),'navidrome').enabled,false);assert.equal(row(f.current(),'navidrome').baseUrl,'');assert.equal(fs.existsSync(statePath(f.root,'navidrome')),false);
 const isolated=path.join(f.root,'inactive-orphans'),files=fs.readdirSync(isolated);assert.equal(files.length,2);assert.ok(files.some(name=>fs.readFileSync(path.join(isolated,name)).equals(bytes)));assert.equal(fs.readFileSync(path.join(isolated,'navidrome.saved.state.json'),'utf8'),'older-unique-copy');
 f.restart();assert.equal(fs.readdirSync(isolated).length,2);assert.equal(row(f.current(),'navidrome').baseUrl,'');
});

test('legacy install cannot enable a source or overwrite its preserved account',async t=>{
 const f=setup(t),host=f.current();writeState(f.root,'netease',account());const before=fs.readFileSync(statePath(f.root,'netease'));
 await host.manage({action:'install',id:'netease'});assert.equal(row(host,'netease').enabled,false);await host.manage({action:'enable',id:'netease'});await host.manage({action:'install',id:'netease'});assert.equal(row(host,'netease').enabled,true);assert.deepEqual(fs.readFileSync(statePath(f.root,'netease')),before);
 await assert.rejects(host.manage({action:'install',id:'unknown-plugin'}),{code:'PLUGIN_CATALOG'});
});

test('old builtin remove is rejected and explicit reset only closes and clears the selected default source',async t=>{
 const f=setup(t,(root,directory)=>{for(const name of ['native-session','native-local-grants','shared-cache.audio','original.flac'])fs.writeFileSync(path.join(directory,name),name)}),host=f.current();
 await host.manage({action:'enable',id:'emby'});writeState(f.root,'emby',account());const instance=(await host.manage({action:'instance',id:'emby',name:'Other account'})).plugin.id;writeState(f.root,instance,account());
 const instanceBytes=fs.readFileSync(statePath(f.root,instance));assert.equal((await host.call('emby','getAccount',{},false)).userName,'Listener');assert.equal((await host.call(instance,'getAccount',{},false)).userName,'Listener');
 await assert.rejects(host.manage({action:'remove',id:'emby'}),{code:'PLUGIN_BUILTIN_PROVIDED'});assert.equal(fs.existsSync(statePath(f.root,'emby')),true);
 await host.manage({action:'reset',id:'emby'});assert.equal(row(host,'emby').enabled,false);assert.equal(row(host,'emby').status,'logout');assert.equal(fs.existsSync(statePath(f.root,'emby')),false);assert.equal(row(host,instance).enabled,true);assert.deepEqual(fs.readFileSync(statePath(f.root,instance)),instanceBytes);assert.equal((await host.call(instance,'getAccount',{},false)).userName,'Listener');
 await host.manage({action:'enable',id:'emby'});assert.equal((await host.call('emby','getAccount',{},false)).userName,'','Reset must stop the old worker as well as clear persisted credentials');
 for(const name of ['native-session','native-local-grants','shared-cache.audio','original.flac'])assert.equal(fs.readFileSync(path.join(f.directory,name),'utf8'),name);
 await host.manage({action:'remove',id:instance});assert.equal(fs.existsSync(statePath(f.root,instance)),false);assert.equal(row(host,instance),undefined);assert.deepEqual(ids(f.restart().list()),builtinIds);
});

test('failed reset commit restores the original state and enabled registry entry',async t=>{
 const f=setup(t),host=f.current();await host.manage({action:'enable',id:'emby'});writeState(f.root,'emby',account());const before=fs.readFileSync(statePath(f.root,'emby')),rename=fs.renameSync;
 fs.renameSync=function(from,to,...rest){if(path.resolve(to)===path.resolve(path.join(f.root,'registry.json')))throw Object.assign(new Error('Synthetic registry failure'),{code:'ENOSPC'});return rename.call(this,from,to,...rest)};
 try{await assert.rejects(host.manage({action:'reset',id:'emby'}))}finally{fs.renameSync=rename}
 assert.equal(row(host,'emby').enabled,true);assert.deepEqual(fs.readFileSync(statePath(f.root,'emby')),before);assert.equal(row(f.restart(),'emby').enabled,true);
});

test('credential deletion failure preserves an enabled provided source and its exact account',async t=>{
 const f=setup(t),host=f.current();await host.manage({action:'enable',id:'emby'});writeState(f.root,'emby',account());const before=fs.readFileSync(statePath(f.root,'emby')),unlink=fs.unlinkSync;
 fs.unlinkSync=function(file,...rest){if(path.resolve(file)===path.resolve(statePath(f.root,'emby')))throw Object.assign(new Error('Synthetic credential failure'),{code:'EACCES'});return unlink.call(this,file,...rest)};
 try{await assert.rejects(host.manage({action:'reset',id:'emby'}))}finally{fs.unlinkSync=unlink}
 assert.equal(row(host,'emby').enabled,true);assert.deepEqual(fs.readFileSync(statePath(f.root,'emby')),before);
});

test('a failed enable or disable commit cannot publish an in-memory-only switch state',async t=>{
 const f=setup(t),host=f.current(),rename=fs.renameSync;
 for(const action of ['enable','disable']){
  if(action==='disable')await host.manage({action:'enable',id:'emby'});
  const before=row(host,'emby').enabled;
  fs.renameSync=function(from,to,...rest){if(path.resolve(to)===path.resolve(path.join(f.root,'registry.json')))throw Object.assign(new Error('Synthetic registry failure'),{code:'ENOSPC'});return rename.call(this,from,to,...rest)};
  try{await assert.rejects(host.manage({action,id:'emby'}))}finally{fs.renameSync=rename}
  assert.equal(row(host,'emby').enabled,before);assert.equal(JSON.parse(fs.readFileSync(path.join(f.root,'registry.json'))).plugins.emby.enabled,before);
 }
});
