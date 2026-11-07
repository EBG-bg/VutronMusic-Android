export type PluginKind = 'local' | 'library' | 'stream'
export type PluginEntityKind = 'tracks' | 'playlists' | 'albums' | 'artists' | 'mvs'
export type PluginContext = Record<string, unknown>
export interface MusicPlugin {
  id: string; name: string; type: PluginKind; enabled: boolean; builtIn: boolean
  baseId?:string;installed?:boolean;icon?:string
  baseUrl?: string; status?: 'login' | 'logout' | 'offline'; accountScope?: string; methods: string[]; unsupportedMethods?: string[]
  capabilities?: { getLyric?: boolean; getComments?: boolean; matchTrack?: 'official' | 'search' | false
    comment?: { read?: boolean; like?: boolean; submit?: boolean; floor?: boolean; types?: string[] }
    mv?: { detail?: boolean; like?: boolean; subscribe?: boolean } }
}
export type MusicPluginCatalog = Omit<MusicPlugin,'enabled'|'builtIn'> & {builtIn:true;installed:boolean;enabled?:boolean}
export interface PluginItem {
  id: string | number; name: string; picUrl?: string; pluginId?: string; sourceContext: PluginContext
  artists?: PluginItem[]; album?: PluginItem; duration?: number; playable?: boolean; reason?: string
  isMine?: boolean; isPrivate?: boolean; subscribed?: boolean; followed?: boolean; description?: string
  tags?: string[]; tracks?: PluginItem[]; trackCount?: number; trackIds?: (string | number)[]
  playlistRole?: 'liked'
  creator?: { userId: string | number; nickname?: string }; [field: string]: unknown
}
export interface PluginComment {
  id: string | number; content: string; time: number; owner: boolean; liked: boolean; likedCount: number; replyCount: number
  user: { id: string | number; nickname: string; avatarUrl: string }; sourceContext: PluginContext
  beReplied?: { id: string | number; content: string; nickname: string } | null
}
export interface PluginResult {
  code: number; message?: string; data?: unknown; count?: number; sourceContext?: PluginContext
  playlists?: PluginItem[]; albums?: PluginItem[]; liked?: PluginItem | null; songs?: PluginItem[]
  artist?: PluginItem; status?: string; [field: string]: unknown
}
export interface PluginPlayback { pluginId: string; track: PluginItem; queue: PluginItem[]; playlistKey?: string; playlistName?: string; playlistSourceContext?:PluginContext; accountScope?: string; sourceMethod?: string;position?:number;resumePlaylist?:boolean }
export interface PluginPlaylistProgress {available:boolean;trackId?:string;sourcePluginId?:string;position?:number}
export interface PluginSourceCandidate { pluginId:string; accountScope?:string; trackId:string|number; sourceContext:PluginContext; matched?:number }
export interface PluginSourcePriorities { lyric:string[]; comment:string[] }

// Context is transported unchanged. It is never used to infer provider identity,
// authorization or pagination fields owned by an individual plugin.
export function pluginParams(context: PluginContext = {}, fields: PluginContext = {}): PluginContext {
  return { ...context, ...fields, sourceContext: context }
}
export function pluginItems(value: unknown): PluginItem[] { return Array.isArray(value) ? value as PluginItem[] : [] }
export function pluginItemKey(item: PluginItem): string { return JSON.stringify([item.pluginId || '', String(item.id)]) }
export function mergePluginItems(previous: PluginItem[], next: PluginItem[]): PluginItem[] {
  const seen = new Set(previous.map(pluginItemKey))
  return [...previous, ...next.filter(row => !seen.has(pluginItemKey(row)) && Boolean(seen.add(pluginItemKey(row))))]
}
export function declaresPluginMethod(plugin: MusicPlugin | undefined, method: string): boolean {
  return Boolean(plugin?.methods.includes(method) && !plugin.unsupportedMethods?.includes(method))
}
export function hasPluginMethod(plugin: MusicPlugin | undefined, method: string): boolean {
  return Boolean(plugin?.enabled && declaresPluginMethod(plugin,method))
}
export function allowsPluginComments(plugin: MusicPlugin | undefined, type: string): boolean {
  const caps = plugin?.capabilities
  return Boolean(hasPluginMethod(plugin,'getComments') && (caps?.comment?.read ?? caps?.getComments)
    && (!caps?.comment?.types || caps.comment.types.includes(type)))
}
export function pluginSubscriptionParams(method: string, item: PluginItem, selected: boolean): PluginContext {
  const fields: PluginContext = {id:item.id}
  if (method === 'followArtist') fields.op = selected ? 'unfollow' : 'follow'
  else if (method === 'likeAMV' || method === 'subAMV') fields.t = selected ? 0 : 1
  else fields.op = selected ? 'del' : 'add'
  return pluginParams(item.sourceContext, fields)
}
export const pluginFeatures: { method: string; kind: PluginEntityKind; label: string }[] = [
  {method:'getRecommendPlaylist',kind:'playlists',label:'recommendedPlaylists'},
  {method:'getRecommendTracks',kind:'tracks',label:'recommendedTracks'},
  {method:'userPlaylist',kind:'playlists',label:'myPlaylists'},
  {method:'getAllTracks',kind:'tracks',label:'allTracks'},
  {method:'likelist',kind:'tracks',label:'likedTracks'},
  {method:'userLikedArtists',kind:'artists',label:'likedArtists'},
  {method:'userLikedMVs',kind:'mvs',label:'likedMvs'},
  {method:'cloudDisk',kind:'tracks',label:'cloudDisk'},
  {method:'userRecord',kind:'tracks',label:'recent'},
  {method:'personalFM',kind:'tracks',label:'personalFm'},
  {method:'rankList',kind:'playlists',label:'charts'},
  {method:'topSong',kind:'tracks',label:'newTracks'},
  {method:'topArtists',kind:'artists',label:'topArtists'},
  {method:'topAlbums',kind:'albums',label:'topAlbums'},
  {method:'newAlbums',kind:'albums',label:'newAlbums'}
]
