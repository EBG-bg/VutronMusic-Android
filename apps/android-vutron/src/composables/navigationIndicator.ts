import { computed, nextTick, onBeforeUnmount, shallowRef, watch, type Ref } from 'vue'

/** Measure on layout changes, then interpolate cached button geometry during a drag. */
export function useNavigationIndicator(root: Readonly<Ref<HTMLElement | undefined>>, position: Readonly<Ref<number>>, count: Readonly<Ref<number>>) {
  const geometry = shallowRef<{ x: number; y: number; width: number; height: number }[]>([])
  let observer: ResizeObserver | undefined
  let disposed = false
  function measure() {
    geometry.value = [...root.value?.querySelectorAll<HTMLElement>(':scope > button') ?? []]
      .map(button => ({ x: button.offsetLeft, y: button.offsetTop, width: button.offsetWidth, height: button.offsetHeight }))
  }
  watch([root, count], async () => {
    await nextTick()
    if (disposed) return
    observer?.disconnect()
    if (!root.value) { geometry.value = []; return }
    observer ??= new ResizeObserver(measure)
    observer.observe(root.value)
    root.value.querySelectorAll(':scope > button').forEach(button => observer!.observe(button))
    measure()
  }, { flush: 'post', immediate: true })
  const style = computed(() => {
    const rows = geometry.value
    if (!rows.length) return { width: '0px', height: '0px', transform: 'translate3d(0,0,0)' }
    const value = Math.max(0, Math.min(rows.length - 1, position.value))
    const before = rows[Math.floor(value)]!, after = rows[Math.ceil(value)]!, part = value % 1
    const lerp = (key: keyof typeof before) => before[key] + (after[key] - before[key]) * part
    return { width: `${lerp('width')}px`, height: `${lerp('height')}px`, transform: `translate3d(${lerp('x')}px,${lerp('y')}px,0)` }
  })
  onBeforeUnmount(() => { disposed = true; observer?.disconnect() })
  return style
}
