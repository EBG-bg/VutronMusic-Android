<script setup lang="ts">
import type { TrackBatchAction } from '../composables/trackSelection'
import OriginalIcon from './OriginalIcon.vue'
defineProps<{ count: number; total: number; all: boolean; busy: boolean; actions: TrackBatchAction[] }>()
defineEmits<{ all: []; close: []; action: [id: string] }>()
</script>
<template>
  <section class="track-selection-bar" :aria-label="$t('mobile.batch.title')" :aria-busy="busy">
    <div class="selection-heading"><b role="status">{{ $t('mobile.batch.selected', { count, total }) }}</b><button type="button" class="icon-button" :disabled="busy" :aria-label="$t('mobile.common.close')" @click="$emit('close')"><OriginalIcon name="close" /></button></div>
    <div class="selection-actions"><button type="button" class="text-button" :disabled="busy" @click="$emit('all')">{{ $t(all ? 'mobile.batch.clear' : 'mobile.batch.all') }}</button><button v-for="action in actions" :key="action.id" type="button" class="secondary-button" :class="{ 'danger-text': action.danger }" :disabled="busy || !count" @click="$emit('action', action.id)">{{ action.label }}</button></div>
  </section>
</template>
<style scoped>
.track-selection-bar { position:sticky; top:calc(var(--safe-top, 0px) + 8px); z-index:12; margin:8px 0 12px; padding:8px 10px; border:1px solid var(--line); border-radius:var(--radius-card); background:var(--color-body-bg); box-shadow:var(--shadow); animation:selection-enter var(--motion-state) ease both; }
.selection-heading,.selection-actions { display:flex; align-items:center; gap:6px; flex-wrap:wrap; }.selection-heading { justify-content:space-between; }.selection-heading b { font-size:calc(12px * var(--ui-font-scale,1)); }.selection-heading .icon-button { width:44px; height:44px; }.selection-actions>button { min-height:44px; padding:8px 10px; font-size:calc(12px * var(--ui-font-scale,1)); }
.selection-actions>.danger-text { color:var(--danger); }
@keyframes selection-enter { from { opacity:0; transform:translateY(-6px); } to { opacity:1; transform:none; } }
html[data-motion='reduced'] .track-selection-bar { animation:none; }
@media(max-width:340px) { .selection-actions { display:grid; grid-template-columns:repeat(2,minmax(0,1fr)); }.selection-actions>button { min-width:0; white-space:normal; line-height:1.35; overflow-wrap:anywhere; } }
</style>
