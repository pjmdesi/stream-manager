# Release notes draft (next release from `dev`)

> Running draft, maintained ON `dev`. When a feature lands, append a line to the right section in the same sitting. At promotion time this gets edited into the GitHub-release copy (trim, reword, reorder headline-first; see `archive/_release-notes-v2.md` for the structure, but NO emojis anywhere) and the file is emptied for the next cycle. Wording here is working-quality, not final. Fixes that already shipped in a hotfix release do NOT belong here. Style lessons from the v2.5.0 edit: plain category titles, modest scope claims, user vocabulary only, no micro-detail.

Target: TBD · emptied 2026-09-01 after the v2.5.0 release.

## Streams

- After pushing a video in a category with a Studio-only field (like Gaming's Game), a reminder now stays in the sidebar until it's marked done, instead of only the brief banner that was easy to miss. It appears a few minutes after the push (no nag if the field gets set right away) and never returns once marked done for that video.

## Player

- The player timeline now shows markers. Press M (or the bookmark button in the playback controls) to add one at the playhead, click a marker to jump to it, and double-click to name it, change its color, or move it to an exact timecode. Chapters embedded in video files show up as markers too, including the ones OBS's Hybrid MP4 chapter hotkey writes during a stream. SM-added markers are saved in the stream's metadata next to the file; video files are never modified.
- Fixed the frames segment of timecode inputs getting stuck when stepping up with the arrow keys (a floating-point rounding issue could display a frame value one frame low, so each up-step was read back and cancelled out).
- Clipping mode and multi-track audio are now proper mode toggles in the player sidebar. Start Clipping swaps to Stop Clipping in the same spot while clipping (the clip toolbar no longer duplicates it), and multi-track audio is opened and closed from the same slot right above it instead of a chip under the waveform.
- Clip region edge handles now land on whole pixels, with a subtle glow only on the outer side of each edge. Fractional positioning used to blur the handles into a both-sides shimmer.
- Clip regions are easier to work with. Clicking inside a region now places the playhead (and selects the region) instead of being reserved for dragging; moving the whole region lives on its timecode tag, which now appears on hover with drag grips and connects visually to the region's border. Clicking the thumbnail strip deselects a region, the same as clicking the waveform always did.

- Holding Shift while arrow-stepping an input jumps by 10x everywhere stepping exists: timecode inputs (10 of whatever segment the cursor is on), the crop tool's position and size fields, and the track volume, matching the number fields that already did this. Tiny-range settings like max simultaneous conversions and the relay port deliberately keep plain stepping.
- The crop controls moved out of the clip toolbar and onto the video itself, attached to the crop region (following it as it moves, flipping inside when there's no room below, staying in view at the container edges). The toolbar keeps a simple Crop toggle that remembers your last aspect, and the position/size fields gained tiny +/- steppers.
- The player controls now adapt to narrow windows: clip toolbar buttons collapse to icons and the transport row sheds its larger skip buttons (5m first, then 1m, then 10s) when space runs short. Keyboard shortcuts are unaffected. In clipping mode, hovering a track row also lifts it out of the out-of-region dimming so its controls read as usable.

## Converter

- The max simultaneous conversions setting is now enforced everywhere. Manually started conversions, auto-rule conversions, clip and Short exports from the player, and archive batches whose files just finished downloading from the cloud all wait for a free slot instead of piling on. Waiting items show a "Waiting" state and start automatically, in order, as slots free up.
- Removed conversion items no longer reappear after an app restart. A stale snapshot of the queue could survive in storage when a downloading job was cancelled and cleared, resurrecting it on the next launch.
- Quitting while conversions are running now brings those items back on the next launch, parked alongside the ones that were waiting, ready to start manually. Nothing starts encoding unattended at launch, and the quit dialog now says exactly what will and won't come back. Archive batches are still forgotten on quit (redoing the archive is the safe path), and clip exports cannot survive a restart since their edit settings only exist while the app runs.
- Conversions that need to download their file from the cloud now announce it the same way pinning files locally does: per-file rows in the cloud sync widget, live cloud-status icons and spinners in the files grid, and converter row thumbnails appearing as soon as the file lands. The widget's Cancel stops converter downloads too.
- The link back to the source stream on conversion rows now shows for every job whose file lives in a stream folder, including archive jobs, clip exports, and jobs restored after a restart, and it displays the stream's title (falling back to the folder date when there is none). Files from outside the library still show no link, as intended.

## App-wide

- Zooming the UI now shows a percentage overlay (with odometer-rolling digits) so you can see where you landed, the zoom level survives restarts, and an exact zoom control lives in Settings under Appearance. The shortcuts (Ctrl+=, Ctrl+-, Ctrl+0) step through browser-style zoom levels.
- The About window lists the open source libraries the app is built with, each linking to its project page.

## Thumbnail editor

- Gradients have a Style option: Smooth (the usual blend) or Hard, which renders each stop as a solid band with crisp edges halfway to its neighbors, the easy way to build striped and split-color effects without stacking extra layers.
- Gradients now take any number of color stops. Click the preview bar to add a stop exactly where you clicked (it picks up the gradient's existing color at that spot, so the ramp doesn't jump), drag the arrow markers to reposition stops directly, and remove stops from their rows (a gradient keeps at least two). Works in both blend modes and records into gradient swatches like before.

## Integrations

- Connecting YouTube got a guided setup. A walkthrough opens from the Integrations page with one step per Google Cloud task, each with a direct link, plain-language explanation, and a progress checklist that remembers where you left off. Credentials can be imported straight from Google's downloaded JSON file instead of copy-pasting two values (with clear guidance on keeping that file private), and when Google rejects a step, SM explains the actual fix instead of showing a raw error code. The guide also covers publishing your Google app, without which Google silently expires the connection every 7 days, and recommends the Desktop app credential type, which removes the redirect-URI step from the old instructions entirely. Existing connections are untouched.

## Cloud sync

- Cancelling downloads is honest now: waiting files are skipped, and a file already mid-transfer finishes and stays on your PC, since transfers can't be interrupted and throwing away a completed download would waste the bandwidth already spent. The Cancel button's tooltip explains exactly what it does.
- Cloud status icons in the files grid no longer get stuck on a stale state after opposite operations on the same file (like offloading a file that was downloaded earlier in the session).
- Quitting while a conversion is running now cleans up the partial output file it leaves behind; if the sync client briefly locks the file, the cleanup finishes on the next launch instead of leaving a corrupt file in the stream folder.

## Under the hood

- Stored credentials are now encrypted at rest. The YouTube and Twitch tokens, both client secrets, and the Claude API key were previously plain text in SM's settings files; they are now encrypted with Windows' user-profile encryption (DPAPI, via Electron's safeStorage). Existing values migrate silently on first launch with no reconnect needed. If the OS ever can't decrypt them (for example a settings folder copied from another machine), SM treats the service as disconnected and offers a normal reconnect instead of failing.

- The app's accent color classes are named honestly now: the internal "purple" class family (which actually rendered the slate accent) is renamed accent-*, and Tailwind's real purple is back for things that are genuinely purple, like the Purple tag color. No visual change anywhere.
