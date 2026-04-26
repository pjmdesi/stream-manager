import React, { useState, useRef, useEffect, useMemo } from 'react'
import ReactDOM from 'react-dom'
import { SwatchBook, Trash2, Star, X, GitMerge, Check, Plus, Layers } from 'lucide-react'
import { Modal } from './Modal'
import { Button } from './Button'
import { Tooltip } from './Tooltip'
import { TAG_COLORS, getTagColor, pickColorForNewTag, TAG_TEXTURES, getTagTextureStyle, pickTextureForNewTag, DEFAULT_TAG_TEXTURE } from '../../constants/tagColors'
import type { StreamFolder } from '../../types'

// ─── Helpers ─────────────────────────────────────────────────────────────────

function normalizeStreamTypes(v: string | string[] | undefined): string[] {
  if (!v) return []
  return Array.isArray(v) ? v : [v]
}

const TOPIC_CHIP = 'bg-purple-900/40 text-purple-300 border-purple-300/40'

// ─── Swatch picker portal ─────────────────────────────────────────────────────

function SwatchPicker({
  anchorRef,
  currentKey,
  onPick,
  onClose,
}: {
  anchorRef: React.RefObject<HTMLElement | null>
  currentKey: string
  onPick: (colorKey: string) => void
  onClose: () => void
}) {
  const rect = anchorRef.current?.getBoundingClientRect()
  const pickerRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    const handler = (e: MouseEvent) => {
      if (
        pickerRef.current && !pickerRef.current.contains(e.target as Node) &&
        anchorRef.current && !anchorRef.current.contains(e.target as Node)
      ) onClose()
    }
    document.addEventListener('mousedown', handler)
    return () => document.removeEventListener('mousedown', handler)
  }, [onClose, anchorRef])

  if (!rect) return null

  return ReactDOM.createPortal(
    <div
      ref={pickerRef}
      style={{ position: 'fixed', top: rect.bottom + 6, left: rect.left, zIndex: 10000 }}
      className="bg-navy-700 border border-white/10 rounded-xl shadow-2xl p-2"
    >
      <div className="grid grid-cols-4 gap-1.5">
        {TAG_COLORS.map(c => (
          <button
            key={c.key}
            type="button"
            title={c.label}
            onMouseDown={e => { e.preventDefault(); onPick(c.key) }}
            className={`w-7 h-7 rounded-full ${c.swatch} transition-transform hover:scale-110 flex items-center justify-center`}
          >
            {c.key === currentKey && <Check size={12} className="text-white drop-shadow" />}
          </button>
        ))}
      </div>
    </div>,
    document.body
  )
}

// ─── Texture picker portal ────────────────────────────────────────────────────

const TEXTURE_PREVIEW_BG = 'transparent'

function TexturePicker({
  anchorRef,
  currentKey,
  onPick,
  onClose,
}: {
  anchorRef: React.RefObject<HTMLElement | null>
  currentKey: string
  onPick: (textureKey: string) => void
  onClose: () => void
}) {
  const rect = anchorRef.current?.getBoundingClientRect()
  const pickerRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    const handler = (e: MouseEvent) => {
      if (
        pickerRef.current && !pickerRef.current.contains(e.target as Node) &&
        anchorRef.current && !anchorRef.current.contains(e.target as Node)
      ) onClose()
    }
    document.addEventListener('mousedown', handler)
    return () => document.removeEventListener('mousedown', handler)
  }, [onClose, anchorRef])

  if (!rect) return null

  return ReactDOM.createPortal(
    <div
      ref={pickerRef}
      style={{ position: 'fixed', top: rect.bottom + 6, left: rect.left, zIndex: 10000 }}
      className="bg-navy-700 border border-white/10 rounded-xl shadow-2xl p-2"
    >
      <div className="grid grid-cols-3 gap-1.5">
        {TAG_TEXTURES.map((t, i) => (
          <Tooltip key={t.key} content={t.label} side={i < 3 ? 'top' : 'bottom'}>
            <button
              type="button"
              onMouseDown={e => { e.preventDefault(); onPick(t.key) }}
              className={`w-14 h-9 rounded-md border transition-colors flex items-center justify-center relative overflow-hidden ${
                t.key === currentKey ? 'border-purple-400/70 ring-1 ring-purple-400/50' : 'border-white/10 hover:border-white/30'
              }`}
              style={{ backgroundColor: TEXTURE_PREVIEW_BG, ...getTagTextureStyle(t.key) }}
            >
              {t.key === currentKey && (
                <Check size={12} className="text-white drop-shadow absolute" />
              )}
            </button>
          </Tooltip>
        ))}
      </div>
    </div>,
    document.body
  )
}

// ─── Shared tag list panel ────────────────────────────────────────────────────

interface TagListPanelProps {
  items: string[]
  /** Usage count per item across folders */
  usageCounts: Record<string, number>
  /** Combined folder count for the currently selected items (combine mode) */
  combinedUsage: number
  combineMode: boolean
  selected: string[]
  deleteTarget: string | null
  onAddToSelected: (item: string) => void
  onRemoveFromSelected: (item: string) => void
  onDyingClick: (item: string) => void
  onDeleteItem: (item: string) => void
  onSetDeleteTarget: (item: string | null) => void
  onConfirmDelete: () => void
  onSetCombineMode: (v: boolean) => void
  onConfirmCombine: () => void
  /** Chip class. Omit to use tag color from tagColors. */
  chipClass?: string
  tagColors?: Record<string, string>
  tagTextures?: Record<string, string>
  onColorChange?: (item: string, colorKey: string) => void
  onTextureChange?: (item: string, textureKey: string) => void
  /** If provided, shows an "Add Tag" button and new-tag input row */
  onAddItem?: (name: string, colorKey: string, textureKey: string) => void
  /** Returns the default color key for a new tag (least-used rule) */
  getDefaultColor?: () => string
  getDefaultTexture?: () => string
}

function TagListPanel({
  items,
  usageCounts,
  combinedUsage,
  combineMode,
  selected,
  deleteTarget,
  onAddToSelected,
  onRemoveFromSelected,
  onDyingClick,
  onDeleteItem,
  onSetDeleteTarget,
  onConfirmDelete,
  onSetCombineMode,
  onConfirmCombine,
  chipClass,
  tagColors,
  tagTextures,
  onColorChange,
  onTextureChange,
  onAddItem,
  getDefaultColor,
  getDefaultTexture,
}: TagListPanelProps) {
  const [openColorPicker, setOpenColorPicker] = useState<string | null>(null)
  const [openTexturePicker, setOpenTexturePicker] = useState<string | null>(null)
  const swatchBtnRefs = useRef<Record<string, HTMLButtonElement | null>>({})
  const textureBtnRefs = useRef<Record<string, HTMLButtonElement | null>>({})

  // New-tag inline state
  const [newTag, setNewTag] = useState<{ name: string; colorKey: string; textureKey: string } | null>(null)
  const [newTagColorOpen, setNewTagColorOpen] = useState(false)
  const [newTagTextureOpen, setNewTagTextureOpen] = useState(false)
  const [newTagError, setNewTagError] = useState('')
  const newTagInputRef = useRef<HTMLInputElement>(null)
  const newTagSwatchRef = useRef<HTMLButtonElement>(null)
  const newTagTextureRef = useRef<HTMLButtonElement>(null)

  useEffect(() => { if (combineMode) { setOpenColorPicker(null); setOpenTexturePicker(null); setNewTag(null) } }, [combineMode])

  // Autofocus input when new-tag row appears
  useEffect(() => {
    if (newTag !== null) newTagInputRef.current?.focus()
  }, [newTag !== null]) // eslint-disable-line react-hooks/exhaustive-deps

  const openNewTag = () => {
    setNewTag({ name: '', colorKey: getDefaultColor?.() ?? 'purple', textureKey: getDefaultTexture?.() ?? DEFAULT_TAG_TEXTURE })
    setNewTagError('')
    setNewTagColorOpen(false)
    setNewTagTextureOpen(false)
  }

  const cancelNewTag = () => {
    setNewTag(null)
    setNewTagError('')
    setNewTagColorOpen(false)
    setNewTagTextureOpen(false)
  }

  const commitNewTag = () => {
    if (!newTag || !onAddItem) return
    const name = newTag.name.trim()
    if (!name) { setNewTagError('Name is required.'); return }
    if (items.includes(name)) { setNewTagError('Already exists.'); return }
    onAddItem(name, newTag.colorKey, newTag.textureKey)
    setNewTag(null)
    setNewTagError('')
    setNewTagColorOpen(false)
    setNewTagTextureOpen(false)
  }

  const sorted = [...items].sort((a, b) => a.localeCompare(b))
  const survivor = selected[0]

  return (
    <>
      {/* ── Header row ─────────────────────────────────────────────────── */}
      <div className="flex items-center justify-between mb-3">
        <p className="text-sm text-gray-500">
          {items.length} item{items.length !== 1 ? 's' : ''}
        </p>
        {!combineMode && items.length >= 2 && (
          <Button variant="ghost" size="sm" icon={<GitMerge size={14} />} onClick={() => onSetCombineMode(true)}>
            Combine
          </Button>
        )}
        {combineMode && (
          <div className="flex items-center gap-2">
            <Button variant="ghost" size="sm" onClick={() => onSetCombineMode(false)}>Cancel</Button>
            <Button
              variant="primary"
              size="sm"
              icon={<GitMerge size={14} />}
              onClick={onConfirmCombine}
              disabled={selected.length < 2}
            >
              Combine
            </Button>
          </div>
        )}
      </div>

      {/* ── List ───────────────────────────────────────────────────────── */}
      <div className="flex flex-col gap-1 overflow-y-auto max-h-[380px] pr-1">
        {sorted.length === 0 && (
          <p className="text-sm text-gray-600 italic text-center py-6">Nothing here yet.</p>
        )}

        {sorted.map(item => {
          const resolvedChip = chipClass ?? getTagColor(tagColors?.[item]).chip
          const isSelected = selected.includes(item)
          const isSurvivor = survivor === item
          const isDying = isSelected && !isSurvivor
          const isPendingDelete = deleteTarget === item

          return (
            <div
              key={item}
              className={`
                flex items-center gap-3 px-3 py-2.5 rounded-lg border transition-colors
                ${isPendingDelete
                  ? 'bg-red-900/20 border-red-800/40'
                  : isSurvivor
                  ? 'bg-navy-700/80 border-yellow-700/40 survivor-pulse'
                  : isDying
                  ? 'bg-navy-700/80 border-red-700/30'
                  : 'bg-navy-800/60 border-white/5 hover:border-white/10'
                }
              `}
            >
              {/* Combine checkbox */}
              {combineMode && (
                <button
                  type="button"
                  title={isDying ? 'Click to uncheck · Double-click to choose as survivor' : undefined}
                  onClick={() => {
                    if (!isSelected) onAddToSelected(item)
                    else if (isSurvivor) onRemoveFromSelected(item)
                    else onDyingClick(item)
                  }}
                  className={`
                    w-5 h-5 rounded flex items-center justify-center border shrink-0 transition-colors
                    ${isSurvivor
                      ? 'bg-yellow-500/20 border-yellow-500/60 text-yellow-300'
                      : isDying
                      ? 'bg-red-500/20 border-red-500/60 text-red-400 cursor-pointer'
                      : 'bg-white/5 border-white/20 hover:border-white/40'
                    }
                  `}
                >
                  {isSurvivor && <Star size={11} fill="currentColor" />}
                  {isDying && <X size={11} />}
                </button>
              )}

              {/* Chip */}
              <span
                className={`inline-block text-xs px-2 py-0.5 rounded-full border font-medium ${resolvedChip}`}
                style={chipClass ? {} : getTagTextureStyle(tagTextures?.[item])}
              >
                {item}
              </span>

              {/* Usage */}
              <span className="text-xs text-gray-600 shrink-0">
                {usageCounts[item] ?? 0} stream{(usageCounts[item] ?? 0) !== 1 ? 's' : ''}
              </span>

              <div className="flex-1" />

              {/* Action buttons */}
              {!combineMode && !isPendingDelete && (
                <div className="flex items-center gap-1">
                  {onColorChange && (
                    <Tooltip content="Change color">
                      <button
                        ref={el => { swatchBtnRefs.current[item] = el }}
                        type="button"
                        onClick={() => { setOpenColorPicker(prev => prev === item ? null : item); setOpenTexturePicker(null) }}
                        className="p-1.5 rounded text-gray-500 hover:text-gray-200 hover:bg-white/10 transition-colors"
                      >
                        <SwatchBook size={14} />
                      </button>
                    </Tooltip>
                  )}
                  {onTextureChange && (
                    <Tooltip content="Change texture">
                      <button
                        ref={el => { textureBtnRefs.current[item] = el }}
                        type="button"
                        onClick={() => { setOpenTexturePicker(prev => prev === item ? null : item); setOpenColorPicker(null) }}
                        className="p-1.5 rounded text-gray-500 hover:text-gray-200 hover:bg-white/10 transition-colors"
                      >
                        <Layers size={14} />
                      </button>
                    </Tooltip>
                  )}
                  <Tooltip content="Delete">
                    <button
                      type="button"
                      onClick={() => onDeleteItem(item)}
                      className="p-1.5 rounded text-gray-500 hover:text-red-400 hover:bg-red-900/20 transition-colors"
                    >
                      <Trash2 size={14} />
                    </button>
                  </Tooltip>
                </div>
              )}

              {/* Delete confirmation */}
              {isPendingDelete && (
                <div className="flex items-center gap-2 text-xs">
                  <span className="text-red-400">
                    Used by {usageCounts[item]} stream{usageCounts[item] !== 1 ? 's' : ''}. Remove from all?
                  </span>
                  <button
                    type="button"
                    onClick={onConfirmDelete}
                    className="px-2 py-0.5 rounded bg-red-600/30 text-red-300 border border-red-700/40 hover:bg-red-600/50 transition-colors"
                  >
                    Delete
                  </button>
                  <button
                    type="button"
                    onClick={() => onSetDeleteTarget(null)}
                    className="px-2 py-0.5 rounded bg-white/5 text-gray-400 border border-white/10 hover:bg-white/10 transition-colors"
                  >
                    Cancel
                  </button>
                </div>
              )}

              {/* Swatch picker */}
              {openColorPicker === item && onColorChange && tagColors && (
                <SwatchPicker
                  anchorRef={{ current: swatchBtnRefs.current[item] }}
                  currentKey={tagColors[item] ?? 'purple'}
                  onPick={colorKey => { onColorChange(item, colorKey); setOpenColorPicker(null) }}
                  onClose={() => setOpenColorPicker(null)}
                />
              )}
              {/* Texture picker */}
              {openTexturePicker === item && onTextureChange && tagTextures && (
                <TexturePicker
                  anchorRef={{ current: textureBtnRefs.current[item] }}
                  currentKey={tagTextures[item] ?? DEFAULT_TAG_TEXTURE}
                  onPick={textureKey => { onTextureChange(item, textureKey); setOpenTexturePicker(null) }}
                  onClose={() => setOpenTexturePicker(null)}
                />
              )}
            </div>
          )
        })}
      </div>

      {/* ── New tag row — mirrors existing list item layout ──────────────── */}
      {newTag && (
        <div className="flex items-center gap-3 mt-1 px-3 py-2.5 rounded-lg border bg-navy-800/60 border-white/10">
          {/* Chip with inline input */}
          <span
            className={`inline-flex items-center text-xs px-2 py-0.5 rounded-full border font-medium ${newTagError ? 'bg-red-900/30 text-red-300 border-red-700/50' : getTagColor(newTag.colorKey).chip}`}
            style={newTagError ? {} : getTagTextureStyle(newTag.textureKey)}
          >
            <input
              ref={newTagInputRef}
              type="text"
              value={newTag.name}
              onChange={e => { setNewTag(t => t ? { ...t, name: e.target.value } : t); setNewTagError('') }}
              onKeyDown={e => {
                if (e.key === 'Enter') { e.preventDefault(); commitNewTag() }
                if (e.key === 'Escape') { e.preventDefault(); cancelNewTag() }
              }}
              placeholder="tag name…"
              className="bg-transparent outline-none font-medium w-28 min-w-0 placeholder:opacity-40"
            />
          </span>

          {/* Mirrors usage count slot */}
          <span className="text-xs text-gray-600 shrink-0">0 streams</span>

          <div className="flex-1" />

          {/* Action buttons — same layout as existing rows */}
          <div className="flex items-center gap-1">
            {/* Color picker (Types tab only) */}
            {onColorChange && (
              <>
                <Tooltip content="Choose color">
                  <button
                    ref={newTagSwatchRef}
                    type="button"
                    onClick={() => { setNewTagColorOpen(p => !p); setNewTagTextureOpen(false) }}
                    className="p-1.5 rounded text-gray-500 hover:text-gray-200 hover:bg-white/10 transition-colors"
                  >
                    <SwatchBook size={14} />
                  </button>
                </Tooltip>
                {newTagColorOpen && (
                  <SwatchPicker
                    anchorRef={newTagSwatchRef}
                    currentKey={newTag.colorKey}
                    onPick={colorKey => { setNewTag(t => t ? { ...t, colorKey } : t); setNewTagColorOpen(false) }}
                    onClose={() => setNewTagColorOpen(false)}
                  />
                )}
              </>
            )}
            {/* Texture picker (Types tab only) */}
            {onTextureChange && (
              <>
                <Tooltip content="Choose texture">
                  <button
                    ref={newTagTextureRef}
                    type="button"
                    onClick={() => { setNewTagTextureOpen(p => !p); setNewTagColorOpen(false) }}
                    className="p-1.5 rounded text-gray-500 hover:text-gray-200 hover:bg-white/10 transition-colors"
                  >
                    <Layers size={14} />
                  </button>
                </Tooltip>
                {newTagTextureOpen && (
                  <TexturePicker
                    anchorRef={newTagTextureRef}
                    currentKey={newTag.textureKey}
                    onPick={textureKey => { setNewTag(t => t ? { ...t, textureKey } : t); setNewTagTextureOpen(false) }}
                    onClose={() => setNewTagTextureOpen(false)}
                  />
                )}
              </>
            )}
            {/* Save (in place of delete) */}
            <Tooltip content={newTagError || 'Save tag'}>
              <button
                type="button"
                onClick={commitNewTag}
                disabled={!newTag.name.trim()}
                className="p-1.5 rounded text-gray-500 hover:text-green-400 hover:bg-green-900/20 transition-colors disabled:opacity-30 disabled:pointer-events-none"
              >
                <Check size={14} />
              </button>
            </Tooltip>
            {/* Cancel */}
            <Tooltip content="Cancel">
              <button
                type="button"
                onClick={cancelNewTag}
                className="p-1.5 rounded text-gray-500 hover:text-red-400 hover:bg-red-900/20 transition-colors"
              >
                <X size={14} />
              </button>
            </Tooltip>
          </div>
        </div>
      )}

      {/* ── Add Tag button ───────────────────────────────────────────────── */}
      {onAddItem && !newTag && !combineMode && (
        <button
          type="button"
          onClick={openNewTag}
          className="mt-2 w-full flex items-center justify-center gap-1.5 px-3 py-2 rounded-lg border border-dashed border-white/15 text-xs text-gray-600 hover:text-gray-300 hover:border-white/30 transition-colors"
        >
          <Plus size={12} />
          Add Tag
        </button>
      )}

      {/* Combine summary */}
      {combineMode && (
        <div className="mt-3 px-3 py-2.5 rounded-lg bg-navy-700/60 border border-white/10 text-xs text-gray-400 flex items-center gap-2">
          <GitMerge size={13} className="text-gray-500 shrink-0" />
          {selected.length === 0 && (
            <span>Select items to combine. The first item you pick becomes the survivor.</span>
          )}
          {selected.length === 1 && (
            <span>
              <span className={`font-medium ${chipClass ? 'text-purple-300' : getTagColor(tagColors?.[selected[0]]).text}`}>
                {selected[0]}
              </span>
              {' '}will survive. Select at least one more to merge into it.
            </span>
          )}
          {selected.length >= 2 && (
            <span>
              <span className={`font-medium ${chipClass ? 'text-purple-300' : getTagColor(tagColors?.[selected[0]]).text}`}>
                {selected[0]}
              </span>
              {' '}will absorb{' '}
              {selected.slice(1).map((t, i) => (
                <React.Fragment key={t}>
                  {i > 0 && ', '}
                  <span className={`font-medium ${chipClass ? 'text-purple-300' : getTagColor(tagColors?.[t]).text}`}>
                    {t}
                  </span>
                </React.Fragment>
              ))}
              {' '}— affecting{' '}
              <span className="text-gray-200 font-medium">{combinedUsage}</span>
              {' '}stream{combinedUsage !== 1 ? 's' : ''}.
            </span>
          )}
        </div>
      )}
    </>
  )
}

// ─── Props ────────────────────────────────────────────────────────────────────

interface Props {
  tags: string[]
  tagColors: Record<string, string>
  tagTextures: Record<string, string>
  games: string[]
  folders: StreamFolder[]
  onColorChange: (tag: string, colorKey: string) => void
  onTextureChange: (tag: string, textureKey: string) => void
  onAddTag: (name: string, colorKey: string, textureKey: string) => void
  onDeleteTag: (tag: string) => void
  onCombineTags: (dying: string[], survivor: string) => void
  onDeleteGame: (game: string) => void
  onCombineGames: (dying: string[], survivor: string) => void
  onClose: () => void
}

// ─── Component ────────────────────────────────────────────────────────────────

export function ManageTagsModal({
  tags, tagColors, tagTextures, games, folders,
  onColorChange, onTextureChange, onAddTag, onDeleteTag, onCombineTags,
  onDeleteGame, onCombineGames,
  onClose,
}: Props) {
  const [activeTab, setActiveTab] = useState<'types' | 'topics'>('types')

  // Shared combine/delete state — reset when switching tabs
  const [combineMode, setCombineMode] = useState(false)
  const [selected, setSelected] = useState<string[]>([])
  const [deleteTarget, setDeleteTarget] = useState<string | null>(null)
  const dyingClickTimer = useRef<{ tag: string; id: ReturnType<typeof setTimeout> } | null>(null)

  const switchTab = (tab: 'types' | 'topics') => {
    setActiveTab(tab)
    setCombineMode(false)
    setSelected([])
    setDeleteTarget(null)
    if (dyingClickTimer.current) {
      clearTimeout(dyingClickTimer.current.id)
      dyingClickTimer.current = null
    }
  }

  useEffect(() => () => {
    if (dyingClickTimer.current) clearTimeout(dyingClickTimer.current.id)
  }, [])

  // ── Usage counts ───────────────────────────────────────────────────────────

  const typeUsageCounts = useMemo(() => {
    const counts: Record<string, number> = {}
    for (const t of tags) counts[t] = 0
    for (const f of folders)
      normalizeStreamTypes(f.meta?.streamType).forEach(t => { if (t in counts) counts[t]++ })
    return counts
  }, [tags, folders])

  const gameUsageCounts = useMemo(() => {
    const counts: Record<string, number> = {}
    for (const g of games) counts[g] = 0
    for (const f of folders)
      (f.meta?.games ?? []).forEach(g => { if (g in counts) counts[g]++ })
    return counts
  }, [games, folders])

  // ── Combined folder usage for combine summary ──────────────────────────────

  const typeCombinedUsage = useMemo(() => {
    if (selected.length === 0) return 0
    const seen = new Set<string>()
    for (const f of folders)
      if (selected.some(t => normalizeStreamTypes(f.meta?.streamType).includes(t))) seen.add(f.folderPath)
    return seen.size
  }, [selected, folders])

  const gameCombinedUsage = useMemo(() => {
    if (selected.length === 0) return 0
    const seen = new Set<string>()
    for (const f of folders)
      if (selected.some(g => (f.meta?.games ?? []).includes(g))) seen.add(f.folderPath)
    return seen.size
  }, [selected, folders])

  // ── Shared selection handlers ──────────────────────────────────────────────

  const addToSelected = (item: string) =>
    setSelected(prev => prev.includes(item) ? prev : [...prev, item])

  const removeFromSelected = (item: string) =>
    setSelected(prev => prev.filter(t => t !== item))

  const handleDyingClick = (item: string) => {
    if (dyingClickTimer.current?.tag === item) {
      clearTimeout(dyingClickTimer.current.id)
      dyingClickTimer.current = null
      setSelected(prev => [item, ...prev.filter(t => t !== item)])
    } else {
      if (dyingClickTimer.current) clearTimeout(dyingClickTimer.current.id)
      const id = setTimeout(() => {
        dyingClickTimer.current = null
        removeFromSelected(item)
      }, 280)
      dyingClickTimer.current = { tag: item, id }
    }
  }

  // ── Confirm handlers ───────────────────────────────────────────────────────

  // Called both from inline confirm button AND directly for 0-usage items
  const handleDeleteItem = (item: string) => {
    const counts = activeTab === 'types' ? typeUsageCounts : gameUsageCounts
    if ((counts[item] ?? 0) === 0) {
      if (activeTab === 'types') onDeleteTag(item)
      else onDeleteGame(item)
      setDeleteTarget(null)
    } else {
      setDeleteTarget(item)
    }
  }

  const handleConfirmDelete = () => {
    if (!deleteTarget) return
    if (activeTab === 'types') onDeleteTag(deleteTarget)
    else onDeleteGame(deleteTarget)
    setDeleteTarget(null)
  }

  const handleConfirmCombine = () => {
    if (selected.length < 2) return
    const [survivor, ...dying] = selected
    if (activeTab === 'types') onCombineTags(dying, survivor)
    else onCombineGames(dying, survivor)
    setCombineMode(false)
    setSelected([])
  }

  // ── Tabs ───────────────────────────────────────────────────────────────────

  const tabs = [
    { key: 'types' as const, label: 'Stream Types', count: tags.length },
    { key: 'topics' as const, label: 'Topics / Games', count: games.length },
  ]

  return (
    <Modal title="Manage Tags" onClose={onClose} isOpen width="md">
      {/* Tab switcher */}
      <div className="flex gap-1 p-1 bg-navy-900/60 rounded-lg mb-4">
        {tabs.map(t => (
          <button
            key={t.key}
            type="button"
            onClick={() => switchTab(t.key)}
            className={`
              flex-1 flex items-center justify-center gap-1.5 px-3 py-1.5 rounded-md text-sm transition-colors
              ${activeTab === t.key
                ? 'bg-navy-700 text-gray-100 shadow-sm'
                : 'text-gray-500 hover:text-gray-300'
              }
            `}
          >
            {t.label}
            <span className={`text-xs px-1.5 py-0.5 rounded-full ${activeTab === t.key ? 'bg-white/10 text-gray-300' : 'bg-white/5 text-gray-600'}`}>
              {t.count}
            </span>
          </button>
        ))}
      </div>

      {activeTab === 'types' && (
        <TagListPanel
          items={tags}
          usageCounts={typeUsageCounts}
          combinedUsage={typeCombinedUsage}
          combineMode={combineMode}
          selected={selected}
          deleteTarget={deleteTarget}
          onAddToSelected={addToSelected}
          onRemoveFromSelected={removeFromSelected}
          onDyingClick={handleDyingClick}
          onDeleteItem={handleDeleteItem}
          onSetDeleteTarget={setDeleteTarget}
          onConfirmDelete={handleConfirmDelete}
          onSetCombineMode={v => { setCombineMode(v); if (!v) setSelected([]) }}
          onConfirmCombine={handleConfirmCombine}
          tagColors={tagColors}
          tagTextures={tagTextures}
          onColorChange={onColorChange}
          onTextureChange={onTextureChange}
          onAddItem={onAddTag}
          getDefaultColor={() => pickColorForNewTag(tagColors)}
          getDefaultTexture={() => pickTextureForNewTag(tagTextures)}
        />
      )}

      {activeTab === 'topics' && (
        <TagListPanel
          items={games}
          usageCounts={gameUsageCounts}
          combinedUsage={gameCombinedUsage}
          combineMode={combineMode}
          selected={selected}
          deleteTarget={deleteTarget}
          onAddToSelected={addToSelected}
          onRemoveFromSelected={removeFromSelected}
          onDyingClick={handleDyingClick}
          onDeleteItem={handleDeleteItem}
          onSetDeleteTarget={setDeleteTarget}
          onConfirmDelete={handleConfirmDelete}
          onSetCombineMode={v => { setCombineMode(v); if (!v) setSelected([]) }}
          onConfirmCombine={handleConfirmCombine}
          chipClass={TOPIC_CHIP}
        />
      )}
    </Modal>
  )
}
