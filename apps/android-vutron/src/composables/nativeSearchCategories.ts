import type { VutronSearchCategory } from '../platform/vutronPlugin'

export const nativeSearchCategories = ['tracks', 'albums', 'artists', 'playlists', 'mvs'] as const

export const nativeSearchCategoryLabel: Record<VutronSearchCategory, string> = {
  tracks: 'nav.track', albums: 'nav.album', artists: 'nav.artist', playlists: 'nav.playlist', mvs: 'mobile.shellUi.categoryMvs',
}
