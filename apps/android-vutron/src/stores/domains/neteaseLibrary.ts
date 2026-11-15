import { computed, ref, shallowRef, watch, type Ref } from 'vue'
import { askAction } from '../../platform/actionDialog'
import { translate as t } from '../../platform/i18n'
import { vutronPlugin, type VutronNeteaseMutation, type VutronOnlineLibrary, type VutronPlaylist, type VutronProfile, type VutronTrack } from '../../platform/vutronPlugin'

export type OnlinePlaylistDialog = { kind: 'create' } | { kind: 'more' | 'edit'; playlist: VutronPlaylist } | { kind: 'add'; track: VutronTrack; tracks: VutronTrack[] }
interface Options {
  profile: Ref<VutronProfile | undefined>
  onlineAvailable: Ref<boolean>
  playlists: Ref<VutronPlaylist[]>
  tracks: Ref<VutronTrack[]>
  selectedPlaylist: Ref<VutronPlaylist | undefined>
  error: Ref<string>
  invalidateReads(): void
  applySnapshot(snapshot: VutronOnlineLibrary): void
  notice(message: string): void
  formatError(cause: unknown, fallback: string): string
}
export function onlineTrackId(track: VutronTrack): number {
  if (track.missingLocal || track.pluginId) return 0
  const id = track.neteaseId || (!track.localUri && !track.localPath || track.cached ? track.id : 0)
  return Number.isSafeInteger(id) && id > 0 ? id : 0
}
const normalizedDescription = (value: string | undefined) => (value || '').replace(/\r\n?/g, '\n').trim()
const normalizedTags = (values: string[] | undefined) => [...new Set((values || []).map(value => value.trim()).filter(Boolean))]
function uniqueOnlineTracks(tracks: VutronTrack[]) {
  const ids = new Set<number>()
  return tracks.filter(track => { const id = onlineTrackId(track); if (!id || ids.has(id)) return false; ids.add(id); return true })
}

/** Account relations and writes are separate from local playback and its cache. */
export function createNeteaseLibrary(options: Options) {
  const likedTrackIds = ref<number[]>([]), likedLoaded = ref(false), likesLoading = ref(false)
  const onlineMutationBusy = ref(false), onlineNeedsRefresh = ref(false), onlineOperationNotice = ref('')
  const onlinePlaylistDialog = shallowRef<OnlinePlaylistDialog>()
  const liked = computed(() => new Set(likedTrackIds.value))
  const ownedPlaylists = computed(() => options.playlists.value.filter(canManageOnlinePlaylist))
  let generation = 0, likeRequest = 0, lastLikedAt = 0
  let likedTask: Promise<boolean> | undefined
  let pendingCommitted: VutronOnlineLibrary | undefined
  let confirmationPending = false
  const sameAccount = (token: number, uid: number) => generation === token && options.onlineAvailable.value && options.profile.value?.userId === uid
  watch(() => [options.profile.value?.userId || 0, options.onlineAvailable.value], () => {
    generation++; likeRequest++; lastLikedAt = 0; likedTask = undefined
    likedTrackIds.value = []; likedLoaded.value = false; likesLoading.value = false
    onlineNeedsRefresh.value = false; pendingCommitted = undefined; onlinePlaylistDialog.value = undefined; onlineOperationNotice.value = ''
  }, { flush: 'sync' })

  function isOwnedOnlinePlaylist(playlist: VutronPlaylist | undefined): boolean {
    return Boolean(options.onlineAvailable.value && options.profile.value?.userId && playlist?.creatorUserId === options.profile.value.userId)
  }
  function canManageOnlinePlaylist(playlist: VutronPlaylist | undefined): boolean {
    return isOwnedOnlinePlaylist(playlist) && playlist?.specialType !== 5
  }
  function isTrackLiked(track: VutronTrack) { return likedLoaded.value && liked.value.has(onlineTrackId(track)) }
  function removableOnlinePlaylist(track: VutronTrack) {
    const playlist = options.selectedPlaylist.value
    return !playlist?.offlineSnapshot && canManageOnlinePlaylist(playlist) && onlineTrackId(track) > 0 && track.playlistVolumeKey === 'netease:' + playlist!.id
      && options.tracks.value.some(item => onlineTrackId(item) === onlineTrackId(track)) ? playlist : undefined
  }
  function onlineFailure(cause: unknown) {
    const message = options.formatError(cause, t('mobile.netease.failed'))
    onlineOperationNotice.value = message; options.error.value = message
  }
  async function loadLikedTracks(force = false): Promise<boolean> {
    if (!options.onlineAvailable.value || !vutronPlugin.getLikedTrackIds || onlineMutationBusy.value) return false
    if (!force && likedLoaded.value && Date.now() - lastLikedAt < 60000) return true
    if (likedTask) return likedTask
    const token = generation, uid = options.profile.value!.userId, request = ++likeRequest
    likesLoading.value = true
    const task = (async () => {
      try {
        const result = await vutronPlugin.getLikedTrackIds!()
        if (!sameAccount(token, uid) || request !== likeRequest || result.userId !== uid) return false
        likedTrackIds.value = result.likedIds.filter(id => Number.isSafeInteger(id) && id > 0)
        likedLoaded.value = true; lastLikedAt = Date.now(); return true
      } catch (cause) { if (sameAccount(token, uid) && request === likeRequest) onlineFailure(cause); return false }
      finally { if (request === likeRequest) likesLoading.value = false }
    })()
    likedTask = task
    try { return await task } finally { if (likedTask === task) likedTask = undefined }
  }
  function apply(result: VutronOnlineLibrary) {
    if (!Array.isArray(result.playlists) || !Array.isArray(result.likedIds)) throw new Error(t('mobile.netease.incomplete'))
    options.applySnapshot({ ...result, deletedPlaylistId: result.deletedPlaylistId || pendingCommitted?.deletedPlaylistId })
    likedTrackIds.value = result.likedIds.filter(id => Number.isSafeInteger(id) && id > 0)
    likedLoaded.value = true; lastLikedAt = Date.now()
  }
  async function refreshOnlineLibrary(): Promise<boolean> {
    if (!options.onlineAvailable.value || !vutronPlugin.getOnlineLibrary || onlineMutationBusy.value) return false
    const token = generation, uid = options.profile.value!.userId
    const recovering = onlineNeedsRefresh.value
    onlineMutationBusy.value = true; likeRequest++; likesLoading.value = false; options.invalidateReads()
    try {
      let playlistId = options.selectedPlaylist.value?.id
      if (playlistId === pendingCommitted?.deletedPlaylistId) playlistId = undefined
      const uncertain = onlineNeedsRefresh.value && !pendingCommitted
      let result = await vutronPlugin.getOnlineLibrary({ playlistId: uncertain ? undefined : playlistId })
      if (!sameAccount(token, uid) || result.userId !== uid) return false
      const selected = options.selectedPlaylist.value
      if (uncertain && selected && isOwnedOnlinePlaylist(selected)) {
        if (result.playlists?.some(item => item.id === selected.id)) result = await vutronPlugin.getOnlineLibrary({ playlistId: selected.id })
        else result = { ...result, deletedPlaylistId: selected.id }
        if (!sameAccount(token, uid) || result.userId !== uid) return false
      }
      apply(result)
      if (pendingCommitted || recovering) onlinePlaylistDialog.value = undefined
      pendingCommitted = undefined; onlineNeedsRefresh.value = false; onlineOperationNotice.value = ''; options.error.value = ''
      return true
    } catch (cause) { if (sameAccount(token, uid)) onlineFailure(cause); return false }
    finally { onlineMutationBusy.value = false }
  }
  async function mutate(request: VutronNeteaseMutation): Promise<boolean> {
    if (!options.onlineAvailable.value) { onlineFailure(new Error(t('mobile.netease.onlineRequired'))); return false }
    if (!vutronPlugin.manageNeteaseLibrary) { onlineFailure(new Error(t('mobile.netease.unavailable'))); return false }
    if (onlineMutationBusy.value) return false
    if (onlineNeedsRefresh.value) { onlineFailure(new Error(t('mobile.netease.refreshRequired'))); return false }
    const token = generation, uid = options.profile.value!.userId, dialog = onlinePlaylistDialog.value
    onlineMutationBusy.value = true; likeRequest++; likesLoading.value = false; options.invalidateReads(); options.error.value = ''
    try {
      const result = await vutronPlugin.manageNeteaseLibrary({ ...request, refreshPlaylistId: options.selectedPlaylist.value?.id })
      if (!sameAccount(token, uid) || result.userId !== uid) return false
      if (result.refreshFailed) {
        pendingCommitted = result; onlineNeedsRefresh.value = true
        onlineFailure(new Error(result.message || t('mobile.netease.refreshRequired'))); return false
      }
      apply(result); pendingCommitted = undefined; onlineNeedsRefresh.value = false; onlineOperationNotice.value = ''
      if (onlinePlaylistDialog.value === dialog) onlinePlaylistDialog.value = undefined
      options.notice(t('mobile.netease.completed')); return true
    } catch (cause) {
      if (sameAccount(token, uid)) { onlineNeedsRefresh.value = true; onlineFailure(cause) }
      return false
    } finally { onlineMutationBusy.value = false }
  }
  async function toggleTrackLike(track: VutronTrack) {
    const id = onlineTrackId(track)
    if (!id || !options.onlineAvailable.value || onlineMutationBusy.value) return false
    if (!likedLoaded.value && !await loadLikedTracks(true)) return false
    return mutate({ action: 'like', trackId: id, liked: !liked.value.has(id) })
  }
  function openCreateOnlinePlaylist() { if (options.onlineAvailable.value && !onlineMutationBusy.value) onlinePlaylistDialog.value = { kind: 'create' } }
  function openOnlinePlaylistMore(playlist: VutronPlaylist) { if (canManageOnlinePlaylist(playlist) && !onlineMutationBusy.value) onlinePlaylistDialog.value = { kind: 'more', playlist: { ...playlist, tags: playlist.tags?.slice() } } }
  function openEditOnlinePlaylist(playlist: VutronPlaylist) { if (canManageOnlinePlaylist(playlist) && !onlineMutationBusy.value) onlinePlaylistDialog.value = { kind: 'edit', playlist: { ...playlist, tags: playlist.tags?.slice() } } }
  function openAddToOnlinePlaylist(trackOrTracks: VutronTrack | VutronTrack[]) {
    const tracks = uniqueOnlineTracks(Array.isArray(trackOrTracks) ? trackOrTracks : [trackOrTracks])
    if (options.onlineAvailable.value && tracks.length && !onlineMutationBusy.value) {
      const copies = tracks.map(track => ({ ...track }))
      onlinePlaylistDialog.value = { kind: 'add', track: copies[0], tracks: copies }
      if (!options.playlists.value.length && !onlineNeedsRefresh.value) void refreshOnlineLibrary()
    }
  }
  async function saveOnlinePlaylist(form: { name: string; description: string; tags: string[]; privacy: number }) {
    if (onlineMutationBusy.value || onlineNeedsRefresh.value) return false
    const dialog = onlinePlaylistDialog.value
    const name = form.name.trim(), description = normalizedDescription(form.description), tags = normalizedTags(form.tags)
    if (dialog?.kind === 'create') return mutate({ action: 'create', name, privacy: form.privacy })
    if (dialog?.kind === 'edit' && canManageOnlinePlaylist(dialog.playlist)) {
      const playlist = dialog.playlist
      const sameTags = JSON.stringify(tags.slice().sort()) === JSON.stringify(normalizedTags(playlist.tags).sort())
      if (name === playlist.name.trim() && description === normalizedDescription(playlist.description) && sameTags) {
        onlinePlaylistDialog.value = undefined
        return true
      }
      return mutate({ action: 'edit', playlistId: playlist.id, name, description, tags })
    }
    return false
  }
  async function addTrackToOnlinePlaylist(playlist: VutronPlaylist) {
    const dialog = onlinePlaylistDialog.value
    if (dialog?.kind !== 'add' || !canManageOnlinePlaylist(playlist)) return false
    const ids = dialog.tracks.map(onlineTrackId)
    return mutate({ action: 'add', playlistId: playlist.id, trackIds: ids })
  }
  async function deleteOnlinePlaylist(playlist: VutronPlaylist) {
    if (!canManageOnlinePlaylist(playlist) || confirmationPending || onlineMutationBusy.value) return false
    const token = generation, uid = options.profile.value!.userId
    confirmationPending = true
    try {
      const choice = await askAction({ title: t('mobile.netease.delete'), message: t('mobile.netease.deleteHint', { name: playlist.name }), confirmLabel: t('mobile.netease.delete'), cancelLabel: t('mobile.management.cancel') })
      if (choice !== 'confirm' || !sameAccount(token, uid) || !canManageOnlinePlaylist(playlist)) return false
      return await mutate({ action: 'delete', playlistId: playlist.id })
    } finally { confirmationPending = false }
  }
  async function removeTracksFromOnlinePlaylist(tracks: VutronTrack[]) {
    if (tracks.some(track => !onlineTrackId(track))) return false
    const selected = uniqueOnlineTracks(tracks), playlist = selected.length ? removableOnlinePlaylist(selected[0]) : undefined
    if (!playlist || selected.some(track => removableOnlinePlaylist(track)?.id !== playlist.id) || confirmationPending || onlineMutationBusy.value) return false
    const token = generation, uid = options.profile.value!.userId
    confirmationPending = true
    try {
      const choice = await askAction({ title: t('mobile.netease.remove'), message: t('mobile.netease.removeHint', { name: playlist.name }), confirmLabel: t('mobile.netease.remove'), cancelLabel: t('mobile.management.cancel') })
      if (choice !== 'confirm' || !sameAccount(token, uid) || selected.some(track => removableOnlinePlaylist(track)?.id !== playlist.id)) return false
      return await mutate({ action: 'remove', playlistId: playlist.id, trackIds: selected.map(onlineTrackId) })
    } finally { confirmationPending = false }
  }
  function removeTrackFromOnlinePlaylist(track: VutronTrack) { return removeTracksFromOnlinePlaylist([track]) }
  async function reorderOnlinePlaylist(ordered: VutronTrack[]) {
    const playlist = options.selectedPlaylist.value
    if (!playlist || playlist.offlineSnapshot || !canManageOnlinePlaylist(playlist)) return false
    const ids = ordered.map(onlineTrackId), current = options.tracks.value.map(onlineTrackId), currentIds = new Set(current)
    if (ids.length !== current.length || ids.some(id => !id) || new Set(ids).size !== ids.length || ids.some(id => !currentIds.has(id))) return false
    if (ids.every((id, index) => id === current[index])) return true
    // An uncertain earlier write must be read before another attempt.
    if (onlineNeedsRefresh.value && !await refreshOnlineLibrary()) return false
    if (options.selectedPlaylist.value?.id !== playlist.id || !canManageOnlinePlaylist(options.selectedPlaylist.value)) return false
    const fresh = options.tracks.value.map(onlineTrackId), freshIds = new Set(fresh)
    if (ids.length !== fresh.length || ids.some(id => !freshIds.has(id))) return false
    if (ids.every((id, index) => id === fresh[index])) return true
    return mutate({ action: 'reorder', playlistId: playlist.id, trackIds: ids })
  }
  return { likedTrackIds, likedLoaded, likesLoading, onlineMutationBusy, onlineNeedsRefresh, onlineOperationNotice, onlinePlaylistDialog, ownedPlaylists,
    canManageOnlinePlaylist, isTrackLiked, removableOnlinePlaylist, loadLikedTracks, refreshOnlineLibrary, toggleTrackLike,
    openCreateOnlinePlaylist, openOnlinePlaylistMore, openEditOnlinePlaylist, openAddToOnlinePlaylist, saveOnlinePlaylist, addTrackToOnlinePlaylist,
    deleteOnlinePlaylist, removeTrackFromOnlinePlaylist, removeTracksFromOnlinePlaylist, reorderOnlinePlaylist, closeOnlinePlaylistDialog: () => { onlinePlaylistDialog.value = undefined } }
}
