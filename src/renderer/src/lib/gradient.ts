/**
 * Gradient color math for the thumbnail editor (thumbnails #2).
 *
 * Canvas/Konva gradients interpolate in sRGB only, which drags saturated
 * blends through gray (the classic red→blue dead zone). The oklch mode
 * here pre-computes the blend instead: the user's stops are sampled
 * through OKLab/OKLCh math into a piecewise multi-stop gradient that any
 * canvas renders natively. sRGB mode passes the stops straight through.
 *
 * Conversions use Björn Ottosson's published OKLab reference constants.
 */

export interface GradientStop {
  /** #rrggbb or #rrggbbaa */
  color: string
  /** 0..1 along the gradient line */
  pos: number
}

export type GradientColorSpace = 'oklch' | 'srgb'

interface Rgba { r: number; g: number; b: number; a: number }
interface Oklab { L: number; A: number; B: number; a: number }

function parseHex(hex: string): Rgba {
  const m = /^#([0-9a-f]{6})([0-9a-f]{2})?$/i.exec(hex)
  if (!m) return { r: 0, g: 0, b: 0, a: 1 }
  const n = parseInt(m[1], 16)
  return {
    r: ((n >> 16) & 0xff) / 255,
    g: ((n >> 8) & 0xff) / 255,
    b: (n & 0xff) / 255,
    a: m[2] !== undefined ? parseInt(m[2], 16) / 255 : 1,
  }
}

const srgbToLinear = (c: number): number => (c <= 0.04045 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4))
const linearToSrgb = (c: number): number => (c <= 0.0031308 ? 12.92 * c : 1.055 * Math.pow(c, 1 / 2.4) - 0.055)
const clamp01 = (c: number): number => Math.min(1, Math.max(0, c))

function rgbaToOklab({ r, g, b, a }: Rgba): Oklab {
  const lr = srgbToLinear(r)
  const lg = srgbToLinear(g)
  const lb = srgbToLinear(b)
  const l = Math.cbrt(0.4122214708 * lr + 0.5363325363 * lg + 0.0514459929 * lb)
  const m = Math.cbrt(0.2119034982 * lr + 0.6806995451 * lg + 0.1073969566 * lb)
  const s = Math.cbrt(0.0883024619 * lr + 0.2817188376 * lg + 0.6299787005 * lb)
  return {
    L: 0.2104542553 * l + 0.7936177850 * m - 0.0040720468 * s,
    A: 1.9779984951 * l - 2.4285922050 * m + 0.4505937099 * s,
    B: 0.0259040371 * l + 0.7827717662 * m - 0.8086757660 * s,
    a,
  }
}

function oklabToRgba({ L, A, B, a }: Oklab): Rgba {
  const l = (L + 0.3963377774 * A + 0.2158037573 * B) ** 3
  const m = (L - 0.1055613458 * A - 0.0638541728 * B) ** 3
  const s = (L - 0.0894841775 * A - 1.2914855480 * B) ** 3
  // Naive per-channel clamp for out-of-gamut results — at the sample
  // densities used here the error is visually negligible.
  return {
    r: clamp01(linearToSrgb(4.0767416621 * l - 3.3077115913 * m + 0.2309699292 * s)),
    g: clamp01(linearToSrgb(-1.2684380046 * l + 2.6097574011 * m - 0.3413193965 * s)),
    b: clamp01(linearToSrgb(-0.0041960863 * l - 0.7034186147 * m + 1.7076147010 * s)),
    a,
  }
}

function cssRgba({ r, g, b, a }: Rgba): string {
  const to255 = (c: number): number => Math.round(c * 255)
  return `rgba(${to255(r)}, ${to255(g)}, ${to255(b)}, ${Number(a.toFixed(4))})`
}

/** Mix two colors at t (0..1) in OKLCh: L and C interpolate linearly, hue
 *  takes the shorter arc, and an achromatic endpoint (C≈0: white, black,
 *  grays) adopts the other endpoint's hue so blends into gray don't spin
 *  the hue wheel. Alpha interpolates linearly. */
function mixOklch(c1: Rgba, c2: Rgba, t: number): Rgba {
  const lab1 = rgbaToOklab(c1)
  const lab2 = rgbaToOklab(c2)
  const C1 = Math.hypot(lab1.A, lab1.B)
  const C2 = Math.hypot(lab2.A, lab2.B)
  const ACHROMATIC = 1e-4
  let h1 = Math.atan2(lab1.B, lab1.A)
  let h2 = Math.atan2(lab2.B, lab2.A)
  if (C1 < ACHROMATIC) h1 = h2
  if (C2 < ACHROMATIC) h2 = h1
  let dh = h2 - h1
  if (dh > Math.PI) dh -= 2 * Math.PI
  if (dh < -Math.PI) dh += 2 * Math.PI
  const L = lab1.L + (lab2.L - lab1.L) * t
  const C = C1 + (C2 - C1) * t
  const h = h1 + dh * t
  return oklabToRgba({ L, A: C * Math.cos(h), B: C * Math.sin(h), a: lab1.a + (lab2.a - lab1.a) * t })
}

/** Konva `fillLinearGradientColorStops` array ([pos, color, pos, color…]).
 *  oklch mode subdivides each stop pair into `samplesPerSegment` pieces so
 *  the canvas's native sRGB interpolation only ever bridges tiny,
 *  visually-linear intervals. */
export function buildKonvaColorStops(
  stops: GradientStop[],
  space: GradientColorSpace,
  samplesPerSegment = 16,
): (number | string)[] {
  const ordered = [...stops].sort((x, y) => x.pos - y.pos)
  if (space === 'srgb' || ordered.length < 2) {
    return ordered.flatMap(s => [s.pos, cssRgba(parseHex(s.color))])
  }
  const out: (number | string)[] = []
  for (let i = 0; i < ordered.length - 1; i++) {
    const a = ordered[i]
    const b = ordered[i + 1]
    const ca = parseHex(a.color)
    const cb = parseHex(b.color)
    // Skip k=0 on later segments — it duplicates the previous segment's end.
    for (let k = i === 0 ? 0 : 1; k <= samplesPerSegment; k++) {
      const t = k / samplesPerSegment
      out.push(a.pos + (b.pos - a.pos) * t, cssRgba(mixOklch(ca, cb, t)))
    }
  }
  return out
}

/** CSS-style gradient line across a w×h box anchored at (0,0): the angle
 *  follows the CSS convention (0° = up, 90° = right, measured clockwise),
 *  the line passes through the center, and its length is the CSS
 *  projection |w·sin| + |h·cos| so the first/last stops land exactly on
 *  the box corners the way linear-gradient() does. */
export function gradientLinePoints(
  angleDeg: number,
  w: number,
  h: number,
): { start: { x: number; y: number }; end: { x: number; y: number } } {
  const rad = (angleDeg * Math.PI) / 180
  // Screen coords (y down): CSS 0° points up.
  const dx = Math.sin(rad)
  const dy = -Math.cos(rad)
  const halfLen = (Math.abs(w * dx) + Math.abs(h * dy)) / 2
  const cx = w / 2
  const cy = h / 2
  return {
    start: { x: cx - dx * halfLen, y: cy - dy * halfLen },
    end: { x: cx + dx * halfLen, y: cy + dy * halfLen },
  }
}

/** CSS background for the editor's preview bar. Chromium supports
 *  `linear-gradient(… in oklch, …)` natively, so the bar previews both
 *  blend modes accurately. The angle orients the bar itself (180° for the
 *  vertical spine: first stop at top) — it previews the COLORS; the
 *  gradient's real direction is visible on the canvas. */
export function cssGradientPreview(stops: GradientStop[], space: GradientColorSpace, angleDeg = 90): string {
  const ordered = [...stops].sort((x, y) => x.pos - y.pos)
  const list = ordered.map(s => `${s.color} ${Math.round(s.pos * 100)}%`).join(', ')
  return `linear-gradient(${angleDeg}deg${space === 'oklch' ? ' in oklch' : ''}, ${list})`
}
