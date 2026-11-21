import { ref, shallowRef } from 'vue'
import { selectLyricFamily, type LyricFamily } from '@vutronmusic/core/lyrics'
import { vutronPlugin, type VutronPlaybackState } from '../../platform/vutronPlugin'

const emptyLyrics: LyricFamily = { original: [], translation: [], pairedTranslations: [], source: 'empty' }
const retryDelayMs = 8_000

function trackKey({ trackId, track }: VutronPlaybackState) {
  return JSON.stringify([trackId, track?.localUri, track?.localPath, track?.neteaseId, track?.cueTrackNo, track?.cueOffsetMs,
    track?.pluginId, track?.pluginAccountScope, track?.pluginTrackId])
}

type LyricRequest = { trackId: number; key: string; loaded: boolean; retryAt: number }

export function createPlaybackLyrics(hasAccess: () => boolean) {
  const lyrics = shallowRef(emptyLyrics)
  const lyricsLoading = ref(false)
  let requested: LyricRequest | undefined
  let inFlight = false

  function clearLyrics() {
    requested = undefined
    lyrics.value = emptyLyrics
    lyricsLoading.value = false
  }

  function updateLyrics(state: VutronPlaybackState) {
    if (!hasAccess() || !state.trackId || !vutronPlugin.getLyrics) { clearLyrics(); return }
    const key = trackKey(state)
    if (requested?.key !== key) {
      requested = { trackId: state.trackId, key, loaded: false, retryAt: 0 }
      lyrics.value = emptyLyrics
      lyricsLoading.value = true
    }
    requestLatest()
  }

  function requestLatest() {
    const candidate = requested
    if (inFlight || !candidate || candidate.loaded || candidate.retryAt > Date.now()) return
    // Native lyric reads already share one worker. While one is pending,
    // remember just the latest target rather than queueing each skipped song.
    inFlight = true
    lyricsLoading.value = true
    void read(candidate)
  }

  async function read(candidate: LyricRequest) {
    try {
      const payload = await vutronPlugin.getLyrics!({ trackId: candidate.trackId })
      if (candidate !== requested) return
      lyrics.value = selectLyricFamily(payload)
      candidate.loaded = true
    } catch {
      if (candidate === requested) candidate.retryAt = Date.now() + retryDelayMs
    } finally {
      inFlight = false
      if (candidate === requested) lyricsLoading.value = false
      else requestLatest()
    }
  }

  return { lyrics, lyricsLoading, updateLyrics, clearLyrics }
}
