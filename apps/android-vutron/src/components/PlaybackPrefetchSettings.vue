<script setup lang="ts">
import { onMounted } from 'vue'
import { usePlaybackTuning } from '../composables/playbackTuning'
const { settings, ready, error, errorKind, load, update, flush } = usePlaybackTuning()
onMounted(load)
</script>
<template>
  <section class="prefetch-setting">
    <label class="settings-detail"><span>{{ $t('mobile.advancedPlayback.prefetch') }}</span><input type="checkbox" :checked="settings.prefetchWifi" :disabled="!ready" @change="update({ prefetchWifi: ($event.target as HTMLInputElement).checked }); flush()" /></label>
    <p class="setting-note">{{ $t('mobile.advancedPlayback.prefetchHint') }}</p>
    <p v-if="error" class="inline-error" role="alert">{{ $t(`mobile.playbackFeedback.${errorKind}Error`) }} <button class="text-button" type="button" @click="errorKind === 'save' ? flush() : load()">{{ $t('mobile.advancedPlayback.retry') }}</button></p>
  </section>
</template>
<style scoped>
.prefetch-setting { margin: 12px 0; padding: 8px 0; border-top: 1px solid var(--line); border-bottom: 1px solid var(--line); }
.prefetch-setting .setting-note { line-height: 1.65; }
</style>
