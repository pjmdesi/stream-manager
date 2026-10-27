# Release test checklist: v2.8.0 (2026-10-27)

Build: Stream Manager 2.7.1_DEV.exe from dev @ cec4e33 (the APP-28 commit). Fixes found during the sweep get a fresh build and an updated hash here.

Sweep fixes so far (each needs a fresh build; update the hash above when cut):

- (none yet)

FROZEN 2026-10-26: the queue is fully built. Code changes from here are limited to bugs and fixes found during this sweep.

Batch: no single theme. A converter safety round (temporary names for every write, one list of ffmpeg processes, the archive that would come out larger), the YouTube link picker with its best match, the files grid's converter mark, the player's zoom bar and per-frame time, a thumbnail editor fix round, the dump-folder retirement notice, one look for the stream navigation group, and the dependency update to Electron 44.5.1.

Every item below is checked in the packaged build, not the dev server. An item that fails gets a line under "Sweep fixes so far" with the date, the cause once known, and the commit of the fix.

## This batch

### Under the hood (APP-43, APP-41, APP-21, APP-48, APP-49, APP-51)

- [ ] The installed app carries one ffprobe build, the Windows 64-bit one; the download is about a third smaller than 2.7.1's.
- [ ] Nothing looks or behaves differently for the Electron 44.5.1 update across a normal session: launch, tray, the window controls, a stream night's relay lifecycle (covered again under Core regression).
- [ ] Two-launch check: with the app in the tray, double-click the exe again; the running instance comes to the front, no second tray icon, no window flash.

### Converter (CONV-15, CONV-16, CONV-17, CONV-18, CONV-13, CONV-4, CONV-25)

- [ ] Archive a recording the preset cannot shrink (a short, already small file): the original stays, the row says the result was larger and is kept for two hours, Replace anyway asks before replacing, Discard now removes the larger file, and the stream is marked archived only after a real replacement.
- [ ] A converting row shows the source size beside the source name, the output size growing beside the output name, an estimated final size with its share of the source from 5 percent on, and the time remaining; the Combine page shows the same while it runs.
- [ ] Every conversion, archive, clip export and combine lands in the log on this PC: Settings, under System, Open logs folder; the records carry the files, the preset and its settings, the timings and how it ended.
- [ ] A finished row's button reads Clear, a queued row's and the ready list's read Remove, all with the list icon and a gray hover; each tooltip says the files on disk are not touched; the Combine page's Clear job, Remove job and per-file remove read the same way.
- [ ] A converting row at a narrow window: the percentage sits under the status icon in the icon's color, the figures stay on one line with the folder link visible, and the buttons collapse to icons below about 900 px of row width.
- [ ] While a job runs, the output folder holds a temporary name; the final name appears only when the job ends. Cancel a job mid-write: no half-written file under the final name, and the kept partial is a "-partial" sibling that never takes an existing file's name.
- [ ] Cancel a job in the moment after Start: no ffmpeg process lingers in Task Manager; the Converting list's Cancel all asks first and stops every job; quit the app with jobs running and the relay bound: no ffmpeg or relay process survives.
- [ ] Drop a folder with subfolders on the Converter, the Combine page and the Player: the video files inside come in, other files are left out and the drop zone says what it skipped; the browse dialog behaves the same.

### Streams (STR-39, STR-42, STR-40, STR-41, STR-37, STR-47, STR-51, STR-20)

- [ ] Link a video: the picker opens in place of the old menu with the stream and its current link at the top, a search field, and the channel's videos as rows with a thumbnail, the date, the privacy, livestream or upload, and the id; the privacy opens the video, the id opens it in Studio, each with a copy button; videos linked to another stream stay behind the filter; the stream and episode arrows work inside the picker; a second open lists at once from the kept list and picks up only newer videos.
- [ ] For a stream with no link the picker leads with a Best match row and its reasons (length, title, tags, date, or the uploaded file's name); a linked stream shows no best match.
- [ ] The sidebar footer shows the linked video as the picker's row with the date, privacy and id, and the Broadcast options under it; Link, Change and Unlink sit on the heading; for an upcoming stream with no link, Push to YouTube creates the broadcast with the chosen privacy, date and time and pushes the details, category and thumbnail included.
- [ ] Convert a recording with a regular preset: the result's badge in the files grid carries the bolt, hover reads "Converted by Stream Manager"; an archived file keeps the green archive icon alone; a clip export and a combined file get the bolt after their first visit; offload the converted file and the placeholder keeps the bolt; a conversion from before this build shows none.
- [ ] Import a YouTube video for a day that already has a stream: the summary row says so with the folder name, the heading counts it, a free date shows no notice, and two videos from one day in one run mark only the second.
- [ ] Delete a file from the files grid: the dialog names the file and its size, says when the file is offloaded, and the select-mode Delete asks the same way.
- [ ] Turn on select mode and tick rows, then open a stream item from the converter's link or the player's Selected Stream block: the item opens with select mode off and nothing ticked.
- [ ] Widen the window until the streams page's buttons show labels, visit the player and come back: the labels are in place at once, no slide; an open detail sidebar is there at full opacity, no fade; a real resize still animates the labels.
- [ ] New stream on a date that has one: the dialog says so, names the folder it will get, and creates it alongside; a dump library says it holds one stream per date instead.
- [ ] The archived marker sits inside the Recording, Clip or Combined badge for every kind of video, never beside the name.

### Player (PLR-31, PLR-35, PLR-26, PLR-30, PLR-32, PLR-38)

- [ ] Move to a previous or next stream whose videos are all in the cloud: no download starts on its own and no error shows; the stream opens with its videos and their cloud status, a click downloads one, a second click opens it once it has landed.
- [ ] Session Videos fills in at once when a video opens or the stream changes, with each file's cloud status following a moment later, never the previous stream's files.
- [ ] Click the Selected Stream title or thumbnail, in the open panel and in the collapsed rail: the Streams page opens on that stream; the prev, next and jump controls still change the player's stream and never leave the page.
- [ ] Drag a track's volume slider, release, press Space or an arrow: the player responds, not the slider; the same when the drag ends off the slider; a slider reached with Tab keeps the arrow keys until a click elsewhere.
- [ ] The clip toolbar ends with Export Clip and shows no timecodes or zoom readout; the zoom bar's handles read their bound and the zoom on hover, the thumb its visible length, the needle the playhead time; each tooltip stays up through its own drag and follows the handle; while one part is dragged the others show neither tooltip nor hover tint, and the cursor keeps the drag's shape; the markers show as ticks in their colors above the thumb and under the needle; the needle and the timeline's playhead move in step with the cursor; the 0 key still resets the zoom.
- [ ] Zoom the video stage to the maximum in clip mode with a crop on: the percentage badge stays above the crop controls and resets the zoom on click.
- [ ] Play at 1x: the timecode's frame digits count every frame and both playheads move continuously; at 2x and 0.25x the same; at 8x one playhead, moving steadily, with the decoder's own hiccups only.

### Combine (COMB-6)

- [ ] A file dropped from outside a stream shows an "External file" line where a stream's name would be, and every row has the same height.

### Cloud sync (SYNC-8, SYNC-9)

- [ ] Offload a file the sync client has not finished uploading, or whose cloud copy the client registered at another size: the file stays and its row in the Cloud sync window says why; retry after the client has caught up and it offloads.
- [ ] In a dump-folder library, Offload and Pin local on one stream act on that stream's files only.

### Thumbnail editor (THU-40, THU-42, THU-45, NAV-1, THU-35, THU-43, STR-39's nav)

- [ ] The flip buttons in the floating alignment panel flip the right way: horizontal mirrors left to right, vertical top to bottom.
- [ ] The episode picker in the top bar opens centered under its List button, fully visible beside the rail; in the streams sidebar it is centered under its button too; from the bottom half of the window it opens upward.
- [ ] With a thumbnail open, use the arrows to reach a stream with no thumbnail and pick a template with images: the editor stays open and the stream folder holds the PNG and JSON within a few seconds; Start blank stays open and writes nothing until the first edit; arrow onward and back and the canvas reopens with its layers; delete a saved thumbnail's PNG and JSON in Explorer while it is open and the editor returns to the overview.
- [ ] Reach a stream whose title uses merge fields through the arrows: the Thumbnails entry in the navigation and the recents row show the rendered title, not the template.
- [ ] Paste an image and press Ctrl+Z: the layer goes and the layer panel's toolbar goes with it; Ctrl+Y brings the layer back unselected; undo of an edit that removes nothing keeps the selection.
- [ ] Select three layers with gaps and press Ctrl+] repeatedly: they close up as they climb and stop at the top as a block; Ctrl+[ walks them back; Ctrl+Shift+] with two selected puts both at the top of their parent in order; drag one of two selected rows to a new spot and both land there in order; drag an unselected row and only it moves; two shapes dragged onto a mask slot do nothing, one shape still drops in.
- [ ] The navigation group is there the moment the editor opens, grayed for the second the stream list takes, then live; a single stream in the library shows the arrows disabled, never hidden.

### Across the app (NAV-2, APP-41 sweep)

- [ ] The prev and next stream buttons, the episode picker and the episode pair look the same in the streams sidebar, the player's Selected Stream block, the player's collapsed rail, the thumbnail editor's top bar and the link picker: same size and icons, each group on a slightly darker field.
- [ ] The small action buttons in converter and combine rows, file cards and the files-grid toolbar are brighter at rest and a disabled one stands apart from its neighbors.
- [ ] The Converter, Combine and Player accept a WMV, an M4V and an M2TS from their drop zones and open dialogs.

### Settings (APP-55, APP-28, the thumbnail defaults, Default Watch Directory, episode numbering)

- [ ] The three removed thumbnail settings are gone; a new thumbnail starts in the built-in editor; a file made elsewhere is added to a stream like any other file.
- [ ] Change a setting: its blue dot reads "Changed, not saved yet. Save applies it." on hover, the section chip reads "Unsaved changes in this section. Save applies them.", a clean chip shows nothing, and Save clears both.
- [ ] Set Default Watch Directory, add an auto-rule: the rule starts with that folder filled in.
- [ ] Number episodes automatically off: a new episode starts with an empty episode number; on: it fills in the next number for the topic and season.
- [ ] In this _DEV build, Settings shows the yellow Dev Tools section with Reset onboarding first, then Reset one-time notices; press it and the first-archive notice returns at the next archive.

### Dump-folder libraries (APP-54)

- [ ] On a test library in the dump layout, first launch of this build: the retirement notice shows once; Not now leaves a yellow strip at the top of the Streams page; Convert on the strip opens the conversion modal; after converting, the strip is gone and the library opens as folder-per-stream.
- [ ] Settings in dump mode shows the retirement line beside Convert to folder-per-stream and the button opens the same modal.
- [ ] Settings, run setup again on a folder of dated files: one banner with the stream count, "Dump folder detected" and the retirement line; no mode cards; Next opens the Convert step with the same banner, Update structure (Recommended) stacked on two lines, and Skip for now as the way past it; a folder-per-stream library sets up with no mention of modes.
- [ ] A folder-per-stream library shows no notice and no strip anywhere.

## Core regression (every release)

- [ ] Relay: full lifecycle on a real or test stream, bind, ingest, live, complete; post-stream Twitch auto-update fires (60 s delay) and the Twitch channel panel reflects it.
- [ ] Watcher/auto-rules: drop a recording into the watch folder; it lands in the right stream item.
- [ ] New stream + New episode: correct season and episode, templates render.
- [ ] YouTube: push and pull a stream's details; thumbnail push; out-of-sync panel clean afterward.
- [ ] Converter: one job start to finish; pause and resume; output plays.
- [ ] Player: open a video, clip draft, export.
- [ ] Thumbnail editor: open, edit, export; variant creation; a saved canvas from v2.7.1 opens unchanged.
- [ ] Cloud: pin local and offload one item; statuses update everywhere.
- [ ] Launcher: run a launch group (window and tray).
- [ ] Quit/relaunch: no orphaned processes, state restored.

## Docs (every release)

- [ ] README.md reviewed against the shipped app (features, prerequisites, links, hero screenshot, layout block). Open the Discord invite in a browser: a dead invite still answers 200, so a status check proves nothing.
- [ ] CONTRIBUTING.md and PRINCIPLES.md still accurate (principles: code citations resolve).
- [ ] `npm audit` read, both ways: the full count and `npm audit --omit=dev` (what ships). Anything in the shipped set gets fixed or a written reason in the todo before promotion.
- [ ] Style guide: the rules added this cycle (logs, every image has a fallback, stable button positions, the Remove tier, the stream navigation group, the files grid converter mark) describe what shipped.
- [ ] Website: the Get started page's dump-folder sentence is updated with the website instance before the release is announced.

## Promotion (after the sweep is green)

1. Release notes: edit `_release-notes-draft.md` into the GitHub copy. Plain category titles, modest scope claims, user vocabulary, no emojis, no em-dashes. The dump-folder retirement gets its own short section, since it is the one line users must read.
2. New screenshots land on the website first (the website owns them); the README hero comes from that shoot.
3. Merge dev into master, `npm run release:minor` (v2.8.0), push master and the tag; wait for the release workflow; smoke the CI exe (name, icon, no chips, the two-launch check); paste notes, mark latest, publish; confirm the release page.
4. Coordinate the website deploy with the website instance (ask before opening a new conversation there); merge master back into dev.
5. Archive this file to `archive/`.
