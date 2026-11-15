import { watch } from 'vue'
import { createI18n } from 'vue-i18n'
import zh from '../../../../src/renderer/locales/zh-hans.json'
import zht from '../../../../src/renderer/locales/zh-hant.json'
import en from '../../../../src/renderer/locales/en.json'
import mobileZh from '../locales/zh-hans.json'
import mobileZht from '../locales/zh-hant.json'
import mobileEn from '../locales/en.json'
import pluginZh from '../plugins/locales/zh-hans.json'
import pluginZht from '../plugins/locales/zh-hant.json'
import pluginEn from '../plugins/locales/en.json'

export type AppLocale = 'zh' | 'zht' | 'en'
export const supportedLocales: readonly AppLocale[] = ['zh', 'zht', 'en']
const storageKey = 'vutron:language'
let initialLocale: AppLocale = 'zh'
try {
  const saved = localStorage.getItem(storageKey)
  if (supportedLocales.includes(saved as AppLocale)) initialLocale = saved as AppLocale
} catch { /* Keep the existing Chinese default when storage is unavailable. */ }

export const i18n = createI18n({
  legacy: false, globalInjection: true, locale: initialLocale, fallbackLocale: 'zh',
  // Static references let the bundler omit desktop-only settings without a
  // second word list or asynchronous language changes. Mobile/plugin keys stay complete.
  messages: {
    zh: {
      nav: zh.nav,
      home: { recommendPlaylist: zh.home.recommendPlaylist },
      contextMenu: { play: zh.contextMenu.play },
      player: { previous: zh.player.previous, next: zh.player.next, pause: zh.player.pause },
      settings: {
        nav: { appearance: zh.settings.nav.appearance, osdLyric: zh.settings.nav.osdLyric },
        general: { language: { text: zh.settings.general.language.text } },
        theme: zh.settings.theme
      },
      mobile: { ...mobileZh, plugins: pluginZh }
    },
    zht: {
      nav: zht.nav,
      home: { recommendPlaylist: zht.home.recommendPlaylist },
      contextMenu: { play: zht.contextMenu.play },
      player: { previous: zht.player.previous, next: zht.player.next, pause: zht.player.pause },
      settings: {
        nav: { appearance: zht.settings.nav.appearance, osdLyric: zht.settings.nav.osdLyric },
        general: { language: { text: zht.settings.general.language.text } },
        theme: zht.settings.theme
      },
      mobile: { ...mobileZht, plugins: pluginZht }
    },
    en: {
      nav: en.nav,
      home: { recommendPlaylist: en.home.recommendPlaylist },
      contextMenu: { play: en.contextMenu.play },
      player: { previous: en.player.previous, next: en.player.next, pause: en.player.pause },
      settings: {
        nav: { appearance: en.settings.nav.appearance, osdLyric: en.settings.nav.osdLyric },
        general: { language: { text: en.settings.general.language.text } },
        theme: en.settings.theme
      },
      mobile: { ...mobileEn, plugins: pluginEn }
    }
  }
})
export const appLocale = i18n.global.locale
export const translate = i18n.global.t
export function setAppLocale(value: string): boolean {
  if (!supportedLocales.includes(value as AppLocale)) return false
  appLocale.value = value as AppLocale
  try { localStorage.setItem(storageKey, value) } catch { /* The current session can still switch language. */ }
  return true
}
watch(appLocale, locale => {
  if (typeof document !== 'undefined') document.documentElement?.setAttribute('lang', locale === 'zh' ? 'zh-CN' : locale === 'zht' ? 'zh-TW' : 'en')
}, { immediate: true, flush: 'sync' })
