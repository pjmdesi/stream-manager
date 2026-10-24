import React from 'react'
import { Check } from 'lucide-react'
import { Tooltip } from './Tooltip'

/** Toggle pill: the second checkbox. The stream-detail sidebar's style for
 *  OVERRIDE switches that own an adjacent input (Twitch custom
 *  title/category; the Series toggle is the same look hand-rolled in
 *  its segment group), and the link modal's list filter (STR-39). Off by
 *  default; turning it ON wears the primary-button chrome (same
 *  bg-accent-800 as "New stream") so the enabled state is unmistakable.
 *  `segment` embeds the pill as the left anchor of a bordered lockup; the
 *  standalone form is its own bordered box. A plain yes/no setting stays
 *  Checkbox. Lived in StreamsPage.tsx until 2026-10-24. */
export function TogglePill({ checked, onChange, tooltip, label, segment }: {
  checked: boolean
  onChange: (v: boolean) => void
  /** Describes what the click does NOW (per the tooltip rule). */
  tooltip: string
  /** Omit for an icon-only pill (segment lockups) — the tooltip then
   *  carries the whole explanation. */
  label?: React.ReactNode
  /** Render as the LEFT SEGMENT of a bordered lockup (the series /
   *  Twitch-override groups): no own border box — full-height, a
   *  hairline on the right, squared corners; the host group supplies
   *  the border, background, and rounding. */
  segment?: boolean
}) {
  const stateCls = checked
    ? 'bg-accent-800 hover:bg-accent-700 text-white'
    : `text-gray-500 hover:bg-white/5 hover:text-gray-300${segment ? '' : ' bg-navy-900/70'}`
  return (
    <Tooltip content={tooltip} side="top" triggerClassName={segment ? 'self-stretch flex' : undefined}>
      <button
        type="button"
        aria-pressed={checked}
        onClick={() => onChange(!checked)}
        // Focus affordance is a focus-VISIBLE inset ring, never a
        // background swap: focus:bg-* outranks the plain state bg, so a
        // just-clicked pill showed the focus tint instead of its checked
        // accent-tinted until blur — reading as a broken/mismatched state.
        className={segment
          ? `flex items-center gap-2 px-2.5 border-r border-white/10 transition-colors focus:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-accent-500/40 text-left ${stateCls}`
          : `flex items-center gap-2 max-w-full px-2.5 py-1.5 rounded-lg border border-white/10 transition-colors focus:outline-none focus-visible:ring-2 focus-visible:ring-accent-500/40 text-left ${stateCls}`}
      >
        <Check size={12} strokeWidth={3} className={`shrink-0 ${checked ? '' : 'opacity-30'}`} />
        {label != null && <span className="min-w-0">{label}</span>}
      </button>
    </Tooltip>
  )
}
