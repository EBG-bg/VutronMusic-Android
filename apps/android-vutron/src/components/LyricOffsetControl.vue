<script setup lang="ts">
import { computed, onBeforeUnmount, ref, watch } from 'vue'
import back5s from '../../../../src/renderer/assets/icons/back5s.svg?url'
import forward5s from '../../../../src/renderer/assets/icons/forward5s.svg?url'
import OriginalIcon from './OriginalIcon.vue'

const props = withDefaults(defineProps<{ modelValue: number; disabled?: boolean; trackKey?: string | number; orientation?: 'horizontal' | 'vertical'; compact?: boolean }>(), { disabled: false, orientation: 'horizontal', compact: false })
const emit = defineEmits<{ 'update:modelValue': [milliseconds: number]; commit: [milliseconds: number] }>()
const limit = 30000
const earlierIcon = { '--offset-icon': `url("${back5s}")` }
const laterIcon = { '--offset-icon': `url("${forward5s}")` }
const normalize = (value: number) => Math.max(-limit, Math.min(limit, Math.round((Number.isFinite(value) ? value : 0) / 10) * 10))
const value = ref(normalize(props.modelValue))
const numeric = ref(String(value.value / 1000))
const editing = ref(false)
const dragging = ref(false)
const slider = ref<HTMLElement>()
const rail = ref<HTMLElement>()
const center = ref(value.value)
const lower = computed(() => Math.max(-limit, center.value - 1000))
const upper = computed(() => Math.min(limit, center.value + 1000))
const percent = computed(() => (value.value - lower.value) / (upper.value - lower.value) * 100)
const signedSeconds = (milliseconds: number) => `${milliseconds > 0 ? '+' : ''}${(milliseconds / 1000).toFixed(2)}`
let drag: { pointer: number; coordinate: number; vertical: boolean; value: number; scale: number } | undefined

function update(next: number) {
  value.value = normalize(next)
  if (!editing.value) numeric.value = String(value.value / 1000)
  emit('update:modelValue', value.value)
}
function commit() {
  numeric.value = String(value.value / 1000)
  center.value = value.value
  emit('commit', value.value)
}
function releaseCapture() {
  const pointer = drag?.pointer
  drag = undefined
  dragging.value = false
  if (pointer !== undefined && slider.value?.hasPointerCapture(pointer)) slider.value.releasePointerCapture(pointer)
}
function beginDrag(event: PointerEvent) {
  if (props.disabled || drag || (event.pointerType === 'mouse' && event.button !== 0)) return
  if (!(event.target as Element).closest('.offset-thumb')) return
  event.preventDefault()
  slider.value?.focus({ preventScroll: true })
  const vertical = props.orientation === 'vertical'
  const bounds = rail.value?.getBoundingClientRect()
  const length = (vertical ? bounds?.height : bounds?.width) ?? 0
  if (length <= 0) return
  // Keep the grab position within the thumb; the rest of the rail scrolls the page.
  drag = { pointer: event.pointerId, coordinate: vertical ? event.clientY : event.clientX, vertical, value: value.value, scale: (upper.value - lower.value) / length }
  dragging.value = true
  slider.value?.setPointerCapture(event.pointerId)
}
function moveDrag(event: PointerEvent) {
  if (!drag || event.pointerId !== drag.pointer) return
  const coordinate = drag.vertical ? event.clientY : event.clientX
  const next = Math.max(lower.value, Math.min(upper.value, drag.value + (coordinate - drag.coordinate) * drag.scale))
  update(next)
}
function endDrag(event: PointerEvent) {
  if (!drag || event.pointerId !== drag.pointer) return
  if (event.type !== 'pointercancel' && event.type !== 'lostpointercapture') moveDrag(event)
  releaseCapture()
  commit()
}
function step(milliseconds: number) {
  if (props.disabled) return
  update(value.value + milliseconds)
  commit()
}
function keyboard(event: KeyboardEvent) {
  if (props.disabled) return
  const small = event.shiftKey ? 100 : 10
  const verticalStep = props.orientation === 'vertical' ? -small : small
  const pageStep = props.orientation === 'vertical' ? -500 : 500
  const next: Record<string, number> = { ArrowLeft: value.value - small, ArrowDown: value.value - verticalStep, ArrowRight: value.value + small, ArrowUp: value.value + verticalStep, PageDown: value.value - pageStep, PageUp: value.value + pageStep, Home: -limit, End: limit }
  if (!(event.key in next)) return
  event.preventDefault()
  update(next[event.key])
  commit()
}
function inputNumber(event: Event) {
  const input = event.target as HTMLInputElement
  numeric.value = input.value
  if (input.value.trim() !== '' && Number.isFinite(input.valueAsNumber)) update(input.valueAsNumber * 1000)
}
function finishNumber() { editing.value = false; commit() }
watch(() => props.modelValue, next => {
  value.value = normalize(next)
  if (!editing.value) numeric.value = String(value.value / 1000)
  if (!drag) center.value = value.value
})
watch(() => props.trackKey, () => {
  releaseCapture()
  editing.value = false
  value.value = normalize(props.modelValue)
  numeric.value = String(value.value / 1000)
  center.value = value.value
})
watch(() => props.disabled, disabled => { if (disabled) releaseCapture() })
watch(() => props.orientation, releaseCapture)
onBeforeUnmount(releaseCapture)
</script>

<template>
  <div class="lyric-offset-control" :class="{ disabled, 'offset-vertical': orientation === 'vertical', 'offset-compact': compact }">
    <div class="offset-heading"><span>{{ $t('mobile.offsetUi.title') }}</span><output>{{ $t('mobile.offsetUi.seconds', { value: signedSeconds(value) }) }}</output></div>
    <div ref="slider" class="offset-slider" :data-dragging="dragging ? '' : undefined" role="slider" :aria-orientation="orientation" :tabindex="disabled ? -1 : 0" :aria-label="$t('mobile.offsetUi.slider')" :aria-disabled="disabled" :aria-valuemin="-limit" :aria-valuemax="limit" :aria-valuenow="value" :aria-valuetext="$t('mobile.offsetUi.sliderValue', { value: signedSeconds(value) })" :style="{ '--offset-position': `${percent}%` }" @pointerdown="beginDrag" @pointermove="moveDrag" @pointerup="endDrag" @pointercancel="endDrag" @lostpointercapture="endDrag" @keydown="keyboard">
      <span ref="rail" class="offset-rail"><span class="offset-fill"></span><span class="offset-thumb"></span></span>
    </div>
    <div v-if="!compact" class="offset-scale"><span>{{ $t('mobile.offsetUi.seconds', { value: signedSeconds(lower) }) }}</span><span>{{ $t('mobile.offsetUi.fine') }}</span><span>{{ $t('mobile.offsetUi.seconds', { value: signedSeconds(upper) }) }}</span></div>
    <div v-if="!compact" class="offset-actions">
      <button class="secondary-button" type="button" :disabled="disabled" :aria-label="$t('mobile.offsetUi.earlierLabel')" @click="step(-500)"><span class="offset-original-icon" :style="earlierIcon" aria-hidden="true"></span>{{ $t('mobile.offsetUi.earlier') }}</button>
      <button class="secondary-button" type="button" :disabled="disabled" @click="update(0); commit()"><OriginalIcon name="refresh" />{{ $t('mobile.offsetUi.reset') }}</button>
      <button class="secondary-button" type="button" :disabled="disabled" :aria-label="$t('mobile.offsetUi.laterLabel')" @click="step(500)"><span class="offset-original-icon" :style="laterIcon" aria-hidden="true"></span>{{ $t('mobile.offsetUi.later') }}</button>
    </div>
    <label v-if="!compact" class="offset-exact"><span>{{ $t('mobile.offsetUi.exact') }}</span><input type="number" inputmode="decimal" min="-30" max="30" step="0.01" :disabled="disabled" :value="numeric" :aria-label="$t('mobile.offsetUi.exactLabel')" @focus="editing = true" @input="inputNumber" @blur="finishNumber" @keydown.enter.prevent="finishNumber" /><span>{{ $t('mobile.offsetUi.hint') }}</span></label>
  </div>
</template>

<style scoped>
.lyric-offset-control { display: grid; gap: 3px; min-width: 0; }
.offset-heading { display: flex; justify-content: space-between; align-items: center; gap: 10px; font-size: calc(13px * var(--ui-font-scale, 1)); }
.offset-heading output { color: var(--color-primary, var(--accent)); font-variant-numeric: tabular-nums; white-space: nowrap; }
.offset-slider { position: relative; height: 32px; margin: 0; touch-action: pan-y; user-select: none; outline: none; }
.offset-rail { position: absolute; inset: 14px 13px auto; height: 4px; border-radius: 2px; background: var(--color-secondary-bg, var(--line)); }
.offset-fill { position: absolute; inset: 0 auto 0 0; width: var(--offset-position); border-radius: inherit; background: var(--color-primary, var(--accent)); }
.offset-thumb { position: absolute; top: 50%; left: var(--offset-position); width: 18px; height: 18px; border: 2px solid var(--color-body-bg); border-radius: 50%; background: var(--color-primary, var(--accent)); box-shadow: 0 1px 4px rgb(0 0 0 / 18%); transform: translate(-50%, -50%); touch-action: none; cursor: ew-resize; }
.offset-slider:focus-visible .offset-thumb { outline: 2px solid var(--color-primary, var(--accent)); outline-offset: 3px; }
.offset-fill { transition: width var(--motion-slider, 180ms) ease-out; }
.offset-thumb { transition: left var(--motion-slider, 180ms) ease-out, transform var(--motion-feedback, 180ms) ease, box-shadow var(--motion-state, 220ms) ease; }
.offset-vertical { display: flex; flex-direction: column; align-items: center; gap: 8px; }
.offset-vertical .offset-slider { width: 32px; height: clamp(110px, 28dvh, 220px); flex: none; }
.offset-vertical .offset-rail { inset: 13px auto 13px calc(50% - 2px); height: auto; width: 4px; background: var(--line); }
.offset-vertical .offset-fill { inset: 0 0 auto; width: 100%; height: var(--offset-position); transition: height var(--motion-slider, 180ms) ease-out; }
.offset-vertical .offset-thumb { left: 50%; top: var(--offset-position); cursor: ns-resize; transition: top var(--motion-slider, 180ms) ease-out, transform var(--motion-feedback, 180ms) ease, box-shadow var(--motion-state, 220ms) ease; }
.offset-compact .offset-heading { justify-content: center; font-size: calc(11px * var(--ui-font-scale, 1)); }
.offset-compact .offset-heading > span { position: absolute; width: 1px; height: 1px; overflow: hidden; clip-path: inset(50%); white-space: nowrap; }
.offset-compact .offset-heading output { white-space: normal; text-align: center; }
.offset-slider[data-dragging] .offset-fill { transition: none; }
.offset-slider[data-dragging] .offset-thumb { transform: translate(-50%, -50%) scale(1.1); box-shadow: 0 0 0 3px var(--accent-soft); transition: transform var(--motion-feedback, 180ms) ease, box-shadow var(--motion-state, 220ms) ease; }
.offset-scale { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 3px 6px; margin-top: -3px; color: var(--muted); font-size: calc(10px * var(--ui-font-scale, 1)); font-variant-numeric: tabular-nums; }
.offset-scale > span:nth-child(2) { grid-row: 2; grid-column: 1 / -1; text-align: center; }
.offset-scale > span:last-child { text-align: right; }
.offset-actions { display: flex; flex-wrap: wrap; gap: 6px; margin-top: 9px; }
.offset-actions button { display: inline-flex; align-items: center; justify-content: center; flex: 1 1 auto; gap: 5px; min-height: 34px; padding: 6px 8px; font-size: calc(12px * var(--ui-font-scale, 1)); white-space: nowrap; }
.offset-original-icon { width: 17px; height: 17px; flex: 0 0 auto; background: currentColor; mask: var(--offset-icon) center / contain no-repeat; -webkit-mask: var(--offset-icon) center / contain no-repeat; }
.offset-exact { display: flex; flex-wrap: wrap; align-items: center; gap: 7px; margin-top: 8px; font-size: calc(12px * var(--ui-font-scale, 1)); }
.offset-exact input { width: 78px; min-width: 0; padding: 6px 8px; font-size: calc(13px * var(--ui-font-scale, 1)); font-variant-numeric: tabular-nums; }
.offset-exact > span:last-child { color: var(--muted); font-size: calc(11px * var(--ui-font-scale, 1)); }
.disabled { opacity: .5; }
.disabled .offset-slider { cursor: default; }
.disabled .offset-thumb { pointer-events: none; }
</style>
