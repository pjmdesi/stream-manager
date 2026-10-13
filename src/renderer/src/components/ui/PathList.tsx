import React from 'react'
import { Folder } from 'lucide-react'
import { Tooltip } from './Tooltip'

/** The file and folder listing inside confirm and preview modals (stream
 *  delete, files-grid delete, reschedule preview, the converter's partial
 *  file prompt). One look for all of them: a dark box, monospace names
 *  truncated with the full path as tooltip, an optional folder line on
 *  top and an optional trailing note per row (a size, "In use"). Private
 *  copies had drifted in color, size and row shape (2026-10-12). */

export interface PathListItem {
  key: string
  /** The row's text: a file name, or "from → to" for a rename. */
  label: string
  /** Tooltip content, normally the full path. Defaults to the label. */
  tooltip?: React.ReactNode
  /** Right-aligned note: a size, "In use". */
  trailing?: React.ReactNode
  /** Red for a row that will fail or be skipped. */
  tone?: 'default' | 'danger'
  /** Struck through: listed for honesty but not acted on. */
  struck?: boolean
  /** Inline icon before the label (a warning triangle on a collision). */
  icon?: React.ReactNode
}

export function PathList({ folder, items, empty, maxHeight = 'max-h-64', className = '', children }: {
  /** Folder line shown above the rows, as given ("name/" or "from/ → to/"). */
  folder?: string
  items: PathListItem[]
  /** Shown when there are no items. */
  empty?: React.ReactNode
  /** Tailwind max-height class for the scroll box. */
  maxHeight?: string
  className?: string
  /** Replaces the rows while given: a loading or error state. */
  children?: React.ReactNode
}) {
  return (
    <div className={`bg-navy-900 border border-white/5 rounded-lg px-3 py-2.5 font-mono text-sm text-gray-200 ${maxHeight} overflow-y-auto ${className}`}>
      {folder && (
        <div className="flex items-center gap-1.5 text-gray-300 mb-1">
          <Folder size={13} className="shrink-0 text-gray-400" />
          <span className="truncate">{folder}</span>
        </div>
      )}
      {children != null ? children : items.length === 0 ? (
        <span className="text-gray-400 italic text-xs">{empty}</span>
      ) : items.map(i => (
        <div key={i.key} className={`flex items-center gap-1.5 py-px ${i.tone === 'danger' ? 'text-red-400' : ''}`}>
          <span className="shrink-0 text-gray-400">·</span>
          <Tooltip content={i.tooltip ?? i.label} maxWidth="max-w-md" triggerClassName="block min-w-0 flex-1">
            <span className={`block truncate ${i.struck ? 'line-through text-gray-400' : ''}`}>{i.icon}{i.label}</span>
          </Tooltip>
          {i.trailing != null && i.trailing !== '' && (
            <span className="shrink-0 text-xs text-gray-400">{i.trailing}</span>
          )}
        </div>
      ))}
    </div>
  )
}
