import { ref, watch } from 'vue'

export const INTERFACE_KEYS = ['vutron:font-scale', 'vutron:player-lyrics', 'vutron:timer-preset', 'vutron:playlist-sort-hints', 'vutron:sleep-mode', 'vutron:sleep-track-count', 'vutron:sleep-fade-seconds'] as const
export function boundedNumber(value: unknown, fallback: number, min: number, max: number): number {
  if (value === null || value === '') return fallback
  const number = Number(value)
  return Number.isFinite(number) ? Math.max(min, Math.min(max, Math.round(number))) : fallback
}
export const fontScale = ref(boundedNumber(localStorage.getItem(INTERFACE_KEYS[0]), 100, 100, 150))
export const playerLyrics = ref(localStorage.getItem(INTERFACE_KEYS[1]) === 'true')
export const timerPreset = ref(boundedNumber(localStorage.getItem(INTERFACE_KEYS[2]), 1800, 1, 18000))
export const playlistSortHints = ref(localStorage.getItem(INTERFACE_KEYS[3]) !== 'false')
const readSleepMode = () => { const value = localStorage.getItem(INTERFACE_KEYS[4]); return value === 'track' || value === 'count' ? value : 'duration' }
const readSleepFade = () => { const value = Number(localStorage.getItem(INTERFACE_KEYS[6])); return [0, 5, 15, 30].includes(value) ? value : 0 }
export const sleepMode = ref<'duration' | 'track' | 'count'>(readSleepMode())
export const sleepTrackCount = ref(boundedNumber(localStorage.getItem(INTERFACE_KEYS[5]), 1, 1, 100))
export const sleepFadeSeconds = ref(readSleepFade())
function setIfChanged(key: string, value: string) { if (localStorage.getItem(key) !== value) localStorage.setItem(key, value) }
watch(fontScale, value => {
  const valid = boundedNumber(value, 100, 100, 150)
  if (valid !== value) { fontScale.value = valid; return }
  document.documentElement.style.setProperty('--ui-font-scale', String(valid / 100))
  setIfChanged(INTERFACE_KEYS[0], String(valid))
}, { immediate: true, flush: 'sync' })
watch(playerLyrics, value => setIfChanged(INTERFACE_KEYS[1], String(value)))
watch(timerPreset, value => setIfChanged(INTERFACE_KEYS[2], String(boundedNumber(value, 1800, 1, 18000))))
watch(playlistSortHints, value => setIfChanged(INTERFACE_KEYS[3], String(value)), { flush:'sync' })
watch(sleepMode, value => setIfChanged(INTERFACE_KEYS[4], value), { flush: 'sync' })
watch(sleepTrackCount, value => setIfChanged(INTERFACE_KEYS[5], String(boundedNumber(value, 1, 1, 100))), { flush: 'sync' })
watch(sleepFadeSeconds, value => setIfChanged(INTERFACE_KEYS[6], String([0, 5, 15, 30].includes(value) ? value : 0)), { flush: 'sync' })
window.addEventListener('vutron-backup-restored', () => {
  fontScale.value = boundedNumber(localStorage.getItem(INTERFACE_KEYS[0]), 100, 100, 150)
  playerLyrics.value = localStorage.getItem(INTERFACE_KEYS[1]) === 'true'
  timerPreset.value = boundedNumber(localStorage.getItem(INTERFACE_KEYS[2]), 1800, 1, 18000)
  playlistSortHints.value = localStorage.getItem(INTERFACE_KEYS[3]) !== 'false'
  sleepMode.value = readSleepMode()
  sleepTrackCount.value = boundedNumber(localStorage.getItem(INTERFACE_KEYS[5]), 1, 1, 100)
  sleepFadeSeconds.value = readSleepFade()
})
