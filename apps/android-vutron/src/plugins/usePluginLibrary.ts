import { computed, nextTick, onScopeDispose, ref, shallowRef, toRaw, type Ref } from 'vue'
import { musicPluginBridge, type MusicPluginBridge } from './bridge'
import { pluginFeatures, pluginItems, pluginParams, mergePluginItems, hasPluginMethod,
  type MusicPlugin, type PluginContext, type PluginEntityKind, type PluginItem, type PluginResult } from './protocol'

type LibraryPage = { kind: PluginEntityKind; rows: PluginItem[]; count: number; more: boolean; context: PluginContext; detail?: PluginItem; method: string; params: PluginContext; scrollY: number; view: PluginContext; reload?: boolean; cachedRowCount?: number }
type LibrarySnapshot = LibraryPage & { owner: string; accountScope: string; history: LibraryPage[]; status: string }
// Short lived page state only: no mounted DOM, timers, plugin accounts or passwords.
const snapshots = new Map<string, LibrarySnapshot>()
const MAX_SNAPSHOTS = 6
export const libraryCacheBudget = { items: 8_000, estimatedBytes: 12 * 1024 * 1024 } as const
const itemCosts = new WeakMap<PluginItem, number>()
/** Newest first. Shared arrays/items count once; the visible page may exceed the budget. */
export function trimLibraryPageCache(pages: LibraryPage[], limits: { items: number; estimatedBytes: number } = libraryCacheBudget) {
  const arrays = new Set<PluginItem[]>(), items = new Set<PluginItem>()
  let estimatedBytes = 0, evictedPages = 0
  for (const [index, page] of pages.entries()) {
    // Detail responses often contain the very same complete track array. Navigation
    // metadata must not keep that array alive after its rows have been released.
    if (page.detail && (page.detail.tracks || page.detail.songs)) {
      const { tracks: _tracks, songs: _songs, ...metadata } = page.detail
      page.detail = metadata as PluginItem
    }
    if (page.reload && index > 0 || arrays.has(page.rows)) continue
    const additions: PluginItem[] = [], candidates = new Set<PluginItem>()
    let bytes = page.rows.length * 8
    for (const item of page.rows) {
      if (items.has(item) || candidates.has(item)) continue
      let cost = itemCosts.get(item)
      if (cost === undefined) { cost = JSON.stringify(item).length * 2 + 160; itemCosts.set(item, cost) }
      bytes += cost; additions.push(item); candidates.add(item)
      if (index > 0 && (items.size + additions.length > limits.items || estimatedBytes + bytes > limits.estimatedBytes)) break
    }
    if (index > 0 && (items.size + additions.length > limits.items || estimatedBytes + bytes > limits.estimatedBytes)) {
      page.cachedRowCount = page.rows.length; page.rows = []; page.reload = true; evictedPages++
      continue
    }
    arrays.add(page.rows); additions.forEach(item => items.add(item)); estimatedBytes += bytes
  }
  return { retainedItems: items.size, estimatedBytes, evictedPages }
}

export function usePluginLibrary(pluginId: Ref<string>, localOnly: Ref<boolean>, api: MusicPluginBridge = musicPluginBridge, viewKey:Ref<string> = ref('standalone')) {
  const plugins = ref<MusicPlugin[]>([]), plugin = computed(() => plugins.value.find(row => row.id === pluginId.value))
  const busy = ref(false), loading = ref(false), error = ref(''), status = ref(''), profile = ref<PluginContext>()
  const kind = ref<PluginEntityKind>('tracks'), rows = ref<PluginItem[]>([]), count = ref(0), more = ref(false)
  const context = shallowRef<PluginContext>({}), detail = ref<PluginItem>(), method = ref('')
  const requestParams = shallowRef<PluginContext>({})
  const history = shallowRef<LibraryPage[]>([]), viewState = shallowRef<PluginContext>({}), restored = ref(false)
  let generation = 0, metadataGeneration=0, hydration = 0, disposed = false
  let pendingRestore: LibraryPage | undefined
  let stateOwner = '', stateAccount = '', stateView='standalone'
  const snapshotKey=(owner:string,view:string)=>JSON.stringify([owner,view])
  const allowed = computed(() => plugin.value?.enabled && (!localOnly.value || plugin.value.type === 'local'))
  const features = computed(() => pluginFeatures.filter(feature => hasPluginMethod(plugin.value, feature.method)))
  function fail(cause: unknown) { return cause instanceof Error ? cause.message : String(cause || 'Plugin request failed') }
  async function refreshPlugins() {
    const token=++metadataGeneration,result=await api.listMusicPlugins()
    if(disposed||token!==metadataGeneration)return
    plugins.value = result.plugins
    for (const [key, snapshot] of snapshots) {
      const current = plugins.value.find(row => row.id === snapshot.owner)
      if (!current?.enabled || current.accountScope !== snapshot.accountScope) snapshots.delete(key)
    }
  }
  async function call(name: string, params: PluginContext = {}): Promise<PluginResult> {
    if (!allowed.value) throw new Error(localOnly.value ? 'PLUGIN_OFFLINE' : 'PLUGIN_DISABLED')
    const result = await api.callMusicPlugin({ pluginId: pluginId.value, accountScope:plugin.value?.accountScope,method: name, params })
    if (result.code !== 200 && result.code !== 803) throw new Error(result.message || (result.code === 404 ? 'PLUGIN_UNSUPPORTED' : 'PLUGIN_REQUEST_' + result.code))
    return result
  }
  function cancelReads() { generation++; hydration++; loading.value = false }
  function restoreScroll(scrollY: number) {
    const token = generation, owner = pluginId.value, view = viewKey.value
    void nextTick(() => {
      if (disposed || token !== generation || owner !== pluginId.value || view !== viewKey.value) return
      // restoreView also restores the progressive row count before this flush.
      // Apply before the next paint instead of presenting the old scroll first.
      window.scrollTo({ top: scrollY, behavior: 'instant' })
    })
  }
  function currentPage(): LibraryPage {
    return { kind: kind.value, rows: toRaw(rows.value), count: count.value, more: more.value, context: context.value,
      detail: detail.value ? toRaw(detail.value) : undefined, method: method.value, params: requestParams.value, scrollY: pendingRestore?.scrollY ?? window.scrollY, view: viewState.value,
      ...(pendingRestore ? { reload: true, cachedRowCount: pendingRestore.cachedRowCount } : {}) }
  }
  function saveSnapshot() {
    if (!stateOwner || !stateAccount || !method.value&&stateView!=='integrated:search') return
    const key=snapshotKey(stateOwner,stateView)
    snapshots.delete(key)
    snapshots.set(key, { ...currentPage(), owner: stateOwner, accountScope: stateAccount, history: history.value, status: status.value })
    while (snapshots.size > MAX_SNAPSHOTS) snapshots.delete(snapshots.keys().next().value!)
    trimCache()
  }
  function trimCache() {
    trimLibraryPageCache([currentPage(), ...[...history.value].reverse(), ...[...snapshots.values()].reverse().flatMap(snapshot => [snapshot, ...[...snapshot.history].reverse()])])
  }
  function restorePage(page: LibraryPage) {
    pendingRestore = page.reload ? page : undefined
    kind.value = page.kind; rows.value = page.rows; count.value = page.count; more.value = page.more; context.value = page.context
    detail.value = page.detail; method.value = page.method; requestParams.value = page.params; viewState.value = page.view
  }
  function pushHistory() {
    history.value = [...history.value, currentPage()].slice(-30)
  }
  async function hydratePage(page: LibraryPage) {
    const token = ++hydration, owner = pluginId.value, account = plugin.value?.accountScope, view = viewKey.value
    const valid = () => !disposed && token === hydration && owner === pluginId.value && account === plugin.value?.accountScope && view === viewKey.value
    const pending = page.detail
      ? open(page.detail, page.method === 'getPlaylistTracks' ? 'playlists' : page.method === 'artistDetail' ? 'artists' : page.method === 'mvDetail' ? 'mvs' : 'albums', false, token)
      : list(page.method, page.kind, page.params, false, false, token)
    if (!await pending || !valid()) return
    // Replay only the pages previously loaded, retaining provider-owned cursors.
    while (valid() && more.value && rows.value.length < (page.cachedRowCount ?? 0)) {
      const before = rows.value.length
      if (!await list(method.value, kind.value, requestParams.value, true, false, token) || !valid() || rows.value.length <= before) break
    }
    if (valid() && !error.value) { pendingRestore = undefined; restoreScroll(page.scrollY); trimCache() }
  }
  function back(): boolean {
    const previous = history.value.at(-1)
    if (!previous) return false
    cancelReads(); history.value = history.value.slice(0, -1)
    restorePage(previous)
    if (previous.reload) void hydratePage(previous)
    else restoreScroll(previous.scrollY)
    return true
  }
  function backToRoot():boolean {
    const first=history.value[0]
    if(!first)return false
    cancelReads();history.value=[];restorePage(first)
    if (first.reload) void hydratePage(first)
    else restoreScroll(first.scrollY)
    return true
  }
  async function list(name: string, itemKind: PluginEntityKind, params: PluginContext = {}, append = false, remember = true, restoreToken?: number) {
    if (loading.value || !allowed.value) return
    if (restoreToken === undefined) hydration++
    else if (restoreToken !== hydration) return
    const rememberCurrent = !append && remember && Boolean(method.value)
    const token = ++generation, owner = pluginId.value,account=plugin.value?.accountScope,view=viewKey.value
    loading.value = true; error.value = ''
    try {
      const response = await call(name, append ? { ...requestParams.value, ...pluginParams(context.value, { reset: false }) } : params)
      if (disposed || token !== generation || pluginId.value !== owner || plugin.value?.accountScope!==account || viewKey.value!==view) return
      if(rememberCurrent)pushHistory()
      let incoming = pluginItems(response.data ?? response.albums ?? response.songs)
      if (name === 'userPlaylist') incoming = itemKind === 'albums' ? pluginItems(response.albums) : [...(response.liked?[{...response.liked,playlistRole:'liked' as const}]:[]), ...(response.playlists || [])]
      if (name === 'userRecord') incoming = pluginItems((append?requestParams.value:params).period === 'week' ? response.weekData : response.allData)
      const before = rows.value.length
      rows.value = append ? mergePluginItems(rows.value, incoming) : incoming
      kind.value = itemKind; count.value = response.count ?? rows.value.length; context.value = response.sourceContext || {}
      more.value = append ? rows.value.length > before : count.value > rows.value.length || incoming.length > 0 && Object.keys(context.value).length > 0
      method.value = name; if (!append) requestParams.value = params
      if (!append) detail.value = undefined
      if (restoreToken === undefined) pendingRestore = undefined
      trimCache()
      return response
    } catch (cause) { if (token === generation) error.value = fail(cause) }
    finally { if (token === generation) loading.value = false }
  }
  async function open(item: PluginItem, itemKind: PluginEntityKind, remember=true, restoreToken?: number) {
    if (itemKind === 'tracks') return
    if (restoreToken === undefined) hydration++
    else if (restoreToken !== hydration) return
    const token = ++generation, owner = pluginId.value,account=plugin.value?.accountScope,view=viewKey.value
    loading.value = true; error.value = ''
    try {
      const name = itemKind === 'playlists' ? 'getPlaylistDetail' : itemKind === 'albums' ? 'albumDetail' : itemKind === 'artists' ? 'artistDetail' : 'mvDetail'
      const response = await call(name, pluginParams(item.sourceContext, { id: item.id }))
      if (disposed || token !== generation || pluginId.value !== owner || plugin.value?.accountScope!==account || viewKey.value!==view) return
      if(remember && method.value)pushHistory()
      const value = (response.data || response.artist) as PluginItem | undefined
      detail.value = value ? { ...item, ...value, pluginId: owner } : item
      rows.value = pluginItems(value?.tracks ?? value?.songs ?? response.songs)
      kind.value = 'tracks'; count.value = value?.trackCount ?? rows.value.length
      context.value = value?.sourceContext || response.sourceContext || item.sourceContext
      more.value = itemKind === 'playlists' && Number(value?.trackCount || 0) > rows.value.length
      method.value = itemKind === 'playlists' ? 'getPlaylistTracks' : itemKind === 'artists' ? 'artistDetail' : name
      requestParams.value = pluginParams(item.sourceContext, { id: item.id })
      if (remember) restoreScroll(0)
      if (itemKind === 'playlists' && !rows.value.length && hasPluginMethod(plugin.value, 'getPlaylistTracks')) {
        loading.value = false
        const pending = list('getPlaylistTracks', 'tracks', pluginParams(context.value, { id: item.id }), false, false, hydration)
        const tracksGeneration = generation
        await pending
        if (disposed || tracksGeneration !== generation || pluginId.value !== owner) return
        detail.value = {...item,...value}
        if(Number.isFinite(detail.value.trackCount)){count.value=detail.value.trackCount!;more.value=count.value>rows.value.length}
      }
      if (restoreToken === undefined) pendingRestore = undefined
      trimCache()
      return true
    } catch (cause) { if (token === generation) error.value = fail(cause) }
    finally { if (token === generation) loading.value = false }
  }
  async function mutate(name: string, params: PluginContext, refresh = true) {
    if (busy.value) return false
    busy.value = true; error.value = ''
    const owner = pluginId.value,account=plugin.value?.accountScope,view=viewKey.value
    try {
      await call(name, params)
      if (pluginId.value !== owner || disposed || plugin.value?.accountScope!==account || viewKey.value!==view) return false
      if (refresh && method.value) {
        if (detail.value && method.value === 'getPlaylistTracks') await open(detail.value, 'playlists',false)
        else await list(method.value, kind.value, requestParams.value, false, false)
        if (error.value) return false
      }
      return true
    } catch (cause) { if(pluginId.value===owner&&plugin.value?.accountScope===account&&viewKey.value===view&&!disposed)error.value = fail(cause); return false }
    finally { busy.value = false }
  }
  async function initialize(restore = false, initialPage = true) {
    saveSnapshot()
    cancelReads(); rows.value = []; detail.value = undefined; history.value = []; method.value = ''; profile.value = undefined; restored.value = false; viewState.value = {}; error.value = '';count.value=0;more.value=false;context.value={};requestParams.value={};kind.value='tracks';status.value=''
    pendingRestore = undefined
    stateOwner = ''; stateAccount = ''
    const token=generation,owner=pluginId.value,view=viewKey.value
    try {
      await refreshPlugins()
      if(disposed||token!==generation||owner!==pluginId.value||view!==viewKey.value)return
      stateOwner = owner; stateAccount = plugin.value?.accountScope || '';stateView=view
      if (!allowed.value) return
      const key=snapshotKey(owner,view),snapshot = snapshots.get(key)
      if (restore && stateAccount && snapshot?.accountScope === stateAccount) {
        restorePage(snapshot); history.value = snapshot.history; status.value = snapshot.status; restored.value = true
        snapshots.delete(key); snapshots.set(key, snapshot)
        if (snapshot.reload) await hydratePage(snapshot)
        return
      }
      if (!initialPage) return
      if (hasPluginMethod(plugin.value, 'systemPing')) {
        try { const response = await call('systemPing'); if(token===generation&&owner===pluginId.value)status.value = plugin.value?.type==='local' ? '' : String(response.status || '') }
        catch { if(token===generation&&owner===pluginId.value)status.value = 'offline' }
      }
      if(disposed||token!==generation||owner!==pluginId.value)return
      const first = features.value.find(item => item.method === (plugin.value?.type === 'library' ? 'getRecommendPlaylist' : 'getAllTracks')) || features.value[0]
      if (first) await list(first.method, first.kind, {reset:true,sort:'name',order:'ASC',pageSize:80}, false, false)
    } catch (cause) { if(token===generation&&owner===pluginId.value)error.value = fail(cause) }
  }
  onScopeDispose(() => { saveSnapshot(); disposed = true; cancelReads() })
  return { plugin, plugins, allowed, busy, loading, error, status, profile, kind, rows, count, more, context, detail, method,
    requestParams, history, features, call, refreshPlugins, list, open, mutate, initialize, back, backToRoot, cancelReads, viewState, restored, saveSnapshot }
}
