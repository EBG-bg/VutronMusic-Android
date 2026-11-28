<script setup lang="ts">
import { computed, inject, nextTick, onMounted, onUnmounted, ref, watch, type ComponentPublicInstance } from 'vue'
import type { LyricFamily, LyricLine } from '@vutronmusic/core/lyrics'
import { lyricDisplayStyle, type LyricDisplaySettings } from '../platform/lyricDisplay'
import { isMotionReduced } from '../platform/motion'
import { navigationPreviewKey } from '../composables/navigationPreview'
import {
  boundaryScrollRemainder, estimatedLyricWords, interpolatedPosition, lyricClock, lyricDisplayEnd, lyricDisplayLines, lyricIndexAt, lyricLineProgress,
  lyricCenteredScrollTop, lyricSeekPosition, lyricWordProgress, type LyricPlaybackAnchor
} from '../utils/lyricPlayback'

const props = withDefaults(defineProps<{
  family: LyricFamily
  position: number
  playing: boolean
  rate?: number
  offsetMs: number
  duration?: number
  displaySettings?: LyricDisplaySettings
  loop?: LyricPlaybackAnchor['loop']
}>(), { duration: 0, rate: 1 })
const emit = defineEmits<{ seek: [position: number] }>()
const preview = inject(navigationPreviewKey, false)
const container = ref<HTMLElement>()
const activeIndex = ref(-1)
const manualScroll = ref(false)
const pendingLine = ref<number>()
let pendingUntil = 0
let confirmationTimer: ReturnType<typeof setTimeout> | undefined
function clearConfirmation() { clearTimeout(confirmationTimer); confirmationTimer = undefined; pendingLine.value = undefined; pendingUntil = 0 }
const rows: HTMLElement[] = []
const hasWords = computed(() => props.family.original.some(line => line.words.length > 0))
const estimated = computed(() => props.displaySettings?.estimatedWordTiming === true)
const hasEstimates = computed(() => estimated.value && props.family.original.some(line => !line.words.length && line.text))
const displayLines = computed(() => lyricDisplayLines(props.family.original, estimated.value, props.duration))
const displayStyle = computed(() => lyricDisplayStyle(props.displaySettings, 'theme'))

// A peek needs only the lines around the same center as followActive. Avoid
// creating a second scrolling lyric timeline or estimating the whole song.
const previewClock = computed(() => lyricClock(props.position, props.offsetMs))
const previewIndex = computed(() => lyricIndexAt(props.family.original, previewClock.value))
const previewGroups = computed(() => {
  const lines = props.family.original
  const center = Math.max(0, previewIndex.value)
  const first = Math.max(0, center - 8)
  const rows = (start: number, end: number) => lines.slice(start, end).map((line, offset) => {
    const index = start + offset
    if (index === previewIndex.value && estimated.value && !line.words.length && line.text) {
      const end = lyricDisplayEnd(lines, index, props.duration)
      return { index, line: { ...line, end, words: estimatedLyricWords(line, end) } }
    }
    return { index, line }
  })
  return [
    { side: 'before', rows: rows(first, center) },
    { side: 'center', rows: rows(center, center + 1) },
    { side: 'after', rows: rows(center + 1, center + 9) }
  ]
})
function previewProgress(progress: number) { return { '--lyric-progress': progress * 100 + '%' } }
let anchor: LyricPlaybackAnchor = { position: props.position, monotonicTime: performance.now(), playing: props.playing, rate: props.rate, loop: props.loop }
let frame = 0
let mounted = false
let highlightedRow = -1
let highlightedElement: HTMLElement | undefined
let activeWords: HTMLElement[] = []
let activeTranslation: HTMLElement | null = null
const renderedProgress = new WeakMap<HTMLElement, string>()
let followGeneration = 0
let lastFingerY: number | undefined
let fingerStartX = 0, fingerStartY = 0
let touchDirection: 'pending' | 'horizontal' | 'vertical' = 'pending'
let touchPointerMoved = false
let handoffFrame = 0
let handoffRemainder = 0
let handoffWindowY = 0
let layoutFrame = 0
let scrollAnimationFrame = 0
let layoutObserver: ResizeObserver | undefined
let observedRow: HTMLElement | undefined
const observedSizes = new WeakMap<Element, string>()

function cancelScrollAnimation() {
  if (!scrollAnimationFrame) return
  cancelAnimationFrame(scrollAnimationFrame)
  scrollAnimationFrame = 0
}

function animateScrollTop(list: HTMLElement, target: number) {
  cancelScrollAnimation()
  const maxTop = Math.max(0, list.scrollHeight - list.clientHeight)
  const destination = Math.max(0, Math.min(maxTop, target))
  const start = list.scrollTop
  const delta = destination - start
  if (Math.abs(delta) < 1) { list.scrollTop = destination; return }
  const duration = Math.max(240, Math.min(460, 240 + Math.abs(delta) * 0.45))
  const startedAt = performance.now()
  const step = (now: number) => {
    if (!mounted || manualScroll.value || container.value !== list) { scrollAnimationFrame = 0; return }
    const progress = Math.min(1, (now - startedAt) / duration)
    const eased = 1 - Math.pow(1 - progress, 3)
    list.scrollTop = start + delta * eased
    if (progress < 1) scrollAnimationFrame = requestAnimationFrame(step)
    else scrollAnimationFrame = 0
  }
  scrollAnimationFrame = requestAnimationFrame(step)
}

function setRow(element: Element | ComponentPublicInstance | null, index: number) {
  if (element instanceof HTMLElement) rows[index] = element
  else delete rows[index]
}

function lineEnd(index: number): number { return props.family.original[index + 1]?.start ?? props.duration }

function selectHighlightedRow(index: number) {
  if (highlightedRow === index && highlightedElement === rows[index]) return
  if (highlightedElement) {
    highlightedElement.querySelectorAll<HTMLElement>('.original-lyric-word, .original-lyric-translation').forEach(word => { word.style.removeProperty('--lyric-progress'); renderedProgress.delete(word) })
  }
  highlightedRow = index
  const row = rows[index]
  highlightedElement = row
  if (observedRow !== row) {
    if (observedRow) { layoutObserver?.unobserve(observedRow); observedSizes.delete(observedRow) }
    observedRow = row
    if (row) layoutObserver?.observe(row)
  }
  activeWords = row ? Array.from(row.querySelectorAll<HTMLElement>('.original-lyric-word')) : []
  activeTranslation = row?.querySelector<HTMLElement>('.original-lyric-translation') ?? null
}

function setProgress(element: HTMLElement | null | undefined, progress: number) {
  if (!element) return
  const value = progress * 100 + '%'
  if (renderedProgress.get(element) === value) return
  renderedProgress.set(element, value)
  element.style.setProperty('--lyric-progress', value)
}

function renderClock(now = performance.now()) {
  const position = interpolatedPosition(anchor, now, props.duration)
  const clock = lyricClock(position, props.offsetMs)
  const index = lyricIndexAt(props.family.original, clock)
  if (activeIndex.value !== index) {
    activeIndex.value = index
    if (!manualScroll.value) void followActive()
  }
  selectHighlightedRow(index)
  const line = displayLines.value[index]
  if (!line) return
  const progress = lyricLineProgress(line, clock, lineEnd(index))
  if (line.words.length) {
    // Vue does not render the whole lyric family on every animation frame.
    // Only spans in the current row receive a CSS progress update.
    for (let word = 0; word < activeWords.length; word++) {
      const value = lyricWordProgress(line.words[word], clock)
      setProgress(activeWords[word], value)
    }
  } else setProgress(activeWords[0], 1)
  setProgress(activeTranslation, line.words.length ? progress : 1)
}

function animationFrame(now: number) {
  frame = 0
  renderClock(now)
  if (props.playing && document.visibilityState !== 'hidden') frame = requestAnimationFrame(animationFrame)
}

function reanchor() {
  anchor = { position: props.position, monotonicTime: performance.now(), playing: props.playing, rate: props.rate, loop: props.loop }
  if (!mounted) return
  cancelAnimationFrame(frame)
  frame = 0
  renderClock()
  if (props.playing && document.visibilityState !== 'hidden') frame = requestAnimationFrame(animationFrame)
}

function unobscuredViewport(list: HTMLElement) {
  const visual = window.visualViewport
  const top = visual?.offsetTop ?? 0
  let bottom = top + (visual?.height ?? window.innerHeight)
  const listRect = list.getBoundingClientRect()
  for (const element of document.querySelectorAll<HTMLElement>('.bottom-nav, .mini-player')) {
    const style = getComputedStyle(element)
    if (style.display === 'none' || style.visibility === 'hidden' || style.position !== 'fixed') continue
    const rect = element.getBoundingClientRect()
    if (rect.height > 0 && rect.right > listRect.left && rect.left < listRect.right
      && rect.bottom > top && rect.top < bottom) bottom = Math.min(bottom, rect.top)
  }
  return { top, bottom }
}

async function followActive(instant = false, reveal = false) {
  const token = ++followGeneration
  await nextTick()
  if (token !== followGeneration || manualScroll.value) return
  const list = container.value
  const row = rows[Math.max(0, activeIndex.value)]
  if (!list || !row?.isConnected) return
  // Like the original LyricPage's block:center, align the whole row. Use one
  // coordinate space rather than subtracting unrelated offsetParent positions.
  list.style.setProperty('--lyric-edge-space', Math.ceil(list.clientHeight / 2) + 'px')
  let listRect = list.getBoundingClientRect()
  let rowRect = row.getBoundingClientRect()
  let viewport = unobscuredViewport(list)
  // Follow the lyric pane's own center, not the portion currently visible on
  // screen. Scrolling the outer page must not pull the words toward its edge.
  let band = { top: listRect.top, bottom: listRect.bottom }
  if (reveal && Math.min(listRect.bottom, viewport.bottom) - Math.max(listRect.top, viewport.top)
    < Math.min(list.clientHeight, rowRect.height + 24)) {
    window.scrollBy({ top: (listRect.top + listRect.bottom - viewport.top - viewport.bottom) / 2, behavior: 'instant' as ScrollBehavior })
    listRect = list.getBoundingClientRect()
    rowRect = row.getBoundingClientRect()
    viewport = unobscuredViewport(list)
    band = { top: listRect.top, bottom: listRect.bottom }
  }
  // Account for ancestor CSS transform scaling (such as .page-stage entry transitions)
  // because getBoundingClientRect() returns scaled viewport pixels while scrollTop uses layout pixels.
  const scale = list.clientHeight > 0 && listRect.height > 0 && Math.abs(listRect.height - list.clientHeight) > 0.5 ? listRect.height / list.clientHeight : 1
  const top = scale === 1
    ? lyricCenteredScrollTop(list.scrollTop, rowRect.top, rowRect.bottom, band)
    : lyricCenteredScrollTop(list.scrollTop, band.top + (rowRect.top - band.top) / scale, band.top + (rowRect.bottom - band.top) / scale, { top: band.top, bottom: band.top + (band.bottom - band.top) / scale })
  if (instant || isMotionReduced()) {
    cancelScrollAnimation()
    list.scrollTop = Math.max(0, Math.min(Math.max(0, list.scrollHeight - list.clientHeight), top))
  } else animateScrollTop(list, top)
}

function returnToCurrent() {
  clearConfirmation()
  manualScroll.value = false
  void followActive(false, true)
}

function markManualScroll() {
  clearConfirmation()
  cancelScrollAnimation()
  ++followGeneration
  manualScroll.value = true
}

function touchStart(event: TouchEvent) {
  cancelScrollAnimation()
  if (event.touches.length !== 1) { lastFingerY = undefined; return }
  lastFingerY = event.touches[0].clientY
  fingerStartX = event.touches[0].clientX
  fingerStartY = event.touches[0].clientY
  touchDirection = 'pending'
  touchPointerMoved = false
}

function touchMove(event: TouchEvent) {
  const list = container.value
  if (!list || lastFingerY === undefined || event.touches.length !== 1) return
  const nextY = event.touches[0].clientY
  if (touchDirection === 'horizontal') return
  if (touchDirection === 'pending') {
    const dx = Math.abs(event.touches[0].clientX - fingerStartX), dy = Math.abs(nextY - fingerStartY)
    if (Math.max(dx, dy) < 10) return
    touchPointerMoved = true
    clearConfirmation()
    if (dx >= dy * 1.35) { touchDirection = 'horizontal'; return }
    if (dy < dx * 1.1) return
    touchDirection = 'vertical'
  }
  const delta = lastFingerY - nextY
  lastFingerY = nextY
  if (Math.abs(delta) < .5) return
  touchPointerMoved = true
  markManualScroll()
  const remainder = boundaryScrollRemainder(list.scrollTop, list.clientHeight, list.scrollHeight, delta)
  if (Math.abs(remainder) < .5) return
  // Leave the event untouched so Chrome's normal scroll chaining can run.
  // Some Android WebViews keep a gesture latched to the nested lyric scroller;
  // only compensate after native scrolling had two frames to move the page.
  if (!handoffFrame) handoffWindowY = window.scrollY
  handoffRemainder += remainder
  if (handoffFrame) return
  handoffFrame = requestAnimationFrame(() => {
    handoffFrame = requestAnimationFrame(() => {
      handoffFrame = 0
      const remaining = handoffRemainder
      handoffRemainder = 0
      if (Math.abs(window.scrollY - handoffWindowY) < .5) window.scrollBy({ top: remaining, behavior: 'instant' as ScrollBehavior })
    })
  })
}

function seekLine(line: LyricLine, event: MouseEvent, index: number) {
  // A finger drag must not seek when a WebView synthesizes its trailing click.
  if (touchPointerMoved && event.detail !== 0) { touchPointerMoved = false; return }
  if (pendingLine.value !== index || performance.now() > pendingUntil) {
    clearConfirmation()
    cancelScrollAnimation()
    manualScroll.value = true
    ++followGeneration
    pendingLine.value = index
    pendingUntil = performance.now() + 1800
    confirmationTimer = setTimeout(clearConfirmation, 1800)
    return
  }
  confirmLine(line)
}

function confirmLine(line: LyricLine) {
  clearConfirmation()
  const target = lyricSeekPosition(line, props.offsetMs, props.duration, props.loop)
  anchor = { position: target, monotonicTime: performance.now(), playing: props.playing, rate: props.rate, loop: props.loop }
  manualScroll.value = false
  renderClock()
  void followActive(false, true)
  emit('seek', target)
}

function scrollKey(event: KeyboardEvent) {
  if (['ArrowUp', 'ArrowDown', 'PageUp', 'PageDown', 'Home', 'End', ' '].includes(event.key)) markManualScroll()
}

function onVisibility() {
  cancelAnimationFrame(frame)
  frame = 0
  if (document.visibilityState !== 'hidden') {
    renderClock()
    if (props.playing) frame = requestAnimationFrame(animationFrame)
  }
}

function onViewportChange() {
  if (layoutFrame || manualScroll.value) return
  layoutFrame = requestAnimationFrame(() => {
    layoutFrame = 0
    if (!manualScroll.value) void followActive(true)
  })
}

function onObservedResize(entries: ResizeObserverEntry[]) {
  let changed = false
  for (const entry of entries) {
    const size = Math.round(entry.contentRect.width) + "x" + Math.round(entry.contentRect.height)
    const previous = observedSizes.get(entry.target)
    observedSizes.set(entry.target, size)
    if (previous !== undefined && previous !== size) changed = true
  }
  if (changed) onViewportChange()
}

if (!preview) {
  watch(() => [props.position, props.playing, props.rate, props.offsetMs, props.duration, props.loop], reanchor)
  watch(displayLines, () => {
    highlightedRow = -1
    reanchor()
    if (!manualScroll.value) void followActive(true)
  }, { deep: true, flush: 'post' })
  watch(() => props.family, async () => {
    clearConfirmation()
    cancelScrollAnimation()
    ++followGeneration
    highlightedRow = -1
    activeWords = []
    activeTranslation = null
    highlightedElement = undefined
    rows.length = 0
    activeIndex.value = -1
    manualScroll.value = false
    await nextTick()
    reanchor()
    void followActive(true)
  })
  onMounted(() => {
    mounted = true
    document.addEventListener('visibilitychange', onVisibility)
    window.addEventListener('resize', onViewportChange, { passive: true })
    window.visualViewport?.addEventListener('resize', onViewportChange, { passive: true })
    layoutObserver = new ResizeObserver(onObservedResize)
    if (container.value) layoutObserver.observe(container.value)
    reanchor()
    void followActive(true)
  })
  onUnmounted(() => {
    clearConfirmation()
    mounted = false
    cancelAnimationFrame(frame)
    cancelAnimationFrame(handoffFrame)
    cancelAnimationFrame(layoutFrame)
    cancelScrollAnimation()
    layoutObserver?.disconnect()
    ++followGeneration
    document.removeEventListener('visibilitychange', onVisibility)
    window.removeEventListener('resize', onViewportChange)
    window.visualViewport?.removeEventListener('resize', onViewportChange)
  })
}
</script>

<template>
  <section class="original-lyrics-view" :class="{ 'word-timed': hasWords || hasEstimates }" :style="displayStyle" :aria-label="$t('mobile.lyricUi.title')">
    <header class="original-lyrics-heading"><b>{{ $t('mobile.lyricUi.title') }}</b><span v-if="hasWords" class="original-lyrics-source">{{ $t('mobile.lyricUi.originalWords') }}</span><span v-if="hasEstimates" class="original-lyrics-source estimated-lyrics-note">{{ $t('mobile.lyricUi.estimatedWords') }}</span><button v-if="manualScroll" type="button" class="return-current-lyric" @click="returnToCurrent">{{ $t('mobile.lyricUi.returnCurrent') }}</button></header>
    <div class="lyric-seek-confirmation" aria-live="polite"><template v-if="pendingLine !== undefined"><span>{{ $t('mobile.playbackReview.seekAgain') }}</span><button type="button" class="text-button" @click="confirmLine(displayLines[pendingLine])">{{ $t('mobile.playbackReview.confirmSeek') }}</button></template></div>
    <div v-if="!family.original.length" class="original-lyrics-empty">{{ $t('mobile.refinements.noLyrics') }}</div>
    <div v-else-if="preview" class="original-lyrics-scroll original-lyrics-preview">
      <div class="original-lyrics-preview-center">
        <div v-for="group in previewGroups" :key="group.side" class="original-lyrics-preview-group" :data-side="group.side">
          <div v-for="{ index, line } in group.rows" :key="index" class="original-lyric-row" :class="{ active: previewIndex === index }">
            <span class="original-lyric-text">
              <template v-if="previewIndex === index && line.words.length"><span v-for="(word, wordIndex) in line.words" :key="wordIndex" class="original-lyric-word" :style="previewProgress(lyricWordProgress(word, previewClock))">{{ word.text }}</span></template>
              <span v-else class="original-lyric-word" :style="previewIndex === index ? previewProgress(1) : undefined">{{ line.text || '♪' }}</span>
            </span>
            <span v-if="family.pairedTranslations[index]" class="original-lyric-translation" :style="previewIndex === index ? previewProgress(line.words.length ? lyricLineProgress(line, previewClock, lineEnd(index)) : 1) : undefined">{{ family.pairedTranslations[index] }}</span>
          </div>
        </div>
      </div>
    </div>
    <div v-else ref="container" class="original-lyrics-scroll" tabindex="0" :aria-label="$t('mobile.lyricUi.scrollArea')" @wheel.passive="markManualScroll" @keydown="scrollKey" @touchstart.passive="touchStart" @touchmove.passive="touchMove">
      <button v-for="(line, index) in displayLines" :key="line.start + '-' + index" :ref="element => setRow(element, index)" type="button" class="original-lyric-row" :class="{ active: activeIndex === index, 'seek-pending': pendingLine === index }" :aria-current="activeIndex === index ? 'true' : undefined" :aria-label="$t('mobile.playbackReview.seekLabel', { text: line.text })" @click="seekLine(line, $event, index)">
        <span class="original-lyric-text"><span v-if="!line.words.length" class="original-lyric-word">{{ line.text || '♪' }}</span><template v-else><span v-for="(word, wordIndex) in line.words" :key="wordIndex" class="original-lyric-word">{{ word.text }}</span></template></span>
        <span v-if="family.pairedTranslations[index]" class="original-lyric-translation">{{ family.pairedTranslations[index] }}</span>
      </button>
    </div>
  </section>
</template>

<style scoped>
.original-lyrics-view { width: 100%; min-width: 0; color: var(--color-text); }
.original-lyrics-heading { display: flex; flex-wrap: wrap; align-items: center; gap: 8px; min-height: 36px; margin: 0 8px 6px; }
.original-lyrics-heading b { font-size: calc(15px * var(--ui-font-scale, 1)); font-weight: 700; letter-spacing: -.01em; }
.original-lyrics-source { font-size: calc(11px * var(--ui-font-scale, 1)); font-weight: 600; color: var(--muted); padding: 2px 6px; border-radius: 6px; background: var(--surface); }
.return-current-lyric { margin-left: auto; min-height: 34px; padding: 5px 11px; border: 1px solid var(--accent-border, var(--line)); border-radius: 10px; color: var(--accent-ink, var(--color-primary)); background: var(--accent-soft, var(--color-secondary-bg)); font: inherit; font-size: calc(11px * var(--ui-font-scale, 1)); font-weight: 650; cursor: pointer; }
.original-lyrics-scroll {
  position: relative;
  min-width: 0;
  height: clamp(260px, 50dvh, 420px);
  border-radius: 14px;
  background: var(--lyric-background, transparent);
  overflow-y: auto;
  overflow-x: hidden;
  overscroll-behavior-y: auto;
  touch-action: pan-y;
  scrollbar-width: none;
  scroll-padding-block: 20%;
  -webkit-mask-image: linear-gradient(to bottom, transparent 0%, #000 11%, #000 89%, transparent 100%);
  mask-image: linear-gradient(to bottom, transparent 0%, #000 11%, #000 89%, transparent 100%);
}
.original-lyrics-scroll::-webkit-scrollbar { display: none; }
.original-lyrics-preview { overflow: hidden; }
.original-lyrics-preview::before, .original-lyrics-preview::after { display: none; }
.original-lyrics-preview-center { position: absolute; inset: 50% 0 auto; transform: translateY(-50%); }
.original-lyrics-preview-group { display: flow-root; }
.original-lyrics-preview-group[data-side="before"] { position: absolute; inset: auto 0 100%; }
.original-lyrics-preview-group[data-side="after"] { position: absolute; inset: 100% 0 auto; }
.original-lyrics-scroll::before, .original-lyrics-scroll::after { content: ''; display: block; height: var(--lyric-edge-space, 130px); pointer-events: none; }
.original-lyric-row {
  display: block;
  width: 100%;
  min-width: 0;
  margin: 2px 0;
  padding: 12px 12px;
  border: 0;
  border-radius: 14px;
  color: var(--lyric-unplayed, var(--muted));
  background: transparent;
  text-align: left;
  font-family: inherit;
  font-weight: 600;
  cursor: pointer;
  -webkit-tap-highlight-color: transparent;
  transition: background-color var(--motion-feedback, 180ms) ease, opacity var(--motion-state, 220ms) ease;
}
.original-lyric-row:not(.active) { opacity: 1; }
.original-lyric-row.active { opacity: 1; font-weight: 700; }
.original-lyric-row:active { background: var(--color-secondary-bg-for-transparent); }
.original-lyric-row.seek-pending { opacity: 1; background: var(--accent-soft); outline: 1px solid var(--accent); outline-offset: -1px; }
.lyric-seek-confirmation { min-height: 24px; padding: 0 8px; display: flex; align-items: center; flex-wrap: wrap; gap: 4px; color: var(--muted); font-size: calc(11px * var(--ui-font-scale, 1)); }
.lyric-seek-confirmation:empty { min-height: 0; }
.original-lyric-text { display: block; white-space: pre-wrap; overflow-wrap: anywhere; font-size: 21px; line-height: 1.48; filter: var(--lyric-shadow, none); transform: scale(.96); transform-origin: left center; transition: transform .3s cubic-bezier(.25,.46,.45,.94); }
.original-lyric-row.active .original-lyric-text { transform: scale(1); }
.original-lyric-word { --lyric-progress: 0%; background-image: linear-gradient(to right, var(--lyric-played, var(--color-wbw-text-played)) var(--lyric-progress), var(--lyric-unplayed, var(--color-wbw-text-unplay)) var(--lyric-progress)); background-clip: text; -webkit-background-clip: text; color: transparent; }
.original-lyric-row:not(.active) .original-lyric-word { background-image: none; color: var(--lyric-unplayed, var(--muted)); }
.original-lyric-translation { --lyric-progress: 0%; display: block; width: fit-content; max-width: 100%; margin: 5px 0 0; font-size: 14px; line-height: 1.5; filter: var(--lyric-shadow, none); white-space: pre-wrap; overflow-wrap: anywhere; background-image: linear-gradient(to right, var(--lyric-played, var(--color-wbw-text)) var(--lyric-progress), var(--lyric-unplayed, var(--color-wbw-text-unplay)) var(--lyric-progress)); background-clip: text; -webkit-background-clip: text; color: transparent; }
.original-lyric-row:not(.active) .original-lyric-translation { background-image: none; color: var(--lyric-unplayed, var(--muted)); }
.original-lyric-row:focus-visible, .return-current-lyric:focus-visible, .original-lyrics-scroll:focus-visible { outline: 2px solid var(--color-primary); outline-offset: -2px; }
.original-lyrics-empty { padding: 30px 8px; color: var(--muted); text-align: center; font-size: calc(13px * var(--ui-font-scale, 1)); }
@media (max-width: 340px) { .original-lyric-text { font-size: 19px; } .original-lyric-translation { font-size: 13px; } .original-lyric-row { padding-inline: 8px; } }
html[data-motion="reduced"] .original-lyric-text, html[data-motion="reduced"] .original-lyric-row { transition: none; }
</style>
