<script setup lang="ts">
import { computed } from 'vue'
import { useI18n } from 'vue-i18n'
import type { MusicPlugin } from '../plugins/protocol'
import AppSelect from './AppSelect.vue'
import OriginalIcon from './OriginalIcon.vue'

const props = defineProps<{ modelValue: string; sources: MusicPlugin[]; onlineAvailable: boolean }>()
const emit = defineEmits<{ select: [value: string]; manage: [] }>()
const { t } = useI18n()
const options = computed(() => [
  { value: 'native:netease', label: t('mobile.shellUi.neteaseMusic'), disabled: !props.onlineAvailable },
  { value: 'native:local', label: t('mobile.library.allLocal') },
  { value: 'native:offline', label: t('mobile.offline.library') },
  ...props.sources.map(source => ({ value: 'plugin:' + source.id, label: source.name }))
])
</script>

<template>
  <div class="music-source-switcher" data-music-source-switcher>
    <AppSelect class="music-source-picker" :model-value="modelValue" :options="options" :label="$t('mobile.plugins.sourceSelector')" @update:model-value="emit('select', $event)" />
    <button class="icon-button" type="button" :aria-label="$t('mobile.plugins.manageSources')" :title="$t('mobile.plugins.manageSources')" @click="emit('manage')"><OriginalIcon name="settings" /></button>
  </div>
</template>

<style scoped>
.music-source-switcher{display:flex;align-items:flex-end;gap:8px;margin:8px 12px 0;padding:10px 12px;border:1px solid var(--line);border-radius:16px;background:var(--surface);box-shadow:var(--shadow-sm,0 2px 8px #00000006)}.music-source-picker{flex:1;min-width:0}.music-source-switcher>.icon-button{flex:none;min-width:40px;min-height:40px;margin-bottom:1px}
</style>
