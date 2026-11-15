import { shallowRef } from 'vue'

export interface UndoOffer {
  id: number
  message: string
  deadline: number
  durationMs: number
  running: boolean
  error?: string
  undo: () => void | Promise<void>
}

export const activeUndo = shallowRef<UndoOffer>()
let sequence = 0
let expiry: ReturnType<typeof setTimeout> | undefined

function clearExpiry() { if (expiry !== undefined) clearTimeout(expiry); expiry = undefined }

/** Mutations already happened; expiration only retires their exact inverse operation. */
export function offerUndo(options: { message: string; undo: UndoOffer['undo']; seconds?: number }): number {
  clearExpiry()
  const durationMs = Math.max(1, options.seconds ?? 8) * 1000
  const entry: UndoOffer = { id: ++sequence, message: options.message, undo: options.undo,
    durationMs, deadline: Date.now() + durationMs, running: false }
  activeUndo.value = entry
  expiry = setTimeout(() => { if (activeUndo.value?.id === entry.id && !activeUndo.value.running) dismissUndo(entry.id) }, durationMs)
  return entry.id
}

export function dismissUndo(id = activeUndo.value?.id) {
  if (activeUndo.value?.id !== id) return
  clearExpiry(); activeUndo.value = undefined
}

export async function performUndo(): Promise<boolean> {
  const entry = activeUndo.value
  if (!entry || entry.running) return false
  if (Date.now() >= entry.deadline) { dismissUndo(entry.id); return false }
  clearExpiry(); activeUndo.value = { ...entry, running: true, error: undefined }
  try {
    await entry.undo()
    dismissUndo(entry.id)
    return true
  } catch (cause) {
    if (activeUndo.value?.id === entry.id) {
      activeUndo.value = { ...entry, running: false, error: cause && typeof cause === 'object' && 'message' in cause ? String(cause.message) : String(cause) }
      const remaining = entry.deadline - Date.now()
      if (remaining > 0) expiry = setTimeout(() => dismissUndo(entry.id), remaining)
      else dismissUndo(entry.id)
    }
    return false
  }
}
