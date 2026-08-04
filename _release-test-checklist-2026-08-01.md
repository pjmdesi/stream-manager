# Release test checklist — v2.2.0 (2026-08-01)

Build: Stream Manager 2.1.0_DEV.exe from dev @ 54d717e

## This batch (thumbnail editor)

- [x] Number fields: stroke width and filter slider value boxes use the +/- spinner; filter spinners step finer than their sliders (Brightness slides 0.05, spins 0.01) with no floating-point residue; typing "0100" in opacity resolves to 100 with no leading zero left behind
- [x] Layer bounds: hovering an element outlines it on the canvas and highlights its layers-panel row (and vice versa); every member of a group selection gets a dashed outline; outlines hide during drags/resizes
- [x] Export fix: export a PNG while a group selection is active → no selection outlines in the file
- [x] Letter case: all four modes (as typed / UPPER / lower / Title) render on canvas including merge-field text; switching back to "as typed" recovers the original
- [x] Preview mode: Edit/Preview toggle shows the YouTube mockups (home card, search, suggested, compact) with duration/LIVE/Upcoming badges, watched bar, light-theme toggle; property tweaks update mockups live; badge/theme choices persist across toggles; gallery scrolls (no wheel-zoom bleed)
- [x] Preview fidelity (2026-08-02 fixes, verify in PACKAGED build — font bundling differs from dev server): mockup text renders in Roboto (badges 20px tall, 12px icon), surface labels stay app-font and are readable on dark, and a title with " | " wraps without a leading space on the second line
- [x] Gradient fills: Solid/Gradient toggle on shape AND text fills; two stops with per-stop transparency, position fields (1 = top), angle (0° = top→bottom), oklch vs sRGB visibly differ on saturated pairs; preview bar shows checker under transparent stops
- [x] Color fields: Esc in opacity → 0, Esc in hex → black; hex accepts f00 / f00c / ff0000 / #ff000080 with or without '#', normalizes on blur, bare-digit resting display, red ring only on never-valid text, paste of 9-char '#rrggbbaa' works
- [x] Palette panel: defaults on first run, + adds via native picker, drag swatch onto any color field applies (color AND opacity), per-field popover applies solids; edit mode: click/Ctrl/Shift select, drag reorder (multi-selection moves as a block), delete, reset to defaults; export then re-import palette .json → "No new swatches"
- [x] Palette reorder polish: insertion marker centered in the gap, wraps with its tile at row boundaries, dropping ON the marker works, no marker beside the dragged swatch itself, no cancel-cursor flicker while sweeping
- [x] Smart recents ties: tweaking one property repeatedly updates ONE recents entry in place; detour to another property and back keeps both ties; selecting another layer breaks ties (next edit = new entry)
- [x] Gradient swatches: editing a gradient captures stops+angle+space as one recents tile (true angle rendered); enabling gradient mode alone records nothing; toggling to Solid breaks the gradient tie; click a gradient recent → saved to palette; export/import carries gradients
- [ ] Gradient swatch apply: drag onto a solid fill → switches to gradient; drag onto a gradient fill → replaces it; stroke/outline fields reject gradient drags; solid-fill popover lists gradients (pick converts); gradient-mode header palette button opens gradients-only popover (picks keep it open, Esc closes without deselecting)
- [ ] Solid-onto-gradient: drop a solid swatch on a gradient Fill control → flat fill (drop on a stop field → recolors just that stop, ring hands off correctly)
- [ ] Adoption semantics: after applying any swatch, the next tweak creates a NEW recents entry (adopted swatch never mutates); applying swatch B doesn't evict previously applied swatch A
- [ ] Recents persistence: restart the app → recents restored (solids with alpha + gradients), ties not (by design)
- [ ] _palette.json travels: palette changes land in the library folder beside _meta.json
- [ ] Double-click select (app-wide, 2026-08-04): double-click in the empty space of a wide input with short text → all text selected; double-click ON a word → just that word; spot-check a number field, a hex color field, and a textarea (description)

## Core regression (every release)

- [x] Relay: full lifecycle on a real or test stream — bind → ingest → live → complete; post-stream Twitch auto-update fires (60s delay)
- [x] Watcher/auto-rules: drop a recording into the watch folder → lands in the right stream item
- [x] New stream + New episode: correct season/episode, templates render
- [x] YouTube: push + pull a stream's details; thumbnail push; out-of-sync panel clean afterward
- [ ] Converter: one job start→finish; pause/resume; output plays
- [ ] Player: open a video, clip draft → export
- [ ] Thumbnail editor: open, edit, export; variant creation
- [ ] Cloud: pin local + offload one item; statuses update everywhere
- [x] Launcher: run a launch group (window + tray)
- [x] Quit/relaunch: no orphaned processes, state restored
