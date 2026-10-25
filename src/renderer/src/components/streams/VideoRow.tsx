import React, { useEffect, useState } from 'react'
import { Film, Lock, Globe, Link as LinkIcon, Radio, Upload } from 'lucide-react'
import type { LiveBroadcast } from '../../types'
import { TruncatedText } from '../ui/TruncatedText'
import { Tooltip } from '../ui/Tooltip'
import { formatScheduledTime } from '../../lib/formatScheduledTime'
import { formatDateOnly } from '../ui/BroadcastPicker'

/** The row a YouTube video or scheduled broadcast takes in the link
 *  picker (STR-39) and in the sidebar's linked-video footer: 64 px tall,
 *  the thumbnail flush to the row's top, bottom and left edges, the title
 *  on one line, the date and privacy on the next, and a third line for
 *  chips when the row has any; the lines sit centered in the row either
 *  way. */
export function VideoRow({ broadcast, kind, chips, actions, onClick, onThumbFailed, placeholderTitle, className = '', onOpenWatch, onOpenStudio }: {
  broadcast: LiveBroadcast | null
  kind: 'video' | 'broadcast'
  /** The third line; left out when nothing is passed. */
  chips?: React.ReactNode
  /** Buttons at the row's right, vertically centered. */
  actions?: React.ReactNode
  /** Makes the thumbnail and text a button. */
  onClick?: () => void
  onThumbFailed?: () => void
  /** The title shown when there is no broadcast (an unlinked footer). */
  placeholderTitle?: string
  className?: string
  /** When given, the id on the second line opens the video on YouTube
   *  and the privacy opens it in Studio. Only for a row that is not
   *  itself a button. */
  onOpenWatch?: () => void
  onOpenStudio?: () => void
}) {
  const title = broadcast ? (broadcast.snippet?.title?.trim() || `Untitled ${kind}`) : (placeholderTitle ?? '')
  const start = broadcast?.snippet?.actualStartTime ?? broadcast?.snippet?.scheduledStartTime ?? ''
  const when = start ? (kind === 'video' ? formatDateOnly(start) : formatScheduledTime(start)) : ''
  const privacy = broadcast?.status?.privacyStatus
  const PrivacyIcon = privacy === 'unlisted' ? LinkIcon : privacy === 'private' ? Lock : privacy === 'public' ? Globe : null
  const privacyLabel = privacy === 'public' ? 'Public' : privacy === 'unlisted' ? 'Unlisted' : privacy === 'private' ? 'Private' : null

  // The second line: date, kind, privacy, id, with a dot between them.
  // The privacy and the id are links in the footer, text in the picker.
  const linkCls = 'hover:text-gray-200 hover:underline underline-offset-2 transition-colors'
  const meta: React.ReactNode[] = []
  if (when) meta.push(<span key="when" className="tabular-nums shrink-0">{when}</span>)
  if (broadcast?.isLivestream != null) {
    meta.push(
      <span key="kind" className="inline-flex items-center gap-1 shrink-0">
        {broadcast.isLivestream ? <Radio size={10} /> : <Upload size={10} />}
        {broadcast.isLivestream ? 'Livestream' : 'Upload'}
      </span>
    )
  }
  if (PrivacyIcon && privacyLabel) {
    meta.push(onOpenStudio
      ? (
        <Tooltip key="privacy" content="Open in YouTube Studio" side="top" triggerClassName="inline-flex shrink-0">
          <button type="button" onClick={onOpenStudio} className={`inline-flex items-center gap-1 ${linkCls}`}>
            <PrivacyIcon size={10} /> {privacyLabel}
          </button>
        </Tooltip>
      )
      : <span key="privacy" className="inline-flex items-center gap-1 shrink-0"><PrivacyIcon size={10} /> {privacyLabel}</span>)
  }
  if (broadcast) {
    meta.push(onOpenWatch
      ? (
        <Tooltip key="id" content="Open on YouTube" side="top" triggerClassName="inline-flex min-w-0">
          <button type="button" onClick={onOpenWatch} className={`font-mono truncate ${linkCls}`}>{broadcast.id}</button>
        </Tooltip>
      )
      : <span key="id" className="font-mono truncate">{broadcast.id}</span>)
  }

  const body = (
    <>
      <RowThumb url={broadcast?.snippet?.thumbnailUrl} locked={privacy === 'private'} onFailed={onThumbFailed} />
      <div className="flex-1 min-w-0 px-3 flex flex-col justify-center gap-0.5">
        <TruncatedText text={title} className={`truncate text-xs ${broadcast ? 'text-gray-200' : 'text-gray-400'}`} />
        <div className="h-[14px] flex items-center gap-1.5 text-[10px] text-gray-400 whitespace-nowrap overflow-hidden">
          {meta.map((item, i) => (
            <React.Fragment key={i}>
              {i > 0 && <span className="shrink-0 select-none" aria-hidden>•</span>}
              {item}
            </React.Fragment>
          ))}
        </div>
        {chips && (
          // leading-none: a chip is its text plus padding and border, so
          // an inherited line height would push it past the line's box.
          <div className="h-[18px] flex items-center gap-1.5 min-w-0 overflow-hidden whitespace-nowrap text-[10px] leading-none">
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
    <span className={`inline-flex items-center gap-1 px-1.5 py-0.5 rounded border min-w-0 leading-none ${toneCls} ${className}`}>
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
