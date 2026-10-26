import React, { useEffect, useRef, useState } from 'react'
import { Film, Lock, Globe, Link as LinkIcon, Radio, Upload, Copy, Check, Loader2 } from 'lucide-react'
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
export function VideoRow({ broadcast, kind, chips, actions, onClick, onThumbFailed, placeholderTitle, className = '', links, loading }: {
  broadcast: LiveBroadcast | null
  kind: 'video' | 'broadcast'
  /** The record is still loading: the thumbnail box shows a spinner,
   *  the section's one loading sign. */
  loading?: boolean
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
  /** When given, the privacy on the second line opens the video on
   *  YouTube and the id opens it in Studio, each with a copy icon beside
   *  it. Works with `onClick` too: the row is then a div with the button
   *  role, and the links stop their clicks from picking the row. */
  links?: { watchUrl: string; studioUrl: string }
}) {
  const title = broadcast ? (broadcast.snippet?.title?.trim() || `Untitled ${kind}`) : (placeholderTitle ?? '')
  const start = broadcast?.snippet?.actualStartTime ?? broadcast?.snippet?.scheduledStartTime ?? ''
  const when = start ? (kind === 'video' ? formatDateOnly(start) : formatScheduledTime(start)) : ''
  const privacy = broadcast?.status?.privacyStatus
  const PrivacyIcon = privacy === 'unlisted' ? LinkIcon : privacy === 'private' ? Lock : privacy === 'public' ? Globe : null
  const privacyLabel = privacy === 'public' ? 'Public' : privacy === 'unlisted' ? 'Unlisted' : privacy === 'private' ? 'Private' : null

  // The second line: privacy, kind, date, id, with a dot between them
  // (privacy before the date, the order of the Broadcast options). In
  // the footer the privacy is the video's link and the id is its Studio
  // link, each with a copy icon; in the picker they are text.
  const linkCls = 'hover:text-gray-200 hover:underline underline-offset-2 transition-colors'
  const meta: React.ReactNode[] = []
  // A link inside a pickable row must not pick it.
  const open = (url: string) => (e: React.MouseEvent) => { e.stopPropagation(); void window.api.openUrl(url) }
  if (PrivacyIcon && privacyLabel) {
    meta.push(links
      ? (
        <span key="privacy" className="inline-flex items-center gap-1 shrink-0">
          <Tooltip content="Open on YouTube" side="top" triggerClassName="inline-flex">
            <button type="button" onClick={open(links.watchUrl)} className={`inline-flex items-center gap-1 ${linkCls}`}>
              <PrivacyIcon size={10} /> {privacyLabel}
            </button>
          </Tooltip>
          <InlineCopy url={links.watchUrl} label="Copy video link" />
        </span>
      )
      : <span key="privacy" className="inline-flex items-center gap-1 shrink-0"><PrivacyIcon size={10} /> {privacyLabel}</span>)
  }
  if (broadcast?.isLivestream != null) {
    meta.push(
      <span key="kind" className="inline-flex items-center gap-1 shrink-0">
        {broadcast.isLivestream ? <Radio size={10} /> : <Upload size={10} />}
        {broadcast.isLivestream ? 'Livestream' : 'Upload'}
      </span>
    )
  }
  if (when) meta.push(<span key="when" className="tabular-nums shrink-0">{when}</span>)
  if (broadcast) {
    meta.push(links
      ? (
        <span key="id" className="inline-flex items-center gap-1 min-w-0">
          <Tooltip content="Open in YouTube Studio" side="top" triggerClassName="inline-flex min-w-0">
            <button type="button" onClick={open(links.studioUrl)} className={`font-mono truncate ${linkCls}`}>{broadcast.id}</button>
          </Tooltip>
          <InlineCopy url={links.studioUrl} label="Copy Studio link" />
        </span>
      )
      : <span key="id" className="font-mono truncate">{broadcast.id}</span>)
  }

  const body = (
    <>
      <RowThumb url={broadcast?.snippet?.thumbnailUrl} locked={privacy === 'private'} loading={loading} onFailed={onThumbFailed} />
      <div className="flex-1 min-w-0 px-3 py-1 flex flex-col justify-center gap-0.5">
        <TruncatedText text={title} className={`truncate text-xs ${broadcast ? 'text-gray-200' : 'text-gray-400'}`} />
        {/* Wraps when the row is narrow (the sidebar at its narrowest);
            the row grows with it and the thumbnail keeps its size. */}
        <div className="flex flex-wrap items-center gap-x-1.5 gap-y-0.5 text-[10px] text-gray-400 leading-[14px]">
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

  // A pickable row is a div with the button role rather than a button,
  // so the links on its second line can be buttons of their own.
  const pickable = onClick
    ? {
      role: 'button' as const,
      tabIndex: 0,
      onClick,
      onKeyDown: (e: React.KeyboardEvent) => {
        if (e.target !== e.currentTarget) return
        if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); onClick() }
      },
    }
    : {}
  return (
    <div className={`flex items-stretch min-h-16 ${className}`}>
      <div
        {...pickable}
        className={`flex flex-1 min-w-0 items-stretch text-left ${onClick ? 'cursor-pointer focus:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-accent-500/40' : ''}`}
      >
        {body}
      </div>
      {actions && <div className="flex items-center gap-1.5 pe-2 shrink-0">{actions}</div>}
    </div>
  )
}

/** A copy icon the size of the meta line's text, with a check for a
 *  moment after the copy. */
function InlineCopy({ url, label }: { url: string; label: string }) {
  const [copied, setCopied] = useState(false)
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null)
  useEffect(() => () => { if (timer.current) clearTimeout(timer.current) }, [])
  return (
    <Tooltip content={copied ? 'Copied!' : label} side="top" triggerClassName="inline-flex">
      <button
        type="button"
        aria-label={label}
        onClick={async (e) => {
          e.stopPropagation()
          try {
            await navigator.clipboard.writeText(url)
            setCopied(true)
            if (timer.current) clearTimeout(timer.current)
            timer.current = setTimeout(() => setCopied(false), 1500)
          } catch { /* clipboard refused */ }
        }}
        className="inline-flex text-gray-400 hover:text-gray-200 transition-colors"
      >
        {copied ? <Check size={10} className="text-green-400" /> : <Copy size={10} />}
      </button>
    </Tooltip>
  )
}

/** A thumbnail URL made unique to the thumbnail last pushed for it. A
 *  new thumbnail keeps its URL on YouTube, and the browser's image cache
 *  serves the same URL from memory for the life of the page, so the row
 *  kept showing the picture from before the upload (or YouTube's
 *  placeholder) until a reload. The pushed file's hash, which the push
 *  records in meta, becomes a query parameter: a new picture, a new URL. */
export function bustThumbUrl(url: string | undefined, token: string | undefined): string | undefined {
  if (!url || !token) return url
  return `${url}${url.includes('?') ? '&' : '?'}sm=${token.slice(0, 12)}`
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
function RowThumb({ url, locked, loading, onFailed }: { url?: string; locked?: boolean; loading?: boolean; onFailed?: () => void }) {
  const [failed, setFailed] = useState(false)
  useEffect(() => { setFailed(false) }, [url])
  return (
    <div className="h-16 self-start aspect-video shrink-0 overflow-hidden bg-navy-700 flex items-center justify-center text-gray-400">
      {url && !failed
        ? <img src={url} loading="lazy" alt="" className="w-full h-full object-cover" onError={() => { setFailed(true); onFailed?.() }} />
        : loading ? <Loader2 size={14} className="animate-spin" />
          : locked ? <Lock size={14} /> : <Film size={14} />}
    </div>
  )
}
