<script setup lang="ts">
import { ref } from 'vue'
import { useModalFocus } from '../composables/modalFocus'
import PlaybackTuningControls from './PlaybackTuningControls.vue'
import OriginalIcon from './OriginalIcon.vue'
const emit = defineEmits<{ close: [] }>()
const sheet = ref<HTMLElement>()
useModalFocus(sheet, { close: () => emit('close') })
</script>
<template>
  <div class="tuning-layer" @click.self="emit('close')">
    <section ref="sheet" class="tuning-sheet" role="dialog" aria-modal="true" :aria-label="$t('mobile.advancedPlayback.quickTitle')" tabindex="-1">
      <header><div><h2>{{ $t('mobile.advancedPlayback.quickTitle') }}</h2><p>{{ $t('mobile.advancedPlayback.globalHint') }}</p></div><button class="icon-button" type="button" :aria-label="$t('mobile.common.close')" @click="emit('close')"><OriginalIcon name="close" /></button></header>
      <PlaybackTuningControls />
    </section>
  </div>
</template>
<style scoped>
.tuning-layer { position: fixed; inset: 0; z-index: 200; display: flex; align-items: flex-end; justify-content: center; background: rgb(0 0 0 / 35%); }
.tuning-sheet { width: min(100%, 560px); max-height: 90dvh; padding: 16px 16px max(18px, env(safe-area-inset-bottom)); overflow: auto; overscroll-behavior: contain; border-radius: 22px 22px 0 0; background: var(--color-body-bg); color: var(--ink); box-shadow: 0 -8px 32px rgb(0 0 0 / 18%); }
header { display: flex; justify-content: space-between; align-items: center; gap: 12px; margin-bottom: 16px; }
h2 { margin: 0; font-size: 18px; } header p { margin: 6px 0 0; color: var(--muted); font-size: 12px; line-height: 1.5; }
</style>
