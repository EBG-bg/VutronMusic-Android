<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref, watch } from 'vue'
import { useAndroidShellStore } from '../stores/androidShell'
import { timerPreset, sleepMode, sleepTrackCount, sleepFadeSeconds } from '../platform/interfacePreferences'
import { vutronPlugin } from '../platform/vutronPlugin'
import { useI18n } from 'vue-i18n'
import ArcWheel from './ArcWheel.vue'
import OriginalIcon from './OriginalIcon.vue'
import CollapsibleSettingsCard from './CollapsibleSettingsCard.vue'
import AppSelect from './AppSelect.vue'
import ThumbRange from './ThumbRange.vue'
import AppErrorNotice from './AppErrorNotice.vue'
import { reducedMotion, settingsMotionDuration } from '../platform/motion'
import { clampTimerSeconds, editTimerPart, timerParts, timerLabel, MAX_TIMER_SECONDS } from '../utils/sleepTimer'
const store = useAndroidShellStore()
const { t } = useI18n()
const editing = ref(false)
const running = computed(() => store.sleepTimerActive)
const preparedTrack = computed(() => Boolean(store.playback.trackId && store.playback.duration > 0))
const following = computed(() => running.value && store.sleepTimerMode === 'duration' && sleepMode.value === 'duration' && !editing.value)
const abConflict = ref(false), localError = ref(''), abBusy = ref(false)
const modeBody = ref<HTMLElement>()
let modeAnimation: Animation | undefined, modeRevision = 0
function clearModeHeight() {
  ++modeRevision; modeAnimation?.cancel(); modeAnimation = undefined
  modeBody.value?.style.removeProperty('height')
}
function prepareModeLeave(element: Element) {
  const body = modeBody.value
  if (!body) return
  const height = body.getBoundingClientRect().height
  ++modeRevision; modeAnimation?.cancel(); modeAnimation = undefined
  body.style.height = `${height}px`
  ;(element as HTMLElement).inert = true
}
async function animateModeEnter(element: Element) {
  const body = modeBody.value
  if (!body) return
  const child = element as HTMLElement, style = getComputedStyle(child)
  const from = body.getBoundingClientRect().height
  const to = child.getBoundingClientRect().height + parseFloat(style.marginTop || '0') + parseFloat(style.marginBottom || '0')
  child.inert = false
  const duration = settingsMotionDuration(Math.max(from, to), to > from)
  if (!duration) { clearModeHeight(); return }
  const token = ++modeRevision
  modeAnimation = body.animate([{ height: `${from}px` }, { height: `${to}px` }], { duration, easing: to > from ? 'cubic-bezier(.2,.75,.25,1)' : 'ease-in-out', fill: 'both' })
  try { await modeAnimation.finished } catch { return }
  if (token === modeRevision) clearModeHeight()
}
watch(reducedMotion, reduced => { if (reduced) clearModeHeight() })
onBeforeUnmount(clearModeHeight)
const currentStatus = computed(() => !running.value ? t('mobile.settingsUi.timerHint') : store.sleepTimerMode === 'duration'
  ? t('mobile.settingsUi.timerRemaining', { time: store.sleepTimerLabel }) : store.sleepTimerMode === 'track'
    ? t('mobile.sleepEnhanced.runningTrack') : t('mobile.sleepEnhanced.runningCount', { count: store.sleepTimerRemainingTracks }))
const modeOptions = computed(() => ['duration', 'track', 'count'].map(value => ({ value, label: t('mobile.sleepEnhanced.mode_' + value) })))
const fadeOptions = computed(() => [0, 5, 15, 30].map(value => ({ value, label: value ? t('mobile.sleepEnhanced.fadeSeconds', { count: value }) : t('mobile.sleepEnhanced.noFade') })))
const currentSeconds = computed(() => following.value ? Math.max(0, store.sleepTimerRemainingMs / 1000) : timerPreset.value)
const parts = computed(() => timerParts(currentSeconds.value))
const minuteWheel = computed(() => following.value ? Math.min(300, currentSeconds.value / 60) : parts.value.minutes)
const durationLabel = computed(() => timerLabel(currentSeconds.value * 1000))
function beginEdit() {
  if (following.value) timerPreset.value = clampTimerSeconds(Math.ceil(store.sleepTimerRemainingMs / 1000))
  editing.value = true
}
function edit(part: 'minutes' | 'seconds', value: number) {
  if (!Number.isFinite(value)) return
  beginEdit()
  timerPreset.value = editTimerPart(timerPreset.value, part, value)
}
function editSeconds(value: number) { beginEdit(); timerPreset.value = clampTimerSeconds(value) }
async function refreshAbConflict() {
  if (sleepMode.value === 'duration' || !vutronPlugin.getAbLoop) { abConflict.value = false; return }
  try { abConflict.value = (await vutronPlugin.getAbLoop()).enabled } catch { /* The native start operation still validates conflicts. */ }
}
async function disableAb() {
  if (abBusy.value || !vutronPlugin.getAbLoop || !vutronPlugin.setAbLoop) return
  abBusy.value = true; localError.value = ''
  try { const state = await vutronPlugin.getAbLoop(); const next = await vutronPlugin.setAbLoop({ expectedTrackKey: state.trackKey, enabled: false }); abConflict.value = next.enabled; store.applyAbLoopState(next) }
  catch (cause) { localError.value = cause instanceof Error ? cause.message : t('mobile.sleepEnhanced.failed') }
  finally { abBusy.value = false }
}
async function start() {
  localError.value = ''
  await refreshAbConflict()
  if (abConflict.value) return
  if (await store.setSleepTimerSettings({ mode: sleepMode.value, ...(sleepMode.value === 'duration' ? { durationMs: timerPreset.value * 1000 } : sleepMode.value === 'count' ? { trackCount: sleepTrackCount.value } : {}), fadeSeconds: sleepFadeSeconds.value })) editing.value = false
}
watch(sleepMode, () => { editing.value = true; void refreshAbConflict() })
onMounted(refreshAbConflict)
</script>
<template>
  <CollapsibleSettingsCard section-id="timer" :title="$t('mobile.settingsUi.timer')">
    <template #heading><span class="settings-icon coral"><OriginalIcon name="timer" /></span><div><h3>{{ $t('mobile.settingsUi.timer') }}</h3><p>{{ currentStatus }}</p></div></template>
    <AppSelect v-model="sleepMode" :label="$t('mobile.sleepEnhanced.mode')" :options="modeOptions" :disabled="store.sleepTimerBusy" />
    <div ref="modeBody" class="sleep-mode-body"><Transition name="content-switch" mode="out-in" @before-leave="prepareModeLeave" @enter="animateModeEnter">
    <div v-if="sleepMode === 'duration'" key="duration">
    <output class="timer-readout" role="timer" aria-live="off">{{ durationLabel }}</output>
    <ArcWheel :model-value="minuteWheel" :min="0" :max="300" :label="$t('mobile.refinements.minutes')" :value-text="durationLabel" :running="following" :disabled="store.sleepTimerBusy" @interaction-start="beginEdit" @update:model-value="edit('minutes', $event)">
      <input type="number" min="0" max="300" :value="parts.minutes" :aria-label="$t('mobile.refinements.minutes')" :disabled="store.sleepTimerBusy" @change="edit('minutes', Number(($event.target as HTMLInputElement).value))" />
    </ArcWheel>
    <ArcWheel :model-value="currentSeconds" :min="following ? 0 : 1" :max="MAX_TIMER_SECONDS" :cycle="60" :label="$t('mobile.refinements.seconds')" :value-text="durationLabel" :running="following" :disabled="store.sleepTimerBusy" @interaction-start="beginEdit" @update:model-value="editSeconds">
      <input type="number" min="0" max="59" :value="parts.seconds" :aria-label="$t('mobile.refinements.seconds')" :disabled="store.sleepTimerBusy" @change="edit('seconds', Number(($event.target as HTMLInputElement).value))" />
    </ArcWheel>
    <p class="setting-note">{{ $t('mobile.refinements.timerPrecision') }}</p>
    </div>
    <div v-else-if="sleepMode === 'count'" key="count" class="sleep-track-count">
      <label><span>{{ $t('mobile.sleepEnhanced.count') }}</span><span><input v-model.number="sleepTrackCount" type="number" min="1" max="100" inputmode="numeric" :aria-label="$t('mobile.sleepEnhanced.count')" :disabled="store.sleepTimerBusy" @change="sleepTrackCount = Math.max(1, Math.min(100, Math.round(sleepTrackCount || 1)))" />{{ $t('mobile.sleepEnhanced.tracks') }}</span></label>
      <ThumbRange :value="sleepTrackCount" min="1" max="100" :disabled="store.sleepTimerBusy" :aria-label="$t('mobile.sleepEnhanced.count')" @input="sleepTrackCount = Number(($event.target as HTMLInputElement).value)" />
      <p class="setting-note">{{ $t('mobile.sleepEnhanced.countHint') }}</p>
    </div>
    <p v-else key="track" class="setting-note sleep-track-hint">{{ $t('mobile.sleepEnhanced.trackHint') }}</p>
    </Transition></div>
    <div class="sleep-fade"><AppSelect v-model="sleepFadeSeconds" :label="$t('mobile.sleepEnhanced.fade')" :options="fadeOptions" :disabled="store.sleepTimerBusy" /><p class="setting-note">{{ $t('mobile.sleepEnhanced.fadeHint') }}</p></div>
    <p v-if="sleepMode !== 'duration' && !preparedTrack" class="setting-note">{{ $t('mobile.sleepEnhanced.needsTrack') }}</p>
    <div v-if="abConflict" class="inline-error" role="status">{{ $t('mobile.sleepEnhanced.abConflict') }} <button class="text-button" type="button" :disabled="abBusy" @click="disableAb">{{ $t('mobile.sleepEnhanced.disableAb') }}</button></div>
    <AppErrorNotice v-if="localError" :message="localError" inline @close="localError = ''" />
    <div class="timer-actions"><button class="secondary-button" type="button" :disabled="store.sleepTimerBusy || abBusy || sleepMode !== 'duration' && !preparedTrack" @click="start">{{ $t('mobile.settingsUi.startTimer') }}</button><button class="text-button" type="button" :disabled="!running || store.sleepTimerBusy" @click="store.clearSleepTimer(); editing = false">{{ $t('mobile.settingsUi.cancelTimer') }}</button></div>
  </CollapsibleSettingsCard>
</template>
<style scoped>
.timer-readout { display:block; text-align:center; font-size:calc(32px * var(--ui-font-scale, 1)); font-variant-numeric:tabular-nums; color:var(--accent); margin:8px 0 12px; }.arc-wheel-control input { width:78px; min-width:0; padding:8px; border:1px solid var(--line); border-radius:10px; background:var(--color-body-bg); color:var(--ink); touch-action:manipulation; }
.sleep-mode-body { overflow:hidden; }.sleep-mode-body>* { display:flow-root; }.sleep-track-count { margin-top:14px; }.sleep-track-count>label { display:flex;align-items:center;justify-content:space-between;gap:12px;font-size:calc(13px * var(--ui-font-scale,1)); }.sleep-track-count>label>span:first-child { min-width:0; }.sleep-track-count>label>span:last-child { display:flex;align-items:center;gap:7px;flex:none;white-space:nowrap; }.sleep-track-count input { width:72px;min-width:0;padding:8px;border:1px solid var(--line);border-radius:var(--radius-control);background:var(--surface);color:var(--ink);font:inherit; }.sleep-fade { margin:16px 0; }.sleep-track-hint { padding:12px;border-radius:var(--radius-control);background:var(--surface); }.timer-actions { flex-wrap:wrap; }.timer-actions button { min-height:44px; }
</style>
