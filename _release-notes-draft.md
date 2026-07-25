# Release notes draft — next release from `dev`

> Running draft, maintained ON `dev`. When a feature lands, append a line to the right section in the same sitting. At promotion time this gets edited into the GitHub-release copy (trim, reword, reorder headline-first — see `_release-notes-v2.md` for the format) and the file is emptied for the next cycle. Wording here is working-quality, not final. Fixes that already shipped in a hotfix release (e.g. episode numbering in 2.0.12) do NOT belong here.

Target: 2.1.0 (tentative) · draft started 2026-07-25, seeded with everything on `dev` since v2.0.12.

## Streams page

- Search accepts multiple terms: commas mean AND, semicolons mean OR (`game 1, game 2; type1`). Hint tooltip appears while the empty search bar is focused.
- Shift/Ctrl-click a stream row to jump straight into multi-select with that row selected — works everywhere multi-select exists (including the files grid).
- Files grid renamed "Files", collapsible with a per-type summary ("2 recordings · 3 clips …"); collapse state persists. Loading state keeps the panel height with a spinner.
- Clip-draft badge (✂ N) on source videos in the files grid — click to open the drafts; creating/deleting drafts updates the grid live.
- File-class tag borders overhauled: red Recording, pink Clip, violet Short, teal selected thumbnail; alternate thumbnails show their tag without hover.
- Combine button in files-grid multi-select — send picked video files straight to the Combine page.
- Import files into a stream's folder: drag files from Explorer anywhere onto the files grid (move; hold Ctrl to copy), or use the new add-files tile / click-to-browse. Works for empty folders (post-YouTube-import), never renames or overwrites, and reports per-file failures inline. Folder-per-stream mode only.
- Cloud sync: failed pin/offload items get a per-item Retry button, and retries take the next free worker slot immediately instead of waiting for the current batch to finish.
- Sending a dehydrated file to the player from the files grid buttons now opens the same download modal as everywhere else, with a note about pinning local to keep using the app meanwhile.
- Multi-select Stop button tooltip now lists its keyboard shortcut; filter buttons and all remaining buttons got tooltips.

## Player

- Playback speed control built into the play button: hover to fan out ¼×–8× (slower speeds left, faster right), scroll to step, J/K/L shortcuts (K resets to 1×). Selection persists across sessions.
- Holding a skip shortcut repeats the skip; frame-stepping no longer stalls on slow decodes — the timecode and playhead advance immediately and the picture catches up.
- Timeline auto-scrolls to keep the playhead in view while playing or skipping when zoomed in (paged, with padding). Manually scrolling while paused pins the view until you seek or resume.
- Keyboard shortcuts flash their on-screen button — solid while held, quick fade in/out. Shortcut chips added to the play/pause, skip, and timecode tooltips.
- Subtle border and drop shadow around the video canvas so its edges read against same-color footage.
- Recents show a cloud icon when every video in the stream is offloaded; opening one goes through the standard download modal.
- Session videos list: dehydrated files show a spinner + "Downloading from cloud…" tooltip while hydrating (visible in the cloud-sync widget too), and finished files get the pulsing-ring callout instead of switching automatically.
- Recents thumbnails sharpened (proper high-quality downscaling; shared with the thumbnail overview).

## Thumbnail editor

- Transparency support for every color input: opacity value in the swatch control, eraser button to clear to fully transparent, alpha-aware pickers. Swatches are now square with rounded corners.
- Rounded corners for rectangle and triangle shapes (new Transform field). When the entered radius exceeds what the shape can render, the field shows the actual applied radius in parentheses.
- Line-height field for text layers; rotation field shows °.
- Asset panel is collapsible (chevron on the left, state persists).
- Variant creation: "Start blank" joined the template/copy grid, with a Create button enabled on selection.
- Template sessions: usage hint line, and saving a new template from an unbound session binds the editor to the saved template.
- Thumbnail overview recents show the stream's variant count instead of the directory path.

## Launcher

- Launch groups are available from the tray icon's right-click menu. Failures bring the main window up with an in-app error modal — no OS notifications.

## Fixes

- Thumbnail mismatch indicator no longer flashes blue while opening or switching stream items.
- Keyboard-navigating to the first stream in the list no longer leaves it hidden behind the column headers.
- Convert-to-folder-per-stream modal: Close is now the primary (right) button on the final step.

## Under the hood

- Dev builds are unmistakable: non-master `npm run dist` builds get a `_DEV` artifact name, a yellow dev icon, and a branch chip in the sidebar; the electron-vite dev server shows an amber `server` chip. Release builds ship none of these markers.
