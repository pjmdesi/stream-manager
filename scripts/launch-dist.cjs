// Launch the newest packaged exe in dist/ (the portable build that
// `npm run dist` just produced). `npm run dist:run` chains the two.
//
//   node scripts/launch-dist.cjs           launch it, detached
//   node scripts/launch-dist.cjs --print   only print which exe would launch
//
// ELECTRON_RUN_AS_NODE is dropped from the child's environment: shells
// started by an agent carry it, and with it set the exe boots as plain Node
// and dies at the first app call (see electron-run-as-node in the notes).
const fs = require('fs')
const path = require('path')
const { spawn } = require('child_process')

const distDir = path.join(__dirname, '..', 'dist')
let newest = null
try {
  for (const name of fs.readdirSync(distDir)) {
    if (!name.toLowerCase().endsWith('.exe')) continue
    const full = path.join(distDir, name)
    const stat = fs.statSync(full)
    if (!stat.isFile()) continue
    if (!newest || stat.mtimeMs > newest.mtimeMs) newest = { full, mtimeMs: stat.mtimeMs }
  }
} catch (err) {
  console.error(`Could not read ${distDir}: ${err.message}`)
  process.exit(1)
}
if (!newest) {
  console.error(`No packaged exe in ${distDir}. Run \`npm run dist\` first.`)
  process.exit(1)
}

console.log(newest.full)
if (process.argv.includes('--print')) process.exit(0)

const env = { ...process.env }
delete env.ELECTRON_RUN_AS_NODE
const child = spawn(newest.full, [], { detached: true, stdio: 'ignore', env, windowsHide: false })
child.on('error', err => { console.error(`Launch failed: ${err.message}`); process.exit(1) })
child.unref()
