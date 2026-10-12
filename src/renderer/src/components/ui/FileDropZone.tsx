import React, { useState, useRef, useEffect } from 'react'
import { Upload, Film } from 'lucide-react'
import { Tooltip } from './Tooltip'
import { resolveDroppedPaths, dropNotice } from '../../lib/droppedPaths'

/** How many accepted extensions the empty state names before "and N more";
 *  the full list is the line's tooltip. The video list is 21 long. */
const SUPPORTS_SHOWN = 7
/** How long a skip notice stays before the zone's own text returns. */
const NOTICE_MS = 10_000

interface FileDropZoneProps {
  /** `opts.ctrlKey` reflects the modifier held at DROP time (false for
   *  click-to-browse) — the files grid uses it for move-vs-copy. */
  onFiles: (paths: string[], opts?: { ctrlKey: boolean }) => void
  accept?: readonly string[]
  className?: string
  children?: React.ReactNode
  label?: string
  /** Overlay text for the children variant (defaults to "Drop files here"). */
  overlayLabel?: string
  /** Slim single-row variant (icon + short label, no supported-types line) for
   *  embedding inside a list as an inline "add more" affordance. */
  compact?: boolean
  /** Name shown for the extension filter in the browse dialog. Defaults to
   *  "Media Files" — pass the honest name when the zone accepts something
   *  else (e.g. "OAuth client JSON"). */
  browseFilterName?: string
  /** Folder the browse dialog opens in. Omit for the app default (streams
   *  root, then Videos); pass `'downloads'` when the expected file was just
   *  downloaded. */
  browseStartIn?: string | 'downloads'
}

export const FileDropZone: React.FC<FileDropZoneProps> = ({
  onFiles,
  accept,
  className = '',
  children,
  label = 'Drop files here or click to browse',
  overlayLabel = 'Drop files here',
  compact = false,
  browseFilterName = 'Media Files',
  browseStartIn,
}) => {
  const [isDragging, setIsDragging] = useState(false)
  // What the last drop left out (files of other types, folders with
  // nothing usable). Shown in the zone so the user who dropped the wrong
  // thing sees why nothing happened; it clears on the next drag, drop,
  // browse or click, or on its own after NOTICE_MS (left alone it read as
  // the zone's permanent text).
  const [notice, setNotice] = useState<string | null>(null)
  useEffect(() => {
    if (!notice) return
    const t = setTimeout(() => setNotice(null), NOTICE_MS)
    return () => clearTimeout(t)
  }, [notice])
  const inputRef = useRef<HTMLInputElement>(null)

  const handleDrop = async (e: React.DragEvent) => {
    e.preventDefault()
    setIsDragging(false)
    setNotice(null)
    const ctrlKey = e.ctrlKey

    const paths: string[] = []
    const items = e.dataTransfer.items

    if (items) {
      for (let i = 0; i < items.length; i++) {
        const item = items[i]
        if (item.kind === 'file') {
          const file = item.getAsFile()
          if (file) {
            const path = window.api.getPathForFile(file)
            if (path) paths.push(path)
          }
        }
      }
    }
    if (paths.length === 0) return

    // With an accept list, folders expand to the accepted files inside
    // them and files of other types are left out (CONV-13); a dropped
    // folder used to arrive as one "file" and fail downstream.
    const resolved = await resolveDroppedPaths(paths, accept)
    setNotice(dropNotice(resolved, paths.length))
    if (resolved.files.length > 0) {
      onFiles(resolved.files, { ctrlKey })
    }
  }

  const handleDragOver = (e: React.DragEvent) => {
    e.preventDefault()
    setIsDragging(true)
    if (notice) setNotice(null)
  }

  const handleBrowse = async () => {
    setNotice(null)
    const extensions = accept?.map(ext => ext.replace('.', ''))
    const paths = await window.api.openFileDialog({
      filters: extensions
        ? [{ name: browseFilterName, extensions }]
        : [{ name: 'All Files', extensions: ['*'] }],
      properties: ['openFile', 'multiSelections'],
      ...(browseStartIn === 'downloads' ? { startIn: 'downloads' as const } : browseStartIn ? { defaultPath: browseStartIn } : {}),
    })
    if (paths && paths.length > 0) {
      // The dialog filters by type, but a typed name or "*" in the file
      // name box gets past the filter on Windows, so a pick is checked
      // the same way a drop is.
      const resolved = await resolveDroppedPaths(paths, accept)
      setNotice(dropNotice(resolved, paths.length))
      if (resolved.files.length > 0) onFiles(resolved.files)
    }
  }

  if (children) {
    return (
      <div
        className={`relative ${className}`}
        onDragOver={handleDragOver}
        onDragLeave={() => setIsDragging(false)}
        onDrop={handleDrop}
        onClickCapture={() => { if (notice) setNotice(null) }}
      >
        {isDragging && (
          <div className="absolute inset-0 bg-accent-600/20 border-2 border-dashed border-accent-500 rounded-xl z-10 flex items-center justify-center pointer-events-none">
            <div className="text-accent-300 font-medium text-center px-4">{overlayLabel}</div>
          </div>
        )}
        {notice && !isDragging && (
          <div className="absolute inset-x-0 top-3 z-10 flex justify-center pointer-events-none">
            <div className="bg-navy-800/90 border border-amber-500/40 text-amber-300 text-xs rounded-lg px-3 py-1.5">{notice}</div>
          </div>
        )}
        {children}
      </div>
    )
  }

  if (compact) {
    return (
      <div
        className={`
          relative flex items-center justify-center gap-2 px-4 py-3
          border-2 border-dashed rounded-lg cursor-pointer transition-all duration-200
          ${isDragging
            ? 'border-accent-500 bg-accent-600/10'
            : 'border-white/10 hover:border-accent-500/50 hover:bg-accent-600/5'
          }
          ${className}
        `}
        onDragOver={handleDragOver}
        onDragLeave={() => setIsDragging(false)}
        onDrop={handleDrop}
        onClick={handleBrowse}
      >
        {isDragging
          ? <Upload size={16} className="text-accent-400" />
          : <Film size={16} className="text-gray-400" />}
        <p className={`text-xs ${notice ? 'text-amber-300' : 'text-gray-400'}`}>{notice ?? label}</p>
      </div>
    )
  }

  return (
    <div
      className={`
        relative flex flex-col items-center justify-center gap-4 p-8
        border-2 border-dashed rounded-xl cursor-pointer transition-all duration-200
        ${isDragging
          ? 'border-accent-500 bg-accent-600/10'
          : 'border-white/10 bg-white/2 hover:border-accent-500/50 hover:bg-accent-600/5'
        }
        ${className}
      `}
      onDragOver={handleDragOver}
      onDragLeave={() => setIsDragging(false)}
      onDrop={handleDrop}
      onClick={handleBrowse}
    >
      <div className={`p-4 rounded-full transition-colors ${isDragging ? 'bg-accent-600/20' : 'bg-white/5'}`}>
        {isDragging ? (
          <Upload size={32} className="text-accent-400" />
        ) : (
          <Film size={32} className="text-gray-400" />
        )}
      </div>
      <div className="text-center">
        <p className="text-gray-300 font-medium">{label}</p>
        {accept && accept.length > SUPPORTS_SHOWN + 1 ? (
          <Tooltip content={accept.join(', ')} triggerClassName="flex justify-center">
            <p className="text-gray-400 text-sm mt-1">
              Supports: {accept.slice(0, SUPPORTS_SHOWN).join(', ')} and {accept.length - SUPPORTS_SHOWN} more
            </p>
          </Tooltip>
        ) : accept && (
          <p className="text-gray-400 text-sm mt-1">
            Supports: {accept.join(', ')}
          </p>
        )}
        {notice && (
          <p className="text-amber-300 text-sm mt-2">{notice}</p>
        )}
      </div>
    </div>
  )
}
