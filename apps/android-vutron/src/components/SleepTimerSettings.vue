<script setup lang="ts">
import { computed, ref } from 'vue'
import { useAndroidShellStore } from '../stores/androidShell'
import { timerPreset } from '../platform/interfacePreferences'
import ArcWheel from './ArcWheel.vue'
import OriginalIcon from './OriginalIcon.vue'
import CollapsibleSettingsCard from './CollapsibleSettingsCard.vue'
import { clampTimerSeconds, editTimerPart, timerParts, timerLabel, MAX_TIMER_SECONDS } from '../utils/sleepTimer'
const store = useAndroidShellStore()
const editing = ref(false)
const running = computed(() => store.sleepTimerRemainingMs > 0)
const following = computed(() => running.value && !editing.value)
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
async function start() { await store.setSleepTimerSeconds(timerPreset.value); if (!store.error) editing.value = false }
</script>
<template>
  <CollapsibleSettingsCard section-id="timer" :title="$t('mobile.settingsUi.timer')">
    <template #heading><span class="settings-icon coral"><OriginalIcon name="timer" /></span><div><h3>{{ $t('mobile.settingsUi.timer') }}</h3><p>{{ $t(running ? 'mobile.settingsUi.timerRemaining' : 'mobile.settingsUi.timerHint', { time: store.sleepTimerLabel }) }}</p></div></template>
    <output class="timer-readout" role="timer" aria-live="off">{{ durationLabel }}</output>
    <ArcWheel :model-value="minuteWheel" :min="0" :max="300" :label="$t('mobile.refinements.minutes')" :value-text="durationLabel" :running="following" :disabled="store.sleepTimerBusy" @interaction-start="beginEdit" @update:model-value="edit('minutes', $event)">
      <input type="number" min="0" max="300" :value="parts.minutes" :aria-label="$t('mobile.refinements.minutes')" :disabled="store.sleepTimerBusy" @change="edit('minutes', Number(($event.target as HTMLInputElement).value))" />
    </ArcWheel>
    <ArcWheel :model-value="currentSeconds" :min="following ? 0 : 1" :max="MAX_TIMER_SECONDS" :cycle="60" :label="$t('mobile.refinements.seconds')" :value-text="durationLabel" :running="following" :disabled="store.sleepTimerBusy" @interaction-start="beginEdit" @update:model-value="editSeconds">
      <input type="number" min="0" max="59" :value="parts.seconds" :aria-label="$t('mobile.refinements.seconds')" :disabled="store.sleepTimerBusy" @change="edit('seconds', Number(($event.target as HTMLInputElement).value))" />
    </ArcWheel>
    <p class="setting-note">{{ $t('mobile.refinements.timerPrecision') }}</p>
    <div class="timer-actions"><button class="secondary-button" type="button" :disabled="store.sleepTimerBusy" @click="start">{{ $t('mobile.settingsUi.startTimer') }}</button><button class="text-button" type="button" :disabled="!running || store.sleepTimerBusy" @click="store.clearSleepTimer(); editing = false">{{ $t('mobile.settingsUi.cancelTimer') }}</button></div>
  </CollapsibleSettingsCard>
</template>
<style scoped>
.timer-readout { display:block; text-align:center; font-size:calc(32px * var(--ui-font-scale, 1)); font-variant-numeric:tabular-nums; color:var(--accent); margin:8px 0 12px; }.arc-wheel-control input { width:78px; min-width:0; padding:8px; border:1px solid var(--line); border-radius:10px; background:var(--color-body-bg); color:var(--ink); touch-action:manipulation; }
</style>
