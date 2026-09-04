# Release notes draft (next release from `dev`)

> Running draft, maintained ON `dev`. When a feature lands, append a line to the right section in the same sitting. At promotion time this gets edited into the GitHub-release copy (trim, reword, reorder headline-first; see `archive/_release-notes-v2.md` for the structure, but NO emojis anywhere) and the file is emptied for the next cycle. Wording here is working-quality, not final. Fixes that already shipped in a hotfix release do NOT belong here. Style lessons from the v2.5.0 edit: plain category titles, modest scope claims, user vocabulary only, no micro-detail.

Target: TBD · emptied 2026-09-01 after the v2.5.0 release.

## Streams

- After pushing a video in a category with a Studio-only field (like Gaming's Game), a reminder now stays in the sidebar until it's marked done, instead of only the brief banner that was easy to miss. It appears a few minutes after the push (no nag if the field gets set right away) and never returns once marked done for that video.

## Converter

- The max simultaneous conversions setting is now enforced everywhere. Manually started conversions, auto-rule conversions, clip and Short exports from the player, and archive batches whose files just finished downloading from the cloud all wait for a free slot instead of piling on. Waiting items show a "Waiting" state and start automatically, in order, as slots free up.
- Removed conversion items no longer reappear after an app restart. A stale snapshot of the queue could survive in storage when a downloading job was cancelled and cleared, resurrecting it on the next launch.
- Quitting while conversions are running now brings those items back on the next launch, parked alongside the ones that were waiting, ready to start manually. Nothing starts encoding unattended at launch. Archive batches are still forgotten on quit (redoing the archive is the safe path), and clip exports cannot survive a restart since their edit settings only exist while the app runs.
- The link back to the source stream on conversion rows now shows for every job whose file lives in a stream folder, including archive jobs, clip exports, and jobs restored after a restart, and it displays the stream's title (falling back to the folder date when there is none). Files from outside the library still show no link, as intended.

## Under the hood

- The app's accent color classes are named honestly now: the internal "purple" class family (which actually rendered the slate accent) is renamed accent-*, and Tailwind's real purple is back for things that are genuinely purple, like the Purple tag color. No visual change anywhere.
