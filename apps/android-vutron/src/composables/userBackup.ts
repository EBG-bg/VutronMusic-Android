import { ref } from 'vue'
import { vutronPlugin } from '../platform/vutronPlugin'
import { askAction } from '../platform/actionDialog'
import { translate as t, setAppLocale } from '../platform/i18n'
import { appearance, accent, type Appearance } from '../platform/appearance'
import { motionPreference, type MotionPreference } from '../platform/motion'
import { playlistView, playlistColumns } from '../platform/libraryLayout'
import { ORDER_STORAGE_KEY } from './localTrackOrdering'
import { ORDER_HISTORY_STORAGE_KEY, exportCollectionOrderHistories, restoreCollectionOrderHistories } from './collectionOrderHistory'
import { INTERFACE_KEYS } from '../platform/interfacePreferences'
import { PLAYLIST_ORDER_KEY, sanitizePlaylistOrders } from './playlistOrdering'
import { libraryMutationBusy } from '../platform/libraryActivity'
import { useAndroidShellStore } from '../stores/androidShell'

const keys = ['vutron:language', 'vutron:appearance', 'vutron:accent', 'vutron:motion-preference', 'vutron:playlist-view', 'vutron:playlist-columns', 'vutron:local-track-order', ...INTERFACE_KEYS, PLAYLIST_ORDER_KEY, ORDER_STORAGE_KEY, ORDER_HISTORY_STORAGE_KEY]
function setIfChanged(key: string, value: string) { if (localStorage.getItem(key) !== value) localStorage.setItem(key, value) }
export function useUserBackup() {
  const busy = ref(false), message = ref('')
  const store = useAndroidShellStore()
  async function exportBackup() {
    if (busy.value || libraryMutationBusy.value || !vutronPlugin.exportUserBackup) return
    busy.value = true
    try {
      await store.flushLiveSettings()
      const frontend = Object.fromEntries(keys.filter(key => key !== ORDER_HISTORY_STORAGE_KEY).flatMap(key => { const value = localStorage.getItem(key); return value === null ? [] : [[key, value]] }))
      const histories = exportCollectionOrderHistories()
      if (Object.keys(histories).length) frontend[ORDER_HISTORY_STORAGE_KEY] = JSON.stringify(histories)
      const orders = JSON.parse(localStorage.getItem(ORDER_STORAGE_KEY) || '{}')
      const result = await vutronPlugin.exportUserBackup({ frontend, orders })
      if (!result.cancelled) message.value = t('mobile.backup.exported', { count: result.collectionCount || 0 })
    } catch (cause) { message.value = cause instanceof Error ? cause.message : t('mobile.backup.failed') }
    finally { busy.value = false }
  }
  async function importBackup() {
    if (busy.value || libraryMutationBusy.value || !vutronPlugin.importUserBackup) return
    if (await askAction({ title: t('mobile.backup.import'), message: t('mobile.backup.confirm'), confirmLabel: t('mobile.backup.import'), cancelLabel: t('mobile.management.cancel') }) !== 'confirm') return
    if (libraryMutationBusy.value) return
    busy.value = true; libraryMutationBusy.value = true
    try {
      await store.flushLiveSettings()
      const result = await vutronPlugin.importUserBackup()
      if (result.cancelled) return
      for (const key of keys) if (typeof result.frontend?.[key] === 'string') {
        if (key === ORDER_HISTORY_STORAGE_KEY) {
          restoreCollectionOrderHistories(JSON.parse(result.frontend[key]))
        } else if (key === PLAYLIST_ORDER_KEY) {
          const existing = sanitizePlaylistOrders(JSON.parse(localStorage.getItem(key) || '{}'))
          const restored = sanitizePlaylistOrders(JSON.parse(result.frontend[key]))
          setIfChanged(key, JSON.stringify({ ...existing, ...restored }))
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
      await store.reloadManagedLibrary(); await store.loadOverlaySettings(); await store.loadSourceSettings(); await store.loadCacheStatus(false)
      message.value = t('mobile.backup.imported', { count: result.collectionCount || 0 })
    } catch (cause) { message.value = cause instanceof Error ? cause.message : t('mobile.backup.failed') }
    finally { busy.value = false; libraryMutationBusy.value = false }
  }
  return { busy, message, exportBackup, importBackup }
}
