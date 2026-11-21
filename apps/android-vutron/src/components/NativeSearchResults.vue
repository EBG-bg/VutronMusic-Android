<script setup lang="ts">
import { computed, inject } from 'vue'
import { trackKey } from '../composables/localTrackOrdering'
import { nativeSearchCategoryLabel } from '../composables/nativeSearchCategories'
import { navigationPreviewKey } from '../composables/navigationPreview'
import { vRangeSelect, type RangeSelection } from '../composables/rangeSelect'
import { vTrackMenu } from '../composables/trackActionMenu'
import { isCurrentTrack } from '../platform/currentTrack'
import type { VutronPlaylist, VutronSearchCategory, VutronSearchEntity, VutronSearchItem, VutronTrack } from '../platform/vutronPlugin'
import { useAndroidShellStore } from '../stores/androidShell'
import placeholder from '../../../../src/renderer/assets/images/vutronmusic-icon.png'
import CoverImage from './CoverImage.vue'
import LibraryLayoutControls from './LibraryLayoutControls.vue'
import OnlinePlaylistCard from './OnlinePlaylistCard.vue'
import OriginalIcon from './OriginalIcon.vue'
import TrackMenuButton from './TrackMenuButton.vue'
import WindowedTrackList from './WindowedTrackList.vue'

const props = defineProps<{
  category: VutronSearchCategory
  items: readonly VutronSearchItem[]
  loading?: boolean
  searched?: boolean
  more: boolean | null
  stateKey?: string
  range?: RangeSelection
  selecting?: boolean
  selectedKeys?: ReadonlySet<string>
  selectionRevision?: number
}>()
const emit = defineEmits<{ select: []; track: [VutronTrack]; menu: [VutronTrack]; entity: [VutronSearchEntity]; more: [] }>()
const store = useAndroidShellStore()
const preview = inject(navigationPreviewKey, false)
const tracks = computed(() => props.items as readonly VutronTrack[])
const playlists = computed(() => props.items as readonly VutronPlaylist[])
const entities = computed(() => props.items as readonly VutronSearchEntity[])
const owner = computed(() => 'netease:' + (store.profile?.userId || 0))
const currentIndex = computed(() => tracks.value.findIndex(track => isCurrentTrack(track, store.playback.track, owner.value)))

function coverOf(item: VutronSearchEntity & { picLocalUri?: string }) { return item.picLocalUri || item.picUrl }
function entityArtists(item: VutronSearchEntity) { return 'artists' in item ? item.artists?.map(artist => artist.name).join(' / ') : undefined }
function cancelPreviewActivation(event: Event) {
  if (preview) { event.preventDefault(); event.stopPropagation() }
}
</script>

<template>
  <div :inert="preview" @click.capture="cancelPreviewActivation">
    <LibraryLayoutControls v-if="category === 'playlists'" class="search-layout-controls" />
    <div v-if="category === 'tracks'" v-range-select="preview ? undefined : range" class="track-list search-track-list" :data-selection-revision="selectionRevision ?? 0">
      <button v-if="tracks.length && !selecting" type="button" class="text-button select-tracks-button" @click="emit('select')">{{ $t('mobile.batch.select') }}</button>
      <slot v-if="selecting" name="selection" />
      <WindowedTrackList :items="tracks" :item-key="trackKey" :state-key="stateKey" :selection-revision="selectionRevision ?? 0">
        <template #default="{ item: track, index }">
          <div :data-range-key="trackKey(track)" class="track-row" :class="{ 'track-current': index === currentIndex, 'track-selected': selectedKeys?.has(trackKey(track)) }"
            :aria-current="index === currentIndex ? 'true' : undefined" :role="selecting ? 'checkbox' : 'button'"
            :aria-checked="selecting ? selectedKeys?.has(trackKey(track)) : undefined" tabindex="0"
            v-track-menu="preview ? undefined : () => !selecting && emit('menu', track)"
            @click="emit('track', track)" @keydown.enter.self.prevent="!preview && emit('track', track)" @keydown.space.self.prevent="!preview && emit('track', track)">
            <span v-if="selecting" class="track-selection-check" :class="{ checked: selectedKeys?.has(trackKey(track)) }" aria-hidden="true">
              <OriginalIcon v-if="selectedKeys?.has(trackKey(track))" name="check" />
            </span>
            <span v-else class="track-index">{{ String(index + 1).padStart(2, '0') }}</span>
            <span class="track-copy"><b>{{ track.name }}</b><small>{{ track.artists?.join(' / ') || track.album || $t('mobile.shellUi.neteaseMusic') }}</small></span>
            <TrackMenuButton v-if="!selecting" :name="track.name" @open="emit('menu', track)" />
          </div>
        </template>
      </WindowedTrackList>
    </div>
    <div v-else-if="category === 'playlists'" class="playlist-grid search-playlist-grid">
      <OnlinePlaylistCard v-for="item in playlists" :key="item.id" :playlist="item" :subtitle="$t('mobile.shellUi.songs', { count: item.trackCount ?? 0 })" />
    </div>
    <div v-else class="search-entity-list">
      <button v-for="item in entities" :key="item.id" class="search-entity-row" type="button" @click="emit('entity', item)">
        <CoverImage v-if="coverOf(item)" :src="coverOf(item)" :remote-src="item.picUrl" alt="" loading="lazy" />
        <span v-else class="entity-fallback"><img class="original-cover-placeholder" :src="placeholder" alt="" /></span>
        <span class="entity-copy"><b>{{ item.name }}</b><small>{{ entityArtists(item) || $t(category === 'mvs' ? 'mobile.shellUi.musicVideo' : 'mobile.shellUi.neteaseMusic') }}</small></span>
        <span class="entity-type">{{ $t(nativeSearchCategoryLabel[category]) }}</span>
      </button>
    </div>
    <div v-if="loading && !items.length" class="empty-state">{{ $t('mobile.shellUi.searching') }}</div>
    <div v-else-if="!items.length && searched" class="empty-state">{{ $t('mobile.shellUi.noResults') }}</div>
    <button v-if="more" class="load-more-button" type="button" :disabled="loading" @click="emit('more')">{{ $t(loading ? 'mobile.shellUi.loading' : 'mobile.shellUi.loadMore') }}</button>
    <div v-else-if="more === false && items.length" class="search-end">{{ $t('mobile.shellUi.endOfList') }}</div>
  </div>
</template>

<style scoped>
/* The search header already spaces this toolbar. Keep its margin inside the deck from changing when the next pane is absolutely positioned. */
.library-layout-controls.search-layout-controls { margin-top: 0; }
</style>
