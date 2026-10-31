import type { VutronPlaybackState } from './vutronPlugin'

const failureActions = {
  auth: 'login', local_permission: 'folders', local_missing: 'folders',
  network: 'retry', timeout: 'retry', source_unavailable: 'retry', source_io: 'retry',
  decode: 'retry', player: 'retry', offline: 'offline', seek: 'retry', audio_focus: 'retry', playback: 'retry'
} as const
export function describePlaybackFailure(state: Pick<VutronPlaybackState, 'error' | 'errorCode'>) {
  const known = Object.prototype.hasOwnProperty.call(failureActions, state.errorCode ?? '')
  const code = known ? state.errorCode as keyof typeof failureActions : 'playback'
  return { code, action: failureActions[code], messageKey: `mobile.playbackErrors.${code}`, legacyMessage: !known ? state.error : '' }
}
