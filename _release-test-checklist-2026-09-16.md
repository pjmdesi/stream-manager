# Release test checklist: v2.7.0 (2026-09-16)

Build: Stream Manager 2.6.0_DEV.exe from dev @ 4638615 (the STR-17 commit; the dist cut on 2026-09-16 for the row-thumbnail test is this commit). Fixes found during the sweep get a fresh build and an updated hash here.

Sweep fixes so far (each needs a fresh build; update the hash above when cut):

- 2026-09-19: the streams page threw React error 300 ("Something went wrong on this page") after the window sat idle. Cause: STR-17 declared two hooks in ThumbImage below the cloud/syncing/error early return, so a row whose image flipped into a placeholder state changed its hook count. Hooks moved above the return; `react-hooks/rules-of-hooks` enabled in lint so the class cannot ship again.
- 2026-09-24: the Templates modal's title and description editors showed `{topic}` as raw text and still offered `game` in their Insert row. Cause: the modal kept a private copy of the merge-key list from before the topic rename, while the sidebar had the updated list. Both now read `TITLE_MERGE_KEYS` and `TITLE_KNOWN_KEYS` from `lib/streamTitle.ts`: pickers offer topic and topics, editors also chip the legacy game and games so older templates read right. Check: edit a title template containing `{topic}`, it renders as a chip and the Insert row reads topic, topics, season, episode, tagline, title, total_episodes; a template with `{game}` still shows a chip and still resolves; same in the description editor with season_links added.

FROZEN 2026-09-16: the queue is fully built. Code changes from here are limited to bugs and fixes found during this sweep.

Batch: no single theme. The Electron 34 to 44 upgrade, a converter and cloud round, stream list additions, player navigation and track naming, and a large thumbnail editor batch (groups, masks, effects on groups, gradient strokes and kinds, the properties panel rework, arrows, layer naming), plus the row-thumbnail cache. All checks run against the PACKAGED build, not the dev server. The relay and Twitch items pair with a real stream night.

## This batch

### Under the hood (APP-1, APP-24, APP-27)

- [ ] Two-launch check on Electron 44: with the app in the tray, double-click the exe again; the running instance comes to the front in well under a second, no second tray icon, no window flash, and ffprobe still works hours later (open a file's info).
- [ ] Folder pickers open in the folder last chosen for that setting, else the streams folder, else Videos; the JSON import pickers (YouTube setup, palette import) open in Downloads.
- [ ] No 1 px tall buttons in toolbars after the Tooltip trigger change: eyeball the player transport row, the clip toolbar, the converter row actions, the thumbnail editor toolbar.
- [ ] Nothing looks or behaves differently for the Electron upgrade across a normal session (a black window on first launch is APP-33; note it if it happens, with what was on screen).

### Streams page (STR-2, STR-3, STR-18, STR-19, STR-20, STR-21, STR-23, STR-24, STR-17)

- [ ] Header shows the library size next to the item count; hover breaks it down by videos, clips, images; with cloud sync active it reads as used on this PC out of the full size.
- [ ] Rows show views, likes, dislikes beside the date for linked videos; hover shows exact figures; counts refresh during a session without a manual reload.
- [ ] With Twitch connected, close the sidebar: the Twitch channel panel shows the current title, category, and tag count (tags in the tooltip) and links to the matching stream; that stream carries the Twitch badge in its row; push to Twitch and confirm the panel updates at once.
- [ ] Delete a stream: the row flashes red and slides shut on confirm; no wave of cloud downloads afterward (watch the sync client), which is STR-23's fix.
- [ ] Reschedule: the second step (push the new date) stays open until you choose; the push you tick runs.
- [ ] Archived marker in the files grid is right on first open for an archived file and appears for a freshly finished archive without reopening the stream.
- [ ] Send a cloud-only video to the player: confirm-only dialog, download runs in the widget, the video opens in the player without switching pages; the Player nav item shows it.
- [ ] Row thumbnails (STR-17), on the rebuilt exe: leave the streams page open for an hour or through a stream (rows flipping to a cloud or syncing placeholder must not blank the page); second launch on this build is not slower than before; thumbnail column drag with 200 rows is smooth; hover zoom is smooth; Settings cache size includes the rows folder; Clear cache while the list is open keeps rows showing and refills; re-render a thumbnail in the editor and the row updates; a cloud-only thumbnail keeps its cloud icon.
- [ ] Drag a tag chip in the sidebar with the body scrolled: no regression in chip reorder (auto-scroll only fires near the body's edges).

### Converter and cloud (CONV-8, CONV-9, CONV-10, CONV-11, CONV-12, APP-36, APP-37, COMB-3, COMB-4)

- [ ] Nav aggregate: queue five jobs with the cap at two; the bar climbs from the first job to the last and the count reads done out of total.
- [ ] Set all: pick a preset and an output location, Apply, every ready row takes them; change one row afterward on its own.
- [ ] Drag to reorder the ready list; Start all runs in that order; with the window short, dragging a row near the list's top or bottom scrolls it.
- [ ] Finished card: done, failed, and cancelled jobs move below Converting with counts; an archive group stays whole in Converting until its last file ends; Clear all empties only the Finished card.
- [ ] Cloud: an archive with several cloud files uses every free slot; a job whose download dies fails with the provider's reason instead of waiting forever; Cancel pending shows only with waiting rows and never touches converter downloads; a file requested twice shows one row; Retry all re-runs a card's failures; a download past three minutes shows its elapsed time with the paused-client note.
- [ ] Combine: sources that needed downloading and differ in frame rate stop after the download with the frame-rate note and wait for a second click; thumbnails fill in as cloud files land.

### Player (PLR-2, PLR-21, PLR-27, PLR-23, PLR-24)

- [ ] Alt+arrows skip one minute, Alt+Shift+arrows five, repeating while held; tooltips and Help show them.
- [ ] Selected Stream block: previous and next stream buttons and previous and next episode with the jump list; Ctrl+Up/Down walks streams, Ctrl+Shift+Up/Down episodes; every tooltip names the stream it leads to; the collapsed rail shows the column layout with the thumbnail between the halves.
- [ ] Sidebar header on the streams page has the same prev and next stream buttons beside the episode buttons; the old in-sidebar episode picker is gone.
- [ ] Track names: Settings, Video Player, Default audio track names; name Tracks 1 to 6, open a Hybrid MP4 recording and the rows use them; an MKV with embedded names shows those; double-click a name to rename it for one file; the small source icon beside each name is right in all three cases; the clip export dialog and the converter's track picker use the same names.
- [ ] Alt-drag a clip segment handle: both ends move, shrinking or growing around the center.

### Thumbnail editor, canvas and layers (THU-2, THU-18, THU-24, THU-25, THU-26, THU-27, THU-28, THU-19, THU-29, THU-30, THU-21, THU-1)

- [ ] Polygon tool: new polygons are triangles; Sides 3 to 12 keeps the shape regular and the center put; existing triangles open as three-sided polygons unchanged; corner radius rounds them.
- [ ] Groups: Ctrl+G and Ctrl+Shift+G; a group moves, rotates, resizes, hides, and fades as one; members scale with a resize; three levels deep max with the tooltip saying why past that; click selects the group, double-click reaches the member; drag layers in and out of groups in the panel.
- [ ] Paste lands above the selected layer, inside its group; with nothing selected it lands on top.
- [ ] Rotation: Ctrl snaps 90, Shift 5; the angle readout follows the pointer; move and resize readouts show X and Y, W and H; the Transform fields update live during a gesture and settle on release; no stretch when smart-snap guides light up during a rotate.
- [ ] Pixel snap: on by default beside the grid and smart snap buttons; moves and resizes land on whole pixels; an aspect-locked image keeps its ratio exact; off, sub-pixel values survive; position and size show two decimals; typed values are kept as typed.
- [ ] Alignment panel: appears under the selection on the canvas once one layer is selected; align-to-artboard and align-to-first-selected switch unlock at two or more; it steps aside during a drag, resize, or rotate; flips work.
- [ ] Toolbar: prev and next stream and episode buttons with the jump list; Ctrl+Up/Down and Ctrl+Shift+Up/Down; the stream title's tooltip shows the full title and links back to the streams page.
- [ ] Bracket keys: ] up, [ down, Shift to the end of the level, Enter into a group, Shift+Enter out to the group; the panel scrolls the selected row into view.
- [ ] Selection tab: slides out beside the selection with duplicate, delete, hide, group, ungroup, and the mask actions; hover a button and the affected rows light up; the count shows only for a multi-selection; spine and rounded joins look right at the top and bottom of the list.
- [ ] Masks: every group shows a mask slot; the slot creates a rectangle, ellipse, or polygon fitted to the group or takes an existing shape; members clip to the outline; the mask's own fill, stroke, shadows, and opacity are off and the panel says so; the mask moves, rotates, and resizes with the group; hide it to switch the clip off; release it from the tab or by ungrouping; double-click empty masked space to reach the mask; Apply as mask to the layer below groups an image with the shape above it in one step; the dashed mask outline never appears in an exported PNG.
- [ ] Layers panel drag with more rows than fit: dragging near the top or bottom scrolls the list and the drop indicator follows; the wheel does nothing mid-drag (known, APP-40).

### Thumbnail editor, effects and paint (THU-31, THU-8, THU-9, THU-11, THU-7, THU-10, THU-16, THU-23, THU-20)

- [ ] Group effects: a masked group casts one shadow in the shape of its mask; the group outline traces the silhouette; blur or grayscale applies to the group as one image; effects refresh when an edit lands and pause while a member is moved.
- [ ] Gradient strokes: the Stroke field is the same solid-or-gradient control as Fill with its own stops, angle, style, and blend; a gradient swatch drops onto it; the outline effect stays one color.
- [ ] Gradient kinds: Linear, Radial, Conic in the segmented switch with live swatch previews; radial takes center and radius, conic a center and start angle; swatches remember the kind and reapply it; the spine bar sits on the sidebar edge and the stop rows line up with the kind switch and Add stop.
- [ ] Angle fields wrap: type 400 in a rotation or gradient angle field and it reads 40 after leaving; spinners step from 359 to 0; clearing a 0 and typing a minus sign both work; one undo step per typed entry.
- [ ] Palette: drag a recent swatch between two saved swatches, onto the first and last position, and onto an empty palette; a saved swatch dragged across the grid shows no marker; click still appends.
- [ ] Assets panel: each stream group header has an Open folder button that opens that stream's folder; the header tooltip and truncation still work; the options menu opens upward when the panel sits at the sidebar's foot and flips live when the list collapses.
- [ ] Layer names: three groups read Group 1 to 3; ungroup Group 2 and group again for Group 4; names survive a reload and a variant switch; an older canvas with a Group 2 gets Group 3; text and shapes number the same way; images keep their file name.
- [ ] Arrows: Add arrow gives a 300 by 120 arrow pointing right; rotate and flip; three heads; head length, stem, taper, bend refit the box instead of squashing; the head stays square on a bent stem; corner radius with Sharp tip on and off; gradient fill and stroke, shadow, outline, filters on an arrow; an arrow as a group mask; export.

### Thumbnail editor, properties panel (APP-29, THU-33, THU-34)

- [ ] Cards in the same order for every layer type (image, text, rectangle, ellipse, polygon, arrow, group, mask); collapse state remembered across layers; an empty Shadows card starts collapsed; collapsed summaries read right; header controls work while collapsed; the mask's cards are muted with the reason; the context line names the layer; each card shows its icon.
- [ ] Transform: X and Y left, W and H right, lock between W and H; text shows a read-only height; typing a group's width scales its members; scrub any letter cell (Shift for ten per pixel; pixel snap rounds); a click on a letter focuses the field.
- [ ] Value bars: drag sideways and up or down; rotation wraps past either end; double-click resets to the dotted default; soft maxima accept typed values past the bar (stroke width 150 shows a full bar); opacity and sides stop at their limits.
- [ ] Shadows: entries are divider rows, not boxes; X and Y offsets sit beside each other; Blur is a bar; add, remove, and reorder shadows.
- [ ] Selects (Style, font family, font style, align, the streams header sort, the sidebar category select) sit at the same inset as the inputs beside them; option lists are dark.

### Integrations

- [ ] The Claude mark and terracotta color show on the Integrations card, in Settings, in the nav subline, and in Help; orange remains only for "changed on YouTube", the locked clip region, the combined-file tag, and the Orange tag color.

## Core regression (every release)

- [ ] Relay: full lifecycle on a real or test stream, bind, ingest, live, complete; post-stream Twitch auto-update fires (60 s delay) and the Twitch channel panel reflects it.
- [ ] Watcher/auto-rules: drop a recording into the watch folder; it lands in the right stream item.
- [ ] New stream + New episode: correct season and episode, templates render.
- [ ] YouTube: push and pull a stream's details; thumbnail push; out-of-sync panel clean afterward.
- [ ] Converter: one job start to finish; pause and resume; output plays.
- [ ] Player: open a video, clip draft, export.
- [ ] Thumbnail editor: open, edit, export; variant creation; a saved canvas from v2.6.0 opens unchanged.
- [ ] Cloud: pin local and offload one item; statuses update everywhere.
- [ ] Launcher: run a launch group (window and tray).
- [ ] Quit/relaunch: no orphaned processes, state restored.

## Docs (every release)

- [ ] README.md reviewed against the shipped app: features (one sentence for arrows and groups if anything), prerequisites and versions (Electron 44, Node 24), every link, the hero screenshot from the new shoot, the project layout block (new files: lib/arrow.ts, lib/layerNames.ts, lib/groupMask.ts, hooks/useDragAutoScroll.ts, hooks/useDropdownPlacement.ts, services/rowThumbs.ts, services/streamsWatcher.ts).
- [ ] CONTRIBUTING.md and PRINCIPLES.md still accurate; principles: code citations resolve; the host list is unchanged by this cycle (no new outbound host, credential, or database or telemetry dependency).
- [ ] Style guide: the Angle fields, Native select skin, Drag and drop in scrollable containers, and Anchored popovers rules match what shipped.

## Promotion (after the sweep is green)

1. Release notes: edit `_release-notes-draft.md` into the GitHub copy. Plain category title (this cycle has no theme; the Thumbnail editor section carries the weight), modest scope claims, user vocabulary, no emojis, no em-dashes. Empty the draft afterward.
2. New screenshots land on the website first (the website owns them); the README hero comes from that shoot.
3. Merge dev into master, `npm run release:minor` (v2.7.0), push master and the tag; wait for the release workflow; smoke the CI exe (name, icon, no chips, the two-launch check); paste notes, mark latest, publish; confirm `releases/latest`.
4. Coordinate the website deploy with the website instance (ask before opening a new conversation there); merge master back into dev.
5. Archive this file to `archive/`.
