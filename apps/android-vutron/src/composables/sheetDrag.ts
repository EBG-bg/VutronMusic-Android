import { onBeforeUnmount, watch, type Ref } from 'vue'
import { reducedMotion } from '../platform/motion'

/** Shared downward dismissal. Scrolled content and value controls keep their gestures. */
export function useSheetDrag(element: Ref<HTMLElement | undefined>, options: { close(): void; enabled?: () => boolean }) {
  let detach: (() => void) | undefined
  let animation: Animation | undefined
  let closing = false
  let suppressClickUntil = 0
  let state: { id: number; touch:boolean; x: number; y: number; at: number; dy: number; active: boolean; scroller: HTMLElement; handle: boolean; transform: string; priority: string } | undefined
  const enabled = () => options.enabled?.() !== false && !!element.value && !element.value.closest('[inert]')
  function restore(panel: HTMLElement, saved: NonNullable<typeof state>) {
    if (saved.transform) panel.style.setProperty('transform', saved.transform, saved.priority)
    else panel.style.removeProperty('transform')
    panel.removeAttribute('data-sheet-dragging')
  }
  function reset(keepClosing = false) {
    if (!keepClosing || !closing) { animation?.cancel(); animation = undefined }
    const saved = state, panel = element.value; state = undefined
    if (saved && panel) {
      if (!saved.touch && panel.hasPointerCapture(saved.id)) panel.releasePointerCapture(saved.id)
      restore(panel, saved)
    }
  }
  function scrollerFor(target: HTMLElement, panel: HTMLElement) {
    for (let node: HTMLElement | null = target; node && node !== panel; node = node.parentElement) {
      if (/(auto|scroll)/.test(getComputedStyle(node).overflowY) && node.scrollHeight > node.clientHeight) return node
    }
    return panel
  }
  function begin(target: HTMLElement, x: number, y: number, id: number, touch: boolean) {
    const panel = element.value
    if (!panel || !enabled() || state
      || target.closest('input,textarea,select,a,[role="slider"],[contenteditable="true"],.thumb-range,.offset-slider,.arc-wheel-control,[data-sheet-no-drag]')) return
    const scroller = scrollerFor(target, panel), handle = !!target.closest('[data-sheet-drag-handle]')
    if (!handle && scroller.scrollTop > 1) return
    animation?.cancel(); animation = undefined
    closing = false
    state = { id, touch, x, y, at:performance.now(), dy:0, active:false, scroller, handle,
      transform:panel.style.getPropertyValue('transform'), priority:panel.style.getPropertyPriority('transform') }
  }
  function down(event: PointerEvent) {
    if (event.pointerType !== 'touch' && event.isPrimary && event.button === 0) begin(event.target as HTMLElement,event.clientX,event.clientY,event.pointerId,false)
  }
  function touchStart(event: TouchEvent) {
    if (event.touches.length !== 1) { reset(); return }
    const touch=event.touches[0]
    begin(event.target as HTMLElement,touch.clientX,touch.clientY,touch.identifier,true)
  }
  function moved(x: number, y: number, event: Event) {
    const saved = state, panel = element.value
    if (!saved || !panel) return
    if (!enabled()) { reset(); return }
    const dx = x - saved.x, dy = y - saved.y
    if (!saved.active) {
      if (dy < -7 || Math.abs(dx) > Math.abs(dy) + 7 || !saved.handle && saved.scroller.scrollTop > 1) { reset(); return }
      if (dy < 8) return
      saved.active = true
      if (!saved.touch) panel.setPointerCapture(saved.id)
      panel.setAttribute('data-sheet-dragging', '')
    }
    if (event.cancelable) event.preventDefault()
    saved.dy = Math.max(0, dy)
    panel.style.transform = `translate3d(0, ${saved.dy}px, 0)`
  }
  function move(event: PointerEvent) { if (state && !state.touch && state.id === event.pointerId) moved(event.clientX, event.clientY, event) }
  function touchMove(event: TouchEvent) {
    if (state?.touch && event.touches.length === 1) moved(event.touches[0].clientX, event.touches[0].clientY, event)
  }
  function end(event: Event, id: number, cancelled: boolean) {
    const saved = state, panel = element.value
    if (!saved || saved.id !== id || !panel) return
    state = undefined
    if (!saved.touch && panel.hasPointerCapture(saved.id)) panel.releasePointerCapture(saved.id)
    if (!saved.active) { restore(panel, saved); return }
    suppressClickUntil = performance.now() + 400
    if (event.cancelable) event.preventDefault()
    const distance = Math.min(120, Math.max(64, panel.offsetHeight * .2))
    const velocity = saved.dy / Math.max(1, performance.now() - saved.at)
    const close = !cancelled && enabled() && (saved.dy >= distance || saved.dy >= 36 && velocity > .55)
    closing = close
    const from = `translate3d(0, ${saved.dy}px, 0)`
    restore(panel, saved)
    animation?.cancel()
    animation = panel.animate([{ transform:from }, { transform:close ? `translate3d(0, ${panel.offsetHeight + 32}px, 0)` : 'translate3d(0, 0, 0)' }],
      { duration:reducedMotion.value ? 0 : close ? 200 : 180, easing:'cubic-bezier(.2,.7,.25,1)', fill:close ? 'forwards' : 'none' })
    if (close) options.close()
  }
  function pointerEnd(event: PointerEvent) { if (!state?.touch) end(event,event.pointerId,event.type==='pointercancel') }
  function touchEnd(event: TouchEvent) {
    if (state?.touch && Array.from(event.changedTouches).some(touch=>touch.identifier===state?.id)) end(event,state.id,event.type==='touchcancel')
  }
  function click(event: MouseEvent) { if (performance.now() < suppressClickUntil) { event.preventDefault(); event.stopImmediatePropagation() } }
  function lost(event: PointerEvent) { if (state && !state.touch && state.id === event.pointerId) reset() }
  function visibility() { if (document.visibilityState === 'hidden') reset() }
  watch(element, panel => {
    detach?.(); detach = undefined; reset(true)
    if (!panel) return
    panel.addEventListener('pointerdown', down)
    panel.addEventListener('pointermove', move)
    panel.addEventListener('pointerup', pointerEnd)
    panel.addEventListener('pointercancel', pointerEnd)
    panel.addEventListener('lostpointercapture', lost)
    panel.addEventListener('touchstart', touchStart, { passive:true })
    document.addEventListener('touchmove', touchMove, { passive:false })
    document.addEventListener('touchend', touchEnd, { passive:false })
    document.addEventListener('touchcancel', touchEnd, { passive:false })
    panel.addEventListener('click', click, true)
    document.addEventListener('visibilitychange', visibility)
    detach = () => {
      panel.removeEventListener('pointerdown', down); panel.removeEventListener('pointermove', move)
      panel.removeEventListener('pointerup', pointerEnd); panel.removeEventListener('pointercancel', pointerEnd)
      panel.removeEventListener('lostpointercapture', lost); panel.removeEventListener('touchstart', touchStart)
      document.removeEventListener('touchmove', touchMove); document.removeEventListener('touchend', touchEnd); document.removeEventListener('touchcancel', touchEnd)
      panel.removeEventListener('click', click, true)
      document.removeEventListener('visibilitychange', visibility)
    }
  }, { flush:'post' })
  watch(() => options.enabled?.() !== false, value => { if (!value && !closing) reset() })
  watch(reducedMotion, value => { if (value) { animation?.finish() } })
  onBeforeUnmount(() => { detach?.(); reset(true) })
}
