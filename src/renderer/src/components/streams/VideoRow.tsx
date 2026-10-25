import React, { useEffect, useState } from 'react'
import { Film, Lock, Globe, Link as LinkIcon } from 'lucide-react'
import type { LiveBroadcast } from '../../types'
import { TruncatedText } from '../ui/TruncatedText'
import { formatScheduledTime } from '../../lib/formatScheduledTime'
import { formatDateOnly } from '../ui/BroadcastPicker'

/** The row a YouTube video or scheduled broadcast takes in the link
 *  picker (STR-39) and in the sidebar's linked-video footer: 64 px tall,
 *  the thumbnail flush to the row's top, bottom and left edges, the title
 *  on one line, the date and privacy on the next, and a third line for
 *  chips. The chip line keeps its height even when empty, so the title
 *  and the date sit at the same place in every row; a row that never
 *  carries chips passes `chips={null}` and centers its two lines. */
export function VideoRow({ broadcast, kind, chips, actions, onClick, onThumbFailed, placeholderTitle, className = '' }: {
  broadcast: LiveBroadcast | null
  kind: 'video' | 'broadcast'
  /** The third line. `null` leaves it out; undefined or empty keeps the
   *  line's space. */
  chips?: React.ReactNode | null
  /** Buttons at the row's right, vertically centered. */
  actions?: React.ReactNode
  /** Makes the thumbnail and text a button. */
  onClick?: () => void
  onThumbFailed?: () => void
  /** The title shown when there is no broadcast (an unlinked footer). */
  placeholderTitle?: string
  className?: string
}) {
  const title = broadcast ? (broadcast.snippet?.title?.trim() || `Untitled ${kind}`) : (placeholderTitle ?? '')
  const start = broadcast?.snippet?.actualStartTime ?? broadcast?.snippet?.scheduledStartTime ?? ''
  const when = start ? (kind === 'video' ? formatDateOnly(start) : formatScheduledTime(start)) : ''
  const privacy = broadcast?.status?.privacyStatus
  const PrivacyIcon = privacy === 'unlisted' ? LinkIcon : privacy === 'private' ? Lock : privacy === 'public' ? Globe : null
  const privacyLabel = privacy === 'public' ? 'Public' : privacy === 'unlisted' ? 'Unlisted' : privacy === 'private' ? 'Private' : null

  const body = (
    <>
      <RowThumb url={broadcast?.snippet?.thumbnailUrl} locked={privacy === 'private'} onFailed={onThumbFailed} />
      <div className="flex-1 min-w-0 px-3 flex flex-col justify-center gap-0.5">
        <TruncatedText text={title} className={`truncate text-xs ${broadcast ? 'text-gray-200' : 'text-gray-400'}`} />
        <div className="h-[14px] flex items-center gap-2 text-[10px] text-gray-400 whitespace-nowrap">
          {when && <span className="tabular-nums">{when}</span>}
          {PrivacyIcon && privacyLabel && (
            <span className="inline-flex items-center gap-1"><PrivacyIcon size={10} /> {privacyLabel}</span>
          )}
        </div>
        {chips !== null && (
          <div className="h-[18px] flex items-center gap-1.5 min-w-0 overflow-hidden whitespace-nowrap text-[10px]">
            {chips}
          </div>
        )}
      </div>
    </>
  )

  return (
    <div className={`flex items-stretch h-16 ${className}`}>
      {onClick
        ? <button type="button" onClick={onClick} className="flex flex-1 min-w-0 items-stretch text-left">{body}</button>
        : <div className="flex flex-1 min-w-0 items-stretch">{body}</div>}
      {actions && <div className="flex items-center gap-1.5 pe-2 shrink-0">{actions}</div>}
    </div>
  )
}

/** One chip on a VideoRow's third line. The border takes the text's
 *  color (style guide, chips). */
export function RowChip({ tone, icon, children, className = '' }: {
  tone: 'accent' | 'amber' | 'gray'
  icon?: React.ReactNode
  children: React.ReactNode
  className?: string
}) {
  const toneCls = tone === 'accent'
    ? 'text-accent-300 border-accent-300/40'
    : tone === 'amber'
      ? 'text-amber-300 border-amber-300/40'
      : 'text-gray-300 border-gray-300/40'
  return (
    <span className={`inline-flex items-center gap-1 px-1.5 py-0.5 rounded border min-w-0 ${toneCls} ${className}`}>
      {icon && <span className="shrink-0 flex">{icon}</span>}
      <span className="truncate">{children}</span>
    </span>
  )
}

/** A row's thumbnail, flush to the row's top, bottom and left edges, or
 *  the placeholder box when there is no URL or the load fails: the
 *  browser's broken-image glyph never shows (style guide, every image
 *  has a fallback). A private video's placeholder carries the lock,
 *  since its signed thumbnail URL is the one that expires. A new URL
 *  gets a new try. */
function RowThumb({ url, locked, onFailed }: { url?: string; locked?: boolean; onFailed?: () => void }) {
  const [failed, setFailed] = useState(false)
  useEffect(() => { setFailed(false) }, [url])
  return (
    <div className="self-stretch aspect-video shrink-0 overflow-hidden bg-navy-700 flex items-center justify-center text-gray-400">
      {url && !failed
        ? <img src={url} loading="lazy" alt="" className="w-full h-full object-cover" onError={() => { setFailed(true); onFailed?.() }} />
        : locked ? <Lock size={14} /> : <Film size={14} />}
    </div>
  )
}
