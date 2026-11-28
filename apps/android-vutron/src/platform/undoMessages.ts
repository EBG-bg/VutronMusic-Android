import { appLocale } from './i18n'

const messages = {
  zh: { undo: '撤销', close: '关闭撤销提示', seconds: '{seconds} 秒', restoring: '正在恢复…', loadMore: '加载更多',
    removedTrack: '已从应用移除「{name}」', removedTracks: '已从应用移除 {count} 首歌曲', removeTracks: '移除所选歌曲', removeTracksHint: '从应用移除 {count} 首歌曲，保留原音频。正在播放的所选歌曲会停止。', deleteCaches: '删除所选音频缓存', deleteCachesHint: '删除 {count} 首歌曲的应用音频缓存，原始文件、封面、歌词和歌单资料保留。当前播放中的歌曲会跳过。', partialCache: '已删除 {removed} 首缓存，{skipped} 首正在使用或删除失败，所选项目已保留。', busy: '请等待当前操作完成', removedQueue: '已从播放队列移除', clearedNext: '已清空插队歌曲',
    removedHistory: '已删除这份排序', restoreHistoryFull: '自动排序记录已满，请先提高保留数量再撤销', records: '移除记录', restore: '恢复', noRecords: '没有可恢复的移除记录',
    recordsHint: '只恢复列表里的记录，原音频一直在手机里。很早以前移除、缺少歌名信息的记录，重新扫一次文件夹就能找回。',
    restored: '已恢复', queueChanged: '播放队列已改变，请重新操作', restoreFailed: '恢复失败，请重试' },
  zht: { undo: '復原', close: '關閉復原提示', seconds: '{seconds} 秒', restoring: '正在恢復…', loadMore: '載入更多',
    removedTrack: '已從應用程式移除「{name}」', removedTracks: '已從應用程式移除 {count} 首歌曲', removeTracks: '移除所選歌曲', removeTracksHint: '從應用程式移除 {count} 首歌曲，保留原音訊。正在播放的所選歌曲會停止。', deleteCaches: '刪除所選音訊快取', deleteCachesHint: '刪除 {count} 首歌曲的應用程式音訊快取，原始檔案、封面、歌詞及歌單資料保留。目前播放中的歌曲會略過。', partialCache: '已刪除 {removed} 首快取，{skipped} 首正在使用或刪除失敗，所選項目已保留。', busy: '請等待目前操作完成', removedQueue: '已從播放佇列移除', clearedNext: '已清空插隊歌曲',
    removedHistory: '已刪除這份排序', restoreHistoryFull: '自動排序記錄已滿，請先提高保留數量再復原', records: '移除記錄', restore: '恢復', noRecords: '沒有可恢復的移除記錄',
    recordsHint: '只恢復清單裡的紀錄，原音訊一直在手機裡。很早以前移除、缺少歌名資訊的紀錄，重新掃一次資料夾就能找回。',
    restored: '已恢復', queueChanged: '播放佇列已改變，請重新操作', restoreFailed: '恢復失敗，請重試' },
  en: { undo: 'Undo', close: 'Dismiss undo notification', seconds: '{seconds}s', restoring: 'Restoring…', loadMore: 'Load more',
    removedTrack: 'Removed “{name}” from the app', removedTracks: 'Removed {count} tracks from the app', removeTracks: 'Remove selected tracks', removeTracksHint: 'Remove {count} tracks from the app and keep original audio. Any selected track that is playing will stop.', deleteCaches: 'Delete selected audio caches', deleteCachesHint: 'Delete audio caches for {count} tracks. Original files, artwork, lyrics and playlists are kept. Tracks in use will be skipped.', partialCache: 'Deleted {removed} audio caches; {skipped} are in use or failed. Your selection has been kept.', busy: 'Please wait for the current operation', removedQueue: 'Removed from the playback queue', clearedNext: 'Cleared play next',
    removedHistory: 'Deleted this saved order', restoreHistoryFull: 'Automatic order history is full. Increase the retention limit, then retry Undo.', records: 'Removed tracks', restore: 'Restore', noRecords: 'No removed tracks to restore',
    recordsHint: 'Restores the list entries only; original audio files stay on your phone. Very old records without track info return after rescanning the folder.',
    restored: 'Restored', queueChanged: 'The queue has changed. Please try again.', restoreFailed: 'Could not restore. Please try again.' }
} as const

export function undoText(key: keyof typeof messages.zh, values: Record<string, string | number> = {}): string {
  return Object.entries(values).reduce((text, [name, value]) => text.replaceAll(`{${name}}`, String(value)), messages[appLocale.value][key] as string)
}
