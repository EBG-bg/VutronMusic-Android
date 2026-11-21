<script setup lang="ts">
import { computed, inject, toRef } from 'vue'
import { useI18n } from 'vue-i18n'
import { useAndroidShellStore } from '../stores/androidShell'
import type { VutronPlaylist, VutronTrack } from '../platform/vutronPlugin'
import { isCurrentTrack } from '../platform/currentTrack'
import { trackKey } from '../composables/localTrackOrdering'
import { useTrackSelection, type TrackBatchAction } from '../composables/trackSelection'
import { vRangeSelect } from '../composables/rangeSelect'
import { vTrackMenu } from '../composables/trackActionMenu'
import { useTrackSearch, useSortedTracks, useLocalTrackOrder } from '../composables/libraryPresentation'
import { useLibraryManagement } from '../composables/libraryManagement'
import { navigationPreviewKey, type LibraryMode } from '../composables/navigationPreview'
import OriginalIcon from './OriginalIcon.vue'
import PlaylistLibrary from './PlaylistLibrary.vue'
import PlaylistMenuButton from './PlaylistMenuButton.vue'
import LocalTrackList from './LocalTrackList.vue'
import LocalLibrarySort from './LocalLibrarySort.vue'
import TrackSelectionBar from './TrackSelectionBar.vue'
import TrackMenuButton from './TrackMenuButton.vue'
import WindowedTrackList from './WindowedTrackList.vue'

const query = defineModel<string>('query', { default: '' })
const props = withDefaults(defineProps<{
  libraryMode: LibraryMode; filter?: string
  localBatchActions?: TrackBatchAction[]; cacheBatchActions?: TrackBatchAction[]
  runBatch?: (action: string, tracks: VutronTrack[]) => Promise<boolean>
}>(), { filter: '' })
const emit = defineEmits<{ menu: [track: VutronTrack, collection: string] }>()
const { t } = useI18n()
const store = useAndroidShellStore()
const preview = inject(navigationPreviewKey, false)
const libraryManagement = useLibraryManagement()
const runBatch = (action: string, tracks: VutronTrack[]) => props.runBatch?.(action, tracks) ?? Promise.resolve(false)
function coverOf(item: VutronPlaylist) { return item.coverLocalUri || item.coverImgUrl || '' }
const playlistOwner = computed(() => store.cachedPlaylists.find(p => !p.pluginCacheKey && p.cacheOwnerId)?.cacheOwnerId || store.profile?.userId || 0)
const offlineEntryKey = (playlist: VutronPlaylist) => playlist.pluginCacheKey ? `plugin:${playlist.pluginCacheKey}` : `${playlist.cacheOwnerId || playlistOwner.value}:${playlist.id}`
function playlistSummary(count: number, source?: string) {
  const tracks = t('mobile.common.tracks', { count })
  return source ? t('mobile.playlistCache.sourceTrackCount', { source, tracks }) : tracks
}
const onlinePlaylistEntries = computed(() => store.playlists.map(p => ({ key: String(store.profile?.userId || 0) + ':' + p.id, name:p.name, count:p.trackCount || 0, cover:coverOf(p), remoteCover:p.coverImgUrl, createTime:p.createTime })))
const offlinePlaylistsByKey = computed(() => new Map(store.cachedPlaylists.map(p => [offlineEntryKey(p), p])))
const offlinePlaylistEntries = computed(() => Array.from(offlinePlaylistsByKey.value, ([key, p]) => ({
  key, name:p.name, count:p.trackCount || 0, subtitle: p.cacheProviderName ? playlistSummary(p.trackCount || 0, p.cacheProviderName) : undefined,
  cover: p.pluginCacheKey ? p.coverLocalUri : coverOf(p), remoteCover:p.pluginCacheKey ? undefined : p.coverImgUrl, createTime:p.createTime
})))
const localPlaylistEntries = computed(() => store.localLibrary.playlists.map(p => ({ key:p.id, name:p.name, count:p.trackCount, createTime:p.createTime })))
const onlinePlaylistsByKey = computed(() => new Map(store.playlists.map(p => [String(store.profile?.userId || 0) + ':' + p.id, p])))
function openOnlinePlaylistKey(key: string) { const playlist = onlinePlaylistsByKey.value.get(key); if (playlist) void store.openPlaylist(playlist) }
function openOfflinePlaylistKey(key: string) { const p = offlinePlaylistsByKey.value.get(key); if (p) void store.openCachedPlaylist(p) }
function removeOfflinePlaylistKey(key: string) { const p = offlinePlaylistsByKey.value.get(key); if (p) void libraryManagement.deleteOfflinePlaylist(p) }
function openLocalPlaylistKey(key: string) { const p = store.localLibrary.playlists.find(p => p.id === key); if (p) void store.openLocalCollection(p) }
const libraryQuery = toRef(props, 'filter')
const cachedMatches = useTrackSearch(computed(() => store.cachedTracks), libraryQuery)
const libraryOrder = useLocalTrackOrder()
const orderedCachedTracks = useSortedTracks(cachedMatches, libraryOrder)
const currentRecording = computed(() => store.playback.track)
const currentCachedIndex = computed(() => orderedCachedTracks.value.findIndex(track => isCurrentTrack(track, currentRecording.value, 'netease:' + playlistOwner.value)))
const cacheSelection = useTrackSelection(orderedCachedTracks,trackKey,computed(() => `${props.libraryMode}:${store.profile?.userId || 0}`))
const {active:cacheSelecting,keys:cacheSelectedKeys,selected:cacheSelected,selectedCount:cacheSelectedCount,allSelected:cacheAll,busy:cacheBatchBusy}=cacheSelection
function closeSelection() {
  if (!cacheSelecting.value) return false
  cacheSelection.close()
  return true
}
defineExpose({ closeSelection })
</script>

<template>
  <div class="library-pane">
    <p v-if="libraryMode !== 'playlists'" class="library-mode-description">{{ $t(libraryMode === 'local' ? 'mobile.offline.deviceHint' : 'mobile.offline.cacheHint') }}</p>
    <label class="search-box"><span><OriginalIcon name="search" /></span><input v-model="query" type="search" :placeholder="libraryMode === 'playlists' ? t('mobile.shellUi.searchPlaylists') : t('mobile.shellUi.searchTracks')" /></label>
    <p v-if="store.localScanLoading" class="setting-note" role="status">{{ $t('mobile.shellUi.backgroundScan') }}</p>
    <template v-if="libraryMode === 'playlists'">
    <PlaylistLibrary :entries="onlinePlaylistEntries" :scope="'netease:' + (store.profile?.userId || 0)" :query="libraryQuery" :loading="store.playlistsLoading" @open="openOnlinePlaylistKey">
      <template #row-actions="{ item, placement }"><PlaylistMenuButton :playlist="onlinePlaylistsByKey.get(item.key)" :placement="placement" /></template>
      <template #actions><button v-if="store.onlineAvailable" class="secondary-button create-playlist-button" type="button" :disabled="store.onlineMutationBusy" @click="store.openCreateOnlinePlaylist"><OriginalIcon name="plus" />{{ $t('mobile.netease.create') }}</button><button v-if="store.onlineNeedsRefresh" class="text-button" type="button" :disabled="store.onlineMutationBusy" @click="store.refreshOnlineLibrary"><OriginalIcon name="refresh" />{{ $t('mobile.netease.refresh') }}</button></template>
    </PlaylistLibrary>
    </template>
    <div v-else-if="libraryMode === 'offline'" class="offline-content">

      <PlaylistLibrary :entries="offlinePlaylistEntries" :scope="'netease:' + playlistOwner" :query="libraryQuery" :loading="store.cachedPlaylistsLoading && !offlinePlaylistEntries.length" removable @open="openOfflinePlaylistKey" @remove="removeOfflinePlaylistKey" />
      <h3 class="offline-track-heading">{{ $t('mobile.shellUi.cachedTracks', { count: store.cachedTracks.length }) }}</h3>
      <LocalLibrarySort v-model="libraryOrder" />
      <button v-if="orderedCachedTracks.length && !cacheSelecting" type="button" class="text-button select-tracks-button" @click="cacheSelecting=true">{{ $t('mobile.batch.select') }}</button>
      <TrackSelectionBar v-if="cacheSelecting" :count="cacheSelectedCount" :total="orderedCachedTracks.length" :all="cacheAll" :busy="cacheBatchBusy" :actions="cacheBatchActions ?? []" @all="cacheSelection.selectAll" @close="cacheSelection.close" @action="action=>cacheSelection.run(action,runBatch)" />
      <div v-range-select="!preview && !cacheBatchBusy ? cacheSelection.range.value : undefined" class="track-list">
        <WindowedTrackList :items="orderedCachedTracks" :item-key="trackKey" :state-key="JSON.stringify(['cached-tracks',playlistOwner,libraryQuery,libraryOrder])"><template #default="{item:track,index}">
        <div :data-range-key="trackKey(track)" class="track-row" :class="{'track-current':index===currentCachedIndex,'track-selected':cacheSelectedKeys.has(trackKey(track))}" :aria-current="index===currentCachedIndex?'true':undefined" :role="cacheSelecting?'checkbox':'button'" :aria-checked="cacheSelecting?cacheSelectedKeys.has(trackKey(track)):undefined" tabindex="0" v-track-menu="preview ? undefined : () => !cacheSelecting && emit('menu', track, 'cache:all')" @click="cacheSelecting?cacheSelection.toggle(track):store.play(track, 'cache:all', orderedCachedTracks)" @keydown.enter.self.prevent="cacheSelecting?cacheSelection.toggle(track):store.play(track, 'cache:all', orderedCachedTracks)" @keydown.space.self.prevent="cacheSelecting?cacheSelection.toggle(track):store.play(track, 'cache:all', orderedCachedTracks)">
          <span v-if="cacheSelecting" class="track-selection-check" :class="{checked:cacheSelectedKeys.has(trackKey(track))}" aria-hidden="true"><OriginalIcon v-if="cacheSelectedKeys.has(trackKey(track))" name="check" /></span><span v-else class="track-index">{{ String(index + 1).padStart(2, '0') }}</span>
          <span class="track-copy"><b>{{ track.name }}</b><small>{{ track.artists?.join(' / ') || track.album }}</small></span>
          <span class="offline-badge">{{ $t('mobile.common.offline') }}</span><TrackMenuButton v-if="!cacheSelecting" :name="track.name" @open="emit('menu', track, 'cache:all')" />
        </div>
        </template></WindowedTrackList>
        <div v-if="!orderedCachedTracks.length" class="empty-state">{{ $t('mobile.shellUi.noCachedTracks') }}</div>
      </div>
    </div>

    <div v-else class="track-list">
      <PlaylistLibrary v-if="store.localLibrary.playlists.length" :entries="localPlaylistEntries" scope="local:device" :query="libraryQuery" @open="openLocalPlaylistKey" />
      <div class="inline-info"><span>{{ store.folderName }}</span><button type="button" class="text-button" @click="store.pickMusicFolder">{{ $t('mobile.library.chooseFolder') }}</button></div>
      <LocalTrackList :tracks="store.localTracks" collection-key="local:folder" :query="libraryQuery" :loading="store.localScanLoading" :local-only="store.localOnly" :current-track="store.playback.track" :batch-actions="localBatchActions" :run-batch="runBatch" @play="(track, queue) => store.play(track, 'local:folder', queue)" @menu="track => emit('menu', track, 'local:folder')" @order-change="keys => store.reorderLocalPlayback('local:folder', keys)" />
    </div>
  </div>
</template>

<style scoped>
.library-pane { display: flow-root; }
</style>
