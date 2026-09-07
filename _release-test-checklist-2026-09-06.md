# Release test checklist — v2.6.0 (2026-09-06)

Build: Stream Manager X.X.X_DEV.exe from dev @ <fill hash after final build>

Batch: the completions release (finishing touches on features) plus the marker system, the YouTube setup guide, and encryption at rest. All checks run against the PACKAGED build, not the dev server. Several player/marker checks pair naturally with a real stream night (OBS chapter hotkey on a Hybrid MP4 recording).

## This batch

### Player markers (IDEA-4)

- [ ] Open a Hybrid MP4 recording with hotkey chapters: triangles appear at the right times (Start at 0:00), hover shows name + timecode with "(from file)".
- [ ] M drops a marker at the playhead (default gray); M again on the same spot opens its popup instead of duplicating; the bookmark button next to the playhead timecode does the same.
- [ ] Single click seeks to the marker; double click opens the edit popup: recolor, rename, move via timecode (arrows step, Shift = x10); popup clamps inside the timeline at the first/last markers.
- [ ] Edit a file chapter: reopening the file shows the edit persisted and the popup offers Reset (back to the file's version); an M-added marker offers Delete instead.
- [ ] Markers survive closing/reopening the file and the app; the video file's own bytes are untouched.
- [ ] In clip mode zoomed in: markers track the viewport, render above region chrome, and stay clickable; marker layer never pokes through a modal backdrop (open the delete-draft confirm with markers visible).

### Player interactions & layout (PLR-6/11/12/13, APP-22, crop move)

- [ ] Press-and-hold anywhere on the timeline (thumbnails, waveform, multi-track rows, inside regions) places then scrubs the playhead; plain click still places precisely; middle-drag still pans.
- [ ] Regions: hover shows the timecode pill (grips) attached to the region; dragging the pill moves the region with snapping; clicking inside a region seeks + selects; thumbnail-strip clicks deselect.
- [ ] Region pills and handle popups: borders match selection state (light blue selected), 1px overlaps top/bottom, corners round continuously as a pill gets wider than its region.
- [ ] Edge handles: consistent 2px width at your zoom/scaling, glow only outside the region.
- [ ] Sidebar mode toggles: Start Clipping ↔ red Stop Clipping in the same slot; Open ↔ Close Multi-track Audio above it; collapsed rail shows the X badge on both close states; order is Clipping, Multi-track, Info.
- [ ] Clip toolbar: labels collapse to icon-only below ~672px of player width; transport row sheds ±5m, then ±1m, then ±10s as it narrows; nothing wraps at 718px with both sidebars open.
- [ ] Multi-track + clip mode: hovering a track row lifts it out of the out-of-region dimming; bleeps on top of rows stay clickable.
- [ ] Crop: toolbar Crop toggle reveals the region with its control panel attached (flips inside near the bottom, pins at container edges, tracks stage zoom/pan without scaling); micro spinners step (Shift = x10); middle-click pans from anywhere including the panel; toggle off/on restores the last aspect.
- [ ] Timecode inputs: frames segment arrow-steps up AND down everywhere (playhead, marker popup, viewport, duration, handles); Shift = x10 steps the segment under the cursor; playhead readout shows every place value for the video's duration (hours only on 1h+ videos).
- [ ] Track volume %: Shift+arrows step 10; crosshair cursor on seek surfaces only.

### YouTube setup guide (IDEA-11) & OAuth polish

- [ ] Integrations card: slim intro + "Open the setup guide" button (reads "Set up with the guided walkthrough" when disconnected); old instruction list gone.
- [ ] Wizard opens with all steps checked for the existing connection; "Progress is saved" sits by the close button; copy buttons in steps 3-4 copy the right URLs.
- [ ] Connect/reconnect once: Google flow completes against the Desktop-type client, the new callback page shows the styled card (no garbled character), and SM's end-to-end probe reports success in step 8.
- [ ] Settings max-conversions and relay port step by 1 even with Shift, tooltips without the Shift note.

### Encryption at rest

- [ ] After first launch of the packaged build: app-config.json shows enc1: values for both client secrets + the Claude key; youtube-auth.json and twitch-auth.json tokens are enc1:; expiresAt stays readable.
- [ ] YouTube and Twitch work without any re-auth (push or pull something small); AI suggestion works (Claude key decrypts).
- [ ] Quit/relaunch: connections persist.

### Converter & cloud (CONV-1/2 + quit behavior)

- [ ] Max simultaneous conversions is enforced on every start path: queue 4+ jobs with the cap at 2 (manual starts + an archive batch); excess shows Waiting and starts in order as slots free.
- [ ] Converter-triggered downloads appear in the cloud sync widget with per-file rows; files grid cloud icons update live; row thumbnails appear once local.
- [ ] Cancel pending: waiting files skip, an in-flight file finishes and stays local; no stuck cloud icons afterward.
- [ ] Quit mid-conversion: dialog says what comes back; on relaunch the running job returns parked (nothing auto-starts), partial output file is gone.
- [ ] Stream-link on converter rows shows the stream title for archive jobs, clip exports, and restored jobs.

### Streams (STR-14) & app-wide (APP-12/16/17, APP-9)

- [ ] Push a Gaming-category video: reminder appears in the sidebar a few minutes later, persists across restarts, clears when marked done, never returns for that video.
- [ ] UI zoom: Ctrl+= / Ctrl+- / Ctrl+0 show the odometer overlay; level survives restart; exact control in Settings > Appearance matches.
- [ ] Colors sanity: Purple tag is true purple, Gray tag is the slate accent, Twitch UI purple, no odd accents anywhere (APP-16 fallout check).
- [ ] About window lists third-party libraries with working links; tagline is the new one.
- [ ] Start Minimized sub-option: with all three toggles on, launching the exe manually opens the window; launching with --from-autostart (or a real reboot) goes to tray; sub-option grays but keeps its checkmark when the parent is off.

### Thumbnail editor (THU-7/11)

- [ ] Gradients: click the preview bar to add a stop (picks up the ramp's color), drag markers directly, remove stops (2-stop floor), rows stay sorted with the swap animation, Add stop button between rows and angle/style/blend.
- [ ] Style dropdown: Hard renders crisp bands (canvas + preview + swatches agree); Blend disables in Hard mode; swatches record and reapply both styles.

### Help modal

- [ ] Player section: Markers entry present, M in the shortcut list, Crop bullet describes the on-video controls, Multi-track entry points at the sidebar toggle.

## Ride-alongs (check off as each lands, then test)

- [ ] APP-3: lint rule (build-gate only, no runtime check).
- [x] APP-9: covered in app-wide above.
- [ ] PLR-7: Ctrl+Shift+M toggles multi-track; tooltip shows the shortcut.
- [ ] THU-6: "Last used: [font]" link under the font dropdown applies it; hides after using the dropdown.
- [ ] STR-12: duplicate buttons on template and tag items.
- [ ] LNCH-2: duplicate launch group (plus its added task).
- [ ] STR-10: ineligible image can't be set as thumbnail; existing ineligible primary warns inline on the YouTube thumbnail row.
- [ ] PLR-1: multi-track Setup tips button opens Help to the new OBS setup section.
- [ ] PLR-5: retest clicking near the playhead's auto-scroll margin (may already be fixed by the scrub rework); fix if it survives.
- [ ] APP-24: style-guide audit (doc-only, no runtime check).

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

## Promotion coordination (this release)

- [ ] APP-18: un-gitignore PRINCIPLES.md and commit it with the release.
- [ ] Website deploy goes out WITH the release: /principles, /app-privacy, /youtube-setup, strengthened encryption wording (tell the website instance when the tag is published).
- [ ] Rollback note is in the release notes (older builds can't read encrypted credentials).
