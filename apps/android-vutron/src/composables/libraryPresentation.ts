import { computed, onBeforeUnmount, ref, watch, type ComputedRef, type Ref, type WatchSource } from 'vue'
import type { VutronTrack } from '../platform/vutronPlugin'

export const TRACK_PAGE_SIZE = 80
export type LocalTrackOrder = 'original' | 'title' | 'artist' | 'album'
const trackCollator = new Intl.Collator('zh-CN', { numeric: true, sensitivity: 'base' })

export function useLocalTrackOrder() {
  let saved: string | null = null
  try { saved = localStorage.getItem('vutron:local-track-order') } catch { /* Use the original order if storage is unavailable. */ }
  const order = ref<LocalTrackOrder>(saved === 'title' || saved === 'artist' || saved === 'album' ? saved : 'original')
  watch(order, value => {
    try { localStorage.setItem('vutron:local-track-order', value) } catch { /* Sorting remains usable without persistence. */ }
  })
  const refreshOrder = () => {
    const value = localStorage.getItem('vutron:local-track-order')
    order.value = value === 'title' || value === 'artist' || value === 'album' ? value : 'original'
  }
  if (typeof window !== 'undefined') window.addEventListener('vutron-backup-restored', refreshOrder)
  onBeforeUnmount(() => { if (typeof window !== 'undefined') window.removeEventListener('vutron-backup-restored', refreshOrder) })
  return order
}

export function useSortedTracks<T extends VutronTrack>(source: ComputedRef<T[]>, order: Ref<LocalTrackOrder>) {
  return computed(() => {
    if (order.value === 'original') return source.value
    const artistKeys = order.value === 'artist' ? new Map<T, string>() : undefined
    const field = (track: T) => {
      if (artistKeys) {
        let value = artistKeys.get(track)
        if (value === undefined) { value = track.artists?.join(' / ') ?? ''; artistKeys.set(track, value) }
        return value
      }
      return order.value === 'album' ? track.album ?? '' : track.name
    }
    return [...source.value].sort((a, b) => {
      const left = field(a), right = field(b)
      return left && right ? trackCollator.compare(left, right) || trackCollator.compare(a.name, b.name) : left ? -1 : right ? 1 : 0
    })
  })
}

export function useDebouncedLibraryQuery(query: Ref<string>) {
  const debounced = ref(query.value.trim().toLowerCase())
  let timer: ReturnType<typeof setTimeout> | undefined
  watch(query, value => {
    if (timer !== undefined) clearTimeout(timer)
    timer = setTimeout(() => { debounced.value = value.trim().toLowerCase() }, 180)
  })
  onBeforeUnmount(() => { if (timer !== undefined) clearTimeout(timer) })
  return debounced
}

export function useTrackSearch<T extends VutronTrack>(tracks: ComputedRef<T[]>, query: Ref<string>) {
  const index = computed(() => tracks.value.map(track => ({
    track, text: [track.name, ...(track.artists ?? []), track.album ?? ''].join(' ').toLowerCase()
  })))
  return computed(() => query.value ? index.value.filter(item => item.text.includes(query.value)).map(item => item.track) : tracks.value)
}

const progressivePages = new Map<string, number>()
export function useProgressiveTracks<T>(source: ComputedRef<T[]>, reset: WatchSource<unknown> | WatchSource<unknown>[], pageKey?: Ref<string>) {
  const limit = ref(pageKey ? progressivePages.get(pageKey.value) || TRACK_PAGE_SIZE : TRACK_PAGE_SIZE)
  const visible = computed(() => source.value.slice(0, limit.value))
  const hasMore = computed(() => limit.value < source.value.length)
  const showMore = () => { limit.value += TRACK_PAGE_SIZE }
  function remember(key: string) {
    progressivePages.delete(key); progressivePages.set(key, limit.value)
    while (progressivePages.size > 24) progressivePages.delete(progressivePages.keys().next().value!)
  }
  if (pageKey) {
    watch(pageKey, (key, previous) => { remember(previous); limit.value = progressivePages.get(key) || TRACK_PAGE_SIZE }, { flush: 'sync' })
    onBeforeUnmount(() => remember(pageKey.value))
  } else watch(reset, () => { limit.value = TRACK_PAGE_SIZE })
  return { visible, hasMore, showMore }
}
