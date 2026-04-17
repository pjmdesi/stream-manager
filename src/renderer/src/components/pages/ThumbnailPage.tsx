import React, {
  useState, useEffect, useRef, useCallback, useMemo
} from 'react'
import { Stage, Layer, Image as KonvaImage, Text as KonvaText, Transformer, Rect as KonvaRect } from 'react-konva'
import useImage from 'use-image'
import Konva from 'konva'
import {
  ArrowLeft, Plus, Trash2, Eye, EyeOff, ChevronUp, ChevronDown,
  Image as ImageIcon, Type, Undo2, Redo2, Save, Download,
  BookMarked, FolderOpen, LayoutTemplate, Sliders, RotateCcw, Copy,
  Magnet, Grid3x3, Check, X
} from 'lucide-react'
import { Button } from '../ui/Button'
import { Tooltip } from '../ui/Tooltip'
import { useThumbnailEditor } from '../../context/ThumbnailEditorContext'
import { useStore } from '../../hooks/useStore'
import type { ThumbnailLayer, ThumbnailTemplate, ThumbnailCanvasFile, ThumbnailRecentEntry } from '../../types'

// ── Canvas dimensions ─────────────────────────────────────────────────────────
const CANVAS_W = 1280
const CANVAS_H = 720

// ── Pan / zoom ────────────────────────────────────────────────────────────────
const SNAP_ZOOM_THRESHOLD = 0.05 // 5% — snap to 100% or fit

function clampCanvasPan(x: number, y: number, zoom: number, cw: number, ch: number) {
  const csx = CANVAS_W * zoom
  const csy = CANVAS_H * zoom
  return {
    x: csx <= cw ? (cw - csx) / 2 : Math.max(cw / 2 - csx, Math.min(cw / 2, x)),
    y: csy <= ch ? (ch - csy) / 2 : Math.max(ch / 2 - csy, Math.min(ch / 2, y)),
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

function getSnapResult(
  node: Konva.Node,
  stage: Konva.Stage,
  smartSnap: boolean,
  gridSnap: boolean
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
      stroke: '#a855f7',
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

// ── Konva node rendering ──────────────────────────────────────────────────────

interface KonvaLayerNodeProps {
  layer: ThumbnailLayer
  isSelected: boolean
  onSelect: (id: string, multi: boolean) => void
  onChange: (updated: ThumbnailLayer) => void
  scale: number
  onSnapDragMove: (e: Konva.KonvaEventObject<DragEvent>) => void
  onClearGuides: () => void
  gridSnapEnabled: boolean
}

function snapGrid(v: number) { return Math.round(v / GRID_SIZE) * GRID_SIZE }

function ImageNode({ layer, isSelected, onSelect, onChange, onSnapDragMove, onClearGuides, gridSnapEnabled }: KonvaLayerNodeProps) {
  const [img] = useImage(layer.src ? `file://${layer.src}` : '', 'anonymous')
  const nodeRef = useRef<Konva.Image>(null)
  const trRef = useRef<Konva.Transformer>(null)

  useEffect(() => {
    if (isSelected && trRef.current && nodeRef.current) {
      trRef.current.nodes([nodeRef.current])
      trRef.current.getLayer()?.batchDraw()
    }
  }, [isSelected])

  if (!img) return null

  const w = layer.width ?? img.naturalWidth
  const h = layer.height ?? img.naturalHeight

  return (
    <>
      <KonvaImage
        ref={nodeRef}
        name="snap-target"
        image={img}
        x={layer.x}
        y={layer.y}
        width={w}
        height={h}
        rotation={layer.rotation}
        opacity={layer.opacity / 100}
        visible={layer.visible}
        draggable
        onClick={e => onSelect(layer.id, e.evt.shiftKey)}
        onTap={() => onSelect(layer.id, false)}
        onDragMove={onSnapDragMove}
        onDragEnd={e => {
          onClearGuides()
          onChange({ ...layer, x: e.target.x(), y: e.target.y() })
        }}
        onTransformEnd={e => {
          const node = e.target
          let x = node.x(), y = node.y()
          let w2 = Math.round(node.width() * node.scaleX())
          let h2 = Math.round(node.height() * node.scaleY())
          if (gridSnapEnabled) { x = snapGrid(x); y = snapGrid(y); w2 = snapGrid(w2); h2 = snapGrid(h2) }
          onChange({ ...layer, x, y, width: w2, height: h2, rotation: node.rotation() })
          node.scaleX(1)
          node.scaleY(1)
        }}
      />
      {isSelected && <Transformer ref={trRef} rotateEnabled keepRatio={false} boundBoxFunc={(_, newBox) => newBox} />}
    </>
  )
}

function TextNode({ layer, isSelected, onSelect, onChange, onSnapDragMove, onClearGuides, gridSnapEnabled }: KonvaLayerNodeProps) {
  const nodeRef = useRef<Konva.Text>(null)
  const trRef = useRef<Konva.Transformer>(null)

  useEffect(() => {
    if (isSelected && trRef.current && nodeRef.current) {
      trRef.current.nodes([nodeRef.current])
      trRef.current.getLayer()?.batchDraw()
    }
  }, [isSelected])

  return (
    <>
      <KonvaText
        ref={nodeRef}
        name="snap-target"
        text={layer.text ?? ''}
        x={layer.x}
        y={layer.y}
        width={layer.width ?? undefined}
        rotation={layer.rotation}
        opacity={layer.opacity / 100}
        visible={layer.visible}
        fontFamily={layer.fontFamily ?? 'Arial'}
        fontSize={layer.fontSize ?? 48}
        fontStyle={layer.fontStyle ?? 'normal'}
        fill={layer.fill ?? '#ffffff'}
        stroke={layer.stroke}
        strokeWidth={layer.strokeWidth}
        align={layer.align ?? 'left'}
        draggable
        onClick={e => onSelect(layer.id, e.evt.shiftKey)}
        onTap={() => onSelect(layer.id, false)}
        onDragMove={onSnapDragMove}
        onDragEnd={e => {
          onClearGuides()
          onChange({ ...layer, x: e.target.x(), y: e.target.y() })
        }}
        onTransformEnd={e => {
          const node = e.target
          let x = node.x(), y = node.y()
          let w2 = Math.round(node.width() * node.scaleX())
          if (gridSnapEnabled) { x = snapGrid(x); y = snapGrid(y); w2 = snapGrid(w2) }
          onChange({ ...layer, x, y, width: w2, rotation: node.rotation() })
          node.scaleX(1)
          node.scaleY(1)
        }}
      />
      {isSelected && (
        <Transformer
          ref={trRef}
          rotateEnabled
          enabledAnchors={['middle-left', 'middle-right']}
          boundBoxFunc={(oldBox, newBox) => ({ ...newBox, height: oldBox.height })}
        />
      )}
    </>
  )
}

// ── Undo/redo ─────────────────────────────────────────────────────────────────

function useUndoRedo(initial: ThumbnailLayer[]) {
  const [past, setPast] = useState<ThumbnailLayer[][]>([])
  const [present, setPresent] = useState<ThumbnailLayer[]>(initial)
  const [future, setFuture] = useState<ThumbnailLayer[][]>([])

  const commit = useCallback((next: ThumbnailLayer[]) => {
    setPast(p => [...p.slice(-49), present])
    setPresent(next)
    setFuture([])
  }, [present])

  const set = useCallback((next: ThumbnailLayer[]) => {
    setPresent(next)
    setFuture([])
  }, [])

  const undo = useCallback(() => {
    if (past.length === 0) return
    const prev = past[past.length - 1]
    setPast(p => p.slice(0, -1))
    setFuture(f => [present, ...f])
    setPresent(prev)
  }, [past, present])

  const redo = useCallback(() => {
    if (future.length === 0) return
    const next = future[0]
    setFuture(f => f.slice(1))
    setPast(p => [...p, present])
    setPresent(next)
  }, [future, present])

  const reset = useCallback((layers: ThumbnailLayer[]) => {
    setPast([])
    setPresent(layers)
    setFuture([])
  }, [])

  return { layers: present, commit, set, undo, redo, reset, canUndo: past.length > 0, canRedo: future.length > 0 }
}

// ── Overview ──────────────────────────────────────────────────────────────────

interface OverviewProps {
  streamsDir: string
  templates: ThumbnailTemplate[]
  recents: ThumbnailRecentEntry[]
  onNewBlank: () => void
  onOpenTemplate: (t: ThumbnailTemplate) => void
  onOpenRecent: (entry: ThumbnailRecentEntry) => void
  onDeleteTemplate: (id: string) => void
  loading: boolean
}

function Overview({ templates, recents, onNewBlank, onOpenTemplate, onOpenRecent, onDeleteTemplate, loading }: OverviewProps) {
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
        {loading ? (
          <p className="text-xs text-gray-500">Loading…</p>
        ) : templates.length === 0 ? (
          <p className="text-xs text-gray-500">No templates yet. Create one from the editor.</p>
        ) : (
          <div className="grid grid-cols-3 gap-3">
            {templates.map(t => (
              <div
                key={t.id}
                className="group relative bg-navy-800 border border-white/10 rounded-lg overflow-hidden cursor-pointer hover:border-purple-500/50 transition-colors"
                onClick={() => onOpenTemplate(t)}
              >
                <div className="aspect-video bg-navy-900 flex items-center justify-center">
                  <LayoutTemplate size={28} className="text-gray-600" />
                </div>
                <div className="p-2 flex items-center justify-between gap-1">
                  <span className="text-xs text-gray-300 truncate">{t.name}</span>
                  <button
                    className="opacity-0 group-hover:opacity-100 p-1 rounded hover:bg-red-500/20 text-gray-500 hover:text-red-400 transition-all shrink-0"
                    onClick={e => { e.stopPropagation(); onDeleteTemplate(t.id) }}
                  >
                    <Trash2 size={12} />
                  </button>
                </div>
              </div>
            ))}
          </div>
        )}
      </section>

      {/* Recents */}
      {recents.length > 0 && (
        <section>
          <h2 className="text-sm font-semibold text-gray-300 uppercase tracking-wider mb-3">Recent</h2>
          <div className="flex flex-col gap-1.5">
            {recents.map((entry, i) => (
              <button
                key={i}
                onClick={() => onOpenRecent(entry)}
                className="flex items-center gap-3 px-3 py-2 rounded-lg bg-navy-800 border border-white/5 hover:border-white/15 hover:bg-white/5 text-left transition-colors"
              >
                <ImageIcon size={14} className="text-gray-500 shrink-0" />
                <div className="flex-1 min-w-0">
                  <p className="text-xs text-gray-300 truncate">{entry.title ?? entry.date}</p>
                  <p className="text-[10px] text-gray-600 truncate">{entry.folderPath}</p>
                </div>
                <span className="text-[10px] text-gray-600 shrink-0">{entry.date}</span>
              </button>
            ))}
          </div>
        </section>
      )}
    </div>
  )
}

// ── Properties panel ──────────────────────────────────────────────────────────

interface PropsPanelProps {
  layer: ThumbnailLayer | null
  onChange: (updated: ThumbnailLayer) => void
  systemFonts: string[]
}

function PropertiesPanel({ layer, onChange, systemFonts }: PropsPanelProps) {
  if (!layer) {
    return (
      <div className="p-4 text-xs text-gray-600 text-center">
        Select a layer to edit properties
      </div>
    )
  }

  const update = (patch: Partial<ThumbnailLayer>) => onChange({ ...layer, ...patch })

  return (
    <div className="p-3 flex flex-col gap-3 overflow-y-auto flex-1 min-h-0">
      {/* Common */}
      <section>
        <p className="text-[10px] uppercase tracking-wider text-gray-600 mb-2">Transform</p>
        <div className="grid grid-cols-2 gap-1.5">
          {[['X', 'x'], ['Y', 'y']].map(([label, key]) => (
            <label key={key} className="flex flex-col gap-0.5">
              <span className="text-[10px] text-gray-500">{label}</span>
              <input
                type="number"
                value={Math.round((layer as any)[key])}
                onChange={e => update({ [key]: Number(e.target.value) } as any)}
                className="bg-navy-900 border border-white/10 rounded px-2 py-1 text-xs text-gray-200 w-full"
              />
            </label>
          ))}
          <label className="flex flex-col gap-0.5">
            <span className="text-[10px] text-gray-500">Rotation</span>
            <input
              type="number"
              value={Math.round(layer.rotation)}
              onChange={e => update({ rotation: Number(e.target.value) })}
              className="bg-navy-900 border border-white/10 rounded px-2 py-1 text-xs text-gray-200 w-full"
            />
          </label>
          <label className="flex flex-col gap-0.5">
            <span className="text-[10px] text-gray-500">Opacity %</span>
            <input
              type="number"
              min={0}
              max={100}
              value={layer.opacity}
              onChange={e => update({ opacity: Math.min(100, Math.max(0, Number(e.target.value))) })}
              className="bg-navy-900 border border-white/10 rounded px-2 py-1 text-xs text-gray-200 w-full"
            />
          </label>
        </div>
        {(layer.width !== undefined) && (
          <div className="grid grid-cols-2 gap-1.5 mt-1.5">
            <label className="flex flex-col gap-0.5">
              <span className="text-[10px] text-gray-500">Width</span>
              <input
                type="number"
                value={Math.round(layer.width ?? 0)}
                onChange={e => update({ width: Number(e.target.value) })}
                className="bg-navy-900 border border-white/10 rounded px-2 py-1 text-xs text-gray-200 w-full"
              />
            </label>
            {layer.type === 'image' && layer.height !== undefined && (
              <label className="flex flex-col gap-0.5">
                <span className="text-[10px] text-gray-500">Height</span>
                <input
                  type="number"
                  value={Math.round(layer.height ?? 0)}
                  onChange={e => update({ height: Number(e.target.value) })}
                  className="bg-navy-900 border border-white/10 rounded px-2 py-1 text-xs text-gray-200 w-full"
                />
              </label>
            )}
          </div>
        )}
      </section>

      {layer.type === 'text' && (
        <>
          <section>
            <p className="text-[10px] uppercase tracking-wider text-gray-600 mb-2">Text</p>
            <textarea
              value={layer.text ?? ''}
              onChange={e => update({ text: e.target.value })}
              rows={3}
              className="w-full bg-navy-900 border border-white/10 rounded px-2 py-1.5 text-xs text-gray-200 resize-none"
            />
          </section>
          <section>
            <p className="text-[10px] uppercase tracking-wider text-gray-600 mb-2">Font</p>
            <div className="flex flex-col gap-1.5">
              <select
                value={layer.fontFamily ?? 'Arial'}
                onChange={e => update({ fontFamily: e.target.value })}
                className="bg-navy-900 border border-white/10 rounded px-2 py-1 text-xs text-gray-200 w-full"
                style={{ fontFamily: layer.fontFamily ?? 'Arial' }}
              >
                {systemFonts.map(f => (
                  <option key={f} value={f} style={{ fontFamily: f }}>{f}</option>
                ))}
              </select>
              <div className="grid grid-cols-2 gap-1.5">
                <label className="flex flex-col gap-0.5">
                  <span className="text-[10px] text-gray-500">Size</span>
                  <input
                    type="number"
                    min={8}
                    max={500}
                    value={layer.fontSize ?? 48}
                    onChange={e => update({ fontSize: Number(e.target.value) })}
                    className="bg-navy-900 border border-white/10 rounded px-2 py-1 text-xs text-gray-200"
                  />
                </label>
                <label className="flex flex-col gap-0.5">
                  <span className="text-[10px] text-gray-500">Style</span>
                  <select
                    value={layer.fontStyle ?? 'normal'}
                    onChange={e => update({ fontStyle: e.target.value })}
                    className="bg-navy-900 border border-white/10 rounded px-2 py-1 text-xs text-gray-200"
                  >
                    <option value="normal">Normal</option>
                    <option value="bold">Bold</option>
                    <option value="italic">Italic</option>
                    <option value="bold italic">Bold Italic</option>
                  </select>
                </label>
              </div>
              <div className="grid grid-cols-2 gap-1.5">
                <label className="flex flex-col gap-0.5">
                  <span className="text-[10px] text-gray-500">Align</span>
                  <select
                    value={layer.align ?? 'left'}
                    onChange={e => update({ align: e.target.value as any })}
                    className="bg-navy-900 border border-white/10 rounded px-2 py-1 text-xs text-gray-200"
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
            <p className="text-[10px] uppercase tracking-wider text-gray-600 mb-2">Color</p>
            <div className="grid grid-cols-2 gap-1.5">
              <label className="flex flex-col gap-0.5">
                <span className="text-[10px] text-gray-500">Fill</span>
                <div className="flex items-center gap-1.5">
                  <input
                    type="color"
                    value={layer.fill ?? '#ffffff'}
                    onChange={e => update({ fill: e.target.value })}
                    className="h-7 w-10 rounded border border-white/10 bg-transparent cursor-pointer"
                  />
                  <input
                    type="text"
                    value={layer.fill ?? '#ffffff'}
                    onChange={e => update({ fill: e.target.value })}
                    className="flex-1 bg-navy-900 border border-white/10 rounded px-2 py-1 text-xs text-gray-200"
                  />
                </div>
              </label>
              <label className="flex flex-col gap-0.5">
                <span className="text-[10px] text-gray-500">Stroke</span>
                <div className="flex items-center gap-1.5">
                  <input
                    type="color"
                    value={layer.stroke ?? '#000000'}
                    onChange={e => update({ stroke: e.target.value })}
                    className="h-7 w-10 rounded border border-white/10 bg-transparent cursor-pointer"
                  />
                  <input
                    type="number"
                    min={0}
                    max={50}
                    placeholder="0"
                    value={layer.strokeWidth ?? 0}
                    onChange={e => update({ strokeWidth: Number(e.target.value) })}
                    className="flex-1 bg-navy-900 border border-white/10 rounded px-2 py-1 text-xs text-gray-200"
                  />
                </div>
              </label>
            </div>
          </section>
        </>
      )}
    </div>
  )
}

// ── Main ThumbnailPage ────────────────────────────────────────────────────────

export function ThumbnailPage({ isVisible }: { isVisible: boolean }) {
  const { pendingStream, clearPendingStream } = useThumbnailEditor()
  const { config } = useStore()

  // ── Mode ─────────────────────────────────────────────────────────────────
  const [mode, setMode] = useState<'overview' | 'editor'>('overview')

  // ── Overview data ─────────────────────────────────────────────────────────
  const [templates, setTemplates] = useState<ThumbnailTemplate[]>([])
  const [recents, setRecents] = useState<ThumbnailRecentEntry[]>([])
  const [overviewLoading, setOverviewLoading] = useState(false)

  // ── Editor state ──────────────────────────────────────────────────────────
  const [currentStream, setCurrentStream] = useState<{ folderPath: string; date: string; title?: string } | null>(null)
  const [currentTemplateId, setCurrentTemplateId] = useState<string | undefined>(undefined)
  const { layers, commit, set: setLayersDirect, undo, redo, reset: resetLayers, canUndo, canRedo } = useUndoRedo([])
  const [selectedIds, setSelectedIds] = useState<string[]>([])
  const [isDirty, setIsDirty] = useState(false)
  const [saveTemplateOpen, setSaveTemplateOpen] = useState(false)
  const [saveTemplateName, setSaveTemplateName] = useState('')
  const saveTemplateInputRef = useRef<HTMLInputElement>(null)

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
  const containerSizeRef = useRef({ w: 800, h: 600 })
  const isPanningRef = useRef(false)
  const panStartRef = useRef({ x: 0, y: 0, panX: 0, panY: 0 })
  const lastMiddleClickRef = useRef(0)

  // Keep refs in sync
  useEffect(() => { viewZoomRef.current = viewZoom }, [viewZoom])
  useEffect(() => { viewPanRef.current = viewPan }, [viewPan])

  // ── Stage refs ────────────────────────────────────────────────────────────
  const stageRef = useRef<Konva.Stage>(null)
  const bgLayerRef = useRef<Konva.Layer>(null)
  const guideLayerRef = useRef<Konva.Layer>(null)

  // ── Snapping ──────────────────────────────────────────────────────────────
  const [smartSnapEnabled, setSmartSnapEnabled] = useState(true)
  const [gridSnapEnabled, setGridSnapEnabled] = useState(false)

  const handleSnapDragMove = useCallback((e: Konva.KonvaEventObject<DragEvent>) => {
    if (!stageRef.current || !guideLayerRef.current) return
    if (!smartSnapEnabled && !gridSnapEnabled) return
    const node = e.target
    const snap = getSnapResult(node, stageRef.current, smartSnapEnabled, gridSnapEnabled)
    if (snap.x !== undefined) node.x(snap.x)
    if (snap.y !== undefined) node.y(snap.y)
    renderSnapGuides(snap.guides, guideLayerRef.current, viewZoomRef.current)
  }, [smartSnapEnabled, gridSnapEnabled])

  const clearSnapGuides = useCallback(() => {
    if (!guideLayerRef.current) return
    guideLayerRef.current.destroyChildren()
    guideLayerRef.current.batchDraw()
  }, [])

  // ── System fonts ─────────────────────────────────────────────────────────
  const [systemFonts, setSystemFonts] = useState<string[]>(['Arial', 'Georgia', 'Impact', 'Times New Roman', 'Verdana'])

  // ── Auto-save timer ───────────────────────────────────────────────────────
  const autoSaveTimer = useRef<ReturnType<typeof setTimeout> | null>(null)

  // ─── Load system fonts ─────────────────────────────────────────────────
  useEffect(() => {
    if (!(window as any).queryLocalFonts) return
    ;(window as any).queryLocalFonts().then((fonts: any[]) => {
      const names = Array.from(new Set(fonts.map((f: any) => f.family as string))).sort()
      if (names.length > 0) setSystemFonts(names)
    }).catch(() => {})
  }, [])

  // ── Load overview data when visible ───────────────────────────────────────
  useEffect(() => {
    if (!isVisible || !config.streamsDir) return
    setOverviewLoading(true)
    Promise.all([
      window.api.thumbnailListTemplates(config.streamsDir),
      window.api.thumbnailGetRecents(),
    ]).then(([tmpl, rec]) => {
      setTemplates(tmpl)
      setRecents(rec)
    }).catch(() => {}).finally(() => setOverviewLoading(false))
  }, [isVisible, config.streamsDir])

  // ── Handle pending stream navigation ─────────────────────────────────────
  useEffect(() => {
    if (!pendingStream || !isVisible) return
    openStreamEditor(pendingStream.folderPath, pendingStream.date, pendingStream.title)
    clearPendingStream()
  }, [pendingStream, isVisible])

  // ── Fit scale + container size ────────────────────────────────────────────
  useEffect(() => {
    if (mode !== 'editor') return
    const el = canvasContainerRef.current
    if (!el) return
    const update = () => {
      const { width, height } = el.getBoundingClientRect()
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
        const pan = clampCanvasPan(viewPanRef.current.x, viewPanRef.current.y, next, cw, ch)
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
        // Double middle-click: reset to fit
        lastMiddleClickRef.current = 0
        const fs = fitScaleRef.current
        const { w: cw, h: ch } = containerSizeRef.current
        const pan = clampCanvasPan(0, 0, fs, cw, ch)
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
    if (!currentStream) return
    setIsDirty(true)
    if (autoSaveTimer.current) clearTimeout(autoSaveTimer.current)
    autoSaveTimer.current = setTimeout(() => {
      doSave(newLayers, currentStream.folderPath, currentStream.date, currentTemplateId)
    }, 500)
  }, [currentStream, currentTemplateId])

  // Export the canvas at full 1:1 resolution regardless of current view
  const getCanvasDataUrl = useCallback((): string => {
    const stage = stageRef.current
    if (!stage) return ''
    bgLayerRef.current?.hide()
    guideLayerRef.current?.hide()
    const prevX = stage.x(), prevY = stage.y()
    const prevSX = stage.scaleX(), prevSY = stage.scaleY()
    const prevW = stage.width(), prevH = stage.height()
    stage.x(0); stage.y(0); stage.scaleX(1); stage.scaleY(1)
    stage.width(CANVAS_W); stage.height(CANVAS_H)
    const dataUrl = stage.toDataURL({ pixelRatio: 1 })
    stage.x(prevX); stage.y(prevY); stage.scaleX(prevSX); stage.scaleY(prevSY)
    stage.width(prevW); stage.height(prevH)
    bgLayerRef.current?.show()
    guideLayerRef.current?.show()
    return dataUrl
  }, [])

  const doSave = useCallback(async (
    saveLayers: ThumbnailLayer[],
    folderPath: string,
    date: string,
    templateId: string | undefined
  ) => {
    if (!stageRef.current) return
    const canvasFile: ThumbnailCanvasFile = {
      version: 1,
      templateId,
      updatedAt: Date.now(),
      layers: saveLayers,
    }
    const pngDataUrl = getCanvasDataUrl()
    try {
      await window.api.thumbnailSaveCanvas(folderPath, date, canvasFile, pngDataUrl)
      setIsDirty(false)
    } catch (err) {
      console.error('Auto-save failed:', err)
    }
  }, [getCanvasDataUrl])

  // ── Layer mutations ────────────────────────────────────────────────────────
  const commitLayers = useCallback((next: ThumbnailLayer[]) => {
    commit(next)
    triggerAutoSave(next)
  }, [commit, triggerAutoSave])

  const updateLayer = useCallback((updated: ThumbnailLayer) => {
    const next = layers.map(l => l.id === updated.id ? updated : l)
    commitLayers(next)
  }, [layers, commitLayers])

  const deleteSelected = useCallback(() => {
    if (selectedIds.length === 0) return
    const next = layers.filter(l => !selectedIds.includes(l.id))
    commitLayers(next)
    setSelectedIds([])
  }, [layers, selectedIds, commitLayers])

  const moveLayer = useCallback((id: string, dir: 'up' | 'down') => {
    const idx = layers.findIndex(l => l.id === id)
    if (idx < 0) return
    const next = [...layers]
    const other = dir === 'up' ? idx + 1 : idx - 1
    if (other < 0 || other >= next.length) return
    ;[next[idx], next[other]] = [next[other], next[idx]]
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

  // ── Add layers ────────────────────────────────────────────────────────────
  const addImageLayer = useCallback(async () => {
    let defaultPath: string | undefined
    if (config.streamsDir) {
      await window.api.thumbnailEnsureAssetsDir(config.streamsDir).catch(() => {})
      defaultPath = `${config.streamsDir}/_thumbnail-assets`
    }
    const paths = await window.api.openFileDialog({ filters: [{ name: 'Images', extensions: ['png', 'jpg', 'jpeg', 'webp', 'gif'] }], properties: ['openFile'], defaultPath })
    if (!paths.length) return
    const srcPath = config.streamsDir
      ? await window.api.thumbnailCacheAsset(config.streamsDir, paths[0])
      : paths[0]

    // Read natural dimensions, then contain within canvas if needed
    const { naturalW, naturalH } = await new Promise<{ naturalW: number; naturalH: number }>(resolve => {
      const img = new Image()
      img.onload = () => resolve({ naturalW: img.naturalWidth, naturalH: img.naturalHeight })
      img.onerror = () => resolve({ naturalW: CANVAS_W, naturalH: CANVAS_H })
      img.src = `file://${srcPath}`
    })
    const scaleW = CANVAS_W / naturalW
    const scaleH = CANVAS_H / naturalH
    const containScale = Math.min(1, scaleW, scaleH) // ≤1: only ever shrink
    const width = Math.round(naturalW * containScale)
    const height = Math.round(naturalH * containScale)

    const layer: ThumbnailLayer = {
      id: newId(), name: 'Image', type: 'image', visible: true, opacity: 100,
      x: Math.round((CANVAS_W - width) / 2),
      y: Math.round((CANVAS_H - height) / 2),
      rotation: 0, src: srcPath, width, height,
    }
    commitLayers([...layers, layer])
    setSelectedIds([layer.id])
  }, [layers, commitLayers, config.streamsDir])

  const addTextLayer = useCallback(() => {
    const layer: ThumbnailLayer = {
      id: newId(), name: 'Text', type: 'text', visible: true, opacity: 100,
      x: 100, y: 100, rotation: 0, text: 'New Text',
      fontFamily: systemFonts[0] ?? 'Arial', fontSize: 72, fontStyle: 'bold',
      fill: '#ffffff', strokeWidth: 0, align: 'left',
    }
    commitLayers([...layers, layer])
    setSelectedIds([layer.id])
  }, [layers, commitLayers, systemFonts])

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

  // ── Open editor for a stream ───────────────────────────────────────────────
  const openStreamEditor = useCallback(async (folderPath: string, date: string, title?: string) => {
    setCurrentStream({ folderPath, date, title })
    setSelectedIds([])
    try {
      const canvas = await window.api.thumbnailLoadCanvas(folderPath, date)
      if (canvas) {
        resetLayers(canvas.layers)
        setCurrentTemplateId(canvas.templateId)
      } else {
        resetLayers([])
        setCurrentTemplateId(undefined)
      }
    } catch {
      resetLayers([])
    }
    setIsDirty(false)
    setMode('editor')
    // Add to recents
    const entry: ThumbnailRecentEntry = { folderPath, date, title, updatedAt: Date.now() }
    window.api.thumbnailAddRecent(entry).then(setRecents).catch(() => {})
  }, [resetLayers])

  const openFromRecent = useCallback((entry: ThumbnailRecentEntry) => {
    openStreamEditor(entry.folderPath, entry.date, entry.title)
  }, [openStreamEditor])

  const openFromTemplate = useCallback((t: ThumbnailTemplate) => {
    // Open editor with template layers but no stream association
    setCurrentStream(null)
    setSelectedIds([])
    resetLayers(t.layers.map(l => ({ ...l, id: newId() })))
    setCurrentTemplateId(t.id)
    setIsDirty(false)
    setMode('editor')
  }, [resetLayers])

  const openNewBlank = useCallback(() => {
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
    const saved = await window.api.thumbnailSaveTemplate(config.streamsDir, template)
    setTemplates(prev => [saved, ...prev.filter(t => t.id !== saved.id)])
  }, [saveTemplateName, layers, config.streamsDir])

  const deleteTemplate = useCallback(async (id: string) => {
    if (!config.streamsDir) return
    await window.api.thumbnailDeleteTemplate(config.streamsDir, id)
    setTemplates(prev => prev.filter(t => t.id !== id))
  }, [config.streamsDir])

  // ── Manual save ───────────────────────────────────────────────────────────
  const manualSave = useCallback(async () => {
    if (!currentStream) return
    if (autoSaveTimer.current) { clearTimeout(autoSaveTimer.current); autoSaveTimer.current = null }
    await doSave(layers, currentStream.folderPath, currentStream.date, currentTemplateId)
  }, [currentStream, layers, currentTemplateId, doSave])

  // ── Export PNG ────────────────────────────────────────────────────────────
  const exportPng = useCallback(async () => {
    if (!stageRef.current) return
    const dataUrl = getCanvasDataUrl()
    const defaultName = currentStream ? `${currentStream.date}_thumbnail.png` : 'thumbnail.png'
    const dest = await window.api.saveFileDialog({ defaultPath: defaultName, filters: [{ name: 'PNG', extensions: ['png'] }] })
    if (!dest) return
    await window.api.saveScreenshot(dest, dataUrl.replace(/^data:image\/png;base64,/, ''))
  }, [currentStream, getCanvasDataUrl])

  // ── Keyboard shortcuts ────────────────────────────────────────────────────
  useEffect(() => {
    if (!isVisible || mode !== 'editor') return
    const handler = (e: KeyboardEvent) => {
      const tag = (e.target as HTMLElement).tagName
      if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT') return
      if ((e.ctrlKey || e.metaKey) && e.key === 'z' && !e.shiftKey) { e.preventDefault(); undo() }
      if ((e.ctrlKey || e.metaKey) && (e.key === 'y' || (e.key === 'z' && e.shiftKey))) { e.preventDefault(); redo() }
      if ((e.ctrlKey || e.metaKey) && e.key === 's') { e.preventDefault(); manualSave() }
      if (e.key === 'Delete' || e.key === 'Backspace') deleteSelected()
      if (e.key === 'g' || e.key === 'G') setGridSnapEnabled(v => !v)
    }
    window.addEventListener('keydown', handler)
    return () => window.removeEventListener('keydown', handler)
  }, [isVisible, mode, undo, redo, manualSave, deleteSelected, setGridSnapEnabled])

  // ── Selected layer ────────────────────────────────────────────────────────
  const selectedLayer = useMemo(() => {
    if (selectedIds.length !== 1) return null
    return layers.find(l => l.id === selectedIds[0]) ?? null
  }, [selectedIds, layers])

  // ── Rendered canvas layers (bottom-to-top order, reversed for konva draw) ──
  // layers[0] = bottom, layers[length-1] = top. Konva draws in array order.
  const renderLayers = useMemo(() => [...layers], [layers])

  // ── Render ────────────────────────────────────────────────────────────────
  return (
    <div className="flex flex-col h-full bg-navy-900">
      {mode === 'overview' ? (
        <>
          <div className="flex items-center justify-between px-5 py-3 border-b border-white/5 shrink-0">
            <h1 className="text-sm font-semibold text-gray-200">Thumbnail Editor</h1>
          </div>
          <Overview
            streamsDir={config.streamsDir}
            templates={templates}
            recents={recents}
            onNewBlank={openNewBlank}
            onOpenTemplate={openFromTemplate}
            onOpenRecent={openFromRecent}
            onDeleteTemplate={deleteTemplate}
            loading={overviewLoading}
          />
        </>
      ) : (
        <>
          {/* Top bar */}
          <div className="flex items-center gap-2 px-3 py-2 border-b border-white/5 shrink-0 bg-navy-800">
            <Tooltip content="Back to overview" side="bottom">
              <button
                onClick={() => setMode('overview')}
                className="p-1.5 rounded hover:bg-white/10 text-gray-400 hover:text-gray-200 transition-colors"
              >
                <ArrowLeft size={15} />
              </button>
            </Tooltip>
            <div className="flex-1 flex items-center gap-2 min-w-0">
              {currentStream ? (
                <span className="text-xs text-gray-400 truncate">
                  {currentStream.title ?? currentStream.date}
                  <span className="text-gray-600 ml-2">{currentStream.date}</span>
                </span>
              ) : (
                <span className="text-xs text-gray-500 italic">Unsaved canvas</span>
              )}
              {isDirty && <span className="w-1.5 h-1.5 rounded-full bg-amber-400 shrink-0" />}
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
              <Tooltip content="Redo (Ctrl+Y)" side="bottom">
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
                  className={`p-1.5 rounded transition-colors ${smartSnapEnabled ? 'bg-purple-600/30 text-purple-300' : 'hover:bg-white/10 text-gray-500 hover:text-gray-300'}`}
                >
                  <Magnet size={14} />
                </button>
              </Tooltip>
              <Tooltip content={`Grid snap ${gridSnapEnabled ? '(on)' : '(off)'} — snap to ${GRID_SIZE}px grid (G)`} side="bottom">
                <button
                  onClick={() => setGridSnapEnabled(v => !v)}
                  className={`p-1.5 rounded transition-colors ${gridSnapEnabled ? 'bg-purple-600/30 text-purple-300' : 'hover:bg-white/10 text-gray-500 hover:text-gray-300'}`}
                >
                  <Grid3x3 size={14} />
                </button>
              </Tooltip>
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
                    className="h-6 px-2 rounded bg-navy-900 border border-purple-500/50 text-xs text-gray-200 placeholder-gray-600 outline-none focus:border-purple-400 w-36"
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
                    className="p-1 rounded hover:bg-white/10 text-gray-500 hover:text-gray-300 transition-colors"
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
              <Tooltip content="Export PNG" side="bottom">
                <button
                  onClick={exportPng}
                  className="p-1.5 rounded hover:bg-white/10 text-gray-400 hover:text-gray-200 transition-colors"
                >
                  <Download size={14} />
                </button>
              </Tooltip>
              {currentStream && (
                <Button variant="primary" size="sm" icon={<Save size={12} />} onClick={manualSave} disabled={!isDirty}>
                  Save
                </Button>
              )}
            </div>
          </div>

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
            </div>

            {/* Canvas center */}
            <div
              ref={canvasContainerRef}
              className="flex-1 overflow-hidden relative min-w-0"
              style={{ background: '#0d0d1a', cursor: isPanning ? 'grabbing' : undefined }}
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
                      onSnapDragMove: handleSnapDragMove,
                      onClearGuides: clearSnapGuides,
                      gridSnapEnabled,
                    }
                    return layer.type === 'image'
                      ? <ImageNode key={layer.id} {...props} />
                      : <TextNode key={layer.id} {...props} />
                  })}
                </Layer>
                <Layer ref={guideLayerRef} listening={false} />
              </Stage>

              {/* Zoom badge */}
              <div className="absolute bottom-3 left-3 flex items-center gap-1.5 pointer-events-none">
                <span className="text-[10px] tabular-nums bg-black/50 text-gray-400 px-1.5 py-0.5 rounded">
                  {Math.round(viewZoom * 100)}%
                  {Math.abs(viewZoom - fitScale) < 0.001 && <span className="text-gray-600 ml-1">fit</span>}
                  {Math.abs(viewZoom - 1) < 0.001 && <span className="text-gray-600 ml-1">1:1</span>}
                </span>
              </div>
            </div>

            {/* Right panel: Layers + Properties */}
            <div className="w-56 flex flex-col border-l border-white/5 bg-navy-800 shrink-0 overflow-hidden">
              {/* Layers */}
              <div className="flex flex-col" style={{ minHeight: 0, flex: '0 0 auto', maxHeight: '50%' }}>
                <div className="flex items-center justify-between px-3 py-2 border-b border-white/5 shrink-0">
                  <span className="text-[10px] uppercase tracking-wider text-gray-500 font-semibold">Layers</span>
                  <span className="text-[10px] text-gray-600">{layers.length}</span>
                </div>
                <div className="overflow-y-auto flex-1">
                  {[...layers].reverse().map(layer => {
                    const isSelected = selectedIds.includes(layer.id)
                    const idx = layers.indexOf(layer)
                    return (
                      <div
                        key={layer.id}
                        onClick={() => handleLayerSelect(layer.id, false)}
                        className={`flex items-center gap-1.5 px-2 py-1.5 cursor-pointer group border-b border-white/5 ${isSelected ? 'bg-purple-600/20' : 'hover:bg-white/5'}`}
                      >
                        <button
                          onClick={e => { e.stopPropagation(); updateLayer({ ...layer, visible: !layer.visible }) }}
                          className="text-gray-500 hover:text-gray-300 shrink-0"
                        >
                          {layer.visible ? <Eye size={12} /> : <EyeOff size={12} className="text-gray-700" />}
                        </button>
                        <span className="flex-1 text-xs text-gray-400 truncate">{layer.name}</span>
                        <div className={`flex gap-0.5 opacity-0 group-hover:opacity-100 ${isSelected ? 'opacity-100' : ''} transition-opacity`}>
                          <button onClick={e => { e.stopPropagation(); duplicateLayer(layer.id) }} className="p-0.5 rounded hover:bg-white/10 text-gray-600 hover:text-gray-300">
                            <Copy size={10} />
                          </button>
                          <button onClick={e => { e.stopPropagation(); moveLayer(layer.id, 'up') }} disabled={idx >= layers.length - 1} className="p-0.5 rounded hover:bg-white/10 text-gray-600 hover:text-gray-300 disabled:opacity-30">
                            <ChevronUp size={10} />
                          </button>
                          <button onClick={e => { e.stopPropagation(); moveLayer(layer.id, 'down') }} disabled={idx <= 0} className="p-0.5 rounded hover:bg-white/10 text-gray-600 hover:text-gray-300 disabled:opacity-30">
                            <ChevronDown size={10} />
                          </button>
                          <button onClick={e => { e.stopPropagation(); commitLayers(layers.filter(l => l.id !== layer.id)); setSelectedIds([]) }} className="p-0.5 rounded hover:bg-red-500/20 text-gray-600 hover:text-red-400">
                            <Trash2 size={10} />
                          </button>
                        </div>
                      </div>
                    )
                  })}
                </div>
              </div>

              {/* Divider */}
              <div className="border-t border-white/10 shrink-0" />

              {/* Properties */}
              <div className="flex flex-col flex-1 overflow-hidden min-h-0">
                <div className="flex items-center gap-1.5 px-3 py-2 border-b border-white/5 shrink-0">
                  <Sliders size={11} className="text-gray-500" />
                  <span className="text-[10px] uppercase tracking-wider text-gray-500 font-semibold">Properties</span>
                </div>
                <PropertiesPanel layer={selectedLayer} onChange={updateLayer} systemFonts={systemFonts} />
              </div>
            </div>
          </div>
        </>
      )}
    </div>
  )
}
