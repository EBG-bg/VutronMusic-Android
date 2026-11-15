import type { VutronPlaybackState } from '../../platform/vutronPlugin'

/** Native bridge metadata is JSON. Reuse unchanged branches of this single track, without a second cache. */
function shareTrackValue(previous: unknown, next: unknown): unknown {
  if (previous === next) return previous
  if (!previous || !next || typeof previous !== 'object' || typeof next !== 'object'
      || Array.isArray(previous) !== Array.isArray(next)) return next
  const before = previous as Record<string, unknown>, after = next as Record<string, unknown>
  const keys = Object.keys(after)
  let unchanged = Object.keys(before).length === keys.length
  for (const key of keys) {
    const present = Object.prototype.hasOwnProperty.call(before, key)
    const value = present ? shareTrackValue(before[key], after[key]) : after[key]
    if (!present || value !== before[key]) unchanged = false
    after[key] = value
  }
  return unchanged ? previous : next
}

export function sharePlaybackSnapshot(previous: VutronPlaybackState, next: VutronPlaybackState): VutronPlaybackState {
  const before = previous.track, after = next.track
  if (before && after && before.id === after.id && before.pluginId === after.pluginId
      && before.pluginAccountScope === after.pluginAccountScope && before.pluginTrackId === after.pluginTrackId) {
    next.track = shareTrackValue(before, after) as typeof after
  }
  if (previous.abLoop && next.abLoop) next.abLoop = shareTrackValue(previous.abLoop, next.abLoop) as typeof next.abLoop
  const keys = Object.keys(next) as (keyof VutronPlaybackState)[]
  return keys.length === Object.keys(previous).length && keys.every(key => next[key] === previous[key]) ? previous : next
}
