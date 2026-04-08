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
}

export const TAG_COLORS: TagColor[] = [
  {
    key: 'slate',
    label: 'Slate',
    chip: 'bg-slate-800/60 text-slate-300 border-slate-600/40',
    text: 'text-slate-300',
    highlight: 'bg-slate-600/30',
    swatch: 'bg-slate-500',
  },
  {
    key: 'red',
    label: 'Red',
    chip: 'bg-red-900/40 text-red-300 border-red-800/40',
    text: 'text-red-300',
    highlight: 'bg-red-600/30',
    swatch: 'bg-red-500',
  },
  {
    key: 'orange',
    label: 'Orange',
    chip: 'bg-orange-900/40 text-orange-300 border-orange-800/40',
    text: 'text-orange-300',
    highlight: 'bg-orange-600/30',
    swatch: 'bg-orange-500',
  },
  {
    key: 'amber',
    label: 'Amber',
    chip: 'bg-amber-900/40 text-amber-300 border-amber-800/40',
    text: 'text-amber-300',
    highlight: 'bg-amber-600/30',
    swatch: 'bg-amber-500',
  },
  {
    key: 'yellow',
    label: 'Yellow',
    chip: 'bg-yellow-900/40 text-yellow-300 border-yellow-800/40',
    text: 'text-yellow-300',
    highlight: 'bg-yellow-600/30',
    swatch: 'bg-yellow-400',
  },
  {
    key: 'lime',
    label: 'Lime',
    chip: 'bg-lime-900/40 text-lime-300 border-lime-800/40',
    text: 'text-lime-300',
    highlight: 'bg-lime-600/30',
    swatch: 'bg-lime-500',
  },
  {
    key: 'green',
    label: 'Green',
    chip: 'bg-green-900/40 text-green-300 border-green-800/40',
    text: 'text-green-300',
    highlight: 'bg-green-600/30',
    swatch: 'bg-green-500',
  },
  {
    key: 'teal',
    label: 'Teal',
    chip: 'bg-teal-900/40 text-teal-300 border-teal-800/40',
    text: 'text-teal-300',
    highlight: 'bg-teal-600/30',
    swatch: 'bg-teal-500',
  },
  {
    key: 'cyan',
    label: 'Cyan',
    chip: 'bg-cyan-900/40 text-cyan-300 border-cyan-800/40',
    text: 'text-cyan-300',
    highlight: 'bg-cyan-600/30',
    swatch: 'bg-cyan-500',
  },
  {
    key: 'blue',
    label: 'Blue',
    chip: 'bg-blue-900/40 text-blue-300 border-blue-800/40',
    text: 'text-blue-300',
    highlight: 'bg-blue-600/30',
    swatch: 'bg-blue-500',
  },
  {
    key: 'purple',
    label: 'Purple',
    chip: 'bg-purple-900/40 text-purple-300 border-purple-800/40',
    text: 'text-purple-300',
    highlight: 'bg-purple-600/30',
    swatch: 'bg-purple-500',
  },
  {
    key: 'pink',
    label: 'Pink',
    chip: 'bg-pink-900/40 text-pink-300 border-pink-800/40',
    text: 'text-pink-300',
    highlight: 'bg-pink-600/30',
    swatch: 'bg-pink-500',
  },
]

/** Fast key → color lookup */
export const TAG_COLOR_MAP: Record<string, TagColor> = Object.fromEntries(
  TAG_COLORS.map(c => [c.key, c])
)

/** Fallback used when a tag has no recorded color yet */
export const DEFAULT_TAG_COLOR = 'purple'

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
