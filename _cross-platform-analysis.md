# Cross-platform analysis — Linux & macOS

*Investigation only (2026-07-15). No external demand yet; nothing here is scheduled.
Scope: what it takes to ship Stream Manager on popular Linux distros and macOS in its
current (v2.0.10) state.*

---

## TL;DR

| Platform | Verdict | Rough effort |
|---|---|---|
| **Linux** | Surprisingly close. Every Windows-only subsystem already has a guard + graceful fallback. The real work is packaging/CI, one tray API difference, and a QA pass. | Days, not weeks |
| **macOS** | Meaningfully more work (window chrome, Cmd shortcuts, code signing + notarization at $99/yr), and currently **untestable** — defer until there's demand and test hardware. | 1–2 weeks + recurring cost |

The codebase is in better shape than a typical Windows-first Electron app: all 14
`process.platform` branch sites degrade gracefully rather than crash, and the stack
(Electron, chokidar, electron-store, ffmpeg-static/ffprobe-static, Konva, `shell.trashItem`,
`queryLocalFonts`) is cross-platform by design.

---

## Already cross-platform (no work)

- **File watching, meta writes, scanning** — chokidar + Node fs everywhere; the atomic
  `_meta.json` swap and backups are pure Node. The Windows hidden-attribute migration
  (`streams.ts` → `attrib -H`) is already win32-gated.
- **Conversion pause/resume** — `ffmpegService.ts` already branches: NtSuspendProcess via
  PowerShell on Windows, `SIGSTOP`/`SIGCONT` elsewhere. The POSIX path is arguably *more*
  reliable than ours.
- **ffmpeg/ffprobe** — `ffmpeg-static`/`ffprobe-static` ship per-platform binaries;
  `asarUnpack` config is already in place. (Caveat: the binary downloaded at `npm install`
  matches the *build* machine — see Packaging.)
- **Trash, open-in-folder, open-external** — all via Electron `shell.*`, cross-platform.
- **Thumbnail editor fonts** — `queryLocalFonts` (Chromium Local Font Access API), not a
  Windows API. Shipped for Win/mac/Linux desktop Chromium; the missing-font system's
  `fontsLoaded` gate already fails safe if the API is absent. *Verify on Linux during QA.*
- **OAuth (YouTube/Twitch), relay server, update check** — loopback servers, `net.fetch`,
  GitHub releases API. Nothing platform-specific. (Relay's above-normal priority bump is
  win32-gated best-effort; skipping it on Linux is fine.)
- **quit behavior** — `window-all-closed` already has the `darwin` special case.

---

## Windows-coupled subsystems (the actual work)

### 1. Cloud placeholder system — *no Linux work; large macOS work if ever wanted*
`cfapi.ts` + the `checkLocalFiles` family in `files.ts` are built on the Windows Cloud
Files API (attrib PINNED/UNPINNED, OFFLINE/RECALL attribute mask, PowerShell
`GetAttributes` batches). Every entry point is win32-guarded and returns "everything is
local" / "not a sync root" elsewhere, so on Linux/mac:
- hydration badges, pin/offload buttons, and dump-mode cloud actions simply don't appear
  (`isCfApiSyncRoot` fails closed), and
- scans treat all files as local — correct, since no placeholder semantics exist.

**Linux:** Synology Drive's Linux client does full/selective sync only (no on-demand
placeholders), so hiding the feature is the *correct* behavior, not a regression.
**macOS:** on-demand sync exists (File Provider "dataless" files) but uses a completely
different API surface (`SF_DATALESS`, `brctl`); supporting it is a new subsystem.
Recommend: explicitly out of scope for a first mac build — document "cloud features are
Windows-only."

### 2. GPU-accelerated conversion — *optional for MVP, medium to do right*
`detectGpuMakersViaWMI` (PowerShell/WMI) returns empty off-Windows → conversions fall back
to CPU (libx264/x265/svtav1). Works everywhere, just slower.
- **Linux:** NVENC and QSV exist in the bundled ffmpeg; detection needs a non-WMI probe
  (e.g. parse `ffmpeg -encoders` + a 1-frame test encode, or read `/sys/class/drm` vendor
  IDs). AMF is Windows-only — AMD on Linux means VAAPI, a new entry in `GPU_CODEC_MAP`.
- **macOS:** one new vendor, `videotoolbox` (h264/hevc; AV1 encode not available) — small
  mapping addition, but untestable today.

### 3. Tray — *the one real Linux bug waiting to happen*
`index.ts` builds the tray menu inside a `tray.on('right-click')` handler (deliberate, to
dodge Windows' stale-menu caching). On Linux (AppIndicator — GNOME/KDE both) **click and
right-click events never fire**; a context menu must be registered via
`tray.setContextMenu()`. As-is the tray icon would appear but be completely inert.
Fix: on non-Windows, `setContextMenu(buildTrayMenu(...))` and rebuild/reassign whenever
status changes (the Windows caching problem this avoided doesn't exist there). Also note
GNOME needs the (Ubuntu-preinstalled) AppIndicator extension; KDE (CachyOS/Bazzite) is fine.

### 4. Window chrome — *fine on Linux, real work on macOS*
`frame: false` + fully custom titlebar/controls (including the splash's mirrored buttons).
- **Linux:** custom chrome is normal; works as-is. QA: maximize/restore behavior across
  KDE/GNOME, and multi-monitor window-state restore.
- **macOS:** users expect native traffic lights. Proper fix is `titleBarStyle:
  'hiddenInset'` *without* `frame: false` on darwin, hide the custom min/max/close buttons,
  keep the drag region, and re-mirror the splash titlebar. Touches App.tsx, index.html
  splash, and window creation.

### 5. Keyboard shortcuts — *zero Linux work, broad-but-shallow macOS work*
18 `ctrlKey` sites across 7 renderer files, plus every tooltip/help string that says
"Ctrl+…". Linux uses Ctrl — nothing to do. macOS needs `ctrlKey || metaKey` (or a small
`isCmdOrCtrl(e)` helper) plus display-string substitution ("⌘"). Mechanical, but easy to
miss spots — grep-driven.

### 6. Launcher page — *degrade gracefully, then per-OS niceties*
URLs already work everywhere. App entries are Windows-flavored:
- `.lnk` handling (`shell.readShortcutLink`) is correctly gated behind a `.lnk` extension
  check, so it can't crash elsewhere — but the "browse for app" default
  (`launcher:getStartMenuPath` → Windows Start Menu) needs per-OS defaults:
  `/usr/share/applications` + `~/.local/share/applications` (.desktop) on Linux,
  `/Applications` (.app) on mac.
- `.desktop` files aren't launchable via `shell.openPath` on all distros — may need
  `gio launch`/`gtk-launch` fallback. `.app` bundles open fine via `openPath`.
- `app.getFileIcon` works on all platforms (the drive-letter cache-busting hack is
  win-path-gated and no-ops elsewhere).

### 7. Start-at-login — *small*
`app.setLoginItemSettings` works on Windows and macOS. On Linux it's a **no-op**: need to
write/remove `~/.config/autostart/stream-manager.desktop` ourselves. Also the setting is
labeled "start with Windows" in the UI/store — rename generically.

### 8. Packaging, distribution, updates — *the biggest Linux line-item*
- Targets are already stubbed in `package.json` (AppImage x64; dmg x64+arm64).
- **You cannot build all three from the Windows machine.** ffmpeg-static downloads the
  build-host's binary at install, and mac builds require macOS for signing. The clean
  answer is a GitHub Actions matrix (windows/ubuntu/macos runners) producing all artifacts
  per tag — worth doing for Windows alone eventually.
- **Linux formats:** AppImage covers Ubuntu and CachyOS directly, and is also the right
  answer for Bazzite (immutable Fedora — no rpm installs; AppImage or Flatpak only).
  Ship AppImage first; consider Flatpak later only if users ask. A `.deb` is a cheap
  add-on for Ubuntu once CI exists.
- **Update check** currently only compares versions against GitHub latest and links the
  release page — that's platform-neutral and keeps working. If it ever gains per-asset
  download links, asset naming needs platform awareness.
- **macOS signing:** unsigned/un-notarized builds are effectively uninstallable for normal
  users on current macOS (Gatekeeper no longer offers right-click-open bypass). Requires
  Apple Developer Program ($99/yr), hardened runtime, `notarytool` in CI. This alone is a
  reason to defer mac until demand exists.

### 9. Playback codec caveat (Linux QA item)
Chromium plays H.264/AAC everywhere, but HEVC playback relies on hardware decode support
that is spotty on Linux (VAAPI driver dependent). Recordings that play in the Windows
build may show black video on Linux. The converter is the existing escape hatch; QA should
test an HEVC file specifically and, if it fails, the player's "convert to compatible
format" path should be the suggested action (already exists for unsupported codecs).

### 10. Miscellaneous small items
- `app.setAppUserModelId` — already win32-gated. macOS dock/menu need `app.name`/about
  panel sanity check; Linux needs correct `.desktop` `StartupWMClass` (electron-builder
  handles this for AppImage).
- Favicon fetch UA string says "Windows NT" — cosmetic, harmless, optionally genericize.
- Paths in `_meta.json`/store are absolute with drive letters — fine per-machine, but a
  library folder shared over the NAS between a Windows and a Linux machine will re-resolve
  by scan (folder paths are re-derived), while *settings* (streams dir, converter output
  dirs) are per-machine anyway via electron-store. Verify during QA that nothing else
  persists absolute paths that get *reused* cross-machine.
- Dev-shell gotcha carries over: `ELECTRON_RUN_AS_NODE` must stay cleared when launching.

---

## Suggested sequencing (when this gets scheduled)

**Phase L1 — make it run (1–2 days):** CI build matrix (or a one-off WSL/VM build), tray
`setContextMenu` fallback, login-item `.desktop` handling + setting rename, launcher
per-OS browse defaults. Everything else already degrades.

**Phase L2 — Linux QA pass (1–2 days, on real hardware):** Ubuntu first (GNOME is the
strictest tray/desktop-integration environment), then Bazzite/CachyOS (KDE). Checklist:
watcher + auto-rules on a real recording session, converter (CPU), player incl. HEVC file,
thumbnail editor incl. `queryLocalFonts` + missing-font system, relay end-to-end with OBS,
OAuth flows, tray, window-state restore, AppImage self-location quirks (portable-exe-style
assumptions, if any).

**Phase L3 — polish (optional):** GPU detection for NVENC/QSV/VAAPI, `.deb` target,
Flatpak if requested.

**macOS — defer until:** (a) someone actually asks, (b) test hardware exists (the work
Mac is off-limits; a used M1 Mini or MacStadium/GitHub-Actions-only smoke builds are the
realistic options), (c) willingness to pay/renew the $99/yr developer account. When it
happens: traffic-light window chrome, Cmd shortcuts + label substitution, videotoolbox
mapping, notarized dmg in CI, and an explicit "cloud placeholder features are
Windows-only" doc note. File Provider (on-demand sync) support: separate future project.
