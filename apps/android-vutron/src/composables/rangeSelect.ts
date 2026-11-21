import type { ObjectDirective } from 'vue'

export interface RangeSelection {
  order(): readonly string[]
  selected(): ReadonlySet<string>
  apply(keys: Set<string>): void
  loadMore?(): Promise<boolean>
  valid?(): boolean
  start?(): void
  cancel?(): void
}

type Binding = RangeSelection | undefined
interface Contact { id: number; x: number; y: number; startKey: string; source: RangeSelection; row: HTMLElement }
interface Range { initial: Set<string>; current: Set<string>; order: readonly string[]; positions: Map<string,number>; anchor: number; end: number; low: number; high: number; adding: boolean }
const controllers = new WeakMap<HTMLElement, ReturnType<typeof bind>>()
const rowSelector = '[data-range-key]'
const excluded = 'button,a,input,select,textarea,summary,[contenteditable=true],[data-no-range-select]'
const handle = '[data-range-handle],[role=switch]'

function bind(element: HTMLElement, value: Binding) {
  if (value) element.dataset.rangeSelect = ''
  let source = value, touch: Contact | undefined, range: Range | undefined
  let timer: ReturnType<typeof setTimeout> | undefined, frame = 0, blockClick = false
  let pointX = 0, pointY = 0, lastFrameAt = 0, loadingMore = false, loadRevision = 0
  let scrollTarget: Element | undefined
  let lastRequestedOrder: readonly string[] | undefined
  let controls: Element[] | undefined
  function stopTimer() { clearTimeout(timer); timer = undefined }
  function finish(cancelled: boolean) {
    stopTimer(); cancelAnimationFrame(frame); frame = 0; lastFrameAt = 0
    loadingMore = false; lastRequestedOrder = undefined; loadRevision++
    if (cancelled && range && source === touch?.source) {
      source?.apply(range.initial); source?.cancel?.()
    }
    range = undefined; touch = undefined; scrollTarget = undefined; controls = undefined
    delete element.dataset.rangeSelecting
  }
  function apply(end: number) {
    const r = range
    if (!r || end < 0 || end === r.end) return
    const nextLow = Math.min(r.anchor, end), nextHigh = Math.max(r.anchor, end)
    if (r.end >= 0) {
      for (let i = r.low; i < nextLow; ++i) setInitial(r, i)
      for (let i = nextHigh + 1; i <= r.high; ++i) setInitial(r, i)
    }
    const oldLow = r.end < 0 ? r.anchor + 1 : r.low
    const oldHigh = r.end < 0 ? r.anchor - 1 : r.high
    for (let i = nextLow; i < Math.min(nextHigh + 1, oldLow); ++i) setRangeValue(r, i)
    for (let i = Math.max(nextLow, oldHigh + 1); i <= nextHigh; ++i) setRangeValue(r, i)
    r.low = nextLow; r.high = nextHigh; r.end = end
    source?.apply(r.current)
  }
  function setInitial(r: Range, index: number) {
    const key = r.order[index]!
    if (r.initial.has(key)) r.current.add(key)
    else r.current.delete(key)
  }
  function setRangeValue(r: Range, index: number) {
    const key = r.order[index]!
    if (r.adding) r.current.add(key)
    else r.current.delete(key)
  }
  function extendOrder() {
    if (!range || source?.valid?.() === false) return false
    const latest = source?.order() ?? []
    if (latest === range.order) return true
    if (latest.length < range.order.length) return false
    for (let index = 0; index < range.order.length; ++index) if (latest[index] !== range.order[index]) return false
    for (let index = range.order.length; index < latest.length; ++index) {
      const key = latest[index]!
      range.positions.set(key, index)
    }
    range.order = latest
    return true
  }
  function hit() {
    if (!extendOrder()) { if (range) finish(true); return }
    const row = document.elementFromPoint(pointX, pointY)?.closest<HTMLElement>(rowSelector)
    if (row && element.contains(row) && range) apply(range.positions.get(row.dataset.rangeKey!) ?? -1)
  }
  function edge(timestamp: number) {
    frame = 0
    if (!range || !scrollTarget) return
    if (!extendOrder()) { finish(true); return }
    const viewport = scrollTarget === document.scrollingElement ? { top: 0, bottom: innerHeight } : scrollTarget.getBoundingClientRect()
    const list = element.getBoundingClientRect()
    let top = Math.max(list.top, viewport.top, 0), bottom = Math.min(list.bottom, viewport.bottom, innerHeight)
    // The last reachable track sits above the player and navigation; in landscape the nav sits beside the list.
    controls ??= [...document.querySelectorAll('.mini-player, .bottom-nav'), ...element.querySelectorAll('.track-selection-bar')]
    for (const control of controls) {
      const rect = control.getBoundingClientRect()
      if (pointX < rect.left || pointX > rect.right || !rect.height) continue
      if (control.matches('.track-selection-bar')) top = Math.max(top, rect.bottom)
      else if (rect.top > viewport.top) bottom = Math.min(bottom, rect.top)
    }
    if (pointX < list.left || pointX > list.right || pointY < top) return
    const zone = Math.min(52, (bottom - top) / 5)
    const bottomEdge = pointY > bottom - zone
    if (bottomEdge && list.bottom - bottom <= zone * 2 && !loadingMore && source?.loadMore && lastRequestedOrder !== range.order) {
      const revision = ++loadRevision
      lastRequestedOrder = range.order
      loadingMore = true
      void source.loadMore().then(loaded => {
        if (revision !== loadRevision) return
        loadingMore = false
        if (!range || !loaded) return
        if (!extendOrder()) { finish(true); return }
        hit()
        if (!frame) frame = requestAnimationFrame(edge)
      }).catch(() => { if (revision === loadRevision) loadingMore = false })
    }
    if (pointY > bottom) return
    const depth = pointY < top + zone ? (top + zone - pointY) / zone : pointY > bottom - zone ? (pointY - bottom + zone) / zone : 0
    if (!depth) { lastFrameAt = 0; return }
    const elapsed = lastFrameAt ? Math.min(48, timestamp - lastFrameAt) : 16.7
    lastFrameAt = timestamp
    const speed = Math.sign(pointY < top + zone ? -1 : 1) * Math.max(1, Math.round(520 * Math.min(1, depth) * elapsed / 1000))
    const prev = scrollTarget.scrollTop
    scrollTarget.scrollTop += speed
    if (prev !== scrollTarget.scrollTop) { hit(); frame = requestAnimationFrame(edge) }
  }
  function activate() {
    if (!touch || !source || touch.source !== source || !touch.row.isConnected || element.closest('[inert]')) return finish(false)
    const order = source.order(), positions = new Map(order.map((key, i) => [key, i]))
    const anchor = positions.get(touch.startKey)
    if (anchor === undefined) return finish(false)
    const initial = new Set(source.selected())
    range = { initial, current: new Set(initial), order, positions, anchor, end: -1, low: anchor, high: anchor, adding: !initial.has(touch.startKey) }
    element.dataset.rangeSelecting = ''; blockClick = true
    source.start?.(); apply(anchor)
    for (let node: Element | null = element; node; node = node.parentElement) {
      if (node.scrollHeight > node.clientHeight && /auto|scroll/.test(getComputedStyle(node).overflowY)) { scrollTarget = node; break }
    }
    scrollTarget ??= document.scrollingElement || undefined
  }
  function start(event: TouchEvent) {
    finish(true); blockClick = false
    if (!source || event.touches.length !== 1 || element.closest('[inert]')) return
    const target = event.target as Element, row = target.closest<HTMLElement>(rowSelector)
    if (!row || !element.contains(row) || row.getAttribute('aria-disabled') === 'true') return
    const control = target.closest(excluded)
    if (control && control !== row && !control.matches(handle)) return
    const finger = event.touches[0]!
    touch = { id: finger.identifier, x: finger.clientX, y: finger.clientY, row, source, startKey: row.dataset.rangeKey! }
    pointX = finger.clientX; pointY = finger.clientY
    timer = setTimeout(activate, 420)
  }
  function move(event: TouchEvent) {
    if (!touch) return
    const finger = event.touches[0]
    if (event.touches.length !== 1 || finger?.identifier !== touch.id) return finish(true)
    pointX = finger.clientX; pointY = finger.clientY
    if (!range) {
      if (Math.hypot(pointX - touch.x, pointY - touch.y) > 9) finish(false)
      return
    }
    if (event.cancelable) event.preventDefault()
    hit(); if (!frame) frame = requestAnimationFrame(edge)
  }
  function end(event: TouchEvent) {
    if (!touch || !Array.from(event.changedTouches).some(p => p.identifier === touch!.id)) return
    if (range && event.cancelable) event.preventDefault()
    finish(event.type === 'touchcancel')
  }
  function cancel() { finish(true) }
  function scroll() { if (touch && !range) finish(false) }
  function click(event: MouseEvent) {
    if (blockClick && event.detail !== 0) { blockClick = false; event.preventDefault(); event.stopImmediatePropagation() }
  }
  function key(event: KeyboardEvent) { if (range && event.key === 'Escape') { event.preventDefault(); event.stopPropagation(); cancel() } }
  function context(event: Event) { if (touch || range) { event.preventDefault(); event.stopImmediatePropagation() } }
  function visibility() { if (document.hidden) cancel() }
  element.addEventListener('touchstart', start, { passive: true })
  element.addEventListener('touchmove', move, { passive: false })
  element.addEventListener('touchend', end, { passive: false })
  element.addEventListener('touchcancel', end)
  element.addEventListener('contextmenu', context, true)
  element.addEventListener('click', click, true)
  window.addEventListener('blur', cancel); window.addEventListener('scroll', scroll, true)
  document.addEventListener('visibilitychange', visibility); document.addEventListener('keydown', key, true)
  return {
    update(next: Binding) { if (source !== next) { finish(false); source = next; if (source) element.dataset.rangeSelect = ''; else delete element.dataset.rangeSelect } },
    dispose() {
      finish(false); delete element.dataset.rangeSelect; element.removeEventListener('touchstart', start); element.removeEventListener('touchmove', move)
      element.removeEventListener('touchend', end); element.removeEventListener('touchcancel', end)
      element.removeEventListener('contextmenu', context, true); element.removeEventListener('click', click, true)
      window.removeEventListener('blur', cancel); window.removeEventListener('scroll', scroll, true); document.removeEventListener('visibilitychange', visibility); document.removeEventListener('keydown', key, true)
    },
  }
}

export const vRangeSelect: ObjectDirective<HTMLElement, Binding> = {
  mounted(el, { value }) { controllers.set(el, bind(el, value)) },
  updated(el, { value }) { controllers.get(el)?.update(value) },
  beforeUnmount(el) { controllers.get(el)?.dispose(); controllers.delete(el) },
}
