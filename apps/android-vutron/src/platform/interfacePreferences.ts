import { ref, watch } from 'vue'

export const INTERFACE_KEYS = ['vutron:font-scale', 'vutron:player-lyrics', 'vutron:timer-preset'] as const
export function boundedNumber(value: unknown, fallback: number, min: number, max: number): number {
  if (value === null || value === '') return fallback
  const number = Number(value)
  return Number.isFinite(number) ? Math.max(min, Math.min(max, Math.round(number))) : fallback
}
export const fontScale = ref(boundedNumber(localStorage.getItem(INTERFACE_KEYS[0]), 100, 100, 150))
export const playerLyrics = ref(localStorage.getItem(INTERFACE_KEYS[1]) === 'true')
export const timerPreset = ref(boundedNumber(localStorage.getItem(INTERFACE_KEYS[2]), 1800, 1, 18000))
watch(fontScale, value => {
  const valid = boundedNumber(value, 100, 100, 150)
  if (valid !== value) { fontScale.value = valid; return }
  document.documentElement.style.setProperty('--ui-font-scale', String(valid / 100))
  localStorage.setItem(INTERFACE_KEYS[0], String(valid))
}, { immediate: true, flush: 'sync' })
watch(playerLyrics, value => localStorage.setItem(INTERFACE_KEYS[1], String(value)))
watch(timerPreset, value => localStorage.setItem(INTERFACE_KEYS[2], String(boundedNumber(value, 1800, 1, 18000))))
window.addEventListener('vutron-backup-restored', () => {
  fontScale.value = boundedNumber(localStorage.getItem(INTERFACE_KEYS[0]), 100, 100, 150)
  playerLyrics.value = localStorage.getItem(INTERFACE_KEYS[1]) === 'true'
  timerPreset.value = boundedNumber(localStorage.getItem(INTERFACE_KEYS[2]), 1800, 1, 18000)
})
