// Replaces the Windows ffmpeg binary that `ffmpeg-static` installs with
// gyan.dev's FULL build of the same version. Runs from `postinstall`.
//
// Why: ffmpeg-static ships gyan's "essentials" build on Windows, which has
// no SVT-AV1. The Archive (AV1) preset names libsvtav1, so without this the
// preset cannot run as written on any machine, and on GPUs with an AV1
// encoder it was silently swapped for the hardware encoder at a quality
// setting meant for the software one (v2.7.0 and earlier; fixed in 2.7.1).
// The full build adds SVT-AV1, dav1d and libvmaf for about 50 MB more exe.
//
// The download is pinned by version and SHA-256, extracted with Windows'
// own tar (bsdtar reads zip), verified again on disk, and skipped when the
// installed binary already matches. Set SM_SKIP_FFMPEG_FETCH=1 to leave
// the essentials build in place for an offline install; `npm run dist`
// refuses to package a binary without libsvtav1, so a skipped fetch cannot
// reach a release.
'use strict'
const fs = require('fs')
const os = require('os')
const path = require('path')
const https = require('https')
const crypto = require('crypto')
const { spawnSync } = require('child_process')

const VERSION = '6.1.1'
const ZIP_NAME = `ffmpeg-${VERSION}-full_build.zip`
const ZIP_URL = `https://github.com/GyanD/codexffmpeg/releases/download/${VERSION}/${ZIP_NAME}`
const ZIP_SHA256 = '3537631e7e6261987ba01053d52198aeb020f29619f7d8e3e453048b7146b442'
const EXE_SHA256 = '2e00e43aeb1929d19763ed3ca1e226b3bc81cb50f6b0b04709f1ee504657e2c5'
const EXE_IN_ZIP = `ffmpeg-${VERSION}-full_build/bin/ffmpeg.exe`
const LICENSE_IN_ZIP = `ffmpeg-${VERSION}-full_build/LICENSE`
const README_IN_ZIP = `ffmpeg-${VERSION}-full_build/README.txt`

const pkgDir = path.join(__dirname, '..', 'node_modules', 'ffmpeg-static')
const exePath = path.join(pkgDir, 'ffmpeg.exe')
const markerPath = path.join(pkgDir, 'ffmpeg.exe.full-build.json')

function log(msg) { console.log(`[fetch-ffmpeg] ${msg}`) }

function sha256(file) {
  return crypto.createHash('sha256').update(fs.readFileSync(file)).digest('hex')
}

function download(url, dest, redirects = 0) {
  return new Promise((resolve, reject) => {
    if (redirects > 5) return reject(new Error('too many redirects'))
    https.get(url, { headers: { 'User-Agent': 'stream-manager-build' } }, res => {
      if ([301, 302, 303, 307, 308].includes(res.statusCode) && res.headers.location) {
        res.resume()
        return resolve(download(new URL(res.headers.location, url).toString(), dest, redirects + 1))
      }
      if (res.statusCode !== 200) {
        res.resume()
        return reject(new Error(`HTTP ${res.statusCode} for ${url}`))
      }
      const total = Number(res.headers['content-length'] || 0)
      let got = 0, lastPct = -10
      const out = fs.createWriteStream(dest)
      res.on('data', chunk => {
        got += chunk.length
        if (total) {
          const pct = Math.floor((got / total) * 100)
          if (pct >= lastPct + 10) { lastPct = pct; log(`downloading ${ZIP_NAME}: ${pct}%`) }
        }
      })
      res.pipe(out)
      out.on('finish', () => out.close(resolve))
      out.on('error', reject)
      res.on('error', reject)
    }).on('error', reject)
  })
}

function alreadyInstalled() {
  if (!fs.existsSync(exePath) || !fs.existsSync(markerPath)) return false
  try {
    const marker = JSON.parse(fs.readFileSync(markerPath, 'utf8'))
    return marker.version === VERSION && marker.sha256 === EXE_SHA256 && sha256(exePath) === EXE_SHA256
  } catch {
    return false
  }
}

async function main() {
  if (os.platform() !== 'win32') { log('not Windows; keeping the ffmpeg-static binary'); return }
  if (process.env.SM_SKIP_FFMPEG_FETCH) { log('SM_SKIP_FFMPEG_FETCH set; keeping the essentials build (dist will refuse to package it)'); return }
  if (!fs.existsSync(pkgDir)) throw new Error(`ffmpeg-static is not installed at ${pkgDir}`)
  if (alreadyInstalled()) { log(`full build ${VERSION} already in place`); return }

  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'sm-ffmpeg-'))
  const zipPath = path.join(tmp, ZIP_NAME)
  try {
    log(`fetching gyan.dev full build ${VERSION} (about 154 MB)`)
    await download(ZIP_URL, zipPath)
    const zipHash = sha256(zipPath)
    if (zipHash !== ZIP_SHA256) throw new Error(`archive hash mismatch: expected ${ZIP_SHA256}, got ${zipHash}`)

    // Windows ships bsdtar as %SystemRoot%\System32\tar.exe, which extracts
    // zip archives; Git's GNU tar on PATH does not, so use the full path.
    const tar = path.join(process.env.SystemRoot || 'C:\\Windows', 'System32', 'tar.exe')
    const r = spawnSync(tar, ['-xf', zipPath, '-C', tmp, EXE_IN_ZIP, LICENSE_IN_ZIP, README_IN_ZIP], { stdio: 'inherit' })
    if (r.status !== 0) throw new Error(`tar exited with ${r.status}`)

    const extracted = path.join(tmp, EXE_IN_ZIP)
    const exeHash = sha256(extracted)
    if (exeHash !== EXE_SHA256) throw new Error(`ffmpeg.exe hash mismatch: expected ${EXE_SHA256}, got ${exeHash}`)

    // Prove the binary is what we fetched it for before it replaces anything.
    const check = spawnSync(extracted, ['-hide_banner', '-encoders'], { encoding: 'utf8' })
    if (check.status !== 0 || !/libsvtav1/.test(check.stdout)) {
      throw new Error('the downloaded ffmpeg does not list the libsvtav1 encoder')
    }

    fs.copyFileSync(extracted, exePath)
    fs.copyFileSync(path.join(tmp, LICENSE_IN_ZIP), path.join(pkgDir, 'ffmpeg.exe.LICENSE'))
    fs.copyFileSync(path.join(tmp, README_IN_ZIP), path.join(pkgDir, 'ffmpeg.exe.README'))
    fs.writeFileSync(markerPath, JSON.stringify({ version: VERSION, build: 'gyan.dev full', sha256: EXE_SHA256, source: ZIP_URL }, null, 2))
    log(`installed ffmpeg ${VERSION} full build (${(fs.statSync(exePath).size / 1048576).toFixed(1)} MB) with libsvtav1`)
  } finally {
    fs.rmSync(tmp, { recursive: true, force: true })
  }
}

main().catch(err => {
  console.error(`[fetch-ffmpeg] FAILED: ${err.message}`)
  console.error('[fetch-ffmpeg] The Archive (AV1) preset needs this build. Retry with network access, or set SM_SKIP_FFMPEG_FETCH=1 for an offline dev install (packaging will refuse).')
  process.exit(1)
})
