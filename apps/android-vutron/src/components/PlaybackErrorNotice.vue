<script setup lang="ts">
import { computed, ref } from 'vue'
import { useAndroidShellStore } from '../stores/androidShell'
import { describePlaybackFailure } from '../platform/playbackFailure'
import OriginalIcon from './OriginalIcon.vue'

const store = useAndroidShellStore()
const emit = defineEmits<{ login: []; offline: [] }>()
const failure = computed(() => describePlaybackFailure(store.playback))
const retrying = ref(false)
async function retry() {
  if (retrying.value || store.playback.loading) return
  retrying.value = true
  try { await store.resume() }
  finally { retrying.value = false }
}
</script>

<template>
  <section v-if="store.playback.error && !store.playback.loading" class="playback-error-notice" role="alert">
    <p><OriginalIcon name="error" /> {{ failure.legacyMessage || $t(failure.messageKey) }}</p>
    <div class="playback-error-actions">
      <button v-if="failure.action === 'login'" class="secondary-button" type="button" @click="emit('login')">{{ $t('mobile.playbackErrors.login') }}</button>
      <button v-else-if="failure.action === 'folders'" class="secondary-button" type="button" @click="store.navigateTo('settings')">{{ $t('mobile.playbackErrors.folders') }}</button>
      <button v-else-if="failure.action !== 'offline'" class="secondary-button" type="button" :disabled="retrying" @click="retry">{{ $t(retrying ? 'mobile.playbackErrors.retrying' : 'mobile.playbackErrors.retry') }}</button>
      <button v-if="failure.action === 'offline' || failure.code === 'network' || failure.code === 'timeout'" class="text-button" type="button" @click="emit('offline')">{{ $t('mobile.playbackErrors.openOffline') }}</button>
    </div>
    <details v-if="store.playback.errorDetail" class="playback-error-details"><summary>{{ $t('mobile.playbackErrors.details') }}</summary><code>{{ store.playback.errorDetail }}</code></details>
  </section>
</template>

<style scoped>
.playback-error-notice { padding: 12px; border: 1px solid var(--line); border-radius: 14px; background: var(--surface); text-align: left; }
.playback-error-notice p { margin: 0; color: var(--ink); line-height: 1.6; overflow-wrap: anywhere; }
.playback-error-actions { display: flex; flex-wrap: wrap; align-items: center; gap: 8px; margin-top: 8px; }
.playback-error-actions button { min-width: 0; white-space: normal; }
.playback-error-details { margin-top: 10px; color: var(--muted); font-size: calc(11px * var(--ui-font-scale, 1)); }
.playback-error-details summary { cursor: pointer; padding: 4px 0; }
.playback-error-details code { display: block; padding-top: 4px; overflow-wrap: anywhere; }
</style>
