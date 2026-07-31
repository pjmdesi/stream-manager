# Release notes draft — next release from `dev`

> Running draft, maintained ON `dev`. When a feature lands, append a line to the right section in the same sitting. At promotion time this gets edited into the GitHub-release copy (trim, reword, reorder headline-first — see `archive/_release-notes-v2.md` for the format) and the file is emptied for the next cycle. Wording here is working-quality, not final. Fixes that already shipped in a hotfix release do NOT belong here.

Target: TBD · emptied 2026-07-26 after the v2.1.0 release.

## Thumbnail editor

- Stroke width and the filter sliders' value boxes use the standard +/- number field like the rest of the properties panel. Filter spinners step finer than their sliders (rough in with the slider, refine with the spinner — e.g. Brightness slides in 0.05s, spins in 0.01s), with no floating-point residue.
- Layer bounds on the canvas: hovering an element outlines it (and highlights its row in the layers panel — and vice versa), and every member of a group selection gets a dashed outline so elements inside the group frame stay identifiable even when one engulfs another. Outlines hide during drags/resizes so they never obscure edges while positioning.
- Letter case control for text layers (as typed / UPPERCASE / lowercase / Title Case). Non-destructive: the transform applies at render time — including to merge-field content — so switching back to "as typed" always recovers the original text.
- Preview mode: an Edit/Preview toggle above the layers panel swaps the canvas for mockups of real YouTube surfaces (home card, search result, suggested rail, compact row) with duration/LIVE/Upcoming badges (radio icon like YouTube's), watched-progress bar, and a light-theme toggle. The properties panel stays live — tweak a font size and watch every mockup size update. Badge/theme choices persist while toggling between Edit and Preview. Uses your Streamer Name setting for the channel line.
- Fixed: exported PNGs could include the new selection-bounds outlines when a group selection was active at save time.
- Color palette panel in the editor sidebar: default swatch set to start, add your own with + (or promote a recently-used color from the recents row), remove via the header's edit mode (pencil → click swatches to delete). Apply colors by dragging a swatch onto any color field, or keyboard-friendly via the new palette button on every color field (popover with palette + recents). The palette is saved beside your library (`_palette.json`) so it follows your streams through cloud sync; recent colors are remembered per machine. (Phase 3 still to come: reorder, multi-select, import/export — reword then.)
