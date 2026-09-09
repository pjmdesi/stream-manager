# Release notes draft (next release from `dev`)

> Running draft, maintained ON `dev`. When a feature lands, append a line to the right section in the same sitting. At promotion time this gets edited into the GitHub-release copy (trim, reword, reorder headline-first; see `archive/_release-notes-v2.md` for the structure, but NO emojis anywhere) and the file is emptied for the next cycle. Wording here is working-quality, not final. Fixes that already shipped in a hotfix release do NOT belong here. Style lessons from the v2.5.0 edit: plain category titles, modest scope claims, user vocabulary only, no micro-detail.

Target: v2.6.0. RELEASE-READY COPY below (edited 2026-09-09 from the running draft; the sweep is green). Paste everything under the line into the draft GitHub release, then empty this file down to the header for the next cycle.

---

# Finishing touches release

This release finishes features that shipped earlier: markers on the player timeline, a guided YouTube setup, encrypted credentials, and a long list of smaller improvements and fixes across the app.

## Player markers

- The player timeline now shows markers. Press M (or the bookmark button in the playback controls) to add one at the playhead, click a marker to jump to it, and double-click to name it, change its color, or move it to an exact timecode.
- Chapters embedded in video files appear as markers too, including the ones OBS's Hybrid MP4 chapter hotkey writes during a stream. Editing one of those keeps the video file untouched; the edit is stored with the stream's metadata, and a Reset returns to the file's version.

## YouTube setup guide

- Connecting YouTube is now a guided walkthrough from the Integrations page: one step per Google Cloud task, each with a direct link and a plain-language explanation, and a progress checklist that remembers where you left off. Credentials can be imported from the file Google gives you instead of copy-pasting two values, and when Google rejects a step, SM explains the fix instead of showing an error code.
- The guide also covers publishing your Google app. Without that step, Google expires the connection every 7 days.
- Existing connections are untouched. The guide recognizes them and only asks you to confirm the two steps SM cannot check on Google's side.
- The browser page shown after a YouTube or Twitch sign-in now matches SM's look and says what happens next.

## Credentials encrypted at rest

- The YouTube and Twitch tokens, both client secrets, and the Claude API key are now stored encrypted with Windows' per-user encryption instead of as plain text. Existing values migrate on first launch with no reconnect needed. If Windows cannot decrypt them (for example a settings folder copied from another PC), SM shows the service as disconnected and offers a normal reconnect.
- Rolling back: once this version has run, an older SM version cannot read the encrypted values, so YouTube, Twitch, and the Claude key would each need a one-time reconnect or re-entry there.

## Player

- Press and hold anywhere on the timeline to place and then scrub the playhead. Clicking inside a clip region places the playhead too; moving a whole region is done from its timecode tag, which appears on hover.
- Clipping mode and multi-track audio are turned off from the same sidebar slots that turn them on. Ctrl+Shift+M opens and closes multi-track audio.
- The crop controls sit on the video, attached to the crop region. The toolbar keeps a Crop toggle that remembers the last aspect.
- A setup-tips button next to the multi-track toggle opens the Help section on configuring recording software for multi-track audio.
- Holding Shift while arrow-stepping timecode, crop, and volume inputs jumps by 10.
- The player controls adapt to narrow windows: toolbar labels collapse to icons and the transport row drops its larger skip buttons as space runs short.
- Unnamed audio tracks are labeled Track 1, Track 2, and so on, the same numbering OBS shows, instead of guessed names. MP4 files cannot carry track names, so recordings in that container (including OBS's Hybrid MP4) always show numbers; MKV recordings keep the names set in OBS.
- Fixed: clip export failed on recordings that carry a chapter track, such as OBS's Hybrid MP4 output; the frames segment of timecode inputs could get stuck when stepping up; clicking the zoomed timeline near its edges paged the view instead of placing the playhead; clip region edge handles could render blurry.

## Streams

- After pushing a video in a category with a Studio-only field (like Gaming's Game), a reminder stays in the sidebar until it is marked done, instead of only a brief banner.
- Title, description, and tag templates can be duplicated from their rows in the Templates modal; the copy opens for editing right away.
- Set-as-thumbnail is only offered on images that meet YouTube's thumbnail requirements, and the sidebar warns when a stream's current thumbnail would not upload at all.

## Converter and cloud

- The max simultaneous conversions setting is enforced on every start path: manual starts, auto-rules, clip and Short exports, and archive batches. Extra items show as Waiting and start in order as slots free up.
- Quitting while conversions are running brings them back parked on the next launch, and the quit dialog says what will and will not come back. Partial output files are cleaned up.
- Conversions that need to download their file from the cloud now show up in the cloud sync widget and the files grid like other cloud work, and the widget's Cancel stops them.
- Fixed: removed conversion items reappearing after a restart; the source-stream link missing on archive, clip, and restored jobs; cloud status icons stuck after opposite operations on the same file. Cancelling downloads now skips waiting files and keeps a file that was already mid-transfer.

## Thumbnail editor

- Gradients take any number of color stops: click the preview bar to add one where you clicked, drag the markers to reposition, and remove stops from their rows.
- Gradients have a Style option: Smooth (the usual blend) or Hard, which renders each stop as a solid band with crisp edges.
- A "Last used" link under the font dropdown applies the font you last picked.

## App-wide

- UI zoom shows a percentage overlay, survives restarts, and has an exact control in Settings under Appearance.
- Start Minimized has a sub-option to hide to the tray only when Windows launched the app at startup, so manual launches open the window.
- Launching the exe while Stream Manager is already running now just brings the running window forward, within about a second. It used to unpack a second copy for around ten seconds, flash its own window, add a second tray icon, re-ask for firewall permission, and on its way out remove files the running app still needed.
- Launch groups can be duplicated from the open group's header.
- The About window lists the open source libraries the app is built with.

## Under the hood

- Internal color class names were straightened out (the app's slate accent is no longer called purple internally). No visual change.
