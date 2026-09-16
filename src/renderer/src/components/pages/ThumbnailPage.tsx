import React, {
  useState, useEffect, useLayoutEffect, useRef, useCallback, useMemo, useContext, createContext, useSyncExternalStore,
} from 'react'
import { createPortal, flushSync } from 'react-dom'
import { Stage, Layer, Group as KonvaGroup, Image as KonvaImage, Text as KonvaText, Transformer, Rect as KonvaRect, Ellipse as KonvaEllipse, Shape as KonvaShape } from 'react-konva'
import useImage from 'use-image'
import Konva from 'konva'
import {
  Plus, Trash2, Eye, EyeOff,
  Image as ImageIcon, Type, Undo2, Redo2, Download,
  BookMarked, FolderOpen, LayoutTemplate, Sliders, RotateCcw, Copy,
  Magnet, Grid3x3, SquareDot, Check, X, AlertTriangle, Pencil, Link2, Unlink2,
  Square, Circle, Pentagon,
  Frame, BoxSelect,
  AlignStartVertical, AlignCenterVertical, AlignEndVertical,
  AlignStartHorizontal, AlignCenterHorizontal, AlignEndHorizontal,
  FlipHorizontal2, FlipVertical2,
  ChevronDown, ChevronRight, Loader2, Radio, Palette, Upload,
  Layers as LayersIcon,
  Group as GroupIcon, Ungroup as UngroupIcon, Folder, Blend, ArrowDown,
  Move, Shapes, PaintBucket, PenLine, SquareStack, SquareDashed, SlidersHorizontal,
  type LucideIcon,
} from 'lucide-react'
import { Button } from '../ui/Button'
import { Tooltip } from '../ui/Tooltip'
import { RecentRow, SmoothThumb } from '../ui/RecentRow'
import { NumberInput } from '../ui/Input'
import { AnchoredPanel } from '../ui/AnchoredPanel'
import { StreamNavButtons } from '../streams/StreamNavButtons'
import { seriesNavFor, type SeriesNav } from '../../lib/seriesNav'
import { buildKonvaColorStops, gradientLinePoints, cssGradientPreview, cssGradientOfKind, sampleGradientAt, DEFAULT_GRADIENT_GEOMETRY } from '../../lib/gradient'
import type { GradientStop, GradientColorSpace, GradientStyle, GradientKind, GradientGeometry } from '../../lib/gradient'
import { makeCanvasGradient } from '../../lib/canvasGradient'
import { normalizeLayers, polygonPoints, polygonMaxCornerRadius, polygonSidesOf, polygonSidesPatch, regularPolygonBox, tracePolygonPath, POLYGON_MIN_SIDES, POLYGON_MAX_SIDES, POLYGON_DEFAULT_SIDES } from '../../lib/polygon'
import {
  childrenOf, paintableLayers, selectionRoots, copySelection, insertPastedAbove, canGroup, groupLayers, ungroupLayer,
  deleteLayers, duplicateLayer as duplicateLayerTree, clonePasteLayers, moveLayerTo, moveAmongSiblings, scaleGroupMembers,
  snapResizedBox, needsUniformScale, panelRows, isGroup, hasHiddenAncestor, ancestorIds, subtreeIds,
  walkSelection, enterGroup, leaveGroup,
  isMask, maskOf, pinMasks, canBeGroupMask, setGroupMask, releaseGroupMask, insertGroupMask,
  canApplyAsMaskBelow, applyAsMaskBelow,
} from '../../lib/layerTree'
import { traceMaskPath, traceShapeOutlineLocal } from '../../lib/groupMask'
import type { PanelRow } from '../../lib/layerTree'
import { setLiveTransform, useLiveTransform, normalizeAngle } from '../../lib/liveTransform'
import { TemplateBodyEditor, MergeFieldPicker } from '../ui/TemplateBodyEditor'
import { useThumbnailEditor } from '../../context/ThumbnailEditorContext'
import type { PendingThumbnailStream } from '../../context/ThumbnailEditorContext'
import { useOpenItems } from '../../context/OpenItemsContext'
import { usePageActivity } from '../../context/PageActivityContext'
import { useStore } from '../../hooks/useStore'
import { useAnimationConfig } from '../../hooks/useAnimationConfig'
import { theme, rgba } from '../../theme'
import { renderStreamTitle, renderTitleFromMeta, resolvePrimaryGame, detectTotalEpisodes } from '../../lib/streamTitle'
import { Modal } from '../ui/Modal'
import type { ThumbnailLayer, ThumbnailShadow, ThumbnailTemplate, ThumbnailCanvasFile, ThumbnailRecentEntry, StreamMeta, StreamFolder, PaletteSwatch, GradientSwatchData } from '../../types'

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

/** Rotation snapping (THU-25): the angle step the rotate handle snaps to
 *  while a modifier is held. Ctrl for the coarse stops, Shift for
 *  refinement; with both held the finer step wins. No modifier, no snap.
 *  Alt stays out of it (reserved for the Alt-drag duplicate gesture). */
const ROTATION_SNAP_STEPS = { ctrl: 90, shift: 5 } as const

/** Display precision for position, size, and angle (THU-27): two decimals,
 *  trailing zeros dropped. Stored values keep their full precision. */
const round2 = (v: number) => Math.round(v * 100) / 100

/** Wrap every stored angle into 0..360 on load (style guide, "Angle
 *  fields"): older builds committed raw rotations and let gradient angles
 *  sit at 360. Returns the same array when nothing needed wrapping. */
function wrapLayerAngles(layers: ThumbnailLayer[]): ThumbnailLayer[] {
  let changed = false
  const out = layers.map(l => {
    const patch: Partial<ThumbnailLayer> = {}
    const r = normalizeAngle(l.rotation ?? 0)
    if (r !== (l.rotation ?? 0)) patch.rotation = r
    if (l.gradientAngle !== undefined && normalizeAngle(l.gradientAngle) !== l.gradientAngle) patch.gradientAngle = normalizeAngle(l.gradientAngle)
    if (l.strokeGradientAngle !== undefined && normalizeAngle(l.strokeGradientAngle) !== l.strokeGradientAngle) patch.strokeGradientAngle = normalizeAngle(l.strokeGradientAngle)
    if (Object.keys(patch).length === 0) return l
    changed = true
    return { ...l, ...patch }
  })
  return changed ? out : layers
}

/** One button in the layers panel's selection tab (THU-30). `affects` are
 *  the rows that light up while the button is hovered, in the button's
 *  `tone`: red for destructive (delete), blue for structure changes (group,
 *  ungroup), amber for the mask actions (THU-21), which change how several
 *  layers render, and the accent for the rest. */
type LayerTabTone = 'accent' | 'blue' | 'amber' | 'red'
interface LayerTabAction {
  key: string
  separator?: boolean
  icon?: React.ReactNode
  label?: string
  disabled?: boolean
  reason?: string
  tone?: LayerTabTone
  affects?: string[]
  onClick?: () => void
}
/** The mask icon with a small badge at its lower right saying which mask
 *  action this is (the player's mode-close icon technique: a knocked-out
 *  disc so the badge reads over the icon). 'group' = use as the group's
 *  mask (folder), 'below' = apply to the layer below (down arrow),
 *  'release' = release the mask (red X). */
function MaskActionIcon({ badge }: { badge: 'group' | 'below' | 'release' }) {
  const cls = 'absolute -bottom-1 -right-1 rounded-full bg-navy-800'
  return (
    <span className="relative shrink-0 flex">
      <Blend size={14} />
      {badge === 'group' && <Folder size={9} strokeWidth={3} className={`${cls} text-gray-200`} />}
      {badge === 'below' && <ArrowDown size={9} strokeWidth={3.5} className={`${cls} text-gray-200`} />}
      {badge === 'release' && <X size={9} strokeWidth={3.5} className={`${cls} text-red-300`} />}
    </span>
  )
}

/** Full class strings per tone (Tailwind needs them written out). */
const LAYER_TAB_BUTTON_TONE: Record<LayerTabTone, string> = {
  accent: 'text-gray-400 hover:text-gray-200 hover:bg-white/10',
  blue: 'text-gray-400 hover:text-blue-300 hover:bg-blue-500/15',
  amber: 'text-gray-400 hover:text-amber-300 hover:bg-amber-500/15',
  red: 'text-gray-400 hover:text-red-400 hover:bg-red-500/15',
}
const LAYER_ROW_AFFECTED_TONE: Record<LayerTabTone, string> = {
  accent: 'bg-accent-600/30 after:bg-accent-400',
  blue: 'bg-blue-600/30 after:bg-blue-400',
  amber: 'bg-amber-600/30 after:bg-amber-400',
  red: 'bg-red-600/30 after:bg-red-400',
}
interface LayerHighlight { ids: ReadonlySet<string>; tone: LayerTabTone }
const NO_HIGHLIGHT: LayerHighlight = { ids: new Set(), tone: 'accent' }
const byIdOf = (layers: ThumbnailLayer[], id: string): ThumbnailLayer => layers.find(l => l.id === id) ?? ({ type: 'image' } as ThumbnailLayer)
function rotationSnapStep(ctrl: boolean, shift: boolean): number | null {
  if (shift) return ROTATION_SNAP_STEPS.shift
  if (ctrl) return ROTATION_SNAP_STEPS.ctrl
  return null
}
/** Every multiple of `step` in a full turn, for Konva's rotationSnaps. */
function rotationSnapAngles(step: number): number[] {
  const out: number[] = []
  for (let a = 0; a < 360; a += step) out.push(a)
  return out
}

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
  /** Member of a group (THU-18). Nested wrappers are not snap targets and
   *  stop their own events from bubbling to the enclosing group. */
  nested?: boolean
  /** A nested member that is not itself selected: it neither selects nor
   *  drags, so its events reach the enclosing group, which is what a click
   *  on a group member selects. */
  inert?: boolean
  /** Groups only (THU-31): a canvas gesture is moving a layer inside this
   *  group, so its shadow and outline ghosts are dropped until release. */
  effectsPaused?: boolean
}

/** The event props every layer wrapper (image, text, shape, group) puts on
 *  its Konva Group. Inert nodes get none, so a click on a group member
 *  bubbles up to the group's own wrapper. Nested interactive nodes (a
 *  member selected through the panel or a double-click) stop the bubble so
 *  the enclosing group does not also react. */
function wrapperHandlers(p: KonvaLayerNodeProps) {
  if (p.inert) return { draggable: false as const }
  const stop = (e: Konva.KonvaEventObject<unknown>) => { if (p.nested) e.cancelBubble = true }
  return {
    draggable: true as const,
    onMouseDown: (e: Konva.KonvaEventObject<MouseEvent>) => { if (e.evt.button !== 0) e.target.stopDrag() },
    onClick: (e: Konva.KonvaEventObject<MouseEvent>) => { if (e.evt.button === 0) { stop(e); p.onSelect(p.layer.id, e.evt.shiftKey) } },
    onTap: (e: Konva.KonvaEventObject<TouchEvent>) => { stop(e); p.onSelect(p.layer.id, false) },
    onDragStart: (e: Konva.KonvaEventObject<DragEvent>) => { stop(e); p.onDragStart(e) },
    onDragMove: (e: Konva.KonvaEventObject<DragEvent>) => { stop(e); p.onSnapDragMove(e) },
    onDragEnd: (e: Konva.KonvaEventObject<DragEvent>) => { stop(e); p.onClearGuides(); p.onDragEnd(e) },
    onTransformEnd: (e: Konva.KonvaEventObject<Event>) => { stop(e); p.onTransformEnd(e) },
  }
}

/** Walk up from the Konva node under the pointer to the wrapper that is a
 *  DIRECT member of `groupId`, and return its layer id. Members live in the
 *  group's inner (clipping) container, one level under the node that
 *  carries the group's id (see GroupNode). */
function directChildIdUnder(target: Konva.Node, groupId: string): string | null {
  let n: Konva.Node | null = target
  while (n) {
    const parent = n.getParent()
    if (!parent) return null
    if (parent.id() === groupId) return n.id() || null
    if (parent.name() === GROUP_INNER_NAME && parent.getParent()?.id() === groupId) return n.id() || null
    n = parent
  }
  return null
}

// ── Group effects (THU-31) ────────────────────────────────────────────────────
// A group has no shadow of its own in Konva (shadows are a Shape feature),
// so a group with shadows or an outline rasterizes its clipped content once
// per change and draws ghost images beneath it: one per shadow, carrying
// that shadow, plus the outline ring. The ghosts sit OUTSIDE the clip, so a
// shadow extends past the mask the way a shadow under a cut-out should.

/** Name of the inner container that carries the clip and the members. */
const GROUP_INNER_NAME = 'group-inner'
/** Name of a selected mask's dashed outline node (editor chrome inside the
 *  content layer; hidden for every snapshot). */
const MASK_OUTLINE_NAME = 'mask-outline'

/** Members tell groups with effects when what they paint changed without a
 *  layers commit (an image bitmap arriving, an outlined canvas landing). */
const contentListeners = new Set<() => void>()
function notifyContentChanged(): void { contentListeners.forEach(fn => fn()) }

/** Rasters in flight; the export and the background re-render wait for
 *  zero so a snapshot never misses a group's shadow. */
let pendingGroupRasters = 0
async function waitForGroupRasters(timeoutMs = 3000): Promise<void> {
  const start = Date.now()
  while (pendingGroupRasters > 0 && Date.now() - start < timeoutMs) {
    await new Promise<void>(r => requestAnimationFrame(() => r()))
  }
}

const outlineActiveOn = (l: ThumbnailLayer): boolean => !!l.outlineEnabled && (l.outlineWidth ?? 0) > 0
/** Shadows, outline, or filters: anything that makes the group rasterize. */
function groupHasEffects(l: ThumbnailLayer): boolean {
  return resolveShadows(l).length > 0 || outlineActiveOn(l) || activeFilters(l).length > 0
}

/** Push the layer's filter parameters onto a Konva node before caching it
 *  with `activeFilters`. Shared by ImageInner and the group container. */
function applyFilterParams(node: Konva.Node, layer: ThumbnailLayer): void {
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
}

interface GroupRaster {
  /** What the shadows attach to: the content, dilated when the outline is
   *  on. Positioned at (x, y) in the group's own frame. */
  silhouette: HTMLCanvasElement
  x: number
  y: number
  /** The outline ring alone (dilation minus the content's own coverage),
   *  drawn beneath the live content; null with the outline off. */
  ring: HTMLCanvasElement | null
}

/** Build the ghost canvases from a raster of the group's clipped content
 *  (`base`, whose top-left sits at (x, y) in the group's frame). */
function buildGroupRaster(base: HTMLCanvasElement, x: number, y: number, layer: ThumbnailLayer): GroupRaster {
  if (!outlineActiveOn(layer)) return { silhouette: base, x, y, ring: null }
  const pad = Math.max(1, Math.round(layer.outlineWidth ?? 0))
  const w = base.width + pad * 2
  const h = base.height + pad * 2
  const full = document.createElement('canvas')
  full.width = w; full.height = h
  const fctx = full.getContext('2d')!
  fctx.drawImage(base, pad, pad)
  const data = fctx.getImageData(0, 0, w, h)
  const originalAlpha = new Uint8ClampedArray(w * h)
  for (let i = 0, p = 3; i < originalAlpha.length; i++, p += 4) originalAlpha[i] = data.data[p]
  makeOutlineFilter(pad, layer.outlineColor ?? '#000000')(data)
  fctx.putImageData(data, 0, 0)
  // Ring only: knock the content's own coverage out of the dilated result,
  // so a translucent member does not see a filled copy of itself beneath.
  const ring = document.createElement('canvas')
  ring.width = w; ring.height = h
  const rctx = ring.getContext('2d')!
  const rd = rctx.createImageData(w, h)
  const src = data.data
  for (let i = 0, p = 0; i < originalAlpha.length; i++, p += 4) {
    const a0 = originalAlpha[i]
    if (a0 >= 128) continue
    rd.data[p] = src[p]; rd.data[p + 1] = src[p + 1]; rd.data[p + 2] = src[p + 2]
    rd.data[p + 3] = a0 > 0 ? Math.round(src[p + 3] * (1 - a0 / 255)) : src[p + 3]
  }
  rctx.putImageData(rd, 0, 0)
  return { silhouette: full, x: x - pad, y: y - pad, ring }
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

/** The geometry a swatch carries, defaults filled in (older swatches are
 *  linear with no center or radius). */
function swatchGeometry(g: GradientSwatchData): GradientGeometry {
  return {
    kind: g.kind ?? 'linear',
    angle: g.angle,
    centerX: g.centerX ?? 0.5,
    centerY: g.centerY ?? 0.5,
    radius: g.radius ?? 1,
  }
}

/** A layer's fill or stroke gradient geometry, defaults filled in. */
function layerGradientGeometry(layer: ThumbnailLayer, paint: 'fill' | 'stroke'): GradientGeometry {
  return paint === 'fill'
    ? { kind: layer.gradientType ?? 'linear', angle: layer.gradientAngle ?? 0, centerX: layer.gradientCenterX ?? 0.5, centerY: layer.gradientCenterY ?? 0.5, radius: layer.gradientRadius ?? 1 }
    : { kind: layer.strokeGradientType ?? 'linear', angle: layer.strokeGradientAngle ?? 0, centerX: layer.strokeGradientCenterX ?? 0.5, centerY: layer.strokeGradientCenterY ?? 0.5, radius: layer.strokeGradientRadius ?? 1 }
}

/** Konva props for a layer's gradient FILL over a w×h box whose top-left is
 *  at (sx, sy) in the shape's drawing space, or an empty object when the
 *  fill is solid. Linear uses Konva's native gradient props; radial and
 *  conic (THU-9) hand Konva a CanvasGradient as the fill colour. */
function fillGradientKonvaProps(layer: ThumbnailLayer, w: number, h: number, sx: number, sy: number): Record<string, unknown> {
  if (layer.fillType !== 'linear' || (layer.gradientStops?.length ?? 0) < 2 || w <= 0 || h <= 0) return {}
  const stops = layer.gradientStops!
  const space = layer.gradientColorSpace ?? 'oklch'
  const style = layer.gradientStyle ?? 'smooth'
  const geom = layerGradientGeometry(layer, 'fill')
  if (geom.kind === 'linear') {
    const { start, end } = gradientLinePoints(geom.angle, w, h)
    return {
      fillPriority: 'linear-gradient',
      fillLinearGradientStartPoint: { x: start.x + sx, y: start.y + sy },
      fillLinearGradientEndPoint: { x: end.x + sx, y: end.y + sy },
      fillLinearGradientColorStops: buildKonvaColorStops(stops, space, style),
    }
  }
  const grad = makeCanvasGradient(stops, space, style, geom, w, h, sx, sy)
  return grad ? { fill: grad as unknown as string, fillPriority: 'color' } : {}
}

/** Same for the STROKE (THU-8, THU-9). Konva has no radial or conic stroke
 *  props, so those kinds pass a CanvasGradient as the stroke colour. */
function strokeGradientKonvaProps(layer: ThumbnailLayer, w: number, h: number, sx: number, sy: number): Record<string, unknown> {
  if (layer.strokeType !== 'linear' || (layer.strokeGradientStops?.length ?? 0) < 2 || w <= 0 || h <= 0) return {}
  const stops = layer.strokeGradientStops!
  const space = layer.strokeGradientColorSpace ?? 'oklch'
  const style = layer.strokeGradientStyle ?? 'smooth'
  const geom = layerGradientGeometry(layer, 'stroke')
  if (geom.kind === 'linear') {
    const { start, end } = gradientLinePoints(geom.angle, w, h)
    return {
      strokeLinearGradientStartPoint: { x: start.x + sx, y: start.y + sy },
      strokeLinearGradientEndPoint: { x: end.x + sx, y: end.y + sy },
      strokeLinearGradientColorStops: buildKonvaColorStops(stops, space, style),
    }
  }
  const grad = makeCanvasGradient(stops, space, style, geom, w, h, sx, sy)
  return grad ? { stroke: grad as unknown as string } : {}
}

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
/** Parse any hex form a user might type or paste — `#rgb`, `#rgba`,
 *  `#rrggbb`, `#rrggbbaa`, with or without the leading `#` — into the
 *  canonical 6-digit rgb plus an alpha. `alpha: null` means the entry
 *  didn't specify one, so the caller should keep whatever it already has
 *  (typing a new color must not reset the opacity). Returns null when the
 *  text isn't a color, including the incomplete 5- and 7-digit lengths.
 *
 *  Shorthand is expanded HERE rather than stored as typed: canvas would
 *  render `#000` correctly, but the app's own color plumbing (this
 *  function, lib/gradient's sampler) expects the canonical form, so
 *  storing shorthand makes the swatch and the canvas disagree. */
function parseHexEntry(raw: string): { rgb: string; alpha: number | null } | null {
  const m = /^#?([0-9a-fA-F]+)$/.exec(raw.trim())
  if (!m) return null
  const d = m[1].toLowerCase()
  const dup = (c: string): string => c + c
  if (d.length === 3 || d.length === 4) {
    return {
      rgb: `#${dup(d[0])}${dup(d[1])}${dup(d[2])}`,
      alpha: d.length === 4 ? parseInt(dup(d[3]), 16) / 255 : null,
    }
  }
  if (d.length === 6 || d.length === 8) {
    return {
      rgb: `#${d.slice(0, 6)}`,
      alpha: d.length === 8 ? parseInt(d.slice(6, 8), 16) / 255 : null,
    }
  }
  return null
}

function splitColorAlpha(v: string | undefined, fallback: string): { rgb: string; alpha: number } {
  // Delegates so anything the fields accept is also readable back —
  // including shorthand that reached a canvas.json by hand-editing or an
  // externally-authored template.
  const parsed = parseHexEntry(v ?? '')
  if (!parsed) return { rgb: fallback, alpha: 1 }
  return { rgb: parsed.rgb, alpha: parsed.alpha ?? 1 }
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
    applyFilterParams(node, layer)
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

function ImageNode(props: KonvaLayerNodeProps) {
  // The shared parent-level Transformer attaches itself to selected nodes
  // via its own useEffect, so per-node Transformer mounts are gone. The
  // wrapper's event props come from wrapperHandlers (see KonvaLayerNodeProps).
  const { layer } = props
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
  // An enclosing group with effects (THU-31) rasterizes what its members
  // paint; a bitmap or outlined canvas arriving after a commit is a change
  // it cannot see through the layers, so tell it.
  useEffect(() => { if (img) notifyContentChanged() }, [img, outlinedCanvas])
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
      name={props.nested ? undefined : 'snap-target'}
      x={layer.x}
      y={layer.y}
      rotation={layer.rotation}
      opacity={layer.opacity / 100}
      visible={layer.visible}
      {...wrapperHandlers(props)}
    >
      {shadows.map((s, i) => (
        <ImageInner key={`shadow-${i}`} layer={layer} imageSource={imageSource} renderW={renderW} renderH={renderH} offsetX={offX} offsetY={offY} shadow={s} />
      ))}
      <ImageInner layer={layer} imageSource={imageSource} renderW={renderW} renderH={renderH} offsetX={offX} offsetY={offY} shadow={null} />
    </KonvaGroup>
  )
}

/** Default palette (thumbnails #1). Spectrum-ordered saturated colors +
 *  brown first (exactly one 9-wide row at the sidebar's width), then the
 *  black→grays→white run on its own row. Plain "typical" hex values on
 *  purpose — a starting point users will replace, not a designed scheme. */
const DEFAULT_PALETTE: ReadonlyArray<{ name: string; color: string }> = [
  { name: 'Red', color: '#ff0000' },
  { name: 'Orange', color: '#ff8000' },
  { name: 'Yellow', color: '#ffff00' },
  { name: 'Green', color: '#00ff00' },
  { name: 'Cyan', color: '#00ffff' },
  { name: 'Blue', color: '#0000ff' },
  { name: 'Purple', color: '#8000ff' },
  { name: 'Magenta', color: '#ff00ff' },
  { name: 'Brown', color: '#8b4513' },
  { name: 'Black', color: '#000000' },
  { name: 'Dark gray', color: '#404040' },
  { name: 'Gray', color: '#808080' },
  { name: 'Light gray', color: '#bfbfbf' },
  { name: 'White', color: '#ffffff' },
]

/** Letter-case control options (thumbnails #7). Labels mirror Figma's
 *  letter-case buttons. Small caps is deliberately absent: it's an
 *  OpenType glyph-substitution feature (smcp), not a case transform, and
 *  Konva's canvas text path can't reach it. */
const TEXT_TRANSFORM_OPTIONS = [
  { value: 'none', label: '—', tip: 'As typed' },
  { value: 'uppercase', label: 'AG', tip: 'Uppercase' },
  { value: 'lowercase', label: 'ag', tip: 'Lowercase' },
  { value: 'capitalize', label: 'Ag', tip: 'Title case — uppercase each word’s first letter, rest as typed' },
] as const

/** Render-time case transform. Applied AFTER merge-field resolution so
 *  {topic} etc. transform too; the stored text is never modified.
 *  'capitalize' follows CSS semantics — uppercase each word's first
 *  letter, leave the rest alone (acronyms survive). */
function applyTextTransform(text: string, transform: ThumbnailLayer['textTransform']): string {
  switch (transform) {
    case 'uppercase': return text.toLocaleUpperCase()
    case 'lowercase': return text.toLocaleLowerCase()
    case 'capitalize': return text.replace(/(^|\s)(\S)/g, (_, pre: string, ch: string) => pre + ch.toLocaleUpperCase())
    default: return text
  }
}

function TextNode(props: KonvaLayerNodeProps) {
  const { layer, mergeFields } = props
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

  // Text dimensions are FONT-DRIVEN — Konva measures them, we never store
  // a height — so anything geometric (flip offsets, gradient endpoints)
  // has to read them off the node. Reading `nodeRef.current` straight in
  // render is stale on the first pass (ref still null) and never
  // re-renders, so measurements land in state instead: this effect runs
  // after every render and only sets state when a value actually changed,
  // so it converges immediately and keeps the gradient correct for the
  // PNG export too.
  const [measured, setMeasured] = useState({ w: 0, h: 0 })
  useLayoutEffect(() => {
    const n = nodeRef.current
    if (!n) return
    const w = n.width()
    const h = n.height()
    if (w !== measured.w || h !== measured.h) setMeasured({ w, h })
    // The Transform card shows a text layer's font-driven height (THU-33).
    publishMeasuredBox(layer.id, w, h)
  })

  // Gradient fill (thumbnails #2, text). Konva's Text draws from its own
  // top-left, so the endpoints need no origin shift (unlike the centered
  // ellipse). The box is the text box: the layer width when set, else the
  // measured width; height is always measured.
  const gradW = layer.width ?? measured.w
  const gradH = measured.h
  // Linear, radial, or conic (THU-9), built by the shared helper; spread
  // only when active, since the keys' absence is what makes react-konva
  // reset Konva's gradient props to none.
  const gradientFillProps = fillGradientKonvaProps(layer, gradW, gradH, 0, 0)
  // Gradient stroke (THU-8): same geometry over the same box. Skipped
  // while the outline effect overrides the stroke with its single color.
  const strokeGradientProps = outlineActive ? {} : strokeGradientKonvaProps(layer, gradW, gradH, 0, 0)

  // Shared text props — every shadow clone + the original render with
  // identical content; only the shadow attachment differs per clone.
  // Pulling this out of the JSX avoids drift between clones and keeps
  // the multi-shadow loop trivial.
  const textProps = {
    text: applyTextTransform(applyThumbnailMergeFields(layer.text ?? '', mergeFields), layer.textTransform),
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
    // Flip in place — uses the same measured dimensions. (offsetY for
    // unflipped text is 0, so the measurement only matters in the flipped
    // branch.) Shadow clones reuse the same values: they render the same
    // text at the same font, so their measured dimensions match.
    scaleX: layer.flipX ? -1 : 1,
    scaleY: layer.flipY ? -1 : 1,
    offsetX: layer.flipX ? (layer.width ?? measured.w) : 0,
    offsetY: layer.flipY ? measured.h : 0,
    ...gradientFillProps,
    ...strokeGradientProps,
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
      name={props.nested ? undefined : 'snap-target'}
      x={layer.x}
      y={layer.y}
      rotation={layer.rotation}
      opacity={layer.opacity / 100}
      visible={layer.visible}
      {...wrapperHandlers(props)}
    >
      {shadows.map((s, i) => (
        <KonvaText key={`shadow-${i}`} {...textProps} {...shadowPropsFor(s)} />
      ))}
      <KonvaText ref={nodeRef} {...textProps} {...shadowPropsFor(null)} />
    </KonvaGroup>
  )
}

function ShapeNode(props: KonvaLayerNodeProps) {
  const { layer } = props
  const w = layer.width ?? 200
  const h = layer.height ?? 200
  // Legacy 'triangle' layers are migrated on load; treating one as a
  // polygon here is only a fallback for a layer that slipped past that.
  const shapeType = layer.shapeType === 'triangle' ? 'polygon' : (layer.shapeType ?? 'rect')
  // Ellipse and polygon are centered on x/y in Konva; we store top-left
  const isCentered = shapeType === 'ellipse' || shapeType === 'polygon'

  // Flip in place. Centered shapes (ellipse, polygon) already have
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

  // Gradient fill (thumbnails #2): endpoints from the CSS gradient-line
  // projection, expressed in each shape's LOCAL drawing space — rect and
  // the triangle sceneFunc draw in 0..w/0..h, while Konva's Ellipse draws
  // around its own center, so its points shift by (-w/2, -h/2). The
  // solid `fill` stays set underneath; fillPriority picks the gradient
  // (and older app versions that ignore these fields render the flat
  // fill instead).
  // Linear, radial, or conic (THU-9), built by the shared helper with the
  // ellipse's origin shift.
  const gradientFillProps = fillGradientKonvaProps(layer, w, h, shapeType === 'ellipse' ? -w / 2 : 0, shapeType === 'ellipse' ? -h / 2 : 0)

  // Inner-shape props (without shadow) — no id/name/position/rotation/
  // handlers; those live on the Group. Centered shapes still get their
  // own center offset inside the Group so Konva's ellipse/polygon math
  // (centered around x/y) lines up with our top-left-stored coords.
  // Gradient stroke (THU-8): same endpoints and origin shift as the fill,
  // skipped while the outline effect overrides the stroke.
  const strokeGradientProps = outlineActive
    ? {}
    : strokeGradientKonvaProps(layer, w, h, shapeType === 'ellipse' ? -w / 2 : 0, shapeType === 'ellipse' ? -h / 2 : 0)

  const baseInnerProps = {
    x: isCentered ? w / 2 : 0,
    y: isCentered ? h / 2 : 0,
    fill: layer.fill ?? '#6366f1',
    stroke: effectiveStroke,
    strokeWidth: effectiveStrokeWidth,
    fillAfterStrokeEnabled: true,
    scaleX, scaleY, offsetX, offsetY,
    ...gradientFillProps,
    ...strokeGradientProps,
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
    // Polygon (THU-2): a flat-bottomed regular polygon stretched to fill
    // the layer box, drawn by a custom sceneFunc so corners can round
    // (arcTo at each vertex). The radius is in PIXELS, independent of
    // width/height, so corners stay perfectly circular through resizes,
    // and it clamps to the largest value the shape's geometry can render
    // (lib/polygon.ts). Three sides is the former triangle, unchanged.
    const pts = polygonPoints(polygonSidesOf(layer), w, h)
    const radius = layer.cornerRadius ?? 0
    return (
      <KonvaShape
        key={key}
        {...props}
        width={w}
        height={h}
        // Center the self-rect so position/flip semantics match the other
        // centered shapes (baseInnerProps places x/y at the center).
        offsetX={w / 2}
        offsetY={h / 2}
        sceneFunc={(ctx: Konva.Context, shape: Konva.Shape) => {
          tracePolygonPath(ctx, pts, radius)
          ctx.fillStrokeShape(shape)
        }}
      />
    )
  }

  return (
    // See ImageNode for the Group-wrap rationale + multi-shadow pattern.
    <KonvaGroup
      id={layer.id}
      name={props.nested ? undefined : 'snap-target'}
      x={layer.x}
      y={layer.y}
      rotation={layer.rotation}
      opacity={layer.opacity / 100}
      visible={layer.visible}
      {...wrapperHandlers(props)}
    >
      {shadows.map((s, i) => renderShape(s, `shadow-${i}`))}
      {renderShape(null)}
    </KonvaGroup>
  )
}

/** A group (THU-18): one Konva Group carrying position, rotation, opacity,
 *  and visibility, with its members rendered inside it so every transform
 *  composes. A click selects the group; a double-click selects the member
 *  under the pointer (double-click again on a nested group to go deeper). */
function GroupNode(props: KonvaLayerNodeProps & { children: React.ReactNode; maskLayer?: ThumbnailLayer; maskSelected?: boolean; contentKey: string }) {
  const { layer, onSelect, children, maskLayer, maskSelected, contentKey } = props
  const innerRef = useRef<Konva.Group>(null)
  const [raster, setRaster] = useState<GroupRaster | null>(null)
  const shadows = resolveShadows(layer)
  const hasGhosts = shadows.length > 0 || outlineActiveOn(layer)
  const filters = activeFilters(layer)
  const hasFilters = filters.length > 0
  const hasEffects = hasGhosts || hasFilters
  const paused = !!props.effectsPaused
  const drill = (e: Konva.KonvaEventObject<unknown>) => {
    if (props.nested) e.cancelBubble = true
    const childId = directChildIdUnder(e.target, layer.id)
    if (childId) onSelect(childId, false)
  }
  // Group mask (THU-21): Konva clips the inner container's children (scene
  // and hit graph alike) to the path this traces in the group's own space.
  // A hidden mask switches the clip off, which doubles as the mask toggle.
  const clip = maskLayer && maskLayer.visible ? maskLayer : undefined

  // The Transform card shows a group's measured box (THU-33): the members'
  // extent in the group's own frame, read after every render.
  useLayoutEffect(() => {
    const inner = innerRef.current
    if (!inner) return
    const r = inner.getClientRect({ relativeTo: inner as unknown as Konva.Container, skipShadow: true, skipStroke: true })
    publishMeasuredBox(layer.id, r.width, r.height)
  })

  // Effects (THU-31). Konva's cache() renders a node in its own local
  // coordinates, clip included, into an offscreen canvas. Shadows and
  // outline copy that canvas for their ghosts; filters keep the cache and
  // run Konva's filter chain over it (the cached hit canvas keeps each
  // member's color key, so clicks and drill-down still reach members).
  // Without filters the cache is cleared at once so the container stays
  // live. Runs a frame after each change of the group's subtree
  // (contentKey), of the outline, or of the clip, and again whenever a
  // member reports new content (image loaded). While a gesture moves a
  // member inside the group, ghosts are dropped and the cache cleared so
  // the member draws live; everything rebuilds on release.
  useEffect(() => {
    const inner = innerRef.current
    if (!hasEffects || paused) {
      setRaster(null)
      if (inner) { inner.filters([]); inner.clearCache() }
      return
    }
    let raf = 0
    let counted = false
    const count = () => { if (!counted) { counted = true; pendingGroupRasters++ } }
    const uncount = () => { if (counted) { counted = false; pendingGroupRasters-- } }
    const run = () => {
      raf = 0
      const inner = innerRef.current
      try {
        if (inner) {
          inner.filters([])
          inner.clearCache()
          // A blur needs room past the content's bounds or it clips flat.
          const blurPad = hasFilters && (layer.filterBlur ?? 0) > 0 ? Math.ceil(layer.filterBlur ?? 0) : 0
          inner.cache({ pixelRatio: 1, offset: blurPad })
          const cc = inner._getCanvasCache() as { scene?: { _canvas: HTMLCanvasElement }; x: number; y: number } | undefined
          const src = cc?.scene?._canvas
          if (src && src.width > 0 && src.height > 0) {
            if (hasGhosts) {
              const copy = document.createElement('canvas')
              copy.width = src.width; copy.height = src.height
              copy.getContext('2d')!.drawImage(src, 0, 0)
              setRaster(buildGroupRaster(copy, cc!.x, cc!.y, layer))
            } else {
              setRaster(null)
            }
            if (hasFilters) {
              applyFilterParams(inner, layer)
              inner.filters(filters)
              inner.getLayer()?.batchDraw()
            } else {
              inner.clearCache()
            }
          } else {
            inner.clearCache()
            setRaster(null)
          }
        }
      } catch {
        try { inner?.filters([]); inner?.clearCache() } catch { /* nothing to clear */ }
      }
      uncount()
    }
    const schedule = () => {
      if (raf) cancelAnimationFrame(raf)
      count()
      raf = requestAnimationFrame(run)
    }
    schedule()
    contentListeners.add(schedule)
    return () => {
      contentListeners.delete(schedule)
      if (raf) cancelAnimationFrame(raf)
      uncount()
      const node = innerRef.current
      if (node) { node.filters([]); node.clearCache() }
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps -- contentKey serializes the subtree, the group's own filter and outline fields included
  }, [hasEffects, hasGhosts, hasFilters, paused, contentKey, clip])

  return (
    <KonvaGroup
      id={layer.id}
      name={props.nested ? undefined : 'snap-target'}
      x={layer.x}
      y={layer.y}
      rotation={layer.rotation}
      opacity={layer.opacity / 100}
      visible={layer.visible}
      {...wrapperHandlers(props)}
      onDblClick={props.inert ? undefined : drill}
      onDblTap={props.inert ? undefined : drill}
    >
      {/* Ghosts beneath the content, outside the clip: one per shadow
          (each carries its shadow; the live content covers the copy), then
          the outline ring. */}
      {raster && shadows.map((s, i) => (
        <KonvaImage
          key={`shadow-${i}`}
          image={raster.silhouette}
          x={raster.x}
          y={raster.y}
          width={raster.silhouette.width}
          height={raster.silhouette.height}
          listening={false}
          perfectDrawEnabled={false}
          {...shadowPropsFor(s)}
        />
      ))}
      {raster?.ring && (
        <KonvaImage
          image={raster.ring}
          x={raster.x}
          y={raster.y}
          width={raster.ring.width}
          height={raster.ring.height}
          listening={false}
          perfectDrawEnabled={false}
        />
      )}
      <KonvaGroup
        ref={innerRef}
        name={GROUP_INNER_NAME}
        clipFunc={clip ? (ctx: Konva.Context) => { traceMaskPath(ctx, clip) } : undefined}
      >
        {children}
      </KonvaGroup>
      {/* Selected mask's dashed outline (THU-21): editor chrome, so it sits
          outside the inner container (never in its cache, never filtered)
          and only exists while the mask is selected. The export hides every
          `mask-outline` node before it snapshots. */}
      {maskLayer && maskSelected && (
        <KonvaGroup x={maskLayer.x} y={maskLayer.y} rotation={maskLayer.rotation} listening={false}>
          <KonvaShape
            name={MASK_OUTLINE_NAME}
            width={maskLayer.width ?? 200}
            height={maskLayer.height ?? 200}
            listening={false}
            fillEnabled={false}
            stroke="#fbbf24"
            strokeWidth={1.5}
            dash={[6, 4]}
            strokeScaleEnabled={false}
            perfectDrawEnabled={false}
            shadowForStrokeEnabled={false}
            sceneFunc={(ctx: Konva.Context, shape: Konva.Shape) => {
              ctx.save()
              traceShapeOutlineLocal(ctx, maskLayer)
              ctx.restore()
              ctx.fillStrokeShape(shape)
            }}
          />
        </KonvaGroup>
      )}
    </KonvaGroup>
  )
}

/** A group's mask on the canvas (THU-21): paints nothing (the clip lives
 *  on the group), but keeps a hit region the size of its outline so it can
 *  be reached by a double-click on empty masked space and driven by the
 *  transformer like any shape. Rendered beneath the members, so content
 *  wins every hit it covers. Selected, it shows a dashed outline. */
function MaskNode(props: KonvaLayerNodeProps) {
  const { layer } = props
  const w = layer.width ?? 200
  const h = layer.height ?? 200
  return (
    <KonvaGroup
      id={layer.id}
      x={layer.x}
      y={layer.y}
      rotation={layer.rotation}
      visible={layer.visible}
      {...wrapperHandlers(props)}
    >
      <KonvaShape
        width={w}
        height={h}
        // A transparent fill keeps the hit region while drawing nothing.
        // No stroke props at all on this node: react-konva leaves a prop
        // that goes from a value to undefined in place, so a stroke that
        // was once set would stick after deselection.
        fill="rgba(0,0,0,0)"
        strokeEnabled={false}
        perfectDrawEnabled={false}
        sceneFunc={(ctx: Konva.Context, shape: Konva.Shape) => {
          ctx.save()
          traceShapeOutlineLocal(ctx, layer)
          ctx.restore()
          ctx.fillStrokeShape(shape)
        }}
      />
      {/* The selection outline is drawn by GroupNode, outside the clipped
          (and possibly cached) container, so it is never rasterized. */}
    </KonvaGroup>
  )
}

/** On-canvas readout for the gesture in progress (THU-25, THU-26): angle
 *  while rotating, W and H while resizing (W alone for text), X and Y while
 *  moving. Subscribes to the live-transform store on its own so the
 *  per-frame updates never re-render the editor around it. */
function TransformHud() {
  const live = useLiveTransform()
  if (!live || !live.pointer) return null
  const n = (v: number) => String(round2(v))
  let text: string
  // Raw accumulated angle while rotating (spin twice, read 720°); the
  // commit on release wraps it (style guide, "Angle fields").
  if (live.kind === 'rotate') text = `${round2(live.rotation).toFixed(2)}°`
  else if (live.kind === 'resize') text = live.height !== undefined ? `W ${n(live.width ?? 0)}   H ${n(live.height)}` : `W ${n(live.width ?? 0)}`
  else text = `X ${n(live.x)}   Y ${n(live.y)}`
  return (
    <div
      className="absolute pointer-events-none px-1.5 py-0.5 rounded bg-navy-900/90 border border-white/10 text-[10px] text-gray-200 tabular-nums whitespace-pre z-10"
      style={{ left: live.pointer.x + 14, top: live.pointer.y + 14 }}
    >
      {text}
    </div>
  )
}

/** Renders one level of the layer tree: the members of `parentId` in paint
 *  order, recursing into groups. Shared by the editor stage and the
 *  background re-render so both draw nesting the same way. */
function LayerNodes({ layers, parentId, makeProps }: {
  layers: ThumbnailLayer[]
  parentId: string | null
  makeProps: (layer: ThumbnailLayer) => KonvaLayerNodeProps
}) {
  // A group's mask (THU-21) is stored as its topmost member. Unselected it
  // is drawn first, a hit-only node beneath the members, so content wins
  // every click it covers and a double-click on empty masked space reaches
  // the mask. Selected, it moves on top: the whole outline becomes its
  // drag target, so the user does not have to aim for the dashed edge.
  // Click empty canvas (or another row) to hand hits back to the content.
  const members = childrenOf(layers, parentId)
  const mask = parentId ? members.find(isMask) : undefined
  const maskProps = mask ? makeProps(mask) : null
  const others = mask ? members.filter(l => l !== mask) : members
  const ordered = mask ? (maskProps!.isSelected ? [...others, mask] : [mask, ...others]) : members
  return (
    <>
      {ordered.map(layer => {
        if (layer === mask) return <MaskNode key={layer.id} {...maskProps!} />
        const props = makeProps(layer)
        if (layer.type === 'group') {
          // Groups with effects (THU-31) re-rasterize when their subtree
          // changes; the key is the subtree's serialization, computed only
          // for groups that need it.
          let contentKey = ''
          if (groupHasEffects(layer)) {
            const sub = new Set(subtreeIds(layers, layer.id))
            contentKey = JSON.stringify(layers.filter(l => sub.has(l.id)))
          }
          return (
            <GroupNode
              key={layer.id}
              {...props}
              maskLayer={maskOf(layers, layer.id)}
              maskSelected={(() => { const m = maskOf(layers, layer.id); return m ? makeProps(m).isSelected : false })()}
              contentKey={contentKey}
            >
              <LayerNodes layers={layers} parentId={layer.id} makeProps={makeProps} />
            </GroupNode>
          )
        }
        if (layer.type === 'image') return <ImageNode key={layer.id} {...props} />
        if (layer.type === 'shape') return <ShapeNode key={layer.id} {...props} />
        return <TextNode key={layer.id} {...props} />
      })}
    </>
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

// ── YouTube preview gallery (thumbnails #8) ──────────────────────────────────
// DOM mockups of real YouTube surfaces, fed by ONE bitmap snapshot of the
// canvas — no extra Konva stages. Badge and text sizes are intentionally
// FIXED like YouTube's own chrome (badges don't scale with thumb size), so
// the small cards honestly answer "is this legible in the suggested rail".

type PreviewOverlay = 'none' | 'duration' | 'live' | 'upcoming'

function PreviewThumb({ snapshot, w, h, radius, overlay, watched }: {
  snapshot: string | null
  w: number
  h: number
  radius: number
  overlay: PreviewOverlay
  watched: boolean
}) {
  return (
    <div className="relative overflow-hidden shrink-0 bg-black/40" style={{ width: w, height: h, borderRadius: radius }}>
      {/* SmoothThumb (shared with the recents lists): stepped-halving canvas
          downscale — a plain <img> at 168/120px from the 1280px snapshot hits
          Chromium's fast low-quality resample path and looks crunchy. */}
      {snapshot && <SmoothThumb src={snapshot} className="w-full h-full" />}
      {/* Badge styling measured from youtube.com (2026-08): 20px rendered
          (16px content-box + 2px/6px padding), 4px gap + radius,
          rgba(0,0,0,0.6) background, Roboto 12px/500 on an 18px line —
          bundled as Roboto_VF_latin so the mockups match the real chrome,
          not the app font. h-5 is the border-box equivalent of their
          content-box 16px + vertical padding. */}
      {overlay === 'duration' && (
        <span className="absolute bottom-1 right-1 flex items-center h-5 py-0.5 px-1.5 rounded bg-black/60 font-roboto text-[12px] font-medium leading-[18px] text-white tabular-nums">12:34</span>
      )}
      {overlay === 'live' && (
        <span className="absolute bottom-1 right-1 flex items-center h-5 gap-1 py-0.5 px-1.5 rounded bg-red-600 font-roboto text-[12px] font-medium leading-[18px] text-white">
          <Radio size={12} className="shrink-0" /> LIVE
        </span>
      )}
      {overlay === 'upcoming' && (
        <span className="absolute bottom-1 right-1 flex items-center h-5 gap-1 py-0.5 px-1.5 rounded bg-black/60 font-roboto text-[12px] font-medium leading-[18px] text-white">
          <Radio size={12} className="shrink-0" /> Upcoming
        </span>
      )}
      {watched && (
        <div className="absolute bottom-0 inset-x-0 h-1 bg-white/30">
          <div className="h-full bg-red-600 w-2/5" />
        </div>
      )}
    </div>
  )
}

function PreviewGallery({ snapshot, title, channelName, overlay, setOverlay, watched, setWatched, lightBg, setLightBg }: {
  snapshot: string | null
  title: string
  channelName: string
  /** Badge/theme settings live in the parent so they survive Edit↔Preview
   *  toggles instead of resetting with this component's mount. */
  overlay: PreviewOverlay
  setOverlay: (v: PreviewOverlay) => void
  watched: boolean
  setWatched: (v: boolean) => void
  lightBg: boolean
  setLightBg: (v: boolean) => void
}) {
  // YouTube's own theme colors for the mockups (the cards are "their"
  // chrome); only the control bar above is app-styled.
  const titleCls = lightBg ? 'text-[#0f0f0f]' : 'text-white'
  const metaCls = lightBg ? 'text-[#606060]' : 'text-[#aaaaaa]'
  const fillCls = lightBg ? 'bg-black/10' : 'bg-white/10'
  // Surface labels are APP chrome inside the YouTube-styled area: they keep
  // the app font (font-sans) to read as ours, and get a lightness bump on
  // the dark backdrop where gray-500 sat too close to #0f0f0f.
  const labelCls = `text-[10px] uppercase tracking-wider font-sans ${lightBg ? 'text-gray-500' : 'text-gray-400'}`
  const meta = '1.2K views · 2 hours ago'
  // "|" is a break-after character (UAX #14), so Chromium may wrap BETWEEN
  // a pipe and the space after it — and a space that starts a line this way
  // is rendered, not collapsed (collapsing only happens when the break is
  // at the space itself). A WORD JOINER glued to the pipe forbids exactly
  // that break point; the wrap then lands after the space, which collapses.
  // Display-only — the stored title is untouched. (0x2060 = WORD JOINER,
  // built via fromCharCode so no invisible literal hides in this file.)
  const displayTitle = title.replace(/\|(?=\s)/g, '|' + String.fromCharCode(0x2060))
  const segCls = (on: boolean) =>
    `px-2 py-1 text-xs whitespace-nowrap transition-colors ${on ? 'bg-accent-600/25 text-accent-200' : 'text-gray-400 hover:text-gray-200 hover:bg-white/5'}`
  const chipCls = (on: boolean) =>
    `px-2 py-1 rounded-lg text-xs border transition-colors ${on ? 'bg-accent-600/25 text-accent-200 border-accent-300/40' : 'bg-navy-900 text-gray-400 border-white/10 hover:text-gray-200 hover:bg-white/5'}`
  return (
    <div className="absolute inset-0 z-20 flex flex-col">
      {/* Control bar — app chrome */}
      <div className="flex items-center gap-2 px-4 py-2 bg-navy-800 border-b border-white/5 shrink-0">
        <div className="flex bg-navy-900 border border-white/10 rounded-lg overflow-hidden">
          <Tooltip content="No corner badge"><button className={segCls(overlay === 'none')} onClick={() => setOverlay('none')}>—</button></Tooltip>
          <Tooltip content="Duration badge — regular uploads"><button className={segCls(overlay === 'duration')} onClick={() => setOverlay('duration')}>12:34</button></Tooltip>
          <Tooltip content="LIVE badge — active live streams"><button className={segCls(overlay === 'live')} onClick={() => setOverlay('live')}>LIVE</button></Tooltip>
          <Tooltip content="Upcoming badge — scheduled broadcasts"><button className={segCls(overlay === 'upcoming')} onClick={() => setOverlay('upcoming')}>Upcoming</button></Tooltip>
        </div>
        <Tooltip content="Watched-progress bar along the bottom edge">
          <button className={chipCls(watched)} onClick={() => setWatched(!watched)}>Watched</button>
        </Tooltip>
        <Tooltip content="Preview against YouTube’s light theme">
          <button className={chipCls(lightBg)} onClick={() => setLightBg(!lightBg)}>Light</button>
        </Tooltip>
        {!snapshot && (
          <span className="flex items-center gap-1.5 text-[10px] text-gray-400 ml-auto">
            <Loader2 size={11} className="animate-spin" /> Rendering…
          </span>
        )}
      </div>
      {/* Mockups — YouTube chrome. font-roboto here puts every mockup text
          element in YouTube's actual UI font; the surface labels opt back
          out via labelCls (font-sans) since they're ours. */}
      <div className={`flex-1 overflow-y-auto font-roboto transition-colors ${lightBg ? 'bg-white' : 'bg-[#0f0f0f]'}`}>
        <div className="p-5 flex flex-col gap-7 items-start">
          <div className="flex flex-col gap-1.5">
            <p className={labelCls}>Home · 360×202</p>
            <div className="w-[360px]">
              <PreviewThumb snapshot={snapshot} w={360} h={202} radius={12} overlay={overlay} watched={watched} />
              <div className="flex gap-3 mt-3">
                <div className={`w-9 h-9 rounded-full shrink-0 ${fillCls}`} />
                <div className="min-w-0">
                  <p className={`text-sm font-medium leading-snug line-clamp-2 ${titleCls}`}>{displayTitle}</p>
                  <p className={`text-xs mt-1 ${metaCls}`}>{channelName}</p>
                  <p className={`text-xs ${metaCls}`}>{meta}</p>
                </div>
              </div>
            </div>
          </div>
          <div className="flex flex-col gap-1.5">
            <p className={labelCls}>Search · 360×202</p>
            <div className="flex gap-4 max-w-full">
              <PreviewThumb snapshot={snapshot} w={360} h={202} radius={12} overlay={overlay} watched={watched} />
              <div className="min-w-0 pt-1 w-64">
                <p className={`text-base leading-snug line-clamp-2 ${titleCls}`}>{displayTitle}</p>
                <p className={`text-xs mt-1.5 ${metaCls}`}>{meta}</p>
                <div className="flex items-center gap-2 mt-2.5">
                  <div className={`w-6 h-6 rounded-full shrink-0 ${fillCls}`} />
                  <span className={`text-xs truncate ${metaCls}`}>{channelName}</span>
                </div>
                <div className={`h-2 rounded mt-3 w-11/12 ${fillCls}`} />
                <div className={`h-2 rounded mt-1.5 w-2/3 ${fillCls}`} />
              </div>
            </div>
          </div>
          <div className="flex flex-col gap-1.5">
            <p className={labelCls}>Suggested · 168×94</p>
            <div className="flex gap-2 w-[400px] max-w-full">
              <PreviewThumb snapshot={snapshot} w={168} h={94} radius={8} overlay={overlay} watched={watched} />
              <div className="min-w-0">
                <p className={`text-sm font-medium leading-snug line-clamp-2 ${titleCls}`}>{displayTitle}</p>
                <p className={`text-xs mt-0.5 ${metaCls}`}>{channelName}</p>
                <p className={`text-xs ${metaCls}`}>{meta}</p>
              </div>
            </div>
          </div>
          <div className="flex flex-col gap-1.5">
            <p className={labelCls}>Compact · 120×68</p>
            <div className="flex gap-2 w-[360px] max-w-full">
              <PreviewThumb snapshot={snapshot} w={120} h={68} radius={6} overlay={overlay} watched={watched} />
              <div className="min-w-0">
                <p className={`text-xs font-medium leading-snug line-clamp-2 ${titleCls}`}>{displayTitle}</p>
                <p className={`text-[11px] mt-0.5 ${metaCls}`}>{channelName} · {meta}</p>
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  )
}

// ── Background thumbnail re-render ───────────────────────────────────────────
// Renders a stream's SM thumbnails to PNG against its CURRENT meta without
// opening the editor. Purpose: New Episode creation copies the previous
// episode's thumbnail files, and the PNGs arrive baked with the SOURCE
// episode's merge-field values ({episode}, {title}, …) — they used to stay
// wrong until the user opened the editor and touched something. The canvas
// JSON stores merge MARKERS, so re-rendering it against the new stream's
// fields produces the correct image.
//
// Failure model: a render that can't be produced faithfully is SKIPPED and
// the variant is flagged in meta.smThumbnailStale — assets missing or
// unreadable (deleted, or a cloud placeholder with the sync service not
// running), or a text layer's font not installed. Thumbnail surfaces
// overlay "Could not load references" from that flag; the stale PNG is
// never silently overwritten with a broken render.

/** Merge-field values from a PendingThumbnailStream — mirrors the editor's
 *  mergeFieldValues (keep the two in sync). */
function buildRerenderMergeFields(s: PendingThumbnailStream): Record<string, string> {
  const m = s.meta
  return {
    title: m?.ytCatchyTitle || renderTitleFromMeta(m, {
      totalEpisodes: s.totalEpisodes,
      fallback: s.title,
    }) || '',
    topic: m?.ytGameTitle || m?.games?.[0] || '',
    game: m?.ytGameTitle || m?.games?.[0] || '',
    date: s.date,
    season: m?.ytSeason || '1',
    episode: m?.ytEpisode || '1',
    total_episodes: s.totalEpisodes ? String(s.totalEpisodes) : '',
  }
}

function BackgroundRerender({ request }: { request: (PendingThumbnailStream & { token: number }) | null }) {
  // The variant currently mounted on the hidden stage; null between jobs.
  const [job, setJob] = useState<{ layers: ThumbnailLayer[]; fields: Record<string, string> } | null>(null)
  const stageRef = useRef<Konva.Stage | null>(null)

  useEffect(() => {
    if (!request) return
    let cancelled = false
    const nextFrame = () => new Promise<void>(r => requestAnimationFrame(() => r()))

    void (async () => {
      const { folderPath, date } = request
      const ordinals = await window.api.thumbnailListVariants(folderPath, date).catch(() => [] as number[])
      if (cancelled || ordinals.length === 0) return
      const fields = buildRerenderMergeFields(request)
      const stale: Record<string, { reason: 'assets' | 'font'; at: number }> = { ...(request.meta?.smThumbnailStale ?? {}) }
      let staleChanged = false

      for (const ordinal of ordinals) {
        if (cancelled) return
        const doc = await window.api.thumbnailLoadCanvas(folderPath, date, ordinal).catch(() => null)
        const layers: ThumbnailLayer[] = paintableLayers(normalizeLayers((doc?.layers ?? []) as ThumbnailLayer[]))
        if (!doc || layers.length === 0) continue

        // Preflight fonts: baking a substitute font into the PNG is the
        // same silent corruption the editor's missing-font guard exists
        // to prevent. document.fonts.check resolves installed system
        // fonts as well as loaded webfonts in Chromium.
        const fontFamilies = [...new Set(layers.filter(l => l.type === 'text' && l.fontFamily).map(l => l.fontFamily!))]
        const missingFont = fontFamilies.some(f => {
          try { return !document.fonts.check(`16px "${f.replace(/"/g, '')}"`) } catch { return false }
        })
        if (missingFont) {
          stale[String(ordinal)] = { reason: 'font', at: Date.now() }
          staleChanged = true
          continue
        }

        // Preflight image assets: decode each referenced file directly.
        // Catches deleted files AND cloud placeholders that can't hydrate
        // (sync service not running) — with a timeout so a hung
        // placeholder read can't stall the queue forever. Successful
        // decodes also warm the browser cache, so the stage's own image
        // loads below resolve quickly.
        const srcs = [...new Set(layers.filter(l => l.type === 'image' && l.src).map(l => l.src!))]
        let assetsOk = true
        for (const src of srcs) {
          const ok = await Promise.race([
            (async () => {
              const im = new Image()
              im.src = `file://${src}`
              try { await im.decode(); return im.naturalWidth > 0 } catch { return false }
            })(),
            new Promise<boolean>(r => setTimeout(() => r(false), 10_000)),
          ])
          if (!ok) { assetsOk = false; break }
        }
        if (cancelled) return
        if (!assetsOk) {
          stale[String(ordinal)] = { reason: 'assets', at: Date.now() }
          staleChanged = true
          continue
        }

        // Mount the hidden stage with this variant's layers, wait for its
        // Konva image nodes to attach their (cache-warm) bitmaps, snapshot.
        setJob({ layers, fields })
        await nextFrame()
        await nextFrame()
        const stage = stageRef.current
        if (stage) {
          const start = Date.now()
          const pending = () => stage.find('Image').filter(node => {
            const im = (node as Konva.Image).image()
            if (!im) return true
            return im instanceof HTMLImageElement && (!im.complete || im.naturalWidth === 0)
          })
          while (pending().length > 0 && Date.now() - start < 5000) {
            await nextFrame()
          }
          // Group effects (THU-31) rasterize after the images land.
          await waitForGroupRasters()
          await nextFrame()
        }
        if (cancelled) { setJob(null); return }
        const url = stageRef.current?.toDataURL({ pixelRatio: 1 }) ?? null
        setJob(null)
        if (!url) continue
        try {
          // Same doc back + fresh PNG; saveCanvas also fires the scoped
          // streams:changed so the row's thumbnail refreshes.
          await window.api.thumbnailSaveCanvas(folderPath, date, doc, url, ordinal)
          if (stale[String(ordinal)]) {
            delete stale[String(ordinal)]
            staleChanged = true
          }
        } catch (err) {
          console.warn(`[thumbnail rerender] save failed for ${date} v${ordinal}:`, err)
        }
      }

      if (staleChanged && !cancelled) {
        await window.api.updateStreamMeta(folderPath, { smThumbnailStale: stale }).catch(() => {})
      }
    })()

    return () => { cancelled = true; setJob(null) }
  }, [request?.token]) // eslint-disable-line react-hooks/exhaustive-deps

  if (!job) return null
  const noop = () => {}
  return (
    // Offscreen but real: Konva needs an actual canvas to rasterize.
    <div style={{ position: 'fixed', left: -100000, top: 0, width: CANVAS_W, height: CANVAS_H, pointerEvents: 'none' }} aria-hidden>
      <Stage ref={stageRef} width={CANVAS_W} height={CANVAS_H} listening={false}>
        <Layer listening={false}>
          <LayerNodes layers={job.layers} parentId={null} makeProps={layer => {
            const props: KonvaLayerNodeProps = {
              layer,
              isSelected: false,
              onSelect: noop,
              onChange: noop,
              scale: 1,
              onDragStart: noop,
              onSnapDragMove: noop,
              onDragEnd: noop,
              onTransformEnd: noop,
              onClearGuides: noop,
              gridSnapEnabled: false,
              mergeFields: job.fields,
              nested: !!layer.parentId,
              inert: true,
            }
            return props
          }} />
        </Layer>
      </Stage>
    </div>
  )
}

/** The stream's selected thumbnail, resolved the same way the streams list
 *  does it (StreamsPage.resolveStreamThumb): preferredThumbnail basename →
 *  matching path → first thumbnail. Keep the two in sync. */
function resolveStreamItemThumb(folder: StreamFolder): string | null {
  if (folder.thumbnails.length === 0) return null
  const preferredName = folder.meta?.preferredThumbnail
  if (preferredName) {
    const match = folder.thumbnails.find(p => (p.split(/[\\/]/).pop() ?? '') === preferredName)
    if (match) return match
  }
  return folder.thumbnails[0]
}

interface OverviewProps {
  streamsDir: string
  templates: ThumbnailTemplate[]
  recents: Array<ThumbnailRecentEntry & { variantCount?: number; thumbPath?: string | null }>
  onNewBlank: () => void
  onOpenTemplate: (t: ThumbnailTemplate) => void
  onOpenRecent: (entry: ThumbnailRecentEntry) => void
  onRemoveRecent: (entry: ThumbnailRecentEntry) => void
  onClearRecents: () => void
  onDeleteTemplate: (t: ThumbnailTemplate) => void
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
                className="group relative bg-navy-800 border border-white/10 rounded-lg overflow-hidden cursor-pointer hover:border-accent-500/50 transition-colors"
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
                      onClick={e => { e.stopPropagation(); onDeleteTemplate(t) }}
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
                // Follows the stream's SELECTED thumbnail (thumbPath) — the
                // hardcoded variant-1 filename is only the fallback for
                // entries whose stream folder wasn't found at load time.
                thumbSrc={entry.thumbPath
                  ? `file://${entry.thumbPath.replace(/\\/g, '/')}?t=${entry.updatedAt}`
                  : `file://${entry.folderPath.replace(/\\/g, '/')}/${entry.date}_sm-thumbnail.png?t=${entry.updatedAt}`}
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
/** Palette + recent colors, provided by the editor around PropertiesPanel.
 *  Context (not props): ColorAlphaField has a dozen call sites deep inside
 *  the panel, and every one of them gets drag-apply, the palette popover,
 *  and recents recording for free this way. */
const PaletteContext = createContext<{
  palette: PaletteSwatch[]
  /** Palette-filtered recents, newest first. The id is EPHEMERAL (per app
   *  session) — it's what a session tie points at so tweaks update one
   *  entry in place instead of spawning siblings. */
  recents: { id: number; value: SwatchValue }[]
  /** Record a committed swatch value (picker close, hex entry, opacity
   *  change, swatch apply, gradient edit). `tieKey` scopes the session
   *  tie — same key while the same layer stays selected updates the same
   *  recents entry. */
  recordRecent: (value: SwatchValue, tieKey?: string) => void
  /** Break one session tie early (e.g. toggling a fill back to Solid ends
   *  the gradient editing session even though the layer stays selected). */
  breakRecentTie: (tieKey: string) => void
}>({ palette: [], recents: [], recordRecent: () => {}, breakRecentTie: () => {} })

/** Drag payload type for palette swatches → color fields. */
const COLOR_DRAG_MIME = 'application/x-sm-color'
/** Drag payload type for GRADIENT swatches → Fill controls (JSON-encoded
 *  GradientSwatchData). A separate MIME so solid-only fields (stroke,
 *  outline, shadows) never light up for a drag they can't accept. */
const GRADIENT_DRAG_MIME = 'application/x-sm-gradient'

/** Runtime swatch value: a solid (full hex — alpha allowed; swatches are
 *  FULL field snapshots, so applying one applies its opacity too) or a
 *  gradient snapshot (stops + angle + blend space). */
type SwatchValue = { color: string } | { gradient: GradientSwatchData }

/** Canonical identity for dedup and session-tie bookkeeping: solids
 *  normalize to 8 lowercase digits, gradients serialize their sorted
 *  stops + angle + space. */
function swatchKey(v: SwatchValue): string {
  if ('color' in v) {
    const p = parseHexEntry(v.color)
    if (!p) return `s:${v.color.toLowerCase()}`
    const a = Math.round((p.alpha ?? 1) * 255).toString(16).padStart(2, '0')
    return `s:${p.rgb}${a}`
  }
  const g = v.gradient
  const stops = [...g.stops].sort((x, y) => x.pos - y.pos).map(st => `${st.color.toLowerCase()}@${st.pos}`).join(',')
  return `g:${g.colorSpace}:${Math.round(g.angle)}:${stops}`
}

/** Tile background for any swatch: content layered over the transparency
 *  checker. Gradient tiles render at their TRUE angle — the tile is the
 *  one surface where a swatch's direction shows (the editor's spine bar
 *  deliberately does not). */
function swatchTileStyle(v: SwatchValue): React.CSSProperties {
  const top = 'color' in v
    ? `linear-gradient(${v.color}, ${v.color})`
    // The swatch's real geometry: a radial or conic swatch reads as one
    // (cssGradientOfKind handles the app-to-CSS angle conversion).
    : cssGradientOfKind(v.gradient.stops, v.gradient.colorSpace, v.gradient.style ?? 'smooth', swatchGeometry(v.gradient))
  return {
    backgroundImage: `${top}, ${CHECKER_IMAGE}`,
    backgroundSize: 'auto, 6px 6px',
    backgroundRepeat: 'no-repeat, repeat',
  }
}

/** Descriptive tooltip line(s) for a swatch — call sites append their own
 *  interaction hints. Solids show bare hex (+opacity when not 100%);
 *  gradients show the stop run, angle, and blend space. */
function swatchDescription(v: SwatchValue): React.ReactNode {
  if ('color' in v) {
    const p = parseHexEntry(v.color)
    const pct = Math.round((p?.alpha ?? 1) * 100)
    return <div className="tabular-nums">{(p?.rgb ?? v.color).replace('#', '').toUpperCase()}{pct < 100 ? ` · ${pct}%` : ''}</div>
  }
  const g = v.gradient
  const stops = [...g.stops].sort((x, y) => x.pos - y.pos)
  return (
    <>
      <div className="tabular-nums">{stops.map(st => st.color.replace('#', '').toUpperCase()).join(' → ')}</div>
      <div>{Math.round(g.angle)}° · {g.colorSpace === 'srgb' ? 'sRGB' : 'oklch'}</div>
    </>
  )
}

/** PaletteSwatch (storage shape) → runtime SwatchValue; null for malformed
 *  entries (neither color nor gradient). */
function paletteSwatchValue(s: PaletteSwatch): SwatchValue | null {
  if (s.gradient) return { gradient: s.gradient }
  if (typeof s.color === 'string') return { color: s.color }
  return null
}

/** CSS checkerboard used as the transparency backdrop wherever a color
 *  can be see-through (color-field swatches, the gradient preview bar).
 *  Pair with a `backgroundSize` — 6px for swatch-sized boxes, 8px for
 *  larger surfaces. */
const CHECKER_IMAGE = 'conic-gradient(#3d4257 90deg, #23283c 90deg 180deg, #3d4257 180deg 270deg, #23283c 270deg)'
/** Drag payload for edit-mode swatch REORDERING — deliberately a different
 *  type so color fields never light up (or accept) a reorder drag. */
const SWATCH_REORDER_MIME = 'application/x-sm-swatch-reorder'
/** Marker type set alongside the color or gradient payload when the drag
 *  starts on a RECENT tile (THU-10). The palette grid accepts only drags
 *  carrying it: a saved swatch dragged over its own grid is on its way to
 *  a color field and must not offer an insertion point. */
const RECENT_DRAG_MIME = 'application/x-sm-recent'

/** The swatch a color-field style drag carries, solid or gradient; null
 *  when the payload is missing or malformed. */
function readDraggedSwatch(dt: DataTransfer): SwatchValue | null {
  const rawGradient = dt.getData(GRADIENT_DRAG_MIME)
  if (rawGradient) {
    try {
      const g = JSON.parse(rawGradient) as GradientSwatchData
      return Array.isArray(g?.stops) && g.stops.length >= 2 ? { gradient: g } : null
    } catch {
      return null
    }
  }
  const color = dt.getData(COLOR_DRAG_MIME)
  return color ? { color } : null
}

/** Replace the default drag snapshot — which bakes in the dashed frame and
 *  the panel background behind the rounded corners — with a clean rounded
 *  square of the raw color. The square itself is fully opaque; the slight
 *  ghosting on top of it is the browser's own drag rendering and isn't
 *  controllable. */
function setColorDragImage(e: React.DragEvent, value: SwatchValue | string) {
  const el = document.createElement('div')
  el.style.cssText = 'width:20px;height:20px;border-radius:5px;position:fixed;top:-100px;left:-100px;pointer-events:none;'
  Object.assign(el.style, swatchTileStyle(typeof value === 'string' ? { color: value } : value))
  document.body.appendChild(el)
  e.dataTransfer.setDragImage(el, 10, 10)
  // Chromium snapshots the element during dragstart; safe to drop it after.
  setTimeout(() => el.remove(), 0)
}

/** Recents tile — dashed OUTER border with the color fill inset inside it,
 *  so the border only ever contrasts against the panel background (a border
 *  drawn over the color itself was invisible on bright swatches). Shared by
 *  the palette panel and the per-field popover so the two can't drift. */
const RECENT_TILE_CLS = 'w-5 h-5'
const RECENT_FILL_CLS = 'block w-full h-full rounded-[5px] border border-dashed border-white/50'

/** Popover CONTENT shared by the per-field popover and the gradient
 *  control's header popover: palette grid first, recents below, mirroring
 *  the palette panel's order so muscle memory transfers. Which swatches
 *  appear follows which apply handlers exist — a solid-only field never
 *  shows gradient tiles it couldn't apply, and the gradient header
 *  popover never shows solids. Picks keep the popover open (the caller
 *  closes it where applying reshapes the UI). */
function SwatchPopoverBody({ onApplySolid, onApplyGradient }: {
  onApplySolid?: (color: string) => void
  onApplyGradient?: (g: GradientSwatchData) => void
}) {
  const { palette, recents } = useContext(PaletteContext)
  const keep = (v: SwatchValue) => ('color' in v ? !!onApplySolid : !!onApplyGradient)
  const pal = palette.flatMap(s => {
    const v = paletteSwatchValue(s)
    return v && keep(v) ? [v] : []
  })
  const rec = recents.filter(e => keep(e.value))
  const apply = (v: SwatchValue) => {
    if ('color' in v) onApplySolid?.(v.color)
    else onApplyGradient?.(v.gradient)
  }
  return (
    <>
      {pal.length === 0 ? (
        <p className="text-[10px] text-gray-400 px-1">
          {onApplySolid
            ? 'Palette is empty — add colors in the Palette panel.'
            : 'No gradients in the palette yet — edit a gradient, then save it from the Recent row.'}
        </p>
      ) : (
        <div className="flex flex-wrap gap-1.5">
          {pal.map((v, i) => (
            <Tooltip key={`${swatchKey(v)}-${i}`} content={swatchDescription(v)}>
              <button type="button" onClick={() => apply(v)} className="w-5 h-5 rounded-md border border-white/50" style={swatchTileStyle(v)} />
            </Tooltip>
          ))}
        </div>
      )}
      {rec.length > 0 && (
        <>
          <div className="border-t border-white/20" />
          <p className="text-[9px] uppercase tracking-wider text-gray-400">Recent</p>
          <div className="flex flex-wrap gap-1.5">
            {rec.map(e => (
              <Tooltip key={e.id} content={swatchDescription(e.value)}>
                <button type="button" onClick={() => apply(e.value)} className={RECENT_TILE_CLS}>
                  <span className={RECENT_FILL_CLS} style={swatchTileStyle(e.value)} />
                </button>
              </Tooltip>
            ))}
          </div>
        </>
      )}
    </>
  )
}

function ColorAlphaField({ value, fallback, onChange, showHex = false, stopPos, onStopPosChange, recentKey, onCommitColor, onApplyGradient }: {
  value: string | undefined
  fallback: string
  onChange: (v: string) => void
  /** Show the free-text hex input (accepts #rrggbb / #rrggbbaa). */
  showHex?: boolean
  /** Gradient-stop mode: the stop's height on the preview bar (1 = top,
   *  0 = bottom), rendered as a 0.0–1.0 field right of the swatch
   *  (fractional on purpose — visually distinct from the %-based
   *  opacity). This is the DISPLAY value; the caller converts to/from the
   *  stored gradient-line position. Provide both or neither. */
  stopPos?: number
  onStopPosChange?: (pos: number) => void
  /** Session-tie key for recents (`layerId:property`). While the same
   *  layer stays selected, commits from this field UPDATE its recents
   *  entry in place instead of spawning one per tweak. Omit to record
   *  untied (old behavior) — or to not record at all when onCommitColor
   *  redirects commits. */
  recentKey?: string
  /** Overrides recents recording entirely: gradient STOP fields report
   *  their commits to the gradient control (which records the whole
   *  gradient as one swatch) instead of dropping solids into recents. */
  onCommitColor?: (fullColor: string) => void
  /** Fill fields only: lets the popover offer gradient swatches too.
   *  Picking one hands the whole gradient to the fill control (which
   *  switches to gradient mode) — so the popover closes on pick, since
   *  this solid-mode field unmounts with the switch. */
  onApplyGradient?: (g: GradientSwatchData) => void
}) {
  const { rgb, alpha } = splitColorAlpha(value, fallback)
  const { recordRecent, breakRecentTie } = useContext(PaletteContext)

  // A COMMIT — picker close, hex entry, opacity change, Esc-zero, swatch
  // apply/drop — records the FULL field snapshot (color incl. alpha).
  // Ref-routed so the once-mounted native `change` listener always sees
  // the current handler and alpha.
  const commitRecent = (fullColor: string) => {
    if (onCommitColor) onCommitColor(fullColor)
    else recordRecent({ color: fullColor }, recentKey)
  }
  const commitRecentRef = useRef(commitRecent)
  commitRecentRef.current = commitRecent
  const alphaRef = useRef(alpha)
  alphaRef.current = alpha
  const wrapRef = useRef<HTMLDivElement>(null)
  const colorInputRef = useRef<HTMLInputElement>(null)
  const [paletteOpen, setPaletteOpen] = useState(false)
  const [dragHover, setDragHover] = useState(false)
  // In-progress hex text. While non-null it OWNS what the field shows, so
  // the two alpha digits of an 8-digit entry stay on screen and editable
  // instead of being swallowed into the opacity field the moment they're
  // typed. Each keystroke still commits when it parses (canvas + opacity
  // track live); blur clears the draft, handing display back to the
  // canonical color.
  const [hexDraft, setHexDraft] = useState<string | null>(null)
  // Resting display drops the leading '#'. It's a constant prefix that
  // carries no information next to the swatch, costs a character in a
  // cramped monospace field, and matches how design tools (Figma,
  // Photoshop) present hex. Input still accepts it — parseHexEntry makes
  // it optional — and a typed '#' stays visible until blur via the draft.
  const restingHex = (
    value && /^#[0-9a-fA-F]{8}$/.test(value) ? value.slice(0, 7) : (value ?? fallback)
  ).replace(/^#/, '')

  // Flags text that can NEVER become a color: a stray non-hex character,
  // or more digits than the longest valid form holds. A clean-but-short
  // entry ("00") is unfinished typing, not a mistake, so it stays
  // unmarked.
  const hexInvalid = (() => {
    if (hexDraft === null) return false
    const t = hexDraft.trim()
    if (t === '') return false
    const m = /^#?([0-9a-fA-F]*)$/.exec(t)
    return !m || m[1].length > 8
  })()
  const popRef = useRef<HTMLDivElement>(null)
  // Anchor for the PORTALED popover: rendered inline it was clipped by the
  // sidebar's overflow-hidden (a 246px popover in a 256px sidebar).
  // Right-aligned to the field, flipping above when the field sits near the
  // bottom of the window.
  const [popPos, setPopPos] = useState<{ top?: number; bottom?: number; right: number } | null>(null)
  const openPopover = () => {
    const r = wrapRef.current?.getBoundingClientRect()
    if (!r) return
    const estimatedHeight = 220
    setPopPos(r.bottom + estimatedHeight > window.innerHeight
      ? { bottom: window.innerHeight - r.top + 4, right: window.innerWidth - r.right }
      : { top: r.bottom + 4, right: window.innerWidth - r.right })
    setPaletteOpen(true)
  }

  // Recents feed from the native picker: React's onChange is the `input`
  // event (fires per tick while dragging inside the dialog); the native
  // `change` event fires once when the dialog closes — THAT color is the
  // one worth remembering. Full snapshot: the picker's rgb joined with
  // the field's current alpha.
  useEffect(() => {
    const el = colorInputRef.current
    if (!el) return
    const onCommit = () => commitRecentRef.current(joinColorAlpha(el.value, alphaRef.current))
    el.addEventListener('change', onCommit)
    return () => el.removeEventListener('change', onCommit)
  }, [])

  // Outside-click closes the palette popover. The popover is portaled, so
  // both the field and the popover count as "inside".
  useEffect(() => {
    if (!paletteOpen) return
    const onDown = (e: MouseEvent) => {
      const t = e.target as Node
      if (wrapRef.current?.contains(t) || popRef.current?.contains(t)) return
      setPaletteOpen(false)
    }
    document.addEventListener('mousedown', onDown)
    return () => document.removeEventListener('mousedown', onDown)
  }, [paletteOpen])

  // Swatches are FULL snapshots — applying one applies its opacity too
  // (the old keep-target-alpha rule died with the rgb-only palette).
  // ADOPTING a swatch is not this field's own editing session: it records
  // UNTIED (the value just moves to the front of recents) and breaks the
  // field's live tie, so a later tweak starts a NEW entry instead of
  // mutating the swatch that was adopted.
  const applySwatch = (fullColor: string) => {
    onChange(fullColor)
    if (onCommitColor) {
      // Gradient stop fields: dropping a color on a stop IS gradient
      // editing — the gradient control records it under its own tie.
      onCommitColor(fullColor)
    } else {
      if (recentKey) breakRecentTie(recentKey)
      recordRecent({ color: fullColor })
    }
  }

  return (
    <div
      ref={wrapRef}
      className={`relative flex items-center min-w-0 rounded-lg ${dragHover ? 'ring-1 ring-accent-300/60' : ''}`}
      // The whole field sits inside a <label>: clicks on our custom controls
      // would otherwise FORWARD to the label's first control — the native
      // color input — and pop its dialog (the phantom picker seen after
      // closing the palette popover). Only a direct click on the input
      // itself may activate it.
      onClick={e => { if (e.target !== colorInputRef.current) e.preventDefault() }}
      onDragOver={e => {
        if (!e.dataTransfer.types.includes(COLOR_DRAG_MIME)) return
        e.preventDefault()
        e.dataTransfer.dropEffect = 'copy'
        setDragHover(true)
      }}
      onDragLeave={e => {
        const related = e.relatedTarget as Node | null
        if (related && e.currentTarget.contains(related)) return
        setDragHover(false)
      }}
      onDrop={e => {
        const color = e.dataTransfer.getData(COLOR_DRAG_MIME)
        setDragHover(false)
        if (!color) return
        e.preventDefault()
        applySwatch(color)
      }}
    >
      {/* Unified input: swatch | hex | opacity share ONE frame (single
          border/background, thin internal dividers) so the row reads as a
          single control instead of three boxes. */}
      <div className="flex items-stretch flex-1 min-w-0 h-6 bg-navy-900 border border-white/10 rounded-lg overflow-visible focus-within:border-accent-500/50 transition-colors">
        {/* Checker sits BEHIND the swatch (opaque wrapper + alpha-faded
            input on top), so a transparent color reveals the pattern
            rather than the panel background. */}
        <div
          className="h-6 w-6 -my-[1px] -mx-[1px] shrink-0 rounded-s-md overflow-hidden z-1"
          style={{ backgroundImage: CHECKER_IMAGE, backgroundSize: '8px 8px' }}
        >
          <input
            ref={colorInputRef}
            type="color"
            value={rgb}
            onChange={e => onChange(joinColorAlpha(e.target.value, alpha))}
            // The webkit pseudo-element rules make the color chip fill the
            // segment with its own rounding instead of the tiny native chip.
            className="block h-full w-full bg-transparent cursor-pointer [&::-webkit-color-swatch-wrapper]:p-0 [&::-webkit-color-swatch]:rounded-s-md [&::-webkit-color-swatch]:border-white/50"
            // Fade the swatch with the alpha so transparency is visible at a glance.
            style={{ opacity: 0.35 + 0.65 * alpha }}
          />
        </div>
        {stopPos !== undefined && onStopPosChange && (
          <Tooltip content="Stop position on the bar" triggerClassName="flex w-12 shrink-0 border-l border-white/10">
            <NumberInput
              min={0}
              max={1}
              step={0.01}
              value={stopPos}
              onChange={onStopPosChange}
              className="w-full h-6 min-w-12"
              frameless
              merged
            />
          </Tooltip>
        )}
        {showHex && (
          <input
            type="text"
            // Resting display is the rgb digits only — opacity lives in the
            // % field beside it. While typing, the draft takes over.
            value={hexDraft ?? restingHex}
            onChange={e => {
              const raw = e.target.value
              setHexDraft(raw)
              // Commit only parseable entries: an in-progress or malformed
              // string never becomes the layer's color, so the canvas can't
              // be handed something it won't render. `alpha ?? current`
              // keeps the field's opacity unless the entry supplied one.
              const parsed = parseHexEntry(raw)
              if (parsed) onChange(joinColorAlpha(parsed.rgb, parsed.alpha ?? alpha))
            }}
            // Editing ends: drop the draft so the canonical value shows
            // again. Text that never parsed simply falls away — the last
            // committed color is already intact, nothing to revert. A
            // parsed entry commits the full snapshot (entry's own alpha
            // when it carried one, the field's otherwise).
            onBlur={() => {
              const parsed = hexDraft !== null ? parseHexEntry(hexDraft) : null
              if (parsed) commitRecent(joinColorAlpha(parsed.rgb, parsed.alpha ?? alpha))
              setHexDraft(null)
            }}
            // Escape zeroes the field (#000000 is the zero color, matching
            // the opacity field's Esc → 0) — the keyboard replacement for
            // the removed clear button. Alpha is untouched: this segment
            // owns rgb only. An open palette popover takes Escape first,
            // innermost-overlay-wins.
            onKeyDown={e => {
              if (e.key !== 'Escape') return
              e.preventDefault()
              e.stopPropagation()
              if (paletteOpen) { setPaletteOpen(false); return }
              // Drop the draft too, or the zeroed color would stay hidden
              // behind whatever text was mid-edit.
              setHexDraft(null)
              const zeroed = joinColorAlpha('#000000', alpha)
              onChange(zeroed)
              commitRecent(zeroed)
            }}
            // 9 = '#' + 8 digits, the longest valid form. Deliberately NOT
            // narrowed to 8 for the now-bare display: the limit is applied
            // at paste time, when the draft doesn't yet contain the '#', so
            // an 8-cap would silently truncate a pasted '#rrggbbaa' to
            // seven digits. A 9th bare digit is caught by hexInvalid
            // instead, which shows the user what's wrong rather than
            // swallowing a keystroke.
            maxLength={9}
            className={`flex-1 min-w-0 bg-transparent border-l border-white/10 px-1 text-xs text-gray-200 focus:outline-none h-6 font-mono ${
              hexInvalid ? 'ring-1 ring-inset ring-red-500' : ''
            }`}
          />
        )}
        <Tooltip content="Opacity % — Esc clears to 0" triggerClassName="flex w-11 shrink-0 border-l border-white/10">
          <NumberInput
            min={0}
            max={100}
            value={Math.round(alpha * 100)}
            // Opacity edits are commits too — alpha is part of the swatch
            // now, so tweaking it updates this field's tied recents entry.
            onChange={p => {
              const next = joinColorAlpha(rgb, p / 100)
              onChange(next)
              commitRecent(next)
            }}
            className="w-full h-6"
            frameless
            merged
            // Replaces the old clear button: Esc here = fully transparent.
            onEscape={() => {
              if (paletteOpen) { setPaletteOpen(false); return }
              const next = joinColorAlpha(rgb, 0)
              onChange(next)
              commitRecent(next)
            }}
          />
        </Tooltip>
      </div>
      <Tooltip content="Apply a palette color">
        <button
          type="button"
          onClick={() => { if (paletteOpen) setPaletteOpen(false); else openPopover() }}
          className={`p-1 rounded shrink-0 transition-colors ${paletteOpen ? 'text-gray-200 bg-white/10' : 'text-gray-400 hover:text-gray-200 hover:bg-white/10'}`}
        >
          <Palette size={12} />
        </button>
      </Tooltip>
      {/* Keyboard-friendly apply path (thumbnails #1): the popover mirrors
          the palette panel — palette grid first, recents below — at the
          same 9-across width so muscle memory from the panel transfers.
          Picks keep the popover OPEN (try several colors in a row; outside
          click / Esc / the toggle closes it). PORTALED to the body: inline
          it was clipped by the sidebar's overflow-hidden. Esc stays local
          (stopPropagation) so it can't bubble into editor shortcuts. */}
      {paletteOpen && popPos && createPortal(
        <div
          ref={popRef}
          className="fixed z-50 w-[246px] bg-navy-800 border border-white/10 rounded-lg shadow-xl p-2 flex flex-col gap-2"
          style={{ top: popPos.top, bottom: popPos.bottom, right: popPos.right }}
          onKeyDown={e => { if (e.key === 'Escape') { e.stopPropagation(); setPaletteOpen(false) } }}
        >
          <SwatchPopoverBody
            onApplySolid={applySwatch}
            // Fill fields also offer gradient swatches: picking one
            // switches the fill to gradient mode, which unmounts this
            // solid-mode field — close the popover with it.
            onApplyGradient={onApplyGradient
              ? g => { onApplyGradient(g); setPaletteOpen(false) }
              : undefined}
          />
        </div>,
        document.body,
      )}
    </div>
  )
}

/** Fill control with the Solid/Gradient toggle and, in gradient mode, the
 *  vertical-spine editor (thumbnails #2). Shared by the shape and text
 *  property sections so the two can't drift.
 *
 *  `layer.fill` always mirrors the first stop, so solid mode and older app
 *  versions (which ignore the gradient fields) degrade to a flat color.
 *  The outer element is a div, NOT a label: it contains buttons and nested
 *  color fields, and label click-forwarding would fire the native picker. */
/** Which layer fields a paint control reads and writes (THU-8): the fill
 *  and the stroke carry parallel field sets, and the same control drives
 *  both. Recents ties are keyed `${layerId}:${tie}` (solid) and
 *  `${layerId}:${tie}-gradient` (gradient), so the two paints never share
 *  an entry. */
type PaintTarget = 'fill' | 'stroke'
const PAINT_FIELDS = {
  fill: { label: 'Fill', color: 'fill', type: 'fillType', stops: 'gradientStops', angle: 'gradientAngle', space: 'gradientColorSpace', style: 'gradientStyle', kind: 'gradientType', centerX: 'gradientCenterX', centerY: 'gradientCenterY', radius: 'gradientRadius', tie: 'fill' },
  stroke: { label: 'Stroke', color: 'stroke', type: 'strokeType', stops: 'strokeGradientStops', angle: 'strokeGradientAngle', space: 'strokeGradientColorSpace', style: 'strokeGradientStyle', kind: 'strokeGradientType', centerX: 'strokeGradientCenterX', centerY: 'strokeGradientCenterY', radius: 'strokeGradientRadius', tie: 'stroke' },
} as const

/** Everything a paint's controls need, read through its field descriptor:
 *  mode, flat color, effective stops (a default pair when none are stored),
 *  blend space, style, geometry, and a patch builder that maps neutral
 *  names onto this paint's fields. Shared by the paint control, the
 *  header mode switch, and the collapsed-card summary (THU-33). */
function paintState(layer: ThumbnailLayer, paint: PaintTarget, fallback: string) {
  const F = PAINT_FIELDS[paint]
  const paintType = layer[F.type] as 'solid' | 'linear' | undefined
  const paintColor = layer[F.color] as string | undefined
  const storedStops = layer[F.stops] as GradientStop[] | undefined
  const patch = (p: { type?: 'solid' | 'linear'; color?: string; stops?: GradientStop[]; angle?: number; space?: GradientColorSpace; style?: GradientStyle; kind?: GradientKind; centerX?: number; centerY?: number; radius?: number }): Partial<ThumbnailLayer> => {
    const out: Record<string, unknown> = {}
    if (p.type !== undefined) out[F.type] = p.type
    if (p.color !== undefined) out[F.color] = p.color
    if (p.stops !== undefined) out[F.stops] = p.stops
    if (p.angle !== undefined) out[F.angle] = p.angle
    if (p.space !== undefined) out[F.space] = p.space
    if (p.style !== undefined) out[F.style] = p.style
    if (p.kind !== undefined) out[F.kind] = p.kind
    if (p.centerX !== undefined) out[F.centerX] = p.centerX
    if (p.centerY !== undefined) out[F.centerY] = p.centerY
    if (p.radius !== undefined) out[F.radius] = p.radius
    return out as Partial<ThumbnailLayer>
  }
  const isGradient = paintType === 'linear'
  // Geometry (THU-9): the kind, the shared center, the radial radius.
  const geom: GradientGeometry = {
    kind: (layer[F.kind] as GradientKind | undefined) ?? 'linear',
    angle: (layer[F.angle] as number | undefined) ?? 0,
    centerX: (layer[F.centerX] as number | undefined) ?? DEFAULT_GRADIENT_GEOMETRY.centerX,
    centerY: (layer[F.centerY] as number | undefined) ?? DEFAULT_GRADIENT_GEOMETRY.centerY,
    radius: (layer[F.radius] as number | undefined) ?? DEFAULT_GRADIENT_GEOMETRY.radius,
  }
  const split = splitColorAlpha(paintColor, fallback)
  const defaultStops: GradientStop[] = [
    { color: paintColor ?? fallback, pos: 0 },
    // Figma convention: fill → same color fully transparent.
    { color: joinColorAlpha(split.rgb, 0), pos: 1 },
  ]
  const stops = (storedStops?.length ?? 0) >= 2 ? storedStops! : defaultStops
  const space = (layer[F.space] as GradientColorSpace | undefined) ?? 'oklch'
  const angle = geom.angle
  const gStyle = (layer[F.style] as GradientStyle | undefined) ?? 'smooth'
  return { F, isGradient, paintColor, stops, space, angle, gStyle, geom, patch }
}

/** Solid-or-gradient paint control for one layer property: the fill (the
 *  original use) or, since THU-8, the stroke. Everything below reads and
 *  writes through `F` so the two never diverge. `headerless` (THU-33) drops
 *  the label row and the mode switch: the card that hosts the control owns
 *  those, and the swatch popover button moves beside the kind switch. */
function GradientFillControl({ layer, update, fallback, paint = 'fill', headerless = false }: {
  layer: ThumbnailLayer
  update: (patch: Partial<ThumbnailLayer>) => void
  fallback: string
  paint?: PaintTarget
  headerless?: boolean
}) {
  const { F, isGradient, paintColor, stops, space, angle, gStyle, geom, patch: paintPatch } = paintState(layer, paint, fallback)

  const anim = useAnimationConfig()
  // Rows display in STOP ORDER (top of the bar first) while the ARRAY
  // keeps insertion order — stable keys (the array index) preserve editing
  // focus and undo identity while rows re-sort, and give the swap
  // animation real elements to move (THU-7 round 2; supersedes the old
  // never-resort decision, whose row-jump objection the FLIP animation
  // resolves). Ties keep insertion order so equal positions don't jitter.
  const sortedOrder = stops
    .map((st, origIdx) => ({ st, origIdx }))
    .sort((a, b) => a.st.pos - b.st.pos || a.origIdx - b.origIdx)
  // origIdx → sorted row slot. The SVG track renders in STABLE array
  // order and only reads row targets from this map: reordering keyed SVG
  // nodes moves them in the DOM, and a moved node loses its pointer
  // capture — that's what broke a slow drag the moment it crossed a
  // neighbor and the rows swapped.
  const rowOf = new Map(sortedOrder.map((o, r) => [o.origIdx, r]))
  // Blender-style smart add anchors on the most recently touched stop.
  const lastTouchedRef = useRef<number | null>(null)
  // Stable per-stop identities for row keys and FLIP. Array indices shift
  // on delete, which made React unmount the LAST index's row and
  // re-content every row after the deleted one — the wrong row visibly
  // vanished. Ids live only in this control: our own add/remove handlers
  // adjust them in place (so those animate correctly), and any EXTERNAL
  // count change (undo/redo, swatch apply, layer switch) regenerates them
  // — those redraws are instant, which is fine.
  const stopIdsRef = useRef<{ layerId: string; ids: number[] }>({ layerId: '', ids: [] })
  const nextStopIdRef = useRef(1)
  if (stopIdsRef.current.layerId !== layer.id || stopIdsRef.current.ids.length !== stops.length) {
    stopIdsRef.current = { layerId: layer.id, ids: stops.map(() => nextStopIdRef.current++) }
  }
  const stopIds = stopIdsRef.current.ids
  // FLIP the rows: any row whose offsetTop changed since the last render
  // glides to its new slot. Measured every render — a handful of rows.
  const rowElsRef = useRef(new Map<number, HTMLDivElement>())
  const rowTopsRef = useRef(new Map<number, number>())
  const rowsSeenRef = useRef(false)
  useLayoutEffect(() => {
    const tops = rowTopsRef.current
    const firstRender = !rowsSeenRef.current
    rowsSeenRef.current = true
    rowElsRef.current.forEach((el, key) => {
      const top = el.offsetTop
      const prev = tops.get(key)
      if (!anim.noAnimation) {
        if (prev === undefined && !firstRender) {
          // Freshly added row: fade in so the insertion reads clearly
          // (the neighbors' FLIP glide shows where it pushed them).
          el.style.transition = 'none'
          el.style.opacity = '0'
          void el.offsetHeight
          el.style.transition = `opacity ${anim.duration(200)}ms linear`
          el.style.opacity = ''
        } else if (prev !== undefined && prev !== top) {
          el.style.transition = 'none'
          el.style.transform = `translateY(${prev - top}px)`
          void el.offsetHeight
          el.style.transition = `transform ${anim.duration(200)}ms linear`
          el.style.transform = ''
        }
      }
      tops.set(key, top)
    })
  })

  // Gradient recents capture: ANY committed gradient edit — stop color,
  // stop position, angle, blend space — records the whole gradient as one
  // swatch, tied per layer so a tweaking session updates a single entry.
  // Merely enabling gradient mode records nothing (the untouched default
  // isn't the user's gradient yet). Individual stop colors deliberately do
  // NOT land in recents as solids — the gradient entry represents the work.
  const { recordRecent, breakRecentTie } = useContext(PaletteContext)
  const recordGradient = (over: Partial<GradientSwatchData> = {}) => {
    recordRecent(
      { gradient: {
        stops: over.stops ?? stops, angle: over.angle ?? angle, colorSpace: over.colorSpace ?? space, style: over.style ?? gStyle,
        kind: over.kind ?? geom.kind, centerX: over.centerX ?? geom.centerX, centerY: over.centerY ?? geom.centerY, radius: over.radius ?? geom.radius,
      } },
      `${layer.id}:${F.tie}-gradient`,
    )
  }

  // Applying a gradient SWATCH (drop or popover pick) sets the whole
  // fill in one go — and switches to gradient mode when needed, so a
  // gradient dropped on a solid fill "just works". ADOPTING a swatch is
  // not this layer's own gradient session: it records UNTIED (the value
  // just moves to the front of recents) and breaks the live tie, so the
  // next gradient tweak starts a NEW entry instead of mutating the
  // adopted swatch — and applying a second swatch can't evict the first.
  const applyGradientSwatch = (g: GradientSwatchData) => {
    const sg = swatchGeometry(g)
    update(paintPatch({
      type: 'linear',
      stops: g.stops,
      angle: g.angle,
      space: g.colorSpace,
      style: g.style ?? 'smooth',
      kind: sg.kind, centerX: sg.centerX, centerY: sg.centerY, radius: sg.radius,
      // The flat color mirrors the first stop (solid-mode / back-compat degrade).
      color: g.stops[0]?.color,
    }))
    // Both ties: the solid tie could still be live from before a mode
    // switch, and post-adoption edits must never mutate old entries.
    breakRecentTie(`${layer.id}:${F.tie}-gradient`)
    breakRecentTie(`${layer.id}:${F.tie}`)
    recordRecent({ gradient: { stops: g.stops, angle: g.angle, colorSpace: g.colorSpace, style: g.style ?? 'smooth', kind: sg.kind, centerX: sg.centerX, centerY: sg.centerY, radius: sg.radius } })
  }

  // The reverse adoption: a SOLID swatch dropped on the control while in
  // gradient mode replaces the gradient with a flat paint. Same adoption
  // semantics — record untied, break both ties.
  const applySolidSwatch = (color: string) => {
    update(paintPatch({ type: 'solid', color }))
    breakRecentTie(`${layer.id}:${F.tie}-gradient`)
    breakRecentTie(`${layer.id}:${F.tie}`)
    recordRecent({ color })
  }

  // Header-row gradient popover (gradient mode): same portal treatment as
  // the field popover — inline it would be clipped by the sidebar.
  const [gradPopOpen, setGradPopOpen] = useState(false)
  const [gradPopPos, setGradPopPos] = useState<{ top?: number; bottom?: number; right: number } | null>(null)
  const gradPopBtnRef = useRef<HTMLButtonElement>(null)
  const gradPopRef = useRef<HTMLDivElement>(null)
  const [gradDragHover, setGradDragHover] = useState(false)
  const openGradPopover = () => {
    const r = gradPopBtnRef.current?.getBoundingClientRect()
    if (!r) return
    const estimatedHeight = 220
    setGradPopPos(r.bottom + estimatedHeight > window.innerHeight
      ? { bottom: window.innerHeight - r.top + 4, right: window.innerWidth - r.right }
      : { top: r.bottom + 4, right: window.innerWidth - r.right })
    setGradPopOpen(true)
  }
  // Outside click / Escape close. Capture-phase Escape so an open popover
  // swallows the key before editor-level shortcuts (deselect) see it.
  useEffect(() => {
    if (!gradPopOpen) return
    const onDown = (e: MouseEvent) => {
      const t = e.target as Node
      if (gradPopBtnRef.current?.contains(t) || gradPopRef.current?.contains(t)) return
      setGradPopOpen(false)
    }
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== 'Escape') return
      e.stopPropagation()
      setGradPopOpen(false)
    }
    document.addEventListener('mousedown', onDown)
    document.addEventListener('keydown', onKey, true)
    return () => {
      document.removeEventListener('mousedown', onDown)
      document.removeEventListener('keydown', onKey, true)
    }
  }, [gradPopOpen])

  const setStop = (idx: number, color: string) => {
    lastTouchedRef.current = idx
    const next = stops.map((st, k) => (k === idx ? { ...st, color } : st))
    update(paintPatch({ stops: next, ...(idx === 0 ? { color } : {}) }))
  }
  const setStopPos = (idx: number, pos: number) => {
    lastTouchedRef.current = idx
    const clamped = Math.min(1, Math.max(0, pos))
    const next = stops.map((st, k) => (k === idx ? { ...st, pos: clamped } : st))
    update(paintPatch({ stops: next }))
    recordGradient({ stops: next })
  }
  // New stops APPEND to the array (stable identity); the sorted display
  // slots them into place. The color samples the gradient at the position
  // so adding a stop doesn't change the ramp.
  const addStop = (pos: number, color?: string) => {
    const clamped = Math.round(Math.min(1, Math.max(0, pos)) * 100) / 100
    // A dropped swatch supplies the color; otherwise the new stop samples
    // the gradient at its position so adding it does not change the ramp.
    const next = [...stops, { color: color ?? sampleGradientAt(stops, space, clamped, gStyle), pos: clamped }]
    lastTouchedRef.current = stops.length
    stopIdsRef.current.ids = [...stopIds, nextStopIdRef.current++]
    update(paintPatch({ stops: next }))
    recordGradient({ stops: next })
  }
  // Blender-style add: halfway between the last-touched stop and its
  // neighbor ABOVE in the sorted rows (the top-most anchor uses the
  // neighbor below instead). The new stop becomes the anchor, so repeated
  // clicks keep subdividing.
  const addStopSmart = (color?: string) => {
    const lt = lastTouchedRef.current
    const anchorOrig = lt !== null && lt < stops.length ? lt : sortedOrder[sortedOrder.length - 1].origIdx
    const rowIdx = sortedOrder.findIndex(o => o.origIdx === anchorOrig)
    const neighborRow = rowIdx > 0 ? rowIdx - 1 : rowIdx + 1
    const a = sortedOrder[rowIdx].st
    const b = sortedOrder[neighborRow].st
    addStop((a.pos + b.pos) / 2, color)
  }
  // The Add stop button is a drop target for solid swatches: the dropped
  // color becomes a new stop at the smart position. It claims the drag
  // (preventDefault) so the control's own drop handler, which would
  // otherwise replace the whole gradient with the solid, stands down.
  const [addStopDragHover, setAddStopDragHover] = useState(false)
  const removeStop = (idx: number) => {
    if (stops.length <= 2) return
    const lt = lastTouchedRef.current
    if (lt !== null) lastTouchedRef.current = lt === idx ? null : lt > idx ? lt - 1 : lt
    stopIdsRef.current.ids = stopIds.filter((_, k) => k !== idx)
    const next = stops.filter((_, k) => k !== idx)
    // The flat color keeps mirroring the FIRST stop (solid-mode / back-compat).
    update(paintPatch({ stops: next, ...(idx === 0 ? { color: next[0].color } : {}) }))
    recordGradient({ stops: next })
  }
  const segCls = (on: boolean) =>
    `px-1.5 py-0.5 text-[10px] transition-colors ${on ? 'bg-accent-600/25 text-accent-200' : 'text-gray-400 hover:text-gray-200 hover:bg-white/5'}`
  return (
    <div
      className={`flex flex-col gap-0.5 rounded-lg ${gradDragHover ? 'ring-1 ring-accent-300/60' : ''}`}
      // The WHOLE control is the gradient-swatch drop target, both modes —
      // a gradient describes the entire fill, not any one sub-field. In
      // gradient mode it ALSO accepts solid drops, replacing the gradient
      // with a solid fill (the symmetric move to gradient-onto-solid).
      // The stop fields keep priority for solids: they preventDefault
      // first and bubble up, so `defaultPrevented` means "a stop claimed
      // this drag" — recolor the stop, don't replace the fill. In solid
      // mode solid drags pass through untouched to the fill field.
      onDragEnter={e => {
        if (e.dataTransfer.types.includes(GRADIENT_DRAG_MIME)) e.preventDefault()
        else if (isGradient && e.dataTransfer.types.includes(COLOR_DRAG_MIME)) e.preventDefault()
      }}
      onDragOver={e => {
        if (e.defaultPrevented) { setGradDragHover(false); return }
        const gradPayload = e.dataTransfer.types.includes(GRADIENT_DRAG_MIME)
        if (!gradPayload && !(isGradient && e.dataTransfer.types.includes(COLOR_DRAG_MIME))) return
        e.preventDefault()
        e.dataTransfer.dropEffect = 'copy'
        setGradDragHover(true)
      }}
      onDragLeave={e => {
        const related = e.relatedTarget as Node | null
        if (related && e.currentTarget.contains(related)) return
        setGradDragHover(false)
      }}
      onDrop={e => {
        setGradDragHover(false)
        if (e.defaultPrevented) return
        const raw = e.dataTransfer.getData(GRADIENT_DRAG_MIME)
        if (raw) {
          e.preventDefault()
          try {
            const g = JSON.parse(raw) as GradientSwatchData
            if (Array.isArray(g?.stops) && g.stops.length >= 2) applyGradientSwatch(g)
          } catch {
            // Malformed payload — drags only originate from our own
            // tiles, so nothing to recover; ignore.
          }
          return
        }
        if (!isGradient) return
        const color = e.dataTransfer.getData(COLOR_DRAG_MIME)
        if (!color) return
        e.preventDefault()
        applySolidSwatch(color)
      }}
    >
      {/* Whole-paint apply path (the gradient swatch popover) lives on the
          header row with the mode switch, or beside the kind switch when
          the card owns the header. Gradient mode only: in solid mode the
          color field's own popover carries gradients. */}
      {!headerless && (
      <div className="flex items-center justify-between">
        <span className="text-[10px] text-gray-400">{F.label}</span>
        <div className="flex items-center gap-1">
          {isGradient && (
            <Tooltip content="Apply a gradient swatch">
              <button
                ref={gradPopBtnRef}
                type="button"
                onClick={() => { if (gradPopOpen) setGradPopOpen(false); else openGradPopover() }}
                className={`p-1 rounded shrink-0 transition-colors ${gradPopOpen ? 'text-gray-200 bg-white/10' : 'text-gray-400 hover:text-gray-200 hover:bg-white/10'}`}
              >
                <Palette size={12} />
              </button>
            </Tooltip>
          )}
          <div className="flex bg-navy-900 border border-white/10 rounded-md overflow-hidden">
          <Tooltip content={`Flat color ${F.label.toLowerCase()}`}>
            <button
              type="button"
              onClick={() => {
                update(paintPatch({ type: 'solid' }))
                // Leaving gradient mode ends that editing session — the
                // captured swatch stays as-is; a later return to gradient
                // mode records a fresh entry.
                breakRecentTie(`${layer.id}:${F.tie}-gradient`)
              }}
              className={segCls(!isGradient)}
            >
              Solid
            </button>
          </Tooltip>
          <Tooltip content={`Linear gradient ${F.label.toLowerCase()} (click the preview bar to add stops)`}>
            <button
              type="button"
              onClick={() => update(paintPatch({
                type: 'linear',
                stops,
                // 0° = top→bottom, matching the preview bar.
                angle,
                space,
              }))}
              className={segCls(isGradient)}
            >
              Gradient
            </button>
          </Tooltip>
          </div>
        </div>
      </div>
      )}
      {gradPopOpen && gradPopPos && createPortal(
        <div
          ref={gradPopRef}
          className="fixed z-50 w-[246px] bg-navy-800 border border-white/10 rounded-lg shadow-xl p-2 flex flex-col gap-2"
          style={{ top: gradPopPos.top, bottom: gradPopPos.bottom, right: gradPopPos.right }}
        >
          {/* Gradients only: this popover applies whole fills, and in
              gradient mode a solid pick has no whole-fill meaning. Picks
              keep it open — try several, close by Esc/outside/toggle. */}
          <SwatchPopoverBody onApplyGradient={applyGradientSwatch} />
        </div>,
        document.body,
      )}
      {!isGradient ? (
        <ColorAlphaField
          value={paintColor}
          fallback={fallback}
          showHex
          onChange={color => update(paintPatch({ color }))}
          recentKey={`${layer.id}:${F.tie}`}
          onApplyGradient={applyGradientSwatch}
        />
      ) : (
        <div className="flex flex-col gap-1.5 mt-0.5">
          {/* Gradient kind (THU-9): the same segmented switch as Solid /
              Gradient, a little taller, each segment carrying a square
              preview of the current stops rendered as that kind beside its
              label. The spine bar below previews the colors only. */}
          <div className="flex items-center gap-1.5 my-1">
          <div className="flex-1 min-w-0 flex bg-navy-900 border border-white/10 rounded-md overflow-hidden" role="radiogroup" aria-label={`${F.label} gradient kind`}>
            {([
              ['linear', 'Linear', 'Runs along a line at the angle below'],
              ['radial', 'Radial', 'Spreads from the center out to the radius'],
              ['conic', 'Conic', 'Sweeps around the center from the start angle'],
            ] as const).map(([kind, label, tip]) => {
              const on = geom.kind === kind
              return (
                <Tooltip key={kind} content={`${label}: ${tip.toLowerCase()}`} triggerClassName="flex-1 min-w-0 flex">
                  <button
                    type="button"
                    role="radio"
                    aria-checked={on}
                    onClick={() => { if (on) return; update(paintPatch({ kind })); recordGradient({ kind }) }}
                    // The swatch fills the segment's left side edge to edge
                    // as a square (24 px, the color field's height, no
                    // padding); the group's rounded corners clip the outer
                    // ones. The label centers in the rest.
                    className={`relative flex-1 min-w-0 h-6 pl-6 flex items-center justify-center text-[10px] transition-colors ${
                      on ? 'bg-accent-600/25 text-accent-200' : 'text-gray-400 hover:text-gray-200 hover:bg-white/5'
                    }`}
                  >
                    <span
                      className="absolute inset-y-0 left-0 w-6"
                      style={{
                        backgroundImage: `${cssGradientOfKind(stops, space, gStyle, { ...geom, kind })}, ${CHECKER_IMAGE}`,
                        backgroundSize: 'auto, 4px 4px',
                        backgroundRepeat: 'no-repeat, repeat',
                      }}
                      aria-hidden
                    />
                    <span className="truncate px-1">{label}</span>
                  </button>
                </Tooltip>
              )
            })}
          </div>
          {headerless && (
            <Tooltip content="Apply a gradient swatch">
              <button
                ref={gradPopBtnRef}
                type="button"
                onClick={() => { if (gradPopOpen) setGradPopOpen(false); else openGradPopover() }}
                className={`h-6 w-6 flex items-center justify-center rounded-md border border-white/10 shrink-0 transition-colors ${gradPopOpen ? 'text-gray-200 bg-white/10' : 'text-gray-400 hover:text-gray-200 hover:bg-white/10'}`}
              >
                <Palette size={12} />
              </button>
            </Tooltip>
          )}
          </div>
          {/* Vertical preview bar is the gradient's spine (top = first
              stop); each stop row carries a ◄ pointer at its spot on the
              bar. Multi-stop (THU-7): clicking the bar adds a stop at the
              clicked position, the arrows drag, rows carry a remove.
              CSS renders `in oklch` natively, so both blend modes preview
              accurately; direction is on the canvas. */}
          <div className="flex">
            <Tooltip content="Click to add a color stop at that spot. Drag the arrows beside the bar to move stops." side="top" triggerClassName="w-3 -ms-3 shrink-0 self-stretch flex">
              <div
                className="w-full border border-white/25 border-s-0 cursor-copy"
                // Layered backgrounds: gradient on top (no-repeat — subpixel
                // sampling at the bottom edge wrapped 1px of the FIRST stop
                // back in with repeat on), and a checker underneath so
                // transparent regions read as transparency.
                style={{
                  backgroundImage: `${cssGradientPreview(stops, space, 180, gStyle)}, ${CHECKER_IMAGE}`,
                  backgroundSize: 'auto, 8px 8px',
                  backgroundPosition: '0 0, -1px 0',
                  backgroundRepeat: 'no-repeat, repeat',
                }}
                onClick={e => {
                  const r = e.currentTarget.getBoundingClientRect()
                  if (r.height > 0) addStop((e.clientY - r.top) / r.height)
                }}
              />
            </Tooltip>
            {/* Arrow track: each ◄ rides the bar at its stop's EXACT
                position (top = 0, bottom = 1), and a link line runs from
                the triangle's right edge to its swatch's left edge —
                diagonal whenever the stop position and its row don't
                align. Geometry derives from the fixed row metrics (h-6
                rows = 24px, gap-1.5 = 6px); update the constants if the
                row styling changes. */}
            {(() => {
              const ROW = 24
              const GAP = 6
              const trackH = stops.length * ROW + (stops.length - 1) * GAP
              // Triangle occupies 0..6; the link line gets the remaining
              // 3px (halved from 6, tuned by eye).
              const TRACK_W = 9
              return (
                <svg
                  className="shrink-0 text-white/50"
                  width={TRACK_W}
                  height={trackH}
                  viewBox={`0 0 ${TRACK_W} ${trackH}`}
                  style={{ overflow: 'visible' }}
                >
                  {stops.map((st, origIdx) => {
                    const ay = Math.min(1, Math.max(0, st.pos)) * trackH
                    const ry = (rowOf.get(origIdx) ?? 0) * (ROW + GAP) + ROW / 2
                    const posFromEvent = (e: React.PointerEvent<SVGRectElement>): number | null => {
                      const svg = e.currentTarget.ownerSVGElement
                      if (!svg) return null
                      const r = svg.getBoundingClientRect()
                      if (r.height <= 0) return null
                      return Math.round(Math.min(1, Math.max(0, (e.clientY - r.top) / r.height)) * 100) / 100
                    }
                    return (
                      <g key={stopIds[origIdx] ?? origIdx}>
                        <line x1={6} y1={ay} x2={TRACK_W} y2={ry} stroke="currentColor" strokeWidth={1} />
                        <path d={`M0 ${ay} L6 ${ay - 5} L6 ${ay + 5} Z`} fill="currentColor" />
                        {/* Invisible widened hit area so the 6px triangle
                            drags without pixel hunting (THU-7). Pointer
                            capture keeps the drag alive off the track;
                            update() folds the whole drag into ONE undo
                            entry (same patch key = one gesture), and the
                            gradient swatch records once on release.
                            Crossing a neighbor mid-drag swaps the rows
                            live (sorted display + FLIP). */}
                        <rect
                          x={-3}
                          y={ay - 8}
                          width={TRACK_W + 3}
                          height={16}
                          fill="transparent"
                          style={{ cursor: 'ns-resize' }}
                          onPointerDown={e => {
                            e.stopPropagation()
                            lastTouchedRef.current = origIdx
                            e.currentTarget.setPointerCapture(e.pointerId)
                          }}
                          onPointerMove={e => {
                            if (!e.currentTarget.hasPointerCapture(e.pointerId)) return
                            const pos = posFromEvent(e)
                            if (pos === null || pos === st.pos) return
                            update(paintPatch({ stops: stops.map((s2, k) => (k === origIdx ? { ...s2, pos } : s2)) }))
                          }}
                          onPointerUp={e => {
                            if (!e.currentTarget.hasPointerCapture(e.pointerId)) return
                            e.currentTarget.releasePointerCapture(e.pointerId)
                            const pos = posFromEvent(e) ?? st.pos
                            recordGradient({ stops: stops.map((s2, k) => (k === origIdx ? { ...s2, pos } : s2)) })
                          }}
                        />
                      </g>
                    )
                  })}
                </svg>
              )
            })()}
            <div className="flex flex-col gap-1.5 flex-1 min-w-0 justify-between">
              {sortedOrder.map(({ st, origIdx }) => (
                <div
                  key={stopIds[origIdx] ?? origIdx}
                  // Inline ref callbacks fire null-then-element EVERY
                  // render — the tops history must survive that, or FLIP
                  // never sees a previous position (the missing-animation
                  // bug). Element map only; stale top entries are inert.
                  ref={el => {
                    const uid = stopIds[origIdx] ?? origIdx
                    if (el) rowElsRef.current.set(uid, el)
                    else rowElsRef.current.delete(uid)
                  }}
                  className="flex items-center gap-1"
                >
                <div className="flex-1 min-w-0">
                <ColorAlphaField
                  value={st.color}
                  fallback={fallback}
                  showHex
                  onChange={c => setStop(origIdx, c)}
                  // Stored `pos` is the canonical distance along the
                  // gradient line (0 = line start = bar TOP at 0°), which
                  // is what CSS/Konva expect. The FIELD shows its
                  // inverse so the number reads as height on the bar:
                  // 1 = top, 0 = bottom. That way the spinner's up arrow
                  // walks the marker up the bar instead of down. Rounded
                  // to the step's 2 decimals because the subtraction is
                  // lossy in binary floating point (1 - 0.7 renders as
                  // 0.30000000000000004 otherwise).
                  stopPos={Math.round((1 - st.pos) * 100) / 100}
                  onStopPosChange={p => setStopPos(origIdx, Math.round((1 - p) * 100) / 100)}
                  // Stop commits feed the GRADIENT recents entry (whole
                  // snapshot), not solid recents. The committed color is
                  // spliced in HERE rather than read from `stops`: for
                  // synchronous commits (opacity spinner, hex blur, Esc)
                  // this closure predates the update that triggered them,
                  // so the closed-over `stops` is one edit stale — ten
                  // spinner clicks recorded as nine (the off-by-one caught
                  // in live testing, 2026-08-04). Only the native picker's change
                  // event fires late enough to see a fresh render.
                  onCommitColor={c => recordGradient({
                    stops: stops.map((s2, k) => (k === origIdx ? { ...s2, color: c } : s2)),
                  })}
                />
                </div>
                <Tooltip content={stops.length <= 2 ? 'A gradient needs at least two stops' : 'Remove this stop (the colors stay untouched elsewhere)'}>
                  <button
                    type="button"
                    onClick={() => removeStop(origIdx)}
                    disabled={stops.length <= 2}
                    className="p-0.5 rounded shrink-0 text-gray-400 transition-colors enabled:hover:text-red-400 enabled:hover:bg-red-500/10 disabled:opacity-30 disabled:cursor-not-allowed"
                  >
                    <Trash2 size={11} />
                  </button>
                </Tooltip>
                </div>
              ))}
            </div>
          </div>
          {/* Blender-style add (THU-7 round 2): splits the gap above the
              last-touched stop, sampling the gradient's color there so
              the ramp doesn't change. Sits between the stops and the
              angle/blend row — it acts on the stops list above it. */}
          <Tooltip content="Add a stop halfway between the last edited stop and its neighbor above. Its color samples the gradient there, so the look doesn't change. Drop a color swatch here to add it as a stop instead." triggerClassName="flex">
            <button
              type="button"
              onClick={() => addStopSmart()}
              onDragEnter={e => { if (e.dataTransfer.types.includes(COLOR_DRAG_MIME)) e.preventDefault() }}
              onDragOver={e => {
                if (!e.dataTransfer.types.includes(COLOR_DRAG_MIME)) return
                e.preventDefault()
                e.dataTransfer.dropEffect = 'copy'
                setAddStopDragHover(true)
              }}
              onDragLeave={e => {
                const related = e.relatedTarget as Node | null
                if (related && e.currentTarget.contains(related)) return
                setAddStopDragHover(false)
              }}
              onDrop={e => {
                setAddStopDragHover(false)
                const color = e.dataTransfer.getData(COLOR_DRAG_MIME)
                if (!color) return
                e.preventDefault()
                addStopSmart(color)
              }}
              className={`flex-1 flex items-center justify-center gap-1 py-1 rounded-md bg-navy-900 border text-[10px] transition-colors ${
                addStopDragHover ? 'border-accent-300/60 text-gray-200 bg-white/5' : 'border-white/10 text-gray-400 hover:text-gray-200 hover:bg-white/5'
              }`}
            >
              <Plus size={11} />
              Add stop
            </button>
          </Tooltip>
          {/* Angle only ever holds 1-3 digits — fixed narrow column so the
              Style select and the Blend pair get the room they need
              (widths hand-tuned in devtools). */}
          {/* Radial and conic (THU-9): the center as percentages of the
              layer box, so it survives resizes. */}
          {geom.kind !== 'linear' && (
            <div className="grid grid-cols-2 gap-1.5">
              <label className="flex flex-col gap-0.5">
                <span className="text-[10px] text-gray-400">Center X %</span>
                <NumberInput
                  min={-100}
                  max={200}
                  value={Math.round(geom.centerX * 100)}
                  onChange={v => { const centerX = v / 100; update(paintPatch({ centerX })); recordGradient({ centerX }) }}
                  className="w-full"
                />
              </label>
              <label className="flex flex-col gap-0.5">
                <span className="text-[10px] text-gray-400">Center Y %</span>
                <NumberInput
                  min={-100}
                  max={200}
                  value={Math.round(geom.centerY * 100)}
                  onChange={v => { const centerY = v / 100; update(paintPatch({ centerY })); recordGradient({ centerY }) }}
                  className="w-full"
                />
              </label>
            </div>
          )}
          <div className="grid grid-cols-[3.1rem_minmax(0,1.3fr)_minmax(0,1.3fr)] gap-1.5">
            {geom.kind === 'radial' ? (
              <label className="flex flex-col gap-0.5">
                <span className="text-[10px] text-gray-400">Radius %</span>
                <Tooltip content="100% reaches the farthest corner of the layer box from the center." triggerClassName="flex">
                  <NumberInput
                    min={1}
                    max={400}
                    value={Math.round(geom.radius * 100)}
                    onChange={v => { const radius = v / 100; update(paintPatch({ radius })); recordGradient({ radius }) }}
                    className="w-full"
                  />
                </Tooltip>
              </label>
            ) : (
              <label className="flex flex-col gap-0.5">
                <span className="text-[10px] text-gray-400">{geom.kind === 'conic' ? 'Start °' : 'Angle °'}</span>
                <NumberInput
                  value={Math.round(angle)}
                  // No min/max: the spinners never stop. `wrap` folds the
                  // value into 0..360 when the user is done typing or on a
                  // step (style guide, "Angle fields").
                  // Angle is part of the swatch (brand gradients carry their
                  // direction), so angle edits create/update the tied entry
                  // like any other gradient edit.
                  wrap={normalizeAngle}
                  onChange={nextAngle => {
                    update(paintPatch({ angle: nextAngle }))
                    recordGradient({ angle: nextAngle })
                  }}
                  className="w-full"
                />
              </label>
            )}
            <label className="flex flex-col gap-0.5">
              <span className="text-[10px] text-gray-400">Style</span>
              <Tooltip content="Smooth blends between stops. Hard renders each stop as a solid band with edges halfway to its neighbors." triggerClassName="flex">
                <select
                  value={gStyle}
                  onChange={e => {
                    const nextStyle = e.target.value as 'smooth' | 'hard'
                    update(paintPatch({ style: nextStyle }))
                    recordGradient({ style: nextStyle })
                  }}
                  className="select-themed flex-1 min-w-0 bg-navy-900 border border-white/10 rounded-lg pl-2 pr-7 py-1 text-xs text-gray-200"
                >
                  <option value="smooth">Smooth</option>
                  <option value="hard">Hard</option>
                </select>
              </Tooltip>
            </label>
            <div className="flex flex-col gap-0.5">
              {/* div, not label — a label would forward caption clicks to
                  the first button. */}
              <span className="text-[10px] text-gray-400">Blend</span>
              <div className={`flex bg-navy-900 border border-white/10 rounded-lg overflow-hidden ${gStyle === 'hard' ? 'opacity-40' : ''}`}>
                {/* triggerClassName carries flex-1: the Tooltip wrapper is
                    the actual flex item, so flex-1 on the buttons alone
                    left the pair unevenly sized. Hard style disables the
                    pair — bands don't blend, so the space does nothing. */}
                <Tooltip content={gStyle === 'hard' ? 'No blending happens between hard bands' : 'oklch — keeps saturated blends vivid (recommended)'} triggerClassName="flex-1 min-w-0 flex">
                  <button type="button" disabled={gStyle === 'hard'} onClick={() => { update(paintPatch({ space: 'oklch' })); recordGradient({ colorSpace: 'oklch' }) }} className={`flex-1 py-1 text-xs transition-colors disabled:cursor-not-allowed ${space === 'oklch' ? 'bg-accent-600/25 text-accent-200' : 'text-gray-400 enabled:hover:text-gray-200 enabled:hover:bg-white/5'}`}>oklch</button>
                </Tooltip>
                <Tooltip content={gStyle === 'hard' ? 'No blending happens between hard bands' : 'sRGB — classic CSS blending; use when brand colors expect it'} triggerClassName="flex-1 min-w-0 flex">
                  <button type="button" disabled={gStyle === 'hard'} onClick={() => { update(paintPatch({ space: 'srgb' })); recordGradient({ colorSpace: 'srgb' }) }} className={`flex-1 py-1 text-xs transition-colors disabled:cursor-not-allowed ${space === 'srgb' ? 'bg-accent-600/25 text-accent-200' : 'text-gray-400 enabled:hover:text-gray-200 enabled:hover:bg-white/5'}`}>sRGB</button>
                </Tooltip>
              </div>
            </div>
          </div>
        </div>
      )}
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
  /** Scales a group's members by the given factors (THU-33): the Transform
   *  card's width and height for a group edit the members, not the group. */
  onScaleGroup?: (id: string, sx: number, sy: number) => void
  systemFonts: string[]
  fontVariantMap: Record<string, { name: string; css: string }[]>
  /** True once the real queryLocalFonts list loaded — gates the
   *  missing-font treatment so the seed list can't cause false alarms. */
  fontsLoaded: boolean
  /** True when queryLocalFonts failed (or is unavailable) — the Font
   *  section says so instead of silently offering the 5-font seed list. */
  fontQueryFailed: boolean
  /** Pixel snap toggle state (THU-27). Position and size fields step to
   *  the next whole pixel while it is on; typed values are never altered. */
  pixelSnapEnabled: boolean
  /** True when the active stream is explicitly standalone (not a series).
   *  Flags the season/episode/total_episodes merge chips as inapplicable —
   *  mirrors the YouTube-title chip editor on the Streams page. False in
   *  template-edit mode (no bound stream → every field is applicable). */
  standalone: boolean
}

// Konva Transformer's default border color. The hover / group-member
// bounds (thumbnails #3) derive from it: hover = solid transparent
// version of the selection lines, group member = full color, dashed.
const SELECTION_STROKE = 'rgb(0,161,255)'
const SELECTION_STROKE_SOFT = 'rgba(0,161,255,0.55)'

/**
 * Blender-style value bar (THU-33): one 24 px row that is the control. The
 * bar's fill is the value (from the left, like Blender, even on ranges that
 * straddle zero), the label sits inside the bar, and the number field joins
 * it in the same frame as the readout. Drag anywhere on the bar, arrow keys
 * step it, double-click resets to `defaultValue` when one is given. Used for
 * every field with an obvious range: opacity, rotation, sizes, widths,
 * blur, the filters. Position and offsets, which have no natural ends,
 * stay plain fields.
 */
function ValueBar({
  label, min, max, step, value, onChange, defaultValue, spinnerStep, wrap, fieldUnbounded = false,
  softMax = false, snapToStep = false, inlineNote, disabled = false,
}: {
  label: string; min: number; max: number; step: number; value: number; onChange: (v: number) => void
  /** Value a double-click on the bar resets to; also drawn as a dotted
   *  marker when it sits strictly inside the range. */
  defaultValue?: number
  /** Finer step for the +/- spinners: the bar roughs the value in at
   *  `step`, the spinners refine it (e.g. Brightness bar 0.05 → spinner
   *  0.01). Defaults to the bar step. */
  spinnerStep?: number
  /** Angle fields: the bar spans one turn and never lands on `max`; the
   *  field wraps (style guide, "Angle fields"). */
  wrap?: (n: number) => number
  /** The field takes any number (the bar still spans min..max). */
  fieldUnbounded?: boolean
  /** Blender-style soft limit: the bar spans min..max and dragging stops
   *  there, but the field accepts anything above `max` (the bar then reads
   *  full). `min` stays a hard floor. */
  softMax?: boolean
  snapToStep?: boolean
  inlineNote?: string
  disabled?: boolean
}) {
  const barRef = useRef<HTMLDivElement>(null)
  const decimals = (String(step).split('.')[1] ?? '').length
  const shown = wrap ? wrap(value) : value
  const pct = Math.max(0, Math.min(100, ((shown - min) / (max - min)) * 100))
  const clampBar = (v: number) => Math.min(wrap ? max - step : max, Math.max(min, v))
  const fieldMin = fieldUnbounded ? undefined : min
  const fieldMax = fieldUnbounded || softMax ? undefined : max
  // Pointer-down jumps to the clicked position; the drag then moves the
  // value relative to that point, on both axes: right or up raises it,
  // left or down lowers it, one bar width (or height of travel) per full
  // range. Along x this is the same as absolute positioning; the y axis is
  // extra reach for fine or long adjustments, a convenience the cursor and
  // tooltip do not advertise. Hard-ranged bars stop at their ends; a
  // wrapping bar (rotation) keeps turning past them, the way its spinner
  // does.
  const dragRef = useRef<{ startX: number; startY: number; startValue: number } | null>(null)
  const snap = (v: number) => Number((wrap ? wrap(Math.round(v / step) * step) : clampBar(Math.round(v / step) * step)).toFixed(decimals))
  const setFromPointer = (clientX: number, clientY: number, phase: 'down' | 'move') => {
    const r = barRef.current?.getBoundingClientRect()
    if (!r || r.width <= 0) return
    if (phase === 'down' || !dragRef.current) {
      const t = Math.min(1, Math.max(0, (clientX - r.left) / r.width))
      const next = snap(min + t * (max - min))
      dragRef.current = { startX: clientX, startY: clientY, startValue: next }
      if (next !== value) onChange(next)
      return
    }
    const { startX, startY, startValue } = dragRef.current
    const travel = (clientX - startX) - (clientY - startY)
    const next = snap(startValue + (travel / r.width) * (max - min))
    if (next !== value) onChange(next)
  }
  return (
    <div className={`flex items-stretch h-6 bg-navy-900 border border-white/10 rounded-lg overflow-hidden focus-within:border-accent-500/50 transition-colors ${disabled ? 'opacity-50 pointer-events-none' : ''}`}>
      <Tooltip content={defaultValue !== undefined ? `${label}: drag to set, double-click to reset` : `${label}: drag to set`} triggerClassName="flex-1 min-w-0 flex">
        <div
          ref={barRef}
          role="slider"
          tabIndex={disabled ? -1 : 0}
          aria-label={label}
          aria-valuemin={min}
          aria-valuemax={max}
          aria-valuenow={shown}
          className="relative flex-1 min-w-0 cursor-ew-resize select-none outline-none focus-visible:ring-1 focus-visible:ring-inset focus-visible:ring-accent-500/50"
          onPointerDown={e => {
            if (e.button !== 0) return
            e.currentTarget.setPointerCapture(e.pointerId)
            setFromPointer(e.clientX, e.clientY, 'down')
          }}
          onPointerMove={e => { if (e.currentTarget.hasPointerCapture(e.pointerId)) setFromPointer(e.clientX, e.clientY, 'move') }}
          onPointerUp={e => {
            if (e.currentTarget.hasPointerCapture(e.pointerId)) e.currentTarget.releasePointerCapture(e.pointerId)
            dragRef.current = null
          }}
          onDoubleClick={() => { if (defaultValue !== undefined) onChange(defaultValue) }}
          onKeyDown={e => {
            const dir = e.key === 'ArrowRight' || e.key === 'ArrowUp' ? 1 : e.key === 'ArrowLeft' || e.key === 'ArrowDown' ? -1 : 0
            if (!dir) return
            e.preventDefault()
            const amount = step * (e.shiftKey ? 10 : 1)
            // Arrow keys respect the bar's range, except that a value already
            // typed past a soft max keeps stepping from where it is.
            const stepped = value + dir * amount
            const next = wrap ? wrap(stepped)
              : softMax && value > max ? Math.max(min, stepped)
              : Math.min(max, Math.max(min, stepped))
            onChange(Number(next.toFixed(decimals)))
          }}
        >
          <div className="absolute inset-y-0 left-0 bg-accent-600/25 pointer-events-none" style={{ width: `${pct}%` }} />
          {/* Default marker: a dotted hairline where the reset value sits,
              so a bar that fills from the left still shows where neutral
              is. Left out when the default is an endpoint. */}
          {defaultValue !== undefined && defaultValue > min && defaultValue < max && (
            <div
              className="absolute inset-y-0 w-px border-l border-dotted border-white/30 pointer-events-none"
              style={{ left: `${((defaultValue - min) / (max - min)) * 100}%` }}
              aria-hidden
            />
          )}
          <span className="relative block px-2 text-[10px] leading-[22px] text-gray-300 truncate">{label}</span>
        </div>
      </Tooltip>
      <div className="flex w-14 shrink-0 border-l border-white/10">
        <NumberInput
          min={fieldMin}
          max={fieldMax}
          step={spinnerStep ?? step}
          value={value}
          onChange={onChange}
          wrap={wrap}
          snapToStep={snapToStep}
          inlineNote={inlineNote}
          disabled={disabled}
          className="w-full h-6"
          frameless
          merged
          aria-label={`${label} value`}
        />
      </div>
    </div>
  )
}

/** The bar frame for a value with no natural range (position, size,
 *  shadow offset): the same 24 px frame, corners, and focus border as a
 *  ValueBar, with a one-letter label cell where the bar would be, so a row
 *  of these and a bar below read as one family. Two fit side by side.
 *
 *  The letter cell scrubs: drag it and the value moves one step per pixel
 *  of travel, right or up raising it, left or down lowering it, with no
 *  ends, the way the bars drag. Shift makes it ten per pixel, matching the
 *  spinners. A click that does not move focuses the number field. */
function LabeledField({ label, ariaLabel, value, onChange, step = 1, snapToStep = false, disabled = false }: {
  label: string
  ariaLabel: string
  value: number
  onChange: (v: number) => void
  step?: number
  snapToStep?: boolean
  disabled?: boolean
}) {
  const frameRef = useRef<HTMLDivElement>(null)
  const scrubRef = useRef<{ startX: number; startY: number; startValue: number; moved: boolean } | null>(null)
  const decimals = Math.max((String(step).split('.')[1] ?? '').length, 2)
  const scrubTo = (clientX: number, clientY: number, shift: boolean) => {
    const s = scrubRef.current
    if (!s) return
    const travel = (clientX - s.startX) - (clientY - s.startY)
    if (travel !== 0) s.moved = true
    // Whole steps from the start value. With pixel snap on the start is
    // rounded to the step first, like the spinners; off, a fractional
    // start keeps its fraction.
    const base = snapToStep ? Math.round(s.startValue / step) * step : s.startValue
    const next = Number((base + travel * step * (shift ? 10 : 1)).toFixed(decimals))
    if (next !== value) onChange(next)
  }
  return (
    <div ref={frameRef} className={`flex items-stretch h-6 min-w-0 bg-navy-900 border border-white/10 rounded-lg overflow-hidden focus-within:border-accent-500/50 transition-colors ${disabled ? 'opacity-50 pointer-events-none' : ''}`}>
      <span
        className="w-6 shrink-0 flex items-center justify-center text-[10px] text-gray-300 border-r border-white/10 select-none cursor-ew-resize hover:bg-white/5 transition-colors"
        aria-hidden
        onPointerDown={e => {
          if (e.button !== 0) return
          e.preventDefault()
          e.currentTarget.setPointerCapture(e.pointerId)
          scrubRef.current = { startX: e.clientX, startY: e.clientY, startValue: value, moved: false }
        }}
        onPointerMove={e => { if (e.currentTarget.hasPointerCapture(e.pointerId)) scrubTo(e.clientX, e.clientY, e.shiftKey) }}
        onPointerUp={e => {
          if (e.currentTarget.hasPointerCapture(e.pointerId)) e.currentTarget.releasePointerCapture(e.pointerId)
          const moved = scrubRef.current?.moved ?? false
          scrubRef.current = null
          if (!moved) frameRef.current?.querySelector('input')?.focus()
        }}
      >
        {label}
      </span>
      <NumberInput
        value={value}
        onChange={onChange}
        step={step}
        snapToStep={snapToStep}
        disabled={disabled}
        className="w-full h-6 min-w-0"
        frameless
        merged
        aria-label={ariaLabel}
      />
    </div>
  )
}

/** A filter's bar: every filter is neutral at 0, so that is its reset. */
function FilterSlider(props: { label: string; min: number; max: number; step: number; value: number; onChange: (v: number) => void; spinnerStep?: number }) {
  return <ValueBar defaultValue={0} {...props} />
}

function FilterToggle({ label, checked, onChange }: {
  label: string; checked: boolean; onChange: (v: boolean) => void
}) {
  return (
    <label className="flex items-center gap-1.5 text-[10px] text-gray-300 cursor-pointer">
      <input
        type="checkbox" checked={checked} onChange={e => onChange(e.target.checked)}
        className="accent-accent-600"
      />
      {label}
    </label>
  )
}

// ── Properties panel cards (THU-33) ──────────────────────────────────────────
// The panel is a fixed-order stack of cards, one per concern (Transform,
// Shape or Text, Fill, Stroke, Shadows, Outline, Filters), each with the
// same header (chevron, title, one contextual control on the right) and a
// one-line summary while collapsed. Cards absent for a layer type are simply
// not rendered, so the order never changes. Collapsed state is remembered
// per card across layers; a card with nothing active starts collapsed.

/** Measured boxes for layers whose size the layer record does not hold:
 *  text height (font-driven) and group extents (from the members). The
 *  canvas nodes publish them after each render; the Transform card reads
 *  them through a tiny external store so it re-renders when they land. */
const measuredBoxes = new Map<string, { w: number; h: number }>()
const measuredListeners = new Set<() => void>()
let measuredVersion = 0
function publishMeasuredBox(id: string, w: number, h: number): void {
  const prev = measuredBoxes.get(id)
  if (prev && Math.abs(prev.w - w) < 0.01 && Math.abs(prev.h - h) < 0.01) return
  measuredBoxes.set(id, { w, h })
  measuredVersion++
  measuredListeners.forEach(fn => fn())
}
function subscribeMeasured(fn: () => void): () => void {
  measuredListeners.add(fn)
  return () => { measuredListeners.delete(fn) }
}
const getMeasuredVersion = () => measuredVersion

const CARD_PREFS_KEY = 'thumbPropsCards'
type CardPrefs = Record<string, 'open' | 'closed'>

/** One glyph per card, keyed by card id, so the stack can be told apart at
 *  a glance while scrolling: the same icon in the same place on every layer
 *  type, whatever the header's title and summary say. */
const CARD_ICONS: Record<string, LucideIcon> = {
  transform: Move,
  shape: Shapes,
  text: Type,
  fill: PaintBucket,
  stroke: PenLine,
  shadows: SquareStack,
  outline: SquareDashed,
  filters: SlidersHorizontal,
}

function PanelCard({ id, title, control, summary, mutedReason, headerTooltip, open, onToggle, children }: {
  id: string
  title: string
  /** The one control that belongs in the header: Reset, Enable, Add, or
   *  the Solid/Gradient switch. Clicks on it never toggle the card. */
  control?: React.ReactNode
  /** Shown after the title while collapsed, so collapsed is not hidden. */
  summary?: string
  /** The body is disabled and this says why (a shape serving as a mask). */
  mutedReason?: string
  headerTooltip?: string
  open: boolean
  onToggle: () => void
  children: React.ReactNode
}) {
  const Icon = CARD_ICONS[id]
  const titleNode = (
    <span className="flex items-center gap-1.5 text-[10px] uppercase tracking-wider text-gray-400 shrink-0">
      {Icon && <Icon size={11} className="shrink-0" aria-hidden />}
      {title}
    </span>
  )
  // A filled slab: the border-only variant was tried during the THU-33
  // review and the fill kept.
  return (
    <section data-card={id} className={`rounded-lg border border-white/10 bg-navy-900/40 ${mutedReason ? 'opacity-60' : ''}`}>
      <div className="flex items-center gap-1 pl-1.5 pr-2 h-7">
        <button
          type="button"
          onClick={onToggle}
          aria-expanded={open}
          className="flex items-center gap-1 min-w-0 flex-1 h-full text-left text-gray-400 hover:text-gray-200 transition-colors"
        >
          {open ? <ChevronDown size={11} className="shrink-0" /> : <ChevronRight size={11} className="shrink-0" />}
          {headerTooltip ? <Tooltip content={headerTooltip} side="left" triggerClassName="flex shrink-0">{titleNode}</Tooltip> : titleNode}
          {mutedReason ? (
            <span className="text-[10px] text-amber-300 truncate">· {mutedReason}</span>
          ) : (!open && summary) ? (
            <span className="text-[10px] text-gray-400 truncate">· {summary}</span>
          ) : null}
        </button>
        {control && (
          <div className={`shrink-0 flex items-center ${mutedReason ? 'pointer-events-none' : ''}`}>
            {control}
          </div>
        )}
      </div>
      {open && (mutedReason ? (
        <Tooltip content={`${mutedReason}. Release the mask (selection tab) to use these again.`} side="left" triggerClassName="block min-w-0 max-w-full">
          {/* min-w-0: a fieldset's browser default is min-inline-size:
              min-content, which stops it shrinking below its widest row. */}
          <fieldset disabled className="flex flex-col gap-1.5 min-w-0 w-full px-2 pb-2 [&_*]:pointer-events-none" aria-disabled>
            {children}
          </fieldset>
        </Tooltip>
      ) : (
        <div className="flex flex-col gap-1.5 px-2 pb-2">
          {children}
        </div>
      ))}
    </section>
  )
}

/** The Solid / Gradient switch for a paint, lifted out of the paint control
 *  so it can sit in its card's header and stay visible while the card is
 *  collapsed. Same behavior as before: leaving gradient mode ends that
 *  recents session; entering it seeds the stops from the flat color. */
function PaintModeToggle({ layer, update, paint, fallback }: {
  layer: ThumbnailLayer
  update: (patch: Partial<ThumbnailLayer>) => void
  paint: PaintTarget
  fallback: string
}) {
  const { F, isGradient, stops, space, angle, patch } = paintState(layer, paint, fallback)
  const { breakRecentTie } = useContext(PaletteContext)
  const segCls = (on: boolean) =>
    `px-1.5 py-0.5 text-[10px] transition-colors ${on ? 'bg-accent-600/25 text-accent-200' : 'text-gray-400 hover:text-gray-200 hover:bg-white/5'}`
  return (
    <div className="flex bg-navy-900 border border-white/10 rounded-md overflow-hidden">
      <Tooltip content={`Flat color ${F.label.toLowerCase()}`}>
        <button
          type="button"
          onClick={() => {
            update(patch({ type: 'solid' }))
            breakRecentTie(`${layer.id}:${F.tie}-gradient`)
          }}
          className={segCls(!isGradient)}
        >
          Solid
        </button>
      </Tooltip>
      <Tooltip content={`Gradient ${F.label.toLowerCase()} (linear, radial, or conic)`}>
        <button
          type="button"
          onClick={() => update(patch({ type: 'linear', stops, angle, space }))}
          className={segCls(isGradient)}
        >
          Gradient
        </button>
      </Tooltip>
    </div>
  )
}

/** One line for a collapsed Fill or Stroke card. */
function paintSummary(layer: ThumbnailLayer, paint: PaintTarget, fallback: string): string {
  const { isGradient, paintColor, stops, geom } = paintState(layer, paint, fallback)
  if (!isGradient) return splitColorAlpha(paintColor, fallback).rgb
  const kind = geom.kind.charAt(0).toUpperCase() + geom.kind.slice(1)
  return `${kind} gradient, ${stops.length} stops`
}

interface CardState { open: boolean; onToggle: () => void }

function ShadowsCard({ layer, update, muted, state }: {
  layer: ThumbnailLayer
  update: (patch: Partial<ThumbnailLayer>) => void
  muted?: string
  state: CardState
}) {
  const shadows = resolveShadows(layer)
  // Migrate-on-write: any change here drops the legacy single-shadow
  // fields so there are not two sources of truth on disk.
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
      // A new shadow inherits the last entry's params when one exists:
      // easier to stack subtle variations than to restart from defaults.
      shadows.length > 0
        ? { ...shadows[shadows.length - 1] }
        : { color: '#000000', offsetX: 4, offsetY: 4, blur: 8, opacity: 100 },
    ])
  const summary = shadows.length === 0 ? 'None' : shadows.length === 1 ? '1 shadow' : `${shadows.length} shadows`
  return (
    <PanelCard
      id="shadows"
      title="Shadows"
      summary={summary}
      mutedReason={muted}
      control={(
        <Tooltip content="Add a shadow (each one stacks behind the layer)">
          <button
            type="button"
            onClick={addShadow}
            className="flex items-center gap-1 text-[10px] text-gray-400 hover:text-gray-200 transition-colors"
          >
            <Plus size={11} />
            Add
          </button>
        </Tooltip>
      )}
      {...state}
    >
      {shadows.length === 0 && (
        <p className="text-[10px] text-gray-400">None</p>
      )}
      {shadows.map((s, idx) => (
        // Entries are separated, not boxed: a labeled hairline row carries
        // the number and the delete, and the fields sit flush with the rest
        // of the card. A box here made a card inside a card inside the panel.
        <div key={idx} className={`flex flex-col gap-1.5 ${idx > 0 ? 'pt-1' : ''}`}>
          <div className="flex items-center gap-2">
            <span className="text-[10px] uppercase tracking-wider text-gray-400 shrink-0">Shadow {idx + 1}</span>
            <div className="flex-1 border-t border-white/10" />
            <Tooltip content="Remove this shadow">
            <button
              type="button"
              onClick={() => removeAt(idx)}
              className="p-1 -my-1 -mr-1 rounded text-gray-400 hover:text-red-400 hover:bg-red-900/20 transition-colors"
            >
              <Trash2 size={11} />
            </button>
            </Tooltip>
          </div>
          <label className="flex flex-col gap-0.5">
            <span className="text-[10px] text-gray-400">Color</span>
            {/* Unified color field like every other color property. The
                field's % segment IS the shadow opacity (stored s.opacity,
                drives Konva shadowOpacity); the color itself stays rgb in
                the meta. An applied swatch's alpha lands in the shadow
                opacity, full-snapshot style. */}
            <ColorAlphaField
              // splitColorAlpha first: the old raw text input let any
              // string into s.color, so normalize to rgb before joining
              // with the stored opacity.
              value={joinColorAlpha(splitColorAlpha(s.color, '#000000').rgb, (s.opacity ?? 100) / 100)}
              fallback="#000000"
              showHex
              onChange={v => {
                const p = splitColorAlpha(v, '#000000')
                updateAt(idx, { color: p.rgb, opacity: Math.round(p.alpha * 100) })
              }}
              recentKey={`${layer.id}:shadow${idx}`}
            />
          </label>
          {/* Offsets: under a shadow's own divider, X and Y can only mean
              its offset, so the letters carry the row. */}
          <div className="grid grid-cols-2 gap-1.5">
            <LabeledField label="X" ariaLabel="Shadow offset X" value={s.offsetX} onChange={offsetX => updateAt(idx, { offsetX })} />
            <LabeledField label="Y" ariaLabel="Shadow offset Y" value={s.offsetY} onChange={offsetY => updateAt(idx, { offsetY })} />
          </div>
          <ValueBar label="Blur" min={0} max={100} step={1} value={s.blur} onChange={blur => updateAt(idx, { blur })} softMax defaultValue={0} />
        </div>
      ))}
    </PanelCard>
  )
}

/** Outline: an alpha-dilation stroke. Text and shapes route to Konva's
 *  native stroke (overriding the design stroke while enabled), images and
 *  groups run the dilation filter over a raster. Stacked with shadows, the
 *  shadows attach to the dilated silhouette. */
function OutlineCard({ layer, update, muted, state }: {
  layer: ThumbnailLayer
  update: (patch: Partial<ThumbnailLayer>) => void
  muted?: string
  state: CardState
}) {
  const on = !!layer.outlineEnabled
  const width = layer.outlineWidth ?? 0
  return (
    <PanelCard
      id="outline"
      title="Outline"
      summary={on ? `${width} px` : 'Off'}
      mutedReason={muted}
      control={(
        <label className="flex items-center gap-1 text-[10px] text-gray-400 cursor-pointer">
          <input
            type="checkbox"
            checked={on}
            onChange={e => update({ outlineEnabled: e.target.checked })}
            className="accent-accent-600"
          />
          Enable
        </label>
      )}
      {...state}
    >
      {on ? (
        <>
          <label className="flex flex-col gap-0.5">
            <span className="text-[10px] text-gray-400">Color</span>
            <ColorAlphaField
              value={layer.outlineColor}
              fallback="#000000"
              showHex
              onChange={outlineColor => update({ outlineColor })}
              recentKey={`${layer.id}:outline`}
            />
          </label>
          <ValueBar label="Width" min={0} max={50} step={1} value={width} onChange={outlineWidth => update({ outlineWidth })} defaultValue={0} softMax />
          {layer.type !== 'image' && layer.type !== 'group' && (layer.strokeWidth ?? 0) > 0 && (
            <p className="text-[10px] text-amber-300 leading-snug">
              Replaces the {layer.strokeWidth} px stroke while enabled.
            </p>
          )}
        </>
      ) : (
        <p className="text-[10px] text-gray-400">Off</p>
      )}
    </PanelCard>
  )
}

/** Filters, shared by images and groups (THU-31). All filter values persist
 *  regardless of the master toggle, so the user can A/B compare without
 *  re-dialing settings. */
function FiltersCard({ layer, update, state }: {
  layer: ThumbnailLayer
  update: (patch: Partial<ThumbnailLayer>) => void
  state: CardState
}) {
  const on = !!layer.filtersEnabled
  const active: string[] = []
  if (on) {
    if ((layer.filterBrightness ?? 0) !== 0) active.push('Brightness')
    if ((layer.filterContrast ?? 0) !== 0) active.push('Contrast')
    if ((layer.filterSaturation ?? 0) !== 0) active.push('Saturation')
    if ((layer.filterHue ?? 0) !== 0) active.push('Hue')
    if ((layer.filterLuminance ?? 0) !== 0) active.push('Luminance')
    if ((layer.filterBlur ?? 0) > 0) active.push(`Blur ${layer.filterBlur}`)
    if ((layer.filterEnhance ?? 0) !== 0) active.push('Enhance')
    if ((layer.filterPixelate ?? 0) > 1) active.push('Pixelate')
    if ((layer.filterPosterize ?? 0) > 0 && (layer.filterPosterize ?? 0) < 1) active.push('Posterize')
    if ((layer.filterThreshold ?? 0) > 0) active.push('Threshold')
    if (layer.filterGrayscale) active.push('Grayscale')
    if (layer.filterSepia) active.push('Sepia')
    if (layer.filterInvert) active.push('Invert')
    if (layer.filterEmboss) active.push('Emboss')
  }
  const summary = !on ? 'Off' : active.length === 0 ? 'On, all neutral' : active.join(', ')
  return (
    <PanelCard
      id="filters"
      title="Filters"
      summary={summary}
      control={(
        <label className="flex items-center gap-1 text-[10px] text-gray-400 cursor-pointer">
          <input
            type="checkbox"
            checked={on}
            onChange={e => update({ filtersEnabled: e.target.checked })}
            className="accent-accent-600"
          />
          Enable
        </label>
      )}
      {...state}
    >
      {on ? (
        <div className="flex flex-col gap-1.5">
          <FilterSlider label="Brightness" min={-1} max={1} step={0.05} spinnerStep={0.01} value={layer.filterBrightness ?? 0}
            onChange={v => update({ filterBrightness: v })} />
          <FilterSlider label="Contrast" min={-100} max={100} step={1} value={layer.filterContrast ?? 0}
            onChange={v => update({ filterContrast: v })} />
          <FilterSlider label="Saturation" min={-2} max={10} step={0.1} spinnerStep={0.01} value={layer.filterSaturation ?? 0}
            onChange={v => update({ filterSaturation: v })} />
          <FilterSlider label="Hue" min={-180} max={180} step={1} value={layer.filterHue ?? 0}
            onChange={v => update({ filterHue: v })} />
          <FilterSlider label="Luminance" min={-2} max={2} step={0.05} spinnerStep={0.01} value={layer.filterLuminance ?? 0}
            onChange={v => update({ filterLuminance: v })} />
          <FilterSlider label="Blur" min={0} max={40} step={1} value={layer.filterBlur ?? 0}
            onChange={v => update({ filterBlur: v })} />
          <FilterSlider label="Enhance" min={-1} max={1} step={0.05} spinnerStep={0.01} value={layer.filterEnhance ?? 0}
            onChange={v => update({ filterEnhance: v })} />
          <FilterSlider label="Pixelate" min={0} max={50} step={1} value={layer.filterPixelate ?? 0}
            onChange={v => update({ filterPixelate: v })} />
          <FilterSlider label="Posterize" min={0} max={1} step={0.05} spinnerStep={0.01} value={layer.filterPosterize ?? 0}
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
      ) : (
        <p className="text-[10px] text-gray-400">Off</p>
      )}
    </PanelCard>
  )
}

function PropertiesPanel({ layer, onChange, onLiveChange, onScaleGroup, systemFonts, fontVariantMap, fontsLoaded, fontQueryFailed, standalone, pixelSnapEnabled }: PropsPanelProps) {
  // Last-used font family (THU-6): persisted app-wide via IPC so it
  // survives sessions. Rendered as a quick-pick link under the font
  // dropdown whenever it differs from the selected layer's family.
  const [lastUsedFont, setLastUsedFont] = useState('')
  useEffect(() => { window.api.thumbnailGetLastFont().then(setLastUsedFont).catch(() => {}) }, [])
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
  // Live canvas gesture (THU-26): while this layer is being dragged,
  // resized, or rotated, the transform inputs show the node's live numbers
  // instead of the committed layer. Display only; the layer state is never
  // written mid-gesture.
  const liveAll = useLiveTransform()
  // Measured text and group boxes (see publishMeasuredBox).
  useSyncExternalStore(subscribeMeasured, getMeasuredVersion, getMeasuredVersion)

  // Card collapse state (THU-33), remembered per card across layers. A card
  // with nothing active (no shadows, outline off) starts collapsed until the
  // user opens it once.
  const [cardPrefs, setCardPrefs] = useState<CardPrefs>(() => {
    try { return JSON.parse(localStorage.getItem(CARD_PREFS_KEY) ?? '{}') as CardPrefs } catch { return {} }
  })
  const cardOpen = (id: string, emptyByDefault = false) => (cardPrefs[id] ?? (emptyByDefault ? 'closed' : 'open')) === 'open'
  const cardState = (id: string, emptyByDefault = false): CardState => ({
    open: cardOpen(id, emptyByDefault),
    onToggle: () => {
      const next: CardPrefs = { ...cardPrefs, [id]: cardOpen(id, emptyByDefault) ? 'closed' : 'open' }
      setCardPrefs(next)
      try { localStorage.setItem(CARD_PREFS_KEY, JSON.stringify(next)) } catch { /* per-viewer convenience only */ }
    },
  })

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

  const isMaskLayer = isMask(layer)
  const isGroupLayer = layer.type === 'group'
  const isTextLayer = layer.type === 'text'
  const lv = liveAll && liveAll.id === layer.id ? liveAll : null
  const dispX = lv ? lv.x : layer.x
  const dispY = lv ? lv.y : layer.y
  // Angle fields (style guide): the live value is the raw accumulated
  // rotation; the stored value is shown as stored (it is wrapped on
  // commit and on load, and mid-typing values must not fold).
  const dispRot = lv ? lv.rotation : layer.rotation

  // Size model (THU-33): every type shows width and height. Images and
  // shapes store both; text stores an optional width (auto until set) and
  // its height is font-driven; groups hold neither, their box is measured
  // from the members and editing it scales them.
  const measured = measuredBoxes.get(layer.id)
  const sizeW = isGroupLayer ? measured?.w : isTextLayer ? (layer.width ?? measured?.w) : layer.width
  const sizeH = isGroupLayer ? measured?.h : isTextLayer ? measured?.h : layer.height
  const dispW = lv?.width ?? sizeW
  const dispH = lv?.height ?? sizeH

  // Aspect-ratio lock is per-layer + persisted on the layer itself.
  // Undefined defaults to `true` — newly added layers start locked,
  // matching every other vector editor's convention.
  const aspectLocked = layer.aspectLocked ?? true
  const toggleAspectLock = () => update({ aspectLocked: !aspectLocked })
  // The locked ratio is always derived from the current box (not a stored
  // "original"), so unlock, resize, re-lock pins whatever ratio is current.
  const lockedRatio = (() => {
    const w = sizeW ?? 0
    const h = sizeH ?? 0
    return h > 0 ? w / h : 1
  })()

  // Width/height inputs accept signed values on images and shapes: a
  // negative number sets the corresponding flip flag and stores the
  // magnitude. Zero leaves the flip state alone so typing "-" → "0" →
  // digits doesn't bounce flip state mid-keystroke.
  const handleWidthChange = (w: number) => {
    const abs = Math.abs(w)
    if (isGroupLayer) {
      const cur = sizeW ?? 0
      if (cur <= 0 || abs <= 0 || !onScaleGroup) return
      const f = abs / cur
      onScaleGroup(layer.id, f, aspectLocked ? f : 1)
      return
    }
    if (isTextLayer) { if (abs > 0) update({ width: Math.round(abs) }); return }
    const flipX = w < 0 ? true : (w > 0 ? false : !!layer.flipX)
    if (aspectLocked && lockedRatio > 0) {
      // The derived dimension keeps the exact ratio (THU-27); it is
      // rounded only for shapes, which always take whole pixels.
      const h = abs / lockedRatio
      update({ width: abs, height: Math.max(1, layer.type === 'image' ? h : Math.round(h)), flipX })
    } else {
      update({ width: abs, flipX })
    }
  }
  const handleHeightChange = (h: number) => {
    const abs = Math.abs(h)
    if (isGroupLayer) {
      const cur = sizeH ?? 0
      if (cur <= 0 || abs <= 0 || !onScaleGroup) return
      const f = abs / cur
      onScaleGroup(layer.id, aspectLocked ? f : 1, f)
      return
    }
    if (isTextLayer) return
    const flipY = h < 0 ? true : (h > 0 ? false : !!layer.flipY)
    if (aspectLocked && lockedRatio > 0) {
      const w = abs * lockedRatio
      update({ height: abs, width: Math.max(1, layer.type === 'image' ? w : Math.round(w)), flipY })
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
    const w = sizeW ?? 0
    const h = sizeH ?? 0
    update({
      x: Math.round((CANVAS_W - w) / 2),
      y: Math.round((CANVAS_H - h) / 2),
      rotation: 0,
    })
  }

  // Context line: which layer these properties belong to. The panel sits
  // far from the Layers row, so the name and type repeat here.
  const typeIcon = isMaskLayer ? <Blend size={11} className="text-amber-300/80" />
    : layer.type === 'image' ? <ImageIcon size={11} />
    : layer.type === 'text' ? <Type size={11} />
    : layer.type === 'group' ? <Folder size={11} />
    : layer.shapeType === 'ellipse' ? <Circle size={11} />
    : layer.shapeType === 'polygon' ? <Pentagon size={11} />
    : <Square size={11} />
  const typeLabel = isMaskLayer ? 'Mask'
    : layer.type === 'shape' ? (layer.shapeType === 'ellipse' ? 'Ellipse' : layer.shapeType === 'polygon' ? 'Polygon' : 'Rectangle')
    : layer.type.charAt(0).toUpperCase() + layer.type.slice(1)

  const labelCls = 'text-[10px] text-gray-400'
  const mutedReason = isMaskLayer ? 'Off while this shape is a mask' : undefined
  const paintable = layer.type === 'shape' || layer.type === 'text'
  const fillFallback = layer.type === 'text' ? '#ffffff' : '#6366f1'
  const hasSides = layer.type === 'shape' && layer.shapeType === 'polygon'
  const hasRadius = layer.type === 'shape' && (layer.shapeType === 'rect' || layer.shapeType === 'polygon')
  const shadowsCount = resolveShadows(layer).length

  return (
    <div className="p-2 flex flex-col gap-2 overflow-y-auto flex-1 min-h-0">
      <div className="flex items-center gap-1.5 px-1 min-w-0 text-gray-400">
        <span className="shrink-0">{typeIcon}</span>
        <span className="text-[11px] text-gray-200 truncate">{layer.name}</span>
        <span className="text-[10px] shrink-0">· {typeLabel}</span>
      </div>

      {/* Transform: the same four rows for every layer type. */}
      <PanelCard
        id="transform"
        title="Transform"
        summary={`${Math.round(layer.x)}, ${Math.round(layer.y)}${sizeW && sizeH ? ` · ${Math.round(sizeW)}×${Math.round(sizeH)}` : ''}${layer.rotation ? ` · ${round2(normalizeAngle(layer.rotation))}°` : ''}`}
        headerTooltip={isGroupLayer ? 'Double-click a grouped layer on the canvas to select it.' : undefined}
        control={(
          <Tooltip content="Reset position and rotation (and, for images, the fitted size)">
            <button
              type="button"
              onClick={() => { resetTransform().catch(() => {}) }}
              className="flex items-center gap-1 text-[10px] text-gray-400 hover:text-gray-200 transition-colors"
            >
              <RotateCcw size={10} />
              Reset
            </button>
          </Tooltip>
        )}
        {...cardState('transform')}
      >
        {/* Position down the left, size down the right, and the aspect lock
            in a narrow third column spanning both size rows so it brackets
            W and H instead of sitting between them. */}
        <div className="grid grid-cols-[1fr_1fr_auto] gap-1.5 items-stretch">
          <LabeledField label="X" ariaLabel="X position" value={round2(dispX)} onChange={x => update({ x })} snapToStep={pixelSnapEnabled} />
          <LabeledField
            label="W"
            ariaLabel="Width"
            value={layer.flipX && !isGroupLayer && !isTextLayer ? -round2(dispW ?? 0) : round2(dispW ?? 0)}
            onChange={handleWidthChange}
            snapToStep={pixelSnapEnabled}
          />
          {isTextLayer ? (
            <Tooltip content="Text height follows the font; width sets the wrapping box." side="top" triggerClassName="flex row-span-2">
              <span className="h-full w-4 flex items-center justify-center text-gray-400"><Unlink2 size={13} className="rotate-90" /></span>
            </Tooltip>
          ) : (
            <Tooltip
              content={aspectLocked
                ? 'Aspect ratio locked: changing width or height keeps the other in proportion. Click to unlock.'
                : 'Lock the aspect ratio so width and height change together.'}
              side="top"
              triggerClassName="flex row-span-2"
            >
              <button
                type="button"
                onClick={toggleAspectLock}
                className={`h-full w-4 flex items-center justify-center rounded transition-colors hover:bg-white/5 ${
                  aspectLocked ? 'text-accent-300 hover:text-accent-200' : 'text-gray-400 hover:text-gray-200'
                }`}
                aria-label={aspectLocked ? 'Unlock aspect ratio' : 'Lock aspect ratio'}
              >
                {/* Rotated so the chain runs top to bottom, W to H. */}
                <span className="rotate-90 flex">{aspectLocked ? <Link2 size={13} /> : <Unlink2 size={13} />}</span>
              </button>
            </Tooltip>
          )}
          <LabeledField label="Y" ariaLabel="Y position" value={round2(dispY)} onChange={y => update({ y })} snapToStep={pixelSnapEnabled} />
          <LabeledField
            label="H"
            ariaLabel="Height"
            value={layer.flipY && !isGroupLayer && !isTextLayer ? -round2(dispH ?? 0) : round2(dispH ?? 0)}
            onChange={handleHeightChange}
            snapToStep={pixelSnapEnabled}
            disabled={isTextLayer}
          />
        </div>
        {/* Bars (THU-33), one per row so the labels have room: rotation
            spans one turn (the field still wraps and never stops), opacity
            0..100. */}
        <ValueBar label="Rotation °" min={0} max={360} step={1} value={round2(dispRot)} onChange={rotation => update({ rotation })} wrap={normalizeAngle} fieldUnbounded snapToStep defaultValue={0} />
        {isMaskLayer ? (
          <Tooltip content="Opacity has no effect on a group mask; only its outline is used." side="left" triggerClassName="block min-w-0">
            <ValueBar label="Opacity %" min={0} max={100} step={1} value={Math.round(layer.opacity)} onChange={() => {}} disabled />
          </Tooltip>
        ) : (
          <ValueBar label="Opacity %" min={0} max={100} step={1} value={Math.round(layer.opacity)} onChange={opacity => update({ opacity: Math.max(0, Math.min(100, opacity)) })} defaultValue={100} />
        )}
      </PanelCard>

      {/* Shape geometry: sides and corner radius, out of Transform. */}
      {(hasSides || hasRadius) && (
        <PanelCard
          id="shape"
          title="Shape"
          summary={[hasSides ? `${polygonSidesOf(layer)} sides` : '', hasRadius ? `radius ${layer.cornerRadius ?? 0}` : ''].filter(Boolean).join(' · ')}
          {...cardState('shape')}
        >
          {/* One bar per row: the bar's value field is a fixed five
              characters wide, so two bars side by side leave no room for
              their labels. */}
          <div className="flex flex-col gap-1.5">
            {hasSides && (
              // Keeps the shape as regular as it was: the box height follows
              // the new side count's natural ratio, carrying over whatever
              // stretch the user had applied, and the visual center stays
              // put (lib/polygon.ts).
              <ValueBar
                label="Sides"
                min={POLYGON_MIN_SIDES}
                max={POLYGON_MAX_SIDES}
                step={1}
                value={polygonSidesOf(layer)}
                onChange={sides => update(polygonSidesPatch(layer, sides))}
              />
            )}
            {hasRadius && (() => {
              // Corner radius is stored in pixels, independent of width and
              // height, so corners stay circular through resizes. The bar
              // spans what the geometry can render (rect: half the short
              // side; polygon: its inradius); a typed value past that keeps
              // the rendered radius beside it.
              const sw = layer.width ?? 200
              const sh = layer.height ?? 200
              const maxR = layer.shapeType === 'polygon'
                ? polygonMaxCornerRadius(polygonPoints(polygonSidesOf(layer), sw, sh))
                : Math.min(sw, sh) / 2
              const entered = layer.cornerRadius ?? 0
              return (
                <ValueBar
                  label="Corner radius"
                  min={0}
                  max={Math.max(1, Math.ceil(maxR))}
                  step={1}
                  value={entered}
                  onChange={cornerRadius => update({ cornerRadius })}
                  softMax
                  defaultValue={0}
                  inlineNote={entered > maxR ? (maxR % 1 === 0 ? String(maxR) : maxR.toFixed(1)) : undefined}
                />
              )
            })()}
          </div>
        </PanelCard>
      )}

      {/* Text: content, then the font controls, one card. */}
      {isTextLayer && (
        <PanelCard
          id="text"
          title="Text"
          summary={`${layer.fontFamily ?? 'Arial'} ${layer.fontSize ?? 48}`}
          {...cardState('text')}
        >
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
          {(() => {
            const fam = layer.fontFamily ?? 'Arial'
            const famMissing = fontsLoaded && !systemFonts.includes(fam)
            const applyFontFamily = (next: string) => {
              const variants = fontVariantMap[next]
              if (variants && variants.length > 0) {
                // Try to preserve current weight; fall back to first variant
                const cur = layer.fontStyle ?? 'normal'
                const match = variants.find(v => v.css === cur) ?? variants.find(v => v.css === 'normal') ?? variants[0]
                update({ fontFamily: next, fontStyle: match.css })
              } else {
                update({ fontFamily: next })
              }
              // Any pick becomes the new last-used; the quick-pick link
              // hides by itself since last-used now equals the layer's
              // family (THU-6).
              window.api.thumbnailSetLastFont(next).catch(() => {})
              setLastUsedFont(next)
            }
            return (
              <>
                <label className="flex flex-col gap-0.5 mt-1">
                  <span className={labelCls}>Font</span>
                  <select
                    value={fam}
                    onChange={e => applyFontFamily(e.target.value)}
                    className={`select-themed bg-navy-900 border rounded-lg pl-2 pr-7 py-1 text-xs w-full ${famMissing ? 'border-amber-500/60 text-amber-300' : 'border-white/10 text-gray-200'}`}
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
                </label>
                {famMissing && (
                  <p className="text-[10px] text-amber-400 flex items-center gap-1">
                    <AlertTriangle size={10} className="shrink-0" />
                    Not installed. Pick a replacement to resume image updates.
                  </p>
                )}
                {fontQueryFailed && !fontsLoaded && (
                  <p className="text-[10px] text-amber-400 flex items-center gap-1">
                    <AlertTriangle size={10} className="shrink-0" />
                    Could not read installed fonts; showing a minimal list.
                  </p>
                )}
                {/* Quick-pick for the last-used family (THU-6). Hidden when
                    it IS the current family, and never offers a font that
                    isn't installed. */}
                {lastUsedFont && lastUsedFont !== fam && systemFonts.includes(lastUsedFont) && (
                  <Tooltip content={`Switch to ${lastUsedFont}`} triggerClassName="self-start">
                    <button
                      onClick={() => applyFontFamily(lastUsedFont)}
                      className="text-[10px] text-gray-400 hover:text-accent-300 transition-colors"
                    >
                      Last used: <span className="text-gray-300" style={{ fontFamily: lastUsedFont }}>{lastUsedFont}</span>
                    </button>
                  </Tooltip>
                )}
              </>
            )
          })()}
          <div className="grid grid-cols-2 gap-1.5">
            <label className="flex flex-col gap-0.5">
              <span className={labelCls}>Style</span>
              {(() => {
                const variants = fontVariantMap[layer.fontFamily ?? 'Arial'] ?? []
                if (variants.length > 0) {
                  const cur = layer.fontStyle ?? 'normal'
                  const matched = variants.find(v => v.css === cur) ?? variants[0]
                  return (
                    <select
                      value={matched.css}
                      onChange={e => update({ fontStyle: e.target.value })}
                      className="select-themed bg-navy-900 border border-white/10 rounded-lg pl-2 pr-7 py-1 text-xs text-gray-200"
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
                    className="select-themed bg-navy-900 border border-white/10 rounded-lg pl-2 pr-7 py-1 text-xs text-gray-200"
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
              <span className={labelCls}>Align</span>
              <select
                value={layer.align ?? 'left'}
                onChange={e => update({ align: e.target.value as 'left' | 'center' | 'right' })}
                className="select-themed bg-navy-900 border border-white/10 rounded-lg pl-2 pr-7 py-1 text-xs text-gray-200"
              >
                <option value="left">Left</option>
                <option value="center">Center</option>
                <option value="right">Right</option>
              </select>
            </label>
          </div>
          {/* Size and line height as bars (THU-33), one per row. Line
              height is stored as a multiplier (Konva-native); the UI speaks
              percent to match the other % fields. */}
          <ValueBar label="Size" min={8} max={500} step={1} value={layer.fontSize ?? 48} onChange={fontSize => update({ fontSize })} softMax />
          <ValueBar label="Line height %" min={50} max={300} step={1} value={Math.round((layer.lineHeight ?? 1) * 100)} onChange={p => update({ lineHeight: p / 100 })} defaultValue={100} softMax />
          {/* Letter case (thumbnails #7): radio-style group sized to the
              panel's input rows. div, not label: a label would forward
              clicks on the caption to the first button. */}
          <div className="flex flex-col gap-0.5">
            <span className={labelCls}>Case</span>
            <div className="flex bg-navy-900 border border-white/10 rounded-lg overflow-hidden">
              {TEXT_TRANSFORM_OPTIONS.map(opt => {
                const selected = (layer.textTransform ?? 'none') === opt.value
                return (
                  <Tooltip key={opt.value} content={opt.tip} triggerClassName="flex-1 flex min-w-0">
                    <button
                      type="button"
                      onClick={() => update({ textTransform: opt.value })}
                      className={`flex-1 py-1 text-xs transition-colors ${
                        selected ? 'bg-accent-600/25 text-accent-200' : 'text-gray-400 hover:text-gray-200 hover:bg-white/5'
                      }`}
                    >
                      {opt.label}
                    </button>
                  </Tooltip>
                )
              })}
            </div>
          </div>
        </PanelCard>
      )}

      {/* Fill and Stroke, one card each, the mode switch in the header. */}
      {paintable && (
        <PanelCard
          id="fill"
          title="Fill"
          summary={paintSummary(layer, 'fill', fillFallback)}
          mutedReason={mutedReason}
          control={<PaintModeToggle layer={layer} update={update} paint="fill" fallback={fillFallback} />}
          {...cardState('fill')}
        >
          <GradientFillControl layer={layer} update={update} fallback={fillFallback} headerless />
        </PanelCard>
      )}
      {paintable && (
        <PanelCard
          id="stroke"
          title="Stroke"
          summary={`${paintSummary(layer, 'stroke', '#000000')}, ${layer.strokeWidth ?? 0} px`}
          mutedReason={mutedReason}
          control={<PaintModeToggle layer={layer} update={update} paint="stroke" fallback="#000000" />}
          {...cardState('stroke')}
        >
          <GradientFillControl layer={layer} update={update} fallback="#000000" paint="stroke" headerless />
          <ValueBar label="Width" min={0} max={100} step={1} value={layer.strokeWidth ?? 0} onChange={strokeWidth => update({ strokeWidth })} defaultValue={0} softMax />
        </PanelCard>
      )}

      <ShadowsCard layer={layer} update={update} muted={mutedReason} state={cardState('shadows', shadowsCount === 0)} />
      <OutlineCard layer={layer} update={update} muted={mutedReason} state={cardState('outline', !layer.outlineEnabled)} />
      {(layer.type === 'image' || isGroupLayer) && (
        <FiltersCard layer={layer} update={update} state={cardState('filters', !layer.filtersEnabled)} />
      )}
    </div>
  )
}

// ── Main ThumbnailPage ────────────────────────────────────────────────────────

export function ThumbnailPage({ isVisible, onNavigateToStream }: {
  isVisible: boolean
  /** Opens the stream item on the streams page; the toolbar's stream
   *  title links there (THU-28). */
  onNavigateToStream?: (folderPath: string) => void
}) {
  const { pendingStream, clearPendingStream, rerenderRequest } = useThumbnailEditor()
  const { config, updateConfig } = useStore()
  const { setThumbnailHasCanvas, setNavSubtext } = usePageActivity()
  // Assets-panel options dropdown (show-from-season / show-from-topic-game).
  const [assetOptionsOpen, setAssetOptionsOpen] = useState(false)
  const assetOptionsRef = useRef<HTMLDivElement>(null)
  // Assets-panel collapse — just the header when collapsed (options button
  // and list hidden). Persisted UI pref, same pattern as the files grid.
  // Palette panel collapse (thumbnails #1) — same persistence pattern as
  // the assets panel below.
  const [paletteCollapsed, setPaletteCollapsed] = useState(() => localStorage.getItem('thumbPaletteCollapsed') === 'true')
  const togglePaletteCollapsed = () => {
    const next = !paletteCollapsed
    setPaletteCollapsed(next)
    localStorage.setItem('thumbPaletteCollapsed', String(next))
    if (next) setPaletteEditMode(false)
  }
  // ── Palette data (thumbnails #1, phase 2) ─────────────────────────────────
  // Palette: _palette.json beside _meta.json (travels with the library).
  // null = not loaded yet. Recents: electron-store (per-machine — they churn
  // on every color use and don't belong in a cloud-synced file).
  const [palette, setPalette] = useState<PaletteSwatch[] | null>(null)
  // Recents carry an EPHEMERAL id (never persisted): it's what a session
  // tie points at so tweaks update one entry in place. Ties don't survive
  // the session, so ids don't need to either.
  const [colorRecents, setColorRecents] = useState<{ id: number; value: SwatchValue }[]>([])
  const recentIdRef = useRef(1)
  const [paletteError, setPaletteError] = useState<string | null>(null)
  // Neutral feedback line (import/export results) — paletteError stays red
  // for real failures.
  const [paletteNotice, setPaletteNotice] = useState<string | null>(null)
  // Edit-mode selection (phase 3) — indexes into `palette`. Anchor drives
  // shift-range selection; drop index is the live reorder insertion point.
  const [selectedSwatches, setSelectedSwatches] = useState<ReadonlySet<number>>(new Set())
  const swatchAnchorRef = useRef<number | null>(null)
  const [swatchDropIndex, setSwatchDropIndex] = useState<number | null>(null)
  useEffect(() => {
    if (!config.streamsDir) return
    let cancelled = false
    window.api.thumbnailGetPalette(config.streamsDir)
      .then(p => { if (!cancelled) setPalette(p ?? [...DEFAULT_PALETTE]) })
      .catch(err => {
        console.error('Failed to load palette', err)
        if (!cancelled) {
          setPalette([...DEFAULT_PALETTE])
          setPaletteError('Couldn’t read _palette.json — showing the defaults')
        }
      })
    window.api.thumbnailGetColorRecents()
      .then(r => {
        if (cancelled) return
        // Stored entries: hex strings (solids) or { gradient } objects.
        setColorRecents(r.flatMap(en => {
          const value: SwatchValue | null =
            typeof en === 'string' ? { color: en } : en?.gradient ? { gradient: en.gradient } : null
          return value ? [{ id: recentIdRef.current++, value }] : []
        }))
      })
      .catch(err => console.error('Failed to load recent colors', err))
    return () => { cancelled = true }
  }, [config.streamsDir])
  const persistPalette = useCallback((next: PaletteSwatch[]) => {
    setPalette(next)
    setPaletteError(null)
    setPaletteNotice(null)
    // Any mutation invalidates the index-based edit-mode selection.
    setSelectedSwatches(new Set())
    swatchAnchorRef.current = null
    if (!config.streamsDir) return
    window.api.thumbnailSetPalette(config.streamsDir, next).catch(err => {
      console.error('Failed to save palette', err)
      setPaletteError('Saving _palette.json failed — this change may not persist')
    })
  }, [config.streamsDir])
  const addPaletteSwatch = useCallback((value: SwatchValue) => {
    if (!palette) return
    const key = swatchKey(value)
    if (palette.some(s => { const v = paletteSwatchValue(s); return v !== null && swatchKey(v) === key })) return
    persistPalette([...palette, 'color' in value ? { color: value.color.toLowerCase() } : { gradient: value.gradient }])
  }, [palette, persistPalette])
  /** A recent tile dropped between two saved swatches (THU-10): same
   *  dedupe as a click, inserted at the marker instead of the end. The
   *  recent disappears from its row the way a clicked one does, through
   *  the duplicate filter on `visibleRecents`. */
  const insertPaletteSwatch = useCallback((value: SwatchValue, at: number) => {
    setSwatchDropIndex(null)
    if (!palette) return
    const key = swatchKey(value)
    if (palette.some(s => { const v = paletteSwatchValue(s); return v !== null && swatchKey(v) === key })) return
    const entry: PaletteSwatch = 'color' in value ? { color: value.color.toLowerCase() } : { gradient: value.gradient }
    const idx = Math.max(0, Math.min(palette.length, at))
    persistPalette([...palette.slice(0, idx), entry, ...palette.slice(idx)])
  }, [palette, persistPalette])

  // ── Session ties (the "smart recents") ────────────────────────────────────
  // While the user works one color property, its recents entry updates IN
  // PLACE instead of spawning a sibling per tweak — tweak a fill's hue
  // five times and you've used one slot, not five. Key = layerId:property
  // (so detouring to the stroke and back keeps both ties alive). All ties
  // break EAGERLY when the selected layer changes — the next edit session
  // gets a fresh entry, and an old entry can never mutate mysteriously.
  const recentTiesRef = useRef(new Map<string, number>())
  // (The tie-breaking effect lives further down, after selectedIds/mode
  // are declared — deps can't reference bindings that don't exist yet.)

  const recordRecentColor = useCallback((value: SwatchValue, tieKey?: string) => {
    // Swatches are FULL snapshots — solids keep their alpha (validated
    // here), gradients arrive pre-shaped from the gradient control.
    if ('color' in value && !/^#[0-9a-f]{6}([0-9a-f]{2})?$/i.test(value.color)) return
    const normalized: SwatchValue = 'color' in value ? { color: value.color.toLowerCase() } : value
    setColorRecents(prev => {
      const key = swatchKey(normalized)
      const tiedId = tieKey ? recentTiesRef.current.get(tieKey) : undefined
      // Replace the tied entry (in-place identity) and any value-duplicate.
      const rest = prev.filter(e => e.id !== tiedId && swatchKey(e.value) !== key)
      const id = tiedId ?? recentIdRef.current++
      if (tieKey) recentTiesRef.current.set(tieKey, id)
      const next = [{ id, value: normalized }, ...rest].slice(0, 30)
      window.api.thumbnailSetColorRecents(
        next.map(e => ('color' in e.value ? e.value.color : { gradient: e.value.gradient })),
      ).catch(err => console.error('Failed to save recent colors', err))
      return next
    })
  }, [])

  // Recents that duplicate a saved swatch add nothing — the value is
  // already one tile away — so displays filter them out (storage keeps the
  // full list: deleting the swatch resurfaces the recent). THIS slice is
  // the one-row cap (9 across at the panel's width); storage keeps more so
  // filtered-out duplicates can't shrink the visible row.
  const visibleRecents = useMemo(() => {
    const paletteKeys = new Set(
      (palette ?? []).flatMap(s => { const v = paletteSwatchValue(s); return v ? [swatchKey(v)] : [] }),
    )
    return colorRecents.filter(e => !paletteKeys.has(swatchKey(e.value))).slice(0, 9)
  }, [colorRecents, palette])
  const breakRecentTie = useCallback((tieKey: string) => {
    recentTiesRef.current.delete(tieKey)
  }, [])
  const paletteCtx = useMemo(() => ({
    palette: palette ?? [],
    recents: visibleRecents,
    recordRecent: recordRecentColor,
    breakRecentTie,
  }), [palette, visibleRecents, recordRecentColor, breakRecentTie])
  const paletteAddInputRef = useRef<HTMLInputElement>(null)
  // Palette edit mode (pencil in the header) — phase 3: click selects
  // (Ctrl toggles, Shift ranges from the anchor), drag reorders (a
  // multi-selection moves as a block), and the toolbar carries
  // delete / reset / export / import.
  const [paletteEditMode, setPaletteEditMode] = useState(false)
  const [confirmPaletteReset, setConfirmPaletteReset] = useState(false)
  // Leaving edit mode drops the selection and any pending drop indicator.
  useEffect(() => {
    if (paletteEditMode) return
    setSelectedSwatches(new Set())
    setSwatchDropIndex(null)
    swatchAnchorRef.current = null
  }, [paletteEditMode])

  const handleSwatchSelect = useCallback((i: number, e: React.MouseEvent) => {
    setSelectedSwatches(prev => {
      const next = new Set(prev)
      const anchor = swatchAnchorRef.current
      if (e.shiftKey && anchor !== null) {
        if (!e.ctrlKey) next.clear()
        for (let k = Math.min(anchor, i); k <= Math.max(anchor, i); k++) next.add(k)
      } else if (e.ctrlKey) {
        if (next.has(i)) next.delete(i)
        else next.add(i)
        swatchAnchorRef.current = i
      } else {
        // Plain click: select only this one; clicking the sole selected
        // swatch again deselects.
        const wasSole = next.size === 1 && next.has(i)
        next.clear()
        if (!wasSole) next.add(i)
        swatchAnchorRef.current = wasSole ? null : i
      }
      return next
    })
  }, [])

  const deleteSelectedSwatches = useCallback(() => {
    if (!palette || selectedSwatches.size === 0) return
    persistPalette(palette.filter((_, i) => !selectedSwatches.has(i)))
  }, [palette, selectedSwatches, persistPalette])

  // Reorder drop: `insertAt` indexes the CURRENT array; the moved selection
  // is pulled out (relative order kept) and re-inserted at the equivalent
  // position among the remaining swatches.
  const commitSwatchReorder = useCallback((insertAt: number) => {
    setSwatchDropIndex(null)
    if (!palette || selectedSwatches.size === 0) return
    const sel = [...selectedSwatches].sort((a, b) => a - b)
    const moving = sel.map(i => palette[i])
    const rest = palette.filter((_, i) => !selectedSwatches.has(i))
    const at = insertAt - sel.filter(i => i < insertAt).length
    persistPalette([...rest.slice(0, at), ...moving, ...rest.slice(at)])
  }, [palette, selectedSwatches, persistPalette])

  // A drop is a no-op when the dragged selection is one contiguous block
  // and the insertion point falls inside or adjacent to it — releasing
  // there wouldn't move anything, so no insertion marker is offered. (A
  // NON-contiguous selection always moves: dropping anywhere pulls it
  // together into one block.)
  const reorderIsNoop = useCallback((insertAt: number) => {
    const sel = [...selectedSwatches].sort((a, b) => a - b)
    if (sel.length === 0) return false
    const contiguous = sel[sel.length - 1] - sel[0] === sel.length - 1
    return contiguous && insertAt >= sel[0] && insertAt <= sel[sel.length - 1] + 1
  }, [selectedSwatches])

  const exportPalette = useCallback(async () => {
    if (!palette) return
    try {
      const target = await window.api.saveFileDialog({
        title: 'Export palette',
        defaultPath: 'sm-palette.json',
        filters: [{ name: 'Palette JSON', extensions: ['json'] }],
      })
      if (!target) return
      await window.api.thumbnailExportPalette(target, palette)
      setPaletteNotice(`Exported ${palette.length} swatch${palette.length === 1 ? '' : 'es'}`)
    } catch (err) {
      console.error('Palette export failed', err)
      setPaletteError('Export failed — see the console for the cause')
    }
  }, [palette])

  const importPalette = useCallback(async () => {
    try {
      const picked = await window.api.openFileDialog({
        title: 'Import palette',
        filters: [{ name: 'Palette JSON', extensions: ['json'] }],
        properties: ['openFile'],
        startIn: 'downloads',
      })
      const file = picked?.[0]
      if (!file) return
      const swatches = await window.api.thumbnailImportPalette(file)
      const cur = palette ?? []
      const have = new Set(cur.flatMap(s => { const v = paletteSwatchValue(s); return v ? [swatchKey(v)] : [] }))
      const added = swatches.filter(s => {
        const v = paletteSwatchValue(s)
        return v !== null && !have.has(swatchKey(v))
      })
      if (added.length === 0) {
        setPaletteNotice('No new swatches — that file’s swatches are all in the palette already')
        return
      }
      persistPalette([...cur, ...added])
      setPaletteNotice(`Added ${added.length} swatch${added.length === 1 ? '' : 'es'}`)
    } catch (err) {
      console.error('Palette import failed', err)
      const msg = err instanceof Error ? err.message.replace(/^Error invoking remote method '[^']+': (Error: )?/, '') : String(err)
      setPaletteError(`Import failed: ${msg}`)
    }
  }, [palette, persistPalette])
  const [assetsCollapsed, setAssetsCollapsed] = useState(() => localStorage.getItem('thumbAssetsCollapsed') === 'true')
  const toggleAssetsCollapsed = () => {
    const next = !assetsCollapsed
    setAssetsCollapsed(next)
    localStorage.setItem('thumbAssetsCollapsed', String(next))
    if (next) setAssetOptionsOpen(false)
  }
  // Layers + Properties panel collapse (UI-polish batch): every sidebar
  // panel collapses now, and collapsibility is the default for any future
  // panel here. Same persistence pattern as palette/assets.
  const [layersCollapsed, setLayersCollapsed] = useState(() => localStorage.getItem('thumbLayersCollapsed') === 'true')
  const toggleLayersCollapsed = () => {
    const next = !layersCollapsed
    setLayersCollapsed(next)
    localStorage.setItem('thumbLayersCollapsed', String(next))
  }
  const [propertiesCollapsed, setPropertiesCollapsed] = useState(() => localStorage.getItem('thumbPropertiesCollapsed') === 'true')
  const togglePropertiesCollapsed = () => {
    const next = !propertiesCollapsed
    setPropertiesCollapsed(next)
    localStorage.setItem('thumbPropertiesCollapsed', String(next))
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
  // Add-swatch flow (thumbnails #1): the palette header's + button clicks a
  // hidden color input; the swatch lands on the native `change` event
  // (dialog close), NOT per input tick — a drag through the picker would
  // otherwise scatter junk swatches. `mode` in the deps: the input only
  // exists in editor mode, so the listener must (re)attach when it mounts.
  useEffect(() => {
    const el = paletteAddInputRef.current
    if (!el) return
    const onPick = () => addPaletteSwatch({ color: el.value })
    el.addEventListener('change', onPick)
    return () => el.removeEventListener('change', onPick)
  }, [addPaletteSwatch, mode])

  // ── Overview data ─────────────────────────────────────────────────────────
  const [templates, setTemplates] = useState<ThumbnailTemplate[]>([])
  const [recents, setRecents] = useState<Array<ThumbnailRecentEntry & { variantCount?: number; thumbPath?: string | null }>>([])
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
  const { layers, commit, set: setLayersDirect, undo, redo, reset: resetLayersRaw, canUndo, canRedo } = useUndoRedo(
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
  // Every list that enters the editor (a canvas from disk, a template, a
  // duplicate) passes through the on-load migrations in lib/polygon.ts, so
  // the state never carries a legacy shape: saved triangles become
  // three-sided polygons with their box refitted (THU-2). Unchanged lists
  // come back by identity, so this is free for current files.
  // Load-time normalization: legacy triangles become polygons, and mask
  // flags are validated and pinned (THU-21).
  const resetLayers = useCallback((next: ThumbnailLayer[]) => resetLayersRaw(wrapLayerAngles(pinMasks(normalizeLayers(next)))), [resetLayersRaw])
  const [selectedIds, setSelectedIds] = useState<string[]>([])
  const selectedIdsRef = useRef<string[]>([])
  useEffect(() => { selectedIdsRef.current = selectedIds }, [selectedIds])
  // Session-tie breaker: changing the selected layer (or leaving the
  // editor) is the "focus is obviously lost" signal — every live recents
  // tie breaks, so the next edit session starts a fresh entry.
  useEffect(() => {
    recentTiesRef.current.clear()
  }, [selectedIds, mode])
  // Live layers for the keyboard handler's relative edits (arrow-key nudge),
  // which can fire on auto-repeat faster than React re-renders the closure.
  const layersRef = useRef(layers)
  useEffect(() => { layersRef.current = layers }, [layers])
  // Inline rename state for the layer panel. Only one layer renames at a time.
  const [renamingLayerId, setRenamingLayerId] = useState<string | null>(null)
  // Drag-and-drop reordering state: the row being dragged, and below it the
  // computed drop target.
  const [draggingLayerId, setDraggingLayerId] = useState<string | null>(null)
  // Panel drop target (THU-18): the gap the indicator draws in (row index,
  // indented to the target depth) plus where the drop lands in the tree.
  const [panelDrop, setPanelDrop] = useState<{ gapIdx: number; depth: number; parentId: string | null; afterId: string | null } | null>(null)
  // Collapsed groups in the layers panel. UI state only: not saved with
  // the canvas, so toggling a chevron never dirties the thumbnail.
  const [collapsedGroups, setCollapsedGroups] = useState<Set<string>>(() => new Set())
  const toggleGroupCollapsed = useCallback((id: string) => {
    setCollapsedGroups(prev => {
      const next = new Set(prev)
      if (next.has(id)) next.delete(id); else next.add(id)
      return next
    })
  }, [])

  // Sync the shared Transformer's nodes() to the current selection. Konva's
  // Transformer renders no handles when nodes() is empty (i.e. nothing
  // selected), so we don't need an isSelected gate. Single-text selection
  // gets keepRatio off but the boundBoxFunc locks height to font metrics.
  // (Polygons stretch like ellipses, so they get no special case; the
  // per-layer aspect lock in boundBoxFunc covers them.)
  //
  // Multi-select with any rotated member forces keepRatio: a non-uniform
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
    const rotatedInMulti = sel.length > 1 && sel.some(l => (l.rotation ?? 0) !== 0)
    // A group holding text or a rotated member resizes proportionally only:
    // its scale is baked into the members on release, and neither has a
    // non-uniform representation (THU-18).
    tr.keepRatio(rotatedInMulti || needsUniformScale(layers, selectedIds))
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

  // ── Layer bounds overlays (thumbnails #3) ─────────────────────────────────
  // Five states, two new styles: hovered layers get a solid transparent
  // outline (whether unselected or inside a group selection), group-selection
  // MEMBERS get a dashed full-color outline so each element inside the
  // Transformer's collective frame stays identifiable. Single selection is
  // untouched — the Transformer already communicates it, hover included.
  // hoveredLayerId is shared with the layers panel: canvas hover highlights
  // the row, row hover outlines the canvas element.
  const [hoveredLayerId, setHoveredLayerId] = useState<string | null>(null)
  // Overlays hide while a drag/resize gesture is live: the group frame
  // already shows what's moving, and outlines would obscure the element
  // edges exactly when precise positioning matters most.
  const [canvasGestureActive, setCanvasGestureActive] = useState(false)
  const [boundsOverlays, setBoundsOverlays] = useState<Array<{
    id: string; x: number; y: number; rotation: number
    box: { x: number; y: number; width: number; height: number }
    kind: 'hover' | 'member'
  }>>([])

  // Computed in an effect (not during render) so the Konva nodes are read
  // AFTER react-konva commits geometry changes — text heights are measured
  // by Konva, not modeled, so the node is the only correct source.
  useEffect(() => {
    const stage = stageRef.current
    if (!stage || canvasGestureActive) {
      setBoundsOverlays(prev => (prev.length ? [] : prev))
      return
    }
    const wanted = new Map<string, 'hover' | 'member'>()
    if (selectedIds.length > 1) for (const id of selectedIds) wanted.set(id, 'member')
    if (hoveredLayerId && !(selectedIds.length === 1 && selectedIds[0] === hoveredLayerId)) {
      wanted.set(hoveredLayerId, 'hover')
    }
    const next: typeof boundsOverlays = []
    wanted.forEach((kind, id) => {
      const l = layers.find(x => x.id === id)
      if (!l || !l.visible) return
      const node = stage.findOne(`#${id}`)
      if (!node) return
      // A group member's x/y are relative to its group, so its outline
      // takes the stage-space box instead (axis-aligned; good enough for
      // a hover hint, and exact when the group is unrotated).
      if (l.parentId) {
        const abs = node.getClientRect({ relativeTo: stage as unknown as Konva.Container, skipShadow: true, skipStroke: true })
        next.push({ id, kind, x: 0, y: 0, rotation: 0, box: abs })
        return
      }
      // Self-relative client rect = the node's untransformed content box.
      // The overlay group re-applies x/y/rotation below, so the outline
      // hugs rotated elements instead of their axis-aligned bounds.
      const box = node.getClientRect({ relativeTo: node as Konva.Container, skipShadow: true, skipStroke: true })
      next.push({ id, kind, x: l.x, y: l.y, rotation: l.rotation ?? 0, box })
    })
    setBoundsOverlays(next)
  }, [hoveredLayerId, selectedIds, layers, canvasGestureActive])

  // Canvas-side hover tracking: one listener pair on the content Layer
  // (Konva events bubble). The wrapper Group carrying the layer id is found
  // by walking up until the parent is the content Layer itself — topmost
  // element under the cursor wins naturally on overlaps.
  const handleCanvasMouseOver = useCallback((e: Konva.KonvaEventObject<MouseEvent>) => {
    let n: Konva.Node | null = e.target
    while (n && n.getParent() !== e.currentTarget) n = n.getParent()
    setHoveredLayerId(n?.id() || null)
  }, [])
  const handleCanvasMouseOut = useCallback(() => setHoveredLayerId(null), [])

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
  // Rotation snapping (THU-25) follows the same modifiers, applied to the
  // Transformer imperatively so pressing or releasing a key mid-drag takes
  // effect on the next frame. Tolerance is half the step, so while a
  // modifier is held the handle always sits on a stop.
  const applyRotationSnaps = useCallback(() => {
    const tr = transformerRef.current
    if (!tr) return
    const step = rotationSnapStep(ctrlPressedRef.current, shiftPressedRef.current)
    if (step) {
      tr.rotationSnaps(rotationSnapAngles(step))
      tr.rotationSnapTolerance(step / 2)
    } else {
      tr.rotationSnaps([])
      tr.rotationSnapTolerance(0)
    }
  }, [])
  useEffect(() => {
    const sync = (e: KeyboardEvent) => {
      shiftPressedRef.current = e.shiftKey
      ctrlPressedRef.current = e.ctrlKey || e.metaKey
      applyRotationSnaps()
    }
    // Some focus-shift sequences can leave the keyup unfired (e.g. user
    // alt-tabs while holding a modifier). Reset on blur to avoid a stale
    // "always held" state.
    const onBlur = () => { shiftPressedRef.current = false; ctrlPressedRef.current = false; applyRotationSnaps() }
    window.addEventListener('keydown', sync)
    window.addEventListener('keyup', sync)
    window.addEventListener('blur', onBlur)
    return () => {
      window.removeEventListener('keydown', sync)
      window.removeEventListener('keyup', sync)
      window.removeEventListener('blur', onBlur)
    }
  }, [applyRotationSnaps])

  // ── Snapping ──────────────────────────────────────────────────────────────
  const [smartSnapEnabled, setSmartSnapEnabled] = useState(true)
  const [gridSnapEnabled, setGridSnapEnabled] = useState(false)
  // Accumulated rotation during a rotate gesture, for the live readout.
  const rotationTrackRef = useRef<{ last: number; accum: number } | null>(null)
  // Pixel snap (THU-27): moves and resizes land on whole canvas pixels.
  // On by default and remembered; off leaves Konva's raw doubles alone.
  // Typed values in the properties panel are never touched by it.
  const [pixelSnapEnabled, setPixelSnapEnabled] = useState(() => localStorage.getItem('thumbPixelSnap') !== 'false')
  const pixelSnapEnabledRef = useRef(pixelSnapEnabled)
  pixelSnapEnabledRef.current = pixelSnapEnabled
  const togglePixelSnap = useCallback(() => {
    setPixelSnapEnabled(v => {
      const next = !v
      localStorage.setItem('thumbPixelSnap', String(next))
      return next
    })
  }, [])
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
  // Selection tools panel anchor (THU-28): the selection's axis-aligned
  // bounding box in CONTAINER pixels (Konva's absolute client rect already
  // includes the stage's zoom and pan). Recomputed in an effect, after
  // react-konva has committed geometry, and dropped during gestures so
  // the panel does not chase the pointer.
  const [selectionAnchor, setSelectionAnchor] = useState<{ x: number; y: number; w: number; h: number } | null>(null)
  useEffect(() => {
    const stage = stageRef.current
    if (!stage || canvasGestureActive || selectedIds.length === 0) {
      setSelectionAnchor(null)
      return
    }
    let x1 = Infinity, y1 = Infinity, x2 = -Infinity, y2 = -Infinity
    for (const id of selectedIds) {
      const node = stage.findOne(`#${id}`)
      if (!node) continue
      const r = node.getClientRect({ skipShadow: true, skipStroke: true })
      x1 = Math.min(x1, r.x); y1 = Math.min(y1, r.y)
      x2 = Math.max(x2, r.x + r.width); y2 = Math.max(y2, r.y + r.height)
    }
    if (!Number.isFinite(x1)) { setSelectionAnchor(null); return }
    setSelectionAnchor({ x: x1, y: y1, w: x2 - x1, h: y2 - y1 })
  }, [selectedIds, layers, canvasGestureActive, viewZoom, viewPan, containerSize])

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

  // Every stream in the library, from the asset-library load below. Drives
  // the toolbar's previous/next stream and episode buttons (THU-19).
  const [allStreamFolders, setAllStreamFolders] = useState<StreamFolder[]>([])

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
        // The same listing feeds the toolbar's stream and episode
        // navigation (THU-19), so it stays current with the watcher too.
        setAllStreamFolders(all)
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
    setCanvasGestureActive(true)
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

    // Pixel snap (THU-27) goes first so the node itself steps by whole
    // pixels; the smart and grid snaps below still win when they engage.
    if (pixelSnapEnabled) {
      node.x(Math.round(node.x()))
      node.y(Math.round(node.y()))
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
          other.x(pixelSnapEnabled ? Math.round(start.x + dx) : start.x + dx)
          other.y(pixelSnapEnabled ? Math.round(start.y + dy) : start.y + dy)
        }
      })
    }

    // Live readout of the move (THU-26): the primary's post-snap position.
    setLiveTransform({
      kind: 'move',
      id: node.id(),
      x: node.x(),
      y: node.y(),
      rotation: node.rotation(),
      pointer: stageRef.current.getPointerPosition(),
    })
  }, [smartSnapEnabled, gridSnapEnabled, pixelSnapEnabled])

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
  // Delete-template confirm (overview): holds the template so the modal can
  // name what's about to be removed. Deletion is irreversible — the template
  // JSON + preview are files with no undo path.
  const [confirmDeleteTemplate, setConfirmDeleteTemplate] = useState<ThumbnailTemplate | null>(null)
  const [deletingTemplate, setDeletingTemplate] = useState(false)
  const [deleteTemplateError, setDeleteTemplateError] = useState<string | null>(null)

  // ─── Load system fonts + variants ─────────────────────────────────────────
  // Deliberately keyed to page VISIBILITY, not mount: ThumbnailPage is
  // always mounted (App toggles isVisible), and queryLocalFonts rejects
  // with a SecurityError in an unfocused / never-user-activated document —
  // which is exactly what the startup background mount is. A mount-time
  // query therefore failed every session (silently, via an empty catch)
  // and never retried, stranding the 5-font seed list with missing-font
  // detection off. Querying on the navigation that made the page visible
  // succeeds; if it still fails we retry on window focus and say so in
  // the Font section.
  const [fontQueryFailed, setFontQueryFailed] = useState(false)
  const fontQueryInFlight = useRef(false)
  useEffect(() => {
    if (!isVisible || fontsLoaded) return
    const load = (): void => {
      if (fontQueryInFlight.current) return
      if (!(window as any).queryLocalFonts) { setFontQueryFailed(true); return }
      fontQueryInFlight.current = true
      ;(window as any).queryLocalFonts().then((fonts: any[]) => {
        const names = Array.from(new Set(fonts.map((f: any) => f.family as string))).sort()
        if (names.length > 0) {
          setSystemFonts(names)
          setFontsLoaded(true)
          setFontQueryFailed(false)
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
      }).catch((err: unknown) => {
        console.error('queryLocalFonts failed:', err)
        setFontQueryFailed(true)
      }).finally(() => { fontQueryInFlight.current = false })
    }
    load()
    window.addEventListener('focus', load)
    return () => window.removeEventListener('focus', load)
  }, [isVisible, fontsLoaded])

  // ── Load overview data ────────────────────────────────────────────────────
  // ThumbnailPage stays mounted across navigation (App renders it always,
  // toggling `isVisible`), so its templates/recents state persists. The
  // LOADING state shows only on the first load per (streamsDir, streamMode) —
  // re-showing it every visit flashed the whole overview. But the DATA
  // refreshes every time the overview comes back into view (page navigation
  // or closing the editor): recents follow live stream metadata — selected
  // thumbnail, renamed titles — that can change from the streams page or
  // from inside the editor, so a load-once snapshot went stale.
  const overviewLoadedKeyRef = useRef<string | null>(null)
  useEffect(() => {
    if (!isVisible || currentStream || !config.streamsDir) return
    const key = `${config.streamsDir}${config.streamMode || 'folder-per-stream'}`
    // The key is marked loaded only when a load COMPLETES (end of the .then
    // below) — marking it up front stranded the spinner: navigating straight
    // into the editor from the streams page cancels the just-started first
    // load (currentStream arrives a beat after visibility), and the post-
    // editor re-run then classified itself as a silent refresh, leaving
    // overviewLoading true forever.
    const firstLoad = overviewLoadedKeyRef.current !== key
    if (firstLoad) setOverviewLoading(true)
    let cancelled = false
    Promise.all([
      window.api.thumbnailListTemplates(config.streamsDir),
      window.api.thumbnailGetRecents(),
      window.api.listStreams(config.streamsDir, config.streamMode || 'folder-per-stream'),
    ]).then(async ([tmpl, rec, allStreams]) => {
      if (cancelled) return
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
      if (cancelled) return
      const stale = rec.filter((_, i) => variantCounts[i] === 0)

      // Persist removals so they don't reappear next time
      await Promise.allSettled(
        stale.map(r => window.api.thumbnailRemoveRecent(r.folderPath, r.date))
      )
      if (cancelled) return

      // Re-render each recent's title from live stream metadata. The stored
      // title is just a snapshot (and older entries stored the raw template
      // body), so resolving against the current folder keeps the list in
      // sync with renames + renders {merge fields} properly. The same live
      // folder also resolves the row's thumbnail (thumbPath) so the recents
      // image follows the stream's SELECTED thumbnail.
      const byPath = new Map(allStreams.map(s => [s.folderPath, s]))
      const valid = rec
        .map((r, i) => ({ r, count: variantCounts[i] }))
        .filter(({ count }) => count > 0)
        .map(({ r, count }) => {
          const f = byPath.get(r.folderPath)
          return {
            ...(f ? { ...r, title: renderStreamTitle(f, allStreams) } : r),
            variantCount: count,
            thumbPath: f ? resolveStreamItemThumb(f) : null,
          }
        })

      setRecents(valid)
      overviewLoadedKeyRef.current = key
    }).catch(err => {
      console.error('Failed to load thumbnail overview', err)
    }).finally(() => { if (!cancelled && firstLoad) setOverviewLoading(false) })
    return () => { cancelled = true }
  }, [isVisible, currentStream, config.streamsDir, config.streamMode])

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
    const open = mode === 'editor' && currentStream !== null
    setThumbnailHasCanvas(open)
    // Nav subtext (nav redesign Pass C): the open canvas's stream title,
    // falling back to its date. Overview mode publishes nothing.
    setNavSubtext('thumbnails', open ? (currentStream.title?.trim() || currentStream.date) : null)
  }, [mode, currentStream, setThumbnailHasCanvas, setNavSubtext])

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

  // ── Preview mode (thumbnails #8) ──────────────────────────────────────────
  // Swaps the canvas viewport for DOM mockups of YouTube surfaces, fed by a
  // bitmap snapshot of the stage. The stage stays mounted underneath the
  // overlay, so the properties panel keeps working — edits re-capture
  // (debounced) and every mockup size updates near-live. Declared HERE,
  // before the wheel-zoom effect, whose deps read previewMode; the capture
  // effect lives after getCanvasDataUrl, which it calls.
  const [previewMode, setPreviewMode] = useState(false)
  const [previewSnapshot, setPreviewSnapshot] = useState<string | null>(null)
  // Gallery settings live here (not in PreviewGallery) so they survive
  // Edit↔Preview toggles — the gallery unmounts each time. Deliberately NOT
  // reset on session switch: badge/theme choice is a viewing preference.
  const [previewOverlay, setPreviewOverlay] = useState<PreviewOverlay>('duration')
  const [previewWatched, setPreviewWatched] = useState(false)
  const [previewLightBg, setPreviewLightBg] = useState(false)
  // A new session (stream/variant/template switch, or leaving the editor)
  // starts back in Edit mode with no stale snapshot.
  useEffect(() => {
    setPreviewMode(false)
    setPreviewSnapshot(null)
  }, [mode, currentStream?.folderPath, currentStream?.date, currentVariant, currentTemplateId])

  // ── Wheel zoom + middle-click pan ─────────────────────────────────────────
  // Unbound entirely while the preview overlay is up: the container-level
  // wheel listener preventDefaults, which blocked scrolling INSIDE the
  // gallery (its wheel events bubble through the overlay to the container).
  useEffect(() => {
    if (mode !== 'editor' || previewMode) return
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
    // previewMode is in the deps so the listeners actually UNBIND when the
    // preview overlay opens (the guard above alone only affects fresh runs).
  }, [mode, previewMode])

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
    // Group shadows and outlines (THU-31) rasterize a frame after the
    // images land; a snapshot taken before that would miss them.
    await waitForGroupRasters(Math.max(0, timeoutMs - (Date.now() - start)))
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
    // Hide the whole transformer layer — it hosts pure UI chrome (the
    // Transformer's handles, the align-anchor box, and the hover/member
    // bounds overlays), none of which belongs in the exported image.
    // Hiding only the Transformer nodes left the bounds overlay rects
    // baking into PNGs saved while a group selection was active.
    transformerLayerRef.current?.hide()
    // A selected mask's dashed outline (THU-21) is chrome that lives in
    // the content layer; hide it too, or a save taken while a mask is
    // selected bakes the dashes into the PNG.
    const maskOutlines = stage.find(`.${MASK_OUTLINE_NAME}`)
    maskOutlines.forEach(n => n.hide())
    const prevX = stage.x(), prevY = stage.y()
    const prevSX = stage.scaleX(), prevSY = stage.scaleY()
    const prevW = stage.width(), prevH = stage.height()
    stage.x(0); stage.y(0); stage.scaleX(1); stage.scaleY(1)
    stage.width(CANVAS_W); stage.height(CANVAS_H)
    const dataUrl = stage.toDataURL({ pixelRatio: 1 })
    stage.x(prevX); stage.y(prevY); stage.scaleX(prevSX); stage.scaleY(prevSY)
    stage.width(prevW); stage.height(prevH)
    maskOutlines.forEach(n => n.show())
    transformerLayerRef.current?.show()
    bgLayerRef.current?.show()
    guideLayerRef.current?.show()
    matteLayerRef.current?.show()
    return dataUrl
  }, [])

  // Preview snapshot capture (thumbnails #8) — state lives above the
  // wheel-zoom effect (whose deps read previewMode); this effect sits here
  // because it needs waitForStageImages + getCanvasDataUrl.
  useEffect(() => {
    if (!previewMode) return
    let cancelled = false
    // Short debounce: slider drags produce layer-state bursts, and a full
    // 1280×720 rasterize per change would churn. 250ms after the last edit
    // (and on entry) is imperceptible for a preview.
    const t = setTimeout(async () => {
      try {
        await waitForStageImages()
        if (cancelled) return
        const url = getCanvasDataUrl()
        if (!cancelled && url) setPreviewSnapshot(url)
      } catch (err) {
        console.error('Preview snapshot failed', err)
      }
    }, 250)
    return () => { cancelled = true; clearTimeout(t) }
  }, [previewMode, layers, waitForStageImages, getCanvasDataUrl])

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
        // A successful save with a real PNG is a faithful render — clear
        // this variant's background-rerender stale flag ("Could not load
        // references") if one was set.
        const staleMap = currentStream?.meta?.smThumbnailStale
        if (pngDataUrl != null && staleMap?.[String(ordinal)]) {
          const next = { ...staleMap }
          delete next[String(ordinal)]
          await window.api.updateStreamMeta(folderPath, {
            smThumbnailStale: next,
          }, streamMetaKey(folderPath, date, config.streamsDir)).catch(() => {})
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
    // The readout and the panel drop back to the committed layer; the
    // commit below lands in the same microtask, before the next paint.
    setLiveTransform(null)
    queueMicrotask(() => {
      dragEndFlushScheduledRef.current = false
      // Before the early returns: the bounds overlays must come back even
      // when the drag turns out to be a no-op.
      setCanvasGestureActive(false)
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
      // Pixel snap (THU-27): the primary already moved by whole pixels;
      // companions land on whole pixels too, as they did on screen.
      const pos = (v: number) => (pixelSnapEnabledRef.current ? Math.round(v) : v)
      const positions = new Map<string, { x: number; y: number }>()
      positions.set(primaryId, { x: px, y: py })
      companions.forEach((start, id) => positions.set(id, { x: pos(start.x + dx), y: pos(start.y + dy) }))

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
    // Pixel snap (THU-27): a nudge from a fractional position lands on a
    // whole pixel rather than carrying the fraction along.
    const base = (v: number) => (pixelSnapEnabledRef.current ? Math.round(v) : v)
    const next = layersRef.current.map(l =>
      sel.includes(l.id) ? { ...l, x: base(l.x) + dx, y: base(l.y) + dy } : l
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

      // Groups bake their drag scale into their members after the map
      // (the members are other entries of the same array).
      const groupScales: Array<{ id: string; sx: number; sy: number }> = []
      // Pixel snap (THU-27): positions and boxes commit to whole pixels
      // (an aspect-locked image keeps its ratio exactly, see
      // snapResizedBox); off, the raw values land as they are.
      const pixelSnap = pixelSnapEnabledRef.current
      const pos = (v: number) => (pixelSnap ? Math.round(v) : v)
      let next = layers.map(l => {
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
        // Wrapped on commit (style guide, "Angle fields"): the readout showed
        // the accumulated spin; the stored value is 0..360.
        const rot = normalizeAngle(node.rotation())
        let x = node.x(), y = node.y()
        if (l.type === 'group') {
          groupScales.push({ id: l.id, sx: dragScaleX, sy: dragScaleY })
          return { ...l, x: pos(x), y: pos(y), rotation: rot }
        }
        if (l.type === 'image') {
          let { width: w, height: h } = snapResizedBox(l, (l.width ?? 0) * dragScaleX, (l.height ?? 0) * dragScaleY, pixelSnap)
          x = pos(x); y = pos(y)
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
          let w = Math.max(1, pos(baseW * dragScaleX))
          x = pos(x); y = pos(y)
          if (gridSnapEnabled) { x = snapGrid(x); y = snapGrid(y); w = snapGrid(w) }
          return { ...l, x, y, width: w, rotation: rot }
        }
        // shape: layer.width/height are authoritative.
        const w0 = l.width ?? 200
        const h0 = l.height ?? 200
        let { width: newW, height: newH } = snapResizedBox(l, w0 * dragScaleX, h0 * dragScaleY, pixelSnap)
        if (gridSnapEnabled) { newW = snapGrid(newW); newH = snapGrid(newH) }
        return { ...l, x: pos(x), y: pos(y), width: newW, height: newH, rotation: rot }
      })
      for (const g of groupScales) next = scaleGroupMembers(next, g.id, g.sx, g.sy, pixelSnap)

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

  /** Delete layers with their subtrees; groups left empty go with them.
   *  Selection keeps whatever survived. */
  const deleteLayerIds = useCallback((ids: string[]) => {
    if (ids.length === 0) return
    const next = deleteLayers(layers, ids)
    commitLayers(next)
    setSelectedIds(prev => prev.filter(id => next.some(l => l.id === id)))
  }, [layers, commitLayers])

  const deleteSelected = useCallback(() => { deleteLayerIds(selectedIds) }, [deleteLayerIds, selectedIds])

  // Move a layer (with its subtree) among its siblings in the z-order:
  // 'up'/'top' toward the front, 'down'/'bottom' toward the back. Used by
  // the Photoshop-style Ctrl+[ /] keyboard shortcuts. A group moves as one;
  // a member moves within its group.
  const moveLayer = useCallback((id: string, direction: 'up' | 'down' | 'top' | 'bottom') => {
    const next = moveAmongSiblings(layers, id, direction)
    if (next) commitLayers(next)
  }, [layers, commitLayers])

  /** The Transform card's width and height for a group (THU-33): scale the
   *  members by the factors, the same math a canvas resize bakes in. */
  const scaleGroupFromPanel = useCallback((id: string, sx: number, sy: number) => {
    if (!Number.isFinite(sx) || !Number.isFinite(sy) || sx <= 0 || sy <= 0) return
    commitLayers(scaleGroupMembers(layersRef.current, id, sx, sy, pixelSnapEnabledRef.current))
  }, [commitLayers])

  // ── Grouping (THU-18) ──────────────────────────────────────────────────
  const groupCheck = useMemo(() => canGroup(layers, selectedIds), [layers, selectedIds])

  /** Wrap the selection in a new group. The union box comes from the Konva
   *  nodes (relative to each node's parent container) so rotated members
   *  and measured text land exactly; the group's origin is its top-left. */
  const groupSelected = useCallback(() => {
    const ls = layersRef.current
    const sel = selectedIdsRef.current
    if (!canGroup(ls, sel).ok) return
    const stage = stageRef.current
    const rectOf = (id: string) => {
      const node = stage?.findOne(`#${id}`)
      const parent = node?.getParent()
      if (!node || !parent) return null
      return node.getClientRect({ relativeTo: parent as Konva.Container, skipShadow: true, skipStroke: true })
    }
    const res = groupLayers(ls, sel, rectOf, newId)
    if (!res) return
    commitLayers(res.layers)
    setSelectedIds([res.groupId])
  }, [commitLayers])

  /** Dissolve the selected groups; their freed members join whatever else
   *  was selected. Other selected layers are left alone (THU-30 relaxed
   *  this from "every selected root must be a group"). */
  const ungroupSelected = useCallback(() => {
    let ls = layersRef.current
    const sel = selectedIdsRef.current
    const groups = selectionRoots(ls, sel).filter(id => isGroup(byIdOf(ls, id)))
    if (groups.length === 0) return
    const freed: string[] = []
    for (const id of groups) {
      const r = ungroupLayer(ls, id)
      if (r) { ls = r.layers; freed.push(...r.freed) }
    }
    commitLayers(ls)
    setSelectedIds([...sel.filter(id => !groups.includes(id) && ls.some(l => l.id === id)), ...freed])
  }, [commitLayers])

  // ── Layer actions tab (THU-30) ─────────────────────────────────────────
  // One tab per selection, not per row: it slides out of the layers panel's
  // left edge beside the topmost selected row and holds the actions that
  // apply to the current selection (single-layer actions for one layer,
  // whole-selection actions for several). Hovering a button lights up the
  // rows it will affect. Positioned against the editor body so it can sit
  // over the canvas, and re-measured on selection, layout, scroll, and
  // resize changes.
  const editorBodyRef = useRef<HTMLDivElement>(null)
  const rightPanelRef = useRef<HTMLDivElement>(null)
  const layersListRef = useRef<HTMLDivElement>(null)
  const layerTabRef = useRef<HTMLDivElement>(null)
  // `top`/`right` place the tab body; the spine is the 4 px bar along the
  // panel edge spanning the selected rows; the two radii are the tab's
  // right-hand corners, which square off where the spine continues past
  // them and round continuously as the tab overhangs it (the same morph as
  // the player's region pills).
  // `filletTop`/`filletBottom` are the sizes of the concave joins outside
  // the tab's right-hand corners where the spine runs past them (0 = none).
  const [layerTabPos, setLayerTabPos] = useState<{
    top: number; right: number; tabHeight: number; spineTop: number; spineHeight: number
    radiusTR: number; radiusBR: number; filletTop: number; filletBottom: number
    spineRadiusTop: number; spineRadiusBottom: number
  } | null>(null)
  const [highlighted, setHighlighted] = useState<LayerHighlight>(NO_HIGHLIGHT)
  const layerTabShown = selectedIds.length > 0 && !layersCollapsed && !previewMode
  // Synced during render, not in an effect: the measurement below runs in a
  // layout effect, before the shared selectedIdsRef catches up, and read the
  // previous selection through it.
  const tabSelectionRef = useRef(selectedIds)
  tabSelectionRef.current = selectedIds

  const measureLayerTab = useCallback(() => {
    const body = editorBodyRef.current, list = layersListRef.current, panel = rightPanelRef.current
    const sel = tabSelectionRef.current
    if (!body || !list || !panel || sel.length === 0 || list.offsetParent === null) {
      setLayerTabPos(null)
      return
    }
    const bodyRect = body.getBoundingClientRect()
    const listRect = list.getBoundingClientRect()
    const clampY = (v: number) => Math.min(Math.max(v, listRect.top), listRect.bottom)
    // Vertical range of the selected rows as displayed; a selection hidden
    // inside a collapsed group has no rows, so everything parks at the top.
    let selTop = Infinity, selBottom = -Infinity
    for (const id of sel) {
      const el = list.querySelector<HTMLElement>(`[data-layer-id="${CSS.escape(id)}"]`)
      if (!el) continue
      const r = el.getBoundingClientRect()
      selTop = Math.min(selTop, r.top)
      selBottom = Math.max(selBottom, r.bottom)
    }
    if (!Number.isFinite(selTop)) { selTop = listRect.top; selBottom = listRect.top }
    // The spine covers only the visible part of the range.
    const spineTop = clampY(selTop)
    const spineBottom = clampY(selBottom)
    // Tab body centered on the spine, kept inside the list's visible height.
    const tabH = layerTabRef.current?.offsetHeight ?? 0
    const maxTop = Math.max(listRect.top, listRect.bottom - tabH)
    const tabTop = Math.min(Math.max((spineTop + spineBottom) / 2 - tabH / 2, listRect.top), maxTop)
    const tabBottom = tabTop + tabH
    // Right-hand corners: radius equals the tab's overhang past the spine's
    // end, capped at the tab's own radius, so a corner the spine runs past
    // is square and one the tab sticks out beyond is round.
    const R = 8
    const radiusTR = Math.min(R, Math.max(0, spineTop - tabTop))
    const radiusBR = Math.min(R, Math.max(0, tabBottom - spineBottom))
    // Concave joins the other way round: they grow with the spine's overrun
    // past the tab's edge, up to the same radius. The spine's rounded end
    // needs room in the same overrun, so when there is not enough for both
    // they share it: the end rounding takes up to half, the join the rest.
    // Full-width rounding: the spine is 4 px wide and its ends read as
    // round only when the radius equals that width.
    const SPINE_R = 4
    const share = (overrun: number) => {
      const end = overrun <= 0 ? SPINE_R : Math.min(SPINE_R, overrun / 2)
      return { end, fillet: Math.min(R, Math.max(0, overrun - end)) }
    }
    const topShare = share(tabTop - spineTop)
    const bottomShare = share(spineBottom - tabBottom)
    const filletTop = topShare.fillet, filletBottom = bottomShare.fillet
    const spineRadiusTop = topShare.end, spineRadiusBottom = bottomShare.end
    // One pixel under the panel so the tab covers the panel's left border
    // and reads as part of it.
    const right = panel.offsetWidth - 1
    const next = {
      top: tabTop - bodyRect.top, right, tabHeight: tabH,
      spineTop: spineTop - bodyRect.top, spineHeight: Math.max(0, spineBottom - spineTop),
      radiusTR, radiusBR, filletTop, filletBottom, spineRadiusTop, spineRadiusBottom,
    }
    setLayerTabPos(p => (
      p && Math.abs(p.top - next.top) < 0.5 && p.right === next.right && p.tabHeight === next.tabHeight
        && Math.abs(p.spineTop - next.spineTop) < 0.5 && Math.abs(p.spineHeight - next.spineHeight) < 0.5
        && p.radiusTR === next.radiusTR && p.radiusBR === next.radiusBR
        && p.filletTop === next.filletTop && p.filletBottom === next.filletBottom
        && p.spineRadiusTop === next.spineRadiusTop && p.spineRadiusBottom === next.spineRadiusBottom
        ? p : next
    ))
  }, [])

  useLayoutEffect(() => {
    if (!layerTabShown) { setLayerTabPos(null); return }
    measureLayerTab()
  }, [layerTabShown, selectedIds, layers, collapsedGroups, measureLayerTab])

  useEffect(() => {
    if (!layerTabShown) return
    const list = layersListRef.current
    const body = editorBodyRef.current
    if (!list || !body) return
    list.addEventListener('scroll', measureLayerTab)
    window.addEventListener('resize', measureLayerTab)
    const ro = new ResizeObserver(measureLayerTab)
    ro.observe(list)
    ro.observe(body)
    return () => {
      list.removeEventListener('scroll', measureLayerTab)
      window.removeEventListener('resize', measureLayerTab)
      ro.disconnect()
    }
  }, [layerTabShown, measureLayerTab])

  // A button that disappears under the pointer (the selection changed)
  // must not leave its highlight behind.
  useEffect(() => { setHighlighted(NO_HIGHLIGHT) }, [selectedIds])

  /** Duplicate every selected unit in one undo entry; the copies become
   *  the selection. */
  const duplicateSelected = useCallback(() => {
    let ls = layersRef.current
    const roots = selectionRoots(ls, selectedIdsRef.current)
    const copies: string[] = []
    for (const id of roots) {
      const r = duplicateLayerTree(ls, id, newId)
      if (r) { ls = r.layers; copies.push(r.rootId) }
    }
    if (copies.length === 0) return
    commitLayers(ls)
    setSelectedIds(copies)
  }, [commitLayers])

  /** Hide every selected layer, or show them all when any is hidden. */
  const toggleSelectedVisibility = useCallback(() => {
    const ls = layersRef.current
    const sel = new Set(selectedIdsRef.current)
    const allVisible = ls.filter(l => sel.has(l.id)).every(l => l.visible)
    commitLayers(ls.map(l => (sel.has(l.id) ? { ...l, visible: !allVisible } : l)))
  }, [commitLayers])

  // ── Group masks (THU-21) ───────────────────────────────────────────────
  const useAsGroupMask = useCallback((id: string) => {
    const next = setGroupMask(layersRef.current, id)
    if (next) commitLayers(next)
  }, [commitLayers])
  const releaseMask = useCallback((id: string) => {
    const next = releaseGroupMask(layersRef.current, id)
    if (next) commitLayers(next)
  }, [commitLayers])
  /** New mask shape fitted to the group's current bounds (in the group's
   *  own frame, read from the Konva node so rotated members and measured
   *  text are exact), dropped straight into the slot and selected. */
  const addGroupMask = useCallback((groupId: string, shapeType: 'rect' | 'ellipse' | 'polygon') => {
    const ls = layersRef.current
    const node = stageRef.current?.findOne(`#${groupId}`)
    // Measure the inner container (members only) so the group's own shadow
    // and outline ghosts (THU-31) do not widen the fitted mask.
    const inner = (node as Konva.Group | undefined)?.findOne(`.${GROUP_INNER_NAME}`) ?? node
    const r = node && inner ? inner.getClientRect({ relativeTo: node as unknown as Konva.Container, skipShadow: true, skipStroke: true }) : null
    const box = r && r.width > 0 && r.height > 0 ? r : { x: 0, y: 0, width: 200, height: 200 }
    const shape: ThumbnailLayer = {
      id: newId(), name: 'Mask', type: 'shape', shapeType, visible: true, opacity: 100,
      x: Math.round(box.x), y: Math.round(box.y), rotation: 0,
      width: Math.max(1, Math.round(box.width)), height: Math.max(1, Math.round(box.height)),
      fill: '#6366f1', stroke: '#000000', strokeWidth: 0, cornerRadius: 0,
      ...(shapeType === 'polygon' ? { sides: POLYGON_DEFAULT_SIDES } : {}),
    }
    const next = insertGroupMask(ls, groupId, shape)
    if (!next) return
    commitLayers(next)
    setSelectedIds([shape.id])
  }, [commitLayers])
  /** THU-1: the selected shape becomes the mask of the layer below it,
   *  wrapping that layer in a new group when it is not one already. The
   *  masked group becomes the selection. */
  const applyMaskBelow = useCallback((id: string) => {
    const stage = stageRef.current
    const rectOf = (lid: string) => {
      const node = stage?.findOne(`#${lid}`)
      const parent = node?.getParent()
      if (!node || !parent) return null
      return node.getClientRect({ relativeTo: parent as Konva.Container, skipShadow: true, skipStroke: true })
    }
    const res = applyAsMaskBelow(layersRef.current, id, rectOf, newId)
    if (!res) return
    commitLayers(res.layers)
    setSelectedIds([res.groupId])
  }, [commitLayers])
  /** A shape dragged from the panel onto a group's empty slot: it moves into
   *  the group (kept in place on screen) and becomes the mask. */
  const dropShapeIntoSlot = useCallback((shapeId: string, groupId: string) => {
    const ls = layersRef.current
    const kids = childrenOf(ls, groupId)
    const moved = moveLayerTo(ls, shapeId, groupId, kids.length ? kids[kids.length - 1].id : null) ?? ls
    const masked = setGroupMask(moved, shapeId)
    if (masked) commitLayers(masked)
  }, [commitLayers])
  // The group whose empty slot is the current drop target, lit amber.
  const [slotDrop, setSlotDrop] = useState<string | null>(null)
  // The empty slot's menu: pick a shape already in the group, or create one.
  const [maskSlotMenu, setMaskSlotMenu] = useState<{ groupId: string; anchor: DOMRect } | null>(null)
  useEffect(() => {
    if (!maskSlotMenu) return
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') setMaskSlotMenu(null) }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [maskSlotMenu])

  const layerTabActions = useMemo<LayerTabAction[]>(() => {
    if (selectedIds.length === 0) return []
    const roots = selectionRoots(layers, selectedIds)
    const subtree = roots.flatMap(id => subtreeIds(layers, id))
    const groupRoots = roots.filter(id => isGroup(byIdOf(layers, id)))
    const single = selectedIds.length === 1 ? byIdOf(layers, selectedIds[0]) : undefined
    const out: LayerTabAction[] = []
    if (!single) {
      const allVisible = selectedIds.every(id => byIdOf(layers, id)?.visible !== false)
      out.push({
        key: 'visibility', icon: allVisible ? <EyeOff size={14} /> : <Eye size={14} />,
        label: allVisible ? 'Hide the selected layers' : 'Show the selected layers',
        affects: subtree, onClick: toggleSelectedVisibility,
      })
    }
    out.push({
      key: 'duplicate', icon: <Copy size={14} />,
      label: single ? (isGroup(single) ? 'Duplicate group' : 'Duplicate layer') : 'Duplicate the selected layers',
      affects: subtree, onClick: duplicateSelected,
    })
    out.push({
      key: 'delete', icon: <Trash2 size={14} />, tone: 'red',
      label: single ? (isGroup(single) ? 'Delete group and its layers' : 'Delete layer') : 'Delete the selected layers',
      affects: subtree, onClick: deleteSelected,
    })
    if (!single) {
      out.push({ key: 'sep-1', separator: true })
      out.push({
        key: 'group', icon: <GroupIcon size={14} />, label: 'Group the selected layers (Ctrl+G)', tone: 'blue',
        disabled: !groupCheck.ok, reason: groupCheck.reason,
        affects: roots, onClick: groupSelected,
      })
    }
    if (groupRoots.length > 0) {
      if (single) out.push({ key: 'sep-1', separator: true })
      out.push({
        key: 'ungroup', icon: <UngroupIcon size={14} />, tone: 'blue',
        label: groupRoots.length === 1 ? 'Ungroup (Ctrl+Shift+G)' : 'Ungroup the selected groups (Ctrl+Shift+G)',
        affects: groupRoots.flatMap(id => subtreeIds(layers, id)), onClick: ungroupSelected,
      })
    }
    // Mask actions (THU-21, THU-1), amber: they change how every layer in
    // the group renders. Affected rows: the group and everything in it.
    if (single && single.type === 'shape') {
      out.push({ key: 'sep-mask', separator: true })
      if (isMask(single)) {
        out.push({
          key: 'release-mask', icon: <MaskActionIcon badge="release" />, tone: 'amber',
          label: 'Release mask (the shape stays; the group is no longer clipped)',
          affects: [single.parentId!, ...subtreeIds(layers, single.parentId!)], onClick: () => releaseMask(single.id),
        })
      } else {
        if (single.parentId) {
          const check = canBeGroupMask(layers, single.id)
          out.push({
            key: 'use-as-mask', icon: <MaskActionIcon badge="group" />, tone: 'amber',
            label: 'Use as group mask (only its outline clips the group)',
            disabled: !check.ok, reason: check.reason,
            affects: [single.parentId, ...subtreeIds(layers, single.parentId)], onClick: () => useAsGroupMask(single.id),
          })
        }
        // THU-1: mask the layer directly below. Lights that layer (with
        // its members when it is a group) and the shape.
        const belowCheck = canApplyAsMaskBelow(layers, single.id)
        const siblings = childrenOf(layers, single.parentId ?? null)
        const below = siblings[siblings.indexOf(single) - 1]
        out.push({
          key: 'mask-below', icon: <MaskActionIcon badge="below" />, tone: 'amber',
          label: below ? `Apply as mask to the layer below (${below.name})` : 'Apply as mask to the layer below',
          disabled: !belowCheck.ok, reason: belowCheck.reason,
          affects: below ? [single.id, ...subtreeIds(layers, below.id)] : [single.id],
          onClick: () => applyMaskBelow(single.id),
        })
      }
    }
    return out
  }, [layers, selectedIds, groupCheck, toggleSelectedVisibility, duplicateSelected, deleteSelected, groupSelected, ungroupSelected, useAsGroupMask, releaseMask, applyMaskBelow])

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

  const addShapeLayer = useCallback((shapeType: 'rect' | 'ellipse' | 'polygon') => {
    const names = { rect: 'Rectangle', ellipse: 'Ellipse', polygon: 'Polygon' }
    // A new polygon arrives regular (all edges equal): its box takes the
    // natural ratio for its side count instead of a square.
    const box = shapeType === 'polygon' ? regularPolygonBox(POLYGON_DEFAULT_SIDES, 200) : { width: 200, height: 200 }
    const layer: ThumbnailLayer = {
      id: newId(), name: names[shapeType], type: 'shape', shapeType, visible: true, opacity: 100,
      x: Math.round(CANVAS_W / 2 - box.width / 2), y: Math.round(CANVAS_H / 2 - box.height / 2),
      rotation: 0, width: box.width, height: box.height,
      fill: '#6366f1', stroke: '#000000', strokeWidth: 0, cornerRadius: 0,
      ...(shapeType === 'polygon' ? { sides: POLYGON_DEFAULT_SIDES } : {}),
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
      // Range over the rows as displayed (groups expanded or not), so a
      // shift-click selects exactly what sits between the two clicks.
      const display = panelRows(layersRef.current, collapsedGroups).map(r => r.layer)
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
  }, [handleLayerSelect, collapsedGroups])

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

  // ── Stream and episode navigation (THU-19) ────────────────────────────────
  // Same model as the player's Selected Stream block: adjacent streams are
  // neighbors in date order across the whole library (every stream can
  // carry a thumbnail, so nothing is skipped), episodes come from the
  // series helper. Switching streams goes through openStreamEditor, which
  // flushes the current canvas's pending saves first.
  const sortedStreamFolders = useMemo(
    () => [...allStreamFolders].sort((a, b) => a.date.localeCompare(b.date) || a.relativePath.localeCompare(b.relativePath)),
    [allStreamFolders],
  )
  const currentNavFolder = useMemo(() => {
    if (!currentStream) return null
    return sortedStreamFolders.find(f => f.folderPath === currentStream.folderPath && f.date === currentStream.date)
      ?? sortedStreamFolders.find(f => f.folderPath === currentStream.folderPath)
      ?? null
  }, [sortedStreamFolders, currentStream])
  const currentNavIndex = useMemo(
    () => (currentNavFolder ? sortedStreamFolders.indexOf(currentNavFolder) : -1),
    [sortedStreamFolders, currentNavFolder],
  )
  const prevNavStream = currentNavIndex > 0 ? sortedStreamFolders[currentNavIndex - 1] : null
  const nextNavStream = currentNavIndex >= 0 && currentNavIndex < sortedStreamFolders.length - 1 ? sortedStreamFolders[currentNavIndex + 1] : null
  const thumbSeriesNav = useMemo<SeriesNav>(
    () => seriesNavFor(currentNavFolder, sortedStreamFolders),
    [currentNavFolder, sortedStreamFolders],
  )
  const openNeighborStream = useCallback((f: StreamFolder) => {
    // Same resolution as opening from the recents list: live meta and the
    // series length, so merge fields render real values in the new canvas.
    const primaryGame = resolvePrimaryGame(f.meta) || f.detectedGames?.[0] || ''
    const totalEpisodes = f.meta?.isSeries === false
      ? 0
      : detectTotalEpisodes(sortedStreamFolders, primaryGame, f.meta?.ytSeason || '1')
    const title = f.meta?.ytTitle ?? f.meta?.games?.join(', ')
    void openStreamEditor(f.folderPath, f.date, title, f.meta ?? undefined, totalEpisodes)
  }, [openStreamEditor, sortedStreamFolders])
  const navRefs = useRef({ prevNavStream, nextNavStream, thumbSeriesNav, openNeighborStream })
  navRefs.current = { prevNavStream, nextNavStream, thumbSeriesNav, openNeighborStream }

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

  // Keyboard-driven selection (THU-29): select the one layer and expand
  // every group above it in the panel so the row is there to scroll to.
  const selectFromKeyboard = useCallback((id: string) => {
    const above = ancestorIds(layersRef.current, id)
    if (above.length > 0) {
      setCollapsedGroups(prev => {
        if (!above.some(a => prev.has(a))) return prev
        const next = new Set(prev)
        for (const a of above) next.delete(a)
        return next
      })
    }
    panelAnchorIdRef.current = id
    setSelectedIds([id])
  }, [setSelectedIds])

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
        // A selected group copies with its members; a member selected
        // alongside its group is covered by the group. Copied units carry
        // canvas-space positions so they paste where they were seen.
        const copied = copySelection(layers, selectedIds).map(cloneLayer)
        if (copied.length > 0) setClipboardLayers(copied)
      }
      if ((e.ctrlKey || e.metaKey) && k === 'g') {
        e.preventDefault()
        if (e.shiftKey) ungroupSelected()
        else groupSelected()
      }
      if ((e.ctrlKey || e.metaKey) && e.key === 'v') {
        if (clipboardLayers.length > 0) {
          // Mark this Ctrl+V as handled so the native 'paste' event for the
          // same keystroke doesn't also paste an OS-clipboard image. The
          // paste event fires synchronously before this timeout, so the
          // guard sees `true`; the timeout just clears it if no paste follows.
          justPastedLayerRef.current = true
          setTimeout(() => { justPastedLayerRef.current = false }, 0)
          // Fresh ids with inner parent links remapped. The paste lands
          // directly above the topmost selected layer, inside its group when
          // it has one, so it appears where the user is working; with no
          // selection it goes to the top of the stack (THU-24).
          const pasted = clonePasteLayers(clipboardLayers.map(cloneLayer), newId)
          const anchorId = [...layers].reverse().find(l => selectedIds.includes(l.id))?.id ?? null
          const res = insertPastedAbove(layers, pasted, anchorId)
          commitLayers(res.layers)
          setSelectedIds(res.rootIds)
        }
      }
      if (e.key === 'Delete' || e.key === 'Backspace') deleteSelected()
      if (!(e.ctrlKey || e.metaKey) && (e.key === 'g' || e.key === 'G')) setGridSnapEnabled(v => !v)
      // Ctrl+Up/Down walks streams, Ctrl+Shift+Up/Down walks episodes in
      // the series (THU-19), the same keys as the streams page and the
      // player; up is next (newer), down is previous.
      if ((e.ctrlKey || e.metaKey) && !e.altKey && (e.code === 'ArrowUp' || e.code === 'ArrowDown')) {
        e.preventDefault()
        const up = e.code === 'ArrowUp'
        const nav = navRefs.current
        const target = e.shiftKey
          ? (up ? nav.thumbSeriesNav.next : nav.thumbSeriesNav.prev)
          : (up ? nav.nextNavStream : nav.prevNavStream)
        if (target) nav.openNeighborStream(target)
        return
      }
      // Arrow-key nudge: move the selection 1px (10px with Shift). e.code keeps
      // this layout-independent and lets it co-exist with the bracket z-order
      // keys below. preventDefault stops the arrows from scrolling the panels.
      if (!(e.ctrlKey || e.metaKey) && (e.code === 'ArrowUp' || e.code === 'ArrowDown' || e.code === 'ArrowLeft' || e.code === 'ArrowRight')) {
        if (selectedIdsRef.current.length > 0) {
          e.preventDefault()
          const step = e.shiftKey ? 10 : 1
          const dx = e.code === 'ArrowLeft' ? -step : e.code === 'ArrowRight' ? step : 0
          const dy = e.code === 'ArrowUp' ? -step : e.code === 'ArrowDown' ? step : 0
          nudgeSelected(dx, dy)
        }
      }
      // Bracket keys without Ctrl walk the selection (THU-29): ] up, [ down,
      // among the siblings at the current level; Shift jumps to that end;
      // with nothing selected [ takes the top layer and ] the bottom one.
      // Enter steps into the selected group, Shift+Enter back out to it.
      if (!(e.ctrlKey || e.metaKey) && !e.altKey && (e.code === 'BracketRight' || e.code === 'BracketLeft')) {
        e.preventDefault()
        const id = walkSelection(layers, selectedIds, e.code === 'BracketRight' ? 'up' : 'down', e.shiftKey)
        if (id) selectFromKeyboard(id)
        return
      }
      if (e.key === 'Enter' && !(e.ctrlKey || e.metaKey) && !e.altKey) {
        const id = e.shiftKey ? leaveGroup(layers, selectedIds) : enterGroup(layers, selectedIds)
        if (id) {
          e.preventDefault()
          selectFromKeyboard(id)
        }
        return
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
  }, [isVisible, mode, undo, redo, manualSave, setGridSnapEnabled, layers, selectedIds, clipboardLayers, setClipboardLayers, commitLayers, setSelectedIds, moveLayer, nudgeSelected, groupSelected, ungroupSelected, selectFromKeyboard])

  // The layers panel scrolls the selected row into view whenever a single
  // layer becomes selected (keyboard walk, canvas click); a row already in
  // view does not move. Runs after render, so a group expanded in the same
  // keystroke has its rows on screen by then.
  useEffect(() => {
    if (selectedIds.length !== 1 || !layersListRef.current) return
    const row = layersListRef.current.querySelector<HTMLElement>(`[data-layer-id="${CSS.escape(selectedIds[0])}"]`)
    row?.scrollIntoView({ block: 'nearest' })
  }, [selectedIds])

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
      {/* Background re-render service — runs regardless of mode (this page
          is always mounted). Renders on its OWN hidden stage, so an open
          editing session is never disturbed. */}
      <BackgroundRerender request={rerenderRequest} />
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
            onDeleteTemplate={t => { setDeleteTemplateError(null); setConfirmDeleteTemplate(t) }}
            loading={overviewLoading}
          />
          {/* Template picker modal was moved out of this branch so
              it renders in editor mode too — needed for the "+ New
              thumbnail" alternative flow from the variant switcher
              dropdown. See the lifted copy at the end of this
              component's render. */}
          {confirmDeleteTemplate && (
            <Modal
              isOpen
              onClose={() => { if (!deletingTemplate) setConfirmDeleteTemplate(null) }}
              title="Delete template?"
              width="sm"
              dismissible={!deletingTemplate}
              footer={
                <>
                  <Button variant="ghost" size="sm" disabled={deletingTemplate} onClick={() => setConfirmDeleteTemplate(null)}>
                    Cancel
                  </Button>
                  <Button
                    variant="danger"
                    size="sm"
                    loading={deletingTemplate}
                    onClick={async () => {
                      setDeletingTemplate(true)
                      try {
                        await deleteTemplate(confirmDeleteTemplate.id)
                        setConfirmDeleteTemplate(null)
                      } catch (err) {
                        console.error('Failed to delete template', err)
                        setDeleteTemplateError(err instanceof Error ? err.message : String(err))
                      } finally {
                        setDeletingTemplate(false)
                      }
                    }}
                  >
                    Delete template
                  </Button>
                </>
              }
            >
              <p className="text-sm text-gray-300">
                “{confirmDeleteTemplate.name}” will be permanently deleted. Thumbnails already created from it are not affected.
              </p>
              {deleteTemplateError && (
                <p className="text-xs text-red-400 mt-2">Delete failed: {deleteTemplateError}</p>
              )}
            </Modal>
          )}
        </div>
      ) : (
        <>
          {/* Top bar */}
          <div className="flex items-center gap-2 px-3 py-2 border-b border-white/5 shrink-0 bg-navy-800">
            <div className="flex-1 flex items-center gap-2 min-w-0">
              {currentStream ? (
                // Title links back to the stream item (THU-28); the tooltip
                // carries the full title since the toolbar truncates it.
                <Tooltip
                  content={`${currentStreamTitle ?? currentStream.date} · ${currentStream.date}${onNavigateToStream ? ' · Open on the streams page' : ''}`}
                  side="bottom"
                  triggerClassName="block min-w-0 max-w-full"
                >
                  <button
                    type="button"
                    onClick={() => onNavigateToStream?.(currentStream.folderPath)}
                    disabled={!onNavigateToStream}
                    className="block max-w-full truncate text-xs text-left text-gray-400 enabled:hover:text-accent-200 enabled:hover:underline transition-colors"
                  >
                    {currentStreamTitle ?? currentStream.date}
                    <span className="ml-2">{currentStream.date}</span>
                  </button>
                </Tooltip>
              ) : currentTemplateId ? (
                <span className="text-xs text-gray-400 truncate">
                  {templates.find(t => t.id === currentTemplateId)?.name ?? 'Template'}
                  <span className="text-gray-400 ml-1.5">template</span>
                </span>
              ) : (
                <span className="text-xs text-gray-400 italic">Unsaved canvas</span>
              )}
              {isDirty && <span className="w-1.5 h-1.5 rounded-full bg-amber-400 shrink-0" />}
              {/* Stream and episode navigation (THU-19), once the library
                  listing has resolved the open stream. */}
              {currentStream && currentNavFolder && (
                <div className="shrink-0 ml-1">
                  <StreamNavButtons
                    current={currentNavFolder}
                    folders={sortedStreamFolders}
                    prevStream={prevNavStream}
                    nextStream={nextNavStream}
                    onPickStream={openNeighborStream}
                    series={thumbSeriesNav}
                    onPickEpisode={openNeighborStream}
                    variant="toolbar"
                  />
                </div>
              )}
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
                        className="flex items-center gap-2 w-full px-2 py-1.5 text-xs text-left text-accent-300 hover:bg-white/5 transition-colors"
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
                  className={`p-1.5 rounded transition-colors ${smartSnapEnabled ? 'bg-accent-600/30 text-accent-300' : 'hover:bg-white/10 text-gray-400 hover:text-gray-300'}`}
                >
                  <Magnet size={14} />
                </button>
              </Tooltip>
              <Tooltip content={`Grid snap ${gridSnapEnabled ? '(on)' : '(off)'} — snap to ${GRID_SIZE}px grid (G)`} side="bottom">
                <button
                  onClick={() => setGridSnapEnabled(v => !v)}
                  className={`p-1.5 rounded transition-colors ${gridSnapEnabled ? 'bg-accent-600/30 text-accent-300' : 'hover:bg-white/10 text-gray-400 hover:text-gray-300'}`}
                >
                  <Grid3x3 size={14} />
                </button>
              </Tooltip>
              <Tooltip content={`Pixel snap ${pixelSnapEnabled ? '(on)' : '(off)'} — moves and resizes land on whole pixels`} side="bottom">
                <button
                  onClick={togglePixelSnap}
                  className={`p-1.5 rounded transition-colors ${pixelSnapEnabled ? 'bg-accent-600/30 text-accent-300' : 'hover:bg-white/10 text-gray-400 hover:text-gray-300'}`}
                >
                  <SquareDot size={14} />
                </button>
              </Tooltip>
              {/* Alignment and flip tools live in the floating selection
                  panel on the canvas (THU-28), not here. */}
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
                    className="h-6 px-2 rounded-lg bg-navy-900 border border-accent-500/50 text-xs text-gray-200 placeholder-gray-600 outline-none focus:border-accent-400 w-36"
                  />
                  <button
                    onClick={commitSaveTemplate}
                    disabled={!saveTemplateName.trim()}
                    className="p-1 rounded bg-accent-600 hover:bg-accent-500 text-white disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
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

          {/* Editor body. `relative` anchors the layers panel's selection
              tab (THU-30), which hangs off the panel over the canvas. */}
          <div ref={editorBodyRef} className="relative flex flex-1 overflow-hidden min-h-0">
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
              <Tooltip content="Add polygon" side="right">
                <button onClick={() => addShapeLayer('polygon')} className="p-2 rounded hover:bg-white/10 text-gray-400 hover:text-gray-200 transition-colors">
                  <Pentagon size={16} />
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
                <Layer onMouseOver={handleCanvasMouseOver} onMouseOut={handleCanvasMouseOut}>
                  <LayerNodes layers={renderLayers} parentId={null} makeProps={layer => {
                    const nested = !!layer.parentId
                    return {
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
                      nested,
                      // A group member only becomes its own interactive node
                      // once it is selected (panel click or canvas double-click);
                      // otherwise its events belong to the group.
                      inert: nested && !selectedIds.includes(layer.id),
                      // A gesture on something inside this group pauses its
                      // effects (THU-31); moving the group itself does not.
                      effectsPaused: canvasGestureActive && layer.type === 'group'
                        && selectedIds.some(id => id !== layer.id && ancestorIds(layers, id).includes(layer.id)),
                    }
                  }} />
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
                  {/* Hover / group-member bounds (thumbnails #3). Rendered
                      BEFORE the Transformer so the group frame + handles
                      always stay topmost (state d's stacking requirement). */}
                  {boundsOverlays.map(o => (
                    <KonvaGroup key={`bounds-${o.id}`} x={o.x} y={o.y} rotation={o.rotation} listening={false}>
                      <KonvaRect
                        x={o.box.x}
                        y={o.box.y}
                        width={o.box.width}
                        height={o.box.height}
                        stroke={o.kind === 'member' ? SELECTION_STROKE : SELECTION_STROKE_SOFT}
                        strokeWidth={1.5 / viewZoom}
                        dash={o.kind === 'member' ? [6 / viewZoom, 4 / viewZoom] : undefined}
                        listening={false}
                        perfectDrawEnabled={false}
                      />
                    </KonvaGroup>
                  ))}
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
                    onTransformStart={() => {
                      setCanvasGestureActive(true)
                      // Modifiers held before the drag started count too.
                      applyRotationSnaps()
                      // Start the accumulated-angle tracker for the readout
                      // (style guide, "Angle fields"): Konva keeps the node's
                      // rotation wrapped, so full turns are counted here.
                      const first = transformerRef.current?.nodes()[0]
                      rotationTrackRef.current = first ? { last: first.rotation(), accum: first.rotation() } : null
                    }}
                    onTransform={() => {
                      // Live readout (THU-25, THU-26): the primary node's
                      // numbers go to the live-transform store each frame;
                      // the on-canvas readout and the properties panel
                      // subscribe to it, nothing else re-renders. A resize
                      // reports the layer box times Konva's live scale, which
                      // is what release will bake into width and height.
                      const tr = transformerRef.current
                      const stage = stageRef.current
                      if (!tr || !stage) return
                      const node = tr.nodes()[0]
                      if (!node) return
                      const pointer = stage.getPointerPosition()
                      const rotating = tr.getActiveAnchor() === 'rotater'
                      const l = layersRef.current.find(x => x.id === node.id())
                      let width: number | undefined
                      let height: number | undefined
                      // With pixel snap on (THU-27) the readout shows the
                      // size that release will commit, not the raw scale.
                      const pixelSnap = pixelSnapEnabledRef.current
                      const pos = (v: number) => (pixelSnap ? Math.round(v) : v)
                      if (!rotating && l) {
                        const sx = node.scaleX(), sy = node.scaleY()
                        if (l.type === 'text') {
                          const r = node.getClientRect({ skipTransform: true, skipShadow: true, skipStroke: true })
                          width = Math.max(1, pos((l.width ?? r.width) * sx))
                        } else if (l.type === 'group') {
                          const r = node.getClientRect({ skipTransform: true, skipShadow: true, skipStroke: true })
                          width = pos(r.width * sx)
                          height = pos(r.height * sy)
                        } else {
                          const box = snapResizedBox(l, (l.width ?? 0) * sx, (l.height ?? 0) * sy, pixelSnap)
                          width = box.width
                          height = box.height
                        }
                      }
                      // Accumulate the rotation across wraps: Konva hands back
                      // an angle folded into one turn, so the step from one
                      // frame to the next is taken the short way round and
                      // summed, which lets a readout climb past 360.
                      let liveRotation = node.rotation()
                      const track = rotationTrackRef.current
                      if (rotating && track) {
                        let d = liveRotation - track.last
                        if (d > 180) d -= 360
                        if (d < -180) d += 360
                        track.accum += d
                        track.last = liveRotation
                        liveRotation = track.accum
                      }
                      setLiveTransform({
                        kind: rotating ? 'rotate' : 'resize',
                        id: node.id(),
                        x: rotating ? node.x() : pos(node.x()),
                        y: rotating ? node.y() : pos(node.y()),
                        rotation: liveRotation,
                        width,
                        height,
                        pointer,
                      })
                    }}
                    onTransformEnd={() => { setCanvasGestureActive(false); setLiveTransform(null) }}
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

                      // Not a resize (rotation / unknown handle): hand Konva's
                      // box back untouched. It used to go through the per-edge
                      // snapper, which is written for axis-aligned resizes;
                      // fed a rotating box it nudged the box's width or height
                      // whenever an edge crossed a snap stop, so shapes visibly
                      // stretched during a rotation (THU-18 review). Angle
                      // snapping proper is THU-25.
                      if (!dragsLeft && !dragsRight && !dragsTop && !dragsBottom) {
                        return {
                          ...newBox,
                          width: Math.max(10, newBox.width),
                          height: Math.max(10, newBox.height),
                        }
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

              {/* Live readout (THU-25, THU-26): rides beside the pointer for
                  the length of a move, resize, or rotate gesture. Its own
                  component, so the per-frame updates re-render only it.
                  Pointer coords are stage container coords, which is this box. */}
              <TransformHud />

              {/* Selection tools (THU-28): alignment and flip, attached
                  below the selection's bounding box like the player's crop
                  controls. Shown from one selected layer up (align to
                  artboard and flip act on a single layer); the mode toggle
                  is always shown and enabled from two selected layers up;
                  hidden for the length of a canvas gesture. Middle-click pans through it
                  because the pan listener sits on this container. */}
              {selectionAnchor && !canvasGestureActive && !previewMode && (
                <AnchoredPanel
                  anchor={selectionAnchor}
                  boundsW={containerSize.w}
                  boundsH={containerSize.h}
                  gap={12}
                  className="gap-0.5 px-1 py-0.5 border border-white/10"
                >
                  {/* Mode toggle stays visible with one layer selected, lit
                      on artboard and disabled, so the user can see which
                      target the align buttons act on and that only one
                      layer is selected. */}
                  <Tooltip content={selectedIds.length < 2 ? 'Aligning to the artboard (canvas). Select two or more layers to align to a layer instead.' : 'Align to artboard (canvas)'} side="bottom">
                    <button
                      onClick={() => setAlignMode('artboard')}
                      disabled={selectedIds.length < 2}
                      className={`p-1.5 rounded transition-colors disabled:cursor-default ${alignMode === 'artboard' ? 'bg-accent-600/30 text-accent-300' : 'hover:bg-white/10 text-gray-400 hover:text-gray-300'}`}
                    >
                      <Frame size={14} />
                    </button>
                  </Tooltip>
                  <Tooltip content={selectedIds.length < 2 ? 'Align to first selected (needs 2+ layers)' : 'Align to first selected'} side="bottom">
                    <button
                      onClick={() => setAlignMode('selection')}
                      disabled={selectedIds.length < 2}
                      className={`p-1.5 rounded transition-colors disabled:opacity-30 disabled:cursor-not-allowed ${alignMode === 'selection' ? 'bg-accent-600/30 text-accent-300' : 'hover:bg-white/10 text-gray-400 hover:text-gray-300'}`}
                    >
                      <BoxSelect size={14} />
                    </button>
                  </Tooltip>
                  <div className="w-px h-4 bg-white/10 mx-0.5" />
                  {([
                    ['left',     <AlignStartVertical size={14} />,    'Align left edges'],
                    ['h-center', <AlignCenterVertical size={14} />,   'Align horizontal centers'],
                    ['right',    <AlignEndVertical size={14} />,      'Align right edges'],
                    ['top',      <AlignStartHorizontal size={14} />,  'Align top edges'],
                    ['v-center', <AlignCenterHorizontal size={14} />, 'Align vertical centers'],
                    ['bottom',   <AlignEndHorizontal size={14} />,    'Align bottom edges'],
                  ] as const).map(([op, icon, label]) => (
                    <Tooltip key={op} content={selectedIds.length >= 2 && alignMode === 'selection' ? `${label} to the first selected` : `${label} to the artboard`} side="bottom">
                      <button
                        onClick={() => handleAlign(op as AlignOp)}
                        className="p-1.5 rounded hover:bg-white/10 text-gray-400 hover:text-gray-300 transition-colors"
                      >
                        {icon}
                      </button>
                    </Tooltip>
                  ))}
                  <div className="w-px h-4 bg-white/10 mx-0.5" />
                  {/* Flip ops act on every selected layer, one undo entry
                      per click. Lit when every selected layer is flipped. */}
                  {([
                    ['x', <FlipHorizontal2 size={14} />, 'Flip horizontally', (l: ThumbnailLayer) => !!l.flipX],
                    ['y', <FlipVertical2 size={14} />,   'Flip vertically',   (l: ThumbnailLayer) => !!l.flipY],
                  ] as const).map(([axis, icon, label, isLit]) => {
                    const allSelectedAreFlipped = selectedIds.every(id => {
                      const l = layers.find(ll => ll.id === id)
                      return l ? isLit(l) : false
                    })
                    return (
                      <Tooltip key={axis} content={label} side="bottom">
                        <button
                          onClick={() => handleFlip(axis)}
                          className={`p-1.5 rounded transition-colors ${
                            allSelectedAreFlipped
                              ? 'bg-accent-600/30 text-accent-300'
                              : 'hover:bg-white/10 text-gray-400 hover:text-gray-300'
                          }`}
                        >
                          {icon}
                        </button>
                      </Tooltip>
                    )
                  })}
                </AnchoredPanel>
              )}

              {/* Preview mode (thumbnails #8): absolute overlay above the
                  canvas AND the zoom controls (z-20 beats their auto
                  stacking). The stage underneath stays mounted and live so
                  property edits keep re-capturing the snapshot. */}
              {previewMode && (
                <PreviewGallery
                  snapshot={previewSnapshot}
                  title={currentStreamTitle ?? 'Example video title'}
                  channelName={(config.streamerName || '').trim() || 'Your channel'}
                  overlay={previewOverlay}
                  setOverlay={setPreviewOverlay}
                  watched={previewWatched}
                  setWatched={setPreviewWatched}
                  lightBg={previewLightBg}
                  setLightBg={setPreviewLightBg}
                />
              )}

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
                      <Tooltip key={z} content={`Zoom to ${Math.round(z * 100)}%`}>
                      <button
                        onClick={() => setZoomCentered(z)}
                        className={`text-[10px] tabular-nums px-1.5 py-0.5 rounded transition-colors ${
                          active ? 'bg-accent-600/30 text-accent-200' : 'bg-black/50 text-gray-400 hover:text-gray-200'
                        }`}
                      >
                        {Math.round(z * 100)}%
                      </button>
                      </Tooltip>
                    )
                  })}
                  <Tooltip content="Fit the whole artboard in view" shortcut="Double middle-click">
                  <button
                    onClick={() => setZoomCentered(fitScale)}
                    className={`text-[10px] px-1.5 py-0.5 rounded transition-colors ${
                      Math.abs(viewZoom - fitScale) < 0.001 ? 'bg-accent-600/30 text-accent-200' : 'bg-black/50 text-gray-400 hover:text-gray-200'
                    }`}
                  >
                    Fit
                  </button>
                  </Tooltip>
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

            {/* Layers panel selection tab (THU-30): the actions for the
                current selection, centered on the selected rows, with a
                spine along the panel edge spanning them so a range reads as
                one target. Tooltips open to the left, over the canvas. */}
            {layerTabShown && layerTabActions.length > 0 && (
              <>
              <div
                ref={layerTabRef}
                className="absolute z-20 border border-white/10 border-r-0 bg-navy-800 shadow-lg overflow-hidden"
                style={{
                  top: layerTabPos?.top ?? 0,
                  right: layerTabPos?.right ?? 0,
                  borderRadius: `8px ${layerTabPos?.radiusTR ?? 8}px ${layerTabPos?.radiusBR ?? 8}px 8px`,
                  visibility: layerTabPos ? 'visible' : 'hidden',
                }}
              >
              {/* Inner tint matches a selected row (accent over the panel
                  background) so the tab reads as the selection's own. */}
              <div className="flex flex-col gap-0.5 p-1 bg-accent-600/15">
                {/* Selection count, multi-selections only: a quiet check
                    that the actions below apply to what the user thinks
                    they do. A group counts as one, as it does in the panel. */}
                {selectedIds.length > 1 && (
                  <>
                    <Tooltip content={`${selectedIds.length} layers selected`} side="left" triggerClassName="block w-full">
                      <div className="w-full text-[10px] leading-none tabular-nums text-center text-gray-400 pt-0.5 pb-1 select-none" aria-label={`${selectedIds.length} selected`}>
                        {selectedIds.length}
                      </div>
                    </Tooltip>
                    <div className="h-px bg-white/10 mb-0.5" />
                  </>
                )}
                {layerTabActions.map(a => a.separator ? (
                  <div key={a.key} className="h-px bg-white/10 my-0.5" />
                ) : (
                  <Tooltip key={a.key} content={a.disabled ? (a.reason ?? a.label ?? '') : (a.label ?? '')} side="left">
                    <button
                      type="button"
                      onClick={() => { if (!a.disabled) a.onClick?.() }}
                      disabled={a.disabled}
                      onMouseEnter={() => setHighlighted({ ids: new Set(a.affects ?? []), tone: a.tone ?? 'accent' })}
                      onMouseLeave={() => setHighlighted(NO_HIGHLIGHT)}
                      aria-label={a.label}
                      className={`p-1.5 rounded transition-colors disabled:opacity-30 disabled:cursor-not-allowed ${LAYER_TAB_BUTTON_TONE[a.tone ?? 'accent']}`}
                    >
                      {a.icon}
                    </button>
                  </Tooltip>
                ))}
              </div>
              </div>
              {/* Spine: same face as the tab, painted after it so it covers
                  the tab's edge lines where the two overlap. Its outer
                  corners are rounded; the panel side stays flush. */}
              {layerTabPos && layerTabPos.spineHeight > 0 && (
                <div
                  className="absolute z-20 w-1 bg-navy-800 pointer-events-none overflow-hidden"
                  style={{ top: layerTabPos.spineTop, height: layerTabPos.spineHeight, right: layerTabPos.right, borderRadius: `${layerTabPos.spineRadiusTop}px 0 0 ${layerTabPos.spineRadiusBottom}px` }}
                >
                  <div className="absolute inset-0 bg-accent-600/15" />
                </div>
              )}
              {/* Concave joins where the spine runs past the tab: a square
                  of the tab's face outside each such corner, with a quarter
                  circle cut from its outer corner by a radial mask. Each
                  overlaps the tab by a pixel to cover the border segment it
                  meets. No hairline along the arc: a gradient ring rendered
                  lighter than the real border. */}
              {layerTabPos && ([
                ['top', layerTabPos.filletTop],
                ['bottom', layerTabPos.filletBottom],
              ] as const).map(([edge, f]) => f <= 0 ? null : (
                <div
                  key={edge}
                  className="absolute z-20 bg-navy-800 pointer-events-none"
                  style={{
                    right: layerTabPos.right + 4,
                    width: f,
                    height: f + 1,
                    top: edge === 'top' ? layerTabPos.top - f : layerTabPos.top + layerTabPos.tabHeight - 1,
                    WebkitMaskImage: `radial-gradient(circle at ${edge} left, transparent ${f}px, black ${f}px)`,
                    maskImage: `radial-gradient(circle at ${edge} left, transparent ${f}px, black ${f}px)`,
                  }}
                >
                  <div className="absolute inset-0 bg-accent-600/15" />
                </div>
              ))}
              </>
            )}

            {/* Empty mask slot menu (THU-21): portal-rendered so the
                scrolling layers list cannot clip it. Hovering a shape
                lights its row in amber, as the tab's mask actions do. */}
            {maskSlotMenu && (() => {
              const { groupId, anchor } = maskSlotMenu
              const shapes = childrenOf(layers, groupId).filter(l => l.type === 'shape')
              const dropUp = anchor.bottom > window.innerHeight - 240
              const style: React.CSSProperties = dropUp
                ? { position: 'fixed', bottom: window.innerHeight - anchor.top + 4, right: Math.max(8, window.innerWidth - anchor.right), zIndex: 61 }
                : { position: 'fixed', top: anchor.bottom + 4, right: Math.max(8, window.innerWidth - anchor.right), zIndex: 61 }
              const close = () => { setMaskSlotMenu(null); setHighlighted(NO_HIGHLIGHT) }
              // A pick from a collapsed group's row expands the group so the
              // new mask row is on screen.
              const expandGroup = () => setCollapsedGroups(prev => {
                if (!prev.has(groupId)) return prev
                const next = new Set(prev)
                next.delete(groupId)
                return next
              })
              const item = 'flex items-center gap-2 w-full px-3 py-1.5 text-xs text-left text-gray-300 hover:bg-white/5 transition-colors'
              return createPortal(
                <>
                  <div className="fixed inset-0 z-[60]" onClick={close} />
                  <div style={style} className="w-60 bg-navy-700 border border-white/10 rounded-lg shadow-xl py-1">
                    {shapes.length > 0 && (
                      <>
                        <div className="px-3 pt-1 pb-0.5 text-[10px] uppercase tracking-wider text-gray-400">Use a shape in this group</div>
                        {shapes.map(s => (
                          <button
                            key={s.id}
                            type="button"
                            className={item}
                            onMouseEnter={() => setHighlighted({ ids: new Set([s.id]), tone: 'amber' })}
                            onMouseLeave={() => setHighlighted(NO_HIGHLIGHT)}
                            onClick={() => { useAsGroupMask(s.id); expandGroup(); close() }}
                          >
                            {s.shapeType === 'ellipse' ? <Circle size={12} className="shrink-0 text-gray-400" /> : s.shapeType === 'polygon' ? <Pentagon size={12} className="shrink-0 text-gray-400" /> : <Square size={12} className="shrink-0 text-gray-400" />}
                            <span className="truncate">{s.name}</span>
                          </button>
                        ))}
                        <div className="my-1 border-t border-white/5" />
                      </>
                    )}
                    <div className="px-3 pt-1 pb-0.5 text-[10px] uppercase tracking-wider text-gray-400">New mask, fitted to the group</div>
                    {([
                      ['rect', 'Rectangle', <Square size={12} className="shrink-0 text-gray-400" />],
                      ['ellipse', 'Ellipse', <Circle size={12} className="shrink-0 text-gray-400" />],
                      ['polygon', 'Polygon', <Pentagon size={12} className="shrink-0 text-gray-400" />],
                    ] as const).map(([type, label, icon]) => (
                      <button key={type} type="button" className={item} onClick={() => { addGroupMask(groupId, type); expandGroup(); close() }}>
                        {icon}
                        <span>{label}</span>
                      </button>
                    ))}
                  </div>
                </>,
                document.body,
              )
            })()}

            {/* Right panel: Layers + Assets + Properties */}
            <div ref={rightPanelRef} className="w-64 flex flex-col border-l border-white/5 bg-navy-800 shrink-0 overflow-hidden">
              {/* Layers — collapsible like every sidebar panel (UI-polish
                  batch). The Edit/Preview toggle stays visible while
                  collapsed: it switches the whole editor's mode, not panel
                  content, so hiding it with the layer list would strand
                  preview mode. */}
              <div className="flex flex-col" style={{ minHeight: 0, flex: '0 0 auto', maxHeight: '30%' }}>
                {/* border-b always present (transparent when collapsed): the
                    border participates in the h-8 border-box, so toggling it
                    off grew the h-full chevron by 1px and shifted the row. */}
                <div className={`flex items-center gap-1.5 px-3 h-8 shrink-0 border-b ${!layersCollapsed ? 'border-white/5' : 'border-transparent'}`}>
                  <Tooltip
                    content={layersCollapsed ? 'Expand layers panel' : 'Collapse layers panel'}
                    triggerClassName="self-stretch -ml-3 flex"
                  >
                    <button
                      type="button"
                      onClick={toggleLayersCollapsed}
                      className="h-full aspect-square flex items-center justify-center text-gray-400 hover:text-gray-200 hover:bg-white/5 transition-colors"
                    >
                      {layersCollapsed ? <ChevronRight size={14} /> : <ChevronDown size={14} />}
                    </button>
                  </Tooltip>
                  <LayersIcon size={11} className="text-gray-400" />
                  <span className="text-[10px] uppercase tracking-wider text-gray-400 font-semibold">Layers</span>
                  <div className="ml-auto flex items-center gap-2">
                    {/* Edit/Preview toggle (thumbnails #8) — Preview swaps the
                        canvas viewport for YouTube-surface mockups; the
                        sidebar stays live so properties can be tweaked while
                        watching the mockups update. */}
                    <div className="flex bg-navy-900 border border-white/10 rounded-md overflow-hidden">
                      <Tooltip content="Edit the canvas">
                        <button
                          className={`px-1.5 py-0.5 text-[10px] transition-colors ${!previewMode ? 'bg-accent-600/25 text-accent-200' : 'text-gray-400 hover:text-gray-200 hover:bg-white/5'}`}
                          onClick={() => setPreviewMode(false)}
                        >
                          Edit
                        </button>
                      </Tooltip>
                      <Tooltip content="Preview how this thumbnail looks on YouTube — real sizes, badges, light/dark theme">
                        <button
                          className={`px-1.5 py-0.5 text-[10px] transition-colors ${previewMode ? 'bg-accent-600/25 text-accent-200' : 'text-gray-400 hover:text-gray-200 hover:bg-white/5'}`}
                          onClick={() => setPreviewMode(true)}
                        >
                          Preview
                        </button>
                      </Tooltip>
                    </div>
                    {/* Group, ungroup, duplicate, and delete live in the
                        selection tab beside the selected rows (THU-30). */}
                    <span className="text-[10px] text-gray-400">{layers.filter(l => !isGroup(l)).length}</span>
                  </div>
                </div>
                {/* `hidden` (not unmount) so drag/rename state survives a
                    collapse round-trip, matching the assets panel. */}
                <div ref={layersListRef} className={`overflow-y-auto flex-1${layersCollapsed ? ' hidden' : ''}`}>
                  {(() => {
                    const rows = panelRows(layers, collapsedGroups)
                    const indent = (depth: number) => 8 + depth * 14
                    // Where a drop between rows lands in the tree (THU-18).
                    // "Above row" = directly above that row in its parent.
                    // "Below row" = above the next sibling, or the bottom of
                    // the parent when the row is its last member, or the top
                    // slot inside the row when it is an expanded group.
                    const dropFor = (rowIdx: number, aboveRow: boolean) => {
                      const row: PanelRow = rows[rowIdx]
                      // Nothing lands above a mask (it is pinned to the top of
                      // its group), so the upper half of a mask row targets the
                      // slot below it, where the drop actually lands.
                      const above = aboveRow && !isMask(row.layer)
                      if (above) return { gapIdx: rowIdx, depth: row.depth, parentId: row.parentId, afterId: row.layer.id }
                      if (isGroup(row.layer) && !collapsedGroups.has(row.layer.id)) {
                        const kids = childrenOf(layers, row.layer.id)
                        return { gapIdx: rowIdx + 1, depth: row.depth + 1, parentId: row.layer.id, afterId: kids.length ? kids[kids.length - 1].id : null }
                      }
                      const nextRow = rows[rowIdx + 1]
                      if (nextRow && nextRow.parentId === row.parentId) return { gapIdx: rowIdx + 1, depth: row.depth, parentId: row.parentId, afterId: nextRow.layer.id }
                      return { gapIdx: rowIdx + 1, depth: row.depth, parentId: row.parentId, afterId: null }
                    }
                    const indicator = (depth: number) => (
                      <div className="h-0.5 bg-accent-500" style={{ marginLeft: indent(depth) }} />
                    )
                    return (
                      <>
                        {rows.map((row, rowIdx) => {
                          const { layer, depth } = row
                          const isSelected = selectedIds.includes(layer.id)
                          const isRenaming = renamingLayerId === layer.id
                          const isDragging = draggingLayerId === layer.id
                          const group = isGroup(layer)
                          const collapsed = collapsedGroups.has(layer.id)
                          // Members of a hidden group read as hidden too.
                          const dimmed = !layer.visible || hasHiddenAncestor(layers, layer.id)
                          const isHovered = hoveredLayerId === layer.id
                          const isAffected = highlighted.ids.has(layer.id)
                          // Group masks (THU-21): the mask row carries its
                          // icon; a group row knows its mask for the slot
                          // row under it and the collapsed-row indicator.
                          const rowIsMask = isMask(layer)
                          const groupMask = group ? maskOf(layers, layer.id) : undefined
                          // Name brightness climbs with the row tone so the
                          // brighter backgrounds keep their contrast.
                          const nameTone = dimmed
                            ? (isAffected ? 'text-gray-400' : 'text-gray-500')
                            : isAffected ? 'text-gray-100'
                            : isSelected ? 'text-gray-200'
                            : isHovered ? 'text-gray-300'
                            : group ? 'text-gray-300'
                            : 'text-gray-400'
                          return (
                            <React.Fragment key={layer.id}>
                              {panelDrop?.gapIdx === rowIdx && indicator(panelDrop.depth)}
                              <div
                                data-layer-id={layer.id}
                                draggable={!isRenaming && !rowIsMask}
                                onDragStart={e => {
                                  setDraggingLayerId(layer.id)
                                  e.dataTransfer.effectAllowed = 'move'
                                  // Required for drag to work in some browsers; the
                                  // payload is unused since we track via state.
                                  e.dataTransfer.setData('text/plain', layer.id)
                                }}
                                onDragOver={e => {
                                  if (!draggingLayerId || draggingLayerId === layer.id) return
                                  const rect = e.currentTarget.getBoundingClientRect()
                                  const above = e.clientY < rect.top + rect.height / 2
                                  const target = dropFor(rowIdx, above)
                                  // A drop the tree refuses (into its own subtree,
                                  // past the nesting limit, a pinned mask) or one
                                  // that would change nothing gets neither the
                                  // indicator nor the move cursor: without
                                  // preventDefault the browser shows not-allowed,
                                  // which is the truth.
                                  const valid = moveLayerTo(layers, draggingLayerId, target.parentId, target.afterId) !== null
                                  if (!valid) { setPanelDrop(null); setSlotDrop(null); return }
                                  e.preventDefault()
                                  e.dataTransfer.dropEffect = 'move'
                                  setPanelDrop(target)
                                  setSlotDrop(null)
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
                                  if (draggingLayerId && panelDrop) {
                                    const next = moveLayerTo(layers, draggingLayerId, panelDrop.parentId, panelDrop.afterId)
                                    if (next) commitLayers(next)
                                  }
                                  setDraggingLayerId(null)
                                  setPanelDrop(null)
                                }}
                                onDragEnd={() => {
                                  setDraggingLayerId(null)
                                  setPanelDrop(null)
                                  setSlotDrop(null)
                                }}
                                onClick={e => { if (!isRenaming) handleLayerRowClick(layer.id, e) }}
                                // Bidirectional hover sync with the canvas
                                // (thumbnails #3): row hover outlines the canvas
                                // element; canvas hover highlights this row via
                                // the same shared hoveredLayerId.
                                onMouseEnter={() => setHoveredLayerId(layer.id)}
                                onMouseLeave={() => setHoveredLayerId(null)}
                                // Row tone ladder (THU-30 review), one accent
                                // hue at rising opacity so the steps read as
                                // brightness: hovered, selected, selected and
                                // hovered, then affected by a hovered tab
                                // button, which also gets the right-edge bar
                                // the streams page and launcher use. Hover is
                                // driven by hoveredLayerId (set on mouse enter)
                                // rather than a CSS hover so the states compose.
                                className={`relative flex items-center gap-1.5 pr-2 py-1.5 ${isRenaming ? '' : 'cursor-pointer'} group border-b border-white/5 transition-colors ${
                                  isAffected ? `${LAYER_ROW_AFFECTED_TONE[highlighted.tone]} after:content-[""] after:absolute after:inset-y-0 after:right-0 after:w-0.5`
                                    : isSelected && isHovered ? 'bg-accent-600/[0.22]'
                                    : isSelected ? 'bg-accent-600/15'
                                    : isHovered ? 'bg-accent-600/[0.08]'
                                    : group ? 'bg-white/[0.03]'
                                    : ''
                                } ${isDragging ? 'opacity-40' : ''}`}
                                style={{ paddingLeft: indent(depth) }}
                              >
                                {/* Group rails (THU-21 review): a 2 px line
                                    under each enclosing group's eye runs
                                    alongside its members, first to last, so
                                    the block reads as bracketed rather than
                                    merely indented. The group row itself
                                    carries none, so the rail never touches
                                    an icon. */}
                                {Array.from({ length: depth }, (_, d) => (
                                  <span key={d} aria-hidden className="absolute inset-y-0 w-0.5 bg-white/15 pointer-events-none" style={{ left: indent(d) + 5 }} />
                                ))}
                                <Tooltip content={layer.visible ? (group ? 'Hide group' : 'Hide layer') : (group ? 'Show group' : 'Show layer')} side="top">
                                  <button
                                    onClick={e => { e.stopPropagation(); updateLayer({ ...layer, visible: !layer.visible }) }}
                                    className="text-gray-400 hover:text-gray-300 shrink-0"
                                  >
                                    {layer.visible ? <Eye size={12} /> : <EyeOff size={12} className="text-gray-400" />}
                                  </button>
                                </Tooltip>
                                {/* The folder is the collapse toggle (no
                                    chevron), so a group's eye lines up with
                                    its siblings' and the open or closed
                                    folder shows the state. */}
                                {group && (
                                  <Tooltip content={collapsed ? 'Expand group' : 'Collapse group'} side="top" triggerClassName="shrink-0 flex">
                                    <button
                                      type="button"
                                      onClick={e => { e.stopPropagation(); toggleGroupCollapsed(layer.id) }}
                                      className="text-gray-400 hover:text-gray-200 transition-colors"
                                      aria-label={collapsed ? 'Expand group' : 'Collapse group'}
                                    >
                                      {collapsed ? <Folder size={12} /> : <FolderOpen size={12} />}
                                    </button>
                                  </Tooltip>
                                )}
                                {rowIsMask && (
                                  <Tooltip content="Group mask: its outline clips the group. Hide it to switch the mask off; release it from the selection tab." side="top" triggerClassName="shrink-0 flex">
                                    <Blend size={11} className="text-amber-300/80" />
                                  </Tooltip>
                                )}
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
                                className="flex-1 min-w-0 bg-navy-900 border border-accent-500/60 rounded px-1.5 py-0 text-xs text-gray-200 focus:outline-none"
                              />
                            ) : (
                              <span
                                onDoubleClick={e => { e.stopPropagation(); setRenamingLayerId(layer.id) }}
                                className={`flex-1 text-xs truncate cursor-text ${nameTone} ${group ? 'font-medium' : ''}`}
                              >
                                {layer.name}
                              </span>
                            )}
                            {layer.type === 'text' && fontsLoaded && !installedFontSet.has(layer.fontFamily ?? 'Arial') && (
                              <Tooltip content={`Font "${layer.fontFamily ?? 'Arial'}" is not installed`}>
                                <AlertTriangle size={11} className="text-amber-400 shrink-0" />
                              </Tooltip>
                            )}
                            {/* Collapsed group: the mask slot shows on the
                                row's right instead of under it. */}
                            {group && collapsed && (groupMask ? (
                              <Tooltip content={`Mask: ${groupMask.name}. Click to select it.`} side="top" triggerClassName="shrink-0 flex items-center min-w-0 max-w-[88px]">
                                <button
                                  type="button"
                                  onClick={e => { e.stopPropagation(); selectFromKeyboard(groupMask.id) }}
                                  className="flex items-center gap-1 min-w-0 text-[10px] text-amber-300/70 hover:text-amber-200 transition-colors"
                                >
                                  <Blend size={10} className="shrink-0" />
                                  <span className="truncate">{groupMask.name}</span>
                                </button>
                              </Tooltip>
                            ) : (
                              <Tooltip content="No mask. Click to add one, or drop a shape here." side="top" triggerClassName="shrink-0 flex">
                                <button
                                  type="button"
                                  onClick={e => { e.stopPropagation(); setMaskSlotMenu({ groupId: layer.id, anchor: e.currentTarget.getBoundingClientRect() }) }}
                                  // Same drop target as the expanded slot row:
                                  // a shape dropped here becomes the mask and
                                  // the group expands to show it. The row's own
                                  // drag handlers must not see these events, or
                                  // the row would draw its landing indicator too.
                                  // dragenter is cancelled as well as dragover:
                                  // an uncancelled dragenter on the icon's SVG
                                  // child makes the browser treat the body as
                                  // the target for a frame, which flashed the
                                  // not-allowed cursor while the pointer moved
                                  // over the icon.
                                  onDragEnter={e => {
                                    e.stopPropagation()
                                    const d = draggingLayerId ? layers.find(l => l.id === draggingLayerId) : undefined
                                    if (d && d.type === 'shape' && !isMask(d)) e.preventDefault()
                                  }}
                                  onDragOver={e => {
                                    e.stopPropagation()
                                    if (!draggingLayerId) return
                                    const d = layers.find(l => l.id === draggingLayerId)
                                    const ok = !!d && d.type === 'shape' && !isMask(d)
                                    if (!ok) { setPanelDrop(null); setSlotDrop(null); return }
                                    e.preventDefault()
                                    e.dataTransfer.dropEffect = 'move'
                                    setPanelDrop(null)
                                    setSlotDrop(layer.id)
                                  }}
                                  onDragLeave={e => {
                                    e.stopPropagation()
                                    const related = e.relatedTarget as Node | null
                                    if (related && e.currentTarget.contains(related)) return
                                    setSlotDrop(prev => (prev === layer.id ? null : prev))
                                  }}
                                  onDrop={e => {
                                    e.preventDefault()
                                    e.stopPropagation()
                                    if (draggingLayerId && slotDrop === layer.id) {
                                      dropShapeIntoSlot(draggingLayerId, layer.id)
                                      toggleGroupCollapsed(layer.id)
                                    }
                                    setDraggingLayerId(null)
                                    setPanelDrop(null)
                                    setSlotDrop(null)
                                  }}
                                  className={`rounded p-0.5 -m-0.5 transition-colors ${
                                    slotDrop === layer.id ? 'bg-amber-600/40 text-amber-100'
                                      : maskSlotMenu?.groupId === layer.id ? 'text-gray-200'
                                      : 'text-gray-600 hover:text-gray-300'
                                  }`}
                                  aria-label="Add a mask"
                                >
                                  <Blend size={10} className="pointer-events-none" />
                                </button>
                              </Tooltip>
                            ))}
                            {/* Duplicate and delete moved to the selection
                                tab (THU-30); the row keeps the eye and the
                                name so indented names have the room. */}
                          </div>
                          {/* Mask slot (THU-21): every expanded group shows
                              its slot under its row. Filled, the mask's own
                              row is the slot (it is the group's topmost
                              member, so it lands here). Empty, this row
                              opens the add-mask menu. */}
                          {group && !collapsed && !groupMask && (
                            <Tooltip content="Add a mask: use a shape already in this group, or create one fitted to the group. Only the shape's outline clips." side="top" triggerClassName="block">
                              <div
                                role="button"
                                tabIndex={0}
                                onClick={e => setMaskSlotMenu({ groupId: layer.id, anchor: e.currentTarget.getBoundingClientRect() })}
                                onKeyDown={e => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); setMaskSlotMenu({ groupId: layer.id, anchor: e.currentTarget.getBoundingClientRect() }) } }}
                                // Drop target: a dragged shape can be dropped
                                // straight into the slot (it moves into the group
                                // and becomes its mask); the slot lights amber.
                                // Anything else gets the not-allowed cursor and
                                // no indicator anywhere.
                                onDragEnter={e => {
                                  const d = draggingLayerId ? layers.find(l => l.id === draggingLayerId) : undefined
                                  if (d && d.type === 'shape' && !isMask(d)) e.preventDefault()
                                }}
                                onDragOver={e => {
                                  if (!draggingLayerId) return
                                  const d = layers.find(l => l.id === draggingLayerId)
                                  const ok = !!d && d.type === 'shape' && !isMask(d)
                                  if (!ok) { setPanelDrop(null); setSlotDrop(null); return }
                                  e.preventDefault()
                                  e.dataTransfer.dropEffect = 'move'
                                  setPanelDrop(null)
                                  setSlotDrop(layer.id)
                                }}
                                onDragLeave={e => {
                                  const related = e.relatedTarget as Node | null
                                  if (related && e.currentTarget.contains(related)) return
                                  setSlotDrop(prev => (prev === layer.id ? null : prev))
                                }}
                                onDrop={e => {
                                  e.preventDefault()
                                  if (draggingLayerId && slotDrop === layer.id) dropShapeIntoSlot(draggingLayerId, layer.id)
                                  setDraggingLayerId(null)
                                  setPanelDrop(null)
                                  setSlotDrop(null)
                                }}
                                className={`relative flex items-center gap-1.5 pr-2 py-1 border-b border-white/5 cursor-pointer transition-colors ${
                                  slotDrop === layer.id ? 'bg-amber-600/30 text-amber-100'
                                    : maskSlotMenu?.groupId === layer.id ? 'bg-white/10 text-gray-300'
                                    : 'text-gray-500 hover:text-gray-300 hover:bg-white/5'
                                }`}
                                style={{ paddingLeft: indent(depth + 1) }}
                              >
                                {Array.from({ length: depth + 1 }, (_, d) => (
                                  <span key={d} aria-hidden className="absolute inset-y-0 w-0.5 bg-white/15 pointer-events-none" style={{ left: indent(d) + 5 }} />
                                ))}
                                <Blend size={11} className="shrink-0 opacity-70" />
                                <span className="text-[11px] italic">No mask</span>
                                <span className="ml-auto text-[10px] uppercase tracking-wider">Add</span>
                              </div>
                            </Tooltip>
                          )}
                        </React.Fragment>
                      )
                    })}
                        {panelDrop?.gapIdx === rows.length && indicator(panelDrop.depth)}
                      </>
                    )
                  })()}
                </div>
              </div>

              {/* Divider */}
              <div className="border-t border-white/10 shrink-0" />

              {/* Palette — global color swatches (thumbnails #1, phase 2):
                  recents row (dashed tiles, click = add to palette), palette
                  tiles (drag onto a color field to apply, hover × removes),
                  + button adds via the native picker. Section border-b
                  doubles as the divider between palette and properties. */}
              <div className="flex flex-col shrink-0 border-b border-white/10">
                <div className={`flex items-center gap-1.5 px-3 h-8 shrink-0 border-b ${!paletteCollapsed ? 'border-white/5' : 'border-transparent'}`}>
                  <Tooltip
                    content={paletteCollapsed ? 'Expand palette' : 'Collapse palette'}
                    triggerClassName="self-stretch -ml-3 flex"
                  >
                    <button
                      type="button"
                      onClick={togglePaletteCollapsed}
                      className="h-full aspect-square flex items-center justify-center text-gray-400 hover:text-gray-200 hover:bg-white/5 transition-colors"
                    >
                      {paletteCollapsed ? <ChevronRight size={14} /> : <ChevronDown size={14} />}
                    </button>
                  </Tooltip>
                  <Palette size={11} className="text-gray-400" />
                  <span className="text-[10px] uppercase tracking-wider text-gray-400 font-semibold">Palette</span>
                  <div className={`ml-auto flex items-center gap-0.5${paletteCollapsed ? ' hidden' : ''}`}>
                    <Tooltip content={paletteEditMode ? 'Done editing' : 'Edit palette — click swatches to remove them'}>
                      {/* Edit mode reads as a MODE now (thumbnails #14):
                          amber-lit pencil + a matching ring around the
                          panel body below — the old subtle bg-white/10
                          active state made the grayed recents list look
                          disabled rather than in-edit. */}
                      {/* Chrome matches the assets panel's options button
                          (panel-header icon-button convention); the active
                          state keeps its amber mode signal. */}
                      <button
                        type="button"
                        onClick={() => setPaletteEditMode(m => !m)}
                        className={`p-1 rounded-md border flex items-center justify-center transition-colors ${paletteEditMode ? 'bg-amber-500/20 border-amber-400/50 text-amber-300' : 'bg-navy-900 border-white/10 text-gray-400 hover:text-gray-200 hover:border-white/25 hover:bg-white/5'}`}
                      >
                        <Pencil size={13} />
                      </button>
                    </Tooltip>
                    <Tooltip content="Add a color to the palette">
                      <button
                        type="button"
                        onClick={() => paletteAddInputRef.current?.click()}
                        className="p-1 rounded-md border bg-navy-900 border-white/10 flex items-center justify-center text-gray-400 hover:text-gray-200 hover:border-white/25 hover:bg-white/5 transition-colors"
                      >
                        <Plus size={13} />
                      </button>
                    </Tooltip>
                    <input ref={paletteAddInputRef} type="color" className="sr-only" tabIndex={-1} aria-hidden />
                  </div>
                </div>
                {!paletteCollapsed && (
                  // Edit-mode outline: ring-inset (not border) so nothing
                  // shifts, square corners to match the panel's geometry,
                  // and the ringed box is inset a uniform 2px on ALL sides
                  // via margin, with padding trades keeping the content
                  // position identical (m-0.5+px-2.5 = px-3, m-0.5+py-1.5
                  // = py-2). 4px read too snug against the swatch rows;
                  // fully flush was ruled out (the ring's left pixel gets
                  // cropped by the window edge).
                  <div className={`flex flex-col gap-2 ${paletteEditMode ? 'm-0.5 px-2.5 py-1.5 ring-1 ring-inset ring-amber-400/40' : 'px-3 py-2'}`}>
                    {/* Edit-mode toolbar: selection count + delete, reset,
                        export, import. Deletion moved here from per-swatch
                        buttons when multi-select arrived. */}
                    {paletteEditMode && palette !== null && (
                      <div className="flex items-center gap-0.5">
                        <span className="text-[10px] text-gray-400 mr-auto">
                          {selectedSwatches.size > 0 ? `${selectedSwatches.size} selected` : 'Click to select'}
                        </span>
                        <Tooltip content={selectedSwatches.size > 0 ? `Delete ${selectedSwatches.size} selected swatch${selectedSwatches.size === 1 ? '' : 'es'}` : 'Delete selected — select swatches first'}>
                          <button
                            type="button"
                            onClick={deleteSelectedSwatches}
                            disabled={selectedSwatches.size === 0}
                            className={`p-1 rounded transition-colors ${selectedSwatches.size > 0 ? 'text-gray-400 hover:text-red-400 hover:bg-red-500/10' : 'text-gray-600 cursor-default'}`}
                          >
                            <Trash2 size={12} />
                          </button>
                        </Tooltip>
                        <Tooltip content="Reset to the default palette">
                          <button type="button" onClick={() => setConfirmPaletteReset(true)} className="p-1 rounded text-gray-400 hover:text-gray-200 hover:bg-white/5 transition-colors">
                            <RotateCcw size={12} />
                          </button>
                        </Tooltip>
                        {/* Icon semantics (deliberate): the tray is the APP — arrow
                            up/out of it = export, arrow down/into it =
                            import. (The web convention is the reverse;
                            deliberate choice for a local desktop app.) */}
                        <Tooltip content="Export the palette to a .json file">
                          <button type="button" onClick={() => void exportPalette()} className="p-1 rounded text-gray-400 hover:text-gray-200 hover:bg-white/5 transition-colors">
                            <Upload size={12} />
                          </button>
                        </Tooltip>
                        <Tooltip content="Import colors from a palette .json — adds missing colors, never removes">
                          <button type="button" onClick={() => void importPalette()} className="p-1 rounded text-gray-400 hover:text-gray-200 hover:bg-white/5 transition-colors">
                            <Download size={12} />
                          </button>
                        </Tooltip>
                      </div>
                    )}
                    {palette === null ? (
                      <div className="flex items-center gap-1.5 text-[10px] text-gray-400">
                        <Loader2 size={11} className="animate-spin" /> Loading palette…
                      </div>
                    ) : palette.length === 0 ? (
                      <p
                        className={`text-[10px] text-gray-400 rounded ${swatchDropIndex !== null ? 'ring-1 ring-accent-500/60' : ''}`}
                        // An empty palette takes a recent tile too (THU-10).
                        onDragEnter={e => { if (e.dataTransfer.types.includes(RECENT_DRAG_MIME)) e.preventDefault() }}
                        onDragOver={e => {
                          if (!e.dataTransfer.types.includes(RECENT_DRAG_MIME)) return
                          e.preventDefault()
                          e.dataTransfer.dropEffect = 'copy'
                          if (swatchDropIndex !== 0) setSwatchDropIndex(0)
                        }}
                        onDragLeave={() => setSwatchDropIndex(null)}
                        onDrop={e => {
                          if (!e.dataTransfer.types.includes(RECENT_DRAG_MIME)) return
                          e.preventDefault()
                          const v = readDraggedSwatch(e.dataTransfer)
                          if (v) insertPaletteSwatch(v, 0)
                        }}
                      >
                        Palette is empty: add colors with +, or click or drag a recent color below.
                      </p>
                    ) : (
                      <div
                        className="flex flex-wrap gap-1.5"
                        // The gaps BETWEEN tiles belong to this container, not
                        // to any tile — without these handlers the browser
                        // shows the no-drop cursor exactly where the insertion
                        // marker is drawn. Tiles preventDefault first and
                        // bubble up, so `defaultPrevented` distinguishes
                        // "over a tile" (tile already handled it — keep out so
                        // we don't recompute or double-commit) from "over a
                        // gap" (accept the drop at the marker's index).
                        // dragENTER must be canceled too: it's what formally
                        // marks an element as a drop target, and without it
                        // the cursor flashes no-drop each time the pointer
                        // crosses into a new element, until the first
                        // dragover lands.
                        // Two drags land here: edit-mode reorders (move) and
                        // recent tiles being saved at a spot (copy, THU-10).
                        onDragEnter={e => {
                          if (e.dataTransfer.types.includes(SWATCH_REORDER_MIME) || e.dataTransfer.types.includes(RECENT_DRAG_MIME)) e.preventDefault()
                        }}
                        onDragOver={e => {
                          if (e.defaultPrevented) return
                          if (e.dataTransfer.types.includes(SWATCH_REORDER_MIME)) {
                            e.preventDefault()
                            e.dataTransfer.dropEffect = 'move'
                          } else if (e.dataTransfer.types.includes(RECENT_DRAG_MIME)) {
                            e.preventDefault()
                            e.dataTransfer.dropEffect = 'copy'
                            // Entering through the trailing space, without
                            // crossing a tile, offers the end of the palette.
                            if (swatchDropIndex === null) setSwatchDropIndex(palette.length)
                          }
                        }}
                        onDragLeave={e => {
                          // Leaving the grid for good (not moving between its
                          // tiles) withdraws the marker; the drag may go on to
                          // a color field.
                          const related = e.relatedTarget as Node | null
                          if (related && e.currentTarget.contains(related)) return
                          if (e.dataTransfer.types.includes(RECENT_DRAG_MIME)) setSwatchDropIndex(null)
                        }}
                        onDrop={e => {
                          if (e.defaultPrevented) return
                          if (e.dataTransfer.types.includes(SWATCH_REORDER_MIME)) {
                            e.preventDefault()
                            if (swatchDropIndex !== null) commitSwatchReorder(swatchDropIndex)
                          } else if (e.dataTransfer.types.includes(RECENT_DRAG_MIME)) {
                            e.preventDefault()
                            const v = readDraggedSwatch(e.dataTransfer)
                            if (v) insertPaletteSwatch(v, swatchDropIndex ?? palette.length)
                          }
                        }}
                      >
                        {palette.map((s, i) => {
                          const v = paletteSwatchValue(s)
                          if (!v) return null
                          const isSolid = 'color' in v
                          // Insertion marker, shared by both tile personalities.
                          // Anchored INSIDE the tile it precedes (absolute,
                          // sitting in the 6px flex gap) rather than rendered
                          // as its own flex item. An in-flow marker could wrap
                          // independently of its tile: dropping at the start
                          // of row 2 drew the line at the end of row 1,
                          // because the 2px divider still fit there while the
                          // tile wrapped. Offsets are measured from the
                          // PADDING box, 1px inside the tile's border, hence
                          // 5px (not 4) to center the 2px line in the 6px gap,
                          // and -top-px/h-5 to span the full 20px tile height.
                          const dropMarkers = (
                            <>
                              {swatchDropIndex === i && (
                                <span className="pointer-events-none absolute -left-[5px] -top-px h-5 w-0.5 rounded bg-accent-500" />
                              )}
                              {swatchDropIndex === palette.length && i === palette.length - 1 && (
                                <span className="pointer-events-none absolute -right-[5px] -top-px h-5 w-0.5 rounded bg-accent-500" />
                              )}
                            </>
                          )
                          return (
                            // The Tooltip wrapper IS the flex item (like the
                            // recents row) — an extra block wrapper around the
                            // inline-flex trigger added baseline space below
                            // each tile, making wrapped-row gaps look bigger
                            // than in-row gaps.
                            <React.Fragment key={`${swatchKey(v)}-${i}`}>
                              <Tooltip
                                content={paletteEditMode
                                  ? (
                                    <>
                                      {swatchDescription(v)}
                                      <div>Click to select · drag to reorder</div>
                                    </>
                                  )
                                  : (
                                    <>
                                      {swatchDescription(v)}
                                      <div>{isSolid ? 'Drag over color field to apply' : 'Drag over a Fill control to apply'}</div>
                                    </>
                                  )}
                              >
                                {/* Two personalities: normal mode = drag-to-apply
                                    tile; edit mode = click to select (Ctrl
                                    toggles, Shift ranges), drag to reorder —
                                    a multi-selection moves as a block. */}
                                {paletteEditMode ? (
                                  <button
                                    type="button"
                                    draggable
                                    onClick={e => handleSwatchSelect(i, e)}
                                    onDragStart={e => {
                                      // Dragging an unselected tile selects it first.
                                      if (!selectedSwatches.has(i)) {
                                        setSelectedSwatches(new Set([i]))
                                        swatchAnchorRef.current = i
                                      }
                                      e.dataTransfer.setData(SWATCH_REORDER_MIME, '')
                                      e.dataTransfer.effectAllowed = 'move'
                                      setColorDragImage(e, v)
                                    }}
                                    onDragEnter={e => {
                                      if (e.dataTransfer.types.includes(SWATCH_REORDER_MIME)) e.preventDefault()
                                    }}
                                    onDragOver={e => {
                                      if (!e.dataTransfer.types.includes(SWATCH_REORDER_MIME)) return
                                      e.preventDefault()
                                      e.dataTransfer.dropEffect = 'move'
                                      const r = e.currentTarget.getBoundingClientRect()
                                      const at = e.clientX < r.left + r.width / 2 ? i : i + 1
                                      setSwatchDropIndex(reorderIsNoop(at) ? null : at)
                                    }}
                                    onDrop={e => {
                                      if (!e.dataTransfer.types.includes(SWATCH_REORDER_MIME)) return
                                      e.preventDefault()
                                      if (swatchDropIndex !== null) commitSwatchReorder(swatchDropIndex)
                                    }}
                                    onDragEnd={() => setSwatchDropIndex(null)}
                                    className={`relative w-5 h-5 rounded-md border transition-shadow ${selectedSwatches.has(i) ? 'border-transparent ring-2 ring-accent-400' : 'border-white/50 hover:ring-1 hover:ring-white/70'}`}
                                    style={swatchTileStyle(v)}
                                  >
                                    {dropMarkers}
                                  </button>
                                ) : (
                                  <div
                                    draggable
                                    onDragStart={e => {
                                      if ('color' in v) e.dataTransfer.setData(COLOR_DRAG_MIME, v.color)
                                      else e.dataTransfer.setData(GRADIENT_DRAG_MIME, JSON.stringify(v.gradient))
                                      e.dataTransfer.effectAllowed = 'copy'
                                      setColorDragImage(e, v)
                                    }}
                                    // A recent tile dragged over this one picks
                                    // the near side as its insertion point
                                    // (THU-10); the tile's own drags are unaffected.
                                    onDragEnter={e => {
                                      if (e.dataTransfer.types.includes(RECENT_DRAG_MIME)) e.preventDefault()
                                    }}
                                    onDragOver={e => {
                                      if (!e.dataTransfer.types.includes(RECENT_DRAG_MIME)) return
                                      e.preventDefault()
                                      e.dataTransfer.dropEffect = 'copy'
                                      const r = e.currentTarget.getBoundingClientRect()
                                      const at = e.clientX < r.left + r.width / 2 ? i : i + 1
                                      if (at !== swatchDropIndex) setSwatchDropIndex(at)
                                    }}
                                    onDrop={e => {
                                      if (!e.dataTransfer.types.includes(RECENT_DRAG_MIME)) return
                                      e.preventDefault()
                                      const dragged = readDraggedSwatch(e.dataTransfer)
                                      if (dragged) insertPaletteSwatch(dragged, swatchDropIndex ?? i + 1)
                                    }}
                                    className="relative w-5 h-5 rounded-md border border-white/50 cursor-grab active:cursor-grabbing"
                                    style={swatchTileStyle(v)}
                                  >
                                    {dropMarkers}
                                  </div>
                                )}
                              </Tooltip>
                            </React.Fragment>
                          )
                        })}
                      </div>
                    )}
                    {visibleRecents.length > 0 && (
                      <>
                        <div className="border-t border-white/20" />
                        <p className={`text-[9px] uppercase tracking-wider text-gray-400 ${paletteEditMode ? 'opacity-40' : ''}`}>Recent</p>
                        {/* Recents — dashed outer border, color fill inset
                            inside it. Click ADDS to the palette; drag
                            applies to a color field, same as saved
                            swatches. Dimmed + inert in edit mode: that
                            mode manages the saved palette, not recents. */}
                        <div className={`flex flex-wrap gap-1.5 ${paletteEditMode ? 'opacity-40 pointer-events-none' : ''}`}>
                          {visibleRecents.map(e => {
                            const isSolid = 'color' in e.value
                            return (
                              <Tooltip
                                key={e.id}
                                content={(
                                  <>
                                    {swatchDescription(e.value)}
                                    <div>Click to save to palette, or drag it into the palette where you want it</div>
                                    <div>{isSolid ? 'Drag over color field to apply' : 'Drag over a Fill control to apply'}</div>
                                  </>
                                )}
                              >
                                <button
                                  type="button"
                                  draggable
                                  onDragStart={ev => {
                                    if ('color' in e.value) ev.dataTransfer.setData(COLOR_DRAG_MIME, e.value.color)
                                    else ev.dataTransfer.setData(GRADIENT_DRAG_MIME, JSON.stringify(e.value.gradient))
                                    // The marker type lets the palette grid offer
                                    // an insertion point (THU-10); color fields
                                    // read the payload types and ignore it.
                                    ev.dataTransfer.setData(RECENT_DRAG_MIME, '')
                                    ev.dataTransfer.effectAllowed = 'copy'
                                    setColorDragImage(ev, e.value)
                                  }}
                                  onDragEnd={() => setSwatchDropIndex(null)}
                                  onClick={() => addPaletteSwatch(e.value)}
                                  className={`${RECENT_TILE_CLS} cursor-grab active:cursor-grabbing`}
                                >
                                  <span className={RECENT_FILL_CLS} style={swatchTileStyle(e.value)} />
                                </button>
                              </Tooltip>
                            )
                          })}
                        </div>
                      </>
                    )}
                    {paletteNotice && <p className="text-[10px] text-gray-400">{paletteNotice}</p>}
                    {paletteError && <p className="text-[10px] text-red-400">{paletteError}</p>}
                  </div>
                )}
              </div>

              {/* Reset-palette confirm — replaces the saved swatches with the
                  default set; destructive, so it gets the standard confirm
                  (Cancel left, danger action right). */}
              {confirmPaletteReset && (
                <Modal
                  isOpen
                  onClose={() => setConfirmPaletteReset(false)}
                  title="Reset palette?"
                  width="sm"
                  footer={
                    <>
                      <Button variant="ghost" size="sm" onClick={() => setConfirmPaletteReset(false)}>
                        Cancel
                      </Button>
                      <Button
                        variant="danger"
                        size="sm"
                        onClick={() => {
                          persistPalette([...DEFAULT_PALETTE])
                          setConfirmPaletteReset(false)
                        }}
                      >
                        Reset palette
                      </Button>
                    </>
                  }
                >
                  <p className="text-sm text-gray-300">Your saved swatches will be replaced with the default set. Exported palette files are not affected.</p>
                </Modal>
              )}

              {/* Properties — collapsible (UI-polish batch). Collapsed, it
                  gives up its flex-1 filler role so it shrinks to the
                  header; the panels below slide up and the leftover space
                  sits at the sidebar's bottom. */}
              <div className={`flex flex-col overflow-hidden min-h-0${propertiesCollapsed ? '' : ' flex-1'}`}>
                <div className={`flex items-center gap-1.5 px-3 h-8 shrink-0 border-b ${!propertiesCollapsed ? 'border-white/5' : 'border-transparent'}`}>
                  <Tooltip
                    content={propertiesCollapsed ? 'Expand properties panel' : 'Collapse properties panel'}
                    triggerClassName="self-stretch -ml-3 flex"
                  >
                    <button
                      type="button"
                      onClick={togglePropertiesCollapsed}
                      className="h-full aspect-square flex items-center justify-center text-gray-400 hover:text-gray-200 hover:bg-white/5 transition-colors"
                    >
                      {propertiesCollapsed ? <ChevronRight size={14} /> : <ChevronDown size={14} />}
                    </button>
                  </Tooltip>
                  <Sliders size={11} className="text-gray-400" />
                  <span className="text-[10px] uppercase tracking-wider text-gray-400 font-semibold">Properties</span>
                </div>
                {/* `hidden` (not unmount) so the panel's field drafts survive
                    a collapse round-trip. */}
                <div className={`flex flex-col flex-1 overflow-hidden min-h-0${propertiesCollapsed ? ' hidden' : ''}`}>
                  <PaletteContext.Provider value={paletteCtx}>
                    <PropertiesPanel layer={selectedLayer} onChange={updateLayer} onLiveChange={liveUpdateLayer} onScaleGroup={scaleGroupFromPanel} systemFonts={systemFonts} fontVariantMap={fontVariantMap} fontsLoaded={fontsLoaded} fontQueryFailed={fontQueryFailed} standalone={currentStream?.meta?.isSeries === false} pixelSnapEnabled={pixelSnapEnabled} />
                  </PaletteContext.Provider>
                </div>
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
                    {/* Bordered + filled like a real control (matches the
                        Edit/Preview toggle's chrome) — the bare-icon version
                        was indistinguishable from the decorative panel icon
                        sitting in the same header. */}
                    <button
                      type="button"
                      onClick={() => setAssetOptionsOpen(o => !o)}
                      // p-1 + a 13px glyph: the border eats into the compact
                      // p-0.5 box, so matching the old padding read cramped —
                      // the chrome needs a hair more air than the bare icon
                      // did for the glyph to stay parseable.
                      className={`p-1 rounded-md border flex items-center justify-center transition-colors ${assetOptionsOpen ? 'bg-white/10 border-white/25 text-gray-200' : 'bg-navy-900 border-white/10 text-gray-400 hover:text-gray-200 hover:border-white/25 hover:bg-white/5'}`}
                    >
                      <Sliders size={13} />
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
                              <span className={`w-3.5 h-3.5 rounded border flex items-center justify-center shrink-0 ${checked ? 'bg-accent-600/40 border-accent-500/60 text-accent-100' : 'border-white/20'}`}>
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
                                  {sizeText && <span className="text-gray-400"> · {sizeText}</span>}
                                </span>
                              </div>
                            )
                            return (
                              <Tooltip key={p} content={tooltipContent} side="left">
                                <div className="group relative aspect-square bg-navy-900 border border-white/5 hover:border-accent-500/60 rounded overflow-hidden flex items-center justify-center transition-colors">
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
                                      className="flex items-center justify-center w-7 h-7 rounded-full bg-white/10 hover:bg-accent-600/60 border border-white/20 hover:border-accent-400/70 text-gray-200 hover:text-white transition-colors"
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
                    grid slot. Accent border + label make it visually
                    distinct from the template cards. */}
                {templatePickerStream.targetVariant
                  && templatePickerStream.targetVariant > 1
                  && currentStream
                  && layers.length > 0 && (
                  <div
                    className={`group bg-navy-900 border rounded-lg overflow-hidden cursor-pointer transition-colors ${
                      pickerChoice === 'duplicate' ? 'border-accent-400 ring-1 ring-accent-400/60' : 'border-accent-500/50 hover:border-accent-400'
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
                      <span className="text-xs text-accent-300 truncate block">Duplicate current</span>
                    </div>
                  </div>
                )}
                {templates.map(t => (
                  <div
                    key={t.id}
                    className={`group bg-navy-900 border rounded-lg overflow-hidden cursor-pointer transition-colors ${
                      pickerChoice === t.id ? 'border-accent-400 ring-1 ring-accent-400/60' : 'border-white/10 hover:border-accent-500/60'
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
                    pickerChoice === 'blank' ? 'border-accent-400 ring-1 ring-accent-400/60' : 'border-white/10 hover:border-accent-500/60'
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
