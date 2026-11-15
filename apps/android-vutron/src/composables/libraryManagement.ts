import { useAndroidShellStore } from '../stores/androidShell'
import { vutronPlugin, type VutronTrack, type VutronLocalCollection, type VutronPlaylist } from '../platform/vutronPlugin'
import { translate as t } from '../platform/i18n'
import { askAction } from '../platform/actionDialog'

import { libraryMutationBusy } from '../platform/libraryActivity'
import { offerUndo } from '../platform/undo'
import { undoText } from '../platform/undoMessages'
export function useLibraryManagement() {
  const store = useAndroidShellStore()
  let confirmationPending = false
  async function restoreRemovedTrack(recordId: string, group = false): Promise<boolean> {
    if (!vutronPlugin.manageLocalLibrary || libraryMutationBusy.value) return false
    libraryMutationBusy.value = true
    try {
      const result = await vutronPlugin.manageLocalLibrary({ action: group ? 'restoreRemoval' : 'restoreTrack', recordId })
      if (result.changed) { await store.reloadManagedLibrary({ refreshLocalSnapshots: true }); store.queueNotice = undoText('restored') }
      return result.changed
    } catch (cause) { store.error = cause instanceof Error ? cause.message : undoText('restoreFailed'); return false }
    finally { libraryMutationBusy.value = false }
  }
  async function removeLocalTracks(tracks: VutronTrack[]): Promise<boolean> {
    if (!tracks.length || !vutronPlugin.manageLocalLibrary || libraryMutationBusy.value || confirmationPending) return false
    confirmationPending = true
    try {
      const title = tracks.length === 1 ? t('mobile.management.removeTrack') : undoText('removeTracks')
      const choice = await askAction({ title, message: tracks.length === 1 ? t('mobile.management.removeTrackHint') : undoText('removeTracksHint', { count: tracks.length }), confirmLabel: title, cancelLabel: t('mobile.management.cancel') })
      if (choice !== 'confirm' || libraryMutationBusy.value) return false
      libraryMutationBusy.value = true
      try {
        store.error = ''
        const result = await vutronPlugin.manageLocalLibrary({ action: tracks.length === 1 ? 'removeTrack' : 'removeTracks', track: tracks[0], tracks, stopCurrent: true })
        if (!result.changed) return false
        await store.reloadManagedLibrary({ tracks })
        if (result.undoToken) offerUndo({ message: tracks.length === 1 ? undoText('removedTrack', { name: tracks[0]!.name }) : undoText('removedTracks', { count: result.removedCount ?? tracks.length }), undo: async () => {
          if (libraryMutationBusy.value) throw new Error(undoText('busy'))
          if (!await restoreRemovedTrack(result.undoToken!, true)) throw new Error(store.error || undoText('restoreFailed'))
        } })
        return true
      } catch (cause) {
        store.error = cause instanceof Error ? cause.message : t('mobile.management.failed')
        try { await store.reloadManagedLibrary() } catch { /* Preserve the operation error. */ }
        return false
      } finally { libraryMutationBusy.value = false }
    } finally { confirmationPending = false }
  }
  async function manage(action: 'removeTrack' | 'deletePlaylist' | 'forgetFolder' | 'restoreRemoved', track?: VutronTrack, collection?: VutronLocalCollection): Promise<boolean> {
    if (!vutronPlugin.manageLocalLibrary || libraryMutationBusy.value) return false
    const title = t('mobile.management.' + action)
    const choice = await askAction({ title, message: t('mobile.management.' + action + 'Hint'), confirmLabel: title, cancelLabel: t('mobile.management.cancel') })
    if (choice !== 'confirm' || libraryMutationBusy.value) return false
    libraryMutationBusy.value = true
    try {
      store.error = ''
      const result = await vutronPlugin.manageLocalLibrary({ action, track, collectionId: collection?.id, stopCurrent: true })
      if (!result.changed) return false
      await store.reloadManagedLibrary({ track, collectionId: action === 'removeTrack' ? undefined : collection?.id })
      if (action === 'restoreRemoved') await store.loadLocalMusic(true)
      store.queueNotice = t('mobile.management.completed')
      return true
    } catch (cause) {
      store.error = cause instanceof Error ? cause.message : t('mobile.management.failed')
      try { await store.reloadManagedLibrary() } catch { /* Preserve the original operation error. */ }
      return false
    } finally { libraryMutationBusy.value = false }
  }
  async function deleteCachedTrack(track: VutronTrack): Promise<boolean> {
    if (!vutronPlugin.deleteCachedTrack || libraryMutationBusy.value) return false
    const trackId = track.neteaseId || (!track.localUri && !track.localPath || track.cached ? track.id : 0)
    if (trackId <= 0) return false
    libraryMutationBusy.value = true
    try {
      const result = await vutronPlugin.deleteCachedTrack({ trackId })
      if (result.inUse) {
        await askAction({ title: t('mobile.management.deleteCache'), message: t('mobile.management.cacheInUse'), confirmLabel: t('mobile.management.understood'), cancelLabel: t('mobile.management.cancel') })
        return false
      }
      await store.loadCacheStatus(false)
      store.queueNotice = t('mobile.management.cacheRemoved')
      return true
    } catch (cause) { store.error = cause instanceof Error ? cause.message : t('mobile.management.failed'); return false }
    finally { libraryMutationBusy.value = false }
  }
  async function deleteCachedTracks(tracks: VutronTrack[]): Promise<boolean> {
    if (!tracks.length || !vutronPlugin.deleteCachedTracks || libraryMutationBusy.value || confirmationPending) return false
    const ids = [...new Set(tracks.map(track => track.neteaseId || (!track.localUri && !track.localPath || track.cached ? track.id : 0)).filter(id => id > 0))]
    if (!ids.length) return false
    confirmationPending = true
    try {
      const choice = await askAction({ title: undoText('deleteCaches'), message: undoText('deleteCachesHint', { count: ids.length }), confirmLabel: undoText('deleteCaches'), cancelLabel: t('mobile.management.cancel') })
      if (choice !== 'confirm' || libraryMutationBusy.value) return false
      libraryMutationBusy.value = true
      try {
        store.error = ''
        const result = await vutronPlugin.deleteCachedTracks({ trackIds: ids })
        await store.loadCacheStatus(false)
        if (result.skipped || result.failed) { store.error = undoText('partialCache', { removed: result.removed, skipped: result.skipped + result.failed }); return false }
        store.queueNotice = t('mobile.management.cacheRemoved'); return true
      } catch (cause) { store.error = cause instanceof Error ? cause.message : t('mobile.management.failed'); return false }
      finally { libraryMutationBusy.value = false }
    } finally { confirmationPending = false }
  }
  let cacheConfirmation = false
  async function deleteOfflinePlaylist(playlist: VutronPlaylist): Promise<boolean> {
    if (!vutronPlugin.deleteCachedPlaylist || libraryMutationBusy.value || cacheConfirmation) return false
    cacheConfirmation = true
    try {
      const choice = await askAction({ title: t('mobile.offline.deletePlaylist'), message: t('mobile.offline.deleteHint', { name: playlist.name }), confirmLabel: t('mobile.offline.deletePlaylist'), cancelLabel: t('mobile.management.cancel') })
      if (choice !== 'confirm' || libraryMutationBusy.value) return false
      libraryMutationBusy.value = true
      try {
        store.error = ''
        const result = await vutronPlugin.deleteCachedPlaylist({ playlistId: playlist.id, userId: playlist.cacheOwnerId })
        if (!result.removed) return false
        store.removeCachedPlaylistView(playlist.id)
        await Promise.all([store.loadOfflinePlaylists(), store.loadCacheStatus(false)])
        store.queueNotice = t('mobile.offline.deleted')
        return true
      } catch (cause) { store.error = cause instanceof Error ? cause.message : t('mobile.management.failed'); return false }
      finally { libraryMutationBusy.value = false }
    } finally { cacheConfirmation = false }
  }
  return { deleteCachedTrack, deleteCachedTracks, deleteOfflinePlaylist, removeLocalTrack: (track: VutronTrack) => removeLocalTracks([track]), removeLocalTracks, restoreRemovedTrack,
    removeCollection: (collection: VutronLocalCollection, action: 'deletePlaylist' | 'forgetFolder') => manage(action, undefined, collection),
    restoreRemoved: () => manage('restoreRemoved') }
}
