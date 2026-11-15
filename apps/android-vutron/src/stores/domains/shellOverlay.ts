import { computed, ref, type Ref } from 'vue'
import {
  vutronPlugin,
  type VutronLyricOverlaySettings,
  type VutronPlaybackState,
} from '../../platform/vutronPlugin'
import { createLiveSettingWriter } from '../../platform/liveSettingWrites'
import { flushRegisteredLiveSettings } from '../../platform/liveSettingsLifecycle'

export interface ShellOverlayOptions {
  playback: Ref<VutronPlaybackState>
  error: Ref<string>
  t(key: string): string
  formatError(cause: unknown, fallback: string): string
  /** Returns the composite key for a playback track. Defaults to the current track. */
  playbackTrackKey(state?: VutronPlaybackState): string
}

interface VolumeReadSnapshot {
  revision: number
  pendingTracks: Set<string>
  pendingPlaylists: Set<string>
}

/** Owns lyric overlay settings, per-track lyric offset, and volume writers. */
export function createShellOverlay(options: ShellOverlayOptions) {
  const { playback, error, t, formatError, playbackTrackKey } = options

  // Color value → hex string for color inputs
  function colorInputValue(value: number): string {
    return `#${((value >>> 0) & 0xffffff).toString(16).padStart(6, '0')}`
  }

  // --- Overlay settings state -----------------------------------------------

  const overlaySettings = ref<VutronLyricOverlaySettings>({
    enabled: false, locked: false, translation: true, nextLine: true, wifiValidation: true, estimatedWordTiming: false,
    fontSize: 22, playedColor: 0xff37cf88, unplayedColor: 0xffd2d2d2,
    backgroundColor: 0xff181920, shadowColor: 0x99000000, shadowEnabled: true,
    shadowRadius: 2, touchPassthroughPriority: true, permissionGranted: false,
  })

  const overlayEnabled = computed(() => overlaySettings.value.enabled)
  const overlayPlayedColor = computed(() => colorInputValue(overlaySettings.value.playedColor))
  const overlayUnplayedColor = computed(() => colorInputValue(overlaySettings.value.unplayedColor))
  const overlayShadowColor = computed(() => colorInputValue(overlaySettings.value.shadowColor))
  const overlayBackgroundOpacity = computed(() =>
    Math.round(((overlaySettings.value.backgroundColor >>> 24) & 0xff) * 100 / 255)
  )

  // --- Draft-protection counters (plain `let`, not reactive) ----------------

  type OverlayValue = boolean | number
  let overlayRevision = 0
  let overlayReadRequest = 0
  let overlayTrackKey = ''
  let offsetRevision = 0
  let volumeRevision = 0

  const overlayDrafts = new Map<keyof VutronLyricOverlaySettings, { value: OverlayValue; revision: number }>()
  const offsetDrafts = new Map<string, { value: number; revision: number }>()
  const trackVolumeDrafts = new Map<string, { value: number; revision: number }>()
  const playlistVolumeDrafts = new Map<string, { value: number; revision: number }>()

  type NumberWriter = ReturnType<typeof createLiveSettingWriter<number>>
  const offsetWriters = new Map<string, NumberWriter>()
  const trackVolumeWriters = new Map<string, NumberWriter>()
  const playlistVolumeWriters = new Map<string, NumberWriter>()

  // --- Overlay writer (merge-batching + draft cleanup) ----------------------

  const overlayWriter = createLiveSettingWriter<Partial<VutronLyricOverlaySettings>>({
    merge: (previous, next) => ({ ...previous, ...next }),
    write: async patch => {
      const savedRevisions = new Map([...overlayDrafts].map(([key, draft]) => [key, draft.revision]))
      const next = vutronPlugin.updateLyricOverlaySettings
        ? await vutronPlugin.updateLyricOverlaySettings({ settings: patch })
        : patch.enabled !== undefined && vutronPlugin.setLyricOverlayEnabled
          ? await vutronPlugin.setLyricOverlayEnabled({ enabled: patch.enabled })
          : undefined
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
    onError: cause => { error.value = formatError(cause, t('mobile.runtimeText.overlaySaveFailed')) },
  })

  // --- Overlay read ---------------------------------------------------------

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
      error.value = formatError(cause, t('mobile.runtimeText.overlayReadFailed'))
    }
  }

  // --- Overlay mutations ----------------------------------------------------

  async function toggleLyricOverlay() {
    await updateOverlayField('enabled', !overlaySettings.value.enabled)
  }

  async function updateOverlayField(key: keyof VutronLyricOverlaySettings, value: boolean | number) {
    if (key === 'currentLyricOffsetMs') { await updateCurrentLyricOffset(Number(value)); return }
    const current = overlaySettings.value[key]
    const unchanged = current === value || ['playedColor','unplayedColor','backgroundColor','shadowColor'].includes(key) && typeof current === 'number' && typeof value === 'number' && (current >>> 0) === (value >>> 0)
    if (unchanged) { if (overlayDrafts.has(key)) await overlayWriter.flush(); return }
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
    } catch (cause) {
      error.value = formatError(cause, t('mobile.runtimeText.overlayHideFailed'))
    }
  }

  async function restoreOverlay() {
    if (!vutronPlugin.restoreLyricOverlay) return
    try {
      const next = await vutronPlugin.restoreLyricOverlay()
      overlaySettings.value.temporaryHidden = next.temporaryHidden
      overlaySettings.value.temporaryHiddenRemainingMs = next.temporaryHiddenRemainingMs
    } catch (cause) {
      error.value = formatError(cause, t('mobile.runtimeText.overlayRestoreFailed'))
    }
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

  // --- Per-track lyric offset -----------------------------------------------

  async function updateCurrentLyricOffset(offsetMs: number) {
    if (!vutronPlugin.setLyricOffset || !playback.value.trackId) return
    if (!Number.isFinite(offsetMs) || offsetMs < -30_000 || offsetMs > 30_000) {
      error.value = t('mobile.runtimeText.offsetRange'); return
    }
    const trackId = playback.value.trackId
    const trackKey = playbackTrackKey()
    if (overlayTrackKey === trackKey && (overlaySettings.value.currentLyricOffsetMs ?? 0) === offsetMs) { await offsetWriters.get(trackKey)?.flush(); return }
    const track = playback.value.track ? { ...playback.value.track } : { id: trackId, name: playback.value.title }
    offsetDrafts.set(trackKey, { value: offsetMs, revision: ++offsetRevision })
    overlaySettings.value.currentLyricOffsetMs = offsetMs
    overlayTrackKey = trackKey
    let writer = offsetWriters.get(trackKey)
    if (!writer) {
      writer = createLiveSettingWriter<number>({
        write: async value => { await vutronPlugin.setLyricOffset!({ trackId, track, offsetMs: value }) },
        onError: cause => { error.value = formatError(cause, t('mobile.runtimeText.offsetSaveFailed')) },
      })
      offsetWriters.set(trackKey, writer)
    }
    await writer.queue(offsetMs)
  }

  // --- Per-track / per-playlist volume --------------------------------------

  async function setCurrentTrackVolume(percent: number) {
    if (!Number.isInteger(percent) || percent < 0 || percent > 100 || !playback.value.trackId) return
    const key = playbackTrackKey()
    if ((playback.value.trackVolumePercent ?? 100) === percent) { await trackVolumeWriters.get(key)?.flush(); return }
    const track = playback.value.track ? { ...playback.value.track } : { id: playback.value.trackId, name: playback.value.title }
    trackVolumeDrafts.set(key, { value: percent, revision: ++volumeRevision })
    playback.value.trackVolumePercent = percent
    let writer = trackVolumeWriters.get(key)
    if (!writer) {
      writer = createLiveSettingWriter<number>({
        write: async value => { await vutronPlugin.setTrackVolume({ track, percent: value }) },
        onError: cause => { error.value = formatError(cause, t('mobile.runtimeText.trackVolumeSaveFailed')) },
      })
      trackVolumeWriters.set(key, writer)
    }
    await writer.queue(percent)
  }

  async function setCurrentPlaylistVolume(percent: number) {
    const playlistKey = playback.value.track?.playlistVolumeKey
    if (!playlistKey || !Number.isInteger(percent) || percent < 0 || percent > 100) return
    if ((playback.value.playlistVolumePercent ?? 100) === percent) { await playlistVolumeWriters.get(playlistKey)?.flush(); return }
    playlistVolumeDrafts.set(playlistKey, { value: percent, revision: ++volumeRevision })
    playback.value.playlistVolumePercent = percent
    let writer = playlistVolumeWriters.get(playlistKey)
    if (!writer) {
      writer = createLiveSettingWriter<number>({
        write: async value => { await vutronPlugin.setPlaylistVolume({ playlistKey, percent: value }) },
        onError: cause => { error.value = formatError(cause, t('mobile.runtimeText.playlistVolumeSaveFailed')) },
      })
      playlistVolumeWriters.set(playlistKey, writer)
    }
    await writer.queue(percent)
  }

  // --- Flush all live writers -----------------------------------------------

  async function flushLiveSettings() {
    await Promise.all([
      flushRegisteredLiveSettings(),
      overlayWriter.flush(),
      ...[...offsetWriters.values(), ...trackVolumeWriters.values(), ...playlistVolumeWriters.values()].map(writer => writer.flush()),
    ])
  }

  // --- Escape hatches for androidShell (keep private state encapsulated) ----

  /** Keep the in-flight writer state from before the asynchronous native read. */
  function captureVolumeRead(): VolumeReadSnapshot {
    return {
      revision: volumeRevision,
      pendingTracks: new Set([...trackVolumeWriters].filter(([, writer]) => writer.pending()).map(([key]) => key)),
      pendingPlaylists: new Set([...playlistVolumeWriters].filter(([, writer]) => writer.pending()).map(([key]) => key)),
    }
  }

  /**
   * Apply volume draft-protection to a freshly-read playback state.
   * Mutates `next` in-place if a pending draft should take precedence.
   */
  function applyVolumeDraftsToState(next: VutronPlaybackState, read: VolumeReadSnapshot): void {
    const nextKey = playbackTrackKey(next)

    const trackDraft = trackVolumeDrafts.get(nextKey)
    if (trackDraft) {
      const writer = trackVolumeWriters.get(nextKey)
      if (
        trackDraft.revision > read.revision ||
        read.pendingTracks.has(nextKey) ||
        (writer?.pending() ?? false) ||
        next.trackVolumePercent !== trackDraft.value
      ) {
        next.trackVolumePercent = trackDraft.value
      } else {
        trackVolumeDrafts.delete(nextKey)
      }
    }

    const playlistKey = next.track?.playlistVolumeKey ?? ''
    const playlistDraft = playlistVolumeDrafts.get(playlistKey)
    if (playlistDraft) {
      const writer = playlistVolumeWriters.get(playlistKey)
      if (
        playlistDraft.revision > read.revision ||
        read.pendingPlaylists.has(playlistKey) ||
        (writer?.pending() ?? false) ||
        next.playlistVolumePercent !== playlistDraft.value
      ) {
        next.playlistVolumePercent = playlistDraft.value
      } else {
        playlistVolumeDrafts.delete(playlistKey)
      }
    }
  }

  /** Apply the saved lyric offset draft (or 0) for a given track key. */
  function setOffsetForTrack(trackKey: string): void {
    overlaySettings.value.currentLyricOffsetMs = offsetDrafts.get(trackKey)?.value ?? 0
  }

  /** True if the overlay settings need a reload for the given track key. */
  function needsOverlayReload(trackKey: string): boolean {
    return trackKey !== overlayTrackKey
  }

  /** Mark overlay track key as stale (called when a new track begins playing). */
  function invalidateOverlayTrack(): void { overlayTrackKey = '' }

  return {
    overlaySettings, overlayEnabled,
    overlayPlayedColor, overlayUnplayedColor, overlayShadowColor, overlayBackgroundOpacity,
    loadOverlaySettings, toggleLyricOverlay, updateOverlayField,
    temporarilyHideOverlay, restoreOverlay,
    updateOverlayColor, updateOverlayBackgroundOpacity,
    updateCurrentLyricOffset, setCurrentTrackVolume, setCurrentPlaylistVolume,
    flushLiveSettings,
    captureVolumeRead, applyVolumeDraftsToState,
    setOffsetForTrack, needsOverlayReload, invalidateOverlayTrack,
  }
}
