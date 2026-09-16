import type { ThumbnailLayer } from '../types'
import { polygonPoints, polygonSidesOf, tracePolygonPath } from './polygon'
import { arrowOutline, traceArrowPath } from './arrow'

/**
 * Group mask geometry (THU-21). A mask is a shape layer whose OUTLINE clips
 * its group; nothing else about the shape takes part. The outline is traced
 * in the group's coordinate space so it composes with the group's own
 * position and rotation the way the members do.
 */

/** The subset of the canvas context the path tracing needs. Konva's
 *  Context proxies all of these to the underlying 2D context. */
export interface PathContext {
  beginPath(): void
  moveTo(x: number, y: number): void
  lineTo(x: number, y: number): void
  arcTo(x1: number, y1: number, x2: number, y2: number, r: number): void
  ellipse(x: number, y: number, rx: number, ry: number, rotation: number, start: number, end: number): void
  closePath(): void
  save(): void
  restore(): void
  translate(x: number, y: number): void
  rotate(rad: number): void
  scale(x: number, y: number): void
}

function traceRoundedRect(ctx: PathContext, w: number, h: number, radius: number): void {
  const r = Math.max(0, Math.min(radius, w / 2, h / 2))
  ctx.beginPath()
  if (r <= 0) {
    ctx.moveTo(0, 0); ctx.lineTo(w, 0); ctx.lineTo(w, h); ctx.lineTo(0, h)
  } else {
    ctx.moveTo(r, 0)
    ctx.arcTo(w, 0, w, h, r)
    ctx.arcTo(w, h, 0, h, r)
    ctx.arcTo(0, h, 0, 0, r)
    ctx.arcTo(0, 0, w, 0, r)
  }
  ctx.closePath()
}

/** Trace the shape's outline in its own local space (0..width, 0..height,
 *  before position and rotation). Flips mirror about the box center, as the
 *  rendered shape does. */
export function traceShapeOutlineLocal(ctx: PathContext, layer: ThumbnailLayer): void {
  const w = layer.width ?? 200
  const h = layer.height ?? 200
  const type = layer.shapeType === 'triangle' ? 'polygon' : (layer.shapeType ?? 'rect')
  const flipped = !!layer.flipX || !!layer.flipY
  if (flipped) {
    ctx.translate(w / 2, h / 2)
    ctx.scale(layer.flipX ? -1 : 1, layer.flipY ? -1 : 1)
    ctx.translate(-w / 2, -h / 2)
  }
  if (type === 'rect') {
    traceRoundedRect(ctx, w, h, layer.cornerRadius ?? 0)
  } else if (type === 'ellipse') {
    ctx.beginPath()
    ctx.ellipse(w / 2, h / 2, w / 2, h / 2, 0, 0, Math.PI * 2)
    ctx.closePath()
  } else if (type === 'arrow') {
    traceArrowPath(ctx, arrowOutline(layer, w, h), layer.cornerRadius ?? 0)
  } else {
    tracePolygonPath(ctx, polygonPoints(polygonSidesOf(layer), w, h), layer.cornerRadius ?? 0)
    ctx.closePath()
  }
}

/**
 * Trace the mask's outline in its GROUP's coordinate space: the shape's
 * position and rotation applied, then the local outline. The transform is
 * wrapped in save/restore because a canvas path is stored in device space
 * once traced, so the context's transform can be put back before the
 * caller clips; Konva's clip function relies on the transform it set up
 * still being in place afterwards.
 */
export function traceMaskPath(ctx: PathContext, mask: ThumbnailLayer): void {
  ctx.save()
  ctx.translate(mask.x, mask.y)
  if (mask.rotation) ctx.rotate((mask.rotation * Math.PI) / 180)
  traceShapeOutlineLocal(ctx, mask)
  ctx.restore()
}
