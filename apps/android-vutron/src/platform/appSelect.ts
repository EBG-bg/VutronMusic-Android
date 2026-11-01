import { shallowRef } from 'vue'

export const activeAppSelect = shallowRef<{ close: () => void }>()

export function closeAppSelect(): boolean {
  if (!activeAppSelect.value) return false
  activeAppSelect.value.close()
  return true
}
