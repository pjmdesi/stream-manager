import React, { useCallback, useEffect, useLayoutEffect, useRef } from 'react'

interface InputProps extends React.InputHTMLAttributes<HTMLInputElement> {
  label?: string
  error?: string
  hint?: string
  suffix?: React.ReactNode
  inputPrefix?: React.ReactNode
}

export const Input: React.FC<InputProps> = ({
  label,
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
          {label}
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
  const ref = useAutoGrowTextarea(value as string | undefined, autoGrow)

  return (
    <div className="flex flex-col gap-1">
      {label && (
        <label htmlFor={inputId} className="text-sm font-medium text-gray-300">
          {label}
        </label>
      )}
      <textarea
        id={inputId}
        ref={ref}
        value={value}
        className={`
          w-full bg-navy-900 border text-gray-200 text-sm rounded-lg
          px-3 py-2 placeholder-gray-600 resize-none
          focus:outline-none focus:ring-2 focus:ring-purple-500/50 focus:border-purple-500/50
          transition-colors duration-200
          ${error ? 'border-red-500/50' : 'border-white/10'}
          ${className}
        `}
        {...props}
      />
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
