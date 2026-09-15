import type { GradientColorSpace, GradientGeometry, GradientStop, GradientStyle } from './gradient'
import { buildKonvaColorStops, conicStartRadians, farthestCornerDistance } from './gradient'

/**
 * Radial and conic gradients for Konva (THU-9). Konva has native props for
 * linear fills and strokes and radial fills, but no radial stroke and no
 * conic anything, so those cases hand Konva a real CanvasGradient object as
 * the `fill` or `stroke` value: the canvas accepts a gradient wherever it
 * accepts a colour string, and a gradient built on one 2D context can be
 * used on any other. Coordinates are read in the shape's local drawing
 * space at fill time, so the geometry is expressed in that space (the same
 * origin shift the linear path applies for the centered ellipse).
 */

let factoryCtx: CanvasRenderingContext2D | null = null
function ctx(): CanvasRenderingContext2D | null {
  if (factoryCtx) return factoryCtx
  if (typeof document === 'undefined') return null
  factoryCtx = document.createElement('canvas').getContext('2d')
  return factoryCtx
}

/** A CanvasGradient for a radial or conic gradient over a w×h box whose
 *  top-left sits at (sx, sy) in the drawing space. Null for linear (the
 *  caller uses Konva's native props) or when no canvas is available. */
export function makeCanvasGradient(
  stops: GradientStop[],
  space: GradientColorSpace,
  style: GradientStyle,
  geom: GradientGeometry,
  w: number,
  h: number,
  sx = 0,
  sy = 0,
): CanvasGradient | null {
  if (geom.kind === 'linear') return null
  const c = ctx()
  if (!c) return null
  const cx = sx + geom.centerX * w
  const cy = sy + geom.centerY * h
  let grad: CanvasGradient
  if (geom.kind === 'radial') {
    const r = Math.max(0.01, geom.radius) * farthestCornerDistance(w, h, geom.centerX, geom.centerY)
    grad = c.createRadialGradient(cx, cy, 0, cx, cy, Math.max(0.01, r))
  } else {
    grad = c.createConicGradient(conicStartRadians(geom.angle), cx, cy)
  }
  const flat = buildKonvaColorStops(stops, space, style)
  for (let i = 0; i + 1 < flat.length; i += 2) {
    const pos = Math.min(1, Math.max(0, flat[i] as number))
    grad.addColorStop(pos, flat[i + 1] as string)
  }
  return grad
}
