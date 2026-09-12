import React from 'react'
import { RefreshCw, Loader2 } from 'lucide-react'
import { Tooltip } from '../ui/Tooltip'
import { Twitch as LucideTwitch } from '../ui/BrandIcons'
import { renderStreamTitle } from '../../lib/streamTitle'
import type { StreamFolder } from '../../types'

/**
 * Sidebar empty-state panel (STR-18): what the Twitch channel currently
 * shows (title, category, tags) and which stream item those details came
 * from, so the user can tell what the channel is set to without opening the
 * stream they believe it should be. Read-only by design: Twitch's channel
 * info is one global blob that SM's post-stream auto-update also writes, and
 * a manual edit here would have to reconcile with that; pushes stay on the
 * stream items. Sits above the YouTube out-of-sync panel, whose height
 * varies with its list.
 */
export function TwitchChannelPanel({
  channel, checkedAt, loading, error, offline, sourceFolder, folders,
  onRefresh, onOpenStream,
}: {
  channel: { title: string; gameName: string; tags: string[] } | null
  checkedAt: number | null
  loading: boolean
  /** Last check failure, if the most recent refresh threw. */
  error: string | null
  offline: boolean
  /** The stream item whose effective Twitch details match the channel,
   *  when one does. */
  sourceFolder: StreamFolder | null
  folders: StreamFolder[]
  onRefresh: () => void
  onOpenStream: (folder: StreamFolder) => void
}) {
  const checkedLabel = checkedAt
    ? `checked ${new Date(checkedAt).toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit' })}`
    : ''
  const heading = channel === null
    ? (offline ? 'Can’t check Twitch' : error ? 'Twitch check failed' : 'Checking Twitch…')
    : 'Twitch channel'

  return (
    <div className="border-t border-white/5">
      <div className="flex items-center justify-between gap-2 px-3 py-2">
        <span className="text-[10px] font-semibold uppercase tracking-wider text-gray-400 truncate">
          {heading}
          {checkedLabel && <span className="ml-1.5 normal-case tracking-normal font-normal text-gray-500">{checkedLabel}</span>}
        </span>
        <Tooltip content={offline ? 'Can’t check Twitch while offline' : 'Re-check what your Twitch channel currently shows'} side="left">
          <button
            type="button"
            onClick={onRefresh}
            disabled={loading || offline}
            className="p-1 rounded text-gray-400 hover:text-gray-200 hover:bg-white/5 transition-colors disabled:opacity-50"
            aria-label="Re-check Twitch channel"
          >
            {loading ? <Loader2 size={13} className="animate-spin" /> : <RefreshCw size={13} />}
          </button>
        </Tooltip>
      </div>
      <div className="px-3 pb-3">
        {channel === null ? (
          error && !offline
            ? <p className="text-xs text-red-300 break-words">{error}</p>
            : null
        ) : (
          <>
            <div className="flex items-start gap-2 px-3 py-2 rounded-lg bg-twitch-400/10 border border-twitch-400/30">
              <LucideTwitch size={14} className="text-twitch-400 shrink-0 mt-0.5" />
              <div className="min-w-0 flex-1">
                <div className={`text-sm leading-snug break-words ${channel.title ? 'text-gray-100' : 'text-gray-500 italic'}`}>
                  {channel.title || 'No title'}
                </div>
                <div className={`text-xs truncate ${channel.gameName ? 'text-gray-400' : 'text-gray-500 italic'}`}>
                  {channel.gameName || 'No category'}
                </div>
                {channel.tags.length > 0 && (
                  <div className="mt-1 flex flex-wrap gap-1">
                    {channel.tags.map(t => (
                      <span key={t} className="px-1.5 py-0.5 rounded bg-twitch-400/15 text-[10px] text-twitch-200">{t}</span>
                    ))}
                  </div>
                )}
              </div>
            </div>
            {/* Which stream item these details came from. Matched the same
                way the Push to Twitch button decides it has nothing to push
                (live channel values, or the stream's last-pushed snapshot
                while the channel still reflects it). */}
            <div className="mt-2 text-[11px] flex items-baseline gap-1 min-w-0">
              {sourceFolder ? (
                <>
                  <span className="text-gray-500 shrink-0">Set by</span>
                  <Tooltip content="Open this stream" side="top" triggerClassName="block min-w-0">
                    <button
                      type="button"
                      onClick={() => onOpenStream(sourceFolder)}
                      className="block max-w-full truncate text-accent-300/90 hover:text-accent-200 hover:underline transition-colors"
                    >
                      <span className="font-mono tabular-nums">{sourceFolder.date}</span>
                      {' · '}
                      {renderStreamTitle(sourceFolder, folders)}
                    </button>
                  </Tooltip>
                </>
              ) : (
                <span className="text-gray-500">No stream item matches these details.</span>
              )}
            </div>
          </>
        )}
      </div>
    </div>
  )
}
