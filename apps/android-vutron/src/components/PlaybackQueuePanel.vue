<script setup lang="ts">
import { computed, nextTick, ref, watch } from 'vue'
import { useModalFocus } from '../composables/modalFocus'
import { actionDialog } from '../platform/actionDialog'
import { useAndroidShellStore } from '../stores/androidShell'
import type { VutronTrack } from '../platform/vutronPlugin'
import OriginalIcon from './OriginalIcon.vue'
import WindowedTrackList from './WindowedTrackList.vue'
import type { WindowedScrollPosition, WindowedTrackListHandle } from '../composables/windowedTracks'
import { reducedMotion } from '../platform/motion'
import { useSheetDrag } from '../composables/sheetDrag'
import SheetDragHandle from './SheetDragHandle.vue'
const store = useAndroidShellStore()
const panel = ref<HTMLElement>()
const scrollPanel = ref<HTMLElement>()
const playlistList = ref<WindowedTrackListHandle>()
useModalFocus(panel, { close: () => { store.queueOpen = false }, open: () => store.queueOpen, enabled: () => !actionDialog.value })
useSheetDrag(panel, { close: () => { store.queueOpen = false }, enabled: () => store.queueOpen && !actionDialog.value })
function keyedTracks(tracks: VutronTrack[]) {
  const occurrences = new Map<string, number>()
  return tracks.map((track, index) => {
    const identity = `${track.id}:${track.localUri ?? track.localPath ?? ''}:${track.playlistVolumeKey ?? ''}`
    const occurrence = occurrences.get(identity) ?? 0
    occurrences.set(identity, occurrence + 1)
    return { track, index, key: `${identity}:${occurrence}` }
  })
}
const insertedTracks = computed(() => keyedTracks(store.playbackQueue.upNext))
const playlistTracks = computed(() => keyedTracks(store.playbackQueue.tracks))
const queueItemKey = (item: { key: string }) => item.key
const currentKey = computed(() => `${store.playback.queueToken ?? ''}:${playlistTracks.value[store.playbackQueue.index]?.key ?? ''}`)
const rememberedCurrent = ref(''), rememberedPosition = ref<WindowedScrollPosition>()
const initialQueuePosition = computed(() => rememberedCurrent.value === currentKey.value ? rememberedPosition.value : undefined)
const initialQueueIndex = computed(() => initialQueuePosition.value ? undefined : Math.max(0, store.playbackQueue.index))
async function locateCurrent(animate = true) {
  await playlistList.value?.scrollToIndex(store.playbackQueue.index, { align: 'center', behavior: animate ? 'smooth' : 'instant' })
}
watch(() => store.queueOpen, async open => {
  if (!open) {
    if (scrollPanel.value) { rememberedPosition.value = playlistList.value?.captureScrollPosition(); rememberedCurrent.value = currentKey.value }
    return
  }
  await nextTick()
  if (!store.queueOpen) return
  if (initialQueuePosition.value) await playlistList.value?.restoreScrollPosition(initialQueuePosition.value)
  else await locateCurrent(false)
}, { flush: 'sync' })
// Opening reads the latest native queue asynchronously. A newer current item must
// replace the initial estimate without mounting all preceding tracks.
watch(currentKey, async () => {
  if (!store.queueOpen) return
  await nextTick(); await locateCurrent(false)
})
</script>
<template>
  <Transition name="queue-sheet" :duration="reducedMotion ? 0 : { enter: 320, leave: 240 }">
    <div v-if="store.queueOpen" class="queue-layer" @click.self="store.queueOpen = false">
      <section ref="panel" class="queue-panel" role="dialog" aria-modal="true" :aria-label="$t('mobile.player.queue')" tabindex="-1" :inert="Boolean(actionDialog)">
        <SheetDragHandle @close="store.queueOpen = false" />
        <header data-sheet-drag-handle><div><h2>{{ $t('mobile.player.queue') }}</h2><small>{{ $t('mobile.common.tracks', { count: store.playbackQueue.tracks.length }) }} · {{ [$t('mobile.player.listLoop'), $t('mobile.player.singleLoop'), $t('mobile.player.shuffle')][store.playbackQueue.mode] }}</small></div><button class="icon-button" type="button" :aria-label="$t('mobile.player.closeQueue')" @click="store.queueOpen = false"><OriginalIcon name="close" /></button></header>
        <div ref="scrollPanel" class="queue-scroll">
          <h3>{{ $t('mobile.common.playing') }}</h3>
          <Transition name="queue-current" mode="out-in"><p :key="store.playback.trackId" class="queue-current">{{ store.playback.title || $t('mobile.common.notPlaying') }}</p></Transition>
          <Transition name="queue-section">
            <section v-if="insertedTracks.length" class="queue-inserted-section">
              <div class="queue-section-title"><h3>{{ $t('mobile.player.inserted', { count: insertedTracks.length }) }}</h3><button class="text-button" type="button" @click="store.clearPlayNext()">{{ $t('mobile.player.clearInserted') }}</button></div>
              <WindowedTrackList :items="insertedTracks" :item-key="queueItemKey" :scroll-target="scrollPanel" :gap="0" :estimated-height="56" animate-changes class="queue-items">
                <template #default="{ item: { track, index } }"><div class="queue-row"><button type="button" class="queue-track" @click="store.playQueueIndex(index, true)"><OriginalIcon name="next" /><span><b>{{ track.name }}</b><small>{{ track.artists?.join(' / ') }}</small></span></button><button type="button" class="icon-button" :aria-label="$t('mobile.player.removeInserted', { name: track.name })" @click="store.removeQueueTrack(index, true)"><OriginalIcon name="close" /></button></div></template>
              </WindowedTrackList>
            </section>
          </Transition>
          <div class="queue-section-title"><h3>{{ $t('mobile.player.playlist') }}</h3><button type="button" class="text-button queue-locate" :disabled="store.playbackQueue.index < 0" @click="locateCurrent()"><OriginalIcon name="play" />{{ $t('mobile.player.locateCurrent') }}</button></div>
          <WindowedTrackList ref="playlistList" :items="playlistTracks" :item-key="queueItemKey" :scroll-target="scrollPanel" :initial-index="initialQueueIndex" :initial-position="initialQueuePosition" :gap="0" :estimated-height="56" animate-changes class="queue-items">
            <template #default="{ item: { track, index } }"><div class="queue-row" :class="{ current: index === store.playbackQueue.index }"><button type="button" class="queue-track" :aria-current="index === store.playbackQueue.index ? 'true' : undefined" @click="store.playQueueIndex(index)"><span class="queue-number">{{ index + 1 }}</span><span><b>{{ track.name }}</b><small>{{ track.artists?.join(' / ') }}</small></span></button><button type="button" class="icon-button" :aria-label="$t('mobile.player.removeTrack', { name: track.name })" @click="store.removeQueueTrack(index)"><OriginalIcon name="close" /></button></div></template>
          </WindowedTrackList>
          <Transition name="queue-section"><p v-if="!playlistTracks.length" class="empty-state">{{ $t('mobile.library.noQueue') }}</p></Transition>
        </div>
      </section>
    </div>
  </Transition>
</template>

<style scoped>
.queue-items { position: relative; }
.queue-locate { display: inline-flex; gap: 5px; align-items: center; }
.queue-locate .original-icon { width: 15px; height: 15px; }
.queue-section-enter-active, .queue-section-leave-active, .queue-current-enter-active, .queue-current-leave-active { transition: opacity 125ms ease-out, transform 125ms ease-out; }
.queue-section-enter-from, .queue-section-leave-to, .queue-current-enter-from, .queue-current-leave-to { opacity: 0; transform: translateY(6px); }
.queue-row { transition: background-color 125ms ease-out, color 125ms ease-out, outline-color var(--motion-feedback), box-shadow var(--motion-feedback); }
html[data-motion="reduced"] .queue-section-enter-active, html[data-motion="reduced"] .queue-section-leave-active, html[data-motion="reduced"] .queue-current-enter-active, html[data-motion="reduced"] .queue-current-leave-active, html[data-motion="reduced"] .queue-row { transition: none; }
</style>
