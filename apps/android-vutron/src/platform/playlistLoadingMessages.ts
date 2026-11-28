import { appLocale } from './i18n'
const messages = {
  zh: { loading: '已加载 {count} 首，继续加载中…', sorting: '可以先上下翻着看，全部加载完会自动按你的设置排好序。', incomplete: '仅加载了 {count} 首，完整歌单还没拉完，请重试后再播或调整顺序。', retry: '重试加载', wait: '等完整歌单加载完再操作。' },
  zht: { loading: '已載入 {count} 首，繼續載入中…', sorting: '可以先上下翻著看，全部載入完會自動按你的設定排好序。', incomplete: '僅載入了 {count} 首，完整歌單還沒拉完，請重試後再播或調整順序。', retry: '重新載入', wait: '等完整歌單載入完再操作。' },
  en: { loading: '{count} tracks loaded. Loading more…', sorting: 'You can browse now; your saved sort order applies once everything finishes loading.', incomplete: 'Only {count} tracks loaded so far. Retry before playing, resuming, or sorting.', retry: 'Retry loading', wait: 'Wait for the full playlist to finish loading.' }
} as const
export function playlistLoadingText(key: keyof typeof messages.zh, values: Record<string, string | number> = {}): string {
  return Object.entries(values).reduce((text, [name, value]) => text.replaceAll(`{${name}}`, String(value)), messages[appLocale.value][key] as string)
}
