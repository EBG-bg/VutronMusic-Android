<script setup lang="ts">
import { computed } from 'vue'
import { useAndroidShellStore } from '../stores/androidShell'
import type { VutronPlaylist } from '../platform/vutronPlugin'
import placeholder from '../../../../src/renderer/assets/images/vutronmusic-icon.png'
import CoverImage from './CoverImage.vue'
import OriginalIcon from './OriginalIcon.vue'
import PlaylistMenuButton from './PlaylistMenuButton.vue'

const props = defineProps<{ playlist: VutronPlaylist & { picLocalUri?: string; picUrl?: string }; subtitle: string; shelf?: boolean }>()
const store = useAndroidShellStore()
const cover = computed(() => props.playlist.coverLocalUri || props.playlist.picLocalUri || props.playlist.coverImgUrl || props.playlist.picUrl)
const remoteCover = computed(() => props.playlist.coverImgUrl || props.playlist.picUrl)
</script>

<template>
  <div class="online-playlist-card" :class="{ 'online-playlist-shelf-card': shelf }">
    <button :class="shelf ? 'home-cover-card' : 'playlist-card'" type="button" @click="store.openPlaylist(playlist)">
      <span :class="shelf ? 'home-cover' : 'cover-wrap'">
        <CoverImage v-if="cover" :src="cover" :remote-src="remoteCover" alt="" />
        <span v-else :class="{ 'cover-fallback': !shelf }"><img class="original-cover-placeholder" :src="placeholder" alt="" /></span>
        <span v-if="!shelf" class="cover-play"><OriginalIcon name="play" /></span>
      </span>
      <template v-if="shelf"><b>{{ playlist.name }}</b><small>{{ subtitle }}</small></template>
      <span v-else class="playlist-copy"><b>{{ playlist.name }}</b><small>{{ subtitle }}</small></span>
    </button>
    <PlaylistMenuButton :playlist="playlist" placement="card" />
  </div>
</template>

<style scoped>
.online-playlist-card { position:relative; min-width:0; }
.online-playlist-card > button:not(.playlist-menu-button) { width:100%; }
.online-playlist-shelf-card { flex:0 0 126px; scroll-snap-align:start; }
@media (min-width:600px) { .online-playlist-shelf-card { flex-basis:145px; } }
</style>
