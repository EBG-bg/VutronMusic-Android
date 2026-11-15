const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),vm=require('node:vm'),ts=require('typescript')
function fixture(){
 const module={exports:{}},timers=new Map();let sequence=0,listener,resolve,result,current=true,removed=0,requests=0
 const plugin={addListener:async(name,fn)=>{assert.equal(name,'playlistTracksProgress');listener=fn;return{remove:async()=>{removed++}}},getPlaylistTracks:async(options)=>{requests++;assert.equal(options.requestToken,'token');return new Promise(done=>{resolve=done})}}
 vm.runInNewContext(ts.transpileModule(fs.readFileSync(path.join(__dirname,'../src/stores/domains/playlistTrackLoading.ts'),'utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022}}).outputText,{module,exports:module.exports,require:()=>({vutronPlugin:plugin}),console,setTimeout:fn=>{timers.set(++sequence,fn);return sequence},clearTimeout:id=>timers.delete(id)})
 const updates=[],request={playlist:{id:42,name:'List'},userId:7,requestToken:'token',isCurrent:()=>current,publish:(rows,playlist)=>updates.push({rows,playlist})}
 const task=module.exports.loadPlaylistTrackBatches(request)
 const send=(offset,ids,rest={})=>listener({requestToken:'token',userId:7,playlistId:42,offset,total:1000,tracks:ids.map(id=>({id,name:'Track '+id})),playlist:{id:42,name:'List'},...rest})
 return{task,updates,timers,send,async ready(){await Promise.resolve();await Promise.resolve()},flush(){for(const[id,fn]of[...timers]){timers.delete(id);fn()}},finish(value){resolve(value)},stale(){current=false},get removed(){return removed},get requests(){return requests}}
}
test('real batches publish before completion, coalesce same-turn arrivals and reuse displayed objects at completion',async()=>{
 const f=fixture();await f.ready();f.send(0,[1,2]);f.send(2,[3,4]);assert.equal(f.updates.length,0);assert.equal(f.timers.size,1);f.flush()
 assert.deepEqual(Array.from(f.updates[0].rows,row=>row.id),[1,2,3,4]);const displayed=f.updates[0].rows
 f.finish({tracks:[1,2,3,4].map(id=>({id,name:'Track '+id})),playlist:{id:42,name:'List'}});const result=await f.task
 assert.equal(result.tracks,displayed);assert.equal(f.updates.at(-1).rows,displayed);assert.equal(f.requests,1);assert.equal(f.removed,1);assert.equal(f.timers.size,0)
})
test('old account, playlist, request and out-of-order or duplicate batches never contaminate the current prefix',async()=>{
 const f=fixture();await f.ready();f.send(0,[99],{userId:8});f.send(0,[98],{playlistId:9});f.send(0,[97],{requestToken:'old'});f.send(80,[96]);f.send(0,[1,2]);f.send(0,[1,2]);f.flush()
 assert.deepEqual(Array.from(f.updates[0].rows,row=>row.id),[1,2]);f.stale();f.send(2,[3]);f.finish({tracks:[{id:9,name:'Old completion'}]});assert.equal(await f.task,undefined);assert.equal(f.updates.length,1);assert.equal(f.removed,1)
})
test('incomplete results preserve the received rows while complete cached fallback replaces the prefix',async()=>{
 const f=fixture();await f.ready();f.send(0,[1,2]);f.flush();f.finish({tracks:[{id:1,name:'Track 1'},{id:2,name:'Track 2'}],incomplete:true,message:'Network interrupted'})
 const result=await f.task;assert.equal(result.incomplete,true);assert.equal(result.tracks,f.updates[0].rows);assert.equal(f.removed,1)
 const cached=fixture();await cached.ready();cached.send(0,[1,2]);cached.flush();cached.finish({tracks:[{id:8,name:'Old complete cache'},{id:9,name:'Old complete cache 2'}],cached:true})
 assert.deepEqual(Array.from((await cached.task).tracks,row=>row.id),[8,9]);assert.equal(cached.updates.at(-1).rows[0].id,8)
})
test('a completed request cancels a pending paint and deduplicates an old non-streaming host result',async()=>{
 const f=fixture();await f.ready();f.send(0,[1]);f.finish({tracks:[{id:3,name:'Three'},{id:3,name:'Duplicate'},{id:4,name:'Four'}]});const result=await f.task
 f.flush();assert.deepEqual(Array.from(result.tracks,row=>row.id),[3,4]);assert.equal(f.updates.length,1);assert.equal(f.timers.size,0);assert.equal(f.removed,1)
})
