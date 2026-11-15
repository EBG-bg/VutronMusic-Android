import { computed, getCurrentScope, onScopeDispose, ref, watch, type Ref } from 'vue'
import {
  vutronPlugin,
  type VutronCacheStatus,
  type VutronLocalTrack,
  type VutronPlaybackState,
  type VutronTrack,
  type VutronSleepTimerState,
  type VutronSleepTimerOptions,
  type VutronSleepTimerMode,
} from '../../platform/vutronPlugin'
import { timerDeadline, timerLabel, timerRemaining } from '../../utils/sleepTimer'
import type { ShellTab } from './shellTypes'

export interface ShellCacheOptions {
  playback: Ref<VutronPlaybackState>
  activeTab: Ref<ShellTab>
  onlineAvailable: Ref<boolean>
  error: Ref<string>
  t(key: string): string
  formatError(cause: unknown, fallback: string): string
  /** Resolve the full track object for the current track, for manual caching. */
  resolveCacheTrack(): VutronTrack | undefined
  /** Reload offline playlists after clearing cache. */
  loadOfflinePlaylists(): unknown
}

/** Owns cache status/settings, cached tracks, and the sleep timer. */
export function createShellCache(options: ShellCacheOptions) {
  const { playback, activeTab, onlineAvailable, error, t, formatError, resolveCacheTrack, loadOfflinePlaylists } = options

  // --- Cache status & settings ---------------------------------------------

  const cacheStatus = ref<VutronCacheStatus>({ capacityMb: 2048, usedBytes: 0, trackCount: 0, enabled: true })
  const cacheCapacityMb = ref(2048)
  const artworkCacheCapacityMb = ref(128)
  const cachedTracks = ref<VutronLocalTrack[]>([])
  let cacheStatusPending = false
  let cacheSettingsRevision = 0
  let cachePollAt = 0
  const cacheWrites = new Map<string, { value: boolean | number; task: Promise<void> }>()
  function saveCacheSetting(field: 'enabled' | 'capacityMb' | 'artworkCapacityMb', value: boolean | number, write: () => Promise<VutronCacheStatus>, failure: string): Promise<void> {
    const previous = cacheWrites.get(field)
    if (previous?.value === value) return previous.task
    if (!previous && cacheStatus.value[field] === value) return Promise.resolve()
    const revision = ++cacheSettingsRevision
    const task = Promise.resolve(previous?.task).then(write).then(status => {
      if (revision === cacheSettingsRevision) cacheStatus.value = status
    }).catch(cause => { error.value = formatError(cause, t(failure)) }).finally(() => {
      if (cacheWrites.get(field)?.task === task) cacheWrites.delete(field)
    })
    cacheWrites.set(field, { value, task })
    return task
  }

  async function loadCacheStatus(updateInputs = true, includeTracks = true) {
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
      if (includeTracks && vutronPlugin.getCachedTracks) {
        const cached = await vutronPlugin.getCachedTracks()
        if (revision === cacheSettingsRevision) cachedTracks.value = cached.tracks ?? []
      }
    } catch (cause) {
      error.value = formatError(cause, t('mobile.runtimeText.cacheStatusReadFailed'))
    } finally {
      cacheStatusPending = false
    }
  }

  async function setAutomaticCache(enabled: boolean) {
    if (!vutronPlugin.setCacheEnabled) return
    await saveCacheSetting('enabled', enabled, () => vutronPlugin.setCacheEnabled!({ enabled }), 'mobile.runtimeText.autoCacheSaveFailed')
  }

  async function setCacheCapacity() {
    if (!vutronPlugin.setCacheCapacity) return
    const capacityMb = cacheCapacityMb.value
    await saveCacheSetting('capacityMb', capacityMb, () => vutronPlugin.setCacheCapacity!({ capacityMb }), 'mobile.runtimeText.cacheCapacitySaveFailed')
  }

  async function setArtworkCacheCapacity() {
    if (!vutronPlugin.setArtworkCacheCapacity) return
    const capacityMb = artworkCacheCapacityMb.value
    await saveCacheSetting('artworkCapacityMb', capacityMb, () => vutronPlugin.setArtworkCacheCapacity!({ capacityMb }), 'mobile.runtimeText.artworkCapacitySaveFailed')
  }

  async function cacheCurrent() {
    if (!onlineAvailable.value || !vutronPlugin.cacheTrack || !playback.value.trackId) return
    const track = resolveCacheTrack()
    if (!track) return
    try { await vutronPlugin.cacheTrack({ track }); await loadCacheStatus() }
    catch (cause) { error.value = formatError(cause, t('mobile.runtimeText.trackCacheFailed')) }
  }

  async function clearCache() {
    if (!vutronPlugin.clearCache) return
    try { await vutronPlugin.clearCache(); await Promise.all([loadCacheStatus(), loadOfflinePlaylists()]) }
    catch (cause) { error.value = formatError(cause, t('mobile.runtimeText.cacheClearFailed')) }
  }

  /** Cache-status poll hook for the playback poller (settings/library tabs, 5s throttle). */
  function pollCacheStatus() {
    if (!['settings', 'library'].includes(activeTab.value)) return
    const now = Date.now()
    if (now - cachePollAt >= 5000) { cachePollAt = now; void loadCacheStatus(false, activeTab.value === 'library') }
  }

  // --- Sleep timer ----------------------------------------------------------

  const sleepTimerDeadline = ref(0)
  const sleepTimerNow = ref(Date.now())
  const sleepTimerBusy = ref(false)
  const sleepTimerMinutes = ref(30)
  const sleepTimerMode = ref<VutronSleepTimerMode>('duration')
  const sleepTimerRemainingTracks = ref(0)
  const sleepTimerFadeSeconds = ref(0)
  const sleepTimerRequestedActive = ref(false)
  let sleepTimerRevision = 0
  let sleepClock: ReturnType<typeof setInterval> | undefined

  const sleepTimerRemainingMs = computed(() => timerRemaining(sleepTimerDeadline.value, sleepTimerNow.value))
  const sleepTimerLabel = computed(() => timerLabel(sleepTimerRemainingMs.value))
  const sleepTimerActive = computed(() => sleepTimerRequestedActive.value && (sleepTimerMode.value !== 'duration' || sleepTimerRemainingMs.value > 0))

  function stopSleepClock() {
    if (sleepClock !== undefined) clearInterval(sleepClock)
    sleepClock = undefined
  }

  function startSleepClock() {
    if (activeTab.value !== 'settings' || sleepClock !== undefined || sleepTimerDeadline.value <= Date.now() || document.visibilityState === 'hidden') return
    sleepClock = setInterval(() => {
      sleepTimerNow.value = Date.now()
      if (!sleepTimerRemainingMs.value) stopSleepClock()
    }, 250)
  }

  function syncSleepTimer(sample: VutronSleepTimerState) {
    sleepTimerNow.value = Date.now()
    sleepTimerMode.value = sample.mode ?? 'duration'
    sleepTimerRemainingTracks.value = sample.remainingTracks ?? 0
    sleepTimerFadeSeconds.value = sample.fadeSeconds ?? 0
    sleepTimerRequestedActive.value = sample.active ?? sample.remainingMs > 0
    sleepTimerDeadline.value = timerDeadline(sample, sleepTimerNow.value)
    if (sleepTimerDeadline.value > sleepTimerNow.value) startSleepClock()
    else stopSleepClock()
  }
  // The native deadline owns pausing playback; this smooth clock only paints
  // the settings countdown/wheels and has no consumers on other pages.
  watch(activeTab, () => {
    stopSleepClock()
    sleepTimerNow.value = Date.now()
    startSleepClock()
  }, { flush: 'sync' })
  if (getCurrentScope()) onScopeDispose(stopSleepClock)

  async function setSleepTimer(minutes: number) {
    await setSleepTimerSeconds(minutes * 60)
  }

  async function setSleepTimerSeconds(seconds: number) {
    if (!Number.isFinite(seconds) || seconds < 1 || seconds > 18000) return false
    return setSleepTimerSettings({ mode: 'duration', durationMs: Math.round(seconds * 1000) })
  }

  async function setSleepTimerSettings(options: VutronSleepTimerOptions) {
    if (sleepTimerBusy.value || !vutronPlugin.setSleepTimer) return false
    sleepTimerBusy.value = true; ++sleepTimerRevision; error.value = ''
    try { syncSleepTimer(await vutronPlugin.setSleepTimer(options)); return true }
    catch (cause) { error.value = formatError(cause, t('mobile.runtimeText.timerSaveFailed')); return false }
    finally { sleepTimerBusy.value = false }
  }

  async function clearSleepTimer() {
    if (sleepTimerBusy.value || !vutronPlugin.clearSleepTimer) return
    sleepTimerBusy.value = true; ++sleepTimerRevision
    try { syncSleepTimer(await vutronPlugin.clearSleepTimer()) }
    catch (cause) { error.value = formatError(cause, t('mobile.runtimeText.timerCancelFailed')) }
    finally { sleepTimerBusy.value = false }
  }

  // --- Escape hatches for androidShell (keep private state encapsulated) ----

  /** Snapshot the current sleepTimerRevision for draft-protection in refreshPlaybackState. */
  function captureTimerRevision(): number { return sleepTimerRevision }

  /** Apply a timer sync only if the revision hasn't changed and no mutation is in flight. */
  function trySyncTimer(sample: VutronSleepTimerState, capturedRevision: number): void {
    if (capturedRevision === sleepTimerRevision && !sleepTimerBusy.value) syncSleepTimer(sample)
  }

  /** Prevent an older native cache read from applying after logout. */
  function bumpCacheReadRevision(): void { ++cacheSettingsRevision }

  return {
    cacheStatus, cacheCapacityMb, artworkCacheCapacityMb, cachedTracks,
    loadCacheStatus, setAutomaticCache, setCacheCapacity, setArtworkCacheCapacity,
    cacheCurrent, clearCache, pollCacheStatus,
    sleepTimerDeadline, sleepTimerNow, sleepTimerBusy, sleepTimerMinutes, sleepTimerMode, sleepTimerRemainingTracks, sleepTimerFadeSeconds, sleepTimerActive,
    sleepTimerRemainingMs, sleepTimerLabel,
    stopSleepClock, startSleepClock, syncSleepTimer,
    setSleepTimer, setSleepTimerSeconds, setSleepTimerSettings, clearSleepTimer,
    captureTimerRevision, trySyncTimer, bumpCacheReadRevision,
  }
}
