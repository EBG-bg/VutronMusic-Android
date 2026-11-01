import type { CapacitorConfig } from '@capacitor/cli'
import { mobileBuild } from './build-config'

const config: CapacitorConfig = {
  appId: 'io.github.vutronmusic.personal.webshell',
  appName: mobileBuild.displayName,
  webDir: 'dist',
  android: {
    backgroundColor: '#ffffff',
    // Let Capacitor consume system bar / cutout insets on Android 15+.
    // Older Android versions retain their existing, non-edge-to-edge layout.
    adjustMarginsForEdgeToEdge: 'auto'
  }
}

export default config
