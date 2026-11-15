import { shallowRef } from 'vue'
import type { CollectionOrder } from './localTrackOrdering'

export const ORDER_HISTORY_STORAGE_KEY = 'vutron:collection-order-history:v1'
export const ORDER_HISTORY_SCOPE_PREFIX = 'vutron:collection-order-history:v2:'
export const ORDER_HISTORY_INDEX_KEY = 'vutron:collection-order-history-scopes:v2'
export const DEFAULT_ORDER_HISTORY_LIMIT = 10
export const MAX_ORDER_HISTORY_LIMIT = 50
export interface CollectionOrderSnapshot {
  id: string
  createdAt: number
  mode: CollectionOrder
  keys: string[]
  customAt?: number
  name?: string
  pinned?: boolean
}
export interface CollectionOrderHistory {
  limit: number
  entries: CollectionOrderSnapshot[]
  legacyMigrated?: boolean
}
export type CollectionOrderHistories = Record<string, CollectionOrderHistory>
const modes = ['original', 'title', 'artist', 'album', 'custom']
const records = new Map<string, CollectionOrderHistory>()
const historyRevision = shallowRef(0)
const MAX_CACHED_HISTORY_SCOPES = 8, MAX_CACHED_HISTORY_KEYS = 100000
let cachedKeys = 0
let scopes: string[] | undefined
let legacy: CollectionOrderHistories = {}
let migrationAttempted = false
let sequence = 0
const emptyHistory = (): CollectionOrderHistory => ({ limit: DEFAULT_ORDER_HISTORY_LIMIT, entries: [] })
const sameKeys = (a: string[], b: string[]) => a.length === b.length && a.every((key, index) => key === b[index])
const keyCount = (record: CollectionOrderHistory | undefined) => record?.entries.reduce((count, entry) => count + entry.keys.length, 0) || 0
function remember(scope: string, value: CollectionOrderHistory) {
  cachedKeys += keyCount(value) - keyCount(records.get(scope))
  records.delete(scope); records.set(scope, value)
  while (records.size > 1 && (records.size > MAX_CACHED_HISTORY_SCOPES || cachedKeys > MAX_CACHED_HISTORY_KEYS)) {
    const oldest = records.keys().next().value!
    cachedKeys -= keyCount(records.get(oldest)); records.delete(oldest)
  }
}
const validTime = (value: unknown): value is number => typeof value === 'number' && Number.isSafeInteger(value) && value > 0 && value <= 8_640_000_000_000_000
const validScope = (value: string) => value.length > 0 && value.length <= 2048 && !['__proto__', 'prototype', 'constructor'].includes(value)
function validKeys(value: unknown): value is string[] {
  return Array.isArray(value) && value.length > 0 && value.every(key => typeof key === 'string' && key.length > 0 && key.length <= 2048)
}
function limitValue(value: unknown): number {
  return typeof value === 'number' && Number.isInteger(value) && value >= 1 && value <= MAX_ORDER_HISTORY_LIMIT ? value : DEFAULT_ORDER_HISTORY_LIMIT
}
function trimEntries(entries: CollectionOrderSnapshot[], limit: number): CollectionOrderSnapshot[] {
  let automatic = 0
  return entries.slice().sort((a, b) => b.createdAt - a.createdAt).filter(entry => entry.pinned || ++automatic <= limit)
}
function actionTime(history: CollectionOrderHistory, now = Date.now()): number {
  return history.entries.reduce((time, entry) => Math.max(time, entry.createdAt + 1, (entry.customAt || 0) + 1), now)
}
function snapshotId(history: CollectionOrderHistory, now: number): string {
  const used = new Set(history.entries.map(entry => entry.id))
  let id: string
  do { id = 'o-' + now.toString(36) + '-' + (++sequence).toString(36) } while (used.has(id))
  return id
}
function deduplicate(entries: CollectionOrderSnapshot[]): CollectionOrderSnapshot[] {
  const result: CollectionOrderSnapshot[] = [], byKeys = new Map<string, number>(), ids = new Set<string>()
  for (const entry of entries.slice().sort((a, b) => b.createdAt - a.createdAt)) {
    const signature = JSON.stringify(entry.keys), existing = byKeys.get(signature)
    if (existing !== undefined) {
      const current = result[existing]
      const customAt = Math.max(current.customAt || 0, entry.customAt || 0)
      result[existing] = { ...current, ...(customAt ? { customAt } : {}), ...(current.name || entry.name ? { name: current.name || entry.name } : {}), ...(current.pinned || entry.pinned ? { pinned: true } : {}) }
      continue
    }
    let id = entry.id, suffix = 1
    while (ids.has(id)) id = entry.id.slice(0, 88) + '-' + (++suffix)
    ids.add(id); byKeys.set(signature, result.length); result.push({ ...entry, id, keys: entry.keys.slice() })
  }
  return result
}

/** Validate saved/imported metadata without changing any valid snapshot's full order. */
export function sanitizeCollectionOrderHistories(raw: unknown): CollectionOrderHistories {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return {}
  const result: CollectionOrderHistories = {}
  for (const [scope, unknownRecord] of Object.entries(raw)) {
    if (!validScope(scope) || !unknownRecord || typeof unknownRecord !== 'object' || Array.isArray(unknownRecord)) continue
    const record = unknownRecord as CollectionOrderHistory
    if (!Array.isArray(record.entries)) continue
    const entries = record.entries.flatMap(entry => {
      if (!entry || typeof entry !== 'object' || typeof entry.id !== 'string' || !/^[a-zA-Z0-9_-]{1,100}$/.test(entry.id) || !validTime(entry.createdAt) || !modes.includes(entry.mode) || !validKeys(entry.keys)) return []
      const customAt = validTime(entry.customAt) ? entry.customAt : entry.mode === 'custom' ? entry.createdAt : 0
      const name = typeof entry.name === 'string' && entry.name.trim().length <= 80 ? entry.name.trim() : ''
      return [{ id: entry.id, createdAt: entry.createdAt, mode: entry.mode, keys: entry.keys.slice(), ...(customAt ? { customAt } : {}), ...(name ? { name } : {}), ...(entry.pinned === true ? { pinned: true } : {}) }]
    })
    const limit = limitValue(record.limit)
    result[scope] = { limit, entries: trimEntries(deduplicate(entries), limit), ...(record.legacyMigrated === true ? { legacyMigrated: true } : {}) }
  }
  return result
}

/** Backup imports keep existing named/permanent orders and reconcile duplicate sequences. */
export function mergeCollectionOrderHistories(existing: unknown, restored: unknown): CollectionOrderHistories {
  const before = sanitizeCollectionOrderHistories(existing), incoming = sanitizeCollectionOrderHistories(restored)
  const result: CollectionOrderHistories = { ...before }
  for (const [scope, record] of Object.entries(incoming)) {
    const previous = before[scope]
    result[scope] = { limit: record.limit, entries: trimEntries(deduplicate([...record.entries, ...(previous?.entries || [])]), record.limit), ...(record.legacyMigrated || previous?.legacyMigrated ? { legacyMigrated: true } : {}) }
  }
  return result
}

export const collectionOrderHistoryStorageKey = (scope: string) => ORDER_HISTORY_SCOPE_PREFIX + encodeURIComponent(scope)
function storedHistory(scope: string): CollectionOrderHistory | undefined {
  try {
    const stored = localStorage.getItem(collectionOrderHistoryStorageKey(scope))
    return stored === null ? undefined : sanitizeCollectionOrderHistories({ [scope]: JSON.parse(stored) })[scope]
  } catch { return undefined }
}
function initialize() {
  if (scopes) return
  try {
    const stored = JSON.parse(localStorage.getItem(ORDER_HISTORY_INDEX_KEY) || '[]')
    scopes = Array.isArray(stored) ? [...new Set(stored.filter((scope): scope is string => typeof scope === 'string' && validScope(scope)))] : []
  } catch { scopes = [] }
  try { legacy = sanitizeCollectionOrderHistories(JSON.parse(localStorage.getItem(ORDER_HISTORY_STORAGE_KEY) || '{}')) }
  catch { legacy = {} }
}
/** Copy the old aggregate once; retain its only copy if a storage write fails. */
function migrateStorage() {
  initialize()
  const oldScopes = Object.keys(legacy)
  if (!oldScopes.length) return
  const nextScopes = [...new Set([...scopes!, ...oldScopes])]
  for (const scope of oldScopes) {
    const key = collectionOrderHistoryStorageKey(scope)
    if (!storedHistory(scope)) localStorage.setItem(key, JSON.stringify(legacy[scope]))
  }
  if (JSON.stringify(nextScopes) !== JSON.stringify(scopes)) localStorage.setItem(ORDER_HISTORY_INDEX_KEY, JSON.stringify(nextScopes))
  localStorage.removeItem?.(ORDER_HISTORY_STORAGE_KEY)
  scopes = nextScopes
  legacy = {}
}
function prepareRead() {
  initialize()
  if (migrationAttempted) return
  migrationAttempted = true
  // A quota failure must leave existing histories readable. Mutations retry and report it.
  try { migrateStorage() } catch { /* The old aggregate remains authoritative for uncopied scopes. */ }
}
function read(scope: string): CollectionOrderHistory {
  historyRevision.value
  prepareRead()
  const current = records.get(scope)
  if (current) { records.delete(scope); records.set(scope, current); return current }
  const value = storedHistory(scope) || legacy[scope] || emptyHistory()
  remember(scope, value)
  return value
}
function persist(scope: string, value: CollectionOrderHistory): boolean {
  if (!validScope(scope)) throw new Error('Invalid collection history scope')
  const current = read(scope)
  if (JSON.stringify(current) === JSON.stringify(value)) return false
  migrateStorage()
  if (!scopes!.includes(scope)) {
    const nextScopes = [...scopes!, scope]
    localStorage.setItem(ORDER_HISTORY_INDEX_KEY, JSON.stringify(nextScopes))
    scopes = nextScopes
  }
  localStorage.setItem(collectionOrderHistoryStorageKey(scope), JSON.stringify(value))
  remember(scope, value); historyRevision.value++
  return true
}
export function getCollectionOrderHistory(scope: string): CollectionOrderHistory { return read(scope) }
/** The backup contract remains the portable v1 aggregate used by the Android bridge. */
export function exportCollectionOrderHistories(): CollectionOrderHistories {
  prepareRead()
  return Object.fromEntries([...new Set([...scopes!, ...Object.keys(legacy)])].map(scope => [scope, getCollectionOrderHistory(scope)]))
}
export function restoreCollectionOrderHistories(restored: unknown) {
  const merged = mergeCollectionOrderHistories(exportCollectionOrderHistories(), restored)
  for (const [scope, value] of Object.entries(merged)) persist(scope, value)
}
export function recentCustomOrder(history: CollectionOrderHistory): CollectionOrderSnapshot | undefined {
  return history.entries.reduce<CollectionOrderSnapshot | undefined>((latest, entry) => (entry.customAt || 0) > (latest?.customAt || 0) ? entry : latest, undefined)
}
export function recordCollectionOrder(scope: string, keys: string[], mode: CollectionOrder, options: { promote?: boolean; now?: number } = {}): CollectionOrderSnapshot | undefined {
  if (!keys.length) return undefined
  if (!validKeys(keys) || !modes.includes(mode)) throw new Error('Invalid collection order snapshot')
  const current = getCollectionOrderHistory(scope), existing = current.entries.find(entry => sameKeys(entry.keys, keys))
  if (existing && (options.promote === false || (options.promote !== true && existing.mode === mode))) return existing
  const now = actionTime(current, options.now ?? Date.now())
  const entry: CollectionOrderSnapshot = { ...existing, id: existing?.id || snapshotId(current, now), createdAt: now, mode, keys: keys.slice(), ...(mode === 'custom' ? { customAt: now } : {}) }
  persist(scope, { ...current, entries: trimEntries([entry, ...current.entries.filter(item => item !== existing)], current.limit), ...(mode === 'custom' ? { legacyMigrated: true } : {}) })
  return entry
}
export function migrateLegacyCustomOrder(scope: string, keys: string[]) {
  const current = getCollectionOrderHistory(scope)
  if (current.legacyMigrated || !keys.length) return
  if (!validKeys(keys)) throw new Error('Invalid legacy custom order')
  const existing = current.entries.find(entry => sameKeys(entry.keys, keys)), now = actionTime(current)
  const entry: CollectionOrderSnapshot = existing ? { ...existing, customAt: existing.customAt || existing.createdAt } : { id: snapshotId(current, now), createdAt: now, mode: 'custom', keys: keys.slice(), customAt: now }
  persist(scope, { ...current, entries: trimEntries(existing ? current.entries.map(item => item === existing ? entry : item) : [entry, ...current.entries], current.limit), legacyMigrated: true })
}
export function setCollectionOrderHistoryLimit(scope: string, limit: number) {
  if (!Number.isInteger(limit) || limit < 1 || limit > MAX_ORDER_HISTORY_LIMIT) throw new Error('Invalid history limit')
  const current = getCollectionOrderHistory(scope)
  if (current.limit === limit) return
  persist(scope, { ...current, limit, entries: trimEntries(current.entries, limit) })
}
export function renameCollectionOrderHistory(scope: string, id: string, name: string): boolean {
  const value = name.trim()
  if (value.length > 80) throw new Error('Order name exceeds 80 characters')
  const current = getCollectionOrderHistory(scope)
  const entry = current.entries.find(entry => entry.id === id)
  if (!entry) return false
  if ((entry.name || '') === value) return true
  persist(scope, { ...current, entries: current.entries.map(entry => entry.id === id ? { ...entry, name: value || undefined } : entry) })
  return true
}
export function pinCollectionOrderHistory(scope: string, id: string, pinned: boolean): boolean {
  const current = getCollectionOrderHistory(scope)
  const entry = current.entries.find(entry => entry.id === id)
  if (!entry) return false
  if (Boolean(entry.pinned) === pinned) return true
  const entries = current.entries.map(entry => entry.id === id ? { ...entry, pinned, ...(!pinned ? { createdAt: actionTime(current) } : {}) } : entry)
  persist(scope, { ...current, entries: trimEntries(entries, current.limit) })
  return true
}
export function removeCollectionOrderHistory(scope: string, id: string): boolean {
  const current = getCollectionOrderHistory(scope)
  if (!current.entries.some(entry => entry.id === id)) return false
  persist(scope, { ...current, entries: current.entries.filter(entry => entry.id !== id) })
  return true
}
/** Restore only the deleted row; never replace metadata or records changed since deletion. */
export function restoreDeletedCollectionOrder(scope: string, snapshot: CollectionOrderSnapshot): 'restored' | 'exists' | 'full' {
  const current = getCollectionOrderHistory(scope)
  if (current.entries.some(entry => entry.id === snapshot.id || sameKeys(entry.keys, snapshot.keys))) return 'exists'
  const restored = sanitizeCollectionOrderHistories({ [scope]: { limit: current.limit, entries: [snapshot] } })[scope]?.entries[0]
  if (!restored) throw new Error('Invalid deleted collection order')
  if (!restored.pinned && current.entries.filter(entry => !entry.pinned).length >= current.limit) return 'full'
  persist(scope, { ...current, entries: [...current.entries, restored].sort((a, b) => b.createdAt - a.createdAt) })
  return 'restored'
}

/** Missing tracks disappear only in the loaded view; new tracks follow current source order. */
export function reconcileCollectionOrder(keys: string[], available: string[]): string[] {
  const present = new Set(available), seen = new Set<string>(), result: string[] = []
  for (const key of [...keys, ...available]) if (present.has(key) && !seen.has(key)) { seen.add(key); result.push(key) }
  return result
}
export function refreshCollectionOrderHistories() { scopes = undefined; legacy = {}; migrationAttempted = false; records.clear(); cachedKeys = 0; historyRevision.value++ }
if (typeof window !== 'undefined') window.addEventListener('vutron-backup-restored', refreshCollectionOrderHistories)
