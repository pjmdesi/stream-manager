import type { ThumbnailLayer } from '../types'

/**
 * Regular-polygon geometry for the thumbnail editor's polygon shape
 * (THU-2), plus the one-time migration of the older triangle shape onto it.
 *
 * Conventions:
 *  - Flat bottom. Vertices are placed so one edge is centered at the bottom
 *    of the shape: a square sits square, a pentagon points up, a hexagon has
 *    a flat top and bottom, and a three-sided polygon is exactly the old
 *    triangle.
 *  - The polygon fills its bounding box. The vertices on the unit circle are
 *    normalized so their own extent spans 0..1 on both axes, then scaled to
 *    the layer's width and height. A non-square box stretches the shape the
 *    way it stretches an ellipse.
 *  - Corner radius is in pixels and applied after the stretch, so corners
 *    stay circular through resizes (the triangle already worked that way).
 *    It is clamped per shape to the largest radius at which adjacent arcs
 *    still fit on their shared edge.
 */

export const POLYGON_MIN_SIDES = 3
export const POLYGON_MAX_SIDES = 12
/** New polygons start as a triangle so the tool reads as distinct from the
 *  rectangle tool at a glance; a four-sided default looked like a second
 *  rectangle button. */
export const POLYGON_DEFAULT_SIDES = 3

export interface Pt { x: number; y: number }

function clampSides(sides: number): number {
  return Math.max(POLYGON_MIN_SIDES, Math.min(POLYGON_MAX_SIDES, Math.round(sides)))
}

/** Flat-bottomed regular polygon on the unit circle, with its extents. */
function unitCirclePolygon(sides: number): { raw: Pt[]; minX: number; maxX: number; minY: number; maxY: number } {
  const n = clampSides(sides)
  // The bottom edge is centered on 90° (screen y grows downward), so its
  // two vertices sit at 90° ± 180°/n; start on the first and walk clockwise.
  const start = Math.PI / 2 + Math.PI / n
  const raw: Pt[] = []
  for (let i = 0; i < n; i++) {
    const a = start + (2 * Math.PI * i) / n
    raw.push({ x: Math.cos(a), y: Math.sin(a) })
  }
  let minX = Infinity, maxX = -Infinity, minY = Infinity, maxY = -Infinity
  for (const p of raw) {
    if (p.x < minX) minX = p.x
    if (p.x > maxX) maxX = p.x
    if (p.y < minY) minY = p.y
    if (p.y > maxY) maxY = p.y
  }
  return { raw, minX, maxX, minY, maxY }
}

/** Vertices of a flat-bottomed regular polygon, normalized to the 0..1 box. */
export function polygonUnitPoints(sides: number): Pt[] {
  const { raw, minX, maxX, minY, maxY } = unitCirclePolygon(sides)
  const sx = maxX - minX || 1
  const sy = maxY - minY || 1
  return raw.map(p => ({ x: (p.x - minX) / sx, y: (p.y - minY) / sy }))
}

/** Width divided by height of the REGULAR polygon with this many sides
 *  (all edges equal): a triangle is 2/sqrt(3), a square is 1, a hexagon
 *  with flat top and bottom is 2/sqrt(3) again, and the ratio tends to 1
 *  as the sides increase. A layer whose box matches this ratio renders a
 *  regular polygon; any other box is the user's stretch on top of it. */
export function polygonNaturalAspect(sides: number): number {
  const { minX, maxX, minY, maxY } = unitCirclePolygon(sides)
  return (maxX - minX) / ((maxY - minY) || 1)
}

/** Box for a new regular polygon of the given width. */
export function regularPolygonBox(sides: number, width: number): { width: number; height: number } {
  return { width, height: Math.round(width / polygonNaturalAspect(sides)) }
}

/** Vertices in pixel space for a `w` by `h` box (top-left origin). */
export function polygonPoints(sides: number, w: number, h: number): Pt[] {
  return polygonUnitPoints(sides).map(p => ({ x: p.x * w, y: p.y * h }))
}

/** Largest corner radius the polygon can carry before adjacent corner arcs
 *  overlap on their shared edge: for each vertex, half the shorter adjacent
 *  edge times tan(interior angle / 2), minimized over the shape. For an
 *  equilateral triangle this is the inradius, matching the old clamp. */
export function polygonMaxCornerRadius(pts: Pt[]): number {
  const n = pts.length
  if (n < 3) return 0
  let best = Infinity
  for (let i = 0; i < n; i++) {
    const prev = pts[(i + n - 1) % n]
    const cur = pts[i]
    const next = pts[(i + 1) % n]
    const ax = prev.x - cur.x, ay = prev.y - cur.y
    const bx = next.x - cur.x, by = next.y - cur.y
    const la = Math.hypot(ax, ay), lb = Math.hypot(bx, by)
    if (la === 0 || lb === 0) return 0
    const cos = Math.max(-1, Math.min(1, (ax * bx + ay * by) / (la * lb)))
    const theta = Math.acos(cos)
    const r = (Math.min(la, lb) / 2) * Math.tan(theta / 2)
    if (r < best) best = r
  }
  return Number.isFinite(best) ? best : 0
}

/** Trace the polygon outline on a 2D context. `radius` is clamped to the
 *  shape's maximum; 0 draws sharp corners. The rounded path starts at the
 *  midpoint of the last edge and rounds every vertex with arcTo, which is
 *  the construction the old triangle used. */
export function tracePolygonPath(ctx: CanvasRenderingContext2D | { beginPath(): void; moveTo(x: number, y: number): void; lineTo(x: number, y: number): void; arcTo(x1: number, y1: number, x2: number, y2: number, r: number): void; closePath(): void }, pts: Pt[], radius: number): void {
  const n = pts.length
  ctx.beginPath()
  if (n === 0) return
  const rr = Math.max(0, Math.min(radius, polygonMaxCornerRadius(pts)))
  if (rr <= 0) {
    ctx.moveTo(pts[0].x, pts[0].y)
    for (let i = 1; i < n; i++) ctx.lineTo(pts[i].x, pts[i].y)
  } else {
    const last = pts[n - 1]
    ctx.moveTo((last.x + pts[0].x) / 2, (last.y + pts[0].y) / 2)
    for (let i = 0; i < n; i++) {
      const cur = pts[i]
      const next = pts[(i + 1) % n]
      ctx.arcTo(cur.x, cur.y, next.x, next.y, rr)
    }
  }
  ctx.closePath()
}

/** Effective side count for a polygon layer (legacy triangles count as 3). */
export function polygonSidesOf(layer: ThumbnailLayer): number {
  if (layer.shapeType === 'triangle') return 3
  return clampSides(layer.sides ?? POLYGON_DEFAULT_SIDES)
}

/**
 * The layer patch for changing a polygon's side count so the shape stays
 * as regular as it was. The user's stretch is how far the current box
 * deviates from the old side count's natural ratio; the new box keeps the
 * width, applies that same deviation to the new natural ratio, and moves
 * the origin so the visual center stays put (the layer rotates about its
 * top-left corner, so the vertical shift is rotated with it). A regular
 * triangle becomes a regular square; a triangle squashed to half height
 * becomes a square squashed to half height.
 */
export function polygonSidesPatch(layer: ThumbnailLayer, sides: number): Partial<ThumbnailLayer> {
  const n = clampSides(sides)
  const w = layer.width ?? 200
  const h = layer.height ?? 200
  const oldN = polygonSidesOf(layer)
  if (n === oldN) return {}
  const stretch = (w / h) / polygonNaturalAspect(oldN)
  const newH = Math.max(1, Math.round(w / (polygonNaturalAspect(n) * stretch)))
  const dy = (h - newH) / 2
  const rad = ((layer.rotation ?? 0) * Math.PI) / 180
  return {
    sides: n,
    height: newH,
    x: layer.x - dy * Math.sin(rad),
    y: layer.y + dy * Math.cos(rad),
  }
}

/**
 * Migrate an old triangle layer to a three-sided polygon that renders pixel
 * for pixel the same. The old triangle was inscribed in the circle of radius
 * R = min(w, h) / 2 centered in its box (point up, flat bottom), so its real
 * extent was R*sqrt(3) wide by 1.5 R tall and sat inside a larger box. The
 * new polygon fills its box, so the box shrinks to that extent and the
 * layer origin moves by the old inset, rotated with the layer (the layer
 * rotates about its own top-left corner). A vertical flip mirrored the
 * triangle about the box center, which moves the inset accordingly.
 */
export function migrateTriangleLayer(layer: ThumbnailLayer): ThumbnailLayer {
  if (layer.shapeType !== 'triangle') return layer
  const w = layer.width ?? 200
  const h = layer.height ?? 200
  const R = Math.min(w, h) / 2
  const cx = w / 2
  const cy = h / 2
  const newW = R * Math.sqrt(3)
  const newH = 1.5 * R
  const dx = cx - newW / 2
  const dy = layer.flipY ? cy - R / 2 : cy - R
  const rad = ((layer.rotation ?? 0) * Math.PI) / 180
  const cos = Math.cos(rad), sin = Math.sin(rad)
  const x = layer.x + dx * cos - dy * sin
  const y = layer.y + dx * sin + dy * cos
  return { ...layer, shapeType: 'polygon', sides: 3, x, y, width: newW, height: newH }
}

/** Normalize a layer list read from disk or a template: legacy triangles
 *  become polygons; everything else passes through untouched. */
export function normalizeLayers(layers: ThumbnailLayer[]): ThumbnailLayer[] {
  let changed = false
  const out = layers.map(l => {
    if (l.type === 'shape' && l.shapeType === 'triangle') { changed = true; return migrateTriangleLayer(l) }
    return l
  })
  return changed ? out : layers
}
