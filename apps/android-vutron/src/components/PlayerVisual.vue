<script setup lang="ts">
import { useAndroidShellStore } from '../stores/androidShell'
import { computed, defineAsyncComponent, onMounted, onUnmounted, ref } from 'vue'
import { playerLyrics } from '../platform/interfacePreferences'
import CoverImage from './CoverImage.vue'
import PluginArtwork from './PluginArtwork.vue'
import OriginalIcon from './OriginalIcon.vue'
import LandscapeLyricOffset from './LandscapeLyricOffset.vue'
import { useNavigationIndicator } from '../composables/navigationIndicator'
import { prepareNavigationSwipeLeave } from '../composables/mainNavigationSwipe'
const OriginalLyricsView = defineAsyncComponent(() => import('./OriginalLyricsView.vue'))
const props = defineProps<{ cover: string; remoteCover?: string; pluginId?: string; pluginContext?: Record<string, unknown>; swipeStyle?: Record<string, string>; swiping?: boolean; swipePosition?: number; releasedOffset?: number; direction?: 'next' | 'previous' }>()
const store = useAndroidShellStore()
const lyricLoop = computed(() => store.playback.abLoop?.enabled && store.playback.abLoop.trackId === store.playback.trackId ? store.playback.abLoop : undefined)
const wideQuery = window.matchMedia('(min-width: 840px) and (orientation: landscape)')
const wide = ref(wideQuery.matches)
const viewTabs = ref<HTMLElement>()
const indicatorStyle = useNavigationIndicator(viewTabs, computed(() => props.swipePosition ?? (playerLyrics.value ? 1 : 0)), computed(() => 2))
defineExpose({ wide })
function prepareLeave(element: Element) {
  prepareNavigationSwipeLeave(element, props.releasedOffset ?? 0)
}
function updateWindow() { wide.value = wideQuery.matches }
onMounted(() => wideQuery.addEventListener('change', updateWindow))
onUnmounted(() => wideQuery.removeEventListener('change', updateWindow))
</script>
<template>
  <div class="player-visual" :class="{ 'player-visual-wide': wide }">
    <div v-if="!wide" ref="viewTabs" class="player-view-tabs navigation-tabs" :data-swiping="swiping ? '' : undefined" role="group" :aria-label="$t('mobile.refinements.playerView')"><span class="navigation-tab-indicator" :style="indicatorStyle" aria-hidden="true"></span><button type="button" :aria-pressed="!playerLyrics" @click="playerLyrics = false">{{ $t('mobile.refinements.cover') }}</button><button type="button" :aria-pressed="playerLyrics" @click="playerLyrics = true">{{ $t('mobile.refinements.lyrics') }}</button></div>
    <Transition :name="wide ? 'player-visual-switch' : 'surface-' + (direction ?? 'next')" @before-leave="prepareLeave">
      <button v-if="wide || !playerLyrics" key="cover" class="player-artwork artwork-toggle swipe-surface" :style="!wide ? swipeStyle : undefined" :data-swiping="swiping ? '' : undefined" type="button" :aria-label="$t(wide ? 'mobile.refinements.cover' : 'mobile.refinements.showLyrics')" :disabled="wide" @click="playerLyrics = true"><PluginArtwork v-if="pluginId" :plugin-id="pluginId" :uri="props.cover" :source-context="pluginContext" eager size="large" /><CoverImage v-else-if="props.cover" :src="props.cover" :remote-src="remoteCover" loading="eager" size="large" alt="" /><span v-else class="cover-fallback large-cover"><OriginalIcon name="library" /></span><span class="artwork-glow"></span></button>
    </Transition>
    <Transition :name="wide ? 'player-visual-switch' : 'surface-' + (direction ?? 'next')" @before-leave="prepareLeave">
      <section v-if="wide || playerLyrics" key="lyrics" class="lyrics-panel player-lyrics-view swipe-surface" :style="!wide ? swipeStyle : undefined" :data-swiping="swiping ? '' : undefined" @click.self="!wide && (playerLyrics = false)">
        <div v-if="store.lyricsLoading || !store.lyrics.original.length" class="lyrics-empty">{{ $t(store.lyricsLoading ? 'mobile.refinements.lyricsLoading' : 'mobile.refinements.noLyrics') }}</div>
        <div v-else class="player-lyrics-content"><OriginalLyricsView :family="store.lyrics" :position="store.playback.position" :playing="store.playback.playing && !store.playback.buffering" :rate="store.playback.rate ?? 1" :offset-ms="store.overlaySettings.currentLyricOffsetMs ?? 0" :duration="store.playback.duration" :display-settings="store.overlaySettings" :loop="lyricLoop" @seek="store.seek" /><LandscapeLyricOffset /></div>
      </section>
    </Transition>
  </div>
</template>
<style scoped>
.player-visual { display:grid; grid-template-columns:minmax(0,1fr); }
.player-view-tabs { grid-area:1 / 1; }
.player-artwork,.player-lyrics-view { grid-area:2 / 1; align-self:start; }
.player-lyrics-content { height:100%; min-height:0; display:flex; gap:12px; }.player-lyrics-content :deep(.original-lyrics-view) { flex:1; min-width:0; }
.player-view-tabs { display:flex; justify-content:center; gap:5px; margin-bottom:14px; }.player-view-tabs button { min-height:40px; padding:8px 17px; border:0; border-radius:14px; background:transparent; color:var(--muted); font-size: calc(13px * var(--ui-font-scale, 1)); }.player-view-tabs button[aria-pressed='true'] { background:transparent; color:var(--accent); }.player-view-tabs .navigation-tab-indicator { border-radius:14px; }.artwork-toggle { display:block; padding:0; border:0; border-radius:16px; background:transparent; cursor:pointer; }.player-lyrics-view { height:360px; height:min(46dvh,430px); min-height:250px; margin:0 0 22px; padding:10px 4px; border-radius:22px; overflow:hidden; }.player-lyrics-view :deep(.original-lyrics-view) { height:100%; display:flex; flex-direction:column; }.player-lyrics-view :deep(.original-lyrics-scroll) { height:auto; min-height:0; flex:1; }.player-visual-switch-enter-active,.player-visual-switch-leave-active { transition:opacity 180ms ease,transform 220ms ease; }.player-visual-switch-enter-from,.player-visual-switch-leave-to { opacity:0; transform:scale(.97); }html[data-motion='reduced'] .player-visual-switch-enter-active, html[data-motion='reduced'] .player-visual-switch-leave-active { transition:none; }
</style>
