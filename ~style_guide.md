# Stream Manager UI/UX Style Guide

> **Status: audited 2026-09-10 (APP-24).** Every concrete claim below (token values,
> primitive props, class strings, file paths) was checked against the code that day;
> drifted claims were corrected and the open decisions were gathered into the last
> section. Sources: `tailwind.config.js`, `src/renderer/src/assets/index.css`,
> `components/ui/*`, plus accumulated design rules. Code is the source of truth; this
> doc captures intent + the judgment calls code can't enforce. Re-audit at each
> release sweep (the docs step in `_release-process.md`).

## How to use this (the 3 layers)

Consistency is held by three layers, not by this doc alone:

1. **Tokens in code**: colors/fonts/motion live in `tailwind.config.js` + `index.css`. No magic hex values or one-off sizes in components.
2. **Shared primitives**: `components/ui/*`. Compose from these for text/action buttons, fields, and modals; add a variant to the primitive rather than forking it inline. Accepted exception: icon-only chrome buttons (toolbar icons, panel-header actions, row hover actions) are raw `<button>`s in practice; they must carry a `<Tooltip>` and, in panel headers, the panel-header chrome rule below. Raw `<input type="number">` is banned by lint (APP-3): use `NumberInput` or the crop tool's sanctioned `CropNumberInput`.
3. **This doc**: the rules and "when to use which" that tokens/components can't express.

When adding UI: reach for a primitive → if it doesn't fit, extend the primitive → only then write bespoke markup, and add a rule here.

**Public accountability doc:** `PRINCIPLES.md` (repo root, rendered at stream-manager.app/principles) makes the app-level rules below into public, falsifiable claims. It cites this file's "App-level rules" section and these source paths: `src/main/services/updateCheck.ts`, `src/main/ipc/net.ts`, `writeAllMeta` and `backupMetaOnQuit` in `src/main/ipc/streams.ts`, `src/main/services/secretStorage.ts` (with `youtubeAuth.ts`, `twitchAuth.ts` and the config store's secret fields as its call sites), `.github/workflows/release.yml`, and `package.json` (the "no database or telemetry dependency" claims). It also enumerates every host the app contacts. Three duties follow: (1) if any of those files move or those mechanisms change, update the citations in `PRINCIPLES.md` in the same commit; (2) a new outbound host, a new stored credential, or a new dependency in the database/telemetry class updates the relevant principle in the same commit; (3) before shipping a feature that touches notifications, network requests, storage, or the build pipeline, check it against the published principles: a change that breaks one either doesn't ship or the principle is publicly amended.

---

## Foundations

### Color tokens (`tailwind.config.js`)

`navy-*` is a legacy name for the slate-flavored background grays. `accent-*` is the app's semantic accent (slate-with-extra-blue). Until APP-16 (2026-09) the accent was remapped OVER Tailwind's `purple-*` classes ("the purple hack"); that remap is gone: `purple-*` is Tailwind's real purple again and appears only where actual purple is intended (the true-purple tag color, the merge-field chip selection tint).

| Token | Use |
|---|---|
| `navy-900` `#0a0f1a` | app background (darkest) |
| `navy-800` `#131825` | elevated background |
| `navy-700` `#1c2333` | panels, **modal body** |
| `navy-600` `#283447` / `navy-500` `#34425a` | raised surfaces, borders-as-fills |
| `surface-100..400` `#2a3447` `#243043` `#1c2538` `#161e2c` | button/input fills (`surface-100` = secondary button bg) |
| `accent-950/900` `#1b273c` `#30415a` | chip fills (merge-field chips), deep accent backgrounds |
| `accent-800` `#44566f` | **primary button** bg (hover `accent-700` `#5f7491`) |
| `accent-600` `#8fa2bc` | accent fill |
| `accent-500` `#c9d5e3` | hover / slider thumb (`--color-accent`) |
| `accent-400` `#e0e7f0` | accent **text** |
| `accent-300`/`200` | highlighted/active text |
| `twitch-500/400/300` `#9146ff…` | **Twitch-only** UI, literal brand purple, never themed |
| `claude-500/400/300` `#d97757…` | **Claude-only** UI (the logo terracotta); 400/300 are white-mixed tints for hover/text |

Text ramp: `gray-200` primary · `gray-300` field labels · `gray-400` secondary · `gray-500/600` muted/placeholder. Borders: `border-white/5` (subtle) · `border-white/10` (standard).

Semantic colors: red = danger **and** YouTube brand (`red-400`); green = success; the slate `accent-*` = primary accent; `twitch-*` = Twitch brand; `claude-*` = Claude brand. Real `purple-*` appears in exactly two places: the true-purple tag color (`constants/tagColors.ts`) and the merge-field chip selection tint in `index.css`.

**Third-party services wear their real brand colors and marks (rule, 2026-09-10).** A connected service is identified by its own logo (`components/ui/BrandIcons.tsx`, paths from the simple-icons project) in its own brand color token, the way YouTube and Twitch always were. Claude joined them: the `Bot` glyph in borrowed `orange-400` became the Claude mark in `claude-500` on the Integrations card, the Settings connection status, the nav subline, and the Help entry. Generic AI *features* (the Ctrl+Space hint lines, the AI Suggestions settings section) stay vendor-neutral: gray text and the plain `Bot` icon, because they describe the feature, not the provider. When AI-2 adds other providers, the Integrations card becomes a neutral container of provider rows, each row carrying its own mark and color.

Orange is spoken for and none of its meanings is Claude:

| `orange-*` use | Where |
|---|---|
| "Changed on YouTube" / pull direction | out-of-sync dots and panel, sidebar mismatch markers |
| Locked clip region | player region lock toggle |
| Combined-file tag | files grid |
| The Orange tag color | tag palette |

Also in the config: a `wide` breakpoint (1200px) and a `roboto` font family (thumbnail-editor YouTube preview mockups only).

CSS vars in `index.css` (`--color-bg`, `--color-bg-elevated`, `--color-panel`, `--color-text`, `--color-accent`, `--color-accent-light`) mirror a subset for non-Tailwind contexts (sliders, playhead). Keep them in sync with the Tailwind tokens.

### Typography

- Font: **Recursive** (`font-sans`), with a mono variant (`font-mono`, also Recursive). Variation axes set in `index.css`: `MONO 0/1`, `CASL 0`, `CRSV 0.5`. `code/pre/kbd` flip `MONO 1`.
- Size scale in use: `text-[8px]` (merge-field value-chip name labels only) · `text-[9px]` / `text-[11px]` (dense timeline and table chrome: marker badges, region pills, table headers) · `text-[10px]` (hints, dense metadata, tags) · `text-xs` (most field/control text) · `text-sm` (standard body, labels) · `text-lg` (page/modal titles). `tabular-nums` for counters and timecodes.
- `user-select: none` globally; only `input/textarea/select/.selectable` are selectable.

### Text contrast floor (rule)

**Minimum readable text is `text-gray-400` with NO opacity utility.** Never stack an opacity modifier on `gray-500`/`gray-600` (e.g. no `text-gray-500/70`). Below this it fails on poor displays / for low-vision users. (Audited 2026-09-10: zero violations in the renderer.)

### Spacing, radius, sizing

- Radius: `rounded-lg` (buttons, inputs, most controls) · `rounded-xl` (modal panel) · `rounded` (chips, checkboxes) · `rounded-[20px]` (the files grid's input-style container).
- Standard control padding: buttons `px-4 py-2` (md) / `px-2.5 py-1.5` (sm) / `p-2` (icon-sm); inputs `px-3 py-2`; dense controls `px-2 py-1`.
- Canonical spacing scale: still an open decision (see the last section).

### Motion (rule)

- **Default timing function is `linear`** (set in `tailwind.config.js`). Eased transitions caused drift when differently-sized elements animate together. Note: `transition-[prop]` classes still need explicit `ease-linear`.
- Shared attention animation: `@keyframes outline-pulse` in `index.css` (2px outline), driven per-use by a `--pulse-color` CSS var (uses `outline`, not `box-shadow`, so it isn't clipped by `overflow:hidden`). Named users: `.save-attention`, `.help-attention`, `.survivor-pulse`. A 1px sibling, `outline-pulse-sm`, serves the tiny mismatch dots (`.mismatch-dot-pulse`). Reuse one of these two for new attention cues rather than inventing a third.
- **Respect user settings**: `config.disableAnimations` / `config.slowAnimations` (and the OS reduced-motion preference) must gate non-trivial animation. Read them through `useAnimationConfig`, which folds all three into `noAnimation` and a duration multiplier.

---

## Components (primitives in `components/ui/`)

> Props below are the load-bearing ones; see each file for the full API.

**Directory (2026-09-10).** Documented in detail below: `Button`, `Input`/`Textarea`/`Select`/`NumberInput`, `Checkbox`, `TogglePill` (in StreamsPage for now), `Modal`, `Tooltip`. Also in `components/ui/` and worth reaching for before writing bespoke markup: `CollapsibleLabel` (icon-only ↔ icon+label via container query; Button wraps it), `Slide` (`SlideOpen`/`SlideBlock` height reveals), `TruncatedText` (truncate + full-text tooltip), `DatePicker` (popup and `inline` variants), `FileDropZone` (drop + browse, `browseStartIn` picks the dialog's folder), `TagChipEditor`, `TagComboBox`, `TopicSelect`, `TemplateBodyEditor` (merge-field chips; exports the chip classes), `BroadcastPicker`, `VideoRow`, `VideoThumb`, `RecentRow` (with `SmoothThumb`, the canvas downscaler), `BrandIcons` (YouTube/Twitch marks), and the modals `TemplatesModal`, `ManageTagsModal`, `IconPickerModal`, `TwitchCategoryRenamePrompt`. Two are effectively retired: `GhostTextArea` is used only by the parked legacy streams code, and `Slider` by one preset-editor field; both go with the legacy dead-code pass. `Kbd` (keyboard chips) lives inside `HelpModal`; move it to `ui/` the first time a second surface needs it.

### Button (`Button.tsx`)

- **Variants:** `primary` (accent, shadowed) · `secondary` (**default**, surface fill + border) · `ghost` (transparent, for low-emphasis/cancel) · `danger` (red) · `success` (green).
- **Sizes:** `icon-sm` · `sm` · `md` (**default**) · `lg`.
- `icon`, `loading` (built-in spinner), `collapsibleLabel` (animated icon-only↔icon+label via container query, see file), `labelCollapsed` (force the collapsed state, for slide animations that must start collapsed).
- Sets `data-variant`, which **Modal autofocus relies on** to find the action button. Keep action buttons as `primary`/`danger`/`success`, cancel buttons as `ghost`/`secondary`.

### Inputs (`Input.tsx`)

Shared field skin: `bg-navy-900` · `border-white/10` · `rounded-lg` · focus `ring-2 ring-accent-500/50 + border-accent-500/50` · error `border-red-500/50`. Labels `text-sm font-medium text-gray-300`. Error text `text-xs text-red-400`; hint `text-xs text-gray-400`.

- **`Input`**: label/error/hint/prefix/suffix slots.
- **`Textarea`**: auto-grows to content by default (`useAutoGrowTextarea`); custom bottom drag-handle strip (double-click resets to auto). Prefer this over bare `<textarea>`.
- **`Select`**: native select, themed; `options` array. Raw themed `<select>` + `ChevronDown` overlays still exist in 12 files (28 sites; Settings, Converter, Thumbnail editor, Streams among them). Consolidation is an open decision (see the last section); until then, new dropdowns use the primitive.
- **`NumberInput`**: number field with custom vertical +/− (Shift = ×10), native spinner stripped, `text-xs` mono by design (it is a dense inline control). Primitive: owns no label/error. Extras: `inlineNote`, `frameless`, `merged` (for lockups), `onEscape`, `disableShiftStep`.

**Shift = ×10 stepping (rule, APP-22).** Every input that steps with arrow keys or spinners multiplies the step by 10 while Shift is held: NumberInput's spinners, the player timecode inputs (ten of whatever segment the cursor is on: 10 frames, 10 seconds, 10 minutes; central implementation in `applyTimecodeArrow`), the crop x/y/w/h fields, the track volume %. Custom handlers must `preventDefault` so the native number-input step can't double up. Exceptions are decided case-by-case for tiny-range inputs where a ×10 jump spans most of the range: opt a NumberInput out with `disableShiftStep` (which also drops the "(Shift = ×10)" note from its spinner tooltips, a shown hint must never be wrong); current exceptions are max simultaneous conversions and the relay port. Deliberately unadvertised: no tooltip hints outside NumberInput's own spinner tooltips.

### Checkbox (`Checkbox.tsx`)

Custom `role="checkbox"` button (not native). Colors `accent` (**default**) · `red` · `green` · `blue`; sizes `sm`/`md`. Single check icon, `strokeWidth=3`. This is the checkbox for settings, lists, and forms: a box with a label beside it.

### TogglePill (second checkbox type; `TogglePill` in `StreamsPage.tsx`)

The other checkbox. Used when the toggle OWNS an adjacent field or push behavior and the two must read as one control, so far only in the stream-detail sidebar. `aria-pressed` button, whole pill clickable, check glyph plus optional label; the tooltip is mandatory and describes what the click does NOW.

- **On:** primary Button chrome, `bg-accent-800 hover:bg-accent-700 text-white` (the same look as "New stream"). **Off:** `text-gray-500 hover:text-gray-300 hover:bg-white/5`, check at 30% opacity, plus `bg-navy-900/70` when standalone.
- **Focus:** a focus-VISIBLE inset ring (`focus-visible:ring-2 ring-inset ring-accent-500/40`), never a background swap: a focus background outranked the checked state and a just-clicked pill read as unchecked.
- **Two variants.** *Standalone*: its own `rounded-lg border border-white/10` box (`px-2.5 py-1.5`); no current user since the thumbnail-upload toggle left with the 2026-08-30 picker removal. *Segment* (`segment` prop): the LEFT segment of a bordered lockup, no box of its own, full height, a hairline on the right, squared corners; the host group supplies the border, background and rounding. Live instances: the Series lockup [toggle | S | E] (pill + two `NumberStepperField`s), the Twitch title override (pill attached to a `TemplateBodyEditor` via its `attachLeft` prop), and the Twitch category override.
- **Choosing between the two checkboxes:** a plain yes/no setting gets `Checkbox`; a switch that enables, seeds, or takes over the field next to it gets `TogglePill` in the segment form. Do not put a square checkbox inside a field lockup.
- Lives in `StreamsPage.tsx` today; move it to `components/ui/` the first time another page needs it.

### Modal (`Modal.tsx`)

- Props: `isOpen`, `onClose`, `title` (header text, **not** a tooltip), `width` (`sm`→`2xl`, maps to `max-w-sm`…`max-w-4xl`), `footer`, `dismissible`, `headerExtra`, `autoFocus` (`default`/`initial-only`/`none`), `noOverlay`.
- Panel: `bg-navy-700`, `rounded-xl`, header/scroll-body/footer; footer is right-aligned actions.
- **Button order (rule):** the user's **most-likely-next action sits on the RIGHT**, in the primary slot, even when that action is just *Close* after a completed operation (a finished flow's Close outranks a rarely-used Undo/retry). Lower-likelihood actions sit to its left; Cancel/dismiss ghosts leftmost. Canonical instance: the convert-to-folder-per-stream modal's done step (`Undo conversion` left, `Close` right + primary).
- **Overlay starts at `top-10`** (frameless titlebar rule below), backdrop `bg-black/60 backdrop-blur-sm`.
- Autofocus: focuses first input, else the rightmost action button (by `data-variant`); `default` also refocuses a primary action when it flips enabled. Use `none` for edit forms, `initial-only` for long forms.

### Tooltip (`Tooltip.tsx`)

- **ALWAYS use `<Tooltip>` instead of native `title=`** (native is slow + unstyleable). Exception: `Modal`'s `title` prop is a header, not a tooltip, leave those. (Audited 2026-09-10: zero native `title` attributes on DOM elements outside the legacy file.)
- **Every button gets a tooltip (rule).** Default assumption: a button without a `<Tooltip>` is a bug, even when its label seems self-evident. The rare exception is a button where no extra text could improve understanding (e.g. the Settings **Save** button), but err on the side of adding one. Toggle-style buttons should describe the action the click will take *now* ("Hide video files" / "Show video files"), not a static label.
- **Shortcut chips:** if a keyboard shortcut triggers the button, pass `shortcut`. When one key toggles between two buttons' actions (Ctrl+A = select-all ↔ clear-when-complete), the chip sits on whichever button the key would *currently* trigger. A shown shortcut must never be wrong.
- `side` (`top` default) with automatic fallback to a side that fits; `w-max` capped at `max-w-xs` (override via `maxWidth`); `interactive` (hoverable body, click-to-dismiss); `open`+`triggerStyle` for anchoring over non-React visuals (e.g. contenteditable chips). Portal at `z-[10001]`, `bg-navy-800`.
- **Line-box strut gotcha (rule, 2026-09-07).** The trigger wrapper is `inline-flex`. Placed directly inside a plain block container it sits on a line box and inherits that container's line-height, so the wrapped control renders taller than an identical unwrapped one (1px on toolbar buttons, a 24px strut on the 9px marker triangles). Invisible when the Tooltip is a flex item, which is why most toolbars never show it. When a Tooltip's parent is a block (`relative` wrappers around a button, positioning shells, absolutely placed anchors), either make that parent `flex` or pass `triggerClassName="block"`/`"flex"`. Three sightings so far: the old crop dropdown, the marker triangles, and the Split Segment button; the tell is one control in a row being 1px off its siblings, or a row height that changes when a button swaps.

### Anchored popovers (rule)

Any floating popup anchored to a point in the UI (marker edit popup, track color picker, clip handle popups, dropdown panels) **must keep itself fully inside its clipping container before it shows**: the viewport for portalled popovers, or the nearest `overflow-hidden` ancestor for inline ones. A popover that renders half-cut at a container edge is a bug, not a cosmetic nit (codified 2026-09-05 from the marker edit popup clipping at the timeline's ends). `<Tooltip>` already does this (side fallback + fit logic); it is the default choice for hover info, including `interactive` for hoverable content. Write a bespoke popover only when it needs focusable controls (inputs, swatch grids), and give it the clamp: measure after mount in a `useLayoutEffect` and shift the panel so it fits, keeping the logical anchor position (reference implementation: `MarkerEditPopup` in PlayerPage, which clamps against the strips wrapper via a `boundsRef`).

**Timeline-anchored chrome snaps to device pixels (rule, 2026-09-07).** Anything positioned from a time value on the player timeline that has visible internal detail (edge handles, attached pills, edit popups) resolves its final position in pixels and rounds it through `devicePixelRatio` (`Math.round(v * dpr) / dpr`), never a bare percent `left` with `translateX(-50%)`. Percent-plus-translate lands on arbitrary sub-pixel offsets, so a frame step at full zoom-out moves the element by a fraction of a pixel and its contents re-rasterize with different anti-aliasing (the "swatch circles jitter" symptom). Two incidents now: the clip region edge handles (blurry/uneven 2px bars, IDEA-4 polish) and the marker edit popup (shimmering swatches, this rule). `devicePixelRatio` covers both OS scaling and the app's UI zoom, so whole CSS pixels are not enough. Point markers with no internal detail (the marker triangles) are exempt.

### Chips / badges (rule)

- **Chip border color matches its text color** (e.g. `text-accent-300` → `border-accent-300/40`). Don't pair a colored text with a neutral border.
- Tag chips: `text-[10px] px-1.5 py-0.5 rounded`. Merge-field chips: see `TemplateBodyEditor` exports (`MERGE_FIELD_CHIP_CLASS`).
- **File-class tag-border palette** (files grid `TaggedThumb`): the video class is the warm family (**red** Recording · **pink** Clip · **violet** Short); images are cool (**teal** selected thumbnail · **gray** alternates). **Blue is reserved** (unassigned; save it for a future marker). Shorts use Tailwind's literal `violet-*`, never the app's `accent-*` tokens (the slate accent would collide with selection rings). SM-made files always show their tag statically; hover-only tags are for affordances on non-SM files (e.g. set-as-thumbnail).

---

## App-level rules (hard preferences)

- **No toast/snackbar notifications, ever.** For soft outcomes, stay silent or use persistent UI (inline status, icons, modal results). [established preference]
- **No OS/system notifications either.** Errors from background- or tray-initiated actions bring the main window up (`show()` + `focus()`) and surface IN-APP as a modal, same as the post-stream Twitch auto-update problem and tray launch-group failures. SM never speaks through the Windows notification center. (Cloud-provider download notifications from Synology/OneDrive are theirs, not ours.)
- **X closes, trash removes and deletes.** Three tiers: **Delete** (a real thing such as a file or a stream item is physically removed) → `Trash2`. **Remove** (a UI element is cleared from a list or process; nothing on disk changes) → `Trash2`, with the tooltip clarifying the file/data itself is untouched. **Close/Dismiss** (menu, modal, sidebar, message) → X. The X icon is strictly a close/dismiss affordance, never use it for deletion or removal. (Codified 2026-07-31 from the palette swatch remove button; Remove tier added 2026-08-05 from the combine job rows.)
- **No secondary modals.** Never open a modal from inside a modal, use inline editing (turn the row into an editable form with Save/Cancel) instead.
- **Close buttons live where their open buttons are.** A button that exits a mode or closes a surface renders in the same place as the button that opened it (or as near as possible), swapping in while the mode is active: the user who just found the open button already knows where the exit is, which matters most the first time they use the feature. Style the close state with the red close-button chrome (like Close Session) so it reads as an exit, not a second feature, and keep the mode's OWN icon with a small X badge at its lower-right corner (`ModeCloseIcon` in PlayerPage: 9px X, strokeWidth 3.5, `bg-navy-800 rounded-full text-red-300` disc); the badge is what says "this now closes what it opened" when a collapsed sidebar leaves no room for the label. Canonical instances: the player sidebar's Start/Stop Clipping slot and Open/Close Multi-track Audio slot (PLR-13, 2026-09-05); the clip toolbar deliberately carries no duplicate stop button.
- **Frameless titlebar, `top-10` rule (CRITICAL).** The window is `frame:false`; the window controls sit in the top ~40px. All VISIBLE fixed overlays/backdrops/drawers MUST use `top-10` (e.g. `fixed inset-x-0 bottom-0 top-10`; the Modal overlay is the reference), **never** `inset-0`/`top-0`, or they cover the min/max/close controls. Exempt: the transparent click-away layers behind small pickers and filter menus (`fixed inset-0` with no background, six sites as of 2026-09-10). Those paint nothing, and dismissing the picker on the first click anywhere, window controls included, is the intended behavior.
- **Dark theme only.** No light mode.
- **Errors surface inline**, not via toasts (consistent with no-toast rule), e.g. the AI hint lines turn red with the message.
- **Build/environment naming (rule).** Two independent axes, three terms, never say just "dev":
  - **Release build**: packaged from `master`. Ships NO markers: no `_DEV` name, normal icon, no sidebar chips. This absence is a guarantee, enforced by `scripts/dist.cjs` (only non-master builds get dev markers).
  - **Dev build**: packaged from any non-master branch (`npm run dist` on `dev`). `_DEV` artifact name, yellow dev icon, accent-colored **branch chip** (GitBranch icon + branch name, from the shipped `dev-branch.txt` marker).
  - **Dev server**: running unpackaged via `npm run dev` (electron-vite), any branch. Amber **`server` chip** (`import.meta.env.DEV`, label kept short for the collapsed sidebar); the branch chip also shows when the checkout isn't on master.
  - Chip colors are reserved: **accent = git branch**, **amber = environment**. The chips live on their own row under the version line (they made the version row too wide inline); each chip carries its own explanatory tooltip, and the About modal spells out both states.

---

## Recurring patterns

- **Page header**: match the streams page: `text-lg font-semibold` `h1` (icons and status chips inline with `flex items-center gap-2`) + `text-xs text-gray-400` subtitle, in a `px-6 py-4 border-b border-white/5` band. Reference: the `Streams` header in `StreamsPage.tsx` (search for the `h1`); all ten pages use the same two class strings, so read the live one rather than a pasted copy that would drift.
- **Bulleted/numbered lists**: `list-disc list-outside ps-4` (plus a `marker:` color), never `list-inside`: inside markers make wrapped lines return flush left instead of hanging under the text (codified 2026-09-06 from the setup wizard's lists). (Audited 2026-09-10: zero `list-inside` in the renderer.)
- **Loading states**: spinner (`Loader2 animate-spin`) + reserved height (min-height to prevent content jump), never a bare "Loading…" text node.
- **Empty states**: no unified standard yet (open decision, last section). Current practice: centered `text-gray-400 text-sm` message, with an icon and a CTA button where an action exists.
- **AI suggestion hint line**: `text-[10px] text-gray-400`, states: idle "Ctrl+Space for AI suggestion" / loading spinner+"Generating…" / "Tab to accept · Esc to dismiss" / error (red, `AlertTriangle` + message). Pattern lives in `useFieldSuggestion` + `TemplateBodyEditor`.
- **Platform icons by field label**: `<Youtube size={11} className="text-red-400/70" />`, `<Twitch size={11} className="text-twitch-400/70" />` to mark which platform a field targets.
- **Collapsible panels/sections (rule)**: the collapse chevron sits on the **LEFT, before the panel title/content** (ChevronDown = expanded, ChevronRight = collapsed), never on the right. Collapsed keeps a constant-height header; include a summary line where it's useful (e.g. the files grid's file-class counts). Collapse state is a persisted UI pref (`localStorage`), global rather than per-item. Two size variants: **in a control row** (files grid), the button matches its sibling buttons' box exactly (it's the row-height anchor); **in a panel header** (Assets panel), it fills the row's FULL height, flush to the left edge, square aspect, no rounded corners: an easy large hit target. Header gotcha: if the header's bottom border is conditional on collapse, keep it always present and swap to `border-transparent` when collapsed; removing it changes the border-box and nudges the full-height chevron by 1px.
- **Panel-header icon buttons (rule)**: action buttons in a panel header (asset sources, palette edit/add) get REAL button chrome so they don't read as decorative icons: `p-1 rounded-md border` with idle `bg-navy-900 border-white/10 text-gray-400` and hover `text-gray-200 border-white/25 bg-white/5`; glyph ~13px. An active/toggled state may recolor the whole treatment (e.g. the palette pencil's amber edit-mode state) but keeps the same box. Purely decorative panel icons (the 11px icon next to the title) stay bare; the chrome is what separates "button" from "label icon". Segmented controls in headers (Layers' Edit/Preview) already carry `bg-navy-900 border` chrome and are consistent by construction.
- **Sidebar governor toggles (rule)**: in the stream-detail sidebar, a checkbox that OWNS an adjacent field or push behavior (Series numbering, Twitch title/category overrides) renders as a `TogglePill` in its segment form, not a square checkbox. Chrome, variants and the choosing rule are in the TogglePill entry under Components.
- **Duplicating user-named items (rule, LNCH-2)**: a Duplicate action copies the item's content exactly (children get FRESH internal ids so per-child state never cross-links original and copy), names the copy `<source name> - Copy` (plain hyphen, matching Windows' own convention; repeatable: duplicating a copy appends again), inserts it immediately after its source in the list, and selects/opens it. Selection-adjacent state that points AT an item (a pin, a default) is not copied. Applies to launcher groups, template/tag duplicates (STR-12), and future duplicate buttons. Known exception: thumbnail variants keep their fixed generated name regardless.
- **Local z-index ladders get `isolate`**: a component that stacks many internal layers (the player timeline: hit areas, region chrome, marker layer, popups) puts `isolate` on its positioned container so those z values order elements INSIDE it only. Without it they compete in the root stacking context and can outrank app-level overlays (the Modal overlay is z-50; timeline markers at z-65 rendered above a modal backdrop, codified 2026-09-06). Rule of thumb: any z value above 50 inside page content is a bug unless an `isolate` ancestor contains it.
- **Persistent vs conditional pages**: Streams, Player, Converter, Combine and Thumbnails stay mounted behind a `hidden` wrapper to preserve state and receive an `isVisible` prop; Templates, Rules, Launcher, Integrations and Settings are conditionally rendered. Gotcha for the mounted five: anything that needs focus or real layout size (canvas resamples, autofocus, measurements) must key off `isVisible`, not mount. All pages sit inside `PageErrorBoundary` (App.tsx).
- **Streams list columns**: `table-fixed`; the thumbnail column is user-resizable via the drag handle on any thumbnail cell (85 to 170px, persisted as `config.listThumbWidth`); video count `w-[44px]`; date `w-[220px]`; then container-query columns that reveal as the list widens: type `min-w-[120px]` at `@xl`, topics `min-w-[120px]` at `@3xl`, notes `min-w-[100px]` at `@5xl`, actions `min-w-[160px]` (label at `@xl`). Cells `px-2 py-2 align-middle`. The detail sidebar OVERLAYS the list rather than shrinking it, so hidden columns keep their cell boxes and only hide their contents.

---

## Open decisions (re-verified 2026-09-10)

Still true in the code; each needs a call, then a small alignment pass. A recommendation is attached where the audit suggested one.

1. **Placeholder color:** `Input`/`Textarea`/`Select` use `placeholder-gray-600`; `NumberInput` uses `placeholder-gray-500`. Recommendation: `gray-500` everywhere (the contrast-floor rule already treats `gray-600` as the last stop).
2. **Focus treatment:** `Input`/`Textarea`/`Select` use `focus:ring-2 ring-accent-500/50 + border`; `NumberInput` is border-only. Recommendation: keep border-only for NumberInput when it is a segment of a lockup (a ring would overlap its neighbors) and add the ring when it stands alone; document that as the rule.
3. **Field text size:** standard fields `text-sm`; `NumberInput` `text-xs`. Recommendation: accept as intentional (dense inline control), already noted in its entry above; close this item.
4. **Field label color:** primitive labels are `text-gray-300`; many page/sidebar labels use `text-gray-400`. Recommendation: `gray-300` for labels of editable fields, `gray-400` for read-only metadata labels; audit the sidebar `MetaRow` labels against that.
5. **Select usage:** the `Select` primitive vs raw themed `<select>` + `ChevronDown` (28 sites in 12 files). Recommendation: give the primitive whatever the raw sites needed (compact size, inline variant), then migrate; ties in with APP-29 (dropdown padding mismatch).
6. **Button default variant** is `secondary`. Confirmed by usage: every primary action passes `variant="primary"` explicitly. Recommendation: keep, close this item.
7. **Canonical spacing scale** (gap-1/2/3 per layout context): not yet decided.
8. **Empty-state standard** (icon + message + optional CTA): not yet unified across thumbnails, launcher and streams.
9. **Tooltip trigger default** (`inline-flex`): APP-27 proposes flipping it to `flex`; when that lands, trim the line-box strut rule above to a one-line history note.

---

## Not needed yet (revisit if the project grows)

Figma source files, a Storybook component catalog, a token build pipeline, automated visual-regression tests. Markdown + disciplined tokens/components is the right weight for a solo dev. Storybook is the natural upgrade if contributors arrive.
