<script setup lang="ts">
import { computed, ref, watch } from 'vue'
import { useI18n } from 'vue-i18n'

type Point = 'startMs' | 'endMs'
const props = defineProps<{ startMs: number; endMs: number; durationMs: number; minSpanMs: number; position: number; disabled: boolean }>()
const emit = defineEmits<{ change: [which: Point, value: number]; preview: [value?: { which: Point; time: number }] }>()
const { t } = useI18n()
const rail = ref<HTMLElement>()
const a = ref<HTMLElement>(), b = ref<HTMLElement>()
const preview = ref<{ which: Point; time: number }>()
let drag: { id: number; which: Point; x: number; value: number; width: number; target: HTMLElement } | undefined
let tap: { id: number; x: number; y: number } | undefined
const maximum = computed(() => Math.max(0, props.durationMs))
const limits = (which: Point) => which === 'startMs'
  ? [0, props.endMs < 0 ? maximum.value : Math.max(0, props.endMs - props.minSpanMs)] as const
  : [props.startMs < 0 ? 0 : Math.min(maximum.value, props.startMs + props.minSpanMs), maximum.value] as const
const clamp = (which: Point, value: number) => { const [min, max] = limits(which); return Math.round(Math.max(min, Math.min(max, value))) }
const shown = (which: Point) => preview.value?.which === which ? preview.value.time : props[which] >= 0 ? Math.min(maximum.value, props[which]) : which === 'startMs' ? 0 : maximum.value
const percent = (time: number) => `${maximum.value > 0 ? Math.max(0, Math.min(100, time * 100 / maximum.value)) : 0}%`
const format = (time: number) => `${Math.floor(time / 60000)}:${(time / 1000 % 60).toFixed(2).padStart(5, '0')}`
function display(value?: { which: Point; time: number }) { preview.value = value; emit('preview', value) }
function commit(which: Point, value: number) {
  const next = clamp(which, value)
  if (props[which] !== next) emit('change', which, next)
}
function begin(event: PointerEvent, which: Point) {
  if (props.disabled || drag || !event.isPrimary || event.button !== 0 || !rail.value) return
  const width = rail.value.getBoundingClientRect().width
  if (!width) return
  event.preventDefault()
  const target = event.currentTarget as HTMLElement
  drag = { id: event.pointerId, which, target, x: event.clientX, value: shown(which), width }
  tap = undefined
  target.focus({ preventScroll: true }); target.setPointerCapture(event.pointerId)
}
function move(event: PointerEvent) {
  if (!drag || event.pointerId !== drag.id || Math.abs(event.clientX - drag.x) < 2 && !preview.value) return
  const { which, x, value, width } = drag
  display({ which, time: clamp(which, value + (event.clientX - x) / width * maximum.value) })
}
function end(event: PointerEvent) {
  if (!drag || event.pointerId !== drag.id) return
  if (event.type === 'pointerup') move(event)
  const change = preview.value, current = drag
  drag = undefined; display(undefined)
  if (current.target.hasPointerCapture(event.pointerId)) current.target.releasePointerCapture(event.pointerId)
  if (event.type === 'pointerup' && change && !props.disabled) commit(change.which, change.time)
}
function tapStart(event: PointerEvent) {
  if (!props.disabled && event.isPrimary && event.button === 0) tap = { id: event.pointerId, x: event.clientX, y: event.clientY }
}
function tapEnd(event: PointerEvent) {
  const previous = tap; tap = undefined
  if (props.disabled || !previous || previous.id !== event.pointerId || !rail.value || Math.hypot(previous.x - event.clientX, previous.y - event.clientY) > 8) return
  const rect = rail.value.getBoundingClientRect()
  if (!rect.width) return
  const value = (event.clientX - rect.left) / rect.width * maximum.value
  const which = Math.abs(shown('startMs') - value) <= Math.abs(shown('endMs') - value) ? 'startMs' : 'endMs'
  ;(which === 'startMs' ? a.value : b.value)?.focus({ preventScroll: true })
  commit(which, value)
}
function keyboard(event: KeyboardEvent, which: Point) {
  if (props.disabled) return
  const [min, max] = limits(which), value = shown(which), step = event.shiftKey ? 1000 : 100
  const next = ({ ArrowLeft: value - step, ArrowDown: value - step, ArrowRight: value + step, ArrowUp: value + step,
    PageDown: value - 5000, PageUp: value + 5000, Home: min, End: max } as Record<string, number>)[event.key]
  if (next === undefined) return
  event.preventDefault(); commit(which, next)
}
watch(() => props.durationMs, () => { drag = undefined; tap = undefined; display(undefined) })
</script>

<template>
  <div class="loop-slider" data-sheet-no-drag data-no-page-swipe :data-dragging="drag ? true : undefined" role="group" :aria-label="t('mobile.experience.timeline')" :style="{ '--a': percent(shown('startMs')), '--b': percent(shown('endMs')), '--now': percent(position) }" @pointerdown="tapStart" @pointerup="tapEnd" @pointercancel="tap = undefined">
    <div ref="rail" class="loop-rail" aria-hidden="true"><div class="loop-fill" :class="{ 'unset-range': startMs < 0 && preview?.which !== 'startMs' || endMs < 0 && preview?.which !== 'endMs' }" /><i class="loop-current-position" /></div>
    <div class="loop-points">
      <div ref="a" class="loop-thumb loop-a" role="slider" tabindex="0" :aria-disabled="disabled" :aria-label="t('mobile.experience.startPoint')" :aria-valuemin="0" :aria-valuemax="limits('startMs')[1] / 1000" :aria-valuenow="shown('startMs') / 1000" :aria-valuetext="format(shown('startMs'))" @pointerdown.stop="begin($event, 'startMs')" @pointermove.stop="move" @pointerup.stop="end" @pointercancel.stop="end" @lostpointercapture="end" @keydown="keyboard($event, 'startMs')"><span aria-hidden="true">A</span></div>
      <div ref="b" class="loop-thumb loop-b" role="slider" tabindex="0" :aria-disabled="disabled" :aria-label="t('mobile.experience.endPoint')" :aria-valuemin="limits('endMs')[0] / 1000" :aria-valuemax="maximum / 1000" :aria-valuenow="shown('endMs') / 1000" :aria-valuetext="format(shown('endMs'))" @pointerdown.stop="begin($event, 'endMs')" @pointermove.stop="move" @pointerup.stop="end" @pointercancel.stop="end" @lostpointercapture="end" @keydown="keyboard($event, 'endMs')"><span aria-hidden="true">B</span></div>
    </div>
  </div>
</template>

<style scoped>
.loop-slider { position: relative; height: 88px; touch-action: pan-y; user-select: none; }
.loop-rail, .loop-points { position: absolute; inset-inline: 23px; top: 50%; }
.loop-rail { height: 5px; transform: translateY(-50%); border-radius: 6px; background: var(--line); }
.loop-fill { position: absolute; inset-block: 0; left: var(--a); right: calc(100% - var(--b)); border-radius: inherit; background: var(--accent); }
.loop-fill.unset-range { opacity: .34; }
.loop-current-position { position: absolute; left: var(--now); top: -4px; width: 2px; height: 13px; border-radius: 2px; transform: translateX(-50%); background: var(--ink); }
.loop-points { height: 0; }
.loop-thumb { position: absolute; width: 44px; height: 44px; display: grid; place-items: center; border-radius: var(--radius-control); transform: translateX(-50%); touch-action: none; cursor: ew-resize; }
.loop-thumb[aria-disabled='true'] { cursor: default; }
.loop-a { left: var(--a); bottom: 0; }
.loop-b { left: var(--b); top: 0; }
.loop-thumb span { z-index: 1; display: grid; place-items: center; width: 29px; height: 29px; border: 1px solid var(--accent); border-radius: 9px; color: var(--accent-ink); background: var(--color-body-bg); font-weight: 750; font-size: calc(11px * var(--ui-font-scale, 1)); }
.loop-thumb::before { content: ''; position: absolute; width: 2px; height: 10px; background: var(--accent); }
.loop-a::before { bottom: 0; }.loop-b::before { top: 0; }
.loop-thumb:is(:focus-visible, :active) span { background: var(--accent-soft); }
.loop-thumb:focus-visible { outline: 2px solid var(--accent); }
</style>
