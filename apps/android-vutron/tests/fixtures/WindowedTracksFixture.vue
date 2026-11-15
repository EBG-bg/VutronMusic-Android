<script setup lang="ts">
import { nextTick, onMounted, ref } from 'vue'
import WindowedTrackList from '../../src/components/WindowedTrackList.vue'
import PlaybackQueuePanel from '../../src/components/PlaybackQueuePanel.vue'
import type { WindowedTrackListHandle } from '../../src/composables/windowedTracks'
import { useAndroidShellStore } from '../../src/stores/androidShell'
const items = ref(Array.from({ length: 5000 }, (_, id) => ({ id, name: `Track ${id} ` + (id % 5 === 0 ? 'variable height wrapped title '.repeat(4) : 'short title') })))
const key = (item: { id: number }) => item.id
const list = ref<WindowedTrackListHandle>(), pinned = ref<number>()
const shown = ref(true), stateKey = ref('fixture-library/a')
const store = useAndroidShellStore()
store.playbackQueue = { tracks: items.value.map(item => ({ ...item, artists: ['Artist'], duration: 180000 })), upNext: [], index: 3017, mode: 0 }
store.playback = { ...store.playback, trackId: 3017, title: 'Track 3017', queueToken: 'fixture', playing: false }
onMounted(() => { (window as unknown as Record<string, unknown>).windowedHarness = { items, store, list, pinned, stateKey, async remount() { shown.value = false; await nextTick(); window.scrollTo(0, 0); shown.value = true } } })
</script>
<template>
  <main class="windowed-fixture">
    <h1>Variable height track list</h1>
    <button id="open-queue" type="button" @click="store.queueOpen = true">Open queue</button>
    <WindowedTrackList v-if="shown" ref="list" :items="items" :item-key="key" :estimated-height="76" :pinned-index="pinned" :state-key="stateKey">
      <template #default="{ item, index }"><article class="fixture-track" :data-track="index"><button type="button">{{ item.name }}</button><small>{{ index }}</small><button type="button" class="fixture-action">More</button></article></template>
    </WindowedTrackList>
  </main>
  <PlaybackQueuePanel />
</template>
<style scoped>
.windowed-fixture { max-width: 390px; margin: auto; padding: 12px; }
.fixture-track { display: flex; gap: 8px; align-items: center; min-height: 58px; border-radius: 12px; border: 1px solid var(--line); padding: 8px; }
.fixture-track > button:first-child { flex: 1; min-width: 0; text-align: left; white-space: normal; font-size: calc(14px * var(--ui-font-scale, 1)); }
.fixture-action { width: 44px; flex: 0 0 44px; }
</style>
