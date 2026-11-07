const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),vm=require('node:vm'),ts=require('typescript'),vue=require('vue')
const app=path.resolve(__dirname,'..'),runtime=path.resolve(app,'../../vendor/android-runtime/src/main/assets/sources-runtime')
const compile=file=>ts.transpileModule(fs.readFileSync(file,'utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022}}).outputText
const source=compile(path.join(app,'src/plugins/usePluginLikes.ts')),protocolModule={exports:{}}
vm.runInNewContext(compile(path.join(app,'src/plugins/protocol.ts')),{module:protocolModule,exports:protocolModule.exports,require:()=>{throw new Error('Unexpected protocol dependency')}})
const builtins=JSON.parse(fs.readFileSync(path.join(runtime,'plugins/builtin-index.json'),'utf8'))
const item=(id,sourceContext={id,opaque:{provider:'fixture',value:['preserve',id]}})=>({id,name:'Track '+String(id),sourceContext})
const liked=(sourceContext={id:'liked-opaque',private:{cursor:'keep'}},values={})=>({id:'liked-public',name:'Liked tracks',sourceContext,trackCount:0,...values})
const detail=(tracks=[],values={})=>({code:200,data:{id:'liked-detail',name:'Liked tracks',tracks,trackIds:[],trackCount:tracks.length,sourceContext:{},...values}})
const deferred=()=>{let resolve,reject;const promise=new Promise((yes,no)=>{resolve=yes;reject=no});return{promise,resolve,reject}}
const tick=()=>new Promise(resolve=>setImmediate(resolve))
const plain=value=>JSON.parse(JSON.stringify(value))
function fixture(handler,patch={}){
 const calls=[],clock={now:1000000},module={exports:{}},plugin={id:'fixture',name:'Fixture',type:'stream',enabled:true,builtIn:true,accountScope:'account-a',methods:['userPlaylist','getPlaylistDetail','getPlaylistTracks','likeATrack'],...patch}
 const api={async callMusicPlugin(query){calls.push(query);return handler(query,calls)}}
 class FixedDate extends Date{static now(){return clock.now}}
 vm.runInNewContext(source,{module,exports:module.exports,require:name=>name==='vue'?vue:name==='./protocol'?protocolModule.exports:name==='./bridge'?{musicPluginBridge:api}:(()=>{throw new Error('Unexpected dependency '+name)})(),Date:FixedDate,Error,console})
 return {api,plugin,calls,clock,likes:module.exports.createPluginLikes(api)}
}
const methods=f=>f.calls.map(call=>call.method)

test('concurrent row reads share one request, reactive state, and the five-minute cache',async()=>{
 const gate=deferred(),f=fixture(({method})=>method==='likelist'?gate.promise:assert.fail('Unexpected request'),{methods:['likelist','likeATrack']})
 const p1=f.likes.load(f.plugin),p2=f.likes.load(f.plugin),selected=vue.computed(()=>f.likes.state(f.plugin,item(17))),another=vue.computed(()=>f.likes.state(f.plugin,item('17')))
 await tick();assert.deepEqual(methods(f),['likelist']);assert.equal(f.likes.view(f.plugin).loading,true);assert.equal(selected.value,undefined)
 gate.resolve({code:200,data:[item(17)],sourceContext:{}});await Promise.all([p1,p2]);assert.equal(selected.value,true);assert.equal(another.value,true);assert.equal(f.likes.state(f.plugin,item(18)),false)
 await f.likes.load(f.plugin);assert.equal(f.calls.length,1)
 f.clock.now+=5*60_000+1;await f.likes.load(f.plugin);assert.equal(f.calls.length,2)
})

test('the seven bundled sources use their declared liked collection without calling placeholder likelist',async t=>{
 for(const manifest of builtins)await t.test(manifest.id,async()=>{
  const summary=liked(),f=fixture(({method})=>method==='userPlaylist'?{code:200,liked:summary,playlists:[{id:'unrelated'}],albums:[],sourceContext:{}}:method==='getPlaylistDetail'?detail([item(17)]):assert.fail('Unexpected request '+method),{...manifest,accountScope:'bundled-account'})
  await f.likes.load(f.plugin)
  if(manifest.id==='demo'){assert.deepEqual(methods(f),[]);assert.equal(f.likes.state(f.plugin,item(17)),undefined);assert.equal(f.likes.view(f.plugin).status,'unsupported')}
  else{assert.deepEqual(methods(f),['userPlaylist','getPlaylistDetail']);assert.equal(f.likes.state(f.plugin,item(17)),true);assert.equal(f.likes.state(f.plugin,item(18)),false)}
 })
})

test('NetEase complete public trackIds establish membership without downloading song details',async()=>{
 const summary=liked(),ids=Array.from({length:6000},(_,i)=>i+1)
 const f=fixture(({method})=>method==='userPlaylist'?{code:200,liked:summary}:method==='getPlaylistDetail'?detail([],{trackIds:ids,trackCount:6000}):assert.fail('No song-detail request is needed'),{id:'netease',baseId:'netease'})
 await f.likes.load(f.plugin);assert.equal(f.likes.state(f.plugin,item('6000')),true);assert.equal(f.likes.state(f.plugin,item(6001)),false);assert.deepEqual(methods(f),['userPlaylist','getPlaylistDetail']);assert.equal(f.likes.view(f.plugin).status,'ready')
})

test('synthetic favourite summaries with zero count still read detail and keep the string context ID',async t=>{
 for(const id of ['navidrome','emby','jellyfin'])await t.test(id,async()=>{
  const ctx={id:'-1',opaque:{doNotCoerce:true}},summary=liked(ctx,{id:-1,trackCount:0})
  const f=fixture(({method,params})=>{
   if(method==='userPlaylist')return{code:200,liked:summary}
   if(method==='getPlaylistDetail'){assert.equal(params.id,'-1');assert.equal(params.sourceContext,ctx);return detail([item('server-song')],{trackCount:1})}
   assert.fail('Synthetic favourites must not use ParentId/ordinary playlist requests')
  },{id,baseId:id})
  await f.likes.load(f.plugin);assert.equal(f.likes.state(f.plugin,item('server-song')),true);assert.deepEqual(methods(f),['userPlaylist','getPlaylistDetail'])
 })
})

test('failed or absent liked collection remains unknown instead of guessing from arbitrary playlists',async()=>{
 const f=fixture(()=>({code:200,liked:null,playlists:[liked({}, {id:'random',name:'Liked songs'})],albums:[],sourceContext:{}}))
 await f.likes.load(f.plugin);assert.equal(f.likes.state(f.plugin,item(17)),undefined);assert.equal(f.likes.view(f.plugin).status,'unsupported');assert.deepEqual(methods(f),['userPlaylist'])
 const missing=fixture(()=>({code:404}),{methods:['userPlaylist']});await missing.likes.load(missing.plugin);assert.equal(missing.likes.state(missing.plugin,item(17)),undefined)
})

test('likelist fallback preserves Track objects and never guesses IDs from an incompatible scalar list',async()=>{
 const f=fixture(()=>({code:200,data:[17,'18'],sourceContext:{}}),{methods:['likelist']});await f.likes.load(f.plugin)
 assert.equal(f.likes.state(f.plugin,item(17)),undefined);assert.equal(f.likes.state(f.plugin,item(18)),undefined);assert.equal(f.likes.view(f.plugin).status,'partial')
 const fallback=fixture(({method})=>method==='likelist'?{code:404,data:[],sourceContext:{}}:method==='userPlaylist'?{code:200,liked:liked()}:detail([item(17)]),{methods:['likelist','userPlaylist','getPlaylistDetail']})
 await fallback.likes.load(fallback.plugin);assert.equal(fallback.likes.state(fallback.plugin,item(17)),true);assert.deepEqual(methods(fallback),['likelist','userPlaylist','getPlaylistDetail'])
})

test('partial detail and malformed public IDs never turn an unobserved song into unliked',async()=>{
 const f=fixture(({method})=>method==='userPlaylist'?{code:200,liked:liked()}:detail([item(17),item('')],{trackCount:1}))
 await f.likes.load(f.plugin);assert.equal(f.likes.state(f.plugin,item(17)),true);assert.equal(f.likes.state(f.plugin,item(18)),undefined);assert.equal(f.likes.view(f.plugin).status,'partial')
 for(const id of ['', '   ', undefined, null, {}, NaN, Number.MAX_SAFE_INTEGER+1])assert.equal(f.likes.state(f.plugin,item(id)),undefined)
 const partial=fixture(({method})=>method==='userPlaylist'?{code:200,liked:liked()}:detail([item(17)],{trackCount:20}));await partial.likes.load(partial.plugin)
 assert.equal(partial.likes.state(partial.plugin,item(17)),true);assert.equal(partial.likes.state(partial.plugin,item(18)),undefined)
})

test('Kugou pages only the explicit favourite collection and removes with its complete original member context',async()=>{
 const summaryContext={id:'collection-id',listid:'list-123',gid:'opaque-gid'},summary=liked(summaryContext),cursor1={id:'detail-id',page:1,listid:'list-123',opaque:{position:['a']}},cursor2={id:'detail-id',page:2,listid:'list-123',opaque:{position:['b']}},member=item(17,{id:'provider-id',hash:'member-hash',name:'member-name',fileid:'membership-fileid',opaque:{keep:[1,{value:'secret'}]}})
 const f=fixture(({method,params})=>{
  if(method==='userPlaylist')return{code:200,liked:summary}
  if(method==='getPlaylistDetail')return detail([],{trackCount:2,sourceContext:cursor1})
  if(method==='getPlaylistTracks'){assert.equal(params.sourceContext,params.page===1?cursor1:cursor2);assert.equal(params.listid,'list-123');return params.page===1?{code:200,data:[member],sourceContext:cursor2}:{code:200,data:[item(18)],sourceContext:{...cursor2,page:3}}}
  if(method==='likeATrack'){assert.equal(params.playlist,summaryContext);assert.equal(params.tracks[0],member.sourceContext);assert.equal(params.op,'del');return{code:200}}
  assert.fail('Unexpected request '+method)
 },{id:'kugou:other-account',baseId:'kugou'})
 await f.likes.load(f.plugin);assert.equal(f.likes.state(f.plugin,item(17)),true);assert.equal(f.likes.state(f.plugin,item(19)),false)
 const before=plain(member.sourceContext),row=vue.computed(()=>f.likes.state(f.plugin,item('17')))
 assert.equal(await f.likes.setLiked(f.plugin,item(17,{id:'search-id',hash:'different-search-hash'}),false),true);assert.equal(row.value,false);assert.deepEqual(plain(member.sourceContext),before)
 assert.deepEqual(methods(f),['userPlaylist','getPlaylistDetail','getPlaylistTracks','getPlaylistTracks','likeATrack'])
})

test('Kugou caps automatic favourite pages and refuses removal without a confirmed membership context',async()=>{
 let page=0
 const f=fixture(({method})=>method==='userPlaylist'?{code:200,liked:liked({id:'fav',listid:'list'})}:method==='getPlaylistDetail'?detail([],{trackCount:100,sourceContext:{id:'fav',page:1,listid:'list'}}):method==='getPlaylistTracks'?{code:200,data:[item(++page)],sourceContext:{id:'fav',page:page+1,listid:'list'}}:assert.fail('Do not invent a removal context'),{id:'kugou',baseId:'kugou'})
 await f.likes.load(f.plugin);assert.equal(f.calls.filter(c=>c.method==='getPlaylistTracks').length,4);assert.equal(f.likes.state(f.plugin,item(1)),true);assert.equal(f.likes.state(f.plugin,item(99)),undefined)
 await assert.rejects(()=>f.likes.setLiked(f.plugin,item(99,{hash:'search-hash'}),false),/MEMBER_CONTEXT_REQUIRED/)
 assert.equal(f.calls.filter(c=>c.method==='getPlaylistTracks').length,8);assert.equal(f.calls.filter(c=>c.method==='likeATrack').length,0);assert.equal(f.likes.state(f.plugin,item(99)),undefined)
})

test('a confirmed Kugou add is shared but later removal first retrieves the new membership context',async()=>{
 const input=item(17,{id:'17',hash:'search-hash',name:'Original name',opaque:{nested:['untouched']}}),member=item(17,{id:'17',hash:'same-track',fileid:'newly-assigned-fileid',opaque:{membership:'exact'}}),summary=liked({id:'fav',listid:'liked-list'});let added=false
 const f=fixture(({method,params})=>{
  if(method==='userPlaylist')return{code:200,liked:summary}
  if(method==='getPlaylistDetail')return detail([],{trackCount:added?1:0,sourceContext:{id:'fav',page:1,listid:'liked-list'}})
  if(method==='getPlaylistTracks')return{code:200,data:[member],sourceContext:{id:'fav',page:2,listid:'liked-list'}}
  if(method==='likeATrack'){assert.equal(params.tracks[0],params.op==='add'?input.sourceContext:member.sourceContext);added=params.op==='add';return{code:200}}
  assert.fail(method)
 },{id:'kugou',baseId:'kugou'})
 await f.likes.load(f.plugin);assert.equal(f.likes.state(f.plugin,input),false)
 await f.likes.setLiked(f.plugin,input,true);assert.equal(f.likes.state(f.plugin,item('17')),true)
 await f.likes.setLiked(f.plugin,input,false);assert.equal(f.likes.state(f.plugin,input),false)
 assert.equal(f.calls.filter(c=>c.method==='getPlaylistTracks').length,1)
})

test('401 refreshes and failed mutations preserve confirmed state instead of clearing a shared row',async()=>{
 let mode='ok';const f=fixture(({method})=>{
  if(mode==='401')return{code:401,message:'Session expired'}
  if(method==='userPlaylist')return{code:200,liked:liked()}
  if(method==='getPlaylistDetail')return detail([item(17)])
  if(method==='likeATrack')return{code:500,message:'Mutation failed'}
 })
 await f.likes.load(f.plugin);mode='401';await f.likes.load(f.plugin,()=>true,true)
 assert.equal(f.likes.view(f.plugin).status,'error');assert.equal(f.likes.state(f.plugin,item(17)),true);assert.equal(f.likes.state(f.plugin,item(18)),false)
 mode='ok';await assert.rejects(()=>f.likes.setLiked(f.plugin,item(17),false),/Mutation failed/);assert.equal(f.likes.state(f.plugin,item(17)),true);assert.equal(f.likes.view(f.plugin).saving,false)
 const fresh=fixture(()=>({code:401,message:'No session'}));await fresh.likes.load(fresh.plugin);assert.equal(fresh.likes.state(fresh.plugin,item(17)),undefined)
})

test('old account responses cannot populate a replacement account or reactivate it through state()',async()=>{
 const old=deferred(),f=fixture(({accountScope,method})=>accountScope==='account-a'?old.promise:method==='userPlaylist'?{code:200,liked:liked()}:detail([item(18)]))
 const oldRead=f.likes.load(f.plugin);await tick();const next={...f.plugin,accountScope:'account-b'};await f.likes.load(next)
 old.resolve({code:200,liked:liked()});await oldRead
 assert.equal(f.likes.state(next,item(18)),true);assert.equal(f.likes.state(next,item(17)),false);assert.equal(f.likes.state(f.plugin,item(18)),undefined)
 const count=f.calls.length;await f.likes.load(next);assert.equal(f.calls.length,count,'Reading an old row must not switch the active account back')
 assert.equal(f.calls.filter(c=>c.accountScope==='account-a'&&c.method==='getPlaylistDetail').length,0)
})

test('a read started before a successful write cannot overwrite its confirmed result',async()=>{
 const oldDetail=deferred(),summary=liked(),f=fixture(({method})=>method==='userPlaylist'?{code:200,liked:summary}:method==='getPlaylistDetail'?oldDetail.promise:method==='likeATrack'?{code:200}:assert.fail(method))
 const read=f.likes.load(f.plugin);await tick();assert.deepEqual(methods(f),['userPlaylist','getPlaylistDetail'])
 await f.likes.setLiked(f.plugin,item(17),true);oldDetail.resolve(detail([]));await read
 assert.equal(f.likes.state(f.plugin,item(17)),true);assert.equal(f.likes.view(f.plugin).loading,false)
})

test('in-flight writes are single-flight and cannot update a newly switched account',async()=>{
 const gate=deferred(),f=fixture(({method})=>method==='userPlaylist'?{code:200,liked:liked()}:method==='likeATrack'?gate.promise:detail([]))
 const write=f.likes.setLiked(f.plugin,item(17),true);await tick();assert.equal(f.likes.view(f.plugin).saving,true)
 assert.equal(await f.likes.setLiked(f.plugin,item(18),true),false);assert.equal(f.calls.filter(c=>c.method==='likeATrack').length,1)
 const next={...f.plugin,accountScope:'account-b'};await f.likes.load(next);gate.resolve({code:200});assert.equal(await write,false)
 assert.equal(f.likes.state(next,item(17)),false);assert.equal(f.likes.state(f.plugin,item(17)),undefined);assert.equal(f.likes.view(next).saving,false)
})

test('offline and disabled sources issue no requests; an offline transition drops late reads',async()=>{
 const f=fixture(()=>assert.fail('Offline state must not request'))
 await f.likes.load(f.plugin,()=>false);await f.likes.load({...f.plugin,enabled:false});assert.equal(f.calls.length,0)
 await assert.rejects(()=>f.likes.setLiked(f.plugin,item(17),true,()=>false),/UNAVAILABLE/);assert.equal(f.calls.length,0)
 const gate=deferred(),late=fixture(()=>gate.promise);let allowed=true
 const read=late.likes.load(late.plugin,()=>allowed);await tick();allowed=false;gate.resolve({code:200,liked:liked()});await read
 assert.equal(late.calls.length,1);assert.equal(late.likes.state(late.plugin,item(17)),undefined);assert.equal(late.likes.view(late.plugin).loading,false)
})
