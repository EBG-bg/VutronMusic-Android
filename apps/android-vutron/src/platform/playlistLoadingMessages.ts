import { appLocale } from './i18n'
const messages = {
  zh: { loading: '已加载 {count} 首，继续加载中…', sorting: '加载完成后应用已保存排序；当前可先浏览。', incomplete: '仅加载了 {count} 首，完整歌单尚未取得。请重试后再播放、续播或调整顺序。', retry: '重试加载', wait: '请等待完整歌单加载后再操作。' },
  zht: { loading: '已載入 {count} 首，繼續載入中…', sorting: '載入完成後套用已儲存排序；目前可先瀏覽。', incomplete: '僅載入了 {count} 首，完整歌單尚未取得。請重試後再播放、續播或調整順序。', retry: '重新載入', wait: '請等待完整歌單載入後再操作。' },
  en: { loading: '{count} tracks loaded. Loading more…', sorting: 'You can browse now. Saved sorting applies when loading finishes.', incomplete: 'Only {count} tracks loaded. Retry before playing, resuming or changing the playlist order.', retry: 'Retry loading', wait: 'Wait until the full playlist has loaded.' }
} as const
export function playlistLoadingText(key: keyof typeof messages.zh, values: Record<string, string | number> = {}): string {
  return Object.entries(values).reduce((text, [name, value]) => text.replaceAll(`{${name}}`, String(value)), messages[appLocale.value][key] as string)
}
