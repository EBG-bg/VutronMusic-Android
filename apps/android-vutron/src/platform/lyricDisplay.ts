import { argbCss } from '../utils/lyricColors'

export interface LyricDisplaySettings {
  playedColor: number
  unplayedColor: number
  backgroundColor: number
  shadowColor: number
  shadowEnabled?: boolean
  shadowRadius?: number
  estimatedWordTiming?: boolean
}

/** Share lyric colors/shadow, while the in-app player can inherit its themed surface. */
export function lyricDisplayStyle(settings?: LyricDisplaySettings, background: 'custom' | 'theme' = 'custom'): Record<string, string> {
  if (!settings) return {}
  const radius = Math.max(0, Math.min(8, settings.shadowRadius ?? 2))
  return {
    '--lyric-played': argbCss(settings.playedColor),
    '--lyric-unplayed': argbCss(settings.unplayedColor),
    '--lyric-background': background === 'theme' ? 'transparent' : argbCss(settings.backgroundColor),
    '--lyric-shadow': settings.shadowEnabled !== false && radius > 0
      ? 'drop-shadow(0 1px ' + radius + 'px ' + argbCss(settings.shadowColor) + ')' : 'none'
  }
}
