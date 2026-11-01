export function timerDeadline(sample: { remainingMs: number; deadlineMs?: number }, now = Date.now()): number {
  if (!Number.isFinite(sample.remainingMs) || sample.remainingMs <= 0) return 0
  return Number.isFinite(sample.deadlineMs) && sample.deadlineMs! > 0 ? sample.deadlineMs! : now + sample.remainingMs
}
export function timerRemaining(deadline: number, now: number): number { return Math.max(0, deadline - now) }
export function timerLabel(remaining: number): string {
  const seconds = Math.max(0, Math.ceil(remaining / 1000))
  return `${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, '0')}`
}

export const MAX_TIMER_SECONDS = 300 * 60
export function clampTimerSeconds(value: number): number { return Math.max(1, Math.min(MAX_TIMER_SECONDS, Math.round(value))) }
export function timerParts(value: number) {
  const seconds = Math.max(0, Math.ceil(value))
  return { minutes: Math.floor(seconds / 60), seconds: seconds % 60 }
}
/** Seconds may move outside 0–59 while editing; total time carries or borrows. */
export function editTimerPart(total: number, part: 'minutes' | 'seconds', value: number): number {
  if (!Number.isFinite(value)) return clampTimerSeconds(total)
  const current = timerParts(total)
  return clampTimerSeconds(part === 'minutes' ? Math.round(value) * 60 + current.seconds : current.minutes * 60 + Math.round(value))
}
export function wheelLabel(value: number, cycle?: number): number {
  return cycle ? ((value % cycle) + cycle) % cycle : value
}
