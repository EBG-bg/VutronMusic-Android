import { translate as t } from './i18n'
import { Capacitor } from '@capacitor/core'
import { artworkRequestUrl } from '@vutronmusic/core/artwork'
import { vutronPlugin } from './vutronPlugin'
import { localOnlyMode, isRemoteMusicUri } from './localOnlyMode'

const pending = new Map<string, Promise<string>>()

export function displayArtworkUri(uri: string): string {
  if (localOnlyMode.value && isRemoteMusicUri(uri)) return ''
  if (uri.startsWith('file://') || uri.startsWith('content://') || uri.startsWith('/')) return Capacitor.convertFileSrc(uri)
  return artworkRequestUrl(uri) || uri
}

export function fetchArtwork(source: string, size = 512, cachedUri = ''): Promise<string> {
  const url = artworkRequestUrl(source, size)
  const localUri = /^(file:|content:|\/)/.test(cachedUri) ? cachedUri : /^(file:|content:|\/)/.test(source) ? source : ''
  if ((!url && !localUri) || !Capacitor.isNativePlatform() || !vutronPlugin.getArtwork) return Promise.resolve(localUri ? displayArtworkUri(localUri) : url ? localOnlyMode.value ? '' : url : displayArtworkUri(source))
  if (!url && size >= 512) return Promise.resolve(displayArtworkUri(localUri))
  const key = JSON.stringify([url, localUri, size])
  const existing = pending.get(key)
  if (existing) return existing
  const request = vutronPlugin.getArtwork({ url, size, ...(localUri ? { localUri } : {}) }).then(result => {
    if (!result.uri) throw new Error(t('mobile.runtimeText.artworkPathEmpty'))
    return displayArtworkUri(result.uri)
  }).finally(() => { pending.delete(key) })
  pending.set(key, request)
  return request
}
