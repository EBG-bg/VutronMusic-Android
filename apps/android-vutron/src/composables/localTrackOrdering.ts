import { computed, ref, shallowRef, watch, type ComputedRef, type Ref } from 'vue'
import type { VutronTrack } from '../platform/vutronPlugin'
import { offerUndo } from '../platform/undo'
import { undoText } from '../platform/undoMessages'
import {
  getCollectionOrderHistory, migrateLegacyCustomOrder, pinCollectionOrderHistory, recentCustomOrder,
  reconcileCollectionOrder, recordCollectionOrder, removeCollectionOrderHistory, renameCollectionOrderHistory,
  setCollectionOrderHistoryLimit, restoreDeletedCollectionOrder
} from './collectionOrderHistory'

export type CollectionOrder = 'original' | 'title' | 'artist' | 'album' | 'custom'
export interface SavedCollectionOrder { mode: CollectionOrder; keys: string[] }
export const ORDER_STORAGE_KEY = 'vutron:collection-orders:v1'
const collator = new Intl.Collator('zh-CN', { numeric: true, sensitivity: 'base' })
export const trackKey = (track: VutronTrack) => track.localKey || (track.localEntryKey ? track.localPlaylistId + ':' + track.localEntryKey : track.id + ':' + (track.localUri || ''))

export function applyCollectionOrder<T extends VutronTrack>(source: T[], saved: SavedCollectionOrder, identify: (track: T) => string = trackKey): T[] {
  if (saved.mode === 'original') return source
  if (saved.mode === 'custom') {
    const ranks = new Map(saved.keys.map((key, index) => [key, index]))
    return [...source].sort((a, b) => (ranks.get(identify(a)) ?? Infinity) - (ranks.get(identify(b)) ?? Infinity))
  }
  const artistKeys = saved.mode === 'artist' ? new Map<T, string>() : undefined
  const field = (track: T) => {
    if (artistKeys) {
      let value = artistKeys.get(track)
      if (value === undefined) { value = track.artists?.join(' / ') || ''; artistKeys.set(track, value) }
      return value
    }
    return saved.mode === 'album' ? track.album || '' : track.name
  }
  return [...source].sort((a, b) => collator.compare(field(a), field(b)) || collator.compare(a.name, b.name))
}

export function moveTrackKey(keys: string[], moving: string, anchor: string, after = false): string[] {
  if (moving === anchor || !keys.includes(moving) || !keys.includes(anchor)) return keys
  const next = keys.filter(key => key !== moving)
  next.splice(next.indexOf(anchor) + (after ? 1 : 0), 0, moving)
  return next
}

function readOrders(): Record<string, SavedCollectionOrder> {
  try {
    const raw = JSON.parse(localStorage.getItem(ORDER_STORAGE_KEY) || '{}')
    if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return {}
    return Object.fromEntries(Object.entries(raw).filter(([, value]) => {
      const item = value as SavedCollectionOrder
      return item && ['original', 'title', 'artist', 'album', 'custom'].includes(item.mode) && Array.isArray(item.keys) && item.keys.every(key => typeof key === 'string')
    })) as Record<string, SavedCollectionOrder>
  } catch { return {} }
}

const orderRecords = shallowRef<Record<string, SavedCollectionOrder>>()
function currentOrders() { return orderRecords.value || (orderRecords.value = readOrders()) }
const sameKeys = (a: string[], b: string[]) => a.length === b.length && a.every((key, index) => key === b[index])
const sameOrder = (a: SavedCollectionOrder, b: SavedCollectionOrder) => a.mode === b.mode && sameKeys(a.keys, b.keys)
if (typeof window !== 'undefined') window.addEventListener('vutron-backup-restored', () => { orderRecords.value = readOrders() })

export function useCollectionTrackOrder<T extends VutronTrack>(source: ComputedRef<T[]>, collection: Ref<string>, identify: (track: T) => string = trackKey) {
  currentOrders()
  const saved = computed(() => currentOrders()[collection.value] || { mode: 'original' as CollectionOrder, keys: [] })
  const draft = ref<SavedCollectionOrder>()
  let draftBaseline: string[] | undefined
  let preparedSignature = ''
  const active = computed(() => draft.value || saved.value)
  const draftSignature = () => JSON.stringify([collection.value, active.value])
  const baselineKeys = () => draftBaseline ? reconcileCollectionOrder(draftBaseline, source.value.map(identify)) : applyCollectionOrder(source.value, saved.value, identify).map(identify)
  const sequenceDirty = computed(() => Boolean(draft.value) && !sameKeys(applyCollectionOrder(source.value, active.value, identify).map(identify), baselineKeys()))
  const dirty = computed(() => {
    if (!draft.value || sameOrder(active.value, saved.value)) return false
    if (draft.value && preparedSignature === draftSignature()) return true
    return sequenceDirty.value
  })
  const historyError = ref('')
  function ensureLegacy() { migrateLegacyCustomOrder(collection.value, saved.value.keys); historyError.value = '' }
  function tryLegacy() {
    historyError.value = ''
    try { ensureLegacy() }
    catch (cause) { historyError.value = cause instanceof Error ? cause.message : String(cause) }
  }
  tryLegacy()
  const historyRecord = computed(() => getCollectionOrderHistory(collection.value))
  const history = computed(() => historyRecord.value.entries)
  const recentCustomHistory = computed(() => recentCustomOrder(historyRecord.value))
  const recentCustomId = computed(() => recentCustomHistory.value?.id)
  function recordBaseline() { recordCollectionOrder(collection.value, source.value.map(identify), 'original', { promote: false }) }
  /** Archive before a remote reorder, while keeping its active preference uncommitted. */
  function prepareDraftSave(): boolean {
    if (!dirty.value) return false
    const value = active.value
    const before = baselineKeys()
    const after = applyCollectionOrder(source.value, value, identify).map(identify)
    const signature = draftSignature()
    if (signature === preparedSignature) return true
    if (!sameKeys(before, after)) {
      ensureLegacy()
      recordBaseline()
      recordCollectionOrder(collection.value, after, value.mode, { promote: true })
    }
    preparedSignature = signature
    return true
  }
  function saveDraft(): boolean {
    if (!dirty.value) { discardDraft(); return false }
    prepareDraftSave()
    const value = { mode: active.value.mode, keys: active.value.keys.slice() }
    const next = { ...readOrders(), [collection.value]: value }
    localStorage.setItem(ORDER_STORAGE_KEY, JSON.stringify(next))
    orderRecords.value = next
    discardDraft()
    return true
  }
  function discardDraft() { draft.value = undefined; draftBaseline = undefined; preparedSignature = '' }
  function setDraft(value: SavedCollectionOrder) {
    if (!draft.value) draftBaseline = applyCollectionOrder(source.value, saved.value, identify).map(identify)
    draft.value = value
  }
  /** Original and the last saved custom order are views; changed named sorts remain editable. */
  function selectView(value: CollectionOrder): boolean {
    if (value === active.value.mode) return true
    if (value === 'original' && dirty.value) return false
    const keys = value === 'custom' && !active.value.keys.length ? ordered.value.map(identify) : active.value.keys
    const next = { mode: value, keys }
    const unchangedSequence = sameKeys(applyCollectionOrder(source.value, next, identify).map(identify), ordered.value.map(identify))
    const savedView = value === 'original' || value === 'custom' && saved.value.keys.length > 0
    if (!dirty.value && (savedView || value !== 'custom' && unchangedSequence)) {
      const preference = { mode: value, keys: saved.value.keys }
      if (!sameOrder(preference, saved.value)) {
        const orders = { ...readOrders(), [collection.value]: preference }
        localStorage.setItem(ORDER_STORAGE_KEY, JSON.stringify(orders))
        orderRecords.value = orders
      }
      discardDraft()
    } else setDraft(next)
    return true
  }
  const mode = computed<CollectionOrder>({ get: () => active.value.mode, set: value => { selectView(value) } })
  const ordered = computed(() => applyCollectionOrder(source.value, active.value, identify))
  const savedMode = computed(() => saved.value.mode), savedKeys = computed(() => saved.value.keys)
  const activeHistoryId = computed(() => {
    const entries = history.value
    if (!entries.length || !source.value.length) return undefined
    const current = ordered.value.map(identify)
    const exact = entries.find(entry => sameKeys(entry.keys, current))
    if (exact) return exact.id
    // A saved custom order can remain active after tracks were removed or added.
    if (active.value.mode !== 'custom' || !active.value.keys.length) return undefined
    const matchingPreset = entries.find(entry => sameKeys(entry.keys, active.value.keys))
    const available = new Set(current)
    if (matchingPreset && matchingPreset.keys.some(key => available.has(key))) return matchingPreset.id
    return undefined
  })
  function commit(keys: string[]) {
    const value = { mode: 'custom' as CollectionOrder, keys: reconcileCollectionOrder(keys, source.value.map(identify)) }
    if (active.value.mode === 'custom' && sameKeys(value.keys, ordered.value.map(identify))) return
    if (!sameOrder(value, active.value)) setDraft(value)
  }
  function restore() { return selectView('original') }
  function recordCurrent(mode: CollectionOrder = active.value.mode) { recordCollectionOrder(collection.value, ordered.value.map(identify), mode) }
  function loadHistory(id: string): boolean {
    ensureLegacy()
    const entry = getCollectionOrderHistory(collection.value).entries.find(item => item.id === id)
    const available = source.value.map(identify), existing = new Set(available)
    if (!entry || !entry.keys.some(key => existing.has(key))) return false
    commit(reconcileCollectionOrder(entry.keys, available))
    return true
  }
  function loadRecentCustomHistory(): boolean { ensureLegacy(); const entry = recentCustomOrder(getCollectionOrderHistory(collection.value)); return entry ? loadHistory(entry.id) : false }
  function setHistoryLimit(limit: number) { setCollectionOrderHistoryLimit(collection.value, limit) }
  const historyLimit = computed<number>({ get: () => historyRecord.value.limit, set: setHistoryLimit })
  function renameHistory(id: string, name: string) { return renameCollectionOrderHistory(collection.value, id, name) }
  function pinHistory(id: string, pinned: boolean) { return pinCollectionOrderHistory(collection.value, id, pinned) }
  function removeHistory(id: string) {
    const scope = collection.value, entry = getCollectionOrderHistory(scope).entries.find(row => row.id === id)
    if (!entry || !removeCollectionOrderHistory(scope, id)) return false
    const deleted = { ...entry, keys: entry.keys.slice() }
    offerUndo({ message: undoText('removedHistory'), undo: () => {
      if (restoreDeletedCollectionOrder(scope, deleted) === 'full') throw new Error(undoText('restoreHistoryFull'))
    } })
    return true
  }
  watch(collection, () => { discardDraft(); orderRecords.value = readOrders(); tryLegacy() }, { flush: 'sync' })
  return { mode, ordered, commit, restore, selectView, dirty, sequenceDirty, prepareDraftSave, saveDraft, discardDraft, savedMode, savedKeys, history, historyLimit, recentCustomHistory, recentCustomId, activeHistoryId,
    setHistoryLimit, loadHistory, loadRecentCustomHistory, loadRecentHistory: loadRecentCustomHistory,
    renameHistory, pinHistory, removeHistory, recordCurrent, recordBaseline, ensureLegacy, historyError }
}
