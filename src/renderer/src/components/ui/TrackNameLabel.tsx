import React, { useEffect, useRef, useState } from 'react'
import { Tag, PencilLine, Settings2, CircleDashed } from 'lucide-react'
import { Tooltip } from './Tooltip'
import { TruncatedText } from './TruncatedText'
import { TRACK_NAME_SOURCE_HINT, type ResolvedTrackName } from '../../lib/trackNames'

/**
 * An audio track's name with a source icon and double-click rename
 * (PLR-23). The icon says where the name came from (renamed here, stored
 * in the recording, Settings default, or unnamed) and its tooltip carries
 * the rename hint, since the dense track rows have no room for a button.
 * Double-click opens an inline field: Enter saves, Escape cancels, an
 * empty value clears the rename so the embedded or default name returns.
 */
export function TrackNameLabel({ resolved, className = '', triggerClassName = '', onRename }: {
  resolved: ResolvedTrackName
  /** Classes for the name text (font size, color, truncate). */
  className?: string
  /** Classes for the wrapper (flex sizing in the row). */
  triggerClassName?: string
  /** Undefined clears the per-file rename. */
  onRename: (name: string | undefined) => void
}) {
  const [editing, setEditing] = useState(false)
  const [draft, setDraft] = useState('')
  const inputRef = useRef<HTMLInputElement>(null)
  useEffect(() => {
    if (editing) { inputRef.current?.focus(); inputRef.current?.select() }
  }, [editing])

  const begin = () => { setDraft(resolved.name); setEditing(true) }
  const commit = () => {
    const value = draft.trim()
    setEditing(false)
    if (!value) { onRename(undefined); return }
    // Saving the name it already shows is not a rename: keep the embedded
    // or default source rather than pinning a copy of it to the file.
    if (value === resolved.name && resolved.source !== 'override') return
    onRename(value)
  }

  const Icon = resolved.source === 'override' ? PencilLine
    : resolved.source === 'embedded' ? Tag
    : resolved.source === 'default' ? Settings2
    : CircleDashed
  const iconTone = resolved.source === 'override' ? 'text-accent-300' : 'text-gray-500'

  return (
    <span className={`inline-flex items-center gap-1 min-w-0 ${triggerClassName}`} onDoubleClick={e => { e.stopPropagation(); begin() }}>
      <Tooltip content={TRACK_NAME_SOURCE_HINT[resolved.source]} maxWidth="max-w-xs" triggerClassName="flex shrink-0">
        <Icon size={10} className={iconTone} />
      </Tooltip>
      {editing ? (
        <input
          ref={inputRef}
          value={draft}
          onChange={e => setDraft(e.target.value)}
          onKeyDown={e => {
            e.stopPropagation()
            if (e.key === 'Enter') commit()
            else if (e.key === 'Escape') setEditing(false)
          }}
          onBlur={commit}
          aria-label="Track name"
          className="min-w-0 flex-1 bg-navy-900 border border-accent-500/50 rounded px-1 py-0 text-[11px] leading-4 text-gray-200 focus:outline-none"
        />
      ) : (
        <TruncatedText text={resolved.name} className={className} triggerClassName="min-w-0 flex-1" />
      )}
    </span>
  )
}
