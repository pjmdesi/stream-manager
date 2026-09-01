# Release test checklist — v2.5.0 (2026-08-30)

Build: Stream Manager 2.4.0_DEV.exe from dev @ dac98f2

Batch: navigation redesign + the UI polish campaign. All checks run against the PACKAGED build, not the dev server.

## This batch

### Navigation redesign

- [x] Nav order and groups: Streams / Player / Thumbnails · Converter / Combine · Launcher / Auto-Rules, with Integrations + Settings at the bottom. Auto-Rules sits under Launcher.
- [x] Page-jump shortcuts match positions: Ctrl+1 Streams … Ctrl+5 Combine, Ctrl+6 Launcher, Ctrl+7 Auto-Rules; collapsed-nav tooltips show the same numbers; Ctrl+PageUp/PageDown cycle in visual order.
- [x] Converter nav item: aggregate progress/ETA slides open under the item when a job starts and shut when the last finishes.
- [x] Launcher nav item: launch button on the row runs the pinned group (spinner → check; warning + tooltip details on a failure); Ctrl+L still quick-launches.
- [x] Auto-Rules nav item: Start/Stop control on the row works; "Running · enabled/total" subline while the watcher runs.
- [x] Context subtitles: open stream title under Streams, open video under Player, open canvas's stream under Thumbnails; subtitles animate in/out and the right-edge accent follows.
- [x] Integrations item: per-service dots (YouTube/Twitch/Claude) green when healthy; collapsed rail aggregates to one dot / warning triangle.
- [x] Sidebar collapse/expand: animation clean both ways, collapsed columns hover/select as one unit, clicking outside a control navigates; startup star on the row's left edge on hover.

### Tag colors & textures

- [x] Swatch picker shows 16 colors; the old cool-gray one is labeled "Gray" with a darker swatch; new Purple is true purple; Black and White chips legible (White uses a dark check).
- [x] Textures on a Black tag draw in light ink and stay subtle; other colors keep dark ink; texture picker previews unchanged.

### Thumbnail editor panels

- [x] Layers and Properties panels collapse/expand, persist across an app restart, and the chevron doesn't shift the header by a pixel when toggling.
- [x] Palette edit mode: pencil goes amber, amber ring wraps the panel contents evenly; palette + assets header buttons share the same button chrome.

### Number inputs

- [x] Settings: cache limit (MB) and max simultaneous conversions are stepper fields; spinner tooltips read the actual step ("+128 (Shift = ×10)").
- [x] Integrations: relay custom port is a stepper; the save fires on leaving the field group and the relay restarts its listener when enabled.

### App zoom

- [x] In the packaged build (main-process change): Ctrl+- a few times, then Ctrl+= steps back in; Ctrl+Shift+= doesn't double-step; Ctrl+0 resets.

### Converter & Combine

- [x] Progress fills the row background (neutral tint on job rows, stronger green on the archive group header); percent/elapsed/ETA text unchanged; finished/cancelled rows revert to a plain background.
- [x] Status icon sits in its own column at 20px; filenames use the mono stream-date styling.
- [x] At minimum window width: output-folder link truncates with the full path in its tooltip; stats don't wrap.
- [x] Combine in-progress row matches all of the above; a COMPLETED combine row has no green bar, the check icon in its own column, mono filename.

### Integrations page

- [x] Navigating to the page does not flash the expanded YouTube setup instructions or reflow after load.
- [x] Stream Relay section header wears the widget's icon (slightly larger than the other section icons).

### Streams list (narrow widths)

- [x] With a stream open at minimum window width: row hover actions don't appear over the date/title (and the count/date columns hold their widths).
- [x] File cards collapse their action labels to icon-only in a narrow grid instead of overflowing the thumbnail.

### Files section

- [x] The section is one panel: controls (chevron, Video/Images filters, Offload / Pin local / Open folder, Select) in a header inside the container; collapsing shrinks it to a slim bar that keeps the ops.
- [x] Labels fold before the row wraps: filters + ops go icon-only on a narrow sidebar; select-mode cluster keeps labels until ~920px.
- [x] Bulk tooltips carry live counts (convert/combine count videos; offload/pin split by hydration; delete counts what in-use checks allow); zero-count buttons disable; the pinned displayed thumbnail is excluded from the offload count.
- [x] An item with no SM-created thumbnail shows the "Create thumbnail" tile where the thumbnail card will appear; creating one replaces the tile.

### Detail sidebar

- [x] Header: title first with the labeled "Close sidebar" button (collapses to icon on a narrow sidebar); date / episode nav / New episode (labeled, collapses at the same breakpoint) / Archived on the row below; a long title wraps without a line starting on a space or lone pipe.
- [x] Date buttons: header and broadcast-row buttons match their rows' heights, pencils match the date text color, and hovering either shows the reference calendar (correct month, item date filled, today outlined, first-day-of-week honored).
- [x] Broadcast row: Date · Broadcast time · Privacy at equal heights; the clock icon shows pointer + hover tint and still opens the native dropdown; Copy URL / Create broadcast centers on the inputs.
- [x] Footer: broadcast section + push buttons + Archive / Delete (permanent labels) — no send buttons.
- [x] Reschedule, New stream, and New episode dialogs show the combined calendar+input picker by default (centered, no icon click, stream dots, typing a date walks the calendar); Reschedule is the narrower width; pull mode grays the whole picker.
- [x] Series control: one segment group [toggle | S | E]; toggle wears the solid accent when on; off disables the numbers in place (no reflow); enabling backfills season/episode from the series.
- [x] Twitch title: off shows the rendered YouTube title read-only with "Using YouTube title" below; enabling seeds the editor with the YouTube title's chips + template binding and gives the full YouTube-title experience (template tab in the label row, merge chips, Ctrl+Space AI suggestion with the hint under the box, char counter).
- [x] Twitch category: off shows the picked tag (dropdown when several tags); enabling seeds the resolved tag into the free-text field; "Using the picked Topic / Game tag" only while off.
- [x] YouTube thumbnail row is informational only (primary thumbnail name + hint); the push uploads that thumbnail.
- [x] Merge-field hints render as arrow + chip next to labels (Topics/Games, Tagline, Series) and light up when the bound title template uses them; the Templates modal shows chips in its intro text and chip-ified bodies on title/description items.

### Help modal

- [x] Open Help (?) and skim each section: merge fields show as chips (including one red example), Shortcuts lists Ctrl+1…7 in the new nav order plus the Ctrl +/-/0 zoom keys, the Streams action-button list matches reality, the Twitch paragraph describes the override toggles, and the last nav entry is Stream Relay (no Widgets section).

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
