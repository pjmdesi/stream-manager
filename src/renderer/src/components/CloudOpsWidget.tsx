import { Cloud, RefreshCw } from 'lucide-react'
import { Tooltip } from './ui/Tooltip'
import { useCloudOps } from '../context/CloudOpsContext'

const TERMINAL = new Set(['done', 'already-offline', 'already-local', 'failed', 'skipped-protected', 'cancelled'])

/**
 * Sidebar widget that surfaces in-flight cloud operations (offload + pin/
 * hydrate combined). Visible only while at least one direction has a pending
 * or running file. Click reopens the CloudOpsModal so the user can review
 * detail or cancel.
 *
 * The progress bar is a simple x/y file count — Cloud Files API gives us
 * per-file callbacks but no inner progress on the actual download/upload, so
 * percent-of-bytes would be a lie.
 */
export function CloudOpsWidget({ collapsed }: { collapsed: boolean }) {
  const { offloadItems, hydrateItems, offloadActive, hydrateActive, openModal } = useCloudOps()

  if (!offloadActive && !hydrateActive) return null

  const all = [...offloadItems, ...hydrateItems]
  const total = all.length
  const completed = all.filter(it => TERMINAL.has(it.status)).length
  const percent = total > 0 ? (completed / total) * 100 : 0

  const tooltipLabel = (() => {
    const parts: string[] = []
    if (offloadActive) parts.push('Offloading')
    if (hydrateActive) parts.push('Downloading')
    return `${parts.join(' & ')} · ${completed} / ${total}`
  })()

  if (collapsed) {
    return (
      <Tooltip content={tooltipLabel} side="right" triggerClassName="block w-full">
        <button
          onClick={openModal}
          className="w-full flex flex-col items-center gap-0.5 py-2.5 bg-navy-900 border-y border-white/5 hover:border-white/10 hover:bg-white/5 transition-colors"
        >
          <Cloud size={14} className="text-cyan-300" />
          <span className="text-[10px] tabular-nums text-cyan-300">{completed}/{total}</span>
          <RefreshCw size={10} className="text-cyan-300 animate-spin" />
        </button>
      </Tooltip>
    )
  }

  const label =
    offloadActive && hydrateActive ? 'Syncing' :
    offloadActive ? 'Offloading' :
    'Downloading'

  return (
    <button
      onClick={openModal}
      className="w-full p-3 bg-navy-900 border-y border-white/5 hover:border-white/10 hover:bg-white/5 transition-colors text-left"
    >
      <div className="flex items-center justify-between mb-2">
        <span className="text-[10px] font-semibold uppercase tracking-wider text-gray-500 flex items-center gap-1.5">
          <Cloud size={11} className="text-cyan-300" />
          Cloud sync
        </span>
        <span className="text-[10px] font-medium text-cyan-300">{label}</span>
      </div>
      <div className="h-1 w-full bg-white/10 rounded-full overflow-hidden">
        <div
          className="h-full rounded-full transition-all bg-cyan-400"
          style={{ width: `${percent}%` }}
        />
      </div>
      <div className="mt-1.5 text-[10px] text-gray-600 tabular-nums flex items-center justify-between">
        <span>{completed} / {total} files</span>
        <RefreshCw size={10} className="text-cyan-300 animate-spin" />
      </div>
    </button>
  )
}
