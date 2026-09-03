# Release notes draft (next release from `dev`)

> Running draft, maintained ON `dev`. When a feature lands, append a line to the right section in the same sitting. At promotion time this gets edited into the GitHub-release copy (trim, reword, reorder headline-first; see `archive/_release-notes-v2.md` for the structure, but NO emojis anywhere) and the file is emptied for the next cycle. Wording here is working-quality, not final. Fixes that already shipped in a hotfix release do NOT belong here. Style lessons from the v2.5.0 edit: plain category titles, modest scope claims, user vocabulary only, no micro-detail.

Target: TBD · emptied 2026-09-01 after the v2.5.0 release.

## Streams

- After pushing a video in a category with a Studio-only field (like Gaming's Game), a reminder now stays in the sidebar until it's marked done, instead of only the brief banner that was easy to miss. It appears a few minutes after the push (no nag if the field gets set right away) and never returns once marked done for that video.

## Under the hood

- The app's accent color classes are named honestly now: the internal "purple" class family (which actually rendered the slate accent) is renamed accent-*, and Tailwind's real purple is back for things that are genuinely purple, like the Purple tag color. No visual change anywhere.
