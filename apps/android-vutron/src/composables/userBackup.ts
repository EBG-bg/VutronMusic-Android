import { ref } from 'vue'
import { vutronPlugin } from '../platform/vutronPlugin'
import { askAction } from '../platform/actionDialog'
import { appLocale, translate as t, setAppLocale } from '../platform/i18n'
import { notifyMusicSourcesChanged } from '../plugins/useMusicSources'
import { appearance, accent, type Appearance } from '../platform/appearance'
import { motionPreference, type MotionPreference } from '../platform/motion'
import { playlistView, playlistColumns } from '../platform/libraryLayout'
import { ORDER_STORAGE_KEY } from './localTrackOrdering'
import { ORDER_HISTORY_STORAGE_KEY, exportCollectionOrderHistories, restoreCollectionOrderHistories } from './collectionOrderHistory'
import { INTERFACE_KEYS } from '../platform/interfacePreferences'
import { PLAYLIST_ORDER_KEY, sanitizePlaylistOrders } from './playlistOrdering'
import { libraryMutationBusy } from '../platform/libraryActivity'
import { useAndroidShellStore } from '../stores/androidShell'
import { usePlaybackTuning } from './playbackTuning'

const keys = ['vutron:language', 'vutron:appearance', 'vutron:accent', 'vutron:motion-preference', 'vutron:playlist-view', 'vutron:playlist-columns', 'vutron:local-track-order', ...INTERFACE_KEYS, PLAYLIST_ORDER_KEY, ORDER_STORAGE_KEY, ORDER_HISTORY_STORAGE_KEY]
function setIfChanged(key: string, value: string) { if (localStorage.getItem(key) !== value) localStorage.setItem(key, value) }
export function useUserBackup() {
  const busy = ref(false), message = ref('')
  const retryImportAvailable = ref(false)
  const store = useAndroidShellStore()
  const tuning = usePlaybackTuning()
  let asking = false
  let pendingImport: { requestId: string; includePrivacy: boolean; includeCache: boolean; summary: string } | undefined
  async function confirmBackup(direction: 'import' | 'export', includePrivacy: boolean, summary = '', accountIncluded = false) {
    asking = true
    try {
      const exporting = direction === 'export'
      const choice = await askAction({
        title: t(exporting ? 'mobile.backup.exportAccountsTitle' : 'mobile.backup.import'),
        message: [t(exporting ? 'mobile.backup.exportAccountsHint' : includePrivacy && accountIncluded ? 'mobile.backup.importAccountsHint' : 'mobile.backup.confirm'), summary].filter(Boolean).join('\n'),
        confirmLabel: t(exporting ? 'mobile.backup.exportAccounts' : 'mobile.backup.import'),
        cancelLabel: t('mobile.management.cancel'),
      })
      return choice === 'confirm' && !libraryMutationBusy.value
    } finally { asking = false }
  }
  async function exportBackup(options: { includePrivacy?: boolean; includeCache?: boolean } = {}) {
    if (asking || busy.value || libraryMutationBusy.value || !vutronPlugin.exportUserBackup) return
    if (options.includePrivacy && !await confirmBackup('export', true)) return
    busy.value = true; libraryMutationBusy.value = true
    try {
      await store.flushLiveSettings()
      const frontend = Object.fromEntries(keys.filter(key => key !== ORDER_HISTORY_STORAGE_KEY).flatMap(key => { const value = localStorage.getItem(key); return value === null ? [] : [[key, value]] }))
      const histories = exportCollectionOrderHistories()
      if (Object.keys(histories).length) frontend[ORDER_HISTORY_STORAGE_KEY] = JSON.stringify(histories)
      const orders = JSON.parse(localStorage.getItem(ORDER_STORAGE_KEY) || '{}')
      const result = await vutronPlugin.exportUserBackup({ frontend, orders, ...options, language: appLocale.value })
      if (!result.cancelled) message.value = result.cacheItems === undefined
        ? t('mobile.backup.exported', { count: result.collectionCount || 0 })
        : t('mobile.backup.exportedCache', { count: result.collectionCount || 0, cache: result.cacheItems })
    } catch (cause) { message.value = cause instanceof Error ? cause.message : t('mobile.backup.failed') }
    finally { busy.value = false; libraryMutationBusy.value = false }
  }
  async function importBackup(includePrivacy = false, includeCache = false) {
    if (asking || busy.value || libraryMutationBusy.value || !vutronPlugin.inspectUserBackup || !vutronPlugin.completeUserBackupImport) return
    if (pendingImport && vutronPlugin.cancelUserBackupImport) await vutronPlugin.cancelUserBackupImport({ requestId: pendingImport.requestId })
    pendingImport = undefined; retryImportAvailable.value = false; message.value = ''
    busy.value = true
    try {
      await store.flushLiveSettings()
      const inspected = await vutronPlugin.inspectUserBackup()
      if (inspected.cancelled) return
      if (!inspected.requestId) throw new Error(t('mobile.backup.failed'))
      const cache = inspected.archive && inspected.cacheItems
        ? t(includeCache ? 'mobile.backup.importCacheSummary' : 'mobile.backup.importCacheSkipped', { items: inspected.cacheItems, tracks: inspected.audioItems || 0 }) : ''
      const accounts = inspected.hasAccounts
        ? t(includePrivacy ? 'mobile.backup.importAccountsSummary' : 'mobile.backup.importAccountsSkipped') : ''
      const summary = t('mobile.backup.importContents', { playlists: inspected.collectionCount || 0, tracks: inspected.trackCount || 0, cache, accounts })
      pendingImport = { requestId: inspected.requestId, includePrivacy, includeCache, summary }
      busy.value = false
      if (!await confirmBackup('import', includePrivacy, summary, Boolean(inspected.hasAccounts))) {
        await vutronPlugin.cancelUserBackupImport?.({ requestId: inspected.requestId })
        pendingImport = undefined
        return
      }
      busy.value = true; libraryMutationBusy.value = true
      const result = await completePendingImport()
      if (result.cancelled) { retryImportAvailable.value = true; message.value = t('mobile.backup.passwordPromptCancelled'); return }
      await applyImportedBackup(result)
    } catch (cause) {
      message.value = cause instanceof Error ? cause.message : t('mobile.backup.failed')
      retryImportAvailable.value = Boolean(pendingImport)
    }
    finally { busy.value = false; libraryMutationBusy.value = false }
  }
  async function completePendingImport() {
    if (!pendingImport || !vutronPlugin.completeUserBackupImport) throw new Error(t('mobile.backup.failed'))
    return vutronPlugin.completeUserBackupImport({
      requestId: pendingImport.requestId, includePrivacy: pendingImport.includePrivacy,
      includeCache: pendingImport.includeCache, language: appLocale.value,
    })
  }
  async function retryImport() {
    if (busy.value || !pendingImport || !vutronPlugin.completeUserBackupImport) return
    busy.value = true; libraryMutationBusy.value = true
    try {
      retryImportAvailable.value = false
      const result = await completePendingImport()
      if (result.cancelled) { retryImportAvailable.value = true; return }
      await applyImportedBackup(result)
    } catch (cause) {
      message.value = cause instanceof Error ? cause.message : t('mobile.backup.failed')
      retryImportAvailable.value = true
    } finally { busy.value = false; libraryMutationBusy.value = false }
  }
  async function applyImportedBackup(result: Awaited<ReturnType<NonNullable<typeof vutronPlugin.completeUserBackupImport>>>) {
      pendingImport = undefined; retryImportAvailable.value = false
      if (result.cancelled) return
      if (result.pluginAccountsRestored) notifyMusicSourcesChanged()
      if (result.neteaseRestored) await store.refreshRestoredAccount()
      for (const key of keys) if (typeof result.frontend?.[key] === 'string') {
        if (key === ORDER_HISTORY_STORAGE_KEY) {
          restoreCollectionOrderHistories(JSON.parse(result.frontend[key]))
        } else if (key === PLAYLIST_ORDER_KEY) {
          const existing = sanitizePlaylistOrders(JSON.parse(localStorage.getItem(key) || '{}'))
          const restored = sanitizePlaylistOrders(JSON.parse(result.frontend[key]))
          for (const [scope, incoming] of Object.entries(restored)) {
            const current = existing[scope]
            if (!current) { existing[scope] = incoming; continue }
            // Restore the chosen sort and supplied sequence. Keep other playlists
            // ranked, and never replace a newer play date with an older backup.
            const recent = { ...current.recent }
            for (const [playlist, time] of Object.entries(incoming.recent)) recent[playlist] = Math.max(recent[playlist] ?? 0, time)
            existing[scope] = { ...incoming, keys: [...new Set([...incoming.keys, ...current.keys])], recent }
          }
          setIfChanged(key, JSON.stringify(sanitizePlaylistOrders(existing)))
        } else if (key === ORDER_STORAGE_KEY) {
          const existing = JSON.parse(localStorage.getItem(key) || '{}'), restored = JSON.parse(result.frontend[key])
          setIfChanged(key, JSON.stringify({ ...existing, ...restored }))
        } else setIfChanged(key, result.frontend[key])
      }
      const previous = JSON.parse(localStorage.getItem(ORDER_STORAGE_KEY) || '{}')
      setIfChanged(ORDER_STORAGE_KEY, JSON.stringify({ ...previous, ...result.orders }))
      const values = result.frontend || {}
      if (values['vutron:language']) setAppLocale(values['vutron:language'])
      if (values['vutron:appearance']) appearance.value = values['vutron:appearance'] as Appearance
      if (values['vutron:accent']) accent.value = values['vutron:accent']
      if (values['vutron:motion-preference']) motionPreference.value = values['vutron:motion-preference'] as MotionPreference
      if (values['vutron:playlist-view']) playlistView.value = values['vutron:playlist-view'] as 'cards' | 'list'
      if (values['vutron:playlist-columns']) playlistColumns.value = Number(values['vutron:playlist-columns'])
      window.dispatchEvent(new Event('vutron-backup-restored'))
      const refreshOffline = result.cacheItems !== undefined || result.cacheIncomplete || result.neteaseRestored || result.pluginAccountsRestored
      await Promise.all([store.reloadManagedLibrary(), store.loadOverlaySettings(), store.loadSourceSettings(), store.loadCacheStatus(true), tuning.load(), ...(refreshOffline ? [store.loadOfflinePlaylists()] : [])])
      const summary = [t('mobile.backup.imported', { count: result.collectionCount ?? 0 })]
      if (result.collectionSkipped) summary.push(t('mobile.backup.importedDuplicates', { count: result.collectionSkipped }))
      if (result.cacheItems !== undefined) summary.push(t('mobile.backup.importedCache', { cache: result.cacheItems, skipped: result.cacheSkipped ?? 0 }))
      if (result.cacheIncomplete) summary.push(t('mobile.backup.cacheIncomplete'))
      const accounts = Number(Boolean(result.neteaseRestored)) + (result.pluginAccountsRestored || 0)
      if (accounts) summary.push(t('mobile.backup.accountsRestored', { count: accounts }))
      if (result.pluginAccountsSkipped) summary.push(t('mobile.backup.accountsSkipped', { count: result.pluginAccountsSkipped }))
      message.value = summary.join(' · ')
  }
  return { busy, message, retryImportAvailable, exportBackup, importBackup, retryImport }
}
