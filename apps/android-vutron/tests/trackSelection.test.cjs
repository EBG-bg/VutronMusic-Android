const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),vm=require('node:vm'),ts=require('typescript'),vue=require('vue')
const moduleObject={exports:{}}
vm.runInNewContext(ts.transpileModule(fs.readFileSync(path.join(__dirname,'../src/composables/trackSelection.ts'),'utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022}}).outputText,{module:moduleObject,exports:moduleObject.exports,require:()=>vue})
test('selection keeps source order, selects current results only and drops missing identities on scope changes',async()=>{
 const scope=vue.effectScope(),rows=vue.ref([{id:'b'},{id:'a'},{id:'c'}]),identity=vue.ref('account:one'),state=scope.run(()=>moduleObject.exports.useTrackSelection(rows,x=>x.id,identity))
 state.active.value=true;state.toggle(rows.value[2]);state.toggle(rows.value[0]);assert.deepEqual(Array.from(state.selected.value,x=>x.id),['b','c'])
 state.selectAll();assert.equal(state.allSelected.value,true);rows.value=rows.value.slice(1);await vue.nextTick();assert.deepEqual([...state.keys.value],['a','c'])
 identity.value='account:two';assert.equal(state.active.value,false);assert.equal(state.selected.value.length,0);scope.stop()
})
test('batch mutations are single-flight and failed operations keep the selection for a deliberate retry',async()=>{
 const scope=vue.effectScope(),rows=vue.ref([{id:'one'},{id:'two'}]),state=scope.run(()=>moduleObject.exports.useTrackSelection(rows,x=>x.id,vue.ref('p')))
 state.selectAll();let release,calls=0
 const handler=async()=>{calls++;return new Promise(resolve=>release=resolve)}
 const first=state.run('append',handler);await state.run('append',handler);assert.equal(calls,1);state.close();assert.equal(state.keys.value.size,2)
 release(false);await first;assert.equal(state.selected.value.length,2)
 await state.run('append',async()=>true);assert.equal(state.selected.value.length,0);scope.stop()
})
test('a delayed result from another account cannot clear a new selection or its running state',async()=>{
 const scope=vue.effectScope(),rows=vue.ref([{id:'one'}]),owner=vue.ref('account:one'),state=scope.run(()=>moduleObject.exports.useTrackSelection(rows,x=>x.id,owner))
 state.selectAll();let releaseOld,releaseNew
 const old=state.run('append',()=>new Promise(resolve=>releaseOld=resolve))
 owner.value='account:two';state.active.value=true;state.selectAll()
 const next=state.run('append',()=>new Promise(resolve=>releaseNew=resolve))
 releaseOld(true);await old;assert.equal(state.selected.value.length,1);assert.equal(state.busy.value,true)
 releaseNew(true);await next;assert.equal(state.selected.value.length,0);assert.equal(state.busy.value,false);scope.stop()
})
test('large-list selection count and all-selected state do not scan track metadata',()=>{
 let keyReads=0
 const rows=vue.ref(Array.from({length:5000},(_,id)=>({id}))),scope=vue.effectScope()
 const state=scope.run(()=>moduleObject.exports.useTrackSelection(rows,row=>{keyReads++;return String(row.id)},vue.ref('large-list')))
 keyReads=0;state.keys.value=new Set(rows.value.map(row=>String(row.id)))
 assert.equal(state.selectedCount.value,5000);assert.equal(state.allSelected.value,true);assert.equal(keyReads,0)
 scope.stop()
})
test('range controller survives appended pages but is replaced when the selection scope changes',async()=>{
 let loadCalls=0
 const scope=vue.effectScope(),rows=vue.ref([{id:'one'}]),owner=vue.ref('query:one'),state=scope.run(()=>moduleObject.exports.useTrackSelection(rows,row=>row.id,owner,async()=>{loadCalls++;return true}))
 const initial=state.range.value
 rows.value=[...rows.value,{id:'two'}];await vue.nextTick()
 assert.equal(state.range.value,initial);assert.deepEqual(initial.order(),['one','two'])
 assert.equal(await initial.loadMore(),true);assert.equal(loadCalls,1)
 owner.value='query:two';await vue.nextTick()
 assert.notEqual(state.range.value,initial);assert.equal(initial.valid(),false)
 scope.stop()
})
