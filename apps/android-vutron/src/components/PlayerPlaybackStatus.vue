<script setup lang="ts">
import { computed } from 'vue'
import type { VutronPlaybackState } from '../platform/vutronPlugin'

const props = defineProps<{ state: VutronPlaybackState }>()
const pending = computed(() => props.state.loading || props.state.buffering)
const status = computed(() => props.state.buffering ? 'mobile.playbackFeedback.buffering'
  : props.state.loading ? 'mobile.playbackFeedback.preparing'
  : props.state.error ? 'mobile.runtimeText.playFailed' : '')
</script>

<template>
  <div class="player-overline-copy" :aria-busy="pending || undefined">
    <span v-if="status" :class="{ 'playback-pending': pending }" :role="pending ? 'status' : undefined">{{ $t(status) }}</span>
    <template v-else>
      <span>{{ $t('mobile.common.playing') }}</span>
      <span class="quality-chip">{{ state.quality || $t('mobile.shellUi.waitingToPlay') }}</span>
    </template>
  </div>
</template>

<style scoped>
.playback-pending { display: flex; align-items: center; gap: 7px; letter-spacing: normal; }
.playback-pending::before { content: ''; flex: 0 0 6px; width: 6px; height: 6px; border-radius: 50%; background: var(--accent); }
</style>
