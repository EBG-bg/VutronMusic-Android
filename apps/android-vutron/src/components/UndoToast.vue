<script setup lang="ts">
import { computed, nextTick, onBeforeUnmount, onMounted, ref, watch } from 'vue'
import { activeUndo, dismissUndo, performUndo } from '../platform/undo'
import { undoText } from '../platform/undoMessages'
import OriginalIcon from './OriginalIcon.vue'

const now = ref(Date.now())
let tick: ReturnType<typeof setTimeout> | undefined
let returnFocus: HTMLElement | undefined
function rememberFocus(event: FocusEvent) { if (event.relatedTarget instanceof HTMLElement && !event.relatedTarget.closest('[data-ui-notification]')) returnFocus = event.relatedTarget }
const seconds = computed(() => Math.max(0, Math.ceil(((activeUndo.value?.deadline ?? 0) - now.value) / 1000)))
const remaining = computed(() => Math.max(0, (activeUndo.value?.deadline ?? 0) - now.value))
function clearTick() { if (tick !== undefined) clearTimeout(tick); tick = undefined }
function update() {
  clearTick(); now.value = Date.now()
  const entry = activeUndo.value
  if (!entry || entry.running) return
  if (remaining.value <= 0) { dismissUndo(entry.id); return }
  if (typeof document === 'undefined' || document.visibilityState === 'visible') tick = setTimeout(update, Math.min(1000, remaining.value))
}
watch(activeUndo, update, { immediate: true })
watch(() => activeUndo.value?.id, async (id, previous) => {
  if (!previous || id || !(document.activeElement instanceof Element) || !document.activeElement.closest('[data-ui-notification]')) return
  await nextTick()
  if (returnFocus?.isConnected && !returnFocus.closest('[inert]')) returnFocus.focus({ preventScroll: true })
})
onMounted(() => document.addEventListener('visibilitychange', update))
onBeforeUnmount(() => { clearTick(); document.removeEventListener('visibilitychange', update) })
</script>

<template>
  <Teleport to="body">
    <div class="undo-toast-portal" data-ui-notification>
      <Transition name="undo-toast">
        <aside v-if="activeUndo" class="undo-toast" :aria-busy="activeUndo.running" @focusin="rememberFocus"
          @keydown.esc.stop.prevent="dismissUndo()">
          <p role="status" aria-live="polite">{{ activeUndo.error || activeUndo.message }}</p>
          <button class="undo-action" type="button" :disabled="activeUndo.running" :aria-label="`${undoText('undo')} · ${undoText('seconds', { seconds })}`" @click="performUndo()">
            {{ activeUndo.running ? undoText('restoring') : undoText('undo') }}
            <small v-if="!activeUndo.running" aria-hidden="true">{{ undoText('seconds', { seconds }) }}</small>
          </button>
          <button class="icon-button undo-dismiss" type="button" :disabled="activeUndo.running" :aria-label="undoText('close')" @click="dismissUndo()"><OriginalIcon name="close" /></button>
          <span v-if="!activeUndo.running" :key="`${activeUndo.id}-${Math.round(remaining / 1000)}`" class="undo-countdown" aria-hidden="true"
            :style="{ '--undo-time': `${remaining}ms`, '--undo-ratio': remaining / activeUndo.durationMs }" />
        </aside>
      </Transition>
    </div>
  </Teleport>
</template>

<style scoped>
.undo-toast-portal { position: fixed; z-index: 600; inset: 0; display: flex; align-items: flex-end; justify-content: center; padding: 12px 12px max(18px, env(safe-area-inset-bottom)); pointer-events: none; }
.undo-toast { pointer-events: auto; position: relative; display: flex; align-items: center; gap: 4px; width: min(100%, 520px); overflow: hidden; padding: 6px 6px 8px 16px; border: 1px solid var(--line); border-radius: var(--radius-card); background: var(--color-body-bg); color: var(--ink); box-shadow: 0 8px 32px rgb(0 0 0 / 22%); }
.undo-toast p { flex: 1; min-width: 0; margin: 0; overflow-wrap: anywhere; font-size: calc(13px * var(--ui-font-scale, 1)); line-height: 1.45; }
.undo-action { display: flex; flex: none; align-items: center; justify-content: center; gap: 5px; min-height: 44px; padding: 8px 10px; border: 0; border-radius: var(--radius-control, 12px); color: var(--accent); background: transparent; font-weight: 650; }
.undo-action small { font-size: calc(11px * var(--ui-font-scale, 1)); font-weight: 400; white-space: nowrap; color: var(--muted); }
.undo-dismiss { flex: none; width: 44px; height: 44px; }
.undo-countdown { position: absolute; bottom: 0; inset-inline: 0; height: 3px; background: var(--accent); transform-origin: left center; transform: scaleX(var(--undo-ratio)); animation: undo-countdown var(--undo-time) linear forwards; }
.undo-toast-enter-active { transition: opacity var(--motion-panel) ease, transform var(--motion-panel) ease; }
.undo-toast-leave-active { transition: opacity var(--motion-panel-exit) ease, transform var(--motion-panel-exit) ease; }
.undo-toast-enter-from, .undo-toast-leave-to { opacity: 0; transform: translateY(12px); }
@keyframes undo-countdown { from { transform: scaleX(var(--undo-ratio)); } to { transform: scaleX(0); } }
</style>
<style>
html[data-motion='reduced'] .undo-countdown { animation: none; }
</style>
