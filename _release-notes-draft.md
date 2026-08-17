# Release notes draft (next release from `dev`)

> Running draft, maintained ON `dev`. When a feature lands, append a line to the right section in the same sitting. At promotion time this gets edited into the GitHub-release copy (trim, reword, reorder headline-first; see `archive/_release-notes-v2.md` for the format) and the file is emptied for the next cycle. Wording here is working-quality, not final. Fixes that already shipped in a hotfix release do NOT belong here.

Target: TBD · emptied 2026-08-10 after the v2.3.0 release.

## Streams page

- New episodes get correct thumbnails immediately: creating an episode now copies only the PRIMARY thumbnail (the stream item's selected one, with its editable canvas; variant numbering resets so it starts as the new episode's only thumbnail) instead of piling every alternate through a season, and re-renders it in the background against the new episode's details, so merge fields like {episode} and {title} show the right values without opening the editor. If a thumbnail can't be re-rendered faithfully (an image it references was deleted or its cloud copy is unreachable, or a font is missing), the stale image is kept and marked with a "Could not load references" overlay in the files grid (and a warning badge on the stream row) until it renders successfully or is fixed in the editor.
