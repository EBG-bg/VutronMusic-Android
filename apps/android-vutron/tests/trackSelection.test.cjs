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
