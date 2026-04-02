import React, { useState, useRef } from 'react'
import { Upload, Film } from 'lucide-react'

interface FileDropZoneProps {
  onFiles: (paths: string[]) => void
  accept?: string[]
  className?: string
  children?: React.ReactNode
  label?: string
}

export const FileDropZone: React.FC<FileDropZoneProps> = ({
  onFiles,
  accept,
  className = '',
  children,
  label = 'Drop files here or click to browse'
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
            // In Electron, files have a path property
            const path = (file as any).path
            if (path) paths.push(path)
          }
        }
      }
    }

    if (paths.length > 0) {
      onFiles(paths)
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
            <div className="text-purple-300 font-medium">Drop files here</div>
          </div>
        )}
        {children}
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
          <Film size={32} className="text-gray-500" />
        )}
      </div>
      <div className="text-center">
        <p className="text-gray-300 font-medium">{label}</p>
        {accept && (
          <p className="text-gray-600 text-sm mt-1">
            Supports: {accept.join(', ')}
          </p>
        )}
      </div>
    </div>
  )
}
