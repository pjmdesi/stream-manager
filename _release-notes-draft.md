# Release notes draft — next release from `dev`

> Running draft, maintained ON `dev`. When a feature lands, append a line to the right section in the same sitting. At promotion time this gets edited into the GitHub-release copy (trim, reword, reorder headline-first — see `archive/_release-notes-v2.md` for the format) and the file is emptied for the next cycle. Wording here is working-quality, not final. Fixes that already shipped in a hotfix release do NOT belong here.

Target: TBD · emptied 2026-07-26 after the v2.1.0 release.

## Thumbnail editor

- Stroke width and the filter sliders' value boxes use the standard +/- number field like the rest of the properties panel. Filter spinners step finer than their sliders (rough in with the slider, refine with the spinner — e.g. Brightness slides in 0.05s, spins in 0.01s), with no floating-point residue.
- Layer bounds on the canvas: hovering an element outlines it (and highlights its row in the layers panel — and vice versa), and every member of a group selection gets a dashed outline so elements inside the group frame stay identifiable even when one engulfs another. Outlines hide during drags/resizes so they never obscure edges while positioning.
