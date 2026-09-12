import React from 'react'
import { RefreshCw, Loader2 } from 'lucide-react'
import { Tooltip } from '../ui/Tooltip'
import { Twitch as LucideTwitch } from '../ui/BrandIcons'
import { renderStreamTitle } from '../../lib/streamTitle'
import type { StreamFolder } from '../../types'

/** Same chip the stream-detail sidebar's tag editors use (TagChipEditor),
 *  so the tags read as the same objects here. */
const TAG_CHIP_CLASS = 'inline-flex items-center gap-1 text-[10px] text-accent-300/80 bg-accent-500/10 border border-accent-500/25 rounded px-1.5 py-0.5 max-w-full'

/**
 * Sidebar empty-state panel (STR-18): what the Twitch channel currently
 * shows (title, category, tags) and which stream item those details came
 * from, so the user can tell what the channel is set to without opening the
 * stream they believe it should be. Read-only by design: Twitch's channel
 * info is one global blob that SM's post-stream auto-update also writes, and
 * a manual edit here would have to reconcile with that; pushes stay on the
 * stream items. Sits above the YouTube out-of-sync panel, whose height
 * varies with its list, and mirrors its header (label left, icon button
 * right, the checked time in the button's tooltip).
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
  const tagCount = channel?.tags.length ?? 0

  return (
    <div className="border-t border-white/5">
      <div className="flex items-center justify-between gap-2 px-3 py-2">
        <span className="text-[10px] font-semibold uppercase tracking-wider text-gray-400 truncate">{heading}</span>
        <Tooltip
          content={offline ? 'No internet connection.' : checkedLabel ? `Re-check Twitch (${checkedLabel})` : 'Re-check Twitch'}
          side="top"
        >
          <button
            type="button"
            onClick={onRefresh}
            disabled={loading || offline}
            className="p-1 rounded text-gray-400 hover:text-gray-200 hover:bg-white/5 transition-colors disabled:opacity-50"
            aria-label="Re-check Twitch"
          >
            {loading ? <Loader2 size={12} className="animate-spin" /> : <RefreshCw size={12} />}
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
            <div className="flex items-start gap-2">
              <LucideTwitch size={11} className="text-twitch-400/70 shrink-0 mt-0.5" />
              <div className="min-w-0 flex-1 flex flex-col gap-1">
                <div className={`text-xs leading-snug break-words ${channel.title ? 'text-gray-200' : 'text-gray-500 italic'}`}>
                  {channel.title || 'No title'}
                </div>
                <div className="flex items-center gap-2 min-w-0">
                  <span className={`text-[11px] truncate ${channel.gameName ? 'text-gray-400' : 'text-gray-500 italic'}`}>
                    {channel.gameName || 'No category'}
                  </span>
                  {tagCount > 0 && (
                    <Tooltip
                      side="top"
                      maxWidth="max-w-sm"
                      content={
                        <div className="flex flex-wrap gap-1">
                          {channel.tags.map(t => <span key={t} className={TAG_CHIP_CLASS}>{t}</span>)}
                        </div>
                      }
                      triggerClassName="inline-flex shrink-0"
                    >
                      <span className={`${TAG_CHIP_CLASS} cursor-default tabular-nums`}>{tagCount} tag{tagCount === 1 ? '' : 's'}</span>
                    </Tooltip>
                  )}
                </div>
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
