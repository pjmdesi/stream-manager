/**
 * Tag color system — 12 predefined Tailwind-based color options.
 *
 * All class strings are written out fully so Tailwind's build-time purge
 * never removes them. Dynamic construction (e.g. `bg-${color}-900/40`) is
 * intentionally avoided.
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
    key: 'purple',
    label: 'Purple',
    chip: 'bg-purple-900/40 text-purple-300 border-purple-300/30',
    text: 'text-purple-300',
    highlight: 'bg-purple-600/30',
    swatch: 'bg-purple-500',
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

const D = 'rgba(0,0,0,0.5)'

export function getTagTextureStyle(textureKey: string | undefined): TagTextureStyle {
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
 * – if all 12 are used, randomly selects from those with the lowest usage count.
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
