import React, { useState, useRef, useEffect, useMemo, useLayoutEffect, Fragment } from 'react'
import ReactDOM from 'react-dom'
import { CalendarDays, ChevronLeft, ChevronRight } from 'lucide-react'
import { useStore } from '../../hooks/useStore'

/** A single date's marker for the popup's stream dots. `archived` adds a
 *  green ring to that dot (matching the sidebar calendar). The array
 *  length drives how many dots render (capped at 4). */
export interface DateMark { archived?: boolean }

const MONTHS_SHORT = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec']
const MONTHS_LONG = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December']

function isoToday(): string {
  const d = new Date()
  const y = d.getFullYear()
  const m = String(d.getMonth() + 1).padStart(2, '0')
  const day = String(d.getDate()).padStart(2, '0')
  return `${y}-${m}-${day}`
}

function pad(n: number) { return String(n).padStart(2, '0') }

/**
 * DatePicker — a date field that keeps the native `<input type="date">`
 * for typing + arrow-key editing (locale-correct, free), but hides the
 * native calendar dropdown and replaces it with a custom popup that
 * honors the app's first-day-of-week setting and can render per-day
 * stream dots. Value is a `YYYY-MM-DD` string (or '' for empty).
 */
export function DatePicker({
  value, onChange, disabled, className, markedDates, min,
}: {
  value: string
  onChange: (v: string) => void
  disabled?: boolean
  className?: string
  /** ISO date → markers. Drives the stream dots in the popup. */
  markedDates?: Map<string, DateMark[]>
  /** Optional minimum selectable date (YYYY-MM-DD). Days before it are
   *  disabled in the popup; the native input also gets the `min`. */
  min?: string
}) {
  const { config } = useStore()
  const firstDayMondayBased = config.calendarFirstDayOfWeek === 'monday'

  const [open, setOpen] = useState(false)
  const wrapRef = useRef<HTMLDivElement>(null)
  const popupRef = useRef<HTMLDivElement>(null)
  // Portal popup position (fixed-coords), measured from the input so the
  // popup escapes the modal's overflow:auto clipping. Flips above the
  // field when there isn't room below.
  const [pos, setPos] = useState<{ left: number; top: number } | null>(null)

  const today = useMemo(() => isoToday(), [])

  // View month — initialized from the value (or today) and re-synced to
  // the value each time the popup opens so it lands on the current pick.
  const valid = /^\d{4}-\d{2}-\d{2}$/.test(value)
  const base = valid ? value : today
  const [viewYear, setViewYear] = useState(() => parseInt(base.slice(0, 4), 10))
  const [viewMonth, setViewMonth] = useState(() => parseInt(base.slice(5, 7), 10) - 1)

  // Month/year quick-nav (opens on the month label click) — mirrors the
  // sidebar calendar's behavior.
  const [monthPickerOpen, setMonthPickerOpen] = useState(false)
  const [pickerYear, setPickerYear] = useState(viewYear)

  useEffect(() => {
    if (!open) return
    const b = /^\d{4}-\d{2}-\d{2}$/.test(value) ? value : today
    setViewYear(parseInt(b.slice(0, 4), 10))
    setViewMonth(parseInt(b.slice(5, 7), 10) - 1)
    setMonthPickerOpen(false)
  }, [open]) // eslint-disable-line react-hooks/exhaustive-deps

  // Close on outside click — the popup is portaled out of the wrapper,
  // so the check excludes both the wrapper (input + calendar button)
  // and the popup itself.
  useEffect(() => {
    if (!open) return
    const handler = (e: MouseEvent) => {
      const t = e.target as Node
      if (wrapRef.current?.contains(t)) return
      if (popupRef.current?.contains(t)) return
      setOpen(false)
    }
    document.addEventListener('mousedown', handler)
    return () => document.removeEventListener('mousedown', handler)
  }, [open])

  // Position the portaled popup from the input's rect before paint.
  useLayoutEffect(() => {
    if (!open) { setPos(null); return }
    const anchor = wrapRef.current
    const pop = popupRef.current
    if (!anchor) return
    const r = anchor.getBoundingClientRect()
    const popH = pop?.offsetHeight ?? 300
    const popW = pop?.offsetWidth ?? 240 // w-60
    const gap = 4
    const below = r.bottom + gap
    const fitsBelow = below + popH <= window.innerHeight - 8
    const top = fitsBelow ? below : Math.max(8, r.top - gap - popH)
    // Right-align the popup's right edge with the input's (matches the
    // calendar icon's position). Clamp so it never runs off either edge.
    const left = Math.min(window.innerWidth - 8 - popW, Math.max(8, r.right - popW))
    setPos({ left, top })
  }, [open, viewYear, viewMonth, monthPickerOpen])

  // Close on Escape. Capture phase + stopPropagation so the Esc that
  // closes the CALENDAR is consumed here and can't also reach the
  // containing Modal's own Escape handler — one keypress used to close
  // the calendar AND the whole New Stream / Reschedule modal behind it.
  useEffect(() => {
    if (!open) return
    const handler = (e: KeyboardEvent) => {
      if (e.key !== 'Escape') return
      e.stopPropagation()
      setOpen(false)
    }
    window.addEventListener('keydown', handler, true)
    return () => window.removeEventListener('keydown', handler, true)
  }, [open])

  // 6-week grid (42 cells) starting on the first-day-of-week column on or
  // before the 1st of the viewed month. Same start-index math as the
  // sidebar calendar.
  const cells = useMemo(() => {
    const first = new Date(viewYear, viewMonth, 1)
    const startDow = firstDayMondayBased ? (first.getDay() + 6) % 7 : first.getDay()
    const out: Array<{ iso: string; day: number; inMonth: boolean }> = []
    const start = new Date(viewYear, viewMonth, 1 - startDow)
    for (let i = 0; i < 42; i++) {
      const d = new Date(start)
      d.setDate(start.getDate() + i)
      const iso = `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`
      out.push({ iso, day: d.getDate(), inMonth: d.getMonth() === viewMonth })
    }
    return out
  }, [viewYear, viewMonth, firstDayMondayBased])

  const DOW = firstDayMondayBased
    ? ['M', 'T', 'W', 'T', 'F', 'S', 'S']
    : ['S', 'M', 'T', 'W', 'T', 'F', 'S']

  const prevMonth = () => {
    setViewMonth(m => { if (m === 0) { setViewYear(y => y - 1); return 11 } return m - 1 })
  }
  const nextMonth = () => {
    setViewMonth(m => { if (m === 11) { setViewYear(y => y + 1); return 0 } return m + 1 })
  }
  const pick = (iso: string) => { onChange(iso); setOpen(false) }

  return (
    <div ref={wrapRef} className="relative">
      <input
        type="date"
        value={value}
        min={min}
        onChange={e => onChange(e.target.value)}
        disabled={disabled}
        // `date-picker-input` hides the native calendar dropdown
        // indicator (see index.css) so only our custom popup opens; the
        // text-segment typing + arrow-key editing stay native.
        className={`date-picker-input ${className ?? ''}`}
      />
      <button
        type="button"
        onClick={() => !disabled && setOpen(o => !o)}
        disabled={disabled}
        aria-label="Open calendar"
        className="absolute right-2 top-1/2 -translate-y-1/2 text-gray-400 hover:text-gray-200 transition-colors disabled:opacity-40 disabled:cursor-not-allowed"
        tabIndex={-1}
      >
        <CalendarDays size={14} />
      </button>

      {open && ReactDOM.createPortal(
        <div
          ref={popupRef}
          style={{ position: 'fixed', top: pos?.top ?? -9999, left: pos?.left ?? -9999, visibility: pos ? 'visible' : 'hidden' }}
          className="z-[9999] bg-navy-900 border border-white/10 rounded-lg shadow-xl p-2 w-60"
        >
          {/* Month header with nav */}
          <div className="relative flex items-center justify-between mb-2">
            <button
              type="button"
              onClick={prevMonth}
              className="p-1 rounded text-gray-400 hover:text-gray-200 hover:bg-white/5 transition-colors"
              aria-label="Previous month"
            >
              <ChevronLeft size={14} />
            </button>
            <button
              type="button"
              onClick={() => { setPickerYear(viewYear); setMonthPickerOpen(o => !o) }}
              className="text-xs font-medium text-gray-200 hover:text-white px-2 py-0.5 rounded hover:bg-white/5 transition-colors"
            >
              {MONTHS_LONG[viewMonth]} {viewYear}
            </button>
            <button
              type="button"
              onClick={nextMonth}
              className="p-1 rounded text-gray-400 hover:text-gray-200 hover:bg-white/5 transition-colors"
              aria-label="Next month"
            >
              <ChevronRight size={14} />
            </button>

            {monthPickerOpen && (
              <div className="absolute top-full left-1/2 -translate-x-1/2 mt-1 z-10 bg-navy-900 border border-white/10 rounded-lg shadow-lg p-2 w-56">
                <div className="flex items-center justify-between mb-2">
                  <button type="button" onClick={() => setPickerYear(y => y - 1)} className="p-1 rounded text-gray-400 hover:text-gray-200 hover:bg-white/5 transition-colors" aria-label="Previous year">
                    <ChevronLeft size={14} />
                  </button>
                  <span className="text-xs font-medium text-gray-200">{pickerYear}</span>
                  <button type="button" onClick={() => setPickerYear(y => y + 1)} className="p-1 rounded text-gray-400 hover:text-gray-200 hover:bg-white/5 transition-colors" aria-label="Next year">
                    <ChevronRight size={14} />
                  </button>
                </div>
                <div className="grid grid-cols-3 gap-1">
                  {MONTHS_SHORT.map((m, i) => {
                    const isSel = pickerYear === viewYear && i === viewMonth
                    return (
                      <button
                        key={m}
                        type="button"
                        onClick={() => { setViewYear(pickerYear); setViewMonth(i); setMonthPickerOpen(false) }}
                        className={[
                          'py-1.5 rounded text-xs transition-colors',
                          isSel ? 'bg-purple-600/30 text-purple-200 border border-purple-500/40' : 'text-gray-300 hover:bg-white/5',
                        ].join(' ')}
                      >
                        {m}
                      </button>
                    )
                  })}
                </div>
              </div>
            )}
          </div>

          {/* Day-of-week header */}
          <div className="grid grid-cols-7 gap-0.5 mb-1">
            {DOW.map((d, i) => (
              <div key={i} className="text-center text-[10px] uppercase tracking-wider text-gray-500">{d}</div>
            ))}
          </div>

          {/* Day grid */}
          <div className="grid grid-cols-7 gap-0.5">
            {cells.map((c, i) => {
              const marks = markedDates?.get(c.iso)
              const has = !!marks?.length
              const isToday = c.iso === today
              const isSelected = c.iso === value
              const isFuture = c.iso > today
              const belowMin = !!min && c.iso < min
              const dotColor = isFuture ? 'bg-teal-400' : 'bg-gray-400'
              const dayNumberClass = isSelected
                ? 'text-purple-100 font-semibold'
                : isToday
                  ? 'text-purple-300 font-semibold'
                  : !c.inMonth
                    ? 'text-gray-600'
                    : has
                      ? 'text-gray-200'
                      : 'text-gray-400'
              return (
                <Fragment key={`${c.iso}-${i}`}>
                  <button
                    type="button"
                    disabled={belowMin}
                    onClick={() => pick(c.iso)}
                    className={[
                      'relative h-7 w-full flex items-center justify-center rounded transition-colors',
                      belowMin ? 'cursor-not-allowed opacity-30' : 'hover:bg-white/10 cursor-pointer',
                      isSelected ? 'bg-purple-600/30 ring-1 ring-purple-500/50' : isToday ? 'ring-1 ring-purple-500/40' : '',
                    ].join(' ')}
                  >
                    <span className={`text-xs leading-none ${dayNumberClass}`}>{c.day}</span>
                    {has && !isSelected && (
                      <span className="absolute bottom-0.5 left-1/2 -translate-x-1/2 flex items-center gap-0.5">
                        {marks!.slice(0, 4).map((mk, idx) => (
                          <span
                            key={idx}
                            className={`w-1 h-1 rounded-full ${dotColor} ${mk.archived ? 'ring-1 ring-green-400' : ''}`}
                          />
                        ))}
                      </span>
                    )}
                  </button>
                </Fragment>
              )
            })}
          </div>
        </div>,
        document.body
      )}
    </div>
  )
}
