import { vutronPlugin, type VutronPlaylist, type VutronPlaylistTracksProgress, type VutronPlaylistTracksResult, type VutronTrack } from '../../platform/vutronPlugin'

interface Request {
  playlist: VutronPlaylist
  userId: number
  requestToken: string
  isCurrent(): boolean
  publish(tracks: VutronTrack[], playlist?: VutronPlaylist): void
}

/** Real native batches are coalesced into one visible update per event-loop turn. */
export async function loadPlaylistTrackBatches(request: Request): Promise<VutronPlaylistTracksResult | undefined> {
  let listener: { remove(): Promise<void> } | undefined
  let pending: ReturnType<typeof setTimeout> | undefined
  let rows: VutronTrack[] = [], lastPublished: VutronTrack[] | undefined, metadata: VutronPlaylist | undefined
  const ids = new Set<number>()
  let disposed = false, metadataPublished = false
  function flush() {
    pending = undefined
    if (disposed || !request.isCurrent() || lastPublished?.length === rows.length) return
    lastPublished = rows.slice(); request.publish(lastPublished, metadata); if (metadata) metadataPublished = true; metadata = undefined
  }
  function progress(batch: VutronPlaylistTracksProgress) {
    if (disposed || !request.isCurrent() || batch.requestToken !== request.requestToken || batch.userId !== request.userId || batch.playlistId !== request.playlist.id || batch.offset !== rows.length) return
    for (const track of batch.tracks) if (!ids.has(track.id)) { ids.add(track.id); rows.push(track) }
    if (!metadataPublished) metadata ??= batch.playlist
    if (pending === undefined) pending = setTimeout(flush, 0)
  }
  try {
    listener = await vutronPlugin.addListener('playlistTracksProgress', progress)
    if (!request.isCurrent()) return undefined
    const result = await vutronPlugin.getPlaylistTracks({ playlistId: request.playlist.id, playlist: request.playlist, userId: request.userId, requestToken: request.requestToken })
    if (!request.isCurrent()) return undefined
    if (pending !== undefined) { clearTimeout(pending); pending = undefined }
    const sameSequence = !result.cached && rows.length === result.tracks.length && rows.every((track, index) => track.id === result.tracks[index]!.id)
    // Native standardizes each row once. Keep the objects already displayed instead
    // of publishing their duplicate bridge copies and invalidating every row effect.
    if (sameSequence) rows = lastPublished?.length === rows.length ? lastPublished : rows.slice()
    else {
      const seen = new Set<number>()
      rows = result.tracks.filter(track => { if (seen.has(track.id)) return false; seen.add(track.id); return true })
    }
    request.publish(rows, result.playlist)
    return { ...result, tracks: rows }
  } finally {
    disposed = true
    if (pending !== undefined) clearTimeout(pending)
    try { await listener?.remove() } catch (failure) { console.warn('Playlist batch listener cleanup failed', failure) }
  }
}
