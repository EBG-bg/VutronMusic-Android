const test = require('node:test'), assert = require('node:assert/strict')
const fs = require('node:fs'), path = require('node:path'), vm = require('node:vm'), ts = require('typescript'), vue = require('vue')

// The adjacent bottom-navigation tests use the same DOM/event boundary. Keep
// this fixture dependency-free; real input dispatch is covered by the browser run.
function fixture(initial = 'library', options = {}) {
  class Events {
    constructor() { this.listeners = new Map() }
    addEventListener(name, callback) { if (!this.listeners.has(name)) this.listeners.set(name, new Set()); this.listeners.get(name).add(callback) }
    removeEventListener(name, callback) { this.listeners.get(name)?.delete(callback); if (!this.listeners.get(name)?.size) this.listeners.delete(name) }
    dispatchEvent(event) {
      if (!event.target) event.target = this
      event.currentTarget = this
      for (const callback of [...this.listeners.get(event.type) || []]) { callback(event); if (event.immediateStopped) break }
      if (event.bubbles && !event.stopped && this.parentElement) this.parentElement.dispatchEvent(event)
      return !event.defaultPrevented
    }
    dispatch(type, fields = {}) { const event = { type, ...fields }; this.dispatchEvent(event); return event }
    count() { return [...this.listeners.values()].reduce((total, callbacks) => total + callbacks.size, 0) }
  }
  function selectorParts(selector, separator) {
    const parts = []; let depth = 0, at = 0
    for (let i = 0; i < selector.length; i++) {
      if ('[('.includes(selector[i])) depth++
      else if ('])'.includes(selector[i])) depth--
      else if (!depth && (separator === ',' ? selector[i] === ',' : /\s/.test(selector[i]))) { if (selector.slice(at, i).trim()) parts.push(selector.slice(at, i).trim()); at = i + 1 }
    }
    if (selector.slice(at).trim()) parts.push(selector.slice(at).trim())
    return parts
  }
  function compoundMatches(element, selector) {
    let valid = true
    selector = selector.replace(/:(not|is|where)\(([^()]*)\)/g, (_all, kind, inner) => { const matches = selectorParts(inner, ',').some(part => element.matches(part)); if (kind === 'not' ? matches : !matches) valid = false; return '' })
    if (!valid) return false
    if (selector.includes(':disabled') && !element.hasAttribute('disabled')) return false
    if (selector.includes(':enabled') && element.hasAttribute('disabled')) return false
    selector = selector.replace(/:(disabled|enabled)/g, '')
    const tag = selector.match(/^[a-z][\w-]*/i)?.[0]
    if (tag && tag.toUpperCase() !== element.tagName) return false
    for (const [, name, value] of selector.matchAll(/\[([^\s=\]]+)(?:\s*=\s*["']?([^\]"']+)["']?)?\]/g)) {
      if (!element.hasAttribute(name) || value !== undefined && element.getAttribute(name) !== value.trim()) return false
    }
    const withoutAttributes = selector.replace(/\[[^\]]*\]/g, '')
    for (const [, name] of withoutAttributes.matchAll(/\.([\w-]+)/g)) if (!element.classList.contains(name)) return false
    return true
  }
  class Element extends Events {
    constructor(tag = 'div', classes = '', attributes = {}) {
      super(); this.tagName = tag.toUpperCase(); this.nodeType = 1; this.parentElement = null; this.children = []; this.attributes = new Map(Object.entries(attributes))
      this.classes = new Set(classes.split(/\s+/).filter(Boolean)); this.classList = { contains: name => this.classes.has(name), add: name => this.classes.add(name), remove: name => this.classes.delete(name) }
      this.clientWidth = this.scrollWidth = 360; this.clientHeight = this.scrollHeight = 600; this.isConnected = true; this.capture = new Set()
      this.css = { overflowX: 'visible', overflowY: 'visible', touchAction: 'auto' }
      this.style = { setProperty() {}, removeProperty() {}, getPropertyValue() { return '' } }
    }
    append(child) { child.parentElement = this; child.ownerDocument = this.ownerDocument; this.children.push(child); return child }
    contains(child) { for (let node = child; node; node = node.parentElement) if (node === this) return true; return false }
    hasAttribute(name) { return this.attributes.has(name) }
    getAttribute(name) { return this.attributes.get(name) ?? null }
    setAttribute(name, value) { this.attributes.set(name, String(value)) }
    removeAttribute(name) { this.attributes.delete(name) }
    matches(selector) {
      return selectorParts(selector, ',').some(part => {
        const ancestors = selectorParts(part, ' '); let node = this
        if (!compoundMatches(node, ancestors.pop())) return false
        while (ancestors.length) { const required = ancestors.pop(); node = node.parentElement; while (node && !compoundMatches(node, required)) node = node.parentElement; if (!node) return false }
        return true
      })
    }
    closest(selector) { for (let node = this; node; node = node.parentElement) if (node.matches(selector)) return node; return null }
    getBoundingClientRect() { return { x:0,y:0,left:0,top:0,right:360,bottom:600,width:360,height:600 } }
    setPointerCapture(id) { this.capture.add(id) }
    hasPointerCapture(id) { return this.capture.has(id) }
    releasePointerCapture(id) { this.capture.delete(id) }
  }
  class CustomEvent {
    constructor(type, options = {}) { this.type = type; Object.assign(this, options); this.defaultPrevented = false }
    preventDefault() { if (this.cancelable !== false) this.defaultPrevented = true }
    stopPropagation() { this.stopped = true }
    stopImmediatePropagation() { this.stopped = this.immediateStopped = true }
  }
  const document = new Events(), window = new Events(), cleanup = [], mounts = [], timers = new Map(); let timerId = 0, now = 1000
  document.visibilityState = 'visible'; document.hidden = false; document.documentElement = new Element('html'); document.body = document.documentElement.append(new Element('body'))
  document.documentElement.ownerDocument = document; document.body.ownerDocument = document
  const root = document.body.append(new Element('div', 'page-stage')), claims = []
  root.addEventListener('vutron-navigation-swipe', event => claims.push(event))
  window.innerWidth = 360; window.innerHeight = 800
  const module = { exports: {} }, filename = path.join(__dirname, '../src/composables/mainNavigationSwipe.ts')
  const source = ts.transpileModule(fs.readFileSync(filename, 'utf8'), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText
  vm.runInNewContext(source, {
    module, exports: module.exports, require(name) { if (name === 'vue') return { ...vue, onBeforeUnmount: callback => cleanup.push(callback), onMounted: callback => mounts.push(callback) }; throw new Error('Unexpected navigation-swipe dependency: ' + name) },
    document, window, Element, HTMLElement: Element, Node: { ELEMENT_NODE: 1 }, CustomEvent, Event: CustomEvent,
    innerWidth: 360, innerHeight: 800, getComputedStyle: element => element.css, performance: { now: () => now },
    setTimeout(callback) { timers.set(++timerId, callback); return timerId }, clearTimeout(id) { timers.delete(id) },
    requestAnimationFrame(callback) { timers.set(++timerId, callback); return timerId }, cancelAnimationFrame(id) { timers.delete(id) }, console
  })
  const scope = vue.effectScope(), tabs = vue.ref(['home', 'library', 'search', 'player', 'settings']), current = vue.ref(initial), enabled = vue.ref(true), calls = []
  const api = scope.run(() => module.exports.useMainNavigationSwipe(tabs, current, () => enabled.value, tab => { calls.push(tab); current.value = tab }, options))
  mounts.forEach(callback => callback())
  const baseline = { document: document.count(), window: window.count() }
  function event(target, x, y = 100, fields = {}) {
    return { target,currentTarget:root,clientX:x,clientY:y,pointerId:1,pointerType:'mouse',isPrimary:true,button:0,buttons:1,cancelable:true,defaultPrevented:false,detail:1,timeStamp:now,
      composedPath() { const path=[];for(let node=target;node;node=node.parentElement)path.push(node);return [...path,document,window] },
      preventDefault() { this.defaultPrevented = this.prevented = true }, stopPropagation() { this.stopped = true }, stopImmediatePropagation() { this.stopped = this.immediateStopped = true }, ...fields }
  }
  function touch(target, x, y = 100, fields = {}) {
    const point = { identifier:1,clientX:x,clientY:y,target }
    return event(target, x, y, { type:'touchmove',touches:[point],changedTouches:[point], ...fields })
  }
  function child(tag = 'div', classes = '', attrs = {}, parent = root) { return parent.append(new Element(tag, classes, attrs)) }
  const styleOffset = () => api.style.value['--page-swipe-x'] === 'none' ? 0 : parseFloat(api.style.value['--page-swipe-x'])
  function destroy() { cleanup.splice(0).forEach(callback => callback()); scope.stop() }
  function assertReleased() { assert.equal(api.holding.value,false); assert.equal(styleOffset(),0); assert.equal(api.position.value,undefined); assert.equal(document.count(),baseline.document); assert.equal(window.count(),baseline.window) }
  return { api, root, claims, current, tabs, enabled, calls, document, window, baseline, event, touch, child, timers, styleOffset, assertReleased, destroy, advance(ms) { now += ms } }
}

test('touch drags can start on ordinary buttons, role-button songs, normal playlist grids and player artwork', () => {
  for (const kind of ['button','song','playlist','cover']) {
    const f = fixture(), parent = kind === 'playlist' ? f.child('div','playlist-grid') : f.root
    const control = f.child(kind === 'song' || kind === 'cover' ? 'div' : 'button',kind === 'song'?'track-row':kind==='cover'?'player-artwork':'playlist-card',kind === 'song'?{role:'button'}:{},parent), target=f.child('span','',{},control)
    f.api.start(f.touch(target,300,100,{type:'touchstart'}));const move=f.touch(target,220);f.api.move(move)
    assert.equal(f.api.holding.value,true,kind);assert.ok(f.styleOffset()<0);assert.equal(move.defaultPrevented,true)
    assert.ok(f.api.position.value>1&&f.api.position.value<2,'The selected-tab position follows the fractional drag')
    assert.equal(f.claims.length,1);assert.equal(f.claims[0].bubbles,true)
    f.api.move(f.touch(target,180));assert.equal(f.claims.length,1,'Long-press cancellation notification fires once per claimed gesture')
    f.api.end(f.touch(target,150,100,{type:'touchend',touches:[]}));assert.deepEqual(f.calls,['search']);f.assertReleased();f.destroy()
  }
})

test('mouse and pen use the pointer path while touch pointers do not duplicate the touch path', () => {
  for (const pointerType of ['mouse','pen','touch']) {
    const f=fixture(),target=f.child('button','playlist-card')
    f.api.pointerStart(f.event(target,300,100,{type:'pointerdown',pointerType}));f.document.dispatch('pointermove',f.event(target,190,100,{type:'pointermove',pointerType}));f.document.dispatch('pointerup',f.event(target,150,100,{type:'pointerup',pointerType,buttons:0}))
    assert.deepEqual(f.calls,pointerType==='touch'?[]:['search']);f.assertReleased();f.destroy()
  }
})

test('a dedicated cover/lyrics surface may opt into lyric horizontal switching without stealing vertical scroll', () => {
  const f=fixture('cover',{allowLyrics:()=>true});f.tabs.value=['cover','lyrics']
  const owner=f.child('div','original-lyrics-view'),target=f.child('p','',{},owner);owner.scrollHeight=1800;owner.css.overflowY='auto'
  f.api.start(f.touch(target,300,100,{type:'touchstart'}));f.api.move(f.touch(target,180));f.api.end(f.touch(target,130,100,{type:'touchend',touches:[]}));assert.deepEqual(f.calls,['lyrics']);f.assertReleased()
  f.api.start(f.touch(target,200,100,{type:'touchstart'}));const vertical=f.touch(target,205,190);f.api.move(vertical);f.api.end(f.touch(target,205,220,{type:'touchend',touches:[]}));assert.equal(vertical.defaultPrevented,false);assert.deepEqual(f.calls,['lyrics']);f.assertReleased();f.destroy()
})

test('vertical scrolling, non-primary pointers and non-left buttons remain outside page navigation', () => {
  const f=fixture(),target=f.child('div','track-row',{role:'button'})
  f.api.start(f.touch(target,200,100,{type:'touchstart'}));const move=f.touch(target,205,180);f.api.move(move);f.api.end(f.touch(target,205,220,{type:'touchend',touches:[]}))
  assert.equal(move.defaultPrevented,false);assert.deepEqual(f.calls,[]);assert.equal(f.claims.length,0);f.assertReleased()
  for(const fields of [{button:2},{isPrimary:false}]){f.api.pointerStart(f.event(target,300,100,fields));f.api.pointerMove(f.event(target,150,100,fields));f.api.pointerEnd(f.event(target,120,100,fields))}
  assert.deepEqual(f.calls,[]);f.assertReleased();f.destroy()
})

test('horizontal shelves, lyrics, whole arc-wheel controls, sliders and active custom sorting keep their gestures', () => {
  for(const kind of ['shelf','lyrics','wheel-label','slider','custom-sort','sort-handle','inert']){
    const f=fixture();let owner,target
    if(kind==='shelf'){owner=f.child('div','horizontal-cards');owner.scrollWidth=900;owner.css.overflowX='auto';target=f.child('button','home-cover-card',{},owner)}
    else if(kind==='lyrics'){owner=f.child('div','original-lyrics-view');target=f.child('p','',{},owner)}
    else if(kind==='wheel-label'){owner=f.child('div','arc-wheel-control');target=f.child('div','wheel-label',{},owner)}
    else if(kind==='slider'){owner=f.child('div','thumb-range',{role:'slider'});target=f.child('span','thumb-range-thumb',{},owner)}
    else if(kind==='custom-sort'){owner=f.child('div','playlist-grid custom-playlists');target=f.child('button','playlist-card',{},owner)}
    else if(kind==='sort-handle')target=f.child('button','playlist-drag-handle')
    else{owner=f.child('div','',{inert:''});target=f.child('button','playlist-card',{},owner)}
    f.api.start(f.touch(target,300,100,{type:'touchstart'}));const move=f.touch(target,150);f.api.move(move);f.api.end(f.touch(target,100,100,{type:'touchend',touches:[]}))
    assert.equal(move.defaultPrevented,false,kind);assert.deepEqual(f.calls,[],kind);assert.equal(f.claims.length,0,kind);f.assertReleased();f.destroy()
  }
})

test('short horizontal drags and outer-tab resistance swallow only that gesture click without navigating', () => {
  for(const kind of ['short','boundary']){
    const f=fixture(kind==='boundary'?'home':'library'),target=f.child('button','playlist-card')
    f.api.start(f.touch(target,180,100,{type:'touchstart'}));f.api.move(f.touch(target,kind==='boundary'?270:210))
    assert.equal(f.api.holding.value,true);assert.notEqual(f.styleOffset(),0)
    f.api.end(f.touch(target,kind==='boundary'?300:210,100,{type:'touchend',touches:[]}));assert.deepEqual(f.calls,[])
    const trailing=f.event(target,210,100,{type:'click'});f.api.click(trailing);assert.equal(trailing.defaultPrevented,true,kind);assert.equal(trailing.stopped,true)
    f.api.start(f.touch(target,210,100,{type:'touchstart'}));f.api.end(f.touch(target,210,100,{type:'touchend',touches:[]}))
    const next=f.event(target,210,100,{type:'click'});f.api.click(next);assert.equal(next.defaultPrevented,false,'A new down restores the ordinary tap path')
    f.assertReleased();f.destroy()
  }
})

test('nested first and last pages hand the same outward touch to primary navigation exactly once', () => {
  for (const [page, distance, expected] of [['cover', 145, 'search'], ['lyrics', -145, 'settings']]) {
    const local = fixture(page, { yieldAtBoundary: () => true }), primary = fixture('player')
    local.tabs.value = ['cover', 'lyrics']
    const target = local.child('button', 'player-artwork'), start = local.touch(target, 180, 100, { type: 'touchstart' })
    local.api.start(start); primary.api.start(start)
    const move = local.touch(target, 180 + distance / 2)
    local.api.move(move)
    assert.equal(move.defaultPrevented, false, 'The local boundary leaves the event available to its parent')
    local.assertReleased(); primary.api.move(move)
    assert.equal(primary.api.holding.value, true); assert.ok(primary.api.position.value !== 3)
    assert.equal(local.styleOffset(), 0, 'Only the parent surface follows a boundary drag')
    const end = local.touch(target, 180 + distance, 100, { type: 'touchend', touches: [] })
    local.api.end(end); primary.api.end(end)
    assert.deepEqual(local.calls, []); assert.deepEqual(primary.calls, [expected])
    local.assertReleased(); primary.assertReleased(); local.destroy(); primary.destroy()
  }
})

test('an interior nested swipe cancels primary movement, including a reversal within the same gesture', () => {
  const local = fixture('cover', { yieldAtBoundary: () => true }), primary = fixture('player')
  local.tabs.value = ['cover', 'lyrics']
  const target = local.child('button', 'player-artwork'), start = local.touch(target, 180, 100, { type: 'touchstart' })
  local.api.start(start); primary.api.start(start)
  const move = local.touch(target, 100)
  local.api.move(move); primary.api.move(move)
  assert.equal(local.api.holding.value, true); primary.assertReleased()
  const reverse = local.touch(target, 300)
  local.api.move(reverse); primary.api.move(reverse)
  assert.equal(local.api.holding.value, true); assert.equal(primary.styleOffset(), 0)
  const end = local.touch(target, 300, 100, { type: 'touchend', touches: [] })
  local.api.end(end); primary.api.end(end)
  assert.deepEqual(local.calls, []); assert.deepEqual(primary.calls, [])
  local.assertReleased(); primary.assertReleased(); local.destroy(); primary.destroy()
})

test('a nested boundary still respects vertical intent, cancellation and the first primary page', () => {
  for (const kind of ['vertical', 'cancel', 'outer']) {
    const local = fixture('first', { yieldAtBoundary: () => true }), primary = fixture(kind === 'outer' ? 'home' : 'library')
    local.tabs.value = ['first', 'last']
    const target = local.child('button', 'playlist-card'), start = local.touch(target, 180, 100, { type: 'touchstart' })
    local.api.start(start); primary.api.start(start)
    const move = local.touch(target, kind === 'vertical' ? 184 : 300, kind === 'vertical' ? 220 : 100)
    local.api.move(move); primary.api.move(move)
    if (kind === 'cancel') { local.api.cancel(); primary.api.cancel() }
    const end = local.touch(target, 300, kind === 'vertical' ? 240 : 100, { type: 'touchend', touches: [] })
    local.api.end(end); primary.api.end(end)
    assert.deepEqual(local.calls, [], kind); assert.deepEqual(primary.calls, [], kind)
    local.assertReleased(); primary.assertReleased(); local.destroy(); primary.destroy()
  }
})

test('tap and keyboard activation remain available without a claimed horizontal gesture', () => {
  const f=fixture(),target=f.child('button','playlist-card')
  f.api.start(f.touch(target,180,100,{type:'touchstart'}));f.api.end(f.touch(target,180,100,{type:'touchend',touches:[]}))
  const tap=f.event(target,180,100,{type:'click'});f.api.click(tap);assert.equal(tap.defaultPrevented,false)
  const keyboard=f.event(target,0,0,{type:'click',detail:0});f.api.click(keyboard);assert.equal(keyboard.defaultPrevented,false)
  assert.deepEqual(f.calls,[]);f.destroy()
})

test('changed capabilities, current tab, tab collection and backgrounding cancel the active gesture', async () => {
  for(const reason of ['disabled','current','tabs','hidden','blur','multitouch','cancel','child-busy']){
    const f=fixture(),target=f.child('div','track-row',{role:'button'})
    f.api.start(f.touch(target,300,100,{type:'touchstart'}));f.api.move(f.touch(target,220));assert.equal(f.api.holding.value,true)
    if(reason==='disabled')f.enabled.value=false
    else if(reason==='current')f.current.value='player'
    else if(reason==='tabs')f.tabs.value=['home','library','settings']
    else if(reason==='hidden'){f.document.visibilityState='hidden';f.document.hidden=true;f.document.dispatch('visibilitychange')}
    else if(reason==='blur')f.window.dispatch('blur')
    else if(reason==='multitouch')f.api.move(f.touch(target,180,100,{touches:[{identifier:1,clientX:180,clientY:100},{identifier:2,clientX:200,clientY:100}]}))
    else if(reason==='child-busy'){target.setAttribute('data-no-page-swipe','');f.api.move(f.touch(target,180))}
    else f.api.cancel()
    await vue.nextTick();f.assertReleased();f.api.end(f.touch(target,100,100,{type:'touchend',touches:[]}));assert.deepEqual(f.calls,[],reason);f.destroy()
  }
})

test('a child-owned gesture and unmount cannot leave document resources or a pending navigation', () => {
  const f=fixture(),target=f.child('button','playlist-card')
  f.api.start(f.touch(target,300,100,{type:'touchstart'}));f.api.move(f.touch(target,190,100,{defaultPrevented:true}));f.api.end(f.touch(target,130,100,{type:'touchend',touches:[]}));assert.deepEqual(f.calls,[]);f.assertReleased()
  f.api.pointerStart(f.event(target,300,100,{type:'pointerdown'}));f.api.pointerMove(f.event(target,190,100,{type:'pointermove'}));assert.equal(f.api.holding.value,true)
  f.destroy();assert.equal(f.document.count(),0);assert.equal(f.window.count(),0);assert.equal(f.timers.size,0);assert.equal(f.api.holding.value,false);assert.equal(f.styleOffset(),0)
  f.document.dispatch('pointerup',f.event(target,100,100,{type:'pointerup'}));assert.deepEqual(f.calls,[])
})
