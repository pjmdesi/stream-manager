import React, { useEffect, useRef, useState } from 'react'
import { Check } from 'lucide-react'
import { Tooltip } from './Tooltip'
import { rowActionClass } from './rowAction'

/** A small icon button that copies a URL to the clipboard and shows a
 *  check for a moment. Row-action chrome, so it sits with the other
 *  small controls in a row or a lockup. */
export function CopyLinkButton({ url, label, icon, text, disabled }: {
  url: string
  /** What is copied, for the tooltip: "Copy video link". */
  label: string
  icon: React.ReactNode
  /** A short word beside the icon ("Link", "Studio") when two of these
   *  sit together and the icon alone would not tell them apart. */
  text?: string
  disabled?: boolean
}) {
  const [copied, setCopied] = useState(false)
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null)
  useEffect(() => () => { if (timer.current) clearTimeout(timer.current) }, [])
  return (
    <Tooltip content={copied ? 'Copied!' : label} side="top">
      <button
        type="button"
        aria-label={label}
        disabled={disabled}
        onClick={async () => {
          try {
            await navigator.clipboard.writeText(url)
            setCopied(true)
            if (timer.current) clearTimeout(timer.current)
            timer.current = setTimeout(() => setCopied(false), 1500)
          } catch { /* clipboard refused */ }
        }}
        className={rowActionClass('gray', 'sm')}
      >
        {copied ? <Check size={12} className="text-green-400" /> : icon}
        {text && <span>{text}</span>}
      </button>
    </Tooltip>
  )
}
