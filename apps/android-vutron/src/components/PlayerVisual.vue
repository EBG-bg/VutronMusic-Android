<script setup lang="ts">
import { useAndroidShellStore } from '../stores/androidShell'
import { defineAsyncComponent } from 'vue'
import { playerLyrics } from '../platform/interfacePreferences'
import CoverImage from './CoverImage.vue'
import OriginalIcon from './OriginalIcon.vue'
import LandscapeLyricOffset from './LandscapeLyricOffset.vue'
const OriginalLyricsView = defineAsyncComponent(() => import('./OriginalLyricsView.vue'))
const props = defineProps<{ cover: string; remoteCover?: string }>()
const store = useAndroidShellStore()
</script>
<template>
  <div class="player-visual">
    <div class="player-view-tabs" role="group" :aria-label="$t('mobile.refinements.playerView')"><button type="button" :aria-pressed="!playerLyrics" @click="playerLyrics = false">{{ $t('mobile.refinements.cover') }}</button><button type="button" :aria-pressed="playerLyrics" @click="playerLyrics = true">{{ $t('mobile.refinements.lyrics') }}</button></div>
    <Transition name="player-visual-switch" mode="out-in">
      <button v-if="!playerLyrics" key="cover" class="player-artwork artwork-toggle" type="button" :aria-label="$t('mobile.refinements.showLyrics')" @click="playerLyrics = true"><CoverImage v-if="props.cover" :src="props.cover" :remote-src="remoteCover" loading="eager" alt="" /><span v-else class="cover-fallback large-cover"><OriginalIcon name="library" /></span><span class="artwork-glow"></span></button>
      <section v-else key="lyrics" class="lyrics-panel player-lyrics-view" @click.self="playerLyrics = false">
        <div v-if="store.lyricsLoading || !store.lyrics.original.length" class="lyrics-empty">{{ $t(store.lyricsLoading ? 'mobile.refinements.lyricsLoading' : 'mobile.refinements.noLyrics') }}</div>
        <div v-else class="player-lyrics-content"><OriginalLyricsView :family="store.lyrics" :position="store.playback.position" :playing="store.playback.playing && !store.playback.buffering" :rate="store.playback.rate ?? 1" :offset-ms="store.overlaySettings.currentLyricOffsetMs ?? 0" :duration="store.playback.duration" :display-settings="store.overlaySettings" @seek="store.seek" /><LandscapeLyricOffset /></div>
      </section>
    </Transition>
  </div>
</template>
<style scoped>
.player-lyrics-content { height:100%; min-height:0; display:flex; gap:12px; }.player-lyrics-content :deep(.original-lyrics-view) { flex:1; min-width:0; }
.player-view-tabs { display:flex; justify-content:center; gap:5px; margin-bottom:14px; }.player-view-tabs button { min-height:40px; padding:8px 17px; border:0; border-radius:14px; background:transparent; color:var(--muted); font-size: calc(13px * var(--ui-font-scale, 1)); }.player-view-tabs button[aria-pressed='true'] { background:var(--accent-soft); color:var(--accent); }.artwork-toggle { display:block; padding:0; border:0; cursor:pointer; }.player-lyrics-view { height:360px; height:min(46dvh,430px); min-height:250px; margin:0 0 22px; padding:10px 4px; border-radius:22px; overflow:hidden; }.player-lyrics-view :deep(.original-lyrics-view) { height:100%; display:flex; flex-direction:column; }.player-lyrics-view :deep(.original-lyrics-scroll) { height:auto; min-height:0; flex:1; }.player-visual-switch-enter-active,.player-visual-switch-leave-active { transition:opacity 180ms ease,transform 220ms ease; }.player-visual-switch-enter-from,.player-visual-switch-leave-to { opacity:0; transform:scale(.97); }html[data-motion='reduced'] :is(.player-visual-switch-enter-active,.player-visual-switch-leave-active) { transition:none; }
</style>
