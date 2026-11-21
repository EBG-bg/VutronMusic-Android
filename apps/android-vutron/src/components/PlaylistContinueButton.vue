<script setup lang="ts">
import { computed, inject, onUnmounted, ref, watch } from 'vue'
import { vutronPlugin, type VutronPlaylistProgress, type VutronTrack } from '../platform/vutronPlugin'
import { useAndroidShellStore } from '../stores/androidShell'
import { formatTime } from '../utils/formatting'
import OriginalIcon from './OriginalIcon.vue'
import { navigationPreviewKey } from '../composables/navigationPreview'
import { appNavigation } from '../composables/navigationGuard'

const preview = inject(navigationPreviewKey, false)
const props = defineProps<{ tracks: VutronTrack[]; scope: string; playlistKey: string }>()
const store = useAndroidShellStore()
const saved = ref<VutronPlaylistProgress>()
const busy = ref(false)
let generation = 0
onUnmounted(() => { generation++ })
if (!preview) watch([() => props.scope, () => props.playlistKey], async ([scope, playlistKey]) => {
  const token = ++generation
  saved.value = undefined
  if (!vutronPlugin.getPlaylistProgress) return
  try {
    const result = await vutronPlugin.getPlaylistProgress({ scope, playlistKey })
    if (token === generation) saved.value = result
  } catch (failure) { console.warn('Could not read playlist progress', failure) }
}, { immediate: true })
const current = computed(() => store.playback.track?.playlistOrderScope === props.scope
  && store.playback.track?.playlistVolumeKey === props.playlistKey ? store.playback : undefined)
const bookmark = computed(() => current.value ? {
  trackId: current.value.track?.neteaseId || current.value.trackId,
  cueTrackNo: current.value.track?.cueTrackNo || 0, position: current.value.position,
  localEntryKey: current.value.track?.source === 'plugin-snapshot' ? current.value.track.localEntryKey : undefined
} : saved.value)
const track = computed(() => {
  const point = bookmark.value
  if (!point?.trackId) return
  const matches = (row: VutronTrack) => !row.missingLocal && (!store.localOnly || !row.onlineOnly)
    && (row.neteaseId || row.id) === point.trackId && (row.cueTrackNo || 0) === (point.cueTrackNo || 0)
  if (!point.localEntryKey) return props.tracks.find(matches)
  // A refreshed offline snapshot can move a track. Continue by recording only
  // if a single playable occurrence remains, never by an unrelated row index.
  let fallback: VutronTrack | undefined, duplicate = false
  for (const row of props.tracks) {
    if (row.source !== 'plugin-snapshot' || !matches(row)) continue
    if (row.localEntryKey === point.localEntryKey) return row
    if (fallback) duplicate = true
    else fallback = row
  }
  return duplicate ? undefined : fallback
})
async function resume() {
  if (!track.value || busy.value) return
  if (appNavigation.intercept(() => { void resume() })) return
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
