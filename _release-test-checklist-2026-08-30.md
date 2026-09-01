# Release test checklist — v2.5.0 (2026-08-30)

Build: Stream Manager 2.4.0_DEV.exe from dev @ 79a9334

Batch: navigation redesign + the UI polish campaign. All checks run against the PACKAGED build, not the dev server.

## This batch

### Navigation redesign

- [ ] Nav order and groups: Streams / Player / Thumbnails · Converter / Combine · Launcher / Auto-Rules, with Integrations + Settings at the bottom. Auto-Rules sits under Launcher.
- [ ] Page-jump shortcuts match positions: Ctrl+1 Streams … Ctrl+5 Combine, Ctrl+6 Launcher, Ctrl+7 Auto-Rules; collapsed-nav tooltips show the same numbers; Ctrl+PageUp/PageDown cycle in visual order.
- [ ] Converter nav item: aggregate progress/ETA slides open under the item when a job starts and shut when the last finishes.
- [ ] Launcher nav item: launch button on the row runs the pinned group (spinner → check; warning + tooltip details on a failure); Ctrl+L still quick-launches.
- [ ] Auto-Rules nav item: Start/Stop control on the row works; "Running · enabled/total" subline while the watcher runs.
- [ ] Context subtitles: open stream title under Streams, open video under Player, open canvas's stream under Thumbnails; subtitles animate in/out and the right-edge accent follows.
- [ ] Integrations item: per-service dots (YouTube/Twitch/Claude) green when healthy; collapsed rail aggregates to one dot / warning triangle.
- [ ] Sidebar collapse/expand: animation clean both ways, collapsed columns hover/select as one unit, clicking outside a control navigates; startup star on the row's left edge on hover.

### Tag colors & textures

- [ ] Swatch picker shows 16 colors; the old cool-gray one is labeled "Gray" with a darker swatch; new Purple is true purple; Black and White chips legible (White uses a dark check).
- [ ] Textures on a Black tag draw in light ink and stay subtle; other colors keep dark ink; texture picker previews unchanged.

### Thumbnail editor panels

- [ ] Layers and Properties panels collapse/expand, persist across an app restart, and the chevron doesn't shift the header by a pixel when toggling.
- [ ] Palette edit mode: pencil goes amber, amber ring wraps the panel contents evenly; palette + assets header buttons share the same button chrome.

### Number inputs

- [ ] Settings: cache limit (MB) and max simultaneous conversions are stepper fields; spinner tooltips read the actual step ("+128 (Shift = ×10)").
- [ ] Integrations: relay custom port is a stepper; the save fires on leaving the field group and the relay restarts its listener when enabled.

### App zoom

- [ ] In the packaged build (main-process change): Ctrl+- a few times, then Ctrl+= steps back in; Ctrl+Shift+= doesn't double-step; Ctrl+0 resets.

### Converter & Combine

- [ ] Progress fills the row background (neutral tint on job rows, stronger green on the archive group header); percent/elapsed/ETA text unchanged; finished/cancelled rows revert to a plain background.
- [ ] Status icon sits in its own column at 20px; filenames use the mono stream-date styling.
- [ ] At minimum window width: output-folder link truncates with the full path in its tooltip; stats don't wrap.
- [ ] Combine in-progress row matches all of the above; a COMPLETED combine row has no green bar, the check icon in its own column, mono filename.

### Integrations page

- [ ] Navigating to the page does not flash the expanded YouTube setup instructions or reflow after load.
- [ ] Stream Relay section header wears the widget's icon (slightly larger than the other section icons).

### Streams list (narrow widths)

- [ ] With a stream open at minimum window width: row hover actions don't appear over the date/title (and the count/date columns hold their widths).
- [ ] File cards collapse their action labels to icon-only in a narrow grid instead of overflowing the thumbnail.

### Files section

- [ ] The section is one panel: controls (chevron, Video/Images filters, Offload / Pin local / Open folder, Select) in a header inside the container; collapsing shrinks it to a slim bar that keeps the ops.
- [ ] Labels fold before the row wraps: filters + ops go icon-only on a narrow sidebar; select-mode cluster keeps labels until ~920px.
- [ ] Bulk tooltips carry live counts (convert/combine count videos; offload/pin split by hydration; delete counts what in-use checks allow); zero-count buttons disable; the pinned displayed thumbnail is excluded from the offload count.
- [ ] An item with no SM-created thumbnail shows the "Create thumbnail" tile where the thumbnail card will appear; creating one replaces the tile.

### Detail sidebar

- [ ] Header: title first with the labeled "Close sidebar" button (collapses to icon on a narrow sidebar); date / episode nav / New episode (labeled, collapses at the same breakpoint) / Archived on the row below; a long title wraps without a line starting on a space or lone pipe.
- [ ] Date buttons: header and broadcast-row buttons match their rows' heights, pencils match the date text color, and hovering either shows the reference calendar (correct month, item date filled, today outlined, first-day-of-week honored).
- [ ] Broadcast row: Date · Broadcast time · Privacy at equal heights; the clock icon shows pointer + hover tint and still opens the native dropdown; Copy URL / Create broadcast centers on the inputs.
- [ ] Footer: broadcast section + push buttons + Archive / Delete (permanent labels) — no send buttons.
- [ ] Reschedule, New stream, and New episode dialogs show the combined calendar+input picker by default (centered, no icon click, stream dots, typing a date walks the calendar); Reschedule is the narrower width; pull mode grays the whole picker.
- [ ] Series control: one segment group [toggle | S | E]; toggle wears the solid accent when on; off disables the numbers in place (no reflow); enabling backfills season/episode from the series.
- [ ] Twitch title: off shows the rendered YouTube title read-only with "Using YouTube title" below; enabling seeds the editor with the YouTube title's chips + template binding and gives the full YouTube-title experience (template tab in the label row, merge chips, Ctrl+Space AI suggestion with the hint under the box, char counter).
- [ ] Twitch category: off shows the picked tag (dropdown when several tags); enabling seeds the resolved tag into the free-text field; "Using the picked Topic / Game tag" only while off.
- [ ] YouTube thumbnail row is informational only (primary thumbnail name + hint); the push uploads that thumbnail.
- [ ] Merge-field hints render as arrow + chip next to labels (Topics/Games, Tagline, Series) and light up when the bound title template uses them; the Templates modal shows chips in its intro text and chip-ified bodies on title/description items.

### Help modal

- [ ] Open Help (?) and skim each section: merge fields show as chips (including one red example), Shortcuts lists Ctrl+1…7 in the new nav order plus the Ctrl +/-/0 zoom keys, the Streams action-button list matches reality, the Twitch paragraph describes the override toggles, and the last nav entry is Stream Relay (no Widgets section).

## Core regression (every release)

- [ ] Relay: full lifecycle on a real or test stream — bind → ingest → live → complete; post-stream Twitch auto-update fires (60s delay)
- [ ] Watcher/auto-rules: drop a recording into the watch folder → lands in the right stream item
- [ ] New stream + New episode: correct season/episode, templates render
- [ ] YouTube: push + pull a stream's details; thumbnail push; out-of-sync panel clean afterward
- [ ] Converter: one job start→finish; pause/resume; output plays
- [ ] Player: open a video, clip draft → export
- [ ] Thumbnail editor: open, edit, export; variant creation
- [ ] Cloud: pin local + offload one item; statuses update everywhere
- [ ] Launcher: run a launch group (window + tray)
- [ ] Quit/relaunch: no orphaned processes, state restored
