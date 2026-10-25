import React, { useEffect, useMemo, useState } from 'react'
import { Search, Loader2, AlertTriangle, Link2, Radio, ImageOff } from 'lucide-react'
import { Youtube as LucideYoutube } from '../ui/BrandIcons'
import type { LiveBroadcast, StreamFolder } from '../../types'
import { StreamNavButtons } from './StreamNavButtons'
import { Modal } from '../ui/Modal'
import { Button } from '../ui/Button'
import { Input } from '../ui/Input'
import { TogglePill } from '../ui/TogglePill'
import { TruncatedText } from '../ui/TruncatedText'
import { ThumbImage } from './ThumbImage'
import { VideoRow, RowChip } from './VideoRow'
import { type BroadcastLinkRef } from '../ui/BroadcastPicker'

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

/** The stream item the modal was opened for, drawn at the top so a row
 *  can be compared against it. */
export interface LinkModalStream {
  title: string
  /** The folder date, YYYY-MM-DD. */
  date: string
  thumbPath: string | null
  thumbsKey: number
}

/** What the stream nav needs, the same set the sidebar header passes
 *  its StreamNavButtons; the modal keeps up because the sidebar under it
 *  moves to the picked stream and re-renders the modal with it. */
export interface LinkModalNav {
  current: StreamFolder
  folders: StreamFolder[]
  prevStream: StreamFolder | null
  nextStream: StreamFolder | null
  onPickStream: (f: StreamFolder) => void
  series: { prev: StreamFolder | null; next: StreamFolder | null; siblings: StreamFolder[] }
  onPickEpisode: (f: StreamFolder) => void
}

interface LinkVideoModalProps {
  isOpen: boolean
  onClose: () => void
  /** A past stream links a video; an upcoming one a scheduled broadcast. */
  kind: 'video' | 'broadcast'
  stream: LinkModalStream
  /** Stream and episode arrows on the stream item's label row, so links
   *  can be checked stream after stream without closing the modal. */
  nav?: LinkModalNav
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
 * The link picker (STR-39): a modal in place of the sidebar's drop-up.
 * The stream it was opened for sits at the top, the current link in its
 * own box under it, then a search field and the list: rows of one shape
 * (VideoRow) with the thumbnail flush to the row's edges, the title, the
 * date and privacy, and a chip line. Videos already linked to another
 * stream stay out until the filter pill above the list says otherwise.
 * Rows never move once shown: the list has a fixed height, a status line
 * of fixed height sits above it, and new videos land under that line,
 * at the top, where the one you came for is.
 */
export function LinkVideoModal({ isOpen, onClose, kind, stream, nav, items, currentId, otherFolderLinks, state, onPick, onThumbFailed }: LinkVideoModalProps) {
  const [query, setQuery] = useState('')
  const [showLinked, setShowLinked] = useState(false)
  const noun = kind === 'video' ? 'video' : 'broadcast'

  // The page's Ctrl+arrow shortcuts stand down while a modal is open, so
  // the modal walks streams and episodes itself with the same keys.
  useEffect(() => {
    if (!isOpen || !nav) return
    const onKey = (e: KeyboardEvent) => {
      if (!e.ctrlKey || e.altKey || e.metaKey) return
      if (e.key !== 'ArrowUp' && e.key !== 'ArrowDown') return
      const up = e.key === 'ArrowUp'
      const target = e.shiftKey
        ? (up ? nav.series.next : nav.series.prev)
        : (up ? nav.nextStream : nav.prevStream)
      e.preventDefault()
      if (!target) return
      if (e.shiftKey) nav.onPickEpisode(target)
      else nav.onPickStream(target)
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [isOpen, nav])

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

  const renderRow = (b: LiveBroadcast, boxed: boolean) => {
    const links = linkMap.get(b.id) ?? []
    const isNew = newSet.has(b.id)
    const isDefaultBroadcast = kind === 'broadcast' && !b.snippet?.scheduledStartTime
    // The current link needs no chip of its own: its box says what it is.
    const hasChips = isNew || isDefaultBroadcast || links.length > 0
    // The row's own links (the footer's design): the privacy opens the
    // video, the id opens Studio's edit page for a video or the live
    // control room for a broadcast that has not happened yet.
    const rowLinks = {
      watchUrl: `https://youtu.be/${b.id}`,
      studioUrl: `https://studio.youtube.com/video/${b.id}/${kind === 'video' ? 'edit' : 'livestreaming'}`,
    }
    return (
      <VideoRow
        key={b.id}
        broadcast={b}
        kind={kind}
        onClick={() => pick(b.id)}
        onThumbFailed={onThumbFailed ? () => onThumbFailed(b.id) : undefined}
        links={rowLinks}
        className={`transition-colors hover:bg-white/5 ${boxed ? 'bg-white/5' : 'border-b border-white/5'}`}
        chips={hasChips ? (
          <>
            {isNew && <RowChip tone="accent">New</RowChip>}
            {isDefaultBroadcast && <RowChip tone="gray" icon={<Radio size={9} />}>Default livestream</RowChip>}
            {links.length > 0 && (
              <RowChip tone="amber" icon={<Link2 size={9} />}>
                {links.length > 1 ? `Linked to ${links.length} other streams` : `Linked to: ${links[0].folderTitle || links[0].folderDate}`}
              </RowChip>
            )}
          </>
        ) : undefined}
      />
    )
  }

  // The two boxes draw the same row on purpose, for the comparison; the
  // labels and their icons are what tell them apart.
  const sectionLabel = 'text-[10px] uppercase tracking-wide text-gray-400 flex items-center gap-1.5'

  return (
    <Modal
      isOpen={isOpen}
      onClose={close}
      title={kind === 'video' ? 'Link a YouTube video' : 'Link a scheduled broadcast'}
      width="xl"
      footer={<Button onClick={close}>Close</Button>}
    >
      <div className="flex flex-col gap-3">
        {/* The stream this is for, and what it is linked to now, each in
            its own box, so a row below can be checked against them. */}
        <div>
          <div className="flex items-center justify-between gap-2 mb-1 min-h-[22px]">
            <div className={sectionLabel}><Radio size={11} /> Stream item</div>
            {nav && (
              <StreamNavButtons
                current={nav.current}
                folders={nav.folders}
                prevStream={nav.prevStream}
                nextStream={nav.nextStream}
                onPickStream={nav.onPickStream}
                series={nav.series}
                onPickEpisode={nav.onPickEpisode}
                variant="player"
              />
            )}
          </div>
          <div className="rounded-lg border border-white/10 bg-navy-900 overflow-hidden">
            <div className="flex items-stretch h-16">
              <div className="self-stretch aspect-video shrink-0 overflow-hidden bg-navy-700 flex items-center justify-center text-gray-400">
                {stream.thumbPath
                  ? <ThumbImage path={stream.thumbPath} thumbsKey={stream.thumbsKey} className="w-full h-full object-cover" placeholderClassName="w-full h-full flex items-center justify-center" iconSize={14} />
                  : <ImageOff size={14} />}
              </div>
              <div className="flex-1 min-w-0 px-3 flex flex-col justify-center gap-0.5">
                <TruncatedText text={stream.title || 'Untitled stream'} className="truncate text-xs text-gray-200" />
                <div className="h-[14px] flex items-center text-[10px] text-gray-400 tabular-nums">{formatFolderDate(stream.date)}</div>
              </div>
            </div>
          </div>
        </div>
        {/* Always drawn, with a placeholder row when nothing is linked:
            the modal keeps one height from stream to stream, so the nav
            buttons above stay put (style guide: a button clicked more
            than once stays where it was). */}
        <div>
          <div className={`${sectionLabel} mb-1 min-h-[22px]`}>
            <LucideYoutube size={11} className="text-red-400/70" />
            {kind === 'video' ? 'Linked YouTube video' : 'Linked YouTube broadcast'}
          </div>
          <div className="rounded-lg border border-white/10 bg-navy-900 overflow-hidden">
            {current
              ? renderRow(current, true)
              : <VideoRow kind={kind} broadcast={null} placeholderTitle={currentId ? 'Loading the linked video' : 'No linked video or broadcast'} />}
          </div>
        </div>
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
          {/* Fixed-height list: the modal keeps its size while pages land. */}
          <div className="h-[50vh] overflow-y-auto rounded-lg border border-white/10 bg-navy-900">
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
      </div>
    </Modal>
  )
}

/** A folder date (YYYY-MM-DD) in the rows' date style, built as a local
 *  date so it does not slip a day in zones behind UTC. */
function formatFolderDate(date: string): string {
  const [y, m, d] = date.split('-').map(n => parseInt(n, 10))
  if (!y || !m || !d) return date
  return new Date(y, m - 1, d).toLocaleDateString(undefined, { year: 'numeric', month: 'short', day: 'numeric' })
}
