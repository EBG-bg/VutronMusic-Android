type FlushSettings = () => Promise<void>
const flushers = new Set<FlushSettings>()

/** Domain-owned writers participate without importing the shell store back. */
export function registerLiveSettingsFlusher(flush: FlushSettings): () => void {
  flushers.add(flush)
  return () => { flushers.delete(flush) }
}

export async function flushRegisteredLiveSettings(): Promise<void> {
  await Promise.all([...flushers].map(flush => flush()))
}
