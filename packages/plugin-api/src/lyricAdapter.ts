import { selectLyricFamily } from '../../core/src/lyrics'
import type { LyricLine } from './plugin'

/** Same desktop shared-core adapter: line times are seconds; word times are ms. */
export function parseLyric(value: unknown): LyricLine[] {
  const payload = typeof value === 'string' ? { lrc: value } : value && typeof value === 'object' ? value as Record<string, unknown> : {}
  const read = (name: string) => {
    const raw = payload[name]
    return typeof raw === 'string' ? raw : raw && typeof raw === 'object' && typeof (raw as { lyric?: unknown }).lyric === 'string' ? (raw as { lyric: string }).lyric : ''
  }
  const family = selectLyricFamily({ lrc: read('lrc'), tlyric: read('tlyric'), yrc: read('yrc'), ytlrc: read('ytlrc') })
  return family.original.map((line, index) => ({
    start: line.start / 1000, end: line.end / 1000,
    lyric: { text: line.text, ...(line.words.length ? { info: line.words.map(word => ({ start: word.start, end: word.end, word: word.text })) } : {}) },
    ...(family.pairedTranslations[index] ? { tlyric: { text: family.pairedTranslations[index] } } : {})
  }))
}
