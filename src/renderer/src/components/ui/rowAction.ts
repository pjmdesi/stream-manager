/** Chrome for the small action buttons that sit in rows, cards and panel
 *  footers: the Converter and Combine job rows, the Streams sidebar's
 *  Archive and Delete, the file cards' hover row and the files-grid toolbar.
 *  Neutral at rest, colored only on hover, dimmed when disabled. These are
 *  raw `<button>`s wearing this class, and each carries a `<Tooltip>`.
 *
 *  `shrink-0` keeps the button from shrinking as a flex item of its row,
 *  and `min-w-max` forces its intrinsic width to its full max-content.
 *  Together these stop an inner CollapsibleLabel's `min-w-0` (needed for
 *  its 0fr/1fr collapse animation) from propagating up through the
 *  inline-grid and letting Chromium size the button to "just the icon",
 *  which rendered the label outside the button's box. */

export type RowActionTone = 'green' | 'red' | 'yellow' | 'blue' | 'accent' | 'gray' | 'pink' | 'cyan'
/** `md` for row and footer buttons; `sm` for the file cards and the
 *  files-grid toolbar, whose CollapsibleLabels use `-ms-1` to match the
 *  tighter gap. */
export type RowActionSize = 'md' | 'sm'

const BASE = 'inline-flex shrink-0 min-w-max items-center rounded-md text-[11px] text-gray-200 transition-colors disabled:opacity-40 disabled:cursor-not-allowed disabled:hover:bg-transparent disabled:hover:text-gray-200'

const SIZE: Record<RowActionSize, string> = {
  md: 'gap-1.5 px-2 py-1.5',
  sm: 'gap-1 px-1.5 py-1',
}

const TONE: Record<RowActionTone, string> = {
  green: 'hover:text-green-400 hover:bg-green-500/10',
  red: 'hover:text-red-400 hover:bg-red-500/10',
  yellow: 'hover:text-yellow-400 hover:bg-yellow-500/10',
  blue: 'hover:text-blue-400 hover:bg-blue-500/10',
  accent: 'hover:text-accent-300 hover:bg-accent-500/10',
  gray: 'hover:text-white hover:bg-white/10',
  pink: 'hover:text-pink-400 hover:bg-pink-500/10',
  cyan: 'hover:text-cyan-400 hover:bg-cyan-500/10',
}

export function rowActionClass(tone: RowActionTone, size: RowActionSize = 'md'): string {
  return `${BASE} ${SIZE[size]} ${TONE[tone]}`
}
