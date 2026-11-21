<script setup lang="ts">
import { ref } from 'vue'
import { actionDialog, settleAction } from '../platform/actionDialog'
import { useModalFocus } from '../composables/modalFocus'
import { useModalIsolation } from '../composables/modalIsolation'
const dialog = ref<HTMLElement>()
useModalIsolation(dialog, () => Boolean(actionDialog.value))
useModalFocus(dialog, { close: () => settleAction('cancel'), open: () => Boolean(actionDialog.value) })
</script>
<template>
  <Teleport to="body"><Transition name="notice-fade"><div v-if="actionDialog" class="action-dialog-layer" @click.self="settleAction('cancel')"><section ref="dialog" tabindex="-1" role="dialog" aria-modal="true" aria-labelledby="action-dialog-title" aria-describedby="action-dialog-message" class="action-dialog"><h2 id="action-dialog-title">{{ actionDialog.title }}</h2><p id="action-dialog-message">{{ actionDialog.message }}</p><div class="action-dialog-buttons"><button class="text-button" type="button" @click="settleAction('cancel')">{{ actionDialog.cancelLabel }}</button><button v-if="actionDialog.secondaryLabel" class="secondary-button" type="button" :disabled="actionDialog.secondaryDisabled" @click="settleAction('secondary')">{{ actionDialog.secondaryLabel }}</button><button data-default-action class="primary-button" type="button" @click="settleAction('confirm')">{{ actionDialog.confirmLabel }}</button></div></section></div></Transition></Teleport>
</template>
<style scoped>
.action-dialog-layer { position: fixed; inset: 0; z-index: 500; display: grid; align-items: center; padding: max(20px, env(safe-area-inset-top)) max(20px, env(safe-area-inset-right)) max(20px, env(safe-area-inset-bottom)) max(20px, env(safe-area-inset-left)); background: var(--scrim); backdrop-filter: blur(5px); -webkit-backdrop-filter: blur(5px); }
.action-dialog { width: min(100%, 440px); max-height: calc(100dvh - 40px - env(safe-area-inset-top) - env(safe-area-inset-bottom)); overflow: auto; overscroll-behavior: contain; margin: auto; padding: 22px; border: 1px solid var(--line); border-radius: 22px; color: var(--ink); background: var(--color-body-bg); box-shadow: var(--shadow-float); }
h2 { margin: 0 0 10px; font-size: calc(17px * var(--ui-font-scale, 1)); font-weight: 700; line-height: 1.38; }
p { margin: 0; color: color-mix(in srgb, var(--ink) 82%, var(--muted)); font-size: calc(13px * var(--ui-font-scale, 1)); white-space: pre-line; line-height: 1.65; overflow-wrap: anywhere; }
.action-dialog-buttons { display: flex; flex-wrap: wrap; justify-content: flex-end; gap: 8px; margin-top: 20px; }
.action-dialog-buttons > button { min-height: 44px; max-width: 100%; white-space: normal; overflow-wrap: anywhere; }
</style>
