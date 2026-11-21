<script setup lang="ts">
import { computed, nextTick, ref, useId, watch, type ComponentPublicInstance } from 'vue'
import { useAndroidShellStore } from '../stores/androidShell'
import { describePlaybackFailure } from '../platform/playbackFailure'
import AppErrorNotice from './AppErrorNotice.vue'
import OriginalIcon from './OriginalIcon.vue'

const props = defineProps<{ visible: boolean }>()
const emit = defineEmits<{ login: []; offline: []; sourceSettings: [pluginId?: string] }>()
const store = useAndroidShellStore()
const failure = computed(() => describePlaybackFailure(store.playback))
const canBrowseOffline = computed(() => ['network', 'timeout', 'source_address'].includes(failure.value.code))
const diagnostic = computed(() => {
  const { error, errorDetail } = store.playback
  const legacy = failure.value.legacyMessage || (failure.value.code === 'playback' && !errorDetail ? error : '')
  return [legacy, errorDetail === legacy ? '' : errorDetail].filter(Boolean).join('\n')
})
const detailsLabel = computed(() => canBrowseOffline.value ? 'mobile.playbackErrors.moreOptions' : 'mobile.playbackErrors.details')
const detailsId = useId()
const expanded = ref(false)
const dismissed = ref(false)
const retrying = ref(false)
const toast = ref<ComponentPublicInstance>()
const toggle = ref<HTMLButtonElement>()
let returnFocus: HTMLElement | undefined
const showing = computed(() => props.visible && !dismissed.value && !!store.playback.error && !store.playback.loading && !store.playback.buffering)
watch([() => store.playback.trackId, () => store.playback.error, () => store.playback.errorCode, () => store.playback.loading, () => store.playback.buffering], () => {
  expanded.value = false
  dismissed.value = false
})
watch(showing, async open => {
  if (open) return
  expanded.value = false
  const root = toast.value?.$el as HTMLElement | undefined
  if (root?.contains(document.activeElement)) {
    await nextTick()
    if (document.activeElement === document.body || root.contains(document.activeElement)) {
      const target = returnFocus
      if (target?.isConnected && !target.closest('[inert]') && target.getClientRects().length) target.focus({ preventScroll: true })
    }
  }
  returnFocus = undefined
})
function rememberFocus(event: FocusEvent) {
  const previous = event.relatedTarget
  if (previous instanceof HTMLElement && !(event.currentTarget as HTMLElement).contains(previous)) returnFocus = previous
}
function dismiss() { dismissed.value = true }
function handleBack() {
  if (!showing.value) return false
  if (expanded.value) {
    expanded.value = false
    if (toast.value?.$el?.contains(document.activeElement)) toggle.value?.focus({ preventScroll: true })
    return true
  }
  if (toast.value?.$el?.contains(document.activeElement)) { dismiss(); return true }
  return false
}
function deactivate(element: Element) { if (element instanceof HTMLElement) element.inert = true }
async function retry() {
  if (retrying.value || store.playback.loading || store.playback.buffering) return
  expanded.value = false
  retrying.value = true
  try { await store.resume() }
  finally { retrying.value = false }
}
defineExpose({ handleBack, showing })
</script>

<template>
  <Transition name="notice-fade" @before-leave="deactivate">
    <AppErrorNotice v-if="showing" ref="toast" class="playback-error-notice" compact :message="diagnostic"
      :title="$t(failure.messageKey)" @close="dismiss" @focusin="rememberFocus" @keydown.esc.stop.prevent="handleBack">
      <template #quick-actions>
        <div class="playback-error-actions">
          <button v-if="failure.action === 'login'" class="text-button playback-error-primary" type="button" @click="emit('login')">{{ $t('mobile.playbackErrors.login') }}</button>
          <button v-else-if="failure.action === 'sourceSettings'" class="text-button playback-error-primary" type="button" @click="emit('sourceSettings', store.playback.track?.pluginId)">{{ $t('mobile.playbackErrors.sourceSettings') }}</button>
          <button v-else-if="failure.action === 'folders'" class="text-button playback-error-primary" type="button" @click="store.navigateTo('settings')">{{ $t('mobile.playbackErrors.folders') }}</button>
          <button v-else-if="failure.action === 'offline'" class="text-button playback-error-primary" type="button" @click="emit('offline')">{{ $t('mobile.playbackErrors.openOffline') }}</button>
          <button v-else class="text-button playback-error-primary" type="button" :disabled="retrying" @click="retry">{{ $t(retrying ? 'mobile.playbackErrors.retrying' : 'mobile.playbackErrors.retry') }}</button>
          <button v-if="canBrowseOffline || diagnostic" ref="toggle" class="text-button playback-error-toggle" type="button" :aria-expanded="expanded" :aria-controls="detailsId" :aria-label="$t(detailsLabel)" :title="$t(detailsLabel)" @click="expanded = !expanded"><OriginalIcon name="down" /></button>
        </div>
      </template>
      <template #details>
        <Transition name="error-fold">
          <div v-show="expanded" :id="detailsId" class="playback-error-details" :inert="!expanded">
            <div class="playback-error-clip">
              <div class="playback-error-detail-content">
                <p v-if="failure.code === 'source_address'" class="playback-error-hint">{{ $t('mobile.playbackErrors.sourceAddressHint') }}</p>
                <button v-if="canBrowseOffline" class="text-button" type="button" @click="emit('offline')">{{ $t('mobile.playbackErrors.openOffline') }}</button>
                <div v-if="diagnostic" class="playback-error-diagnostic"><span>{{ $t('mobile.playbackErrors.details') }}</span><code>{{ diagnostic }}</code></div>
              </div>
            </div>
          </div>
        </Transition>
      </template>
    </AppErrorNotice>
  </Transition>
</template>

<style scoped>
.playback-error-actions { display:flex; flex:none; align-items:center; min-width:0; }
.playback-error-actions button, .playback-error-detail-content button { min-width:0; min-height:44px; padding:4px 6px; white-space:normal; overflow-wrap:anywhere; pointer-events:auto; }
.playback-error-primary { max-width:min(40vw, 11rem); padding-inline:5px; font-size:calc(11.5px * var(--ui-font-scale, 1)); }
.playback-error-actions .playback-error-toggle { display:grid; place-items:center; min-width:44px; padding:0; color:var(--muted); }
.playback-error-toggle .original-icon { font-size:16px; transition:transform var(--motion-feedback) ease; }
.playback-error-toggle[aria-expanded='true'] .original-icon { transform:rotate(180deg); }
.playback-error-details { display:grid; grid-template-rows:1fr; color:var(--muted); font-size:calc(11px * var(--ui-font-scale, 1)); }
.playback-error-clip { min-height:0; }
.playback-error-detail-content { margin:0 4px; padding:4px 0; border-top:1px solid var(--line); }
.playback-error-hint { margin:4px 0 0; }
.playback-error-diagnostic { padding:4px 0; }
.playback-error-diagnostic code { display:block; margin-top:3px; max-height:min(18dvh, 12rem); overflow:auto; color:var(--ink); font:inherit; white-space:pre-wrap; overflow-wrap:anywhere; pointer-events:auto; user-select:text; }
.error-fold-enter-active, .error-fold-leave-active { transition:grid-template-rows var(--motion-feedback) ease, opacity var(--motion-feedback) ease; }
.error-fold-enter-active .playback-error-clip, .error-fold-leave-active .playback-error-clip { overflow:hidden; }
.error-fold-enter-from, .error-fold-leave-to { grid-template-rows:0fr; opacity:0; }
html[data-motion="reduced"] .error-fold-enter-active, html[data-motion="reduced"] .error-fold-leave-active, html[data-motion="reduced"] .playback-error-toggle .original-icon { transition:none; }
</style>
