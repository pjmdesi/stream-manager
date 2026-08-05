# Release notes draft (next release from `dev`)

> Running draft, maintained ON `dev`. When a feature lands, append a line to the right section in the same sitting. At promotion time this gets edited into the GitHub-release copy (trim, reword, reorder headline-first; see `archive/_release-notes-v2.md` for the format) and the file is emptied for the next cycle. Wording here is working-quality, not final. Fixes that already shipped in a hotfix release do NOT belong here.

Target: TBD · emptied 2026-08-04 after the v2.2.0 release.

## App-wide

- The update check now re-runs every 6 hours while the app is open, so an instance that lives in the tray for days learns about new releases without a restart. (Previously it only checked once at launch.)
- Video thumbnails now appear on their own after a cloud file finishes downloading (converter, combine, and files-grid rows previously kept the placeholder until the page remounted).

## Combine

- Rich file rows, matching the converter's design: each row now shows a frame thumbnail, the owning stream item's title (click to open its detail sidebar on the streams page) and date, and the file's codec, resolution, frame rate, and size. The recording start time and duration are now labeled columns (Started / Duration), and Auto-sort explains itself in a tooltip.
- Reordering shows a clear insertion line between rows (the same behavior as the thumbnail palette's swatch reorder), and no line is offered where dropping wouldn't move anything.
- The incompatible-files message now lays the conflict out as a table (one row per file, one column per differing property), and the audio layout joins each row's detail line. Mismatched properties are highlighted in red directly on the file rows (amber for frame rate, which is only advisory), so you can see at a glance which file is the odd one out.
- The page works with external files now: a drop zone fills the empty state (drop or click to browse), and a slim add-more zone sits under the list once files are loaded. Added files never re-sort your hand-ordered list. A Clear all button in the header empties the list (the files themselves are untouched).
- The Combine item in the main nav lights up while files are loaded on the page, matching how the player, converter, and thumbnails items behave.
