<script setup lang="ts">
import { useAndroidShellStore } from '../stores/androidShell'
import { computed, inject, onMounted, onUnmounted, ref } from 'vue'
import { playerLyrics } from '../platform/interfacePreferences'
import CoverImage from './CoverImage.vue'
import PluginArtwork from './PluginArtwork.vue'
import OriginalIcon from './OriginalIcon.vue'
import LandscapeLyricOffset from './LandscapeLyricOffset.vue'
import LyricOffsetControl from './LyricOffsetControl.vue'
import OriginalLyricsView from './OriginalLyricsView.vue'
import { navigationPreviewKey } from '../composables/navigationPreview'
import { useNavigationIndicator } from '../composables/navigationIndicator'
import { finishNavigationSwipeEnter } from '../composables/mainNavigationSwipe'
const props = defineProps<{
  cover: string; remoteCover?: string; pluginId?: string; pluginContext?: Record<string, unknown>
  swipeStyle?: Record<string, string>; swiping?: boolean; swipePosition?: number; direction?: 'next' | 'previous'
  neighbor?: string; peekStyle?: Record<string, string>; prepareEnter?: (element: Element) => void; prepareLeave?: (element: Element) => void; previewLyrics?: boolean
}>()
const store = useAndroidShellStore()
const preview = inject(navigationPreviewKey, false)
const showingLyrics = computed(() => preview && props.previewLyrics !== undefined ? props.previewLyrics : playerLyrics.value)
const lyricLoop = computed(() => store.playback.abLoop?.enabled && store.playback.abLoop.trackId === store.playback.trackId ? store.playback.abLoop : undefined)
const wideQuery = window.matchMedia('(min-width: 840px) and (orientation: landscape)')
const wide = ref(wideQuery.matches)
const viewTabs = ref<HTMLElement>()
const swipeViewport = ref<HTMLElement>()
const indicatorStyle = preview ? undefined : useNavigationIndicator(viewTabs, computed(() => props.swipePosition ?? (playerLyrics.value ? 1 : 0)), computed(() => 2))
defineExpose({ wide, swipeViewport })
function beforeLeave(element: Element) {
  if (!preview && !wide.value && !element.hasAttribute('data-player-peek')) props.prepareLeave?.(element)
}
function beforeEnter(element: Element) {
  if (!preview && !wide.value && !element.hasAttribute('data-player-peek')) props.prepareEnter?.(element)
}
function updateWindow() { wide.value = wideQuery.matches }
if (!preview) {
  onMounted(() => wideQuery.addEventListener('change', updateWindow))
  onUnmounted(() => wideQuery.removeEventListener('change', updateWindow))
}
</script>
<template>
  <div class="player-visual" :class="{ 'player-visual-wide': wide, 'player-visual-preview': preview }">
    <div v-if="!wide" ref="viewTabs" class="player-view-tabs navigation-tabs" :data-swiping="swiping ? '' : undefined" role="group" :aria-label="$t('mobile.refinements.playerView')"><span v-if="!preview" class="navigation-tab-indicator" :style="indicatorStyle" aria-hidden="true"></span><button type="button" :aria-pressed="!showingLyrics" @click="!preview && (playerLyrics = false)">{{ $t('mobile.refinements.cover') }}</button><button type="button" :aria-pressed="showingLyrics" @click="!preview && (playerLyrics = true)">{{ $t('mobile.refinements.lyrics') }}</button></div>
    <div ref="swipeViewport" class="swipe-deck player-viewport">
    <Transition :name="wide ? 'player-visual-switch' : 'surface-' + (direction ?? 'next')" @before-leave="beforeLeave" @before-enter="beforeEnter" @after-enter="finishNavigationSwipeEnter">
      <div v-if="wide || !showingLyrics || neighbor === 'cover'" key="cover" class="swipe-surface player-visual-pane" :data-slide-active="!wide && !showingLyrics ? '' : undefined" :data-player-peek="!wide && showingLyrics ? '' : undefined" :data-peek-tab="!wide && showingLyrics ? 'cover' : undefined" :style="!wide ? showingLyrics ? peekStyle : swipeStyle : undefined" :data-swiping="!wide && swiping ? '' : undefined" :inert="!wide && showingLyrics">
        <button class="player-artwork artwork-toggle" type="button" :aria-label="$t(wide ? 'mobile.refinements.cover' : 'mobile.refinements.showLyrics')" :disabled="wide" @click="!preview && (playerLyrics = true)"><PluginArtwork v-if="pluginId" :plugin-id="pluginId" :uri="props.cover" :source-context="pluginContext" eager size="large" /><CoverImage v-else-if="props.cover" :src="props.cover" :remote-src="remoteCover" :loading="showingLyrics && !wide ? 'lazy' : 'eager'" size="large" alt="" /><span v-else class="cover-fallback large-cover"><OriginalIcon name="library" /></span><span class="artwork-glow"></span></button>
      </div>
    </Transition>
    <Transition :name="wide ? 'player-visual-switch' : 'surface-' + (direction ?? 'next')" @before-leave="beforeLeave" @before-enter="beforeEnter" @after-enter="finishNavigationSwipeEnter">
      <div v-if="wide || showingLyrics || neighbor === 'lyrics'" key="lyrics" class="swipe-surface player-visual-pane" :data-slide-active="!wide && showingLyrics ? '' : undefined" :data-player-peek="!wide && !showingLyrics ? '' : undefined" :data-peek-tab="!wide && !showingLyrics ? 'lyrics' : undefined" :style="!wide ? showingLyrics ? swipeStyle : peekStyle : undefined" :data-swiping="!wide && swiping ? '' : undefined" :inert="!wide && !showingLyrics">
        <section class="lyrics-panel player-lyrics-view" @click.self="!preview && !wide && (playerLyrics = false)">
          <div v-if="store.lyricsLoading || !store.lyrics.original.length" class="lyrics-empty">{{ $t(store.lyricsLoading ? 'mobile.refinements.lyricsLoading' : 'mobile.refinements.noLyrics') }}</div>
          <div v-else class="player-lyrics-content">
            <OriginalLyricsView :family="store.lyrics" :position="store.playback.position" :playing="!preview && (wide || showingLyrics) && store.playback.playing && !store.playback.buffering" :rate="store.playback.rate ?? 1" :offset-ms="store.overlaySettings.currentLyricOffsetMs ?? 0" :duration="store.playback.duration" :display-settings="store.overlaySettings" :loop="lyricLoop" @seek="!preview && store.seek($event)" />
            <aside v-if="preview" class="preview-lyric-offset"><LyricOffsetControl orientation="vertical" compact :model-value="store.overlaySettings.currentLyricOffsetMs ?? 0" :disabled="!store.playback.trackId" /></aside>
            <LandscapeLyricOffset v-else-if="wide || showingLyrics" />
          </div>
        </section>
      </div>
    </Transition>
    </div>
  </div>
</template>
<style scoped>
.player-visual { display: grid; grid-template-columns: minmax(0, 1fr); }
.player-view-tabs {
  grid-area: 1 / 1;
  display: inline-flex;
  justify-content: center;
  justify-self: center;
  gap: 2px;
  margin-bottom: 16px;
  padding: 3px;
  border: 1px solid var(--line);
  border-radius: 999px;
  background: var(--surface);
}
.player-view-tabs button {
  min-height: 34px;
  padding: 6px 18px;
  border: 0;
  border-radius: 999px;
  background: transparent;
  color: var(--muted);
  font-size: calc(12px * var(--ui-font-scale, 1));
  font-weight: 600;
  line-height: 1.25;
}
.player-view-tabs button[aria-pressed='true'] {
  background: transparent;
  color: var(--accent-ink);
  font-weight: 700;
}
.player-view-tabs .navigation-tab-indicator {
  border-radius: 999px;
  border: 1px solid var(--line);
  background: var(--surface-elevated);
  box-shadow: 0 2px 8px rgb(0 0 0 / 12%);
}
.player-artwork, .player-lyrics-view { grid-area: 2 / 1; align-self: start; }
.player-lyrics-content { height: 100%; min-height: 0; display: flex; gap: 12px; }
.player-lyrics-content :deep(.original-lyrics-view) { flex: 1; min-width: 0; }
.artwork-toggle {
  display: block;
  padding: 0;
  border: 0;
  border-radius: 22px;
  overflow: hidden;
  background: var(--surface);
  cursor: pointer;
}
.artwork-toggle :deep(img), .artwork-toggle :deep(.plugin-artwork) { border-radius: inherit; }
.player-lyrics-view {
  box-sizing: border-box;
  height: var(--player-art-size);
  min-height: 0;
  margin: 0 0 20px;
  padding: 12px 6px;
  border-radius: 22px;
  overflow: hidden;
}
.player-lyrics-view :deep(.original-lyrics-view) { height: 100%; display: flex; flex-direction: column; }
.player-lyrics-view :deep(.original-lyrics-scroll) { height: auto; min-height: 0; flex: 1; }
.player-visual-switch-enter-active, .player-visual-switch-leave-active { transition: opacity 180ms ease, transform 220ms ease; }
.player-visual-switch-enter-from, .player-visual-switch-leave-to { opacity: 0; transform: scale(.97); }
html[data-motion='reduced'] .player-visual-switch-enter-active, html[data-motion='reduced'] .player-visual-switch-leave-active { transition: none; }
.player-viewport { grid-area:2 / 1; min-width:0; }
.player-visual-wide .player-viewport, .player-visual-wide .player-visual-pane { display:contents; }
.player-visual-pane { display:flow-root; transition: translate var(--swipe-settle) var(--swipe-curve); }
.player-visual-pane[data-player-peek] { position:absolute; inset:0 0 auto; opacity:1; transform:none; translate:var(--swipe-peek-x) 0; pointer-events:none; }
.player-visual-pane[data-player-peek][class*="-enter-active"] { transition:none; }
.player-visual-pane[data-player-peek][class*="-leave-active"] { position:absolute; inset:0 0 auto; opacity:1; transform:none; transition:translate var(--swipe-settle) var(--swipe-curve); }
.player-visual-pane[data-player-peek][class*="-leave-to"] { translate:var(--swipe-peek-rest) 0; }
.player-viewport:has(> [data-player-peek]) { overflow-x:clip; }
.player-visual-pane[data-swiping] { transition:none; }
.player-visual-preview .player-view-tabs button[aria-pressed='true'] { background: var(--accent-soft); }
.preview-lyric-offset { display: none; }
@media (orientation: landscape) {
.preview-lyric-offset { display: flex; flex: 0 0 max(62px, calc(56px * var(--ui-font-scale, 1))); align-self: center; justify-content: center; align-items: center; min-width: 0; padding: 8px 4px; }
}
</style>
