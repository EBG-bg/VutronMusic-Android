<script setup lang="ts">
import { computed, onBeforeUnmount, ref, watch, type StyleValue } from 'vue'

defineOptions({ inheritAttrs: false })
const props = withDefaults(defineProps<{
  value: number | string
  min?: number | string
  max?: number | string
  step?: number | string
  disabled?: boolean
  variant?: 'default' | 'color'
}>(), { min: 0, max: 100, step: 1, disabled: false, variant: 'default' })
const emit = defineEmits<{ input: [event: Event]; change: [event: Event]; cancel: [] }>()
const input = ref<HTMLInputElement>()
const path = ref<HTMLElement>()
const thumb = ref<HTMLElement>()
const current = ref(Number(props.value))
const dragging = ref(false)
const percent = computed(() => {
  const span = Number(props.max) - Number(props.min)
  return span > 0 ? Math.max(0, Math.min(100, (current.value - Number(props.min)) / span * 100)) : 0
})
let gesture: { pointer: number; handle: HTMLElement; x: number; y: number; origin: number; scale: number; initial: number; changed: boolean } | undefined

function setValue(value: number) {
  if (!input.value) return false
  // The native input clamps the value and rounds to step for every input method.
  input.value.value = String(value)
  if (input.value.valueAsNumber === current.value) return false
  input.value.dispatchEvent(new Event('input', { bubbles: true }))
  return true
}

function inputValue(event: Event) {
  current.value = (event.target as HTMLInputElement).valueAsNumber
  emit('input', event)
}
function pointerDown(event: PointerEvent) {
  if (props.disabled || gesture || !event.isPrimary || event.button !== 0 || !input.value) return
  const rect = path.value?.getBoundingClientRect()
  if (!rect?.width) return
  const onThumb = event.target === thumb.value
  const scale = (Number(props.max) - Number(props.min)) / rect.width
  const initial = input.value.valueAsNumber
  const handle = event.currentTarget as HTMLElement
  // Thumb drags preserve the grab offset; a drag from the rail follows the pointer position.
  const origin = onThumb ? initial : Number(props.min) + (event.clientX - rect.left) * scale
  gesture = { pointer: event.pointerId, handle, x: event.clientX, y: event.clientY, origin, scale, initial, changed: false }
  handle.setPointerCapture(event.pointerId)
  if (onThumb) {
    dragging.value = true
    input.value.focus({ preventScroll: true })
    event.preventDefault()
  }
}
function updatePointer(event: PointerEvent, ending: boolean) {
  const active = gesture
  if (!active || event.pointerId !== active.pointer) return
  const dx = event.clientX - active.x
  if (!dragging.value) {
    const dy = event.clientY - active.y
    if (Math.hypot(dx, dy) > 8) {
      if (Math.abs(dx) <= Math.abs(dy)) { release(); return }
    } else if (!ending) return
    dragging.value = true
    input.value?.focus({ preventScroll: true })
  }
  if (setValue(active.origin + dx * active.scale)) active.changed = true
  if (ending) {
    release()
    if (active.changed) input.value?.dispatchEvent(new Event('change', { bubbles: true }))
  }
}
function release() {
  const previous = gesture
  gesture = undefined
  dragging.value = false
  if (previous?.handle.hasPointerCapture(previous.pointer)) previous.handle.releasePointerCapture(previous.pointer)
}
function cancel(event?: PointerEvent) {
  const active = gesture
  if (!active || (event && active.pointer !== event.pointerId)) return
  release()
  if (active.changed) {
    setValue(active.initial)
    emit('cancel')
  }
}
watch(() => props.value, value => { if (!dragging.value) current.value = Number(value) })
watch(() => props.disabled, disabled => { if (disabled) { release(); emit('cancel'); current.value = Number(props.value) } })
onBeforeUnmount(release)
</script>

<template>
  <span class="thumb-range" :data-dragging="dragging ? '' : undefined" :class="[$attrs.class, { 'thumb-range-color': variant === 'color', 'thumb-range-disabled': disabled }]" :style="[$attrs.style as StyleValue, { '--range-position': `${percent}%` }]" @pointerdown="pointerDown" @pointermove="updatePointer($event, false)" @pointerup="updatePointer($event, true)" @pointercancel="cancel" @lostpointercapture="cancel" @click.prevent>
    <input v-bind="$attrs" ref="input" class="thumb-range-input" type="range" :min="min" :max="max" :step="step" :value="current" :disabled="disabled" @input="inputValue" @change="emit('change', $event)" />
    <span ref="path" class="thumb-range-path" aria-hidden="true">
      <span class="thumb-range-rail"><span class="thumb-range-fill"></span></span>
      <span ref="thumb" class="thumb-range-thumb"></span>
    </span>
  </span>
</template>

<style scoped>
.thumb-range { --range-thumb-width: 36px; position: relative; display: block; width: 100%; min-width: 0; max-width: 100%; height: 48px; margin: 0; padding: 0; border: 0; touch-action: pan-y; user-select: none; }
.thumb-range > .thumb-range-input { position: absolute; inset: 0; display: block; width: 100%; height: 100%; min-width: 0; margin: 0; padding: 0; border: 0; opacity: 0; pointer-events: none; }
.thumb-range-path { position: absolute; top: 50%; left: calc(var(--range-thumb-width) / 2 + 2px); right: calc(var(--range-thumb-width) / 2 + 2px); height: 0; pointer-events: none; }
.thumb-range-rail { position: absolute; top: -2.5px; left: 0; right: 0; height: 5px; border-radius: 999px; background: var(--line-strong, var(--line)); }
.thumb-range-fill { display: block; width: var(--range-position); height: 100%; border-radius: inherit; background: var(--accent); transition: width var(--motion-slider, 180ms) ease-out; }
.thumb-range-thumb { position: absolute; top: 0; left: var(--range-position); width: var(--range-thumb-width); height: 44px; display: grid; place-items: center; transform: translate(-50%, -50%); pointer-events: auto; touch-action: none; cursor: ew-resize; transition: left var(--motion-slider, 180ms) ease-out; }
.thumb-range-thumb::after { content: ''; width: 17px; height: 17px; box-sizing: border-box; border: 2.5px solid var(--color-body-bg); border-radius: 50%; background: var(--accent); box-shadow: 0 2px 6px rgb(0 0 0 / 22%); transition: transform var(--motion-feedback, 180ms) ease, box-shadow var(--motion-state, 220ms) ease; }
.thumb-range[data-dragging] .thumb-range-fill { transition: none; }
.thumb-range[data-dragging] .thumb-range-thumb { transition: none; }
.thumb-range[data-dragging] .thumb-range-thumb::after { transform: scale(1.18); box-shadow: 0 0 0 5px var(--accent-soft), 0 3px 8px rgb(0 0 0 / 24%); }
@media (hover: hover) { .thumb-range-thumb:hover::after { transform: scale(1.08); box-shadow: 0 0 0 4px var(--accent-soft), 0 2px 6px rgb(0 0 0 / 20%); } }
.thumb-range-input:focus-visible ~ .thumb-range-path .thumb-range-thumb::after { outline: 2px solid var(--accent); outline-offset: 2px; }
.thumb-range-color { height: 48px; }
.thumb-range-color .thumb-range-rail { display: none; }
.thumb-range-color .thumb-range-thumb::after { width: 12px; height: 28px; border-color: #fff; border-radius: 5px; background: transparent; box-shadow: 0 0 0 1px #0009; }
.thumb-range-color[data-dragging] .thumb-range-thumb::after { transform: scale(1.06); box-shadow: 0 0 0 2px #0009; }
.thumb-range-disabled { opacity: .5; }
.thumb-range-disabled .thumb-range-thumb { pointer-events: none; cursor: default; }
</style>
