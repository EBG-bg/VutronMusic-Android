const fs = require('node:fs')
const path = require('node:path')
const root = path.resolve(__dirname, '..')
const source = path.join(root, 'packages/plugin-runtime-deps/node_modules')
const assets = path.join(root, 'vendor/android-runtime/src/main/assets/sources-runtime')
const runtimeModules = path.join(assets, 'node_modules')
const apiName = '@neteasecloudmusicapienhanced/api'
const sourceApi = path.join(source, apiName)
const targetApi = path.join(runtimeModules, apiName)
const check = process.argv.includes('--check')
const compatibility = require('./runtime-regex-compat.cjs')
const compatibleFiles = []
const excludedDirectories = new Set(['.bin', '.github', '.git', '.vscode', 'test', 'tests', '__tests__', 'fixtures', 'bench', 'benchmark', 'benchmarks', 'example', 'examples', 'docs', 'doc', 'coverage'])
let files = 0, bytes = 0

function include(relative) {
  const parts = relative.split(path.sep)
  if (parts.some(part => excludedDirectories.has(part) || part.startsWith('.'))) return false
  const leaf = parts.at(-1)
  if (/^(?:licen[cs]e|copying|notice|copyright|unlicense)/i.test(leaf)) return true
  if (/\.(?:md|markdown|ts|tsx|map|log|exe|dll|pdb|bat|cmd|ps1|sln|vcxproj)$/i.test(leaf)) return false
  return !/^(?:anonymous_token|xeapi_public_key|cookie(?:s)?(?:\.json)?|session(?:\.json)?)$/i.test(leaf)
}
function copyTree(from, to, relative = '') {
  for (const entry of fs.readdirSync(from, { withFileTypes: true })) {
    const item = relative ? path.join(relative, entry.name) : entry.name
    if (!include(item)) continue
    const src = path.join(from, entry.name), dest = path.join(to, entry.name)
    if (entry.isSymbolicLink()) throw new Error('Unexpected package symlink: ' + item)
    if (entry.isDirectory()) {
      // The HTTP server UI is not used; plugin requests call API exports directly.
      if (from === sourceApi && entry.name === 'public') continue
      copyTree(src, dest, item)
    } else if (entry.isFile()) {
      const original = fs.readFileSync(src)
      const converted = /\.[cm]?js$/.test(entry.name) ? compatibility.transform(original.toString('utf8'), item) : null
      const contents = converted ? Buffer.from(converted.code) : original
      if (converted) compatibility.record(compatibleFiles, path.relative(assets, dest), original, converted)
      if (check) {
        if (!fs.existsSync(dest) || !contents.equals(fs.readFileSync(dest))) throw new Error('Vendored runtime dependency differs: ' + dest)
      } else {
        fs.mkdirSync(path.dirname(dest), { recursive: true })
        if (!fs.existsSync(dest) || !contents.equals(fs.readFileSync(dest))) fs.writeFileSync(dest, contents)
      }
      files++; bytes += contents.length
    }
  }
  if (fs.existsSync(path.join(from, 'package.json'))) {
    const names = fs.readdirSync(from)
    if (!names.some(name => /^(?:licen[cs]e|copying|notice|unlicense)/i.test(name))) {
      const readme = names.find(name => /^readme(?:\.md)?$/i.test(name))
      const text = readme ? fs.readFileSync(path.join(from, readme), 'utf8') : ''
      const grant = text.match(/\(The MIT License\)[\s\S]*?SOFTWARE\./)
      if (grant) {
        const contents = Buffer.from('License text retained verbatim from ' + readme + ' in the same npm package.\n\n' + grant[0] + '\n')
        const destination = path.join(to, 'LICENSE-from-README.txt')
        if (check) {
          if (!fs.existsSync(destination) || !contents.equals(fs.readFileSync(destination))) throw new Error('Retained README license differs: ' + destination)
        } else { fs.mkdirSync(to, { recursive: true }); fs.writeFileSync(destination, contents) }
        files++; bytes += contents.length
      }
    }
  }
}
const packageManifest = JSON.parse(fs.readFileSync(path.join(sourceApi, 'package.json'), 'utf8'))
if (packageManifest.version !== '4.36.1') throw new Error('Install the locked plugin runtime dependencies first')
copyTree(sourceApi, targetApi)
const dependencies = []
for (const entry of fs.readdirSync(source, { withFileTypes: true })) {
  if (!entry.isDirectory() || entry.name.startsWith('.')) continue
  if (entry.name.startsWith('@')) {
    for (const child of fs.readdirSync(path.join(source, entry.name), { withFileTypes: true })) if (child.isDirectory()) dependencies.push(entry.name + '/' + child.name)
  } else dependencies.push(entry.name)
}
// Keep the established matcher and its patched selection path in one place.
const omitted = new Set([apiName, '@unblockneteasemusic/server', '@tokenizer/token', 'gzip', 'https'])
for (const name of dependencies) if (!omitted.has(name)) copyTree(path.join(source, name), path.join(targetApi, 'node_modules', name))

const lockPath = path.join(assets, 'dependency-lock.json')
const lock = JSON.parse(fs.readFileSync(lockPath, 'utf8'))
const inputLock = JSON.parse(fs.readFileSync(path.join(root, 'packages/plugin-runtime-deps/package-lock.json'), 'utf8'))
lock.packages[''].dependencies[apiName] = '4.36.1'
for (const [key, value] of Object.entries(inputLock.packages)) {
  if (!key) continue
  if (key === 'node_modules/' + apiName) lock.packages[key] = value
  else if (![...omitted].some(name => key === 'node_modules/' + name || key.startsWith('node_modules/' + name + '/'))) lock.packages['node_modules/' + apiName + '/' + key] = value
}
for (const name of ['@tokenizer/token', 'gzip', 'https']) delete lock.packages['node_modules/' + apiName + '/node_modules/' + name]
if (!check) fs.writeFileSync(lockPath, JSON.stringify(lock, null, 2) + '\n')
compatibility.manifest(assets, 'dependencies', compatibleFiles, check)
console.log(JSON.stringify({ api: apiName, version: packageManifest.version, runtimeFiles: files, runtimeBytes: bytes, isolatedDependencyPackages: dependencies.length - omitted.size, keptExistingMatcher: true }))
