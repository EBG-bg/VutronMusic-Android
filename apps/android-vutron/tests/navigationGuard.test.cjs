const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),vm=require('node:vm'),ts=require('typescript'),vue=require('vue')
const filename=path.join(__dirname,'../src/composables/navigationGuard.ts'),moduleSource=ts.transpileModule(fs.readFileSync(filename,'utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022}}).outputText
function fixture(){
  const module={exports:{}};vm.runInNewContext(moduleSource,{module,exports:module.exports,require:name=>name==='vue'?vue:{askAction:()=>{throw new Error('Use the isolated question adapter')}},console})
  const questions=[],waiters=[],guard=module.exports.createNavigationGuard(question=>{questions.push(question);return new Promise(resolve=>waiters.push(resolve))})
  const state={dirty:false,saves:0,discards:0,resumes:0,drags:0,saveResult:true},draft={dirty:()=>state.dirty,question:()=>({title:'Unsaved source priorities',message:'Save before leaving?',confirmLabel:'Save',secondaryLabel:'Discard',cancelLabel:'Keep editing'}),save:async()=>{state.saves++;if(state.saveResult)state.dirty=false;return state.saveResult},discard:()=>{state.discards++;state.dirty=false},resume:()=>{state.resumes++},cancelInteraction:()=>{if(!state.drags)return false;state.drags--;return true}},release=guard.register(draft)
  return {guard,state,draft,release,questions,choose:choice=>waiters.shift()(choice)}
}
test('unchanged settings navigate immediately and do not ask',()=>{
 const f=fixture();let navigated=0;f.guard.run(()=>navigated++);assert.equal(navigated,1);assert.equal(f.questions.length,0)
})
test('canceling a drag consumes only the current gesture and retains earlier draft changes',()=>{
 const f=fixture();f.state.dirty=true;f.state.drags=1;assert.equal(f.guard.cancelInteraction(),true);assert.equal(f.state.dirty,true);assert.equal(f.state.discards,0);assert.equal(f.questions.length,0);assert.equal(f.guard.cancelInteraction(),false)
})
test('keep editing leaves the draft and restores the editor',async()=>{
 const f=fixture();f.state.dirty=true;let navigated=0;f.guard.run(()=>navigated++);const pending=f.guard.pending.value;f.choose('cancel');await pending
 assert.equal(navigated,0);assert.equal(f.state.dirty,true);assert.equal(f.state.saves,0);assert.equal(f.state.discards,0);assert.equal(f.state.resumes,1);assert.equal(f.guard.pending.value,undefined)
})
test('discard leaves once and allows the approved nested navigation wrapper',async()=>{
 const f=fixture();f.state.dirty=true;let navigated=0;f.guard.run(()=>f.guard.run(()=>navigated++));const pending=f.guard.pending.value;f.choose('secondary');await pending
 assert.equal(navigated,1);assert.equal(f.state.discards,1);assert.equal(f.state.saves,0);assert.equal(f.questions.length,1)
})
test('failed save preserves the draft and blocks leaving until a later successful retry',async()=>{
 const f=fixture();f.state.dirty=true;f.state.saveResult=false;let navigated=0;f.guard.run(()=>navigated++);let pending=f.guard.pending.value;f.choose('confirm');await pending
 assert.equal(navigated,0);assert.equal(f.state.dirty,true);assert.equal(f.state.resumes,1)
 f.state.saveResult=true;f.guard.run(()=>navigated++);pending=f.guard.pending.value;f.choose('confirm');await pending;assert.equal(navigated,1);assert.equal(f.state.saves,2)
})
test('repeat requests share one question and do not race a pending save',async()=>{
 const f=fixture();f.state.dirty=true;let first=0,second=0,resolveSave;f.draft.save=()=>{f.state.saves++;return new Promise(resolve=>resolveSave=resolve)}
 f.guard.run(()=>first++);const pending=f.guard.pending.value;f.guard.run(()=>second++);assert.equal(f.questions.length,1);f.choose('confirm');await new Promise(resolve=>setImmediate(resolve));f.guard.run(()=>second++)
 assert.equal(f.state.saves,1);assert.equal(f.questions.length,1);resolveSave(true);await pending;assert.equal(first,1);assert.equal(second,0)
})
test('an unmounted draft cannot resume an outdated destination',async()=>{
 const f=fixture();f.state.dirty=true;let navigated=0;f.guard.run(()=>navigated++);const pending=f.guard.pending.value;f.release();f.choose('confirm');await pending;assert.equal(navigated,0);assert.equal(f.state.saves,0)
})
