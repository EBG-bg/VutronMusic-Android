<script setup lang="ts">
import { useAndroidShellStore } from '../stores/androidShell'
import sourcePolicy from '../../../../vendor/android-runtime/src/main/assets/sources-runtime/source-policy.json'
import CollapsibleSettingsCard from './CollapsibleSettingsCard.vue'
import OriginalIcon from './OriginalIcon.vue'

const store = useAndroidShellStore()
</script>

<template>
  <CollapsibleSettingsCard section-id="playback-source-policy" :title="$t('mobile.plugins.audioPolicyTitle')" :subtitle="$t('mobile.plugins.audioPolicySubtitle')">
    <template #heading><span class="settings-icon cyan"><OriginalIcon name="play" /></span><div><h3>{{ $t('mobile.plugins.audioPolicyTitle') }}</h3><p>{{ $t('mobile.plugins.audioPolicySubtitle') }}</p></div></template>
    <label class="settings-detail"><span>{{ $t('mobile.settingsUi.autoSources') }}</span><input type="checkbox" :checked="store.autoMatchSources" @change="store.setAutoMatchSources(($event.target as HTMLInputElement).checked)" /></label>
    <ol class="audio-policy-steps">
      <li>{{ $t('mobile.plugins.audioLocalStep') }}</li>
      <li>{{ $t('mobile.plugins.audioOfficialStep') }}</li>
      <li>{{ $t(store.autoMatchSources ? 'mobile.plugins.audioFallbackStep' : 'mobile.plugins.audioFallbackOff') }}</li>
    </ol>
    <h4 class="audio-policy-label">{{ $t('mobile.plugins.audioCandidates') }}</h4>
    <ul class="audio-policy-providers" :class="{ inactive: !store.autoMatchSources }" :aria-label="$t('mobile.plugins.audioCandidates')">
      <li v-for="id in sourcePolicy.fallbackSources" :key="id">{{ $t('mobile.plugins.audioProviderNames.' + id) }}</li>
    </ul>
    <p class="setting-note">{{ $t('mobile.plugins.audioCandidatesHint') }}</p>
    <div class="audio-policy-current"><b>{{ $t('mobile.plugins.audioActual') }}</b><span>{{ store.playback.quality || $t('mobile.plugins.audioNotPlaying') }}</span></div>
    <p class="setting-note">{{ $t('mobile.plugins.audioPolicyScope') }}</p>
    <p class="setting-note">{{ $t('mobile.plugins.audioLibrarySeparate') }}</p>
    <p class="setting-note">{{ $t('mobile.plugins.audioPolicySeparate') }}</p>
  </CollapsibleSettingsCard>
</template>

<style scoped>
.audio-policy-steps{margin:12px 0;padding-inline-start:22px;color:var(--muted);font-size:calc(12px * var(--ui-font-scale,1));line-height:1.7}.audio-policy-steps li+li{margin-top:6px}.audio-policy-label{margin:16px 0 8px;font-size:calc(12px * var(--ui-font-scale,1))}.audio-policy-providers{display:flex;flex-wrap:wrap;gap:7px;list-style:none;margin:0;padding:0}.audio-policy-providers li{padding:6px 10px;border:1px solid var(--line);border-radius:10px;background:var(--surface);font-size:calc(12px * var(--ui-font-scale,1));overflow-wrap:anywhere}.audio-policy-providers.inactive li{color:var(--muted);background:transparent}.audio-policy-current{display:flex;flex-direction:column;gap:5px;margin:14px 0;padding:12px;border-radius:12px;background:var(--surface);font-size:calc(12px * var(--ui-font-scale,1));line-height:1.5;overflow-wrap:anywhere}.audio-policy-current span{color:var(--muted)}
</style>
