/** A duration or position as `H:MM:SS`, or `M:SS` under an hour. Anything
 *  that is not a positive finite number reads `0:00`, so a duration that has
 *  not been probed yet never shows as `NaN:NaN`. The one timecode formatter
 *  for rows, cards, modals, the converter and the player's clock. */
export function formatTimecode(seconds: number): string {
  if (!Number.isFinite(seconds) || seconds <= 0) return '0:00'
  const h = Math.floor(seconds / 3600)
  const m = Math.floor((seconds % 3600) / 60)
  const s = Math.floor(seconds % 60)
  return h > 0
    ? `${h}:${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`
    : `${m}:${String(s).padStart(2, '0')}`
}
