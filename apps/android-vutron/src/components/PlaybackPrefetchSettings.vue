<script setup lang="ts">
import { inject, onMounted } from 'vue'
import { navigationPreviewKey } from '../composables/navigationPreview'
import { usePlaybackTuning } from '../composables/playbackTuning'
import SettingsSwitchRow from './SettingsSwitchRow.vue'
const { settings, ready, error, errorKind, load, update, flush } = usePlaybackTuning()
if (!inject(navigationPreviewKey, false)) onMounted(load)
</script>
<template>
  <section class="prefetch-setting">
    <SettingsSwitchRow :label="$t('mobile.advancedPlayback.prefetch')" :checked="settings.prefetchWifi" :disabled="!ready" @change="enabled => { update({ prefetchWifi: enabled }); flush() }" />
    <p class="setting-note">{{ $t('mobile.advancedPlayback.prefetchHint') }}</p>
    <p v-if="error" class="inline-error" role="alert">{{ $t(`mobile.playbackFeedback.${errorKind}Error`) }} <button class="text-button" type="button" @click="errorKind === 'save' ? flush() : load()">{{ $t('mobile.advancedPlayback.retry') }}</button></p>
  </section>
</template>
<style scoped>
.prefetch-setting { margin: 12px 0; padding: 8px 0; border-top: 1px solid var(--line); border-bottom: 1px solid var(--line); }
.prefetch-setting .setting-note { line-height: 1.65; }
</style>
