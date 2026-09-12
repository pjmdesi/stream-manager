import React, { useEffect, useRef, useState } from 'react'
import ReactDOM from 'react-dom'
import { ChevronUp, ChevronDown, ChevronsUp, ChevronsDown, List } from 'lucide-react'
import { Tooltip } from '../ui/Tooltip'
import { TruncatedText } from '../ui/TruncatedText'
import { renderStreamTitle, isStandalone } from '../../lib/streamTitle'
import type { SeriesNav } from '../../lib/seriesNav'
import type { StreamFolder } from '../../types'

/** One set of keys on both pages: Ctrl+arrows walk streams, Ctrl+Shift
 *  walks episodes within the series. Up is next (newer), down is previous. */
export const STREAM_NAV_SHORTCUTS = {
  prevStream: 'Ctrl+↓',
  nextStream: 'Ctrl+↑',
  prevEpisode: 'Ctrl+Shift+↓',
  nextEpisode: 'Ctrl+Shift+↑',
} as const

type Variant = 'sidebar' | 'player' | 'player-rail'

const VARIANT = {
  sidebar: { btn: 'p-1 hover:bg-white/5', icon: 13, side: 'bottom' as const },
  player: { btn: 'h-5 w-5 flex items-center justify-center hover:bg-white/10', icon: 12, side: 'bottom' as const },
  'player-rail': { btn: 'h-6 w-8 flex items-center justify-center hover:bg-white/10', icon: 12, side: 'right' as const },
}

const BTN_BASE = 'rounded text-gray-400 hover:text-gray-200 transition-colors disabled:opacity-30 disabled:cursor-default disabled:hover:bg-transparent disabled:hover:text-gray-400'

/**
 * Previous/next navigation shared by the stream-detail sidebar header and
 * the player's Selected Stream block (PLR-27): a stream pair (single
 * chevrons, adjacent streams in the caller's list order) and an episode
 * pair (double chevrons, neighbors within the series) with a jump-to-
 * episode picker once the series has more than two episodes. Up is next
 * (newer), down is previous, on both pairs. The caller decides what
 * "adjacent stream" means (the streams page walks its visible list, the
 * player walks streams that have a video) and what a pick does.
 *
 * Row layout: [prev stream][next stream] · [picker][prev episode][next
 * episode]. Column layout (the player's collapsed rail): picker, next
 * episode, next stream, `children` (the rail's thumbnail), previous
 * stream, previous episode, so each arrow's direction matches its place.
 */
export function StreamNavButtons({
  current, folders, prevStream, nextStream, onPickStream, series, onPickEpisode,
  isEpisodeUnavailable, variant, children,
}: {
  current: StreamFolder
  folders: StreamFolder[]
  prevStream: StreamFolder | null
  nextStream: StreamFolder | null
  onPickStream: (f: StreamFolder) => void
  series: SeriesNav
  onPickEpisode: (f: StreamFolder) => void
  /** Episodes the caller cannot open (no video to play); they render
   *  disabled in the picker with a note. The chevrons skip them because
   *  the caller passes an already-filtered `series`. */
  isEpisodeUnavailable?: (f: StreamFolder) => boolean
  variant: Variant
  children?: React.ReactNode
}) {
  const v = VARIANT[variant]
  const column = variant === 'player-rail'
  const btnCls = `${BTN_BASE} ${v.btn}`
  const titleOf = (f: StreamFolder) => renderStreamTitle(f, folders).trim() || f.folderName

  // Episode group: hidden for a single-episode series (nothing to walk),
  // shown disabled for a standalone stream as a visible affordance, the
  // picker only once the chevrons alone would mean many clicks.
  const standalone = isStandalone(current.meta)
  const showEpisodes = !!series.prev || !!series.next || standalone
  const showPicker = showEpisodes && series.siblings.length > 2

  // Jump-to-episode picker: click the List button, pick a row or click
  // outside to close; closes when the current stream changes so a click
  // in one stream cannot leave it open in the next. Portal-rendered so a
  // scrolling, overflow-hidden parent cannot clip it.
  const [pickerOpen, setPickerOpen] = useState(false)
  const anchorRef = useRef<HTMLButtonElement>(null)
  useEffect(() => { setPickerOpen(false) }, [current.relativePath])

  const streamTip = (label: 'Previous' | 'Next', f: StreamFolder | null) =>
    f ? `${label} stream: ${f.date} · ${titleOf(f)}` : `No ${label.toLowerCase()} stream`
  const episodeTip = (label: 'Previous' | 'Next', f: StreamFolder | null) =>
    f ? `${label} episode (E${f.meta?.ytEpisode || '?'}): ${titleOf(f)}` : `No ${label.toLowerCase()} episode`

  const prevStreamBtn = (
    <Tooltip content={streamTip('Previous', prevStream)} maxWidth="max-w-sm" side={v.side} shortcut={prevStream ? STREAM_NAV_SHORTCUTS.prevStream : undefined}>
      <button type="button" onClick={() => prevStream && onPickStream(prevStream)} disabled={!prevStream} className={btnCls} aria-label="Previous stream">
        <ChevronDown size={v.icon} />
      </button>
    </Tooltip>
  )
  const nextStreamBtn = (
    <Tooltip content={streamTip('Next', nextStream)} maxWidth="max-w-sm" side={v.side} shortcut={nextStream ? STREAM_NAV_SHORTCUTS.nextStream : undefined}>
      <button type="button" onClick={() => nextStream && onPickStream(nextStream)} disabled={!nextStream} className={btnCls} aria-label="Next stream">
        <ChevronUp size={v.icon} />
      </button>
    </Tooltip>
  )
  const prevEpisodeBtn = showEpisodes && (
    <Tooltip content={episodeTip('Previous', series.prev)} maxWidth="max-w-sm" side={v.side} shortcut={series.prev ? STREAM_NAV_SHORTCUTS.prevEpisode : undefined}>
      <button type="button" onClick={() => series.prev && onPickEpisode(series.prev)} disabled={!series.prev} className={btnCls} aria-label="Previous episode">
        <ChevronsDown size={v.icon} />
      </button>
    </Tooltip>
  )
  const nextEpisodeBtn = showEpisodes && (
    <Tooltip content={episodeTip('Next', series.next)} maxWidth="max-w-sm" side={v.side} shortcut={series.next ? STREAM_NAV_SHORTCUTS.nextEpisode : undefined}>
      <button type="button" onClick={() => series.next && onPickEpisode(series.next)} disabled={!series.next} className={btnCls} aria-label="Next episode">
        <ChevronsUp size={v.icon} />
      </button>
    </Tooltip>
  )
  const pickerBtn = showPicker && (
    <Tooltip content="Jump to episode…" side={v.side}>
      <button
        ref={anchorRef}
        type="button"
        onClick={() => setPickerOpen(o => !o)}
        className={`${btnCls} ${pickerOpen ? 'bg-white/10 text-gray-200' : ''}`}
        aria-label="Jump to episode"
      >
        <List size={v.icon} />
      </button>
    </Tooltip>
  )

  // Anchored to the List button's screen rect. Row layouts drop below it
  // (flipping up from the bottom half of the viewport) and right-align to
  // it; the rail opens to the left with its top aligned. Height clamps to
  // the available space either way.
  const picker = pickerOpen && anchorRef.current && ReactDOM.createPortal(
    (() => {
      const r = anchorRef.current.getBoundingClientRect()
      let positionStyle: React.CSSProperties
      if (column) {
        positionStyle = {
          position: 'fixed',
          top: Math.max(8, r.top),
          right: Math.max(8, window.innerWidth - r.left + 8),
          zIndex: 61,
          maxHeight: Math.max(160, window.innerHeight - r.top - 12),
        }
      } else {
        const dropUp = r.top > window.innerHeight / 2
        positionStyle = dropUp
          ? { position: 'fixed', bottom: window.innerHeight - r.top + 4, right: Math.max(8, window.innerWidth - r.right), zIndex: 61, maxHeight: Math.max(160, r.top - 16) }
          : { position: 'fixed', top: r.bottom + 4, right: Math.max(8, window.innerWidth - r.right), zIndex: 61, maxHeight: Math.max(160, window.innerHeight - r.bottom - 16) }
      }
      return (
        <>
          <div className="fixed inset-0 z-[60]" onClick={() => setPickerOpen(false)} />
          <div style={positionStyle} className="bg-navy-700 border border-white/10 rounded-lg shadow-xl min-w-[240px] max-w-[320px] overflow-y-auto py-1">
            {/* Newest episode at the top, even though siblings is sorted
                ascending for the prev/next semantics; slice() so the
                reverse cannot mutate the caller's list. */}
            {series.siblings.slice().reverse().map(ep => {
              const isCurrent = ep.relativePath === current.relativePath
              const unavailable = !isCurrent && !!isEpisodeUnavailable?.(ep)
              const disabled = isCurrent || unavailable
              const epNum = ep.meta?.ytEpisode || '?'
              const tone = isCurrent ? 'text-accent-300' : 'text-gray-400'
              return (
                <button
                  key={ep.relativePath}
                  type="button"
                  onClick={() => { if (disabled) return; onPickEpisode(ep); setPickerOpen(false) }}
                  disabled={disabled}
                  className={`flex items-baseline gap-2 w-full px-3 py-1 text-xs text-left transition-colors ${
                    isCurrent ? 'bg-accent-900/25 text-accent-300 cursor-default'
                      : unavailable ? 'text-gray-400 cursor-default'
                      : 'text-gray-300 hover:bg-white/5'
                  }`}
                >
                  <span className={`tabular-nums shrink-0 w-6 text-right ${tone}`}>{epNum}:</span>
                  <span className={`tabular-nums shrink-0 ${tone}`}>{ep.date}</span>
                  <span className={`shrink-0 ${tone}`}>·</span>
                  <TruncatedText text={titleOf(ep)} className={`truncate ${isCurrent ? 'text-accent-300 font-medium' : unavailable ? 'text-gray-400' : 'text-gray-200'}`} />
                  {unavailable && <span className="shrink-0 text-gray-400 italic">(no videos)</span>}
                </button>
              )
            })}
          </div>
        </>
      )
    })(),
    document.body,
  )

  if (column) {
    return (
      <div className="flex flex-col items-center gap-1">
        {pickerBtn}
        {nextEpisodeBtn}
        {nextStreamBtn}
        {children}
        {prevStreamBtn}
        {prevEpisodeBtn}
        {picker}
      </div>
    )
  }
  return (
    <div className="flex items-center gap-0.5">
      {prevStreamBtn}
      {nextStreamBtn}
      {showEpisodes && <span className="w-px h-3.5 bg-white/10 mx-0.5 shrink-0" aria-hidden />}
      {pickerBtn}
      {prevEpisodeBtn}
      {nextEpisodeBtn}
      {picker}
    </div>
  )
}
