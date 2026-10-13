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
  /** The row's text: a file name, or the "from" side of a rename. */
  label: string
  /** The "to" side of a rename. Both sides then truncate on their own, so
   *  the arrow stays in view and roughly centered when names are long. */
  to?: string
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

/** "from → to" where each side takes what it needs and, when both do not
 *  fit, they share the width equally and truncate. `max-w-max` keeps a
 *  short side from being padded out to its half. */
function Rename({ from, to, icon }: { from: React.ReactNode; to: string; icon?: React.ReactNode }) {
  return (
    <span className="flex items-center min-w-0 gap-1.5">
      <span className="truncate flex-1 min-w-0 max-w-max">{icon}{from}</span>
      <span className="shrink-0 text-gray-400">→</span>
      <span className="truncate flex-1 min-w-0 max-w-max">{to}</span>
    </span>
  )
}

export function PathList({ folder, folderTo, items, empty, maxHeight = 'max-h-64', className = '', children }: {
  /** Folder line shown above the rows, as given ("name/"). */
  folder?: string
  /** With `folder`, renders the folder line as a rename ("from/ → to/"). */
  folderTo?: string
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
        <div className="flex items-center gap-1.5 text-gray-300 mb-1 min-w-0">
          <Folder size={13} className="shrink-0 text-gray-400" />
          {folderTo ? <Rename from={folder} to={folderTo} /> : <span className="truncate">{folder}</span>}
        </div>
      )}
      {children != null ? children : items.length === 0 ? (
        <span className="text-gray-400 italic text-xs">{empty}</span>
      ) : items.map(i => (
        <div key={i.key} className={`flex items-center gap-1.5 py-px ${i.tone === 'danger' ? 'text-red-400' : ''}`}>
          <span className="shrink-0 text-gray-400">·</span>
          <Tooltip content={i.tooltip ?? (i.to ? `${i.label} → ${i.to}` : i.label)} maxWidth="max-w-md" triggerClassName="block min-w-0 flex-1">
            {i.to
              ? <Rename from={i.label} to={i.to} icon={i.icon} />
              : <span className={`block truncate ${i.struck ? 'line-through text-gray-400' : ''}`}>{i.icon}{i.label}</span>}
          </Tooltip>
          {i.trailing != null && i.trailing !== '' && (
            <span className="shrink-0 text-xs text-gray-400">{i.trailing}</span>
          )}
        </div>
      ))}
    </div>
  )
}
