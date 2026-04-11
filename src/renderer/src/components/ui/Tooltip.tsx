import React from 'react'

type TooltipSide = 'top' | 'bottom' | 'left' | 'right'

interface TooltipProps {
  content: React.ReactNode
  side?: TooltipSide
  width?: string
  children: React.ReactNode
}

const SIDE_CLASSES: Record<TooltipSide, { wrapper: string; arrow: string }> = {
  top: {
    wrapper: 'bottom-full left-1/2 -translate-x-1/2 mb-2',
    arrow: 'absolute top-full left-1/2 -translate-x-1/2 border-4 border-transparent border-t-white/10',
  },
  bottom: {
    wrapper: 'top-full left-1/2 -translate-x-1/2 mt-2',
    arrow: 'absolute bottom-full left-1/2 -translate-x-1/2 border-4 border-transparent border-b-white/10',
  },
  left: {
    wrapper: 'right-full top-1/2 -translate-y-1/2 mr-2',
    arrow: 'absolute left-full top-1/2 -translate-y-1/2 border-4 border-transparent border-l-white/10',
  },
  right: {
    wrapper: 'left-full top-1/2 -translate-y-1/2 ml-2',
    arrow: 'absolute right-full top-1/2 -translate-y-1/2 border-4 border-transparent border-r-white/10',
  },
}

export function Tooltip({ content, side = 'top', width = 'w-64', children }: TooltipProps) {
  const { wrapper, arrow } = SIDE_CLASSES[side]

  return (
    <div className="relative group inline-flex">
      {children}
      <div
        className={`pointer-events-none absolute ${wrapper} ${width} rounded-lg bg-navy-800 border border-white/10 px-3 py-2.5 text-xs text-gray-300 leading-relaxed shadow-xl opacity-0 group-hover:opacity-100 transition-opacity z-50`}
      >
        {content}
        <div className={arrow} />
      </div>
    </div>
  )
}
