# Release notes draft (next release from `dev`)

> Running draft, maintained ON `dev`. When a feature lands, append a line to the right section in the same sitting. At promotion time this gets edited into the GitHub-release copy (trim, reword, reorder headline-first; see `archive/_release-notes-v2.md` for the structure, but NO emojis anywhere) and the file is emptied for the next cycle. Wording here is working-quality, not final. Fixes that already shipped in a hotfix release do NOT belong here. Style lessons from the v2.5.0 edit: plain category titles, modest scope claims, user vocabulary only, no micro-detail.

Target: TBD · emptied 2026-09-09 after the v2.6.0 release.

## Under the hood

- Stream Manager now runs on Electron 44 (Chromium 152, Node 24), up from Electron 34, which had been out of support since mid-2025. This brings ten versions of browser engine security fixes and performance work to the app. No visible changes are intended; if something looks or behaves differently after updating, that is worth a bug report.
- Folder pickers open somewhere sensible again: the folder you last chose for that setting, otherwise your streams folder, otherwise Videos. The new Electron would have opened them in Downloads.
- Buttons that carry a tooltip no longer render a pixel taller than their neighbors in a few toolbars. The tooltip wrapper is now a block-level box, which removes the stray line spacing that caused it.

## Streams

- The archived marker on files in the files grid is reliable now. It is recorded with the file's other details when Stream Manager reads the file, instead of being re-checked every time the grid opens, which sometimes missed it (and never noticed a freshly finished archive until the stream was reopened).
- Sending a cloud-offloaded video to the player no longer holds a dialog open while it downloads. Confirming starts the download in the background through the cloud sync widget, and when it finishes the video opens in the player without switching you to it (the Player item in the navigation shows what is open). The old dialog also offered to cancel the download, which was never actually possible; that option is gone.

## Converter

- The combined progress shown under the Converter item in the navigation now reflects the whole batch. Jobs still waiting for a slot count at zero and finished jobs count as complete, so the bar climbs steadily from the first job to the last instead of only tracking whatever happens to be encoding. The job count next to it now reads as completed out of total.
- The ready list has a Set all group in its header: pick an encode preset and an output location once, click Apply, and every file in the list takes them. Each row can still be changed on its own afterwards.

## Integrations

- The Claude connection now shows Claude's own mark and color on the Integrations page, in Settings, in the sidebar status, and in Help, in place of a generic robot icon in orange. Orange in the app means "YouTube has a newer value" and is no longer shared with Claude.
