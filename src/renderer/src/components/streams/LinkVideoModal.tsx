import React, { useEffect, useMemo, useState } from 'react'
import { Search, Loader2, AlertTriangle, Link2, Check, Radio, Film, Globe, Lock, Link as LinkIcon, ExternalLink } from 'lucide-react'
import type { LiveBroadcast } from '../../types'
import { Modal } from '../ui/Modal'
import { Button } from '../ui/Button'
import { Input } from '../ui/Input'
import { Tooltip } from '../ui/Tooltip'
import { TogglePill } from '../ui/TogglePill'
import { TruncatedText } from '../ui/TruncatedText'
import { rowActionClass } from '../ui/rowAction'
import { formatScheduledTime } from '../../lib/formatScheduledTime'
import { formatDateOnly, isLikelyDefaultBroadcast, type BroadcastLinkRef } from '../ui/BroadcastPicker'

/** Where the channel-wide video list stands (STR-39). `loading` is the
 *  first walk of the channel with pages still landing; `checking` is the
 *  one-request look for videos newer than the cache; `newIds` are what
 *  that look found, listed first. */
export interface VodListState {
  phase: 'idle' | 'loading' | 'ready'
  checking: boolean
  newIds: string[]
  error: string | null
}

interface LinkVideoModalProps {
  isOpen: boolean
  onClose: () => void
  /** A past stream links a video; an upcoming one a scheduled broadcast. */
  kind: 'video' | 'broadcast'
  items: LiveBroadcast[]
  currentId: string
  /** Other stream items' links into this list, keyed by broadcast id;
   *  those rows stay out until the filter pill asks for them. */
  otherFolderLinks: BroadcastLinkRef[]
  state: VodListState
  onPick: (id: string) => void
  /** A row's thumbnail did not load. Private videos get signed, expiring
   *  thumbnail URLs, so the owner can fetch the record again for a fresh
   *  one; the row shows the placeholder meanwhile. */
  onThumbFailed?: (id: string) => void
}

/**
 * The link picker (STR-39): a modal in place of the sidebar's drop-up. A
 * search field, rows of one height with the thumbnail flush to the row's
 * edges, the title, date and privacy, the current link in its own box
 * above the list so it stays in view for comparison, and videos already
 * linked to another stream left out until the filter pill above the
 * list says otherwise. Rows never move once shown: the list has a fixed
 * height, a status line of fixed height sits above it, and new videos
 * land under that line, at the top, where the one you came for is.
 */
export function LinkVideoModal({ isOpen, onClose, kind, items, currentId, otherFolderLinks, state, onPick, onThumbFailed }: LinkVideoModalProps) {
  const [query, setQuery] = useState('')
  const [showLinked, setShowLinked] = useState(false)
  const noun = kind === 'video' ? 'video' : 'broadcast'

  const linkMap = useMemo(() => {
    const m = new Map<string, BroadcastLinkRef[]>()
    for (const link of otherFolderLinks) {
      const arr = m.get(link.broadcastId) ?? []
      arr.push(link)
      m.set(link.broadcastId, arr)
    }
    return m
  }, [otherFolderLinks])

  const words = query.trim().toLowerCase().split(/\s+/).filter(Boolean)
  const matches = (b: LiveBroadcast) => {
    if (words.length === 0) return true
    const title = (b.snippet?.title ?? '').toLowerCase()
    return words.every(w => title.includes(w))
  }
  // Linked elsewhere, and not the current link: left out until the
  // filter pill asks for them.
  const isLinkedElsewhere = (b: LiveBroadcast) => b.id !== currentId && linkMap.has(b.id)
  const linkedCount = items.filter(b => isLinkedElsewhere(b) && matches(b)).length
  // The current link sits in its own box above the list whatever the
  // search says, so the comparison it is there for never scrolls away.
  const current = currentId ? items.find(b => b.id === currentId) ?? null : null
  const visible = items.filter(b => b.id !== currentId && matches(b) && (showLinked || !isLinkedElsewhere(b)))
  const newSet = new Set(state.newIds)

  const close = () => { setQuery(''); setShowLinked(false); onClose() }
  const pick = (id: string) => { setQuery(''); setShowLinked(false); onPick(id) }

  const statusLine = (() => {
    if (state.error) {
      return (
        <span className="flex items-center gap-1.5 text-red-400">
          <AlertTriangle size={12} className="shrink-0" />
          <span className="truncate">YouTube did not answer: {state.error}</span>
        </span>
      )
    }
    if (kind === 'broadcast') {
      return state.phase === 'loading'
        ? <span className="flex items-center gap-1.5"><Loader2 size={12} className="animate-spin shrink-0" /> Loading scheduled broadcasts</span>
        : <span>Scheduled broadcasts on your channel</span>
    }
    if (state.phase === 'loading') {
      return <span className="flex items-center gap-1.5"><Loader2 size={12} className="animate-spin shrink-0" /> Loading your videos from YouTube</span>
    }
    if (state.checking) {
      return <span className="flex items-center gap-1.5"><Loader2 size={12} className="animate-spin shrink-0" /> Checking for new videos</span>
    }
    if (state.newIds.length > 0) {
      return <span className="text-gray-200">{state.newIds.length} new {state.newIds.length === 1 ? 'video' : 'videos'} since last time</span>
    }
    return <span>Up to date</span>
  })()

  const emptyLine = (() => {
    if (state.phase === 'loading' && items.length === 0) return null
    if (visible.length > 0) return null
    if (words.length > 0) return `No ${noun}s match.`
    if (linkedCount > 0) return `Every ${noun} is linked to another stream.`
    if (current) return `No other ${noun}s on your channel.`
    return kind === 'video' ? 'No videos found on your channel.' : 'No scheduled broadcasts on your channel.'
  })()

  const renderRow = (b: LiveBroadcast, pinned: boolean) => {
    const isCurrent = b.id === currentId
    const links = linkMap.get(b.id) ?? []
    const title = b.snippet?.title?.trim() || `Untitled ${noun}`
    const start = b.snippet?.actualStartTime ?? b.snippet?.scheduledStartTime ?? ''
    const when = start ? (kind === 'video' ? formatDateOnly(start) : formatScheduledTime(start)) : ''
    const privacy = b.status?.privacyStatus
    const PrivacyIcon = privacy === 'unlisted' ? LinkIcon : privacy === 'private' ? Lock : privacy === 'public' ? Globe : null
    const privacyLabel = privacy === 'public' ? 'Public' : privacy === 'unlisted' ? 'Unlisted' : privacy === 'private' ? 'Private' : null
    // Studio's edit page for a video; the live control room for a
    // broadcast that has not happened yet.
    const studioUrl = `https://studio.youtube.com/video/${b.id}/${kind === 'video' ? 'edit' : 'livestreaming'}`
    // The hover tint belongs to the whole row, Studio button included,
    // so the row reads as one thing under the pointer.
    return (
      <div
        key={b.id}
        className={`flex items-stretch h-16 transition-colors hover:bg-white/5 ${
          pinned ? 'bg-white/5' : 'border-b border-white/5'
        }`}
      >
        <button
          type="button"
          onClick={() => pick(b.id)}
          className="flex flex-1 min-w-0 items-stretch text-left"
        >
          <RowThumb
            url={b.snippet?.thumbnailUrl}
            locked={privacy === 'private'}
            onFailed={onThumbFailed ? () => onThumbFailed(b.id) : undefined}
          />
          <div className="flex-1 min-w-0 px-3 flex flex-col justify-center gap-1">
            <TruncatedText text={title} className="truncate text-xs text-gray-200" />
            <div className="flex items-center gap-2 min-w-0 overflow-hidden whitespace-nowrap text-[10px] text-gray-400">
              {when && <span className="tabular-nums shrink-0">{when}</span>}
              {PrivacyIcon && privacyLabel && (
                <span className="inline-flex items-center gap-1 shrink-0"><PrivacyIcon size={10} /> {privacyLabel}</span>
              )}
              {newSet.has(b.id) && (
                <span className="px-1.5 py-0.5 rounded text-accent-300 border border-accent-300/40 shrink-0">New</span>
              )}
              {isCurrent && (
                <span className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded text-accent-300 border border-accent-300/40 shrink-0">
                  <Check size={9} /> Linked to this stream
                </span>
              )}
              {kind === 'broadcast' && isLikelyDefaultBroadcast(b) && (
                <span className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded text-gray-300 border border-gray-300/40 shrink-0">
                  <Radio size={9} /> Default livestream
                </span>
              )}
              {links.length > 0 && (
                <span className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded text-amber-300 border border-amber-300/40 min-w-0">
                  <Link2 size={9} className="shrink-0" />
                  <span className="truncate">
                    {links.length > 1 ? `Linked to ${links.length} other streams` : `Linked to: ${links[0].folderTitle || links[0].folderDate}`}
                  </span>
                </span>
              )}
            </div>
          </div>
        </button>
        <div className="flex items-center pe-2">
          <Tooltip content="Open in YouTube Studio">
            <button
              type="button"
              aria-label="Open in YouTube Studio"
              onClick={() => { void window.api.openUrl(studioUrl) }}
              className={rowActionClass('gray', 'sm')}
            >
              <ExternalLink size={12} />
            </button>
          </Tooltip>
        </div>
      </div>
    )
  }

  return (
    <Modal
      isOpen={isOpen}
      onClose={close}
      title={kind === 'video' ? 'Link a YouTube video' : 'Link a scheduled broadcast'}
      width="xl"
      footer={<Button onClick={close}>Close</Button>}
    >
      <div className="flex flex-col gap-2">
        <Input
          value={query}
          onChange={e => setQuery(e.target.value)}
          placeholder="Search by title"
          inputPrefix={<Search size={13} />}
          aria-label="Search by title"
        />
        {/* Fixed-height status row: the line's text changes, its space
            does not; the filter pill on the right lists the videos other
            streams already own. */}
        <div className="h-8 flex items-center justify-between gap-3 text-[11px] text-gray-400 min-w-0">
          <div className="min-w-0 flex items-center">{statusLine}</div>
          {linkedCount > 0 && (
            <TogglePill
              checked={showLinked}
              onChange={setShowLinked}
              tooltip={showLinked
                ? `Leave out the ${linkedCount} ${noun}s already linked to other streams`
                : `Also list the ${linkedCount} ${noun}s already linked to other streams`}
              label={`Show already linked ${noun}s (${linkedCount})`}
            />
          )}
        </div>
        {/* The current link, boxed apart from the list and always in view. */}
        {current && (
          <div className="rounded-lg border border-white/10 bg-navy-900 overflow-hidden">
            {renderRow(current, true)}
          </div>
        )}
        {/* Fixed-height list: the modal keeps its size while pages land. */}
        <div className="h-[55vh] overflow-y-auto rounded-lg border border-white/10 bg-navy-900">
          {visible.map(b => renderRow(b, false))}
          {emptyLine && (
            <p className="px-3 py-6 text-xs text-gray-400 italic text-center">{emptyLine}</p>
          )}
          {state.phase === 'loading' && (
            <div className="flex items-center justify-center gap-1.5 px-3 py-3 text-[11px] text-gray-400">
              <Loader2 size={12} className="animate-spin" /> Loading more
            </div>
          )}
        </div>
      </div>
    </Modal>
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
