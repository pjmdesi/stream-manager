# Release test checklist — v2.1.0 (started 2026-07-25)

Build: `Stream Manager 2.0.12_DEV.exe` — **rebuild first** (`npm run dist` on dev; the last built exe predates the footer-chip changes). Dev @ 6d9092b or later. All checks run against the PACKAGED build, not the dev server.

## This batch

### Streams page

- [ ] Search: `game 1, game 2` narrows (AND); `game 1; game 2` widens (OR); hint tooltip shows on focused-empty search bar
- [ ] Shift/Ctrl-click a stream row → enters multi-select with that row selected; same on a files-grid tile
- [ ] Files panel: collapse → summary counts correct ("2 recordings · 3 clips …"); state survives app relaunch; loading shows spinner at full height
- [ ] Clip-draft badge (✂ N): create a draft in the player → badge appears without refresh; click badge → drafts open; delete draft → badge updates
- [ ] Tag borders: red Recording, pink Clip, violet Short, teal selected thumbnail; alternates show tags without hover
- [ ] Combine button in files-grid multi-select → picked videos arrive on the Combine page
- [ ] Import: drag video + image from Explorer onto the files grid → files MOVE in; Ctrl-drag → copies; add-files tile click-to-browse works; empty folder (fresh YT-imported item) accepts drops; name collision fails with an inline error (no overwrite/rename)
- [ ] Cloud retry: force a pin-local failure (pause Synology sync) → Retry icon appears per failed row → resume sync, click retry → row re-attempts in the next free slot (not after the whole batch)
- [ ] Send a dehydrated file to the player from the files grid button → download modal appears (with the pin-local note)
- [ ] Multi-select Stop button tooltip shows the shortcut; filter buttons have tooltips

### Player

- [ ] Speed control: hover play button → fan-out ¼×–8×; scroll steps one per notch; J/L step speed, K resets to 1×; chosen speed survives relaunch; audio tracks stay in sync at 2×
- [ ] Hold Shift+→ (and other skip modifiers) → repeats until released; hold plain → (frame-step) → advances continuously without stalling; timecode/playhead never freeze on slow decode
- [ ] Zoom in, play → timeline pages to follow the playhead with padding; pause, scroll away manually → view stays pinned; seek or resume → follow resumes
- [ ] Shortcut press flashes its button; stays solid while held (skip, frame-step, space for play/pause); timecode tooltip shows its chip
- [ ] Video canvas edge visible against same-color background (border + shadow)
- [ ] Recents: fully-offloaded stream shows cloud icon; opening it goes through the download modal; thumbnails look sharp (not crusty)
- [ ] Session videos: click a dehydrated file → spinner + "Downloading from cloud…" tooltip + cloud-sync widget activity; when done, file gets pulsing ring and does NOT auto-switch

### Thumbnail editor

- [ ] Color inputs: opacity % edits alpha; eraser clears to transparent; picker carries alpha; swatches square; drop-shadow swatch matches
- [ ] Rounded corners: rect + triangle render circular corners; radius above the cap shows "(max)" note with correct value on odd-sized shapes; corners stay circular after resize
- [ ] Text: line-height field applies; rotation shows °
- [ ] Asset panel: collapse persists across relaunch; spinner while assets load
- [ ] Variant modal: "Start blank" sits in the grid; Create disabled until a selection is made
- [ ] Template session: hint line shows; saving a new template from an unbound session binds the editor to it (no dirty flag)
- [ ] Thumbnail overview recents show variant count, sharp thumbnails

### Launcher

- [ ] Tray right-click → launch groups listed and launch; a failing app brings the main window up with the in-app error modal (no OS notification)

### Fixes & markers

- [ ] Switch rapidly between streams with the sidebar open → no blue mismatch flash on the thumbnail row
- [ ] Keyboard-nav to the very first stream → fully visible below the column headers
- [ ] Convert-to-folder modal final step: Close is the right-hand primary button
- [ ] Dev markers present in THIS build: `_DEV` filename, yellow icon, purple `⎇ dev` chip on its own row, chip tooltips work, no amber `server` chip (packaged)

## Core regression (every release)

- [ ] Relay: full lifecycle on a real or test stream — bind → ingest → live → complete; post-stream Twitch auto-update fires (60s delay)
- [ ] Watcher/auto-rules: drop a recording into the watch folder → lands in the right stream item
- [ ] New stream + New episode: correct season/episode (check The Alters → E13 next), templates render
- [ ] YouTube: push + pull a stream's details; thumbnail push; out-of-sync panel clean afterward
- [ ] Converter: one job start→finish; pause/resume; output plays
- [ ] Player: open a video, clip draft → export
- [ ] Thumbnail editor: open, edit, export; variant creation
- [ ] Cloud: pin local + offload one item; statuses update everywhere
- [ ] Launcher: run a launch group (window + tray)
- [ ] Quit/relaunch: no orphaned processes, state restored

## Found during sweep

(log issues here; fix on dev, re-check, then tick)
