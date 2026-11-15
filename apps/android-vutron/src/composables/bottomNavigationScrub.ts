import { onBeforeUnmount, ref, shallowRef, watch, type CSSProperties, type Ref } from 'vue'

interface IndicatorStyle extends CSSProperties { width: string; height: string; transform: string }
interface ButtonGeometry { left: number; top: number; width: number; height: number; center: number }
interface Gesture<T> {
  pointer: number
  x: number
  y: number
  root: HTMLElement
  rootLeft: number
  buttons: ButtonGeometry[]
  tabs: readonly T[]
}

/** Horizontal scrubbing belongs to the whole navigation bar; ordinary taps keep their existing click path. */
export function useBottomNavigationScrub<T extends string>(
  root: Readonly<Ref<HTMLElement | undefined>>,
  tabs: Readonly<Ref<readonly T[]>>,
  current: Readonly<Ref<string>>,
  enabled: () => boolean,
  navigate: (tab: T) => void,
) {
  const dragging = ref(false), previewIndex = ref(-1), indicatorStyle = shallowRef<IndicatorStyle>()
  let gesture: Gesture<T> | undefined
  let suppressClick = false

  function detach() {
    document.removeEventListener('pointermove', move, true)
    document.removeEventListener('pointerup', end, true)
    document.removeEventListener('pointercancel', cancel, true)
    document.removeEventListener('pointerdown', otherPointer, true)
    document.removeEventListener('lostpointercapture', lostCapture, true)
    document.removeEventListener('visibilitychange', visibility)
    window.removeEventListener('blur', cancel)
    window.removeEventListener('resize', cancel)
  }
  function reset() {
    const previous = gesture
    gesture = undefined; dragging.value = false; previewIndex.value = -1; indicatorStyle.value = undefined
    detach()
    if (previous?.root.hasPointerCapture(previous.pointer)) previous.root.releasePointerCapture(previous.pointer)
  }
  function cancel() { if (gesture) suppressClick = true; reset() }
  function otherPointer(event: PointerEvent) { if (gesture && event.pointerId !== gesture.pointer) cancel() }
  function lostCapture(event: PointerEvent) { if (gesture && event.pointerId === gesture.pointer && event.target === gesture.root) cancel() }
  function visibility() { if (document.visibilityState !== 'visible') cancel() }

  function start(event: PointerEvent) {
    if (!event.isPrimary || event.button !== 0) { if (gesture) cancel(); return }
    if (gesture) cancel()
    suppressClick = false
    const element = root.value
    if (!element || !enabled() || !tabs.value.includes(current.value as T)) return
    const buttons = [...element.querySelectorAll<HTMLElement>(':scope > button')]
    if (buttons.length !== tabs.value.length || buttons.some(button => button.offsetWidth <= 0)) return
    const geometry = buttons.map(button => ({ left: button.offsetLeft, top: button.offsetTop,
      width: button.offsetWidth, height: button.offsetHeight, center: button.offsetLeft + button.offsetWidth / 2 }))
    // Landscape uses a vertical navigation rail; retain its normal clicks and scrolling.
    if (geometry.some((button, index) => index > 0 && button.center <= geometry[index - 1]!.center)) return
    const rect = element.getBoundingClientRect()
    gesture = { pointer: event.pointerId, x: event.clientX, y: event.clientY, root: element,
      rootLeft: rect.left, tabs: [...tabs.value], buttons: geometry }
    document.addEventListener('pointermove', move, { capture: true, passive: false })
    document.addEventListener('pointerup', end, true)
    document.addEventListener('pointercancel', cancel, true)
    document.addEventListener('pointerdown', otherPointer, true)
    document.addEventListener('lostpointercapture', lostCapture, true)
    document.addEventListener('visibilitychange', visibility)
    window.addEventListener('blur', cancel)
    window.addEventListener('resize', cancel)
  }
  function preview(clientX: number) {
    if (!gesture) return
    const buttons = gesture.buttons, x = Math.max(buttons[0]!.center, Math.min(buttons.at(-1)!.center, clientX - gesture.rootLeft))
    let right = buttons.findIndex(button => button.center >= x)
    if (right < 0) right = buttons.length - 1
    const left = Math.max(0, right - 1), before = buttons[left]!, after = buttons[right]!
    const ratio = right === left ? 0 : (x - before.center) / (after.center - before.center)
    const interpolate = (field: 'left' | 'top' | 'width' | 'height') => before[field] + (after[field] - before[field]) * ratio
    previewIndex.value = ratio < .5 ? left : right
    indicatorStyle.value = { width: `${interpolate('width')}px`, height: `${interpolate('height')}px`,
      transform: `translate3d(${interpolate('left')}px,${interpolate('top')}px,0)` }
  }
  function move(event: PointerEvent) {
    const active = gesture
    if (!active || event.pointerId !== active.pointer) return
    if (!enabled()) { cancel(); return }
    const x = Math.abs(event.clientX - active.x), y = Math.abs(event.clientY - active.y)
    if (!dragging.value) {
      if (Math.max(x, y) < 10) return
      if (x <= y * 1.25) { cancel(); return }
      dragging.value = true; suppressClick = true
      active.root.setPointerCapture(active.pointer)
    } else if (y > Math.max(28, active.buttons[0]!.height * .65) && y > x) { cancel(); return }
    if (event.cancelable) event.preventDefault()
    preview(event.clientX)
  }
  function end(event: PointerEvent) {
    const active = gesture
    if (!active || event.pointerId !== active.pointer) return
    // Some input backends coalesce the final movement into pointerup.
    if (dragging.value) move(event)
    const target = dragging.value && enabled() ? active.tabs[previewIndex.value] : undefined
    reset()
    if (target && target !== current.value) navigate(target)
  }
  function click(event: MouseEvent) {
    if (!suppressClick || event.detail === 0) return
    suppressClick = false; event.preventDefault(); event.stopImmediatePropagation()
  }
  watch([root, () => tabs.value.join('\0'), current, enabled], cancel, { flush: 'sync' })
  onBeforeUnmount(() => { reset(); suppressClick = false })
  return { dragging, previewIndex, indicatorStyle, start, move, end, cancel, click }
}
