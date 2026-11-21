<script setup lang="ts">
import { computed, inject, onBeforeUnmount, onMounted, ref } from 'vue'
import { useI18n } from 'vue-i18n'
import { useAndroidShellStore } from '../stores/androidShell'
import type { VutronTrack } from '../platform/vutronPlugin'
import { isCurrentTrack } from '../platform/currentTrack'
import { navigationPreviewKey, type HomeShelfPositions } from '../composables/navigationPreview'
import { vTrackMenu } from '../composables/trackActionMenu'
import originalBrandLogo from '../../../../src/renderer/assets/images/vutronmusic-icon.png?url'
import CoverImage from './CoverImage.vue'
import OriginalIcon from './OriginalIcon.vue'
import OnlinePlaylistCard from './OnlinePlaylistCard.vue'
import TrackMenuButton from './TrackMenuButton.vue'

const props = defineProps<{ heroIndex: number; shelfPositions: HomeShelfPositions }>()
const emit = defineEmits<{ navigate: [tab: 'home' | 'search' | 'library']; refresh: []; hero: [index: number]; heroSelect: [index: number]; heroMove: [direction: -1 | 1]; menu: [track: VutronTrack] }>()
const { t } = useI18n()
const store = useAndroidShellStore()
const preview = inject(navigationPreviewKey, false)
const shelfOwner = store.profile?.userId
const home = ref<HTMLElement>()
const shelves = () => home.value?.querySelectorAll<HTMLElement>('[data-home-shelf]') ?? []
function previewItems<T>(items: T[], shelf: string) {
  return preview ? items.slice(0, Math.max(8, props.shelfPositions.get(shelf)?.previewCount ?? 0)) : items
}
const recommendations = computed(() => previewItems(store.homeData.playlists, 'playlists'))
const charts = computed(() => previewItems(store.homeData.charts, 'charts'))
onMounted(() => {
  for (const shelf of shelves()) {
    const position = props.shelfPositions.get(shelf.dataset.homeShelf!)
    if (position) shelf.scrollTo({ left: position.left, behavior: 'instant' })
  }
})
onBeforeUnmount(() => {
  if (preview || shelfOwner !== store.profile?.userId) return
  for (const shelf of shelves()) {
    const name = shelf.dataset.homeShelf!
    const left = shelf.scrollLeft
    if (left <= 0) { props.shelfPositions.delete(name); continue }
    const right = shelf.getBoundingClientRect().right
    const next = Array.from(shelf.children).findIndex(card => card.getBoundingClientRect().left >= right)
    // Include one card beyond the visible edge so the inert swipe preview can
    // render the saved position even when the user moved past its first group.
    props.shelfPositions.set(name, { left, previewCount: next < 0 ? shelf.children.length : next + 1 })
  }
})
const currentDailyIndex = computed(() => store.homeData.dailyTracks.slice(0, 8).findIndex(track => isCurrentTrack(track, store.playback.track, 'netease:' + (store.profile?.userId || 0))))
function coverOf(item: { coverLocalUri?: string; coverImgUrl?: string; picLocalUri?: string; picUrl?: string }) {
  return item.coverLocalUri || item.picLocalUri || item.coverImgUrl || item.picUrl || ''
}
function heroPosition(index: number) {
  const length = store.homeData.banners.length
  const delta = (index - props.heroIndex + length) % length
  return delta === 0 ? 'hero-center' : delta === 1 ? 'hero-right' : delta === length - 1 ? 'hero-left' : 'hero-hidden'
}
let heroTouchStart = 0
function endHeroSwipe(event: TouchEvent) {
  const distance = (event.changedTouches[0]?.clientX ?? heroTouchStart) - heroTouchStart
  if (Math.abs(distance) >= 35) emit('heroMove', distance < 0 ? 1 : -1)
}
</script>

<template>
  <section ref="home" class="page home-page">
    <div class="home-greeting"><div><h2>{{ $t('mobile.home.forYou') }}</h2></div><button class="home-search-shortcut" type="button" :aria-label="$t('mobile.shellUi.searchMusic')" @click="emit('navigate', 'search')"><OriginalIcon name="search" /></button></div>
    <div v-if="store.homeData.banners.length" class="hero-carousel" :aria-label="$t('mobile.shellUi.carousel')" @touchstart.passive="heroTouchStart = $event.touches[0]?.clientX ?? 0" @touchend.passive="endHeroSwipe">
      <button v-for="(banner, index) in store.homeData.banners" :key="`${banner.id}-${index}`" class="hero-card" :class="heroPosition(index)" :tabindex="heroPosition(index) === 'hero-hidden' ? -1 : 0" :aria-hidden="heroPosition(index) === 'hero-hidden'" type="button" @click="emit('hero', index)">
        <CoverImage :src="banner.picLocalUri || banner.picUrl" :remote-src="banner.picUrl" loading="eager" alt="" /><span class="hero-shade"></span><span class="hero-label">{{ banner.typeTitle || $t('mobile.home.daily') }}</span>
      </button>
      <div class="hero-dots"><button v-for="(banner, index) in store.homeData.banners" :key="`${banner.id}-${index}`" type="button" :class="{ active: index === heroIndex }" :aria-label="$t('mobile.shellUi.carouselItem', { count: index + 1 })" @click="emit('heroSelect', index)"></button></div>
    </div>
    <div v-else class="hero-placeholder"><span class="eyebrow">YOUR MUSIC, YOUR WAY</span><b>{{ $t('mobile.home.discover') }}</b><button class="text-button" type="button" :disabled="store.homeLoading" @click="emit('refresh')">{{ store.homeLoading ? t('mobile.shellUi.loading') : t('mobile.shellUi.refreshRecommendations') }}</button></div>

    <section v-if="store.homeData.playlists.length" class="home-section">
      <div class="home-section-title"><div><h3>{{ $t('home.recommendPlaylist') }}</h3></div><button class="text-button" type="button" @click="emit('navigate', 'library')">{{ $t('mobile.common.more') }}</button></div>
      <div class="horizontal-cards" data-home-shelf="playlists"><OnlinePlaylistCard v-for="item in recommendations" :key="item.id" :playlist="item" :subtitle="item.copywriter || t('mobile.shellUi.songs', { count: item.trackCount ?? 0 })" shelf /></div>
    </section>
    <section v-if="store.homeData.dailyTracks.length" class="home-section">
      <div class="home-section-title"><div><h3>{{ $t('mobile.home.daily') }}</h3></div></div>
      <div class="home-track-strip" data-home-shelf="daily"><div v-for="(track,index) in store.homeData.dailyTracks.slice(0, 8)" :key="track.id" class="home-track-card" :class="{'track-current':index===currentDailyIndex}" :aria-current="index===currentDailyIndex?'true':undefined" role="button" tabindex="0" v-track-menu="preview ? undefined : () => emit('menu', track)" @click="store.play(track)" @keydown.enter.self.prevent="store.play(track)" @keydown.space.self.prevent="store.play(track)"><CoverImage v-if="coverOf(track)" :src="coverOf(track)" :remote-src="track.picUrl" alt="" loading="lazy" /><span v-else class="home-track-fallback"><img class="original-cover-placeholder" :src="originalBrandLogo" alt="" /></span><span><b>{{ track.name }}</b><small>{{ track.artists?.join(' / ') || track.album || t('mobile.shellUi.neteaseMusic') }}</small></span><TrackMenuButton :name="track.name" @open="emit('menu', track)" /></div></div>
    </section>
    <section v-if="store.homeData.artists.length" class="home-section"><div class="home-section-title"><div><h3>{{ $t('mobile.shellUi.recommendedArtists') }}</h3></div></div><div class="horizontal-cards artist-cards" data-home-shelf="artists"><button v-for="item in store.homeData.artists.slice(0, 12)" :key="item.id" class="home-cover-card artist-card" type="button" @click="store.openEntityTracks('artists', item.id, item.name, item.picUrl)"><span class="home-cover artist-cover"><CoverImage v-if="coverOf(item)" :src="coverOf(item)" :remote-src="item.picUrl" alt="" loading="lazy" /><span v-else><img class="original-cover-placeholder" :src="originalBrandLogo" alt="" /></span></span><b>{{ item.name }}</b></button></div></section>
    <section v-if="store.homeData.albums.length" class="home-section"><div class="home-section-title"><div><h3>{{ $t('nav.newAlbum') }}</h3></div></div><div class="horizontal-cards" data-home-shelf="albums"><button v-for="item in store.homeData.albums" :key="item.id" class="home-cover-card" type="button" @click="store.openEntityTracks('albums', item.id, item.name, item.picUrl)"><span class="home-cover"><CoverImage v-if="coverOf(item)" :src="coverOf(item)" :remote-src="item.picUrl" alt="" loading="lazy" /><span v-else><img class="original-cover-placeholder" :src="originalBrandLogo" alt="" /></span></span><b>{{ item.name }}</b><small>{{ item.artists?.map(artist => artist.name).join(' / ') || t('mobile.shellUi.newRelease') }}</small></button></div></section>
    <section v-if="store.homeData.charts.length" class="home-section home-bottom-section"><div class="home-section-title"><div><h3>{{ $t('nav.chart') }}</h3></div></div><div class="horizontal-cards" data-home-shelf="charts"><OnlinePlaylistCard v-for="item in charts" :key="item.id" :playlist="item" :subtitle="item.copywriter || t('mobile.shellUi.neteaseCharts')" shelf /></div></section>
    <div v-if="store.homeLoading" class="home-loading"><i></i><i></i><i></i><span>{{ $t('mobile.home.updating') }}</span></div>
  </section>
</template>
