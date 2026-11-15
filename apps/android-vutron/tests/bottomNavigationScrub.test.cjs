const test = require('node:test'), assert = require('node:assert/strict')
const fs = require('node:fs'), path = require('node:path'), vm = require('node:vm'), ts = require('typescript'), vue = require('vue')
function fixture() {
  function target() {
    const listeners = new Map()
    return { listeners, addEventListener(name, fn) { if (!listeners.has(name)) listeners.set(name, new Set()); listeners.get(name).add(fn) },
      removeEventListener(name, fn) { listeners.get(name)?.delete(fn); if (!listeners.get(name)?.size) listeners.delete(name) },
      dispatch(name, event = {}) { for (const fn of [...listeners.get(name) || []]) fn(event) } }
  }
  const document = { ...target(), visibilityState: 'visible' }, window = target(), captured = new Set(), buttons = Array.from({length:5},(_,i)=>({offsetLeft:i*80+5,offsetTop:5,offsetWidth:70,offsetHeight:60}))
  const element = { querySelectorAll: () => buttons, getBoundingClientRect: () => ({ left: 20 }), setPointerCapture: id => captured.add(id),
    hasPointerCapture: id => captured.has(id), releasePointerCapture: id => captured.delete(id) }
  const module = { exports: {} }; let unmount
  const code = ts.transpileModule(fs.readFileSync(path.join(__dirname, '../src/composables/bottomNavigationScrub.ts'), 'utf8'), {compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022}}).outputText
  vm.runInNewContext(code, { module, exports: module.exports, require: () => ({...vue,onBeforeUnmount:fn=>{unmount=fn}}), document, window })
  const scope = vue.effectScope(), root = vue.shallowRef(element), tabs = vue.ref(['home','library','search','player','settings']), current = vue.ref('home'), enabled = vue.ref(true), calls = []
  const api = scope.run(() => module.exports.useBottomNavigationScrub(root,tabs,current,()=>enabled.value,tab=>{calls.push(tab);current.value=tab}))
  function event(x, y = 700, id = 1, rest = {}) { return { clientX:x,clientY:y,pointerId:id,isPrimary:true,button:0,cancelable:true,detail:1,preventDefault(){this.prevented=true},stopImmediatePropagation(){this.stopped=true},...rest } }
  return { api, document, window, captured, buttons, current, tabs, enabled, calls, event, destroy(){unmount();scope.stop()} }
}
test('tap retains the existing click path, horizontal scrub previews continuously and navigates only on release', () => {
  const f = fixture(); f.api.start(f.event(60)); f.api.end(f.event(60)); const tap = f.event(60); f.api.click(tap)
  assert.equal(tap.prevented, undefined); assert.deepEqual(f.calls, [])
  f.api.start(f.event(60)); f.document.dispatch('pointermove',f.event(170)); assert.equal(f.api.dragging.value,true)
  assert.equal(f.api.previewIndex.value,1); assert.notEqual(f.api.indicatorStyle.value.transform,'translate3d(85px,5px,0)')
  assert.deepEqual(f.calls,[]); f.document.dispatch('pointerup',f.event(222)); assert.deepEqual(f.calls,['search'])
  const trailing=f.event(222);f.api.click(trailing);assert.equal(trailing.prevented,true);assert.equal(trailing.stopped,true)
  f.api.start(f.event(222));f.api.end(f.event(222));const nextTap=f.event(222);f.api.click(nextTap);assert.equal(nextTap.prevented,undefined)
  f.destroy()
})
test('vertical movement, secondary pointers and OS pointer cancellation never navigate', () => {
  for(const cause of ['vertical','second','cancel']) {
    const f=fixture();f.api.start(f.event(60))
    if(cause==='vertical')f.document.dispatch('pointermove',f.event(63,725))
    else {f.document.dispatch('pointermove',f.event(170));f.document.dispatch(cause==='second'?'pointerdown':'pointercancel',f.event(190,700,2,{isPrimary:false}))}
    f.document.dispatch('pointerup',f.event(222));assert.deepEqual(f.calls,[]);assert.equal(f.api.dragging.value,false);assert.equal(f.captured.size,0)
    assert.equal(f.document.listeners.size,0);const trailing=f.event(222);f.api.click(trailing);assert.equal(trailing.prevented,true);f.destroy()
  }
})
test('boundaries clamp to the first/last item without wrapping or duplicating navigation', () => {
  const f=fixture();f.api.start(f.event(60));f.document.dispatch('pointermove',f.event(-900));assert.equal(f.api.previewIndex.value,0);f.document.dispatch('pointerup',f.event(-900));assert.deepEqual(f.calls,[])
  f.api.start(f.event(60));f.document.dispatch('pointermove',f.event(9000));assert.equal(f.api.previewIndex.value,4);f.document.dispatch('pointerup',f.event(9000));assert.deepEqual(f.calls,['settings']);f.destroy()
})
test('the existing landscape vertical rail keeps its normal clicks and scrolling', () => {
  const f=fixture();f.buttons.forEach((button,index)=>{button.offsetLeft=5;button.offsetTop=index*80+5})
  f.api.start(f.event(60));f.document.dispatch('pointermove',f.event(170));assert.equal(f.api.dragging.value,false);assert.equal(f.document.listeners.size,0)
  const tap=f.event(60);f.api.click(tap);assert.equal(tap.prevented,undefined);assert.deepEqual(f.calls,[]);f.destroy()
})
test('backgrounding, resizing, disabled state, changed tabs and unmount release all gesture resources', () => {
  for(const cause of ['hidden','resize','disabled','tabs','current','unmount']) {
    const f=fixture();f.api.start(f.event(60));f.document.dispatch('pointermove',f.event(170));assert.equal(f.captured.size,1)
    if(cause==='hidden'){f.document.visibilityState='hidden';f.document.dispatch('visibilitychange')}
    else if(cause==='resize')f.window.dispatch('resize')
    else if(cause==='disabled')f.enabled.value=false
    else if(cause==='tabs')f.tabs.value=['home','settings']
    else if(cause==='current')f.current.value='library'
    else f.destroy()
    assert.equal(f.api.dragging.value,false);assert.equal(f.api.indicatorStyle.value,undefined);assert.equal(f.captured.size,0)
    assert.equal(f.document.listeners.size,0);assert.equal(f.window.listeners.size,0);assert.deepEqual(f.calls,[])
    if(cause!=='unmount')f.destroy()
  }
})
