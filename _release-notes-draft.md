# Release notes draft — next release from `dev`

> Running draft, maintained ON `dev`. When a feature lands, append a line to the right section in the same sitting. At promotion time this gets edited into the GitHub-release copy (trim, reword, reorder headline-first — see `archive/_release-notes-v2.md` for the format) and the file is emptied for the next cycle. Wording here is working-quality, not final. Fixes that already shipped in a hotfix release do NOT belong here.

Target: TBD · emptied 2026-07-26 after the v2.1.0 release.

## Thumbnail editor

- Stroke width and the filter sliders' value boxes use the standard +/- number field like the rest of the properties panel. Filter spinners step finer than their sliders (rough in with the slider, refine with the spinner — e.g. Brightness slides in 0.05s, spins in 0.01s), with no floating-point residue.
