# Electron upgrade checklist (APP-1)

Working file for the Electron 34 to 43/44 bump. Research done 2026-09-09; the ticket is APP-1 in `_todo.md`. Archive to `archive/` when the upgrade has shipped in a release.

## Where we are and where we're going

| | Current | Candidate A | Candidate B |
|---|---|---|---|
| Electron | 34.5.8 | 43.6.0 | 44.3.0 |
| Released | 2025-01-14 (34.0) | 2026-06-30 | 2026-08-25 |
| Supported until | EOL since 2025-06-24 | 2027-01-05 | 2027-03-02 |
| Chromium | 132 | 150 | 152 |
| Node | 20.19.1 | 24.20.0 | 24.20.0 |
| Patch releases so far | | 6 (.0 to .6) | 3 (.0 to .3) |

Electron supports the latest three majors; today that is 42, 43, 44. Either candidate is in support. 43 is the ticket's target and has three more months of patches behind it; 44 buys two extra months before the next forced bump and its only additional breaking changes do not touch this app (see the audit). Decision recorded below once made.

**Decision (2026-09-09):** 44. Fully supported, its extra breaking changes don't touch this app, and 43 would be end-of-life about four months out, which likely means another bump next cycle. Fallback is 43 if 44 shows a blocker in the shakedown.

## Breaking-changes audit (35 through 44)

Source: the official breaking-changes document, read 2026-09-09, checked against an inventory of every Electron API the main process, preload and renderer use. Nothing this app calls is removed in 35 through 44. Items that need action or a check:

| Version | Change | Applies to SM? | Action |
|---|---|---|---|
| 43 | `dialog.showOpenDialog` / `showSaveDialog` default `defaultPath` to the Downloads folder | YES. `files:openDirectoryDialog` passes no `defaultPath` at all (7 call sites: onboarding x2, Settings streams folder, Rules, Templates, Converter output folder, Player open folder), and several `openFileDialog` calls pass none (Converter preset import, FileDropZone, Player open video). Today Windows reopens the last-used folder; after the bump these land in Downloads. | Give `openDirectoryDialog` an options parameter and pass a sensible `defaultPath` per site (the streams folder, the current stream's folder, the current output folder). Same for the file pickers that lack one. Small code change, ships with the bump. |
| 42 | The `electron` npm package no longer downloads its binary in `postinstall`; it downloads on first run | Dev workflow and CI. `npm ci` gets faster; the first `npm run dev` after install downloads the binary. electron-builder fetches its own copy through @electron/get as before, so `npm run dist` and the release workflow are unaffected. | Note in this file and the README dev section. Revisit the `allowScripts` block in package.json (it pins `electron@34.5.8`; entries are per exact version, so they go stale on every bump; confirm what still needs an install script after the bump and update or drop the block). |
| 36 | `app.commandLine` lowercases switches and arguments | No. The `--from-autostart` flag is read from `process.argv`, which the doc names as the escape hatch. | None. |
| 36 | `NativeImage.getBitmap()` deprecated (use `toBitmap()`) | No. Only `createFromPath` and `createThumbnailFromPath` are used. | None. |
| 43 | `NativeImage.toBitmap()` normalizes to sRGB | No (not called). | None. |
| 44 | `clipboard` module removed from the renderer; main-process `clipboard` becomes Promise-based | No. The renderer uses `navigator.clipboard` only; the main process never touches `clipboard`. | None (relevant only if 44 is chosen; still nothing to do). |
| 44 | 32-bit Windows binaries no longer published | No. Portable target is x64 only. | None. |
| 44 | Pre-macOS-13 login item attributes removed | No. `setLoginItemSettings` uses `openAtLogin`, `path`, `args` only. | None. |
| 38 | `plugin-crashed` event removed | No. | None. |
| 35 | `session.setPreloads` deprecated; console-message event args moved | No (preload is set per window via `webPreferences.preload`; console-message unused). | None. |
| 20 (long shipped) | Renderers sandboxed by default | Already explicit: `sandbox: false` and `webSecurity: false` (file:// media) on both windows. Behavior unchanged by the bump. | Keep as is; re-verify file:// video and audio playback in the shakedown. |

APIs in use that had no entries at all across 35 through 44 (still worth a runtime look in the shakedown): `safeStorage` (encrypted credentials must decrypt on first launch of the new build), `session.addWordToSpellCheckerDictionary` and the spellcheck context menu, `before-input-event` (zoom and Ctrl+` shortcuts), `setWindowOpenHandler`, `screen.*` (pop-out placement), `shell.trashItem/openPath/readShortcutLink/showItemInFolder`, `net.fetch` (thumbnail download, launcher icons), `nativeImage.createThumbnailFromPath` (launcher icons), `Tray`/`Menu`, `app.setAppUserModelId`, `requestSingleInstanceLock` + `app.exit`.

## Toolchain compatibility

| Package | Now | Latest | Plan |
|---|---|---|---|
| electron-vite | 5.0.0 | 5.0.0 (6.0 is beta) | Keep. Peer range is vite ^5 / ^6 / ^7; it does not pin an Electron version. |
| vite | 7.3.6 | | Keep. |
| electron-builder | 26.8.1 (lockfile; range ^26) | 26.15.3 | Keep the lockfile version for this bump to hold variables down. The APP-32 launcher patch in `scripts/dist.cjs` anchors on `templates/nsis/portable.nsi` and fails the build loudly if a builder update reshapes it, so a later builder bump is safe to attempt on its own. |
| @types/node | 20.x | 24.13.4 | Bump to 24 with Electron (Electron 43/44 run Node 24.20). Expect a few type nits. |
| typescript | 5.3 | | Keep unless @types/node 24 demands newer. |
| electron-store | 8.2 | | Keep (10 is ESM-only). |
| electron-devtools-installer | 4.0.0 | 4.0.0 | Keep. |
| Native modules | none | | `@electron/rebuild` runs in the build but has nothing to rebuild. |
| `@electron-toolkit/utils` | not installed | | Not a dependency after all: `is` and `optimizer` are local shims in `index.ts`. Nothing to do. |

## Upgrade steps

- [x] Decide 43 or 44 (record above). 44.
- [x] `npm install --save-dev electron@44 @types/node@24` (2026-09-09: electron ^44.3.0, @types/node ^24.13.4; install clean, 3 s).
- [x] `allowScripts`: removed the `electron@34.5.8` entry (Electron 44's package declares no install script; the other entries stay). `npm ci` re-verification still pending on a clean checkout (CI will do it).
- [x] `npm run typecheck`, then `npm run lint`: both clean on the first try, no Node 24 typing fallout.
- [x] Dialog `defaultPath` pass: `openDirectoryDialog(options?)` now resolves explicit path, then the streams root, then the Videos folder (main-side, so all 7 directory sites benefit); Converter output folder, Rules watch/destination, and the Player export folder pass their current value; the Player's open-video picker starts at the streams root. JSON import pickers deliberately keep the Downloads default (that is where downloaded files are).
  Follow-up 2026-09-10 after the shakedown found file pickers still opening in Downloads: the open-FILE dialog now gets the same main-side fallback (explicit path, then streams root, then Videos), with an explicit `startIn: 'downloads'` opt-in used by the three downloaded-JSON pickers (wizard credentials, converter presets, palette import). The files grid's add-files picker and drop zone open in the stream's own folder. Save dialogs need nothing: they pass a file name, which counts as a defaultPath, so Windows keeps its last-folder memory for them (confirmed on export PNG and export palette).
- [x] `npm run dev`: app launches, dev tools open, hot reload works. (The 44.3.0 binary is downloaded; `npx electron --version` printed v44.3.0.)
- [x] `npm run dist`: passed 2026-09-09 on 44.3.0 (rebuild step ran against 44.3.0, launcher pre-check injected, artifact `Stream Manager 2.6.0_DEV.exe`, 205 MB vs 177 MB on 34). Exe run: see shakedown.
- [x] Runtime check for the native alpha color input: in dev tools, `'alpha' in document.createElement('input')`. If true on the new Chromium, the ColorAlphaField alpha attribute is a follow-up (own ticket or a sub-item), not part of the bump: with `alpha` set the input's value format changes to CSS color strings, which touches `joinColorAlpha` and every call site.
- [x] README tech stack row ("Electron 34") and the dev-section note about the binary downloading on first run.
- [x] Release-notes draft line under Under the hood (Electron and Chromium versions, what users gain: current Chromium, Node 24, security fixes for an EOL runtime).

## Shakedown (packaged `_DEV` build, before it rides in a release)

Everything that crosses the Electron boundary. Tick against the new build.

- [x] First launch: app opens, window state restored, tray icon present, no console errors in `%APPDATA%\stream-manager\logs`.
- [x] Encrypted credentials: YouTube, Twitch and the Claude key decrypt with no reconnect (safeStorage across the bump); push or pull something small on each.
- [x] Single instance: second launch focuses within a second, no file loss (the launcher pre-check is builder-side, but confirm anyway); `--from-autostart` still gates Start Minimized.
- [x] Zoom shortcuts (Ctrl+=, Ctrl+-, Ctrl+0) and Ctrl+` dev tools; spellcheck squiggles, suggestions and Add to dictionary in the context menu.
- [x] Player: open a Hybrid MP4 (file:// with webSecurity off), multi-track audio, waveform, thumbnails strip, markers, clip export, pop-out window (frameless, aspect lock, placement on the display it was on).
- [x] Converter: one conversion start to finish, pause/resume (NtSuspendProcess path), quit-with-running-jobs dialog.
- [x] Combine: one two-file combine.
- [x] Streams: cloud-status icons, offload and pin local (cfapi/PowerShell paths), thumbnail carousel, drag and drop of files into the grid.
- [x] Watcher/auto-rules: drop a file into the watch folder (chokidar under Node 24).
- [x] Relay: bind, ingest, live, complete on a test stream (ffmpeg child process handling under Node 24).
- [x] Thumbnail editor: open, edit, save, export PNG; fonts enumerate; palette import/export dialogs.
- [x] Launcher: launch a group; icons resolve (`createThumbnailFromPath`, `readShortcutLink`); open folder actions.
- [ ] Dialogs: every picker opens in a sensible folder, not Downloads (the 43 change).
- [ ] Integrations page: YouTube wizard opens links in the browser (`shell.openExternal` via the open handler); OAuth callback page renders.
- [ ] Update check: the About/update path reaches GitHub (`net`/fetch under the new Chromium).
- [ ] Quit: no orphaned processes; relaunch restores state.

Watch item from the first packaged 44 build (2026-09-09): one black-window episode after an Explorer window covered the app (repaint on resize, blank on click, self-recovered; no crash, all processes alive). Not reproduced since. Tracked as APP-33 with the diagnosis steps; not treated as a blocker for the bump unless it recurs.

## Rollback

Revert the package.json and lockfile change and `npm ci`. Nothing in the bump migrates on-disk data (safeStorage payloads are DPAPI blobs independent of the Electron version), so a rollback needs no data steps.
