import { translate as t } from '../platform/i18n'
import { computed, ref, shallowRef } from 'vue'
import { timerDeadline, timerRemaining, timerLabel } from '../utils/sleepTimer'
import { recordPlaylistPlayback } from '../composables/playlistOrdering'
import { appNavigation } from '../composables/navigationGuard'
import { defineStore } from 'pinia'
import type { PluginPlayback } from '../plugins/protocol'
import { createLiveSettingWriter } from '../platform/liveSettingWrites'
import { flushRegisteredLiveSettings } from '../platform/liveSettingsLifecycle'
import { createAuthSession } from './domains/authSession'
import { createLocalLibrary } from './domains/localLibrary'
import { createNeteaseLibrary } from './domains/neteaseLibrary'
import { libraryMutationBusy } from '../platform/libraryActivity'
import { selectLyricFamily, type LyricFamily } from '@vutronmusic/core/lyrics'
import {
  vutronPlugin,
  type VutronCacheStatus,
  type VutronHomeData,
  type VutronLocalTrack,
  type VutronLocalCollection,
  type VutronLyricOverlaySettings,
  type VutronPlaybackState,
  type VutronPlaylist,
  type VutronOnlineLibrary,
  type VutronSearchCategory,
  type VutronSearchResult,
  type VutronSearchItem,
  type VutronTrack,
  type VutronQueue
} from '../platform/vutronPlugin'

const emptyPlaybackState: VutronPlaybackState = {
  playing: false, trackId: 0, title: '', artist: '', duration: 0, position: 0, error: ''
}

type ShellTab = 'home' | 'library' | 'search' | 'entity' | 'localCollection' | 'player' | 'settings' | 'about' | 'plugins'
type ShellEntity = { category: 'albums' | 'artists'; id: number; name: string; picUrl?: string }
interface NavigationEntry {
  tab: ShellTab
  pluginId?: string
  musicSourceId?: string
  playlist?: VutronPlaylist
  entity?: ShellEntity
  localCollection?: VutronLocalCollection
  tracks: VutronTrack[]
  scrollY: number
}

function errorMessage(error: unknown, fallback: string): string {
  if (typeof error === 'string' && error.trim()) return error
  if (error && typeof error === 'object' && 'message' in error) {
    const message = (error as { message?: unknown }).message
    if (typeof message === 'string' && message.trim()) return message
  }
  return fallback
}

function colorInputValue(value: number): string {
  return `#${((value >>> 0) & 0xffffff).toString(16).padStart(6, '0')}`
}

export const useAndroidShellStore = defineStore('androidShell', () => {
  const loading = ref(false)
  const error = ref('')
  const authSession = createAuthSession({
    loading, error, formatError: errorMessage, restoreLocalState, resetToLocalLibrary, startPlaybackPolling,
    loadOnlineState: async () => { if (!activeMusicSourceId.value) await Promise.all([loadPlaylists(), loadHomeData(), onlineLibrary.loadLikedTracks()]) },
    resetToOnlineHome: () => { navigationHistory.value = []; activeMusicSourceId.value = ''; activeTab.value = 'home' },
    beforeLogout: async () => {
      await flushLiveSettings()
      ++trackListRequestId; ++searchRequestId; ++lyricsRequestId
      ++cacheSettingsRevision; playbackPlaylistCache.clear()
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
  const playlists = ref<VutronPlaylist[]>([])
  const playlistsLoading = ref(false)
  let playlistReadVersion = 0
  const tracks = ref<VutronTrack[]>([])
  const selectedPlaylist = ref<VutronPlaylist>()
  const selectedLocalCollection = ref<VutronLocalCollection>()
  const { localLibrary, libraryLoading, localScanLoading, localTracks, folderName,
    pickMusicFolder, loadLocalMusic, loadLocalLibrary, importLocalPlaylist
  } = createLocalLibrary({ error, onlineAvailable, formatError: errorMessage, openCollection: openLocalCollection, notice: message => { queueNotice.value = message } })
  const cachedTracks = ref<VutronLocalTrack[]>([])
  const cacheStatus = ref<VutronCacheStatus>({ capacityMb: 2048, usedBytes: 0, trackCount: 0, enabled: true })
  const cacheCapacityMb = ref(2048)
  const artworkCacheCapacityMb = ref(128)
  const overlaySettings = ref<VutronLyricOverlaySettings>({
    enabled: false, locked: false, translation: true, nextLine: true, wifiValidation: true, estimatedWordTiming: false,
    fontSize: 22, playedColor: 0xff37cf88, unplayedColor: 0xffd2d2d2,
    backgroundColor: 0xff181920, shadowColor: 0x99000000, shadowEnabled: true,
    shadowRadius: 2, touchPassthroughPriority: true, permissionGranted: false
  })
  const overlayEnabled = computed(() => overlaySettings.value.enabled)
  const overlayPlayedColor = computed(() => colorInputValue(overlaySettings.value.playedColor))
  const overlayUnplayedColor = computed(() => colorInputValue(overlaySettings.value.unplayedColor))
  const overlayShadowColor = computed(() => colorInputValue(overlaySettings.value.shadowColor))
  const overlayBackgroundOpacity = computed(() => Math.round(((overlaySettings.value.backgroundColor >>> 24) & 0xff) * 100 / 255))
  const lyrics = ref<LyricFamily>({ original: [], translation: [], pairedTranslations: [], source: 'empty' })
  const lyricsLoading = ref(false)
  const activeTab = ref<ShellTab>('home')
  const activePluginId = ref('')
  const activeMusicSourceId = ref('')
  const navigationHistory = shallowRef<NavigationEntry[]>([])
  const navigationDirection = ref<'forward' | 'back'>('forward')
  const navigationScrollY = ref(0)
  const rootTab = computed<ShellTab>(() => localOnly.value && !activeMusicSourceId.value ? 'library' : 'home')
  const canNavigateBack = computed(() => loginRequested.value && localOnly.value || navigationHistory.value.length > 0 || activeTab.value !== rootTab.value)
  const playback = ref<VutronPlaybackState>({ ...emptyPlaybackState })
  const playbackQueue = ref<VutronQueue>({ tracks: [], index: -1, upNext: [], mode: 0 })
  const queueOpen = ref(false)
  let queueReadKey = ''
  const queueNotice = ref('')
  const selectedEntity = ref<ShellEntity>()
  const cachedPlaylists = ref<VutronPlaylist[]>([])
  let offlineReadVersion = 0
  const homeData = ref<VutronHomeData>({ banners: [], playlists: [], artists: [], albums: [], charts: [], dailyTracks: [] })
  const searchCategory = ref<VutronSearchCategory>('tracks')
  const searchKeywords = ref('')
  const submittedSearch = shallowRef<{ category: VutronSearchCategory; keywords: string }>({ category: 'tracks', keywords: '' })
  const searchResults = ref<VutronSearchItem[]>([])
  const searchCount = ref(0)
  const searchNextPage = ref(0)
  const searchLoading = ref(false)
  let searchRequestId = 0
  const homeLoading = ref(false)
  const sleepTimerDeadline = ref(0), sleepTimerNow = ref(Date.now()), sleepTimerBusy = ref(false)
  const sleepTimerRemainingMs = computed(() => timerRemaining(sleepTimerDeadline.value, sleepTimerNow.value))
  let sleepTimerRevision = 0, sleepClock: ReturnType<typeof setInterval> | undefined
  function stopSleepClock() { if (sleepClock !== undefined) clearInterval(sleepClock); sleepClock = undefined }
  function startSleepClock() {
    if (sleepClock !== undefined || sleepTimerDeadline.value <= Date.now() || document.visibilityState === 'hidden') return
    sleepClock = setInterval(() => { sleepTimerNow.value = Date.now(); if (!sleepTimerRemainingMs.value) stopSleepClock() }, 250)
  }
  function syncSleepTimer(sample: { remainingMs: number; deadlineMs?: number }) {
    sleepTimerNow.value = Date.now(); sleepTimerDeadline.value = timerDeadline(sample, sleepTimerNow.value)
    if (sleepTimerDeadline.value > sleepTimerNow.value) startSleepClock(); else stopSleepClock()
  }
  const sleepTimerMinutes = ref(30)
  const cacheAllPlaylistsLoading = ref(false)
  const cacheAllPlaylistsResult = ref('')
  const autoMatchSources = ref(true)
  let playbackTimer: ReturnType<typeof setInterval> | undefined
  let playbackRequestPending = false
  let cacheStatusPending = false
  let cacheSettingsRevision = 0
  let cachePollAt = 0
  let lyricTrackId = 0
  let trackListRequestId = 0
  let lyricsRequestId = 0
  let overlayRevision = 0
  let overlayReadRequest = 0
  let overlayTrackKey = ''
  type OverlayValue = boolean | number
  const overlayDrafts = new Map<keyof VutronLyricOverlaySettings, { value: OverlayValue; revision: number }>()
  const offsetDrafts = new Map<string, { value: number; revision: number }>()
  const trackVolumeDrafts = new Map<string, { value: number; revision: number }>()
  const playlistVolumeDrafts = new Map<string, { value: number; revision: number }>()
  let offsetRevision = 0
  let volumeRevision = 0
  type NumberWriter = ReturnType<typeof createLiveSettingWriter<number>>
  const offsetWriters = new Map<string, NumberWriter>()
  const trackVolumeWriters = new Map<string, NumberWriter>()
  const playlistVolumeWriters = new Map<string, NumberWriter>()
  const overlayWriter = createLiveSettingWriter<Partial<VutronLyricOverlaySettings>>({
    merge: (previous, next) => ({ ...previous, ...next }),
    write: async patch => {
      const savedRevisions = new Map([...overlayDrafts].map(([key, draft]) => [key, draft.revision]))
      const next = vutronPlugin.updateLyricOverlaySettings
        ? await vutronPlugin.updateLyricOverlaySettings({ settings: patch })
        : patch.enabled !== undefined && vutronPlugin.setLyricOverlayEnabled
          ? await vutronPlugin.setLyricOverlayEnabled({ enabled: patch.enabled }) : undefined
      for (const key of Object.keys(patch) as (keyof VutronLyricOverlaySettings)[]) {
        const draft = overlayDrafts.get(key)
        if (draft?.revision === savedRevisions.get(key) && draft?.value === patch[key]) {
          if (key === 'enabled' && next?.enabled !== undefined) overlaySettings.value.enabled = next.enabled
          overlayDrafts.delete(key)
        }
      }
      // Full native snapshots can contain unrelated older slider values.
      if (next?.permissionGranted !== undefined) overlaySettings.value.permissionGranted = next.permissionGranted
      if (next?.temporaryHidden !== undefined) overlaySettings.value.temporaryHidden = next.temporaryHidden
      if (next?.temporaryHiddenRemainingMs !== undefined) overlaySettings.value.temporaryHiddenRemainingMs = next.temporaryHiddenRemainingMs
    },
    onError: cause => { error.value = errorMessage(cause, t('mobile.runtimeText.overlaySaveFailed')) }
  })
  const playbackPlaylistCache = new Set<number>()

  function playbackTrackKey(state = playback.value): string {
    const track = state.track
    return [state.trackId, track?.localUri ?? '', track?.localPath ?? '', track?.neteaseId ?? ''].join('|')
  }

  function queueStateKey(state = playback.value): string {
    return JSON.stringify([state.queueToken, state.queueIndex, state.queueCount, state.upNextCount, state.mode, playbackTrackKey(state)])
  }

  function rememberPage() {
    navigationHistory.value = [...navigationHistory.value, {
      tab: activeTab.value, pluginId: activePluginId.value, musicSourceId: activeMusicSourceId.value, playlist: selectedPlaylist.value, entity: selectedEntity.value,
      tracks: tracks.value, localCollection: selectedLocalCollection.value, scrollY: window.scrollY
    }].slice(-40)
    navigationDirection.value = 'forward'
    navigationScrollY.value = 0
  }

  function navigateTo(tab: ShellTab) {
    if (!activeMusicSourceId.value && !onlineAvailable.value && ['home', 'search', 'entity'].includes(tab)) return
    if (tab === activeTab.value && !(tab === 'library' && selectedPlaylist.value)) return
    rememberPage()
    ++trackListRequestId
    loading.value = false
    activeTab.value = tab
    if (tab === 'library') { selectedPlaylist.value = undefined; selectedEntity.value = undefined; selectedLocalCollection.value = undefined; tracks.value = [] }
    if (tab === rootTab.value) navigationHistory.value = []
  }

  function navigateBack(): boolean {
    const previous = navigationHistory.value.at(-1)
    if (!previous && activeTab.value === rootTab.value) return false
    ++trackListRequestId
    loading.value = false
    navigationDirection.value = 'back'
    navigationScrollY.value = previous?.scrollY ?? 0
    navigationHistory.value = navigationHistory.value.slice(0, -1)
    selectedPlaylist.value = previous?.playlist
    selectedEntity.value = previous?.entity
    selectedLocalCollection.value = previous?.localCollection
    activePluginId.value = previous?.pluginId ?? ''
    activeMusicSourceId.value = previous?.musicSourceId ?? ''
    tracks.value = previous?.tracks ?? []
    activeTab.value = previous?.tab ?? rootTab.value
    return true
  }

  function openPlugins(pluginId = '') {
    if (activeTab.value === 'plugins' && activePluginId.value === pluginId) return
    rememberPage()
    activePluginId.value = pluginId
    activeTab.value = 'plugins'
  }

  /** Source selection belongs to the main shell; plugin accounts stay with their owner. */
  function selectMusicSource(pluginId: string, tab: 'home' | 'library' | 'search' = 'library') {
    if (activeMusicSourceId.value === pluginId && activeTab.value === tab && !selectedPlaylist.value) return
    rememberPage()
    ++trackListRequestId; ++searchRequestId
    loading.value = false; searchLoading.value = false
    activeMusicSourceId.value = pluginId
    selectedPlaylist.value = undefined; selectedEntity.value = undefined; selectedLocalCollection.value = undefined
    tracks.value = []
    activeTab.value = !pluginId && !onlineAvailable.value && tab !== 'library' ? 'library' : tab
  }

  function discardMusicSource(pluginId: string) {
    navigationHistory.value = navigationHistory.value.filter(page => page.musicSourceId !== pluginId)
    if (activeMusicSourceId.value === pluginId) activeMusicSourceId.value = ''
    if (['home', 'library', 'search'].includes(activeTab.value)) {
      ++trackListRequestId; ++searchRequestId
      selectedPlaylist.value = undefined; selectedEntity.value = undefined; selectedLocalCollection.value = undefined
      tracks.value = []; loading.value = false; activeTab.value = 'library'
    }
  }

  function retainMusicSources(pluginIds: string[]) {
    const available = new Set(pluginIds)
    navigationHistory.value = navigationHistory.value.filter(page => !page.musicSourceId || available.has(page.musicSourceId))
  }

  async function restoreLocalState() {
    try { await vutronPlugin.restorePlayback() } catch { /* No saved playback cursor. */ }
    await Promise.all([loadOfflinePlaylists(), loadPlaybackQueue(), refreshPlaybackState(), loadCacheStatus(), loadLocalMusic(), loadOverlaySettings(), loadSourceSettings()])
  }

  function resetToLocalLibrary() {
    ++trackListRequestId; ++searchRequestId
    activeMusicSourceId.value = ''
    navigationHistory.value = []
    selectedPlaylist.value = undefined
    selectedEntity.value = undefined
    selectedLocalCollection.value = undefined
    activeTab.value = 'library'
    tracks.value = []
    loading.value = false
    searchLoading.value = false
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

  async function loadOfflinePlaylists() {
    if (!vutronPlugin.getCachedPlaylists) return
    const request = ++offlineReadVersion
    try { const result = await vutronPlugin.getCachedPlaylists(); if (request === offlineReadVersion) cachedPlaylists.value = result.playlists ?? [] }
    catch { /* Offline snapshots are optional on older builds. */ }
  }

  async function loadHomeData() {
    if (!onlineAvailable.value || !vutronPlugin.getHomeData || homeLoading.value) return
    homeLoading.value = true
    try {
      const result = await vutronPlugin.getHomeData()
      if (onlineAvailable.value) {
        const hasContent = Object.values(homeData.value).some(value => Array.isArray(value) && value.length > 0)
        if (!result.cached || !hasContent) homeData.value = result
        return result.cached ? 'cached' : 'updated'
      }
    }
    catch (cause) {
      error.value = errorMessage(cause, t('mobile.runtimeText.homeLoadFailed'))
      if (!homeData.value.playlists.length) homeData.value.playlists = cachedPlaylists.value.slice(0, 10)
    }
    finally { homeLoading.value = false }
  }

  async function openPlaylist(playlist: VutronPlaylist) {
    if (!onlineAvailable.value) { await openCachedPlaylist(playlist); return }
    rememberPage()
    const requestId = ++trackListRequestId
    const accountId = profile.value?.userId
    selectedPlaylist.value = playlist; selectedEntity.value = undefined; tracks.value = []
    activeTab.value = 'library'; loading.value = true; error.value = ''
    try {
      const result = await vutronPlugin.getPlaylistTracks({ playlistId: playlist.id, playlist })
      playbackPlaylistCache.add(playlist.id)
      if (requestId === trackListRequestId && onlineAvailable.value && profile.value?.userId === accountId) {
        tracks.value = result.tracks
        if (result.playlist) selectedPlaylist.value = result.playlist
      }
      void loadOfflinePlaylists()
    } catch (cause) { if (requestId === trackListRequestId) error.value = errorMessage(cause, t('mobile.runtimeText.tracksReadFailed')) }
    finally { if (requestId === trackListRequestId) loading.value = false }
  }

  async function reloadManagedLibrary(removed: { track?: VutronTrack; collectionId?: string } = {}) {
    const matches = (track: VutronTrack) => removed.collectionId
      ? track.localFolderId === removed.collectionId || track.localPlaylistId === removed.collectionId || track.playlistVolumeKey === removed.collectionId
      : removed.track && (track.localKey && removed.track.localKey ? track.localKey === removed.track.localKey : track.localUri && track.localUri === removed.track.localUri)
    navigationHistory.value = navigationHistory.value.filter(entry => !removed.collectionId || entry.localCollection?.id !== removed.collectionId)
      .map(entry => ({ ...entry, tracks: entry.tracks.filter(track => !matches(track)) }))
    await loadLocalMusic(false, false)
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
    if (!onlineAvailable.value || !vutronPlugin.cachePlaylist) return
    loading.value = true
    try {
      await vutronPlugin.cachePlaylist({ playlistId: playlist.id })
      const cached = await vutronPlugin.getCachedPlaylistTracks?.({ playlistId: playlist.id })
      if (cached && activeTab.value === 'library' && selectedPlaylist.value?.id === playlist.id) tracks.value = cached.tracks
      await loadOfflinePlaylists()
    } catch (cause) { error.value = errorMessage(cause, t('mobile.runtimeText.playlistCacheFailed')) }
    finally { loading.value = false }
  }

  async function cacheAllPlaylists() {
    if (!onlineAvailable.value || !vutronPlugin.cacheAllPlaylists || cacheAllPlaylistsLoading.value) return
    cacheAllPlaylistsLoading.value = true
    cacheAllPlaylistsResult.value = ''
    try {
      const result = await vutronPlugin.cacheAllPlaylists()
      if (result.cancelled) {
        cacheAllPlaylistsResult.value = t('mobile.runtimeText.batchCacheCancelled')
        await Promise.all([loadOfflinePlaylists(), loadCacheStatus()])
        return
      }
      cacheAllPlaylistsResult.value = t('mobile.runtimeText.batchCached', { playlists: result.cachedPlaylists, tracks: result.cachedTracks }) + (result.failedPlaylists ? t('mobile.runtimeText.batchIncomplete', { count: result.failedPlaylists }) : '') + (result.pendingCovers ? t('mobile.runtimeText.batchCoversPending', { count: result.pendingCovers }) : '')
      await Promise.all([loadOfflinePlaylists(), loadCacheStatus()])
    } catch (cause) { error.value = errorMessage(cause, t('mobile.runtimeText.batchCacheFailed')) }
    finally { cacheAllPlaylistsLoading.value = false }
  }

  async function openCachedPlaylist(playlist: VutronPlaylist) {
    rememberPage()
    const requestId = ++trackListRequestId
    selectedPlaylist.value = { ...playlist, offlineSnapshot: true }
    selectedEntity.value = undefined
    tracks.value = []
    activeTab.value = 'library'
    loading.value = true
    try {
      const result = await vutronPlugin.getCachedPlaylistTracks?.({ playlistId: playlist.id })
      if (requestId === trackListRequestId) tracks.value = result?.tracks ?? []
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

  function removeCachedPlaylistView(id: number) {
    offlineReadVersion++
    cachedPlaylists.value = cachedPlaylists.value.filter(row => row.id !== id)
    navigationHistory.value = navigationHistory.value.filter(entry => !(entry.playlist?.offlineSnapshot && entry.playlist.id === id))
    if (selectedPlaylist.value?.offlineSnapshot && selectedPlaylist.value.id === id) {
      ++trackListRequestId; selectedPlaylist.value = undefined; tracks.value = []; loading.value = false
      activeTab.value = 'library'
    }
  }

  async function openMv(id: number) {
    if (!onlineAvailable.value || !vutronPlugin.openMv) return
    try { await vutronPlugin.openMv({ id }) }
    catch (cause) { error.value = errorMessage(cause, t('mobile.runtimeText.openMvFailed')) }
  }

  async function runSearch(category = searchCategory.value, keywords = searchKeywords.value, reset = true) {
    if (!onlineAvailable.value) return
    const requestId = ++searchRequestId
    const normalizedKeywords = keywords.trim()
    if (!reset && (submittedSearch.value.category !== category || submittedSearch.value.keywords !== normalizedKeywords)) reset = true
    if (!vutronPlugin.search || !normalizedKeywords) {
      submittedSearch.value = { category, keywords: '' }
      searchResults.value = []
      searchCount.value = 0
      searchNextPage.value = 0
      searchLoading.value = false
      return
    }
    if (reset) {
      searchCategory.value = category
      searchKeywords.value = keywords
      submittedSearch.value = { category, keywords: normalizedKeywords }
    }
    if (reset) {
      searchResults.value = []
      searchCount.value = 0
      searchNextPage.value = 0
    }
    searchLoading.value = true
    try {
      const page = reset ? 1 : searchNextPage.value
      const result = await vutronPlugin.search({ category, keywords: normalizedKeywords, page })
      if (requestId !== searchRequestId || submittedSearch.value.category !== category || submittedSearch.value.keywords !== normalizedKeywords) return
      searchResults.value = reset ? result.items : [...searchResults.value, ...result.items]
      searchCount.value = result.count
      searchNextPage.value = result.nextPage
    } catch (cause) {
      if (requestId === searchRequestId && submittedSearch.value.category === category && submittedSearch.value.keywords === normalizedKeywords) {
        error.value = errorMessage(cause, t('mobile.runtimeText.searchFailed'))
      }
    } finally {
      if (requestId === searchRequestId) searchLoading.value = false
    }
  }

  async function loadMoreSearch() {
    if (searchNextPage.value > 0 && !searchLoading.value) await runSearch(submittedSearch.value.category, submittedSearch.value.keywords, false)
  }

  async function play(track: VutronTrack, playlistKey?: string, suppliedQueue?: VutronTrack[], position?: number) {
    if (libraryMutationBusy.value) return
    const fromPlaylist = activeTab.value === 'library' && selectedPlaylist.value
      && tracks.value.some(item => item.id === track.id)
    const fromLocalCollection = activeTab.value === 'localCollection' ? selectedLocalCollection.value : undefined
    const context = {
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
    const selectedIndex = queue.findIndex(item => item.id === track.id && item.localUri === track.localUri)
    const index = Math.max(0, selectedIndex)
    if (selectedIndex < 0) queue.splice(0, queue.length, { ...track, ...context })
    const contextual = queue[index]
    // Browsing already persists metadata; playing also ensures the current
    // playlist is saved when invoked from a saved queue or another page.
    const playlistId = Number(context.playlistVolumeKey.replace(/^netease:/, ''))
    if (onlineAvailable.value && context.playlistVolumeKey.startsWith('netease:') && playlistId > 0 && !playbackPlaylistCache.has(playlistId)) {
      playbackPlaylistCache.add(playlistId)
      void vutronPlugin.getPlaylistTracks({ playlistId, playlist: {
        id: playlistId, name: context.playlistVolumeName || t('mobile.runtimeText.playlistName', { id: playlistId }),
        coverImgUrl: contextual.picUrl, trackCount: queue.length
      } }).then(() => loadOfflinePlaylists()).catch(() => { playbackPlaylistCache.delete(playlistId) })
    }
    error.value = ''; navigateTo('player')
    playback.value = { ...emptyPlaybackState, trackId: track.id, title: track.name, artist: track.artists?.join(' / ') ?? '', track: contextual }
    overlayTrackKey = ''
    overlaySettings.value.currentLyricOffsetMs = offsetDrafts.get(playbackTrackKey())?.value ?? 0
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
      overlayTrackKey = ''; lyricTrackId = 0
      await refreshPlaybackState()
    } catch (cause) { error.value = errorMessage(cause, t('mobile.runtimeText.pluginPlayFailed')) }
  }

  async function queuePlugin(value: PluginPlayback, action: 'next' | 'append') {
    try {
      playbackQueue.value = await vutronPlugin.queueMusicPlugin({ pluginId: value.pluginId, accountScope: value.accountScope, track: value.track, action })
      queueNotice.value = action === 'next' ? t('mobile.runtimeText.queuedNext', { name: value.track.name }) : t('mobile.runtimeText.queuedAppend', { name: value.track.name })
    } catch (cause) { error.value = errorMessage(cause, t('mobile.runtimeText.pluginQueueFailed')) }
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
  async function setPlaybackMode(mode: number) {
    if (!vutronPlugin.setPlaybackMode || playbackModeBusy.value || ![0,1,2].includes(mode)) return
    playbackModeBusy.value = true
    try { playback.value.mode = (await vutronPlugin.setPlaybackMode({ mode })).mode }
    catch (cause) { error.value = errorMessage(cause, t('mobile.runtimeText.playbackModeSaveFailed')) }
    finally { playbackModeBusy.value = false }
  }
  async function cyclePlaybackMode() { await setPlaybackMode(((playback.value.mode ?? 0) + 1) % 3) }
  async function seek(position: number) {
    if (!vutronPlugin.seek) return
    try { await vutronPlugin.seek({ position }); await refreshPlaybackState() }
    catch (cause) { error.value = errorMessage(cause, t('mobile.runtimeText.seekFailed')) }
  }

  async function refreshPlaybackState() {
    if (playbackRequestPending) return
    playbackRequestPending = true
    const volumeReadRevision = volumeRevision
    const pendingTrackVolumes = new Set([...trackVolumeWriters].filter(([, writer]) => writer.pending()).map(([key]) => key))
    const pendingPlaylistVolumes = new Set([...playlistVolumeWriters].filter(([, writer]) => writer.pending()).map(([key]) => key))
    try {
      const next = { ...emptyPlaybackState, ...(await vutronPlugin.getPlaybackState()) }
      const previousTrackKey = playbackTrackKey()
      const nextKey = playbackTrackKey(next)
      const trackDraft = trackVolumeDrafts.get(nextKey)
      const playlistKey = next.track?.playlistVolumeKey ?? ''
      const playlistDraft = playlistVolumeDrafts.get(playlistKey)
      if (trackDraft) {
        if (pendingTrackVolumes.has(nextKey) || trackVolumeWriters.get(nextKey)?.pending() || trackDraft.revision > volumeReadRevision || next.trackVolumePercent !== trackDraft.value) next.trackVolumePercent = trackDraft.value
        else trackVolumeDrafts.delete(nextKey)
      }
      if (playlistDraft) {
        if (pendingPlaylistVolumes.has(playlistKey) || playlistVolumeWriters.get(playlistKey)?.pending() || playlistDraft.revision > volumeReadRevision || next.playlistVolumePercent !== playlistDraft.value) next.playlistVolumePercent = playlistDraft.value
        else playlistVolumeDrafts.delete(playlistKey)
      }
      const startedPlaying = next.playing && (!playback.value.playing || previousTrackKey !== nextKey)
      playback.value = next
      if (startedPlaying && next.track?.playlistOrderScope && next.track.playlistOrderKey) {
        try { recordPlaylistPlayback(next.track.playlistOrderScope, next.track.playlistOrderKey) }
        catch (cause) { console.warn('Playlist history save failed', cause) }
      }
      const nextTrackKey = playbackTrackKey()
      if (nextTrackKey !== previousTrackKey) overlaySettings.value.currentLyricOffsetMs = offsetDrafts.get(nextTrackKey)?.value ?? 0
      if (next.trackId && nextTrackKey !== overlayTrackKey) await loadOverlaySettings()
      if (queueOpen.value && queueStateKey(next) !== queueReadKey) await loadPlaybackQueue()
      if (vutronPlugin.getSleepTimer) {
        const revision = sleepTimerRevision
        try { const sample = await vutronPlugin.getSleepTimer(); if (revision === sleepTimerRevision && !sleepTimerBusy.value) syncSleepTimer(sample) }
        catch { /* Timer support was added after the earliest WebShell build. */ }
      }
      if (next.trackId && next.trackId !== lyricTrackId) await loadLyrics(next.trackId)
    } catch (cause) { error.value = errorMessage(cause, t('mobile.runtimeText.playbackReadFailed')) }
    finally { playbackRequestPending = false }
  }

  async function loadLyrics(trackId: number) {
    if (!hasAccess.value || !vutronPlugin.getLyrics || !trackId) return
    const requestId = ++lyricsRequestId
    lyricsLoading.value = true
    try {
      const payload = await vutronPlugin.getLyrics({ trackId })
      if (requestId !== lyricsRequestId || playback.value.trackId !== trackId) return
      lyrics.value = selectLyricFamily(payload); lyricTrackId = trackId
    } catch { if (requestId === lyricsRequestId) lyrics.value = { original: [], translation: [], pairedTranslations: [], source: 'empty' } }
    finally { if (requestId === lyricsRequestId) lyricsLoading.value = false }
  }

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
    const fromPlaylist = activeTab.value === 'library' && selectedPlaylist.value
      && tracks.value.some(item => item.id === track.id && item.localUri === track.localUri) ? selectedPlaylist.value : undefined
    const fromLocal = activeTab.value === 'localCollection' ? selectedLocalCollection.value : undefined
    const key = playlistKey ?? track.playlistVolumeKey ?? (fromPlaylist ? `netease:${fromPlaylist.id}` : fromLocal?.id ?? '')
    const name = track.playlistVolumeName || (fromPlaylist && key === `netease:${fromPlaylist.id}` ? fromPlaylist.name
      : fromLocal && key === fromLocal.id ? fromLocal.name : key === 'local:folder' ? t('mobile.runtimeText.localMusic') : key === 'cache:all' ? t('mobile.runtimeText.cachedMusic') : '')
    return { ...track, artists: track.artists?.slice(), playlistVolumeKey: key, playlistVolumeName: name,
      playlistOrderScope: fromPlaylist ? 'netease:' + (fromPlaylist.cacheOwnerId || profile.value?.userId || 0) : fromLocal ? 'local:device' : playlistKey ? undefined : track.playlistOrderScope,
      playlistOrderKey: fromPlaylist ? String(fromPlaylist.cacheOwnerId || profile.value?.userId || 0) + ':' + fromPlaylist.id : fromLocal?.id || (playlistKey ? undefined : track.playlistOrderKey) }
  }
  async function queueTrackNext(track: VutronTrack) {
    if (!vutronPlugin.addToPlayNext) { error.value = t('mobile.runtimeText.playNextUnsupported'); return false }
    const contextual = trackWithContext(track)
    try {
      playbackQueue.value = await vutronPlugin.addToPlayNext({ track: contextual })
      queueNotice.value = t('mobile.runtimeText.queuedNext', { name: track.name })
      return true
    } catch (cause) { error.value = errorMessage(cause, t('mobile.runtimeText.playNextFailed')); return false }
  }
  async function appendTrackToQueue(track: VutronTrack) {
    if (!vutronPlugin.appendToPlaybackQueue) { error.value = t('mobile.runtimeText.appendUnsupported'); return false }
    try {
      playbackQueue.value = await vutronPlugin.appendToPlaybackQueue({ track: trackWithContext(track) })
      queueNotice.value = t('mobile.runtimeText.queuedEnd', { name: track.name })
      return true
    } catch (cause) { error.value = errorMessage(cause, t('mobile.runtimeText.appendFailed')); return false }
  }
  async function playQueueIndex(index: number, upNext = false) {
    if (!vutronPlugin.playQueueIndex) return
    try { playbackQueue.value = await vutronPlugin.playQueueIndex({ index, upNext }); await refreshPlaybackState() }
    catch (cause) { error.value = errorMessage(cause, t('mobile.runtimeText.queuePlayFailed')) }
  }
  async function removeQueueTrack(index: number, upNext = false) {
    if (!vutronPlugin.removeQueueTrack) return
    try { playbackQueue.value = await vutronPlugin.removeQueueTrack({ index, upNext }); await refreshPlaybackState() }
    catch (cause) { error.value = errorMessage(cause, t('mobile.runtimeText.queueRemoveFailed')) }
  }
  async function clearPlayNext() {
    if (!vutronPlugin.clearPlayNext) return
    try { playbackQueue.value = await vutronPlugin.clearPlayNext() }
    catch (cause) { error.value = errorMessage(cause, t('mobile.runtimeText.upNextClearFailed')) }
  }

  async function setAutoMatchSources(enabled: boolean) {
    try { autoMatchSources.value = (await vutronPlugin.updateSourceSettings({ autoMatch: enabled })).autoMatch }
    catch (cause) { error.value = errorMessage(cause, t('mobile.runtimeText.sourcesSaveFailed')) }
  }

  async function setCurrentTrackVolume(percent: number) {
    if (!Number.isInteger(percent) || percent < 0 || percent > 100 || !playback.value.trackId) return
    const key = playbackTrackKey()
    const track = playback.value.track ? { ...playback.value.track } : { id: playback.value.trackId, name: playback.value.title }
    trackVolumeDrafts.set(key, { value: percent, revision: ++volumeRevision })
    playback.value.trackVolumePercent = percent
    let writer = trackVolumeWriters.get(key)
    if (!writer) {
      writer = createLiveSettingWriter<number>({
        write: async value => { await vutronPlugin.setTrackVolume({ track, percent: value }) },
        onError: cause => { error.value = errorMessage(cause, t('mobile.runtimeText.trackVolumeSaveFailed')) }
      })
      trackVolumeWriters.set(key, writer)
    }
    await writer.queue(percent)
  }

  async function setCurrentPlaylistVolume(percent: number) {
    const playlistKey = playback.value.track?.playlistVolumeKey
    if (!playlistKey || !Number.isInteger(percent) || percent < 0 || percent > 100) return
    playlistVolumeDrafts.set(playlistKey, { value: percent, revision: ++volumeRevision })
    playback.value.playlistVolumePercent = percent
    let writer = playlistVolumeWriters.get(playlistKey)
    if (!writer) {
      writer = createLiveSettingWriter<number>({
        write: async value => { await vutronPlugin.setPlaylistVolume({ playlistKey, percent: value }) },
        onError: cause => { error.value = errorMessage(cause, t('mobile.runtimeText.playlistVolumeSaveFailed')) }
      })
      playlistVolumeWriters.set(playlistKey, writer)
    }
    await writer.queue(percent)
  }

  async function loadOverlaySettings() {
    if (!vutronPlugin.getLyricOverlaySettings) return
    const requestId = ++overlayReadRequest
    const revision = overlayRevision
    const readOffsetRevision = offsetRevision
    const trackKey = playbackTrackKey()
    const readingDirtyKeys = [...overlayDrafts.keys()]
    const readingOffsetWrite = offsetWriters.get(trackKey)?.pending()
    try {
      const next = await vutronPlugin.getLyricOverlaySettings()
      if (requestId !== overlayReadRequest) return
      const { currentLyricOffsetMs, ...globalSettings } = next
      if (revision === overlayRevision) {
        const safeSettings: Partial<VutronLyricOverlaySettings> = { ...globalSettings }
        for (const key of readingDirtyKeys) delete safeSettings[key]
        for (const key of overlayDrafts.keys()) delete safeSettings[key]
        overlaySettings.value = { ...overlaySettings.value, ...safeSettings }
      }
      const draft = offsetDrafts.get(trackKey)
      if (!readingOffsetWrite && trackKey === playbackTrackKey() && !offsetWriters.get(trackKey)?.pending() && (!draft || draft.revision <= readOffsetRevision)) {
        if (!draft || currentLyricOffsetMs === draft.value) {
          overlaySettings.value.currentLyricOffsetMs = currentLyricOffsetMs ?? 0
          offsetDrafts.delete(trackKey)
        }
        overlayTrackKey = trackKey
      }
    } catch (cause) {
      error.value = errorMessage(cause, t('mobile.runtimeText.overlayReadFailed'))
    }
  }

  async function toggleLyricOverlay() {
    const enabled = !overlaySettings.value.enabled
    await updateOverlayField('enabled', enabled)
  }

  async function updateOverlayField(key: keyof VutronLyricOverlaySettings, value: boolean | number) {
    if (key === 'currentLyricOffsetMs') { await updateCurrentLyricOffset(Number(value)); return }
    const patch = { [key]: value } as Partial<VutronLyricOverlaySettings>
    overlayDrafts.set(key, { value, revision: ++overlayRevision })
    overlaySettings.value = { ...overlaySettings.value, ...patch }
    await overlayWriter.queue(patch)
  }

  async function temporarilyHideOverlay() {
    if (!vutronPlugin.temporaryHideLyricOverlay) return
    try {
      const next = await vutronPlugin.temporaryHideLyricOverlay({ durationMs: 30_000 })
      overlaySettings.value.temporaryHidden = next.temporaryHidden
      overlaySettings.value.temporaryHiddenRemainingMs = next.temporaryHiddenRemainingMs
    }
    catch (cause) { error.value = errorMessage(cause, t('mobile.runtimeText.overlayHideFailed')) }
  }
  async function restoreOverlay() {
    if (!vutronPlugin.restoreLyricOverlay) return
    try {
      const next = await vutronPlugin.restoreLyricOverlay()
      overlaySettings.value.temporaryHidden = next.temporaryHidden
      overlaySettings.value.temporaryHiddenRemainingMs = next.temporaryHiddenRemainingMs
    }
    catch (cause) { error.value = errorMessage(cause, t('mobile.runtimeText.overlayRestoreFailed')) }
  }

  async function updateOverlayColor(key: 'playedColor' | 'unplayedColor' | 'shadowColor', value: string) {
    const parsed = Number.parseInt(value.replace('#', ''), 16)
    if (!Number.isFinite(parsed)) return
    const alpha = key === 'shadowColor' ? overlaySettings.value.shadowColor & 0xff000000 : 0xff000000
    await updateOverlayField(key, (alpha | parsed) >>> 0)
  }

  async function updateOverlayBackgroundOpacity(percent: number) {
    const alpha = Math.round(Math.max(0, Math.min(100, percent)) * 255 / 100)
    const rgb = overlaySettings.value.backgroundColor & 0x00ffffff
    await updateOverlayField('backgroundColor', ((alpha << 24) | rgb) >>> 0)
  }

  async function updateCurrentLyricOffset(offsetMs: number) {
    if (!vutronPlugin.setLyricOffset || !playback.value.trackId) return
    if (!Number.isFinite(offsetMs) || offsetMs < -30_000 || offsetMs > 30_000) { error.value = t('mobile.runtimeText.offsetRange'); return }
    const trackId = playback.value.trackId
    const trackKey = playbackTrackKey()
    const track = playback.value.track ? { ...playback.value.track } : { id: trackId, name: playback.value.title }
    offsetDrafts.set(trackKey, { value: offsetMs, revision: ++offsetRevision })
    overlaySettings.value.currentLyricOffsetMs = offsetMs
    overlayTrackKey = trackKey
    let writer = offsetWriters.get(trackKey)
    if (!writer) {
      writer = createLiveSettingWriter<number>({
        write: async value => { await vutronPlugin.setLyricOffset!({ trackId, track, offsetMs: value }) },
        onError: cause => { error.value = errorMessage(cause, t('mobile.runtimeText.offsetSaveFailed')) }
      })
      offsetWriters.set(trackKey, writer)
    }
    await writer.queue(offsetMs)
  }

  async function flushLiveSettings() {
    await Promise.all([flushRegisteredLiveSettings(), overlayWriter.flush(), ...[...offsetWriters.values(), ...trackVolumeWriters.values(), ...playlistVolumeWriters.values()].map(writer => writer.flush())])
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
  async function setAutomaticCache(enabled: boolean) {
    if (!vutronPlugin.setCacheEnabled) return
    ++cacheSettingsRevision
    try { cacheStatus.value = await vutronPlugin.setCacheEnabled({ enabled }) }
    catch (cause) { error.value = errorMessage(cause, t('mobile.runtimeText.autoCacheSaveFailed')) }
  }
  async function loadCacheStatus(updateInputs = true) {
    if (!vutronPlugin.getCacheStatus || cacheStatusPending) return
    cacheStatusPending = true
    const revision = cacheSettingsRevision
    try {
      const status = await vutronPlugin.getCacheStatus()
      if (revision !== cacheSettingsRevision) return
      cacheStatus.value = status
      if (updateInputs) {
        cacheCapacityMb.value = status.capacityMb
        artworkCacheCapacityMb.value = status.artworkCapacityMb ?? artworkCacheCapacityMb.value
      }
      if (vutronPlugin.getCachedTracks) {
        const cached = await vutronPlugin.getCachedTracks()
        if (revision === cacheSettingsRevision) cachedTracks.value = cached.tracks ?? []
      }
    } catch (cause) { error.value = errorMessage(cause, t('mobile.runtimeText.cacheStatusReadFailed')) }
    finally { cacheStatusPending = false }
  }
  async function setCacheCapacity() {
    if (!vutronPlugin.setCacheCapacity) return
    ++cacheSettingsRevision
    try { cacheStatus.value = await vutronPlugin.setCacheCapacity({ capacityMb: cacheCapacityMb.value }) }
    catch (cause) { error.value = errorMessage(cause, t('mobile.runtimeText.cacheCapacitySaveFailed')) }
  }
  async function setArtworkCacheCapacity() {
    if (!vutronPlugin.setArtworkCacheCapacity) return
    ++cacheSettingsRevision
    try { cacheStatus.value = await vutronPlugin.setArtworkCacheCapacity({ capacityMb: artworkCacheCapacityMb.value }) }
    catch (cause) { error.value = errorMessage(cause, t('mobile.runtimeText.artworkCapacitySaveFailed')) }
  }
  async function cacheCurrent() {
    if (!onlineAvailable.value || !vutronPlugin.cacheTrack || !playback.value.trackId) return
    const track = playback.value.track ?? [...tracks.value, ...localTracks.value].find(item => item.id === playback.value.trackId)
    if (!track) return
    try { await vutronPlugin.cacheTrack({ track }); await loadCacheStatus() }
    catch (cause) { error.value = errorMessage(cause, t('mobile.runtimeText.trackCacheFailed')) }
  }
  async function clearCache() {
    if (!vutronPlugin.clearCache) return
    try { await vutronPlugin.clearCache(); await Promise.all([loadCacheStatus(), loadOfflinePlaylists()]) }
    catch (cause) { error.value = errorMessage(cause, t('mobile.runtimeText.cacheClearFailed')) }
  }

  async function setSleepTimer(minutes: number) {
    await setSleepTimerSeconds(minutes * 60)
  }
  async function setSleepTimerSeconds(seconds: number) {
    if (sleepTimerBusy.value || !vutronPlugin.setSleepTimer || !Number.isFinite(seconds) || seconds < 1 || seconds > 18000) return
    sleepTimerBusy.value = true; ++sleepTimerRevision; error.value = ''
    try { syncSleepTimer(await vutronPlugin.setSleepTimer({ durationMs: Math.round(seconds * 1000) })) }
    catch (cause) { error.value = errorMessage(cause, t('mobile.runtimeText.timerSaveFailed')) }
    finally { sleepTimerBusy.value = false }
  }

  async function clearSleepTimer() {
    if (sleepTimerBusy.value || !vutronPlugin.clearSleepTimer) return
    sleepTimerBusy.value = true; ++sleepTimerRevision
    try { syncSleepTimer(await vutronPlugin.clearSleepTimer()) }
    catch (cause) { error.value = errorMessage(cause, t('mobile.runtimeText.timerCancelFailed')) }
    finally { sleepTimerBusy.value = false }
  }

  const sleepTimerLabel = computed(() => timerLabel(sleepTimerRemainingMs.value))

  function startPlaybackPolling(intervalMs = 2000) {
    stopPlaybackPolling(); void refreshPlaybackState()
    startSleepClock()
    playbackTimer = setInterval(() => {
      if (document.visibilityState === 'hidden') return
      void refreshPlaybackState()
      if (!['settings', 'library'].includes(activeTab.value)) return
      const now = Date.now()
      if (now - cachePollAt >= 5000) { cachePollAt = now; void loadCacheStatus(false) }
    }, intervalMs)
  }
  function stopPlaybackPolling() { if (playbackTimer !== undefined) clearInterval(playbackTimer); playbackTimer = undefined; stopSleepClock() }
  return {
    ...onlineLibrary,
    profile, playlists, playlistsLoading, cachedPlaylists, removeCachedPlaylistView, tracks, selectedPlaylist, selectedEntity, localTracks, cachedTracks, folderName, cacheStatus, cacheCapacityMb,
    localLibrary, selectedLocalCollection, libraryLoading, localScanLoading, loadLocalLibrary, importLocalPlaylist, openLocalCollection, reloadManagedLibrary,
    homeData, homeLoading, searchCategory, searchKeywords, submittedSearch, searchResults, searchCount, searchNextPage, searchLoading,
    sleepTimerRemainingMs, sleepTimerMinutes, sleepTimerLabel, cacheAllPlaylistsLoading, cacheAllPlaylistsResult,
    lyrics, lyricsLoading, activeTab, loading, error, playback, loggedIn, localOnly, manualLocalOnly, networkConnected, hasAccess, onlineAvailable, loginVisible, localModeLoading, enterLocalOnly, useAutomaticMode, refreshConnectivity, disposeNetworkMonitoring, requestLogin,
    playbackQueue, queueOpen, queueNotice, showPlaybackQueue, loadPlaybackQueue, trackWithContext, queueTrackNext, appendTrackToQueue, playQueueIndex, removeQueueTrack, clearPlayNext,
    canNavigateBack, navigationDirection, navigationScrollY, navigateTo, navigateBack, activePluginId, openPlugins, activeMusicSourceId, selectMusicSource, discardMusicSource, retainMusicSources,
    qrLoginKey, qrLoginImage, qrLoginStatus, qrLoginLoading,
    restore, login, createQrLogin, checkQrLogin, cancelQrLogin, loadPlaylists, loadOfflinePlaylists, loadHomeData, openPlaylist, cachePlaylist, cacheAllPlaylists, openCachedPlaylist, openEntityTracks,
    runSearch, loadMoreSearch, openMv, play, playPlugin, queuePlugin, pluginRadioTrash, reorderLocalPlayback, playAdjacent, pause, resume, stop, seek, cyclePlaybackMode, setPlaybackMode, playbackModeBusy, refreshPlaybackState, loadLyrics,
    pickMusicFolder, loadLocalMusic, loadCacheStatus, setCacheCapacity, setArtworkCacheCapacity, artworkCacheCapacityMb, cacheCurrent, clearCache,
    setSleepTimer, setSleepTimerSeconds, sleepTimerBusy, clearSleepTimer, setAutomaticCache, temporarilyHideOverlay, restoreOverlay,
    autoMatchSources, loadSourceSettings, setAutoMatchSources, setCurrentTrackVolume, setCurrentPlaylistVolume,
    overlaySettings, overlayEnabled, overlayPlayedColor, overlayUnplayedColor, overlayShadowColor, overlayBackgroundOpacity,
    loadOverlaySettings, toggleLyricOverlay, updateOverlayField, updateOverlayColor,
    updateOverlayBackgroundOpacity, updateCurrentLyricOffset, flushLiveSettings,
    startPlaybackPolling, stopPlaybackPolling, logout
  }
})
