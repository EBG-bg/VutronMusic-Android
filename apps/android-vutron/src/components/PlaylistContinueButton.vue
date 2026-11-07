<script setup lang="ts">
import { computed, onUnmounted, ref, watch } from 'vue'
import { vutronPlugin, type VutronTrack } from '../platform/vutronPlugin'
import { useAndroidShellStore } from '../stores/androidShell'
import { formatTime } from '../utils/formatting'
import OriginalIcon from './OriginalIcon.vue'

const props = defineProps<{ tracks: VutronTrack[]; scope: string; playlistKey: string }>()
const store = useAndroidShellStore()
const saved = ref<{ trackId?: number; position?: number; cueTrackNo?: number }>()
const busy = ref(false)
let generation = 0
onUnmounted(() => { generation++ })
watch(() => [props.scope, props.playlistKey, props.tracks] as const, async () => {
  const token = ++generation
  saved.value = undefined
  if (!vutronPlugin.getPlaylistProgress) return
  try {
    const result = await vutronPlugin.getPlaylistProgress({ scope: props.scope, playlistKey: props.playlistKey })
    if (token === generation) saved.value = result
  } catch (failure) { console.warn('Could not read playlist progress', failure) }
}, { immediate: true })
const current = computed(() => store.playback.track?.playlistOrderScope === props.scope
  && store.playback.track?.playlistVolumeKey === props.playlistKey ? store.playback : undefined)
const bookmark = computed(() => current.value ? {
  trackId: current.value.track?.neteaseId || current.value.trackId,
  cueTrackNo: current.value.track?.cueTrackNo || 0, position: current.value.position
} : saved.value)
const track = computed(() => props.tracks.find(row => !row.missingLocal && (!store.localOnly || !row.onlineOnly)
  && (row.neteaseId || row.id) === bookmark.value?.trackId && (row.cueTrackNo || 0) === (bookmark.value?.cueTrackNo || 0)))
async function resume() {
  if (!track.value || busy.value) return
  busy.value = true
  try {
    if (current.value) { store.navigateTo('player'); if (!current.value.playing) await store.resume() }
    else await store.play(track.value, props.playlistKey, props.tracks, Math.max(0, bookmark.value?.position || 0))
  } finally { busy.value = false }
}
</script>
<template>
  <button v-if="track" type="button" class="playlist-continue-button secondary-button" :disabled="busy" @click="resume">
    <OriginalIcon name="play" /><span><b>{{ $t('mobile.playbackReview.continue') }}</b><small>{{ $t('mobile.playbackReview.continueHint', { name: track.name, time: formatTime(bookmark?.position || 0) }) }}</small></span>
  </button>
</template>
<style scoped>
.playlist-continue-button { display:flex; align-items:center; gap:10px; max-width:100%; min-height:44px; margin:8px 0 14px; text-align:left; }
.playlist-continue-button span { min-width:0; }.playlist-continue-button b,.playlist-continue-button small { display:block; overflow-wrap:anywhere; }
.playlist-continue-button small { font-size:calc(11px * var(--ui-font-scale,1)); color:var(--muted); margin-top:3px; }
</style>
