<script setup lang="ts">
const emit = defineEmits<{ close: [] }>()
</script>
<template><button class="sheet-drag-handle" type="button" data-sheet-drag-handle :aria-label="$t('mobile.common.close')" @click="emit('close')"><span></span></button></template>
<style scoped>
.sheet-drag-handle { display: flex; align-items: center; justify-content: center; width: 100%; min-height: 24px; margin: -8px 0 6px; padding: 6px; border: 0; border-radius: 10px; background: transparent; color: var(--muted); touch-action: none; cursor: grab; }
.sheet-drag-handle > span { display: block; width: 40px; height: 4px; border-radius: 999px; background: currentColor; opacity: .36; transition: opacity var(--motion-feedback, 140ms) ease; }
.sheet-drag-handle:hover > span, .sheet-drag-handle:active > span { opacity: .58; }
.sheet-drag-handle:focus-visible { outline: 2px solid var(--accent); outline-offset: -2px; }
.sheet-drag-handle:active { cursor: grabbing; }
</style>
