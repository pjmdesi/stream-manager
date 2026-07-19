import React, { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react'
import { GripHorizontal, ChevronUp, ChevronDown } from 'lucide-react'
import { Tooltip } from './Tooltip'

interface InputProps extends React.InputHTMLAttributes<HTMLInputElement> {
  label?: string
  /** Rendered inline after the label text (e.g. a dirty-state dot). */
  labelSuffix?: React.ReactNode
  error?: string
  hint?: string
  suffix?: React.ReactNode
  inputPrefix?: React.ReactNode
}

export const Input: React.FC<InputProps> = ({
  label,
  labelSuffix,
  error,
  hint,
  suffix,
  inputPrefix: prefix,
  className = '',
  id,
  ...props
}) => {
  const inputId = id || label?.toLowerCase().replace(/\s+/g, '-')

  return (
    <div className="flex flex-col gap-1">
      {label && (
        <label htmlFor={inputId} className="text-sm font-medium text-gray-300">
          {label}{labelSuffix}
        </label>
      )}
      <div className="relative flex items-center">
        {prefix && (
          <span className="absolute left-3 text-gray-400 pointer-events-none">
            {prefix}
          </span>
        )}
        <input
          id={inputId}
          className={`
            w-full bg-navy-900 border text-gray-200 text-sm rounded-lg
            px-3 py-2 placeholder-gray-600
            focus:outline-none focus:ring-2 focus:ring-purple-500/50 focus:border-purple-500/50
            transition-colors duration-200
            ${error ? 'border-red-500/50' : 'border-white/10'}
            ${prefix ? 'pl-9' : ''}
            ${suffix ? 'pr-9' : ''}
            ${className}
          `}
          {...props}
        />
        {suffix && (
          <span className="absolute right-3 text-gray-400">
            {suffix}
          </span>
        )}
      </div>
      {error && <p className="text-xs text-red-400">{error}</p>}
      {hint && !error && <p className="text-xs text-gray-400">{hint}</p>}
    </div>
  )
}

/**
 * Auto-resize a textarea to fit its content. Pass the controlled value
 * so the hook re-measures whenever it changes; the returned ref attaches
 * to the textarea. Also re-grows on width changes via a ResizeObserver
 * (sidebar/window resize, parent layout shifts).
 *
 * Use this on any bare <textarea> in the app that should grow with its
 * content. The shared Textarea component below applies it
 * automatically (opt-out via `autoGrow={false}`).
 */
export function useAutoGrowTextarea(value: string | undefined, enabled: boolean = true) {
  const ref = useRef<HTMLTextAreaElement>(null)

  // Resize to content. The `+ borderAdjust` covers the box-sizing:
  // border-box case (the height we set includes borders, scrollHeight
  // does not), without which there's a 1-2px scrollbar over the last
  // line of content.
  const grow = useCallback(() => {
    if (!enabled) return
    const ta = ref.current
    if (!ta) return
    ta.style.height = 'auto'
    const borderAdjust = ta.offsetHeight - ta.clientHeight
    ta.style.height = `${ta.scrollHeight + borderAdjust}px`
  }, [enabled])

  useLayoutEffect(() => { grow() }, [value, grow])

  // Re-grow on width changes. Width-only guard so writes from our own
  // grow() (which change height but not width) don't trigger a loop.
  useEffect(() => {
    if (!enabled) return
    const ta = ref.current
    if (!ta) return
    let lastWidth = ta.offsetWidth
    const obs = new ResizeObserver(() => {
      if (ta.offsetWidth === lastWidth) return
      lastWidth = ta.offsetWidth
      grow()
    })
    obs.observe(ta)
    return () => obs.disconnect()
  }, [enabled, grow])

  return ref
}

interface TextareaProps extends React.TextareaHTMLAttributes<HTMLTextAreaElement> {
  label?: string
  error?: string
  hint?: string
  /** Auto-resize to fit content as the user types. Defaults to true —
   *  every textarea in the app should grow to fit unless there's a
   *  specific reason not to (in which case pass `autoGrow={false}` and
   *  rely on the `rows` attribute for a fixed height). `rows` still
   *  acts as the minimum height when autoGrow is on. */
  autoGrow?: boolean
}

export const Textarea: React.FC<TextareaProps> = ({
  label,
  error,
  hint,
  className = '',
  id,
  autoGrow = true,
  value,
  ...props
}) => {
  const inputId = id || label?.toLowerCase().replace(/\s+/g, '-')
  // Auto-grow is paused once the user manually drags the resize
  // handle below — their explicit choice should stick until they
  // double-click the handle to re-engage content-fitting.
  const [manuallyResized, setManuallyResized] = useState(false)
  const ref = useAutoGrowTextarea(value as string | undefined, autoGrow && !manuallyResized)

  // Drag-to-resize via a custom handle strip below the textarea. Mirrors
  // the EditableTextField pattern from the streams sidebar — full-bottom-
  // edge hit target instead of the native bottom-right corner. The
  // mousedown flips off auto-grow so subsequent content changes don't
  // fight the user's chosen height. Double-click re-enables auto-grow
  // and the useAutoGrowTextarea hook re-fires its grow() (the hook
  // re-runs when its `enabled` arg flips back on), snapping the
  // textarea back to content height.
  const handleResizeStart = useCallback((e: React.MouseEvent) => {
    if (!autoGrow) return
    e.preventDefault()
    const ta = ref.current
    if (!ta) return
    setManuallyResized(true)
    const startY = e.clientY
    const startHeight = ta.offsetHeight
    const onMove = (me: MouseEvent) => {
      const next = Math.max(40, startHeight + me.clientY - startY)
      ta.style.height = `${next}px`
    }
    const onUp = () => {
      window.removeEventListener('mousemove', onMove)
      window.removeEventListener('mouseup', onUp)
    }
    window.addEventListener('mousemove', onMove)
    window.addEventListener('mouseup', onUp)
  }, [autoGrow, ref])

  const handleResizeReset = useCallback(() => {
    if (!autoGrow) return
    setManuallyResized(false)
  }, [autoGrow])

  return (
    <div className="flex flex-col gap-1">
      {label && (
        <label htmlFor={inputId} className="text-sm font-medium text-gray-300">
          {label}
        </label>
      )}
      <div className="flex flex-col">
        <textarea
          id={inputId}
          ref={ref}
          value={value}
          className={`
            relative z-10
            w-full bg-navy-900 border text-gray-200 text-sm rounded-lg
            px-3 py-2 placeholder-gray-600 resize-none
            focus:outline-none focus:ring-2 focus:ring-purple-500/50 focus:border-purple-500/50
            transition-colors duration-200
            ${error ? 'border-red-500/50' : 'border-white/10'}
            ${className}
          `}
          {...props}
        />
        {autoGrow && (
          // Tucks 8px (= the textarea's bottom corner radius) up into
          // the textarea so the handle's top edges sit BEHIND the
          // textarea's rounded bottom corners. The textarea has
          // `relative z-10` so its opaque background covers the
          // tucked top of the handle except in the rounded-corner
          // cutouts — so the hover tint only peeks through where the
          // textarea's bg ends due to the rounded shape, and the
          // visible portion of the handle continues below.
          <div
            onMouseDown={handleResizeStart}
            onDoubleClick={handleResizeReset}
            className="group relative z-0 cursor-ns-resize flex items-center justify-center h-4 rounded-b-lg hover:bg-white/5 transition-colors pt-[8px] mt-[-8px]"
          >
            <Tooltip content="Drag to resize · double-click to reset" side="bottom">
              <GripHorizontal size={10} className="text-gray-500 group-hover:text-gray-300" />
            </Tooltip>
          </div>
        )}
      </div>
      {error && <p className="text-xs text-red-400">{error}</p>}
      {hint && !error && <p className="text-xs text-gray-400">{hint}</p>}
    </div>
  )
}

interface SelectProps extends React.SelectHTMLAttributes<HTMLSelectElement> {
  label?: string
  error?: string
  options: { value: string; label: string }[]
}

export const Select: React.FC<SelectProps> = ({
  label,
  error,
  options,
  className = '',
  id,
  ...props
}) => {
  const inputId = id || label?.toLowerCase().replace(/\s+/g, '-')

  return (
    <div className="flex flex-col gap-1">
      {label && (
        <label htmlFor={inputId} className="text-sm font-medium text-gray-300">
          {label}
        </label>
      )}
      <select
        id={inputId}
        className={`
          w-full bg-navy-900 border text-gray-200 text-sm rounded-lg
          px-3 py-2
          focus:outline-none focus:ring-2 focus:ring-purple-500/50 focus:border-purple-500/50
          transition-colors duration-200
          ${error ? 'border-red-500/50' : 'border-white/10'}
          ${className}
        `}
        {...props}
      >
        {options.map(opt => (
          <option key={opt.value} value={opt.value} className="bg-navy-900">
            {opt.label}
          </option>
        ))}
      </select>
      {error && <p className="text-xs text-red-400">{error}</p>}
    </div>
  )
}

interface NumberInputProps {
  value: number
  onChange: (next: number) => void
  min?: number
  max?: number
  /** Per-click increment for the +/- buttons (and arrow keys when the
   *  input is focused). Defaults to 1. */
  step?: number
  placeholder?: string
  disabled?: boolean
  /** Extra classes on the outer flex wrapper — typically used to set
   *  width (e.g. `w-full`, `w-20`). */
  className?: string
  title?: string
  /** Small gray "(…)" note rendered inside the field's right edge (before
   *  the spinner buttons) — e.g. the effective value when the entered one
   *  is clamped by geometry. Display-only, non-interactive. */
  inlineNote?: string
  'aria-label'?: string
}

/**
 * NumberInput — number field with custom vertical +/- buttons stacked
 * on the right edge. Replaces the native Chromium number-spinner with
 * a styled control consistent with the rest of the app's inputs.
 * Pair with `min`/`max` to clamp; the buttons disable at the extremes.
 *
 * The component is a primitive: it owns no label/error/hint. Wrap it
 * in your own layout to add those. Used in the thumbnail editor's
 * properties panel (x, y, width, height, rotation, opacity, font
 * size, stroke, shadow offsets, etc.) and intended for any other
 * single-row number field that needs the +/- affordance.
 */
export const NumberInput: React.FC<NumberInputProps> = ({
  value, onChange, min, max, step = 1, placeholder, disabled, className = '', title,
  inlineNote,
  'aria-label': ariaLabel,
}) => {
  const clamp = (n: number) => {
    let next = n
    if (min !== undefined) next = Math.max(min, next)
    if (max !== undefined) next = Math.min(max, next)
    return next
  }
  // Step amount honors Shift for a 10× nudge — matches the convention
  // in Photoshop / Affinity / Figma's number fields.
  const stepBy = (dir: 1 | -1, shift: boolean) =>
    onChange(clamp(value + dir * step * (shift ? 10 : 1)))
  const atMin = min !== undefined && value <= min
  const atMax = max !== undefined && value >= max

  const field = (
    <div className={`relative flex items-stretch ${className}`}>
      {inlineNote && (
        <span className="absolute right-5 top-1/2 -translate-y-1/2 text-[10px] text-gray-500 tabular-nums pointer-events-none">
          ({inlineNote})
        </span>
      )}
      <input
        type="number"
        value={Number.isFinite(value) ? value : ''}
        onChange={e => {
          const n = Number(e.target.value)
          onChange(Number.isFinite(n) ? clamp(n) : 0)
        }}
        // Arrow keys nudge the value (Shift → 10× step). We preventDefault
        // so the browser's native step doesn't fire alongside ours
        // (would double-step). Native step is also stripped from the
        // Chromium spinner via the arbitrary selectors below, but
        // arrow keys still trigger it on a focused number input.
        onKeyDown={e => {
          if (e.key === 'ArrowUp') {
            e.preventDefault()
            stepBy(1, e.shiftKey)
          } else if (e.key === 'ArrowDown') {
            e.preventDefault()
            stepBy(-1, e.shiftKey)
          }
        }}
        min={min}
        max={max}
        step={step}
        placeholder={placeholder}
        disabled={disabled}
        aria-label={ariaLabel}
        // The arbitrary selectors strip Chromium's native spin buttons
        // since we render our own vertical +/- buttons to the right.
        className={`w-full bg-navy-900 border border-r-0 border-white/10 rounded-l-lg px-2 py-1 ${inlineNote ? 'pr-12' : ''} text-xs text-gray-200 placeholder-gray-500 focus:outline-none focus:border-purple-500/50 transition-colors disabled:opacity-50 [appearance:textfield] [&::-webkit-inner-spin-button]:appearance-none [&::-webkit-outer-spin-button]:appearance-none`}
      />
      <div className="flex flex-col shrink-0">
        <Tooltip content="Increment (Shift = ×10)" side="right" triggerClassName="flex-1 flex min-h-0">
        <button
          type="button"
          tabIndex={-1}
          onClick={e => stepBy(1, e.shiftKey)}
          disabled={disabled || atMax}
          className="flex-1 flex items-center justify-center w-4 bg-navy-900 border border-l-0 border-b-0 border-white/10 rounded-tr-lg text-gray-400 hover:text-gray-200 hover:bg-white/5 transition-colors disabled:opacity-30 disabled:cursor-not-allowed disabled:hover:bg-transparent disabled:hover:text-gray-400"
          aria-label="Increment"
        >
          <ChevronUp size={10} strokeWidth={2.5} />
        </button>
        </Tooltip>
        <Tooltip content="Decrement (Shift = ×10)" side="right" triggerClassName="flex-1 flex min-h-0">
        <button
          type="button"
          tabIndex={-1}
          onClick={e => stepBy(-1, e.shiftKey)}
          disabled={disabled || atMin}
          className="flex-1 flex items-center justify-center w-4 bg-navy-900 border border-l-0 border-white/10 rounded-br-lg text-gray-400 hover:text-gray-200 hover:bg-white/5 transition-colors disabled:opacity-30 disabled:cursor-not-allowed disabled:hover:bg-transparent disabled:hover:text-gray-400"
          aria-label="Decrement"
        >
          <ChevronDown size={10} strokeWidth={2.5} />
        </button>
        </Tooltip>
      </div>
    </div>
  )
  // The optional `title` prop is a field-level tooltip (custom Tooltip, never
  // the native title attribute — app rule).
  return title ? <Tooltip content={title} triggerClassName="block">{field}</Tooltip> : field
}
