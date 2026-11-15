// Self-contained navigation checks for local runs and CI. All native/account data is synthetic.
const path = require('node:path')
const { spawn } = require('node:child_process')
const { chromium } = require('@playwright/test')

async function main() {
  const app = path.resolve(__dirname, '..')
  const artifacts = path.resolve(process.env.VUTRON_TEST_ARTIFACTS || path.join(app, '../../_analysis/visual-regression/navigation-regressions'))
  const port = Number(process.env.VUTRON_NAVIGATION_TEST_PORT || 5191)
  if (!Number.isInteger(port) || port < 1 || port > 65535) throw new Error('VUTRON_NAVIGATION_TEST_PORT must be a valid TCP port.')
  const { createServer } = await import('vite')
  const server = await createServer({ root: app,
    optimizeDeps: { entries: ['tests/fixtures/features.html', 'tests/fixtures/windowed-tracks.html'] },
    plugins: [{ name: 'isolated-navigation-native-fixtures', enforce: 'pre', transform(_code, id) {
      if (id.replaceAll('\\', '/').endsWith('/src/platform/vutronPlugin.ts')) return "export { vutronPlugin } from '/tests/fixtures/features-native.mock.js'"
    } }],
    server: { host: '127.0.0.1', port, strictPort: true }, logLevel: 'error' })
  const children = new Set()
  let interrupted = false
  const stopChildren = () => { interrupted = true; for (const child of children) child.kill() }
  process.once('SIGINT', stopChildren)
  process.once('SIGTERM', stopChildren)
  try {
    await server.listen()
    const baseUrl = `http://127.0.0.1:${port}/`
    console.log('Navigation regression fixture: ' + baseUrl)
    for (const [script, output] of [['browser-navigation-feedback.cjs', 'feedback'], ['browser-main-navigation-touch.cjs', 'touch']]) {
      if (interrupted) throw new Error('Navigation checks interrupted.')
      console.log('Running ' + script + ' with pinned Playwright Chromium')
      await new Promise((resolve, reject) => {
        const child = spawn(process.execPath, [path.join(__dirname, script)], { cwd: app, windowsHide: true, stdio: 'inherit',
          env: { ...process.env, VUTRON_TEST_BASE_URL: baseUrl, VUTRON_TEST_ARTIFACTS: path.join(artifacts, output), EDGE_PATH: chromium.executablePath() } })
        children.add(child)
        child.once('error', reject)
        child.once('close', (code, signal) => {
          children.delete(child)
          if (code === 0) resolve()
          else reject(new Error(`${script} failed (${signal || code}).`))
        })
      })
    }
    console.log('PASS: navigation feedback and touch regressions; evidence: ' + artifacts)
  } finally {
    process.removeListener('SIGINT', stopChildren)
    process.removeListener('SIGTERM', stopChildren)
    for (const child of children) child.kill()
    await server.close()
  }
}
main().catch(error => { console.error(error); process.exitCode = 1 })
