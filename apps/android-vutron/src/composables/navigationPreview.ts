import type { InjectionKey } from 'vue'

export type LibraryMode = 'playlists' | 'local' | 'offline'
export type HomeShelfPositions = Map<string, { left: number; previewCount: number }>
export const navigationPreviewKey: InjectionKey<boolean> = Symbol('navigation-preview')
