import React, {
  useState, useEffect, useRef, useCallback, useMemo
} from 'react'
import { flushSync } from 'react-dom'
import { Stage, Layer, Group as KonvaGroup, Image as KonvaImage, Text as KonvaText, Transformer, Rect as KonvaRect, Ellipse as KonvaEllipse, Shape as KonvaShape } from 'react-konva'
import useImage from 'use-image'
import Konva from 'konva'
import {
  Plus, Trash2, Eye, EyeOff,
  Image as ImageIcon, Type, Undo2, Redo2, Download,
  BookMarked, FolderOpen, LayoutTemplate, Sliders, RotateCcw, Copy,
  Magnet, Grid3x3, Check, X, AlertTriangle, Pencil, Link2, Unlink2,
  Square, Circle, Triangle,
  Frame, BoxSelect,
  AlignStartVertical, AlignCenterVertical, AlignEndVertical,
  AlignStartHorizontal, AlignCenterHorizontal, AlignEndHorizontal,
  FlipHorizontal2, FlipVertical2,
  ChevronDown, ChevronRight, Loader2, Eraser,
} from 'lucide-react'
import { Button } from '../ui/Button'
import { Tooltip } from '../ui/Tooltip'
import { RecentRow, SmoothThumb } from '../ui/RecentRow'
import { NumberInput } from '../ui/Input'
import { TemplateBodyEditor, MergeFieldPicker } from '../ui/TemplateBodyEditor'
import { useThumbnailEditor } from '../../context/ThumbnailEditorContext'
import { useOpenItems } from '../../context/OpenItemsContext'
import { usePageActivity } from '../../context/PageActivityContext'
import { useStore } from '../../hooks/useStore'
import { theme, rgba } from '../../theme'
import { renderStreamTitle, renderTitleFromMeta, resolvePrimaryGame, detectTotalEpisodes } from '../../lib/streamTitle'
import { Modal } from '../ui/Modal'
import type { ThumbnailLayer, ThumbnailShadow, ThumbnailTemplate, ThumbnailCanvasFile, ThumbnailRecentEntry, StreamMeta, StreamFolder } from '../../types'

// ── Canvas dimensions ─────────────────────────────────────────────────────────
const CANVAS_W = 1280
const CANVAS_H = 720

type AlignOp =
  | 'left' | 'h-center' | 'right'
  | 'top'  | 'v-center' | 'bottom'

/** Canonical _meta.json key for a stream the thumbnail editor is editing.
 *  In folder-per-stream mode the key is the relative path from streamsDir.
 *  In dump mode folderPath collapses to streamsDir, so fall back to date —
 *  the dump-mode key in `_meta.json`. */
function streamMetaKey(folderPath: string, date: string, streamsDir: string | undefined): string {
  const root = (streamsDir || '').replace(/\\/g, '/').replace(/\/$/, '')
  const fp = folderPath.replace(/\\/g, '/').replace(/\/$/, '')
  if (root && fp === root) return date
  if (root && fp.startsWith(root + '/')) return fp.slice(root.length + 1)
  return fp.split('/').pop() ?? fp
}

// ── Pan / zoom ────────────────────────────────────────────────────────────────
const SNAP_ZOOM_THRESHOLD = 0.05 // 5% — snap to 100% or fit

// Extra pannable space beyond the canvas, expressed in canvas-widths/heights.
// Pan is allowed at every zoom level (including when the canvas fits inside
// the viewport entirely). With 1.0 the user can reach elements parked
// anywhere in roughly [-CANVAS_W, 2*CANVAS_W] × [-CANVAS_H, 2*CANVAS_H] in
// canvas coords.
const PAN_OVERSCAN = 1

function clampCanvasPan(x: number, y: number, zoom: number, cw: number, ch: number) {
  const csx = CANVAS_W * zoom
  const csy = CANVAS_H * zoom
  const ox = CANVAS_W * PAN_OVERSCAN * zoom
  const oy = CANVAS_H * PAN_OVERSCAN * zoom
  // Pan range is symmetric around the natural centered position with
  // half-width csx/2 + ox. Same formula at every zoom — the previous
  // "canvas fits viewport" branch locked pan and is intentionally gone.
  return {
    x: Math.max(cw / 2 - csx - ox, Math.min(cw / 2 + ox, x)),
    y: Math.max(ch / 2 - csy - oy, Math.min(ch / 2 + oy, y)),
  }
}

/** Pan offset that places the canvas centered in the viewport at the given
 *  zoom. Used for initial mount and the double-middle-click reset, since
 *  clampCanvasPan no longer auto-centers. */
function centeredCanvasPan(zoom: number, cw: number, ch: number) {
  return {
    x: (cw - CANVAS_W * zoom) / 2,
    y: (ch - CANVAS_H * zoom) / 2,
  }
}

function applyZoomSnap(zoom: number, fitScale: number): number {
  if (Math.abs(zoom - 1) < SNAP_ZOOM_THRESHOLD) return 1
  if (Math.abs(zoom - fitScale) / fitScale < SNAP_ZOOM_THRESHOLD) return fitScale
  return zoom
}

// ── Snapping ──────────────────────────────────────────────────────────────────
const SNAP_THRESHOLD = 5 // canvas pixels
const GRID_SIZE = 8      // canvas pixels

interface SnapGuide { lineGuide: number; orientation: 'V' | 'H' }
type KonvaBox = { x: number; y: number; width: number; height: number; rotation: number }

function getSnapResult(
  node: Konva.Node,
  stage: Konva.Stage,
  smartSnap: boolean,
  gridSnap: boolean,
  // Layers that must NOT act as snap stops — the rest of a multi-selection
  // during a group drag. They move WITH the dragged node, so snapping
  // against them is self-referential: the target gets yanked to a
  // companion's edge, the companions follow, and the group creeps/sticks
  // (the resize path's boundBoxFunc already excludes the whole selection).
  excludeIds?: ReadonlySet<string>,
): { x?: number; y?: number; guides: SnapGuide[] } {
  const result: { x?: number; y?: number; guides: SnapGuide[] } = { guides: [] }
  if (!smartSnap && !gridSnap) return result

  const box = node.getClientRect({ relativeTo: stage })

  if (smartSnap) {
    // Collect stops: canvas edges/center + all other snap-target nodes
    const vStops: number[] = [0, CANVAS_W / 2, CANVAS_W]
    const hStops: number[] = [0, CANVAS_H / 2, CANVAS_H]

    stage.find('.snap-target').forEach((other: Konva.Node) => {
      if (other === node) return
      if (excludeIds?.has(other.id())) return
      const b = other.getClientRect({ relativeTo: stage })
      vStops.push(b.x, b.x + b.width / 2, b.x + b.width)
      hStops.push(b.y, b.y + b.height / 2, b.y + b.height)
    })

    // The dragged node's three snap edges per axis
    const vEdges = [box.x, box.x + box.width / 2, box.x + box.width]
    const hEdges = [box.y, box.y + box.height / 2, box.y + box.height]

    let bestVDiff = SNAP_THRESHOLD + 1, bestVDelta = 0, bestVStop = 0
    for (const stop of vStops) {
      for (const edge of vEdges) {
        const diff = Math.abs(stop - edge)
        if (diff < bestVDiff) { bestVDiff = diff; bestVDelta = stop - edge; bestVStop = stop }
      }
    }
    if (bestVDiff <= SNAP_THRESHOLD) {
      result.x = node.x() + bestVDelta
      result.guides.push({ lineGuide: bestVStop, orientation: 'V' })
    }

    let bestHDiff = SNAP_THRESHOLD + 1, bestHDelta = 0, bestHStop = 0
    for (const stop of hStops) {
      for (const edge of hEdges) {
        const diff = Math.abs(stop - edge)
        if (diff < bestHDiff) { bestHDiff = diff; bestHDelta = stop - edge; bestHStop = stop }
      }
    }
    if (bestHDiff <= SNAP_THRESHOLD) {
      result.y = node.y() + bestHDelta
      result.guides.push({ lineGuide: bestHStop, orientation: 'H' })
    }
  }

  // Grid snap as fallback (or standalone when smart snap is off)
  if (gridSnap) {
    if (result.x === undefined) result.x = Math.round(node.x() / GRID_SIZE) * GRID_SIZE
    if (result.y === undefined) result.y = Math.round(node.y() / GRID_SIZE) * GRID_SIZE
  }

  return result
}

function renderSnapGuides(guides: SnapGuide[], guideLayer: Konva.Layer, scale: number) {
  guideLayer.destroyChildren()
  const sw = Math.max(0.5, 1 / scale)
  const dash = [4 / scale, 6 / scale]
  guides.forEach(g => {
    guideLayer.add(new Konva.Line({
      stroke: theme.accent,
      strokeWidth: sw,
      dash,
      points: g.orientation === 'H'
        ? [0, g.lineGuide, CANVAS_W, g.lineGuide]
        : [g.lineGuide, 0, g.lineGuide, CANVAS_H],
    }))
  })
  guideLayer.batchDraw()
}

// ── Checkerboard pattern (created once, reused) ───────────────────────────────
function makeCheckerPattern(): HTMLCanvasElement {
  const c = document.createElement('canvas')
  c.width = 16; c.height = 16
  const ctx = c.getContext('2d')!
  ctx.fillStyle = '#13131f'; ctx.fillRect(0, 0, 16, 16)
  ctx.fillStyle = '#1c1c28'; ctx.fillRect(0, 0, 8, 8); ctx.fillRect(8, 8, 8, 8)
  return c
}
const checkerPatternCanvas = makeCheckerPattern()

// ── Helpers ───────────────────────────────────────────────────────────────────
function newId() { return Math.random().toString(36).slice(2) }

function cloneLayer(layer: ThumbnailLayer): ThumbnailLayer { return { ...layer } }

/** Maps a font variant style name (from queryLocalFonts) to a CSS-compatible fontStyle prefix for Konva */
function styleNameToCSSFont(name: string): string {
  const l = name.toLowerCase()
  const italic = /italic|oblique/.test(l)
  let w = 400
  if (/thin|hairline/.test(l)) w = 100
  else if (/extra\s*light|ultra\s*light/.test(l)) w = 200
  else if (/light/.test(l)) w = 300
  else if (/medium/.test(l)) w = 500
  else if (/demi\s*bold|semi\s*bold/.test(l)) w = 600
  else if (/extra\s*bold|ultra\s*bold/.test(l)) w = 800
  else if (/black|heavy/.test(l)) w = 900
  else if (/bold/.test(l)) w = 700
  const parts: string[] = []
  if (italic) parts.push('italic')
  if (w !== 400) parts.push(String(w))
  return parts.length ? parts.join(' ') : 'normal'
}

/** Returns numeric weight from a CSS fontStyle string */
function cssToWeight(css: string): number {
  const m = css.match(/\b(\d{3})\b/)
  if (m) return parseInt(m[1])
  if (css.includes('bold')) return 700
  return 400
}

/** Font families referenced by text layers that aren't installed on this
 *  machine. Family-level on purpose — a missing family renders in a
 *  substitute font (visually destructive), while a missing variant just
 *  gets synthesized weight/slant. Only meaningful once the real
 *  queryLocalFonts list has loaded. */
function collectMissingFonts(layers: ThumbnailLayer[], installed: Set<string>): string[] {
  const missing = new Set<string>()
  for (const l of layers) {
    if (l.type !== 'text') continue
    const fam = l.fontFamily ?? 'Arial'
    if (!installed.has(fam)) missing.add(fam)
  }
  return [...missing]
}

// ── Konva node rendering ──────────────────────────────────────────────────────

interface KonvaLayerNodeProps {
  layer: ThumbnailLayer
  isSelected: boolean
  onSelect: (id: string, multi: boolean) => void
  onChange: (updated: ThumbnailLayer) => void
  scale: number
  onDragStart: (e: Konva.KonvaEventObject<DragEvent>) => void
  onSnapDragMove: (e: Konva.KonvaEventObject<DragEvent>) => void
  /** Commits the drag's final position. Routes through the parent so a
   *  multi-selection drag can commit every moved layer in a single update
   *  (one undo entry, not N). */
  onDragEnd: (e: Konva.KonvaEventObject<DragEvent>) => void
  /** Same idea for transforms: the shared Transformer fires `transformend`
   *  on each node it touched; the parent handler buffers them via microtask
   *  and commits the whole group in one shot. */
  onTransformEnd: (e: Konva.KonvaEventObject<Event>) => void
  onClearGuides: () => void
  gridSnapEnabled: boolean
  /** Merge field values for text layers. When null, merge fields render
   *  literally ({title}, {episode}, etc.) — used for template editing. */
  mergeFields: Record<string, string> | null
}

/** Replace {field} markers in `text` with values from `fields`. When fields
 *  is null (template-edit mode), the original text is returned untouched so
 *  the user sees the literal merge field markers on the canvas. Unknown
 *  field names are left as-is to surface typos. */
export function applyThumbnailMergeFields(text: string, fields: Record<string, string> | null): string {
  if (!fields) return text
  return text.replace(/\{(\w+)\}/g, (_, key) => fields[key] ?? `{${key}}`)
}

/** Merge fields a thumbnail text layer can reference. Mirrors the keys
 *  `mergeFieldValues` resolves (see the editor body). The series-specific
 *  trio is flagged inapplicable on standalone streams — same treatment as
 *  the YouTube-title chip editor on the Streams page. */
// 'topic' is the canonical key post topic/game rename; {game} stays a
// resolvable alias (see mergeFieldValues + knownKeys) so text layers
// authored before the rename keep rendering.
const THUMBNAIL_MERGE_KEYS = ['title', 'topic', 'date', 'season', 'episode', 'total_episodes'] as const
const THUMBNAIL_SERIES_KEYS = ['season', 'episode', 'total_episodes']

function snapGrid(v: number) { return Math.round(v / GRID_SIZE) * GRID_SIZE }

/** Resolves a layer's effective shadow stack. Reads the new `shadows`
 *  array preferentially, but falls back to migrating the legacy single-
 *  shadow fields (`shadowEnabled` + `shadow*`) into a single-element
 *  array on read — so existing thumbnails keep rendering correctly
 *  without a one-shot migration pass over every saved file. Returns an
 *  empty array when no shadow is configured; the renderer then skips
 *  the clone-stack entirely (no perf cost). */
function resolveShadows(layer: ThumbnailLayer): ThumbnailShadow[] {
  if (Array.isArray(layer.shadows) && layer.shadows.length > 0) return layer.shadows
  if (layer.shadowEnabled) {
    return [{
      color: layer.shadowColor ?? '#000000',
      offsetX: layer.shadowOffsetX ?? 4,
      offsetY: layer.shadowOffsetY ?? 4,
      blur: layer.shadowBlur ?? 8,
      opacity: layer.shadowOpacity ?? 100,
    }]
  }
  return []
}

/** Spreads a single shadow config onto a Konva shape node's shadow props.
 *  Passed `null` for the original (top) clone in the multi-shadow stack —
 *  Konva treats `shadowEnabled: false` as "skip shadow," so the original
 *  renders without any shadow attached. */
function shadowPropsFor(shadow: ThumbnailShadow | null) {
  if (!shadow) return { shadowEnabled: false }
  return {
    shadowEnabled: true,
    shadowColor: shadow.color,
    shadowOffsetX: shadow.offsetX,
    shadowOffsetY: shadow.offsetY,
    shadowBlur: shadow.blur,
    shadowOpacity: shadow.opacity / 100,
  }
}

/** Split #rrggbb / #rrggbbaa into the 6-digit part (all the native color
 *  input can hold) and a 0–1 alpha. Malformed input reads as the fallback
 *  at full alpha. */
function splitColorAlpha(v: string | undefined, fallback: string): { rgb: string; alpha: number } {
  const m = (v ?? '').match(/^#([0-9a-f]{6})([0-9a-f]{2})?$/i)
  if (!m) return { rgb: fallback, alpha: 1 }
  return { rgb: `#${m[1]}`, alpha: m[2] ? parseInt(m[2], 16) / 255 : 1 }
}
/** Join back to #rrggbb (full alpha) or #rrggbbaa — canvas, Konva, and the
 *  outline filter all accept both forms. */
function joinColorAlpha(rgb: string, alpha: number): string {
  const a = Math.round(Math.max(0, Math.min(1, alpha)) * 255)
  return a >= 255 ? rgb : `${rgb}${a.toString(16).padStart(2, '0')}`
}

/** #rgb / #rrggbb / #rrggbbaa → {r,g,b,a}. Returns opaque black on parse
 *  failure so the outline filter still produces visible output rather than
 *  silently punching transparent pixels. */
function parseHexColor(hex: string): { r: number; g: number; b: number; a: number } {
  const clean = (hex || '').replace('#', '')
  if (clean.length === 3) {
    return {
      r: parseInt(clean[0] + clean[0], 16) || 0,
      g: parseInt(clean[1] + clean[1], 16) || 0,
      b: parseInt(clean[2] + clean[2], 16) || 0,
      a: 255,
    }
  }
  if (clean.length === 6 || clean.length === 8) {
    return {
      r: parseInt(clean.slice(0, 2), 16) || 0,
      g: parseInt(clean.slice(2, 4), 16) || 0,
      b: parseInt(clean.slice(4, 6), 16) || 0,
      a: clean.length === 8 ? (parseInt(clean.slice(6, 8), 16) || 0) : 255,
    }
  }
  return { r: 0, g: 0, b: 0, a: 255 }
}

/** 1D squared Euclidean distance transform — writes `out[q] = min over
 *  j of ((q-j)² + f[j])` for `q in [0, n)`. Lower envelope of parabolas
 *  technique (Felzenszwalb & Huttenlocher 2004): each input position j
 *  contributes a parabola centered at j with offset f[j], and the
 *  envelope of all parabolas IS the distance function. Maintains a
 *  stack of parabolas (`v` = vertex positions, `z` = intersection
 *  x-coords); for each new parabola, pop from the stack while it
 *  subsumes the previous, then push the new one. Second sweep reads
 *  the envelope at each q.
 *
 *  O(n) — both loops amortize to constant work per element. `v` and
 *  `z` are scratch buffers passed in by the caller so the 2D wrapper
 *  can reuse them across row/column passes. */
function edt1d(f: Float64Array, n: number, v: Int32Array, z: Float64Array, out: Float64Array): void {
  let k = 0
  v[0] = 0
  z[0] = -Infinity
  z[1] = Infinity
  for (let q = 1; q < n; q++) {
    let s: number
    while (true) {
      const vq = v[k]
      // Intersection x-coord of parabolas at q and v[k]. q > v[k]
      // always, so the denominator is strictly positive.
      s = ((f[q] + q * q) - (f[vq] + vq * vq)) / (2 * (q - vq))
      if (s > z[k]) break
      k--
    }
    k++
    v[k] = q
    z[k] = s
    z[k + 1] = Infinity
  }
  k = 0
  for (let q = 0; q < n; q++) {
    while (z[k + 1] < q) k++
    const dq = q - v[k]
    out[q] = dq * dq + f[v[k]]
  }
}

/** 2D squared Euclidean distance transform of a binary mask. Returns
 *  `distSq[i]` = squared Euclidean distance from pixel `i` to the
 *  nearest set bit in `src`. Two 1D passes (columns then rows) compose
 *  to give the full 2D result, total O(W·H). */
function edt2d(src: Uint8Array, w: number, h: number): Float64Array {
  // Stand-in for +∞ — keeps the arithmetic in finite-float land so the
  // (f[q]+q²) - (f[v[k]]+v[k]²) computation doesn't produce NaN when
  // both terms are "infinity." Safely large for any canvas dimension
  // we'd ever process: 1e10 + (1280)² is still well within float64
  // precision (max integer is 2^53 ≈ 9e15).
  const LARGE = 1e10
  const len = w * h
  const distSq = new Float64Array(len)
  const maxDim = Math.max(w, h)
  const buf = new Float64Array(maxDim)
  const out = new Float64Array(maxDim)
  const v = new Int32Array(maxDim)
  const z = new Float64Array(maxDim + 1)

  // Pass 1 — vertical (per-column 1D EDT). Source pixels seed the
  // column with 0; everything else starts at LARGE. After this pass
  // distSq[i] = squared distance from i to nearest source in its
  // column only.
  for (let x = 0; x < w; x++) {
    for (let y = 0; y < h; y++) buf[y] = src[y * w + x] ? 0 : LARGE
    edt1d(buf, h, v, z, out)
    for (let y = 0; y < h; y++) distSq[y * w + x] = out[y]
  }

  // Pass 2 — horizontal (per-row 1D EDT). Each row's input is the
  // column-pass result; the 1D EDT then minimizes across columns to
  // produce the full 2D distance.
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) buf[x] = distSq[y * w + x]
    edt1d(buf, w, v, z, out)
    for (let x = 0; x < w; x++) distSq[y * w + x] = out[x]
  }
  return distSq
}

/** Outline filter — dilates the source alpha mask by `radius` pixels
 *  (true Euclidean → round corners) and paints the dilated region in
 *  `color`. Original opaque pixels are preserved untouched; only
 *  transparent pixels within `radius` of an opaque one are overwritten.
 *
 *  Round dilation via Euclidean distance transform (Felzenszwalb &
 *  Huttenlocher) — O(W·H), independent of radius. Earlier brute-force
 *  Euclidean was O(W·H·r²) which made thick outlines visibly stutter;
 *  separable Chebyshev was fast but gave square corners that read
 *  unnatural on rounded silhouettes. EDT is the right middle ground:
 *  exact Euclidean output, linear time. */
function makeOutlineFilter(radius: number, color: string): (data: ImageData) => void {
  const { r: cr, g: cg, b: cb, a: ca } = parseHexColor(color)
  const r2 = radius * radius
  return function (imageData: ImageData) {
    if (radius <= 0) return
    const data = imageData.data
    const w = imageData.width
    const h = imageData.height
    const len = w * h
    const src = new Uint8Array(len)
    for (let i = 0; i < len; i++) src[i] = data[i * 4 + 3] >= 128 ? 1 : 0
    const distSq = edt2d(src, w, h)
    // Paint outline where distance ≤ radius and source was transparent.
    // Squared comparison avoids a per-pixel sqrt.
    for (let i = 0; i < len; i++) {
      if (src[i]) continue
      if (distSq[i] > r2) continue
      const p = i * 4
      data[p] = cr
      data[p + 1] = cg
      data[p + 2] = cb
      data[p + 3] = ca
    }
  }
}

/** Returns the array of Konva.Filters to apply, based on which fields on the
 *  layer have non-neutral values. Order matters: HSL → Brightness → Contrast
 *  is the visually intuitive order. Toggles (grayscale, sepia, invert,
 *  emboss) come last so they paint over the color adjustments. */
type KonvaFilterFn = typeof Konva.Filters.Brighten

function activeFilters(layer: ThumbnailLayer): KonvaFilterFn[] {
  if (!layer.filtersEnabled) return []
  const out: KonvaFilterFn[] = []
  // HSL contributes if any of hue/saturation/luminance is non-zero
  if ((layer.filterHue ?? 0) !== 0 || (layer.filterSaturation ?? 0) !== 0 || (layer.filterLuminance ?? 0) !== 0) {
    out.push(Konva.Filters.HSL)
  }
  if ((layer.filterBrightness ?? 0) !== 0) out.push(Konva.Filters.Brighten)
  if ((layer.filterContrast ?? 0) !== 0) out.push(Konva.Filters.Contrast)
  if ((layer.filterBlur ?? 0) > 0) out.push(Konva.Filters.Blur)
  if ((layer.filterEnhance ?? 0) !== 0) out.push(Konva.Filters.Enhance)
  if ((layer.filterPixelate ?? 0) > 1) out.push(Konva.Filters.Pixelate)
  if ((layer.filterPosterize ?? 0) > 0 && (layer.filterPosterize ?? 0) < 1) out.push(Konva.Filters.Posterize)
  if ((layer.filterThreshold ?? 0) > 0) out.push(Konva.Filters.Threshold)
  if (layer.filterGrayscale) out.push(Konva.Filters.Grayscale)
  if (layer.filterSepia) out.push(Konva.Filters.Sepia)
  if (layer.filterInvert) out.push(Konva.Filters.Invert)
  if (layer.filterEmboss) out.push(Konva.Filters.Emboss)
  return out
}

/** Builds a static HTMLCanvas with the outline pre-baked into the
 *  image's alpha. Returns null when outline is disabled / image isn't
 *  loaded yet — callers fall back to the raw `img` source.
 *
 *  Why pre-process instead of using a Konva filter:
 *  Konva's `cache()` calls `drawScene` on its offscreen canvas, which
 *  honors the node's `shadow*` props — so the cached bitmap already
 *  includes the shadow halo by the time the filter chain runs. An
 *  alpha-dilating filter (like outline) then sees the combined
 *  silhouette and paints outline color around the shadow too. And we
 *  can't simply toggle `shadowEnabled` around the cache call: any
 *  shadow-property setter triggers `_afterShadowChange` which clears
 *  the cache, so the restore call invalidates the work we just did.
 *
 *  Baking the outline into the source canvas BEFORE Konva sees it
 *  side-steps the whole ordering problem. Konva still caches whatever
 *  it likes for color filters / shadow, but the dilated alpha is
 *  already in the source — so the shadow naturally attaches to the
 *  outlined silhouette (spread shadow effect for free). */
function useOutlinedCanvas(
  img: HTMLImageElement | undefined,
  outlineEnabled: boolean | undefined,
  outlineColor: string | undefined,
  outlineWidth: number | undefined,
  layerWidth: number,
  layerHeight: number,
): HTMLCanvasElement | null {
  const [canvas, setCanvas] = useState<HTMLCanvasElement | null>(null)
  const active = !!outlineEnabled && (outlineWidth ?? 0) > 0
  useEffect(() => {
    if (!img || !active) {
      setCanvas(null)
      return
    }
    if (!img.naturalWidth || !img.naturalHeight || !layerWidth || !layerHeight) {
      setCanvas(null)
      return
    }
    // Generate the outlined canvas at LAYER resolution, not natural
    // resolution. The earlier "match natural res with scaled pad"
    // approach blew up perf: a 2000×2000 source displayed at 200×200
    // with outline=10 ended up generating a ~2200×2200 canvas and
    // running a filter at radius ~100 — millions of times more work
    // than necessary, all to produce pixels that Konva immediately
    // downscaled to 220×220 anyway. Generating at layer resolution
    // means the canvas is exactly the size Konva will render it at,
    // and the filter radius matches the user's slider value directly.
    //
    // Trade-off: outline is at 1× layer resolution rather than the
    // source's native DPI, so it can look slightly soft when the
    // editor is zoomed in. Acceptable for interactive editing — the
    // final exported thumbnail rasterizes from the same canvas anyway,
    // so what the user sees is what they get.
    const padPx = Math.max(1, Math.round(outlineWidth ?? 0))
    const layerW = Math.max(1, Math.round(layerWidth))
    const layerH = Math.max(1, Math.round(layerHeight))
    const c = document.createElement('canvas')
    c.width = layerW + padPx * 2
    c.height = layerH + padPx * 2
    const ctx = c.getContext('2d')
    if (!ctx) return
    ctx.drawImage(img, padPx, padPx, layerW, layerH)
    const data = ctx.getImageData(0, 0, c.width, c.height)
    makeOutlineFilter(padPx, outlineColor ?? '#000000')(data)
    ctx.putImageData(data, 0, 0)
    setCanvas(c)
  }, [img, active, outlineColor, outlineWidth, layerWidth, layerHeight])
  return canvas
}

/** One KonvaImage instance — used for both the original image and each
 *  ghost-shadow clone behind it. Owns its own color-filter cache so
 *  brightness/contrast/etc. apply independently per node. Outline is
 *  NOT in the filter chain here — it's pre-baked into `imageSource`
 *  upstream (see `useOutlinedCanvas`).
 *
 *  Passing `shadow={null}` renders the original (no shadow attached);
 *  passing a shadow config renders a ghost that contributes only its
 *  shadow halo to the visible result. */
function ImageInner({
  layer, imageSource, renderW, renderH, offsetX, offsetY, shadow,
}: {
  layer: ThumbnailLayer
  imageSource: HTMLImageElement | HTMLCanvasElement | undefined
  renderW: number
  renderH: number
  offsetX: number
  offsetY: number
  shadow: ThumbnailShadow | null
}) {
  const nodeRef = useRef<Konva.Image>(null)

  // Color filters via Konva's standard cache+filter chain. No outline
  // here — that's already baked into `imageSource`.
  useEffect(() => {
    const node = nodeRef.current
    if (!node || !imageSource) return
    const filters = activeFilters(layer)
    if (filters.length === 0) {
      node.filters([])
      node.clearCache()
      node.getLayer()?.batchDraw()
      return
    }
    // Skip caching when the node has no measurable dimensions yet —
    // Konva would create a 0×0 cache canvas, and any subsequent draw
    // call (even from another component on the page after a route
    // change) hits "drawImage: image argument is a canvas with width/
    // height of 0".
    const nw = node.width()
    const nh = node.height()
    if (!nw || !nh) {
      node.filters([])
      node.clearCache()
      node.getLayer()?.batchDraw()
      return
    }
    if (layer.filterBrightness !== undefined) node.brightness(layer.filterBrightness)
    if (layer.filterContrast !== undefined) node.contrast(layer.filterContrast)
    if (layer.filterBlur !== undefined) node.blurRadius(layer.filterBlur)
    if (layer.filterHue !== undefined) node.hue(layer.filterHue)
    if (layer.filterSaturation !== undefined) node.saturation(layer.filterSaturation)
    if (layer.filterLuminance !== undefined) node.luminance(layer.filterLuminance)
    if (layer.filterPixelate !== undefined) node.pixelSize(Math.max(1, Math.round(layer.filterPixelate)))
    if (layer.filterPosterize !== undefined) node.levels(layer.filterPosterize)
    if (layer.filterEnhance !== undefined) node.enhance(layer.filterEnhance)
    if (layer.filterThreshold !== undefined) node.threshold(layer.filterThreshold)
    node.cache({ pixelRatio: 2 })
    node.filters(filters)
    node.getLayer()?.batchDraw()
  }, [
    imageSource,
    layer.filtersEnabled,
    layer.filterBrightness, layer.filterContrast, layer.filterBlur,
    layer.filterHue, layer.filterSaturation, layer.filterLuminance,
    layer.filterPixelate, layer.filterPosterize, layer.filterEnhance,
    layer.filterThreshold,
    layer.filterGrayscale, layer.filterSepia, layer.filterInvert, layer.filterEmboss,
    renderW, renderH,
  ])

  return (
    <KonvaImage
      ref={nodeRef}
      image={imageSource as CanvasImageSource | undefined}
      width={renderW}
      height={renderH}
      // Flip in place: pair scaleX(-1) with offsetX=renderW so the
      // mirror axis sits at the layer's right edge, keeping the
      // bounding box stable. Same idea for Y. With outline padding the
      // canvas is `2 * outlinePad` wider than the image content, so
      // the caller offsets back by outlinePad to keep the visible image
      // content registered at (0,0) of the inner Group.
      scaleX={layer.flipX ? -1 : 1}
      scaleY={layer.flipY ? -1 : 1}
      offsetX={offsetX}
      offsetY={offsetY}
      {...shadowPropsFor(shadow)}
    />
  )
}

function ImageNode({ layer, isSelected, onSelect, onChange, onDragStart, onSnapDragMove, onDragEnd, onTransformEnd, onClearGuides, gridSnapEnabled }: KonvaLayerNodeProps) {
  // isSelected is intentionally unused — the shared parent-level Transformer
  // attaches itself to selected nodes via its own useEffect, so per-node
  // Transformer mounts are gone. Kept in the props for symmetry across the
  // three node components (and so a future filter-on-select etc. can reuse it).
  void isSelected
  const [img] = useImage(layer.src ? `file://${layer.src}` : '', 'anonymous')

  // Render the Konva node even before the image bitmap finishes loading.
  // `useImage` is async: returning null until it resolves would mean the
  // parent's shared-Transformer sync effect runs against a non-existent
  // node, so a freshly-added image's bbox handles wouldn't appear until
  // the user reselected it. Konva accepts an undefined image (draws
  // nothing inside) — the node, its id, and the layer-stored width/height
  // are all that the Transformer needs to attach correctly.
  const w = layer.width ?? img?.naturalWidth ?? 100
  const h = layer.height ?? img?.naturalHeight ?? 100
  const shadows = resolveShadows(layer)

  // Pre-baked outlined canvas (or null when outline is off). Shared
  // across all clones in the multi-shadow stack so we only build it
  // once per param change, not once per shadow entry.
  const outlinedCanvas = useOutlinedCanvas(img, layer.outlineEnabled, layer.outlineColor, layer.outlineWidth, w, h)
  const useOutlined = outlinedCanvas !== null
  const imageSource = useOutlined ? outlinedCanvas : img
  // When using the outlined canvas, expand the rendered KonvaImage to
  // accommodate the canvas's padding (the dilated rim sits outside the
  // image's natural bounds) and shift the registration point back by
  // the same amount so the image content stays anchored at (0,0) of
  // the inner Group. Flip just adds the rendered size to the offset,
  // same as without outline.
  const outlinePad = useOutlined ? (layer.outlineWidth ?? 0) : 0
  const renderW = w + 2 * outlinePad
  const renderH = h + 2 * outlinePad
  const offX = (layer.flipX ? w : 0) + outlinePad
  const offY = (layer.flipY ? h : 0) + outlinePad

  return (
    // Group owns everything Konva's Transformer touches (position,
    // rotation, scale during a resize, drag handlers). The flip lives
    // on the inner KonvaImage only — Konva's Transformer otherwise
    // normalizes a negative scaleX on the same node by adding 180° to
    // rotation, which fights our flip prop on re-render and produces
    // a visible jump after every resize. Group's baseline scale is
    // always +1, so no normalization happens.
    //
    // Multi-shadow render: each shadow renders as a separate KonvaImage
    // clone behind the original, with that one shadow attached. The
    // clones' shape pixels are occluded by the original on top (same
    // size + filters + position), so only the shadow halos contribute
    // to the visible result. Stacking multiple shadows this way is the
    // only way to get the effect — Konva's shadow API allows only one
    // shadow per node.
    <KonvaGroup
      id={layer.id}
      name="snap-target"
      x={layer.x}
      y={layer.y}
      rotation={layer.rotation}
      opacity={layer.opacity / 100}
      visible={layer.visible}
      draggable
      onMouseDown={e => { if (e.evt.button !== 0) e.target.stopDrag() }}
      onClick={e => { if (e.evt.button === 0) onSelect(layer.id, e.evt.shiftKey) }}
      onTap={() => onSelect(layer.id, false)}
      onDragStart={onDragStart}
      onDragMove={onSnapDragMove}
      onDragEnd={e => { onClearGuides(); onDragEnd(e) }}
      onTransformEnd={onTransformEnd}
    >
      {shadows.map((s, i) => (
        <ImageInner key={`shadow-${i}`} layer={layer} imageSource={imageSource} renderW={renderW} renderH={renderH} offsetX={offX} offsetY={offY} shadow={s} />
      ))}
      <ImageInner layer={layer} imageSource={imageSource} renderW={renderW} renderH={renderH} offsetX={offX} offsetY={offY} shadow={null} />
    </KonvaGroup>
  )
}

function TextNode({ layer, isSelected, onSelect, onDragStart, onSnapDragMove, onDragEnd, onTransformEnd, onClearGuides, mergeFields }: KonvaLayerNodeProps) {
  void isSelected
  const nodeRef = useRef<Konva.Text>(null)

  // Outline override: when the Outline effect is enabled and has a
  // non-zero width, it takes over the Konva stroke props. The legacy
  // layer.stroke / layer.strokeWidth fields remain as a "design stroke"
  // and only render when Outline is disabled. Konva supports only one
  // stroke per node, so layering both would require an extra clone —
  // not worth it given the visual result of either is identical.
  const outlineActive = !!layer.outlineEnabled && (layer.outlineWidth ?? 0) > 0
  const effectiveStroke = outlineActive ? (layer.outlineColor ?? '#000000') : (layer.stroke ?? '#000000')
  const effectiveStrokeWidth = outlineActive ? (layer.outlineWidth ?? 0) : (layer.strokeWidth ?? 0)

  // Shared text props — every shadow clone + the original render with
  // identical content; only the shadow attachment differs per clone.
  // Pulling this out of the JSX avoids drift between clones and keeps
  // the multi-shadow loop trivial.
  const textProps = {
    text: applyThumbnailMergeFields(layer.text ?? '', mergeFields),
    width: layer.width ?? undefined,
    fontFamily: layer.fontFamily ?? 'Arial',
    fontSize: layer.fontSize ?? 48,
    fontStyle: layer.fontStyle ?? 'normal',
    fill: layer.fill ?? '#ffffff',
    stroke: effectiveStroke,
    strokeWidth: effectiveStrokeWidth,
    fillAfterStrokeEnabled: true,
    align: (layer.align ?? 'left') as 'left' | 'center' | 'right',
    lineHeight: layer.lineHeight ?? 1,
    // Flip in place — text has no stored height, so fall back to the
    // measured height from the ref. (offsetY for unflipped text is 0,
    // so the fallback only matters in the flipped branch.) Shadow
    // clones reuse the same value: they render the same text at the
    // same font, so their measured dimensions match the original's.
    scaleX: layer.flipX ? -1 : 1,
    scaleY: layer.flipY ? -1 : 1,
    offsetX: layer.flipX ? (layer.width ?? (nodeRef.current?.width() ?? 0)) : 0,
    offsetY: layer.flipY ? (nodeRef.current?.height() ?? 0) : 0,
  }
  const shadows = resolveShadows(layer)

  return (
    // See ImageNode for the Group-wrap rationale: keeps the flip prop
    // off the node the Transformer manipulates, so resize doesn't
    // trigger Konva's rotation-normalization side effect.
    //
    // Multi-shadow render: shadow clones first (behind), original last
    // (on top). See ImageNode for the rationale; same pattern.
    <KonvaGroup
      id={layer.id}
      name="snap-target"
      x={layer.x}
      y={layer.y}
      rotation={layer.rotation}
      opacity={layer.opacity / 100}
      visible={layer.visible}
      draggable
      onMouseDown={e => { if (e.evt.button !== 0) e.target.stopDrag() }}
      onClick={e => { if (e.evt.button === 0) onSelect(layer.id, e.evt.shiftKey) }}
      onTap={() => onSelect(layer.id, false)}
      onDragStart={onDragStart}
      onDragMove={onSnapDragMove}
      onDragEnd={e => { onClearGuides(); onDragEnd(e) }}
      onTransformEnd={onTransformEnd}
    >
      {shadows.map((s, i) => (
        <KonvaText key={`shadow-${i}`} {...textProps} {...shadowPropsFor(s)} />
      ))}
      <KonvaText ref={nodeRef} {...textProps} {...shadowPropsFor(null)} />
    </KonvaGroup>
  )
}

function ShapeNode({ layer, isSelected, onSelect, onDragStart, onSnapDragMove, onDragEnd, onTransformEnd, onClearGuides }: KonvaLayerNodeProps) {
  void isSelected
  const w = layer.width ?? 200
  const h = layer.height ?? 200
  const shapeType = layer.shapeType ?? 'rect'
  // Ellipse and triangle are centered on x/y in Konva; we store top-left
  const isCentered = shapeType === 'ellipse' || shapeType === 'triangle'

  // Flip in place. Centered shapes (ellipse, triangle) already have
  // their origin at the center, so scale alone mirrors around the
  // shape's center. Rect is top-left anchored, so it needs the same
  // offsetX=w / offsetY=h treatment as KonvaImage to keep the
  // bounding box stable after flipping.
  const scaleX = layer.flipX ? -1 : 1
  const scaleY = layer.flipY ? -1 : 1
  const offsetX = !isCentered && layer.flipX ? w : 0
  const offsetY = !isCentered && layer.flipY ? h : 0

  // Outline override — see TextNode comment for rationale.
  const outlineActive = !!layer.outlineEnabled && (layer.outlineWidth ?? 0) > 0
  const effectiveStroke = outlineActive ? (layer.outlineColor ?? '#000000') : (layer.stroke ?? '#000000')
  const effectiveStrokeWidth = outlineActive ? (layer.outlineWidth ?? 0) : (layer.strokeWidth ?? 0)

  // Inner-shape props (without shadow) — no id/name/position/rotation/
  // handlers; those live on the Group. Centered shapes still get their
  // own center offset inside the Group so Konva's ellipse/polygon math
  // (centered around x/y) lines up with our top-left-stored coords.
  const baseInnerProps = {
    x: isCentered ? w / 2 : 0,
    y: isCentered ? h / 2 : 0,
    fill: layer.fill ?? '#6366f1',
    stroke: effectiveStroke,
    strokeWidth: effectiveStrokeWidth,
    fillAfterStrokeEnabled: true,
    scaleX, scaleY, offsetX, offsetY,
  }

  const shadows = resolveShadows(layer)

  // Render one shape primitive for a single shadow pass (or `null` for
  // the original on top). Pulled out so the multi-shadow loop is a
  // simple map without re-doing the shapeType switch each time.
  const renderShape = (shadow: ThumbnailShadow | null, key?: string) => {
    const props = { ...baseInnerProps, ...shadowPropsFor(shadow) }
    if (shapeType === 'rect') {
      return <KonvaRect key={key} {...props} width={w} height={h} cornerRadius={layer.cornerRadius ?? 0} />
    }
    if (shapeType === 'ellipse') {
      return <KonvaEllipse key={key} {...props} radiusX={w / 2} radiusY={h / 2} />
    }
    // Triangle — custom sceneFunc instead of RegularPolygon so corners can
    // round (arcTo at each vertex). Radius 0 draws the identical sharp
    // equilateral triangle; the radius clamps to the inradius (R/2), where
    // the shape degenerates gracefully toward the inscribed circle. The
    // radius is in PIXELS, independent of width/height, so corners stay
    // perfectly circular through resizes (todo #23).
    const R = Math.min(w, h) / 2
    const cx = w / 2
    const cy = h / 2
    const rr = Math.max(0, Math.min(layer.cornerRadius ?? 0, R / 2))
    const pts = [0, 1, 2].map(i => {
      // Same vertex placement as Konva's RegularPolygon: first point up.
      const a = (Math.PI * 2 * i) / 3 - Math.PI / 2
      return { x: cx + R * Math.cos(a), y: cy + R * Math.sin(a) }
    })
    return (
      <KonvaShape
        key={key}
        {...props}
        width={w}
        height={h}
        // Center the self-rect so position/flip semantics match the old
        // centered RegularPolygon (baseInnerProps places x/y at the center).
        offsetX={w / 2}
        offsetY={h / 2}
        sceneFunc={(ctx: Konva.Context, shape: Konva.Shape) => {
          ctx.beginPath()
          if (rr <= 0) {
            ctx.moveTo(pts[0].x, pts[0].y)
            ctx.lineTo(pts[1].x, pts[1].y)
            ctx.lineTo(pts[2].x, pts[2].y)
          } else {
            ctx.moveTo((pts[2].x + pts[0].x) / 2, (pts[2].y + pts[0].y) / 2)
            ctx.arcTo(pts[0].x, pts[0].y, pts[1].x, pts[1].y, rr)
            ctx.arcTo(pts[1].x, pts[1].y, pts[2].x, pts[2].y, rr)
            ctx.arcTo(pts[2].x, pts[2].y, pts[0].x, pts[0].y, rr)
          }
          ctx.closePath()
          ctx.fillStrokeShape(shape)
        }}
      />
    )
  }

  return (
    // See ImageNode for the Group-wrap rationale + multi-shadow pattern.
    <KonvaGroup
      id={layer.id}
      name="snap-target"
      x={layer.x}
      y={layer.y}
      rotation={layer.rotation}
      opacity={layer.opacity / 100}
      visible={layer.visible}
      draggable
      onMouseDown={(e: Konva.KonvaEventObject<MouseEvent>) => { if (e.evt.button !== 0) e.target.stopDrag() }}
      onClick={(e: Konva.KonvaEventObject<MouseEvent>) => { if (e.evt.button === 0) onSelect(layer.id, e.evt.shiftKey) }}
      onTap={() => onSelect(layer.id, false)}
      onDragStart={onDragStart}
      onDragMove={onSnapDragMove}
      onDragEnd={(e: Konva.KonvaEventObject<DragEvent>) => { onClearGuides(); onDragEnd(e) }}
      onTransformEnd={onTransformEnd}
    >
      {shadows.map((s, i) => renderShape(s, `shadow-${i}`))}
      {renderShape(null)}
    </KonvaGroup>
  )
}

// ── Undo/redo ─────────────────────────────────────────────────────────────────

function useUndoRedo(initial: ThumbnailLayer[], onApply?: (next: ThumbnailLayer[]) => void) {
  // History lives in refs; state mirrors it for rendering (canUndo/canRedo
  // and the layers themselves). The old closure-based version captured
  // `present` at render time, so two commits landing in the same tick (or
  // inside a flushSync, e.g. a transform commit racing another interaction)
  // both pushed the SAME stale snapshot — one edit silently vanished from
  // history and undo restored a state older than the user expected. Refs
  // make every commit/undo/redo read the true latest values regardless of
  // render timing.
  const pastRef = useRef<ThumbnailLayer[][]>([])
  const presentRef = useRef<ThumbnailLayer[]>(initial)
  const futureRef = useRef<ThumbnailLayer[][]>([])
  const [past, setPast] = useState<ThumbnailLayer[][]>([])
  const [present, setPresent] = useState<ThumbnailLayer[]>(initial)
  const [future, setFuture] = useState<ThumbnailLayer[][]>([])
  // Stash the latest onApply in a ref so undo/redo callbacks see fresh
  // values without needing to re-create on every render of the parent.
  const onApplyRef = useRef(onApply)
  useEffect(() => { onApplyRef.current = onApply }, [onApply])

  const commit = useCallback((next: ThumbnailLayer[]) => {
    pastRef.current = [...pastRef.current.slice(-49), presentRef.current]
    presentRef.current = next
    futureRef.current = []
    setPast(pastRef.current)
    setPresent(next)
    setFuture([])
  }, [])

  const set = useCallback((next: ThumbnailLayer[]) => {
    presentRef.current = next
    futureRef.current = []
    setPresent(next)
    setFuture([])
  }, [])

  const undo = useCallback(() => {
    if (pastRef.current.length === 0) return
    const prev = pastRef.current[pastRef.current.length - 1]
    futureRef.current = [presentRef.current, ...futureRef.current]
    pastRef.current = pastRef.current.slice(0, -1)
    presentRef.current = prev
    setPast(pastRef.current)
    setFuture(futureRef.current)
    setPresent(prev)
    onApplyRef.current?.(prev)
  }, [])

  const redo = useCallback(() => {
    if (futureRef.current.length === 0) return
    const next = futureRef.current[0]
    pastRef.current = [...pastRef.current, presentRef.current]
    futureRef.current = futureRef.current.slice(1)
    presentRef.current = next
    setPast(pastRef.current)
    setFuture(futureRef.current)
    setPresent(next)
    onApplyRef.current?.(next)
  }, [])

  const reset = useCallback((layers: ThumbnailLayer[]) => {
    pastRef.current = []
    presentRef.current = layers
    futureRef.current = []
    setPast([])
    setPresent(layers)
    setFuture([])
  }, [])

  return { layers: present, commit, set, undo, redo, reset, canUndo: past.length > 0, canRedo: future.length > 0 }
}

/** Collapses a continuous edit (color-picker drag, held arrow-key nudge, a
 *  burst of typing) into a single undo entry. Returns `beginsGesture(key)`:
 *  the first change for a given `key` returns `true` (caller commits to
 *  history); subsequent changes for the same key return `false` (caller
 *  applies a no-history live update). A gesture ends when the key changes or
 *  after `idleMs` of inactivity, so distinct edits stay separate undo entries
 *  while a single drag/scrub/type does not flood the history. */
function useCommitOnRelease(idleMs = 400) {
  const keyRef = useRef<string | null>(null)
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  useEffect(() => () => { if (timerRef.current) clearTimeout(timerRef.current) }, [])
  return useCallback((key: string) => {
    const begins = keyRef.current !== key
    keyRef.current = key
    if (timerRef.current) clearTimeout(timerRef.current)
    timerRef.current = setTimeout(() => { keyRef.current = null }, idleMs)
    return begins
  }, [idleMs])
}

// ── Overview ──────────────────────────────────────────────────────────────────


function TemplatePreview({ streamsDir, templateId, name, cacheKey }: { streamsDir: string; templateId: string; name: string; cacheKey?: number }) {
  const [imgError, setImgError] = useState(false)
  const src = `file://${streamsDir}/_thumbnail-assets/templates/${templateId}.png${cacheKey ? `?t=${cacheKey}` : ''}`
  // Reset error state when cacheKey changes (template was re-saved)
  useEffect(() => { setImgError(false) }, [cacheKey])
  return (
    <div className="aspect-video bg-navy-900 flex items-center justify-center overflow-hidden">
      {!imgError ? (
        <SmoothThumb
          key={src}
          src={src}
          className="w-full h-full"
          onError={() => setImgError(true)}
        />
      ) : (
        <LayoutTemplate size={28} className="text-gray-400" />
      )}
    </div>
  )
}

interface OverviewProps {
  streamsDir: string
  templates: ThumbnailTemplate[]
  recents: Array<ThumbnailRecentEntry & { variantCount?: number }>
  onNewBlank: () => void
  onOpenTemplate: (t: ThumbnailTemplate) => void
  onOpenRecent: (entry: ThumbnailRecentEntry) => void
  onRemoveRecent: (entry: ThumbnailRecentEntry) => void
  onClearRecents: () => void
  onDeleteTemplate: (id: string) => void
  loading: boolean
}

function Overview({ streamsDir, templates, recents, onNewBlank, onOpenTemplate, onOpenRecent, onRemoveRecent, onClearRecents, onDeleteTemplate, loading }: OverviewProps) {
  return (
    <div className="flex-1 overflow-y-auto p-6 flex flex-col gap-8 min-h-0">
      {/* Templates */}
      <section>
        <div className="flex items-center justify-between mb-3">
          <h2 className="text-sm font-semibold text-gray-300 uppercase tracking-wider">Templates</h2>
          <Button variant="primary" size="sm" icon={<Plus size={13} />} onClick={onNewBlank}>
            New blank
          </Button>
        </div>
        {/* Reserve ~one card row so the Recents section below doesn't jump
            when templates finish loading (loading/empty states are short). */}
        <div className="min-h-[170px]">
          {loading ? (
          <div className="flex items-center justify-center gap-2 h-[170px] text-xs text-gray-400">
            <Loader2 size={14} className="animate-spin" /> Loading templates…
          </div>
        ) : templates.length === 0 ? (
          <div className="flex items-center justify-center h-[170px] text-xs text-gray-400">No templates yet. Create one from the editor.</div>
        ) : (
          <div className="grid grid-cols-3 gap-3">
            {templates.map(t => (
              <div
                key={t.id}
                className="group relative bg-navy-800 border border-white/10 rounded-lg overflow-hidden cursor-pointer hover:border-purple-500/50 transition-colors"
                onClick={() => onOpenTemplate(t)}
              >
                <TemplatePreview streamsDir={streamsDir} templateId={t.id} name={t.name} cacheKey={t.updatedAt} />
                <div className="p-2 flex items-center justify-between gap-1">
                  <span className="text-xs text-gray-300 truncate">{t.name}</span>
                  <div className="opacity-0 group-hover:opacity-100 flex items-center gap-0.5 transition-all shrink-0">
                    <Tooltip content="Edit template">
                    <button
                      className="p-1 rounded hover:bg-white/10 text-gray-400 hover:text-gray-200 transition-colors"
                      onClick={e => { e.stopPropagation(); onOpenTemplate(t) }}
                    >
                      <Pencil size={12} />
                    </button>
                    </Tooltip>
                    <Tooltip content="Delete template">
                    <button
                      className="p-1 rounded hover:bg-red-500/20 text-gray-400 hover:text-red-400 transition-colors"
                      onClick={e => { e.stopPropagation(); onDeleteTemplate(t.id) }}
                    >
                      <Trash2 size={12} />
                    </button>
                    </Tooltip>
                  </div>
                </div>
              </div>
            ))}
          </div>
        )}
        </div>
      </section>

      {/* Recents */}
      {recents.length > 0 && (
        <section>
          <div className="flex items-center justify-between mb-3">
            <h2 className="text-sm font-semibold text-gray-300 uppercase tracking-wider">Recent</h2>
            <button
              onClick={onClearRecents}
              className="text-[10px] text-gray-400 hover:text-gray-200 px-1.5 py-0.5 rounded hover:bg-white/5 transition-colors"
            >
              Clear all
            </button>
          </div>
          <div className="flex flex-col gap-1.5">
            {recents.map((entry, i) => (
              <RecentRow
                key={i}
                thumbSrc={`file://${entry.folderPath.replace(/\\/g, '/')}/${entry.date}_sm-thumbnail.png?t=${entry.updatedAt}`}
                thumbFallback={<ImageIcon size={12} className="text-gray-400" />}
                title={entry.title ?? entry.date}
                subtitle={
                  <p className="text-[10px] text-gray-400 truncate">
                    {`${entry.variantCount ?? 1} thumbnail${(entry.variantCount ?? 1) === 1 ? '' : 's'}`}
                  </p>
                }
                trailing={<span className="text-[10px] text-gray-400 shrink-0 py-2">{entry.date}</span>}
                onOpen={() => onOpenRecent(entry)}
                onRemove={() => onRemoveRecent(entry)}
              />
            ))}
          </div>
        </section>
      )}
    </div>
  )
}

// ── Color + alpha field ───────────────────────────────────────────────────────

/** Color swatch + optional hex text + opacity % + clear-to-transparent.
 *  Values are #rrggbb or #rrggbbaa strings — canvas, Konva, and the outline
 *  filter all accept both. The native color input is RGB-only, so alpha
 *  rides in the % field beside it; Clear sets alpha to 0. */
function ColorAlphaField({ value, fallback, onChange, showHex = false }: {
  value: string | undefined
  fallback: string
  onChange: (v: string) => void
  /** Show the free-text hex input (accepts #rrggbb / #rrggbbaa). */
  showHex?: boolean
}) {
  const { rgb, alpha } = splitColorAlpha(value, fallback)
  return (
    <div className="flex items-center gap-1.5 min-w-0">
      <input
        type="color"
        value={rgb}
        onChange={e => onChange(joinColorAlpha(e.target.value, alpha))}
        // Square swatch, boxed like the neighboring inputs; the webkit
        // pseudo-element rules make the color chip fill the box with its
        // own rounding instead of the tiny inset native chip.
        className="h-7 w-7 shrink-0 rounded-lg border border-white/10 bg-navy-900 p-0.5 cursor-pointer [&::-webkit-color-swatch-wrapper]:p-0 [&::-webkit-color-swatch]:rounded-md [&::-webkit-color-swatch]:border-none"
        // Fade the swatch with the alpha so transparency is visible at a glance.
        style={{ opacity: 0.35 + 0.65 * alpha }}
      />
      {showHex && (
        <input
          type="text"
          value={value ?? fallback}
          onChange={e => onChange(e.target.value)}
          className="flex-1 min-w-0 bg-navy-900 border border-white/10 rounded-lg px-2 py-1 text-xs text-gray-200"
        />
      )}
      <Tooltip content="Opacity %">
        <NumberInput
          min={0}
          max={100}
          value={Math.round(alpha * 100)}
          onChange={p => onChange(joinColorAlpha(rgb, p / 100))}
          className="w-14 shrink-0"
        />
      </Tooltip>
      <Tooltip content="Clear — fully transparent">
        <button
          type="button"
          onClick={() => onChange(joinColorAlpha(rgb, 0))}
          className="p-1 rounded text-gray-500 hover:text-gray-200 hover:bg-white/10 transition-colors shrink-0"
        >
          <Eraser size={12} />
        </button>
      </Tooltip>
    </div>
  )
}

// ── Properties panel ──────────────────────────────────────────────────────────

interface PropsPanelProps {
  layer: ThumbnailLayer | null
  /** Commits the change to undo history (one entry). */
  onChange: (updated: ThumbnailLayer) => void
  /** Applies the change live WITHOUT pushing an undo entry — used for the
   *  continuation of a gesture so a color drag / scrub / typing burst lands
   *  as a single undo entry (see `useCommitOnRelease`). */
  onLiveChange: (updated: ThumbnailLayer) => void
  systemFonts: string[]
  fontVariantMap: Record<string, { name: string; css: string }[]>
  /** True once the real queryLocalFonts list loaded — gates the
   *  missing-font treatment so the seed list can't cause false alarms. */
  fontsLoaded: boolean
  /** True when the active stream is explicitly standalone (not a series).
   *  Flags the season/episode/total_episodes merge chips as inapplicable —
   *  mirrors the YouTube-title chip editor on the Streams page. False in
   *  template-edit mode (no bound stream → every field is applicable). */
  standalone: boolean
}

function FilterSlider({ label, min, max, step, value, onChange, defaultValue = 0 }: {
  label: string; min: number; max: number; step: number; value: number; onChange: (v: number) => void
  /** Value the slider resets to on a double-click of the knob. Filters are all
   *  neutral at 0, so that's the default. */
  defaultValue?: number
}) {
  return (
    <label className="flex flex-col gap-0.5">
      <div className="flex items-center justify-between">
        <span className="text-[10px] text-gray-400">{label}</span>
        <span className="text-[10px] text-gray-400 tabular-nums">{Number.isInteger(step) ? value : value.toFixed(2)}</span>
      </div>
      <div className="flex items-center gap-1.5">
        <Tooltip content="Double-click to reset" triggerClassName="flex-1 min-w-0 flex">
        <input
          type="range" min={min} max={max} step={step} value={value}
          onChange={e => onChange(Number(e.target.value))}
          onDoubleClick={() => onChange(defaultValue)}
          className="flex-1 accent-purple-600"
        />
        </Tooltip>
        <input
          type="number" min={min} max={max} step={step} value={value}
          onChange={e => onChange(Number(e.target.value))}
          className="w-14 bg-navy-900 border border-white/10 rounded-lg px-1 py-0.5 text-[10px] text-gray-200 tabular-nums"
        />
      </div>
    </label>
  )
}

function FilterToggle({ label, checked, onChange }: {
  label: string; checked: boolean; onChange: (v: boolean) => void
}) {
  return (
    <label className="flex items-center gap-1.5 text-[10px] text-gray-300 cursor-pointer">
      <input
        type="checkbox" checked={checked} onChange={e => onChange(e.target.checked)}
        className="accent-purple-600"
      />
      {label}
    </label>
  )
}

function PropertiesPanel({ layer, onChange, onLiveChange, systemFonts, fontVariantMap, fontsLoaded, standalone }: PropsPanelProps) {
  // Chip-editor wiring for the text-layer body. Hooks must run
  // unconditionally (the editor only renders for text layers), so they
  // live above the early return. Stable sets keep TemplateBodyEditor from
  // rebuilding its chips every render.
  const textInsertRef = useRef<((text: string) => void) | null>(null)
  // Include the legacy {game} alias so pre-rename text layers still read as
  // chips (the picker only offers the canonical {topic}).
  const knownKeys = useMemo(() => new Set<string>([...THUMBNAIL_MERGE_KEYS, 'game']), [])
  const inapplicableKeys = useMemo(
    () => standalone ? new Set<string>(THUMBNAIL_SERIES_KEYS) : new Set<string>(),
    [standalone],
  )
  const pickerKeys = useMemo(
    () => standalone
      ? THUMBNAIL_MERGE_KEYS.filter(k => !THUMBNAIL_SERIES_KEYS.includes(k))
      : THUMBNAIL_MERGE_KEYS,
    [standalone],
  )

  // Gesture tracker so a continuous edit (color-picker drag, held nudge,
  // typing burst) on one property collapses to a single undo entry.
  const beginsGesture = useCommitOnRelease()

  if (!layer) {
    return (
      <div className="p-4 text-xs text-gray-400 text-center">
        Select a layer to edit properties
      </div>
    )
  }

  // Every property edit funnels through here. The first change of a gesture
  // commits to undo history; continuations of the same gesture apply live
  // (no history). Keyed by layer + which property changed so switching
  // field/layer starts a fresh undo entry.
  const update = (patch: Partial<ThumbnailLayer>) => {
    const next = { ...layer, ...patch }
    const key = `${layer.id}:${Object.keys(patch).sort().join(',')}`
    if (beginsGesture(key)) onChange(next)
    else onLiveChange(next)
  }

  // Aspect-ratio lock is per-layer + persisted on the layer itself.
  // Undefined defaults to `true` — newly added images/shapes start
  // locked to their natural aspect, matching every other vector
  // editor's convention. Toggling persists via `update`.
  const aspectLocked = layer.aspectLocked ?? true
  const toggleAspectLock = () => update({ aspectLocked: !aspectLocked })

  // The locked ratio is always derived from the layer's current
  // width/height (not a separately stored "original"). So if the
  // user unlocks, resizes weirdly, then re-locks, the new lock pins
  // to whatever ratio is current — matches expected vector-editor
  // behavior and avoids stale-ratio bugs.
  const lockedRatio = (() => {
    const w = layer.width ?? 0
    const h = layer.height ?? 0
    return h > 0 ? w / h : 1
  })()

  // Width/height inputs accept signed values: a negative number sets
  // the corresponding flip flag and stores the absolute magnitude.
  // Zero leaves the flip state alone so typing "-" → "0" → digits
  // doesn't bounce flip state mid-keystroke. Positive values
  // explicitly unflip — typing a fresh positive number reads as
  // "remove the flip and resize."
  const handleWidthChange = (w: number) => {
    const abs = Math.abs(w)
    const flipX = w < 0 ? true : (w > 0 ? false : !!layer.flipX)
    if (aspectLocked && lockedRatio > 0) {
      update({ width: abs, height: Math.max(1, Math.round(abs / lockedRatio)), flipX })
    } else {
      update({ width: abs, flipX })
    }
  }
  const handleHeightChange = (h: number) => {
    const abs = Math.abs(h)
    const flipY = h < 0 ? true : (h > 0 ? false : !!layer.flipY)
    if (aspectLocked && lockedRatio > 0) {
      update({ height: abs, width: Math.max(1, Math.round(abs * lockedRatio)), flipY })
    } else {
      update({ height: abs, flipY })
    }
  }

  // Reset position/rotation (and for images, contain-fit scale) to the same
  // defaults a freshly-added layer would have. Opacity isn't touched — the
  // user might have intentionally dimmed an overlay and resetting it would
  // be surprising.
  const resetTransform = async () => {
    if (layer.type === 'image' && layer.src) {
      const { naturalW, naturalH } = await new Promise<{ naturalW: number; naturalH: number }>(resolve => {
        const img = new Image()
        img.onload = () => resolve({ naturalW: img.naturalWidth, naturalH: img.naturalHeight })
        img.onerror = () => resolve({ naturalW: layer.width ?? CANVAS_W, naturalH: layer.height ?? CANVAS_H })
        img.src = `file://${layer.src}`
      })
      const containScale = Math.min(1, CANVAS_W / naturalW, CANVAS_H / naturalH)
      const width = Math.round(naturalW * containScale)
      const height = Math.round(naturalH * containScale)
      update({
        x: Math.round((CANVAS_W - width) / 2),
        y: Math.round((CANVAS_H - height) / 2),
        rotation: 0,
        width,
        height,
      })
      return
    }
    const w = layer.width ?? 0
    const h = layer.height ?? 0
    update({
      x: Math.round((CANVAS_W - w) / 2),
      y: Math.round((CANVAS_H - h) / 2),
      rotation: 0,
    })
  }

  return (
    <div className="p-3 flex flex-col gap-3 overflow-y-auto flex-1 min-h-0">
      {/* Common */}
      <section>
        <div className="flex items-center justify-between mb-2">
          <p className="text-[10px] uppercase tracking-wider text-gray-400">Transform</p>
          <Tooltip content="Reset position, rotation, and (for images) scale to defaults">
          <button
            type="button"
            onClick={() => { resetTransform().catch(() => {}) }}
            className="flex items-center gap-1 text-[10px] text-gray-400 hover:text-gray-200 transition-colors"
          >
            <RotateCcw size={10} />
            Reset
          </button>
          </Tooltip>
        </div>
        {(() => {
          const hasWH = layer.width !== undefined && (layer.type === 'image' || layer.type === 'shape') && layer.height !== undefined
          const labelCls = 'text-[10px] text-gray-400'
          return (
            <>
              {hasWH ? (
                // Image / shape: X+W on row 1, Y+H on row 2, lock icon spans
                // both rows on the right (Affinity-style pairing).
                <div className="grid grid-cols-[1fr_1fr_auto] gap-1.5 items-end">
                  <label className="flex flex-col gap-0.5">
                    <span className={labelCls}>X</span>
                    <NumberInput value={Math.round(layer.x)} onChange={x => update({ x })} className="w-full" />
                  </label>
                  <label className="flex flex-col gap-0.5">
                    <span className={labelCls}>Width</span>
                    <NumberInput
                      value={layer.flipX ? -Math.round(layer.width ?? 0) : Math.round(layer.width ?? 0)}
                      onChange={handleWidthChange}
                      className="w-full"
                    />
                  </label>
                  <Tooltip
                    content={aspectLocked
                      ? 'Aspect ratio locked — changing width or height keeps the other dimension proportional. Click to unlock.'
                      : (layer.type === 'image'
                          ? 'Lock aspect ratio. When locked, changing width or height preserves the original image aspect ratio.'
                          : 'Lock aspect ratio. When locked, changing width or height preserves the current ratio.')}
                    triggerClassName="row-span-2 self-stretch pt-4"
                  >
                    <button
                      type="button"
                      onClick={toggleAspectLock}
                      className={`h-full w-3 relative flex items-center justify-center transition-colors ${
                        aspectLocked ? 'text-purple-300 hover:text-purple-200' : 'text-gray-400 hover:text-gray-200'
                      }`}
                      aria-label={aspectLocked ? 'Unlock aspect ratio' : 'Lock aspect ratio'}
                    >
                      {/* Bracket: short horizontal stubs at top + bottom connect
                          to a vertical line broken in the middle where the icon
                          sits. Implies the icon "owns" both inputs at once.
                          pt-4 on the parent wrapper shifts the entire button
                          (and so the SVG + icon together) down by the label
                          height — top stub aligns with top of W input, bottom
                          stub aligns with bottom of H input. */}
                      <svg
                        className="absolute inset-0 w-full h-full pointer-events-none"
                        viewBox="0 0 20 100"
                        preserveAspectRatio="none"
                      >
                        <path
                          d="M 0 4 L 10 4 L 10 38 M 10 62 L 10 96 L 0 96"
                          stroke="currentColor"
                          strokeWidth="1"
                          fill="none"
                          vectorEffect="non-scaling-stroke"
                        />
                      </svg>
                      <span className="relative rotate-90">
                        {aspectLocked ? <Link2 size={14} /> : <Unlink2 size={14} />}
                      </span>
                    </button>
                  </Tooltip>
                  <label className="flex flex-col gap-0.5">
                    <span className={labelCls}>Y</span>
                    <NumberInput value={Math.round(layer.y)} onChange={y => update({ y })} className="w-full" />
                  </label>
                  <label className="flex flex-col gap-0.5">
                    <span className={labelCls}>Height</span>
                    <NumberInput
                      value={layer.flipY ? -Math.round(layer.height ?? 0) : Math.round(layer.height ?? 0)}
                      onChange={handleHeightChange}
                      className="w-full"
                    />
                  </label>
                </div>
              ) : (
                // Text layers (no width/height): just X / Y on one row.
                <div className="grid grid-cols-2 gap-1.5">
                  <label className="flex flex-col gap-0.5">
                    <span className={labelCls}>X</span>
                    <NumberInput value={Math.round(layer.x)} onChange={x => update({ x })} className="w-full" />
                  </label>
                  <label className="flex flex-col gap-0.5">
                    <span className={labelCls}>Y</span>
                    <NumberInput value={Math.round(layer.y)} onChange={y => update({ y })} className="w-full" />
                  </label>
                </div>
              )}
              {/* Rotation + Opacity get their own full-width rows below. */}
              <div className="flex flex-col gap-1.5 mt-1.5">
                {/* Corner radius — rect + triangle (todo #23). Stored in
                    pixels, independent of width/height, so corners stay
                    perfectly circular through resizes. When the entered
                    radius exceeds what the shape's geometry can render
                    (rect: half the short side; triangle: the inradius),
                    the ACTUAL rendered radius shows in parentheses. */}
                {layer.type === 'shape' && (layer.shapeType === 'rect' || layer.shapeType === 'triangle') && (() => {
                  const sw = layer.width ?? 200
                  const sh = layer.height ?? 200
                  const maxR = layer.shapeType === 'triangle' ? Math.min(sw, sh) / 4 : Math.min(sw, sh) / 2
                  const entered = layer.cornerRadius ?? 0
                  return (
                    <label className="flex flex-col gap-0.5">
                      <span className={labelCls}>Corner radius</span>
                      <NumberInput
                        min={0}
                        max={999}
                        value={entered}
                        onChange={cornerRadius => update({ cornerRadius })}
                        inlineNote={entered > maxR ? String(Math.round(maxR)) : undefined}
                        className="w-full"
                      />
                    </label>
                  )
                })()}
                <label className="flex flex-col gap-0.5">
                  <span className={labelCls}>Rotation °</span>
                  <NumberInput value={Math.round(layer.rotation)} onChange={rotation => update({ rotation })} className="w-full" />
                </label>
                <label className="flex flex-col gap-0.5">
                  <span className={labelCls}>Opacity %</span>
                  <NumberInput value={layer.opacity} onChange={opacity => update({ opacity })} min={0} max={100} className="w-full" />
                </label>
              </div>
            </>
          )
        })()}
      </section>

      {layer.type === 'text' && (
        <>
          <section>
            <p className="text-[10px] uppercase tracking-wider text-gray-400 mb-2">Text</p>
            <TemplateBodyEditor
              value={layer.text ?? ''}
              onSave={v => update({ text: v })}
              placeholder="Text…"
              knownKeys={knownKeys}
              inapplicableKeys={inapplicableKeys}
              insertRef={textInsertRef}
              multiline
              minHeight={54}
            />
            <MergeFieldPicker
              keys={pickerKeys}
              onInsert={k => textInsertRef.current?.(`{${k}}`)}
            />
          </section>
          <section>
            <p className="text-[10px] uppercase tracking-wider text-gray-400 mb-2">Font</p>
            <div className="flex flex-col gap-1.5">
              {(() => {
                const fam = layer.fontFamily ?? 'Arial'
                const famMissing = fontsLoaded && !systemFonts.includes(fam)
                return (
                  <>
                    <select
                      value={fam}
                      onChange={e => {
                        const next = e.target.value
                        const variants = fontVariantMap[next]
                        if (variants && variants.length > 0) {
                          // Try to preserve current weight; fall back to first variant
                          const cur = layer.fontStyle ?? 'normal'
                          const match = variants.find(v => v.css === cur) ?? variants.find(v => v.css === 'normal') ?? variants[0]
                          update({ fontFamily: next, fontStyle: match.css })
                        } else {
                          update({ fontFamily: next })
                        }
                      }}
                      className={`bg-navy-900 border rounded-lg px-2 py-1 text-xs w-full ${famMissing ? 'border-amber-500/60 text-amber-300' : 'border-white/10 text-gray-200'}`}
                      style={{ fontFamily: fam }}
                    >
                      {/* Keep the missing family selectable/displayed instead of
                          the select silently showing nothing. Options inherit the
                          select's text color, so when it's amber (missing state)
                          each installed option pins itself back to the normal
                          text color — only the missing entry reads amber. */}
                      {famMissing && <option value={fam} style={{ color: '#fbbf24' }}>{fam} (missing)</option>}
                      {systemFonts.map(f => (
                        <option key={f} value={f} style={{ fontFamily: f, color: '#e5e7eb' }}>{f}</option>
                      ))}
                    </select>
                    {famMissing && (
                      <p className="text-[10px] text-amber-400 flex items-center gap-1">
                        <AlertTriangle size={10} className="shrink-0" />
                        Not installed — pick a replacement to resume image updates
                      </p>
                    )}
                  </>
                )
              })()}
              <div className="grid grid-cols-2 gap-1.5">
                <label className="flex flex-col gap-0.5">
                  <span className="text-[10px] text-gray-400">Style</span>
                  {(() => {
                    const variants = fontVariantMap[layer.fontFamily ?? 'Arial'] ?? []
                    if (variants.length > 0) {
                      const cur = layer.fontStyle ?? 'normal'
                      const matched = variants.find(v => v.css === cur) ?? variants[0]
                      return (
                        <select
                          value={matched.css}
                          onChange={e => update({ fontStyle: e.target.value })}
                          className="bg-navy-900 border border-white/10 rounded-lg px-2 py-1 text-xs text-gray-200"
                        >
                          {variants.map(v => (
                            <option key={v.name} value={v.css}>{v.name}</option>
                          ))}
                        </select>
                      )
                    }
                    return (
                      <select
                        value={layer.fontStyle ?? 'normal'}
                        onChange={e => update({ fontStyle: e.target.value })}
                        className="bg-navy-900 border border-white/10 rounded-lg px-2 py-1 text-xs text-gray-200"
                      >
                        <option value="normal">Normal</option>
                        <option value="bold">Bold</option>
                        <option value="italic">Italic</option>
                        <option value="bold italic">Bold Italic</option>
                      </select>
                    )
                  })()}
                </label>
                <label className="flex flex-col gap-0.5">
                  <span className="text-[10px] text-gray-400">Size</span>
                  <NumberInput
                    min={8}
                    max={500}
                    value={layer.fontSize ?? 48}
                    onChange={fontSize => update({ fontSize })}
                  />
                </label>
              </div>
              <div className="grid grid-cols-2 gap-1.5">
                <label className="flex flex-col gap-0.5">
                  <span className="text-[10px] text-gray-400">Line height %</span>
                  {/* Stored as a multiplier (Konva-native); the UI speaks
                      percent to match the other % fields. */}
                  <NumberInput
                    min={50}
                    max={300}
                    value={Math.round((layer.lineHeight ?? 1) * 100)}
                    onChange={p => update({ lineHeight: p / 100 })}
                  />
                </label>
                <label className="flex flex-col gap-0.5">
                  <span className="text-[10px] text-gray-400">Align</span>
                  <select
                    value={layer.align ?? 'left'}
                    onChange={e => update({ align: e.target.value as any })}
                    className="bg-navy-900 border border-white/10 rounded-lg px-2 py-1 text-xs text-gray-200"
                  >
                    <option value="left">Left</option>
                    <option value="center">Center</option>
                    <option value="right">Right</option>
                  </select>
                </label>
              </div>
            </div>
          </section>
          <section>
            <p className="text-[10px] uppercase tracking-wider text-gray-400 mb-2">Color</p>
            {/* Stacked full-width rows (was a 2-col grid) — the alpha% +
                clear controls need the horizontal room. */}
            <div className="flex flex-col gap-1.5">
              <label className="flex flex-col gap-0.5">
                <span className="text-[10px] text-gray-400">Fill</span>
                <ColorAlphaField
                  value={layer.fill}
                  fallback="#ffffff"
                  showHex
                  onChange={fill => update({ fill })}
                />
              </label>
              <label className="flex flex-col gap-0.5">
                <span className="text-[10px] text-gray-400">Stroke</span>
                <ColorAlphaField
                  value={layer.stroke}
                  fallback="#000000"
                  showHex
                  onChange={stroke => update({ stroke })}
                />
              </label>
              <label className="flex flex-col gap-0.5">
                <span className="text-[10px] text-gray-400">Stroke width</span>
                <input
                  type="number"
                  min={0}
                  max={50}
                  placeholder="0"
                  value={layer.strokeWidth ?? 0}
                  onChange={e => update({ strokeWidth: Number(e.target.value) })}
                  className="w-full bg-navy-900 border border-white/10 rounded-lg px-2 py-1 text-xs text-gray-200"
                />
              </label>
            </div>
          </section>
        </>
      )}

      {layer.type === 'shape' && (
        <section>
          <p className="text-[10px] uppercase tracking-wider text-gray-400 mb-2">Fill & Stroke</p>
          <div className="flex flex-col gap-1.5">
            <label className="flex flex-col gap-0.5">
              <span className="text-[10px] text-gray-400">Fill</span>
              <ColorAlphaField
                value={layer.fill}
                fallback="#6366f1"
                showHex
                onChange={fill => update({ fill })}
              />
            </label>
            <label className="flex flex-col gap-0.5">
              <span className="text-[10px] text-gray-400">Stroke</span>
              <ColorAlphaField
                value={layer.stroke}
                fallback="#000000"
                showHex
                onChange={stroke => update({ stroke })}
              />
            </label>
            <label className="flex flex-col gap-0.5">
              <span className="text-[10px] text-gray-400">Stroke width</span>
              <NumberInput min={0} max={100} placeholder="0" value={layer.strokeWidth ?? 0}
                onChange={strokeWidth => update({ strokeWidth })}
                className="w-full" />
            </label>
            {/* Corner radius moved to the Transform section (under size/
                position) — it applies to rect AND triangle now. */}
          </div>
        </section>
      )}

      {/* Drop Shadows — multi-shadow stack. Each entry renders as its
          own ghost clone of the layer behind the original (Konva only
          supports one shadow per node, so stacking is the only way to
          combine multiple). Use `resolveShadows` so the panel sees the
          same migrated list the renderer does — first edit converts
          the legacy single-shadow fields into a one-entry array. */}
      <section>
        {(() => {
          const shadows = resolveShadows(layer)
          // Migrate-on-write: any change here drops the legacy single-
          // shadow fields so we don't keep two sources of truth on disk.
          const writeShadows = (next: ThumbnailShadow[]) => update({
            shadows: next,
            shadowEnabled: undefined,
            shadowColor: undefined,
            shadowOffsetX: undefined,
            shadowOffsetY: undefined,
            shadowBlur: undefined,
            shadowOpacity: undefined,
          })
          const updateAt = (idx: number, patch: Partial<ThumbnailShadow>) =>
            writeShadows(shadows.map((s, i) => i === idx ? { ...s, ...patch } : s))
          const removeAt = (idx: number) =>
            writeShadows(shadows.filter((_, i) => i !== idx))
          const addShadow = () =>
            writeShadows([
              ...shadows,
              // New shadow inherits the last entry's params when one
              // exists — easier to stack subtle variations than to
              // restart from defaults every time.
              shadows.length > 0
                ? { ...shadows[shadows.length - 1] }
                : { color: '#000000', offsetX: 4, offsetY: 4, blur: 8, opacity: 100 },
            ])
          return (
            <>
              <div className="flex items-center justify-between mb-2">
                <p className="text-[10px] uppercase tracking-wider text-gray-400">
                  Drop Shadows {shadows.length > 0 && <span className="text-gray-500 normal-case tracking-normal">({shadows.length})</span>}
                </p>
                <Tooltip content="Add a shadow pass">
                <button
                  type="button"
                  onClick={addShadow}
                  className="flex items-center gap-1 text-[10px] text-gray-400 hover:text-gray-200 transition-colors"
                >
                  <Plus size={11} />
                  Add
                </button>
                </Tooltip>
              </div>
              {shadows.length === 0 && (
                <p className="text-[11px] text-gray-500 italic">No shadows. Click "Add" to stack one or more behind the layer.</p>
              )}
              <div className="flex flex-col gap-2.5">
                {shadows.map((s, idx) => (
                  <div key={idx} className="rounded-lg border border-white/5 p-2 flex flex-col gap-1.5 bg-navy-900/40">
                    <div className="flex items-center justify-between">
                      <span className="text-[10px] uppercase tracking-wider text-gray-500">Shadow {idx + 1}</span>
                      <Tooltip content="Remove this shadow">
                      <button
                        type="button"
                        onClick={() => removeAt(idx)}
                        className="p-1 rounded text-gray-500 hover:text-red-400 hover:bg-red-900/20 transition-colors"
                      >
                        <Trash2 size={11} />
                      </button>
                      </Tooltip>
                    </div>
                    <label className="flex flex-col gap-0.5">
                      <span className="text-[10px] text-gray-400">Color</span>
                      <div className="flex items-center gap-1.5">
                        {/* Same boxed square swatch as ColorAlphaField — alpha
                            controls stay off here; shadows have their own
                            Opacity % field below. */}
                        <input type="color" value={s.color}
                          onChange={e => updateAt(idx, { color: e.target.value })}
                          className="h-7 w-7 shrink-0 rounded-lg border border-white/10 bg-navy-900 p-0.5 cursor-pointer [&::-webkit-color-swatch-wrapper]:p-0 [&::-webkit-color-swatch]:rounded-md [&::-webkit-color-swatch]:border-none" />
                        <input type="text" value={s.color}
                          onChange={e => updateAt(idx, { color: e.target.value })}
                          className="flex-1 min-w-0 bg-navy-900 border border-white/10 rounded-lg px-2 py-1 text-xs text-gray-200" />
                      </div>
                    </label>
                    <div className="grid grid-cols-2 gap-1.5">
                      <label className="flex flex-col gap-0.5">
                        <span className="text-[10px] text-gray-400">Offset X</span>
                        <NumberInput value={s.offsetX}
                          onChange={offsetX => updateAt(idx, { offsetX })} className="w-full" />
                      </label>
                      <label className="flex flex-col gap-0.5">
                        <span className="text-[10px] text-gray-400">Offset Y</span>
                        <NumberInput value={s.offsetY}
                          onChange={offsetY => updateAt(idx, { offsetY })} className="w-full" />
                      </label>
                      <label className="flex flex-col gap-0.5">
                        <span className="text-[10px] text-gray-400">Blur</span>
                        <NumberInput min={0} value={s.blur}
                          onChange={blur => updateAt(idx, { blur })} className="w-full" />
                      </label>
                      <label className="flex flex-col gap-0.5">
                        <span className="text-[10px] text-gray-400">Opacity %</span>
                        <NumberInput min={0} max={100} value={s.opacity}
                          onChange={opacity => updateAt(idx, { opacity })} className="w-full" />
                      </label>
                    </div>
                  </div>
                ))}
              </div>
            </>
          )
        })()}
      </section>

      {/* Outline — alpha-dilation stroke. Works on every layer type:
          text + shape route to Konva's native stroke (overriding the
          design-stroke in the fill/stroke section above when enabled);
          image runs the custom alpha-dilation filter from
          `makeOutlineFilter`. When stacked with shadows above, the
          shadows attach to the dilated silhouette — that's how you get
          spread shadow without a dedicated spread parameter on each
          shadow entry. */}
      <section>
        <div className="flex items-center justify-between mb-2">
          <p className="text-[10px] uppercase tracking-wider text-gray-400">Outline</p>
          <label className="flex items-center gap-1 text-[10px] text-gray-400 cursor-pointer">
            <input
              type="checkbox"
              checked={!!layer.outlineEnabled}
              onChange={e => update({ outlineEnabled: e.target.checked })}
              className="accent-purple-600"
            />
            Enable
          </label>
        </div>
        {layer.outlineEnabled && (
          <div className="flex flex-col gap-1.5">
            <label className="flex flex-col gap-0.5">
              <span className="text-[10px] text-gray-400">Color</span>
              <ColorAlphaField
                value={layer.outlineColor}
                fallback="#000000"
                showHex
                onChange={outlineColor => update({ outlineColor })}
              />
            </label>
            <label className="flex flex-col gap-0.5">
              <span className="text-[10px] text-gray-400">Width</span>
              <NumberInput min={0} max={50} value={layer.outlineWidth ?? 0}
                onChange={outlineWidth => update({ outlineWidth })} className="w-full" />
            </label>
            {layer.type === 'image' && (
              <p className="text-[10px] text-gray-500 leading-snug">
                Wider outlines on large images can briefly stutter while the
                filter recomputes. Konva caches the result, so only changes
                trigger a recompute.
              </p>
            )}
            {layer.type !== 'image' && (layer.strokeWidth ?? 0) > 0 && (
              <p className="text-[10px] text-yellow-400/80 leading-snug">
                Overrides the design stroke ({layer.strokeWidth}px) above while enabled.
              </p>
            )}
          </div>
        )}
      </section>

      {/* Filters — image layers only. All filter values persist in JSON
          regardless of the master toggle, so the user can A/B compare without
          re-dialing settings. The cache + filter application is wired in
          ImageNode's effect. */}
      {layer.type === 'image' && (
        <section>
          <div className="flex items-center justify-between mb-2">
            <p className="text-[10px] uppercase tracking-wider text-gray-400">Filters</p>
            <label className="flex items-center gap-1 text-[10px] text-gray-400 cursor-pointer">
              <input
                type="checkbox"
                checked={!!layer.filtersEnabled}
                onChange={e => update({ filtersEnabled: e.target.checked })}
                className="accent-purple-600"
              />
              Enable
            </label>
          </div>
          {layer.filtersEnabled && (
            <div className="flex flex-col gap-2">
              <FilterSlider label="Brightness" min={-1} max={1} step={0.05} value={layer.filterBrightness ?? 0}
                onChange={v => update({ filterBrightness: v })} />
              <FilterSlider label="Contrast" min={-100} max={100} step={1} value={layer.filterContrast ?? 0}
                onChange={v => update({ filterContrast: v })} />
              <FilterSlider label="Saturation" min={-2} max={10} step={0.1} value={layer.filterSaturation ?? 0}
                onChange={v => update({ filterSaturation: v })} />
              <FilterSlider label="Hue" min={-180} max={180} step={1} value={layer.filterHue ?? 0}
                onChange={v => update({ filterHue: v })} />
              <FilterSlider label="Luminance" min={-2} max={2} step={0.05} value={layer.filterLuminance ?? 0}
                onChange={v => update({ filterLuminance: v })} />
              <FilterSlider label="Blur" min={0} max={40} step={1} value={layer.filterBlur ?? 0}
                onChange={v => update({ filterBlur: v })} />
              <FilterSlider label="Enhance" min={-1} max={1} step={0.05} value={layer.filterEnhance ?? 0}
                onChange={v => update({ filterEnhance: v })} />
              <FilterSlider label="Pixelate" min={0} max={50} step={1} value={layer.filterPixelate ?? 0}
                onChange={v => update({ filterPixelate: v })} />
              <FilterSlider label="Posterize" min={0} max={1} step={0.05} value={layer.filterPosterize ?? 0}
                onChange={v => update({ filterPosterize: v })} />
              <FilterSlider label="Threshold" min={0} max={1} step={0.01} value={layer.filterThreshold ?? 0}
                onChange={v => update({ filterThreshold: v })} />
              <div className="grid grid-cols-2 gap-1.5 mt-1">
                <FilterToggle label="Grayscale" checked={!!layer.filterGrayscale}
                  onChange={v => update({ filterGrayscale: v })} />
                <FilterToggle label="Sepia" checked={!!layer.filterSepia}
                  onChange={v => update({ filterSepia: v })} />
                <FilterToggle label="Invert" checked={!!layer.filterInvert}
                  onChange={v => update({ filterInvert: v })} />
                <FilterToggle label="Emboss" checked={!!layer.filterEmboss}
                  onChange={v => update({ filterEmboss: v })} />
              </div>
              <button
                type="button"
                onClick={() => update({
                  filterBrightness: 0, filterContrast: 0, filterBlur: 0,
                  filterHue: 0, filterSaturation: 0, filterLuminance: 0,
                  filterPixelate: 0, filterPosterize: 0, filterEnhance: 0, filterThreshold: 0,
                  filterGrayscale: false, filterSepia: false, filterInvert: false, filterEmboss: false,
                })}
                className="text-[10px] text-gray-400 hover:text-gray-300 self-start"
              >
                Reset filters
              </button>
            </div>
          )}
        </section>
      )}
    </div>
  )
}

// ── Main ThumbnailPage ────────────────────────────────────────────────────────

export function ThumbnailPage({ isVisible }: { isVisible: boolean }) {
  const { pendingStream, clearPendingStream } = useThumbnailEditor()
  const { config, updateConfig } = useStore()
  const { setThumbnailHasCanvas } = usePageActivity()
  // Assets-panel options dropdown (show-from-season / show-from-topic-game).
  const [assetOptionsOpen, setAssetOptionsOpen] = useState(false)
  const assetOptionsRef = useRef<HTMLDivElement>(null)
  // Assets-panel collapse — just the header when collapsed (options button
  // and list hidden). Persisted UI pref, same pattern as the files grid.
  const [assetsCollapsed, setAssetsCollapsed] = useState(() => localStorage.getItem('thumbAssetsCollapsed') === 'true')
  const toggleAssetsCollapsed = () => {
    const next = !assetsCollapsed
    setAssetsCollapsed(next)
    localStorage.setItem('thumbAssetsCollapsed', String(next))
    if (next) setAssetOptionsOpen(false)
  }
  useEffect(() => {
    if (!assetOptionsOpen) return
    const onDown = (e: MouseEvent) => {
      if (assetOptionsRef.current && !assetOptionsRef.current.contains(e.target as Node)) setAssetOptionsOpen(false)
    }
    document.addEventListener('mousedown', onDown)
    return () => document.removeEventListener('mousedown', onDown)
  }, [assetOptionsOpen])

  // ── Mode ─────────────────────────────────────────────────────────────────
  const [mode, setMode] = useState<'overview' | 'editor'>('overview')

  // ── Overview data ─────────────────────────────────────────────────────────
  const [templates, setTemplates] = useState<ThumbnailTemplate[]>([])
  const [recents, setRecents] = useState<Array<ThumbnailRecentEntry & { variantCount?: number }>>([])
  const [overviewLoading, setOverviewLoading] = useState(false)

  // ── Editor state ──────────────────────────────────────────────────────────
  const [currentStream, setCurrentStream] = useState<{ folderPath: string; date: string; title?: string; meta?: StreamMeta; totalEpisodes?: number } | null>(null)
  const [currentTemplateId, setCurrentTemplateId] = useState<string | undefined>(undefined)
  // Multi-thumbnail support: a stream can have N SM-thumbnails on
  // disk, named `<date>_sm-thumbnail.png` (variant 1, legacy) and
  // `<date>_sm-thumbnail-N.png` for N≥2. `variants` holds every
  // ordinal currently present in the folder; `currentVariant` is the
  // one being edited. Both default to [1] / 1 so legacy single-
  // thumbnail streams behave identically without any migration.
  const [variants, setVariants] = useState<number[]>([1])
  const [currentVariant, setCurrentVariant] = useState<number>(1)
  // Mark the open thumbnail as in-use so the Streams page blocks deleting it
  // (and its stream) while the editor has it open — registering the variant's
  // image, which sits under the stream folder, covers both the file-level and
  // stream-level delete guards. Cleared when not editing a stream.
  const { setOpen: setOpenItems } = useOpenItems()
  useEffect(() => {
    if (mode === 'editor' && currentStream) {
      const suffix = currentVariant <= 1 ? '' : `-${currentVariant}`
      setOpenItems('thumbnail', [`${currentStream.folderPath}/${currentStream.date}_sm-thumbnail${suffix}.png`])
    } else {
      setOpenItems('thumbnail', [])
    }
  }, [mode, currentStream, currentVariant, setOpenItems])
  useEffect(() => () => setOpenItems('thumbnail', []), [setOpenItems])
  // Variant switcher dropdown state. `variantPickerOpen` toggles the
  // popover; an outside-click effect (further down) closes it.
  // `variantPreviewKey` is bumped after each successful canvas save so
  // every preview <img> in the popover re-fetches the underlying PNG —
  // the browser caches `file://` URLs aggressively, so without a
  // querystring bump the user would see the old thumbnail.
  const [variantPickerOpen, setVariantPickerOpen] = useState(false)
  const variantPickerRef = useRef<HTMLDivElement>(null)
  const [variantPreviewKey, setVariantPreviewKey] = useState(0)
  useEffect(() => {
    if (!variantPickerOpen) return
    const onDown = (e: MouseEvent) => {
      if (variantPickerRef.current && !variantPickerRef.current.contains(e.target as Node)) {
        setVariantPickerOpen(false)
      }
    }
    document.addEventListener('mousedown', onDown)
    return () => document.removeEventListener('mousedown', onDown)
  }, [variantPickerOpen])
  // Close the picker when the editor switches streams — avoids the
  // dropdown lingering open across an unrelated open/load.
  useEffect(() => { setVariantPickerOpen(false) }, [currentStream?.folderPath, currentStream?.date])
  // Asset library data: images from the current stream's folder + images
  // from same-season stream folders (other episodes), so the user can pull
  // visuals from previous episodes when designing a new thumbnail.
  type SeasonAssetGroup = { folderPath: string; date: string; episode?: string; title?: string; images: string[] }
  const [seasonAssets, setSeasonAssets] = useState<{ current: SeasonAssetGroup | null; related: SeasonAssetGroup[] } | null>(null)
  // Bumped by the paste-image handler so the asset panel re-fetches and
  // shows the newly-written file. listStreams is the only way to discover
  // the change since no streams:changed event fires for ad-hoc file writes.
  const [assetRefreshTrigger, setAssetRefreshTrigger] = useState(0)
  // Cache image dimensions as the grid <img> elements load — used for the
  // hover tooltip (filename + dimensions). Map<absolutePath, {w, h}>.
  const [assetDims, setAssetDims] = useState<Map<string, { w: number; h: number }>>(new Map())
  // Cache file sizes (bytes). Batched fetch via files:getFileSizes whenever
  // the seasonAssets list changes — same lifecycle as the panel itself.
  // null = stat failed for that path.
  const [assetSizes, setAssetSizes] = useState<Map<string, number | null>>(new Map())
  // Pending-delete confirmation for an asset-panel image. Holds the path
  // being confirmed; null when no confirmation is active.
  const [assetDeleteTarget, setAssetDeleteTarget] = useState<string | null>(null)

  // Refresh size cache whenever the asset list changes. Batched IPC: one
  // round-trip for every visible image rather than N. Only fetches for
  // paths we haven't already cached so flipping between expanded sections
  // doesn't re-stat known files.
  useEffect(() => {
    if (!seasonAssets) return
    const allPaths: string[] = []
    if (seasonAssets.current) allPaths.push(...seasonAssets.current.images)
    for (const g of seasonAssets.related) allPaths.push(...g.images)
    const missing = allPaths.filter(p => !assetSizes.has(p))
    if (missing.length === 0) return
    let cancelled = false
    window.api.getFileSizes(missing)
      .then(sizes => {
        if (cancelled) return
        setAssetSizes(prev => {
          const next = new Map(prev)
          missing.forEach((p, i) => next.set(p, sizes[i]))
          return next
        })
      })
      .catch(() => {})
    return () => { cancelled = true }
  // assetSizes intentionally NOT in deps — including it would re-fire after
  // every setAssetSizes (the very thing we trigger), looping. The seasonAssets
  // identity change is the correct trigger for fetching missing entries.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [seasonAssets])
  // Forward layer changes from undo/redo into the autosave pipeline. Uses a
  // ref because triggerAutoSave is defined later in this function — the
  // useUndoRedo hook needs a stable callback at construction time, but the
  // body it points at can change as currentStream / template state shifts.
  const triggerAutoSaveRef = useRef<((layers: ThumbnailLayer[]) => void) | null>(null)
  const { layers, commit, set: setLayersDirect, undo, redo, reset: resetLayers, canUndo, canRedo } = useUndoRedo(
    [],
    useCallback((next: ThumbnailLayer[]) => {
      // Undo/redo must repaint TRUTH. Imperative Konva mutations (drag-move
      // repositioning of multi-drag companions, transform scale/skew) live
      // on the nodes, not in React — when a restored layer's props equal
      // whatever react-konva last rendered, its diff applies nothing and
      // the node stays wherever the interrupted gesture left it (stuck at
      // the wrong position, seemingly un-flippable, until a session
      // reopen rebuilt it). Stamp every Group's transform from the
      // restored state so the canvas always matches history.
      const stage = stageRef.current
      if (stage) {
        for (const l of next) {
          const node = stage.findOne(`#${l.id}`)
          if (!node) continue
          node.x(l.x)
          node.y(l.y)
          node.rotation(l.rotation)
          node.scaleX(1)
          node.scaleY(1)
          node.skewX(0)
          node.skewY(0)
        }
        stage.batchDraw()
      }
      triggerAutoSaveRef.current?.(next)
    }, []),
  )
  const [selectedIds, setSelectedIds] = useState<string[]>([])
  const selectedIdsRef = useRef<string[]>([])
  useEffect(() => { selectedIdsRef.current = selectedIds }, [selectedIds])
  // Live layers for the keyboard handler's relative edits (arrow-key nudge),
  // which can fire on auto-repeat faster than React re-renders the closure.
  const layersRef = useRef(layers)
  useEffect(() => { layersRef.current = layers }, [layers])
  // Inline rename state for the layer panel. Only one layer renames at a time.
  const [renamingLayerId, setRenamingLayerId] = useState<string | null>(null)
  // Drag-and-drop reordering state. `dropTargetDisplayIdx` is the gap index
  // (0..N inclusive) in display-order space — 0 = above the topmost row,
  // N = below the bottommost row.
  const [draggingLayerId, setDraggingLayerId] = useState<string | null>(null)
  const [dropTargetDisplayIdx, setDropTargetDisplayIdx] = useState<number | null>(null)

  // Sync the shared Transformer's nodes() to the current selection. Konva's
  // Transformer renders no handles when nodes() is empty (i.e. nothing
  // selected), so we don't need an isSelected gate. Single-text selection
  // gets keepRatio off but the boundBoxFunc locks height to font metrics.
  // Single triangle gets keepRatio on so it stays equilateral.
  //
  // Multi-select with any rotated member ALSO forces keepRatio: a non-uniform
  // scale on a rotated child requires a skew to fit the axis-aligned group
  // bbox, and we don't model skew anywhere else in the editor — letting it
  // happen would leave items visibly sheared (and the shear would survive
  // undo because skew lives on the Konva node, not the layer state).
  useEffect(() => {
    const tr = transformerRef.current
    const stage = stageRef.current
    if (!tr || !stage) return
    const nodes = selectedIds
      .map(id => stage.findOne(`#${id}`))
      .filter((n): n is Konva.Node => !!n)
    tr.nodes(nodes)

    const sel = layers.filter(l => selectedIds.includes(l.id))
    const onlyText = sel.length > 0 && sel.every(l => l.type === 'text')
    const singleTriangle = sel.length === 1 && sel[0].type === 'shape' && sel[0].shapeType === 'triangle'
    const rotatedInMulti = sel.length > 1 && sel.some(l => (l.rotation ?? 0) !== 0)
    tr.keepRatio(singleTriangle || rotatedInMulti)
    // Stop Konva from forcing proportional scaling when Shift is held — our
    // boundBoxFunc is the sole aspect-ratio authority (Shift inverts the
    // per-layer lock there), and Konva's default Shift behavior would
    // pre-constrain the box and corrupt the cursor reconstruction.
    tr.shiftBehavior('none')
    tr.enabledAnchors(onlyText
      ? ['middle-left', 'middle-right']
      : ['top-left', 'top-right', 'bottom-left', 'bottom-right',
         'top-center', 'bottom-center', 'middle-left', 'middle-right'])
    tr.getLayer()?.batchDraw()
  }, [selectedIds, layers])

  const [isDirty, setIsDirty] = useState(false)
  const [saveTemplateOpen, setSaveTemplateOpen] = useState(false)
  const [saveTemplateName, setSaveTemplateName] = useState('')
  const saveTemplateInputRef = useRef<HTMLInputElement>(null)
  const [deleteThumbOpen, setDeleteThumbOpen] = useState(false)
  // Clipboard persists across stream navigations (component stays mounted)
  const [clipboardLayers, setClipboardLayers] = useState<ThumbnailLayer[]>([])

  // ── Template picker (shown when opening a new stream with no existing canvas) ─
  // `templatePickerStream` carries an optional `targetVariant`. When
  // undefined, the picker is in its initial-thumbnail flow (writes
  // ordinal 1). When set (≥2), it's the "+ New thumbnail" flow that
  // creates an alternative at the next available ordinal.
  const [templatePickerStream, setTemplatePickerStream] = useState<{ folderPath: string; date: string; title?: string; meta?: StreamMeta; totalEpisodes?: number; targetVariant?: number; knownVariants?: number[] } | null>(null)
  // Picker selection — 'blank' | 'duplicate' | a template id. Cards select;
  // the footer's Create button (disabled until a pick) commits. Reset per open.
  const [pickerChoice, setPickerChoice] = useState<'blank' | 'duplicate' | string | null>(null)
  useEffect(() => { setPickerChoice(null) }, [templatePickerStream])

  // ── Container / zoom / pan ────────────────────────────────────────────────
  const canvasContainerRef = useRef<HTMLDivElement>(null)
  const [containerSize, setContainerSize] = useState({ w: 800, h: 600 })
  const [fitScale, setFitScale] = useState(1)
  const [viewZoom, setViewZoom] = useState(1)
  const [viewPan, setViewPan] = useState({ x: 0, y: 0 })
  const [isPanning, setIsPanning] = useState(false)
  const viewZoomRef = useRef(1)
  const viewPanRef = useRef({ x: 0, y: 0 })
  const fitScaleRef = useRef(1)

  // Snap to a specific zoom level and re-center the canvas inside the
  // viewport. Used by the quick-zoom button row + reset button; mirrors the
  // double-middle-click reset behavior so all "jump to a view" affordances
  // converge on the same end state.
  const setZoomCentered = useCallback((target: number) => {
    const { w: cw, h: ch } = containerSizeRef.current
    const pan = centeredCanvasPan(target, cw, ch)
    viewZoomRef.current = target
    viewPanRef.current = pan
    setViewZoom(target)
    setViewPan(pan)
  }, [])
  const containerSizeRef = useRef({ w: 800, h: 600 })
  const isPanningRef = useRef(false)
  const panStartRef = useRef({ x: 0, y: 0, panX: 0, panY: 0 })
  const lastMiddleClickRef = useRef(0)
  // First-mount flag for the resize observer. clampCanvasPan no longer
  // auto-centers when the canvas fits the viewport, so we explicitly center
  // on the first measurement instead of letting (0, 0) survive the clamp.
  const hasInitializedPanRef = useRef(false)

  // Keep refs in sync
  useEffect(() => { viewZoomRef.current = viewZoom }, [viewZoom])
  useEffect(() => { viewPanRef.current = viewPan }, [viewPan])

  // ── Stage refs ────────────────────────────────────────────────────────────
  const stageRef = useRef<Konva.Stage>(null)
  const bgLayerRef = useRef<Konva.Layer>(null)
  const guideLayerRef = useRef<Konva.Layer>(null)
  const transformerLayerRef = useRef<Konva.Layer>(null)
  const matteLayerRef = useRef<Konva.Layer>(null)
  // Shared transformer: one for the whole stage, attached to all selected
  // nodes. Multi-select resize/rotate works because Konva's Transformer
  // applies group-bbox math across every node in nodes(). Per-node
  // transformend events fire one at a time; we batch them via microtask
  // so a 5-node group transform is a single undo entry.
  const transformerRef = useRef<Konva.Transformer>(null)
  const pendingTransformsRef = useRef<Map<string, Konva.Node>>(new Map())
  const commitTransformScheduledRef = useRef(false)

  // Box at the start of the current resize gesture. boundBoxFunc references
  // this (not the per-frame oldBox) for ratio / anchor / scale so the whole
  // transform is recomputed each frame as a pure function of (startBox,
  // cursor, current modifiers). That's what makes pressing/releasing Shift or
  // Ctrl mid-drag behave as if the key had been held the whole time — like
  // Photoshop/Affinity — instead of baking a distorted frame into the
  // baseline. Captured on the first boundBoxFunc frame (when null) and reset
  // to null in handleTransformEnd so the next gesture re-captures.
  const resizeStartBoxRef = useRef<KonvaBox | null>(null)

  // Modifier state observable from inside boundBoxFunc (which doesn't
  // carry event info). During a resize-handle drag:
  //   • Shift inverts the layer's aspectLocked flag for that gesture only
  //     (Photoshop/Affinity convention).
  //   • Ctrl (or Cmd) does centered/symmetric scaling — origin = layer center.
  // Alt is intentionally NOT read here: Konva's Transformer bakes in its own
  // Alt=centered behavior, but we reconstruct the box geometry ourselves so
  // Alt has no effect on resize (reserved for Alt+drag duplicate later).
  const shiftPressedRef = useRef(false)
  const ctrlPressedRef = useRef(false)
  useEffect(() => {
    const sync = (e: KeyboardEvent) => {
      shiftPressedRef.current = e.shiftKey
      ctrlPressedRef.current = e.ctrlKey || e.metaKey
    }
    // Some focus-shift sequences can leave the keyup unfired (e.g. user
    // alt-tabs while holding a modifier). Reset on blur to avoid a stale
    // "always held" state.
    const onBlur = () => { shiftPressedRef.current = false; ctrlPressedRef.current = false }
    window.addEventListener('keydown', sync)
    window.addEventListener('keyup', sync)
    window.addEventListener('blur', onBlur)
    return () => {
      window.removeEventListener('keydown', sync)
      window.removeEventListener('keyup', sync)
      window.removeEventListener('blur', onBlur)
    }
  }, [])

  // ── Snapping ──────────────────────────────────────────────────────────────
  const [smartSnapEnabled, setSmartSnapEnabled] = useState(true)
  const [gridSnapEnabled, setGridSnapEnabled] = useState(false)
  // Alignment toolbar mode. 'artboard' aligns to canvas edges/centers.
  // 'selection' aligns to the first-selected layer's bbox; only meaningful
  // with 2+ items so we auto-revert to 'artboard' below the threshold.
  const [alignMode, setAlignMode] = useState<'artboard' | 'selection'>('artboard')
  useEffect(() => {
    if (selectedIds.length < 2 && alignMode === 'selection') setAlignMode('artboard')
  }, [selectedIds.length, alignMode])
  // Bbox of the first-selected layer in stage (canvas) coords. Used to render
  // the dashed anchor outline when the user is in selection-align mode, so
  // they can see which item everything else is aligning to. Computed in an
  // effect so Konva nodes are guaranteed up-to-date before getClientRect.
  const [alignAnchorBbox, setAlignAnchorBbox] = useState<{ x: number; y: number; width: number; height: number } | null>(null)
  useEffect(() => {
    if (alignMode !== 'selection' || selectedIds.length < 2) {
      setAlignAnchorBbox(null)
      return
    }
    const stage = stageRef.current
    if (!stage) return
    const node = stage.findOne(`#${selectedIds[0]}`)
    if (!node) {
      setAlignAnchorBbox(null)
      return
    }
    const r = node.getClientRect({ relativeTo: stage as unknown as Konva.Container })
    setAlignAnchorBbox({ x: r.x, y: r.y, width: r.width, height: r.height })
  }, [alignMode, selectedIds, layers])

  // Load asset-library data whenever the active stream changes, AND
  // whenever the streams root's chokidar watcher reports a file change
  // (so dragging in / removing thumbnails outside the app surfaces in the
  // panel without a manual refresh). Reuses the existing listStreams IPC.
  // A monotonic token gates stale results: rapid file events queueing
  // multiple loads only let the latest one apply.
  useEffect(() => {
    if (!currentStream || !config.streamsDir) {
      setSeasonAssets(null)
      return
    }
    let cancelled = false
    let token = 0

    const load = async () => {
      const myToken = ++token
      try {
        const all = await window.api.listStreams(config.streamsDir, config.streamMode || 'folder-per-stream')
        if (cancelled || myToken !== token) return
        const cur = all.find(s => s.folderPath === currentStream.folderPath)
        if (!cur) { setSeasonAssets(null); return }
        // Related-episode sources are user-controlled via the Assets
        // panel options dropdown. Both require the SAME series (same
        // Topic/Game) — matching on a bare season number would pull in
        // unrelated games that happen to share it (e.g. Hardspace S2
        // surfacing Rimworld S2):
        //   • FromSeason    → same series, same season (this season's episodes).
        //   • FromTopicGame → same series, ALL seasons (the whole series).
        //                     Broader, so it supersedes FromSeason.
        // Both off → no related streams (only the current stream's assets).
        // Season defaults to '1' so streams without an explicit ytSeason
        // still group together.
        const curGame = cur.meta?.games?.[0] ?? cur.detectedGames?.[0]
        const curSeason = cur.meta?.ytSeason ?? '1'
        const fromTopicGame = config.thumbnailAssetsFromTopicGame
        const fromSeason = config.thumbnailAssetsFromSeason
        const sameSeason = (s: StreamFolder) => (s.meta?.ytSeason ?? '1') === curSeason
        const sameGame = (s: StreamFolder) =>
          !!curGame && !!s.meta?.games?.some(g => g.toLowerCase() === curGame.toLowerCase())
        const related = (fromTopicGame || fromSeason)
          ? all
              .filter(s =>
                s.folderPath !== currentStream.folderPath &&
                sameGame(s) &&
                // Topic/Game spans every season; Season alone narrows to
                // the current one.
                (fromTopicGame || sameSeason(s))
              )
              // Reverse chronological — newest stream items at the top.
              .sort((a, b) => b.date.localeCompare(a.date))
          : []
        // Skip the SM thumbnail PNG itself (`<date>_sm-thumbnail.png`):
        //   - Current stream: it's the file we're editing — adding it as a
        //     layer would render the canvas inside itself, infinitely.
        //   - Other streams: the rendered thumb isn't useful as source
        //     material; the underlying screenshots are already in the list.
        // Match both `<date>_sm-thumbnail.png` and the
        // `<date>_sm-thumbnail-N.png` ordinal variants — they're whole
        // finished thumbnails, not building-block assets.
        const isSmThumb = (p: string) => /(?:^|[\\/])[^\\/]*_sm-thumbnail(?:-\d+)?\.png$/i.test(p)
        const toGroup = (s: typeof cur): SeasonAssetGroup => ({
          folderPath: s.folderPath,
          date: s.date,
          episode: s.meta?.ytEpisode,
          title: renderStreamTitle(s, all),
          images: (s.thumbnails ?? []).filter(p => !isSmThumb(p)),
        })
        setSeasonAssets({
          current: toGroup(cur),
          related: related.map(toGroup),
        })
      } catch {
        if (!cancelled && myToken === token) setSeasonAssets(null)
      }
    }

    load()
    // Debounced: streams:changed arrives in bursts and load() runs a full
    // listStreams, so coalesce them instead of re-scanning per event.
    let timer: ReturnType<typeof setTimeout> | null = null
    const unsubscribe = window.api.onStreamsChanged(() => {
      if (timer) clearTimeout(timer)
      timer = setTimeout(() => load(), 400)
    })
    return () => {
      cancelled = true
      if (timer) clearTimeout(timer)
      unsubscribe()
    }
  }, [currentStream, config.streamsDir, config.streamMode, config.thumbnailAssetsFromSeason, config.thumbnailAssetsFromTopicGame, assetRefreshTrigger])

  const dragStartPosRef = useRef<{ x: number; y: number } | null>(null)
  // {id → starting Konva-space (x, y)} for every OTHER node in the current
  // multi-selection at drag-start time. Empty when not multi-dragging.
  // Konva's node.x()/.y() is the correct coordinate to snapshot regardless
  // of layer type — for centered shapes that's the center, but the delta
  // we apply on drag-move is the same in either coordinate space.
  const multiDragStartRef = useRef<Map<string, { x: number; y: number }>>(new Map())
  // The node the user actually grabbed. Since Konva 8.3, a Transformer with
  // multiple nodes attached MIRRORS a drag onto every attached node — and
  // each mirrored node fires its own dragstart/dragmove/dragend. A 4-layer
  // group drag therefore arrives as 4 interleaved event streams; handling
  // each as its own gesture was the root of every undo corruption here
  // (N commits per drag, N-1 of them half-states from a stale base). All
  // drag handlers act only on the primary's events. First dragstart wins:
  // the grabbed node's handlers were registered at mount, before the
  // Transformer attached its mirror listeners, so its dragstart is always
  // delivered first.
  const primaryDragIdRef = useRef<string | null>(null)
  const dragEndFlushScheduledRef = useRef(false)

  const handleDragStart = useCallback((e: Konva.KonvaEventObject<DragEvent>) => {
    if (primaryDragIdRef.current !== null) return // Transformer mirror — not a new gesture
    const target = e.target
    primaryDragIdRef.current = target.id()
    dragStartPosRef.current = { x: target.x(), y: target.y() }
    multiDragStartRef.current.clear()
    const sel = selectedIdsRef.current
    if (sel.length > 1 && sel.includes(target.id()) && stageRef.current) {
      for (const id of sel) {
        if (id === target.id()) continue
        const node = stageRef.current.findOne(`#${id}`)
        if (node) multiDragStartRef.current.set(id, { x: node.x(), y: node.y() })
      }
    }
  }, [])

  const handleSnapDragMove = useCallback((e: Konva.KonvaEventObject<DragEvent>) => {
    if (!stageRef.current || !guideLayerRef.current) return
    const node = e.target
    // Mirrored drag events do nothing — the primary's handler positions the
    // whole group rigidly, and per-node handling would snap each layer
    // individually (the old "some layers stick to snap points" bug).
    if (primaryDragIdRef.current !== null && node.id() !== primaryDragIdRef.current) return

    // Axis constraint: Shift locks movement to the dominant axis from drag start
    if (e.evt.shiftKey && dragStartPosRef.current) {
      const dx = Math.abs(node.x() - dragStartPosRef.current.x)
      const dy = Math.abs(node.y() - dragStartPosRef.current.y)
      if (dx >= dy) node.y(dragStartPosRef.current.y)
      else node.x(dragStartPosRef.current.x)
    }

    if (smartSnapEnabled || gridSnapEnabled) {
      // Exclude the whole selection from snap stops, not just the dragged
      // node — its companions are moving with it (see getSnapResult).
      const exclude = new Set(selectedIdsRef.current)
      exclude.add(node.id())
      const snap = getSnapResult(node, stageRef.current, smartSnapEnabled, gridSnapEnabled, exclude)
      if (snap.x !== undefined) node.x(snap.x)
      if (snap.y !== undefined) node.y(snap.y)
      renderSnapGuides(snap.guides, guideLayerRef.current, viewZoomRef.current)
    }

    // Multi-drag: shift the other selected nodes by the same delta the
    // dragged node has moved (post-snap so they stay aligned to whatever
    // the snap settled on).
    if (multiDragStartRef.current.size > 0 && dragStartPosRef.current) {
      const stage = stageRef.current
      const dx = node.x() - dragStartPosRef.current.x
      const dy = node.y() - dragStartPosRef.current.y
      multiDragStartRef.current.forEach((start, id) => {
        const other = stage.findOne(`#${id}`)
        if (other) {
          other.x(start.x + dx)
          other.y(start.y + dy)
        }
      })
    }
  }, [smartSnapEnabled, gridSnapEnabled])

  const handleSnapTransformBoundBox = useCallback((oldBox: KonvaBox, newBox: KonvaBox): KonvaBox => {
    if (!stageRef.current || !guideLayerRef.current) return newBox
    if (!smartSnapEnabled && !gridSnapEnabled) return newBox

    const stage = stageRef.current
    const excluded = selectedIdsRef.current
    const zoom = viewZoomRef.current
    const pan = viewPanRef.current
    const guides: SnapGuide[] = []

    // boundBoxFunc boxes are in absolute/screen coordinates (include stage zoom+pan).
    // All snap logic uses canvas coordinates (0–CANVAS_W, 0–CANVAS_H), so convert first.
    const toCanvas = (b: KonvaBox): KonvaBox => ({
      x: (b.x - pan.x) / zoom,
      y: (b.y - pan.y) / zoom,
      width: b.width / zoom,
      height: b.height / zoom,
      rotation: b.rotation,
    })
    const toScreen = (b: KonvaBox): KonvaBox => ({
      x: b.x * zoom + pan.x,
      y: b.y * zoom + pan.y,
      width: b.width * zoom,
      height: b.height * zoom,
      rotation: b.rotation,
    })

    const cOld = toCanvas(oldBox)
    const cNew = toCanvas(newBox)
    const result = { ...cNew }

    // Determine which edges are moving (larger delta = that side is being dragged)
    const leftDelta = Math.abs(cNew.x - cOld.x)
    const rightDelta = Math.abs((cNew.x + cNew.width) - (cOld.x + cOld.width))
    const topDelta = Math.abs(cNew.y - cOld.y)
    const botDelta = Math.abs((cNew.y + cNew.height) - (cOld.y + cOld.height))
    const leftMoving = leftDelta > rightDelta
    const topMoving = topDelta > botDelta

    if (smartSnapEnabled) {
      const vStops: number[] = [0, CANVAS_W / 2, CANVAS_W]
      const hStops: number[] = [0, CANVAS_H / 2, CANVAS_H]
      // getClientRect({ relativeTo: stage }) returns canvas-space coords — matches our stops
      stage.find('.snap-target').forEach((other: Konva.Node) => {
        if (excluded.includes(other.id())) return
        const b = other.getClientRect({ relativeTo: stage })
        vStops.push(b.x, b.x + b.width / 2, b.x + b.width)
        hStops.push(b.y, b.y + b.height / 2, b.y + b.height)
      })

      const movingVEdge = leftMoving ? result.x : result.x + result.width
      const movingHEdge = topMoving ? result.y : result.y + result.height

      let bestVDist = SNAP_THRESHOLD + 1, bestVStop: number | undefined
      for (const stop of vStops) {
        const d = Math.abs(movingVEdge - stop)
        if (d < bestVDist) { bestVDist = d; bestVStop = stop }
      }
      if (bestVDist <= SNAP_THRESHOLD && bestVStop !== undefined) {
        const delta = bestVStop - movingVEdge
        if (leftMoving) { result.x += delta; result.width -= delta }
        else { result.width += delta }
        guides.push({ lineGuide: bestVStop, orientation: 'V' })
      }

      let bestHDist = SNAP_THRESHOLD + 1, bestHStop: number | undefined
      for (const stop of hStops) {
        const d = Math.abs(movingHEdge - stop)
        if (d < bestHDist) { bestHDist = d; bestHStop = stop }
      }
      if (bestHDist <= SNAP_THRESHOLD && bestHStop !== undefined) {
        const delta = bestHStop - movingHEdge
        if (topMoving) { result.y += delta; result.height -= delta }
        else { result.height += delta }
        guides.push({ lineGuide: bestHStop, orientation: 'H' })
      }
    } else if (gridSnapEnabled) {
      // Grid snap: snap the moving edge to the nearest grid line (canvas coords)
      const rightEdge = result.x + result.width
      const botEdge = result.y + result.height
      if (leftMoving) {
        result.x = snapGrid(result.x)
        result.width = Math.max(GRID_SIZE, rightEdge - result.x)
      } else {
        result.width = Math.max(GRID_SIZE, snapGrid(rightEdge) - result.x)
      }
      if (topMoving) {
        result.y = snapGrid(result.y)
        result.height = Math.max(GRID_SIZE, botEdge - result.y)
      } else {
        result.height = Math.max(GRID_SIZE, snapGrid(botEdge) - result.y)
      }
    }

    renderSnapGuides(guides, guideLayerRef.current!, zoom)
    return toScreen(result)
  }, [smartSnapEnabled, gridSnapEnabled])

  // Snap variant for ratio-locked resizes. The plain snapper above moves the
  // vertical and horizontal edges independently, which breaks a locked aspect
  // ratio the instant one edge lands on a stop (e.g. dragging a side handle
  // until the derived edge touches the canvas boundary). Here the whole box is
  // a function of a single scale `s` about a fixed anchor, so it stays exactly
  // ratio-correct: we find the scale that lands the nearest in-threshold edge
  // on its stop, otherwise follow the cursor. Because the in-threshold test is
  // evaluated at the *cursor* scale, the box "freezes" at the snapped size
  // while the cursor lingers near the stop and jumps free once it drags past —
  // matching a normal snap's feel without ever distorting the ratio.
  const handleRatioLockedSnap = useCallback((
    oldBox: KonvaBox,
    cursorBox: KonvaBox,
    hAnchor: 'left' | 'right' | 'center',
    vAnchor: 'top' | 'bottom' | 'center',
  ): KonvaBox => {
    const stage = stageRef.current
    const guideLayer = guideLayerRef.current
    if (!stage || !guideLayer || oldBox.width <= 0 || oldBox.height <= 0) return cursorBox

    const zoom = viewZoomRef.current
    const pan = viewPanRef.current
    const excluded = selectedIdsRef.current

    // Work in canvas space (stops are canvas coords). Scale is dimensionless,
    // so it transfers between screen + canvas untouched.
    const O = {
      x: (oldBox.x - pan.x) / zoom,
      y: (oldBox.y - pan.y) / zoom,
      w: oldBox.width / zoom,
      h: oldBox.height / zoom,
    }
    const sCursor = cursorBox.width / oldBox.width

    // Ratio-locked box at scale s, anchored per hAnchor/vAnchor. Using O.w/O.h
    // directly preserves the layer's exact current ratio.
    const boxAt = (s: number) => {
      const w = O.w * s, h = O.h * s
      const x = hAnchor === 'left' ? O.x
        : hAnchor === 'right' ? O.x + O.w - w
        : O.x + O.w / 2 - w / 2
      const y = vAnchor === 'top' ? O.y
        : vAnchor === 'bottom' ? O.y + O.h - h
        : O.y + O.h / 2 - h / 2
      return { x, y, w, h }
    }

    const vStops: number[] = [0, CANVAS_W / 2, CANVAS_W]
    const hStops: number[] = [0, CANVAS_H / 2, CANVAS_H]
    stage.find('.snap-target').forEach((other: Konva.Node) => {
      if (excluded.includes(other.id())) return
      const b = other.getClientRect({ relativeTo: stage })
      vStops.push(b.x, b.x + b.width / 2, b.x + b.width)
      hStops.push(b.y, b.y + b.height / 2, b.y + b.height)
    })

    // Each moving edge is linear in s: pos(s) = pos(sCursor) + B·(s − sCursor).
    // Anchored edges have B = 0 and never snap. We collect every in-threshold
    // (edge, stop) pair and keep the closest — solving for the scale that puts
    // that edge exactly on its stop.
    const cur = boxAt(sCursor)
    const cands: { s: number; dist: number; guide: SnapGuide }[] = []
    const consider = (posCursor: number, B: number, stops: number[], orientation: 'V' | 'H') => {
      if (Math.abs(B) < 1e-6) return
      for (const stop of stops) {
        const dist = Math.abs(posCursor - stop)
        if (dist > SNAP_THRESHOLD) continue
        cands.push({ s: sCursor + (stop - posCursor) / B, dist, guide: { lineGuide: stop, orientation } })
      }
    }
    // Vertical guide lines (left/right edges) per horizontal anchor.
    if (hAnchor === 'left') consider(cur.x + cur.w, O.w, vStops, 'V')
    else if (hAnchor === 'right') consider(cur.x, -O.w, vStops, 'V')
    else { consider(cur.x, -O.w / 2, vStops, 'V'); consider(cur.x + cur.w, O.w / 2, vStops, 'V') }
    // Horizontal guide lines (top/bottom edges) per vertical anchor.
    if (vAnchor === 'top') consider(cur.y + cur.h, O.h, hStops, 'H')
    else if (vAnchor === 'bottom') consider(cur.y, -O.h, hStops, 'H')
    else { consider(cur.y, -O.h / 2, hStops, 'H'); consider(cur.y + cur.h, O.h / 2, hStops, 'H') }

    let s = sCursor
    const guides: SnapGuide[] = []
    if (cands.length > 0) {
      cands.sort((a, b) => a.dist - b.dist)
      s = cands[0].s
      guides.push(cands[0].guide)
    }
    // Min size: keep both dimensions ≥ ~10 screen px.
    const minS = (10 / zoom) / Math.min(O.w, O.h)
    if (s < minS) s = minS

    const r = boxAt(s)
    renderSnapGuides(guides, guideLayer, zoom)
    return {
      x: r.x * zoom + pan.x,
      y: r.y * zoom + pan.y,
      width: r.w * zoom,
      height: r.h * zoom,
      rotation: oldBox.rotation,
    }
  }, [smartSnapEnabled])

  const clearSnapGuides = useCallback(() => {
    if (!guideLayerRef.current) return
    guideLayerRef.current.destroyChildren()
    guideLayerRef.current.batchDraw()
  }, [])

  // ── System fonts ─────────────────────────────────────────────────────────
  const [systemFonts, setSystemFonts] = useState<string[]>(['Arial', 'Georgia', 'Impact', 'Times New Roman', 'Verdana'])
  const [fontVariantMap, setFontVariantMap] = useState<Record<string, { name: string; css: string }[]>>({})
  // True once queryLocalFonts returned a real list. Missing-font detection is
  // OFF until then — checking against the 5-name seed list above would flag
  // nearly every font as missing during startup (or forever, when the local
  // font access API is unavailable/denied — in that case we can't tell, so
  // we don't warn).
  const [fontsLoaded, setFontsLoaded] = useState(false)
  const installedFontSet = useMemo(() => new Set(systemFonts), [systemFonts])
  // Families used by text layers that aren't installed. While non-empty, the
  // autosave keeps writing canvas.json (edits stay safe) but WITHHOLDS the
  // PNG — rendering would bake a substitute font into the exported image.
  const missingFonts = useMemo(
    () => (fontsLoaded ? collectMissingFonts(layers, installedFontSet) : []),
    [fontsLoaded, layers, installedFontSet],
  )

  // ── Auto-save timer ───────────────────────────────────────────────────────
  const autoSaveTimer = useRef<ReturnType<typeof setTimeout> | null>(null)
  // Monotonic id for "which canvas session is mounted" — bumped whenever the
  // editor's content identity changes (open / variant switch / delete /
  // close). doSave captures it at entry and aborts after its awaits if it
  // changed: the capture reads the LIVE shared stage, so a save started for
  // stream A must never screenshot whatever replaced it (that wrote B's
  // pixels as A's PNG — a persistent JSON/PNG desync).
  const saveEpochRef = useRef(0)
  // The save currently running, if any. Close/switch/open await it so a
  // session is never retired with a write still in flight.
  const pendingSaveRef = useRef<Promise<void> | null>(null)
  const [closingSession, setClosingSession] = useState(false)
  const [confirmCloseTemplate, setConfirmCloseTemplate] = useState(false)

  // ─── Load system fonts + variants ─────────────────────────────────────────
  useEffect(() => {
    if (!(window as any).queryLocalFonts) return
    ;(window as any).queryLocalFonts().then((fonts: any[]) => {
      const names = Array.from(new Set(fonts.map((f: any) => f.family as string))).sort()
      if (names.length > 0) {
        setSystemFonts(names)
        setFontsLoaded(true)
      }

      // Build per-family variant list
      const variantMap: Record<string, { name: string; css: string }[]> = {}
      for (const font of fonts) {
        const family = font.family as string
        const styleName = font.style as string
        if (!variantMap[family]) variantMap[family] = []
        const css = styleNameToCSSFont(styleName)
        if (!variantMap[family].some(v => v.name === styleName)) {
          variantMap[family].push({ name: styleName, css })
        }
      }
      // Sort each family's variants by weight then italic
      for (const fam of Object.keys(variantMap)) {
        variantMap[fam].sort((a, b) => {
          const wa = cssToWeight(a.css), wb = cssToWeight(b.css)
          if (wa !== wb) return wa - wb
          return (a.css.includes('italic') ? 1 : 0) - (b.css.includes('italic') ? 1 : 0)
        })
      }
      setFontVariantMap(variantMap)
    }).catch(() => {})
  }, [])

  // ── Load overview data once per config ────────────────────────────────────
  // ThumbnailPage stays mounted across navigation (App renders it always,
  // toggling `isVisible`), so its templates/recents state persists. Loading on
  // every visibility flip re-fetched and flashed the loading state each visit.
  // Templates/recents are kept current in-memory by the save/delete handlers,
  // so we load once per (streamsDir, streamMode) and skip on subsequent visits;
  // a config change resets the key and triggers a fresh load.
  const overviewLoadedKeyRef = useRef<string | null>(null)
  useEffect(() => {
    if (!isVisible || !config.streamsDir) return
    const key = `${config.streamsDir}${config.streamMode || 'folder-per-stream'}`
    if (overviewLoadedKeyRef.current === key) return
    overviewLoadedKeyRef.current = key
    setOverviewLoading(true)
    Promise.all([
      window.api.thumbnailListTemplates(config.streamsDir),
      window.api.thumbnailGetRecents(),
      window.api.listStreams(config.streamsDir, config.streamMode || 'folder-per-stream'),
    ]).then(async ([tmpl, rec, allStreams]) => {
      setTemplates(tmpl)

      // Filter out recents with NO canvas variant left on disk. Checked via
      // the variant listing, not a hardcoded variant-1 filename — a stream
      // whose only thumbnail is variant 2+ was being pruned (and persisted
      // as removed) despite having a perfectly healthy canvas.
      // The same listing also yields the variant COUNT, shown in the row's
      // subtitle ("2 thumbnails") — no extra round-trip.
      const variantCounts = await Promise.all(
        rec.map(r => window.api.thumbnailListVariants(r.folderPath, r.date)
          .then(v => v.length)
          .catch(() => 0))
      )
      const stale = rec.filter((_, i) => variantCounts[i] === 0)

      // Persist removals so they don't reappear next time
      await Promise.allSettled(
        stale.map(r => window.api.thumbnailRemoveRecent(r.folderPath, r.date))
      )

      // Re-render each recent's title from live stream metadata. The stored
      // title is just a snapshot (and older entries stored the raw template
      // body), so resolving against the current folder keeps the list in
      // sync with renames + renders {merge fields} properly.
      const byPath = new Map(allStreams.map(s => [s.folderPath, s]))
      const valid = rec
        .map((r, i) => ({ r, count: variantCounts[i] }))
        .filter(({ count }) => count > 0)
        .map(({ r, count }) => {
          const f = byPath.get(r.folderPath)
          return { ...(f ? { ...r, title: renderStreamTitle(f, allStreams) } : r), variantCount: count }
        })

      setRecents(valid)
    }).catch(() => {}).finally(() => setOverviewLoading(false))
  }, [isVisible, config.streamsDir, config.streamMode])

  // ── Handle pending stream navigation ─────────────────────────────────────
  useEffect(() => {
    if (!pendingStream || !isVisible) return
    openStreamEditor(pendingStream.folderPath, pendingStream.date, pendingStream.title, pendingStream.meta, pendingStream.totalEpisodes, pendingStream.variantOrdinal)
    clearPendingStream()
  }, [pendingStream, isVisible])

  // ── Publish editor-open signal to App.tsx's nav activity bus ─────────────
  // "Has a canvas open" = the editor is in editor mode AND there's a stream
  // bound to the canvas. Overview mode (template gallery) doesn't count —
  // the user isn't actively editing anything specific then.
  useEffect(() => {
    setThumbnailHasCanvas(mode === 'editor' && currentStream !== null)
  }, [mode, currentStream, setThumbnailHasCanvas])

  // ── Fit scale + container size ────────────────────────────────────────────
  useEffect(() => {
    if (mode !== 'editor') return
    const el = canvasContainerRef.current
    if (!el) return
    const update = () => {
      const { width, height } = el.getBoundingClientRect()
      // Skip when the container has no measurable size — happens whenever
      // ThumbnailPage is hidden via App.tsx's `display: none` wrapper while
      // the user is on a different page. ResizeObserver fires the moment
      // visibility flips; if we propagated 0×0 down to the Konva Stage, its
      // backing canvas resizes to 0×0 and the next layer draw (filter
      // cache, batchDraw, anything) throws "drawImage on 0-sized canvas",
      // which surfaces under the visible page's error boundary even though
      // the user's nowhere near the editor. Keeping the previous (valid)
      // size means the editor reopens to the same scroll/zoom state.
      if (width === 0 || height === 0) return
      const padding = 32
      const fs = Math.max(0.05, Math.min((width - padding) / CANVAS_W, (height - padding) / CANVAS_H))
      const cw = width, ch = height
      const prevFit = fitScaleRef.current
      fitScaleRef.current = fs
      containerSizeRef.current = { w: cw, h: ch }
      setContainerSize({ w: cw, h: ch })
      setFitScale(fs)
      // If currently at fit zoom (or first mount), track fit
      setViewZoom(prev => {
        const next = Math.abs(prev - prevFit) < 0.001 ? fs : prev
        viewZoomRef.current = next
        // Center on the very first measurement (replaces the auto-center
        // that lived inside the old clampCanvasPan). Subsequent resizes
        // just re-clamp the existing pan so user-chosen offsets persist.
        const pan = hasInitializedPanRef.current
          ? clampCanvasPan(viewPanRef.current.x, viewPanRef.current.y, next, cw, ch)
          : centeredCanvasPan(next, cw, ch)
        hasInitializedPanRef.current = true
        viewPanRef.current = pan
        setViewPan(pan)
        return next
      })
    }
    update()
    const ro = new ResizeObserver(update)
    ro.observe(el)
    return () => ro.disconnect()
  }, [mode])

  // ── Wheel zoom + middle-click pan ─────────────────────────────────────────
  useEffect(() => {
    if (mode !== 'editor') return
    const el = canvasContainerRef.current
    if (!el) return

    const onWheel = (e: WheelEvent) => {
      e.preventDefault()
      const rect = el.getBoundingClientRect()
      const mx = e.clientX - rect.left
      const my = e.clientY - rect.top
      const factor = e.deltaY < 0 ? 1.12 : 1 / 1.12
      const fs = fitScaleRef.current
      const { w: cw, h: ch } = containerSizeRef.current
      let newZoom = viewZoomRef.current * factor
      newZoom = Math.max(fs * 0.1, Math.min(16, newZoom))
      newZoom = applyZoomSnap(newZoom, fs)
      const canvasX = (mx - viewPanRef.current.x) / viewZoomRef.current
      const canvasY = (my - viewPanRef.current.y) / viewZoomRef.current
      const pan = clampCanvasPan(mx - canvasX * newZoom, my - canvasY * newZoom, newZoom, cw, ch)
      viewZoomRef.current = newZoom
      viewPanRef.current = pan
      setViewZoom(newZoom)
      setViewPan(pan)
    }

    const onMouseDown = (e: MouseEvent) => {
      if (e.button !== 1) return
      e.preventDefault()
      const now = Date.now()
      if (now - lastMiddleClickRef.current < 300) {
        // Double middle-click: reset to fit + recenter.
        lastMiddleClickRef.current = 0
        const fs = fitScaleRef.current
        const { w: cw, h: ch } = containerSizeRef.current
        const pan = centeredCanvasPan(fs, cw, ch)
        viewZoomRef.current = fs
        viewPanRef.current = pan
        setViewZoom(fs)
        setViewPan(pan)
        isPanningRef.current = false
        setIsPanning(false)
        return
      }
      lastMiddleClickRef.current = now
      isPanningRef.current = true
      setIsPanning(true)
      panStartRef.current = { x: e.clientX, y: e.clientY, panX: viewPanRef.current.x, panY: viewPanRef.current.y }
    }

    const onMouseMove = (e: MouseEvent) => {
      if (!isPanningRef.current) return
      const dx = e.clientX - panStartRef.current.x
      const dy = e.clientY - panStartRef.current.y
      const { w: cw, h: ch } = containerSizeRef.current
      const pan = clampCanvasPan(panStartRef.current.panX + dx, panStartRef.current.panY + dy, viewZoomRef.current, cw, ch)
      viewPanRef.current = pan
      setViewPan(pan)
    }

    const onMouseUp = (e: MouseEvent) => {
      if (e.button !== 1) return
      isPanningRef.current = false
      setIsPanning(false)
    }

    el.addEventListener('wheel', onWheel, { passive: false })
    el.addEventListener('mousedown', onMouseDown)
    window.addEventListener('mousemove', onMouseMove)
    window.addEventListener('mouseup', onMouseUp)
    return () => {
      el.removeEventListener('wheel', onWheel)
      el.removeEventListener('mousedown', onMouseDown)
      window.removeEventListener('mousemove', onMouseMove)
      window.removeEventListener('mouseup', onMouseUp)
    }
  }, [mode])

  // ── Auto-save ─────────────────────────────────────────────────────────────
  const triggerAutoSave = useCallback((newLayers: ThumbnailLayer[]) => {
    if (!currentStream) {
      // No stream — mark dirty so "Update template" button activates, but don't auto-save
      if (currentTemplateId) setIsDirty(true)
      return
    }
    setIsDirty(true)
    if (autoSaveTimer.current) clearTimeout(autoSaveTimer.current)
    autoSaveTimer.current = setTimeout(() => {
      doSave(newLayers, currentStream.folderPath, currentStream.date, currentTemplateId, currentVariant)
    }, 500)
  }, [currentStream, currentTemplateId, currentVariant])
  // Expose the latest triggerAutoSave to the undo/redo hook via the
  // construction-time ref. `doSave` and the unwritten currentStream/
  // currentTemplateId are captured via closure inside triggerAutoSave, so
  // pointing the ref at the callback is enough.
  useEffect(() => { triggerAutoSaveRef.current = triggerAutoSave }, [triggerAutoSave])

  // Image layers load their bitmaps asynchronously (via `useImage`), so
  // capturing the stage before they resolve renders the PNG with assets
  // missing. This is most visible when a render is triggered programmatically
  // right after the editor opens (the self-heal regenerate path) — the user
  // never gets a chance to wait. Block any capture until every Konva image
  // node on the stage actually has its bitmap. Bounded by a timeout so a
  // permanently-broken/missing asset can't hang the save forever.
  const waitForStageImages = useCallback(async (timeoutMs = 5000): Promise<void> => {
    const stage = stageRef.current
    if (!stage) return
    const start = Date.now()
    const pending = () => stage.find('Image').filter(node => {
      const im = (node as Konva.Image).image()
      if (!im) return true
      return im instanceof HTMLImageElement && (!im.complete || im.naturalWidth === 0)
    })
    while (pending().length > 0 && Date.now() - start < timeoutMs) {
      await new Promise<void>(r => requestAnimationFrame(() => r()))
    }
  }, [])

  // Decode every image asset a set of layers references, up front. Polling the
  // konva nodes alone is unreliable right after open — a node may not be
  // mounted yet (so nothing reads as "pending") or `useImage` may not have
  // started. Decoding the files directly both warms the browser cache (so the
  // nodes' own loads resolve fast) and forces a real wait on the bytes.
  // Resolves on error/missing so a broken asset can't hang the save.
  const preloadLayerImages = useCallback(async (layersToLoad: ThumbnailLayer[]): Promise<void> => {
    const srcs = Array.from(new Set(
      layersToLoad
        .filter(l => l.type === 'image' && l.src)
        .map(l => `file://${l.src}`)
    ))
    await Promise.all(srcs.map(src => {
      const img = new Image()
      img.src = src
      return img.decode().catch(() => {})
    }))
  }, [])

  // Export the canvas at full 1:1 resolution regardless of current view
  const getCanvasDataUrl = useCallback((): string => {
    const stage = stageRef.current
    if (!stage) return ''
    bgLayerRef.current?.hide()
    guideLayerRef.current?.hide()
    matteLayerRef.current?.hide()
    // Hide selection handles so they don't appear in the saved image
    const transformers = stage.find('Transformer')
    transformers.forEach(t => t.hide())
    const prevX = stage.x(), prevY = stage.y()
    const prevSX = stage.scaleX(), prevSY = stage.scaleY()
    const prevW = stage.width(), prevH = stage.height()
    stage.x(0); stage.y(0); stage.scaleX(1); stage.scaleY(1)
    stage.width(CANVAS_W); stage.height(CANVAS_H)
    const dataUrl = stage.toDataURL({ pixelRatio: 1 })
    stage.x(prevX); stage.y(prevY); stage.scaleX(prevSX); stage.scaleY(prevSY)
    stage.width(prevW); stage.height(prevH)
    transformers.forEach(t => t.show())
    bgLayerRef.current?.show()
    guideLayerRef.current?.show()
    matteLayerRef.current?.show()
    return dataUrl
  }, [])

  const doSave = useCallback(async (
    saveLayers: ThumbnailLayer[],
    folderPath: string,
    date: string,
    templateId: string | undefined,
    ordinal: number,
    // One-shot bypass of the missing-font PNG pause — the banner's
    // "Manually export anyway" button. The user has seen the warning and
    // explicitly chose to bake the substitute font into the image.
    forcePng = false,
  ) => {
    if (!stageRef.current) return
    const epoch = saveEpochRef.current
    const run = (async () => {
      const canvasFile: ThumbnailCanvasFile = {
        version: 1,
        templateId,
        updatedAt: Date.now(),
        layers: saveLayers,
      }
      // Missing font → save the layer JSON only and leave the last good PNG
      // on disk. Rendering now would silently bake a substitute font into
      // the image (the banner in the editor tells the user this is paused).
      const withholdPng = !forcePng && fontsLoaded && collectMissingFonts(saveLayers, installedFontSet).length > 0
      if (!withholdPng) {
        await preloadLayerImages(saveLayers)
        await waitForStageImages()
      }
      // The stage is shared. If another stream/variant mounted while the
      // image waits ran (up to 5s with a broken asset), its pixels are on
      // the stage now — abort instead of writing them under OUR json.
      // Whoever replaced the session flushed us first, so nothing is lost.
      if (saveEpochRef.current !== epoch || !stageRef.current) return
      const pngDataUrl = withholdPng ? null : getCanvasDataUrl()
      try {
        await window.api.thumbnailSaveCanvas(folderPath, date, canvasFile, pngDataUrl, ordinal)
        // Merge only the thumbnail flags — prevents closure-stale `currentStream.meta` from
        // clobbering fields edited concurrently in other UI (e.g. MetaModal).
        // When the PNG was withheld, only refresh the flag if it was already
        // set — a brand-new session with a missing font has no image yet,
        // and claiming one would break the stream list's preview.
        if (pngDataUrl != null || currentStream?.meta?.smThumbnail) {
          await window.api.updateStreamMeta(folderPath, {
            smThumbnail: true,
            smThumbnailTemplate: templateId,
          }, streamMetaKey(folderPath, date, config.streamsDir))
        }
        if (saveEpochRef.current === epoch) setIsDirty(false)
        // Bump the variant-preview cache buster so the switcher dropdown
        // shows the fresh PNG for whichever variant we just wrote.
        if (pngDataUrl != null) setVariantPreviewKey(k => k + 1)
      } catch (err) {
        console.error('Auto-save failed:', err)
      }
    })()
    pendingSaveRef.current = run
    try {
      await run
    } finally {
      if (pendingSaveRef.current === run) pendingSaveRef.current = null
    }
  }, [getCanvasDataUrl, waitForStageImages, preloadLayerImages, currentStream, fontsLoaded, installedFontSet])

  // Flush everything the autosave owes: turn a pending debounce into an
  // immediate save, then await whatever save is in flight. Session-retiring
  // callers (close, open, variant switch) run this BEFORE bumping the epoch.
  const flushStreamSaves = useCallback(async () => {
    if (autoSaveTimer.current) { clearTimeout(autoSaveTimer.current); autoSaveTimer.current = null }
    if (currentStream && isDirty) {
      await doSave(layers, currentStream.folderPath, currentStream.date, currentTemplateId, currentVariant)
    }
    await pendingSaveRef.current
  }, [currentStream, isDirty, layers, currentTemplateId, currentVariant, doSave])

  // Banner escape hatch: write the thumbnail PNG once despite missing fonts
  // (substitute font and all). Autosave stays paused for later edits.
  const [forceExporting, setForceExporting] = useState(false)
  const forcePngExportOnce = useCallback(async () => {
    if (!currentStream) return
    setForceExporting(true)
    try {
      await doSave(layers, currentStream.folderPath, currentStream.date, currentTemplateId, currentVariant, true)
    } finally {
      setForceExporting(false)
    }
  }, [currentStream, layers, currentTemplateId, currentVariant, doSave])

  // ── Layer mutations ────────────────────────────────────────────────────────
  const commitLayers = useCallback((next: ThumbnailLayer[]) => {
    commit(next)
    triggerAutoSave(next)
  }, [commit, triggerAutoSave])

  const updateLayer = useCallback((updated: ThumbnailLayer) => {
    const next = layers.map(l => l.id === updated.id ? updated : l)
    commitLayers(next)
  }, [layers, commitLayers])

  // Live (no-history) sibling of updateLayer — applies the change + autosaves
  // but does NOT push an undo entry. Used for gesture continuations (a
  // color-picker drag after the first committed change) so one gesture = one
  // undo entry. See useCommitOnRelease / PropertiesPanel.update.
  const liveUpdateLayer = useCallback((updated: ThumbnailLayer) => {
    const next = layers.map(l => l.id === updated.id ? updated : l)
    setLayersDirect(next)
    triggerAutoSave(next)
  }, [layers, setLayersDirect, triggerAutoSave])

  /** Commits the drag's final position(s). One commit = one undo entry,
   *  whether single-drag or multi-drag. The Transformer mirrors dragend to
   *  every attached node, so this fires N times per group drag — mirrored
   *  events are ignored and the real work runs ONCE via microtask (same
   *  pattern as handleTransformEnd). */
  const handleDragEnd = useCallback((e: Konva.KonvaEventObject<DragEvent>) => {
    if (primaryDragIdRef.current !== null && e.target.id() !== primaryDragIdRef.current) return
    if (dragEndFlushScheduledRef.current) return
    dragEndFlushScheduledRef.current = true
    queueMicrotask(() => {
      dragEndFlushScheduledRef.current = false
      const stage = stageRef.current
      const primaryId = primaryDragIdRef.current
      const startPos = dragStartPosRef.current
      const companions = multiDragStartRef.current
      primaryDragIdRef.current = null
      dragStartPosRef.current = null
      multiDragStartRef.current = new Map()
      if (!stage || !primaryId) return
      const primaryNode = stage.findOne(`#${primaryId}`)
      if (!primaryNode) return

      // Rigid-group math: the primary's live position is authoritative
      // (it carries the snap), and companions commit at their snapshot
      // plus the primary's total delta — NOT their live node positions,
      // which the Transformer's native mirroring may have left at the
      // UNSNAPPED delta (a few px off the snapped group).
      const px = primaryNode.x(), py = primaryNode.y()
      const dx = startPos ? px - startPos.x : 0
      const dy = startPos ? py - startPos.y : 0
      const positions = new Map<string, { x: number; y: number }>()
      positions.set(primaryId, { x: px, y: py })
      companions.forEach((start, id) => positions.set(id, { x: start.x + dx, y: start.y + dy }))

      // Group wrappers around every layer mean node.x/y is the layer's
      // top-left in every case — including centered shapes (the center
      // offset lives on the inner Konva element, inside the Group).
      // layersRef (not the render closure) so the base can never be stale
      // relative to a commit that landed earlier in this same tick.
      const next = layersRef.current.map(l => {
        const np = positions.get(l.id)
        if (!np) return l
        return { ...l, x: np.x, y: np.y }
      })
      commitLayers(next)
      // Stamp the nodes to the committed values: react-konva's diff won't
      // reapply a prop that didn't change, and the mirrored drag may have
      // left a node at a not-quite-committed position.
      positions.forEach((p, id) => {
        const n = stage.findOne(`#${id}`)
        if (n) { n.x(p.x); n.y(p.y) }
      })
      stage.batchDraw()
    })
  }, [commitLayers])

  // Arrow-key nudge of the selection — 1px per press, 10px with Shift. A burst
  // of presses collapses into a single undo entry via useCommitOnRelease; the
  // first press commits to history, continuations apply live. layersRef gives a
  // fresh base so rapid auto-repeat accumulates instead of fighting a stale
  // closure.
  const beginsNudge = useCommitOnRelease()
  const nudgeSelected = useCallback((dx: number, dy: number) => {
    const sel = selectedIdsRef.current
    if (sel.length === 0) return
    const next = layersRef.current.map(l =>
      sel.includes(l.id) ? { ...l, x: l.x + dx, y: l.y + dy } : l
    )
    layersRef.current = next
    if (beginsNudge('nudge')) commitLayers(next)
    else { setLayersDirect(next); triggerAutoSave(next) }
  }, [beginsNudge, commitLayers, setLayersDirect, triggerAutoSave])

  /** Commits the transform's final state for every node the shared
   *  Transformer touched. Konva fires `transformend` per node; we accumulate
   *  in a Map and flush once via microtask so a group transform = one undo
   *  entry. After commit, scaleX/scaleY are reset on each node since the
   *  scale factors have already been baked into width/height. */
  const handleTransformEnd = useCallback((e: Konva.KonvaEventObject<Event>) => {
    // Gesture done — drop the captured start box so the next resize
    // re-captures its own baseline on its first boundBoxFunc frame.
    resizeStartBoxRef.current = null
    pendingTransformsRef.current.set(e.target.id(), e.target)
    if (commitTransformScheduledRef.current) return
    commitTransformScheduledRef.current = true
    queueMicrotask(() => {
      commitTransformScheduledRef.current = false
      const nodeMap = pendingTransformsRef.current
      pendingTransformsRef.current = new Map()

      const next = layers.map(l => {
        const node = nodeMap.get(l.id)
        if (!node) return l
        // The Transformer attaches to the Group wrapper, never to the
        // inner shape that carries the flip transforms. So node.scaleX
        // here is purely the user's drag factor (always positive) —
        // no need to abs() against a baseline or detect Konva's
        // rotation-normalization. Same story for x/y/rotation: they're
        // the Group's, which is anchored at the layer's top-left in
        // every case (including centered shapes — the center offset
        // lives on the inner Konva element inside the Group).
        const dragScaleX = node.scaleX()
        const dragScaleY = node.scaleY()
        const rot = node.rotation()
        let x = node.x(), y = node.y()
        if (l.type === 'image') {
          let w = Math.round((l.width ?? 0) * dragScaleX)
          let h = Math.round((l.height ?? 0) * dragScaleY)
          if (gridSnapEnabled) { x = snapGrid(x); y = snapGrid(y); w = snapGrid(w); h = snapGrid(h) }
          return { ...l, x, y, width: w, height: h, rotation: rot }
        }
        if (l.type === 'text') {
          // Auto-width text (no committed width yet) must scale from the
          // node's rendered width — `?? 0` collapsed the layer to width 0 on
          // its first horizontal resize. skipShadow/skipStroke so drop
          // shadows and outlines don't inflate the committed width.
          const baseW = l.width
            ?? node.getClientRect({ skipTransform: true, skipShadow: true, skipStroke: true }).width
          let w = Math.round(baseW * dragScaleX)
          if (gridSnapEnabled) { x = snapGrid(x); y = snapGrid(y); w = snapGrid(w) }
          return { ...l, x, y, width: w, rotation: rot }
        }
        // shape: layer.width/height are authoritative.
        const w0 = l.width ?? 200
        const h0 = l.height ?? 200
        let newW = Math.round(w0 * dragScaleX)
        let newH = Math.round(h0 * dragScaleY)
        if (gridSnapEnabled) { newW = snapGrid(newW); newH = snapGrid(newH) }
        return { ...l, x: Math.round(x), y: Math.round(y), width: newW, height: newH, rotation: rot }
      })

      // flushSync forces React/react-konva to commit the new widths
      // and positions to the underlying Konva nodes IMMEDIATELY,
      // before the next line resets the Group's scale. Without it,
      // the imperative scaleX(1) below would land on the OLD node
      // state (still has the pre-commit width), and the browser
      // would paint a one-frame snapshot of "old width × scale 1 =
      // old size" before React caught up — visible as a jarring
      // snap-back jump after every resize-handle release.
      flushSync(() => { commitLayers(next) })
      clearSnapGuides()
      // Now safely reset Konva-side scale + skew. The flip lives on
      // the inner Konva element, not the Group, so a plain reset
      // here can't un-flip anything visually. Skew is reset because
      // Konva can produce non-zero skewX/skewY when a non-uniform
      // group scale is applied to a rotated child — those values
      // aren't part of our layer schema.
      nodeMap.forEach(node => {
        node.scaleX(1)
        node.scaleY(1)
        node.skewX(0)
        node.skewY(0)
      })
    })
  }, [layers, commitLayers, gridSnapEnabled])

  /** Aligns every selected layer (other than the anchor in selection mode)
   *  to either the artboard or the first-selected layer's bbox. Uses each
   *  Konva node's `getClientRect` for the source bbox so rotation is
   *  honored visually — we then translate by the bbox delta and apply the
   *  same delta to layer.x/y (which are stored in unrotated form). One
   *  commit = one undo entry. */
  const handleAlign = useCallback((op: AlignOp) => {
    const stage = stageRef.current
    if (!stage || selectedIds.length === 0) return

    let target: { left: number; centerX: number; right: number; top: number; centerY: number; bottom: number }
    let anchorId: string | null = null
    const useSelectionAnchor = alignMode === 'selection' && selectedIds.length >= 2

    if (useSelectionAnchor) {
      anchorId = selectedIds[0]
      const anchor = stage.findOne(`#${anchorId}`)
      if (!anchor) return
      const ar = anchor.getClientRect({ relativeTo: stage as unknown as Konva.Container })
      target = {
        left: ar.x, centerX: ar.x + ar.width / 2, right: ar.x + ar.width,
        top: ar.y,  centerY: ar.y + ar.height / 2, bottom: ar.y + ar.height,
      }
    } else {
      target = {
        left: 0, centerX: CANVAS_W / 2, right: CANVAS_W,
        top: 0,  centerY: CANVAS_H / 2, bottom: CANVAS_H,
      }
    }

    const next = layers.map(l => {
      if (!selectedIds.includes(l.id)) return l
      if (l.id === anchorId) return l
      const node = stage.findOne(`#${l.id}`)
      if (!node) return l
      const bbox = node.getClientRect({ relativeTo: stage as unknown as Konva.Container })
      let nbx = bbox.x, nby = bbox.y
      switch (op) {
        case 'left':     nbx = target.left;                       break
        case 'h-center': nbx = target.centerX - bbox.width / 2;   break
        case 'right':    nbx = target.right  - bbox.width;        break
        case 'top':      nby = target.top;                        break
        case 'v-center': nby = target.centerY - bbox.height / 2;  break
        case 'bottom':   nby = target.bottom - bbox.height;       break
      }
      return { ...l, x: l.x + (nbx - bbox.x), y: l.y + (nby - bbox.y) }
    })
    commitLayers(next)
  }, [selectedIds, alignMode, layers, commitLayers])

  const deleteSelected = useCallback(() => {
    if (selectedIds.length === 0) return
    const next = layers.filter(l => !selectedIds.includes(l.id))
    commitLayers(next)
    setSelectedIds([])
  }, [layers, selectedIds, commitLayers])

  // Reorder a layer to a specific display-order gap index.
  // displayIdx 0 = above the topmost row; layers.length = below the bottommost.
  // The display order is the reverse of the storage array (top = highest index).
  const reorderLayer = useCallback((srcId: string, displayDropIdx: number) => {
    const display = [...layers].reverse()
    const srcDisplayIdx = display.findIndex(l => l.id === srcId)
    if (srcDisplayIdx === -1) return
    // No-op if dropping in the same slot or the slot immediately after self.
    if (displayDropIdx === srcDisplayIdx || displayDropIdx === srcDisplayIdx + 1) return
    const [item] = display.splice(srcDisplayIdx, 1)
    const adjusted = displayDropIdx > srcDisplayIdx ? displayDropIdx - 1 : displayDropIdx
    display.splice(adjusted, 0, item)
    commitLayers([...display].reverse())
  }, [layers, commitLayers])

  // Move a single layer within the z-order. Storage array: last index =
  // front/top (renders on top, sits at the top of the layers panel). So
  // 'up'/'top' move toward the end of the array, 'down'/'bottom' toward the
  // start. Used by the Photoshop-style Ctrl+[ /] keyboard shortcuts.
  const moveLayer = useCallback((id: string, direction: 'up' | 'down' | 'top' | 'bottom') => {
    const idx = layers.findIndex(l => l.id === id)
    if (idx === -1) return
    const target =
      direction === 'up'   ? Math.min(idx + 1, layers.length - 1) :
      direction === 'down' ? Math.max(idx - 1, 0) :
      direction === 'top'  ? layers.length - 1 :
      /* bottom */           0
    if (target === idx) return
    const next = [...layers]
    const [item] = next.splice(idx, 1)
    next.splice(target, 0, item)
    commitLayers(next)
  }, [layers, commitLayers])

  const duplicateLayer = useCallback((id: string) => {
    const src = layers.find(l => l.id === id)
    if (!src) return
    const copy: ThumbnailLayer = { ...cloneLayer(src), id: newId(), name: src.name + ' copy', x: src.x + 20, y: src.y + 20 }
    const idx = layers.findIndex(l => l.id === id)
    const next = [...layers.slice(0, idx + 1), copy, ...layers.slice(idx + 1)]
    commitLayers(next)
    setSelectedIds([copy.id])
  }, [layers, commitLayers])

  /** Toggle flipX / flipY on every selected layer. Each click on the
   *  toolbar button is a single undo entry that flips all selected
   *  layers' state for that axis — matches the alignment-ops UX
   *  (operate on the whole selection, one entry per click). */
  const handleFlip = useCallback((axis: 'x' | 'y') => {
    if (selectedIds.length === 0) return
    const key = axis === 'x' ? 'flipX' : 'flipY'
    const next = layers.map(l =>
      selectedIds.includes(l.id) ? { ...l, [key]: !l[key] } : l
    )
    commitLayers(next)
  }, [layers, selectedIds, commitLayers])

  // ── Add layers ────────────────────────────────────────────────────────────
  /** Shared helper for both the image-picker button and asset-library
   *  drag-and-drop. Caches the source into _thumbnail-assets, reads natural
   *  dimensions, contain-fits within the canvas, and adds an image layer
   *  centered either on the canvas (no anchor) or on the given drop point.*/
  const addImageLayerFromPath = useCallback(async (sourcePath: string, anchor?: { x: number; y: number }) => {
    const originalBasename = sourcePath.split(/[\\/]/).pop() ?? ''
    const layerName = originalBasename.replace(/\.[^.]+$/, '') || 'Image'
    const srcPath = config.streamsDir
      ? await window.api.thumbnailCacheAsset(config.streamsDir, sourcePath)
      : sourcePath
    const { naturalW, naturalH } = await new Promise<{ naturalW: number; naturalH: number }>(resolve => {
      const img = new Image()
      img.onload = () => resolve({ naturalW: img.naturalWidth, naturalH: img.naturalHeight })
      img.onerror = () => resolve({ naturalW: CANVAS_W, naturalH: CANVAS_H })
      img.src = `file://${srcPath}`
    })
    const containScale = Math.min(1, CANVAS_W / naturalW, CANVAS_H / naturalH)
    const width = Math.round(naturalW * containScale)
    const height = Math.round(naturalH * containScale)
    const x = anchor ? Math.round(anchor.x - width / 2) : Math.round((CANVAS_W - width) / 2)
    const y = anchor ? Math.round(anchor.y - height / 2) : Math.round((CANVAS_H - height) / 2)
    const layer: ThumbnailLayer = {
      id: newId(), name: layerName, type: 'image', visible: true, opacity: 100,
      x, y, rotation: 0, src: srcPath, width, height,
    }
    commitLayers([...layers, layer])
    setSelectedIds([layer.id])
  }, [layers, commitLayers, config.streamsDir])

  const addImageLayer = useCallback(async () => {
    let defaultPath: string | undefined
    if (currentStream) {
      defaultPath = currentStream.folderPath
    } else if (config.streamsDir) {
      await window.api.thumbnailEnsureAssetsDir(config.streamsDir).catch(() => {})
      defaultPath = `${config.streamsDir}/_thumbnail-assets`
    }
    const paths = await window.api.openFileDialog({ filters: [{ name: 'Images', extensions: ['png', 'jpg', 'jpeg', 'webp', 'gif'] }], properties: ['openFile'], defaultPath })
    if (!paths.length) return
    await addImageLayerFromPath(paths[0])
  }, [currentStream, config.streamsDir, addImageLayerFromPath])

  // Set by the keydown Ctrl+V handler when it pastes an internally-copied
  // layer, so the native 'paste' event fired by the SAME keystroke doesn't
  // also paste a leftover OS-clipboard image as a second layer.
  const justPastedLayerRef = useRef(false)

  // Paste-from-clipboard: write the image to the stream folder as a PNG,
  // refresh the asset panel, and add it to the canvas as a new image layer.
  // Skipped when focus is in a text input so paste-in-textbox still works.
  // Sources route through canvas → PNG so JPEGs land as PNG (matches the
  // editor's image handling) and alpha is preserved when present. Placed
  // below addImageLayerFromPath so the deps reference is in scope.
  useEffect(() => {
    // Kept-alive page: the document-level paste listener must only be live
    // while the editor is actually on screen. Without the visibility/mode
    // gate, Ctrl+V anywhere in the app (say, a fresh screenshot on the
    // clipboard while the Streams page is focused) silently wrote a
    // pasted-*.png into the bound stream's folder and overwrote its saved
    // thumbnail via autosave — currentStream survives "Close session", so
    // gating on it alone wasn't enough.
    if (!isVisible || mode !== 'editor' || !currentStream) return
    const onPaste = async (e: ClipboardEvent) => {
      const target = e.target as HTMLElement | null
      if (target?.closest('input, textarea, [contenteditable="true"]')) return
      // The keydown handler already pasted a copied layer for this Ctrl+V —
      // swallow the native paste so a stale OS-clipboard image isn't added
      // as a second layer (the reported duplication bug).
      if (justPastedLayerRef.current) {
        justPastedLayerRef.current = false
        e.preventDefault()
        return
      }
      const items = e.clipboardData?.items
      if (!items) return
      let imgItem: DataTransferItem | null = null
      for (const it of items) {
        if (it.kind === 'file' && it.type.startsWith('image/')) { imgItem = it; break }
      }
      if (!imgItem) return
      e.preventDefault()
      const blob = imgItem.getAsFile()
      if (!blob) return
      try {
        const img = new Image()
        const url = URL.createObjectURL(blob)
        img.src = url
        await img.decode()
        URL.revokeObjectURL(url)
        const canvas = document.createElement('canvas')
        canvas.width = img.naturalWidth
        canvas.height = img.naturalHeight
        const ctx = canvas.getContext('2d')
        if (!ctx) return
        ctx.drawImage(img, 0, 0)
        const base64 = canvas.toDataURL('image/png').split(',')[1]
        const now = new Date()
        const hh = String(now.getHours()).padStart(2, '0')
        const mm = String(now.getMinutes()).padStart(2, '0')
        const ss = String(now.getSeconds()).padStart(2, '0')
        const destPath = `${currentStream.folderPath}/${currentStream.date}_pasted-${hh}${mm}${ss}.png`
        await window.api.saveScreenshot(destPath, base64)
        setAssetRefreshTrigger(t => t + 1)
        await addImageLayerFromPath(destPath)
      } catch (err) {
        console.error('Paste image failed', err)
      }
    }
    document.addEventListener('paste', onPaste)
    return () => document.removeEventListener('paste', onPaste)
  }, [isVisible, mode, currentStream, addImageLayerFromPath])

  const addTextLayer = useCallback(() => {
    const layer: ThumbnailLayer = {
      id: newId(), name: 'Text', type: 'text', visible: true, opacity: 100,
      x: 100, y: 100, rotation: 0, text: 'New Text',
      fontFamily: systemFonts[0] ?? 'Arial', fontSize: 72, fontStyle: 'bold',
      fill: '#ffffff', stroke: '#000000', strokeWidth: 0, align: 'left',
    }
    commitLayers([...layers, layer])
    setSelectedIds([layer.id])
  }, [layers, commitLayers, systemFonts])

  const addShapeLayer = useCallback((shapeType: 'rect' | 'ellipse' | 'triangle') => {
    const names = { rect: 'Rectangle', ellipse: 'Ellipse', triangle: 'Triangle' }
    const layer: ThumbnailLayer = {
      id: newId(), name: names[shapeType], type: 'shape', shapeType, visible: true, opacity: 100,
      x: Math.round(CANVAS_W / 2 - 100), y: Math.round(CANVAS_H / 2 - 100),
      rotation: 0, width: 200, height: 200,
      fill: '#6366f1', stroke: '#000000', strokeWidth: 0, cornerRadius: 0,
    }
    commitLayers([...layers, layer])
    setSelectedIds([layer.id])
  }, [layers, commitLayers])

  // ── Handle select on stage (deselect) ─────────────────────────────────────
  const handleStageClick = useCallback((e: Konva.KonvaEventObject<MouseEvent>) => {
    if (e.target === e.target.getStage()) setSelectedIds([])
  }, [])

  const handleLayerSelect = useCallback((id: string, multi: boolean) => {
    setSelectedIds(prev => {
      if (multi) {
        return prev.includes(id) ? prev.filter(x => x !== id) : [...prev, id]
      }
      return [id]
    })
  }, [])

  // Layers-panel row click: plain = solo select, Ctrl/Cmd = toggle in/out of
  // the selection, Shift = select the contiguous display-order range from
  // the last non-shift click (Photoshop/Explorer convention). The anchor
  // survives shift-clicks so successive ranges re-extend from the same row.
  const panelAnchorIdRef = useRef<string | null>(null)
  const handleLayerRowClick = useCallback((id: string, e: React.MouseEvent) => {
    if (e.shiftKey && panelAnchorIdRef.current && panelAnchorIdRef.current !== id) {
      const display = [...layersRef.current].reverse()
      const a = display.findIndex(l => l.id === panelAnchorIdRef.current)
      const b = display.findIndex(l => l.id === id)
      if (a !== -1 && b !== -1) {
        const [lo, hi] = a < b ? [a, b] : [b, a]
        setSelectedIds(display.slice(lo, hi + 1).map(l => l.id))
        return
      }
    }
    panelAnchorIdRef.current = id
    handleLayerSelect(id, e.ctrlKey || e.metaKey)
  }, [handleLayerSelect])

  // ── Open editor for a stream ───────────────────────────────────────────────
  // Pull the ordinal out of a thumbnail basename, e.g.
  //   `2026-06-15_sm-thumbnail.png`    → 1
  //   `2026-06-15_sm-thumbnail-3.png`  → 3
  //   anything else                    → null
  const parseVariantOrdinal = (basename: string, date: string): number | null => {
    const escaped = date.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
    const m = basename.match(new RegExp(`^${escaped}_sm-thumbnail(?:-(\\d+))?\\.png$`, 'i'))
    if (!m) return null
    return m[1] ? parseInt(m[1], 10) : 1
  }

  const openStreamEditor = useCallback(async (folderPath: string, date: string, title?: string, meta?: StreamMeta, totalEpisodes?: number, requestedVariantOrdinal?: number) => {
    // Retire the previous canvas session first: flush its pending saves,
    // then bump the epoch so a straggler can't capture the new stage.
    await flushStreamSaves()
    saveEpochRef.current++
    // Scan for existing variants in parallel with everything else.
    // The variant the user sees first is whichever the streams page
    // currently considers "preferred" — `meta.preferredThumbnail`
    // holds a basename, which we parse back into an ordinal. Falls
    // back to the lowest available ordinal if no preference matches.
    const [foundVariants, freshTemplates] = await Promise.all([
      window.api.thumbnailListVariants(folderPath, date).catch(() => [] as number[]),
      window.api.thumbnailListTemplates(config.streamsDir).catch(() => [] as ThumbnailTemplate[]),
    ])
    setTemplates(freshTemplates)
    const preferredOrdinal = meta?.preferredThumbnail
      ? parseVariantOrdinal(meta.preferredThumbnail, date)
      : null
    // Priority: explicit request (from a carousel / lightbox edit
    // button click) → `meta.preferredThumbnail` → first available.
    const initialVariant = requestedVariantOrdinal && foundVariants.includes(requestedVariantOrdinal)
      ? requestedVariantOrdinal
      : preferredOrdinal && foundVariants.includes(preferredOrdinal)
        ? preferredOrdinal
        : (foundVariants[0] ?? 1)
    const canvas = foundVariants.length > 0
      ? await window.api.thumbnailLoadCanvas(folderPath, date, initialVariant)
      : null

    // No canvas → always ask which template to start from (or blank).
    // meta.smThumbnailTemplate is only a RECORD of which template the
    // last saved canvas used (doSave writes it; New Episode inherits it
    // alongside the copied thumbnail files). It is deliberately NOT
    // auto-applied here: a new episode arrives with its canvas files
    // already copied, so the only way to reach this point with the
    // record set is a stale leftover (thumbnails deleted) — and
    // silently re-applying that template instead of asking was a
    // reported bug.
    if (!canvas && freshTemplates.length > 0) {
      // No existing canvas, no preselection, but templates exist → ask user to pick one first.
      // When a variant EXISTED but its JSON couldn't be read (deleted or
      // corrupt), bind the picker to THAT ordinal — confirmPickTemplate
      // defaults to 1, which re-templated healthy variant 1 instead of the
      // broken one the user actually opened.
      setTemplatePickerStream({
        folderPath, date, title, meta, totalEpisodes,
        targetVariant: foundVariants.length > 0 ? initialVariant : undefined,
        // THIS stream's real variant list — confirmPickTemplate must not
        // inherit the previously open stream's list.
        knownVariants: foundVariants,
      })
      setMode('overview')
      return
    }

    setCurrentStream({ folderPath, date, title, meta, totalEpisodes })
    setVariants(foundVariants.length > 0 ? foundVariants : [1])
    setCurrentVariant(initialVariant)
    setSelectedIds([])
    if (canvas) {
      resetLayers(canvas.layers)
      setCurrentTemplateId(canvas.templateId)
    } else {
      // No templates exist at all (picker skipped) — open a blank canvas.
      resetLayers([])
      setCurrentTemplateId(undefined)
    }
    setIsDirty(false)
    setMode('editor')
    // Add to recents
    const entry: ThumbnailRecentEntry = { folderPath, date, title, updatedAt: Date.now() }
    window.api.thumbnailAddRecent(entry).then(setRecents).catch(() => {})
    // Self-heal a missing render: the variant's editable JSON exists (that's
    // how we got here) but its PNG is gone — deleted externally, or a save
    // that wrote the JSON but never finished the image. Regenerate it from the
    // just-loaded canvas so the recents/streams thumbnails stop showing the
    // broken placeholder. Only fires when the PNG is actually absent, so normal
    // opens don't re-write on every visit.
    if (canvas) {
      const layersToSave = canvas.layers
      const templateIdToSave = canvas.templateId
      const suffix = initialVariant <= 1 ? '' : `-${initialVariant}`
      const pngExists = await window.api.fileExists(`${folderPath}/${date}_sm-thumbnail${suffix}.png`)
      if (!pngExists) {
        await new Promise<void>(r => requestAnimationFrame(() => r()))
        await doSave(layersToSave, folderPath, date, templateIdToSave, initialVariant)
      }
    }
  }, [resetLayers, config.streamsDir, doSave, flushStreamSaves])

  const openFromRecent = useCallback(async (entry: ThumbnailRecentEntry) => {
    // Recents persist only path/date/title — re-resolve the stream's meta
    // and series length before opening so merge-field text ({title},
    // {game}, {episode}, …) renders real values. Without this the canvas
    // rendered blanks and the next save BAKED them into the PNG.
    let meta: StreamMeta | undefined
    let totalEpisodes: number | undefined
    try {
      const all = await window.api.listStreams(config.streamsDir, config.streamMode || 'folder-per-stream')
      const f = all.find(x => x.folderPath === entry.folderPath && x.date === entry.date)
        ?? all.find(x => x.folderPath === entry.folderPath)
      if (f) {
        meta = f.meta ?? undefined
        const primaryGame = resolvePrimaryGame(f.meta) || f.detectedGames?.[0] || ''
        totalEpisodes = f.meta?.isSeries === false
          ? 0
          : detectTotalEpisodes(all, primaryGame, f.meta?.ytSeason || '1')
      }
    } catch { /* open with just the basics — same as before */ }
    await openStreamEditor(entry.folderPath, entry.date, entry.title, meta, totalEpisodes)
  }, [openStreamEditor, config.streamsDir, config.streamMode])

  const removeRecent = useCallback((entry: ThumbnailRecentEntry) => {
    window.api.thumbnailRemoveRecent(entry.folderPath, entry.date).then(setRecents).catch(() => {
      setRecents(prev => prev.filter(r => !(r.folderPath === entry.folderPath && r.date === entry.date)))
    })
  }, [])
  const clearRecents = useCallback(() => {
    window.api.thumbnailClearRecents().then(setRecents).catch(() => setRecents([]))
  }, [])

  // ── Confirm template picker choice ────────────────────────────────────────
  const confirmPickTemplate = useCallback(async (t: ThumbnailTemplate | null) => {
    if (!templatePickerStream) return
    const { folderPath, date, title, meta, totalEpisodes, targetVariant, knownVariants } = templatePickerStream
    setTemplatePickerStream(null)
    // Retire whatever session the stage currently shows (the "new
    // alternative" flow arrives here from an OPEN editor session).
    await flushStreamSaves()
    saveEpochRef.current++
    setCurrentStream({ folderPath, date, title, meta, totalEpisodes })
    setSelectedIds([])
    // Compute the layers locally so we can both seed the editor AND
    // pass them straight to the eager save below — avoids waiting on
    // a React state read after `resetLayers`.
    const newLayers = t ? t.layers.map(l => ({ ...l, id: newId() })) : []
    resetLayers(newLayers)
    setCurrentTemplateId(t?.id)
    setIsDirty(false)
    setMode('editor')
    // Variant accounting: in the new-alternative flow `targetVariant`
    // is set to the next-available ordinal; otherwise default to 1.
    const ordinal = targetVariant ?? 1
    setCurrentVariant(ordinal)
    // Base the strip on the picker stream's OWN variant list — merging into
    // whatever `variants` held for the previously open stream carried that
    // stream's thumbnails into this one's strip as phantoms.
    const baseVariants = knownVariants ?? []
    setVariants(baseVariants.includes(ordinal) ? baseVariants : [...baseVariants, ordinal].sort((a, b) => a - b))
    const entry: ThumbnailRecentEntry = { folderPath, date, title, updatedAt: Date.now() }
    window.api.thumbnailAddRecent(entry).then(setRecents).catch(() => {})
    // Eager save: stream items previously only got an on-disk PNG +
    // JSON after the user nudged a layer (triggerAutoSave). With
    // alternative thumbnails the user can create one and immediately
    // navigate away, expecting it to persist; saving here makes the
    // freshly-templated variant exist on disk right after the picker
    // closes. Skip for the "Start blank" path — there are no layers
    // to render, so the save would just write an empty PNG. The rAF
    // gives react-konva a frame to commit the new layers to the
    // stage so `getCanvasDataUrl` reads them instead of the previous
    // contents.
    if (newLayers.length > 0) {
      await new Promise<void>(r => requestAnimationFrame(() => r()))
      await doSave(newLayers, folderPath, date, t?.id, ordinal)
    }
  }, [templatePickerStream, resetLayers, doSave, flushStreamSaves])

  // Switch the editor to a different already-existing variant. Auto-
  // save fires for the current variant first (no work lost if the
  // user was mid-edit), then we load the target variant's canvas.
  const switchVariant = useCallback(async (ordinal: number) => {
    if (!currentStream) return
    if (ordinal === currentVariant) return
    // Flush pending + in-flight saves against the CURRENT variant, then
    // retire it so a straggler can't capture the target variant's stage.
    await flushStreamSaves()
    saveEpochRef.current++
    const canvas = await window.api.thumbnailLoadCanvas(currentStream.folderPath, currentStream.date, ordinal)
    setCurrentVariant(ordinal)
    if (canvas) {
      resetLayers(canvas.layers)
      setCurrentTemplateId(canvas.templateId)
    } else {
      resetLayers([])
      setCurrentTemplateId(undefined)
    }
    setIsDirty(false)
  }, [currentStream, currentVariant, flushStreamSaves, resetLayers])

  // Open the template picker in "new alternative" mode. Computes the
  // next available ordinal from the variants list (gaps left by a
  // delete don't get backfilled — we always take max + 1 so the
  // numbering is stable across the session and prior `preferredThumbnail`
  // references stay valid).
  const startNewVariant = useCallback(() => {
    if (!currentStream) return
    const nextOrdinal = variants.length > 0 ? Math.max(...variants) + 1 : 1
    setTemplatePickerStream({
      folderPath: currentStream.folderPath,
      date: currentStream.date,
      title: currentStream.title,
      meta: currentStream.meta,
      totalEpisodes: currentStream.totalEpisodes,
      targetVariant: nextOrdinal,
      knownVariants: variants,
    })
  }, [currentStream, variants])

  // Duplicate the currently-open variant into a new alternative at
  // `templatePickerStream.targetVariant`. Used by the "Duplicate
  // current" card in the picker modal. Flushes any pending save on
  // the source variant first (so its latest state is on disk),
  // clones the layers with fresh ids, writes the new variant to
  // disk immediately, and switches the editor to it. Preserves the
  // source's template binding so future template-driven updates
  // still apply to the duplicate by default.
  const duplicateCurrentToNewVariant = useCallback(async () => {
    if (!templatePickerStream || !templatePickerStream.targetVariant) return
    const { folderPath, date, title, meta, totalEpisodes, targetVariant } = templatePickerStream
    if (autoSaveTimer.current) { clearTimeout(autoSaveTimer.current); autoSaveTimer.current = null }
    if (isDirty) {
      await doSave(layers, folderPath, date, currentTemplateId, currentVariant)
    }
    const dupLayers = layers.map(l => ({ ...l, id: newId() }))
    setTemplatePickerStream(null)
    setCurrentStream({ folderPath, date, title, meta, totalEpisodes })
    setSelectedIds([])
    resetLayers(dupLayers)
    setCurrentVariant(targetVariant)
    setVariants(prev => prev.includes(targetVariant) ? prev : [...prev, targetVariant].sort((a, b) => a - b))
    setMode('editor')
    // Eager save so the new variant's PNG + JSON exist on disk even
    // if the user navigates away before the next auto-save tick.
    await doSave(dupLayers, folderPath, date, currentTemplateId, targetVariant)
    const entry: ThumbnailRecentEntry = { folderPath, date, title, updatedAt: Date.now() }
    window.api.thumbnailAddRecent(entry).then(setRecents).catch(() => {})
  }, [templatePickerStream, currentVariant, currentTemplateId, isDirty, layers, doSave, resetLayers])

  const openFromTemplate = useCallback((t: ThumbnailTemplate) => {
    // Open editor with template layers but no stream association
    saveEpochRef.current++
    setCurrentStream(null)
    setSelectedIds([])
    resetLayers(t.layers.map(l => ({ ...l, id: newId() })))
    setCurrentTemplateId(t.id)
    setIsDirty(false)
    setMode('editor')
  }, [resetLayers])

  const openNewBlank = useCallback(() => {
    saveEpochRef.current++
    setCurrentStream(null)
    setSelectedIds([])
    resetLayers([])
    setCurrentTemplateId(undefined)
    setIsDirty(false)
    setMode('editor')
  }, [resetLayers])

  // ── Save as template ───────────────────────────────────────────────────────
  const openSaveTemplate = useCallback(() => {
    setSaveTemplateName('')
    setSaveTemplateOpen(true)
    setTimeout(() => saveTemplateInputRef.current?.focus(), 50)
  }, [])

  const commitSaveTemplate = useCallback(async () => {
    const name = saveTemplateName.trim()
    if (!name || !config.streamsDir) return
    setSaveTemplateOpen(false)
    const template: ThumbnailTemplate = {
      id: newId(), name, createdAt: Date.now(), updatedAt: Date.now(), layers: layers.map(cloneLayer),
    }
    await window.api.thumbnailEnsureAssetsDir(config.streamsDir)
    await waitForStageImages()
    const pngDataUrl = getCanvasDataUrl()
    const saved = await window.api.thumbnailSaveTemplate(config.streamsDir, template, pngDataUrl || undefined)
    setTemplates(prev => [saved, ...prev.filter(t => t.id !== saved.id)])
    // An UNBOUND scratch session (New blank) becomes a session editing the
    // template it just saved — before, it stayed an "unsaved canvas" dead
    // end that had to be closed and reopened from the overview. Sessions
    // bound to a STREAM deliberately stay bound: their autosave targets the
    // stream, and save-as-template there is a snapshot, not a context
    // switch (same reasoning that killed todo #21's assign-to-stream flow).
    if (!currentStream) {
      setCurrentTemplateId(saved.id)
      setIsDirty(false)
    }
  }, [saveTemplateName, layers, config.streamsDir, getCanvasDataUrl, waitForStageImages, currentStream])

  const deleteTemplate = useCallback(async (id: string) => {
    if (!config.streamsDir) return
    await window.api.thumbnailDeleteTemplate(config.streamsDir, id)
    setTemplates(prev => prev.filter(t => t.id !== id))
  }, [config.streamsDir])

  // ── Update existing template in place ─────────────────────────────────────
  const updateCurrentTemplate = useCallback(async () => {
    if (!currentTemplateId || !config.streamsDir) return
    const existing = templates.find(t => t.id === currentTemplateId)
    if (!existing) return
    const updated: ThumbnailTemplate = {
      ...existing,
      layers: layers.map(cloneLayer),
      updatedAt: Date.now(),
    }
    await waitForStageImages()
    const pngDataUrl = getCanvasDataUrl()
    const saved = await window.api.thumbnailSaveTemplate(config.streamsDir, updated, pngDataUrl || undefined)
    setTemplates(prev => prev.map(t => t.id === saved.id ? saved : t))
    setIsDirty(false)
  }, [currentTemplateId, templates, layers, config.streamsDir, getCanvasDataUrl, waitForStageImages])

  // ── Manual save ───────────────────────────────────────────────────────────
  const manualSave = useCallback(async () => {
    if (!currentStream) return
    if (autoSaveTimer.current) { clearTimeout(autoSaveTimer.current); autoSaveTimer.current = null }
    await doSave(layers, currentStream.folderPath, currentStream.date, currentTemplateId, currentVariant)
  }, [currentStream, layers, currentTemplateId, currentVariant, doSave])

  // ── Close session ─────────────────────────────────────────────────────────
  // Stream sessions: finish ALL saving first (flush the debounce, await any
  // in-flight save), showing "Closing session…" while it runs — closing used
  // to drop the timer on the floor, silently losing the last ~500ms of edits
  // (or several seconds of a rapid burst). Template sessions are the
  // opposite by design: they are never autosaved ("Update template" is the
  // only write path, so experiments can be abandoned), so closing one dirty
  // asks Save / Discard / Cancel instead.
  const closeSession = useCallback(async () => {
    if (closingSession) return
    if (!currentStream && currentTemplateId && isDirty) {
      setConfirmCloseTemplate(true)
      return
    }
    setClosingSession(true)
    try {
      await flushStreamSaves()
    } finally {
      saveEpochRef.current++
      setCurrentStream(null)
      setCurrentTemplateId(undefined)
      setClosingSession(false)
      setMode('overview')
    }
  }, [closingSession, currentStream, currentTemplateId, isDirty, flushStreamSaves])

  // ── Delete thumbnail files ────────────────────────────────────────────────
  const confirmDeleteThumbnail = useCallback(async () => {
    if (!currentStream) return
    setDeleteThumbOpen(false)
    const { folderPath, date } = currentStream
    const variantToDelete = currentVariant
    const suffix = variantToDelete <= 1 ? '' : `-${variantToDelete}`
    // Cancel any pending auto-save, then retire the session and wait out an
    // in-flight save — a straggler completing after the delete would write
    // the doomed variant's files right back.
    if (autoSaveTimer.current) { clearTimeout(autoSaveTimer.current); autoSaveTimer.current = null }
    saveEpochRef.current++
    await pendingSaveRef.current
    // Delete the JSON + PNG for the CURRENTLY-OPEN variant only.
    // Other variants are left alone — multi-thumbnail stream items
    // keep the remaining alternatives intact.
    await Promise.allSettled([
      window.api.deleteFile(`${folderPath}/${date}_sm-thumbnail${suffix}.json`),
      window.api.deleteFile(`${folderPath}/${date}_sm-thumbnail${suffix}.png`),
    ])
    // Re-scan for what's left after the delete.
    const remaining = await window.api.thumbnailListVariants(folderPath, date).catch(() => [] as number[])
    if (remaining.length > 0) {
      // Other variants still exist → switch to the lowest-ordinal one
      // so the user lands on something rather than the overview.
      const nextOrdinal = remaining[0]
      const canvas = await window.api.thumbnailLoadCanvas(folderPath, date, nextOrdinal)
      setVariants(remaining)
      setCurrentVariant(nextOrdinal)
      if (canvas) {
        resetLayers(canvas.layers)
        setCurrentTemplateId(canvas.templateId)
      } else {
        resetLayers([])
        setCurrentTemplateId(undefined)
      }
      setIsDirty(false)
      // If the deleted variant was the streams page's preferred
      // thumbnail, clear that meta key so the row falls back to
      // another available thumbnail instead of pointing at a now-
      // missing file. Don't touch the smThumbnail flag — the stream
      // still has SM thumbnails, just not THIS one.
      const wasPreferred = currentStream.meta?.preferredThumbnail
        === `${date}_sm-thumbnail${suffix}.png`
      if (wasPreferred) {
        await window.api.updateStreamMeta(folderPath, {
          preferredThumbnail: undefined,
        } as any, streamMetaKey(folderPath, date, config.streamsDir)).catch(() => {})
      }
      return
    }
    // No variants left → clear the thumbnail flags, drop the recents
    // entry, and return to overview (same as the legacy delete flow).
    await window.api.updateStreamMeta(folderPath, {
      smThumbnail: undefined,
      smThumbnailTemplate: undefined,
    } as any, streamMetaKey(folderPath, date, config.streamsDir)).catch(() => {})
    window.api.thumbnailRemoveRecent(folderPath, date).then(setRecents).catch(() => {
      setRecents(prev => prev.filter(r => !(r.folderPath === folderPath && r.date === date)))
    })
    setCurrentStream(null)
    setVariants([1])
    setCurrentVariant(1)
    resetLayers([])
    setCurrentTemplateId(undefined)
    setIsDirty(false)
    setMode('overview')
  }, [currentStream, currentVariant, resetLayers])

  // React to the open variant's files being removed out from under the editor
  // (e.g. deleted via the streams-page detail carousel). Switch to a surviving
  // alternate, or fall back to the overview if nothing's left — otherwise a
  // later edit would silently re-save (resurrect) the just-deleted thumbnail.
  // Mirrors the tail of confirmDeleteThumbnail minus the delete + meta cleanup
  // (the file's already gone and the deleter owns the meta/preferred cleanup).
  const reconcileVariantGone = useCallback(async (folderPath: string, date: string, goneVariant: number) => {
    const remaining = (await window.api.thumbnailListVariants(folderPath, date).catch(() => [] as number[]))
      .filter(v => v !== goneVariant)
    if (remaining.length > 0) {
      const nextOrdinal = remaining[0]
      const canvas = await window.api.thumbnailLoadCanvas(folderPath, date, nextOrdinal)
      setVariants(remaining)
      setCurrentVariant(nextOrdinal)
      if (canvas) { resetLayers(canvas.layers); setCurrentTemplateId(canvas.templateId) }
      else { resetLayers([]); setCurrentTemplateId(undefined) }
      setIsDirty(false)
      return
    }
    setCurrentStream(null)
    setVariants([1])
    setCurrentVariant(1)
    resetLayers([])
    setCurrentTemplateId(undefined)
    setIsDirty(false)
    setMode('overview')
  }, [resetLayers])

  useEffect(() => {
    if (mode !== 'editor' || !currentStream) return
    const { folderPath, date } = currentStream
    const variant = currentVariant
    // This stream's key (main's metaKey semantics: forward-slash path
    // relative to the streams root, basename fallback) — scoped events
    // that don't name it are other streams' churn and can't have touched
    // our variants, so skip the listVariants round-trip entirely.
    const root = (config.streamsDir ?? '').replace(/\\/g, '/').replace(/\/$/, '')
    const fp = folderPath.replace(/\\/g, '/')
    const streamKey = root && fp.startsWith(root + '/') ? fp.slice(root.length + 1) : (fp.split('/').pop() ?? fp)
    const unsub = window.api.onStreamsChanged(async info => {
      if (info?.streamKeys && !info.streamKeys.includes(streamKey)) return
      const remaining = await window.api.thumbnailListVariants(folderPath, date).catch(() => null)
      if (!remaining) return
      // The currently-open variant was deleted → switch to a survivor or return
      // to the overview. (The editor's own saves also fire streams:changed, but
      // the variant still exists then, so this branch is skipped.)
      if (!remaining.includes(variant)) {
        await reconcileVariantGone(folderPath, date, variant)
        return
      }
      // Otherwise keep the selector honest: a non-open variant deleted elsewhere
      // should drop out of the dropdown instead of lingering (blank) behind it.
      setVariants(prev => (prev.length === remaining.length && prev.every((v, i) => v === remaining[i])) ? prev : remaining)
      // And bust the preview cache: the PNGs may have changed CONTENT
      // without changing paths (restored from the Recycle Bin, edited
      // externally) — the ?v= querystring only bumps on our own saves,
      // so the popover would keep showing the pre-restore image forever.
      setVariantPreviewKey(k => k + 1)
    })
    return unsub
  }, [mode, currentStream, currentVariant, reconcileVariantGone, config.streamsDir])

  // ── Export PNG ────────────────────────────────────────────────────────────
  const exportPng = useCallback(async () => {
    if (!stageRef.current) return
    await waitForStageImages()
    const dataUrl = getCanvasDataUrl()
    const defaultName = currentStream ? `${currentStream.date}_thumbnail.png` : 'thumbnail.png'
    const dest = await window.api.saveFileDialog({ defaultPath: defaultName, filters: [{ name: 'PNG', extensions: ['png'] }] })
    if (!dest) return
    await window.api.saveScreenshot(dest, dataUrl.replace(/^data:image\/png;base64,/, ''))
  }, [currentStream, getCanvasDataUrl, waitForStageImages])

  // ── Keyboard shortcuts ────────────────────────────────────────────────────
  useEffect(() => {
    if (!isVisible || mode !== 'editor') return
    const handler = (e: KeyboardEvent) => {
      const target = e.target as HTMLElement
      const tag = target.tagName
      // Bail when typing in a form field OR a contenteditable (the text-layer
      // chip editor) — otherwise Backspace/Delete here would nuke the whole
      // selected layer instead of editing its text.
      if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT' || target.isContentEditable) return
      // Normalize case: with Shift held the Z key reports as 'Z', so a
      // literal 'z' compare would make Ctrl+Shift+Z (the PS/Affinity redo)
      // never match. Redo = Ctrl+Y or Ctrl+Shift+Z; undo = Ctrl+Z.
      const k = e.key.toLowerCase()
      if ((e.ctrlKey || e.metaKey) && k === 'z' && !e.shiftKey) { e.preventDefault(); undo() }
      if ((e.ctrlKey || e.metaKey) && (k === 'y' || (k === 'z' && e.shiftKey))) { e.preventDefault(); redo() }
      if ((e.ctrlKey || e.metaKey) && e.key === 's') { e.preventDefault(); manualSave() }
      if ((e.ctrlKey || e.metaKey) && e.key === 'c') {
        const copied = layers.filter(l => selectedIds.includes(l.id)).map(cloneLayer)
        if (copied.length > 0) setClipboardLayers(copied)
      }
      if ((e.ctrlKey || e.metaKey) && e.key === 'v') {
        if (clipboardLayers.length > 0) {
          // Mark this Ctrl+V as handled so the native 'paste' event for the
          // same keystroke doesn't also paste an OS-clipboard image. The
          // paste event fires synchronously before this timeout, so the
          // guard sees `true`; the timeout just clears it if no paste follows.
          justPastedLayerRef.current = true
          setTimeout(() => { justPastedLayerRef.current = false }, 0)
          const pasted = clipboardLayers.map(l => ({ ...cloneLayer(l), id: newId() }))
          commitLayers([...layers, ...pasted])
          setSelectedIds(pasted.map(l => l.id))
        }
      }
      if (e.key === 'Delete' || e.key === 'Backspace') deleteSelected()
      if (e.key === 'g' || e.key === 'G') setGridSnapEnabled(v => !v)
      // Arrow-key nudge: move the selection 1px (10px with Shift). e.code keeps
      // this layout-independent and lets it co-exist with the bracket z-order
      // keys below. preventDefault stops the arrows from scrolling the panels.
      if (e.code === 'ArrowUp' || e.code === 'ArrowDown' || e.code === 'ArrowLeft' || e.code === 'ArrowRight') {
        if (selectedIdsRef.current.length > 0) {
          e.preventDefault()
          const step = e.shiftKey ? 10 : 1
          const dx = e.code === 'ArrowLeft' ? -step : e.code === 'ArrowRight' ? step : 0
          const dy = e.code === 'ArrowUp' ? -step : e.code === 'ArrowDown' ? step : 0
          nudgeSelected(dx, dy)
        }
      }
      // Layer z-order (Photoshop-style). e.code is layout-independent — with
      // Shift held, e.key becomes '}'/'{', so matching on code avoids that.
      // ] = forward/up, [ = backward/down; Shift = all the way to front/back.
      if ((e.ctrlKey || e.metaKey) && (e.code === 'BracketRight' || e.code === 'BracketLeft')) {
        if (selectedIds.length === 1) {
          e.preventDefault()
          const forward = e.code === 'BracketRight'
          moveLayer(selectedIds[0], e.shiftKey ? (forward ? 'top' : 'bottom') : (forward ? 'up' : 'down'))
        }
      }
    }
    window.addEventListener('keydown', handler)
    return () => window.removeEventListener('keydown', handler)
  }, [isVisible, mode, undo, redo, manualSave, deleteSelected, setGridSnapEnabled, layers, selectedIds, clipboardLayers, setClipboardLayers, commitLayers, setSelectedIds, moveLayer, nudgeSelected])

  // ── Selected layer ────────────────────────────────────────────────────────
  const selectedLayer = useMemo(() => {
    if (selectedIds.length !== 1) return null
    return layers.find(l => l.id === selectedIds[0]) ?? null
  }, [selectedIds, layers])

  // ── Rendered canvas layers (bottom-to-top order, reversed for konva draw) ──
  // layers[0] = bottom, layers[length-1] = top. Konva draws in array order.
  const renderLayers = useMemo(() => [...layers], [layers])

  // Merge field substitutions for text layers. When `currentStream` is set,
  // we have real values from its meta — text layers render with substitutions
  // applied. When null (template editing mode), the memo returns null and
  // text layers render the raw {field} markers literally so the user can see
  // what they're authoring.
  const mergeFieldValues = useMemo<Record<string, string> | null>(() => {
    if (!currentStream) return null
    const m = currentStream.meta
    return {
      // ytTitle is a raw template body — render it, never inline it, or a
      // {title} text layer bakes literal "{game} [PART {episode}]" markers
      // into the exported PNG for streams without a tagline.
      title: m?.ytCatchyTitle || renderTitleFromMeta(m, {
        totalEpisodes: currentStream.totalEpisodes,
        fallback: currentStream.title,
      }) || '',
      // topic is canonical; game stays as the alias so text layers authored
      // before the topic/game rename keep resolving.
      topic: m?.ytGameTitle || m?.games?.[0] || '',
      game: m?.ytGameTitle || m?.games?.[0] || '',
      date: currentStream.date,
      season: m?.ytSeason || '1',
      episode: m?.ytEpisode || '1',
      total_episodes: currentStream.totalEpisodes ? String(currentStream.totalEpisodes) : '',
    }
  }, [currentStream])

  // Display title for the toolbar. `meta.ytTitle` is a raw template body, so
  // resolve it through merge fields (preferred — always current). Streams
  // opened from recents don't carry meta, so fall back to the pre-rendered
  // `title` snapshot that was stored when the recent was created.
  const currentStreamTitle = useMemo(() => {
    if (!currentStream) return undefined
    if (currentStream.meta?.ytTitle?.trim()) {
      const rendered = renderTitleFromMeta(currentStream.meta, {
        totalEpisodes: currentStream.totalEpisodes,
        fallback: currentStream.title,
      })
      if (rendered) return rendered
    }
    return currentStream.title
  }, [currentStream])

  // ── Render ────────────────────────────────────────────────────────────────
  return (
    <div className="flex flex-col h-full bg-navy-900">
      {mode === 'overview' ? (
        <div className="flex flex-col flex-1 min-h-0 relative">
          <div className="px-6 py-4 border-b border-white/5 shrink-0">
            <h1 className="text-lg font-semibold">Thumbnail Editor</h1>
          </div>
          <Overview
            streamsDir={config.streamsDir}
            templates={templates}
            recents={recents}
            onNewBlank={openNewBlank}
            onOpenTemplate={openFromTemplate}
            onOpenRecent={openFromRecent}
            onRemoveRecent={removeRecent}
            onClearRecents={clearRecents}
            onDeleteTemplate={deleteTemplate}
            loading={overviewLoading}
          />
          {/* Template picker modal was moved out of this branch so
              it renders in editor mode too — needed for the "+ New
              thumbnail" alternative flow from the variant switcher
              dropdown. See the lifted copy at the end of this
              component's render. */}
        </div>
      ) : (
        <>
          {/* Top bar */}
          <div className="flex items-center gap-2 px-3 py-2 border-b border-white/5 shrink-0 bg-navy-800">
            <div className="flex-1 flex items-center gap-2 min-w-0">
              {currentStream ? (
                <span className="text-xs text-gray-400 truncate">
                  {currentStreamTitle ?? currentStream.date}
                  <span className="text-gray-400 ml-2">{currentStream.date}</span>
                </span>
              ) : currentTemplateId ? (
                <span className="text-xs text-gray-400 truncate">
                  {templates.find(t => t.id === currentTemplateId)?.name ?? 'Template'}
                  <span className="text-gray-400 ml-1.5">template</span>
                </span>
              ) : (
                <span className="text-xs text-gray-400 italic">Unsaved canvas</span>
              )}
              {isDirty && <span className="w-1.5 h-1.5 rounded-full bg-amber-400 shrink-0" />}
              {/* Variant switcher + Delete — only when editing a
                  stream (templates-only sessions don't have variants).
                  The switcher's button displays a 1-indexed position
                  in the visible variants list, not the file ordinal,
                  so users see "Thumbnail 1, Thumbnail 2…" contiguously
                  even when a delete leaves a gap in the file ordinals. */}
              {currentStream && (
                <div ref={variantPickerRef} className="relative flex items-center gap-1 ml-2 shrink-0">
                  <button
                    type="button"
                    onClick={() => setVariantPickerOpen(v => !v)}
                    className={`flex items-center gap-1 px-2 py-1 rounded text-[11px] font-medium transition-colors ${
                      variantPickerOpen
                        ? 'bg-white/10 text-gray-200'
                        : 'bg-white/5 hover:bg-white/10 text-gray-300 hover:text-gray-100'
                    }`}
                  >
                    Thumbnail {Math.max(1, variants.indexOf(currentVariant) + 1)}
                    <ChevronDown size={11} className={`text-gray-400 transition-transform ${variantPickerOpen ? 'rotate-180' : ''}`} />
                  </button>
                  <Tooltip content="Delete this thumbnail" side="bottom">
                    <button
                      type="button"
                      onClick={() => setDeleteThumbOpen(true)}
                      className="p-1.5 rounded text-red-400 hover:text-red-300 hover:bg-red-500/10 transition-colors"
                      aria-label="Delete this thumbnail"
                    >
                      <Trash2 size={12} />
                    </button>
                  </Tooltip>
                  {variantPickerOpen && (
                    <div className="absolute top-full left-0 mt-1.5 z-30 min-w-[200px] bg-navy-700 border border-white/10 rounded-lg shadow-xl py-1">
                      {variants.map((ord, i) => {
                        const isCurrent = ord === currentVariant
                        const suffix = ord <= 1 ? '' : `-${ord}`
                        const src = `file://${currentStream.folderPath.replace(/\\/g, '/')}/${currentStream.date}_sm-thumbnail${suffix}.png?v=${variantPreviewKey}`
                        return (
                          <button
                            key={ord}
                            type="button"
                            onClick={() => { void switchVariant(ord); setVariantPickerOpen(false) }}
                            disabled={isCurrent}
                            className={`flex items-center gap-2 w-full px-2 py-1.5 text-xs text-left transition-colors ${
                              isCurrent
                                ? 'bg-white/10 text-gray-100 cursor-default'
                                : 'text-gray-300 hover:bg-white/5'
                            }`}
                          >
                            <img
                              src={src}
                              alt=""
                              className="w-12 h-7 object-cover rounded bg-navy-900 border border-white/5 shrink-0"
                              onError={(e) => { (e.currentTarget as HTMLImageElement).style.visibility = 'hidden' }}
                            />
                            <span>Thumbnail {i + 1}</span>
                          </button>
                        )
                      })}
                      <div className="my-1 border-t border-white/5" />
                      <button
                        type="button"
                        onClick={() => { startNewVariant(); setVariantPickerOpen(false) }}
                        className="flex items-center gap-2 w-full px-2 py-1.5 text-xs text-left text-purple-300 hover:bg-white/5 transition-colors"
                      >
                        <span className="w-12 h-7 rounded border border-dashed border-white/10 flex items-center justify-center shrink-0">
                          <Plus size={12} />
                        </span>
                        New thumbnail
                      </button>
                    </div>
                  )}
                </div>
              )}
            </div>
            <div className="flex items-center gap-1">
              <Tooltip content="Undo (Ctrl+Z)" side="bottom">
                <button
                  onClick={undo}
                  disabled={!canUndo}
                  className="p-1.5 rounded hover:bg-white/10 text-gray-400 hover:text-gray-200 disabled:opacity-30 disabled:cursor-not-allowed transition-colors"
                >
                  <Undo2 size={14} />
                </button>
              </Tooltip>
              <Tooltip content="Redo (Ctrl+Shift+Z)" side="bottom">
                <button
                  onClick={redo}
                  disabled={!canRedo}
                  className="p-1.5 rounded hover:bg-white/10 text-gray-400 hover:text-gray-200 disabled:opacity-30 disabled:cursor-not-allowed transition-colors"
                >
                  <Redo2 size={14} />
                </button>
              </Tooltip>
              <div className="w-px h-4 bg-white/10 mx-1" />
              <Tooltip content={`Smart guides ${smartSnapEnabled ? '(on)' : '(off)'} — snap to edges & centers`} side="bottom">
                <button
                  onClick={() => setSmartSnapEnabled(v => !v)}
                  className={`p-1.5 rounded transition-colors ${smartSnapEnabled ? 'bg-purple-600/30 text-purple-300' : 'hover:bg-white/10 text-gray-400 hover:text-gray-300'}`}
                >
                  <Magnet size={14} />
                </button>
              </Tooltip>
              <Tooltip content={`Grid snap ${gridSnapEnabled ? '(on)' : '(off)'} — snap to ${GRID_SIZE}px grid (G)`} side="bottom">
                <button
                  onClick={() => setGridSnapEnabled(v => !v)}
                  className={`p-1.5 rounded transition-colors ${gridSnapEnabled ? 'bg-purple-600/30 text-purple-300' : 'hover:bg-white/10 text-gray-400 hover:text-gray-300'}`}
                >
                  <Grid3x3 size={14} />
                </button>
              </Tooltip>
              <div className="w-px h-4 bg-white/10 mx-1" />
              {/* Alignment mode toggle */}
              <Tooltip content="Align to artboard (canvas)" side="bottom">
                <button
                  onClick={() => setAlignMode('artboard')}
                  className={`p-1.5 rounded transition-colors ${alignMode === 'artboard' ? 'bg-purple-600/30 text-purple-300' : 'hover:bg-white/10 text-gray-400 hover:text-gray-300'}`}
                >
                  <Frame size={14} />
                </button>
              </Tooltip>
              <Tooltip content={selectedIds.length < 2 ? 'Align to first selected (needs 2+ items)' : 'Align to first selected'} side="bottom">
                <button
                  onClick={() => setAlignMode('selection')}
                  disabled={selectedIds.length < 2}
                  className={`p-1.5 rounded transition-colors disabled:opacity-30 disabled:cursor-not-allowed ${alignMode === 'selection' ? 'bg-purple-600/30 text-purple-300' : 'hover:bg-white/10 text-gray-400 hover:text-gray-300'}`}
                >
                  <BoxSelect size={14} />
                </button>
              </Tooltip>
              {/* Alignment ops */}
              {([
                ['left',     <AlignStartVertical size={14} />,    'Align left edges'],
                ['h-center', <AlignCenterVertical size={14} />,   'Align horizontal centers'],
                ['right',    <AlignEndVertical size={14} />,      'Align right edges'],
                ['top',      <AlignStartHorizontal size={14} />,  'Align top edges'],
                ['v-center', <AlignCenterHorizontal size={14} />, 'Align vertical centers'],
                ['bottom',   <AlignEndHorizontal size={14} />,    'Align bottom edges'],
              ] as const).map(([op, icon, label]) => (
                <Tooltip key={op} content={label} side="bottom">
                  <button
                    onClick={() => handleAlign(op as AlignOp)}
                    disabled={selectedIds.length === 0}
                    className="p-1.5 rounded hover:bg-white/10 text-gray-400 hover:text-gray-300 transition-colors disabled:opacity-30 disabled:cursor-not-allowed"
                  >
                    {icon}
                  </button>
                </Tooltip>
              ))}
              {/* Flip ops — operate on every selected layer, one undo
                  entry per click. Lit-state styling matches the
                  snap/alignment-mode toggles above so a flipped
                  selection reads at a glance. */}
              {([
                ['x', <FlipHorizontal2 size={14} />, 'Flip horizontally', (l: ThumbnailLayer) => !!l.flipX],
                ['y', <FlipVertical2 size={14} />,   'Flip vertically',   (l: ThumbnailLayer) => !!l.flipY],
              ] as const).map(([axis, icon, label, isLit]) => {
                const allSelectedAreFlipped =
                  selectedIds.length > 0 &&
                  selectedIds.every(id => {
                    const l = layers.find(ll => ll.id === id)
                    return l ? isLit(l) : false
                  })
                return (
                  <Tooltip key={axis} content={label} side="bottom">
                    <button
                      onClick={() => handleFlip(axis)}
                      disabled={selectedIds.length === 0}
                      className={`p-1.5 rounded transition-colors disabled:opacity-30 disabled:cursor-not-allowed ${
                        allSelectedAreFlipped
                          ? 'bg-purple-600/30 text-purple-300'
                          : 'hover:bg-white/10 text-gray-400 hover:text-gray-300'
                      }`}
                    >
                      {icon}
                    </button>
                  </Tooltip>
                )
              })}
              <div className="w-px h-4 bg-white/10 mx-1" />
              {saveTemplateOpen ? (
                <div className="flex items-center gap-1">
                  <input
                    ref={saveTemplateInputRef}
                    type="text"
                    value={saveTemplateName}
                    onChange={e => setSaveTemplateName(e.target.value)}
                    onKeyDown={e => {
                      if (e.key === 'Enter') commitSaveTemplate()
                      if (e.key === 'Escape') setSaveTemplateOpen(false)
                    }}
                    placeholder="Template name…"
                    className="h-6 px-2 rounded-lg bg-navy-900 border border-purple-500/50 text-xs text-gray-200 placeholder-gray-600 outline-none focus:border-purple-400 w-36"
                  />
                  <button
                    onClick={commitSaveTemplate}
                    disabled={!saveTemplateName.trim()}
                    className="p-1 rounded bg-purple-600 hover:bg-purple-500 text-white disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
                  >
                    <Check size={12} />
                  </button>
                  <button
                    onClick={() => setSaveTemplateOpen(false)}
                    className="p-1 rounded hover:bg-white/10 text-gray-400 hover:text-gray-300 transition-colors"
                  >
                    <X size={12} />
                  </button>
                </div>
              ) : (
                <Tooltip content="Save as template" side="bottom">
                  <button
                    onClick={openSaveTemplate}
                    disabled={!config.streamsDir}
                    className="p-1.5 rounded hover:bg-white/10 text-gray-400 hover:text-gray-200 disabled:opacity-30 disabled:cursor-not-allowed transition-colors"
                  >
                    <BookMarked size={14} />
                  </button>
                </Tooltip>
              )}
              <Tooltip
                content={missingFonts.length > 0
                  ? `Export paused — missing font${missingFonts.length > 1 ? 's' : ''}: ${missingFonts.join(', ')}`
                  : 'Export PNG'}
                side="bottom"
              >
                <button
                  onClick={exportPng}
                  disabled={missingFonts.length > 0}
                  className="p-1.5 rounded hover:bg-white/10 text-gray-400 hover:text-gray-200 disabled:opacity-30 disabled:cursor-not-allowed transition-colors"
                >
                  <Download size={14} />
                </button>
              </Tooltip>
              {currentTemplateId && !currentStream && (
                <Button variant="primary" size="sm" icon={<Check size={12} />} onClick={updateCurrentTemplate} disabled={!isDirty}>
                  Update template
                </Button>
              )}
              {/* Delete-thumbnail control moved to the header next to
                  the variant switcher — both manage "which / how many
                  thumbnails for this stream", so they belong in the
                  same zone instead of the toolbar's canvas-ops band. */}
              {/* Close session — right-most control, mirroring the
                  Player page's red close-session button. Set off from
                  the canvas-ops band by a divider; collapses to
                  icon-only below ~1300px viewport (animated). */}
              <div className="w-px h-4 bg-white/10 mx-1" />
              <Tooltip content="Close session" side="bottom">
                <Button
                  variant="danger"
                  size="sm"
                  icon={closingSession ? <Loader2 size={14} className="animate-spin" /> : <X size={14} />}
                  onClick={() => void closeSession()}
                  disabled={closingSession}
                  collapsibleLabel="min-[1300px]:grid-cols-[1fr] min-[1300px]:ms-0"
                >
                  {closingSession ? 'Closing session…' : 'Close session'}
                </Button>
              </Tooltip>
            </div>
          </div>

          {/* Template sessions used to feel like a dead end for users who
              didn't know how templates get USED — one quiet line closes the
              loop. (Chosen over an "assign to stream" flow: thumbnails are
              authored per-stream, where merge fields resolve and the
              stream's assets are available.) */}
          {currentTemplateId && !currentStream && (
            <div className="px-4 py-1.5 border-b border-white/5 text-[11px] text-gray-400 shrink-0">
              You're editing a template. To use it on a stream: open the stream item's thumbnail
              from the Streams page and pick this template as its starting point.
            </div>
          )}

          {/* Missing-font warning — while any text layer references a font
              that isn't installed, thumbnail image writes are paused (layer
              data keeps saving). Resolves itself the moment every text
              layer uses an installed family. */}
          {missingFonts.length > 0 && (
            <div className="flex items-start gap-2 px-4 py-2 border-b border-amber-500/30 bg-amber-500/10 text-xs text-amber-300 shrink-0">
              <AlertTriangle size={13} className="shrink-0 mt-0.5" />
              <span className="flex-1 min-w-0">
                {missingFonts.length === 1
                  ? <>The font <span className="font-semibold">{missingFonts[0]}</span> isn't installed on this machine — its text is showing in a substitute font.</>
                  : <>The fonts <span className="font-semibold">{missingFonts.join(', ')}</span> aren't installed on this machine — their text is showing in substitute fonts.</>}
                {' '}Thumbnail image updates are paused so the saved image isn't overwritten with the wrong font (your layer edits are still being saved). Pick a replacement font to resume.
              </span>
              {currentStream && (
                <Tooltip content="Write the thumbnail image once with the substitute font. Automatic updates stay paused." side="bottom">
                  <button
                    onClick={() => void forcePngExportOnce()}
                    disabled={forceExporting}
                    className="shrink-0 flex items-center gap-1.5 px-2 py-1 rounded border border-amber-500/40 text-amber-300 hover:bg-amber-500/15 disabled:opacity-50 disabled:cursor-not-allowed transition-colors text-[11px] font-medium"
                  >
                    {forceExporting && <Loader2 size={11} className="animate-spin" />}
                    {forceExporting ? 'Exporting…' : 'Manually export anyway'}
                  </button>
                </Tooltip>
              )}
            </div>
          )}

          {/* Editor body */}
          <div className="flex flex-1 overflow-hidden min-h-0">
            {/* Left tool panel */}
            <div className="w-12 flex flex-col items-center gap-1 py-2 border-r border-white/5 bg-navy-800 shrink-0">
              <Tooltip content="Add image" side="right">
                <button
                  onClick={addImageLayer}
                  className="p-2 rounded hover:bg-white/10 text-gray-400 hover:text-gray-200 transition-colors"
                >
                  <ImageIcon size={16} />
                </button>
              </Tooltip>
              <Tooltip content="Add text" side="right">
                <button
                  onClick={addTextLayer}
                  className="p-2 rounded hover:bg-white/10 text-gray-400 hover:text-gray-200 transition-colors"
                >
                  <Type size={16} />
                </button>
              </Tooltip>
              <div className="w-6 h-px bg-white/10 my-1" />
              <Tooltip content="Add rectangle" side="right">
                <button onClick={() => addShapeLayer('rect')} className="p-2 rounded hover:bg-white/10 text-gray-400 hover:text-gray-200 transition-colors">
                  <Square size={16} />
                </button>
              </Tooltip>
              <Tooltip content="Add ellipse" side="right">
                <button onClick={() => addShapeLayer('ellipse')} className="p-2 rounded hover:bg-white/10 text-gray-400 hover:text-gray-200 transition-colors">
                  <Circle size={16} />
                </button>
              </Tooltip>
              <Tooltip content="Add triangle" side="right">
                <button onClick={() => addShapeLayer('triangle')} className="p-2 rounded hover:bg-white/10 text-gray-400 hover:text-gray-200 transition-colors">
                  <Triangle size={16} />
                </button>
              </Tooltip>
            </div>

            {/* Canvas center */}
            <div
              ref={canvasContainerRef}
              className="flex-1 overflow-hidden relative min-w-0"
              style={{ background: 'var(--color-bg)', cursor: isPanning ? 'grabbing' : undefined }}
              onDragOver={e => {
                // Only accept drops carrying our asset payload. preventDefault
                // is required for the drop to fire.
                if (!e.dataTransfer.types.includes('application/x-thumbnail-asset')) return
                e.preventDefault()
                e.dataTransfer.dropEffect = 'copy'
              }}
              onDrop={e => {
                const sourcePath = e.dataTransfer.getData('application/x-thumbnail-asset')
                if (!sourcePath) return
                e.preventDefault()
                // Convert client coords → canvas (stage) coords using current pan/zoom.
                const rect = canvasContainerRef.current?.getBoundingClientRect()
                if (!rect) return
                const sx = e.clientX - rect.left
                const sy = e.clientY - rect.top
                const cx = (sx - viewPanRef.current.x) / viewZoomRef.current
                const cy = (sy - viewPanRef.current.y) / viewZoomRef.current
                addImageLayerFromPath(sourcePath, { x: cx, y: cy }).catch(() => {})
              }}
            >
              <Stage
                ref={stageRef}
                width={containerSize.w}
                height={containerSize.h}
                scaleX={viewZoom}
                scaleY={viewZoom}
                x={viewPan.x}
                y={viewPan.y}
                style={{ display: 'block' }}
                onClick={handleStageClick}
              >
                {/* Background layer: checkerboard + canvas border — excluded from export */}
                <Layer ref={bgLayerRef} listening={false}>
                  <KonvaRect
                    x={0} y={0} width={CANVAS_W} height={CANVAS_H}
                    fillPatternImage={checkerPatternCanvas as unknown as HTMLImageElement}
                    fillPatternRepeat="repeat"
                    listening={false}
                  />
                  <KonvaRect
                    x={0} y={0} width={CANVAS_W} height={CANVAS_H}
                    stroke="rgba(255,255,255,0.12)" strokeWidth={1 / viewZoom}
                    listening={false}
                  />
                </Layer>
                {/* Content layer */}
                <Layer>
                  {renderLayers.map(layer => {
                    const props: KonvaLayerNodeProps = {
                      layer,
                      isSelected: selectedIds.includes(layer.id),
                      onSelect: handleLayerSelect,
                      onChange: updateLayer,
                      scale: viewZoom,
                      onDragStart: handleDragStart,
                      onSnapDragMove: handleSnapDragMove,
                      onDragEnd: handleDragEnd,
                      onTransformEnd: handleTransformEnd,
                      onClearGuides: clearSnapGuides,
                      gridSnapEnabled,
                      mergeFields: mergeFieldValues,
                    }
                    if (layer.type === 'image') return <ImageNode key={layer.id} {...props} />
                    if (layer.type === 'shape') return <ShapeNode key={layer.id} {...props} />
                    return <TextNode key={layer.id} {...props} />
                  })}
                </Layer>
                {/* Off-canvas matte: darkens content that falls outside the work area.
                    Excluded from export — the matte's sceneFunc closes over
                    viewPan/viewZoom at render time, so when the export logic
                    resets the stage transform, the matte's outer rect can land
                    partially over the canvas and bleed into the saved PNG. */}
                <Layer ref={matteLayerRef} listening={false}>
                  {(() => {
                    const vx0 = -viewPan.x / viewZoom
                    const vy0 = -viewPan.y / viewZoom
                    const vx1 = (containerSize.w - viewPan.x) / viewZoom
                    const vy1 = (containerSize.h - viewPan.y) / viewZoom
                    return (
                      <KonvaShape
                        listening={false}
                        fill={rgba.bg(0.9)}
                        sceneFunc={(ctx, shape) => {
                          ctx.beginPath()
                          // Outer rect: visible viewport, clockwise in screen-Y-down space
                          ctx.moveTo(vx0, vy0)
                          ctx.lineTo(vx1, vy0)
                          ctx.lineTo(vx1, vy1)
                          ctx.lineTo(vx0, vy1)
                          ctx.closePath()
                          // Inner rect: canvas hole, counter-clockwise → punched out by nonzero winding
                          ctx.moveTo(0, 0)
                          ctx.lineTo(0, CANVAS_H)
                          ctx.lineTo(CANVAS_W, CANVAS_H)
                          ctx.lineTo(CANVAS_W, 0)
                          ctx.closePath()
                          ctx.fillStrokeShape(shape)
                        }}
                      />
                    )
                  })()}
                </Layer>
                {/* Transformer layer: hosts the shared selection handles
                    above the matte so they remain bright. One Transformer
                    is attached to every selected node — see the sync
                    useEffect that calls transformerRef.current.nodes(...). */}
                <Layer ref={transformerLayerRef}>
                  {alignAnchorBbox && (
                    <KonvaRect
                      x={alignAnchorBbox.x}
                      y={alignAnchorBbox.y}
                      width={alignAnchorBbox.width}
                      height={alignAnchorBbox.height}
                      stroke="#a78bfa"
                      strokeWidth={3 / viewZoom}
                      dash={[10 / viewZoom, 5 / viewZoom]}
                      listening={false}
                    />
                  )}
                  <Transformer
                    ref={transformerRef}
                    rotateEnabled
                    // Disable Konva's drag-past-the-opposite-handle flip
                    // gesture. We have explicit flip buttons + signed
                    // W/H inputs, so a stray cross-over flip while
                    // dragging the resize handles of an already-flipped
                    // layer is unwanted (and one of the sources of
                    // the rotation/position glitch the Transformer
                    // produces on negative-scaled nodes).
                    flipEnabled={false}
                    boundBoxFunc={(oldBox, newBox) => {
                      // Reconstruct the resize ourselves from the active handle
                      // + our own modifier policy, so Konva's built-in
                      // Alt=centered behavior is ignored: Ctrl/Cmd drives
                      // centered scaling, Alt does nothing (reserved for
                      // Alt+drag duplicate). The dragged anchor's edge in newBox
                      // follows the cursor regardless of Konva's centering, so
                      // we read that and rebuild around our chosen origin.
                      const anchorName = transformerRef.current?.getActiveAnchor() ?? ''
                      const centered = ctrlPressedRef.current
                      const dragsLeft = anchorName.includes('left')
                      const dragsRight = anchorName.includes('right')
                      const dragsTop = anchorName.includes('top')
                      const dragsBottom = anchorName.includes('bottom')

                      // Not a resize (rotation / unknown handle) — pass Konva's
                      // box straight through the per-edge snapper.
                      if (!dragsLeft && !dragsRight && !dragsTop && !dragsBottom) {
                        return handleSnapTransformBoundBox(oldBox, {
                          ...newBox,
                          width: Math.max(10, newBox.width),
                          height: Math.max(10, newBox.height),
                        })
                      }

                      // Reference everything off the gesture-start box (captured
                      // on the first frame), not the per-frame oldBox. This is
                      // what lets a mid-drag Shift/Ctrl change recompute the
                      // whole transform as if the key had been held from the
                      // start instead of baking a distorted frame into the base.
                      // Clone so a reused/mutated oldBox object can't drift our
                      // captured baseline mid-gesture.
                      const start = resizeStartBoxRef.current ?? { ...oldBox }
                      resizeStartBoxRef.current = start

                      const startR = start.x + start.width
                      const startB = start.y + start.height
                      const startCx = start.x + start.width / 2
                      const startCy = start.y + start.height / 2

                      let bx = start.x, by = start.y, bw = start.width, bh = start.height
                      if (dragsLeft || dragsRight) {
                        const cursorX = dragsLeft ? newBox.x : newBox.x + newBox.width
                        if (centered) { bw = Math.max(10, Math.abs(cursorX - startCx) * 2); bx = startCx - bw / 2 }
                        else if (dragsLeft) { bx = Math.min(cursorX, startR - 10); bw = startR - bx }
                        else { bw = Math.max(10, cursorX - start.x) }
                      }
                      if (dragsTop || dragsBottom) {
                        const cursorY = dragsTop ? newBox.y : newBox.y + newBox.height
                        if (centered) { bh = Math.max(10, Math.abs(cursorY - startCy) * 2); by = startCy - bh / 2 }
                        else if (dragsTop) { by = Math.min(cursorY, startB - 10); bh = startB - by }
                        else { bh = Math.max(10, cursorY - start.y) }
                      }
                      const constrained: KonvaBox = { x: bx, y: by, width: Math.max(10, bw), height: Math.max(10, bh), rotation: newBox.rotation }

                      // Anchor the ratio re-derive + snapper grow the box from.
                      let ratioAnchors: { h: 'left' | 'right' | 'center'; v: 'top' | 'bottom' | 'center' } | null = null
                      const sel = selectedIdsRef.current
                      // Aspect-ratio lock decision:
                      //   • Single non-text layer → its own aspectLocked (default
                      //     true); Shift inverts for this gesture.
                      //   • Multi-select → scale the whole group uniformly so
                      //     every layer keeps its aspect + relative position.
                      //     Locked by default; Shift inverts. Rotated members are
                      //     excluded here — the Transformer's keepRatio already
                      //     forces them uniform (a non-uniform group scale would
                      //     skew a rotated child), and an all-text group only
                      //     resizes horizontally so there's no ratio to hold.
                      let effectiveLock = false
                      if (sel.length === 1) {
                        const l = layers.find(ll => ll.id === sel[0])
                        // Text height is font-driven — never resize it vertically.
                        if (l?.type === 'text') { constrained.height = start.height; constrained.y = start.y }
                        else if (l) effectiveLock = (l.aspectLocked ?? true) !== shiftPressedRef.current
                      } else if (sel.length > 1) {
                        const selLayers = layers.filter(ll => sel.includes(ll.id))
                        const allText = selLayers.length > 0 && selLayers.every(ll => ll.type === 'text')
                        const anyRotated = selLayers.some(ll => (ll.rotation ?? 0) !== 0)
                        if (!allText && !anyRotated) effectiveLock = !shiftPressedRef.current
                      }
                      if (effectiveLock) {
                        const ratio = start.height > 0 ? start.width / start.height : 1
                        // Origin: centered → both axes from center; else the
                        // dragged edge's opposite is fixed and any *derived*
                        // axis grows from center.
                        const hAnchor: 'left' | 'right' | 'center' = centered ? 'center' : dragsLeft ? 'right' : dragsRight ? 'left' : 'center'
                        const vAnchor: 'top' | 'bottom' | 'center' = centered ? 'center' : dragsTop ? 'bottom' : dragsBottom ? 'top' : 'center'
                        const dragsH = dragsLeft || dragsRight
                        const dragsV = dragsTop || dragsBottom
                        // Uniform scale: a corner projects the cursor box
                        // (cw, ch) onto the line w = ratio·h (continuous, no
                        // mid-drag axis flip); a side handle is driven by its
                        // single changing dimension.
                        let s: number
                        if (dragsH && dragsV) {
                          const cw = constrained.width
                          const ch = constrained.height
                          s = Math.max(10, (ratio * cw + ch) / (ratio * ratio + 1)) / start.height
                        } else if (dragsH) {
                          s = constrained.width / start.width
                        } else {
                          s = constrained.height / start.height
                        }
                        const nw = Math.max(10, start.width * s)
                        const nh = Math.max(10, start.height * s)
                        constrained.width = nw
                        constrained.height = nh
                        constrained.x = hAnchor === 'left' ? start.x : hAnchor === 'right' ? startR - nw : startCx - nw / 2
                        constrained.y = vAnchor === 'top' ? start.y : vAnchor === 'bottom' ? startB - nh : startCy - nh / 2
                        ratioAnchors = { h: hAnchor, v: vAnchor }
                      }
                      // Ratio-locked + smart snap → single-scale snapper that
                      // keeps the ratio intact. Everything else (freeform, grid,
                      // or no snap) uses the per-edge snapper.
                      if (ratioAnchors && smartSnapEnabled) {
                        return handleRatioLockedSnap(start, constrained, ratioAnchors.h, ratioAnchors.v)
                      }
                      return handleSnapTransformBoundBox(start, constrained)
                    }}
                  />
                </Layer>
                <Layer ref={guideLayerRef} listening={false} />
              </Stage>

              {/* Zoom badge + quick-zoom buttons. Outer container stays
                  pointer-events-none so the badge area doesn't block canvas
                  clicks; the inner button row opts back in. */}
              <div className="absolute bottom-3 left-3 flex items-center gap-1.5 pointer-events-none">
                <span className="text-[10px] tabular-nums bg-black/50 text-gray-400 px-1.5 py-0.5 rounded">
                  {Math.round(viewZoom * 100)}%
                  {Math.abs(viewZoom - fitScale) < 0.001 && <span className="text-gray-400 ml-1">fit</span>}
                  {Math.abs(viewZoom - 1) < 0.001 && <span className="text-gray-400 ml-1">1:1</span>}
                </span>
                <div className="flex items-center gap-0.5 pointer-events-auto">
                  {([0.5, 0.75, 1] as const).map(z => {
                    const active = Math.abs(viewZoom - z) < 0.001
                    return (
                      <button
                        key={z}
                        onClick={() => setZoomCentered(z)}
                        className={`text-[10px] tabular-nums px-1.5 py-0.5 rounded transition-colors ${
                          active ? 'bg-purple-600/30 text-purple-200' : 'bg-black/50 text-gray-400 hover:text-gray-200'
                        }`}
                      >
                        {Math.round(z * 100)}%
                      </button>
                    )
                  })}
                  <button
                    onClick={() => setZoomCentered(fitScale)}
                    className={`text-[10px] px-1.5 py-0.5 rounded transition-colors ${
                      Math.abs(viewZoom - fitScale) < 0.001 ? 'bg-purple-600/30 text-purple-200' : 'bg-black/50 text-gray-400 hover:text-gray-200'
                    }`}
                  >
                    Fit
                  </button>
                  <Tooltip content="Reset zoom to 100% and re-center">
                  <button
                    onClick={() => setZoomCentered(1)}
                    className="p-1 rounded bg-black/50 text-gray-400 hover:text-gray-200 transition-colors"
                  >
                    <RotateCcw size={11} />
                  </button>
                  </Tooltip>
                </div>
              </div>
            </div>

            {/* Right panel: Layers + Assets + Properties */}
            <div className="w-64 flex flex-col border-l border-white/5 bg-navy-800 shrink-0 overflow-hidden">
              {/* Layers */}
              <div className="flex flex-col" style={{ minHeight: 0, flex: '0 0 auto', maxHeight: '30%' }}>
                <div className="flex items-center justify-between px-3 py-2 border-b border-white/5 shrink-0">
                  <span className="text-[10px] uppercase tracking-wider text-gray-400 font-semibold">Layers</span>
                  <span className="text-[10px] text-gray-400">{layers.length}</span>
                </div>
                <div className="overflow-y-auto flex-1">
                  {(() => {
                    const displayLayers = [...layers].reverse()
                    return displayLayers.map((layer, displayIdx) => {
                      const isSelected = selectedIds.includes(layer.id)
                      const isRenaming = renamingLayerId === layer.id
                      const isDragging = draggingLayerId === layer.id
                      return (
                        <React.Fragment key={layer.id}>
                          {dropTargetDisplayIdx === displayIdx && (
                            <div className="h-0.5 bg-purple-500" />
                          )}
                          <div
                            draggable={!isRenaming}
                            onDragStart={e => {
                              setDraggingLayerId(layer.id)
                              e.dataTransfer.effectAllowed = 'move'
                              // Required for drag to work in some browsers; the
                              // payload is unused since we track via state.
                              e.dataTransfer.setData('text/plain', layer.id)
                            }}
                            onDragOver={e => {
                              if (!draggingLayerId || draggingLayerId === layer.id) return
                              e.preventDefault()
                              e.dataTransfer.dropEffect = 'move'
                              const rect = e.currentTarget.getBoundingClientRect()
                              const above = e.clientY < rect.top + rect.height / 2
                              setDropTargetDisplayIdx(above ? displayIdx : displayIdx + 1)
                            }}
                            onDragLeave={e => {
                              // Only clear when leaving the entire row, not when
                              // crossing into a child element.
                              const related = e.relatedTarget as Node | null
                              if (related && e.currentTarget.contains(related)) return
                              // Don't clear if we're moving onto another row that
                              // will set its own target — let onDragOver of the
                              // next row override us.
                            }}
                            onDrop={e => {
                              e.preventDefault()
                              if (draggingLayerId && dropTargetDisplayIdx !== null) {
                                reorderLayer(draggingLayerId, dropTargetDisplayIdx)
                              }
                              setDraggingLayerId(null)
                              setDropTargetDisplayIdx(null)
                            }}
                            onDragEnd={() => {
                              setDraggingLayerId(null)
                              setDropTargetDisplayIdx(null)
                            }}
                            onClick={e => { if (!isRenaming) handleLayerRowClick(layer.id, e) }}
                            className={`flex items-center gap-1.5 px-2 py-1.5 ${isRenaming ? '' : 'cursor-pointer'} group border-b border-white/5 ${isSelected ? 'bg-purple-600/20' : 'hover:bg-white/5'} ${isDragging ? 'opacity-40' : ''}`}
                          >
                            <Tooltip content={layer.visible ? 'Hide layer' : 'Show layer'} side="top">
                              <button
                                onClick={e => { e.stopPropagation(); updateLayer({ ...layer, visible: !layer.visible }) }}
                                className="text-gray-400 hover:text-gray-300 shrink-0"
                              >
                                {layer.visible ? <Eye size={12} /> : <EyeOff size={12} className="text-gray-400" />}
                              </button>
                            </Tooltip>
                            {isRenaming ? (
                              <input
                                autoFocus
                                defaultValue={layer.name}
                                onClick={e => e.stopPropagation()}
                                onFocus={e => e.currentTarget.select()}
                                onBlur={e => {
                                  const next = e.target.value.trim()
                                  if (next && next !== layer.name) updateLayer({ ...layer, name: next })
                                  setRenamingLayerId(null)
                                }}
                                onKeyDown={e => {
                                  if (e.key === 'Enter') { e.preventDefault(); e.currentTarget.blur() }
                                  else if (e.key === 'Escape') { e.preventDefault(); setRenamingLayerId(null) }
                                }}
                                className="flex-1 min-w-0 bg-navy-900 border border-purple-500/60 rounded px-1.5 py-0 text-xs text-gray-200 focus:outline-none"
                              />
                            ) : (
                              <span
                                onDoubleClick={e => { e.stopPropagation(); setRenamingLayerId(layer.id) }}
                                className="flex-1 text-xs text-gray-400 truncate cursor-text"
                              >
                                {layer.name}
                              </span>
                            )}
                            {layer.type === 'text' && fontsLoaded && !installedFontSet.has(layer.fontFamily ?? 'Arial') && (
                              <Tooltip content={`Font "${layer.fontFamily ?? 'Arial'}" is not installed`}>
                                <AlertTriangle size={11} className="text-amber-400 shrink-0" />
                              </Tooltip>
                            )}
                            <div className={`flex gap-0.5 opacity-0 group-hover:opacity-100 ${isSelected ? 'opacity-100' : ''} transition-opacity`}>
                              <Tooltip content="Duplicate layer" side="top">
                                <button onClick={e => { e.stopPropagation(); duplicateLayer(layer.id) }} className="p-0.5 rounded hover:bg-white/10 text-gray-400 hover:text-gray-300">
                                  <Copy size={10} />
                                </button>
                              </Tooltip>
                              <Tooltip content="Delete layer" side="top">
                                <button onClick={e => { e.stopPropagation(); commitLayers(layers.filter(l => l.id !== layer.id)); setSelectedIds([]) }} className="p-0.5 rounded hover:bg-red-500/20 text-gray-400 hover:text-red-400">
                                  <Trash2 size={10} />
                                </button>
                              </Tooltip>
                            </div>
                          </div>
                          {displayIdx === displayLayers.length - 1 && dropTargetDisplayIdx === displayLayers.length && (
                            <div className="h-0.5 bg-purple-500" />
                          )}
                        </React.Fragment>
                      )
                    })
                  })()}
                </div>
              </div>

              {/* Divider */}
              <div className="border-t border-white/10 shrink-0" />

              {/* Properties */}
              <div className="flex flex-col flex-1 overflow-hidden min-h-0">
                <div className="flex items-center gap-1.5 px-3 py-2 border-b border-white/5 shrink-0">
                  <Sliders size={11} className="text-gray-400" />
                  <span className="text-[10px] uppercase tracking-wider text-gray-400 font-semibold">Properties</span>
                </div>
                <PropertiesPanel layer={selectedLayer} onChange={updateLayer} onLiveChange={liveUpdateLayer} systemFonts={systemFonts} fontVariantMap={fontVariantMap} fontsLoaded={fontsLoaded} standalone={currentStream?.meta?.isSeries === false} />
              </div>

              {/* Divider */}
              <div className="border-t border-white/10 shrink-0" />

              {/* Assets — images from the current stream's folder + same-season
                  episodes. Drag a thumbnail onto the canvas to add it as an
                  image layer. */}
              {/* While assets are still being detected the list has no content
                  to size against — without the explicit height the panel
                  collapsed to zero and the header sat at the sidebar's bottom.
                  Reserve the default height and show a spinner instead. */}
              <div className="flex flex-col" style={{ minHeight: 0, flex: '0 0 auto', maxHeight: '35%', ...(!assetsCollapsed && !seasonAssets ? { height: '35%' } : {}) }}>
                {/* Fixed h-8 (not padding-derived): the options button's box is
                    1px taller than the text line, so a padded row grew when it
                    rendered and shrank when collapse hid it. */}
                <div className="relative flex items-center gap-1.5 px-3 h-8 border-b border-white/5 shrink-0">
                  {/* Collapse chevron — LEFT of the panel title, per the
                      style guide's panel-collapse convention. Panel-header
                      variant: fills the row's full height, flush to the left
                      edge, square, unrounded. */}
                  <Tooltip
                    content={assetsCollapsed ? 'Expand asset panel' : 'Collapse asset panel'}
                    triggerClassName="self-stretch -ml-3 flex"
                  >
                    <button
                      type="button"
                      onClick={toggleAssetsCollapsed}
                      className="h-full aspect-square flex items-center justify-center text-gray-400 hover:text-gray-200 hover:bg-white/5 transition-colors"
                    >
                      {assetsCollapsed ? <ChevronRight size={14} /> : <ChevronDown size={14} />}
                    </button>
                  </Tooltip>
                  <ImageIcon size={11} className="text-gray-400" />
                  <span className="text-[10px] uppercase tracking-wider text-gray-400 font-semibold">Assets</span>
                  {/* flex wrapper + flex button: the SVG is inline by default,
                      so a block wrapper reserved baseline/descender space and
                      shoved the icon above center. */}
                  <div ref={assetOptionsRef} className={`ml-auto relative flex items-center${assetsCollapsed ? ' hidden' : ''}`}>
                    <Tooltip content="Asset sources">
                    <button
                      type="button"
                      onClick={() => setAssetOptionsOpen(o => !o)}
                      className={`p-0.5 rounded flex items-center justify-center transition-colors ${assetOptionsOpen ? 'text-gray-200 bg-white/10' : 'text-gray-400 hover:text-gray-200 hover:bg-white/5'}`}
                    >
                      <Sliders size={12} />
                    </button>
                    </Tooltip>
                    {assetOptionsOpen && (
                      <div className="absolute top-full right-0 mt-1 z-30 w-56 bg-navy-900 border border-white/10 rounded-lg shadow-xl p-1">
                        {(() => {
                          // Topic/Game implies season — when it's on, the
                          // season row is forced-checked + disabled.
                          const fromTopicGame = !!config.thumbnailAssetsFromTopicGame
                          const fromSeason = !!config.thumbnailAssetsFromSeason || fromTopicGame
                          const Row = ({ checked, disabled, onToggle, label }: { checked: boolean; disabled?: boolean; onToggle: () => void; label: string }) => (
                            <button
                              type="button"
                              disabled={disabled}
                              onClick={onToggle}
                              className={`w-full flex items-center gap-2 px-2 py-1.5 rounded text-left text-[11px] transition-colors ${disabled ? 'cursor-default opacity-60' : 'hover:bg-white/5'}`}
                            >
                              <span className={`w-3.5 h-3.5 rounded border flex items-center justify-center shrink-0 ${checked ? 'bg-purple-600/40 border-purple-500/60 text-purple-100' : 'border-white/20'}`}>
                                {checked && <Check size={10} strokeWidth={3} />}
                              </span>
                              <span className="text-gray-200">{label}</span>
                            </button>
                          )
                          return (
                            <>
                              <Row
                                checked={fromSeason}
                                disabled={fromTopicGame}
                                onToggle={() => updateConfig({ thumbnailAssetsFromSeason: !config.thumbnailAssetsFromSeason })}
                                label="Show assets from season"
                              />
                              <Row
                                checked={fromTopicGame}
                                onToggle={() => updateConfig({ thumbnailAssetsFromTopicGame: !fromTopicGame })}
                                label="Show assets from same Topic / Game"
                              />
                            </>
                          )
                        })()}
                      </div>
                    )}
                  </div>
                </div>
                {/* `hidden` (not unmount) so loaded asset thumbnails survive
                    a collapse/expand round-trip without refetching. */}
                <div className={`overflow-y-auto flex-1${assetsCollapsed ? ' hidden' : ''}`}>
                  {(() => {
                    if (!seasonAssets) {
                      return (
                        <div className="h-full flex items-center justify-center gap-2 text-[11px] text-gray-400">
                          <Loader2 size={14} className="animate-spin" /> Loading assets…
                        </div>
                      )
                    }
                    const groups: Array<{ key: string; label: string; sublabel?: string; date?: string; images: string[] }> = []
                    if (seasonAssets.current && seasonAssets.current.images.length > 0) {
                      groups.push({
                        key: seasonAssets.current.folderPath,
                        label: 'This stream',
                        sublabel: seasonAssets.current.title,
                        date: seasonAssets.current.date,
                        images: seasonAssets.current.images,
                      })
                    }
                    for (const g of seasonAssets.related) {
                      if (g.images.length === 0) continue
                      groups.push({
                        key: g.folderPath,
                        label: g.episode ? `Episode ${g.episode}` : g.date,
                        sublabel: g.title,
                        date: g.date,
                        images: g.images,
                      })
                    }
                    if (groups.length === 0) {
                      return <div className="px-3 py-3 text-[11px] text-gray-400">No images in this stream{seasonAssets.related.length > 0 ? ' or its season' : ''}.</div>
                    }
                    return groups.map(g => {
                      // Tooltip on the section header surfaces the full title
                      // (which gets `truncate`d in the panel), plus the date
                      // when the label is "Episode X" / "This stream" and
                      // doesn't already include it. Gated on having any
                      // content beyond the visible label so we don't show a
                      // redundant single-line tooltip.
                      const hasExtraInfo = !!g.sublabel || (g.date && g.date !== g.label)
                      const headerTooltip = hasExtraInfo ? (
                        <div className="flex flex-col gap-1 max-w-[300px]">
                          <div className="flex items-baseline gap-2">
                            <span className="text-[10px] uppercase tracking-wider text-gray-400 font-semibold">{g.label}</span>
                            {g.date && g.date !== g.label && (
                              <span className="text-[10px] text-gray-400 tabular-nums">{g.date}</span>
                            )}
                          </div>
                          {g.sublabel && <span className="text-xs text-gray-100 break-words">{g.sublabel}</span>}
                        </div>
                      ) : null
                      const header = (
                        <div className="px-3 pt-2 pb-1 flex flex-col gap-0.5">
                          <span className="text-[10px] uppercase tracking-wider text-gray-400 font-semibold">{g.label}</span>
                          {g.sublabel && <span className="text-[10px] text-gray-400 truncate">{g.sublabel}</span>}
                        </div>
                      )
                      return (
                      <div key={g.key} className="border-b border-white/5 last:border-b-0">
                        {headerTooltip
                          ? <Tooltip content={headerTooltip} side="left" triggerClassName="block">{header}</Tooltip>
                          : header}
                        <div className="px-2 pb-2 grid grid-cols-2 gap-1">
                          {g.images.map(p => {
                            const basename = p.split(/[\\/]/).pop() ?? p
                            const dims = assetDims.get(p)
                            const sizeBytes = assetSizes.get(p)
                            const sizeText = sizeBytes == null
                              ? null
                              : sizeBytes >= 1e9 ? `${(sizeBytes / 1e9).toFixed(1)} GB`
                              : sizeBytes >= 1e6 ? `${(sizeBytes / 1e6).toFixed(1)} MB`
                              : `${(sizeBytes / 1e3).toFixed(0)} KB`
                            const tooltipContent = (
                              <div className="flex flex-col gap-0.5">
                                <span className="font-mono text-[11px] text-gray-200 break-all">{basename}</span>
                                <span className="text-[10px] text-gray-400 tabular-nums">
                                  {dims ? `${dims.w} × ${dims.h}` : 'Loading…'}
                                  {sizeText && <span className="text-gray-500"> · {sizeText}</span>}
                                </span>
                              </div>
                            )
                            return (
                              <Tooltip key={p} content={tooltipContent} side="left">
                                <div className="group relative aspect-square bg-navy-900 border border-white/5 hover:border-purple-500/60 rounded overflow-hidden flex items-center justify-center transition-colors">
                                  <img
                                    src={`file://${p}`}
                                    alt=""
                                    draggable
                                    onLoad={e => {
                                      const img = e.currentTarget
                                      const w = img.naturalWidth, h = img.naturalHeight
                                      setAssetDims(prev => {
                                        if (prev.get(p)?.w === w && prev.get(p)?.h === h) return prev
                                        const next = new Map(prev)
                                        next.set(p, { w, h })
                                        return next
                                      })
                                    }}
                                    onDragStart={e => {
                                      e.dataTransfer.setData('application/x-thumbnail-asset', p)
                                      e.dataTransfer.effectAllowed = 'copy'
                                    }}
                                    className="max-w-full max-h-full object-contain cursor-grab active:cursor-grabbing"
                                  />
                                  {/* Hover overlay — fades in on tile hover, hosts
                                      quick "+ add as layer" and "trash" actions
                                      so the user doesn't have to drag-and-drop or
                                      open the file in Explorer. Pointer-events
                                      stay off until visible to keep the drag
                                      affordance on the image itself unimpeded. */}
                                  <div className="absolute inset-0 bg-black/55 opacity-0 group-hover:opacity-100 transition-opacity flex items-center justify-center gap-1.5 pointer-events-none group-hover:pointer-events-auto">
                                    <Tooltip content="Add as layer">
                                    <button
                                      type="button"
                                      onClick={e => { e.stopPropagation(); addImageLayerFromPath(p).catch(() => {}) }}
                                      className="flex items-center justify-center w-7 h-7 rounded-full bg-white/10 hover:bg-purple-600/60 border border-white/20 hover:border-purple-400/70 text-gray-200 hover:text-white transition-colors"
                                    >
                                      <Plus size={14} />
                                    </button>
                                    </Tooltip>
                                    <Tooltip content="Move to Recycle Bin">
                                    <button
                                      type="button"
                                      onClick={e => { e.stopPropagation(); setAssetDeleteTarget(p) }}
                                      className="flex items-center justify-center w-7 h-7 rounded-full bg-white/10 hover:bg-red-600/60 border border-white/20 hover:border-red-400/70 text-gray-200 hover:text-white transition-colors"
                                    >
                                      <Trash2 size={14} />
                                    </button>
                                    </Tooltip>
                                  </div>
                                </div>
                              </Tooltip>
                            )
                          })}
                        </div>
                      </div>
                      )
                    })
                  })()}
                </div>
              </div>
            </div>
          </div>

          {/* Asset-panel image delete confirmation. Same visual treatment as
              the SM thumbnail delete modal — small, warning-themed, single
              Cancel + red Delete button. Uses the shared trashFile IPC so
              the file lands in the user's Recycle Bin (recoverable). When
              the target is the stream item's preferred thumbnail, a warning
              banner surfaces and on confirm the meta is auto-cleared so the
              row doesn't end up pointing at a ghost file.
              Canvas layers are unaffected by deletion — addImageLayerFromPath
              caches each source into _thumbnail-assets/images/<hash> and
              stores the cached path on the layer, so the original can vanish
              without breaking the canvas. */}
          {assetDeleteTarget && (() => {
            const targetBasename = assetDeleteTarget.split(/[\\/]/).pop() ?? ''
            const isPreferredThumb = !!currentStream
              && (currentStream.meta?.preferredThumbnail ?? '') === targetBasename
            return (
            <div className="absolute inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm">
              <div className="bg-navy-800 border border-white/10 rounded-xl shadow-2xl w-[420px] flex flex-col overflow-hidden">
                <div className="flex items-start gap-3 px-5 pt-5 pb-4">
                  <div className="shrink-0 mt-0.5 p-2 rounded-lg bg-red-500/15">
                    <AlertTriangle size={18} className="text-red-400" />
                  </div>
                  <div className="min-w-0">
                    <h2 className="text-sm font-semibold text-gray-200 mb-1">Move image to Recycle Bin?</h2>
                    <p className="text-xs text-gray-400 leading-relaxed mb-2">
                      The following file will be moved to your Recycle Bin:
                    </p>
                    <p className="text-[11px] text-gray-300 font-mono break-all bg-white/5 rounded px-2 py-1">
                      {targetBasename}
                    </p>
                    {isPreferredThumb && (
                      <div className="mt-3 flex items-start gap-1.5 px-3 py-2 rounded-lg bg-amber-500/10 border border-amber-500/30 text-xs text-amber-200 leading-relaxed">
                        <AlertTriangle size={12} className="shrink-0 mt-0.5" />
                        <span>
                          This image is currently set as the stream item's thumbnail.
                          Deleting it will fall back to another image and clear the
                          preferred-thumbnail setting.
                        </span>
                      </div>
                    )}
                    <p className="text-xs text-gray-400 mt-2">This action can be undone from the Recycle Bin.</p>
                  </div>
                </div>
                <div className="flex items-center justify-end gap-2 px-5 py-3 border-t border-white/10">
                  <Button variant="ghost" size="sm" onClick={() => setAssetDeleteTarget(null)}>
                    Cancel
                  </Button>
                  <Button variant="primary" size="sm" icon={<Trash2 size={12} />}
                    onClick={async () => {
                      const target = assetDeleteTarget
                      setAssetDeleteTarget(null)
                      try {
                        await window.api.trashFile(target)
                        // Auto-clear the meta pointer if we just trashed the
                        // preferred thumbnail. Empty string clears via the
                        // partial-merge IPC (undefined would be stripped by
                        // JSON serialization). Best-effort: a failure here
                        // doesn't undo the file delete, just leaves the meta
                        // dangling which the next open will fall back from.
                        if (isPreferredThumb && currentStream) {
                          await window.api.updateStreamMeta(
                            currentStream.folderPath,
                            { preferredThumbnail: '' },
                            streamMetaKey(currentStream.folderPath, currentStream.date, config.streamsDir),
                          ).catch(err => console.error('Failed to clear preferredThumbnail', err))
                        }
                        // Drop the dimensions/size cache entry for the deleted
                        // file so a re-created file at the same path doesn't
                        // show stale data, and bump the refresh trigger so the
                        // panel re-fetches without it.
                        setAssetDims(prev => { const n = new Map(prev); n.delete(target); return n })
                        setAssetSizes(prev => { const n = new Map(prev); n.delete(target); return n })
                        setAssetRefreshTrigger(t => t + 1)
                      } catch (err) {
                        console.error('Failed to trash asset image', err)
                      }
                    }}
                    className="bg-red-600 hover:bg-red-500 border-red-600 hover:border-red-500"
                  >
                    Delete
                  </Button>
                </div>
              </div>
            </div>
            )
          })()}

          {/* Delete thumbnail confirmation modal */}
          {deleteThumbOpen && currentStream && (
            <div className="absolute inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm">
              <div className="bg-navy-800 border border-white/10 rounded-xl shadow-2xl w-[420px] flex flex-col overflow-hidden">
                <div className="flex items-start gap-3 px-5 pt-5 pb-4">
                  <div className="shrink-0 mt-0.5 p-2 rounded-lg bg-red-500/15">
                    <AlertTriangle size={18} className="text-red-400" />
                  </div>
                  <div>
                    <h2 className="text-sm font-semibold text-gray-200 mb-1">Delete Stream Manager Thumbnail?</h2>
                    <p className="text-xs text-gray-400 leading-relaxed">
                      This will permanently delete the thumbnail canvas and exported image for{' '}
                      <span className="text-gray-200">{currentStream.title ?? currentStream.date}</span>.
                    </p>
                    <ul className="mt-2 flex flex-col gap-0.5">
                      <li className="text-[11px] text-gray-400 font-mono truncate">
                        {currentStream.date}_sm-thumbnail{currentVariant > 1 ? `-${currentVariant}` : ''}.json
                      </li>
                      <li className="text-[11px] text-gray-400 font-mono truncate">
                        {currentStream.date}_sm-thumbnail{currentVariant > 1 ? `-${currentVariant}` : ''}.png
                      </li>
                    </ul>
                    <p className="text-xs text-gray-400 mt-2">This cannot be undone.</p>
                  </div>
                </div>
                <div className="flex items-center justify-end gap-2 px-5 py-3 border-t border-white/10">
                  <Button variant="ghost" size="sm" onClick={() => setDeleteThumbOpen(false)}>
                    Cancel
                  </Button>
                  <Button variant="primary" size="sm" icon={<Trash2 size={12} />}
                    onClick={confirmDeleteThumbnail}
                    className="bg-red-600 hover:bg-red-500 border-red-600 hover:border-red-500"
                  >
                    Delete
                  </Button>
                </div>
              </div>
            </div>
          )}

          {/* Close-without-saving confirm — template sessions only. Templates
              are never autosaved (the whole point: experiments can be
              abandoned), so a dirty close gets the Save / Discard / Cancel
              choice. Mirrors the Settings page's unsaved-changes prompt. */}
          {confirmCloseTemplate && (
            <Modal
              isOpen
              onClose={() => { if (!closingSession) setConfirmCloseTemplate(false) }}
              title="Unsaved changes"
              width="sm"
              dismissible={!closingSession}
              footer={
                <>
                  <Button variant="ghost" size="sm" disabled={closingSession} onClick={() => setConfirmCloseTemplate(false)}>
                    Cancel
                  </Button>
                  <Button
                    variant="ghost"
                    size="sm"
                    disabled={closingSession}
                    onClick={() => {
                      setConfirmCloseTemplate(false)
                      saveEpochRef.current++
                      setIsDirty(false)
                      setCurrentTemplateId(undefined)
                      setMode('overview')
                    }}
                    className="text-red-400 hover:text-red-300"
                  >
                    Discard changes
                  </Button>
                  <Button
                    variant="primary"
                    size="sm"
                    loading={closingSession}
                    onClick={async () => {
                      setClosingSession(true)
                      try {
                        await updateCurrentTemplate()
                      } finally {
                        setConfirmCloseTemplate(false)
                        saveEpochRef.current++
                        setCurrentTemplateId(undefined)
                        setClosingSession(false)
                        setMode('overview')
                      }
                    }}
                  >
                    Save & close
                  </Button>
                </>
              }
            >
              <p className="text-sm text-gray-300">
                The template <span className="text-gray-100">{templates.find(t => t.id === currentTemplateId)?.name ?? 'you are editing'}</span> has
                unsaved changes. Templates only save when you click "Update template".
              </p>
            </Modal>
          )}
        </>
      )}

      {/* Template picker — used both for the initial-thumbnail flow
          (navigating from a stream with no canvas) AND for the "+ New
          thumbnail" alternative flow from the variant switcher.
          Rendered outside the mode ternary so it's available in
          either overview or editor mode. `targetVariant` on the
          picker stream distinguishes the two flows; both end at the
          same `confirmPickTemplate`. */}
      {templatePickerStream && (
        <div className="absolute inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm">
          <div className="bg-navy-800 border border-white/10 rounded-xl shadow-2xl w-[640px] max-h-[80vh] flex flex-col overflow-hidden">
            <div className="flex items-center justify-between gap-3 px-5 py-4 border-b border-white/10 shrink-0">
              {/* min-w-0 + flex-1 on the title wrapper so the truncate
                  rule has a real width constraint that follows the
                  modal's body width minus the close button, instead
                  of capping at an arbitrary 20rem (`max-w-xs`). */}
              <div className="min-w-0 flex-1">
                <h2 className="text-sm font-semibold text-gray-200 truncate">
                  {templatePickerStream.targetVariant && templatePickerStream.targetVariant > 1
                    ? 'Choose a template for the new thumbnail'
                    : 'Choose a starting template'}
                </h2>
                <p className="text-xs text-gray-400 mt-0.5 truncate">
                  {templatePickerStream.title ?? templatePickerStream.date}
                </p>
              </div>
              <button
                onClick={() => setTemplatePickerStream(null)}
                className="shrink-0 p-1.5 rounded hover:bg-white/10 text-gray-400 hover:text-gray-300 transition-colors"
              >
                <X size={15} />
              </button>
            </div>
            <div className="overflow-y-auto p-5 flex flex-col gap-4">
              {/* Cards SELECT (ring highlight); the footer's Create commits.
                  Selection ring is uniform across card types so the picked
                  option always reads the same way. */}
              <div className="grid grid-cols-3 gap-3">
                {/* "Duplicate current thumbnail" card — only available
                    in the new-alternative flow (targetVariant set)
                    AND when we have a current stream + layers to copy
                    from. Rendered first so it sits in the most visible
                    grid slot. Purple border + label make it visually
                    distinct from the template cards. */}
                {templatePickerStream.targetVariant
                  && templatePickerStream.targetVariant > 1
                  && currentStream
                  && layers.length > 0 && (
                  <div
                    className={`group bg-navy-900 border rounded-lg overflow-hidden cursor-pointer transition-colors ${
                      pickerChoice === 'duplicate' ? 'border-purple-400 ring-1 ring-purple-400/60' : 'border-purple-500/50 hover:border-purple-400'
                    }`}
                    onClick={() => setPickerChoice('duplicate')}
                  >
                    <div className="relative aspect-video bg-black">
                      <img
                        src={(() => {
                          const suffix = currentVariant <= 1 ? '' : `-${currentVariant}`
                          return `file://${currentStream.folderPath.replace(/\\/g, '/')}/${currentStream.date}_sm-thumbnail${suffix}.png?v=${variantPreviewKey}`
                        })()}
                        alt=""
                        className="w-full h-full object-cover"
                        onError={(e) => { (e.currentTarget as HTMLImageElement).style.visibility = 'hidden' }}
                      />
                    </div>
                    <div className="px-2 py-1.5">
                      <span className="text-xs text-purple-300 truncate block">Duplicate current</span>
                    </div>
                  </div>
                )}
                {templates.map(t => (
                  <div
                    key={t.id}
                    className={`group bg-navy-900 border rounded-lg overflow-hidden cursor-pointer transition-colors ${
                      pickerChoice === t.id ? 'border-purple-400 ring-1 ring-purple-400/60' : 'border-white/10 hover:border-purple-500/60'
                    }`}
                    onClick={() => setPickerChoice(t.id)}
                  >
                    <TemplatePreview streamsDir={config.streamsDir} templateId={t.id} name={t.name} cacheKey={t.updatedAt} />
                    <div className="px-2 py-1.5">
                      <span className="text-xs text-gray-300 truncate block">{t.name}</span>
                    </div>
                  </div>
                ))}
                {/* "Start blank" — same grid as the real options. Preview is
                    the editor canvas's checkerboard (colors/tile match
                    makeCheckerPattern) so it reads as "empty canvas". */}
                <div
                  className={`group bg-navy-900 border rounded-lg overflow-hidden cursor-pointer transition-colors ${
                    pickerChoice === 'blank' ? 'border-purple-400 ring-1 ring-purple-400/60' : 'border-white/10 hover:border-purple-500/60'
                  }`}
                  onClick={() => setPickerChoice('blank')}
                >
                  <div
                    className="aspect-video"
                    style={{
                      backgroundImage: 'repeating-conic-gradient(#1c1c28 0% 25%, #13131f 0% 50%)',
                      backgroundSize: '16px 16px',
                    }}
                  />
                  <div className="px-2 py-1.5">
                    <span className="text-xs text-gray-300 truncate block">Start blank</span>
                  </div>
                </div>
              </div>
            </div>
            <div className="px-5 py-3 border-t border-white/10 shrink-0 flex justify-end gap-2">
              <Button variant="ghost" size="sm" onClick={() => setTemplatePickerStream(null)}>
                Cancel
              </Button>
              <Button
                variant="primary"
                size="sm"
                disabled={!pickerChoice}
                onClick={() => {
                  if (pickerChoice === 'duplicate') duplicateCurrentToNewVariant()
                  else if (pickerChoice === 'blank') confirmPickTemplate(null)
                  else {
                    const t = templates.find(tt => tt.id === pickerChoice)
                    if (t) confirmPickTemplate(t)
                  }
                }}
              >
                Create
              </Button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
