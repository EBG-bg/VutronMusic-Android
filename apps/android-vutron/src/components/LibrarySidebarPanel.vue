<script setup lang="ts">
import { ref } from 'vue'
import { actionDialog } from '../platform/actionDialog'
import { useModalFocus } from '../composables/modalFocus'
import { useModalIsolation } from '../composables/modalIsolation'

const props = defineProps<{ returnFocus?: HTMLElement }>()
const emit = defineEmits<{ close: [] }>()
const panel = ref<HTMLElement>()
useModalIsolation(panel)
useModalFocus(panel, { close: () => emit('close'), enabled: () => !actionDialog.value, returnFocus: () => props.returnFocus })
</script>

<template>
  <div class="sidebar-layer" :inert="Boolean(actionDialog)" @click.self="emit('close')">
    <aside ref="panel" class="library-sidebar" role="dialog" aria-modal="true" :aria-label="$t('mobile.library.sidebar')" tabindex="-1"><slot /></aside>
  </div>
</template>
