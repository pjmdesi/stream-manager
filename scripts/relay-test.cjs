#!/usr/bin/env node
/**
 * Phase 0 standalone RTMP relay test.
 *
 * Spawns ffmpeg as a one-shot RTMP server on localhost:1935 that forwards an
 * incoming stream to YouTube's ingest. No Stream Manager / Electron context
 * needed — just `npm run relay:test -- --key <YT_STREAM_KEY>`.
 *
 * Configure Aitum (or any RTMP-capable source):
 *   Server:     rtmp://localhost:1935/sm
 *   Stream Key: live
 *
 * Then start streaming from OBS → watch it land on your YouTube test channel.
 *
 * Defaults:
 *   --port    1935
 *   --key     (required — YouTube stream key for the broadcast you're testing)
 *   --host    a.rtmp.youtube.com         (YouTube primary RTMP ingest)
 *   --inkey   live                       (the key Aitum sends; must match)
 *   --restart true                       (auto-restart ffmpeg after each stream)
 */
const { spawn } = require('child_process')
const path = require('path')

// ─── Args ────────────────────────────────────────────────────────────────────
const argv = process.argv.slice(2)
const flag = (name, dflt) => {
  const i = argv.indexOf(`--${name}`)
  return i >= 0 && argv[i + 1] ? argv[i + 1] : dflt
}

const PORT = parseInt(flag('port', '1935'), 10)
const YT_KEY = flag('key', null)
const YT_HOST = flag('host', 'a.rtmp.youtube.com')
const IN_KEY = flag('inkey', 'live')
const RESTART = flag('restart', 'true') !== 'false'

if (!YT_KEY) {
  console.error('\n[relay] missing required --key <YouTube stream key>')
  console.error('Usage: npm run relay:test -- --key xxxx-yyyy-zzzz-...')
  process.exit(1)
}

const FFMPEG = require('ffmpeg-static')
if (!FFMPEG) {
  console.error('[relay] ffmpeg-static path not resolved — is the dep installed?')
  process.exit(1)
}

// ─── Stats parsing ───────────────────────────────────────────────────────────
// ffmpeg streams its own progress line on stderr in the form:
//   frame=1234 fps=60 q=-1 size=12345kB time=00:02:34 bitrate=7500kb/s speed=1.0x
// We grep just enough to surface live throughput.
const PROGRESS_RE = /time=(\S+)\s+bitrate=(\S+).*speed=(\S+)/
let lastProgressAt = 0

// ─── ffmpeg child ────────────────────────────────────────────────────────────
function buildArgs() {
  // -listen 1 turns ffmpeg into a one-shot RTMP server. It accepts a single
  // incoming connection on the input URL, then exits when that connection
  // closes. -c copy means no re-encode — bytes flow through with minimal CPU.
  return [
    '-hide_banner',
    '-loglevel', 'info',
    // Input: RTMP server mode
    '-listen', '1',
    '-f', 'flv',
    '-i', `rtmp://0.0.0.0:${PORT}/sm/${IN_KEY}`,
    // Output: passthrough to YouTube
    '-c', 'copy',
    '-f', 'flv',
    `rtmp://${YT_HOST}/live2/${YT_KEY}`,
  ]
}

let stoppedByUser = false
let attempt = 0

function spawnRelay() {
  attempt += 1
  const args = buildArgs()
  console.log(`\n[relay] starting ffmpeg (attempt ${attempt})`)
  console.log(`[relay] listening on rtmp://localhost:${PORT}/sm/${IN_KEY}`)
  console.log(`[relay] forwarding to rtmp://${YT_HOST}/live2/****\n`)

  const child = spawn(FFMPEG, args, { stdio: ['ignore', 'inherit', 'pipe'] })

  child.stderr.on('data', (chunk) => {
    const text = chunk.toString()
    // Throttle the noisy frame= progress lines to one log per ~3s
    const m = text.match(PROGRESS_RE)
    if (m) {
      const now = Date.now()
      if (now - lastProgressAt < 3000) return
      lastProgressAt = now
      console.log(`[relay] streaming · time=${m[1]} · ${m[2]} · speed=${m[3]}`)
      return
    }
    // Everything else (handshake, warnings, errors) passes through
    process.stderr.write(text)
  })

  child.on('exit', (code, signal) => {
    console.log(`\n[relay] ffmpeg exited (code=${code}, signal=${signal})`)
    if (stoppedByUser) return
    if (!RESTART) return
    // Brief debounce before respawn to avoid tight loop if YT is rejecting us
    setTimeout(spawnRelay, 1500)
  })

  // ─── Signal forwarding ─────────────────────────────────────────────────────
  // Ctrl+C / kill on this process → stop ffmpeg cleanly
  const stop = () => {
    if (stoppedByUser) return
    stoppedByUser = true
    console.log('\n[relay] stopping…')
    child.kill('SIGTERM')
    setTimeout(() => { try { child.kill('SIGKILL') } catch {} }, 3000).unref()
  }
  process.once('SIGINT', stop)
  process.once('SIGTERM', stop)
}

spawnRelay()
