# Release notes draft (next release from `dev`)

> Running draft, maintained ON `dev`. When a feature lands, append a line to the right section in the same sitting. At promotion time this gets edited into the GitHub-release copy (trim, reword, reorder headline-first; see `archive/_release-notes-v2.md` for the format) and the file is emptied for the next cycle. Wording here is working-quality, not final. Fixes that already shipped in a hotfix release do NOT belong here.

Target: TBD · emptied 2026-08-10 after the v2.3.0 release.

## Streams page

- The Twitch match check no longer flags streams whose titles differ from Twitch only in whitespace. Twitch normalizes stored titles server-side (non-breaking spaces and stray newlines come back as plain spaces), so a title containing those characters compared as "mismatched" forever even right after a successful push. Title comparisons now ignore whitespace differences; case still counts.
- The "Out of sync" panel now reacts to template edits: saving a YouTube or Twitch tags template immediately updates the tags of every stream bound to it and surfaces the affected streams in the panel, instead of each stream only picking up the new tags (and appearing in the panel) when opened individually.
- Pushed streams no longer bounce back as "Changed on YouTube": the panel now trusts the values it just pushed for a few minutes instead of YouTube's API reads, which can serve stale data right after an update. Previously a bulk push flipped each item into the "Changed on YouTube" group mid-push and kept some there for a while after it finished.
- New episodes get correct thumbnails immediately: creating an episode now copies only the PRIMARY thumbnail (the stream item's selected one, with its editable canvas; variant numbering resets so it starts as the new episode's only thumbnail) instead of piling every alternate through a season, and re-renders it in the background against the new episode's details, so merge fields like {episode} and {title} show the right values without opening the editor. If a thumbnail can't be re-rendered faithfully (an image it references was deleted or its cloud copy is unreachable, or a font is missing), the stale image is kept and marked with a "Could not load references" overlay in the files grid (and a warning badge on the stream row) until it renders successfully or is fixed in the editor.
