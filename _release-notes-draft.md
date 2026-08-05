# Release notes draft (next release from `dev`)

> Running draft, maintained ON `dev`. When a feature lands, append a line to the right section in the same sitting. At promotion time this gets edited into the GitHub-release copy (trim, reword, reorder headline-first; see `archive/_release-notes-v2.md` for the format) and the file is emptied for the next cycle. Wording here is working-quality, not final. Fixes that already shipped in a hotfix release do NOT belong here.

Target: TBD · emptied 2026-08-04 after the v2.2.0 release.

## App-wide

- The update check now re-runs every 6 hours while the app is open, so an instance that lives in the tray for days learns about new releases without a restart. (Previously it only checked once at launch.)

## Combine

- Rich file rows, matching the converter's design: each row now shows a frame thumbnail, the owning stream item's title (click to open its detail sidebar on the streams page) and date, and the file's codec, resolution, frame rate, and size, alongside the existing recording time and duration.
