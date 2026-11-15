<script setup lang="ts">
import { computed, nextTick, onBeforeUnmount, ref, useId, watch } from 'vue'
import { useI18n } from 'vue-i18n'
import type { CollectionOrderSnapshot } from '../composables/collectionOrderHistory'
import { useModalFocus } from '../composables/modalFocus'
import { useModalIsolation } from '../composables/modalIsolation'
import { useSheetDrag } from '../composables/sheetDrag'
import { reducedMotion, settingsMotionDuration } from '../platform/motion'
import OriginalIcon from './OriginalIcon.vue'
import SheetDragHandle from './SheetDragHandle.vue'
import TrackListPager from './TrackListPager.vue'
import AppErrorNotice from './AppErrorNotice.vue'
import CollapsibleSettingsCard from './CollapsibleSettingsCard.vue'

export interface CollectionOrderPreviewTrack { key: string; name: string; artists?: string[]; album?: string }
const props = withDefaults(defineProps<{
  open: boolean; scopeKey: string; entries: readonly CollectionOrderSnapshot[]; limit: number
  items: readonly CollectionOrderPreviewTrack[]; recentCustomId?: string; disabled?: boolean; error?: string; returnFocus?: HTMLElement
}>(), { recentCustomId: '', error: '' })
const emit = defineEmits<{
  close: []; load: [id: string]; 'update:limit': [limit: number]; rename: [id: string, name: string]
  pin: [id: string, pinned: boolean]; remove: [id: string]
}>()
const { t, locale } = useI18n()
const sectionId = useId()
const panel = ref<HTMLElement>(), selectedId = ref(''), previewLimit = ref(80), historyListLimit = ref(80), nameDraft = ref(''), limitDraft = ref(String(props.limit))
const notice = ref(''), deleting = ref(false), listScroll = ref(0)
const content = ref<HTMLElement>()
let pendingFocus: { preview: boolean; id?: string } | undefined
let contentAnimation: Animation | undefined, contentRevision = 0
const selected = computed(() => props.entries.find(entry => entry.id === selectedId.value))
const labels = { original: 'mobile.orderHistory.original', title: 'mobile.library.title', artist: 'nav.artist', album: 'nav.album', custom: 'mobile.ordering.custom' }
const dateFormat = computed(() => new Intl.DateTimeFormat(locale.value === 'en' ? 'en-US' : locale.value === 'zht' ? 'zh-TW' : 'zh-CN', { year: 'numeric', month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' }))
const pinnedCount = computed(() => props.entries.filter(entry => entry.pinned).length)
const displayEntries = computed(() => [...props.entries.filter(entry => entry.pinned), ...props.entries.filter(entry => !entry.pinned)])
const visibleEntries = computed(() => displayEntries.value.slice(0, historyListLimit.value))
const automaticCount = computed(() => props.entries.length - pinnedCount.value)
const numericLimit = computed(() => Number(limitDraft.value))
const validLimit = computed(() => limitDraft.value.trim() !== '' && Number.isInteger(numericLimit.value) && numericLimit.value >= 1 && numericLimit.value <= 50)
const nameChanged = computed(() => nameDraft.value.trim() !== (selected.value?.name || ''))
const preview = computed(() => {
  const byKey = new Map(props.items.map(item => [item.key, item]))
  const keys = new Set(selected.value?.keys || []), seen = new Set<string>(), rows: CollectionOrderPreviewTrack[] = []
  let matched = 0, missing = 0, added = 0
  for (const key of keys) {
    const item = byKey.get(key)
    if (item) { rows.push(item); seen.add(key); matched++ } else missing++
  }
  for (const item of props.items) if (!seen.has(item.key)) { rows.push(item); seen.add(item.key); added++ }
  return { rows, matched, missing, added, keys }
})
const visiblePreview = computed(() => preview.value.rows.slice(0, previewLimit.value))
const active = () => Boolean(panel.value)
useModalIsolation(panel)
useModalFocus(panel, { close: handleBack, open: active, returnFocus: () => props.returnFocus })
useSheetDrag(panel, { close: () => emit('close'), enabled: () => props.open && !deleting.value })

function entryName(entry: CollectionOrderSnapshot) { return entry.name || t(labels[entry.mode]) }
function openPreview(id: string) {
  if (props.disabled || !props.entries.some(entry => entry.id === id)) return
  listScroll.value = panel.value?.scrollTop || 0
  pendingFocus = { preview: true }
  selectedId.value = id; previewLimit.value = 80; notice.value = ''
}
function leavePreview() {
  const previous = selectedId.value
  pendingFocus = { preview: false, id: previous }
  selectedId.value = ''; previewLimit.value = 80
}
function clearContentHeight() { ++contentRevision; contentAnimation?.cancel(); contentAnimation = undefined; content.value?.style.removeProperty('height') }
function beforeContentLeave(element: Element) {
  const body = content.value
  if (!body || !props.open) return
  const height = body.getBoundingClientRect().height
  clearContentHeight(); body.style.height = `${height}px`
  ;(element as HTMLElement).inert = true
}
function enterContent(element: Element) {
  const body = content.value, container = panel.value
  if (!body || !container || !props.open) { clearContentHeight(); return }
  ;(element as HTMLElement).inert = false
  const from = body.getBoundingClientRect().height, to = element.getBoundingClientRect().height
  const scroll = pendingFocus?.preview ? 0 : listScroll.value
  // Restore a deep list position while the entering content is still transparent.
  if (scroll > 0) { clearContentHeight(); container.scrollTop = scroll; return }
  container.scrollTop = 0
  const duration = settingsMotionDuration(Math.max(from, to), to > from)
  if (!duration || Math.abs(to - from) < 1) { clearContentHeight(); return }
  contentAnimation = body.animate([{ height: `${from}px` }, { height: `${to}px` }], { duration, easing: 'ease-in-out', fill: 'both' })
}
async function afterContentEnter() {
  const revision = contentRevision
  try { await contentAnimation?.finished } catch { return }
  if (revision !== contentRevision || !panel.value?.isConnected || !pendingFocus) return
  clearContentHeight()
  const target = pendingFocus; pendingFocus = undefined
  if (target.preview) { panel.value.scrollTop = 0; panel.value.querySelector<HTMLElement>('.history-preview-back')?.focus({ preventScroll: true }); return }
  panel.value.scrollTop = listScroll.value
  const row = Array.from(panel.value.querySelectorAll<HTMLElement>('[data-history-id]')).find(item => item.dataset.historyId === target.id)
  ;(row || panel.value.querySelector<HTMLElement>('.history-recent') || panel.value)?.focus({ preventScroll: true })
  if (row) {
    const bounds = row.getBoundingClientRect(), viewport = panel.value.getBoundingClientRect()
    if (bounds.bottom <= viewport.top || bounds.top >= viewport.bottom) row.scrollIntoView({ block: 'nearest', behavior: 'instant' })
  }
}
function handleBack() {
  if (!props.open) return false
  if (selectedId.value) leavePreview()
  else emit('close')
  return true
}
function applyLimit() { if (validLimit.value && !props.disabled) emit('update:limit', numericLimit.value) }
function rename() { if (selected.value && nameChanged.value && !props.disabled) emit('rename', selected.value.id, nameDraft.value.trim()) }
function loadSelected() { if (selected.value && preview.value.matched && !props.disabled) emit('load', selected.value.id) }
async function removeSelected() {
  const entry = selected.value
  if (!entry || props.disabled || deleting.value) return
  const key = props.scopeKey
  deleting.value = true
  try {
    if (!props.open || props.scopeKey !== key || !props.entries.some(row => row.id === entry.id)) return
    emit('remove', entry.id)
    await nextTick()
    if (!props.entries.some(row => row.id === entry.id)) { if (selectedId.value) leavePreview(); notice.value = t('mobile.orderHistory.deleted') }
  } finally { deleting.value = false }
}
watch([() => props.open, () => props.scopeKey], () => { clearContentHeight(); pendingFocus = undefined; selectedId.value = ''; previewLimit.value = 80; historyListLimit.value = 80; notice.value = ''; limitDraft.value = String(props.limit) })
watch(() => props.limit, value => { limitDraft.value = String(value) })
watch(() => selected.value?.name, value => { nameDraft.value = value || '' })
watch(selectedId, () => { nameDraft.value = selected.value?.name || '' })
watch(() => props.entries, () => { if (selectedId.value && !selected.value) leavePreview() })
watch(content, value => { if (!value) clearContentHeight() })
watch(reducedMotion, reduced => { if (reduced) contentAnimation?.finish() })
onBeforeUnmount(() => { pendingFocus = undefined; clearContentHeight() })
defineExpose({ handleBack })
</script>

<template>
  <Teleport to="body"><Transition name="tuning-sheet" :duration="reducedMotion ? 0 : { enter: 320, leave: 240 }">
    <div v-if="open" class="collection-history-layer" @click.self="emit('close')">
      <section ref="panel" class="collection-history-sheet tuning-sheet" role="dialog" aria-modal="true" :aria-label="$t(selected ? 'mobile.orderHistory.previewTitle' : 'mobile.orderHistory.title')" tabindex="-1">
        <SheetDragHandle @close="emit('close')" />
        <header data-sheet-drag-handle><div><h2>{{ $t(selected ? 'mobile.orderHistory.previewTitle' : 'mobile.orderHistory.title') }}</h2><p>{{ $t(selected ? 'mobile.orderHistory.previewHint' : 'mobile.orderHistory.scopeHint') }}</p></div><button class="icon-button" type="button" :aria-label="$t('mobile.common.close')" @click="emit('close')"><OriginalIcon name="close" /></button></header>
        <AppErrorNotice v-if="error" :message="error" inline />
        <p v-if="notice" class="history-notice" role="status">{{ notice }}</p>
        <div ref="content" class="history-content"><Transition name="content-switch" mode="out-in" @before-leave="beforeContentLeave" @enter="enterContent" @after-enter="afterContentEnter">
          <div v-if="selected" :key="selected.id" class="history-preview">
            <button class="text-button history-preview-back" type="button" @click="leavePreview"><OriginalIcon name="back" />{{ $t('mobile.orderHistory.backToHistory') }}</button>
            <div class="history-preview-heading"><h3>{{ entryName(selected) }}</h3><span v-if="selected.pinned" class="history-pinned">{{ $t('mobile.orderHistory.permanent') }}</span></div>
            <p class="history-meta">{{ dateFormat.format(selected.createdAt) }} · {{ $t('mobile.common.tracks', { count: selected.keys.length }) }}</p>
            <div class="history-reconciliation" role="status">{{ $t('mobile.orderHistory.reconcile', { matched: preview.matched, missing: preview.missing, added: preview.added }) }}</div>
            <div class="history-load-actions"><button class="primary-button" type="button" :disabled="disabled || !preview.matched" @click="loadSelected"><OriginalIcon name="check" />{{ $t('mobile.orderHistory.confirmLoad') }}</button><button class="text-button" type="button" @click="leavePreview">{{ $t('mobile.management.cancel') }}</button></div>
            <CollapsibleSettingsCard class="history-manage" :section-id="sectionId + '-history-manage'" :title="$t('mobile.orderHistory.manage')" :remember="false">
              <template #heading><div class="history-collapse-heading"><h3>{{ $t('mobile.orderHistory.manage') }}</h3></div></template>
              <form class="history-name-form" @submit.prevent="rename"><label><span>{{ $t('mobile.orderHistory.name') }}</span><input v-model="nameDraft" type="text" maxlength="80" autocomplete="off" :placeholder="$t('mobile.orderHistory.nameHint')" :disabled="disabled" /></label><button class="secondary-button" type="submit" :disabled="disabled || !nameChanged">{{ $t('mobile.orderHistory.saveName') }}</button></form>
              <button class="history-pin-toggle" type="button" role="switch" :aria-checked="Boolean(selected.pinned)" :disabled="disabled" @click="emit('pin', selected.id, !selected.pinned)"><span><b>{{ $t('mobile.orderHistory.keepPermanent') }}</b><small>{{ $t('mobile.orderHistory.permanentHint') }}</small></span><span class="history-switch" :class="{ checked: selected.pinned }" aria-hidden="true"><i></i></span></button>
              <button class="text-button history-delete" type="button" :disabled="disabled || deleting" @click="removeSelected"><OriginalIcon name="close" />{{ $t('mobile.orderHistory.delete') }}</button>
            </CollapsibleSettingsCard>
            <TransitionGroup name="history-row" tag="ol" class="history-preview-list" :aria-label="$t('mobile.orderHistory.previewList')">
              <li v-for="(item, index) in visiblePreview" :key="item.key"><span class="history-track-index">{{ index + 1 }}</span><span class="history-track-copy"><b>{{ item.name }}</b><small>{{ item.artists?.join(' / ') || item.album || $t('mobile.common.local') }}</small></span><span v-if="!preview.keys.has(item.key)" class="history-added">{{ $t('mobile.orderHistory.added') }}</span></li>
            </TransitionGroup>
            <TrackListPager :more="visiblePreview.length < preview.rows.length" @more="previewLimit += 80" />
            <p v-if="!preview.matched" class="setting-note">{{ $t('mobile.orderHistory.noSharedTracks') }}</p>
          </div>
          <div v-else key="history" class="history-overview">
            <button class="secondary-button history-recent" type="button" :disabled="disabled || !recentCustomId" @click="openPreview(recentCustomId)"><OriginalIcon name="refresh" />{{ $t('mobile.orderHistory.recentCustom') }}</button>
            <p class="setting-note">{{ $t('mobile.orderHistory.chooseHint') }}</p>
            <CollapsibleSettingsCard class="history-retention" :section-id="sectionId + '-history-retention'" :title="$t('mobile.orderHistory.limit')" :remember="false">
              <template #heading><div class="history-collapse-heading"><h3>{{ $t('mobile.orderHistory.retentionSummary', { limit }) }}</h3></div></template>
              <form class="history-limit-form" novalidate @submit.prevent="applyLimit"><label><span>{{ $t('mobile.orderHistory.limit') }}</span><input :value="limitDraft" type="number" inputmode="numeric" min="1" max="50" step="1" :disabled="disabled" :aria-label="$t('mobile.orderHistory.limit')" @input="limitDraft = ($event.target as HTMLInputElement).value" /></label><button class="secondary-button" type="submit" :disabled="disabled || !validLimit || numericLimit === limit">{{ $t('mobile.orderHistory.applyLimit') }}</button></form>
              <p class="setting-note">{{ $t('mobile.orderHistory.limitHint', { limit }) }}</p>
              <p v-if="!validLimit" class="history-invalid" role="status">{{ $t('mobile.orderHistory.limitInvalid') }}</p>
            </CollapsibleSettingsCard>
            <div class="history-list-heading"><h3>{{ $t('mobile.orderHistory.versions') }}</h3><p>{{ $t('mobile.orderHistory.counts', { automatic: automaticCount, permanent: pinnedCount }) }}</p></div>
            <TransitionGroup v-if="entries.length" name="history-row" tag="div" class="history-entries"><button v-for="entry in visibleEntries" :key="entry.id" class="history-entry" type="button" :data-history-id="entry.id" :disabled="disabled" @click="openPreview(entry.id)"><span class="history-entry-icon"><OriginalIcon name="sort" /></span><span class="history-entry-copy"><b>{{ entryName(entry) }}</b><small>{{ dateFormat.format(entry.createdAt) }} · {{ $t('mobile.common.tracks', { count: entry.keys.length }) }}</small></span><span v-if="entry.pinned" class="history-pinned">{{ $t('mobile.orderHistory.permanent') }}</span><OriginalIcon name="down" class="history-entry-chevron" /></button></TransitionGroup>
            <TrackListPager v-if="entries.length" :more="visibleEntries.length < entries.length" @more="historyListLimit += 80" />
            <div v-if="!entries.length" class="history-empty"><OriginalIcon name="empty" /><h3>{{ $t('mobile.orderHistory.empty') }}</h3><p>{{ $t('mobile.orderHistory.emptyHint') }}</p></div>
          </div>
        </Transition></div>
      </section>
    </div>
  </Transition></Teleport>
</template>

<style scoped>
.collection-history-layer { position:fixed; inset:0; z-index:430; display:flex; align-items:flex-end; justify-content:center; padding-top:max(12px,env(safe-area-inset-top)); background:rgb(0 0 0 / 38%); }
.collection-history-sheet { width:min(100%,600px); max-height:92dvh; box-sizing:border-box; overflow:auto; overscroll-behavior:contain; padding:12px max(16px,env(safe-area-inset-right)) max(20px,env(safe-area-inset-bottom)) max(16px,env(safe-area-inset-left)); border:1px solid var(--line); border-bottom:0; border-radius:var(--radius-sheet) var(--radius-sheet) 0 0; background:var(--color-body-bg); color:var(--ink); box-shadow:0 -8px 32px rgb(0 0 0 / 18%); }
.history-collapse-heading h3 { margin:0; font-size:calc(13px * var(--ui-font-scale,1)); line-height:1.5; }.history-manage :deep(summary),.history-retention :deep(summary) { min-height:44px; }
.history-content { overflow:hidden; }.history-content>* { display:flow-root; }
header { display:flex; align-items:center; justify-content:space-between; gap:12px; margin:2px 0 14px; } header>div { min-width:0; } h2,h3,p { overflow-wrap:anywhere; } h2 { margin:0; font-size:calc(18px * var(--ui-font-scale,1)); } header p { margin:6px 0 0; color:var(--muted); font-size:calc(12px * var(--ui-font-scale,1)); line-height:1.5; } header>.icon-button { width:44px; height:44px; flex:0 0 44px; }
.setting-note,.history-notice,.history-meta,.history-invalid { margin:10px 0; font-size:calc(12px * var(--ui-font-scale,1)); line-height:1.65; color:var(--muted); }.history-notice { color:var(--accent-ink); }.history-invalid { color:var(--danger); }
.history-recent,.history-preview-back,.history-load-actions>.primary-button,.history-delete { display:inline-flex; align-items:center; justify-content:center; gap:8px; min-height:44px; font-size:calc(13px * var(--ui-font-scale,1)); }.history-recent { width:100%; padding:11px 12px; white-space:normal; text-align:start; color:var(--accent-ink); background:var(--accent-soft); }.history-recent .original-icon { font-size:20px; }.history-recent:disabled { color:var(--muted); background:var(--surface); }
.history-retention { padding:6px 12px; margin:12px 0; border:1px solid var(--line); border-radius:var(--radius-card); background:var(--surface); }.history-limit-form,.history-name-form { display:flex; align-items:flex-end; gap:10px; }.history-limit-form>label,.history-name-form>label { display:flex; flex:1; min-width:0; flex-direction:column; gap:8px; font-size:calc(12px * var(--ui-font-scale,1)); }.history-limit-form input { width:100%; max-width:100px; }.history-name-form input { width:100%; }input { min-width:0; min-height:44px; box-sizing:border-box; padding:9px 10px; border:1px solid var(--line); border-radius:var(--radius-control); background:var(--color-body-bg); color:var(--ink); font:inherit; transition:border-color var(--motion-feedback),background-color var(--motion-feedback); }input:focus { outline:2px solid var(--accent); outline-offset:2px; }input[type=number] { appearance:textfield; }input::-webkit-inner-spin-button,input::-webkit-outer-spin-button { margin:0; -webkit-appearance:none; }.history-limit-form>.secondary-button,.history-name-form>.secondary-button { min-height:44px; max-width:45%; white-space:normal; font-size:calc(12px * var(--ui-font-scale,1)); }
.history-list-heading { display:flex; justify-content:space-between; align-items:baseline; gap:10px; flex-wrap:wrap; margin-bottom:8px; }.history-list-heading h3,.history-manage h3 { margin:0; font-size:calc(14px * var(--ui-font-scale,1)); }.history-list-heading p { margin:0; color:var(--muted); font-size:calc(11px * var(--ui-font-scale,1)); }.history-entries { display:grid; gap:7px; }.history-entry { display:flex; align-items:center; gap:10px; width:100%; padding:11px 10px; min-height:64px; border:1px solid var(--line); border-radius:var(--radius-card); background:var(--surface); color:var(--ink); text-align:start; }.history-entry-icon { display:grid; place-items:center; width:32px; height:32px; flex:0 0 32px; border-radius:var(--radius-control); background:var(--color-body-bg); color:var(--accent-ink); font-size:20px; }.history-entry-copy { flex:1; min-width:0; }.history-entry-copy b,.history-entry-copy small { display:block; overflow-wrap:anywhere; }.history-entry-copy b { font-size:calc(13px * var(--ui-font-scale,1)); line-height:1.45; }.history-entry-copy small { margin-top:5px; color:var(--muted); font-size:calc(10px * var(--ui-font-scale,1)); line-height:1.5; }.history-entry-chevron { flex:0 0 12px; font-size:12px; color:var(--muted); transform:rotate(-90deg); }.history-pinned { flex:0 0 auto; white-space:nowrap; padding:3px 6px; border-radius:var(--radius-control); color:var(--accent-ink); background:var(--accent-soft); font-size:calc(10px * var(--ui-font-scale,1)); line-height:1.4; }
.history-empty { display:grid; justify-items:center; padding:24px 12px 18px; text-align:center; color:var(--muted); }.history-empty>.original-icon { font-size:32px; margin-bottom:12px; }.history-empty h3 { color:var(--ink); margin:0; font-size:calc(14px * var(--ui-font-scale,1)); }.history-empty p { margin:8px 0 0; font-size:calc(12px * var(--ui-font-scale,1)); line-height:1.6; }
.history-preview-back { padding-left:0; color:var(--muted); }.history-preview-heading { display:flex; align-items:center; flex-wrap:wrap; gap:8px; margin:12px 0 0; }.history-preview-heading h3 { margin:0; font-size:calc(16px * var(--ui-font-scale,1)); }.history-reconciliation { padding:10px 12px; border:1px solid var(--line); border-radius:var(--radius-card); font-size:calc(11px * var(--ui-font-scale,1)); color:var(--muted); line-height:1.65; }.history-preview-list { padding:0; margin:12px 0 0; list-style:none; }.history-preview-list>li { display:flex; align-items:center; gap:10px; padding:10px 0; border-bottom:1px solid var(--line); min-height:54px; }.history-track-index { width:24px; flex:0 0 24px; text-align:center; color:var(--muted); font-size:calc(11px * var(--ui-font-scale,1)); font-variant-numeric:tabular-nums; }.history-track-copy { min-width:0; flex:1; }.history-track-copy b,.history-track-copy small { display:block; overflow-wrap:anywhere; }.history-track-copy b { font-size:calc(13px * var(--ui-font-scale,1)); line-height:1.4; }.history-track-copy small { margin-top:4px; color:var(--muted); font-size:calc(10px * var(--ui-font-scale,1)); line-height:1.45; }.history-added { max-width:30%; flex:0 0 auto; color:var(--muted); font-size:calc(10px * var(--ui-font-scale,1)); }.history-load-actions { position:sticky; top:0; display:flex; align-items:center; gap:10px; flex-wrap:wrap; padding:12px 0; margin-top:12px; background:var(--color-body-bg); z-index:1; border-bottom:1px solid var(--line); }.history-load-actions button { white-space:normal; min-height:44px; }.history-manage { margin:8px 0 12px; padding:6px 12px; border:1px solid var(--line); border-radius:var(--radius-card); background:var(--surface); }.history-name-form { margin-top:12px; }.history-pin-toggle { display:flex; align-items:center; justify-content:space-between; gap:14px; width:100%; padding:14px 0; margin-top:6px; border:0; background:transparent; color:var(--ink); text-align:start; }.history-pin-toggle>span:first-child { min-width:0; flex:1; }.history-pin-toggle b,.history-pin-toggle small { display:block; }.history-pin-toggle b { font-size:calc(13px * var(--ui-font-scale,1)); line-height:1.5; }.history-pin-toggle small { margin-top:4px; color:var(--muted); font-size:calc(11px * var(--ui-font-scale,1)); line-height:1.6; }.history-switch { display:block; width:42px; height:26px; flex:0 0 42px; border-radius:13px; background:var(--line); transition:background-color var(--motion-feedback); }.history-switch i { display:block; width:20px; height:20px; border-radius:50%; margin:3px; background:var(--color-body-bg); box-shadow:0 1px 3px #0002; transition:transform var(--motion-feedback); }.history-switch.checked { background:var(--accent); }.history-switch.checked i { transform:translateX(16px); }.history-delete { padding-left:0; color:var(--danger); }
.history-row-enter-active { transition:opacity var(--motion-feedback),transform var(--motion-feedback); }.history-row-enter-from { opacity:0; transform:translateY(6px); }.history-row-move { transition:transform var(--motion-panel); }
html[data-motion='reduced'] :is(input,.history-switch,.history-switch i,.history-row-enter-active,.history-row-move) { transition:none; }@media(max-width:360px){.history-entry { gap:8px; padding:10px 8px; }.history-entry-icon { display:none; }.history-manage { padding:6px 12px; }.history-name-form { align-items:stretch; flex-direction:column; }.history-name-form>.secondary-button { max-width:none; align-self:flex-end; }.history-limit-form { gap:8px; }}
</style>
