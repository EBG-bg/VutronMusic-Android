import { translate as t } from '../platform/i18n'
import { computed, ref, watch } from 'vue'
import { recordPlaylistPlayback } from '../composables/playlistOrdering'
import { appNavigation } from '../composables/navigationGuard'
import { offerUndo } from '../platform/undo'
import { undoText } from '../platform/undoMessages'
import { askAction } from '../platform/actionDialog'
import { defineStore } from 'pinia'
import type { MusicPlugin, PluginItem, PluginPlayback } from '../plugins/protocol'
import { createAuthSession } from './domains/authSession'
import { createLocalLibrary } from './domains/localLibrary'
import { createNeteaseLibrary } from './domains/neteaseLibrary'
import { loadPlaylistTrackBatches } from './domains/playlistTrackLoading'
import { playlistLoadingText } from '../platform/playlistLoadingMessages'
import { createShellNavigation } from './domains/shellNavigation'
import { createShellSearch } from './domains/shellSearch'
import { createShellCache } from './domains/shellCache'
import { createShellOverlay } from './domains/shellOverlay'
import { sharePlaybackSnapshot } from './domains/playbackSnapshot'
import type { ShellEntity } from './domains/shellTypes'
import { libraryMutationBusy } from '../platform/libraryActivity'
import { createPlaybackLyrics } from './domains/playbackLyrics'
import {
  vutronPlugin,
  type VutronHomeData, type VutronLocalCollection, type VutronPlaybackState,
  type VutronPlaylist, type VutronOnlineLibrary, type VutronTrack, type VutronQueue,
} from '../platform/vutronPlugin'

const emptyHomeData = (): VutronHomeData => ({ banners: [], playlists: [], artists: [], albums: [], charts: [], dailyTracks: [] })
const emptyPlaybackState: VutronPlaybackState = {
  playing: false, trackId: 0, title: '', artist: '', duration: 0, position: 0, error: '',
}

function errorMessage(error: unknown, fallback: string): string {
  if (typeof error === 'string' && error.trim()) return error
  if (error && typeof error === 'object' && 'message' in error) {
    const message = (error as { message?: unknown }).message
    if (typeof message === 'string' && message.trim()) return message
  }
  return fallback
}

export const useAndroidShellStore = defineStore('androidShell', () => {
  const loading = ref(false)
  const error = ref('')
  const playlists = ref<VutronPlaylist[]>([])
  const playlistsLoading = ref(false)
  let playlistReadVersion = 0
  const tracks = ref<VutronTrack[]>([])
  const selectedPlaylist = ref<VutronPlaylist>()
  const playlistLoadIncomplete = computed(() => Boolean(selectedPlaylist.value?.tracksIncomplete && !selectedPlaylist.value.offlineSnapshot))
  const playlistLoadError = computed(() => playlistLoadIncomplete.value ? selectedPlaylist.value?.tracksLoadError || '' : '')
  const selectedLocalCollection = ref<VutronLocalCollection>()
  const selectedEntity = ref<ShellEntity>()
  const playback = ref<VutronPlaybackState>({ ...emptyPlaybackState })
  const abLoopEnabled = ref(false)
  let abLoopRevision = 0
  function applyAbLoopState(next: import('../platform/vutronPlugin').VutronAbLoopState) {
    if (next.trackId !== playback.value.trackId) return
    ++abLoopRevision
    abLoopEnabled.value = next.enabled
    playback.value.abLoop = next.enabled ? next : undefined
    playback.value.abLoopEnabled = next.enabled
    if (next.positionMs !== undefined && Number.isFinite(next.positionMs)) playback.value.position = Math.max(0, next.positionMs)
  }
  watch([() => playback.value.trackId, () => playback.value.track?.pluginId, () => playback.value.track?.pluginAccountScope, () => playback.value.track?.pluginTrackId], () => { abLoopEnabled.value = false }, { flush: 'sync' })
  const playbackQueue = ref<VutronQueue>({ tracks: [], index: -1, upNext: [], mode: 0 })
  const queueOpen = ref(false)
  const queueNotice = ref('')
  const cachedPlaylists = ref<VutronPlaylist[]>([])
  const cachedPlaylistsLoading = ref(false)
  const homeData = ref(emptyHomeData())
  let homeReadVersion = 0
  const homeLoading = ref(false)
  const cacheAllPlaylistsLoading = ref(false)
  const cacheAllPlaylistsResult = ref('')
  const cachingPlaylistId = ref<number>()
  const autoMatchSources = ref(true)
  const { lyrics, lyricsLoading, updateLyrics, clearLyrics } = createPlaybackLyrics(() => hasAccess.value)
  let offlineReadVersion = 0
  let playbackTimer: ReturnType<typeof setInterval> | undefined
  let playbackRequestPending = false
  let confirmedPlaybackKey: string | undefined
  let queueReadKey = ''
  let trackListRequestId = 0
  const playbackPlaylistCache = new Map<string, symbol | true>()

  const authSession = createAuthSession({
    loading, error, formatError: errorMessage, restoreLocalState, resetToLocalLibrary: () => navigation.resetToLocalLibrary(), startPlaybackPolling,
    loadOnlineState: async () => { if (!activeMusicSourceId.value) await Promise.all([loadPlaylists(), loadHomeData(), onlineLibrary.loadLikedTracks()]) },
    resetToOnlineHome: () => { navigationHistory.value = []; activeMusicSourceId.value = ''; activeTab.value = 'home' },
    beforeLogout: async () => {
      await flushLiveSettings()
      ++trackListRequestId; search.incrementSearchRequest(); clearLyrics()
      cache.bumpCacheReadRevision(); playbackPlaylistCache.clear()
    },
    clearOnlineState: () => { playlistReadVersion++; playlistsLoading.value = false; playlists.value = [] },
    onAutomaticOffline: () => {
      playlistReadVersion++; playlistsLoading.value = false
      if (activeMusicSourceId.value) return
      if (['home', 'search', 'entity'].includes(activeTab.value) || activeTab.value === 'library' && selectedPlaylist.value && !selectedPlaylist.value.offlineSnapshot) resetToLocalLibrary()
    }
  })
  const {
    profile, localOnly, manualLocalOnly, networkConnected, loginRequested, localModeLoading, loggedIn, hasAccess, loginVisible, onlineAvailable,
    qrLoginKey, qrLoginImage, qrLoginStatus, qrLoginLoading,
    restore, enterLocalOnly, useAutomaticMode, refreshConnectivity, disposeNetworkMonitoring, requestLogin, login, createQrLogin, checkQrLogin, cancelQrLogin, logout
  } = authSession

  const search = createShellSearch({ onlineAvailable, error, t, formatError: errorMessage, getAccountId: () => profile.value?.userId })
  const { searchCategory, searchKeywords, submittedSearch, searchResults, searchCount,
    searchNextPage, searchLoading, runSearch, loadMoreSearch } = search
  const navigation = createShellNavigation({
    loading, searchLoading, localOnly, loginRequested, onlineAvailable,
    selectedPlaylist, selectedEntity, selectedLocalCollection, tracks,
    incrementTrackListRequest: () => { ++trackListRequestId },
    incrementSearchRequest: search.incrementSearchRequest,
  })
  const { activeTab, activePluginId, activeMusicSourceId, playlistOrigin, navigationHistory,
    navigationDirection, navigationScrollY, tabScrollFor, canNavigateBack,
    rememberPage, navigateTo, navigateBack, openPlugins, selectMusicSource,
    discardMusicSource, retainMusicSources, resetToLocalLibrary } = navigation
  const { localLibrary, libraryLoading, localScanLoading, localTracks, folderName,
    pickMusicFolder, loadLocalMusic, loadLocalLibrary, importLocalPlaylist
  } = createLocalLibrary({ error, onlineAvailable, formatError: errorMessage,
    openCollection: openLocalCollection, notice: message => { queueNotice.value = message } })
  const overlay = createShellOverlay({ playback, error, t, formatError: errorMessage, playbackTrackKey })
  const { overlaySettings, overlayEnabled, overlayPlayedColor, overlayUnplayedColor,
    overlayShadowColor, overlayBackgroundOpacity, loadOverlaySettings, toggleLyricOverlay,
    updateOverlayField, temporarilyHideOverlay, restoreOverlay, updateOverlayColor,
    updateOverlayBackgroundOpacity, updateCurrentLyricOffset,
    setCurrentTrackVolume, setCurrentPlaylistVolume, flushLiveSettings } = overlay
  const cache = createShellCache({
    playback, activeTab, onlineAvailable, error, t, formatError: errorMessage,
    resolveCacheTrack: () => playback.value.track ?? [...tracks.value, ...localTracks.value]
      .find(item => item.id === playback.value.trackId),
    loadOfflinePlaylists,
  })
  const { cacheStatus, cacheCapacityMb, artworkCacheCapacityMb, cachedTracks,
    loadCacheStatus, refreshCacheAfterMutation, setAutomaticCache, setLibraryAutomaticCache, setCacheCapacity, setArtworkCacheCapacity,
    cacheCurrent, clearCache, sleepTimerBusy, sleepTimerMinutes, sleepTimerActive, sleepTimerMode, sleepTimerRemainingTracks, sleepTimerFadeSeconds,
    sleepTimerRemainingMs, sleepTimerLabel, stopSleepClock, startSleepClock,
    setSleepTimer, setSleepTimerSeconds, setSleepTimerSettings, clearSleepTimer } = cache

  function playbackTrackKey(state = playback.value): string {
    const track = state.track
    return [state.trackId, track?.localUri ?? '', track?.localPath ?? '', track?.neteaseId ?? ''].join('|')
  }

  function queueStateKey(state = playback.value): string {
    return JSON.stringify([state.queueToken, state.queueIndex, state.queueCount, state.upNextCount, state.mode, playbackTrackKey(state)])
  }

  async function restoreLocalState() {
    try { await vutronPlugin.restorePlayback() } catch { /* No saved playback cursor. */ }
    void loadOfflinePlaylists()
    await Promise.all([loadPlaybackQueue(), refreshPlaybackState(), loadCacheStatus(), loadLocalMusic(), loadOverlaySettings(), loadSourceSettings()])
  }

  const onlineLibrary = createNeteaseLibrary({ profile, onlineAvailable, playlists, tracks, selectedPlaylist, error,
    invalidateReads: () => { playlistReadVersion++; playlistsLoading.value = false },
    applySnapshot: applyOnlineSnapshot, notice: message => { queueNotice.value = message }, formatError: errorMessage })

  function applyOnlineSnapshot(snapshot: VutronOnlineLibrary) {
    playlistReadVersion++; playlistsLoading.value = false
    playlists.value = snapshot.playlists!
    const deleted = snapshot.deletedPlaylistId || 0
    navigationHistory.value = navigationHistory.value.filter(entry => !deleted || entry.playlist?.id !== deleted).map(entry => {
      return snapshot.playlist && entry.playlist?.id === snapshot.playlist.id
        ? { ...entry, playlist: snapshot.playlist, tracks: snapshot.tracks ?? entry.tracks } : entry
    })
    if (deleted && selectedPlaylist.value?.id === deleted) {
      selectedPlaylist.value = undefined; tracks.value = []; trackListRequestId++; loading.value = false
      if (activeTab.value === 'playlist') navigateBack()
    } else if (snapshot.playlist && selectedPlaylist.value?.id === snapshot.playlist.id) {
      selectedPlaylist.value = snapshot.playlist
      if (snapshot.tracks) { tracks.value = snapshot.tracks; trackListRequestId++; loading.value = false }
    }
    void loadOfflinePlaylists()
  }

  async function loadPlaylists() {
    if (!onlineAvailable.value || !profile.value || playlistsLoading.value) return
    const request = ++playlistReadVersion, uid = profile.value.userId
    playlistsLoading.value = true
    try {
      const result = await vutronPlugin.getPlaylists({ userId: uid })
      if (request === playlistReadVersion && onlineAvailable.value && profile.value?.userId === uid) {
        playlists.value = result.playlists
        return result.cached ? 'cached' : 'updated'
      }
    }
    catch (cause) { if (request === playlistReadVersion && onlineAvailable.value && profile.value?.userId === uid) error.value = errorMessage(cause, t('mobile.runtimeText.playlistsReadFailed')) }
    finally { if (request === playlistReadVersion) playlistsLoading.value = false }
  }

  let snapshotScopes: Map<string, string> | undefined
  function visiblePlaylistSnapshot(playlist: VutronPlaylist) {
    if (!playlist.pluginCacheKey || !snapshotScopes) return true
    return Boolean(playlist.pluginId && playlist.pluginAccountScope && snapshotScopes.get(playlist.pluginId) === playlist.pluginAccountScope)
  }
  function syncOfflinePlaylistSources(plugins: MusicPlugin[]) {
    const scopes = new Map(plugins.filter(plugin => plugin.enabled && plugin.installed !== false && plugin.accountScope)
      .map(plugin => [plugin.id, plugin.accountScope!]))
    if (snapshotScopes && scopes.size === snapshotScopes.size && [...scopes].every(([id, scope]) => snapshotScopes?.get(id) === scope)) return
    const initialized = Boolean(snapshotScopes)
    snapshotScopes = scopes
    if (cachedPlaylists.value.some(item => !visiblePlaylistSnapshot(item))) cachedPlaylists.value = cachedPlaylists.value.filter(visiblePlaylistSnapshot)
    const trackVisible = (track: VutronTrack) => track.source !== 'plugin-snapshot'
      || Boolean(track.pluginId && snapshotScopes?.get(track.pluginId) === track.pluginAccountScope)
    navigationHistory.value = navigationHistory.value.filter(entry => !entry.playlist || visiblePlaylistSnapshot(entry.playlist)).map(entry =>
      entry.playlist?.pluginCacheKey && entry.tracks.some(track => !trackVisible(track)) ? { ...entry, tracks: entry.tracks.filter(trackVisible) } : entry)
    if (selectedPlaylist.value?.pluginCacheKey && tracks.value.some(track => !trackVisible(track))) tracks.value = tracks.value.filter(trackVisible)
    if (selectedPlaylist.value && !visiblePlaylistSnapshot(selectedPlaylist.value)) {
      if (activeTab.value === 'playlist') navigateBack()
      else { selectedPlaylist.value = undefined; tracks.value = []; ++trackListRequestId }
    }
    if (initialized) void loadOfflinePlaylists()
  }
  async function loadOfflinePlaylists() {
    if (!vutronPlugin.getCachedPlaylists) return
    const request = ++offlineReadVersion
    cachedPlaylistsLoading.value = true
    try { const result = await vutronPlugin.getCachedPlaylists(); if (request === offlineReadVersion) cachedPlaylists.value = (result.playlists ?? []).filter(visiblePlaylistSnapshot) }
    catch { /* Offline snapshots are optional on older builds. */ }
    finally { if (request === offlineReadVersion) cachedPlaylistsLoading.value = false }
  }

  async function refreshRestoredAccount() {
    // The backup can switch accounts while this WebView and its pending requests stay alive.
    ++homeReadVersion; homeLoading.value = false; homeData.value = emptyHomeData()
    ++playlistReadVersion; playlistsLoading.value = false; playlists.value = []
    ++offlineReadVersion; cachedPlaylistsLoading.value = false; cachedPlaylists.value = []
    ++trackListRequestId; tracks.value = []; selectedPlaylist.value = undefined; selectedEntity.value = undefined
    search.resetSearch(); navigationHistory.value = []; playbackPlaylistCache.clear()
    loading.value = false; error.value = ''
    await authSession.restore(true)
  }

  async function loadHomeData() {
    if (!onlineAvailable.value || !vutronPlugin.getHomeData || homeLoading.value) return
    const version = ++homeReadVersion, owner = profile.value?.userId
    const current = () => version === homeReadVersion && onlineAvailable.value && profile.value?.userId === owner
    homeLoading.value = true
    try {
      const result = await vutronPlugin.getHomeData()
      if (current()) {
        const hasContent = Object.values(homeData.value).some(value => Array.isArray(value) && value.length > 0)
        if (!result.cached || !hasContent) homeData.value = result
        return result.cached ? 'cached' : 'updated'
      }
    }
    catch (cause) {
      if (!current()) return
      error.value = errorMessage(cause, t('mobile.runtimeText.homeLoadFailed'))
      if (!homeData.value.playlists.length) homeData.value.playlists = cachedPlaylists.value.filter(item => !item.pluginCacheKey).slice(0, 10)
    }
    finally { if (version === homeReadVersion) homeLoading.value = false }
  }

  async function openPlaylist(playlist: VutronPlaylist) {
    if (playlist.pluginCacheKey || !onlineAvailable.value) { await openCachedPlaylist(playlist); return }
    // Retry refreshes the current detail without pushing an identical back entry.
    if (activeTab.value !== 'playlist' || selectedPlaylist.value?.id !== playlist.id) rememberPage()
    const requestId = ++trackListRequestId
    const accountId = profile.value?.userId
    const isCurrent = () => requestId === trackListRequestId && onlineAvailable.value && profile.value?.userId === accountId
    const requestToken = `playlist:${accountId || 0}:${playlist.id}:${requestId}:${Date.now()}`
    selectedPlaylist.value = { ...playlist, tracksIncomplete: true, tracksLoadError: '' }; selectedEntity.value = undefined; tracks.value = []
    activeTab.value = 'playlist'; loading.value = true; error.value = ''
    try {
      const result = await loadPlaylistTrackBatches({ playlist, userId: accountId || 0, requestToken, isCurrent,
        publish: (rows, metadata) => { if (isCurrent()) { tracks.value = rows; if (metadata) selectedPlaylist.value = { ...metadata, tracksIncomplete: true, tracksLoadError: '' } } } })
      if (!result || !isCurrent()) return
      if (result.incomplete) {
        const message = playlistLoadingText('incomplete', { count: result.tracks.length })
        selectedPlaylist.value = { ...selectedPlaylist.value!, tracksIncomplete: true, tracksLoadError: message }
        error.value = result.message || message
      } else {
        selectedPlaylist.value = { ...(result.playlist || selectedPlaylist.value!), trackCount: result.tracks.length, tracksIncomplete: false, tracksLoadError: '' }
        if (result.cacheSaved) playbackPlaylistCache.set(`${accountId}:${playlist.id}`, true)
        void loadOfflinePlaylists()
      }
    } catch (cause) { if (isCurrent()) { const message = errorMessage(cause, t('mobile.runtimeText.tracksReadFailed')); selectedPlaylist.value = { ...selectedPlaylist.value!, tracksIncomplete: true, tracksLoadError: message }; error.value = message } }
    finally { if (requestId === trackListRequestId) loading.value = false }
  }

  async function reloadManagedLibrary(removed: { track?: VutronTrack; tracks?: VutronTrack[]; collectionId?: string; refreshLocalSnapshots?: boolean } = {}) {
    const sameLocal = (track: VutronTrack, target: VutronTrack) => track.localKey && target.localKey ? track.localKey === target.localKey
      : (track.localPlaylistId?.startsWith('restored:') || !track.localUri) ? !!target.localEntryKey && target.localEntryKey === track.localEntryKey && track.localPlaylistId === target.localPlaylistId
      : !!track.localUri && track.localUri === target.localUri && track.cueTrackNo === target.cueTrackNo && track.localPlaylistId === target.localPlaylistId
    const matches = (track: VutronTrack) => removed.collectionId
      ? track.localFolderId === removed.collectionId || track.localPlaylistId === removed.collectionId || track.playlistVolumeKey === removed.collectionId
      : (removed.tracks ?? (removed.track ? [removed.track] : [])).some(target => sameLocal(track, target))
    navigationHistory.value = navigationHistory.value.filter(entry => !removed.collectionId || entry.localCollection?.id !== removed.collectionId)
      .map(entry => ({ ...entry, tracks: entry.tracks.filter(track => !matches(track)) }))
    await loadLocalMusic(false, false)
    if (removed.refreshLocalSnapshots) {
      const ids = [...new Set(navigationHistory.value.flatMap(entry => entry.localCollection ? [entry.localCollection.id] : []))]
      const refreshed = new Map(await Promise.all(ids.map(async id => {
        const source = [...localLibrary.value.folders, ...localLibrary.value.playlists].find(item => item.id === id)
        const result = source?.isLocalBundle ? await vutronPlugin.getLocalPlaylistTracks?.({ playlistId: id }) : await vutronPlugin.getLocalFolderTracks?.({ folderId: id })
        return [id, result?.tracks ?? []] as const
      })))
      navigationHistory.value = navigationHistory.value.map(entry => entry.localCollection && refreshed.has(entry.localCollection.id) ? { ...entry, tracks: refreshed.get(entry.localCollection.id)! } : entry)
    }
    const collection = selectedLocalCollection.value
    if (collection) {
      const exists = [...localLibrary.value.folders, ...localLibrary.value.playlists].find(item => item.id === collection.id)
      if (!exists) { selectedLocalCollection.value = undefined; tracks.value = []; activeTab.value = 'library'; ++trackListRequestId }
      else {
        const requestId = ++trackListRequestId
        const result = exists.isLocalBundle ? await vutronPlugin.getLocalPlaylistTracks?.({ playlistId: exists.id }) : await vutronPlugin.getLocalFolderTracks?.({ folderId: exists.id })
        if (requestId === trackListRequestId) { selectedLocalCollection.value = exists; tracks.value = result?.tracks ?? [] }
      }
    } else tracks.value = tracks.value.filter(track => !matches(track))
    await loadPlaybackQueue(); await refreshPlaybackState(); await loadCacheStatus(false)
  }

  async function cachePlaylist(playlist: VutronPlaylist) {
    if (!onlineAvailable.value || !vutronPlugin.cachePlaylist || cachingPlaylistId.value !== undefined || cachingPluginPlaylist.value || libraryMutationBusy.value) return false
    const owner = profile.value?.userId
    cachingPlaylistId.value = playlist.id
    try {
      const result = await vutronPlugin.cachePlaylist({ playlistId: playlist.id })
      if (result.cancelled || profile.value?.userId !== owner) return false
      playbackPlaylistCache.set(`${owner}:${playlist.id}`, true)
      await Promise.all([loadOfflinePlaylists(), refreshCacheAfterMutation(false)])
      if (profile.value?.userId !== owner) return false
      queueNotice.value = t('mobile.playlistCache.saved', { count: result.count ?? 0 })
      return true
    } catch (cause) {
      if (profile.value?.userId === owner) error.value = errorMessage(cause, t('mobile.runtimeText.playlistCacheFailed'))
      return false
    } finally { cachingPlaylistId.value = undefined }
  }

  const cachingPluginPlaylist = ref(false)
  async function cachePluginPlaylist(pluginId: string, accountScope: string, playlist: PluginItem) {
    const sameOwner = () => !snapshotScopes || snapshotScopes.get(pluginId) === accountScope
    if (!vutronPlugin.cachePluginPlaylist || !networkConnected.value || manualLocalOnly.value || !sameOwner()
      || cachingPluginPlaylist.value || cachingPlaylistId.value !== undefined || libraryMutationBusy.value) return false
    const { id, name, picUrl, trackCount, sourceContext } = playlist
    cachingPluginPlaylist.value = true
    try {
      const result = await vutronPlugin.cachePluginPlaylist({ pluginId, accountScope, playlist: { id, name, picUrl, trackCount, sourceContext } })
      if (result.cancelled || !sameOwner()) return false
      await Promise.all([loadOfflinePlaylists(), refreshCacheAfterMutation(false)])
      if (!sameOwner()) return false
      queueNotice.value = t('mobile.playlistCache.saved', { count: result.count })
      return true
    } catch (cause) {
      if (sameOwner()) error.value = errorMessage(cause, t('mobile.runtimeText.playlistCacheFailed'))
      return false
    } finally { cachingPluginPlaylist.value = false }
  }

  async function cacheAllPlaylists() {
    if (!onlineAvailable.value || !vutronPlugin.cacheAllPlaylists || cacheAllPlaylistsLoading.value) return
    cacheAllPlaylistsLoading.value = true
    cacheAllPlaylistsResult.value = ''
    try {
      const result = await vutronPlugin.cacheAllPlaylists()
      if (result.cancelled) {
        cacheAllPlaylistsResult.value = t('mobile.runtimeText.batchCacheCancelled')
        await Promise.all([loadOfflinePlaylists(), refreshCacheAfterMutation()])
        return
      }
      cacheAllPlaylistsResult.value = t('mobile.runtimeText.batchCached', { playlists: result.cachedPlaylists, tracks: result.cachedTracks }) + (result.failedPlaylists ? t('mobile.runtimeText.batchIncomplete', { count: result.failedPlaylists }) : '') + (result.pendingCovers ? t('mobile.runtimeText.batchCoversPending', { count: result.pendingCovers }) : '')
      await Promise.all([loadOfflinePlaylists(), refreshCacheAfterMutation()])
    } catch (cause) { error.value = errorMessage(cause, t('mobile.runtimeText.batchCacheFailed')) }
    finally { cacheAllPlaylistsLoading.value = false }
  }

  async function openCachedPlaylist(playlist: VutronPlaylist) {
    if (!visiblePlaylistSnapshot(playlist)) return
    if (activeTab.value !== 'playlist' || selectedPlaylist.value?.id !== playlist.id
      || selectedPlaylist.value?.pluginCacheKey !== playlist.pluginCacheKey) rememberPage()
    const requestId = ++trackListRequestId
    selectedPlaylist.value = { ...playlist, offlineSnapshot: true }
    selectedEntity.value = undefined
    tracks.value = []
    activeTab.value = 'playlist'
    loading.value = true
    try {
      const result = await vutronPlugin.getCachedPlaylistTracks?.({ playlistId: playlist.id, pluginCacheKey: playlist.pluginCacheKey })
      if (requestId === trackListRequestId && visiblePlaylistSnapshot(playlist)) tracks.value = result?.tracks ?? []
    } catch (cause) { if (requestId === trackListRequestId) error.value = errorMessage(cause, t('mobile.runtimeText.offlinePlaylistReadFailed')) }
    finally { if (requestId === trackListRequestId) loading.value = false }
  }

  async function openEntityTracks(category: 'albums' | 'artists', id: number, name: string, picUrl?: string) {
    if (!onlineAvailable.value || !vutronPlugin.getEntityTracks) return
    rememberPage()
    const requestId = ++trackListRequestId
    loading.value = true
    tracks.value = []
    activeTab.value = 'entity'
    selectedEntity.value = { category, id, name, picUrl }
    selectedPlaylist.value = undefined
    try {
      const result = await vutronPlugin.getEntityTracks({ category, id })
      if (requestId === trackListRequestId) tracks.value = result.tracks
    } catch (cause) { if (requestId === trackListRequestId) error.value = errorMessage(cause, t('mobile.runtimeText.searchTracksReadFailed')) }
    finally { if (requestId === trackListRequestId) loading.value = false }
  }

  function removeCachedPlaylistView(playlist: VutronPlaylist) {
    const same = (row?: VutronPlaylist) => Boolean(row && row.id === playlist.id && row.pluginCacheKey === playlist.pluginCacheKey)
    offlineReadVersion++
    cachedPlaylistsLoading.value = false
    cachedPlaylists.value = cachedPlaylists.value.filter(row => !same(row))
    navigationHistory.value = navigationHistory.value.filter(entry => !(entry.playlist?.offlineSnapshot && same(entry.playlist)))
    if (selectedPlaylist.value?.offlineSnapshot && same(selectedPlaylist.value)) {
      ++trackListRequestId; selectedPlaylist.value = undefined; tracks.value = []; loading.value = false
      if (activeTab.value === 'playlist') navigateBack()
    }
  }

  async function openMv(id: number) {
    if (!onlineAvailable.value || !vutronPlugin.openMv) return
    try { await vutronPlugin.openMv({ id }) }
    catch (cause) { error.value = errorMessage(cause, t('mobile.runtimeText.openMvFailed')) }
  }

  function snapshotPlaybackContext(playlist?: VutronPlaylist) {
    if (!playlist?.pluginCacheKey) return
    const key = 'plugin:' + playlist.pluginCacheKey
    return { playlistVolumeKey: key, playlistVolumeName: playlist.name, playlistOrderScope: key, playlistOrderKey: key }
  }

  async function play(track: VutronTrack, playlistKey?: string, suppliedQueue?: VutronTrack[], position?: number) {
    if (libraryMutationBusy.value) return
    const fromPlaylist = activeTab.value === 'playlist' && selectedPlaylist.value
      && tracks.value.some(item => item.id === track.id)
    const fromLocalCollection = activeTab.value === 'localCollection' ? selectedLocalCollection.value : undefined
    const context = snapshotPlaybackContext(fromPlaylist ? selectedPlaylist.value : undefined) ?? {
      playlistVolumeKey: playlistKey ?? (fromPlaylist ? `netease:${selectedPlaylist.value!.id}` : fromLocalCollection?.id ?? ''),
      playlistOrderScope: fromPlaylist ? 'netease:' + (selectedPlaylist.value!.cacheOwnerId || profile.value?.userId || 0) : fromLocalCollection ? 'local:device' : playlistKey ? undefined : track.playlistOrderScope,
      playlistOrderKey: fromPlaylist ? String(selectedPlaylist.value!.cacheOwnerId || profile.value?.userId || 0) + ':' + selectedPlaylist.value!.id : fromLocalCollection?.id || (playlistKey ? undefined : track.playlistOrderKey),
      playlistVolumeName: fromPlaylist ? selectedPlaylist.value!.name : fromLocalCollection?.name ?? (playlistKey === 'local:folder' ? t('mobile.runtimeText.localMusic') : playlistKey === 'cache:all' ? t('mobile.runtimeText.cachedMusic') : '')
    }
    const sourceQueue = suppliedQueue ?? (fromPlaylist || activeTab.value === 'entity' || fromLocalCollection ? tracks.value
      : playlistKey === 'local:folder' ? localTracks.value : playlistKey === 'cache:all' ? cachedTracks.value
      : activeTab.value === 'search' && searchCategory.value === 'tracks' ? searchResults.value as VutronTrack[]
      : homeData.value.dailyTracks.some(item => item.id === track.id) ? homeData.value.dailyTracks : [track])
    const queue = sourceQueue.map(item => ({ ...item, ...context }))
    const selectedIndex = queue.findIndex(item => track.source === 'plugin-snapshot' && track.localEntryKey
      ? item.localEntryKey === track.localEntryKey : item.id === track.id && item.localUri === track.localUri)
    const index = Math.max(0, selectedIndex)
    if (selectedIndex < 0) queue.splice(0, queue.length, { ...track, ...context })
    const contextual = queue[index]
    error.value = ''; navigateTo('player')
    clearLyrics()
    playback.value = { ...emptyPlaybackState, trackId: track.id, title: track.name, artist: track.artists?.join(' / ') ?? '', track: contextual }
    overlay.invalidateOverlayTrack()
    overlay.setOffsetForTrack(playbackTrackKey())
    try { queueReadKey = ''; await vutronPlugin.play({ track: contextual, queue, index, ...(position === undefined ? {} : { position }) }); await refreshPlaybackState() }
    catch (cause) { error.value = errorMessage(cause, t('mobile.runtimeText.playFailed')) }
  }
  async function reorderLocalPlayback(collectionId: string, keys: string[]) {
    if (!vutronPlugin.reorderLocalPlaybackQueue) return
    try { playbackQueue.value = await vutronPlugin.reorderLocalPlaybackQueue({ collectionId, keys }) }
    catch (cause) { error.value = errorMessage(cause, t('mobile.runtimeText.queueReorderFailed')) }
  }

  async function playPlugin(value: PluginPlayback) {
    if (libraryMutationBusy.value) return
    error.value = ''
    try {
      const current=playback.value.track
      if (value.resumePlaylist && value.playlistKey && current?.pluginPlaylistOwner===value.pluginId
          && current.playlistOrderKey===value.playlistKey && current.playlistOrderScope==='plugin:'+value.pluginId+':'+value.accountScope) {
        navigateTo('player')
        if (!playback.value.playing) await resume()
        return
      }
      const accepted = await vutronPlugin.playMusicPlugin(value)
      navigateTo('player')
      playback.value = { ...emptyPlaybackState, trackId: accepted.track.id, title: accepted.track.name,
        artist: accepted.track.artists?.join(' / ') || '', track: accepted.track, loading: true }
      overlay.invalidateOverlayTrack(); clearLyrics()
      await refreshPlaybackState()
    } catch (cause) { error.value = errorMessage(cause, t('mobile.runtimeText.pluginPlayFailed')) }
  }

  async function queuePlugin(value: PluginPlayback, action: 'next' | 'append') {
    return queuePluginBatch({ pluginId: value.pluginId, accountScope: value.accountScope, tracks: [value.track] }, action)
  }
  const queueMutationBusy = ref(false)
  async function queuePluginBatch(value: { pluginId: string; accountScope?: string; tracks: PluginPlayback['track'][] }, action: 'next' | 'append'): Promise<boolean> {
    if (!value.tracks.length || queueMutationBusy.value) return false
    queueMutationBusy.value = true
    try {
      playbackQueue.value = await vutronPlugin.queueMusicPlugin({ pluginId: value.pluginId, accountScope: value.accountScope, tracks: value.tracks, action })
      queueNotice.value = value.tracks.length > 1 ? t(action === 'next' ? 'mobile.batch.queuedNext' : 'mobile.batch.queuedAppend', { count:value.tracks.length }) : action === 'next' ? t('mobile.runtimeText.queuedNext', { name: value.tracks[0]!.name }) : t('mobile.runtimeText.queuedAppend', { name: value.tracks[0]!.name })
      await refreshPlaybackState(); return true
    } catch (cause) { error.value = errorMessage(cause, t('mobile.runtimeText.pluginQueueFailed')); return false }
    finally { queueMutationBusy.value = false }
  }

  async function pluginRadioTrash(value: PluginPlayback) {
    const current=playback.value.track
    if (current?.pluginId===value.pluginId && current.pluginTrackId===String(value.track.id)) await playAdjacent(1)
  }
  async function playAdjacent(direction: -1 | 1) {
    try {
      if (direction > 0) await vutronPlugin.next()
      else await vutronPlugin.previous()
      await refreshPlaybackState()
    } catch (cause) { error.value = errorMessage(cause, t('mobile.runtimeText.changeTrackFailed')) }
  }
  async function pause() { try { await vutronPlugin.pause(); await refreshPlaybackState() } catch (cause) { error.value = errorMessage(cause, t('mobile.runtimeText.pauseFailed')) } }
  async function resume() { try { await vutronPlugin.resume(); await refreshPlaybackState() } catch (cause) { error.value = errorMessage(cause, t('mobile.runtimeText.resumeFailed')) } }
  async function stop() { try { await vutronPlugin.stop(); await refreshPlaybackState() } catch (cause) { error.value = errorMessage(cause, t('mobile.runtimeText.stopFailed')) } }
  const playbackModeBusy = ref(false)
  let playbackModeRevision = 0
  async function setPlaybackMode(mode: number) {
    const previous = playback.value.mode ?? 0
    if (!vutronPlugin.setPlaybackMode || playbackModeBusy.value || ![0,1,2].includes(mode) || mode === previous) return
    playbackModeBusy.value = true
    playbackModeRevision++
    try {
      const confirmed = (await vutronPlugin.setPlaybackMode({ mode })).mode
      playbackModeRevision++
      playback.value.mode = confirmed
      playbackQueue.value.mode = confirmed
      if (confirmed !== previous) queueNotice.value = t(['mobile.player.listLoop', 'mobile.player.singleLoop', 'mobile.player.shuffle'][confirmed]!)
    }
    catch (cause) { playbackModeRevision++; error.value = errorMessage(cause, t('mobile.runtimeText.playbackModeSaveFailed')) }
    finally { playbackModeBusy.value = false }
  }
  async function cyclePlaybackMode() { await setPlaybackMode(((playback.value.mode ?? 0) + 1) % 3) }
  async function seek(position: number) {
    if (!vutronPlugin.seek) return
    try { await vutronPlugin.seek({ position }); await refreshPlaybackState() }
    catch (cause) { error.value = errorMessage(cause, t('mobile.runtimeText.seekFailed')) }
  }

  function cachePlayingPlaylist(track: VutronTrack) {
    const userId = profile.value?.userId
    if (!onlineAvailable.value || !userId || cacheStatus.value.libraryAutoCache === false || cacheStatus.value.artworkFull
      || track.playlistOrderScope !== `netease:${userId}` || !track.playlistVolumeKey?.startsWith('netease:')) return
    const playlistId = Number(track.playlistVolumeKey.slice('netease:'.length))
    const key = `${userId}:${playlistId}`
    if (!Number.isSafeInteger(playlistId) || playlistId <= 0 || track.playlistOrderKey !== key || playbackPlaylistCache.has(key)) return
    const request = Symbol()
    playbackPlaylistCache.set(key, request)
    void vutronPlugin.getPlaylistTracks({ playlistId, userId, cacheOnly: true }).then(result => {
      if (playbackPlaylistCache.get(key) !== request) return
      if (!result.cacheSaved || profile.value?.userId !== userId) playbackPlaylistCache.delete(key)
      else { playbackPlaylistCache.set(key, true); void loadOfflinePlaylists() }
    }).catch(() => { if (playbackPlaylistCache.get(key) === request) playbackPlaylistCache.delete(key) })
  }

  async function refreshPlaybackState() {
    if (playbackRequestPending) return
    playbackRequestPending = true
    const volumeRead = overlay.captureVolumeRead()
    const loopRead = abLoopRevision
    const modeRead = playbackModeRevision
    const modeWritePending = playbackModeBusy.value
    try {
      const next = { ...emptyPlaybackState, ...(await vutronPlugin.getPlaybackState()) }
      if (modeWritePending || playbackModeBusy.value || modeRead !== playbackModeRevision) next.mode = playback.value.mode ?? 0
      const previousTrackKey = playbackTrackKey()
      const nextKey = playbackTrackKey(next)
      overlay.applyVolumeDraftsToState(next, volumeRead)
      if (loopRead !== abLoopRevision && next.trackId === playback.value.trackId) {
        next.abLoop = playback.value.abLoop
        next.abLoopEnabled = playback.value.abLoopEnabled
        next.position = playback.value.position
      } else if (typeof next.abLoopEnabled === 'boolean') abLoopEnabled.value = next.abLoopEnabled
      else if (next.trackId === playback.value.trackId && next.abLoop === undefined && playback.value.abLoopEnabled !== undefined) {
        next.abLoop = playback.value.abLoop
        next.abLoopEnabled = playback.value.abLoopEnabled
      }
      // A remote player can claim it started before the native clock moves.
      // Remember the last confirmed start separately so rebuffering doesn't record it again.
      if (!next.playing || previousTrackKey !== nextKey) confirmedPlaybackKey = undefined
      const startedPlaying = next.playing && !next.loading && !next.buffering && confirmedPlaybackKey !== nextKey
      if (startedPlaying) confirmedPlaybackKey = nextKey
      playback.value = sharePlaybackSnapshot(playback.value, next)
      updateLyrics(next)
      if (startedPlaying && next.track?.playlistOrderScope && next.track.playlistOrderKey) {
        cachePlayingPlaylist(next.track)
        try { recordPlaylistPlayback(next.track.playlistOrderScope, next.track.playlistOrderKey) }
        catch (cause) { console.warn('Playlist history save failed', cause) }
      }
      const nextTrackKey = playbackTrackKey()
      if (nextTrackKey !== previousTrackKey) overlay.setOffsetForTrack(nextTrackKey)
      if (next.trackId && overlay.needsOverlayReload(nextTrackKey)) await loadOverlaySettings()
      if (queueOpen.value && queueStateKey(next) !== queueReadKey) await loadPlaybackQueue()
      await refreshVisibleSleepTimer()
    } catch (cause) { error.value = errorMessage(cause, t('mobile.runtimeText.playbackReadFailed')) }
    finally { playbackRequestPending = false }
  }

  let timerReadPending = false
  async function refreshVisibleSleepTimer() {
    if (activeTab.value !== 'settings' || document.visibilityState === 'hidden' || timerReadPending || !vutronPlugin.getSleepTimer) return
    timerReadPending = true
    const revision = cache.captureTimerRevision()
    try { const sample = await vutronPlugin.getSleepTimer(); cache.trySyncTimer(sample, revision) }
    catch { /* Timer support was added after the earliest WebShell build. */ }
    finally { timerReadPending = false }
  }
  watch(activeTab, tab => { if (tab === 'settings') void refreshVisibleSleepTimer() })

  async function loadSourceSettings() {
    try { autoMatchSources.value = (await vutronPlugin.getSourceSettings()).autoMatch }
    catch (cause) { error.value = errorMessage(cause, t('mobile.runtimeText.sourcesReadFailed')) }
  }

  async function loadPlaybackQueue() {
    if (!vutronPlugin.getPlaybackQueue) return
    try { playbackQueue.value = await vutronPlugin.getPlaybackQueue(); queueReadKey = queueStateKey() }
    catch (cause) { error.value = errorMessage(cause, t('mobile.runtimeText.queueReadFailed')) }
  }
  async function showPlaybackQueue() { queueOpen.value = true; await loadPlaybackQueue() }
  function trackWithContext(track: VutronTrack, playlistKey?: string): VutronTrack {
    const fromPlaylist = activeTab.value === 'playlist' && selectedPlaylist.value
      && tracks.value.some(item => item.id === track.id && item.localUri === track.localUri) ? selectedPlaylist.value : undefined
    const snapshot = snapshotPlaybackContext(fromPlaylist)
    if (snapshot) return { ...track, artists: track.artists?.slice(), ...snapshot }
    const fromLocal = activeTab.value === 'localCollection' ? selectedLocalCollection.value : undefined
    const key = playlistKey ?? track.playlistVolumeKey ?? (fromPlaylist ? `netease:${fromPlaylist.id}` : fromLocal?.id ?? '')
    const name = track.playlistVolumeName || (fromPlaylist && key === `netease:${fromPlaylist.id}` ? fromPlaylist.name
      : fromLocal && key === fromLocal.id ? fromLocal.name : key === 'local:folder' ? t('mobile.runtimeText.localMusic') : key === 'cache:all' ? t('mobile.runtimeText.cachedMusic') : '')
    return { ...track, artists: track.artists?.slice(), playlistVolumeKey: key, playlistVolumeName: name,
      playlistOrderScope: fromPlaylist ? 'netease:' + (fromPlaylist.cacheOwnerId || profile.value?.userId || 0) : fromLocal ? 'local:device' : playlistKey ? undefined : track.playlistOrderScope,
      playlistOrderKey: fromPlaylist ? String(fromPlaylist.cacheOwnerId || profile.value?.userId || 0) + ':' + fromPlaylist.id : fromLocal?.id || (playlistKey ? undefined : track.playlistOrderKey) }
  }
  async function queueTrackNext(track: VutronTrack) {
    return queueTracks([track], 'next')
  }
  async function appendTrackToQueue(track: VutronTrack) {
    return queueTracks([track], 'append')
  }
  async function queueTracks(tracks: VutronTrack[], action: 'next' | 'append'): Promise<boolean> {
    const operation = action === 'next' ? vutronPlugin.addToPlayNext : vutronPlugin.appendToPlaybackQueue
    if (!tracks.length || queueMutationBusy.value) return false
    if (!operation) { error.value = t(action === 'next' ? 'mobile.runtimeText.playNextUnsupported' : 'mobile.runtimeText.appendUnsupported'); return false }
    queueMutationBusy.value = true
    try {
      const contextual = tracks.map(track => trackWithContext(track))
      playbackQueue.value = await operation.call(vutronPlugin, contextual.length === 1 ? { track: contextual[0]! } : { tracks: contextual })
      queueNotice.value = contextual.length > 1 ? t(action === 'next' ? 'mobile.batch.queuedNext' : 'mobile.batch.queuedAppend', { count:contextual.length }) : t(action === 'next' ? 'mobile.runtimeText.queuedNext' : 'mobile.runtimeText.queuedEnd', { name: tracks[0]!.name })
      await refreshPlaybackState(); return true
    } catch (cause) { error.value = errorMessage(cause, t(action === 'next' ? 'mobile.runtimeText.playNextFailed' : 'mobile.runtimeText.appendFailed')); return false }
    finally { queueMutationBusy.value = false }
  }
  async function playQueueIndex(index: number, upNext = false) {
    if (!vutronPlugin.playQueueIndex) return
    try { playbackQueue.value = await vutronPlugin.playQueueIndex({ index, upNext }); await refreshPlaybackState() }
    catch (cause) { error.value = errorMessage(cause, t('mobile.runtimeText.queuePlayFailed')) }
  }
  async function removeQueueTrack(index: number, upNext = false) {
    if (!vutronPlugin.removeQueueTrack || queueMutationBusy.value) return
    queueMutationBusy.value = true
    try { const result = await vutronPlugin.removeQueueTrack({ index, upNext }); playbackQueue.value = result; await refreshPlaybackState(); offerQueueUndo(result.undoToken, 'removedQueue') }
    catch (cause) { error.value = errorMessage(cause, t('mobile.runtimeText.queueRemoveFailed')) }
    finally { queueMutationBusy.value = false }
  }
  async function clearPlayNext() {
    if (!vutronPlugin.clearPlayNext || queueMutationBusy.value) return
    queueMutationBusy.value = true
    try { const result = await vutronPlugin.clearPlayNext(); playbackQueue.value = result; offerQueueUndo(result.undoToken, 'clearedNext') }
    catch (cause) { error.value = errorMessage(cause, t('mobile.runtimeText.upNextClearFailed')) }
    finally { queueMutationBusy.value = false }
  }
  function offerQueueUndo(undoToken: string | undefined, message: 'removedQueue' | 'clearedNext') {
    if (!undoToken || !vutronPlugin.undoPlaybackQueue) return
    offerUndo({ message: undoText(message), undo: async () => {
      if (queueMutationBusy.value) throw new Error(undoText('busy'))
      queueMutationBusy.value = true
      try { playbackQueue.value = await vutronPlugin.undoPlaybackQueue!({ undoToken }); await refreshPlaybackState() }
      catch (cause) {
        const message = errorMessage(cause, undoText('restoreFailed'))
        error.value = /队列已改变|queue.*chang/i.test(message) ? undoText('queueChanged') : message
        await askAction({ title: undoText('undo'), message: error.value, confirmLabel: t('mobile.management.understood'), cancelLabel: t('mobile.management.cancel') })
        throw new Error(error.value)
      } finally { queueMutationBusy.value = false }
    } })
  }

  async function setAutoMatchSources(enabled: boolean) {
    try { autoMatchSources.value = (await vutronPlugin.updateSourceSettings({ autoMatch: enabled })).autoMatch }
    catch (cause) { error.value = errorMessage(cause, t('mobile.runtimeText.sourcesSaveFailed')) }
  }

  async function openLocalCollection(collection: VutronLocalCollection) {
    if (appNavigation.intercept(() => openLocalCollection(collection))) return
    rememberPage()
    const requestId = ++trackListRequestId
    selectedPlaylist.value = undefined; selectedEntity.value = undefined; selectedLocalCollection.value = collection
    tracks.value = []; activeTab.value = 'localCollection'; loading.value = true
    try {
      const result = collection.isLocalBundle ? await vutronPlugin.getLocalPlaylistTracks?.({ playlistId: collection.id })
        : await vutronPlugin.getLocalFolderTracks?.({ folderId: collection.id })
      if (requestId === trackListRequestId) tracks.value = result?.tracks ?? []
    } catch (cause) { if (requestId === trackListRequestId) error.value = errorMessage(cause, t('mobile.runtimeText.localPlaylistReadFailed')) }
    finally { if (requestId === trackListRequestId) loading.value = false }
  }

  function startPlaybackPolling(intervalMs = 2000) {
    stopPlaybackPolling(); void refreshPlaybackState()
    startSleepClock()
    playbackTimer = setInterval(() => {
      if (document.visibilityState === 'hidden') return
      void refreshPlaybackState()
      cache.pollCacheStatus()
    }, intervalMs)
  }
  function stopPlaybackPolling() { if (playbackTimer !== undefined) clearInterval(playbackTimer); playbackTimer = undefined; stopSleepClock() }
  return {
    ...onlineLibrary,
    profile, playlists, playlistsLoading, cachedPlaylists, cachedPlaylistsLoading, removeCachedPlaylistView, tracks, playlistLoadIncomplete, playlistLoadError, selectedPlaylist, selectedEntity, localTracks, cachedTracks, folderName, cacheStatus, cacheCapacityMb,
    localLibrary, selectedLocalCollection, libraryLoading, localScanLoading, loadLocalLibrary, importLocalPlaylist, openLocalCollection, reloadManagedLibrary,
    homeData, homeLoading, searchCategory, searchKeywords, submittedSearch, searchResults, searchCount, searchNextPage, searchLoading,
    sleepTimerRemainingMs, sleepTimerMinutes, sleepTimerLabel, sleepTimerActive, sleepTimerMode, sleepTimerRemainingTracks, sleepTimerFadeSeconds, cacheAllPlaylistsLoading, cacheAllPlaylistsResult,
    lyrics, lyricsLoading, activeTab, loading, error, playback, abLoopEnabled, applyAbLoopState, loggedIn, localOnly, manualLocalOnly, networkConnected, hasAccess, onlineAvailable, loginVisible, localModeLoading, enterLocalOnly, useAutomaticMode, refreshConnectivity, disposeNetworkMonitoring, requestLogin,
    playbackQueue, queueOpen, queueNotice, queueMutationBusy, showPlaybackQueue, loadPlaybackQueue, trackWithContext, queueTrackNext, appendTrackToQueue, queueTracks, playQueueIndex, removeQueueTrack, clearPlayNext,
    canNavigateBack, playlistOrigin, navigationDirection, navigationScrollY, tabScrollFor, navigateTo, navigateBack, activePluginId, openPlugins, activeMusicSourceId, selectMusicSource, discardMusicSource, retainMusicSources,
    qrLoginKey, qrLoginImage, qrLoginStatus, qrLoginLoading,
    restore, refreshRestoredAccount, login, createQrLogin, checkQrLogin, cancelQrLogin, loadPlaylists, loadOfflinePlaylists, loadHomeData, openPlaylist, cachePlaylist, cachingPlaylistId, cachePluginPlaylist, cachingPluginPlaylist, cacheAllPlaylists, syncOfflinePlaylistSources, openCachedPlaylist, openEntityTracks,
    runSearch, loadMoreSearch, warmSearchCategory: search.warmSearchCategory, adjacentSearch: search.adjacentSearch, openMv, play, playPlugin, queuePlugin, queuePluginBatch, pluginRadioTrash, reorderLocalPlayback, playAdjacent, pause, resume, stop, seek, cyclePlaybackMode, setPlaybackMode, playbackModeBusy, refreshPlaybackState,
    pickMusicFolder, loadLocalMusic, loadCacheStatus, refreshCacheAfterMutation, setCacheCapacity, setArtworkCacheCapacity, artworkCacheCapacityMb, cacheCurrent, clearCache,
    setSleepTimer, setSleepTimerSeconds, setSleepTimerSettings, sleepTimerBusy, clearSleepTimer, setAutomaticCache, setLibraryAutomaticCache, temporarilyHideOverlay, restoreOverlay,
    autoMatchSources, loadSourceSettings, setAutoMatchSources, setCurrentTrackVolume, setCurrentPlaylistVolume,
    overlaySettings, overlayEnabled, overlayPlayedColor, overlayUnplayedColor, overlayShadowColor, overlayBackgroundOpacity,
    loadOverlaySettings, toggleLyricOverlay, updateOverlayField, updateOverlayColor,
    updateOverlayBackgroundOpacity, updateCurrentLyricOffset, flushLiveSettings,
    startPlaybackPolling, stopPlaybackPolling, logout
  }

})
