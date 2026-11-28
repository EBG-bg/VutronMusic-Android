<script setup lang="ts">
import { buildInfo } from './platform/buildInfo'
import { computed, defineAsyncComponent, nextTick, onMounted, onUnmounted, ref, toRef, watch } from 'vue'
import { useI18n } from 'vue-i18n'
import { App as CapacitorApp } from '@capacitor/app'
import { Capacitor, type PluginListenerHandle } from '@capacitor/core'
import CoverImage from './components/CoverImage.vue'
import PluginArtwork from './components/PluginArtwork.vue'
import MusicSourceSwitcher from './components/MusicSourceSwitcher.vue'
import LibrarySidebarPanel from './components/LibrarySidebarPanel.vue'
import OriginalIcon from './components/OriginalIcon.vue'
import originalBrandLogo from '../../../src/renderer/assets/images/vutronmusic-icon.png?url'
import WindowedTrackList from './components/WindowedTrackList.vue'
import TrackSelectionBar from './components/TrackSelectionBar.vue'
import UndoToast from './components/UndoToast.vue'
import { useTrackSelection, type TrackBatchAction } from './composables/trackSelection'
import { trackKey } from './composables/localTrackOrdering'
import { isCurrentTrack } from './platform/currentTrack'
import AppUpdateNotice from './components/AppUpdateNotice.vue'
import ActionDialog from './components/ActionDialog.vue'
import OnlinePlaylistDialog from './components/OnlinePlaylistDialog.vue'
import LibraryTaskProgress from './components/LibraryTaskProgress.vue'
import { initializeLibraryTasks, disposeLibraryTasks } from './platform/libraryTasks'
import { useLibraryManagement } from './composables/libraryManagement'
import { actionDialog, settleAction } from './platform/actionDialog'
import { activeAppSelect, closeAppSelect } from './platform/appSelect'
import { initializeAppUpdates, disposeAppUpdates } from './platform/appUpdates'
import { useDebouncedLibraryQuery, useProgressiveTracks } from './composables/libraryPresentation'
import LocalTrackList from './components/LocalTrackList.vue'
import { usePageRefresh } from './composables/pageRefresh'
import CollapsibleSettingsCard from './components/CollapsibleSettingsCard.vue'
import ThumbRange from './components/ThumbRange.vue'
import { finishNavigationSwipeEnter, useMainNavigationSwipe } from './composables/mainNavigationSwipe'
import NavigationPreview from './components/NavigationPreview.vue'
import NavigationPeek from './components/NavigationPeek.vue'
import NativeHomeView from './components/NativeHomeView.vue'
import LibraryHeader from './components/LibraryHeader.vue'
import LibraryPane from './components/LibraryPane.vue'
import type { HomeShelfPositions, LibraryMode } from './composables/navigationPreview'
import { useBottomNavigationScrub } from './composables/bottomNavigationScrub'
import { useNavigationIndicator } from './composables/navigationIndicator'
import { playerLyrics } from './platform/interfacePreferences'
import SideNavItem from '../../../packages/ui/src/SideNavItem.vue'
import PlayerVisual from './components/PlayerVisual.vue'
import PlayerPlaybackStatus from './components/PlayerPlaybackStatus.vue'
import PlayerNavigationPreview from './components/PlayerNavigationPreview.vue'
import PlaybackModeControl from './components/PlaybackModeControl.vue'
import { playlistView, playlistColumns } from './platform/libraryLayout'
import PlaybackQueuePanel from './components/PlaybackQueuePanel.vue'
import PlaybackErrorNotice from './components/PlaybackErrorNotice.vue'
import AppErrorNotice from './components/AppErrorNotice.vue'
import { usePlaybackTuning } from './composables/playbackTuning'
import { reducedMotion } from './platform/motion'
import { onlineTrackId } from './stores/domains/neteaseLibrary'
import TrackMenuButton from './components/TrackMenuButton.vue'
import NativeSearchHeader from './components/NativeSearchHeader.vue'
import NativeSearchResults from './components/NativeSearchResults.vue'
import NativeSearchPreview from './components/NativeSearchPreview.vue'
import { nativeSearchCategories } from './composables/nativeSearchCategories'
import PlaylistMenuButton from './components/PlaylistMenuButton.vue'
import { useTrackActionMenu } from './composables/trackActionMenu'
import { useAndroidShellStore } from './stores/androidShell'
import { vutronPlugin, type VutronTrack, type VutronPlaylist, type VutronSearchCategory, type VutronSearchEntity } from './platform/vutronPlugin'
import type { PluginPlayback } from './plugins/protocol'
import { requestPluginNavigation, type PluginNavigation } from './plugins/navigation'
import { appNavigation } from './composables/navigationGuard'
import { useMusicSources } from './plugins/useMusicSources'

const store = useAndroidShellStore()
const musicSources = useMusicSources(undefined, toRef(store, 'activeMusicSourceId'))
const loadSettingsView = () => import('./components/AppSettingsView.vue')
const AppSettingsView = defineAsyncComponent(loadSettingsView)
const AppAboutView = defineAsyncComponent(() => import('./components/AppAboutView.vue'))
const PluginManagerView = defineAsyncComponent(() => import('./components/PluginManagerView.vue'))
const PluginLibraryView = defineAsyncComponent(() => import('./components/PluginLibraryView.vue'))
const TrackActionMenu = defineAsyncComponent(() => import('./components/TrackActionMenu.vue'))
const CommentSheet = defineAsyncComponent(() => import('./components/CommentSheet.vue'))
const PlaybackTuningSheet = defineAsyncComponent(() => import('./components/PlaybackTuningSheet.vue'))
const AbLoopSheet = defineAsyncComponent(() => import('./components/AbLoopSheet.vue'))
const pluginSurface = ref<{ handleBack(): boolean; refresh?(): Promise<void>; goRoot?(): void }>()
const pluginViewState = ref({ isDetail: false, canGoBack: false, caption: '', loading: false })
const pageTransitioning = ref(false)
const mainTabTransition = ref<'next' | 'previous'>()
const pendingSurfaceAction = ref<{ key: string; action: 'root' | 'back' }>()
const pluginEntryEdge = ref<{ tab: string; edge: 'start' | 'end' }>()
const integratedSourceVisible = computed(() => Boolean(musicSources.selected.value) && ['home', 'library', 'search'].includes(store.activeTab))
const integratedSection = computed(() => store.activeTab === 'home' ? 'home' : store.activeTab === 'search' ? 'search' : 'library')
const mainOnlineNavigation = computed(() => store.onlineAvailable || Boolean(musicSources.selected.value))
const mainTabs = computed(() => mainOnlineNavigation.value ? ['home', 'library', 'search', 'player', 'settings'] as const : ['library', 'player', 'settings'] as const)
const mainNavigationTab = computed(() => store.activeTab === 'about' ? 'settings' : store.activeTab === 'playlist' ? store.playlistOrigin : store.activeTab === 'entity' || store.activeTab === 'localCollection' ? 'library' : store.activeTab)
const navIndex = computed(() => mainTabs.value.indexOf(mainNavigationTab.value as never))
const bottomNavigation = ref<HTMLElement>()
const pageFrame = ref<HTMLElement>()
const homeShelfPositions: HomeShelfPositions = new Map()
watch(() => store.profile?.userId, () => homeShelfPositions.clear(), { flush: 'sync' })
const transitionHeight = ref<number>()
const trackMenuSurface = ref<{ handleBack(): boolean }>()
async function playFromPlugin(value: PluginPlayback) { await store.playPlugin(value) }
function navigateTo(tab: Parameters<typeof store.navigateTo>[0], preserveEntryEdge = false) {
  if (!preserveEntryEdge) pluginEntryEdge.value = undefined
  if (tab === store.activeTab && integratedSourceVisible.value) {
    if (pageTransitioning.value || pluginViewState.value.loading) pendingSurfaceAction.value = { key: pageKey.value, action: 'root' }
    else void pluginSurface.value?.goRoot?.()
    return
  }
  if (tab === store.activeTab) return
  appNavigation.run(() => {
    const from = mainTabs.value.indexOf(mainNavigationTab.value as never), to = mainTabs.value.indexOf(tab as never)
    mainTabTransition.value = from >= 0 && to >= 0 && from !== to ? to > from ? 'next' : 'previous' : undefined
    store.navigateTo(tab)
  })
}
function openPluginSource(value: Omit<PluginNavigation, 'key'>) {
  appNavigation.run(() => {
    requestPluginNavigation(value)
    if (value.pluginId && musicSources.hasSource(value.pluginId)) store.selectMusicSource(value.pluginId)
    else store.openPlugins(value.pluginId)
  })
}
async function openManagedLibrary(id: string) {
  if (!musicSources.hasSource(id)) await musicSources.refresh()
  appNavigation.run(() => {
    if (id && musicSources.hasSource(id)) store.selectMusicSource(id)
    else store.openPlugins(id)
  })
}
function selectMainSource(value: string) {
  sidebarOpen.value = false
  appNavigation.run(() => {
    if (value.startsWith('plugin:')) {
      const id = value.slice(7)
      if (musicSources.hasSource(id)) store.selectMusicSource(id)
    } else if (value.startsWith('native:')) {
      const section = value.slice(7)
      if (section === 'netease' && !store.onlineAvailable) return
      setLibraryMode(section === 'local' || section === 'offline' ? section : 'playlists')
      store.selectMusicSource('', 'library')
    }
  })
}
const playbackAccountTarget = ref<string>()
function openPlaybackSourceSettings(pluginId?: string) {
  appNavigation.run(() => {
    playbackAccountTarget.value = pluginId
    store.openPlugins()
  })
}
function enterPlugins() {
  sidebarOpen.value = false
  appNavigation.run(async () => {
    if (!store.hasAccess || store.loginVisible) { await store.enterLocalOnly(); await store.useAutomaticMode() }
    store.openPlugins()
  })
}
const libraryManagement = useLibraryManagement()
const { t } = useI18n()
const queueBatchActions = computed<TrackBatchAction[]>(() => [{id:'next',label:t('mobile.plugins.playNext')},{id:'append',label:t('mobile.plugins.appendQueue')}])
const onlineBatchActions = computed<TrackBatchAction[]>(() => [...queueBatchActions.value, ...(store.onlineAvailable ? [{id:'add',label:t('mobile.netease.addTo')}] : [])])
const localBatchActions = computed<TrackBatchAction[]>(() => [...queueBatchActions.value,{id:'removeLocal',label:t('mobile.management.removeTrack'),danger:true}])
const playlistBatchActions = computed<TrackBatchAction[]>(() => [...onlineBatchActions.value, ...(!store.selectedPlaylist?.offlineSnapshot && store.canManageOnlinePlaylist(store.selectedPlaylist) ? [{id:'removeOnline',label:t('mobile.netease.remove'),danger:true}] : [])])
const cacheBatchActions = computed<TrackBatchAction[]>(() => [...onlineBatchActions.value,{id:'deleteCache',label:t('mobile.management.deleteCache'),danger:true}])
async function runNativeBatch(action:string, tracks:VutronTrack[]):Promise<boolean> {
  if (action === 'next' || action === 'append') return store.queueTracks(tracks,action)
  if (action === 'add') { if(tracks.every(track=>onlineTrackId(track)>0))store.openAddToOnlinePlaylist(tracks);else store.queueNotice=t('mobile.batch.onlineOnly');return false }
  if (action === 'removeLocal') return libraryManagement.removeLocalTracks(tracks)
  if (action === 'removeOnline') return store.removeTracksFromOnlinePlaylist(tracks)
  if (action === 'deleteCache') return libraryManagement.deleteCachedTracks(tracks)
  return false
}
const { trackAction, openTrackMenu, closeTrackMenu, vTrackMenu, trackMenuReturnFocus } = useTrackActionMenu()
const cookie = ref('')
const commentTrack = ref<VutronTrack>()
const commentReturnFocus = ref<HTMLElement>()
const tuningOpen = ref(false)
const abLoopOpen = ref(false), abLoopEnabled = toRef(store, 'abLoopEnabled')
const abLoopTrigger = ref<HTMLElement>(), tuningTrigger = ref<HTMLElement>()
const { settings: playbackTuning, load: loadPlaybackTuning } = usePlaybackTuning()
function openComments(track: VutronTrack, trigger?: HTMLElement) {
  commentReturnFocus.value = trigger ?? (document.activeElement instanceof HTMLElement ? document.activeElement : undefined)
  commentTrack.value = track
}
watch(() => [store.profile?.userId, store.onlineAvailable], () => { commentTrack.value = undefined })
const sidebarOpen = ref(false)
const sidebarTrigger = ref<HTMLElement>()
const libraryMode = ref<LibraryMode>('playlists')
const libraryPane = ref<{ closeSelection(): boolean }>()
const playerVisual = ref<{ wide: boolean; swipeViewport?: HTMLElement }>()
const localSwipeFrame = ref<HTMLElement>()
const localTransition = ref<'next' | 'previous'>('next')
const navigationEnabled = () => !sidebarOpen.value && !commentTrack.value && !trackAction.value && !store.queueOpen && !tuningOpen.value && !abLoopOpen.value && !actionDialog.value && !activeAppSelect.value && !store.onlinePlaylistDialog && !store.loginVisible && !appNavigation.pending.value
const swipeContext = computed(() => !integratedSourceVisible.value && store.activeTab === 'library' && !store.selectedPlaylist ? 'library' : !integratedSourceVisible.value && store.activeTab === 'search' ? 'search' : store.activeTab === 'player' ? 'player' : 'main')
const localTabs = computed<readonly string[]>(() => swipeContext.value === 'library' ? store.onlineAvailable ? ['playlists', 'local', 'offline'] : ['local', 'offline'] : swipeContext.value === 'search' ? nativeSearchCategories : swipeContext.value === 'player' ? playerVisual.value?.wide ? [] : ['cover', 'lyrics'] : mainTabs.value)
const swipeCurrent = computed(() => swipeContext.value === 'library' ? libraryMode.value : swipeContext.value === 'search' ? store.searchCategory : swipeContext.value === 'player' ? playerLyrics.value ? 'lyrics' : 'cover' : store.activeTab)
type SubPageEntry = { tab: 'library'; value: LibraryMode } | { tab: 'search'; value: VutronSearchCategory } | { tab: 'player'; value: boolean }
const subPageHistory = ref<SubPageEntry[]>([])
let suppressSubHistory = false
function withSuppressedSubHistory(action: () => void) {
  suppressSubHistory = true
  try { action() } finally { suppressSubHistory = false }
}
function pushSubHistory(entry: SubPageEntry) {
  if (suppressSubHistory) return
  const last = subPageHistory.value[subPageHistory.value.length - 1]
  if (last && last.tab === entry.tab && last.value === entry.value) return
  subPageHistory.value.push(entry)
  if (subPageHistory.value.length > 20) subPageHistory.value.shift()
}
watch(() => [store.activeTab, store.activeMusicSourceId, store.localOnly] as const, () => { subPageHistory.value = [] }, { flush: 'sync' })
const libraryPaneScrolls = new Map<LibraryMode, number>()
let libraryPaneHandoff: { from: number; to: number; leaving?: HTMLElement } | undefined
watch(() => store.profile?.userId, () => libraryPaneScrolls.clear(), { flush: 'sync' })
function setLibraryMode(mode: LibraryMode) {
  if (mode === libraryMode.value) return
  if (swipeContext.value === 'library') pushSubHistory({ tab: 'library', value: libraryMode.value })
  if (swipeContext.value === 'library' && localSwipeFrame.value) {
    const from = window.scrollY
    libraryPaneScrolls.set(libraryMode.value, from)
    libraryPaneHandoff = { from, to: libraryPaneScrolls.get(mode) ?? 0 }
    localTransition.value = localTabs.value.indexOf(mode) > localTabs.value.indexOf(libraryMode.value) ? 'next' : 'previous'
  }
  libraryMode.value = mode
}
function navigateByPrimarySwipe(tab: Parameters<typeof store.navigateTo>[0]) {
  const from = mainTabs.value.indexOf(mainNavigationTab.value as never)
  const to = mainTabs.value.indexOf(tab as never)
  const edge: 'start' | 'end' | undefined = from >= 0 && to >= 0 && from !== to ? (to < from ? 'end' : 'start') : undefined
  if (edge) {
    if (musicSources.selected.value && ['home', 'library', 'search'].includes(tab)) {
      pluginEntryEdge.value = { tab, edge }
    } else {
      pluginEntryEdge.value = undefined
      if (tab === 'library') {
        const modes: LibraryMode[] = store.onlineAvailable ? ['playlists', 'local', 'offline'] : ['local', 'offline']
        const target = edge === 'end' ? modes[modes.length - 1] : modes[0]
        withSuppressedSubHistory(() => { libraryMode.value = target })
      } else if (tab === 'search') {
        const target = edge === 'end' ? nativeSearchCategories[nativeSearchCategories.length - 1] : nativeSearchCategories[0]
        if (store.searchCategory !== target) {
          withSuppressedSubHistory(() => {
            store.searchCategory = target
            if (store.searchKeywords.trim()) void store.runSearch(target, store.searchKeywords.trim(), true, true)
          })
        }
      } else if (tab === 'player' && !window.matchMedia('(min-width: 840px) and (orientation: landscape)').matches) {
        withSuppressedSubHistory(() => { playerLyrics.value = edge === 'end' })
      }
    }
  }
  navigateTo(tab, true)
}
function navigateSurface(tab: string) {
  if (swipeContext.value === 'library') { appNavigation.run(() => setLibraryMode(tab as LibraryMode)); return }
  localTransition.value = localTabs.value.indexOf(tab) > localTabs.value.indexOf(swipeCurrent.value) ? 'next' : 'previous'
  if (swipeContext.value === 'search') changeSearchCategory(tab as VutronSearchCategory)
  else if (swipeContext.value === 'player') playerLyrics.value = tab === 'lyrics'
  else navigateTo(tab as Parameters<typeof store.navigateTo>[0])
}
const navigationSwipe = useMainNavigationSwipe(localTabs, swipeCurrent, () => navigationEnabled() && swipeContext.value !== 'main' && !(store.activeTab === 'library' && store.selectedPlaylist), navigateSurface, {
  allowLyrics: () => swipeContext.value === 'player', yieldAtBoundary: () => true,
  viewport: () => swipeContext.value === 'player' ? playerVisual.value?.swipeViewport : localSwipeFrame.value,
  previewTop: tab => swipeContext.value === 'library' ? window.scrollY - (libraryPaneScrolls.get(tab as LibraryMode) ?? 0) : 0,
})
function prepareLibraryPaneLeave(element: Element) {
  navigationSwipe.prepareLeave(element)
  if (libraryPaneHandoff && element instanceof HTMLElement) libraryPaneHandoff.leaving = element
}
function restoreLibraryPaneScroll() {
  const handoff = libraryPaneHandoff
  if (!handoff) return
  libraryPaneHandoff = undefined
  window.scrollTo({ top: handoff.to, behavior: 'instant' })
  // Keep the outgoing rows at their original viewport coordinates during the slide.
  handoff.leaving?.style.setProperty('--page-leave-y', window.scrollY - handoff.from + 'px')
}
const libraryNeighbor = computed(() => swipeContext.value === 'library' ? navigationSwipe.neighbor.value as LibraryMode | undefined : undefined)
const primarySwipe = useMainNavigationSwipe(mainTabs, computed(() => store.activeTab), () => navigationEnabled() && !(store.activeTab === 'library' && store.selectedPlaylist) && !(swipeContext.value === 'player' && playerVisual.value?.wide), navigateByPrimarySwipe, {
  allowLyrics: () => swipeContext.value === 'player', viewport: () => pageFrame.value,
  previewTop: tab => window.scrollY - store.tabScrollFor(tab)
})
const primaryPeekEdge = computed<'start' | 'end' | undefined>(() => {
  const neighbor = primarySwipe.neighbor.value
  if (!neighbor) return undefined
  const from = mainTabs.value.indexOf(store.activeTab as never), to = mainTabs.value.indexOf(neighbor as never)
  return from >= 0 && to >= 0 && from !== to ? (to < from ? 'end' : 'start') : undefined
})
const peekLibraryMode = computed<LibraryMode>(() => primaryPeekEdge.value === 'end' ? 'offline' : primaryPeekEdge.value === 'start' ? (store.onlineAvailable ? 'playlists' : 'local') : libraryMode.value)
const peekSearchCategory = computed<VutronSearchCategory>(() => primaryPeekEdge.value === 'end' ? nativeSearchCategories[nativeSearchCategories.length - 1] : primaryPeekEdge.value === 'start' ? nativeSearchCategories[0] : store.searchCategory)
const peekPlayerLyrics = computed(() => primaryPeekEdge.value === 'end' ? true : primaryPeekEdge.value === 'start' ? false : playerLyrics.value)
function startContentSwipe(event: TouchEvent) { navigationSwipe.start(event); primarySwipe.start(event) }
function startContentPointer(event: PointerEvent) { navigationSwipe.pointerStart(event); primarySwipe.pointerStart(event) }
function moveContentSwipe(event: TouchEvent) { navigationSwipe.move(event); primarySwipe.move(event) }
function endContentSwipe(event: TouchEvent) { navigationSwipe.end(event); primarySwipe.end(event) }
function cancelContentSwipe() { navigationSwipe.cancel(); primarySwipe.cancel() }
function clickContentSwipe(event: MouseEvent) { navigationSwipe.click(event); primarySwipe.click(event) }
function dragContentSwipe(event: DragEvent) { navigationSwipe.dragStart(event); primarySwipe.dragStart(event) }
const navigationScrub = useBottomNavigationScrub(bottomNavigation, mainTabs, mainNavigationTab, navigationEnabled, navigateTo)
const navIndicatorStyle = useNavigationIndicator(bottomNavigation, computed(() => primarySwipe.position.value ?? navIndex.value), computed(() => mainTabs.value.length))
// A short directional hold is enough to warm one real search page, but a
// jitter across the center should not send requests for both directions.
watch([() => navigationSwipe.neighbor.value, swipeContext], ([category, context], _, onCleanup) => {
  if (context !== 'search' || !category || !navigationSwipe.holding.value) return
  const timer = setTimeout(() => store.warmSearchCategory(category as VutronSearchCategory), 100)
  onCleanup(() => clearTimeout(timer))
})
watch([() => primarySwipe.neighbor.value, () => primarySwipe.holding.value, peekSearchCategory], ([neighbor, holding, category], _, onCleanup) => {
  if (musicSources.selected.value || neighbor !== 'search' || !holding || category === store.searchCategory) return
  const timer = setTimeout(() => store.warmSearchCategory(category), 100)
  onCleanup(() => clearTimeout(timer))
})
const pageSwipeStyle = primarySwipe.style
const localSwipeStyle = computed(() => swipeContext.value !== 'main' ? navigationSwipe.style.value : {})
watch(playerLyrics, (value, previous) => {
  if (store.activeTab === 'player') {
    localTransition.value = value ? 'next' : 'previous'
    if (!playerVisual.value?.wide && previous !== undefined && value !== previous) pushSubHistory({ tab: 'player', value: previous })
  }
}, { flush: 'sync' })
const canStepBackInPage = computed(() =>
  subPageHistory.value.length > 0
  || (store.activeTab === 'player' && !playerVisual.value?.wide && playerLyrics.value)
  || (!store.activeMusicSourceId && !store.localOnly && store.activeTab === 'library' && libraryMode.value !== 'playlists')
)
const networkStatusKey = computed(() =>
  store.manualLocalOnly ? 'mobile.network.manualOffline'
    : !store.networkConnected
      ? (store.networkReason === 'unreachable' ? 'mobile.network.unreachableOffline' : 'mobile.network.automaticOffline')
      : store.localOnly ? 'mobile.network.localGuest' : 'mobile.network.online'
)
const snapshotNoticeKey = computed(() => {
  const playlist = store.selectedPlaylist
  if (!playlist?.offlineSnapshot || !playlist.offlineReason) return ''
  if (playlist.offlineReason === 'system') return 'mobile.offline.snapshotSystem'
  if (playlist.offlineReason === 'unreachable') return 'mobile.offline.snapshotUnreachable'
  return 'mobile.offline.snapshotRequest'
})
async function retryPlaylistOnline() {
  const playlist = store.selectedPlaylist
  if (!playlist) return
  if (!store.manualLocalOnly && !store.networkConnected) {
    await store.retryConnectivity()
    if (store.onlineAvailable && store.activeTab === 'playlist' && store.selectedPlaylist?.id === playlist.id) {
      await store.openPlaylist(playlist)
    }
    return
  }
  if (store.onlineAvailable) await store.openPlaylist(playlist)
}
const selectedMainSource = computed(() => store.activeMusicSourceId ? 'plugin:' + store.activeMusicSourceId : 'native:' + (libraryMode.value === 'playlists' ? 'netease' : libraryMode.value))
const { headerRefreshLabel: nativeRefreshLabel, headerRefreshing: nativeRefreshing, refreshCurrentView: refreshNativeView } = usePageRefresh(store, libraryMode)
const headerRefreshLabel = computed(() => integratedSourceVisible.value
  ? (!store.manualLocalOnly && store.networkConnected || musicSources.selected.value?.type === 'local' ? t('mobile.plugins.refreshSource') : '')
  : nativeRefreshLabel.value)
const headerRefreshing = computed(() => integratedSourceVisible.value ? pageTransitioning.value || pluginViewState.value.loading : nativeRefreshing.value)
async function refreshCurrentView() {
  if (headerRefreshing.value) return
  if (integratedSourceVisible.value) await pluginSurface.value?.refresh?.()
  else await refreshNativeView()
}
const reloadErrorPage = computed<(() => Promise<unknown>) | undefined>(() => {
    if (store.loginVisible || !store.onlineAvailable || store.activeMusicSourceId) return undefined
  // Read-only recovery: never repeat like/create/delete or other write requests.
  if (store.activeTab === 'home') return async () => { store.error = ''; await store.loadHomeData() }
  if (store.activeTab === 'search' && store.searchKeywords.trim()) return async () => { store.error = ''; await store.runSearch() }
  if (store.activeTab === 'library' && libraryMode.value === 'playlists') return async () => { store.error = ''; await store.loadPlaylists() }
  return undefined
})
const query = ref('')
const seeking = ref(false)
const seekValue = ref(0)
const heroIndex = ref(0)
let heroTimer: ReturnType<typeof setInterval> | undefined
let qrPollTimer: ReturnType<typeof setTimeout> | undefined
let qrPollPending = false
let backButtonListener: PluginListenerHandle | undefined
let noticeTimer: ReturnType<typeof setTimeout> | undefined
let disposed = false
let settingsPreload: number | undefined
let settingsWarmed = false
function warmNextPage() {
  if (settingsWarmed || settingsPreload !== undefined || store.activeTab !== 'player') return
  if (!window.requestIdleCallback) return
  settingsPreload = window.requestIdleCallback(() => {
    settingsPreload = undefined
    if (disposed || store.activeTab !== 'player' || document.visibilityState !== 'visible') return
    settingsWarmed = true
    void loadSettingsView().catch(() => { settingsWarmed = false })
  })
}
const pageKey = computed(() => integratedSourceVisible.value ? `source:${musicSources.selectionKey.value}:${store.activeTab}` : store.activeTab === 'playlist'
  ? `playlist:${store.selectedPlaylist?.pluginCacheKey || store.selectedPlaylist?.id}:${Boolean(store.selectedPlaylist?.offlineSnapshot)}`
  : store.activeTab === 'localCollection' ? `local:${store.selectedLocalCollection?.id}`
  : store.activeTab === 'plugins' ? `plugins:${store.activePluginId}`
  : store.activeTab === 'entity' ? `entity:${store.selectedEntity?.category}:${store.selectedEntity?.id}` : store.activeTab)
const transitionName = computed(() => mainTabTransition.value ? 'tab-' + mainTabTransition.value : store.activeTab === 'player' ? 'player-open' : store.navigationDirection === 'back' ? 'page-back' : 'page-forward')
const currentTrack = computed<VutronTrack>(() => {
  const id = store.playback.trackId
  const match = store.playback.track ?? store.tracks.find(track => track.id === id)
    ?? store.localTracks.find(track => track.id === id) ?? store.cachedTracks.find(track => track.id === id)
  return match ?? {
    id,
    name: store.playback.title || t('mobile.common.notPlaying'),
    artists: store.playback.artist ? [store.playback.artist] : [],
    duration: store.playback.duration
  }
})
const playbackErrorNotice = ref<{ handleBack: () => boolean; showing: boolean }>()
const showPlaybackError = computed(() => store.activeTab === 'player' && !store.loginVisible && !sidebarOpen.value
  && !commentTrack.value && !trackAction.value && !store.queueOpen && !tuningOpen.value && !abLoopOpen.value
  && !actionDialog.value && !activeAppSelect.value && !store.onlinePlaylistDialog)
const currentCover = computed(() => currentTrack.value.picLocalUri || currentTrack.value.picUrl || '')
const canPausePlayback = computed(() => Boolean(store.playback.playing || store.playback.loading))
const libraryQuery = useDebouncedLibraryQuery(query)
function playlistSummary(count: number, source?: string) {
  const tracks = t('mobile.common.tracks', { count })
  return source ? t('mobile.playlistCache.sourceTrackCount', { source, tracks }) : tracks
}
const snapshotDetailKey = computed(() => store.selectedPlaylist?.pluginCacheKey ? 'plugin:' + store.selectedPlaylist.pluginCacheKey : '')
const currentRecording = computed(() => store.playback.track)
const { visible: visibleSearchResults, hasMore: moreSearchResults, showMore: showMoreSearchResults } = useProgressiveTracks(computed(() => store.searchResults), [() => store.submittedSearch])
const visibleSearchTracks = computed(() => store.searchCategory === 'tracks' ? store.searchResults as VutronTrack[] : [])
const currentEntityIndex = computed(() => store.tracks.findIndex(track => isCurrentTrack(track, currentRecording.value, 'netease:' + (store.profile?.userId || 0))))
const searchSelection = useTrackSelection(visibleSearchTracks, trackKey,
  computed(() => JSON.stringify([pageKey.value, store.submittedSearch, store.searchCategory, store.profile?.userId || 0])),
  async () => {
    if (store.searchCategory !== 'tracks' || store.searchLoading || store.searchNextPage <= 0) return false
    const count = store.searchResults.length
    await store.loadMoreSearch()
    return store.searchResults.length > count
  })
const {active:searchSelecting,keys:searchSelectedKeys,selectedCount:searchSelectedCount,allSelected:searchAll,busy:searchBatchBusy}=searchSelection
async function loadMoreSearchResults() {
  if (store.searchCategory === 'tracks') { await store.loadMoreSearch(); return }
  if (moreSearchResults.value) { showMoreSearchResults(); return }
  await store.loadMoreSearch()
  if (moreSearchResults.value) showMoreSearchResults()
}


onMounted(async () => {
  await initializeLibraryTasks()
  if (disposed) return
  void initializeAppUpdates()
  document.addEventListener('visibilitychange', onVisibilityChange)
  if (Capacitor.isNativePlatform()) {
    const listener = await CapacitorApp.addListener('backButton', () => {
      if (!handleBack()) void CapacitorApp.minimizeApp()
    })
    if (disposed) { await listener.remove(); return }
    backButtonListener = listener
  }
  await store.restore()
  if (disposed) return
  await musicSources.refresh()
  if (disposed) return
  if (store.hasAccess) {
    if (store.localOnly) libraryMode.value = store.manualLocalOnly && (store.localTracks.length || store.localLibrary.playlists.length) ? 'local' : 'offline'
    store.startPlaybackPolling()
    startHeroRotation()
  }

})
onUnmounted(() => {
  disposed = true
  if (settingsPreload !== undefined) window.cancelIdleCallback(settingsPreload)
  disposeLibraryTasks()
  disposeAppUpdates()
  void store.flushLiveSettings()
  document.removeEventListener('visibilitychange', onVisibilityChange)
  if (noticeTimer !== undefined) clearTimeout(noticeTimer)
  store.stopPlaybackPolling()
  stopHeroRotation()
  stopQrPolling()
  void store.cancelQrLogin()
  store.disposeNetworkMonitoring()
  void backButtonListener?.remove()
  backButtonListener = undefined
})

watch(() => store.loginVisible, visible => {
  if (!visible) stopQrPolling()
})
watch(() => store.localOnly, enabled => {
  if (enabled) { setLibraryMode(store.manualLocalOnly && (store.localTracks.length || store.localLibrary.playlists.length) ? 'local' : 'offline'); stopHeroRotation() }
  else setLibraryMode('playlists')
})
watch(() => store.queueNotice, text => {
  if (noticeTimer !== undefined) clearTimeout(noticeTimer)
  if (text) noticeTimer = setTimeout(() => { store.queueNotice = '' }, 2200)
})

watch(() => [store.activeTab, store.activeMusicSourceId] as const, ([tab, source]) => {
  if (tab === 'player') { void loadPlaybackTuning(); warmNextPage() }
  if (tab === 'home' && store.onlineAvailable && !source) {
    if (!store.homeData.banners.length && !store.homeData.playlists.length) void store.loadHomeData()
    startHeroRotation()
  } else stopHeroRotation()
})
watch(pageKey, () => {
  pageTransitioning.value = true
  transitionHeight.value = Math.max(pageFrame.value?.offsetHeight ?? 0, store.navigationScrollY + innerHeight)
  pluginViewState.value = { isDetail: false, canGoBack: false, caption: '', loading: false }
})
watch([pageTransitioning, () => pluginViewState.value.loading, pageKey], () => {
  const pending = pendingSurfaceAction.value
  if (!pending) return
  if (pending.key !== pageKey.value) { pendingSurfaceAction.value = undefined; return }
  if (pageTransitioning.value || pluginViewState.value.loading) return
  pendingSurfaceAction.value = undefined
  if (pending.action === 'root') void pluginSurface.value?.goRoot?.()
  else if (!pluginSurface.value?.handleBack()) appNavigation.run(() => store.navigateBack())
}, { flush: 'post' })
watch(musicSources.plugins, plugins => {
  store.syncOfflinePlaylistSources(plugins)
  const track = trackAction.value
  if (track?.source === 'plugin-snapshot' && !plugins.some(plugin => plugin.id === track.pluginId
    && plugin.enabled && plugin.installed !== false && plugin.accountScope === track.pluginAccountScope)) closeTrackMenu()
}, { flush: 'sync' })
watch(() => musicSources.sources.value.map(source => source.id), ids => { if (musicSources.loaded.value) store.retainMusicSources(ids) })
watch(() => store.activeMusicSourceId, (id, previous) => {
  if (!id && previous && musicSources.loaded.value && !musicSources.hasSource(previous)) {
    store.discardMusicSource(previous)
    libraryMode.value = store.onlineAvailable ? 'playlists' : 'offline'
    store.queueNotice = t('mobile.plugins.sourceUnavailable')
  }
})

watch(() => store.homeData.banners, () => { heroIndex.value = 0; startHeroRotation() })

function restorePageScroll() {
  window.scrollTo({ top: store.navigationScrollY, behavior: 'instant' as ScrollBehavior })
}
function preserveTransitionSpace(element: Element) {
  if (element instanceof HTMLElement) element.style.setProperty('--page-leave-y', store.navigationScrollY - window.scrollY + 'px')
  primarySwipe.prepareLeave(element)
}
function preparePageEnter() { restorePageScroll() }
function releaseTransitionSpace() {
  if (!pageTransitioning.value && !pluginViewState.value.loading && !store.loading) transitionHeight.value = undefined
}
function finishPageTransition(element: Element) {
  finishNavigationSwipeEnter(element)
  if (!element.hasAttribute('data-slide-active') || element.getAttribute('data-page-key') !== pageKey.value) return
  pageTransitioning.value = false; mainTabTransition.value = undefined; releaseTransitionSpace()
}
watch([() => pluginViewState.value.loading, () => store.loading], releaseTransitionSpace, { flush: 'post' })

function onVisibilityChange() {
  if (document.visibilityState === 'hidden') { void store.flushLiveSettings(); store.stopPlaybackPolling(); stopQrPolling() }
  refreshOverlaySettings()
  if (document.visibilityState === 'visible' && store.hasAccess) {
    void store.refreshConnectivity()
    void musicSources.refresh()
    void store.loadLocalMusic()
    store.startPlaybackPolling()
  }
  if (document.visibilityState === 'visible' && store.activeTab === 'home') startHeroRotation()
  else stopHeroRotation()
  if (document.visibilityState === 'visible') scheduleQrPoll(500)
}

function startHeroRotation() {
  stopHeroRotation()
  if (!store.onlineAvailable || store.activeMusicSourceId) return
  if (document.visibilityState !== 'visible' || store.activeTab !== 'home' || store.homeData.banners.length < 2) return
  heroTimer = setInterval(() => moveHero(1), 8000)
}

function stopHeroRotation() {
  if (heroTimer !== undefined) clearInterval(heroTimer)
  heroTimer = undefined
}

function stopQrPolling() {
  if (qrPollTimer !== undefined) clearTimeout(qrPollTimer)
  qrPollTimer = undefined
}

function scheduleQrPoll(delay = 2200) {
  stopQrPolling()
  if (disposed || document.visibilityState !== 'visible' || !store.loginVisible || !store.qrLoginKey) return
  qrPollTimer = setTimeout(() => { void pollQrLogin() }, delay)
}

async function pollQrLogin() {
  if (disposed || document.visibilityState !== 'visible' || qrPollPending || !store.loginVisible || !store.qrLoginKey) return
  qrPollPending = true
  try { await store.checkQrLogin() }
  finally {
    qrPollPending = false
    scheduleQrPoll()
  }
}

async function refreshQrLogin() {
  stopQrPolling()
  await store.createQrLogin()
  if (store.qrLoginKey) scheduleQrPoll(500)
}

function enterLocalMode() {
  appNavigation.run(async () => {
    stopQrPolling()
    await store.enterLocalOnly()
    if (store.localOnly) libraryMode.value = store.localTracks.length || store.localLibrary.playlists.length ? 'local' : 'offline'
  })
}

function requestOnlineLogin() {
  sidebarOpen.value = false
  appNavigation.run(() => {
    store.requestLogin()
    if (Capacitor.isNativePlatform()) void refreshQrLogin()
  })
}

function moveHero(direction: -1 | 1) {
  const length = store.homeData.banners.length
  if (length < 2) return
  heroIndex.value = (heroIndex.value + direction + length) % length
}

function heroAt(offset: -1 | 0 | 1) {
  const banners = store.homeData.banners
  if (!banners.length) return undefined
  return banners[(heroIndex.value + offset + banners.length) % banners.length]
}

function clickHero(index: number) {
  if (index === heroIndex.value) activateHero(0)
  else selectHero(index)
}
function selectHero(index: number) { heroIndex.value = index; startHeroRotation() }

function activateHero(offset: -1 | 0 | 1) {
  if (offset !== 0) { moveHero(offset); return }
  const banner = heroAt(0)
  if (!banner) return
  if (banner.type === 'track') void store.play({ id: banner.id, name: banner.typeTitle || t('mobile.shellUi.recommendedTrack'), picUrl: banner.picUrl })
  else if (banner.type === 'playlist') void store.openPlaylist({ id: banner.id, name: banner.typeTitle || t('mobile.shellUi.recommendedPlaylist'), coverImgUrl: banner.picUrl })
  else if (banner.type === 'album') void store.openEntityTracks('albums', banner.id, banner.typeTitle || t('mobile.shellUi.recommendedAlbum'), banner.picUrl)
  else if (banner.type === 'mv') void store.openMv(banner.id)
  else if (banner.url) window.open(banner.url, '_blank', 'noopener,noreferrer')
}

function handleBack(): boolean {
  if (closeAppSelect()) return true
  if (tuningOpen.value) { tuningOpen.value = false; return true }
  if (abLoopOpen.value) { abLoopOpen.value = false; return true }
  if (actionDialog.value) { settleAction('cancel'); return true }
  if (commentTrack.value) { commentTrack.value = undefined; return true }
  if (store.onlinePlaylistDialog) { store.closeOnlinePlaylistDialog(); return true }
  if (store.loginVisible && store.hasAccess) { void enterLocalMode(); return true }
  if (trackAction.value) { if (!trackMenuSurface.value?.handleBack()) closeTrackMenu(); return true }
  if (store.queueOpen) { store.queueOpen = false; return true }
  if (sidebarOpen.value) { sidebarOpen.value = false; return true }
  if (playbackErrorNotice.value?.handleBack()) return true
  if (libraryPane.value?.closeSelection()) return true
  if (searchSelecting.value) {searchSelection.close();return true}
  if (appNavigation.pending.value) return true
  if (appNavigation.cancelInteraction()) return true
  const reorderBack=new Event('vutron-playlist-order-back',{cancelable:true});window.dispatchEvent(reorderBack)
  if(reorderBack.defaultPrevented)return true
  if (integratedSourceVisible.value && (pageTransitioning.value || pluginViewState.value.loading)) {
    pendingSurfaceAction.value = { key: pageKey.value, action: 'back' }; return true
  }
  if ((store.activeTab === 'plugins' || integratedSourceVisible.value) && pluginSurface.value?.handleBack()) return true
  const openDetails = Array.from(document.querySelectorAll<HTMLDetailsElement>('details[open]:not([data-closing])')).filter(node => !node.closest('[inert]')).at(-1)
  if (openDetails) {
    if (openDetails.classList.contains('settings-collapse')) openDetails.dispatchEvent(new Event('vutron-settings-close'))
    else openDetails.open = false
    return true
  }
  const lastSub = subPageHistory.value[subPageHistory.value.length - 1]
  if (lastSub && lastSub.tab === store.activeTab && !integratedSourceVisible.value) {
    if (lastSub.tab === 'library') {
      appNavigation.run(() => {
        if (subPageHistory.value[subPageHistory.value.length - 1] === lastSub) subPageHistory.value.pop()
        withSuppressedSubHistory(() => { setLibraryMode(lastSub.value) })
      })
      return true
    }
    subPageHistory.value.pop()
    if (lastSub.tab === 'search') {
      localTransition.value = nativeSearchCategories.indexOf(lastSub.value) > nativeSearchCategories.indexOf(store.searchCategory) ? 'next' : 'previous'
      withSuppressedSubHistory(() => changeSearchCategory(lastSub.value))
      return true
    }
    if (lastSub.tab === 'player' && !playerVisual.value?.wide) {
      withSuppressedSubHistory(() => { playerLyrics.value = lastSub.value })
      return true
    }
  }
  if (store.activeTab === 'player' && !playerVisual.value?.wide && playerLyrics.value) {
    withSuppressedSubHistory(() => { playerLyrics.value = false })
    return true
  }
  if (!store.activeMusicSourceId && !store.localOnly && store.activeTab === 'library' && libraryMode.value !== 'playlists') {
    appNavigation.run(() => withSuppressedSubHistory(() => { setLibraryMode('playlists'); query.value = '' })); return true
  }
  if (appNavigation.intercept(() => store.navigateBack())) return true
  return store.navigateBack()
}
function openLibrarySection(section: 'playlists' | 'local' | 'offline') {
  if (store.localOnly && section === 'playlists') return
  sidebarOpen.value = false
  appNavigation.run(() => {
    setLibraryMode(section)
    store.selectMusicSource('', 'library')
  })
}
function openSidebarCollection(collection: typeof store.localLibrary.folders[number]) {
  sidebarOpen.value = false
  if (collection.permissionGranted === false) {
    store.queueNotice = t('mobile.library.reauthorizeHint')
    void store.pickMusicFolder()
    return
  }
  appNavigation.run(() => { store.selectMusicSource('', 'library'); void store.openLocalCollection(collection) })
}
async function pickFolderFromSidebar() { sidebarOpen.value = false; await store.pickMusicFolder(); openLibrarySection('local') }
async function importFromSidebar() { sidebarOpen.value = false; await store.importLocalPlaylist() }

function submitSearch() {
  const keywords = store.searchKeywords.trim()
  if (!keywords) return
  navigateTo('search')
  void store.runSearch(store.searchCategory, keywords, true)
}

function changeSearchCategory(category: VutronSearchCategory) {
  if (swipeContext.value === 'search' && category !== store.searchCategory) pushSubHistory({ tab: 'search', value: store.searchCategory })
  store.searchCategory = category
  void store.runSearch(category, store.searchKeywords.trim(), true, true)
}

function openSearchEntity(item: { id?: number; name?: string; picUrl?: string }) {
  if (!item.id || !['albums', 'artists'].includes(store.searchCategory)) return
  void store.openEntityTracks(store.searchCategory as 'albums' | 'artists', item.id, item.name || '', item.picUrl)
}

function coverOf(item: { coverLocalUri?: string; coverImgUrl?: string; picLocalUri?: string; picUrl?: string }): string {
  return item.coverLocalUri || item.picLocalUri || item.coverImgUrl || item.picUrl || ''
}

function refreshOverlaySettings() {
  if (document.visibilityState === 'visible' && store.hasAccess) void store.loadOverlaySettings()
}

function formatTime(milliseconds: number): string {
  const totalSeconds = Math.floor(Math.max(0, milliseconds) / 1000)
  return `${Math.floor(totalSeconds / 60)}:${String(totalSeconds % 60).padStart(2, '0')}`
}

function playAdjacent(direction: -1 | 1) {
  void store.playAdjacent(direction)
}

function seekFromInput(event: Event) {
  const input = event.target as HTMLInputElement
  seeking.value = false
  void store.seek(Number(input.value))
}
function previewSeek(event: Event) {
  seeking.value = true
  seekValue.value = Number((event.target as HTMLInputElement).value)
}



</script>

<template>
  <main class="app-shell" :inert="Boolean(commentTrack) || store.queueOpen || tuningOpen || abLoopOpen || Boolean(actionDialog)" :class="[`playlist-layout-${playlistView}`, { 'settings-surface': ['settings', 'about'].includes(store.activeTab) }]" :style="{ '--playlist-columns': playlistColumns }">
    <header class="app-header">
      <button v-if="store.hasAccess && !store.loginVisible" ref="sidebarTrigger" class="icon-button sidebar-toggle" type="button" :aria-label="$t('mobile.library.openSidebar')" :aria-expanded="sidebarOpen" @click="sidebarOpen = !sidebarOpen"><OriginalIcon name="list" /></button>
      <button v-if="store.canNavigateBack || canStepBackInPage || integratedSourceVisible && pluginViewState.canGoBack" class="icon-button header-back" type="button" :aria-label="$t('mobile.common.back')" @click="handleBack"><OriginalIcon name="back" /></button>
      <div v-if="!store.hasAccess" class="brand-mark original-brand"><img :src="originalBrandLogo" :alt="buildInfo.displayName" /></div>
      <div class="brand-copy">
        <h1>{{ buildInfo.displayName }}</h1>
        <p>{{ musicSources.selected.value ? musicSources.selected.value.name : store.localOnly ? $t(networkStatusKey) : store.profile?.nickname || $t('mobile.common.mobilePlayer') }}</p>
      </div>
      <button v-if="headerRefreshLabel" class="icon-button header-refresh" :class="{ 'is-refreshing': headerRefreshing }" type="button" :aria-label="headerRefreshing ? $t('mobile.home.refreshing') : headerRefreshLabel" :title="headerRefreshLabel" :aria-busy="headerRefreshing" :disabled="headerRefreshing" @click="refreshCurrentView"><OriginalIcon name="refresh" /></button>
    </header>

    <section v-if="store.loginVisible" class="login-view">
      <div class="login-art original-login-art"><img :src="originalBrandLogo" :alt="buildInfo.displayName" /></div>
      <div class="eyebrow">YOUR MUSIC, YOUR WAY</div>
      <h2>{{ $t('mobile.login.connect') }}</h2>
      <p class="muted">{{ $t('mobile.login.description') }}</p>
      <div v-if="Capacitor.isNativePlatform()" class="qr-login-card">
        <div class="qr-image-frame">
          <img v-if="store.qrLoginImage" :src="store.qrLoginImage" :alt="$t('mobile.login.qrAlt')" />
          <div v-else class="qr-image-placeholder">{{ store.qrLoginLoading ? t('mobile.shellUi.qrGenerating') : t('mobile.shellUi.qrUnavailable') }}</div>
        </div>
        <p class="qr-login-status" role="status">{{ store.qrLoginStatus || t('mobile.shellUi.qrStartHint') }}</p>
        <button class="primary-button full-button" type="button" :disabled="store.qrLoginLoading" @click="refreshQrLogin">
          {{ store.qrLoginImage ? $t('mobile.login.qrRefresh') : t('mobile.shellUi.qrGet') }}
        </button>
        <p class="qr-login-hint">{{ $t('mobile.login.qrTip') }}</p>
      </div>
      <button class="secondary-button full-button" type="button" :disabled="store.localModeLoading" @click="enterLocalMode()">{{ store.localModeLoading ? t('mobile.shellUi.localLoading') : t('mobile.shellUi.localEntry') }}</button>
      <button class="text-button full-button" type="button" :disabled="store.localModeLoading" @click="enterPlugins">{{ $t('mobile.plugins.title') }}</button>
      <p class="setting-note">{{ $t('mobile.login.localHint') }}</p>
      <CollapsibleSettingsCard class="cookie-login-details" section-id="cookie-login" :title="$t('mobile.login.cookieFallback')" :remember="false">
        <form class="login-form" @submit.prevent="store.login(cookie)">
          <label for="cookie-input">{{ $t('mobile.login.cookieLabel') }}</label>
          <textarea id="cookie-input" v-model="cookie" autocomplete="off" spellcheck="false" :placeholder="$t('mobile.login.cookiePlaceholder')" rows="4" />
          <button class="primary-button full-button" type="submit" :disabled="store.loading">
            {{ store.loading ? $t('mobile.login.connecting') : $t('mobile.login.loginLoad') }}
          </button>
        </form>
      </CollapsibleSettingsCard>
      <AppErrorNotice v-if="store.error" :message="store.error" inline @close="store.error = ''" @login="requestOnlineLogin" @folders="store.pickMusicFolder" @storage="navigateTo('settings')" />
    </section>

    <template v-else>
      <AppErrorNotice v-if="musicSources.error.value && (mainNavigationTab === 'home' || mainNavigationTab === 'library' || mainNavigationTab === 'search' || store.activeTab === 'plugins')" :message="musicSources.error.value" :retry="musicSources.refresh" inline @close="musicSources.error.value = ''" />
      <Teleport to="body"><PlaybackQueuePanel /></Teleport>
      <Teleport to="body"><Transition name="track-menu" :duration="reducedMotion ? 0 : { enter: 320, leave: 240 }"><TrackActionMenu v-if="trackAction" ref="trackMenuSurface" :track="trackAction" :suspended="Boolean(commentTrack)" @close="closeTrackMenu" @comments="openComments($event, trackMenuReturnFocus())" /></Transition></Teleport>
      <Teleport to="body"><Transition name="track-menu" :duration="reducedMotion ? 0 : { enter: 320, leave: 240 }"><CommentSheet v-if="commentTrack" :track="commentTrack" :return-focus="commentReturnFocus" @close="commentTrack = undefined" /></Transition></Teleport>
      <Teleport to="body"><Transition name="sidebar">
        <LibrarySidebarPanel v-if="sidebarOpen" :return-focus="sidebarTrigger" @close="sidebarOpen = false">
            <div class="sidebar-heading"><img :src="originalBrandLogo" alt="" /><b>{{ buildInfo.displayName }}</b><button type="button" class="icon-button" :aria-label="$t('mobile.library.closeSidebar')" @click="sidebarOpen = false"><OriginalIcon name="close" /></button></div>
            <button type="button" v-if="store.onlineAvailable" data-music-source-native="netease" @click="openLibrarySection('playlists')"><OriginalIcon name="library" />{{ $t('mobile.library.netease') }}</button>
            <button v-if="store.onlineAvailable" type="button" :disabled="store.onlineMutationBusy" @click="sidebarOpen = false; store.openCreateOnlinePlaylist()"><OriginalIcon name="plus" />{{ $t('mobile.netease.create') }}</button>
            <button type="button" @click="pickFolderFromSidebar"><OriginalIcon name="folder" />{{ $t('mobile.library.chooseLocalFolder') }}</button>
            <button type="button" :disabled="store.libraryLoading" @click="importFromSidebar"><OriginalIcon name="down" />{{ $t('mobile.library.importDesktop') }}</button>
            <button type="button" data-music-source-native="local" @click="openLibrarySection('local')"><OriginalIcon name="local" />{{ $t('mobile.library.allLocal') }}</button>
            <button type="button" data-music-source-native="offline" @click="openLibrarySection('offline')"><OriginalIcon name="down" />{{ $t('mobile.offline.library') }}</button>
            <h3 v-if="musicSources.sources.value.length">{{ $t('mobile.plugins.sourcesSection') }}</h3>
            <button v-for="source in musicSources.sources.value" :key="source.id" type="button" :data-music-source-id="source.id" :aria-current="store.activeMusicSourceId === source.id ? 'page' : undefined" @click="selectMainSource('plugin:' + source.id)"><OriginalIcon name="library" /><span>{{ source.name }}</span></button>
            <button type="button" @click="enterPlugins"><OriginalIcon name="settings" />{{ $t('mobile.plugins.manageSources') }}</button>
            <button type="button" :disabled="store.localScanLoading" @click="store.loadLocalMusic(true)"><OriginalIcon name="refresh" />{{ $t('mobile.library.scan') }}</button>
            <h3 v-if="store.localLibrary.folders.length">{{ $t('mobile.library.myLocal') }}</h3>
            <div v-for="folder in store.localLibrary.folders" :key="folder.id" class="sidebar-managed-row"><button type="button" @click="openSidebarCollection(folder)"><OriginalIcon name="folder" /><span>{{ folder.name }}<small>{{ folder.permissionGranted === false ? $t('mobile.library.reauthorize') : $t('mobile.common.tracks', { count: folder.trackCount }) }}</small></span></button><button class="icon-button collection-delete" type="button" :aria-label="$t('mobile.management.forgetFolder') + ' ' + folder.name" @click="libraryManagement.removeCollection(folder, 'forgetFolder')"><OriginalIcon name="close" /></button></div>
            <h3 v-if="store.localLibrary.playlists.length">{{ $t('mobile.library.imported') }}</h3>
            <div v-for="playlist in store.localLibrary.playlists" :key="playlist.id" class="sidebar-managed-row"><button type="button" @click="openSidebarCollection(playlist)"><OriginalIcon name="library" /><span>{{ playlist.name }}<small>{{ $t('mobile.common.tracks', { count: playlist.trackCount }) }}</small></span></button><button class="icon-button collection-delete" type="button" :aria-label="$t('mobile.management.deletePlaylist') + ' ' + playlist.name" @click="libraryManagement.removeCollection(playlist, 'deletePlaylist')"><OriginalIcon name="close" /></button></div>
        </LibrarySidebarPanel>
      </Transition></Teleport>
      <div ref="pageFrame" class="page-frame swipe-deck" :style="{ minHeight: transitionHeight === undefined ? undefined : transitionHeight + 'px' }" @pointerdown="startContentPointer" @touchstart.passive="startContentSwipe" @touchmove="moveContentSwipe" @touchend="endContentSwipe" @touchcancel="cancelContentSwipe" @click.capture="clickContentSwipe" @dragstart.capture="dragContentSwipe">
      <Transition name="swipe-peek" @before-leave="primarySwipe.hideCommittedPeek">
        <NavigationPeek v-if="primarySwipe.neighbor.value" :style="primarySwipe.peekStyle.value" :data-peek-tab="primarySwipe.neighbor.value">
          <NativeHomeView v-if="!musicSources.selected.value && primarySwipe.neighbor.value === 'home'" :hero-index="heroIndex" :shelf-positions="homeShelfPositions" />
          <template v-else-if="!musicSources.selected.value && primarySwipe.neighbor.value === 'library'">
            <MusicSourceSwitcher v-if="musicSources.sources.value.length" :model-value="selectedMainSource" :sources="musicSources.sources.value" :online-available="store.onlineAvailable" />
            <section class="page library-page">
              <LibraryHeader :library-mode="peekLibraryMode" />
              <LibraryPane :library-mode="peekLibraryMode" :query="query" :filter="libraryQuery" :local-batch-actions="localBatchActions" :cache-batch-actions="cacheBatchActions" />
            </section>
          </template>
          <NativeSearchPreview v-else-if="!musicSources.selected.value && primarySwipe.neighbor.value === 'search'" :preview-category="peekSearchCategory" :items="store.searchCategory === 'tracks' ? visibleSearchTracks : visibleSearchResults" :more-results="moreSearchResults" />
          <PlayerNavigationPreview v-else-if="primarySwipe.neighbor.value === 'player'" :track="currentTrack" :cover="currentCover" :speed="playbackTuning.speed" :lyrics="peekPlayerLyrics" />
          <AppSettingsView v-else-if="primarySwipe.neighbor.value === 'settings'" />
          <NavigationPreview v-else :tab="primarySwipe.neighbor.value" :source-name="musicSources.selected.value?.name" />
        </NavigationPeek>
      </Transition>
      <Transition :name="transitionName" @before-leave="preserveTransitionSpace" @before-enter="primarySwipe.prepareEnter" @enter="preparePageEnter" @after-enter="finishPageTransition">
      <div :key="pageKey" class="page-stage" data-slide-active :data-page-key="pageKey" :data-swiping="primarySwipe.holding.value ? '' : undefined" :style="pageSwipeStyle">
      <MusicSourceSwitcher v-if="store.activeTab === 'library' && musicSources.sources.value.length && (!integratedSourceVisible || !pluginViewState.isDetail)" :model-value="selectedMainSource" :sources="musicSources.sources.value" :online-available="store.onlineAvailable" @select="selectMainSource" @manage="enterPlugins" />
      <PluginLibraryView v-if="integratedSourceVisible" :key="musicSources.selectionKey.value + ':' + store.activeTab" ref="pluginSurface" :plugin-id="store.activeMusicSourceId" integrated :section="integratedSection" :entry-edge="pluginEntryEdge?.tab === store.activeTab ? pluginEntryEdge.edge : undefined" :local-only="store.manualLocalOnly || !store.networkConnected" @consume-entry-edge="pluginEntryEdge = undefined" @view-state="pluginViewState = $event" @back="handleBack" @manage="enterPlugins" @open-source="openPluginSource" @play="playFromPlugin" @next="store.queuePlugin($event, 'next')" @append="store.queuePlugin($event, 'append')" @radio-trash="store.pluginRadioTrash" />
      <PluginManagerView v-else-if="store.activeTab === 'plugins' && !store.activePluginId" ref="pluginSurface" :local-only="store.manualLocalOnly || !store.networkConnected" :account-target="playbackAccountTarget" @consume-account-target="playbackAccountTarget = undefined" @open="openManagedLibrary" @back="store.navigateBack" />
      <PluginLibraryView v-else-if="store.activeTab === 'plugins'" :key="store.activePluginId" ref="pluginSurface" :plugin-id="store.activePluginId" :local-only="store.manualLocalOnly || !store.networkConnected" @back="store.navigateBack" @manage="store.openPlugins()" @open-source="openPluginSource" @play="playFromPlugin" @next="store.queuePlugin($event, 'next')" @append="store.queuePlugin($event, 'append')" @radio-trash="store.pluginRadioTrash" />
      <NativeHomeView v-else-if="store.activeTab === 'home'" :hero-index="heroIndex" :shelf-positions="homeShelfPositions" @navigate="navigateTo" @refresh="refreshCurrentView" @hero="clickHero" @hero-select="selectHero" @hero-move="moveHero($event); startHeroRotation()" @menu="openTrackMenu($event)" />

      <section v-else-if="store.activeTab === 'search'" class="page search-page">
        <NativeSearchHeader :swipe-position="navigationSwipe.position.value" :swiping="navigationSwipe.holding.value" @submit="submitSearch" @category="navigateSurface" />
        <div ref="localSwipeFrame" class="swipe-deck">
        <Transition name="swipe-peek" @before-leave="navigationSwipe.hideCommittedPeek">
          <NavigationPeek v-if="navigationSwipe.neighbor.value" :style="navigationSwipe.peekStyle.value" :data-peek-tab="navigationSwipe.neighbor.value">
            <NativeSearchPreview :nested-category="navigationSwipe.neighbor.value" />
          </NavigationPeek>
        </Transition>
        <Transition :name="'surface-' + localTransition" @before-leave="navigationSwipe.prepareLeave" @before-enter="navigationSwipe.prepareEnter" @after-enter="finishNavigationSwipeEnter">
        <div :key="store.searchCategory" class="content-switch-stage swipe-surface" data-slide-active :style="localSwipeStyle" :data-swiping="navigationSwipe.holding.value ? '' : undefined">
          <NativeSearchResults :category="store.searchCategory"
            :items="store.searchCategory === 'tracks' ? visibleSearchTracks : visibleSearchResults" :loading="store.searchLoading"
            :searched="Boolean(store.searchKeywords)" :more="Boolean(store.searchNextPage || (store.searchCategory !== 'tracks' && moreSearchResults))"
            :state-key="JSON.stringify(['search-tracks', store.profile?.userId, store.submittedSearch])"
            :range="searchBatchBusy ? undefined : searchSelection.range.value" :selecting="searchSelecting" :selected-keys="searchSelectedKeys" :selection-revision="searchSelection.revision.value" @select="searchSelecting = true"
            @track="track => searchSelecting ? searchSelection.toggle(track) : store.play(track)" @menu="openTrackMenu"
            @entity="item => store.searchCategory === 'mvs' ? store.openMv(item.id) : openSearchEntity(item)" @more="loadMoreSearchResults">
            <template #selection>
              <TrackSelectionBar :count="searchSelectedCount" :total="visibleSearchTracks.length" :all="searchAll" :busy="searchBatchBusy" :actions="onlineBatchActions" @all="searchSelection.selectAll" @close="searchSelection.close" @action="action=>searchSelection.run(action,runNativeBatch)" />
            </template>
          </NativeSearchResults>
        </div>
        </Transition>
        </div>
      </section>

      <section v-else-if="store.activeTab === 'localCollection'" class="page library-page">
        <div class="section-heading"><div><h2>{{ store.selectedLocalCollection?.name }}</h2></div><button class="text-button" type="button" @click="handleBack">{{ $t('mobile.common.back') }}</button></div>
        <LocalTrackList :tracks="store.tracks" :collection-key="store.selectedLocalCollection?.id || 'local:folder'" :loading="store.loading" :local-only="store.localOnly" :current-track="store.playback.track" :batch-actions="localBatchActions" :run-batch="runNativeBatch" @play="(track, queue) => store.play(track, store.selectedLocalCollection?.id, queue)" @menu="track => openTrackMenu(track, store.selectedLocalCollection?.id)" @order-change="keys => store.reorderLocalPlayback(store.selectedLocalCollection?.id || 'local:folder', keys)" />
      </section>
      <section v-else-if="store.activeTab === 'entity'" class="page library-page">
        <div class="section-heading"><div><h2>{{ store.selectedEntity?.name }}</h2></div><button class="text-button" type="button" @click="handleBack">{{ $t('mobile.common.back') }}</button></div>
        <div class="playlist-hero"><CoverImage v-if="store.selectedEntity?.picUrl" :src="store.selectedEntity.picUrl" alt="" /><span v-else class="cover-fallback"><img class="original-cover-placeholder" :src="originalBrandLogo" alt="" /></span><div><div class="eyebrow">{{ store.selectedEntity?.category === 'artists' ? $t('nav.artist') : $t('nav.album') }}</div><h3>{{ store.selectedEntity?.name }}</h3><p>{{ $t('mobile.shellUi.songs', { count: store.tracks.length }) }}</p></div></div>
        <div class="track-list playlist-tracks"><WindowedTrackList :items="store.tracks" :item-key="trackKey" :state-key="'entity:'+(store.profile?.userId||0)+':'+store.selectedEntity?.category+':'+store.selectedEntity?.id"><template #default="{item:track,index}"><div class="track-row" :class="{'track-current':index===currentEntityIndex}" :aria-current="index===currentEntityIndex?'true':undefined" role="button" tabindex="0" v-track-menu="()=>openTrackMenu(track)" @click="store.play(track)" @keydown.enter.self.prevent="store.play(track)" @keydown.space.self.prevent="store.play(track)"><span class="track-index">{{ index+1 }}</span><span class="track-copy"><b>{{ track.name }}</b><small>{{ track.artists?.join(' / ') || track.album }}</small></span><TrackMenuButton :name="track.name" @open="openTrackMenu(track)" /></div></template></WindowedTrackList><div v-if="store.loading" class="empty-state">{{ $t('mobile.shellUi.loadingTracks') }}</div></div>
      </section>

      <section v-else-if="store.activeTab === 'library'" class="page library-page">
        <LibraryHeader :library-mode="libraryMode" :position="navigationSwipe.position.value" :swiping="navigationSwipe.holding.value" @navigate="navigateSurface" />
        <div ref="localSwipeFrame" class="swipe-deck library-swipe-deck">
          <Transition name="swipe-peek" @before-leave="navigationSwipe.hideCommittedPeek">
            <NavigationPeek v-if="libraryNeighbor" :style="navigationSwipe.peekStyle.value" :data-peek-tab="libraryNeighbor">
              <LibraryPane :library-mode="libraryNeighbor" :query="query" :filter="libraryQuery" :local-batch-actions="localBatchActions" :cache-batch-actions="cacheBatchActions" />
            </NavigationPeek>
          </Transition>
          <Transition :name="'surface-' + localTransition" @before-leave="prepareLibraryPaneLeave" @before-enter="navigationSwipe.prepareEnter" @enter="restoreLibraryPaneScroll" @after-enter="finishNavigationSwipeEnter">
            <div :key="libraryMode" class="content-switch-stage swipe-surface" data-slide-active :style="localSwipeStyle" :data-swiping="navigationSwipe.holding.value ? '' : undefined">
              <LibraryPane ref="libraryPane" v-model:query="query" :filter="libraryQuery" :library-mode="libraryMode" :local-batch-actions="localBatchActions" :cache-batch-actions="cacheBatchActions" :run-batch="runNativeBatch" @menu="openTrackMenu" />
            </div>
          </Transition>
        </div>
      </section>

      <section v-else-if="store.activeTab === 'playlist' && store.selectedPlaylist" class="page playlist-detail-page">
          <div class="playlist-hero">
            <CoverImage v-if="snapshotDetailKey ? store.selectedPlaylist.coverLocalUri : coverOf(store.selectedPlaylist)" :prepared="Boolean(snapshotDetailKey)" :src="snapshotDetailKey ? store.selectedPlaylist.coverLocalUri : coverOf(store.selectedPlaylist)" :remote-src="snapshotDetailKey ? undefined : store.selectedPlaylist.coverImgUrl" alt="" />
            <span v-else class="cover-fallback"><img class="original-cover-placeholder" :src="originalBrandLogo" alt="" /></span>
            <div><h2>{{ store.selectedPlaylist.name }}</h2><p>{{ snapshotDetailKey ? playlistSummary(store.selectedPlaylist.trackCount ?? store.tracks.length, store.selectedPlaylist.cacheProviderName) : $t('mobile.shellUi.songs', { count: store.selectedPlaylist.trackCount ?? store.tracks.length }) }}</p></div>
            <button v-if="store.selectedPlaylist.offlineSnapshot" class="icon-button" type="button" :aria-label="$t('mobile.offline.deletePlaylist')" @click="libraryManagement.deleteOfflinePlaylist(store.selectedPlaylist)"><OriginalIcon name="close" /></button>
            <PlaylistMenuButton v-else :playlist="store.selectedPlaylist" />
          </div>
          <p v-if="snapshotNoticeKey" class="library-mode-description playlist-snapshot-notice" role="status">{{ $t(snapshotNoticeKey) }} <button v-if="!store.manualLocalOnly && !store.networkConnected" class="text-button" type="button" :disabled="store.connectivityRetrying" :aria-busy="store.connectivityRetrying" @click="retryPlaylistOnline">{{ $t(store.connectivityRetrying ? 'mobile.network.checkingConnectivity' : 'mobile.network.retryConnectivity') }}</button><button v-else-if="store.onlineAvailable && store.selectedPlaylist.offlineReason === 'request'" class="text-button" type="button" :disabled="store.loading" @click="retryPlaylistOnline">{{ $t('mobile.offline.retryOnline') }}</button></p>
          <p v-if="snapshotNoticeKey && !store.manualLocalOnly && !store.networkConnected && store.connectivityError" class="inline-error" role="alert">{{ store.connectivityError }}</p>
          <LocalTrackList :tracks="store.tracks" :collection-key="snapshotDetailKey || 'netease:' + store.selectedPlaylist.id"
            :order-key="snapshotDetailKey || 'netease:' + (store.selectedPlaylist.cacheOwnerId || store.profile?.userId || 0) + ':playlist:' + store.selectedPlaylist.id"
            :continue-scope="snapshotDetailKey || 'netease:' + (store.selectedPlaylist.cacheOwnerId || store.profile?.userId || 0)"
            :cached-only="Boolean(snapshotDetailKey)" :original-order-label="t(store.selectedPlaylist.offlineSnapshot ? 'mobile.orderHistory.cachedOrder' : 'mobile.orderHistory.serverOrder')"
            :loading="store.loading" :incomplete="store.playlistLoadIncomplete" :load-error="store.playlistLoadError"
            @retry="store.selectedPlaylist && store.openPlaylist(store.selectedPlaylist)" :local-only="store.localOnly"
            :sync-order="!store.selectedPlaylist.offlineSnapshot && store.canManageOnlinePlaylist(store.selectedPlaylist) ? store.reorderOnlinePlaylist : undefined"
            :current-track="store.playback.track" :batch-actions="snapshotDetailKey ? queueBatchActions : playlistBatchActions" :run-batch="runNativeBatch"
            @play="(track, queue) => store.play(track, undefined, queue)" @menu="openTrackMenu" />
      </section>

      <section v-else-if="store.activeTab === 'player'" class="page player-page">
        <div class="player-overline"><PlayerPlaybackStatus :state="store.playback" /><div class="player-quick-controls"><button ref="abLoopTrigger" class="icon-button ab-loop-button" :class="{ selected: abLoopEnabled }" type="button" :aria-label="$t('mobile.abLoop.title')" aria-haspopup="dialog" :aria-expanded="abLoopOpen" :aria-pressed="abLoopEnabled" @click="abLoopOpen = true"><OriginalIcon name="abLoop" /></button><button ref="tuningTrigger" class="secondary-button playback-tuning-button" type="button" :aria-label="$t('mobile.advancedPlayback.quickTitle')" aria-haspopup="dialog" :aria-expanded="tuningOpen" @click="tuningOpen = true; loadPlaybackTuning()">{{ playbackTuning.speed.toFixed(2) }}×</button></div></div>
        <PlayerVisual ref="playerVisual" :cover="currentCover" :remote-cover="currentTrack.picUrl" :plugin-id="currentTrack.pluginId" :plugin-context="currentTrack.pluginSourceContext" :swipe-style="localSwipeStyle" :swiping="navigationSwipe.holding.value" :swipe-position="navigationSwipe.position.value" :direction="localTransition" :neighbor="navigationSwipe.neighbor.value" :peek-style="navigationSwipe.peekStyle.value" :prepare-enter="navigationSwipe.prepareEnter" :prepare-leave="navigationSwipe.prepareLeave" />
        <div class="player-title-row">
          <div class="player-title"><h2>{{ currentTrack.name }}</h2><p>{{ currentTrack.artists?.join(' / ') || store.playback.artist || buildInfo.displayName }}</p></div>
          <TrackMenuButton v-if="currentTrack.id > 0" :name="currentTrack.name" @open="openTrackMenu(currentTrack)" />
        </div>
        <div class="progress-control">
          <ThumbRange min="0" :max="Math.max(1, store.playback.duration)" :value="seeking ? seekValue : store.playback.position" :disabled="!store.playback.duration" :aria-label="$t('mobile.shellUi.playbackProgress')" @input="previewSeek" @change="seekFromInput" @cancel="seeking = false" />
          <div><span>{{ formatTime(seeking ? seekValue : store.playback.position) }}</span><span>{{ formatTime(store.playback.duration) }}</span></div>
        </div>
        <div class="transport-controls">
          <PlaybackModeControl />
          <button class="icon-button transport-small" type="button" :aria-label="$t('player.previous')" @click="playAdjacent(-1)"><OriginalIcon name="previous" /></button>
          <button class="main-play-button" type="button" :aria-label="canPausePlayback ? $t('player.pause') : $t('contextMenu.play')" @click="canPausePlayback ? store.pause() : store.resume()">
            <OriginalIcon :name="canPausePlayback ? 'pause' : 'play'" />
          </button>
          <button class="icon-button transport-small" type="button" :aria-label="$t('player.next')" @click="playAdjacent(1)"><OriginalIcon name="next" /></button>
          <button class="icon-button collapse-player" type="button" :aria-label="$t('mobile.collapsePlayer')" :title="$t('mobile.collapsePlayer')" @click="store.navigateBack()"><OriginalIcon name="down" /></button>
        </div>
        <div class="player-action-row">
          <button class="wide-outline-button playback-queue-button" type="button" @click="store.showPlaybackQueue()"><OriginalIcon name="list" /><span>{{ $t('mobile.shellUi.queueCount', { count: store.playback.queueCount ?? 0 }) }}{{ store.playback.upNextCount ? $t('mobile.shellUi.upNextCount', { count: store.playback.upNextCount }) : '' }}</span></button>
          <button v-if="store.onlineAvailable && onlineTrackId(currentTrack) > 0" class="wide-outline-button" type="button" @click="openComments(currentTrack, $event.currentTarget as HTMLElement)"><OriginalIcon name="lyrics" /><span>{{ $t('mobile.comments.title') }}</span></button>
        </div>
        <p v-if="store.playback.rate && store.playback.rate !== 1" class="setting-note">{{ store.playback.rate }}×</p>
        <CollapsibleSettingsCard class="volume-settings" section-id="playback-volume" :title="$t('mobile.shellUi.volumeTitle')">
          <template #heading><div><h3>{{ $t('mobile.shellUi.volumeTitle') }}</h3><p>{{ $t('mobile.shellUi.actualVolume', { percent: Math.round((store.playback.trackVolumePercent ?? 100) * (store.playback.playlistVolumePercent ?? 100) / 100) }) }}</p></div></template>
          <div class="volume-control">
            <label for="track-volume">{{ $t('mobile.shellUi.currentTrack') }}</label>
            <ThumbRange id="track-volume" min="0" max="100" :value="store.playback.trackVolumePercent ?? 100" :disabled="!store.playback.trackId" @input="store.setCurrentTrackVolume(Number(($event.target as HTMLInputElement).value))" @change="store.flushLiveSettings()" />
            <label class="percent-input"><input type="number" min="0" max="100" inputmode="numeric" :aria-label="$t('mobile.shellUi.trackVolumePercent')" :value="store.playback.trackVolumePercent ?? 100" :disabled="!store.playback.trackId" @change="store.setCurrentTrackVolume(Number(($event.target as HTMLInputElement).value))" /><span>%</span></label>
          </div>
          <div class="volume-control">
            <label for="playlist-volume">{{ store.playback.track?.playlistVolumeName || t('mobile.shellUi.currentPlaylist') }}</label>
            <ThumbRange id="playlist-volume" min="0" max="100" :value="store.playback.playlistVolumePercent ?? 100" :disabled="!store.playback.track?.playlistVolumeKey" @input="store.setCurrentPlaylistVolume(Number(($event.target as HTMLInputElement).value))" @change="store.flushLiveSettings()" />
            <label class="percent-input"><input type="number" min="0" max="100" inputmode="numeric" :aria-label="$t('mobile.shellUi.playlistVolumePercent')" :value="store.playback.playlistVolumePercent ?? 100" :disabled="!store.playback.track?.playlistVolumeKey" @change="store.setCurrentPlaylistVolume(Number(($event.target as HTMLInputElement).value))" /><span>%</span></label>
          </div>
          <p class="setting-note">{{ $t('mobile.shellUi.volumeHint') }}</p>
        </CollapsibleSettingsCard>

      </section>

      <AppAboutView v-else-if="store.activeTab === 'about'" />
      <AppSettingsView v-else @request-login="requestOnlineLogin" @local-mode="enterLocalMode" @open-offline="openLibrarySection('offline')" @open-plugins="enterPlugins" />

      </div>
      </Transition>
      </div>
      <PlaybackErrorNotice ref="playbackErrorNotice" :visible="showPlaybackError" @login="requestOnlineLogin" @offline="openLibrarySection('offline')" @source-settings="openPlaybackSourceSettings" />
      <Transition name="notice-fade"><AppErrorNotice v-if="store.error && !store.loginVisible && !playbackErrorNotice?.showing" :message="store.error" :offline="store.hasAccess" :retry="reloadErrorPage" @close="store.error = ''" @login="requestOnlineLogin" @folders="store.pickMusicFolder" @storage="navigateTo('settings')" @offline="openLibrarySection('offline')" /></Transition>
      <Transition name="notice-fade"><div v-if="store.queueNotice" class="queue-notice" role="status">{{ store.queueNotice }}</div></Transition>
      <Transition name="mini-player">
      <div v-if="store.playback.trackId && !['player', 'settings', 'about'].includes(store.activeTab)" class="mini-player" role="button" tabindex="0" :aria-label="$t('mobile.shellUi.openPlayer')" @click="navigateTo('player')" @keydown.enter.prevent="navigateTo('player')" @keydown.space.prevent="navigateTo('player')">
        <PluginArtwork v-if="currentTrack.pluginId" :plugin-id="currentTrack.pluginId" :uri="currentCover" eager /><CoverImage v-else-if="currentCover" :src="currentCover" :remote-src="currentTrack.picUrl" loading="eager" alt="" /><span v-else class="mini-cover-fallback"><img class="original-cover-placeholder" :src="originalBrandLogo" alt="" /></span>
        <span class="mini-copy"><b>{{ currentTrack.name }}</b><small>{{ currentTrack.artists?.join(' / ') || store.playback.artist }}</small></span>
        <button class="mini-action" type="button" :aria-label="canPausePlayback ? $t('player.pause') : $t('contextMenu.play')" @click.stop="canPausePlayback ? store.pause() : store.resume()" @keydown.enter.stop @keydown.space.stop><OriginalIcon :name="canPausePlayback ? 'pause' : 'play'" /></button>
      </div>
      </Transition>
      <nav ref="bottomNavigation" class="bottom-nav" :data-five-tabs="mainOnlineNavigation ? '' : undefined" :data-scrubbing="navigationScrub.dragging.value || primarySwipe.holding.value ? '' : undefined" :style="{ gridTemplateColumns: `repeat(${mainTabs.length}, minmax(0, 1fr))` }" :aria-label="$t('mobile.shellUi.mainNavigation')" @pointerdown="navigationScrub.start" @click.capture="navigationScrub.click">
        <span class="bottom-nav-indicator" :style="navigationScrub.indicatorStyle.value ?? navIndicatorStyle" :class="{ hidden: navIndex < 0 }" aria-hidden="true"></span>
        <SideNavItem v-if="mainOnlineNavigation" variant="mobile" type="button" :active="mainNavigationTab === 'home'" @click="navigateTo('home')"><span><OriginalIcon name="logo" /></span><small>{{ $t('nav.home') }}</small></SideNavItem>
        <SideNavItem variant="mobile" type="button" :active="mainNavigationTab === 'library'" @click="navigateTo('library')"><span><OriginalIcon name="library" /></span><small>{{ $t('nav.library') }}</small></SideNavItem>
        <SideNavItem v-if="mainOnlineNavigation" variant="mobile" type="button" :active="mainNavigationTab === 'search'" @click="navigateTo('search')"><span><OriginalIcon name="search" /></span><small>{{ $t('nav.search') }}</small></SideNavItem>
        <SideNavItem variant="mobile" type="button" :active="mainNavigationTab === 'player'" @click="navigateTo('player')"><span><OriginalIcon name="play" /></span><small class="bottom-nav-full-label">{{ $t('mobile.common.playing') }}</small><small class="bottom-nav-compact-label">{{ $t('mobile.shellUi.navCompactPlayer') }}</small></SideNavItem>
        <SideNavItem variant="mobile" type="button" :active="store.activeTab === 'settings' || store.activeTab === 'about'" @click="navigateTo('settings')"><span><OriginalIcon name="settings" /></span><small class="bottom-nav-full-label">{{ $t('nav.settings') }}</small><small class="bottom-nav-compact-label">{{ $t('mobile.shellUi.navCompactSettings') }}</small></SideNavItem>
      </nav>
    </template>
    <AppUpdateNotice />
    <Teleport to="body"><Transition name="tuning-sheet" :duration="reducedMotion ? 0 : { enter: 320, leave: 240 }"><PlaybackTuningSheet v-if="tuningOpen" :return-focus="tuningTrigger" @close="tuningOpen = false" /></Transition></Teleport>
    <Teleport to="body"><Transition name="tuning-sheet" :duration="reducedMotion ? 0 : { enter: 320, leave: 240 }"><AbLoopSheet v-if="abLoopOpen" :return-focus="abLoopTrigger" @close="abLoopOpen = false" @changed="abLoopEnabled = $event" /></Transition></Teleport>
    <ActionDialog />
    <OnlinePlaylistDialog />
    <UndoToast />
    <LibraryTaskProgress />
  </main>
</template>
