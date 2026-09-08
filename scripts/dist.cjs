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

// CI (GitHub Actions) checks out a detached HEAD, where rev-parse reports
// the literal name "HEAD" — which reads as "not master" and would mis-mark
// tag-triggered release builds as _DEV (with a dev-branch.txt saying
// "HEAD"). Actions supplies the real ref instead:
//   GITHUB_REF_TYPE 'tag'    → a release build cut from a version tag:
//                              clean naming, no dev markers.
//   GITHUB_REF_TYPE 'branch' → substitute GITHUB_REF_NAME as the branch,
//                              so a workflow_dispatch run keeps the same
//                              semantics as a local build of that branch
//                              (master = release naming, anything else =
//                              _DEV with the right branch badge).
// A LOCAL detached checkout (no Actions env) keeps the old behavior:
// "HEAD" is not master, so it builds as _DEV — the safe direction.
const isTagBuild = process.env.GITHUB_REF_TYPE === 'tag'
if (branch === 'HEAD' && process.env.GITHUB_REF_TYPE === 'branch' && process.env.GITHUB_REF_NAME) {
  branch = process.env.GITHUB_REF_NAME
}

const isDevBuild = !isTagBuild && branch !== '' && branch !== 'master'

// ── Portable launcher pre-check (APP-32) ──────────────────────────────────
// electron-builder's portable target reads its NSIS launcher script from a
// fixed template inside app-builder-lib and ignores the `script`/`include`
// options, so the only way to change the launcher is to patch that template
// before electron-builder runs. Why: the stock launcher deletes and
// re-extracts the whole unpack folder on EVERY launch and deletes it again
// when its app instance exits. The unpack folder is fixed per build, so a
// second launch while SM is already running (double-clicking the exe with
// SM in the tray) spent ~10 s re-extracting, hit the single-instance lock,
// exited, and its launcher then deleted the running instance's unlocked
// files (ffprobe went missing mid-session). The injected block runs before
// the launcher's first delete: if this build's unpacked exe is already
// running (a running executable refuses a write-mode open), hand the launch
// to it (its single-instance lock focuses the primary window, measured at
// 0.09 s) and quit the launcher before it touches the folder.
// Idempotent (marker comment). Fails the build loudly if the anchor lines
// are missing, so an app-builder-lib bump that reshapes the template is
// noticed instead of silently shipping an unpatched launcher. CI runs this
// too: `npm ci` restores the pristine template and this re-patches it.
// A local node_modules stays patched between builds, which is harmless.
function patchPortableLauncher() {
  const templatePath = path.join(__dirname, '..', 'node_modules', 'app-builder-lib', 'templates', 'nsis', 'portable.nsi')
  const marker = '; --- stream-manager launcher pre-check (APP-32) ---'
  let src
  try {
    src = fs.readFileSync(templatePath, 'utf8')
  } catch (err) {
    console.error(`[dist] cannot read the portable launcher template at ${templatePath}: ${err.message}`)
    process.exit(1)
  }
  const endMarker = '; --- end stream-manager launcher pre-check ---'
  const eol = src.includes('\r\n') ? '\r\n' : '\n'
  if (src.includes(marker)) {
    // Already patched (local node_modules persists between builds): strip
    // the old block so the version in THIS script is what ships, then
    // re-inject below.
    const start = src.indexOf(marker)
    const lineStart = src.lastIndexOf(eol, start) + eol.length
    const endIdx = src.indexOf(endMarker, start)
    if (endIdx < 0) {
      console.error('[dist] portable launcher template has a pre-check start marker but no end marker; restore node_modules/app-builder-lib/templates/nsis/portable.nsi (npm ci) and rebuild.')
      process.exit(1)
    }
    const lineEnd = src.indexOf(eol, endIdx) + eol.length
    src = src.slice(0, lineStart) + src.slice(lineEnd)
  }
  const anchor = new RegExp(`^([ \\t]*)RMDir /r \\$INSTDIR\\r?\\n[ \\t]*SetOutPath \\$INSTDIR\\r?\\n`, 'm')
  const m = anchor.exec(src)
  if (!m) {
    console.error('[dist] portable launcher template changed: the "RMDir /r $INSTDIR" / "SetOutPath $INSTDIR" anchor was not found. Review node_modules/app-builder-lib/templates/nsis/portable.nsi and update patchPortableLauncher() in scripts/dist.cjs (APP-32) before building.')
    process.exit(1)
  }
  const indent = m[1]
  const block = [
    `${indent}${marker}`,
    `${indent}; If this build's unpacked exe is already running, hand the launch to it`,
    `${indent}; (its single-instance lock focuses the primary window) and quit before`,
    `${indent}; touching the shared unpack folder: no re-extract, no delete-on-exit.`,
    `${indent}; A running executable refuses a write-mode open (sharing violation).`,
    `${indent}IfFileExists "$INSTDIR\\\${APP_EXECUTABLE_FILENAME}" 0 sm_not_running`,
    `${indent}ClearErrors`,
    `${indent}FileOpen $1 "$INSTDIR\\\${APP_EXECUTABLE_FILENAME}" a`,
    `${indent}IfErrors sm_running`,
    `${indent}FileClose $1`,
    `${indent}Goto sm_not_running`,
    `sm_running:`,
    `${indent}\${StdUtils.GetAllParameters} $R0 0`,
    `${indent}Exec '"$INSTDIR\\\${APP_EXECUTABLE_FILENAME}" $R0'`,
    `${indent}SetErrorLevel 0`,
    `${indent}Quit`,
    `sm_not_running:`,
    `${indent}${endMarker}`,
    '',
  ].join(eol)
  const patched = src.slice(0, m.index) + block + src.slice(m.index)
  fs.writeFileSync(templatePath, patched)
  console.log('[dist] portable launcher pre-check injected into app-builder-lib portable.nsi')
}
patchPortableLauncher()

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
