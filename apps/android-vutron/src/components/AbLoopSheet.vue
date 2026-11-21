<script setup lang="ts">
import { computed, onMounted, onUnmounted, ref, shallowRef, watch } from 'vue'
import { useI18n } from 'vue-i18n'
import { useAndroidShellStore } from '../stores/androidShell'
import { vutronPlugin, type VutronAbLoopState } from '../platform/vutronPlugin'
import { useModalFocus } from '../composables/modalFocus'
import { useSheetDrag } from '../composables/sheetDrag'
import OriginalIcon from './OriginalIcon.vue'
import SheetDragHandle from './SheetDragHandle.vue'
import AppErrorNotice from './AppErrorNotice.vue'
import AbLoopSlider from './AbLoopSlider.vue'
import FloatingField from './FloatingField.vue'

const emit = defineEmits<{ close: []; changed: [enabled: boolean] }>()
const props = defineProps<{ returnFocus?: HTMLElement }>()
const store = useAndroidShellStore(), { t } = useI18n()
const sheet = ref<HTMLElement>(), loading = ref(false), busy = ref(false), checking = ref(false), error = ref(''), sleepConflict = ref(false)
const pending = computed(() => busy.value || checking.value)
const state = ref<VutronAbLoopState>({ trackKey: '', trackId: 0, startMs: -1, endMs: -1, enabled: false, minSpanMs: 500, durationMs: 0 })
const ready = computed(() => Boolean(state.value.trackKey && state.value.durationMs > 0))
const validRange = computed(() => ready.value && state.value.startMs >= 0 && state.value.endMs - state.value.startMs >= state.value.minSpanMs && state.value.endMs <= state.value.durationMs)
const sliderPreview = ref<{ which: 'startMs' | 'endMs'; time: number }>()
const sliderPending = shallowRef<typeof sliderPreview.value>()
const displayedPoint = (which: 'startMs' | 'endMs') => {
  const draft = sliderPreview.value ?? sliderPending.value
  return draft?.which === which ? draft.time : state.value[which]
}
const seconds = (milliseconds: number) => milliseconds < 0 ? '' : (milliseconds / 1000).toFixed(2)
const clock = (milliseconds: number) => milliseconds < 0 ? t('mobile.abLoop.unset') : `${Math.floor(milliseconds / 60000)}:${(milliseconds / 1000 % 60).toFixed(2).padStart(5, '0')}`
let generation = 0
useModalFocus(sheet, { close: () => emit('close'), returnFocus: () => props.returnFocus })
useSheetDrag(sheet, { close: () => emit('close') })
function apply(next: VutronAbLoopState) { state.value = next; store.applyAbLoopState(next); emit('changed', next.enabled) }
async function load() {
  const token = ++generation; loading.value = true; error.value = ''
  try {
    if (!vutronPlugin.getAbLoop) throw new Error(t('mobile.abLoop.unavailable'))
    const [loop, timer] = await Promise.all([vutronPlugin.getAbLoop(), vutronPlugin.getSleepTimer?.()])
    if (token !== generation) return
    apply(loop)
    sleepConflict.value = Boolean(timer?.active && timer.mode !== 'duration')
  } catch (cause) { if (token === generation) error.value = cause instanceof Error ? cause.message : t('mobile.abLoop.failed') }
  finally { if (token === generation) loading.value = false }
}
async function update(patch: { action?: 'set' | 'clear'; startMs?: number; endMs?: number; enabled?: boolean }) {
  if (busy.value || !ready.value || !vutronPlugin.setAbLoop) return
  const token = generation, trackKey = state.value.trackKey
  const trackIdentity = [store.playback.trackId, store.playback.track?.pluginId, store.playback.track?.pluginAccountScope, store.playback.track?.pluginTrackId].join('|')
  busy.value = true; error.value = ''
  try {
    const next = await vutronPlugin.setAbLoop({ expectedTrackKey: trackKey, ...patch })
    if (trackIdentity === [store.playback.trackId, store.playback.track?.pluginId, store.playback.track?.pluginAccountScope, store.playback.track?.pluginTrackId].join('|')) store.applyAbLoopState(next)
    if (token === generation) apply(next)
  } catch (cause) { if (token === generation) error.value = cause instanceof Error ? cause.message : t('mobile.abLoop.failed') }
  finally { if (token === generation) busy.value = false }
}
async function commitSlider(which: 'startMs' | 'endMs', time: number) {
  const edit = { which, time }; sliderPending.value = edit
  try { await update({ [which]: time, enabled: false }) }
  finally { if (sliderPending.value === edit) sliderPending.value = undefined }
}
async function mark(which: 'startMs' | 'endMs') {
  if (!ready.value || pending.value) return
  const token = generation
  checking.value = true
  try {
    const current = await vutronPlugin.getAbLoop!()
    if (token !== generation || current.trackKey !== state.value.trackKey) return
    await update({ [which]: Math.max(0, Math.min(state.value.durationMs, Math.round(current.positionMs ?? store.playback.position))), enabled: false })
  } catch (cause) { if (token === generation) error.value = cause instanceof Error ? cause.message : t('mobile.abLoop.failed') }
  finally { checking.value = false }
}
function exact(which: 'startMs' | 'endMs', event: Event) {
  const input = event.target as HTMLInputElement
  if (input.value.trim() === '') { void update({ [which]: -1, enabled: false }); return }
  if (!Number.isFinite(input.valueAsNumber)) return
  void update({ [which]: Math.max(0, Math.min(state.value.durationMs, Math.round(input.valueAsNumber * 1000))), enabled: false })
}
async function toggle() {
  if (pending.value) return
  if (!state.value.enabled) {
    const token = generation
    checking.value = true
    try {
      const timer = await vutronPlugin.getSleepTimer?.()
      if (token !== generation) return
      sleepConflict.value = Boolean(timer?.active && timer.mode !== 'duration')
      if (sleepConflict.value) return
    } catch (cause) { error.value = cause instanceof Error ? cause.message : t('mobile.abLoop.failed'); return }
    finally { checking.value = false }
  }
  await update({ enabled: !state.value.enabled })
}
async function cancelSongTimer() {
  if (pending.value) return
  checking.value = true; error.value = ''
  try {
    await store.clearSleepTimer()
    const timer = await vutronPlugin.getSleepTimer?.()
    sleepConflict.value = Boolean(timer?.active && timer.mode !== 'duration')
    if (sleepConflict.value && store.error) error.value = store.error
  } catch (cause) { error.value = cause instanceof Error ? cause.message : t('mobile.abLoop.failed') }
  finally { checking.value = false }
}
watch([() => store.playback.trackId, () => store.playback.track?.pluginId, () => store.playback.track?.pluginAccountScope, () => store.playback.track?.pluginTrackId], () => { sliderPreview.value = undefined; sliderPending.value = undefined; busy.value = false; checking.value = false; void load() })
watch([() => store.playback.duration, () => store.playback.buffering], ([duration, buffering]) => {
  if (!ready.value && duration > 0 && !buffering && !loading.value && !pending.value) void load()
})
onMounted(load)
onUnmounted(() => { ++generation })
</script>

<template>
  <div class="ab-loop-layer" @click.self="emit('close')">
    <section ref="sheet" class="ab-loop-sheet tuning-sheet" role="dialog" aria-modal="true" :aria-label="$t('mobile.abLoop.title')" tabindex="-1" :aria-busy="loading || pending">
      <SheetDragHandle @close="emit('close')" />
      <header data-sheet-drag-handle><div><h2>{{ $t('mobile.abLoop.title') }}</h2><p>{{ store.playback.title || $t('mobile.common.notPlaying') }}</p></div><button class="icon-button" type="button" :aria-label="$t('mobile.common.close')" @click="emit('close')"><OriginalIcon name="close" /></button></header>
      <div v-if="ready" class="ab-range-preview">
        <div class="ab-timestamps"><span><b>A</b>{{ clock(displayedPoint('startMs')) }}</span><span><b>B</b>{{ clock(displayedPoint('endMs')) }}</span></div>
        <AbLoopSlider :key="state.trackKey" :start-ms="sliderPending?.which === 'startMs' ? sliderPending.time : state.startMs" :end-ms="sliderPending?.which === 'endMs' ? sliderPending.time : state.endMs"
          :duration-ms="state.durationMs" :min-span-ms="state.minSpanMs" :position="store.playback.position"
          :disabled="pending || loading || state.durationMs < state.minSpanMs" @preview="sliderPreview = $event" @change="commitSlider" />
        <p class="setting-note">{{ $t('mobile.experience.hint') }}</p>
      </div>
      <div v-if="ready" class="ab-points">
        <section><button class="secondary-button" type="button" :disabled="!ready || pending || loading" @click="mark('startMs')">{{ $t('mobile.abLoop.markA') }}</button><FloatingField always-float :label="$t('mobile.abLoop.precisionTime', { point: 'A' })" :value="seconds(state.startMs)"><input type="number" inputmode="decimal" min="0" :max="state.durationMs / 1000" step="0.01" :value="seconds(state.startMs)" :disabled="pending || loading" @change="exact('startMs', $event)" /></FloatingField></section>
        <section><button class="secondary-button" type="button" :disabled="!ready || pending || loading" @click="mark('endMs')">{{ $t('mobile.abLoop.markB') }}</button><FloatingField always-float :label="$t('mobile.abLoop.precisionTime', { point: 'B' })" :value="seconds(state.endMs)"><input type="number" inputmode="decimal" min="0" :max="state.durationMs / 1000" step="0.01" :value="seconds(state.endMs)" :disabled="pending || loading" @change="exact('endMs', $event)" /></FloatingField></section>
      </div>
      <p v-if="!ready && !loading" class="setting-note">{{ $t('mobile.abLoop.needsTrack') }}</p><p v-else-if="!validRange" class="setting-note">{{ $t('mobile.abLoop.invalidRange', { seconds: state.minSpanMs / 1000 }) }}</p>
      <div v-if="sleepConflict && !state.enabled" class="inline-error" role="status">{{ $t('mobile.abLoop.sleepConflict') }} <button class="text-button" type="button" :disabled="store.sleepTimerBusy" @click="cancelSongTimer">{{ $t('mobile.abLoop.cancelSongTimer') }}</button></div>
      <AppErrorNotice v-if="error" :message="error" inline @close="error = ''" /><button v-if="error && !ready" class="text-button" type="button" :disabled="loading" @click="load">{{ $t('mobile.advancedPlayback.retry') }}</button>
      <div class="ab-actions"><button class="secondary-button" type="button" :class="{ selected: state.enabled }" :aria-pressed="state.enabled" :disabled="pending || loading || !ready || !state.enabled && !validRange" @click="toggle">{{ $t(state.enabled ? 'mobile.abLoop.disable' : 'mobile.abLoop.enable') }}</button><button class="text-button" type="button" :disabled="pending || loading || !ready || state.startMs < 0 && state.endMs < 0" @click="update({ action: 'clear' })">{{ $t('mobile.abLoop.clear') }}</button></div>
      <p v-if="ready" class="setting-note">{{ $t('mobile.experience.leaveLoop') }}</p>
    </section>
  </div>
</template>

<style scoped>
.ab-loop-layer { position: fixed; inset: 0; z-index: 200; display: flex; align-items: flex-end; justify-content: center; background: var(--scrim); backdrop-filter: blur(5px); -webkit-backdrop-filter: blur(5px); }
.ab-loop-sheet { width: min(100%, 560px); max-height: 90dvh; overflow: auto; overscroll-behavior: contain; padding: 16px 16px max(18px, env(safe-area-inset-bottom)); border: 1px solid var(--line); border-bottom: 0; border-radius: var(--radius-sheet) var(--radius-sheet) 0 0; background: var(--color-body-bg); color: var(--ink); box-shadow: var(--shadow-sheet); }
header { display: flex; align-items: center; justify-content: space-between; gap: 12px; padding-bottom: 12px; margin-bottom: 12px; border-bottom: 1px solid var(--line); }
h2 { margin: 0; font-size: calc(18px * var(--ui-font-scale, 1)); font-weight: 700; }
header p { margin: 4px 0 0; color: var(--muted); font-size: calc(12px * var(--ui-font-scale, 1)); overflow-wrap: anywhere; }
.ab-range-preview { border: 1px solid var(--line); border-radius: var(--radius-card); background: var(--surface-card); font-variant-numeric: tabular-nums;margin:12px 0;padding:12px; }
.ab-points { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 10px; }
.ab-points section { min-width: 0; padding: 12px; border: 1px solid var(--line); border-radius: var(--radius-card); background: var(--surface-card); }
.ab-points button { width: 100%; min-height: 44px; white-space: normal; font-size: calc(13px * var(--ui-font-scale, 1)); }
.ab-points input { font-variant-numeric: tabular-nums; }
.ab-points input:focus { outline: none; border-color: var(--accent); }
.ab-actions { display: flex; align-items: center; gap: 10px; flex-wrap: wrap; margin: 16px 0; }
.ab-actions button { min-height: 44px; }
.ab-actions .selected { color: var(--accent-ink); background: var(--accent-soft); border-color: var(--accent-border); }
.setting-note { line-height: 1.65; }
@media (max-width: 360px) { .ab-points { gap: 8px; } .ab-points section { padding: 10px; } }
.ab-range-preview p{margin:2px 0 0;text-align:center}
.ab-timestamps{display:flex;justify-content:space-between;gap:10px;font-size:calc(14px * var(--ui-font-scale,1));line-height:1.35}
.ab-timestamps span{display:flex;gap:6px;align-items:baseline;min-width:0}
.ab-timestamps b{color:var(--accent-ink)}
.ab-points .floating-field{margin-top:7px}
</style>
