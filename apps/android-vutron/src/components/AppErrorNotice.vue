<script setup lang="ts">
import { computed, ref } from 'vue'
import { describeAppFailure } from '../platform/appFailure'
import OriginalIcon from './OriginalIcon.vue'

const props = defineProps<{ message: string; title?: string; compact?: boolean; inline?: boolean; offline?: boolean; retry?: () => Promise<unknown> }>()
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
  <section class="app-error-notice" :class="{ 'app-error-floating': !inline, 'app-error-compact': compact }" :role="compact ? undefined : 'alert'">
    <header>
      <p :class="{ 'playback-error-message': compact }" :role="compact ? 'alert' : undefined"><OriginalIcon name="error" /><span>{{ title || $t(failure.messageKey) }}</span></p>
      <slot name="quick-actions" />
      <button class="icon-button error-close" type="button" :aria-label="$t('mobile.common.close')" @click="emit('close')"><OriginalIcon name="close" /></button>
    </header>
    <p v-if="!compact" class="error-hint">{{ $t(failure.hintKey) }}</p>
    <div v-if="!compact" class="error-actions">
      <button v-if="failure.kind === 'auth'" class="secondary-button" type="button" @click="emit('login')">{{ $t('mobile.playbackErrors.login') }}</button>
      <button v-else-if="failure.kind === 'folders'" class="secondary-button" type="button" @click="emit('folders')">{{ $t('mobile.errorNotice.authorize') }}</button>
      <button v-else-if="failure.kind === 'storage'" class="secondary-button" type="button" @click="emit('storage')">{{ $t('mobile.errorNotice.storageAction') }}</button>
      <button v-else-if="props.retry" class="secondary-button" type="button" :disabled="busy" @click="performRetry()">{{ $t(busy ? 'mobile.playbackErrors.retrying' : 'mobile.errorNotice.reload') }}</button>
      <button v-if="offline && ['network', 'timeout'].includes(failure.kind)" class="text-button" type="button" @click="emit('offline')">{{ $t('mobile.playbackErrors.openOffline') }}</button>
    </div>
    <slot name="details"><details v-if="!compact"><summary>{{ $t('mobile.playbackErrors.details') }}</summary><code>{{ message }}</code></details></slot>
  </section>
</template>
<style scoped>
.app-error-notice { --danger: #d6454f; padding: 12px 10px 12px 14px; border: 1px solid color-mix(in srgb, var(--danger) 34%, var(--line)); border-radius: 14px; background: color-mix(in srgb, var(--danger) 7%, var(--color-body-bg)); color: var(--ink); box-shadow: none; font-size: calc(12px * var(--ui-font-scale, 1)); line-height: 1.55; overflow-wrap: anywhere; }
.app-error-floating { position: fixed; z-index: 160; left: 50%; bottom: calc(142px + env(safe-area-inset-bottom)); transform: translateX(-50%); width: min(calc(100vw - 24px), 480px); max-height: 50dvh; overflow: auto; box-shadow: var(--shadow-float); }
header { display: flex; align-items: flex-start; justify-content: space-between; gap: 6px; }
header p { display: flex; align-items: center; gap: 8px; margin: 0; font-weight: 600; padding-top: 8px; }
header p .original-icon { color: var(--danger); flex-shrink: 0; }
.error-hint { margin: 4px 0 0; color: var(--muted); }
.error-actions { display: flex; align-items: center; flex-wrap: wrap; gap: 8px; margin-top: 10px; }
.error-actions:empty { display: none; }
details { margin-top: 8px; color: var(--muted); font-size: calc(11px * var(--ui-font-scale, 1)); }
summary { cursor: pointer; padding: 4px 0; }
code { display: block; max-height: 18dvh; overflow: auto; white-space: pre-wrap; padding: 6px 0; font: inherit; user-select: text; -webkit-user-select: text; }
@media (min-width: 1100px) { .app-error-floating { bottom: calc(32px + env(safe-area-inset-bottom)); } }
header .error-close { flex: 0 0 44px; width: 44px; height: 44px; margin: -4px -2px 0 0; border-radius: 50%; background: transparent; box-shadow: none; color: var(--muted); font-size: 15px; }
header .error-close .original-icon { font-size: calc(16px * var(--ui-font-scale, 1)); }
.app-error-compact { width:min(calc(100vw - 24px), 380px); top: min(calc(130px + 62px * var(--ui-font-scale, 1) + env(safe-area-inset-top)), 34dvh); bottom:auto; z-index:85; padding:3px 4px 3px 10px; overflow:visible; pointer-events:none; }
.app-error-compact header { align-items:center; gap:1px; }
.app-error-compact header p { flex:1 1 auto; min-width:0; gap:5px; font-size:calc(11.5px * var(--ui-font-scale, 1)); line-height:1.32; padding:4px 0; }
.app-error-compact header p > .original-icon { flex:none; font-size:15px; color:var(--danger); }
.app-error-compact header .error-close { margin:0; pointer-events:auto; }
.app-error-compact header .error-close .original-icon { font-size:16px; }
@media (min-width:840px) and (orientation:landscape) {
.app-error-compact { left:calc(50% + (var(--navigation-rail) + env(safe-area-inset-left)) / 2); top:auto; bottom:max(18px, calc(8px + env(safe-area-inset-bottom))); }
}
</style>
