const { defineConfig } = require('@playwright/test')
const path = require('node:path')

if (process.platform !== 'win32') throw new Error('The reviewed visual baselines use Windows. Run this check on Windows or the configured windows-2025 CI runner.')
const artifacts = path.resolve(__dirname, '../../_analysis', process.env.VUTRON_VISUAL_PROBE === '1' ? 'visual-regression-probe' : 'visual-regression')

const scenes = [
  ['phone', 360, 800, 'light', 'zh', 100, 'full'],
  ['dark', 390, 844, 'dark', 'zh', 100, 'full'],
  ['narrow-en', 320, 720, 'light', 'en', 150, 'full'],
  ['dark-zht', 360, 800, 'dark', 'zht', 150, 'full'],
  ['narrow', 320, 720, 'dark', 'zh', 100, 'reduced'],
  ['large', 390, 844, 'light', 'zh', 150, 'system'],
  ['tablet-en', 1024, 768, 'light', 'en', 150, 'full'],
  ['tablet-zht', 1280, 800, 'dark', 'zht', 100, 'system']
]

module.exports = defineConfig({
  testDir: './tests/visual',
  testMatch: 'screens.spec.cjs',
  timeout: 30000,
  expect: { timeout: 10000, toHaveScreenshot: { threshold: 0.15, maxDiffPixelRatio: 0.001, animations: 'allow' } },
  workers: 1,
  retries: 0,
  updateSnapshots: 'none',
  forbidOnly: Boolean(process.env.CI),
  outputDir: path.join(artifacts, 'results'),
  reporter: [['list'], ['html', { outputFolder: path.join(artifacts, 'report'), open: 'never' }]],
  snapshotPathTemplate: '{testDir}/baselines/{projectName}/{arg}{ext}',
  use: {
    baseURL: 'http://127.0.0.1:4179',
    browserName: 'chromium',
    deviceScaleFactor: 1,
    isMobile: true,
    hasTouch: true,
    locale: 'en-US',
    timezoneId: 'UTC',
    launchOptions: { args: ['--force-color-profile=srgb', '--font-render-hinting=none'] },
    trace: 'retain-on-failure'
  },
  projects: scenes.map(([name, width, height, theme, language, fontScale, motion]) => ({
    name,
    metadata: { theme, language, fontScale, motion },
    use: { viewport: { width, height }, colorScheme: theme, reducedMotion: name === 'large' ? 'reduce' : 'no-preference' }
  })),
  webServer: { command: 'node tests/visual/server.cjs', url: 'http://127.0.0.1:4179/tests/visual/app.html', reuseExistingServer: false, timeout: 30000 }
})
