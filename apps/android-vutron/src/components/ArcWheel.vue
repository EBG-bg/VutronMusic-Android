<script setup lang="ts">
import { computed, nextTick, onBeforeUnmount, onMounted, ref, watch } from 'vue'
import { reducedMotion } from '../platform/motion'
import { wheelLabel } from '../utils/sleepTimer'

const props = defineProps<{ modelValue: number; min: number; max: number; label: string; cycle?: number; valueText?: string; running?: boolean; disabled?: boolean }>()
const emit = defineEmits<{ 'update:modelValue': [value: number]; 'interaction-start': [] }>()
const root = ref<HTMLElement>(), slider = ref<HTMLElement>()
const dragging = ref(false), visualValue = ref(props.modelValue)
const spacing = 30
let pointer: number | undefined, originX = 0, originY = 0, originValue = 0
let frame = 0
function stopAnimation() { cancelAnimationFrame(frame); frame = 0 }
function animateTo(value: number, duration = props.running ? 250 : 220) {
  stopAnimation()
  if (reducedMotion.value || duration === 0 || document.visibilityState === 'hidden' || Math.abs(value - visualValue.value) < .001) { visualValue.value = value; return }
  const start = visualValue.value, began = performance.now(), linear = props.running
  function draw(now: number) {
    const progress = Math.min(1, (now - began) / duration)
    const eased = linear ? progress : 1 - Math.pow(1 - progress, 3)
    visualValue.value = start + (value - start) * eased
    if (progress < 1) frame = requestAnimationFrame(draw)
    else frame = 0
  }
  frame = requestAnimationFrame(draw)
}
const ticks = computed(() => {
  const middle = Math.floor(visualValue.value)
  return Array.from({ length: 19 }, (_, index) => middle + index - 9)
    .filter(value => value >= props.min && value <= props.max)
    .map(value => ({ value, label: wheelLabel(value, props.cycle), distance: value - visualValue.value }))
})
function bounded(value: number) { return Math.max(props.min, Math.min(props.max, value)) }
function set(value: number) {
  if (props.disabled) return
  emit('interaction-start')
  emit('update:modelValue', Math.round(bounded(value)))
}
function down(event: PointerEvent) {
  if (props.disabled || pointer !== undefined || !event.isPrimary || event.button !== 0
    || (event.target as HTMLElement).closest('input,button,textarea,a')) return
  stopAnimation()
  pointer = event.pointerId; originX = event.clientX; originY = event.clientY; originValue = props.modelValue
  visualValue.value = props.modelValue
  slider.value?.focus({ preventScroll: true })
  root.value?.setPointerCapture(event.pointerId)
}
function move(event: PointerEvent) {
  if (pointer !== event.pointerId) return
  const dx = event.clientX - originX, dy = event.clientY - originY
  if (!dragging.value && Math.abs(dy) > Math.abs(dx) && Math.abs(dy) > 7) { finish(false); return }
  if (!dragging.value && Math.abs(dx) < 5) return
  if (!dragging.value) { dragging.value = true; emit('interaction-start') }
  event.preventDefault()
  const value = bounded(originValue - dx / spacing)
  // Drag pixels move immediately; numeric commits retain their integer contract.
  visualValue.value = value
  emit('update:modelValue', Math.round(value))
}
function finish(snap = true) {
  const id = pointer, wasDragging = dragging.value
  pointer = undefined; dragging.value = false
  if (id !== undefined && root.value?.hasPointerCapture(id)) root.value.releasePointerCapture(id)
  if (wasDragging && snap) void nextTick(() => animateTo(props.modelValue, 180))
  else if (!wasDragging) animateTo(props.modelValue)
}
function up(event: PointerEvent) { if (pointer !== event.pointerId) return; move(event); finish() }
function key(event: KeyboardEvent) {
  if (props.disabled) return
  const delta = event.shiftKey ? 10 : 1
  if (event.key === 'ArrowLeft' || event.key === 'ArrowDown') set(Math.round(props.modelValue) - delta)
  else if (event.key === 'ArrowRight' || event.key === 'ArrowUp') set(Math.round(props.modelValue) + delta)
  else if (event.key === 'Home') set(props.cycle ? props.modelValue - wheelLabel(Math.round(props.modelValue), props.cycle) : props.min)
  else if (event.key === 'End') set(props.cycle ? props.modelValue - wheelLabel(Math.round(props.modelValue), props.cycle) + props.cycle - 1 : props.max)
  else return
  event.preventDefault()
}
watch(() => props.modelValue, value => { if (!dragging.value) animateTo(value) })
watch(reducedMotion, () => { stopAnimation(); visualValue.value = props.modelValue })
watch(() => props.disabled, value => { if (value) finish() })
function visibility() { if (document.visibilityState === 'hidden') { finish(false); stopAnimation(); visualValue.value = props.modelValue } }
onMounted(() => document.addEventListener('visibilitychange', visibility))
onBeforeUnmount(() => { finish(false); stopAnimation(); document.removeEventListener('visibilitychange', visibility) })
</script>

<template>
  <div ref="root" class="arc-wheel-control" :class="{ dragging }" :data-value="modelValue" :data-visual-value="visualValue" :data-motion="reducedMotion ? 'reduced' : 'full'" :aria-disabled="disabled" @pointerdown="down" @pointermove="move" @pointerup="up" @pointercancel="finish()" @lostpointercapture="pointer !== undefined && finish()">
    <div class="wheel-label"><span>{{ label }}</span><slot /></div>
    <div ref="slider" class="arc-wheel" role="slider" :tabindex="disabled ? -1 : 0" :aria-label="label" :aria-valuemin="min" :aria-valuemax="max" :aria-valuenow="Math.round(modelValue)" :aria-valuetext="valueText" :aria-disabled="disabled" @keydown="key">
      <span class="wheel-axis"></span><span class="wheel-pointer"></span>
      <span v-for="tick in ticks" :key="tick.value" class="wheel-tick" :class="{ major: tick.label % 5 === 0 }" :data-tick="tick.value" :data-label="tick.label" :style="{ '--wheel-x': tick.distance * spacing + 'px', '--wheel-y': Math.pow(Math.abs(tick.distance), 2) * 1.1 + 'px', opacity: Math.max(.08, 1 - Math.abs(tick.distance) / 9) }" aria-hidden="true"><i></i><b>{{ cycle ? String(tick.label).padStart(2, '0') : tick.label }}</b></span>
    </div>
  </div>
</template>

<style scoped>
.arc-wheel-control { position:relative; width:100%; min-width:0; overflow:hidden; touch-action:pan-y; user-select:none; border-radius:18px; background:var(--surface); cursor:ew-resize; border:1px solid var(--line); margin:12px 0; transition:border-color var(--motion-state, 220ms) ease,box-shadow var(--motion-state, 220ms) ease; }
.arc-wheel-control:focus-within,.arc-wheel-control.dragging { border-color:var(--accent); box-shadow:0 0 0 2px var(--accent-soft); }
.arc-wheel-control[aria-disabled='true'] { cursor:default; opacity:.75; }
.wheel-label { display:flex; align-items:center; justify-content:space-between; gap:10px; padding:10px 12px 2px; font-size:calc(13px * var(--ui-font-scale, 1)); }
.arc-wheel { position:relative; height:104px; width:100%; outline:none; }
.wheel-axis { position:absolute; left:8%; top:30px; width:84%; height:125px; border-radius:50%; border-top:1px solid var(--line); }
.wheel-pointer { position:absolute; left:calc(50% - 2px); top:8px; width:4px; height:17px; background:var(--accent); border-radius:3px; }
.wheel-tick { position:absolute; left:50%; top:30px; width:30px; display:flex; align-items:center; flex-direction:column; gap:8px; transform:translate(calc(var(--wheel-x) - 50%),var(--wheel-y)); color:var(--accent); pointer-events:none; }
.wheel-tick i { width:2px; height:9px; background:currentColor; border-radius:2px; }.wheel-tick.major i { height:14px; }
.wheel-tick b { font-size:calc(12px * var(--ui-font-scale, 1)); font-weight:500; }
html[data-motion='reduced'] .arc-wheel-control { transition:none; }
</style>
