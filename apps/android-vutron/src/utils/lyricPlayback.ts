import type { LyricLine, LyricWord } from '@vutronmusic/core/lyrics'

export interface LyricPlaybackAnchor { position: number; monotonicTime: number; playing: boolean; rate?: number; loop?: { enabled: boolean; startMs: number; endMs: number } }

export function interpolatedPosition(anchor: LyricPlaybackAnchor, now: number, duration = 0): number {
  const elapsed = anchor.playing ? Math.max(0, now - anchor.monotonicTime) * (anchor.rate ?? 1) : 0
  const position = Math.max(0, anchor.position + elapsed)
  const loop = anchor.loop
  if (anchor.playing && loop?.enabled && loop.startMs >= 0 && loop.endMs - loop.startMs >= 500
    && anchor.position >= loop.startMs && position >= loop.endMs && (!duration || loop.endMs <= duration)) {
    return loop.startMs + (position - loop.startMs) % (loop.endMs - loop.startMs)
  }
  return duration > 0 ? Math.min(duration, position) : position
}

/** A positive user delay keeps a lyric pending until that many milliseconds later. */
export function lyricClock(position: number, offsetMs: number): number { return position - offsetMs }

export function lyricIndexAt(lines: LyricLine[], clock: number): number {
  let low = 0
  let high = lines.length - 1
  let result = -1
  while (low <= high) {
    const middle = (low + high) >>> 1
    if (lines[middle].start <= clock) { result = middle; low = middle + 1 }
    else high = middle - 1
  }
  return result
}

function fraction(value: number): number { return Math.max(0, Math.min(1, value)) }

export function lyricWordProgress(word: LyricWord, clock: number): number {
  if (word.end <= word.start) return clock >= word.start ? 1 : 0
  return fraction((clock - word.start) / (word.end - word.start))
}

export function lyricLineProgress(line: LyricLine, clock: number, fallbackEnd = 0): number {
  const end = line.end > line.start ? line.end : fallbackEnd > line.start ? fallbackEnd : line.start + 3000
  return fraction((clock - line.start) / (end - line.start))
}

/** Grapheme-like display units keep surrogate pairs, combining marks and joined emoji together. */
export function lyricGraphemes(text: string): string[] {
  const result: string[] = []
  let previous = -1
  let regionalCount = 0
  for (const character of text) {
    const point = character.codePointAt(0)!
    const regional = point >= 0x1f1e6 && point <= 0x1f1ff
    const extender = /\p{M}/u.test(character) || point === 0x200d
      || point >= 0xfe00 && point <= 0xfe0f || point >= 0xe0100 && point <= 0xe01ef
      || point >= 0x1f3fb && point <= 0x1f3ff || point >= 0xe0020 && point <= 0xe007f
    if (result.length && (extender || previous === 0x200d || regional && regionalCount % 2 === 1
      || previous === 0x0d && point === 0x0a)) result[result.length - 1] += character
    else result.push(character)
    regionalCount = regional ? regionalCount + 1 : 0
    previous = point
  }
  return result
}

/** Real provider words always win; estimates exist only in the display projection. */
export function estimatedLyricWords(line: LyricLine, end: number): LyricWord[] {
  if (line.words.length) return line.words
  const units = lyricGraphemes(line.text)
  if (!units.length) return []
  const weights = units.map(text => /[\p{L}\p{N}\p{S}]/u.test(text) ? 1 : 0)
  const count = weights.reduce<number>((total, weight) => total + weight, 0)
  const duration = estimatedSingingDuration(end - line.start, count)
  let elapsed = 0
  return units.map((text, index) => {
    const start = line.start + Math.floor(duration * elapsed / Math.max(1, count))
    elapsed += weights[index]
    return { text, start, end: line.start + Math.floor(duration * elapsed / Math.max(1, count)) }
  })
}

/** Plain LRC cannot locate actual vocal pauses; do not stretch a short line across an obvious interlude/outro. */
export function estimatedSingingDuration(available: number, vocalUnits: number): number {
  const duration = available > 0 ? available : 3000
  return duration > Math.max(6000, vocalUnits * 700)
    ? Math.min(duration, Math.min(10000, Math.max(1800, vocalUnits * 420))) : duration
}

export function lyricDisplayEnd(lines: LyricLine[], index: number, duration = 0): number {
  const line = lines[index]
  if (line.words.length && line.end > line.start) return line.end
  const next = lines[index + 1]?.start
  if (next !== undefined && next > line.start) return next
  if (index === lines.length - 1 && duration > line.start) return duration
  return line.end > line.start ? line.end : line.start + 3000
}

export function lyricDisplayLines(lines: LyricLine[], estimate: boolean, duration = 0): LyricLine[] {
  if (!estimate) return lines
  return lines.map((line, index) => {
    if (line.words.length || !line.text) return line
    const end = lyricDisplayEnd(lines, index, duration)
    return { ...line, end, words: estimatedLyricWords(line, end) }
  })
}

export function lyricSeekPosition(line: LyricLine, offsetMs: number, duration = 0, loop?: LyricPlaybackAnchor['loop']): number {
  const target = Math.max(0, line.start + offsetMs)
  const bounded = duration > 0 ? Math.min(duration, target) : target
  if (loop?.enabled && loop.startMs >= 0 && loop.endMs - loop.startMs >= 500 && (!duration || loop.endMs <= duration)) {
    return Math.max(loop.startMs, Math.min(loop.endMs - 1, bounded))
  }
  return bounded
}

/** Remaining scroll distance after a nested container consumes its available range. */
export function boundaryScrollRemainder(scrollTop: number, clientHeight: number, scrollHeight: number, delta: number): number {
  const maximum = Math.max(0, scrollHeight - clientHeight)
  const top = Math.max(0, Math.min(maximum, scrollTop))
  const available = delta >= 0 ? maximum - top : top
  const remainder = Math.max(0, Math.abs(delta) - available)
  if (remainder === 0) return 0
  return delta >= 0 ? remainder : -remainder
}

export interface LyricVisibleBand { top: number; bottom: number }

/** Both rectangles use viewport coordinates, including the complete original/translation row. */
export function lyricVisibleBand(listTop: number, listBottom: number, viewportTop: number, viewportBottom: number): LyricVisibleBand {
  const top = Math.max(listTop, viewportTop)
  const bottom = Math.min(listBottom, viewportBottom)
  return bottom > top ? { top, bottom } : { top: listTop, bottom: listBottom }
}

export function lyricCenteredScrollTop(scrollTop: number, rowTop: number, rowBottom: number, band: LyricVisibleBand): number {
  return Math.max(0, scrollTop + (rowTop + rowBottom - band.top - band.bottom) / 2)
}
