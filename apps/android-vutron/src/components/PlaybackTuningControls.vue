<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted } from 'vue'
import ThumbRange from './ThumbRange.vue'
import { usePlaybackTuning } from '../composables/playbackTuning'
import { useAndroidShellStore } from '../stores/androidShell'

const { settings, ready, loading, saving, pending, error, errorKind, load, update, flush } = usePlaybackTuning()
const store = useAndroidShellStore()
const applied = computed(() => Boolean(store.playback.tuningApplied && !store.playback.error))
const actualSpeed = computed(() => store.playback.rate ?? settings.actualSpeed)
const actualPitch = computed(() => store.playback.pitch ?? settings.actualPitch)
const fallback = computed(() => !applied.value || pending.value || saving.value ? ''
  : Math.abs(actualSpeed.value - settings.speed) > .005 ? 'speedFallback'
    : Math.abs(actualPitch.value - settings.pitch) > .005 ? 'pitchFallback' : '')
const speedPresets = [.75, 1, 1.25, 1.5, 2]
function change(key: 'speed' | 'pitch', event: Event) {
  const input = event.target as HTMLInputElement
  if (input.value.trim() !== '' && Number.isFinite(input.valueAsNumber)) update({ [key]: input.valueAsNumber })
}
function exact(key: 'speed' | 'pitch', event: Event) {
  change(key, event)
  const input = event.target as HTMLInputElement
  input.value = String(settings[key])
  void flush()
}
onMounted(load)
onBeforeUnmount(() => { void flush() })
</script>

<template>
  <div class="playback-tuning-controls" :aria-busy="loading && !ready">
    <section class="tuning-control-block">
      <div class="tuning-control-heading"><label for="tuning-speed">{{ $t('mobile.advancedPlayback.speed') }}</label><output>{{ settings.speed.toFixed(2) }}×</output></div>
      <ThumbRange id="tuning-speed" :value="settings.speed" min="0.5" max="2" step="0.01" :disabled="!ready" :aria-label="$t('mobile.advancedPlayback.speed')" @input="change('speed', $event)" @change="flush()" />
      <div class="tuning-presets" role="group" :aria-label="$t('mobile.advancedPlayback.presets')"><button v-for="rate in speedPresets" :key="rate" type="button" class="secondary-button" :class="{ selected: settings.speed === rate }" :aria-pressed="settings.speed === rate" :disabled="!ready" @click="update({ speed: rate }); flush()">{{ rate }}×</button></div>
      <label class="tuning-exact"><span>{{ $t('mobile.advancedPlayback.exact') }}</span><span><input type="number" min="0.5" max="2" step="0.01" inputmode="decimal" :value="settings.speed.toFixed(2)" :disabled="!ready" :aria-label="$t('mobile.advancedPlayback.exactSpeed')" @change="exact('speed', $event)" />×</span></label>
      <p class="setting-note">{{ $t('mobile.advancedPlayback.speedHint') }}</p>
    </section>
    <section class="tuning-control-block">
      <div class="tuning-control-heading"><label for="tuning-pitch">{{ $t('mobile.advancedPlayback.pitchRatio') }}</label><output>{{ settings.pitch.toFixed(2) }}×</output></div>
      <ThumbRange id="tuning-pitch" :value="settings.pitch" min="0.5" max="2" step="0.01" :disabled="!ready" :aria-label="$t('mobile.advancedPlayback.pitchRatio')" @input="change('pitch', $event)" @change="flush()" />
      <div class="tuning-pitch-actions"><button class="secondary-button" type="button" :disabled="!ready" @click="update({ pitch: 1 }); flush()">{{ $t('mobile.advancedPlayback.originalPitch') }}</button><label class="tuning-exact"><span>{{ $t('mobile.advancedPlayback.exact') }}</span><span><input type="number" min="0.5" max="2" step="0.01" inputmode="decimal" :value="settings.pitch.toFixed(2)" :disabled="!ready" :aria-label="$t('mobile.advancedPlayback.exactPitch')" @change="exact('pitch', $event)" />×</span></label></div>
      <p class="setting-note">{{ $t('mobile.advancedPlayback.pitchHint') }} · {{ $t('mobile.advancedPlayback.pitchFallback') }}</p>
    </section>
    <p class="tuning-effective setting-note" role="status">{{ applied ? $t('mobile.playbackFeedback.actual', { speed: actualSpeed.toFixed(2), pitch: actualPitch.toFixed(2) }) : $t('mobile.playbackFeedback.whenPlaying') }}</p>
    <div class="tuning-footer"><button class="text-button" type="button" :disabled="!ready" @click="update({ speed: 1, pitch: 1 }); flush()">{{ $t('mobile.advancedPlayback.reset') }}</button><small role="status">{{ $t(pending || saving ? 'mobile.advancedPlayback.saving' : 'mobile.advancedPlayback.saveHint') }}</small></div>
    <p v-if="fallback" class="setting-note" role="status">{{ $t(`mobile.playbackFeedback.${fallback}`) }}</p>
    <p v-if="error" class="inline-error" role="alert">{{ $t(`mobile.playbackFeedback.${errorKind}Error`) }} <button class="text-button" type="button" @click="errorKind === 'save' ? flush() : load()">{{ $t('mobile.advancedPlayback.retry') }}</button></p>
  </div>
</template>

<style scoped>
.playback-tuning-controls { display: grid; gap: 14px; min-width: 0; }
.tuning-control-block { min-width: 0; padding: 12px; border: 1px solid var(--line); border-radius: 14px; background: var(--color-body-bg); }
.tuning-control-heading { display: flex; align-items: center; justify-content: space-between; gap: 10px; font-size: 13px; font-weight: 650; }
.tuning-control-heading output { font-size: 18px; color: var(--accent); font-variant-numeric: tabular-nums; }
.tuning-presets { display: grid; grid-template-columns: repeat(5, minmax(0, 1fr)); gap: 5px; margin: 5px 0 10px; }
.tuning-presets button { min-width: 0; min-height: 34px; padding: 5px 2px; font-size: 12px; font-variant-numeric: tabular-nums; }
.tuning-presets button.selected { color: var(--accent); background: var(--accent-soft); box-shadow: inset 0 0 0 1px var(--accent); }
.tuning-exact { display: flex; align-items: center; justify-content: space-between; gap: 8px; color: var(--muted); font-size: 12px; }
.tuning-exact > span:last-child { display: inline-flex; align-items: center; gap: 5px; }
.tuning-exact input { width: 70px; min-width: 0; padding: 6px; border: 1px solid var(--line); border-radius: 8px; color: var(--ink); background: var(--surface); text-align: center; font-variant-numeric: tabular-nums; }
.tuning-pitch-actions { display: flex; align-items: center; justify-content: space-between; gap: 8px; flex-wrap: wrap; }
.tuning-pitch-actions button { font-size: 12px; }
.tuning-footer { display: flex; justify-content: space-between; align-items: center; gap: 10px; }
.tuning-footer small { min-width: 0; text-align: right; color: var(--muted); font-size: 11px; }
.tuning-footer > button { min-width: 0; white-space: normal; }
.setting-note { margin: 9px 0 0; line-height: 1.65; }
</style>
