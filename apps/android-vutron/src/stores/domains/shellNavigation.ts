import { computed, ref, shallowRef, type Ref } from 'vue'
import type { VutronLocalCollection, VutronPlaylist, VutronTrack } from '../../platform/vutronPlugin'
import type { NavigationEntry, ShellEntity, ShellTab } from './shellTypes'

export interface ShellNavigationOptions {
  /** Shared loading gate — reset to false on every navigation. */
  loading: Ref<boolean>
  /** Search-specific loading gate — also reset on source/library resets. */
  searchLoading: Ref<boolean>
  localOnly: Ref<boolean>
  loginRequested: Ref<boolean>
  onlineAvailable: Ref<boolean>
  selectedPlaylist: Ref<VutronPlaylist | undefined>
  selectedEntity: Ref<ShellEntity | undefined>
  selectedLocalCollection: Ref<VutronLocalCollection | undefined>
  tracks: Ref<VutronTrack[]>
  /** Must increment the module-level trackListRequestId counter. */
  incrementTrackListRequest(): void
  /** Must increment the module-level searchRequestId counter. */
  incrementSearchRequest(): void
}

/** Owns tab state, the back-stack, and all navigation mutations. */
export function createShellNavigation(options: ShellNavigationOptions) {
  const {
    loading, searchLoading, localOnly, loginRequested, onlineAvailable,
    selectedPlaylist, selectedEntity, selectedLocalCollection, tracks,
    incrementTrackListRequest, incrementSearchRequest,
  } = options

  const activeTab = ref<ShellTab>('home')
  const activePluginId = ref('')
  const activeMusicSourceId = ref('')
  const navigationHistory = shallowRef<NavigationEntry[]>([])
  const navigationDirection = ref<'forward' | 'back'>('forward')
  const navigationScrollY = ref(0)
  const tabScrolls = new Map<string, number>()

  const rootTab = computed<ShellTab>(() =>
    localOnly.value && !activeMusicSourceId.value ? 'library' : 'home'
  )
  const playlistOrigin = computed(() => {
    for (let i = navigationHistory.value.length - 1; i >= 0; i--) {
      const tab = navigationHistory.value[i]?.tab
      if (tab === 'home' || tab === 'library' || tab === 'search') return tab
    }
    return 'library'
  })
  const canNavigateBack = computed(() =>
    (loginRequested.value && localOnly.value) ||
    navigationHistory.value.length > 0 ||
    activeTab.value !== rootTab.value
  )

  function rememberPage() {
    navigationHistory.value = [
      ...navigationHistory.value,
      {
        tab: activeTab.value,
        pluginId: activePluginId.value,
        musicSourceId: activeMusicSourceId.value,
        playlist: selectedPlaylist.value,
        entity: selectedEntity.value,
        tracks: tracks.value,
        localCollection: selectedLocalCollection.value,
        scrollY: window.scrollY,
      },
    ].slice(-40)
    navigationDirection.value = 'forward'
    navigationScrollY.value = 0
  }

  function tabScrollFor(tab: ShellTab) { return tabScrolls.get(activeMusicSourceId.value + ':' + tab) ?? 0 }

  function navigateTo(tab: ShellTab) {
    if (
      !activeMusicSourceId.value &&
      !onlineAvailable.value &&
      ['home', 'search', 'entity'].includes(tab)
    ) return
    if (tab === activeTab.value) return
    if (activeTab.value === 'playlist' && tab === playlistOrigin.value) {
      while (navigationHistory.value.at(-1)?.tab === 'playlist') navigationHistory.value = navigationHistory.value.slice(0, -1)
      if (navigationHistory.value.at(-1)?.tab === tab) { navigateBack(); return }
    }
    if (activeTab.value !== 'playlist' && activeTab.value !== 'entity' && activeTab.value !== 'localCollection') tabScrolls.set(activeMusicSourceId.value + ':' + activeTab.value, window.scrollY)
    rememberPage()
    navigationScrollY.value = tabScrollFor(tab)
    incrementTrackListRequest()
    loading.value = false
    activeTab.value = tab
    if (tab === 'home' || tab === 'library' || tab === 'search') {
      selectedPlaylist.value = undefined
      selectedEntity.value = undefined
      selectedLocalCollection.value = undefined
      tracks.value = []
    }
    if (tab === rootTab.value) navigationHistory.value = []
  }

  function navigateBack(): boolean {
    const previous = navigationHistory.value.at(-1)
    if (!previous && activeTab.value === rootTab.value) return false
    incrementTrackListRequest()
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

  function selectMusicSource(pluginId: string, tab: 'home' | 'library' | 'search' = 'library') {
    if (activeMusicSourceId.value === pluginId && activeTab.value === tab) return
    rememberPage()
    incrementTrackListRequest()
    incrementSearchRequest()
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
      incrementTrackListRequest()
      incrementSearchRequest()
      selectedPlaylist.value = undefined; selectedEntity.value = undefined; selectedLocalCollection.value = undefined
      tracks.value = []; loading.value = false; activeTab.value = 'library'
    }
  }

  function retainMusicSources(pluginIds: string[]) {
    const available = new Set(pluginIds)
    navigationHistory.value = navigationHistory.value.filter(page => !page.musicSourceId || available.has(page.musicSourceId))
  }

  /**
   * Reset navigation to the local library root.
   * Called by auth domain on automatic offline / logout.
   */
  function resetToLocalLibrary() {
    tabScrolls.clear()
    incrementTrackListRequest()
    incrementSearchRequest()
    loading.value = false
    searchLoading.value = false
    activeTab.value = 'library'
    activeMusicSourceId.value = ''
    selectedPlaylist.value = undefined
    selectedEntity.value = undefined
    selectedLocalCollection.value = undefined
    tracks.value = []
    navigationHistory.value = []
  }

  return {
    activeTab,
    activePluginId,
    activeMusicSourceId,
    playlistOrigin,
    navigationHistory,
    navigationDirection,
    navigationScrollY,
    tabScrollFor,
    rootTab,
    canNavigateBack,
    rememberPage,
    navigateTo,
    navigateBack,
    openPlugins,
    selectMusicSource,
    discardMusicSource,
    retainMusicSources,
    resetToLocalLibrary,
  }
}
