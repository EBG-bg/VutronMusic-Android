import { computed, nextTick, onBeforeUnmount, ref, watch, type Ref } from 'vue'

interface Gesture {
  kind: 'touch' | 'pointer'
  id: number
  x: number
  y: number
  target: Element
  current: string
  claimed: boolean
}

/** Preserve the finger's last position before Vue starts its outgoing transform transition. */
export function prepareNavigationSwipeLeave(element: Element, distance: number) {
  element.removeAttribute('data-swiping')
  if (!distance || !(element instanceof HTMLElement)) return
  element.style.setProperty('--page-leave-start', distance + 'px')
  element.style.setProperty('--page-leave-end', distance + Math.sign(distance) * 48 + 'px')
  element.style.translate = 'none'
  element.style.transform = `translateX(${distance}px)`
  element.style.transition = 'none'
  // Commit the same visual position while switching from translate to transform.
  // Otherwise Chromium interpolates from the previous transform(0), producing a jump.
  element.getBoundingClientRect()
  queueMicrotask(() => { element.style.removeProperty('transform'); element.style.removeProperty('transition') })
}

/** Taps and vertical scrolling stay with the surface; only a clear horizontal drag changes its tabs. */
export function useMainNavigationSwipe<T extends string>(
  tabs: Readonly<Ref<readonly T[]>>,
  current: Readonly<Ref<string>>,
  enabled: () => boolean,
  navigate: (tab: T) => void,
  options: { allowLyrics?: () => boolean; yieldAtBoundary?: () => boolean } = {},
) {
  const offset = ref(0), holding = ref(false), position = ref<number>(), releasedOffset = ref(0)
  let gesture: Gesture | undefined
  let suppressClick = false
  const style = computed(() => ({ '--page-swipe-x': offset.value ? `${offset.value}px 0` : 'none' }))

  function detach() {
    document.removeEventListener('pointermove', pointerMove)
    document.removeEventListener('pointerup', pointerEnd)
    document.removeEventListener('pointercancel', cancel)
    document.removeEventListener('visibilitychange', visibility)
    window.removeEventListener('blur', cancel)
    window.removeEventListener('resize', cancel)
  }
  function reset() { gesture = undefined; offset.value = 0; holding.value = false; position.value = undefined; detach() }
  function cancel() { if (gesture?.claimed) suppressClick = true; reset() }
  function visibility() { if (document.visibilityState !== 'visible') cancel() }
  function begin(kind: Gesture['kind'], id: number, x: number, y: number, event: Event) {
    cancel(); suppressClick = false; releasedOffset.value = 0
    if (!enabled() || event.defaultPrevented || !tabs.value.includes(current.value as T)) return
    const target = event.target as Element | null
    if (!target?.closest || target.closest('[inert],input,textarea,select,[contenteditable]:not([contenteditable=false]),[role=slider],[role=textbox],video,.thumb-range,.lyric-offset-control,.offset-slider,.arc-wheel-control,.hero-carousel,.plugin-result-strip,.plugin-banners,.sort-handle,.playlist-drag-handle,.plugin-order-handle,.plugin-priority-handle,.custom-playlists,[data-sheet-drag-handle],[data-no-page-swipe],[draggable=true]')) return
    if (!options.allowLyrics?.() && target.closest('.original-lyrics-view')) return
    for (let node: Element | null = target; node && !node.classList.contains('page-stage'); node = node.parentElement) {
      if (node.scrollWidth > node.clientWidth + 2 && /auto|scroll/.test(getComputedStyle(node).overflowX)) return
    }
    gesture = { kind, id, x, y, target, current: current.value, claimed: false }
    document.addEventListener('visibilitychange', visibility)
    window.addEventListener('blur', cancel)
    window.addEventListener('resize', cancel)
    if (kind === 'pointer') {
      document.addEventListener('pointermove', pointerMove, { passive: false })
      document.addEventListener('pointerup', pointerEnd)
      document.addEventListener('pointercancel', cancel)
    }
  }
  function start(event: TouchEvent) {
    if (event.touches.length !== 1) { cancel(); return }
    const touch = event.touches[0]!
    begin('touch', touch.identifier, touch.clientX, touch.clientY, event)
  }
  function pointerStart(event: PointerEvent) {
    if (event.pointerType === 'touch') return
    if (!event.isPrimary || event.button !== 0) { cancel(); return }
    begin('pointer', event.pointerId, event.clientX, event.clientY, event)
  }
  function update(x: number, y: number, event: Event) {
    const active = gesture
    if (!active) return
    if (!enabled() || current.value !== active.current || active.target.closest('[inert],[data-no-page-swipe]') || event.defaultPrevented) { cancel(); return }
    const dx = x - active.x, dy = y - active.y
    if (!active.claimed) {
      if (Math.max(Math.abs(dx), Math.abs(dy)) < 12) return
      if (Math.abs(dx) < Math.abs(dy) * 1.35) { reset(); return }
      const next = tabs.value.indexOf(active.current as T) + (dx < 0 ? 1 : -1)
      // A nested surface owns its interior pages. At its outer edge leave this
      // same event untouched so the surrounding primary navigation can claim it.
      if (!tabs.value[next] && options.yieldAtBoundary?.()) { reset(); return }
      active.claimed = true; suppressClick = true; holding.value = true
      // A coalesced mouse move may leave its row before the local long-press handler runs.
      active.target.dispatchEvent(new Event('vutron-navigation-swipe', { bubbles: true }))
    }
    if (event.cancelable) event.preventDefault()
    const index = tabs.value.indexOf(active.current as T), next = index + (dx < 0 ? 1 : -1)
    const available = Boolean(tabs.value[next])
    offset.value = Math.max(-innerWidth * .42, Math.min(innerWidth * .42, dx * (available ? .7 : .12)))
    position.value = Math.max(0, Math.min(tabs.value.length - 1, index - dx / Math.max(1, innerWidth * .65)))
  }
  function move(event: TouchEvent) {
    if (!gesture || gesture.kind !== 'touch') return
    if (event.touches.length !== 1 || event.touches[0]!.identifier !== gesture.id) { cancel(); return }
    const touch = event.touches[0]!
    update(touch.clientX, touch.clientY, event)
  }
  function pointerMove(event: PointerEvent) {
    if (gesture?.kind === 'pointer' && event.pointerId === gesture.id) update(event.clientX, event.clientY, event)
  }
  function finish(x: number, y: number, event: Event) {
    const active = gesture
    if (!active) return
    if (active.claimed) update(x, y, event)
    const distance = x - active.x
    const next = gesture?.claimed && enabled() && Math.abs(distance) >= Math.min(80, innerWidth * .2)
      ? tabs.value[tabs.value.indexOf(active.current as T) + (distance < 0 ? 1 : -1)] : undefined
    releasedOffset.value = next ? offset.value : 0
    reset()
    if (next) { navigate(next); void nextTick(() => { releasedOffset.value = 0 }) }
  }
  function end(event: TouchEvent) {
    if (gesture?.kind !== 'touch') return
    const touch = [...event.changedTouches].find(touch => touch.identifier === gesture!.id)
    if (touch) finish(touch.clientX, touch.clientY, event)
    else cancel()
  }
  function pointerEnd(event: PointerEvent) {
    if (gesture?.kind === 'pointer' && event.pointerId === gesture.id) finish(event.clientX, event.clientY, event)
  }
  function click(event: MouseEvent) {
    if (!suppressClick || event.detail === 0) return
    suppressClick = false; event.preventDefault(); event.stopImmediatePropagation()
  }
  function dragStart(event: DragEvent) { if (gesture && (event.target as Element)?.closest('img')) event.preventDefault() }
  watch([current, () => tabs.value.join('\0'), enabled], cancel, { flush: 'sync' })
  onBeforeUnmount(() => { reset(); suppressClick = false })
  return { style, holding, position, releasedOffset, start, move, end, pointerStart, pointerMove, pointerEnd, cancel, click, dragStart }
}
