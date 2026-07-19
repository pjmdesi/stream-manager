import React, { useState, useRef } from 'react'
import { Upload, Film } from 'lucide-react'

interface FileDropZoneProps {
  /** `opts.ctrlKey` reflects the modifier held at DROP time (false for
   *  click-to-browse) — the files grid uses it for move-vs-copy. */
  onFiles: (paths: string[], opts?: { ctrlKey: boolean }) => void
  accept?: string[]
  className?: string
  children?: React.ReactNode
  label?: string
  /** Overlay text for the children variant (defaults to "Drop files here"). */
  overlayLabel?: string
  /** Slim single-row variant (icon + short label, no supported-types line) for
   *  embedding inside a list as an inline "add more" affordance. */
  compact?: boolean
}

export const FileDropZone: React.FC<FileDropZoneProps> = ({
  onFiles,
  accept,
  className = '',
  children,
  label = 'Drop files here or click to browse',
  overlayLabel = 'Drop files here',
  compact = false
}) => {
  const [isDragging, setIsDragging] = useState(false)
  const inputRef = useRef<HTMLInputElement>(null)

  const handleDrop = (e: React.DragEvent) => {
    e.preventDefault()
    setIsDragging(false)

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

    if (paths.length > 0) {
      onFiles(paths, { ctrlKey: e.ctrlKey })
    }
  }

  const handleBrowse = async () => {
    const extensions = accept?.map(ext => ext.replace('.', ''))
    const paths = await window.api.openFileDialog({
      filters: extensions
        ? [{ name: 'Media Files', extensions }]
        : [{ name: 'All Files', extensions: ['*'] }],
      properties: ['openFile', 'multiSelections']
    })
    if (paths && paths.length > 0) {
      onFiles(paths)
    }
  }

  if (children) {
    return (
      <div
        className={`relative ${className}`}
        onDragOver={e => { e.preventDefault(); setIsDragging(true) }}
        onDragLeave={() => setIsDragging(false)}
        onDrop={handleDrop}
      >
        {isDragging && (
          <div className="absolute inset-0 bg-purple-600/20 border-2 border-dashed border-purple-500 rounded-xl z-10 flex items-center justify-center pointer-events-none">
            <div className="text-purple-300 font-medium text-center px-4">{overlayLabel}</div>
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
            ? 'border-purple-500 bg-purple-600/10'
            : 'border-white/10 hover:border-purple-500/50 hover:bg-purple-600/5'
          }
          ${className}
        `}
        onDragOver={e => { e.preventDefault(); setIsDragging(true) }}
        onDragLeave={() => setIsDragging(false)}
        onDrop={handleDrop}
        onClick={handleBrowse}
      >
        {isDragging
          ? <Upload size={16} className="text-purple-400" />
          : <Film size={16} className="text-gray-400" />}
        <p className="text-xs text-gray-400">{label}</p>
      </div>
    )
  }

  return (
    <div
      className={`
        relative flex flex-col items-center justify-center gap-4 p-8
        border-2 border-dashed rounded-xl cursor-pointer transition-all duration-200
        ${isDragging
          ? 'border-purple-500 bg-purple-600/10'
          : 'border-white/10 bg-white/2 hover:border-purple-500/50 hover:bg-purple-600/5'
        }
        ${className}
      `}
      onDragOver={e => { e.preventDefault(); setIsDragging(true) }}
      onDragLeave={() => setIsDragging(false)}
      onDrop={handleDrop}
      onClick={handleBrowse}
    >
      <div className={`p-4 rounded-full transition-colors ${isDragging ? 'bg-purple-600/20' : 'bg-white/5'}`}>
        {isDragging ? (
          <Upload size={32} className="text-purple-400" />
        ) : (
          <Film size={32} className="text-gray-400" />
        )}
      </div>
      <div className="text-center">
        <p className="text-gray-300 font-medium">{label}</p>
        {accept && (
          <p className="text-gray-400 text-sm mt-1">
            Supports: {accept.join(', ')}
          </p>
        )}
      </div>
    </div>
  )
}
