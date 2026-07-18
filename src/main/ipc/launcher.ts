import { ipcMain, app, shell, net } from 'electron'
import fs from 'fs'
import path from 'path'
import { getStore } from './store'

interface LauncherApp   { id: string; name: string; path: string }
interface LauncherGroup { id: string; name: string; apps: LauncherApp[] }

// A launch target is a URL (open in the default browser / protocol handler via
// shell.openExternal) when it has a `scheme://` prefix; otherwise it's a file
// path opened with shell.openPath. A Windows drive path ("C:\…") has no `//`
// after the colon, so it never matches.
const isUrl = (p: string): boolean => /^[a-z][a-z\d+.-]*:\/\//i.test(p)
// shell.openPath never rejects — it resolves an error STRING on failure ('' on
// success), so a bare try/catch counted every missing app as launched. Worse,
// a .lnk whose TARGET is gone "opens" successfully as far as openPath is
// concerned, and WINDOWS then pops a blocking "Windows cannot find …" dialog
// that stalls the rest of the group launch until dismissed. So existence is
// validated here, before ShellExecute ever gets a chance to show UI.
const openTarget = async (target: string): Promise<void> => {
  if (isUrl(target)) {
    await shell.openExternal(target)
    return
  }
  let checkPath: string | null = target
  if (target.toLowerCase().endsWith('.lnk')) {
    if (!fs.existsSync(target)) throw new Error('Shortcut file not found')
    try {
      const d = shell.readShortcutLink(target)
      // UWP/Store/Control-Panel shortcuts have no plain file target — nothing
      // to pre-check; let the shell launch the .lnk whole.
      checkPath = d.target || null
    } catch {
      checkPath = null // unreadable shortcut — attempt the launch anyway
    }
  }
  if (checkPath && !fs.existsSync(checkPath)) {
    throw new Error(checkPath === target
      ? 'File not found'
      : `Shortcut target not found: ${checkPath}`)
  }
  const errMsg = await shell.openPath(target)
  if (errMsg) throw new Error(errMsg)
}

// Favicon resolution for website launch items. Cached per origin (favicons
// rarely change within a session) and fetched only from the site itself — no
// third-party favicon service.
const faviconCache = new Map<string, string | null>()
const FAVICON_UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) StreamManager'

// Detect an image by its leading bytes (browsers sniff too). Content-type is
// unreliable here — favicons are routinely served as application/octet-stream
// or other non-image types. Returns the proper MIME for the data URL, or null
// when the bytes aren't a recognizable image.
function sniffImageMime(buf: Buffer): string | null {
  if (buf.length < 4) return null
  if (buf[0] === 0x00 && buf[1] === 0x00 && (buf[2] === 0x01 || buf[2] === 0x02) && buf[3] === 0x00) return 'image/x-icon' // ICO / CUR
  if (buf[0] === 0x89 && buf[1] === 0x50 && buf[2] === 0x4e && buf[3] === 0x47) return 'image/png'
  if (buf[0] === 0x47 && buf[1] === 0x49 && buf[2] === 0x46) return 'image/gif'
  if (buf[0] === 0xff && buf[1] === 0xd8 && buf[2] === 0xff) return 'image/jpeg'
  if (buf[0] === 0x42 && buf[1] === 0x4d) return 'image/bmp'
  if (buf.length >= 12 && buf.toString('ascii', 0, 4) === 'RIFF' && buf.toString('ascii', 8, 12) === 'WEBP') return 'image/webp'
  // SVG is text — sniff the head (skip BOM + leading whitespace).
  const head = buf.toString('utf8', 0, Math.min(buf.length, 256)).replace(/^﻿/, '').trimStart().toLowerCase()
  if (head.startsWith('<svg') || (head.startsWith('<?xml') && head.includes('<svg'))) return 'image/svg+xml'
  return null
}

async function fetchFaviconDataUrl(url: string, timeoutMs = 8000): Promise<string | null> {
  const ctrl = new AbortController()
  const timer = setTimeout(() => ctrl.abort(), timeoutMs)
  try {
    // net.fetch uses Chromium's network stack (browser-equivalent TLS + proxy),
    // so bot-protected hosts that block Node's undici fetch still resolve.
    const res = await net.fetch(url, { signal: ctrl.signal, redirect: 'follow', headers: { 'User-Agent': FAVICON_UA } })
    const ct = (res.headers.get('content-type') ?? '').toLowerCase()
    // Cheap up-front reject for SPA catch-alls that serve their app HTML for
    // /favicon.ico (200 text/html) — avoids downloading a large page body.
    if (!res.ok || ct.includes('html')) { try { ctrl.abort() } catch { /* ignore */ } return null }
    const buf = Buffer.from(await res.arrayBuffer())
    if (buf.length === 0 || buf.length > 512 * 1024) return null
    // Validate by magic bytes, not content-type — many sites serve favicons as
    // application/octet-stream. Use the sniffed MIME for the data URL.
    const mime = sniffImageMime(buf)
    if (!mime) return null
    return `data:${mime};base64,${buf.toString('base64')}`
  } catch {
    return null
  } finally {
    clearTimeout(timer)
  }
}

export function getLauncherGroups(): LauncherGroup[] {
  return (getStore() as any).get('launcherGroups', []) as LauncherGroup[]
}

export interface GroupLaunchResult {
  launched: number
  failed: { id: string; name: string; error: string }[]
}

/** Launch every app/URL in a group. Shared by the renderer IPC handler and
 *  the tray menu's launch items — same semantics from both entry points. */
export async function launchGroupById(groupId: string): Promise<GroupLaunchResult> {
  const group = getLauncherGroups().find(g => g.id === groupId)
  if (!group) return { launched: 0, failed: [] }

  let launched = 0
  const failed: { id: string; name: string; error: string }[] = []
  for (const entry of group.apps) {
    if (!entry.path) continue
    try {
      await openTarget(entry.path)
      launched++
    } catch (err: any) {
      // Keep launching the remaining apps, but report the failure — a
      // "Launched 3" with nothing opened right before going live is the
      // worst possible lie. The id lets the renderer pin the error to the
      // exact app item (error chip + red launch button).
      failed.push({ id: entry.id, name: entry.name || path.basename(entry.path), error: err?.message ?? 'Unknown error' })
    }
  }
  return { launched, failed }
}

export function registerLauncherIPC(): void {
  ipcMain.handle('launcher:getGroups', () => {
    return getLauncherGroups()
  })

  ipcMain.handle('launcher:setGroups', (_event, groups: LauncherGroup[]) => {
    ;(getStore() as any).set('launcherGroups', groups)
  })

  ipcMain.handle('launcher:launchGroup', async (_event, groupId: string) => {
    return launchGroupById(groupId)
  })

  ipcMain.handle('launcher:launchApp', async (_event, filePath: string) => {
    if (!filePath) return { launched: false }
    try {
      await openTarget(filePath)
      return { launched: true }
    } catch (err: any) {
      return { launched: false, error: err?.message ?? 'Unknown error' }
    }
  })

  // Intentionally a pass-through. We keep a .lnk AS the launch target rather
  // than resolving it to its underlying .exe. Launching the shortcut itself
  // (shell.openPath on the .lnk, in launchApp/launchGroup) makes Windows honor
  // the WHOLE shortcut: target, arguments, working directory, and the
  // "Run as administrator" flag, and it also handles UWP/Store/Control-Panel
  // shortcuts that have no plain file target. The old behavior returned
  // `details.target`, which dropped the arguments, working directory, and
  // run-as flag — so a shortcut calling `schtasks /run /tn "…"` to launch an app
  // elevated lost its args and did nothing, and even a plain app shortcut lost
  // its "Start in" directory (apps like OBS require it). The icon and auto-name
  // come straight off the .lnk, so the renderer's add flow is unchanged.
  ipcMain.handle('launcher:resolveShortcut', (_event, filePath: string) => filePath)

  ipcMain.handle('launcher:getStartMenuPath', () => {
    return path.join(app.getPath('appData'), 'Microsoft', 'Windows', 'Start Menu', 'Programs')
  })

  ipcMain.handle('launcher:getFileIcon', async (_event, filePath: string, fresh?: boolean) => {
    try {
      // We launch a .lnk whole (to keep its args/cwd/run-as), but for the ICON
      // we resolve a meaningful source: the shortcut's custom icon first, then
      // its target exe, then the .lnk itself. Without this, a shortcut whose
      // target is a launcher (e.g. schtasks.exe) would show the launcher's icon
      // instead of the real app's, and a target-less shortcut might show nothing.
      let iconSource = filePath
      if (filePath.toLowerCase().endsWith('.lnk')) {
        try {
          const d = shell.readShortcutLink(filePath)
          iconSource = d.icon || d.target || filePath
        } catch { /* fall back to the .lnk itself */ }
      }
      // Chromium's icon manager caches exe icons by exact path string for the
      // whole session, so an icon fetched while the file was MISSING (Windows'
      // generic placeholder) would be served forever, even after the file is
      // restored and refetched. `fresh` dodges the stale entry by toggling the
      // drive letter's case — same file, different cache key. (One variant per
      // session; good enough for the restore-then-relaunch flow.)
      if (fresh && /^[a-zA-Z]:[\\/]/.test(iconSource)) {
        const c = iconSource[0]
        iconSource = (c === c.toUpperCase() ? c.toLowerCase() : c.toUpperCase()) + iconSource.slice(1)
      }
      const icon = await app.getFileIcon(iconSource, { size: 'large' })
      return icon.toDataURL()
    } catch (_) {
      return null
    }
  })

  ipcMain.handle('launcher:getFavicon', async (_event, pageUrl: string): Promise<string | null> => {
    let origin: string, hostname: string, protocol: string
    try {
      const u = new URL(pageUrl)
      if (u.protocol !== 'http:' && u.protocol !== 'https:') return null
      origin = u.origin; hostname = u.hostname; protocol = u.protocol
    } catch {
      return null
    }
    if (faviconCache.has(origin)) return faviconCache.get(origin) ?? null

    // 1. The site's own /favicon.ico (content-type validated).
    let icon = await fetchFaviconDataUrl(`${origin}/favicon.ico`)
    // 2. SPA subdomains (e.g. studio.youtube.com) 404 /favicon.ico and set their
    //    icon via JS — fall back to the parent domain's favicon.
    if (!icon) {
      const labels = hostname.split('.')
      if (labels.length > 2) {
        icon = await fetchFaviconDataUrl(`${protocol}//${labels.slice(1).join('.')}/favicon.ico`)
      }
    }
    faviconCache.set(origin, icon)
    return icon
  })
}
