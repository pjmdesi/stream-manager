import React, { useState, useMemo, useEffect, useRef } from 'react'
import { Search, X } from 'lucide-react'
import { Modal } from './Modal'
import { Tooltip } from './Tooltip'
import { lucideIcon, type LucideIconComponent } from '../../lib/lucideIcon'
import tagsRaw from '../../assets/lucide-tags.json'

const tags = tagsRaw as Record<string, string[]>

// Build the full searchable icon list once at module load. Tag entries the
// installed Lucide no longer exports are dropped rather than shown blank.
const ALL_ICONS: { name: string; Icon: LucideIconComponent }[] = Object.keys(tags)
  .flatMap(name => { const Icon = lucideIcon(name); return Icon ? [{ name, Icon }] : [] })

interface IconPickerModalProps {
  isOpen: boolean
  onClose: () => void
  value?: string
  onChange: (name: string) => void
}

export function IconPickerModal({ isOpen, onClose, value, onChange }: IconPickerModalProps) {
  const [query, setQuery] = useState('')
  const inputRef = useRef<HTMLInputElement>(null)

  useEffect(() => {
    if (isOpen) {
      setQuery('')
      setTimeout(() => inputRef.current?.focus(), 50)
    }
  }, [isOpen])

  const filtered = useMemo(() => {
    const q = query.toLowerCase().trim()
    if (!q) return ALL_ICONS
    return ALL_ICONS.filter(({ name }) => {
      if (name.replace(/-/g, ' ').includes(q)) return true
      return (tags[name] ?? []).some(t => t.toLowerCase().includes(q))
    })
  }, [query])

  const select = (name: string) => {
    onChange(name)
    onClose()
  }

  return (
    <Modal isOpen={isOpen} onClose={onClose} title="Choose Icon" width="2xl">
      <div className="flex flex-col gap-3">

        {/* Search */}
        <div className="relative">
          <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400 pointer-events-none" />
          <input
            ref={inputRef}
            value={query}
            onChange={e => setQuery(e.target.value)}
            onKeyDown={e => { if (e.key === 'Escape') { e.stopPropagation(); onClose() } }}
            placeholder="Search by name or keyword…"
            className="w-full bg-navy-900 border border-white/10 text-gray-200 text-sm rounded-lg pl-8 pr-8 py-2 focus:outline-none focus:ring-2 focus:ring-accent-500/50"
          />
          {query && (
            <button
              onClick={() => setQuery('')}
              className="absolute right-2.5 top-1/2 -translate-y-1/2 text-gray-400 hover:text-gray-400 transition-colors"
            >
              <X size={13} />
            </button>
          )}
        </div>

        {/* Grid */}
        <div className="h-[520px] overflow-y-auto pr-1">
          {filtered.length === 0 ? (
            <p className="text-sm text-gray-400 text-center py-10">No icons found for "{query}"</p>
          ) : (
            <>
              <div className="grid grid-cols-[repeat(auto-fill,minmax(52px,1fr))] gap-1">
                {filtered.map(({ name, Icon }) => {
                  const isSelected = value === name
                  return (
                    <Tooltip key={name} content={name} triggerClassName="block">
                    <button
                      onClick={() => select(name)}
                      className={`w-full flex flex-col items-center justify-center h-12 rounded-lg transition-colors ${
                        isSelected
                          ? 'bg-accent-600/30 text-accent-300 ring-1 ring-accent-500/50'
                          : 'text-gray-300 hover:bg-white/5 hover:text-white'
                      }`}
                    >
                      <Icon size={18} />
                    </button>
                    </Tooltip>
                  )
                })}
              </div>
            </>
          )}
        </div>

      </div>
    </Modal>
  )
}
