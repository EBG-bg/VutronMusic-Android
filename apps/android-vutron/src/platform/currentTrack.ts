import type { VutronTrack } from './vutronPlugin'
import type { PluginItem } from '../plugins/protocol'

function sameSegment(a: VutronTrack, b: VutronTrack) {
  if (!a.cueTrackNo && !b.cueTrackNo) return true
  return a.cueTrackNo === b.cueTrackNo && a.cueOffsetMs === b.cueOffsetMs
}
function localIdentity(track: VutronTrack) {
  return Boolean(track.localKey || track.localEntryKey || track.localFolderId || track.localPlaylistId
    || !track.cached && (track.localUri || track.localPath))
}
function neteaseOwner(scope: string | undefined) { return scope?.match(/^netease:(\d+)$/)?.[1] }

/** Match the displayed recording, independent of the playing/paused state. */
export function isCurrentTrack(track: VutronTrack, current: VutronTrack | undefined, accountScope?: string) {
  if (!current || !sameSegment(track, current)) return false
  if (track.pluginId || current.pluginId) {
    return Boolean(track.pluginId && track.pluginId === current.pluginId
      && track.pluginTrackId && track.pluginTrackId === current.pluginTrackId
      && (track.pluginAccountScope || '') === (current.pluginAccountScope || ''))
  }
  if (localIdentity(track) || localIdentity(current)) {
    if (!localIdentity(track) || !localIdentity(current)) return false
    const uri = track.localUri || track.localPath, currentUri = current.localUri || current.localPath
    if (uri || currentUri) return Boolean(uri && uri === currentUri)
    if (track.localKey && current.localKey) return track.localKey === current.localKey
    if (track.localPlaylistId?.startsWith('restored:') || current.localPlaylistId?.startsWith('restored:')) {
      return Boolean(track.localEntryKey && track.localEntryKey === current.localEntryKey && track.localPlaylistId === current.localPlaylistId)
    }
    return Boolean(track.localEntryKey && track.localEntryKey === current.localEntryKey && track.localPlaylistId === current.localPlaylistId)
  }
  const owner = neteaseOwner(track.playlistOrderScope) || neteaseOwner(accountScope), currentOwner = neteaseOwner(current.playlistOrderScope)
  if (owner && currentOwner && owner !== currentOwner) return false
  const id = track.neteaseId || track.id
  return id > 0 && id === (current.neteaseId || current.id)
}

export function isCurrentPluginTrack(item: PluginItem, current: VutronTrack | undefined, pluginId: string, accountScope?: string) {
  return Boolean(current?.pluginId === (item.pluginId || pluginId) && String(item.id) === current.pluginTrackId
    && (accountScope || '') === (current.pluginAccountScope || ''))
}
