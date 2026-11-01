<script setup lang="ts">
const emit = defineEmits<{ close: [] }>()
</script>
<template><button class="sheet-drag-handle" type="button" data-sheet-drag-handle :aria-label="$t('mobile.common.close')" @click="emit('close')"><span></span></button></template>
<style scoped>
.sheet-drag-handle { display:flex; align-items:center; justify-content:center; width:100%; min-height:24px; margin:-8px 0 4px; padding:6px; border:0; border-radius:10px; background:transparent; color:var(--muted); touch-action:none; cursor:grab; }
.sheet-drag-handle > span { display:block; width:36px; height:4px; border-radius:4px; background:currentColor; opacity:.6; }
.sheet-drag-handle:focus-visible { outline:2px solid var(--accent); outline-offset:-2px; }.sheet-drag-handle:active { cursor:grabbing; }
</style>
