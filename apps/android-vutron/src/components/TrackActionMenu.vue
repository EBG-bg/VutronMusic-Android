<script setup lang="ts">
import ThumbRange from './ThumbRange.vue'
import { translate as t } from '../platform/i18n'
import { computed, onMounted, onUnmounted, ref, watch } from 'vue'
import { useLibraryManagement } from '../composables/libraryManagement'
import { onlineTrackId } from '../stores/domains/neteaseLibrary'
import { useAndroidShellStore } from '../stores/androidShell'
import { vutronPlugin, type VutronTrack } from '../platform/vutronPlugin'
import { createLiveSettingWriter } from '../platform/liveSettingWrites'
import OriginalIcon from './OriginalIcon.vue'
import CollapsibleSettingsCard from './CollapsibleSettingsCard.vue'
import { useModalFocus } from '../composables/modalFocus'
import { actionDialog } from '../platform/actionDialog'
import { useSheetDrag } from '../composables/sheetDrag'
import SheetDragHandle from './SheetDragHandle.vue'
import PluginTrackActions from './PluginTrackActions.vue'
import type { PluginItem, PluginPlayback } from '../plugins/protocol'

const props = defineProps<{ track: VutronTrack; suspended?: boolean }>()
const emit = defineEmits<{ close: []; comments: [track: VutronTrack] }>()
const store = useAndroidShellStore()
const pluginActions=ref<{handleBack():boolean}>(),pluginModal=ref(false)
const pluginItem=computed(()=>props.track.pluginTrack as PluginItem|undefined)
const pluginScope=computed(()=>props.track.pluginAccountScope)
const management = useLibraryManagement()
const cacheTrackId = computed(() => props.track.neteaseId || (!props.track.localUri && !props.track.localPath || props.track.cached ? props.track.id : 0))
const hasCache = computed(() => cacheTrackId.value > 0 && store.cachedTracks.some(item => item.id === cacheTrackId.value))
const isLocal = computed(() => Boolean(props.track.localFolderId || props.track.localPlaylistId))
const canUseOnline = computed(() => store.onlineAvailable && onlineTrackId(props.track) > 0)
async function toggleLike() { await store.toggleTrackLike(props.track) }
function addToPlaylist() { store.openAddToOnlinePlaylist(props.track); close() }
async function removeFromOnlinePlaylist() { if (await store.removeTrackFromOnlinePlaylist(props.track)) close() }
async function deleteCache() { if (await management.deleteCachedTrack(props.track)) close() }
async function removeLocal() { if (await management.removeLocalTrack(props.track)) close() }
const dialog = ref<HTMLElement>()
const busy = ref(false)
const volume = ref<number | string>(100)
const notice = ref('')
let volumeRead = 0
let volumeEdit = 0
let mounted = true
function volumeIdentity(track: VutronTrack) {
  const savedKey = track.trackVolumeKey?.trim()
  if (savedKey) return 'volume:' + savedKey
  const uri = track.localUri?.trim() || track.localPath?.trim()
  const id = track.neteaseId ?? track.id
  if (id > 0 && (!uri || (track.neteaseId ?? 0) > 0)) return 'volume:track:id:' + id
  return 'volume:local-uri:' + uri + (track.cueTrackNo ? ':' + track.cueOffsetMs + ':' + track.cueTrackNo : '')
}
type VolumeLane = { writer: ReturnType<typeof createLiveSettingWriter<number>>; lastValue?: number }
const volumeLanes = new Map<string, VolumeLane>()

function volumeLane() {
  const key = volumeIdentity(props.track)
  let lane = volumeLanes.get(key)
  if (!lane) {
    // Capture the candidate, not whichever track is playing when a write finishes.
    const track = { ...props.track, artists: props.track.artists?.slice() }
    lane = { writer: createLiveSettingWriter<number>({
      async write(percent) {
        await vutronPlugin.setTrackVolume({ track, percent })
        if (mounted && volumeIdentity(props.track) === key && Number(volume.value) === percent) notice.value = t('mobile.trackActions.volumeSaved', { percent })
      },
      onError(error) { if (mounted && volumeIdentity(props.track) === key) notice.value = error instanceof Error ? error.message : t('mobile.runtimeText.trackVolumeSaveFailed') }
    }) }
    volumeLanes.set(key, lane)
  }
  return lane
}

function handleBack(){return pluginActions.value?.handleBack()||false}
defineExpose({handleBack})
function close() { if(!handleBack())emit('close') }
useModalFocus(dialog, { close, enabled: () => !props.suspended && !actionDialog.value && !pluginModal.value, restore: false })
useSheetDrag(dialog, { close, enabled: () => !props.suspended && !actionDialog.value && !pluginModal.value })
async function playPlugin(value:PluginPlayback){
  if(busy.value)return
  busy.value=true
  try{await store.playPlugin(value);if(store.error){notice.value=store.error;return}close()}
  catch(cause){notice.value=cause instanceof Error?cause.message:'Plugin playback failed'}
  finally{busy.value=false}
}

async function action(kind: 'next' | 'append' | 'play') {
  if (busy.value) return
  busy.value = true
  const track = props.track
  try {
    if (kind === 'next') { if (!await store.queueTrackNext(track)) { notice.value = store.error; return } }
    else if (kind === 'append') { if (!await store.appendTrackToQueue(track)) { notice.value = store.error; return } }
    else if (kind === 'play') { await store.play(track, track.playlistVolumeKey, [track]); if (store.error) { notice.value = store.error; return } }
    close()
  } catch (error) { notice.value = error instanceof Error ? error.message : t('mobile.trackActions.actionFailed') }
  finally { busy.value = false }
}

async function showVolume() {
  const request = ++volumeRead
  const revision = volumeEdit
  const track = { ...props.track }
  const key = volumeIdentity(track)
  try {
    const settings = await vutronPlugin.getVolumeSettings({ track })
    if (mounted && request === volumeRead && revision === volumeEdit && volumeIdentity(props.track) === key) {
      const draft = volumeLanes.get(key)?.lastValue
      volume.value = draft ?? settings.trackPercent
    }
  } catch (error) { if (mounted && request === volumeRead && revision === volumeEdit) notice.value = error instanceof Error ? error.message : t('mobile.trackActions.volumeReadFailed') }
}
function volumeToggle(event: Event) {
  if ((event.target as HTMLDetailsElement).open) void showVolume()
}
function queueVolume(reportInvalid = false) {
  const percent = Number(volume.value)
  if (String(volume.value).trim() === '' || !Number.isInteger(percent) || percent < 0 || percent > 100) { if (reportInvalid) notice.value = t('mobile.trackActions.volumeInvalid'); return }
  const lane = volumeLane()
  if (lane.lastValue !== percent) { lane.lastValue = percent; void lane.writer.queue(percent) }
  return lane
}
function volumeInput(event: Event) {
  volumeEdit++
  notice.value = ''
  volume.value = (event.target as HTMLInputElement).value
  queueVolume()
}
async function saveVolume() { await queueVolume(true)?.writer.flush() }
watch(() => props.track, () => { volumeRead++; volumeEdit++; notice.value = ''; volume.value = volumeLanes.get(volumeIdentity(props.track))?.lastValue ?? 100 })
onMounted(() => { if (canUseOnline.value) void store.loadLikedTracks() })
onUnmounted(() => { mounted = false; volumeRead++; for (const lane of volumeLanes.values()) void lane.writer.flush() })
</script>

<template>
    <div class="track-action-layer" :inert="suspended || Boolean(actionDialog)" @click.self="close">
      <section ref="dialog" class="track-action-menu" role="dialog" aria-modal="true" :aria-label="$t('mobile.trackActions.title')">
        <SheetDragHandle @close="close" />
        <header data-sheet-drag-handle><div><h2>{{ track.name }}</h2><p>{{ track.artists?.join(' / ') || track.album || $t('mobile.trackActions.title') }}</p></div><button class="icon-button" type="button" :aria-label="$t('mobile.trackActions.close')" @click="close"><OriginalIcon name="close" /></button></header>
        <div class="track-action-options">
          <PluginTrackActions v-if="pluginItem&&track.pluginId" ref="pluginActions" :track="pluginItem" :plugin-id="track.pluginId" :account-scope="pluginScope" :local-only="store.manualLocalOnly||!store.networkConnected" :disabled="busy" @modal="pluginModal=$event" @play="playPlugin" />
          <button v-if="canUseOnline" type="button" :disabled="busy" @click="emit('comments', track); close()"><OriginalIcon name="list" /><span>{{ $t('mobile.comments.title') }}</span></button>
          <button v-if="canUseOnline" type="button" :disabled="busy || store.onlineMutationBusy || store.onlineNeedsRefresh || !store.likedLoaded" @click="toggleLike"><OriginalIcon :name="store.isTrackLiked(track) ? 'heartSolid' : 'heart'" /><span>{{ store.likedLoaded ? $t(store.isTrackLiked(track) ? 'mobile.netease.unlike' : 'mobile.netease.like') : $t('mobile.netease.likeLoading') }}</span></button>
          <button v-if="canUseOnline" type="button" :disabled="busy || store.onlineMutationBusy || store.onlineNeedsRefresh" @click="addToPlaylist"><OriginalIcon name="plus" /><span>{{ $t('mobile.netease.addTo') }}</span></button>
          <button v-if="store.removableOnlinePlaylist(track)" type="button" :disabled="busy || store.onlineMutationBusy || store.onlineNeedsRefresh" @click="removeFromOnlinePlaylist"><OriginalIcon name="close" /><span>{{ $t('mobile.netease.remove') }}</span></button>
          <button v-if="canUseOnline && (!store.likedLoaded || store.onlineNeedsRefresh)" type="button" :disabled="store.onlineMutationBusy || store.likesLoading" @click="store.onlineNeedsRefresh ? store.refreshOnlineLibrary() : store.loadLikedTracks(true)"><OriginalIcon name="refresh" /><span>{{ $t('mobile.netease.refresh') }}</span></button>
          <button v-if="isLocal" type="button" :disabled="busy" @click="removeLocal"><OriginalIcon name="close" /><span>{{ $t('mobile.management.removeTrack') }}<small>{{ $t('mobile.management.originalRetained') }}</small></span></button>
          <button v-if="hasCache" type="button" :disabled="busy" @click="deleteCache"><OriginalIcon name="close" /><span>{{ $t('mobile.management.deleteCache') }}<small>{{ $t('mobile.management.cacheRetained') }}</small></span></button>
          <button type="button" :disabled="busy" @click="action('next')"><OriginalIcon name="next" /><span>{{ $t('mobile.trackActions.next') }}<small>{{ $t('mobile.trackActions.nextHint') }}</small></span></button>
          <button type="button" :disabled="busy" @click="action('append')"><OriginalIcon name="list" /><span>{{ $t('mobile.trackActions.append') }}<small>{{ $t('mobile.trackActions.appendHint') }}</small></span></button>
          <button type="button" :disabled="busy" @click="action('play')"><OriginalIcon name="play" /><span>{{ $t('mobile.trackActions.play') }}</span></button>
        </div>
        <p v-if="track.cueTrackNo" class="track-action-notice">{{ $t('mobile.advancedPlayback.cue', { count: track.cueTrackNo, name: track.cueAlbum }) }}</p>
        <p v-if="track.cueWarning" class="track-action-notice">{{ track.cueWarning }}</p>
        <CollapsibleSettingsCard :key="track.id + ':' + (track.localUri ?? '')" class="track-menu-volume-card" section-id="track-menu-volume" :title="$t('mobile.trackActions.volume')" :subtitle="$t('mobile.trackActions.volumeFor', { name: track.name })" :remember="false" @toggle="volumeToggle">
          <form class="track-action-volume" @submit.prevent="saveVolume"><label>{{ $t('mobile.trackActions.volumeLabel') }}<ThumbRange :value="volume" min="0" max="100" step="1" :aria-label="$t('mobile.trackActions.volumeSlider')" @input="volumeInput" @change="saveVolume" /></label><div><input :value="volume" type="number" min="0" max="100" step="1" inputmode="numeric" :aria-label="$t('mobile.trackActions.volumePercent')" @input="volumeInput" @change="saveVolume" /><span>%</span><button class="secondary-button" type="submit">{{ $t('mobile.netease.save') }}</button></div></form>
        </CollapsibleSettingsCard>
        <Transition name="track-feedback" mode="out-in"><p v-if="notice" :key="notice" class="track-action-notice" role="status">{{ notice }}</p></Transition>
      </section>
    </div>
</template>

<style scoped>
.track-action-layer { position: fixed; inset: 0; z-index: 120; display: flex; align-items: flex-end; justify-content: center; background: rgb(0 0 0 / 38%); }
.track-action-menu { width: min(100%, 640px); max-height: 88dvh; overflow-y: auto; overscroll-behavior: contain; padding: 18px 16px max(16px, env(safe-area-inset-bottom)); border-radius: 18px 18px 0 0; color: var(--color-text); background: var(--color-body-bg); box-shadow: 0 -8px 36px rgb(0 0 0 / 18%); }
header { display: flex; align-items: center; gap: 12px; padding: 0 2px 12px; border-bottom: 1px solid var(--line); }
header > div { min-width: 0; flex: 1; }
h2 { margin: 0; font-size: calc(17px * var(--ui-font-scale, 1)); line-height: 1.4; overflow-wrap: anywhere; }
header p { margin: 5px 0 0; color: var(--muted); font-size: calc(12px * var(--ui-font-scale, 1)); overflow-wrap: anywhere; }
.track-action-options { display: grid; gap: 5px; margin-top: 9px; }
.track-action-options > button { display: flex; align-items: center; gap: 14px; min-height: 52px; width: 100%; padding: 10px 12px; border: 0; border-radius: 10px; text-align: left; color: inherit; background: transparent; font: inherit; font-size: calc(14px * var(--ui-font-scale, 1)); transition: background-color 125ms ease-out, color 125ms ease-out, opacity 125ms ease-out, transform .2s ease; }
.track-action-options > button:disabled { opacity: .45; }
.track-action-options > button:is([data-original-feedback], :focus-visible) { background-color: var(--accent-soft); }
@media (hover: hover) and (pointer: fine) { .track-action-options > button:hover { background-color: var(--accent-soft); } }
.track-action-options .original-icon { font-size: 20px; }
.track-action-options span { min-width: 0; overflow-wrap: anywhere; }
.track-action-options small { display: block; margin-top: 4px; color: var(--muted); font-size: calc(11px * var(--ui-font-scale, 1)); }
.track-menu-volume-card { margin-top: 8px; padding: 10px 12px; box-shadow: none; background: var(--color-secondary-bg); }
.track-action-volume { padding: 0; font-size: calc(13px * var(--ui-font-scale, 1)); }
.track-action-volume label { display: block; width: 100%; }
.track-action-volume .thumb-range { margin-top: 4px; }
.track-action-volume > div { display: flex; align-items: center; gap: 7px; margin-top: 10px; }
.track-action-volume input[type=number] { min-width: 0; width: 72px; }
.track-action-notice { margin: 10px 4px 0; color: var(--muted); font-size: calc(12px * var(--ui-font-scale, 1)); }
.track-feedback-enter-active, .track-feedback-leave-active { transition: opacity 125ms ease-out, transform 125ms ease-out; }
.track-feedback-enter-from, .track-feedback-leave-to { opacity: 0; transform: translateY(5px); }
html[data-motion="reduced"] .track-action-options > button, html[data-motion="reduced"] .track-feedback-enter-active, html[data-motion="reduced"] .track-feedback-leave-active { transition: none; }
</style>

<style>
.track-menu-enter-active { transition: opacity var(--motion-panel, 320ms) ease-out; }
.track-menu-leave-active { transition: opacity var(--motion-panel-exit, 240ms) ease-in; }
.track-menu-enter-active .track-action-menu { transition: transform var(--motion-panel, 320ms) cubic-bezier(.2,.75,.25,1); }
.track-menu-leave-active .track-action-menu { transition: transform var(--motion-panel-exit, 240ms) ease-in-out; }
.track-menu-enter-active .comments-sheet { transition: transform var(--motion-panel, 320ms) cubic-bezier(.2,.75,.25,1); }
.track-menu-leave-active .comments-sheet { transition: transform var(--motion-panel-exit, 240ms) ease-in-out; }
.track-menu-enter-from, .track-menu-leave-to { opacity: 0; }
.track-menu-enter-from .track-action-menu, .track-menu-leave-to .track-action-menu { transform: translateY(28px); }
.track-menu-enter-from .comments-sheet, .track-menu-leave-to .comments-sheet { transform: translateY(28px); }
html[data-motion="reduced"] .track-menu-enter-active, html[data-motion="reduced"] .track-menu-leave-active, html[data-motion="reduced"] .track-menu-enter-active .track-action-menu, html[data-motion="reduced"] .track-menu-leave-active .track-action-menu { transition: none; }
</style>
