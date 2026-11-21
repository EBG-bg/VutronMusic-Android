<script setup lang="ts" generic="T">
import { computed, inject, nextTick, onBeforeUnmount, onMounted, ref, shallowRef, watch } from 'vue'
import { MeasuredTrackHeights, peekWindowedPreview, readWindowedViewState, saveWindowedViewState, type WindowedScrollPosition } from '../composables/windowedTracks'
import { navigationPreviewKey } from '../composables/navigationPreview'
import { reducedMotion } from '../platform/motion'

const props = withDefaults(defineProps<{
  items: readonly T[]
  itemKey: (item: T, index: number) => string | number
  enabled?: boolean
  estimatedHeight?: number
  overscan?: number
  gap?: number
  scrollTarget?: 'window' | HTMLElement | null
  initialIndex?: number
  initialPosition?: WindowedScrollPosition
  pinnedIndex?: number
  animateChanges?: boolean
  stateKey?: string
  restoreReady?: boolean
  selectionRevision?: number
}>(), { enabled: true, estimatedHeight: 70, overscan: 480, gap: 6, scrollTarget: 'window', restoreReady: true })
const preview = inject(navigationPreviewKey, false)
const root = ref<HTMLElement>()
const measured = new Map<string | number, number>()
const model = shallowRef(new MeasuredTrackHeights([], props.estimatedHeight))
const revision = ref(0), localTop = ref(0), viewportHeight = ref(800), focusedIndex = ref(-1)
const elements = new Map<number, HTMLElement>()
const animateRows = ref(false)
let animationTimer: ReturnType<typeof setTimeout> | undefined
let observer: ResizeObserver | undefined, target: Window | HTMLElement | undefined, frame = 0, disposed = false
let scrollAnimation = 0, finishScroll: (() => void) | undefined
let activeStateKey = '', mounted = false, pendingPosition: WindowedScrollPosition | undefined, restoreRevision = 0
const windowed = computed(() => !preview && props.enabled && props.items.length > 60)
const totalHeight = computed(() => { revision.value; return model.value.total })
const range = computed(() => {
  revision.value
  if (!windowed.value) return { start: 0, end: props.items.length }
  return {
    start: model.value.indexAt(Math.max(0, localTop.value - props.overscan)),
    end: Math.min(props.items.length, model.value.indexAt(Math.max(0, localTop.value + viewportHeight.value + props.overscan)) + 1)
  }
})
const previewWindow = ref({ start: 0, padding: 0 })
const rendered = computed(() => {
  if (preview) {
    const { start, padding } = previewWindow.value
    return props.items.slice(start, start + 24).map((item, i) => ({ item, index: start + i,
      key: props.itemKey(item, start + i), before: i === 0 ? padding : 0, selectionRevision: props.selectionRevision ?? 0 }))
  }
  revision.value
  const { start, end } = range.value, indices = Array.from({ length: Math.max(0, end - start) }, (_, i) => start + i)
  if (windowed.value) for (const index of [focusedIndex.value, props.pinnedIndex ?? -1]) {
    if (index >= 0 && index < props.items.length && (index < start || index >= end) && !indices.includes(index)) indices.push(index)
  }
  indices.sort((a, b) => a - b)
  return indices.map((index, i) => ({ index, item: props.items[index]!, key: props.itemKey(props.items[index]!, index), selectionRevision: props.selectionRevision ?? 0,
    before: windowed.value ? model.value.offset(index) - model.value.offset(i ? indices[i - 1]! + 1 : 0) : 0 }))
})
const bottom = computed(() => {
  revision.value
  return windowed.value ? Math.max(0, model.value.total - model.value.offset((rendered.value.at(-1)?.index ?? -1) + 1)) : 0
})
function scrollOffset() { return target === window ? window.scrollY : (target as HTMLElement | undefined)?.scrollTop ?? 0 }
function listOrigin() {
  if (!root.value) return 0
  const rect = root.value.getBoundingClientRect()
  return target === window ? rect.top + window.scrollY : rect.top - (target as HTMLElement).getBoundingClientRect().top + scrollOffset() - (target as HTMLElement).clientTop
}
function updateViewport() {
  if (!root.value || !target || props.scrollTarget === null) return
  localTop.value = scrollOffset() - listOrigin()
  viewportHeight.value = target === window ? window.innerHeight : (target as HTMLElement).clientHeight
}
function scheduleViewport() {
  if (!frame) frame = requestAnimationFrame(() => { frame = 0; updateViewport() })
}
function scroll(top: number, behavior: ScrollBehavior = 'instant') {
  target?.scrollTo({ top, behavior: reducedMotion.value ? 'instant' : behavior })
  if (behavior !== 'smooth' || reducedMotion.value) updateViewport()
}
async function scrollToIndex(index: number, options: { align?: 'start' | 'center' | 'end' | 'nearest'; behavior?: ScrollBehavior } = {}) {
  pendingPosition = undefined; restoreRevision++
  await nextTick()
  if (disposed || !props.items.length) return
  cancelSmoothScroll()
  updateViewport()
  const row = Math.max(0, Math.min(index, props.items.length - 1)), start = model.value.offset(row), end = model.value.offset(row + 1)
  const align = options.align ?? 'nearest', top = localTop.value, height = viewportHeight.value
  if (align === 'nearest' && start >= top && end <= top + height) return
  const destination = () => {
    const first = model.value.offset(row), last = model.value.offset(row + 1)
    const offset = align === 'center' ? (first + last - height) / 2 : align === 'end' || align === 'nearest' && first > top ? last - height : first
    return listOrigin() + offset
  }
  if (options.behavior !== 'smooth' || reducedMotion.value) { scroll(destination()); return }
  const from = scrollOffset(), at = performance.now()
  // Native smooth scrolling can be cancelled by correcting newly measured rows
  // above it. Recompute the destination during this short shared-motion animation.
  await new Promise<void>(resolve => {
    finishScroll = resolve
    const step = (now: number) => {
      const progress = Math.min(1, (now - at) / 320), eased = 1 - (1 - progress) ** 3
      scroll(from + (destination() - from) * eased)
      if (progress < 1 && !reducedMotion.value) scrollAnimation = requestAnimationFrame(step)
      else { scrollAnimation = 0; finishScroll = undefined; scroll(destination()); resolve() }
    }
    scrollAnimation = requestAnimationFrame(step)
  })
}
function cancelSmoothScroll() {
  if (scrollAnimation) cancelAnimationFrame(scrollAnimation)
  scrollAnimation = 0; finishScroll?.(); finishScroll = undefined
}
function interruptScroll() { cancelSmoothScroll(); pendingPosition = undefined; restoreRevision++ }
function setRow(element: unknown, index: number) {
  const previous = elements.get(index)
  if (previous === element) return
  if (previous) { observer?.unobserve(previous); elements.delete(index) }
  if (element instanceof HTMLElement) { elements.set(index, element); observer?.observe(element) }
}
function measure(entries: ResizeObserverEntry[]) {
  const anchor = model.value.indexAt(Math.max(0, localTop.value)), before = model.value.offset(anchor)
  let changed = false
  for (const entry of entries) {
    if (entry.target === root.value) { scheduleViewport(); continue }
    const index = Number((entry.target as HTMLElement).dataset.windowedIndex), key = model.value.keys[index]
    const height = entry.borderBoxSize?.[0]?.blockSize ?? entry.target.getBoundingClientRect().height
    if (key !== undefined && model.value.update(index, height)) { measured.set(key, height); changed = true }
  }
  if (!changed) return
  revision.value++
  const delta = model.value.offset(anchor) - before
  if (windowed.value && localTop.value > 0 && delta && !scrollAnimation) scroll(scrollOffset() + delta)
}
function bindTarget() {
  target?.removeEventListener('scroll', scheduleViewport)
  target?.removeEventListener('wheel', interruptScroll); target?.removeEventListener('touchstart', interruptScroll)
  target = !props.scrollTarget || props.scrollTarget === 'window' ? window : props.scrollTarget
  target.addEventListener('scroll', scheduleViewport, { passive: true })
  target.addEventListener('wheel', interruptScroll, { passive: true }); target.addEventListener('touchstart', interruptScroll, { passive: true })
  updateViewport()
}
function refresh() { updateViewport(); if (root.value) for (const row of elements.values()) observer?.observe(row) }
function focusIn(event: FocusEvent) {
  const row = (event.target as Element).closest<HTMLElement>('[data-windowed-index]')
  focusedIndex.value = row ? Number(row.dataset.windowedIndex) : -1
}
function focusOut() { void nextTick(() => { if (!root.value?.contains(document.activeElement)) focusedIndex.value = -1 }) }
const focusable = (row: HTMLElement) => Array.from(row.querySelectorAll<HTMLElement>('button:not(:disabled),a[href],input:not(:disabled),[tabindex="0"]')).filter(item => !item.closest('[inert]'))
async function keydown(event: KeyboardEvent) {
  if (!windowed.value || event.altKey || event.metaKey || event.ctrlKey || (event.target as Element).matches('input,textarea,select,[contenteditable="true"]')) return
  const row = (event.target as Element).closest<HTMLElement>('[data-windowed-index]')
  if (!row) return
  const index = Number(row.dataset.windowedIndex), controls = focusable(row), active = document.activeElement
  let next: number | undefined
  if (event.key === 'ArrowDown') next = index + 1
  else if (event.key === 'ArrowUp') next = index - 1
  else if (event.key === 'Home') next = 0
  else if (event.key === 'End') next = props.items.length - 1
  else if (event.key === 'Tab') {
    const edge = event.shiftKey ? controls[0] : controls.at(-1), candidate = index + (event.shiftKey ? -1 : 1)
    if (active === edge && !elements.has(candidate)) next = candidate
  }
  if (next === undefined || next < 0 || next >= props.items.length) return
  event.preventDefault()
  const controlIndex = event.key === 'Tab' ? event.shiftKey ? -1 : 0 : Math.max(0, controls.indexOf(active as HTMLElement))
  focusedIndex.value = next
  await scrollToIndex(next)
  await nextTick()
  const nextControls = elements.get(next) ? focusable(elements.get(next)!) : []
  ;(controlIndex < 0 ? nextControls.at(-1) : nextControls[Math.min(controlIndex, nextControls.length - 1)])?.focus({ preventScroll: true })
}
function rememberView() {
  if (activeStateKey && root.value && target) {
    updateViewport()
    const position = localTop.value >= 0 ? captureScrollPosition() : undefined
    const start = position ? Math.max(0, position.index - 3) : 0
    saveWindowedViewState(activeStateKey, measured, position,
      position && target === window ? { start, padding: model.value.offset(start), scroll: localTop.value } : undefined)
  }
}
async function restoreCachedPosition() {
  if (!mounted || !pendingPosition || !props.items.length || !props.restoreReady) return
  const position = pendingPosition
  // An unloaded plugin history page can arrive in several provider-owned pages.
  if (!model.value.keys.includes(position.key) && props.items.length <= position.index) return
  const token = ++restoreRevision
  await nextTick(); await nextTick()
  if (disposed || token !== restoreRevision || pendingPosition !== position || !props.restoreReady) return
  pendingPosition = undefined
  await restoreScrollPosition(position)
}
if (!preview) watch([() => props.items, () => props.itemKey, () => props.estimatedHeight, () => props.stateKey], () => {
  if (activeStateKey !== (props.stateKey ?? '')) {
    rememberView(); measured.clear(); restoreRevision++
    activeStateKey = props.stateKey ?? ''
    const previous = activeStateKey ? readWindowedViewState(activeStateKey) : undefined
    if (previous) for (const [key, height] of previous.measured) measured.set(key, height)
    pendingPosition = previous?.position
  }
  const keys = props.items.map(props.itemKey), retained = new Set(keys)
  if (props.animateChanges && (model.value.length || mounted) && (keys.length !== model.value.length || keys.some((key, index) => key !== model.value.keys[index]))) {
    animateRows.value = true; clearTimeout(animationTimer)
    animationTimer = setTimeout(() => { animateRows.value = false }, 260)
  }
  for (const key of measured.keys()) if (!retained.has(key)) measured.delete(key)
  model.value = new MeasuredTrackHeights(keys, props.estimatedHeight, measured)
  if (!target && (props.initialPosition || pendingPosition)) {
    const position = props.initialPosition ?? pendingPosition!
    localTop.value = model.value.offset(position.index) + position.offset
  }
  else if (!target && props.initialIndex !== undefined) localTop.value = Math.max(0, model.value.offset(props.initialIndex) - viewportHeight.value / 2)
  focusedIndex.value = -1
  void nextTick(updateViewport)
  void restoreCachedPosition()
}, { immediate: true })
watch(() => props.scrollTarget, () => { if (target) bindTarget() }, { flush: 'post' })
watch(() => props.restoreReady, ready => { if (ready) void restoreCachedPosition(); else restoreRevision++ })
onMounted(async () => {
  if (preview) {
    const top = Math.max(0, -(root.value?.getBoundingClientRect().top ?? 0))
    if (top > props.estimatedHeight * 4 && props.items.length > 24) {
      const saved = props.stateKey ? peekWindowedPreview(props.stateKey) : undefined
      if (saved && saved.start < props.items.length && Math.abs(saved.scroll - top) <= props.estimatedHeight * 3) previewWindow.value = saved
      else {
        const start = Math.max(0, Math.min(props.items.length - 1, Math.floor(top / props.estimatedHeight)) - 3)
        previewWindow.value = { start, padding: start * props.estimatedHeight }
      }
    }
    return
  }
  mounted = true
  observer = new ResizeObserver(measure)
  for (const row of elements.values()) observer.observe(row)
  bindTarget(); window.addEventListener('resize', scheduleViewport, { passive: true })
  // Width changes (sidebars, text scale, rotation) also change the measured row heights.
  if (root.value) observer.observe(root.value)
  if (props.initialPosition) await restoreScrollPosition(props.initialPosition)
  else if (props.initialIndex !== undefined) await scrollToIndex(props.initialIndex, { align: 'center' })
  else await restoreCachedPosition()
})
onBeforeUnmount(() => {
  rememberView(); restoreRevision++
  disposed = true; observer?.disconnect(); target?.removeEventListener('scroll', scheduleViewport)
  target?.removeEventListener('wheel', interruptScroll); target?.removeEventListener('touchstart', interruptScroll); cancelSmoothScroll()
  clearTimeout(animationTimer)
  window.removeEventListener('resize', scheduleViewport); if (frame) cancelAnimationFrame(frame)
})
function indexAtClientY(y: number) { return model.value.indexAt(y - (root.value?.getBoundingClientRect().top ?? 0)) }
function captureScrollPosition(): WindowedScrollPosition {
  updateViewport()
  const index = model.value.indexAt(Math.max(0, localTop.value))
  return { key: model.value.keys[index] ?? '', index, offset: localTop.value - model.value.offset(index) }
}
async function restoreScrollPosition(position: WindowedScrollPosition) {
  const found = model.value.keys.indexOf(position.key), index = found < 0 ? Math.min(position.index, props.items.length - 1) : found
  await scrollToIndex(index, { align: 'start' })
  if (!disposed && target) scroll(listOrigin() + model.value.offset(index) + position.offset)
}
defineExpose({ scrollToIndex, refresh, indexAtClientY, captureScrollPosition, restoreScrollPosition })
</script>
<template>
  <div ref="root" class="windowed-track-list" role="list" :style="{ '--windowed-gap': `${gap}px`, minHeight: windowed ? `${totalHeight}px` : undefined }" @focusin="focusIn" @focusout="focusOut" @keydown="keydown">
    <TransitionGroup tag="div" name="windowed-row" :css="animateRows && !reducedMotion">
    <template v-for="row in rendered" :key="row.key">
      <div v-if="row.before > 0" :key="`spacer:${row.key}`" class="windowed-spacer" aria-hidden="true" :style="{ height: `${row.before}px` }" />
      <div :ref="element => setRow(element, row.index)" class="windowed-track-item" role="listitem" :aria-posinset="row.index + 1" :aria-setsize="items.length" :data-windowed-index="row.index" :data-selection-revision="row.selectionRevision"><slot :item="row.item" :index="row.index" /></div>
    </template>
    <div v-if="bottom > 0" key="bottom-spacer" class="windowed-spacer" aria-hidden="true" :style="{ height: `${bottom}px` }" />
    </TransitionGroup>
  </div>
</template>
<style scoped>
.windowed-track-list { display: block; min-width: 0; overflow-anchor: none; }
.windowed-track-item { min-width: 0; display: flow-root; padding-bottom: var(--windowed-gap); box-sizing: border-box; }
.windowed-track-item:last-child { padding-bottom: 0; }
.windowed-spacer { width: 1px; pointer-events: none; }
.windowed-row-move, .windowed-row-enter-active, .windowed-row-leave-active { transition: opacity 180ms ease-out, transform 240ms ease-out; }
.windowed-row-enter-from, .windowed-row-leave-to { opacity: 0; transform: translateX(16px); }
.windowed-row-leave-active { position: absolute; left: 0; right: 0; pointer-events: none; }
html[data-motion="reduced"] :is(.windowed-row-move, .windowed-row-enter-active, .windowed-row-leave-active) { transition: none; }
</style>
