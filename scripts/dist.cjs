// Final step of `npm run dist`: invokes electron-builder. When building
// from any branch other than master, the artifact name gets a "_DEV"
// marker (so test builds can't be mistaken for release exes) and the app
// icon is swapped for the dev variant — both the exe icon (win.icon) and
// the icon.png shipped via extraResources, which the main process uses
// for the window/taskbar icon at runtime.
const { execSync, spawnSync } = require('node:child_process')
const fs = require('node:fs')
const os = require('node:os')
const path = require('node:path')

let branch = ''
try {
  branch = execSync('git rev-parse --abbrev-ref HEAD', { encoding: 'utf8' }).trim()
} catch {
  // Not a git checkout (e.g. building from a source archive) — release naming.
}

const isDevBuild = branch !== '' && branch !== 'master'

let cmd = 'npx electron-builder'
if (isDevBuild) {
  console.log(`[dist] building from branch "${branch}" - _DEV artifact name + dev icon`)
  // electron-builder's CLI can't override an array entry (extraResources)
  // via -c flags, so build a full dev config instead: clone the "build"
  // section from package.json and apply the dev overrides on top. An
  // explicit --config file replaces the package.json config entirely,
  // which is why the clone starts from the real thing (no drift).
  const config = structuredClone(require('../package.json').build)
  config.artifactName = '${productName} ${version}_DEV.${ext}'
  config.win.icon = 'resources/icon-dev.png'
  // dev-branch.txt tells the packaged app which branch it was built from,
  // so the sidebar's branch badge works in _DEV exes (release builds don't
  // ship the marker, so the badge stays impossible there).
  const branchMarkerPath = path.join(os.tmpdir(), 'stream-manager-dev-branch.txt')
  fs.writeFileSync(branchMarkerPath, branch)
  config.extraResources = [
    { from: 'resources/icon-dev.png', to: 'icon.png' },
    { from: branchMarkerPath, to: 'dev-branch.txt' },
  ]
  const cfgPath = path.join(os.tmpdir(), 'stream-manager-electron-builder-dev.json')
  fs.writeFileSync(cfgPath, JSON.stringify(config, null, 2))
  cmd = `npx electron-builder --config "${cfgPath}"`
}
const result = spawnSync(cmd, { stdio: 'inherit', shell: true })
process.exit(result.status ?? 1)
