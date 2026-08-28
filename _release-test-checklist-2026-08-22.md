# Release test checklist — v2.4.0 (2026-08-22)

Build: Stream Manager 2.3.1_DEV.exe from dev @ a41f4e7

## This batch

### New-episode thumbnails
- [x] Create a new episode from a stream with 2+ thumbnail variants and a non-first variant selected: the new episode gets exactly ONE thumbnail (the selected design, renamed to the base variant), and it re-renders in the background with the new episode's merge-field values (episode number, total episodes).
- [x] Fail condition: temporarily rename/remove an image an SM thumbnail references (or use one whose asset is cloud-only with sync paused), create an episode from it: the copied thumbnail keeps the stale image but shows the "Could not load references" overlay in the files grid and the warning badge on the stream row. Opening and saving it in the editor clears the flag.

### Out-of-sync panel
- [x] Edit a tags template used by several streams (add/remove a tag), without opening any stream: all bound streams appear in the panel as "Ready to push" within a moment, and their tags are updated in meta.
- [x] Bulk-push the resulting list: each item disappears as its push completes, nothing re-appears under "Changed on YouTube" during or after the run, and the panel reads "In sync with YouTube" after the final re-check.
- [x] A real Studio-side edit (change tags on one video in YouTube Studio, wait past the 5-minute post-push grace window if that video was just pushed) still surfaces as "Changed on YouTube" on re-check.

### Twitch match check
- [x] A stream just pushed to Twitch reads as in sync (Push button disabled / no mismatch flag), including one whose title contains special characters.
- [x] Push a different stream, then re-select the first: it correctly reads as out of sync again (channel state moved on).
- [x] Post-stream auto-update (found 2026-08-23, fixed same day — needs the rebuilt exe): after the relay's post-stream Twitch update fires (auto or via the prompt), the target stream reads as in sync in the SAME app session (Push button disabled), and its `_meta.json` gains `twitchLastPushed*` values.

### Title edge-sanitize
- [x] After the streams list loads once, spot-check a `_meta.json` that previously had a leading newline in `ytTitle` (e.g. the Alters stream): the edge whitespace is gone; interior spacing (including non-breaking spaces) is untouched.
- [x] Saving a title with a leading/trailing space or newline stores it trimmed at the edges.

### Merge-field chips (clipboard + undo)
- [x] Drag-select across chips in a title/description: chips highlight while inside the selection and dim when the selection shrinks away.
- [x] Copy a selection containing chips, paste into the other title field: tokens arrive as chips. Paste into Notepad: raw `{field}` text.
- [x] Cut works the same and removes the selection; Ctrl+A copy from a multi-chip description works.
- [x] Undo: Ctrl+Z after a paste removes exactly the paste; Ctrl+Shift+Z / Ctrl+Y restores it. A typing burst undoes as one step; a picker chip-insert undoes alone. Ctrl+Shift+Z inside the editor does not trigger the app-global native redo.

### AI suggestions
- [x] Pending-suggestion persistence: request a tagline suggestion and leave it untouched for a couple of minutes (past a YouTube check cycle): it stays visible and selected; Tab/Esc still work.
- [x] Repeat prevention: Esc a tagline suggestion, request again: meaningfully different suggestion; `aiRejectedSuggestions.tagline` appears in the stream's `_meta.json`. Same quick check on title and a tag field.
- [x] Settings: "AI Suggestions" section exists with Claude connected; toggling "Prevent repeat suggestions per stream item" off stops new Esc dismissals from being recorded. Section (and nav chip) disappears if Claude is disconnected.

### Opportunistic (hard to trigger deliberately)
- [x] Thumbnail flags under CPU load: with something heavy running, reload the streams list; row thumbnails should keep their images instead of all dumping to cloud placeholders.

## Core regression (every release)
- [x] Relay: full lifecycle on a real or test stream — bind → ingest → live → complete; post-stream Twitch auto-update fires (60s delay)
- [x] Watcher/auto-rules: drop a recording into the watch folder → lands in the right stream item
- [x] New stream + New episode: correct season/episode, templates render
- [x] YouTube: push + pull a stream's details; thumbnail push; out-of-sync panel clean afterward
- [x] Converter: one job start→finish; pause/resume; output plays
- [x] Player: open a video, clip draft → export
- [x] Thumbnail editor: open, edit, export; variant creation
- [x] Cloud: pin local + offload one item; statuses update everywhere
- [x] Launcher: run a launch group (window + tray)
- [x] Quit/relaunch: no orphaned processes, state restored
