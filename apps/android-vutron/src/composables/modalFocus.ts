import { nextTick, onMounted, onUnmounted, watch, type Ref } from 'vue'

/** Keyboard/focus behavior shared by bottom sheets. A nested confirmation can suspend it. */
export function useModalFocus(element: Ref<HTMLElement | undefined>, options: {
  close(): void
  enabled?: () => boolean
  open?: () => boolean
  returnFocus?: () => HTMLElement | undefined
  restore?: boolean
}) {
  let previous: HTMLElement | undefined
  let lastInside: HTMLElement | undefined
  let mounted = false
  let listening = false
  const active = () => mounted && options.open?.() !== false && options.enabled?.() !== false && !!element.value && !element.value.closest('[inert]')
  function rememberFocus() {
    previous = options.returnFocus?.() ?? (document.activeElement instanceof HTMLElement ? document.activeElement : undefined)
    lastInside = undefined
  }
  function restoreFocus() {
    if (options.restore !== false && previous?.isConnected && !previous.closest('[inert]')) previous.focus({ preventScroll: true })
  }
  function controls() {
    return [...Array.from(element.value?.querySelectorAll<HTMLElement>('button,input,select,textarea,a[href],summary,[tabindex]') ?? []),
      ...Array.from(document.querySelectorAll<HTMLElement>('[data-ui-notification] button'))]
      .filter(item => item.tabIndex >= 0 && !item.matches(':disabled') && !item.closest('[inert]') && item.getClientRects().length > 0)
  }
  function focusInside() {
    if (!active()) return
    const saved = lastInside?.isConnected && element.value?.contains(lastInside) && !lastInside.matches(':disabled') ? lastInside : undefined
    ;(saved ?? controls()[0] ?? element.value)?.focus({ preventScroll: true })
  }
  function key(event: KeyboardEvent) {
    if (!active()) return
    if (event.key === 'Escape') { if (event.target instanceof Element && event.target.closest('[data-ui-notification]')) return; event.preventDefault(); event.stopImmediatePropagation(); options.close(); return }
    if (event.key !== 'Tab') return
    const row = (event.target as HTMLElement).closest<HTMLElement>('[data-windowed-index]')
    if (row) {
      const index = Number(row.getAttribute('aria-posinset')), total = Number(row.getAttribute('aria-setsize'))
      const rowControls = Array.from(row.querySelectorAll<HTMLElement>('button,input,select,textarea,a[href],summary,[tabindex]'))
        .filter(item => item.tabIndex >= 0 && !item.matches(':disabled') && !item.closest('[inert]') && item.getClientRects().length > 0)
      // The list mounts its next logical row on Tab. A viewport boundary is
      // not the dialog boundary while another logical row exists beyond it.
      if (event.shiftKey ? index > 1 && document.activeElement === rowControls[0]
        : index < total && document.activeElement === rowControls.at(-1)) return
    }
    const items = controls(), first = items[0], last = items.at(-1)
    if (!first) { event.preventDefault(); element.value?.focus({ preventScroll: true }); return }
    if (items.some(item => item.closest('[data-ui-notification]'))) {
      const index = items.indexOf(document.activeElement as HTMLElement)
      event.preventDefault(); items[(index + (event.shiftKey ? -1 : 1) + items.length) % items.length]?.focus(); return
    }
    const outside = !element.value?.contains(document.activeElement) || document.activeElement === element.value
    if (event.shiftKey && (document.activeElement === first || outside)) { event.preventDefault(); last?.focus() }
    else if (!event.shiftKey && (document.activeElement === last || outside)) { event.preventDefault(); first.focus() }
  }
  function focused(event: FocusEvent) {
    if (!active()) return
    if (event.target instanceof HTMLElement && element.value?.contains(event.target)) lastInside = event.target
    else if (event.target instanceof Element && event.target.closest('[data-ui-notification]')) return
    else focusInside()
  }
  function syncListeners() {
    const listen = mounted && options.open?.() !== false && options.enabled?.() !== false && Boolean(element.value)
    if (listen === listening) return
    listening = listen
    if (listen) {
      document.addEventListener('keydown', key, true)
      document.addEventListener('focusin', focused, true)
    } else {
      document.removeEventListener('keydown', key, true)
      document.removeEventListener('focusin', focused, true)
    }
  }
  watch([element, () => options.enabled?.() !== false, () => options.open?.() !== false], syncListeners, { flush: 'post' })
  watch(() => options.enabled?.() !== false, async enabled => {
    if (enabled && mounted) { await nextTick(); focusInside() }
  }, { flush: 'post' })
  watch(() => options.open?.() !== false, async open => {
    if (!mounted) return
    if (open) { rememberFocus(); await nextTick(); focusInside() }
    else { await nextTick(); restoreFocus() }
  }, { flush: 'post' })
  onMounted(async () => {
    if (options.open?.() !== false) rememberFocus()
    mounted = true
    syncListeners()
    await nextTick(); focusInside()
  })
  onUnmounted(() => {
    mounted = false
    syncListeners()
    restoreFocus()
  })
}
