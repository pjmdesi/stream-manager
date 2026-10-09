# Release notes draft (next release from `dev`)

> Running draft, maintained ON `dev`. When a feature lands, append a line to the right section in the same sitting. At promotion time this gets edited into the GitHub-release copy (trim, reword, reorder headline-first; see `archive/_release-notes-v2.md` for the structure, but NO emojis anywhere) and the file is emptied for the next cycle. Wording here is working-quality, not final. Fixes that already shipped in a hotfix release do NOT belong here. Style lessons from the v2.5.0 edit: plain category titles, modest scope claims, user vocabulary only, no micro-detail.

Target: TBD · emptied 2026-10-02 after the v2.7.0 release. The "Questions and bug reports" section at the bottom is standing copy: it stays through every emptying and closes every release.

## Under the hood

- The download is about a third smaller. The packaged app carried ffprobe builds for macOS and Linux and a 32-bit Windows one that could never run; only the one for your machine ships now.
- Routine dependency update: Electron 44.5.1 and current versions of the build and UI libraries, which clears every known advisory in the packages the app ships except one in the auto-rules file watcher that only a rule pattern you write yourself could trigger.

## Fixes

- In a dump-folder library, Offload and Pin local on a stream now act on that stream's files only; they used to queue the whole folder.
- Conversions, archives, clip exports and combined files are now written under a temporary name and checked before they take their final name. A cloud sync client no longer sees a file while it is still being written, and a result that did not finish properly is kept aside and reported instead of being treated as done. An archive's original is removed only after the replacement has passed that check.

## Across the app

- The small action buttons in rows and file cards (the converter and combine rows, the file cards and their toolbar) are brighter at rest, matching the stream sidebar's Archive and Delete, and a disabled one now stands apart from its neighbors.
- The Converter, Combine and Player accept every video format a stream folder can hold (WMV, M4V, MPG, M2TS and the rest), where their drop zones and open dialogs used to take seven.

## Settings

- Three thumbnail settings that no longer did anything are gone: use the built-in creator by default, default built-in template, and default external template. Thumbnails start in the built-in editor, and a file made elsewhere is added to a stream like any other file.
- Default Watch Directory now does what it says: adding a new auto-rule starts with that folder filled in.
- The episode numbering setting works now, under its new name, Number episodes automatically. Off, a new episode starts with an empty episode number for you to type; on, it fills in the next number for that topic and season as before.

## Questions and bug reports

- Ask in the Discord server at https://discord.gg/MMjuHe6ZM2, or open an issue at https://github.com/pjmdesi/stream-manager/issues. A bug report is most useful with the Stream Manager version, your Windows version, and the steps that led to it.
