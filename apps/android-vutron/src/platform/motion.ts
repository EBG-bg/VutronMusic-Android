import { computed, ref, watch } from 'vue'

export type MotionPreference = 'full' | 'system' | 'reduced'
const key = 'vutron:motion-preference'
const system = matchMedia('(prefers-reduced-motion: reduce)')
export const systemReducesMotion = ref(system.matches)
const saved = localStorage.getItem(key)
export const motionPreference = ref<MotionPreference>(saved === 'system' || saved === 'reduced' ? saved : 'full')
export const reducedMotion = computed(() => motionPreference.value === 'reduced'
  || motionPreference.value === 'system' && systemReducesMotion.value)
export function isMotionReduced() { return reducedMotion.value }
// Larger settings blocks need longer travel; closing remains a little quicker.
export function settingsMotionDuration(height: number, opening: boolean) {
  if (isMotionReduced()) return 0
  return Math.round(opening ? Math.min(340, 220 + height * .12) : Math.min(260, 180 + height * .08))
}
const onSystemChange = (event: MediaQueryListEvent) => { systemReducesMotion.value = event.matches }
system.addEventListener('change', onSystemChange)
watch([motionPreference, reducedMotion], () => {
  localStorage.setItem(key, motionPreference.value)
  document.documentElement.dataset.motion = reducedMotion.value ? 'reduced' : 'full'
}, { immediate: true })
if (import.meta.hot) import.meta.hot.dispose(() => system.removeEventListener('change', onSystemChange))
