<script setup lang="ts">
import { computed } from 'vue'
import { useI18n } from 'vue-i18n'
import type { MusicPlugin } from '../plugins/protocol'
import OriginalIcon from './OriginalIcon.vue'

const props = defineProps<{ modelValue: string; sources: MusicPlugin[]; onlineAvailable: boolean }>()
const emit = defineEmits<{ select: [value: string]; manage: [] }>()
const { t } = useI18n()
const options = computed(() => [
  { value: 'native:netease', label: t('mobile.shellUi.neteaseMusic'), disabled: !props.onlineAvailable },
  { value: 'native:local', label: t('mobile.library.allLocal'), disabled: false },
  { value: 'native:offline', label: t('mobile.offline.library'), disabled: false },
  ...props.sources.map(source => ({ value: 'plugin:' + source.id, label: source.name, disabled: false }))
])
</script>

<template>
  <section class="music-source-switcher" data-music-source-switcher>
    <div class="source-heading"><span class="eyebrow">{{ $t('mobile.plugins.sourcesSection') }}</span><button class="text-button" type="button" @click="emit('manage')"><OriginalIcon name="settings" />{{ $t('mobile.plugins.manageSources') }}</button></div>
    <div class="source-strip" role="group" :aria-label="$t('mobile.plugins.sourceSelector')">
      <button v-for="option in options" :key="option.value" type="button" :class="{ selected: option.value === modelValue }" :aria-pressed="option.value === modelValue" :disabled="option.disabled" @click="emit('select', option.value)">{{ option.label }}</button>
    </div>
  </section>
</template>

<style scoped>
.music-source-switcher { --source-accent-ink: color-mix(in srgb, var(--accent) 45%, var(--ink)); --source-muted: color-mix(in srgb, var(--muted) 75%, var(--ink)); margin: 12px 0 4px; }
.source-heading { display: flex; align-items: center; justify-content: space-between; gap: 12px; margin: 0 2px 5px; }
.source-heading .eyebrow { min-width: 0; color: var(--source-muted); font-size: calc(12px * var(--ui-font-scale, 1)); font-weight: 650; letter-spacing: .02em; text-transform: none; }
.source-heading .text-button { display: inline-flex; align-items: center; justify-content: flex-end; gap: 6px; flex: 0 1 auto; min-height: 44px; padding: 8px 2px 8px 10px; color: var(--source-accent-ink); text-align: end; }
.source-heading .original-icon { font-size: 18px; }
.source-strip { display: flex; gap: 8px; padding: 3px 2px 7px; overflow-x: auto; scrollbar-width: none; overscroll-behavior-x: contain; scroll-snap-type: x proximity; }
.source-strip::-webkit-scrollbar { display: none; }
.source-strip button { flex: 0 0 auto; min-height: 44px; padding: 10px 16px; border: 1px solid var(--line); border-radius: 999px; color: var(--source-muted); background: var(--color-body-bg); font: inherit; font-size: calc(12px * var(--ui-font-scale, 1)); line-height: 1.45; font-weight: 600; white-space: nowrap; scroll-snap-align: start; transition: color var(--motion-feedback), background-color var(--motion-feedback), border-color var(--motion-feedback), transform var(--motion-feedback); }
.source-strip button.selected { color: var(--source-accent-ink); border-color: color-mix(in srgb, var(--accent) 35%, var(--line)); background: var(--accent-soft); font-weight: 750; }
.source-strip button:active { transform: scale(.97); }
.source-strip button:disabled { opacity: .45; }
@media (hover: hover) { .source-strip button:enabled:hover { color: var(--source-accent-ink); background: var(--accent-soft); border-color: color-mix(in srgb, var(--accent) 25%, var(--line)); } }
html[data-motion='reduced'] .source-strip button { transition: none; }
html[data-motion='reduced'] .source-strip button:active { transform: none; }
</style>
