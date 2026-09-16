import type { ThumbnailLayer } from '../types'
import type { Pt } from './polygon'

/**
 * Arrow geometry for the thumbnail editor's arrow shape (THU-20).
 *
 * An arrow is a box-defined shape like the polygon: it fills its layer box,
 * points from the left edge to the right edge, and the box height is the
 * head's span. Rotation gives direction; flips mirror it. Every proportion
 * is stored relative to the box, so resizing scales the whole arrow like a
 * glyph.
 *
 * The outline is built once in a design space (length 1 along x, head span
 * DESIGN_SPAN), then its bounding box is normalized to 0..1 and scaled to
 * the layer's width and height, which is what makes a curved arrow fill its
 * box exactly. Corner radius is in pixels and applied after the scale, as
 * the polygon does, so rounded tips stay circular through resizes.
 */

export type ArrowHead = 'triangle' | 'notched' | 'none'

export interface ArrowParams {
  head: ArrowHead
  /** Head length as a percent of the arrow's length. */
  headLength: number
  /** Stem thickness as a percent of the head span. */
  stem: number
  /** Stem thickness at the tail as a percent of its thickness at the head:
   *  100 is a uniform stem, 0 tapers to a point. */
  taper: number
  /** Bow of the centerline, -100..100; 0 is straight, positive bows up. */
  bend: number
  /** Keep the very tip sharp when the corner radius rounds the rest. */
  sharpTip: boolean
}

export const ARROW_DEFAULTS: ArrowParams = { head: 'triangle', headLength: 40, stem: 45, taper: 100, bend: 0, sharpTip: false }
export const ARROW_HEAD_LENGTH_MIN = 10
export const ARROW_HEAD_LENGTH_MAX = 70
export const ARROW_STEM_MIN = 5
export const ARROW_STEM_MAX = 100
export const ARROW_BEND_MAX = 100
/** Width of a freshly added arrow; its height follows the natural aspect. */
export const ARROW_DEFAULT_WIDTH = 300

/** Head span relative to the length in design space: the natural straight
 *  arrow is 300 by 120. */
const DESIGN_SPAN = 0.4
/** Control-point offset at bend 100, as a fraction of the length (the
 *  centerline's midpoint moves by half of it). */
const BEND_CONTROL = 0.6
/** How far the notched head's barbs sweep back, as a fraction of the head
 *  length. */
const NOTCH_DEPTH = 0.3
/** Samples along a curved stem's edge. A straight arrow needs none. */
const CURVE_SEGMENTS = 24

const clamp = (v: number, lo: number, hi: number) => Math.max(lo, Math.min(hi, v))

/** The arrow's parameters with defaults and clamps applied. */
export function arrowParamsOf(layer: ThumbnailLayer): ArrowParams {
  const head = layer.arrowHead === 'notched' || layer.arrowHead === 'none' ? layer.arrowHead : 'triangle'
  return {
    head,
    headLength: clamp(Math.round(layer.arrowHeadLength ?? ARROW_DEFAULTS.headLength), ARROW_HEAD_LENGTH_MIN, ARROW_HEAD_LENGTH_MAX),
    stem: clamp(Math.round(layer.arrowStem ?? ARROW_DEFAULTS.stem), ARROW_STEM_MIN, ARROW_STEM_MAX),
    taper: clamp(Math.round(layer.arrowTaper ?? ARROW_DEFAULTS.taper), 0, 100),
    bend: clamp(Math.round(layer.arrowBend ?? ARROW_DEFAULTS.bend), -ARROW_BEND_MAX, ARROW_BEND_MAX),
    sharpTip: !!layer.arrowSharpTip,
  }
}

/** A closed outline. `round` marks the true vertices (tail corners, the
 *  stem-to-head junctions, the barbs, the tip), which take the corner
 *  radius; the points sampled along a curved stem do not. */
export interface ArrowOutline { pts: Pt[]; round: boolean[] }

function designOutline(p: ArrowParams): ArrowOutline {
  const S = DESIGN_SPAN
  const hl = p.head === 'none' ? 0 : p.headLength / 100
  const tHead = 1 - hl
  const halfStem = ((p.stem / 100) * S) / 2
  const taper = p.taper / 100
  const k = (p.bend / 100) * BEND_CONTROL
  // Quadratic centerline from the tail (0,0) toward (1,0); screen y grows
  // downward, so a positive bend lifts the control point. Only the STEM
  // follows the curve (t from 0 to tHead); the head is a straight,
  // symmetric continuation along the stem's end tangent, so a bend never
  // skews it. On a straight arrow the tip lands on (1,0) exactly.
  const C = { x: 0.5, y: -k }
  const P = (t: number): Pt => ({
    x: (1 - t) * (1 - t) * 0 + 2 * (1 - t) * t * C.x + t * t * 1,
    y: 2 * (1 - t) * t * C.y,
  })
  const D = (t: number): Pt => ({
    x: 2 * (1 - t) * C.x + 2 * t * (1 - C.x),
    y: 2 * (1 - t) * C.y + 2 * t * (0 - C.y),
  })
  const unit = (v: Pt): Pt => { const l = Math.hypot(v.x, v.y) || 1; return { x: v.x / l, y: v.y / l } }
  // "Up" is the tangent turned a quarter turn counterclockwise on screen:
  // a rightward tangent gives (0, -1).
  const upAt = (t: number): Pt => { const d = unit(D(t)); return { x: d.y, y: -d.x } }

  const segs = p.bend === 0 ? 1 : CURVE_SEGMENTS
  const upper: Pt[] = []
  const lower: Pt[] = []
  for (let i = 0; i <= segs; i++) {
    const u = i / segs
    const t = tHead * u
    const half = halfStem * (taper + (1 - taper) * u)
    const c = P(t)
    const n = upAt(t)
    upper.push({ x: c.x + n.x * half, y: c.y + n.y * half })
    lower.push({ x: c.x - n.x * half, y: c.y - n.y * half })
  }

  const pts: Pt[] = []
  const round: boolean[] = []
  const push = (pt: Pt, r: boolean) => {
    const last = pts[pts.length - 1]
    // A tail tapered to a point makes the two tail corners coincide; keep one.
    if (last && Math.abs(last.x - pt.x) < 1e-9 && Math.abs(last.y - pt.y) < 1e-9) return
    pts.push(pt)
    round.push(r)
  }
  upper.forEach((pt, i) => push(pt, i === 0 || i === segs))
  if (p.head !== 'none') {
    const Hb = P(tHead)
    const n = upAt(tHead)
    const d = unit(D(tHead))
    const back = p.head === 'notched' ? NOTCH_DEPTH * hl : 0
    push({ x: Hb.x - d.x * back + n.x * (S / 2), y: Hb.y - d.y * back + n.y * (S / 2) }, true)
    push({ x: Hb.x + d.x * hl, y: Hb.y + d.y * hl }, !p.sharpTip)
    push({ x: Hb.x - d.x * back - n.x * (S / 2), y: Hb.y - d.y * back - n.y * (S / 2) }, true)
  }
  for (let i = segs; i >= 0; i--) push(lower[i], i === 0 || i === segs)
  // The lower tail corner may coincide with the upper one (taper 0): the
  // dedupe above only checks neighbors, so close the loop by hand.
  if (pts.length > 1) {
    const a = pts[0], b = pts[pts.length - 1]
    if (Math.abs(a.x - b.x) < 1e-9 && Math.abs(a.y - b.y) < 1e-9) { pts.pop(); round.pop() }
  }
  return { pts, round }
}

function bounds(pts: Pt[]): { minX: number; minY: number; w: number; h: number } {
  let minX = Infinity, maxX = -Infinity, minY = Infinity, maxY = -Infinity
  for (const p of pts) {
    if (p.x < minX) minX = p.x
    if (p.x > maxX) maxX = p.x
    if (p.y < minY) minY = p.y
    if (p.y > maxY) maxY = p.y
  }
  return { minX, minY, w: maxX - minX || 1, h: maxY - minY || 1 }
}

/** Width divided by height of the arrow drawn at its natural proportions.
 *  A layer whose box matches this ratio renders the arrow as designed; any
 *  other box is the user's stretch on top of it. */
export function arrowNaturalAspect(p: ArrowParams): number {
  const b = bounds(designOutline(p).pts)
  return b.w / b.h
}

/** Box for a new arrow of the given width. */
export function arrowBox(p: ArrowParams, width: number): { width: number; height: number } {
  return { width, height: Math.max(1, Math.round(width / arrowNaturalAspect(p))) }
}

/** The outline in pixel space for a `w` by `h` box (top-left origin). */
export function arrowOutline(layer: ThumbnailLayer, w: number, h: number): ArrowOutline {
  const o = designOutline(arrowParamsOf(layer))
  const b = bounds(o.pts)
  return {
    pts: o.pts.map(p => ({ x: ((p.x - b.minX) / b.w) * w, y: ((p.y - b.minY) / b.h) * h })),
    round: o.round,
  }
}

/** Largest radius the corner at vertex `i` can take before its arc runs
 *  past the midpoint of the shorter adjacent edge. */
function maxRadiusAt(pts: Pt[], i: number): number {
  const n = pts.length
  const prev = pts[(i + n - 1) % n]
  const cur = pts[i]
  const next = pts[(i + 1) % n]
  const ax = prev.x - cur.x, ay = prev.y - cur.y
  const bx = next.x - cur.x, by = next.y - cur.y
  const la = Math.hypot(ax, ay), lb = Math.hypot(bx, by)
  if (la === 0 || lb === 0) return 0
  const cos = Math.max(-1, Math.min(1, (ax * bx + ay * by) / (la * lb)))
  const theta = Math.acos(cos)
  if (theta <= 1e-6 || theta >= Math.PI - 1e-6) return 0
  return (Math.min(la, lb) / 2) * Math.tan(theta / 2)
}

/** The largest corner radius that still changes the arrow: each true
 *  vertex is clamped on its own, so this is the largest of their limits
 *  (the tip on a slim arrow rounds long after the tail corners have hit
 *  theirs). */
export function arrowMaxCornerRadius(o: ArrowOutline): number {
  let best = 0
  o.pts.forEach((_, i) => { if (o.round[i]) best = Math.max(best, maxRadiusAt(o.pts, i)) })
  return best
}

type TraceCtx = {
  beginPath(): void
  moveTo(x: number, y: number): void
  lineTo(x: number, y: number): void
  arcTo(x1: number, y1: number, x2: number, y2: number, r: number): void
  closePath(): void
}

/** Trace the outline on a 2D context. True vertices round with `radius`,
 *  each clamped to what its own corner can take; sampled curve points are
 *  joined straight. The path starts at the midpoint of the closing edge so
 *  the first vertex can round like the others. */
export function traceArrowPath(ctx: TraceCtx, o: ArrowOutline, radius: number): void {
  const { pts, round } = o
  const n = pts.length
  ctx.beginPath()
  if (n === 0) return
  if (radius <= 0) {
    ctx.moveTo(pts[0].x, pts[0].y)
    for (let i = 1; i < n; i++) ctx.lineTo(pts[i].x, pts[i].y)
    ctx.closePath()
    return
  }
  const last = pts[n - 1]
  ctx.moveTo((last.x + pts[0].x) / 2, (last.y + pts[0].y) / 2)
  for (let i = 0; i < n; i++) {
    const cur = pts[i]
    const next = pts[(i + 1) % n]
    const r = round[i] ? Math.min(radius, maxRadiusAt(pts, i)) : 0
    if (r > 0) ctx.arcTo(cur.x, cur.y, next.x, next.y, r)
    else ctx.lineTo(cur.x, cur.y)
  }
  ctx.closePath()
}

/**
 * The layer patch for changing an arrow's parameters so the arrow keeps the
 * user's stretch: the box height follows the new natural ratio with the
 * same deviation the old box had, and the origin moves so the visual
 * center stays put (the layer rotates about its top-left corner, so the
 * vertical shift is rotated with it). Same construction as the polygon's
 * side-count change.
 */
export function arrowParamsPatch(layer: ThumbnailLayer, patch: Partial<ArrowParams>): Partial<ThumbnailLayer> {
  const before = arrowParamsOf(layer)
  const after = arrowParamsOf({
    ...layer,
    arrowHead: patch.head ?? layer.arrowHead,
    arrowHeadLength: patch.headLength ?? layer.arrowHeadLength,
    arrowStem: patch.stem ?? layer.arrowStem,
    arrowTaper: patch.taper ?? layer.arrowTaper,
    arrowBend: patch.bend ?? layer.arrowBend,
    arrowSharpTip: patch.sharpTip ?? layer.arrowSharpTip,
  })
  const fields: Partial<ThumbnailLayer> = {
    arrowHead: after.head,
    arrowHeadLength: after.headLength,
    arrowStem: after.stem,
    arrowTaper: after.taper,
    arrowBend: after.bend,
    arrowSharpTip: after.sharpTip,
  }
  const w = layer.width ?? ARROW_DEFAULT_WIDTH
  const h = layer.height ?? Math.round(w / arrowNaturalAspect(before))
  const oldAspect = arrowNaturalAspect(before)
  const newAspect = arrowNaturalAspect(after)
  if (Math.abs(oldAspect - newAspect) < 1e-9) return fields
  const stretch = (w / h) / oldAspect
  const newH = Math.max(1, Math.round(w / (newAspect * stretch)))
  const dy = (h - newH) / 2
  const rad = ((layer.rotation ?? 0) * Math.PI) / 180
  return {
    ...fields,
    height: newH,
    x: layer.x - dy * Math.sin(rad),
    y: layer.y + dy * Math.cos(rad),
  }
}
