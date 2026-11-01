<script setup lang="ts">
import { computed, onMounted, onUnmounted, ref, toRef, watch } from 'vue'
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
const props = withDefaults(defineProps<{ entries: PlaylistEntry[]; scope: string; query?: string; loading?: boolean; removable?: boolean }>(), { query: '' })
const emit = defineEmits<{ open: [key: string]; remove: [key: string] }>()
const { t } = useI18n()
const { mode, ordered, commit, restore } = usePlaylistOrder(toRef(props, 'entries'), toRef(props, 'scope'))
const sortModes = ['original', 'name', 'created', 'recent', 'custom'] as const
const filtered = computed(() => ordered.value.filter(item => item.name.toLocaleLowerCase().includes(props.query.toLocaleLowerCase())))
const { visible, hasMore, showMore } = useProgressiveTracks(filtered, [toRef(props, 'scope'), toRef(props, 'query'), mode])
const canDrag = computed(() => mode.value === 'custom' && !props.query && !props.loading)
const list = ref<HTMLElement>(), message = ref('')
const drag = ref<{ key: string; pointer: number; x: number; y: number; sx: number; sy: number; active: boolean; anchor: string; after: boolean; width:number; grabX:number; grabY:number }>()
const draggedItem = computed(() => drag.value?.active ? props.entries.find(item => item.key === drag.value?.key) : undefined)
const previewKeys = computed(() => {
  const state = drag.value
  return state?.active && state.anchor ? moveTrackKey(ordered.value.map(item => item.key), state.key, state.anchor, state.after) : undefined
})
const displayed = computed(() => {
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
function keyboard(event: KeyboardEvent, item: PlaylistEntry) {
  if (!canDrag.value || !['ArrowUp', 'ArrowDown'].includes(event.key)) return
  event.preventDefault(); const keys = ordered.value.map(x => x.key), index = keys.indexOf(item.key), next = keys[index+(event.key === 'ArrowUp' ? -1 : 1)]
  if (next) { try { commit(moveTrackKey(keys,item.key,next,event.key === 'ArrowDown')) } catch { message.value = t('mobile.ordering.saveFailed') } }
}
function escape(event: KeyboardEvent) { if (event.key === 'Escape' && drag.value) { event.preventDefault(); event.stopImmediatePropagation(); suppressClickUntil = performance.now()+400; cancel() } }
watch(() => [props.scope, props.entries, props.query, mode.value, playlistView.value], cancel)
onMounted(() => document.addEventListener('keydown', escape, true))
onUnmounted(() => { cancel(); document.removeEventListener('keydown', escape, true) })
</script>
<template>
  <section class="playlist-library">
    <div class="playlist-toolbar"><div class="playlist-primary-tools"><slot name="actions"></slot><div class="playlist-sort"><OriginalIcon name="sort" /><AppSelect v-model="mode" :label="$t('mobile.refinements.playlistSort')" :options="sortModes.map(value => ({ value, label: $t('mobile.refinements.sort_' + value) }))" /></div></div><LibraryLayoutControls /></div>
    <div v-if="mode === 'custom'" class="local-order-hint"><span>{{ $t(query ? 'mobile.ordering.clearFilter' : playlistView === 'list' ? 'mobile.refinements.dragList' : 'mobile.refinements.dragCards') }}</span><button class="text-button" @click="cancel(); restore()">{{ $t('mobile.ordering.restore') }}</button><button v-if="drag?.active" class="secondary-button" @click="cancel">{{ $t('mobile.management.cancel') }}</button></div>
    <p v-if="message" class="setting-note" role="status">{{ message }}</p>
    <div ref="list" class="playlist-list" @pointermove="move" @touchmove="touchMove" @pointerup="finish" @pointercancel="cancel" @lostpointercapture="cancel">
    <TransitionGroup name="playlist-reorder" tag="div" class="playlist-grid" :class="{ 'custom-playlists': canDrag }" :css="!reducedMotion">
      <div v-for="item in displayed" :key="item.key" class="playlist-item" :data-playlist-key="item.key" :class="{ 'playlist-moving': drag?.active && drag.key === item.key, 'playlist-anchor': drag?.anchor === item.key }">
        <button class="playlist-card" type="button" @click="open(item.key)" @pointerdown="down($event,item)" @contextmenu.prevent>
          <span class="cover-wrap"><CoverImage v-if="item.cover || item.remoteCover" :src="item.cover" :remote-src="item.remoteCover" alt="" /><span v-else class="cover-fallback"><OriginalIcon name="library" /></span><span class="cover-play"><OriginalIcon name="play" /></span></span>
          <span class="playlist-copy"><b>{{ item.name }}</b><small>{{ $t('mobile.common.tracks', { count: item.count }) }}</small></span>
        </button>
        <button v-if="mode === 'custom'" class="playlist-drag-handle icon-button" type="button" :disabled="!canDrag" :aria-label="$t('mobile.ordering.move', { name:item.name })" @pointerdown.stop="down($event,item,true)" @click.stop @keydown="keyboard($event,item)"><OriginalIcon name="drag" /></button>
        <button v-if="removable" class="icon-button playlist-remove" type="button" :aria-label="$t('mobile.offline.deletePlaylist') + ' ' + item.name" @click="emit('remove',item.key)"><OriginalIcon name="close" /></button>
      </div>
      <div v-if="!displayed.length" key="empty" class="empty-state"><OriginalIcon name="empty" />{{ $t(loading ? 'mobile.ordering.loading' : 'mobile.ordering.noMatches') }}</div>
    </TransitionGroup></div><TrackListPager :more="hasMore" :label="$t('mobile.library.morePlaylists')" @more="showMore" />
    <Teleport to="body"><Transition name="playlist-floating" :css="!reducedMotion">
      <div v-if="drag?.active && draggedItem" class="playlist-drag-preview" :class="{ 'playlist-preview-list': playlistView === 'list' }" :style="{ width:drag.width + 'px', transform:`translate3d(${drag.x-drag.grabX}px, ${drag.y-drag.grabY}px, 0)` }" aria-hidden="true">
        <div class="playlist-card"><span class="cover-wrap"><CoverImage v-if="draggedItem.cover || draggedItem.remoteCover" :src="draggedItem.cover" :remote-src="draggedItem.remoteCover" loading="eager" alt="" /><span v-else class="cover-fallback"><OriginalIcon name="library" /></span></span><span class="playlist-copy"><b>{{ draggedItem.name }}</b><small>{{ $t('mobile.common.tracks', { count: draggedItem.count }) }}</small></span></div>
      </div>
    </Transition></Teleport>
  </section>
</template>
<style scoped>
.playlist-primary-tools { min-width:0; flex-basis:auto; flex-shrink:0; max-width:100%; flex-wrap:nowrap; }
.playlist-sort { min-width:0; flex-shrink:1; }.playlist-sort :deep(.app-select-trigger) { min-height:40px; max-width:170px; }.playlist-sort :deep(.app-select-trigger > span) { overflow:hidden; white-space:nowrap; text-overflow:ellipsis; }
.playlist-toolbar > .library-layout-controls { flex-shrink:0; margin-left:auto; max-width:100%; }
.playlist-item { transition:opacity 180ms ease,box-shadow 200ms ease; }.playlist-item.playlist-moving { opacity:.22; transform:none; }
.playlist-reorder-move { transition:transform 240ms cubic-bezier(.2,.75,.25,1),opacity 180ms ease; }
.playlist-drag-preview { position:fixed; top:0; left:0; z-index:10000; pointer-events:none; will-change:transform; }.playlist-drag-preview > .playlist-card { display:block; width:100%; padding:8px; border:1px solid var(--accent); border-radius:16px; background:var(--color-body-bg); box-shadow:0 12px 34px #0004; transform:scale(1.035); }
.playlist-drag-preview .cover-wrap { display:block; position:relative; width:100%; aspect-ratio:1; overflow:hidden; border-radius:12px; }.playlist-drag-preview .cover-wrap :deep(img) { display:block; width:100%; height:100%; object-fit:cover; }.playlist-drag-preview .cover-fallback { display:grid; place-items:center; width:100%; height:100%; background:var(--surface); color:var(--accent); font-size:28px; }.playlist-drag-preview .playlist-copy { display:block; padding:8px 2px 2px; }.playlist-drag-preview .playlist-copy small { display:block; }
.playlist-preview-list > .playlist-card { display:flex; align-items:center; gap:12px; padding:9px; }.playlist-preview-list .cover-wrap { flex:0 0 52px; width:52px; height:52px; }.playlist-preview-list .playlist-copy { flex:1; min-width:0; padding:0; }
.playlist-floating-enter-active,.playlist-floating-leave-active { transition:opacity 180ms ease; }.playlist-floating-enter-active > .playlist-card,.playlist-floating-leave-active > .playlist-card { transition:transform 180ms ease; }.playlist-floating-enter-from,.playlist-floating-leave-to { opacity:0; }.playlist-floating-enter-from > .playlist-card,.playlist-floating-leave-to > .playlist-card { transform:scale(.98); }
html[data-motion='reduced'] :is(.playlist-item,.playlist-reorder-move,.playlist-floating-enter-active,.playlist-floating-leave-active) { transition:none; }
.playlist-toolbar { display:flex; flex-wrap:wrap; align-items:center; gap:8px; margin:10px 0 14px; }
.playlist-primary-tools { display:flex; align-items:center; gap:8px; flex:1 0 auto; }
.playlist-sort { display:flex; gap:6px; align-items:center; color:var(--muted); font-size:calc(12px * var(--ui-font-scale, 1)); }
.playlist-item { position:relative; min-width:0; }.playlist-card { width:100%; }
.playlist-drag-handle { position:absolute; right:4px; bottom:7px; width:36px; height:40px; border-radius:10px; touch-action:none; font-size:calc(22px * var(--ui-font-scale, 1)); }
.playlist-remove { position:absolute; right:4px; top:4px; width:34px; height:34px; font-size:calc(18px * var(--ui-font-scale, 1)); border-radius:10px; }
.playlist-anchor { outline:2px solid var(--accent); outline-offset:3px; border-radius:12px; }
.custom-playlists .playlist-card { touch-action:pan-y; }.custom-playlists .playlist-copy { padding-right:34px; }
.playlist-layout-list .playlist-card { padding-right:45px; }.playlist-layout-list .playlist-drag-handle { top:50%; bottom:auto; transform:translateY(-50%); }
.playlist-layout-list .playlist-remove { right:43px; top:50%; transform:translateY(-50%); }.playlist-layout-list .playlist-item:has(.playlist-remove):has(.playlist-drag-handle) .playlist-card { padding-right:80px; }
.library-layout-controls { margin:0; flex-wrap:wrap; }.empty-state .original-icon { display:block; margin:0 auto 10px; font-size:24px; }
</style>
