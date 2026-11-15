export function artworkUrl(value: any): string {
  if (!value) return ''
  const direct = [value.coverImgUrl, value.picUrl, value.cover]
  for (const candidate of direct) if (isHttpUrl(candidate)) return candidate.trim()
  for (const album of [value.al, value.album]) {
    for (const candidate of [album?.picUrl, album?.coverImgUrl, album?.cover]) {
      if (isHttpUrl(candidate)) return candidate.trim()
    }
  }
  return isHttpUrl(value.albumPicUrl) ? value.albumPicUrl.trim() : ''
}

export function isHttpUrl(value: unknown): value is string {
  if (typeof value !== 'string' || !value.trim()) return false
  try {
    const parsed = new URL(value)
    return parsed.protocol === 'http:' || parsed.protocol === 'https:'
  } catch {
    return false
  }
}

export function artworkPixelEdge(cssWidth: number, density = 1): number {
  const width = Number.isFinite(cssWidth) && cssWidth > 0 ? cssWidth : 160
  const scale = Number.isFinite(density) && density > 0 ? Math.max(1, Math.min(4, density)) : 1
  return [96, 192, 320, 512].find(edge => edge >= width * scale) ?? 512
}

export function artworkRequestUrl(source: string, size = 512): string {
  if (!isHttpUrl(source)) return ''
  const url = new URL(source)
  if (url.hostname !== 'music.126.net' && !url.hostname.endsWith('.music.126.net')) return source
  url.protocol = 'https:'
  const edge = [96, 192, 320, 512].includes(size) ? size : 512
  url.searchParams.set('param', `${edge}y${edge}`)
  return url.toString()
}
