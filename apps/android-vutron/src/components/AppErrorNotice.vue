<script setup lang="ts">
import { computed, ref } from 'vue'
import { describeAppFailure } from '../platform/appFailure'
import OriginalIcon from './OriginalIcon.vue'

const props = defineProps<{ message: string; inline?: boolean; offline?: boolean; retry?: () => Promise<unknown> }>()
const emit = defineEmits<{ close: []; login: []; folders: []; storage: []; offline: [] }>()
const failure = computed(() => describeAppFailure(props.message))
const busy = ref(false)
async function performRetry() {
  if (!props.retry || busy.value) return
  busy.value = true
  try { await props.retry() } finally { busy.value = false }
}
</script>
<template>
  <section class="app-error-notice" :class="{ 'app-error-floating': !inline }" role="alert">
    <header><p><OriginalIcon name="error" />{{ $t(failure.messageKey) }}</p><button class="icon-button" type="button" :aria-label="$t('mobile.common.close')" @click="emit('close')"><OriginalIcon name="close" /></button></header>
    <p class="error-hint">{{ $t(failure.hintKey) }}</p>
    <div class="error-actions">
      <button v-if="failure.kind === 'auth'" class="secondary-button" type="button" @click="emit('login')">{{ $t('mobile.playbackErrors.login') }}</button>
      <button v-else-if="failure.kind === 'folders'" class="secondary-button" type="button" @click="emit('folders')">{{ $t('mobile.errorNotice.authorize') }}</button>
      <button v-else-if="failure.kind === 'storage'" class="secondary-button" type="button" @click="emit('storage')">{{ $t('mobile.errorNotice.storageAction') }}</button>
      <button v-else-if="props.retry" class="secondary-button" type="button" :disabled="busy" @click="performRetry()">{{ $t(busy ? 'mobile.playbackErrors.retrying' : 'mobile.errorNotice.reload') }}</button>
      <button v-if="offline && ['network', 'timeout'].includes(failure.kind)" class="text-button" type="button" @click="emit('offline')">{{ $t('mobile.playbackErrors.openOffline') }}</button>
    </div>
    <details><summary>{{ $t('mobile.playbackErrors.details') }}</summary><code>{{ message }}</code></details>
  </section>
</template>
<style scoped>
.app-error-notice { --danger:#d6454f; padding:10px 8px 10px 12px; border:1px solid color-mix(in srgb, var(--danger) 28%, var(--line)); border-left:3px solid var(--danger); border-radius:8px; background:color-mix(in srgb, var(--danger) 7%, var(--color-body-bg)); color:var(--ink); box-shadow:none; font-size:calc(12px * var(--ui-font-scale, 1)); line-height:1.55; overflow-wrap:anywhere; }
.app-error-floating { position:fixed; z-index:160; left:50%; bottom:calc(142px + env(safe-area-inset-bottom)); transform:translateX(-50%); width:min(calc(100vw - 24px), 480px); max-height:50dvh; overflow:auto; box-shadow:0 2px 12px rgb(0 0 0 / 14%); }
header { display:flex; align-items:flex-start; justify-content:space-between; gap:4px; }header p { display:flex; align-items:center; gap:7px; margin:0; font-weight:600; padding-top:10px; }header button { flex:0 0 44px; width:44px; height:44px; margin:-4px -2px 0 0; border-radius:50%; background:transparent; box-shadow:none; color:var(--muted); font-size:15px; }
header button .original-icon { font-size:calc(16px * var(--ui-font-scale, 1)); }
.error-hint { margin:4px 0 0; color:var(--muted); }.error-actions { display:flex; align-items:center; flex-wrap:wrap; gap:8px; margin-top:8px; }.error-actions:empty { display:none; }
details { margin-top:8px; color:var(--muted); font-size:calc(11px * var(--ui-font-scale, 1)); }summary { cursor:pointer; padding:4px 0; }code { display:block; max-height:18dvh; overflow:auto; white-space:pre-wrap; padding:6px 0; font:inherit; user-select:text; -webkit-user-select:text; }
@media (min-width:1100px) { .app-error-floating { bottom:calc(32px + env(safe-area-inset-bottom)); } }
</style>
