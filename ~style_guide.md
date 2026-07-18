# Stream Manager — UI/UX Style Guide

> **Status: draft to refine.** Generated from the current code (`tailwind.config.js`,
> `index.css`, `components/ui/*`) plus accumulated design rules. Code is the source
> of truth; this doc captures intent + the judgment calls code can't enforce.
> `TODO` markers flag sections that need your decisions.

## How to use this (the 3 layers)

Consistency is held by three layers, not by this doc alone:

1. **Tokens in code** — colors/fonts/motion live in `tailwind.config.js` + `index.css`. No magic hex values or one-off sizes in components.
2. **Shared primitives** — `components/ui/*`. Always compose from these; never hand-roll a `<button>`/`<input>`/modal. If you need a new look, add a variant to the primitive, don't fork it inline.
3. **This doc** — the rules and "when to use which" that tokens/components can't express.

When adding UI: reach for a primitive → if it doesn't fit, extend the primitive → only then write bespoke markup, and add a rule here.

---

## Foundations

### Color tokens (`tailwind.config.js`)

Class names are kept legacy (`navy-*`, `purple-*`) but the palette is **slate-flavored**, not literal navy/purple.

| Token | Use |
|---|---|
| `navy-900` `#0a0f1a` | app background (darkest) |
| `navy-800` `#131825` | elevated background |
| `navy-700` `#1c2333` | panels, **modal body** |
| `navy-600` / `navy-500` | raised surfaces, borders-as-fills |
| `surface-100..400` | button/input fills (`surface-100` = secondary button bg) |
| `purple-800` `#44566f` | **primary button** bg |
| `purple-600` `#8fa2bc` | accent fill |
| `purple-500` `#c9d5e3` | hover / slider thumb (`--color-accent`) |
| `purple-400` `#e0e7f0` | accent **text** |
| `purple-300`/`200` | highlighted/active text |
| `twitch-500/400/300` `#9146ff…` | **Twitch-only** UI — literal brand purple, never themed |

Text ramp: `gray-200` primary · `gray-300` field labels · `gray-400` secondary · `gray-500/600` muted/placeholder. Borders: `border-white/5` (subtle) · `border-white/10` (standard).

Semantic colors: red = danger **and** YouTube brand (`red-400`); green = success; the slate `purple-*` = primary accent; `twitch-*` = Twitch brand.

CSS vars in `index.css` (`--color-bg`, `--color-panel`, `--color-accent`, …) mirror a subset for non-Tailwind contexts (sliders, playhead). Keep them in sync with the Tailwind tokens.

### Typography

- Font: **Recursive** (`font-sans`), with a mono variant (`font-mono`, also Recursive). Variation axes set in `index.css`: `MONO 0/1`, `CASL 0`, `CRSV 0.5`. `code/pre/kbd` flip `MONO 1`.
- Size scale in use: `text-[8px]` (chip name labels) · `text-[10px]` (hints, dense metadata, tags) · `text-xs` (most field/control text) · `text-sm` (standard body, labels) · `text-lg` (page/modal titles). `tabular-nums` for counters.
- `user-select: none` globally; only `input/textarea/select/.selectable` are selectable.

### Text contrast floor (rule)

**Minimum readable text is `text-gray-400` with NO opacity utility.** Never stack an opacity modifier on `gray-500`/`gray-600` (e.g. no `text-gray-500/70`). Below this it fails on poor displays / for low-vision users.

### Spacing, radius, sizing

- Radius: `rounded-lg` (buttons, inputs, most controls) · `rounded-xl` (modal panel) · `rounded` (chips, checkboxes).
- Standard control padding: buttons `px-4 py-2` (md); inputs `px-3 py-2`; dense controls `px-2 py-1`.
- `TODO:` decide a canonical spacing scale (gap-1/2/3…) per layout context and document it.

### Motion (rule)

- **Default timing function is `linear`** (set in `tailwind.config.js`). Eased transitions caused drift when differently-sized elements animate together. Note: `transition-[prop]` classes still need explicit `ease-linear`.
- Shared attention animation: the `@keyframes outline-pulse` in `index.css`, driven per-use by a `--pulse-color` CSS var (uses `outline`, not `box-shadow`, so it isn't clipped by `overflow:hidden`). Named users: `.save-attention`, `.help-attention`, `.survivor-pulse`, `.mismatch-dot-pulse`. Reuse this keyframe for new attention cues rather than inventing one.
- **Respect user settings**: `config.disableAnimations` / `config.slowAnimations` must gate non-trivial animation.

---

## Components (primitives in `components/ui/`)

> Props below are the load-bearing ones; see each file for the full API.

### Button (`Button.tsx`)

- **Variants:** `primary` (purple, shadowed) · `secondary` (**default**, surface fill + border) · `ghost` (transparent, for low-emphasis/cancel) · `danger` (red) · `success` (green).
- **Sizes:** `icon-sm` · `sm` · `md` (**default**) · `lg`.
- `icon`, `loading` (built-in spinner), `collapsibleLabel` (animated icon-only↔icon+label via container query — see file).
- Sets `data-variant`, which **Modal autofocus relies on** to find the action button. Keep action buttons as `primary`/`danger`/`success`, cancel buttons as `ghost`/`secondary`.

### Inputs (`Input.tsx`)

Shared field skin: `bg-navy-900` · `border-white/10` · `rounded-lg` · focus `ring-2 ring-purple-500/50 + border-purple-500/50` · error `border-red-500/50`. Labels `text-sm font-medium text-gray-300`. Error text `text-xs text-red-400`; hint `text-xs text-gray-400`.

- **`Input`** — label/error/hint/prefix/suffix slots.
- **`Textarea`** — auto-grows to content by default (`useAutoGrowTextarea`); custom bottom drag-handle strip (double-click resets to auto). Prefer this over bare `<textarea>`.
- **`Select`** — native select, themed; `options` array. (Some places use a raw themed `<select>` + `ChevronDown` overlay — `TODO:` consolidate onto this or document when raw is OK.)
- **`NumberInput`** — number field with custom vertical +/− (Shift = ×10), native spinner stripped. Primitive: owns no label/error.

### Checkbox (`Checkbox.tsx`)

Custom `role="checkbox"` button (not native). Colors `purple` (**default**) · `red` · `green` · `blue`; sizes `sm`/`md`. Single check icon, `strokeWidth=3`.

### Modal (`Modal.tsx`)

- Props: `isOpen`, `onClose`, `title` (header text — **not** a tooltip), `width` (`sm`→`2xl`, maps to `max-w-sm`…`max-w-4xl`), `footer`, `dismissible`, `headerExtra`, `autoFocus` (`default`/`initial-only`/`none`), `noOverlay`.
- Panel: `bg-navy-700`, `rounded-xl`, header/scroll-body/footer; footer is right-aligned actions.
- **Button order (rule):** the user's **most-likely-next action sits on the RIGHT**, in the primary slot — even when that action is just *Close* after a completed operation (a finished flow's Close outranks a rarely-used Undo/retry). Lower-likelihood actions sit to its left; Cancel/dismiss ghosts leftmost. Canonical instance: the convert-to-folder-per-stream modal's done step (`Undo conversion` left, `Close` right + primary).
- **Overlay starts at `top-10`** (frameless titlebar rule below), backdrop `bg-black/60 backdrop-blur-sm`.
- Autofocus: focuses first input, else the rightmost action button (by `data-variant`); `default` also refocuses a primary action when it flips enabled. Use `none` for edit forms, `initial-only` for long forms.

### Tooltip (`Tooltip.tsx`)

- **ALWAYS use `<Tooltip>` instead of native `title=`** (native is slow + unstyleable). Exception: `Modal`'s `title` prop is a header, not a tooltip — leave those.
- **Every button gets a tooltip (rule).** Default assumption: a button without a `<Tooltip>` is a bug, even when its label seems self-evident. The rare exception is a button where no extra text could improve understanding (e.g. the Settings **Save** button) — but err on the side of adding one. Toggle-style buttons should describe the action the click will take *now* ("Hide video files" / "Show video files"), not a static label.
- **Shortcut chips:** if a keyboard shortcut triggers the button, pass `shortcut`. When one key toggles between two buttons' actions (Ctrl+A = select-all ↔ clear-when-complete), the chip sits on whichever button the key would *currently* trigger — a shown shortcut must never be wrong.
- `side` (`top` default) with automatic fallback to a side that fits; `w-max` capped at `max-w-xs` (override via `maxWidth`); `interactive` (hoverable body, click-to-dismiss); `open`+`triggerStyle` for anchoring over non-React visuals (e.g. contenteditable chips). Portal at `z-[10001]`, `bg-navy-800`.

### Chips / badges (rule)

- **Chip border color matches its text color** (e.g. `text-purple-300` → `border-purple-300/40`). Don't pair a colored text with a neutral border.
- Tag chips: `text-[10px] px-1.5 py-0.5 rounded`. Merge-field chips: see `TemplateBodyEditor` exports (`MERGE_FIELD_CHIP_CLASS`).
- **File-class tag-border palette** (files grid `TaggedThumb`): the video class is the warm family — **red** Recording · **pink** Clip · **violet** Short — images are cool — **teal** selected thumbnail · **gray** alternates. **Blue is reserved** (unassigned; save it for a future marker). Shorts use Tailwind's literal `violet-*`, never the app's `purple-*` tokens (those are the remapped slate accent and would collide with selection rings). SM-made files always show their tag statically; hover-only tags are for affordances on non-SM files (e.g. set-as-thumbnail).

---

## App-level rules (hard preferences)

- **No toast/snackbar notifications, ever.** For soft outcomes, stay silent or use persistent UI (inline status, icons, modal results). [established preference]
- **No OS/system notifications either.** Errors from background- or tray-initiated actions bring the main window up (`show()` + `focus()`) and surface IN-APP — a modal, same as the post-stream Twitch auto-update problem and tray launch-group failures. SM never speaks through the Windows notification center. (Cloud-provider download notifications from Synology/OneDrive are theirs, not ours.)
- **No secondary modals.** Never open a modal from inside a modal — use inline editing (turn the row into an editable form with Save/Cancel) instead.
- **Frameless titlebar — `top-10` rule (CRITICAL).** The window is `frame:false`; native controls sit in the top ~40px. All fixed overlays/backdrops/drawers MUST use `top-10` (e.g. `fixed inset-x-0 bottom-0 top-10`), **never** `inset-0`/`top-0`, or they cover the min/max/close controls.
- **Dark theme only.** No light mode.
- **Errors surface inline**, not via toasts (consistent with no-toast rule) — e.g. the AI hint lines turn red with the message.

---

## Recurring patterns

- **Page header** — match the streams page: `text-lg font-semibold` title + `text-xs text-gray-400` subtitle, `px-6 py-4 border-b border-white/5`. `TODO:` paste the canonical header JSX here as the reference snippet.
- **Loading states** — spinner (`Loader2 animate-spin`) + reserved height (min-height to prevent content jump), never a bare "Loading…" text node.
- **Empty states** — `TODO:` document the standard (icon + message + optional CTA) once the thumbnail/launcher/streams empty states are unified.
- **AI suggestion hint line** — `text-[10px] text-gray-400`, states: idle "Ctrl+Space for AI suggestion" / loading spinner+"Generating…" / "Tab to accept · Esc to dismiss" / error (red, `AlertTriangle` + message). Pattern lives in `useFieldSuggestion` + `TemplateBodyEditor`.
- **Platform icons by field label** — `<Youtube size={11} className="text-red-400/70" />`, `<Twitch size={11} className="text-twitch-400/70" />` to mark which platform a field targets.
- **Persistent vs conditional pages** — Player/Converter stay mounted (`hidden` class) to preserve state; others are conditionally rendered. Wrap page content in `PageErrorBoundary`.
- **Streams list column widths** — thumbnail `p-0` (48px img) · stream type `w-[230px]` · video count `w-[44px]` · date `min-w-[130px]` · comments `w-[140px]`; all cells `px-2 py-2 align-middle`. `TODO:` confirm still current after the planned redesigns.

---

## Known inconsistencies to resolve (seed list for the consistency pass)

Spotted while auditing the primitives — decide the canonical choice and align:

1. **Placeholder color:** `Input`/`Textarea`/`Select` use `placeholder-gray-600`; `NumberInput` uses `placeholder-gray-500`. Pick one.
2. **Focus treatment:** `Input`/`Textarea`/`Select` use `focus:ring-2 ring-purple-500/50 + border`; `NumberInput` uses border-only (no ring). Standardize the focus affordance across all fields.
3. **Field text size:** standard fields are `text-sm`; `NumberInput` is `text-xs`. Decide if compact primitives are an intentional exception (and document it) or unify.
4. **Field label color:** `Input`/`Textarea`/`Select` labels are `text-gray-300`; many page/sidebar field labels use `text-gray-400`. Pick one label color.
5. **Select usage:** the `Select` primitive vs raw themed `<select> + ChevronDown` (used in Settings/Integrations). Consolidate or document when each applies.
6. **Button default variant** is `secondary` — confirm that's intended vs `primary` at call sites that omit `variant`.

---

## Not needed yet (revisit if the project grows)

Figma source files, a Storybook component catalog, a token build pipeline, automated visual-regression tests. Markdown + disciplined tokens/components is the right weight for a solo dev. Storybook is the natural upgrade if contributors arrive.
