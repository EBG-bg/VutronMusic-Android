<script setup lang="ts">
import { computed, onBeforeUnmount } from 'vue'
import { useAndroidShellStore } from '../stores/androidShell'
import LyricOffsetControl from './LyricOffsetControl.vue'
const store = useAndroidShellStore()
const trackKey = computed(() => [store.playback.trackId, store.playback.track?.localUri ?? '', store.playback.track?.localPath ?? '', store.playback.track?.neteaseId ?? ''].join('|'))
onBeforeUnmount(() => { void store.flushLiveSettings() })
</script>
<template>
  <aside class="landscape-lyric-offset" :aria-label="$t('mobile.offsetUi.title')" :title="$t('mobile.offsetUi.hint')">
    <LyricOffsetControl orientation="vertical" compact :model-value="store.overlaySettings.currentLyricOffsetMs ?? 0" :track-key="trackKey" :disabled="!store.playback.trackId" @update:model-value="store.updateCurrentLyricOffset" @commit="store.flushLiveSettings()" />
  </aside>
</template>
<style scoped>
.landscape-lyric-offset { display: none; }
@media (orientation: landscape) {
  .landscape-lyric-offset { display: flex; flex: 0 0 max(62px, calc(56px * var(--ui-font-scale, 1))); align-self: center; justify-content: center; align-items: center; min-width: 0; padding: 8px 4px; }
}
</style>
