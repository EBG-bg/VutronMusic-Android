<script setup lang="ts">
import type { LocalTrackOrder } from '../composables/libraryPresentation'
import AppSelect from './AppSelect.vue'
defineProps<{ modelValue: LocalTrackOrder }>()
const emit = defineEmits<{ 'update:modelValue': [value: LocalTrackOrder] }>()
const modes = ['original', 'title', 'artist', 'album'] as const
const labels = { original: 'mobile.library.originalOrder', title: 'mobile.library.title', artist: 'nav.artist', album: 'nav.album' }
</script>

<template>
  <div class="local-sort-control"><span>{{ $t('mobile.library.sort') }}</span><AppSelect :model-value="modelValue" :label="$t('mobile.library.sortLabel')" :options="modes.map(value => ({ value, label: $t(labels[value]) }))" @update:model-value="emit('update:modelValue', $event)" /></div>
</template>

<style scoped>
.local-sort-control { display: flex; justify-content: flex-end; align-items: center; gap: 8px; margin: 10px 0; color: var(--muted); font-size: calc(11px * var(--ui-font-scale, 1)); }
</style>
