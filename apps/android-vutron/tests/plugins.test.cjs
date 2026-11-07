const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),vm=require('node:vm'),ts=require('typescript'),vue=require('vue')
function read(relative,deps={}){const filename=path.join(__dirname,'../src/plugins',relative),module={exports:{}};vm.runInNewContext(ts.transpileModule(fs.readFileSync(filename,'utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022}}).outputText,{module,exports:module.exports,require:name=>name==='vue'?vue:deps[name],window:{scrollY:0,scrollTo(){}},requestAnimationFrame:fn=>fn(),console,Error});return module.exports}
const protocol=read('protocol.ts')
const navigation=read('navigation.ts')
const item=(id=1)=>({id,name:'Track '+id,sourceContext:{private:{token:'opaque-'+id}}})
function fixture(overrides={}){const calls=[],plugin={id:'a',enabled:true,type:'stream',methods:['getAllTracks','search','userPlaylist','getPlaylistDetail','getPlaylistTracks','likeATrack'],name:'A'},id=vue.ref('a'),offline=vue.ref(false),bridge={listMusicPlugins:async()=>({plugins:[plugin,{...plugin,id:'b'}]}),callMusicPlugin:async query=>{calls.push(query);return{code:200,data:[item()],sourceContext:{next:'opaque'}}},...overrides},scope=vue.effectScope(),factory=read('usePluginLibrary.ts',{'./bridge':{musicPluginBridge:bridge},'./protocol':protocol}).usePluginLibrary;const api=scope.run(()=>factory(id,offline,bridge));return{scope,api,id,offline,calls,bridge,plugin,factory}}
const tick=()=>new Promise(resolve=>setImmediate(resolve))
test('local source stays usable without displaying an account login status',async()=>{
 const s=fixture();s.plugin.type='local';s.plugin.methods.push('systemPing');s.offline.value=true
 s.bridge.callMusicPlugin=async query=>{s.calls.push(query);return query.method==='systemPing'?{code:200,status:'logout'}:{code:200,data:[item()],sourceContext:{hasMore:false}}}
 await s.api.initialize();assert.equal(s.api.status.value,'');assert.equal(s.api.rows.value.length,1);assert.equal(s.api.allowed.value,true);s.scope.stop()
})
test('plugin context stays opaque and public mutation contracts match the original methods',()=>{
 const context={secret:{nested:['a']},cursor:'opaque'},track={id:'1',name:'T',sourceContext:context}
 const request=protocol.pluginParams(context,{reset:false});assert.equal(request.sourceContext,context);assert.equal(request.secret,context.secret)
 assert.equal(protocol.pluginSubscriptionParams('followArtist',track,false).op,'follow')
 assert.equal(protocol.pluginSubscriptionParams('followArtist',track,true).op,'unfollow')
 assert.equal(protocol.pluginSubscriptionParams('likeAMV',track,false).t,1)
 assert.equal(protocol.pluginSubscriptionParams('subAMV',track,true).t,0)
 assert.equal(protocol.pluginSubscriptionParams('subscribePlaylist',track,true).op,'del')
 assert.deepEqual(context,{secret:{nested:['a']},cursor:'opaque'})
})
test('mixed provider identities remain distinct and declared unconditional stubs do not become UI capabilities',()=>{
 const a={...item(1),pluginId:'a'},b={...item(1),pluginId:'b'},merged=protocol.mergePluginItems([a],[b,a]);assert.equal(merged.length,2);assert.notEqual(protocol.pluginItemKey(a),protocol.pluginItemKey(b))
 const plugin={enabled:true,methods:['editPlaylist','getComments'],unsupportedMethods:['editPlaylist'],capabilities:{getComments:true}}
 assert.equal(protocol.hasPluginMethod(plugin,'editPlaylist'),false);assert.equal(protocol.hasPluginMethod(plugin,'getComments'),true);assert.equal(protocol.allowsPluginComments(plugin,'track'),true)
})
test('cross source entity navigation keeps opaque context and is consumed only once by its owning source',()=>{
 const entity={...item('album-a'),pluginId:'b'};navigation.requestPluginNavigation({pluginId:'b',kind:'albums',item:entity});assert.equal(navigation.consumePluginNavigation('a'),undefined)
 const pending=navigation.consumePluginNavigation('b');assert.equal(pending.kind,'albums');assert.equal(pending.item.sourceContext,entity.sourceContext);assert.equal(navigation.consumePluginNavigation('b'),undefined)
})
test('independent plugins can browse without any native NetEase profile; explicit offline blocks network calls',async()=>{
 const s=fixture();await s.api.initialize();assert.equal(s.api.rows.value.length,1);s.offline.value=true
 await s.api.list('search','tracks',{keywords:'a'});assert.equal(s.calls.length,1);await assert.rejects(()=>s.api.call('search'),/OFFLINE/);s.scope.stop()
})
test('search pagination preserves the submitted tab and keywords while returning opaque context unchanged',async()=>{
 const s=fixture();await s.api.refreshPlugins();await s.api.list('search','tracks',{tab:'tracks',keywords:'Alpha',reset:true});await s.api.list('search','tracks',{},true)
 const second=s.calls[1].params;assert.equal(second.tab,'tracks');assert.equal(second.keywords,'Alpha');assert.equal(second.reset,false);assert.equal(second.sourceContext.next,'opaque');s.scope.stop()
})
test('failed writes keep old rows and navigation history without retrying mutations',async()=>{
 const s=fixture();await s.api.refreshPlugins();await s.api.list('getAllTracks','tracks',{},false,false);const before=s.api.rows.value
 s.bridge.callMusicPlugin=async()=>{throw new Error('write failed')};assert.equal(await s.api.mutate('likeATrack',{tracks:[item()]}),false);assert.equal(s.api.rows.value,before);assert.equal(s.api.history.value.length,0);assert.equal(s.api.error.value,'write failed');s.scope.stop()
})
test('a response from the previous source cannot replace the selected source',async()=>{
 let resolve;const pending=new Promise(r=>resolve=r),s=fixture({callMusicPlugin:()=>pending});await s.api.refreshPlugins();const request=s.api.list('search','tracks',{keywords:'a'});s.id.value='b';resolve({code:200,data:[item(9)]});await request;assert.equal(s.api.rows.value.length,0);s.scope.stop()
})
test('saved albums and weekly play history use their original response fields',async()=>{
 const s=fixture({callMusicPlugin:async({method})=>method==='userPlaylist'?{code:200,albums:[item('album')],playlists:[item('playlist')],liked:null}:{code:200,allData:[item('all')],weekData:[item('week')]}});await s.api.refreshPlugins();await s.api.list('userPlaylist','albums');assert.equal(s.api.rows.value[0].id,'album');await s.api.list('userRecord','tracks',{period:'week'});assert.equal(s.api.rows.value[0].id,'week');s.scope.stop()
})
test('returning from the player restores source page, submitted query and back history, but account changes discard them',async()=>{
 const s=fixture();s.plugin.accountScope='scope-a';await s.api.initialize();await s.api.list('search','tracks',{keywords:'submitted',tab:'tracks',reset:true});s.api.viewState.value={keywords:'draft',searchTab:'tracks',visibleCount:160}
 const calls=s.calls.length;s.scope.stop();const scope=vue.effectScope(),restored=scope.run(()=>s.factory(s.id,s.offline,s.bridge));await restored.initialize(true)
 assert.equal(restored.restored.value,true);assert.equal(restored.method.value,'search');assert.equal(restored.requestParams.value.keywords,'submitted');assert.equal(restored.viewState.value.keywords,'draft');assert.equal(restored.history.value.length,1);assert.equal(s.calls.length,calls,'Restoring does not restart source requests or polling');assert.equal(restored.back(),true);assert.equal(restored.method.value,'getAllTracks');scope.stop()
 s.plugin.accountScope='scope-b';const nextScope=vue.effectScope(),next=nextScope.run(()=>s.factory(s.id,s.offline,s.bridge));await next.initialize(true);assert.equal(next.restored.value,false);assert.equal(next.method.value,'getAllTracks');assert.equal(next.viewState.value.keywords,undefined);nextScope.stop()
})
test('source page snapshots evict the least recently used instance beyond six entries',async()=>{
 const s=fixture(),plugins=Array.from({length:7},(_,index)=>({...s.plugin,id:'source-'+index,accountScope:'account-'+index}));s.bridge.listMusicPlugins=async()=>({plugins})
 for(let index=0;index<7;index++){s.id.value='source-'+index;await s.api.initialize(true);await s.api.list('search','tracks',{keywords:'page-'+index},false,false)}s.scope.stop()
 const scope=vue.effectScope(),api=scope.run(()=>s.factory(s.id,s.offline,s.bridge));s.id.value='source-0';await api.initialize(true);assert.equal(api.restored.value,false);s.id.value='source-6';await api.initialize(true);assert.equal(api.restored.value,true);assert.equal(api.requestParams.value.keywords,'page-6');scope.stop()
})
test('plugin UI dictionaries cover exactly the same keys in all three languages',()=>{
 const values=['zh-hans','zh-hant','en'].map(name=>JSON.parse(fs.readFileSync(path.join(__dirname,'../src/plugins/locales',name+'.json'),'utf8')))
 assert.deepEqual(Object.keys(values[0]).sort(),Object.keys(values[1]).sort());assert.deepEqual(Object.keys(values[0]).sort(),Object.keys(values[2]).sort());assert.ok(Object.keys(values[0]).length>100)
 for(const dictionary of values)for(const value of Object.values(dictionary))assert.equal(/\?{3,}|\uFFFD/.test(value),false,'Dictionary values retain their source encoding')
})
test('integrated home/library/search keep separate ephemeral snapshots across component remounts',async()=>{
 const s=fixture();s.plugin.accountScope='integrated-account';s.plugin.methods.push('getRecommendPlaylist','getPlaylistDetail')
 s.bridge.callMusicPlugin=async query=>{s.calls.push(query);return query.method==='getPlaylistDetail'?{code:200,data:{id:'playlist',name:'Detail',tracks:[item('song')],trackCount:1,sourceContext:{page:'detail'}}}:{code:200,data:[item(query.method)],playlists:[item('playlist')],count:4,sourceContext:{next:'opaque'}}}
 const key=vue.ref('integrated:home'),scope=vue.effectScope(),api=scope.run(()=>s.factory(s.id,s.offline,s.bridge,key))
 await api.initialize(true,false);assert.equal(s.calls.length,0);await api.list('getRecommendPlaylist','playlists',{},false,false);api.viewState.value={selectedFeature:'getRecommendPlaylist'}
 key.value='integrated:library';await api.initialize(true,false);assert.equal(api.rows.value.length,0);await api.list('userPlaylist','playlists',{},false,false);await api.open(item('playlist'),'playlists');api.viewState.value={currentKind:'playlists'}
 const before=s.calls.length;scope.stop();const returnedScope=vue.effectScope(),returned=returnedScope.run(()=>s.factory(s.id,s.offline,s.bridge,key));await returned.initialize(true,false)
 assert.equal(returned.restored.value,true);assert.equal(returned.detail.value.id,'playlist');assert.equal(returned.history.value.length,1);assert.equal(s.calls.length,before,'Returning from player/settings does not fetch or reset the detail')
 assert.equal(returned.backToRoot(),true);assert.equal(returned.method.value,'userPlaylist');assert.equal(returned.detail.value,undefined);assert.equal(returned.history.value.length,0)
 key.value='integrated:search';await returned.initialize(true,false);assert.equal(returned.method.value,'');assert.equal(returned.rows.value.length,0);assert.equal(returned.count.value,0);assert.equal(returned.more.value,false);returned.viewState.value={keywords:'unsubmitted draft'};returnedScope.stop()
 const draftScope=vue.effectScope(),draft=draftScope.run(()=>s.factory(s.id,s.offline,s.bridge,key));await draft.initialize(true,false);assert.equal(draft.restored.value,true);assert.equal(draft.viewState.value.keywords,'unsubmitted draft');assert.equal(s.calls.length,before)
 key.value='integrated:home';await draft.initialize(true,false);assert.equal(draft.method.value,'getRecommendPlaylist');assert.equal(draft.detail.value,undefined);assert.equal(draft.viewState.value.selectedFeature,'getRecommendPlaylist')
 s.plugin.accountScope='next-account';await draft.initialize(true,false);assert.equal(draft.restored.value,false);key.value='integrated:library';await draft.initialize(true,false);assert.equal(draft.restored.value,false);assert.equal(draft.rows.value.length,0);draftScope.stop();s.scope.stop()
})
test('an old section response cannot populate a new section with the same source id',async()=>{
 let finish;const s=fixture({callMusicPlugin:()=>new Promise(resolve=>finish=resolve)}),key=vue.ref('integrated:home'),scope=vue.effectScope(),api=scope.run(()=>s.factory(s.id,s.offline,s.bridge,key));s.plugin.accountScope='account';await api.initialize(false,false)
 const pending=api.list('search','tracks',{keywords:'home request'});key.value='integrated:library';finish({code:200,data:[item('stale')]});await pending;assert.equal(api.rows.value.length,0);assert.equal(api.method.value,'');scope.stop();s.scope.stop()
})
test('an account change rejects an old read even when the instance id stays the same',async()=>{
 let finish;const s=fixture({callMusicPlugin:()=>new Promise(resolve=>finish=resolve)});s.plugin.accountScope='before';await s.api.initialize(false,false);const pending=s.api.list('search','tracks',{keywords:'old-account'});s.plugin.accountScope='after';finish({code:200,data:[item('old-account-song')]});await pending;assert.equal(s.api.rows.value.length,0);s.scope.stop()
})
test('a slower metadata refresh cannot replace the result of a later refresh',async()=>{
 const pending=[],s=fixture({listMusicPlugins:()=>new Promise(resolve=>pending.push(resolve))});const first=s.api.refreshPlugins(),second=s.api.refreshPlugins();pending[1]({plugins:[{...s.plugin,accountScope:'new'}]});await second;pending[0]({plugins:[{...s.plugin,accountScope:'old'}]});await first;assert.equal(s.api.plugin.value.accountScope,'new');s.scope.stop()
})
test('integrated category filters stay on their section root while standalone history is retained',async()=>{
 const content=require('@vue/compiler-sfc').parse(fs.readFileSync(path.join(__dirname,'../src/components/PluginLibraryView.vue'),'utf8')).descriptor.scriptSetup.content
 const source=ts.createSourceFile('PluginLibraryView.ts',content,ts.ScriptTarget.Latest,true,ts.ScriptKind.TS)
 const functions=source.statements.filter(node=>ts.isFunctionDeclaration(node)&&['selectCategory','selectArtistCategory'].includes(node.name?.text)).map(node=>node.getFullText(source)).join('\n')
 for(const integrated of [false,true]){
  const calls=[],scope={props:{integrated},categories:vue.ref([{context:{opaque:'category'}}]),category:vue.ref(0),visibleCount:vue.ref(0),categoryMethod:vue.ref('getCategoryPlaylist'),currentKind:vue.ref('playlists'),artistGroups:vue.ref([{code:'area',sub:[{code:'all',name:'All'}]}]),artistSelection:vue.ref(['all']),rememberView(){},pluginParams:protocol.pluginParams,library:{list:async(...args)=>calls.push(args)}}
  vm.runInNewContext(ts.transpileModule(functions+'\nglobalThis.api={selectCategory,selectArtistCategory}',{compilerOptions:{target:ts.ScriptTarget.ES2022}}).outputText,scope)
  await scope.api.selectCategory(0);await scope.api.selectArtistCategory();assert.equal(calls.length,2);assert.equal(calls[0][4],!integrated);assert.equal(calls[1][4],!integrated);assert.equal(calls[0][2].sourceContext.opaque,'category');assert.equal(calls[1][2].query[0].code,'area')
 }
})
