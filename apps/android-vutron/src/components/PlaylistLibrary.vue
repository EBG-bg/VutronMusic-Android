<script setup lang="ts">
import { computed, inject, onMounted, onUnmounted, ref, toRef, watch } from 'vue'
import { useI18n } from 'vue-i18n'
import { usePlaylistOrder, type PlaylistEntry } from '../composables/playlistOrdering'
import { moveTrackKey } from '../composables/localTrackOrdering'
import { useProgressiveTracks } from '../composables/libraryPresentation'
import { playlistView } from '../platform/libraryLayout'
import CoverImage from './CoverImage.vue'
import OriginalIcon from './OriginalIcon.vue'
import LibraryLayoutControls from './LibraryLayoutControls.vue'
import AppSelect from './AppSelect.vue'
import TrackListPager from './TrackListPager.vue'
import { reducedMotion } from '../platform/motion'
import { navigationPreviewKey } from '../composables/navigationPreview'
import { playlistSortHints } from '../platform/interfacePreferences'
const props = withDefaults(defineProps<{ entries: PlaylistEntry[]; scope: string; query?: string; loading?: boolean; removable?: boolean }>(), { query: '' })
defineSlots<{ actions?: () => unknown; 'row-actions'?: (props: { item: PlaylistEntry; placement: 'list' | 'card' }) => unknown }>()
const emit = defineEmits<{ open: [key: string]; remove: [key: string] }>()
const { t } = useI18n()
const preview = inject(navigationPreviewKey, false)
const { mode, ordered, commit, restore } = usePlaylistOrder(toRef(props, 'entries'), toRef(props, 'scope'))
const sortModes = ['original', 'name', 'created', 'recent', 'custom'] as const
const filtered = computed(() => ordered.value.filter(item => item.name.toLocaleLowerCase().includes(props.query.toLocaleLowerCase())))
const { visible, hasMore, showMore } = useProgressiveTracks(filtered, [toRef(props, 'scope'), toRef(props, 'query'), mode])
const editing = ref(false)
const canDrag = computed(() => mode.value === 'custom' && editing.value && !props.query && !props.loading)
const list = ref<HTMLElement>(), message = ref('')
const drag = ref<{ key: string; pointer: number; x: number; y: number; sx: number; sy: number; active: boolean; anchor: string; after: boolean; width:number; grabX:number; grabY:number }>()
const draggedItem = computed(() => drag.value?.active ? props.entries.find(item => item.key === drag.value?.key) : undefined)
const previewKeys = computed(() => {
  const state = drag.value
  return state?.active && state.anchor ? moveTrackKey(ordered.value.map(item => item.key), state.key, state.anchor, state.after) : undefined
})
const displayed = computed(() => {
  if (preview) return visible.value.slice(0, 24)
  if (!previewKeys.value) return visible.value
  const entries = new Map(visible.value.map(item => [item.key,item]))
  return previewKeys.value.flatMap(key => entries.has(key) ? [entries.get(key)!] : [])
})
let capture: HTMLElement | undefined, hold: ReturnType<typeof setTimeout> | undefined, animation = 0, suppressClickUntil = 0
function cancel() {
  if (drag.value?.active) suppressClickUntil = performance.now()+400
  clearTimeout(hold); cancelAnimationFrame(animation)
  const id = drag.value?.pointer; drag.value = undefined
  if (id !== undefined && capture?.hasPointerCapture(id)) capture.releasePointerCapture(id)
  capture = undefined
}
function activate() {
  const state = drag.value
  if (!state) return
  state.active = true; capture?.setPointerCapture(state.pointer); animation = requestAnimationFrame(scroll)
}
function down(event: PointerEvent, item: PlaylistEntry, handle = false) {
  if (!canDrag.value || !event.isPrimary || event.button !== 0 || drag.value) return
  if (!handle && playlistView.value === 'list') return
  const trigger = event.currentTarget as HTMLElement
  const bounds = trigger.closest<HTMLElement>('.playlist-item')!.getBoundingClientRect()
  // The list keeps pointer capture while preview rows move inside TransitionGroup.
  capture = list.value
  drag.value = { key: item.key, pointer: event.pointerId, x: event.clientX, y: event.clientY, sx: event.clientX, sy: event.clientY, active: false, anchor: '', after: false, width:bounds.width, grabX:event.clientX-bounds.left, grabY:event.clientY-bounds.top }
  if (handle) { event.preventDefault(); activate() }
  else hold = setTimeout(activate, 430)
}
function anchor() {
  const state = drag.value
  if (!state?.active) return
  const bottom = document.querySelector('.mini-player, .bottom-nav')?.getBoundingClientRect().top || innerHeight
  const y = Math.max(88, Math.min(state.y, bottom-10))
  const row = document.elementFromPoint(state.x, y)?.closest<HTMLElement>('[data-playlist-key]')
  if (!row || !list.value?.contains(row) || row.dataset.playlistKey === state.key) return
  state.anchor = row.dataset.playlistKey || ''
  const r = row.getBoundingClientRect()
  state.after = playlistView.value === 'list' ? y > r.top + r.height / 2 : state.x > r.left + r.width / 2
}
function touchMove(event: TouchEvent) { if (drag.value?.active) event.preventDefault() }
function move(event: PointerEvent) {
  const state = drag.value
  if (!state || state.pointer !== event.pointerId) return
  state.x = event.clientX; state.y = event.clientY
  if (!state.active) { if (Math.hypot(state.x - state.sx, state.y - state.sy) > 7) cancel(); return }
  event.preventDefault(); anchor()
}
function scroll() {
  const state = drag.value
  if (!state?.active) return
  const speed = state.y < 90 ? -Math.min(18, (90-state.y)/3) : state.y > innerHeight-140 ? Math.min(18,(state.y-innerHeight+140)/3) : 0
  if (speed) { window.scrollBy({ top:speed, behavior:'instant' }); anchor() }
  if (speed > 0 && hasMore.value && list.value && list.value.getBoundingClientRect().bottom < innerHeight+100) showMore()
  animation = requestAnimationFrame(scroll)
}
function finish(event: PointerEvent) {
  const state = drag.value
  if (!state || state.pointer !== event.pointerId) return
  if (state.active) {
    suppressClickUntil = performance.now()+400
    if (state.anchor) {
      try { commit(moveTrackKey(ordered.value.map(x => x.key), state.key, state.anchor, state.after)); message.value = t('mobile.ordering.saved') }
      catch { message.value = t('mobile.ordering.saveFailed') }
    }
  }
  cancel()
}
function open(key: string) { if (performance.now() < suppressClickUntil || drag.value?.active) return; emit('open', key) }
function selectSort(value: string | number) {
  if (!sortModes.includes(value as typeof sortModes[number])) return
  cancel(); message.value=''
  try { mode.value=value as typeof sortModes[number]; editing.value=value==='custom' }
  catch { message.value=t('mobile.ordering.saveFailed') }
}
function finishEditing() { cancel(); editing.value=false; message.value='' }
function restoreOriginal() { cancel();try { restore(); editing.value=false; message.value='' } catch { message.value=t('mobile.ordering.saveFailed') } }
function back(event:Event) { if(event.defaultPrevented)return;if(drag.value){event.preventDefault();cancel()}else if(editing.value){event.preventDefault();finishEditing()} }
function keyboard(event: KeyboardEvent, item: PlaylistEntry) {
  if (!canDrag.value || !['ArrowUp', 'ArrowDown'].includes(event.key)) return
  event.preventDefault(); const keys = ordered.value.map(x => x.key), index = keys.indexOf(item.key), next = keys[index+(event.key === 'ArrowUp' ? -1 : 1)]
  if (next) { try { commit(moveTrackKey(keys,item.key,next,event.key === 'ArrowDown')) } catch { message.value = t('mobile.ordering.saveFailed') } }
}
function escape(event: KeyboardEvent) { if (event.key === 'Escape' && drag.value) { event.preventDefault(); event.stopImmediatePropagation(); suppressClickUntil = performance.now()+400; cancel() } }
watch(() => [props.scope, props.entries, props.query, mode.value, playlistView.value], cancel)
watch(() => props.scope, () => { editing.value=false; message.value='' })
function visibilityChanged() { if (document.hidden) cancel() }
onMounted(() => { if (preview) return; document.addEventListener('keydown', escape, true); document.addEventListener('visibilitychange',visibilityChanged); window.addEventListener('vutron-playlist-order-back',back) })
onUnmounted(() => { cancel(); document.removeEventListener('keydown', escape, true); document.removeEventListener('visibilitychange',visibilityChanged); window.removeEventListener('vutron-playlist-order-back',back) })
</script>
<template>
  <section class="playlist-library">
    <div class="playlist-toolbar"><div class="playlist-primary-tools"><slot name="actions"></slot><div class="playlist-sort"><button v-if="mode==='custom'&&!editing" type="button" class="icon-button playlist-edit-order" :aria-label="$t('mobile.ordering.editSort')" :title="$t('mobile.ordering.editSort')" @click="selectSort('custom')"><OriginalIcon name="drag" /></button><OriginalIcon v-else name="sort" /><AppSelect :model-value="mode" :label="$t('mobile.refinements.playlistSort')" :options="sortModes.map(value => ({ value, label: $t('mobile.refinements.sort_' + value) }))" @update:model-value="selectSort" /></div></div><LibraryLayoutControls /></div>
    <div v-if="editing" class="playlist-edit-tools"><button type="button" class="secondary-button playlist-finish-order" @click="finishEditing"><OriginalIcon name="check" />{{ $t('mobile.ordering.finishSort') }}</button><button type="button" class="text-button" @click="restoreOriginal">{{ $t('mobile.ordering.restore') }}</button><button v-if="drag?.active" type="button" class="text-button" @click="cancel">{{ $t('mobile.management.cancel') }}</button></div>
    <div v-if="editing&&playlistSortHints" class="local-order-hint playlist-sort-hint"><span>{{ $t(query ? 'mobile.ordering.clearFilter' : playlistView === 'list' ? 'mobile.refinements.dragList' : 'mobile.refinements.dragCards') }}</span><button type="button" class="icon-button" :aria-label="$t('mobile.ordering.dismissSortHint')" @click="playlistSortHints=false"><OriginalIcon name="close" /></button></div>
    <p v-if="message" class="setting-note" role="status">{{ message }}</p>
    <div ref="list" class="playlist-list" @pointermove="move" @touchmove="touchMove" @pointerup="finish" @pointercancel="cancel" @lostpointercapture="cancel">
    <TransitionGroup name="playlist-reorder" tag="div" class="playlist-grid" :class="{ 'custom-playlists': canDrag }" :css="!reducedMotion">
      <div v-for="item in displayed" :key="item.key" class="playlist-item" :data-playlist-key="item.key" :class="{ 'playlist-moving': drag?.active && drag.key === item.key, 'playlist-anchor': drag?.anchor === item.key }">
        <button class="playlist-card" type="button" @click="open(item.key)" @pointerdown="down($event,item)" @contextmenu.prevent>
          <span class="cover-wrap"><CoverImage v-if="item.cover || item.remoteCover" :src="item.cover" :remote-src="item.remoteCover" :size="playlistView === 'list' ? 'small' : 'auto'" alt="" /><span v-else class="cover-fallback"><OriginalIcon name="library" /></span><span class="cover-play"><OriginalIcon name="play" /></span></span>
          <span class="playlist-copy"><b>{{ item.name }}</b><small>{{ item.subtitle || $t('mobile.common.tracks', { count: item.count }) }}</small></span>
        </button>
        <button v-if="canDrag" class="playlist-drag-handle icon-button" type="button" :aria-label="$t('mobile.ordering.move', { name:item.name })" @pointerdown.stop="down($event,item,true)" @click.stop @keydown="keyboard($event,item)"><OriginalIcon name="drag" /></button>
        <button v-if="removable" class="icon-button playlist-remove" type="button" :aria-label="$t('mobile.offline.deletePlaylist') + ' ' + item.name" @click="emit('remove',item.key)"><OriginalIcon name="close" /></button>
        <slot v-else-if="!editing" name="row-actions" :item="item" :placement="playlistView === 'list' ? 'list' : 'card'" />
      </div>
      <div v-if="!displayed.length" key="empty" class="empty-state"><OriginalIcon name="empty" />{{ $t(loading ? 'mobile.ordering.loading' : 'mobile.ordering.noMatches') }}</div>
    </TransitionGroup></div><TrackListPager :more="hasMore" :label="$t('mobile.library.morePlaylists')" @more="showMore" />
    <Teleport to="body"><Transition name="playlist-floating" :css="!reducedMotion">
      <div v-if="drag?.active && draggedItem" class="playlist-drag-preview" :class="{ 'playlist-preview-list': playlistView === 'list' }" :style="{ width:drag.width + 'px', transform:`translate3d(${drag.x-drag.grabX}px, ${drag.y-drag.grabY}px, 0)` }" aria-hidden="true">
        <div class="playlist-card"><span class="cover-wrap"><CoverImage v-if="draggedItem.cover || draggedItem.remoteCover" :src="draggedItem.cover" :remote-src="draggedItem.remoteCover" loading="eager" alt="" /><span v-else class="cover-fallback"><OriginalIcon name="library" /></span></span><span class="playlist-copy"><b>{{ draggedItem.name }}</b><small>{{ draggedItem.subtitle || $t('mobile.common.tracks', { count: draggedItem.count }) }}</small></span></div>
      </div>
    </Transition></Teleport>
  </section>
</template>
<style scoped>
.playlist-toolbar { display: flex; flex-wrap: wrap; align-items: center; justify-content: space-between; gap: 8px; margin: 10px 0 14px; }
.playlist-primary-tools { display: flex; align-items: center; flex-wrap: wrap; gap: 8px; min-width: 0; flex: 1 1 auto; max-width: 100%; }
.playlist-edit-tools { display: flex; align-items: center; flex-wrap: wrap; gap: 6px; margin: 6px 0; }
.playlist-sort-hint { display: flex; align-items: center; gap: 8px; margin: 6px 0 10px; padding: 8px 10px; border: 1px solid var(--line); border-radius: 12px; background: var(--surface); font-size: calc(12px * var(--ui-font-scale, 1)); color: var(--muted); }
.playlist-sort-hint > span { flex: 1; min-width: 0; line-height: 1.5; }
.playlist-sort-hint > .icon-button { flex: 0 0 38px; width: 38px; height: 38px; }
.playlist-edit-order { padding: 5px; width: 36px; min-width: 36px; height: 40px; }
.playlist-sort { display: inline-flex; gap: 6px; align-items: center; min-width: 0; flex-shrink: 1; color: var(--muted); font-size: calc(12px * var(--ui-font-scale, 1)); }
.playlist-sort :deep(.app-select-trigger) { min-height: 40px; max-width: 170px; }
.playlist-sort :deep(.app-select-trigger > span) { overflow: hidden; white-space: nowrap; text-overflow: ellipsis; }
.playlist-toolbar > .library-layout-controls { flex-shrink: 0; margin: 0; max-width: 100%; }
.playlist-toolbar > .library-layout-controls :deep(.app-select-trigger) { min-height: 38px; }
.playlist-item { position: relative; min-width: 0; transition: opacity 180ms ease, box-shadow 200ms ease; }
.playlist-item.playlist-moving { opacity: .22; transform: none; }
.playlist-card { width: 100%; }
.playlist-reorder-move { transition: transform 240ms cubic-bezier(.2,.75,.25,1), opacity 180ms ease; }
.playlist-drag-preview { position: fixed; top: 0; left: 0; z-index: 10000; pointer-events: none; will-change: transform; }
.playlist-drag-preview > .playlist-card { display: block; width: 100%; padding: 8px; border: 1px solid var(--accent); border-radius: 18px; background: var(--surface-card); box-shadow: var(--shadow-float); transform: scale(1.03); }
.playlist-drag-preview .cover-wrap { display: block; position: relative; width: 100%; aspect-ratio: 1; overflow: hidden; border-radius: 12px; }
.playlist-drag-preview .cover-wrap :deep(img) { display: block; width: 100%; height: 100%; object-fit: cover; }
.playlist-drag-preview .cover-fallback { display: grid; place-items: center; width: 100%; height: 100%; background: var(--surface); color: var(--accent); font-size: 28px; }
.playlist-drag-preview .playlist-copy { display: block; padding: 8px 2px 2px; }
.playlist-drag-preview .playlist-copy small { display: block; }
.playlist-preview-list > .playlist-card { display: flex; align-items: center; gap: 12px; padding: 9px; }
.playlist-preview-list .cover-wrap { flex: 0 0 52px; width: 52px; height: 52px; }
.playlist-preview-list .playlist-copy { flex: 1; min-width: 0; padding: 0; }
.playlist-floating-enter-active, .playlist-floating-leave-active { transition: opacity 180ms ease; }
.playlist-floating-enter-active > .playlist-card, .playlist-floating-leave-active > .playlist-card { transition: transform 180ms ease; }
.playlist-floating-enter-from, .playlist-floating-leave-to { opacity: 0; }
.playlist-floating-enter-from > .playlist-card, .playlist-floating-leave-to > .playlist-card { transform: scale(.98); }
html[data-motion='reduced'] :is(.playlist-item, .playlist-reorder-move, .playlist-floating-enter-active, .playlist-floating-leave-active) { transition: none; }
.playlist-drag-handle { position: absolute; right: 4px; bottom: 7px; width: 36px; height: 40px; border-radius: 10px; touch-action: none; font-size: calc(22px * var(--ui-font-scale, 1)); }
.playlist-remove { position: absolute; right: 4px; top: 4px; width: 34px; height: 34px; font-size: calc(18px * var(--ui-font-scale, 1)); border-radius: 10px; }
.playlist-anchor { outline: 2px solid var(--accent); outline-offset: 3px; border-radius: 14px; }
.custom-playlists .playlist-card { touch-action: pan-y; }
.custom-playlists .playlist-copy { padding-right: 34px; }
.playlist-layout-list .custom-playlists .playlist-card, .playlist-layout-list .playlist-item:has(.playlist-remove) .playlist-card { padding-right: 45px; }
.playlist-layout-list .playlist-drag-handle { top: 50%; bottom: auto; transform: translateY(-50%); }
.playlist-layout-list .playlist-remove { right: 4px; top: 50%; transform: translateY(-50%); }
.playlist-layout-list .playlist-item:has(.playlist-drag-handle) .playlist-remove { right: 43px; }
.playlist-layout-list .playlist-item:has(.playlist-remove):has(.playlist-drag-handle) .playlist-card { padding-right: 80px; }
.empty-state .original-icon { display: block; margin: 0 auto 10px; font-size: 24px; }
.playlist-item > :deep(.playlist-menu-list) { position:absolute; right:4px; top:50%; transform:translateY(-50%); }
.playlist-item:has(.playlist-menu-list) .playlist-card { padding-right:52px; }
</style>
