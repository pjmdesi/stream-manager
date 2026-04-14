import React, { useState, useEffect, useRef } from 'react'
import ReactDOM from 'react-dom'
import * as LucideIcons from 'lucide-react'
import { Plus, Trash2, FolderOpen, Rocket, Pencil, Check, X, GripVertical, ChevronDown, Upload, Star, Play } from 'lucide-react'
import { v4 as uuidv4 } from 'uuid'
import type { LauncherGroup, LauncherApp } from '../../types'
import { Button } from '../ui/Button'
import { Modal } from '../ui/Modal'
import { Tooltip } from '../ui/Tooltip'
import { IconPickerModal } from '../ui/IconPickerModal'
import { useStore } from '../../hooks/useStore'

function toPascal(name: string) {
  return name.split('-').map(s => s.charAt(0).toUpperCase() + s.slice(1)).join('')
}

function GroupIcon({ name, size = 14 }: { name?: string; size?: number }) {
  const Icon = name
    ? ((LucideIcons as Record<string, React.ComponentType<{ size?: number }>>)[toPascal(name)] ?? Rocket)
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
          className="flex-1 min-w-0 bg-navy-900 border border-purple-500/50 rounded px-2 py-0.5 text-sm text-gray-200 outline-none focus:ring-1 focus:ring-purple-500/50"
          placeholder={placeholder}
          autoFocus
        />
        <button onMouseDown={e => { e.preventDefault(); commit() }} className="text-green-400 hover:text-green-300 transition-colors">
          <Check size={13} />
        </button>
        <button onMouseDown={e => { e.preventDefault(); cancel() }} className="text-gray-500 hover:text-gray-300 transition-colors">
          <X size={13} />
        </button>
      </div>
    )
  }

  return (
    <button onClick={start} className={`group flex items-center gap-1.5 min-w-0 text-left ${className}`}>
      <span className="truncate">{value || <span className="text-gray-600 italic">{placeholder}</span>}</span>
      <Pencil size={11} className="shrink-0 opacity-0 group-hover:opacity-40 transition-opacity" />
    </button>
  )
}

// ── App icon (fetched from OS) ─────────────────────────────────────────────────

function AppIcon({ path, size = 20 }: { path: string; size?: number }) {
  const [iconUrl, setIconUrl] = useState<string | null>(null)

  useEffect(() => {
    if (!path) { setIconUrl(null); return }
    window.api.getFileIcon(path).then(setIconUrl).catch(() => setIconUrl(null))
  }, [path])

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
        <div className={`shrink-0 transition-colors ${isDragging ? 'text-purple-400' : 'text-gray-600'}`}>
          {isDragging ? <Upload size={14} /> : <Plus size={14} />}
        </div>
        <div className="pointer-events-none">
          <p className="text-gray-300 font-medium text-sm">Drop an app here or click to browse</p>
          <p className="text-gray-600 text-xs mt-0.5">Supports: .exe, .lnk</p>
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
          : <Plus size={24} className="text-gray-500" />
        }
      </div>
      <div className="text-center pointer-events-none">
        <p className="text-gray-300 font-medium">Drop an app here or click to browse</p>
        <p className="text-gray-600 text-sm mt-1">Supports: .exe, .lnk</p>
      </div>
    </div>
  )
}

// ── Add App modal ─────────────────────────────────────────────────────────────

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
      window.api.getFileIcon(prefill.path).then(setIconUrl).catch(() => setIconUrl(null))
    } else {
      setPath('')
      setName('')
      setIconUrl(null)
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
    } else {
      if (!path) return
      onAdd({ id: uuidv4(), name: name.trim() || path.replace(/.*[\\/]/, '').replace(/\.[^.]+$/, ''), path })
      onClose()
    }
  }

  const newAppMode = !selectedExisting

  return (
    <Modal isOpen={isOpen} onClose={onClose} title="Add App" width="sm">
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
                <span className="flex-1 text-gray-500">Select a previously linked app</span>
              )}
              <ChevronDown size={13} className={`shrink-0 text-gray-500 transition-transform ${dropdownOpen ? 'rotate-180' : ''}`} />
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
                    className="w-full text-left px-3 py-2 text-xs text-gray-500 hover:bg-white/5 transition-colors border-b border-white/5"
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

        {/* Path picker — hidden when an existing app is selected */}
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
                <span className="text-sm text-gray-600">No file selected…</span>
              )}
            </div>
            <Button variant="secondary" size="sm" icon={<FolderOpen size={14} />} onClick={browse}>
              Browse
            </Button>
          </div>
          {path && (
            <p className="text-[11px] text-gray-600 font-mono truncate px-1">{path}</p>
          )}
        </div>

        {/* Icon + name — hidden when an existing app is selected */}
        <div className={`flex flex-col gap-1.5 ${!newAppMode ? 'opacity-40 pointer-events-none select-none' : ''}`}>
          <label className="text-xs font-medium text-gray-400 uppercase tracking-wider">Name</label>
          <div className="flex items-center gap-2">
            {iconUrl && (
              <img src={iconUrl} alt="" className="w-8 h-8 shrink-0 object-contain rounded" />
            )}
            <input
              value={name}
              onChange={e => setName(e.target.value)}
              onKeyDown={e => { if (e.key === 'Enter') confirm() }}
              placeholder="App name"
              disabled={!newAppMode}
              className="flex-1 bg-navy-900 border border-white/10 text-gray-200 text-sm rounded-lg px-3 py-2 focus:outline-none focus:ring-2 focus:ring-purple-500/50 disabled:cursor-not-allowed"
            />
          </div>
        </div>

        <div className="flex justify-end gap-2 pt-1">
          <Button variant="secondary" size="sm" onClick={onClose}>Cancel</Button>
          <Button variant="primary" size="sm" disabled={!selectedExisting && !path} onClick={confirm}>Add App</Button>
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
  defaultPath,
  isDragging,
  style,
  onGripMouseDown,
}: {
  app: LauncherApp
  onUpdate: (updated: LauncherApp) => void
  onRemove: () => void
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
    await window.api.launchApp(app.path)
    setLaunched(true)
    setTimeout(() => setLaunched(false), 2000)
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
        className="text-gray-600 shrink-0 cursor-grab active:cursor-grabbing"
        onMouseDown={onGripMouseDown}
      />
      <AppIcon path={app.path} size={20} />
      <div className="flex-1 min-w-0 flex flex-col gap-0.5">
        <EditableLabel
          value={app.name}
          onSave={name => onUpdate({ ...app, name })}
          placeholder="App name"
          className="text-sm font-medium text-gray-200"
        />
        <div className="flex items-center gap-1 min-w-0">
          <span className="text-xs text-gray-500 truncate font-mono">
            {app.path || <span className="text-gray-700 not-italic">No path set</span>}
          </span>
          <Tooltip content="Change executable" side="top">
            <button
              onClick={browsePath}
              className="shrink-0 p-0.5 text-gray-600 hover:text-gray-300 transition-colors opacity-0 group-hover:opacity-100"
            >
              <FolderOpen size={12} />
            </button>
          </Tooltip>
        </div>
      </div>
      <Tooltip content={launched ? 'Launched!' : 'Launch'} side="left">
        <button
          onClick={launch}
          disabled={!app.path}
          className={`shrink-0 p-1 transition-colors opacity-0 group-hover:opacity-100 disabled:pointer-events-none ${
            launched ? 'text-green-400' : 'text-gray-600 hover:text-green-400'
          }`}
        >
          <Play size={13} />
        </button>
      </Tooltip>
      <Tooltip content="Remove" side="left">
        <button
          onClick={onRemove}
          className="shrink-0 p-1 text-gray-700 hover:text-red-400 transition-colors opacity-0 group-hover:opacity-100"
        >
          <Trash2 size={13} />
        </button>
      </Tooltip>
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
  const [launchFeedback, setLaunchFeedback] = useState<Record<string, number>>({})
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
      if (g.length > 0 && !selectedId) setSelectedId(g[0].id)
    })
    window.api.getStartMenuPath().then(setStartMenuPath).catch(() => {})
  }, [])

  const save = (updated: LauncherGroup[]) => {
    setGroups(updated)
    window.api.setLauncherGroups(updated)
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
      setLaunchFeedback(prev => ({ ...prev, [groupId]: result.launched }))
      setTimeout(() => setLaunchFeedback(prev => { const n = { ...prev }; delete n[groupId]; return n }), 2000)
    } finally {
      setLaunching(null)
    }
  }

  const selected = groups.find(g => g.id === selectedId) ?? null

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
    <div className="flex h-full overflow-hidden">
      {/* Left: group list */}
      <div className="w-56 bg-navy-800 border-r border-white/5 flex flex-col shrink-0">
        <div className="px-4 py-3 border-b border-white/5 shrink-0">
          <h3 className="text-xs font-semibold text-gray-400 uppercase tracking-wider">Launch Groups</h3>
        </div>
        <div className="flex-1 overflow-y-auto py-1">
          {groups.map(group => {
            const isPinned = widgetGroupId === group.id
            const isSelected = selectedId === group.id
            return (
              <div
                key={group.id}
                className={`group/row flex items-center transition-colors ${
                  isSelected ? 'bg-purple-600/20' : 'hover:bg-white/5'
                }`}
              >
                <button
                  onClick={() => setSelectedId(group.id)}
                  className={`flex-1 flex items-center gap-2 pl-3 pr-1 py-2 text-sm text-left transition-colors min-w-0 ${
                    isSelected ? 'text-purple-300' : 'text-gray-400 hover:text-gray-200'
                  }`}
                >
                  <GroupIcon name={group.icon} size={14} />
                  <span className="flex-1 truncate">{group.name}</span>
                  <span className="text-[10px] text-gray-600 shrink-0">{group.apps.length}</span>
                </button>
                <Tooltip content={isPinned ? 'Remove from sidebar widget' : 'Pin to sidebar widget'} side="right">
                  <button
                    onClick={() => setWidgetGroupId(isPinned ? '' : group.id)}
                    className={`shrink-0 px-2 py-2 transition-colors ${
                      isPinned
                        ? 'text-yellow-400'
                        : 'text-gray-700 opacity-0 group-hover/row:opacity-100 hover:text-gray-400'
                    }`}
                  >
                    <Star size={12} className={isPinned ? 'fill-yellow-400' : ''} />
                  </button>
                </Tooltip>
              </div>
            )
          })}
        </div>
        <div className="p-2 border-t border-white/5 shrink-0">
          <Button variant="ghost" size="sm" icon={<Plus size={13} />} className="w-full justify-center" onClick={addGroup}>
            New Group
          </Button>
        </div>
      </div>

      {/* Right: selected group detail */}
      <div className="flex-1 flex flex-col overflow-hidden">
        {selected ? (
          <>
            {/* Header */}
            <div className="flex items-center justify-between px-6 py-4 border-b border-white/5 shrink-0">
              <div className="flex items-center gap-3 min-w-0">
                <Tooltip content="Change icon" side="bottom">
                  <button
                    onClick={() => setIconPickerOpen(true)}
                    className="shrink-0 w-9 h-9 flex items-center justify-center rounded-lg bg-white/5 hover:bg-white/10 text-gray-400 hover:text-gray-200 transition-colors"
                  >
                    <GroupIcon name={selected.icon} size={18} />
                  </button>
                </Tooltip>
                <EditableLabel
                  value={selected.name}
                  onSave={name => updateGroup(selected.id, { name })}
                  placeholder="Group name"
                  className="text-lg font-semibold text-gray-200"
                />
              </div>
              <div className="flex items-center gap-2">
                {widgetGroupId === selected.id && (
                  <span className="flex items-center gap-1 text-[10px] text-yellow-400/80 bg-yellow-400/10 border border-yellow-400/20 rounded px-1.5 py-0.5">
                    <Star size={9} className="fill-yellow-400/80" />
                    Sidebar widget
                  </span>
                )}
                <Tooltip content="Remove this group" side="left">
                  <button
                    onClick={() => removeGroup(selected.id)}
                    className="p-1.5 text-gray-600 hover:text-red-400 transition-colors"
                  >
                    <Trash2 size={15} />
                  </button>
                </Tooltip>
                <Button
                  variant="primary"
                  size="sm"
                  icon={<Rocket size={13} />}
                  disabled={launching === selected.id || selected.apps.length === 0 || selected.apps.every(a => !a.path)}
                  onClick={() => launchGroup(selected.id)}
                >
                  {launchFeedback[selected.id] != null
                    ? `Launched ${launchFeedback[selected.id]}`
                    : 'Launch All'
                  }
                </Button>
              </div>
            </div>

            {/* App list */}
            <div className="flex-1 overflow-y-auto">
              {selected.apps.length === 0 ? (
                <div className="flex flex-col items-center justify-center h-full px-12">
                  <AppDropZone onClick={() => openAddApp()} onFileDrop={openAddApp} />
                </div>
              ) : (
                <div
                  className="p-4 flex flex-col gap-1"
                  style={dragState ? { userSelect: 'none', cursor: 'grabbing' } : undefined}
                >
                  {selected.apps.map((app, i) => (
                    <AppRow
                      key={app.id}
                      app={app}
                      onUpdate={updated => updateApp(selected.id, app.id, updated)}
                      onRemove={() => removeApp(selected.id, app.id)}
                      defaultPath={startMenuPath}
                      isDragging={dragState?.groupId === selected.id && dragState.dragIdx === i}
                      style={getItemStyle(selected.id, i)}
                      onGripMouseDown={e => {
                        e.preventDefault()
                        const rowEl = (e.currentTarget as HTMLElement).closest('.group') as HTMLElement
                        const rowHeight = rowEl?.getBoundingClientRect().height ?? 48
                        setDragState({ groupId: selected.id, dragIdx: i, startY: e.clientY, currentY: e.clientY, rowHeight })
                      }}
                    />
                  ))}
                  <div className="pt-2">
                    <AppDropZone compact onClick={() => openAddApp()} onFileDrop={openAddApp} />
                  </div>
                </div>
              )}
            </div>
          </>
        ) : (
          <div className="flex flex-col items-center justify-center h-full gap-3 text-center px-8">
            <Rocket size={32} className="text-gray-700" />
            <p className="text-sm text-gray-500">Create a launch group to get started.</p>
            <Button variant="secondary" size="sm" icon={<Plus size={13} />} onClick={addGroup}>
              New Group
            </Button>
          </div>
        )}
      </div>
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
