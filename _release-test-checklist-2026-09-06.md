# Release test checklist — v2.6.0 (2026-09-06)

Build: Stream Manager 2.5.0_DEV.exe from dev @ a4e3895 (rebuilt 2026-09-07 with the playhead-over-region hover fix; the packaged exe matches this commit). Previous build @ c806c17 ran the 2026-09-06 stream night clean.

FROZEN 2026-09-06: no further feature work on dev for this release. Code changes from here are limited to bugs and other fixes found during this sweep; each one gets a fresh build and an updated hash above.

Batch: the completions release (finishing touches on features) plus the marker system, the YouTube setup guide, and encryption at rest. All checks run against the PACKAGED build, not the dev server. Several player/marker checks pair naturally with a real stream night (OBS chapter hotkey on a Hybrid MP4 recording).

## This batch

### Player markers (IDEA-4)

- [x] Open a Hybrid MP4 recording with hotkey chapters: triangles appear at the right times (Start at 0:00), hover shows name + timecode with "(from file)".
- [x] M drops a marker at the playhead (default gray); M again on the same spot opens its popup instead of duplicating; the bookmark button next to the playhead timecode does the same.
- [x] Single click seeks to the marker; double click opens the edit popup: recolor, rename, move via timecode (arrows step, Shift = x10); popup clamps inside the timeline at the first/last markers.
- [x] Popup closes on any click outside it, including the timeline strips (the click still places the playhead); Escape closes it too. (Fix found during the sweep 2026-09-07: seek surfaces stopped propagation, so only clicks on the controls row or video used to close it.)
- [x] Click a marker, move the playhead, press M: the focus ring is on the NEW marker (not the clicked one) and Enter seeks to the new one; M on an existing marker's spot opens its popup with focus on that marker. (Sweep fix 2026-09-07.)
- [x] In the popup, step the timecode's seconds/frames segment with the timeline fully zoomed out: the popup and its swatch circles stay pixel-stable, no shimmer; the popup still centers on the marker and clamps at the ends. (Sweep fix 2026-09-07; device-pixel snapping rule added to the style guide.)
- [x] Edit a file chapter: reopening the file shows the edit persisted and the popup offers Reset (back to the file's version); an M-added marker offers Delete instead.
- [x] Reset on an edited chapter keeps the popup open showing the file's original name/time/color (no Reset button anymore, since nothing is overridden); Delete on an SM marker still closes it. (Sweep fix 2026-09-07.)
- [x] Markers survive closing/reopening the file and the app; the video file's own bytes are untouched.
- [x] In clip mode zoomed in: markers track the viewport, render above region chrome, and stay clickable; marker layer never pokes through a modal backdrop (open the delete-draft confirm with markers visible).

### Player interactions & layout (PLR-6/11/12/13, APP-22, crop move)

- [x] Press-and-hold anywhere on the timeline (thumbnails, waveform, multi-track rows, inside regions) places then scrubs the playhead; plain click still places precisely; middle-drag still pans.
- [x] Regions: hover shows the timecode pill (grips) attached to the region; dragging the pill moves the region with snapping; clicking inside a region seeks + selects; thumbnail-strip clicks deselect.
- [x] Region pills and handle popups: borders match selection state (light blue selected), 1px overlaps top/bottom, corners round continuously as a pill gets wider than its region.
- [x] Edge handles: consistent 2px width at your zoom/scaling, glow only outside the region.
- [x] Sidebar mode toggles: Start Clipping ↔ red Stop Clipping in the same slot; Open ↔ Close Multi-track Audio above it; collapsed rail shows the X badge on both close states; order is Clipping, Multi-track, Info.
- [x] Clip toolbar: labels collapse to icon-only below ~672px of player width; transport row sheds ±5m, then ±1m, then ±10s as it narrows; nothing wraps at 718px with both sidebars open.
- [x] Multi-track + clip mode: hovering a track row lifts it out of the out-of-region dimming; bleeps on top of rows stay clickable.
- [x] Clip mode: the playhead line stays full-brightness inside the dimmed out-of-region areas and over bleeps; it still passes under region pills/handle popups, and dragging it works as before. (Sweep fix 2026-09-07.)
- [x] Scrub the playhead quickly back and forth through an unselected region: its timecode pill does not flash during the drag; after release, hovering the region shows the pill normally and a selected region keeps its pill throughout. (Sweep fix 2026-09-07.)
- [x] Crop: toolbar Crop toggle reveals the region with its control panel attached (flips inside near the bottom, pins at container edges, tracks stage zoom/pan without scaling); micro spinners step (Shift = x10); middle-click pans from anywhere including the panel; toggle off/on restores the last aspect.
- [x] Timecode inputs: frames segment arrow-steps up AND down everywhere (playhead, marker popup, viewport, duration, handles); Shift = x10 steps the segment under the cursor; playhead readout shows every place value for the video's duration (hours only on 1h+ videos).
- [x] Track volume %: Shift+arrows step 10; crosshair cursor on seek surfaces only.
- [x] Multi-track on a Hybrid MP4 recording: tracks read "Track 1" through "Track N" (no more Game/Mic/Discord/Music/SFX placeholders); a file WITH embedded track titles (an MKV recording) still shows them. (Sweep fix 2026-09-07.)
- [x] Clip toolbar keeps a constant height as the playhead moves in and out of a region (Add Segment / Split Segment swap without a 1px jump). (Sweep fix 2026-09-07.)

### YouTube setup guide (IDEA-11) & OAuth polish

- [x] Integrations card: slim intro + "Open the setup guide" button (reads "Set up with the guided walkthrough" when disconnected); old instruction list gone.
- [x] Wizard on an existing connection: steps 1, 2, 3, 6, 7, 8 are green (proven by the connection); steps 4 and 5 show an amber ellipsis with a tooltip and an in-step note, since SM can't verify publishing; clicking Done on each turns them green and it persists across reopen. "Progress is saved" sits by the close button; copy buttons in steps 3-4 copy the right URLs. (Sweep fix 2026-09-07: previously only 7 and 8 were checked.)
- [x] Connect/reconnect once: Google flow completes against the Desktop-type client, the new callback page shows the styled card (no garbled character), and SM's end-to-end probe reports success in step 8.
- [x] Settings max-conversions and relay port step by 1 even with Shift, tooltips without the Shift note.

### Encryption at rest

- [x] After first launch of the packaged build: app-config.json shows enc1: values for both client secrets + the Claude key; youtube-auth.json and twitch-auth.json tokens are enc1:; expiresAt stays readable.
- [x] YouTube and Twitch work without any re-auth (push or pull something small); AI suggestion works (Claude key decrypts).
- [x] Quit/relaunch: connections persist.

### Converter & cloud (CONV-1/2 + quit behavior)

- [x] Max simultaneous conversions is enforced on every start path: queue 4+ jobs with the cap at 2 (manual starts + an archive batch); excess shows Waiting and starts in order as slots free.
- [x] Converter-triggered downloads appear in the cloud sync widget with per-file rows; files grid cloud icons update live; row thumbnails appear once local.
- [x] Cancel pending: waiting files skip, an in-flight file finishes and stays local; no stuck cloud icons afterward.
- [x] Quit mid-conversion: dialog says what comes back; on relaunch the running job returns parked (nothing auto-starts), partial output file is gone.
- [x] Stream-link on converter rows shows the stream title for archive jobs, clip exports, and restored jobs.
- [ ] Clip export from a Hybrid MP4 recording (chapter data track present) succeeds, including with multi-track audio selected and while another conversion of the same file is running; the exported clip plays and carries no stray chapters. (Sweep fix 2026-09-07: the segment copy mapped the data track into MKV and failed at "Could not write header".)

### Streams (STR-14) & app-wide (APP-12/16/17, APP-9)

- [x] Push a Gaming-category video: reminder appears in the sidebar a few minutes later, persists across restarts, clears when marked done, never returns for that video.
- [x] UI zoom: Ctrl+= / Ctrl+- / Ctrl+0 show the odometer overlay; level survives restart; exact control in Settings > Appearance matches.
- [x] Colors sanity: Purple tag is true purple, Gray tag is the slate accent, Twitch UI purple, no odd accents anywhere (APP-16 fallout check).
- [x] About window lists third-party libraries with working links; tagline is the new one.
- [x] Start Minimized sub-option: with all three toggles on, launching the exe manually opens the window; launching with --from-autostart (or a real reboot) goes to tray; sub-option grays but keeps its checkmark when the parent is off.
- [ ] Second launch is harmless: with SM running (minimize it to the tray first), double-click the exe again. The existing window comes forward, and afterwards opening a video, generating a waveform and running a conversion all still work (the running instance's unpack folder is intact; check that Temp now holds a per-process ns*.tmp\app folder instead of a fixed-name one, and that it disappears after quitting). (Sweep fix 2026-09-08: a second launch used to delete the shared unpack folder under the running instance.)

### Thumbnail editor (THU-7/11)

- [x] Gradients: click the preview bar to add a stop (picks up the ramp's color), drag markers directly, remove stops (2-stop floor), rows stay sorted with the swap animation, Add stop button between rows and angle/style/blend.
- [x] Style dropdown: Hard renders crisp bands (canvas + preview + swatches agree); Blend disables in Hard mode; swatches record and reapply both styles.

### Help modal

- [x] Player section: Markers entry present, M in the shortcut list, Crop bullet describes the on-video controls, Multi-track entry points at the sidebar toggle.

## Ride-alongs (check off as each lands, then test)

- [x] APP-3: lint rule (build-gate only, no runtime check).
- [x] APP-9: covered in app-wide above.
- [x] PLR-7: Ctrl+Shift+M toggles multi-track; tooltip shows the shortcut.
- [x] THU-6: "Last used: [font]" link under the font dropdown applies it; hides after using the dropdown.
- [x] STR-12: duplicate buttons on template and tag items.
- [x] LNCH-2: duplicate launch group (plus its added task).
- [x] STR-10: ineligible image can't be set as thumbnail; existing ineligible primary warns inline on the YouTube thumbnail row.
- [x] PLR-1: multi-track Setup tips button opens Help to the new OBS setup section.
- [x] PLR-5: retest clicking near the playhead's auto-scroll margin (may already be fixed by the scrub rework); fix if it survives.

Not in this release: APP-24 (style-guide audit) deferred to lead the next cycle; STR-17 (row thumbnail resampling) shipped and reverted the same day (blank thumbnail column on startup), stays open with notes.

## Core regression (every release)

- [x] Relay: full lifecycle on a real or test stream — bind → ingest → live → complete; post-stream Twitch auto-update fires (60s delay)
- [x] Watcher/auto-rules: drop a recording into the watch folder → lands in the right stream item
- [x] New stream + New episode: correct season/episode, templates render
- [x] YouTube: push + pull a stream's details; thumbnail push; out-of-sync panel clean afterward
- [ ] Converter: one job start→finish; pause/resume; output plays
- [ ] Player: open a video, clip draft → export. Run it on a recording in the CURRENT recording container (Hybrid MP4 as of 2026-09; name it here if it changes), since the exporter's intermediate step is sensitive to what streams the container carries (2026-09-07: the chapter data track broke every export until this sweep).
- [ ] Thumbnail editor: open, edit, export; variant creation
- [ ] Cloud: pin local + offload one item; statuses update everywhere
- [ ] Launcher: run a launch group (window + tray)
- [ ] Quit/relaunch: no orphaned processes, state restored

## Promotion coordination (this release)

- [ ] APP-18: un-gitignore PRINCIPLES.md and commit it with the release.
- [ ] Website deploy goes out WITH the release: /principles, /app-privacy, /youtube-setup, strengthened encryption wording (tell the website instance when the tag is published).
- [ ] Rollback note is in the release notes (older builds can't read encrypted credentials).
