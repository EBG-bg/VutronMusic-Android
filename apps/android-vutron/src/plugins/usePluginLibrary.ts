import { computed, onScopeDispose, ref, shallowRef, toRaw, type Ref } from 'vue'
import { musicPluginBridge, type MusicPluginBridge } from './bridge'
import { pluginFeatures, pluginItems, pluginParams, mergePluginItems, hasPluginMethod,
  type MusicPlugin, type PluginContext, type PluginEntityKind, type PluginItem, type PluginResult } from './protocol'

type LibraryPage = { kind: PluginEntityKind; rows: PluginItem[]; count: number; more: boolean; context: PluginContext; detail?: PluginItem; method: string; params: PluginContext; scrollY: number; view: PluginContext }
type LibrarySnapshot = LibraryPage & { owner: string; accountScope: string; history: LibraryPage[]; status: string }
// Short lived page state only: no mounted DOM, timers, plugin accounts or passwords.
const snapshots = new Map<string, LibrarySnapshot>()
const MAX_SNAPSHOTS = 6

export function usePluginLibrary(pluginId: Ref<string>, localOnly: Ref<boolean>, api: MusicPluginBridge = musicPluginBridge, viewKey:Ref<string> = ref('standalone')) {
  const plugins = ref<MusicPlugin[]>([]), plugin = computed(() => plugins.value.find(row => row.id === pluginId.value))
  const busy = ref(false), loading = ref(false), error = ref(''), status = ref(''), profile = ref<PluginContext>()
  const kind = ref<PluginEntityKind>('tracks'), rows = ref<PluginItem[]>([]), count = ref(0), more = ref(false)
  const context = shallowRef<PluginContext>({}), detail = ref<PluginItem>(), method = ref('')
  const requestParams = shallowRef<PluginContext>({})
  const history = shallowRef<LibraryPage[]>([]), viewState = shallowRef<PluginContext>({}), restored = ref(false)
  let generation = 0, metadataGeneration=0, disposed = false
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
  function cancelReads() { generation++; loading.value = false }
  function currentPage(): LibraryPage {
    return { kind: kind.value, rows: toRaw(rows.value), count: count.value, more: more.value, context: context.value,
      detail: detail.value ? toRaw(detail.value) : undefined, method: method.value, params: requestParams.value, scrollY: window.scrollY, view: viewState.value }
  }
  function saveSnapshot() {
    if (!stateOwner || !stateAccount || !method.value&&stateView!=='integrated:search') return
    const key=snapshotKey(stateOwner,stateView)
    snapshots.delete(key)
    snapshots.set(key, { ...currentPage(), owner: stateOwner, accountScope: stateAccount, history: history.value, status: status.value })
    while (snapshots.size > MAX_SNAPSHOTS) snapshots.delete(snapshots.keys().next().value!)
  }
  function restorePage(page: LibraryPage) {
    kind.value = page.kind; rows.value = page.rows; count.value = page.count; more.value = page.more; context.value = page.context
    detail.value = page.detail; method.value = page.method; requestParams.value = page.params; viewState.value = page.view
  }
  function pushHistory() {
    history.value = [...history.value, currentPage()].slice(-30)
  }
  function back(): boolean {
    const previous = history.value.at(-1)
    if (!previous) return false
    cancelReads(); history.value = history.value.slice(0, -1)
    restorePage(previous)
    requestAnimationFrame(() => window.scrollTo({ top: previous.scrollY, behavior: 'instant' }))
    return true
  }
  function backToRoot():boolean {
    const first=history.value[0]
    if(!first)return false
    cancelReads();history.value=[];restorePage(first)
    requestAnimationFrame(()=>window.scrollTo({top:first.scrollY,behavior:'instant'}))
    return true
  }
  async function list(name: string, itemKind: PluginEntityKind, params: PluginContext = {}, append = false, remember = true) {
    if (loading.value || !allowed.value) return
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
      return response
    } catch (cause) { if (token === generation) error.value = fail(cause) }
    finally { if (token === generation) loading.value = false }
  }
  async function open(item: PluginItem, itemKind: PluginEntityKind, remember=true) {
    if (itemKind === 'tracks') return
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
      if (itemKind === 'playlists' && !rows.value.length && hasPluginMethod(plugin.value, 'getPlaylistTracks')) {
        loading.value = false
        const pending = list('getPlaylistTracks', 'tracks', pluginParams(context.value, { id: item.id }), false, false)
        const tracksGeneration = generation
        await pending
        if (disposed || tracksGeneration !== generation || pluginId.value !== owner) return
        detail.value = {...item,...value}
        if(Number.isFinite(detail.value.trackCount)){count.value=detail.value.trackCount!;more.value=count.value>rows.value.length}
      }
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
      }
      return true
    } catch (cause) { if(pluginId.value===owner&&plugin.value?.accountScope===account&&viewKey.value===view&&!disposed)error.value = fail(cause); return false }
    finally { busy.value = false }
  }
  async function initialize(restore = false, initialPage = true) {
    saveSnapshot()
    cancelReads(); rows.value = []; detail.value = undefined; history.value = []; method.value = ''; profile.value = undefined; restored.value = false; viewState.value = {}; error.value = '';count.value=0;more.value=false;context.value={};requestParams.value={};kind.value='tracks';status.value=''
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
