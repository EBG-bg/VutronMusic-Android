<script setup lang="ts">
import { computed, inject, defineAsyncComponent, onBeforeUnmount, onMounted, ref, watch } from 'vue'
import { useI18n } from 'vue-i18n'
import type { VutronTrack } from '../platform/vutronPlugin'
import { isCurrentTrack } from '../platform/currentTrack'
import { trackKey as localTrackKey, moveTrackKey, useCollectionTrackOrder, type CollectionOrder } from '../composables/localTrackOrdering'
import { useTrackSearch } from '../composables/libraryPresentation'
import { useTrackSelection, type TrackBatchAction } from '../composables/trackSelection'
import TrackSelectionBar from './TrackSelectionBar.vue'
import WindowedTrackList from './WindowedTrackList.vue'
import { vRangeSelect } from '../composables/rangeSelect'
import { vTrackMenu } from '../composables/trackActionMenu'
import TrackMenuButton from './TrackMenuButton.vue'
import OriginalIcon from './OriginalIcon.vue'
import AppSelect from './AppSelect.vue'
import PlaylistContinueButton from './PlaylistContinueButton.vue'
import { navigationPreviewKey } from '../composables/navigationPreview'
import { appNavigation, useNavigationDraft } from '../composables/navigationGuard'
import { playlistLoadingText } from '../platform/playlistLoadingMessages'

const CollectionOrderHistorySheet = defineAsyncComponent(() => import('./CollectionOrderHistorySheet.vue'))

const preview = inject(navigationPreviewKey, false)
const props = withDefaults(defineProps<{ tracks: VutronTrack[]; collectionKey: string; orderKey?: string; originalOrderLabel?: string; continueScope?: string; query?: string; loading?: boolean; incomplete?: boolean; loadError?: string; localOnly?: boolean; cachedOnly?: boolean; syncOrder?: (tracks: VutronTrack[]) => Promise<boolean>; currentTrack?: VutronTrack; batchActions?: TrackBatchAction[]; runBatch?: (action: string, tracks: VutronTrack[]) => Promise<boolean> }>(), { query: '', continueScope: 'local:device' })
const emit = defineEmits<{ play: [track: VutronTrack, queue: VutronTrack[]]; menu: [track: VutronTrack]; orderChange: [keys: string[]]; retry: [] }>()
const { t } = useI18n()
const source = computed(() => props.tracks)
const storageKey = computed(() => props.orderKey || props.collectionKey)
const trackKey = (track: VutronTrack) => props.cachedOnly && track.localEntryKey ? `${track.localEntryKey}:${track.id}` : props.orderKey?.startsWith('netease:') ? 'netease:' + (track.neteaseId || track.id) : localTrackKey(track)
const { mode, ordered, commit, selectView, dirty, sequenceDirty, prepareDraftSave, saveDraft, discardDraft, history, historyLimit, recentCustomId, activeHistoryId, ensureLegacy, loadHistory, setHistoryLimit, renameHistory, pinHistory, removeHistory, historyError: storedHistoryError } = useCollectionTrackOrder(source, storageKey, trackKey)
const sortModes = ['original', 'title', 'artist', 'album', 'custom'] as const
const sortLabels = { original: 'mobile.library.originalOrder', title: 'mobile.library.title', artist: 'nav.artist', album: 'nav.album', custom: 'mobile.ordering.custom' }
const normalizedQuery = computed(() => props.query.trim().toLowerCase())
const incomplete = computed(() => Boolean(props.incomplete || props.loading && props.orderKey?.startsWith('netease:')))
const orderLoading = computed(() => Boolean(props.loading || props.incomplete))
const displayOrder = computed(() => incomplete.value ? source.value : ordered.value)
const filtered = useTrackSearch(displayOrder, normalizedQuery)
const listStateKey = computed(()=>JSON.stringify(['native-tracks',storageKey.value,normalizedQuery.value,mode.value]))
const cachedUnavailable = (track: VutronTrack) => Boolean(props.cachedOnly && !track.cached)
const selectable = computed(() => props.cachedOnly ? filtered.value.filter(track => !cachedUnavailable(track)) : filtered.value)
const selection = useTrackSelection(selectable, trackKey, storageKey)
const { active: selecting, keys: selectedKeys, busy: batchBusy, selected, selectedCount, allSelected } = selection
const windowed = ref<{ scrollToIndex(index: number, options?: { align?: 'center' }): Promise<void> }>()
const currentIndex = computed(() => {
  const current = props.currentTrack
  if (props.cachedOnly && current?.localEntryKey && current.playlistVolumeKey === props.collectionKey)
    return filtered.value.findIndex(row => row.localEntryKey === current.localEntryKey)
  return filtered.value.findIndex(row => isCurrentTrack(row, current, props.continueScope))
})
function locateCurrent() { if (currentIndex.value >= 0) void windowed.value?.scrollToIndex(currentIndex.value, { align: 'center' }) }
const message = ref('')
const historyOpen = ref(false), historyMounted = ref(false), historyError = ref(''), historyTrigger = ref<HTMLElement>()
const historySurface = ref<{ handleBack(): boolean }>()
const historyItems = computed(() => source.value.map(track => ({ key: trackKey(track), name: track.name, artists: track.artists, album: track.album })))
const list = ref<HTMLElement>()
const drag = ref<{ key: string; pointer: number; x: number; y: number; startX: number; startY: number; active: boolean; anchor: string; after: boolean; label: string }>()
let animation = 0
const canDrag = computed(() => mode.value === 'custom' && !selecting.value && !normalizedQuery.value && !orderLoading.value && !syncBusy.value)
const playable = computed(() => incomplete.value ? [] : ordered.value.filter(row => !cachedUnavailable(row) && !row.missingLocal && (!props.localOnly || !row.onlineOnly)))
const missingCount = computed(() => displayOrder.value.filter(row => row.missingLocal).length)
const syncBusy = ref(false)
const orderSignature = computed(() => JSON.stringify(ordered.value.map(trackKey)))
const syncDirty = computed(() => !orderLoading.value && dirty.value)
let syncTask: Promise<boolean> | undefined
function syncBeforeLeave(): Promise<boolean> {
  if (syncTask) return syncTask
  if (!syncDirty.value) return Promise.resolve(true)
  const key = storageKey.value, tracks = ordered.value.slice(), sequenceChanged = sequenceDirty.value && orderSignature.value !== JSON.stringify(source.value.map(trackKey))
  syncBusy.value = true
  syncTask = Promise.resolve().then(async () => {
    let historySaved = false
    try {
      prepareDraftSave()
      historySaved = true
      const success = !props.syncOrder || !sequenceChanged || await props.syncOrder(tracks)
      if (success && storageKey.value === key) { if(saveDraft()) reportOrder(); message.value = t('mobile.ordering.saved') }
      if (!success && storageKey.value === key) message.value = t('mobile.ordering.syncFailed')
      return success
    } catch (cause) {
      if (!historySaved) console.warn('Playlist order history could not be saved before synchronization', cause)
      if (storageKey.value === key) message.value = !historySaved ? t('mobile.orderHistory.saveBeforeSyncFailed') : cause instanceof Error ? cause.message : t('mobile.ordering.syncFailed')
      return false
    } finally { syncBusy.value = false; syncTask = undefined }
  })
  return syncTask
}
if (!preview) useNavigationDraft({
  dirty: () => syncDirty.value,
  save: syncBeforeLeave,
  discard: discardOrder,
  question: () => ({ title: t('mobile.orderDraft.title'), message: t('mobile.orderDraft.message'), confirmLabel: t('mobile.orderDraft.save'), secondaryLabel: t('mobile.orderDraft.discard'), cancelLabel: t('mobile.ordering.continueEditing') }),
  cancelInteraction: () => {
    if (historyOpen.value) { if (!historySurface.value?.handleBack()) historyOpen.value = false; return true }
    if (selecting.value) { selection.close(); return true }
    if (!drag.value) return false
    cancelDrag(); return true
  }
})
function discardOrder() { cancelDrag(); discardDraft(); message.value = '' }
function openHistory(event: MouseEvent) {
  if (syncBusy.value || orderLoading.value) return
  cancelDrag(); historyError.value = ''
  try { ensureLegacy() }
  catch (cause) { console.warn('Playlist order history could not be read', cause); historyError.value = t('mobile.orderHistory.saveFailed') }
  historyTrigger.value = event.currentTarget as HTMLElement
  historyMounted.value = true; historyOpen.value = true
}
function updateHistory(action: () => boolean | void) {
  if (syncBusy.value || orderLoading.value) return false
  historyError.value = ''
  try {
    if (action() === false) { historyError.value = t('mobile.orderHistory.unavailable'); return false }
    return true
  } catch (cause) { console.warn('Playlist order history could not be updated', cause); historyError.value = t('mobile.orderHistory.saveFailed'); return false }
}
function loadHistoryOrder(id: string) {
  cancelDrag()
  if (!updateHistory(() => loadHistory(id))) return
  historyOpen.value = false; message.value = dirty.value ? t('mobile.orderDraft.changed') : ''
}
function reportOrder() { emit('orderChange', ordered.value.map(trackKey)) }
function changeMode(value: CollectionOrder) {
  if (syncBusy.value || incomplete.value) return
  cancelDrag()
  const key = storageKey.value
  const apply = () => {
    if (key !== storageKey.value) return
    try { if (selectView(value)) message.value = '' }
    catch { message.value = t('mobile.ordering.saveFailed') }
  }
  if (value === 'original' && dirty.value) appNavigation.run(apply)
  else apply()
}
function restoreOrder() {
  changeMode('original')
}
function startDrag(event: PointerEvent, track: VutronTrack) {
  if (!canDrag.value || event.button !== 0 || !event.isPrimary) return
  list.value?.setPointerCapture(event.pointerId)
  drag.value = { key: trackKey(track), pointer: event.pointerId, x: event.clientX, y: event.clientY,
    startX: event.clientX, startY: event.clientY, active: false, anchor: '', after: false, label: track.name }
}
function findAnchor() {
  const state = drag.value
  if (!state?.active) return
  const row = document.elementFromPoint(state.x, state.y)?.closest<HTMLElement>('[data-local-track-key]')
  if (!row || !list.value?.contains(row) || row.dataset.localTrackKey === state.key) return
  state.anchor = row.dataset.localTrackKey || ''
  const bounds = row.getBoundingClientRect(); state.after = state.y > bounds.top + bounds.height / 2
}
function autoscroll() {
  const state = drag.value
  if (!state?.active) return
  const top = 90, bottom = window.innerHeight - 150
  const speed = state.y < top ? -Math.min(20, (top - state.y) / 3) : state.y > bottom ? Math.min(20, (state.y - bottom) / 3) : 0
  if (speed) { window.scrollBy({ top: speed, behavior: 'instant' }); findAnchor() }
  animation = requestAnimationFrame(autoscroll)
}
function moveDrag(event: PointerEvent) {
  const state = drag.value
  if (!state || state.pointer !== event.pointerId) return
  state.x = event.clientX; state.y = event.clientY
  if (!state.active && Math.hypot(state.x - state.startX, state.y - state.startY) > 6) { state.active = true; animation = requestAnimationFrame(autoscroll) }
  findAnchor()
}
function finishDrag(event: PointerEvent) {
  const state = drag.value
  if (!state || state.pointer !== event.pointerId) return
  if (state.active && state.anchor) {
    try { commit(moveTrackKey(ordered.value.map(trackKey), state.key, state.anchor, state.after)); message.value = '' }
    catch { message.value = t('mobile.ordering.saveFailed') }
  }
  cancelDrag()
}
function cancelDrag() { cancelAnimationFrame(animation); drag.value = undefined }
function keyboard(event: KeyboardEvent) { if (event.key === 'Escape' && drag.value) { event.preventDefault(); event.stopImmediatePropagation(); cancelDrag() } }
function moveKeyboard(event: KeyboardEvent, track: VutronTrack) {
  if (!canDrag.value || !['ArrowUp', 'ArrowDown'].includes(event.key)) return
  event.preventDefault(); event.stopPropagation()
  const keys = ordered.value.map(trackKey), key = trackKey(track), index = keys.indexOf(key)
  const other = keys[index + (event.key === 'ArrowUp' ? -1 : 1)]
  if (!other) return
  try { commit(moveTrackKey(keys, key, other, event.key === 'ArrowDown')); message.value = '' }
  catch { message.value = t('mobile.ordering.saveFailed') }
}
function play(track: VutronTrack) {
  if (incomplete.value) { message.value = playlistLoadingText('wait'); return }
  if (cachedUnavailable(track)) return
  if (selecting.value) { selection.toggle(track); return }
  if (drag.value?.active) return
  if (track.missingLocal) { message.value = t('mobile.backup.missingHint'); return }
  if (props.localOnly && track.onlineOnly) { message.value = t('mobile.ordering.requiresOnline'); return }
  appNavigation.run(() => emit('play', track, playable.value))
}
watch(storageKey, () => { cancelDrag(); historyOpen.value = false; historyError.value = '' })
watch(source, cancelDrag)
onMounted(() => { if (!preview) document.addEventListener('keydown', keyboard, true) })
onBeforeUnmount(() => { cancelDrag(); document.removeEventListener('keydown', keyboard, true) })
</script>

<template>
  <div class="local-track-section">
    <PlaylistContinueButton v-if="!incomplete" :tracks="playable" :playlist-key="collectionKey" :scope="continueScope" />
    <div class="local-order-tools">
      <button class="text-button" type="button" :disabled="!playable.length || loading || selecting" @click="playable[0] && play(playable[0])"><OriginalIcon name="play" />{{ $t('mobile.ordering.playAll', { count: playable.length }) }}</button>
      <button v-if="currentIndex >= 0" class="text-button locate-current" type="button" @click="locateCurrent"><OriginalIcon name="locate" />{{ $t('mobile.player.locateCurrent') }}</button>
      <button v-if="batchActions?.length && (!cachedOnly || selectable.length > 0) && !selecting" type="button" class="text-button" :disabled="orderLoading || syncBusy" @click="cancelDrag(); selecting = true">{{ $t('mobile.batch.select') }}</button>
      <div class="local-order-select"><span>{{ $t('mobile.library.sort') }}</span><AppSelect :model-value="mode" :disabled="syncBusy || incomplete" :label="$t('mobile.library.sortLabel')" :options="sortModes.map(value => ({ value, label: value === 'original' && originalOrderLabel ? originalOrderLabel : $t(sortLabels[value]) }))" @update:model-value="changeMode" /><button class="icon-button local-history-button" type="button" :disabled="syncBusy || incomplete" :aria-label="$t('mobile.orderHistory.title')" :title="$t('mobile.orderHistory.title')" aria-haspopup="dialog" :aria-expanded="historyOpen" @click="openHistory"><OriginalIcon name="refresh" /></button></div>
    </div>
    <div v-if="mode === 'custom'" class="local-order-hint"><span v-if="query">{{ $t('mobile.ordering.clearFilter') }}</span><button class="text-button" type="button" :disabled="syncBusy || incomplete" @click="restoreOrder">{{ originalOrderLabel ? $t('mobile.orderHistory.restoreSource', { label: originalOrderLabel }) : $t('mobile.ordering.restore') }}</button></div>
    <div v-if="syncDirty" class="order-draft-actions"><span>{{ $t('mobile.orderDraft.changed') }}</span><button type="button" class="text-button" :disabled="syncBusy" @click="discardOrder">{{ $t('mobile.orderDraft.discard') }}</button><button type="button" class="secondary-button" :disabled="syncBusy" @click="syncBeforeLeave">{{ $t('mobile.orderDraft.save') }}</button></div>
    <p v-if="message" class="local-order-message" role="status">{{ message }}</p>
    <p v-if="syncBusy" class="local-order-message" role="status">{{ $t('mobile.ordering.syncing') }}</p>
    <p v-else-if="orderKey?.startsWith('netease:') && !syncOrder && mode !== 'original'" class="local-order-message">{{ $t('mobile.ordering.localViewOnly') }}</p>
    <p v-if="missingCount" class="local-order-message">{{ $t('mobile.backup.missing', { count: missingCount }) }}</p>
    <TrackSelectionBar v-if="selecting" :count="selectedCount" :total="selectable.length" :all="allSelected" :busy="batchBusy" :actions="batchActions || []" @all="selection.selectAll" @close="selection.close" @action="action => selection.run(action, runBatch)" />
    <div ref="list" v-range-select="!preview && batchActions?.length && !orderLoading && !syncBusy && !drag && !batchBusy ? selection.range.value : undefined" class="track-list" @pointermove="moveDrag" @pointerup="finishDrag" @pointercancel="cancelDrag" @lostpointercapture="cancelDrag">
      <WindowedTrackList ref="windowed" :items="filtered" :item-key="trackKey" :state-key="listStateKey" :restore-ready="!orderLoading" animate-changes :pinned-index="drag ? filtered.findIndex(row => trackKey(row) === drag?.key) : undefined"><template #default="{ item: track, index }">
      <div :data-range-key="cachedUnavailable(track) ? undefined : trackKey(track)" :data-local-track-key="trackKey(track)" class="track-row" :class="{ 'track-current': index === currentIndex, 'track-selected': selectedKeys.has(trackKey(track)), 'sort-moving': drag?.active && drag.key === trackKey(track), 'sort-before': drag?.anchor === trackKey(track) && !drag.after, 'sort-after': drag?.anchor === trackKey(track) && drag.after }" :role="selecting ? 'checkbox' : 'button'" :aria-checked="selecting ? selectedKeys.has(trackKey(track)) : undefined" :aria-disabled="incomplete || cachedUnavailable(track) || undefined" :aria-current="index === currentIndex ? 'true' : undefined" tabindex="0" v-track-menu="preview ? undefined : () => !incomplete && !selecting && !cachedUnavailable(track) && emit('menu', track)" @click="play(track)" @keydown.enter.self.prevent="play(track)" @keydown.space.self.prevent="play(track)">
        <span v-if="selecting" class="track-selection-check" :class="{ checked: selectedKeys.has(trackKey(track)) }" aria-hidden="true"><OriginalIcon v-if="selectedKeys.has(trackKey(track))" name="check" /></span>
        <button v-else-if="mode === 'custom'" class="sort-handle icon-button" type="button" :disabled="!canDrag" :aria-label="$t('mobile.ordering.move', { name: track.name })" @click.stop @contextmenu.prevent.stop @pointerdown.stop.prevent="startDrag($event, track)" @keydown="moveKeyboard($event, track)"><OriginalIcon name="drag" /></button>
        <span v-else class="track-index">{{ index + 1 }}</span>
        <span class="track-copy"><b>{{ track.name }}</b><small>{{ track.artists?.join(' / ') || track.album || $t('mobile.common.local') }}<span v-if="track.cueTrackNo"> · CUE #{{ track.cueTrackNo }}</span><span v-else-if="track.cueWarning" :title="track.cueWarning"> · CUE ⚠</span></small><small v-if="cachedUnavailable(track)" class="track-cache-state">{{ $t('mobile.playlistCache.audioMissing') }}</small></span>
        <span v-if="track.missingLocal" class="offline-badge">{{ $t('mobile.backup.unlinked') }}</span><span v-else-if="track.onlineOnly" class="offline-badge">{{ $t('mobile.ordering.online') }}</span>
        <TrackMenuButton v-if="!selecting && !cachedUnavailable(track)" :disabled="incomplete" :name="track.name" @open="emit('menu', track)" />
      </div>
      </template></WindowedTrackList>
      <div v-if="loading && orderKey?.startsWith('netease:')" class="playlist-load-state" role="status"><span>{{ playlistLoadingText('loading', { count: tracks.length }) }}</span><small>{{ playlistLoadingText('sorting') }}</small></div>
      <div v-else-if="loading" class="empty-state">{{ $t('mobile.ordering.loading') }}</div>
      <div v-else-if="incomplete" class="playlist-load-state playlist-load-interrupted" role="status"><span>{{ loadError || playlistLoadingText('incomplete', { count: tracks.length }) }}</span><button type="button" class="secondary-button" @click="emit('retry')">{{ playlistLoadingText('retry') }}</button></div>
      <div v-else-if="!filtered.length" class="empty-state">{{ query ? $t('mobile.ordering.noMatches') : $t('mobile.ordering.empty') }}</div>
    </div>
    <Teleport to="body"><div v-if="drag?.active" class="sort-floating-label" :style="{ left: drag.x + 12 + 'px', top: drag.y - 28 + 'px' }">{{ drag.label }}</div></Teleport>
    <CollectionOrderHistorySheet v-if="historyMounted" ref="historySurface" :open="historyOpen" :scope-key="storageKey" :entries="history" :limit="historyLimit" :recent-custom-id="recentCustomId" :active-id="historyOpen ? activeHistoryId : undefined" :items="historyItems" :disabled="syncBusy || loading" :error="historyError || storedHistoryError" :return-focus="historyTrigger" @close="historyOpen = false" @load="loadHistoryOrder" @update:limit="value => updateHistory(() => setHistoryLimit(value))" @rename="(id, name) => updateHistory(() => renameHistory(id, name))" @pin="(id, pinned) => updateHistory(() => pinHistory(id, pinned))" @remove="id => updateHistory(() => removeHistory(id))" />
  </div>
</template>

<style scoped>
.track-copy .track-cache-state { margin-top:2px; font-size:calc(10px * var(--ui-font-scale, 1)); }
.local-order-tools { display:flex; flex-wrap:wrap; justify-content:space-between; align-items:center; gap:8px; margin:8px 0; }
.playlist-load-state { display:flex; flex-wrap:wrap; align-items:center; justify-content:center; gap:8px; padding:18px 12px; color:var(--muted); font-size:calc(12px * var(--ui-font-scale,1)); line-height:1.6; }.playlist-load-state>small { display:block; flex-basis:100%; text-align:center; font-size:calc(11px * var(--ui-font-scale,1)); }.playlist-load-interrupted { border:1px solid var(--line); border-radius:var(--radius-card); margin-top:10px; background:var(--surface); }
.local-order-hint { display:flex; align-items:center; justify-content:space-between; gap:8px; margin:8px 0; }
.local-order-tools > button { display:flex; flex:0 0 auto; align-items:center; gap:5px; max-width:100%; }
.local-order-select { display:flex; align-items:center; gap:6px; min-width:0; margin-left:auto; font-size: calc(11px * var(--ui-font-scale, 1)); color:var(--muted); }
.local-order-select :deep(.app-select-trigger) { max-width:150px; }.local-order-select :deep(.app-select-trigger > span) { overflow:hidden; white-space:nowrap; text-overflow:ellipsis; }.local-history-button { width:44px; height:44px; flex:0 0 44px; border:1px solid var(--line); border-radius:var(--radius-control); background:var(--surface); font-size:20px; }
.local-order-hint, .local-order-message { font-size: calc(11px * var(--ui-font-scale, 1)); color:var(--muted); }
.local-order-hint { flex-wrap:wrap; }.sort-handle { flex:0 0 30px; width:30px; touch-action:none; cursor:grab; font-size: calc(23px * var(--ui-font-scale, 1)); }
.order-draft-actions { display:flex; align-items:center; justify-content:flex-end; flex-wrap:wrap; gap:8px; margin:8px 0; padding:8px 10px; border-radius:var(--radius-control); background:var(--accent-soft); }.order-draft-actions>span { margin-right:auto; color:var(--muted); font-size:calc(12px * var(--ui-font-scale,1)); }
.sort-moving { opacity:.45; }.sort-before { box-shadow:inset 0 2px var(--accent); }.sort-after { box-shadow:inset 0 -2px var(--accent); }
.sort-floating-label { position:fixed; z-index:10000; pointer-events:none; padding:9px 12px; max-width:65vw; white-space:nowrap; overflow:hidden; text-overflow:ellipsis; background:var(--color-body-bg); color:var(--ink); border:1px solid var(--accent); border-radius:12px; box-shadow:0 4px 20px #0003; }
</style>
