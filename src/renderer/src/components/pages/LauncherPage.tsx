import React, { useState, useEffect, useLayoutEffect, useRef } from 'react'
import ReactDOM from 'react-dom'
import * as LucideIcons from 'lucide-react'
import { Plus, Trash2, FolderOpen, Rocket, Pencil, Check, X, GripVertical, ChevronDown, Upload, Star, Play, Globe } from 'lucide-react'
import { v4 as uuidv4 } from 'uuid'
import type { LauncherGroup, LauncherApp } from '../../types'
import { Button } from '../ui/Button'
import { Modal } from '../ui/Modal'
import { Tooltip } from '../ui/Tooltip'
import { IconPickerModal } from '../ui/IconPickerModal'
import { useStore } from '../../hooks/useStore'
import { useAnimationConfig } from '../../hooks/useAnimationConfig'

// Visible width of a group row's left zone (icon + name). The detail sidebar
// slides over everything to the right of this, leaving the icon + name of each
// row showing — mirrors how the Streams detail sidebar obscures all but the
// thumbnail/counter/title. Shared by the rows and the sidebar's width so the
// boundary lines up exactly.
const GROUP_ROW_WIDTH = 280

function toPascal(name: string) {
  return name.split('-').map(s => s.charAt(0).toUpperCase() + s.slice(1)).join('')
}

function GroupIcon({ name, size = 14 }: { name?: string; size?: number }) {
  const Icon = name
    ? (((LucideIcons as unknown) as Record<string, React.ComponentType<{ size?: number }>>)[toPascal(name)] ?? Rocket)
    : Rocket
  return <Icon size={size} />
}

// ── Inline editable label ─────────────────────────────────────────────────────

function EditableLabel({
  value,
  onSave,
  placeholder,
  className = '',
}: {
  value: string
  onSave: (v: string) => void
  placeholder?: string
  className?: string
}) {
  const [editing, setEditing] = useState(false)
  const [draft, setDraft] = useState(value)
  const inputRef = useRef<HTMLInputElement>(null)

  const start = () => { setDraft(value); setEditing(true) }
  const commit = () => { const v = draft.trim(); onSave(v || value); setEditing(false) }
  const cancel = () => setEditing(false)

  useEffect(() => { if (editing) inputRef.current?.select() }, [editing])

  if (editing) {
    return (
      <div className="flex items-center gap-1 min-w-0">
        <input
          ref={inputRef}
          value={draft}
          onChange={e => setDraft(e.target.value)}
          onKeyDown={e => { if (e.key === 'Enter') commit(); if (e.key === 'Escape') cancel() }}
          onBlur={commit}
          className="flex-1 min-w-0 bg-navy-900 border border-purple-500/50 rounded-lg px-2 py-0.5 text-sm text-gray-200 outline-none focus:ring-1 focus:ring-purple-500/50"
          placeholder={placeholder}
          autoFocus
        />
        <button onMouseDown={e => { e.preventDefault(); commit() }} className="text-green-400 hover:text-green-300 transition-colors">
          <Check size={13} />
        </button>
        <button onMouseDown={e => { e.preventDefault(); cancel() }} className="text-gray-400 hover:text-gray-300 transition-colors">
          <X size={13} />
        </button>
      </div>
    )
  }

  return (
    <button onClick={start} className={`group flex items-center gap-1.5 min-w-0 text-left ${className}`}>
      <span className="truncate">{value || <span className="text-gray-400 italic">{placeholder}</span>}</span>
      <Pencil size={11} className="shrink-0 text-gray-400 opacity-0 group-hover:opacity-100 transition-opacity" />
    </button>
  )
}

// A launch target is a website/protocol URL (vs a file path) when it has a
// `scheme://` prefix. Mirrors the main-process check in launcher.ts; a Windows
// drive path ("C:\…") has no `//` after the colon so it never matches.
export const isUrlPath = (p: string): boolean => /^[a-z][a-z\d+.-]*:\/\//i.test(p)

// ── App icon (fetched from OS) ─────────────────────────────────────────────────

function AppIcon({ path, size = 20 }: { path: string; size?: number }) {
  const [iconUrl, setIconUrl] = useState<string | null>(null)  // OS file icon (apps)
  const [favicon, setFavicon] = useState<string | null>(null)  // website favicon (data URL)
  // Bumped by the 'sm:app-icon-refresh' event after a successful launch of
  // this path. Covers the restored-file case: an icon fetched while the exe
  // was missing is Windows' generic placeholder, and with the path unchanged
  // nothing else would ever refetch the real one.
  const [refreshKey, setRefreshKey] = useState(0)
  const isUrl = isUrlPath(path)

  useEffect(() => {
    const onRefresh = (e: Event) => {
      if ((e as CustomEvent<string>).detail === path) setRefreshKey(k => k + 1)
    }
    window.addEventListener('sm:app-icon-refresh', onRefresh)
    return () => window.removeEventListener('sm:app-icon-refresh', onRefresh)
  }, [path])

  // Reset only when the path itself changes — a refresh keeps showing the
  // old icon until the new fetch lands (no placeholder flash).
  useEffect(() => {
    setIconUrl(null)
    setFavicon(null)
  }, [path])

  useEffect(() => {
    if (!path) return
    if (isUrlPath(path)) {
      // Resolved in main from the site's own /favicon.ico (no third party);
      // null while loading or if none is found → show the globe glyph.
      let cancelled = false
      window.api.getFavicon(path).then(d => { if (!cancelled) setFavicon(d) }).catch(() => {})
      return () => { cancelled = true }
    }
    // refreshKey > 0 = a post-launch refresh: ask main to bypass Chromium's
    // session icon cache, which otherwise keeps serving the generic
    // placeholder fetched while the file was missing.
    window.api.getFileIcon(path, refreshKey > 0).then(setIconUrl).catch(() => setIconUrl(null))
    return
  }, [path, refreshKey])

  if (isUrl) {
    if (favicon) {
      return <img src={favicon} alt="" style={{ width: size, height: size }} className="rounded-sm shrink-0 object-contain" />
    }
    return <Globe size={size * 0.8} style={{ width: size, height: size }} className="shrink-0 text-gray-400 p-px" />
  }
  if (!iconUrl) {
    return <div style={{ width: size, height: size }} className="rounded-sm bg-white/5 shrink-0" />
  }
  return <img src={iconUrl} alt="" style={{ width: size, height: size }} className="rounded-sm shrink-0 object-contain" />
}

// ── App drop zone ─────────────────────────────────────────────────────────────

function AppDropZone({ onClick, onFileDrop, compact = false }: {
  onClick: () => void
  onFileDrop: (path: string) => void
  compact?: boolean
}) {
  const [isDragging, setIsDragging] = useState(false)
  const zoneRef = useRef<HTMLDivElement>(null)
  // Keep a stable ref so the effect closure never goes stale
  const onFileDropRef = useRef(onFileDrop)
  useEffect(() => { onFileDropRef.current = onFileDrop }, [onFileDrop])

  useEffect(() => {
    const el = zoneRef.current
    if (!el) return

    const onDragOver = (e: DragEvent) => {
      e.preventDefault()
      setIsDragging(true)
    }
    const onDragLeave = (e: DragEvent) => {
      if (el.contains(e.relatedTarget as Node)) return
      setIsDragging(false)
    }
    const onDrop = (e: DragEvent) => {
      e.preventDefault()
      setIsDragging(false)
      const file = e.dataTransfer?.files?.[0]
      if (file) {
        const filePath = window.api.getPathForFile(file)
        if (filePath) onFileDropRef.current(filePath)
      }
    }

    el.addEventListener('dragover', onDragOver)
    el.addEventListener('dragleave', onDragLeave)
    el.addEventListener('drop', onDrop)
    return () => {
      el.removeEventListener('dragover', onDragOver)
      el.removeEventListener('dragleave', onDragLeave)
      el.removeEventListener('drop', onDrop)
    }
  }, [])

  if (compact) {
    return (
      <div
        ref={zoneRef}
        onClick={onClick}
        className={`flex items-center justify-center gap-3 border border-dashed rounded-lg px-4 py-3 cursor-pointer transition-all
          ${isDragging
            ? 'border-purple-500 bg-purple-600/10'
            : 'border-white/10 hover:border-purple-500/40'
          }`}
      >
        <div className={`shrink-0 transition-colors ${isDragging ? 'text-purple-400' : 'text-gray-400'}`}>
          {isDragging ? <Upload size={14} /> : <Plus size={14} />}
        </div>
        <div className="pointer-events-none">
          <p className="text-gray-300 font-medium text-sm">Drop an app here, or click to add an app or website</p>
          <p className="text-gray-400 text-xs mt-0.5">Supports: .exe, .lnk</p>
        </div>
      </div>
    )
  }

  return (
    <div
      ref={zoneRef}
      onClick={onClick}
      className={`flex flex-col items-center justify-center gap-3 p-8 border-2 border-dashed rounded-xl cursor-pointer transition-all duration-200
        ${isDragging
          ? 'border-purple-500 bg-purple-600/10'
          : 'border-white/10 hover:border-purple-500/50 hover:bg-purple-600/5'
        }`}
    >
      <div className="p-3 rounded-full transition-colors pointer-events-none">
        {isDragging
          ? <Upload size={24} className="text-purple-400" />
          : <Plus size={24} className="text-gray-400" />
        }
      </div>
      <div className="text-center pointer-events-none">
        <p className="text-gray-300 font-medium">Drop an app here, or click to add an app or website</p>
        <p className="text-gray-400 text-sm mt-1">Supports: .exe, .lnk</p>
      </div>
    </div>
  )
}

// ── Add-to-group modal (app or website) ────────────────────────────────────────

function AddAppModal({
  isOpen,
  onClose,
  onAdd,
  defaultPath,
  existingApps = [],
  prefill,
}: {
  isOpen: boolean
  onClose: () => void
  onAdd: (app: LauncherApp) => void
  defaultPath?: string
  existingApps?: LauncherApp[]
  prefill?: { path: string; name: string }
}) {
  const [selectedExistingId, setSelectedExistingId] = useState('')
  const [dropdownOpen, setDropdownOpen] = useState(false)
  const [path, setPath] = useState('')
  const [name, setName] = useState('')
  const [iconUrl, setIconUrl] = useState<string | null>(null)
  const [itemType, setItemType] = useState<'app' | 'url'>('app')
  const anchorRef = useRef<HTMLButtonElement>(null)
  const dropdownRef = useRef<HTMLDivElement>(null)

  // Reset when opened, applying prefill if provided
  useEffect(() => {
    if (!isOpen) return
    setSelectedExistingId('')
    setDropdownOpen(false)
    if (prefill?.path) {
      setPath(prefill.path)
      setName(prefill.name)
      if (isUrlPath(prefill.path)) {
        setItemType('url')
        setIconUrl(null)
      } else {
        setItemType('app')
        window.api.getFileIcon(prefill.path).then(setIconUrl).catch(() => setIconUrl(null))
      }
    } else {
      setPath('')
      setName('')
      setIconUrl(null)
      setItemType('app')
    }
  }, [isOpen])

  const selectedExisting = existingApps.find(a => a.id === selectedExistingId) ?? null

  useEffect(() => {
    if (!dropdownOpen) return
    const handler = (e: MouseEvent) => {
      const t = e.target as Node
      if (
        anchorRef.current && !anchorRef.current.contains(t) &&
        dropdownRef.current && !dropdownRef.current.contains(t)
      ) setDropdownOpen(false)
    }
    document.addEventListener('mousedown', handler)
    return () => document.removeEventListener('mousedown', handler)
  }, [dropdownOpen])

  const browse = async () => {
    const paths = await window.api.openFileDialog({
      title: 'Select Application',
      defaultPath,
      filters: [
        { name: 'Applications', extensions: ['exe', 'lnk'] },
        { name: 'All Files', extensions: ['*'] },
      ],
      properties: ['openFile'],
    })
    if (!paths?.[0]) return
    const resolved = await window.api.resolveShortcut(paths[0])
    setPath(resolved)
    const autoName = resolved.replace(/.*[\\/]/, '').replace(/\.[^.]+$/, '')
    setName(prev => prev || autoName)
    window.api.getFileIcon(resolved).then(setIconUrl).catch(() => setIconUrl(null))
  }

  const confirm = () => {
    if (selectedExisting) {
      onAdd({ ...selectedExisting, id: uuidv4() })
      onClose()
      return
    }
    if (itemType === 'url') {
      let url = path.trim()
      if (!url) return
      if (!isUrlPath(url)) url = `https://${url}`  // assume https when no scheme was typed
      let host = url
      try { host = new URL(url).hostname.replace(/^www\./, '') } catch { /* keep the raw url as the name */ }
      onAdd({ id: uuidv4(), name: name.trim() || host, path: url })
      onClose()
      return
    }
    if (!path) return
    onAdd({ id: uuidv4(), name: name.trim() || path.replace(/.*[\\/]/, '').replace(/\.[^.]+$/, ''), path })
    onClose()
  }

  const newAppMode = !selectedExisting

  return (
    <Modal isOpen={isOpen} onClose={onClose} title="Add to Group" width="sm">
      <div className="flex flex-col gap-4">

        {/* Previously added apps dropdown */}
        {existingApps.length > 0 && (
          <div className="flex flex-col gap-1.5">
            <label className="text-xs font-medium text-gray-400 uppercase tracking-wider">Previously Added</label>
            <button
              ref={anchorRef}
              type="button"
              onClick={() => setDropdownOpen(v => !v)}
              className="w-full flex items-center gap-2 bg-navy-900 border border-white/10 rounded-lg px-3 py-2 text-sm text-left hover:border-white/20 focus:outline-none focus:ring-2 focus:ring-purple-500/50 transition-colors"
            >
              {selectedExisting ? (
                <>
                  <AppIcon path={selectedExisting.path} size={18} />
                  <span className="flex-1 truncate text-gray-200">
                    {selectedExisting.name || selectedExisting.path.replace(/.*[\\/]/, '').replace(/\.[^.]+$/, '')}
                  </span>
                </>
              ) : (
                <span className="flex-1 text-gray-400">Select a previously added item</span>
              )}
              <ChevronDown size={13} className={`shrink-0 text-gray-400 transition-transform ${dropdownOpen ? 'rotate-180' : ''}`} />
            </button>
            {dropdownOpen && anchorRef.current && ReactDOM.createPortal(
              <div
                ref={dropdownRef}
                style={{
                  position: 'fixed',
                  top: anchorRef.current.getBoundingClientRect().bottom + 4,
                  left: anchorRef.current.getBoundingClientRect().left,
                  width: anchorRef.current.getBoundingClientRect().width,
                  zIndex: 9999,
                }}
                className="bg-navy-700 border border-white/10 rounded-lg shadow-xl overflow-hidden"
                onMouseDown={e => e.preventDefault()}
              >
                {selectedExistingId && (
                  <button
                    className="w-full text-left px-3 py-2 text-xs text-gray-400 hover:bg-white/5 transition-colors border-b border-white/5"
                    onClick={() => { setSelectedExistingId(''); setDropdownOpen(false) }}
                  >
                    — Clear selection —
                  </button>
                )}
                <div className="max-h-52 overflow-y-auto">
                  {existingApps.map(app => (
                    <button
                      key={app.id}
                      onClick={() => { setSelectedExistingId(app.id); setDropdownOpen(false) }}
                      className={`w-full flex items-center gap-2.5 px-3 py-2 text-sm text-left transition-colors ${
                        app.id === selectedExistingId
                          ? 'bg-purple-600/20 text-purple-300'
                          : 'text-gray-300 hover:bg-white/5'
                      }`}
                    >
                      <AppIcon path={app.path} size={18} />
                      <span className="flex-1 truncate">
                        {app.name || app.path.replace(/.*[\\/]/, '').replace(/\.[^.]+$/, '')}
                      </span>
                    </button>
                  ))}
                </div>
              </div>,
              document.body
            )}
          </div>
        )}

        {/* App vs. Website toggle — only when adding a new item */}
        {newAppMode && (
          <div className="flex gap-1 p-0.5 bg-navy-900 border border-white/10 rounded-lg w-fit">
            {([['app', 'App'], ['url', 'Website']] as const).map(([t, lbl]) => (
              <button
                key={t}
                type="button"
                onClick={() => setItemType(t)}
                className={`px-3 py-1 rounded-md text-xs font-medium transition-colors ${
                  itemType === t ? 'bg-purple-600/30 text-purple-200' : 'text-gray-400 hover:text-gray-200'
                }`}
              >
                {lbl}
              </button>
            ))}
          </div>
        )}

        {/* Path picker (App) — hidden when an existing app is selected */}
        {itemType === 'app' && (
        <div className={`flex flex-col gap-1.5 ${!newAppMode ? 'opacity-40 pointer-events-none select-none' : ''}`}>
          <label className="text-xs font-medium text-gray-400 uppercase tracking-wider">Application</label>
          <div className="flex gap-2">
            <div
              className="flex-1 flex items-center gap-2 bg-navy-900 border border-white/10 rounded-lg px-3 py-2 cursor-pointer hover:border-white/20 transition-colors"
              onClick={newAppMode ? browse : undefined}
            >
              {path ? (
                <>
                  {iconUrl
                    ? <img src={iconUrl} alt="" className="w-5 h-5 shrink-0 object-contain" />
                    : <div className="w-5 h-5 rounded-sm bg-white/10 shrink-0" />
                  }
                  <span className="text-sm text-gray-200 truncate">{path.replace(/.*[\\/]/, '')}</span>
                </>
              ) : (
                <span className="text-sm text-gray-400">No file selected…</span>
              )}
            </div>
            <Button variant="secondary" size="sm" icon={<FolderOpen size={14} />} onClick={browse}>
              Browse
            </Button>
          </div>
          {path && (
            <p className="text-[11px] text-gray-400 font-mono truncate px-1">{path}</p>
          )}
        </div>
        )}

        {/* URL input (Website) */}
        {itemType === 'url' && (
        <div className={`flex flex-col gap-1.5 ${!newAppMode ? 'opacity-40 pointer-events-none select-none' : ''}`}>
          <label className="text-xs font-medium text-gray-400 uppercase tracking-wider">Website URL</label>
          <input
            value={path}
            onChange={e => setPath(e.target.value)}
            onKeyDown={e => { if (e.key === 'Enter') confirm() }}
            placeholder="https://example.com"
            autoFocus
            className="bg-navy-900 border border-white/10 text-gray-200 text-sm rounded-lg px-3 py-2 font-mono focus:outline-none focus:ring-2 focus:ring-purple-500/50"
          />
          <p className="text-[11px] text-gray-400 px-1">Opens in your default browser when the group launches.</p>
        </div>
        )}

        {/* Icon + name — hidden when an existing app is selected */}
        <div className={`flex flex-col gap-1.5 ${!newAppMode ? 'opacity-40 pointer-events-none select-none' : ''}`}>
          <label className="text-xs font-medium text-gray-400 uppercase tracking-wider">Name</label>
          <div className="flex items-center gap-2">
            {itemType === 'url' ? (
              <Globe size={20} className="w-8 h-8 shrink-0 text-gray-400 p-1.5" />
            ) : iconUrl ? (
              <img src={iconUrl} alt="" className="w-8 h-8 shrink-0 object-contain rounded" />
            ) : null}
            <input
              value={name}
              onChange={e => setName(e.target.value)}
              onKeyDown={e => { if (e.key === 'Enter') confirm() }}
              placeholder={itemType === 'url' ? 'Website name (optional)' : 'App name'}
              disabled={!newAppMode}
              className="flex-1 bg-navy-900 border border-white/10 text-gray-200 text-sm rounded-lg px-3 py-2 focus:outline-none focus:ring-2 focus:ring-purple-500/50 disabled:cursor-not-allowed"
            />
          </div>
        </div>

        <div className="flex justify-end gap-2 pt-1">
          <Button variant="secondary" size="sm" onClick={onClose}>Cancel</Button>
          <Button variant="primary" size="sm" disabled={!selectedExisting && !path} onClick={confirm}>Add</Button>
        </div>
      </div>
    </Modal>
  )
}

// ── App row ───────────────────────────────────────────────────────────────────

function AppRow({
  app,
  onUpdate,
  onRemove,
  onLaunch,
  error,
  defaultPath,
  isDragging,
  style,
  onGripMouseDown,
}: {
  app: LauncherApp
  onUpdate: (updated: LauncherApp) => void
  onRemove: () => void
  /** Page-level launcher — resolves true only if the app actually opened,
   *  and maintains the shared per-app error state. */
  onLaunch: () => Promise<boolean>
  /** Last launch failure for this app, if any (cleared on a good launch). */
  error?: string
  defaultPath?: string
  isDragging?: boolean
  style?: React.CSSProperties
  onGripMouseDown?: (e: React.MouseEvent) => void
}) {
  const [launched, setLaunched] = useState(false)

  const browsePath = async () => {
    const paths = await window.api.openFileDialog({
      title: 'Select Application',
      defaultPath: app.path ? app.path.replace(/[\\/][^\\/]+$/, '') : defaultPath,
      filters: [{ name: 'Applications', extensions: ['exe', 'lnk'] }, { name: 'All Files', extensions: ['*'] }],
      properties: ['openFile'],
    })
    if (paths?.[0]) {
      const p = await window.api.resolveShortcut(paths[0])
      const autoName = p.replace(/.*[\\/]/, '').replace(/\.[^.]+$/, '')
      onUpdate({ ...app, path: p, name: app.name || autoName })
    }
  }

  const launch = async () => {
    if (!app.path) return
    const ok = await onLaunch()
    if (ok) {
      setLaunched(true)
      setTimeout(() => setLaunched(false), 2000)
    }
  }

  return (
    <div
      style={style}
      className={`group flex items-center gap-2.5 px-3 py-2 rounded-lg
        ${isDragging ? 'bg-navy-700 shadow-lg shadow-black/30 z-10' : 'hover:bg-white/5'}
      `}
    >
      <GripVertical
        size={14}
        className="text-gray-400 shrink-0 cursor-grab active:cursor-grabbing"
        onMouseDown={onGripMouseDown}
      />
      <AppIcon path={app.path} size={20} />
      <div className="flex-1 min-w-0 flex flex-col gap-0.5">
        <div className="flex items-center gap-1.5 min-w-0">
          <EditableLabel
            value={app.name}
            onSave={name => onUpdate({ ...app, name })}
            placeholder="App name"
            className="text-sm font-medium text-gray-200"
          />
          {error && (
            <Tooltip content={error} side="top">
              <span className="shrink-0 max-w-[160px] truncate text-[10px] px-1.5 py-0.5 rounded-full bg-red-500/15 border border-red-500/30 text-red-400">
                {error}
              </span>
            </Tooltip>
          )}
        </div>
        <div className="flex items-center gap-1 min-w-0">
          {isUrlPath(app.path) ? (
            <EditableLabel
              value={app.path}
              onSave={p => onUpdate({ ...app, path: p })}
              placeholder="https://…"
              className="text-xs text-gray-400 truncate font-mono"
            />
          ) : (
            <>
              {app.path ? (
                <Tooltip content="Open file location" side="top" triggerClassName="min-w-0">
                  <button
                    onClick={() => { void window.api.openInExplorer(app.path) }}
                    className="block max-w-full text-left text-xs text-gray-400 hover:text-gray-300 truncate font-mono transition-colors"
                  >
                    {app.path}
                  </button>
                </Tooltip>
              ) : (
                <span className="text-xs text-gray-400 truncate font-mono">No path set</span>
              )}
              <Tooltip content="Change executable" side="top">
                <button
                  onClick={browsePath}
                  className="shrink-0 p-0.5 text-gray-400 hover:text-gray-300 transition-colors opacity-0 group-hover:opacity-100"
                >
                  <FolderOpen size={12} />
                </button>
              </Tooltip>
            </>
          )}
        </div>
      </div>
      <Tooltip content={error ? `Launch failed — try again` : launched ? 'Launched!' : 'Launch'} side="left">
        <button
          onClick={launch}
          disabled={!app.path}
          className={`shrink-0 p-1 transition-colors disabled:pointer-events-none ${
            error
              ? 'text-red-400 hover:text-red-300' // errored: always visible, red
              : launched
                ? 'text-green-400 opacity-0 group-hover:opacity-100'
                : 'text-gray-400 hover:text-green-400 opacity-0 group-hover:opacity-100'
          }`}
        >
          <Play size={13} />
        </button>
      </Tooltip>
      <Tooltip content="Remove" side="left">
        <button
          onClick={onRemove}
          className="shrink-0 p-1 text-gray-400 hover:text-red-400 transition-colors opacity-0 group-hover:opacity-100"
        >
          <Trash2 size={13} />
        </button>
      </Tooltip>
    </div>
  )
}

// ── Group row (main list) ──────────────────────────────────────────────────────

function GroupRow({
  group, selected, isWidget, launching, feedback, appErrors, animMs, onSelect, onLaunchGroup, onLaunchApp, onToggleWidget,
}: {
  group: LauncherGroup
  selected: boolean
  /** Detail-sidebar slide duration — delays the selected-row indicator so it
   *  lands once the sidebar settles rather than racing the slide. */
  animMs: number
  isWidget: boolean
  launching: boolean
  feedback?: string
  /** Per-app launch errors — errored app icons get a red ring + error tooltip. */
  appErrors: Record<string, string>
  onSelect: () => void
  onLaunchGroup: () => void
  onLaunchApp: (app: LauncherApp) => void
  onToggleWidget: () => void
}) {
  const launchable = group.apps.length > 0 && group.apps.some(a => a.path)
  // Selected-row indicator timing — the purple right-edge bar lands once the
  // detail sidebar finishes sliding in (mirrors the Streams list). Lags on
  // open; instant on close (useLayoutEffect updates the class before paint).
  const [indicatorVisible, setIndicatorVisible] = useState(false)
  useLayoutEffect(() => {
    if (!selected) { setIndicatorVisible(false); return }
    const t = window.setTimeout(() => setIndicatorVisible(true), animMs)
    return () => clearTimeout(t)
  }, [selected, animMs])
  return (
    <div
      onClick={onSelect}
      className={`group/row flex items-stretch border-b border-white/5 cursor-pointer transition-colors ${
        selected ? 'bg-purple-600/15' : 'hover:bg-white/5'
      }`}
    >
      {/* Left zone (icon + name) — stays visible under the open sidebar. The
          selected-row indicator is an ::after bar pinned to this zone's right
          edge (= the sidebar's left edge at GROUP_ROW_WIDTH) so it sits flush
          against the sidebar, mirroring the Streams list. */}
      <div
        className={`shrink-0 flex items-center gap-3 pl-6 pr-3 py-3 ${indicatorVisible ? 'relative after:content-[""] after:absolute after:inset-y-0 after:right-0 after:w-0.5 after:bg-purple-600' : ''}`}
        style={{ width: GROUP_ROW_WIDTH }}
      >
        <div className={`shrink-0 w-9 h-9 flex items-center justify-center rounded-lg ${
          selected ? 'bg-purple-500/20 text-purple-200' : 'bg-white/5 text-gray-300'
        }`}>
          <GroupIcon name={group.icon} size={18} />
        </div>
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-1.5 min-w-0">
            <span className={`text-sm font-medium truncate ${selected ? 'text-purple-200' : 'text-gray-200'}`}>{group.name}</span>
          </div>
          <span className="text-[11px] text-gray-400">{group.apps.length} {group.apps.length === 1 ? 'app' : 'apps'}</span>
        </div>
      </div>

      {/* Right zone (app icons wrap; covered by the detail sidebar when open). */}
      <div className="flex-1 min-w-0 flex items-center gap-3 pr-4 py-3">
        <div className="flex-1 min-w-0 flex flex-wrap items-center gap-1.5">
          {group.apps.length === 0 ? (
            <span className="text-xs text-gray-400 italic">No apps yet</span>
          ) : group.apps.map(app => (
            <Tooltip
              key={app.id}
              content={appErrors[app.id]
                ? `${app.name} — ${appErrors[app.id]}`
                : app.path ? `Launch ${app.name}` : `${app.name} — no path set`}
              side="top"
            >
              <button
                onClick={e => { e.stopPropagation(); if (app.path) onLaunchApp(app) }}
                disabled={!app.path}
                className={`shrink-0 p-1 rounded hover:bg-white/10 disabled:opacity-40 disabled:cursor-not-allowed transition-colors ${
                  appErrors[app.id] ? 'ring-1 ring-red-500/60' : ''
                }`}
              >
                <AppIcon path={app.path} size={22} />
              </button>
            </Tooltip>
          ))}
        </div>
        <div className="shrink-0 flex items-center gap-1">
          <Tooltip content={isWidget ? 'Remove from sidebar widget' : 'Pin to sidebar widget'} side="top">
            <button
              onClick={e => { e.stopPropagation(); onToggleWidget() }}
              className={`p-1.5 rounded transition-colors ${
                isWidget ? 'text-yellow-400' : 'text-gray-400 opacity-0 group-hover/row:opacity-100 hover:text-gray-200'
              }`}
            >
              <Star size={13} className={isWidget ? 'fill-yellow-400' : ''} />
            </button>
          </Tooltip>
          <Button
            variant="primary"
            size="sm"
            icon={<Rocket size={13} />}
            disabled={launching || !launchable}
            onClick={e => { e.stopPropagation(); onLaunchGroup() }}
          >
            {feedback ?? 'Launch all'}
          </Button>
        </div>
      </div>
    </div>
  )
}

// ── Main page ─────────────────────────────────────────────────────────────────

export function LauncherPage() {
  const { config, updateConfig } = useStore()
  const widgetGroupId = config.launcherWidgetGroupId ?? ''
  const setWidgetGroupId = (id: string) => updateConfig({ launcherWidgetGroupId: id })

  const [groups, setGroups] = useState<LauncherGroup[]>([])
  const [selectedId, setSelectedId] = useState<string | null>(null)
  const [launching, setLaunching] = useState<string | null>(null)
  const [launchFeedback, setLaunchFeedback] = useState<Record<string, string>>({})
  // Per-app launch errors keyed by app id. Set when a launch fails (missing
  // exe, dead shortcut target), cleared the moment the same app launches
  // successfully — individually or as part of a group run.
  const [appErrors, setAppErrors] = useState<Record<string, string>>({})
  const [addAppOpen, setAddAppOpen] = useState(false)
  const [addAppPrefill, setAddAppPrefill] = useState<{ path: string; name: string } | undefined>(undefined)
  const [iconPickerOpen, setIconPickerOpen] = useState(false)
  const [startMenuPath, setStartMenuPath] = useState<string | undefined>(undefined)

  const openAddApp = async (droppedPath?: string) => {
    if (droppedPath) {
      const resolved = await window.api.resolveShortcut(droppedPath)
      const name = resolved.replace(/.*[\\/]/, '').replace(/\.[^.]+$/, '')
      setAddAppPrefill({ path: resolved, name })
    } else {
      setAddAppPrefill(undefined)
    }
    setAddAppOpen(true)
  }

  // Mouse-drag reorder state
  const [dragState, setDragState] = useState<{
    groupId: string; dragIdx: number; startY: number; currentY: number; rowHeight: number
  } | null>(null)

  useEffect(() => {
    if (!dragState) return
    const onMove = (e: MouseEvent) =>
      setDragState(prev => prev ? { ...prev, currentY: e.clientY } : null)
    const onUp = () => {
      if (dragState) {
        const { groupId, dragIdx, startY, currentY, rowHeight } = dragState
        const group = groups.find(g => g.id === groupId)
        if (group) {
          const newIdx = Math.max(0, Math.min(group.apps.length - 1,
            dragIdx + Math.round((currentY - startY) / rowHeight)))
          if (newIdx !== dragIdx) reorderApps(groupId, dragIdx, newIdx)
        }
      }
      setDragState(null)
    }
    window.addEventListener('mousemove', onMove)
    window.addEventListener('mouseup', onUp)
    return () => { window.removeEventListener('mousemove', onMove); window.removeEventListener('mouseup', onUp) }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [dragState])

  useEffect(() => {
    window.api.getLauncherGroups().then(g => {
      setGroups(g)
      // Don't auto-select a group — the page opens to the full list with no
      // sidebar; the detail sidebar appears only when a row is clicked.
    })
    window.api.getStartMenuPath().then(setStartMenuPath).catch(() => {})
  }, [])

  const save = (updated: LauncherGroup[]) => {
    setGroups(updated)
    window.api.setLauncherGroups(updated)
    // Tell the sidebar widget (App.tsx) to refetch — it otherwise keeps the
    // snapshot from its mount and shows stale names/apps after edits here.
    window.dispatchEvent(new Event('sm:launcher-groups-changed'))
  }

  const addGroup = () => {
    const group: LauncherGroup = { id: uuidv4(), name: 'New Group', apps: [] }
    const updated = [...groups, group]
    save(updated)
    setSelectedId(group.id)
  }

  const updateGroup = (id: string, patch: Partial<LauncherGroup>) => {
    save(groups.map(g => g.id === id ? { ...g, ...patch } : g))
  }

  const removeGroup = (id: string) => {
    const updated = groups.filter(g => g.id !== id)
    save(updated)
    if (selectedId === id) setSelectedId(updated[0]?.id ?? null)
    // Deleting the pinned group must also unpin it, or the sidebar keeps a
    // ghost widget pointing at a group that no longer exists.
    if (widgetGroupId === id) setWidgetGroupId('')
  }

  const addApp = (groupId: string, app: LauncherApp) => {
    const group = groups.find(g => g.id === groupId)
    if (!group) return
    updateGroup(groupId, { apps: [...group.apps, app] })
  }

  const updateApp = (groupId: string, appId: string, updated: LauncherApp) => {
    const group = groups.find(g => g.id === groupId)
    if (!group) return
    updateGroup(groupId, { apps: group.apps.map(a => a.id === appId ? updated : a) })
  }

  const reorderApps = (groupId: string, fromIdx: number, toIdx: number) => {
    const group = groups.find(g => g.id === groupId)
    if (!group || fromIdx === toIdx) return
    const apps = [...group.apps]
    const [moved] = apps.splice(fromIdx, 1)
    apps.splice(toIdx, 0, moved)
    updateGroup(groupId, { apps })
  }

  const removeApp = (groupId: string, appId: string) => {
    const group = groups.find(g => g.id === groupId)
    if (!group) return
    updateGroup(groupId, { apps: group.apps.filter(a => a.id !== appId) })
  }

  const launchGroup = async (groupId: string) => {
    setLaunching(groupId)
    try {
      const result = await window.api.launchGroup(groupId)
      // Honest counts: shell.openPath failures used to be counted as
      // launched. Failures show as "N of M launched" and linger longer.
      const label = result.failed.length > 0
        ? `${result.launched} of ${result.launched + result.failed.length} launched`
        : `Launched ${result.launched}`
      setLaunchFeedback(prev => ({ ...prev, [groupId]: label }))
      setTimeout(() => setLaunchFeedback(prev => { const n = { ...prev }; delete n[groupId]; return n }),
        result.failed.length > 0 ? 4000 : 2000)
      // Pin failures to their app items; clear errors for everything in this
      // group that launched fine (a fixed path heals its chip on next run).
      const failedById = new Map(result.failed.map(f => [f.id, f.error]))
      const groupApps = groups.find(g => g.id === groupId)?.apps ?? []
      setAppErrors(prev => {
        const next = { ...prev }
        for (const a of groupApps) {
          if (failedById.has(a.id)) next[a.id] = failedById.get(a.id)!
          else if (a.path) delete next[a.id]
        }
        return next
      })
      // Successful launches also refresh their icons — a restored exe's icon
      // was fetched as the generic placeholder while the file was missing.
      for (const a of groupApps) {
        if (a.path && !failedById.has(a.id)) {
          window.dispatchEvent(new CustomEvent('sm:app-icon-refresh', { detail: a.path }))
        }
      }
    } finally {
      setLaunching(null)
    }
  }

  /** Single-app launch used by the sidebar rows and the group-row app icons.
   *  Returns success so callers only flash their "launched" state when the
   *  app actually opened; failure lands in appErrors for the chip + red
   *  button treatment. */
  const launchSingleApp = async (app: LauncherApp): Promise<boolean> => {
    if (!app.path) return false
    const res = await window.api.launchApp(app.path).catch(() => ({ launched: false as const, error: 'Launch failed' }))
    setAppErrors(prev => {
      const next = { ...prev }
      if (res.launched) delete next[app.id]
      else next[app.id] = res.error ?? 'Launch failed'
      return next
    })
    if (res.launched) {
      window.dispatchEvent(new CustomEvent('sm:app-icon-refresh', { detail: app.path }))
    }
    return res.launched
  }

  const selected = groups.find(g => g.id === selectedId) ?? null

  // Detail sidebar slide timing (respects the user's animation prefs) + the
  // last-opened group held through the close slide-out so its content doesn't
  // vanish before the sidebar finishes animating away.
  const anim = useAnimationConfig()
  const animMs = anim.duration(200)
  const [renderedGroupId, setRenderedGroupId] = useState<string | null>(null)
  useEffect(() => {
    if (selectedId) { setRenderedGroupId(selectedId); return }
    if (renderedGroupId === null) return
    const t = window.setTimeout(() => setRenderedGroupId(null), animMs)
    return () => clearTimeout(t)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedId, animMs])
  const sidebarGroup = groups.find(g => g.id === (selectedId ?? renderedGroupId)) ?? null

  const getItemStyle = (groupId: string, idx: number): React.CSSProperties => {
    if (!dragState || dragState.groupId !== groupId) return {}
    const { dragIdx, startY, currentY, rowHeight } = dragState
    const offset = currentY - startY
    const virtualIdx = Math.max(0, Math.min(
      (selected?.apps.length ?? 1) - 1,
      dragIdx + Math.round(offset / rowHeight)
    ))
    if (idx === dragIdx) {
      return { transform: `translateY(${offset}px)`, position: 'relative', zIndex: 10 }
    }
    if (virtualIdx > dragIdx && idx > dragIdx && idx <= virtualIdx) {
      return { transform: `translateY(-${rowHeight}px)`, transition: 'transform 150ms ease' }
    }
    if (virtualIdx < dragIdx && idx < dragIdx && idx >= virtualIdx) {
      return { transform: `translateY(${rowHeight}px)`, transition: 'transform 150ms ease' }
    }
    return { transform: 'translateY(0)', transition: 'transform 150ms ease' }
  }

  return (
    <>
    <div className="relative h-full overflow-hidden bg-navy-900">
      {/* List column (header + rows) sits full-width UNDER the sidebar overlay,
          so the sidebar covers the header's right portion too — only the left
          strip (the page title, and each row's icon + name) stays visible. */}
      <div className="absolute inset-0 flex flex-col">
        {/* Header — shrinks to the row strip when a group is open, in lockstep
            with the sidebar sliding over the rest. Its New Group button slides
            left with it and animates to icon-only, staying visible in the strip
            (mirrors the Streams header's collapsing buttons). */}
        <div
          className="flex items-center justify-between px-6 py-4 border-b border-white/5 shrink-0 transition-[width] ease-linear"
          style={{ width: selectedId ? `${GROUP_ROW_WIDTH}px` : '100%', transitionDuration: `${animMs}ms` }}
        >
          <h1 className="text-lg font-semibold shrink-0">Launcher</h1>
          <Button
            variant="primary"
            size="sm"
            icon={<Plus size={13} />}
            collapsibleLabel="@2xl:grid-cols-[1fr] @2xl:ms-0"
            labelCollapsed={!!selectedId}
            onClick={addGroup}
          >
            New Group
          </Button>
        </div>

        {/* Group list — full width so rows never reflow. */}
        <div className="flex-1 overflow-y-auto">
          {groups.length === 0 ? (
            <div className="flex flex-col items-center justify-center h-full gap-3 text-center px-8">
              <Rocket size={32} className="text-gray-400" />
              <p className="text-sm text-gray-400">Create a launch group to get started.</p>
              <Button variant="secondary" size="sm" icon={<Plus size={13} />} onClick={addGroup}>New Group</Button>
            </div>
          ) : (
            groups.map(group => (
              <GroupRow
                key={group.id}
                group={group}
                selected={selectedId === group.id}
                isWidget={widgetGroupId === group.id}
                launching={launching === group.id}
                feedback={launchFeedback[group.id]}
                appErrors={appErrors}
                animMs={animMs}
                onSelect={() => setSelectedId(selectedId === group.id ? null : group.id)}
                onLaunchGroup={() => launchGroup(group.id)}
                onLaunchApp={app => { void launchSingleApp(app) }}
                onToggleWidget={() => setWidgetGroupId(widgetGroupId === group.id ? '' : group.id)}
              />
            ))
          )}
        </div>
      </div>

      {/* Detail sidebar — fixed width, slides in from the right over BOTH the
          list rows and the header. Constant width so its content doesn't reflow
          mid-slide; only the left GROUP_ROW_WIDTH strip is left uncovered. */}
      <aside
        className="absolute top-0 right-0 bottom-0 bg-navy-800 border-l border-white/10 overflow-hidden shadow-2xl shadow-black/30"
        style={{
          width: `calc(100% - ${GROUP_ROW_WIDTH}px)`,
          transform: selectedId ? 'translateX(0)' : 'translateX(100%)',
          transition: `transform ${animMs}ms linear`,
          pointerEvents: selectedId ? 'auto' : 'none',
        }}
      >
        {sidebarGroup && (
          <div className="h-full flex flex-col">
            {/* Detail header — aligns with the page header band it overlays. */}
            <div className="flex items-center justify-between gap-3 px-6 py-4 border-b border-white/5 shrink-0">
              <div className="flex items-center gap-3 min-w-0">
                <Tooltip content="Change icon" side="bottom">
                  <button
                    onClick={() => setIconPickerOpen(true)}
                    className="shrink-0 w-9 h-9 flex items-center justify-center rounded-lg bg-white/5 hover:bg-white/10 text-gray-300 hover:text-gray-100 transition-colors"
                  >
                    <GroupIcon name={sidebarGroup.icon} size={18} />
                  </button>
                </Tooltip>
                <EditableLabel
                  value={sidebarGroup.name}
                  onSave={name => updateGroup(sidebarGroup.id, { name })}
                  placeholder="Group name"
                  className="text-lg font-semibold text-gray-200"
                />
              </div>
              <div className="flex items-center gap-1.5 shrink-0">
                <Tooltip content={widgetGroupId === sidebarGroup.id ? 'Remove from sidebar widget' : 'Pin to sidebar widget'} side="bottom">
                  <button
                    onClick={() => setWidgetGroupId(widgetGroupId === sidebarGroup.id ? '' : sidebarGroup.id)}
                    className={`p-1.5 rounded transition-colors ${
                      widgetGroupId === sidebarGroup.id ? 'text-yellow-400' : 'text-gray-400 hover:text-gray-200'
                    }`}
                  >
                    <Star size={15} className={widgetGroupId === sidebarGroup.id ? 'fill-yellow-400' : ''} />
                  </button>
                </Tooltip>
                <Tooltip content="Remove this group" side="bottom">
                  <button
                    onClick={() => removeGroup(sidebarGroup.id)}
                    className="p-1.5 text-gray-400 hover:text-red-400 transition-colors"
                  >
                    <Trash2 size={15} />
                  </button>
                </Tooltip>
                <Button
                  variant="primary"
                  size="sm"
                  icon={<Rocket size={13} />}
                  disabled={launching === sidebarGroup.id || sidebarGroup.apps.length === 0 || sidebarGroup.apps.every(a => !a.path)}
                  onClick={() => launchGroup(sidebarGroup.id)}
                >
                  {launchFeedback[sidebarGroup.id] ?? 'Launch All'}
                </Button>
                {/* Matches the streams detail sidebar's close control. */}
                <Tooltip content="Close" side="left">
                  <Button
                    variant="danger"
                    size="sm"
                    icon={<X size={14} />}
                    onClick={() => setSelectedId(null)}
                    aria-label="Close"
                  />
                </Tooltip>
              </div>
            </div>

            {/* App list */}
            <div className="flex-1 overflow-y-auto">
              {sidebarGroup.apps.length === 0 ? (
                <div className="flex flex-col items-center justify-center h-full px-12">
                  <AppDropZone onClick={() => openAddApp()} onFileDrop={openAddApp} />
                </div>
              ) : (
                <div
                  className="p-4 flex flex-col gap-1"
                  style={dragState ? { userSelect: 'none', cursor: 'grabbing' } : undefined}
                >
                  {sidebarGroup.apps.map((app, i) => (
                    <AppRow
                      key={app.id}
                      app={app}
                      onUpdate={updated => updateApp(sidebarGroup.id, app.id, updated)}
                      onRemove={() => removeApp(sidebarGroup.id, app.id)}
                      onLaunch={() => launchSingleApp(app)}
                      error={appErrors[app.id]}
                      defaultPath={startMenuPath}
                      isDragging={dragState?.groupId === sidebarGroup.id && dragState.dragIdx === i}
                      style={getItemStyle(sidebarGroup.id, i)}
                      onGripMouseDown={e => {
                        e.preventDefault()
                        const rowEl = (e.currentTarget as HTMLElement).closest('.group') as HTMLElement
                        const rowHeight = rowEl?.getBoundingClientRect().height ?? 48
                        setDragState({ groupId: sidebarGroup.id, dragIdx: i, startY: e.clientY, currentY: e.clientY, rowHeight })
                      }}
                    />
                  ))}
                  <div className="pt-2">
                    <AppDropZone compact onClick={() => openAddApp()} onFileDrop={openAddApp} />
                  </div>
                </div>
              )}
            </div>
          </div>
        )}
      </aside>
    </div>

    {selected && (() => {
      const currentPaths = new Set(selected.apps.map(a => a.path).filter(Boolean))
      const existingApps = groups
        .filter(g => g.id !== selected.id)
        .flatMap(g => g.apps)
        .filter(a => a.path && !currentPaths.has(a.path))
        .filter((a, i, arr) => arr.findIndex(b => b.path === a.path) === i)
      return (
        <AddAppModal
          isOpen={addAppOpen}
          onClose={() => setAddAppOpen(false)}
          onAdd={app => addApp(selected.id, app)}
          defaultPath={startMenuPath}
          existingApps={existingApps}
          prefill={addAppPrefill}
        />
      )
    })()}
    {selected && (
      <IconPickerModal
        isOpen={iconPickerOpen}
        onClose={() => setIconPickerOpen(false)}
        value={selected.icon}
        onChange={icon => updateGroup(selected.id, { icon })}
      />
    )}
    </>
  )
}
