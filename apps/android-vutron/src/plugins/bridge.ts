import { registerPlugin } from '@capacitor/core'
import type { MusicPlugin,MusicPluginCatalog, PluginContext, PluginResult, PluginPlayback, PluginSourceCandidate,PluginPlaylistProgress } from './protocol'

export interface MusicPluginBridge {
  listMusicPlugins(): Promise<{ plugins: MusicPlugin[];catalog?:MusicPluginCatalog[] }>
  importMusicPlugin(): Promise<{ cancelled?: boolean; plugin?: MusicPlugin; plugins?: MusicPlugin[];catalog?:MusicPluginCatalog[] }>
  manageMusicPlugin(options: { action: 'install' | 'enable' | 'disable' | 'reset' | 'remove' | 'instance' | 'logs' | 'configure' | 'sourceLink' | 'sourcePriorities' | 'setSourcePriorities' | 'sourceCandidates'; id?: string; name?: string; enabled?: boolean; baseUrl?: string; fromPluginId?:string; fromTrack?:PluginPlayback['track']; fromAccountScope?:string; toPluginId?:string; toTrack?:PluginPlayback['track']; toAccountScope?:string; matched?:number; lyric?:string[];comment?:string[];pluginId?:string;accountScope?:string;track?:PluginPlayback['track'];kind?:'lyric'|'comment' }): Promise<{ plugin?: MusicPlugin; plugins?: MusicPlugin[];catalog?:MusicPluginCatalog[]; logs?: string[] | string; candidates?:PluginSourceCandidate[];lyric?:string[];comment?:string[]; [key: string]: unknown }>
  callMusicPlugin(options: { pluginId: string; accountScope?:string;method: string; params: PluginContext }): Promise<PluginResult>
  renderMusicPluginQr?(options: { url: string }): Promise<{ imageData: string }>
  resolveMusicPluginArtwork?(options: { pluginId: string; uri: string; sourceContext: PluginContext }): Promise<{ uri: string }>
  resolveMusicPluginMedia?(options: { pluginId: string; uri: string; sourceContext: PluginContext }): Promise<{ uri: string }>
  playMusicPlugin?(options: PluginPlayback & {index?: number; position?: number}): Promise<void>
  getMusicPluginPlaylistProgress?(options:{pluginId:string;accountScope?:string;playlistKey:string}):Promise<PluginPlaylistProgress>
  queueMusicPlugin?(options: {pluginId: string; accountScope?:string;track: PluginPlayback['track']; action: 'next' | 'append'}): Promise<unknown>
}
export const musicPluginBridge = registerPlugin<MusicPluginBridge>('VutronMusic')
