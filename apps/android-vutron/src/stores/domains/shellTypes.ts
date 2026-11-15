import type { VutronLocalCollection, VutronPlaylist, VutronTrack } from '../../platform/vutronPlugin'

/** All tabs the app shell can show. */
export type ShellTab =
  | 'home' | 'library' | 'search' | 'entity' | 'localCollection'
  | 'player' | 'settings' | 'about' | 'plugins'

/** An artist or album the user has drilled into. */
export type ShellEntity = {
  category: 'albums' | 'artists'
  id: number
  name: string
  picUrl?: string
}

/** One entry saved in the back-stack. */
export interface NavigationEntry {
  tab: ShellTab
  pluginId?: string
  musicSourceId?: string
  playlist?: VutronPlaylist
  entity?: ShellEntity
  localCollection?: VutronLocalCollection
  tracks: VutronTrack[]
  scrollY: number
}
