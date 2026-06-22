/**
 * Smooth color ramp for YouTube API quota usage.
 *
 * The text color stays neutral while usage is low, then ramps through
 * yellow/orange and into red as the daily quota fills up, matching the
 * urgency of the situation:
 *   0–50%  : neutral (gray)
 *   50–75% : neutral → yellow/orange (pure yellow/orange at 75%)
 *   75–90% : yellow/orange → red (pure red at 90%)
 *   90%+   : red
 *
 * Returns an `rgb(...)` string suitable for an inline `color` / `background`
 * style — the interpolation can't be expressed with discrete Tailwind classes.
 */

type RGB = [number, number, number]

const NEUTRAL: RGB = [209, 213, 219] // gray-300
const WARN: RGB    = [251, 191, 36]  // amber-400 (yellow/orange)
const DANGER: RGB  = [248, 113, 113] // red-400

function lerp(a: RGB, b: RGB, t: number): RGB {
  return [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, a[2] + (b[2] - a[2]) * t]
}

/** Color for a 0–1 usage ratio (used / limit). */
export function quotaColor(ratio: number): string {
  const r = Math.max(0, Math.min(1, ratio))
  let c: RGB
  if (r <= 0.5) c = NEUTRAL
  else if (r <= 0.75) c = lerp(NEUTRAL, WARN, (r - 0.5) / 0.25)
  else if (r <= 0.9) c = lerp(WARN, DANGER, (r - 0.75) / 0.15)
  else c = DANGER
  return `rgb(${Math.round(c[0])}, ${Math.round(c[1])}, ${Math.round(c[2])})`
}
