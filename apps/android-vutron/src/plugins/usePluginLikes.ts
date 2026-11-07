import { computed, reactive, ref, shallowRef, watch, type Ref } from 'vue'
import { musicPluginBridge, type MusicPluginBridge } from './bridge'
import { hasPluginMethod, pluginParams, type MusicPlugin, type PluginContext, type PluginItem, type PluginResult } from './protocol'

type LikeStatus = 'idle' | 'ready' | 'partial' | 'unsupported' | 'error'
export interface PluginLikesView { loading: boolean; saving: boolean; status: LikeStatus; error: string }
interface LikeEntry {
  id: string; scope: string; key: string; version: number; loadedAt: number
  view: PluginLikesView; ids: Set<string>; tracks: Map<string, PluginItem>; overrides: Map<string, boolean>
  complete: Ref<boolean>; playlist?: PluginItem; pending?: Promise<void>
}
const READ_TTL = 5 * 60_000
const MAX_LIKED_PAGES = 4

// Only the public Track.id participates in membership. Provider contexts stay
// opaque; even the synthetic liked-playlist ID may differ from its outer ID.
function publicId(value: unknown): string | undefined {
  if (typeof value === 'string') return value.trim() ? value : undefined
  return typeof value === 'number' && Number.isSafeInteger(value) ? String(value) : undefined
}
function context(value: unknown): PluginContext {
  return value && typeof value === 'object' && !Array.isArray(value) ? value as PluginContext : {}
}
function responseError(result: PluginResult): Error {
  return new Error(result.message || 'PLUGIN_LIKES_REQUEST_' + result.code)
}
function failure(cause: unknown): string { return cause instanceof Error ? cause.message : 'PLUGIN_LIKES_READ_FAILED' }

export function createPluginLikes(api: Pick<MusicPluginBridge, 'callMusicPlugin'> = musicPluginBridge) {
  const entries = new Map<string, LikeEntry>(), scopes = new Map<string, string>()
  function entryFor(plugin: MusicPlugin): LikeEntry {
    const scope = plugin.accountScope || '', key = JSON.stringify([plugin.id, scope])
    if (scopes.has(plugin.id) && scopes.get(plugin.id) !== scope) {
      for (const [oldKey, entry] of entries) if (entry.id === plugin.id) {
        entry.version++; entry.view.loading = false; entries.delete(oldKey)
      }
    }
    scopes.set(plugin.id, scope)
    let entry = entries.get(key)
    if (!entry) {
      entry = { id: plugin.id, scope, key, version: 0, loadedAt: 0,
        view: reactive({ loading: false, saving: false, status: 'idle', error: '' }),
        ids: reactive(new Set<string>()), tracks: new Map(), overrides: reactive(new Map<string, boolean>()), complete: ref(false) }
      entries.set(key, entry)
    }
    return entry
  }
  function valid(entry: LikeEntry, version: number, allowed: () => boolean) {
    return entry.version === version && entries.get(entry.key) === entry && scopes.get(entry.id) === entry.scope && allowed()
  }
  function invalidate(id: string, scope?: string) {
    for (const entry of entries.values()) if (entry.id === id && (scope === undefined || entry.scope === scope)) {
      entry.version++; entry.pending = undefined; entry.view.loading = false; entry.loadedAt = 0
      // Keep the last confirmed state and an outstanding mutation's busy flag.
    }
  }
  function state(plugin: MusicPlugin, track: PluginItem): boolean | undefined {
    const scope = plugin.accountScope || '', entry = entries.get(JSON.stringify([plugin.id, scope])), id = publicId(track.id)
    if (!entry || scopes.get(plugin.id) !== scope || id === undefined) return undefined
    if (entry.overrides.has(id)) return entry.overrides.get(id)
    if (entry.ids.has(id)) return true
    return entry.complete.value ? false : undefined
  }
  async function request(plugin: MusicPlugin, method: string, params: PluginContext) {
    return api.callMusicPlugin({ pluginId: plugin.id, accountScope: plugin.accountScope, method, params })
  }
  async function load(plugin: MusicPlugin, allowed: () => boolean = () => true, force = false, mutationRead = false): Promise<void> {
    const entry = entryFor(plugin)
    if (!plugin.enabled || !allowed() || entry.view.saving && !mutationRead) return
    if (entry.pending) return entry.pending
    if (!force && entry.loadedAt && Date.now() - entry.loadedAt < READ_TTL) return
    const version = ++entry.version
    entry.view.loading = true; entry.view.error = ''
    const task = Promise.resolve().then(async () => {
      try {
        let response: PluginResult | undefined, playlist: PluginItem | undefined
        let ids = new Set<string>(), tracks = new Map<string, PluginItem>(), complete = false, read = false
        function collect(rows: unknown) {
          if (!Array.isArray(rows)) return false
          let allValid = true
          for (const value of rows) {
            const item = value as PluginItem, id = publicId(item?.id)
            if (id === undefined) { allValid = false; continue }
            ids.add(id); tracks.set(id, item)
          }
          return allValid
        }
        if (hasPluginMethod(plugin, 'likelist')) {
          response = await request(plugin, 'likelist', {})
          if (!valid(entry, version, allowed)) return
          if (response.code === 200 && Array.isArray(response.data)) {
            const allValid = collect(response.data)
            const count = typeof response.count === 'number' && Number.isFinite(response.count) ? response.count : undefined
            complete = allValid && (count === undefined ? Object.keys(context(response.sourceContext)).length === 0 : ids.size >= count)
            read = true
          } else if (response.code !== 404) throw responseError(response)
        }
        if (!read && hasPluginMethod(plugin, 'userPlaylist')) {
          response = await request(plugin, 'userPlaylist', {})
          if (!valid(entry, version, allowed)) return
          if (response.code !== 200) throw responseError(response)
          playlist = response.liked || undefined
          // Synthetic playlist summaries have a default count of zero. Only
          // their detail response can establish actual membership or emptiness.
          if (playlist && hasPluginMethod(plugin, 'getPlaylistDetail')) {
            const detailResponse = await request(plugin, 'getPlaylistDetail', pluginParams(context(playlist.sourceContext)))
            if (!valid(entry, version, allowed)) return
            if (detailResponse.code !== 200) throw responseError(detailResponse)
            const detail = detailResponse.data as PluginItem | undefined
            if (detail && typeof detail === 'object') {
              read = true
              let allValid = collect(detail.tracks)
              if (Array.isArray(detail.trackIds)) for (const value of detail.trackIds) {
                const id = publicId(value)
                if (id === undefined) allValid = false
                else ids.add(id)
              }
              const count = typeof detail.trackCount === 'number' && Number.isFinite(detail.trackCount) && detail.trackCount >= 0 ? detail.trackCount : undefined
              const isComplete = () => allValid && count !== undefined && (count === 0 ? ids.size === 0 : ids.size >= count)
              complete = isComplete()
              // Kugou's liked detail intentionally has no tracks. Its own
              // getPlaylistTracks cursor carries listid/page. The other bundled
              // servers' synthetic favourites must never use ParentId queries.
              if (!complete && (plugin.baseId || plugin.id) === 'kugou' && hasPluginMethod(plugin, 'getPlaylistTracks')) {
                let cursor = context(detail.sourceContext)
                for (let page = 0; page < MAX_LIKED_PAGES; page++) {
                  if (!valid(entry, version, allowed)) return
                  const before = ids.size
                  const next = await request(plugin, 'getPlaylistTracks', pluginParams(cursor, { reset: page === 0 }))
                  if (!valid(entry, version, allowed)) return
                  if (next.code !== 200) throw responseError(next)
                  allValid = collect(next.data) && allValid
                  complete = isComplete()
                  if (complete || ids.size === before || !Array.isArray(next.data) || !next.data.length) break
                  cursor = context(next.sourceContext)
                }
              }
            }
          }
        }
        if (!valid(entry, version, allowed)) return
        entry.loadedAt = Date.now()
        if (playlist) entry.playlist = playlist
        if (!read) { entry.view.status = 'unsupported'; return }
        entry.ids.clear(); for (const id of ids) entry.ids.add(id)
        entry.tracks = tracks; entry.complete.value = complete
        if (complete) entry.overrides.clear()
        else for (const id of ids) entry.overrides.delete(id)
        entry.view.status = complete ? 'ready' : 'partial'
      } catch (cause) {
        if (valid(entry, version, allowed)) { entry.view.status = 'error'; entry.view.error = failure(cause); entry.loadedAt = Date.now() }
      } finally {
        if (entry.version === version) { entry.view.loading = false; entry.pending = undefined }
      }
    })
    entry.pending = task
    return task
  }
  async function setLiked(plugin: MusicPlugin, track: PluginItem, liked: boolean, allowed: () => boolean = () => true): Promise<boolean> {
    const entry = entryFor(plugin)
    if (entry.view.saving) return false
    if (!hasPluginMethod(plugin, 'likeATrack') || !allowed()) throw new Error('PLUGIN_LIKES_UNAVAILABLE')
    entry.view.saving = true
    // A read begun before this confirmed write must not roll the result back.
    let version = ++entry.version; entry.pending = undefined; entry.view.loading = false
    try {
      const id = publicId(track.id), kugou = (plugin.baseId || plugin.id) === 'kugou'
      if (kugou && !liked && (id === undefined || !entry.tracks.has(id))) {
        // A successful add does not return Kugou's membership/file context.
        // Read that context before a later remove; never synthesize it from a hash.
        await load(plugin, allowed, true, true)
        if (entries.get(entry.key) !== entry || !allowed()) return false
        version = ++entry.version
      }
      let playlist = entry.playlist
      if (!playlist && hasPluginMethod(plugin, 'userPlaylist')) {
        const response = await request(plugin, 'userPlaylist', {})
        if (!valid(entry, version, allowed)) return false
        if (response.code !== 200) throw responseError(response)
        playlist = response.liked || undefined
        if (playlist) entry.playlist = playlist
      }
      const member = id === undefined ? undefined : entry.tracks.get(id)
      if (kugou && (!playlist || !liked && !member)) throw new Error('PLUGIN_LIKES_MEMBER_CONTEXT_REQUIRED')
      const params: PluginContext = { op: liked ? 'add' : 'del', tracks: [(liked ? track : member || track).sourceContext] }
      if (playlist) params.playlist = playlist.sourceContext
      if (!valid(entry, version, allowed)) return false
      const response = await request(plugin, 'likeATrack', params)
      if (!valid(entry, version, allowed)) return false
      if (response.code !== 200) throw responseError(response)
      if (id !== undefined) {
        entry.overrides.set(id, liked)
        if (liked) entry.ids.add(id)
        else { entry.ids.delete(id); entry.tracks.delete(id) }
      }
      entry.view.error = ''
      return true
    } finally { entry.view.saving = false }
  }
  return { view: (plugin: MusicPlugin) => entryFor(plugin).view, state,
    load: (plugin: MusicPlugin, allowed?: () => boolean, force?: boolean) => load(plugin, allowed, force), setLiked, invalidate }
}

export const sharedPluginLikes = createPluginLikes()

export function usePluginTrackLikes(options: {
  plugin: () => MusicPlugin | undefined; track: () => PluginItem; accountScope: () => string | undefined
  localOnly: () => boolean; active: () => boolean
}) {
  const current = shallowRef<MusicPlugin>(), view = shallowRef<PluginLikesView>()
  function allowed() {
    const plugin = options.plugin(), expected = options.accountScope()
    return Boolean(hasPluginMethod(plugin, 'likeATrack') && (!expected || expected === plugin?.accountScope) && (!options.localOnly() || plugin?.type === 'local'))
  }
  function load(force = false) {
    const plugin = current.value
    if (plugin && allowed()) return sharedPluginLikes.load(plugin, allowed, force)
    return Promise.resolve()
  }
  watch(() => [options.plugin()?.id, options.plugin()?.accountScope, options.plugin()?.enabled, options.accountScope(), options.localOnly(), options.active()], () => {
    const previous = current.value, plugin = options.plugin()
    if (!plugin || !allowed()) {
      if (previous) sharedPluginLikes.invalidate(previous.id, previous.accountScope)
      current.value = undefined; view.value = undefined; return
    }
    current.value = { ...plugin }; view.value = sharedPluginLikes.view(plugin)
    if (options.active()) void load()
  }, { immediate: true, flush: 'sync' })
  return {
    value: computed(() => current.value && allowed() ? sharedPluginLikes.state(current.value, options.track()) : undefined),
    loading: computed(() => view.value?.loading === true), saving: computed(() => view.value?.saving === true),
    error: computed(() => view.value?.error || ''), load,
    setLiked: (liked: boolean) => current.value && allowed() ? sharedPluginLikes.setLiked(current.value, options.track(), liked, allowed) : Promise.resolve(false)
  }
}
