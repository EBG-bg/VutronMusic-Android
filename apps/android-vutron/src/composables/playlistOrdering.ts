import { computed, ref, watch, type Ref } from 'vue'
export type PlaylistSort = 'original' | 'name' | 'created' | 'recent' | 'custom'
export interface PlaylistEntry { key: string; name: string; count: number; cover?: string; remoteCover?: string; createTime?: number }
export interface PlaylistOrder { mode: PlaylistSort; keys: string[]; recent: Record<string, number> }
export const PLAYLIST_ORDER_KEY = 'vutron:playlist-orders:v1'
const modes = ['original', 'name', 'created', 'recent', 'custom']
export function sanitizePlaylistOrders(raw: unknown): Record<string, PlaylistOrder> {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return {}
  return Object.fromEntries(Object.entries(raw).slice(0, 250).flatMap(([scope, value]) => {
    const item = value as PlaylistOrder
    if (!/^(netease:[0-9]+|local:device)$/.test(scope) || !item || !modes.includes(item.mode)) return []
    const validKey = (key: unknown): key is string => typeof key === 'string' && /^[a-zA-Z0-9:_-]{1,200}$/.test(key)
    const keys = Array.isArray(item.keys) ? [...new Set(item.keys.filter(validKey))].slice(0, 3000) : []
    const recent = item.recent && typeof item.recent === 'object' ? Object.fromEntries(Object.entries(item.recent).filter(([key, time]) => validKey(key) && Number.isFinite(time) && time > 0).slice(0, 3000)) : {}
    return [[scope, { mode: item.mode, keys, recent }]]
  }))
}
function read() { try { return sanitizePlaylistOrders(JSON.parse(localStorage.getItem(PLAYLIST_ORDER_KEY) || '{}')) } catch { return {} } }
const records = ref(read())
const defaultOrder = (): PlaylistOrder => ({ mode: 'original', keys: [], recent: {} })
function save(scope: string, order: PlaylistOrder) {
  const next = sanitizePlaylistOrders({ ...read(), [scope]: order })
  localStorage.setItem(PLAYLIST_ORDER_KEY, JSON.stringify(next)); records.value = next
}
export function recordPlaylistPlayback(scope: string, key: string, time = Date.now()) {
  if (!/^(netease:[1-9][0-9]*|local:device)$/.test(scope)) return
  const order = read()[scope] || defaultOrder()
  save(scope, { ...order, recent: { ...order.recent, [key]: time } })
}
export function applyPlaylistOrder<T extends PlaylistEntry>(items: T[], order: PlaylistOrder): T[] {
  if (order.mode === 'original') return items
  const ranks = new Map(order.keys.map((key, index) => [key, index]))
  const collator = new Intl.Collator('zh-CN', { numeric: true, sensitivity: 'base' })
  return [...items].sort((a, b) => {
    if (order.mode === 'name') return collator.compare(a.name, b.name)
    if (order.mode === 'custom') return (ranks.get(a.key) ?? Infinity) - (ranks.get(b.key) ?? Infinity)
    if (order.mode === 'recent') return (order.recent[b.key] || 0) - (order.recent[a.key] || 0)
    if (!a.createTime || !b.createTime) return Number(Boolean(b.createTime)) - Number(Boolean(a.createTime))
    return b.createTime - a.createTime
  })
}
export function usePlaylistOrder(items: Ref<PlaylistEntry[]>, scope: Ref<string>) {
  const saved = computed(() => records.value[scope.value] || defaultOrder())
  const mode = computed<PlaylistSort>({ get: () => saved.value.mode, set: value => save(scope.value, { ...saved.value, mode: value }) })
  const ordered = computed(() => applyPlaylistOrder(items.value, saved.value))
  function commit(keys: string[]) { save(scope.value, { ...saved.value, mode: 'custom', keys }) }
  function restore() { save(scope.value, { ...saved.value, mode: 'original', keys: [] }) }
  watch(scope, () => { records.value = read() })
  return { mode, ordered, commit, restore }
}
window.addEventListener('vutron-backup-restored', () => { records.value = read() })
