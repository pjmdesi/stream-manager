/**
 * Tag color system — 16 predefined color options.
 *
 * All class strings are written out fully so Tailwind's build-time purge
 * never removes them. Dynamic construction (e.g. `bg-${color}-900/40`) is
 * intentionally avoided. Literal hex arbitrary classes (e.g. the Brown and
 * true-Purple entries) are equally purge-safe as long as they appear
 * verbatim in the source.
 *
 * THEME GOTCHA: the app's Tailwind `purple-*` family is REMAPPED to a cool
 * slate-gray (tailwind.config.js) to neutralize the UI. The legacy 'purple'
 * entry therefore RENDERS gray and is labeled Gray; its key stays 'purple'
 * because keys are persisted in users' tagColors data. The real purple
 * lives in the 'true-purple' entry via Tailwind's DEFAULT purple hexes.
 */

export interface TagColor {
  key: string
  label: string
  /** Classes for the chip in tag lists / stream cards */
  chip: string
  /** Text color used in dropdown option labels */
  text: string
  /** Background highlight used for the hovered / selected dropdown row */
  highlight: string
  /** Solid Tailwind background class for the swatch circle in the color picker */
  swatch: string
  /** Ring class for the highlighted chip in the dropdown */
  ring: string
  /** Class for the check icon shown on the selected swatch. Only set on
   *  swatches too light for the default white check (e.g. White). Render
   *  sites fall back to 'text-white drop-shadow'. */
  check?: string
}

export const TAG_COLORS: TagColor[] = [
  {
    key: 'slate',
    label: 'Slate',
    chip: 'bg-slate-800/60 text-slate-300 border-slate-300/30',
    text: 'text-slate-300',
    highlight: 'bg-slate-600/30',
    swatch: 'bg-slate-500',
    ring: 'ring-slate-400/70',
  },
  {
    key: 'red',
    label: 'Red',
    chip: 'bg-red-900/40 text-red-300 border-red-300/30',
    text: 'text-red-300',
    highlight: 'bg-red-600/30',
    swatch: 'bg-red-500',
    ring: 'ring-red-400/70',
  },
  {
    key: 'orange',
    label: 'Orange',
    chip: 'bg-orange-900/40 text-orange-300 border-orange-300/30',
    text: 'text-orange-300',
    highlight: 'bg-orange-600/30',
    swatch: 'bg-orange-500',
    ring: 'ring-orange-400/70',
  },
  {
    key: 'amber',
    label: 'Amber',
    chip: 'bg-amber-900/40 text-amber-300 border-amber-300/30',
    text: 'text-amber-300',
    highlight: 'bg-amber-600/30',
    swatch: 'bg-amber-500',
    ring: 'ring-amber-400/70',
  },
  {
    key: 'yellow',
    label: 'Yellow',
    chip: 'bg-yellow-900/40 text-yellow-300 border-yellow-300/30',
    text: 'text-yellow-300',
    highlight: 'bg-yellow-600/30',
    swatch: 'bg-yellow-400',
    ring: 'ring-yellow-400/70',
  },
  {
    key: 'lime',
    label: 'Lime',
    chip: 'bg-lime-900/40 text-lime-300 border-lime-300/30',
    text: 'text-lime-300',
    highlight: 'bg-lime-600/30',
    swatch: 'bg-lime-500',
    ring: 'ring-lime-400/70',
  },
  {
    key: 'green',
    label: 'Green',
    chip: 'bg-green-900/40 text-green-300 border-green-300/30',
    text: 'text-green-300',
    highlight: 'bg-green-600/30',
    swatch: 'bg-green-500',
    ring: 'ring-green-400/70',
  },
  {
    key: 'teal',
    label: 'Teal',
    chip: 'bg-teal-900/40 text-teal-300 border-teal-300/30',
    text: 'text-teal-300',
    highlight: 'bg-teal-600/30',
    swatch: 'bg-teal-500',
    ring: 'ring-teal-400/70',
  },
  {
    key: 'cyan',
    label: 'Cyan',
    chip: 'bg-cyan-900/40 text-cyan-300 border-cyan-300/30',
    text: 'text-cyan-300',
    highlight: 'bg-cyan-600/30',
    swatch: 'bg-cyan-500',
    ring: 'ring-cyan-400/70',
  },
  {
    key: 'blue',
    label: 'Blue',
    chip: 'bg-blue-900/40 text-blue-300 border-blue-300/30',
    text: 'text-blue-300',
    highlight: 'bg-blue-600/30',
    swatch: 'bg-blue-500',
    ring: 'ring-blue-400/70',
  },
  {
    // Renders GRAY: the app's purple-* Tailwind family is remapped to cool
    // slate-gray (see the header comment). Key stays 'purple' for stored
    // data; the label tells the truth. Swatch darkened one step
    // (purple-500 was #c9d5e3, nearly white — indistinguishable from the
    // White swatch).
    key: 'purple',
    label: 'Gray',
    chip: 'bg-purple-900/40 text-purple-300 border-purple-300/30',
    text: 'text-purple-300',
    highlight: 'bg-purple-600/30',
    swatch: 'bg-purple-600',
    ring: 'ring-purple-400/70',
  },
  {
    key: 'pink',
    label: 'Pink',
    chip: 'bg-pink-900/40 text-pink-300 border-pink-300/30',
    text: 'text-pink-300',
    highlight: 'bg-pink-600/30',
    swatch: 'bg-pink-500',
    ring: 'ring-pink-400/70',
  },
  {
    // Tailwind's DEFAULT purple, as literal hexes — the purple-* classes
    // can't produce it here (theme remap, see header comment).
    key: 'true-purple',
    label: 'Purple',
    chip: 'bg-[#581c87]/40 text-[#d8b4fe] border-[#d8b4fe]/30',
    text: 'text-[#d8b4fe]',
    highlight: 'bg-[#9333ea]/30',
    swatch: 'bg-[#a855f7]',
    ring: 'ring-[#c084fc]/70',
  },
  {
    // No Tailwind brown family exists — hand-rolled scale, same shape as
    // the stock entries (dark translucent chip, light text).
    key: 'brown',
    label: 'Brown',
    chip: 'bg-[#4a2c17]/40 text-[#d3b8a3] border-[#d3b8a3]/30',
    text: 'text-[#d3b8a3]',
    highlight: 'bg-[#8a5a3b]/30',
    swatch: 'bg-[#a16b47]',
    ring: 'ring-[#b98a68]/70',
  },
  {
    // Bordered swatch: a pure-black circle disappears against the dark
    // picker background.
    key: 'black',
    label: 'Black',
    chip: 'bg-black/60 text-gray-300 border-white/25',
    text: 'text-gray-300',
    highlight: 'bg-white/10',
    swatch: 'bg-gray-950 border border-white/30',
    ring: 'ring-gray-400/70',
  },
  {
    // Inverted chip (light background, dark text) — the only entry where
    // the default white check would vanish, hence the check override.
    key: 'white',
    label: 'White',
    chip: 'bg-gray-100/90 text-gray-800 border-gray-500/40',
    text: 'text-gray-100',
    highlight: 'bg-white/20',
    swatch: 'bg-gray-100',
    ring: 'ring-white/80',
    check: 'text-gray-800',
  },
]

// ── Tag Textures ──────────────────────────────────────────────────────────────

export interface TagTexture {
  key: string
  label: string
  /** Short symbol shown in the picker button tooltip */
  symbol: string
}

export const TAG_TEXTURES: TagTexture[] = [
  { key: 'solid',            label: 'Solid',              symbol: '■'   },
  { key: 'diagonal',         label: 'Diagonal',           symbol: '///' },
  { key: 'reverse-diagonal', label: 'Reverse Diagonal',   symbol: '\\\\\\' },
  { key: 'crosshatch',       label: 'Crosshatch',         symbol: '###' },
  { key: 'dots',             label: 'Dots',               symbol: '⬡'  },
  { key: 'checker',          label: 'Checker',            symbol: '🏁'  },
]

export const DEFAULT_TAG_TEXTURE = 'solid'

export type TagTextureStyle = {
  backgroundImage?: string
  backgroundSize?: string
  backgroundPosition?: string
}

const DARK_INK = 'rgba(0,0,0,0.5)'
/** Texture ink for the Black tag color — dark-on-black is invisible.
 *  Lower opacity than the dark ink's 0.5: white-on-black has far more
 *  contrast, so the same weight read garish (0.2 tuned by eye). */
const LIGHT_INK = 'rgba(255,255,255,0.2)'

export function getTagTextureStyle(textureKey: string | undefined, colorKey?: string): TagTextureStyle {
  // Textures draw in translucent black, which disappears on the Black
  // chip — flip to light ink there. Pass the tag's colorKey wherever the
  // caller renders an actual colored chip; omit it for neutral surfaces
  // (the texture picker's fixed preview background).
  const D = colorKey === 'black' ? LIGHT_INK : DARK_INK
  switch (textureKey) {
    case 'diagonal':
      return { backgroundImage: `repeating-linear-gradient(45deg, ${D} 0px, ${D} 1.4px, transparent 1.4px, transparent 4.2px)` }
    case 'reverse-diagonal':
      return { backgroundImage: `repeating-linear-gradient(-45deg, ${D} 0px, ${D} 1.4px, transparent 1.4px, transparent 4.2px)` }
    case 'crosshatch':
      return { backgroundImage: `repeating-linear-gradient(45deg, ${D} 0px, ${D} 1.4px, transparent 1.4px, transparent 4.2px), repeating-linear-gradient(-45deg, ${D} 0px, ${D} 1.4px, transparent 1.4px, transparent 4.2px)` }
    case 'dots':
      return {
        backgroundImage: `radial-gradient(circle, ${D} 1px, transparent 1px), radial-gradient(circle, ${D} 1px, transparent 1px)`,
        backgroundSize: '6px 9px, 6px 9px',
        backgroundPosition: '0 0, 3px 4.5px',
      }
    case 'checker':
      return {
        backgroundImage: `repeating-conic-gradient(${D} 0% 25%, transparent 0% 50%)`,
        backgroundSize: '6px 6px',
      }
    default:
      return {}
  }
}

export function pickTextureForNewTag(tagTextures: Record<string, string>): string {
  const usageCounts: Record<string, number> = {}
  for (const t of TAG_TEXTURES) usageCounts[t.key] = 0
  for (const texture of Object.values(tagTextures)) {
    if (texture in usageCounts) usageCounts[texture]++
  }
  const minUsage = Math.min(...Object.values(usageCounts))
  const candidates = TAG_TEXTURES.filter(t => usageCounts[t.key] === minUsage)
  return candidates[Math.floor(Math.random() * candidates.length)].key
}

/** Fast key → color lookup */
export const TAG_COLOR_MAP: Record<string, TagColor> = Object.fromEntries(
  TAG_COLORS.map(c => [c.key, c])
)

/** Fallback used when a tag has no recorded color yet */
export const DEFAULT_TAG_COLOR = 'purple'

/**
 * Per-color SVG fill class for waveform paths. Mirrors the TAG_COLORS
 * palette one step lighter (400) at ~70% opacity so the fill reads
 * against the bg-black/60 waveform strip. Static map — Tailwind's
 * purger never strips the strings.
 */
const WAVEFORM_FILL: Record<string, string> = {
  slate: 'fill-slate-400/70',
  red: 'fill-red-400/70',
  orange: 'fill-orange-400/70',
  amber: 'fill-amber-400/70',
  yellow: 'fill-yellow-400/70',
  lime: 'fill-lime-400/70',
  green: 'fill-green-400/70',
  teal: 'fill-teal-400/70',
  cyan: 'fill-cyan-400/70',
  blue: 'fill-blue-400/70',
  purple: 'fill-purple-400/70',
  pink: 'fill-pink-400/70',
  'true-purple': 'fill-[#c084fc]/70',
  brown: 'fill-[#b98a68]/70',
  // Black's literal fill would be invisible on the bg-black/60 waveform
  // strip — a mid gray keeps the waveform readable while staying "black
  // flavored". White is fine as-is.
  black: 'fill-gray-500/70',
  white: 'fill-white/70',
}

export function getWaveformFillClass(colorKey: string | undefined): string {
  return WAVEFORM_FILL[colorKey ?? ''] ?? WAVEFORM_FILL[DEFAULT_TAG_COLOR]
}

/** Default color rotation for per-track audio coloring. Indexed by track
 *  number so each track gets a distinct color out of the box. */
export const DEFAULT_TRACK_COLORS = [
  'purple', 'cyan', 'amber', 'pink', 'lime', 'orange',
  'blue', 'teal', 'green', 'yellow', 'red', 'slate',
]

/** Resolve a stored color key (or undefined) to a TagColor, falling back to purple. */
export function getTagColor(colorKey: string | undefined): TagColor {
  return TAG_COLOR_MAP[colorKey ?? ''] ?? TAG_COLOR_MAP[DEFAULT_TAG_COLOR]
}

/**
 * Pick the best color for a newly created tag:
 * – randomly selects from colors not yet used by any tag;
 * – if all are used, randomly selects from those with the lowest usage count.
 */
export function pickColorForNewTag(tagColors: Record<string, string>): string {
  const usageCounts: Record<string, number> = {}
  for (const c of TAG_COLORS) usageCounts[c.key] = 0
  for (const color of Object.values(tagColors)) {
    if (color in usageCounts) usageCounts[color]++
  }
  const minUsage = Math.min(...Object.values(usageCounts))
  const candidates = TAG_COLORS.filter(c => usageCounts[c.key] === minUsage)
  return candidates[Math.floor(Math.random() * candidates.length)].key
}
