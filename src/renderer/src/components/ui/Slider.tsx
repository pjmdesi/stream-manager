import React, { useRef, useCallback } from 'react'

interface SliderProps {
  value: number
  min?: number
  max?: number
  step?: number
  onChange: (value: number) => void
  onDrag?: (value: number) => void    // called on every mousemove during drag
  onCommit?: (value: number) => void  // called once on mouseup
  onHover?: (ratio: number | null) => void  // called with 0–1 ratio on hover, null on leave
  className?: string
  color?: 'purple' | 'blue' | 'green'
  vertical?: boolean
}

export const Slider: React.FC<SliderProps> = ({
  value,
  min = 0,
  max = 1,
  step = 0.01,
  onChange,
  onDrag,
  onCommit,
  onHover,
  className = '',
  color = 'purple',
  vertical = false
}) => {
  const percent = ((value - min) / (max - min)) * 100
  const trackRef = useRef<HTMLDivElement>(null)

  const fillColor = color === 'purple' ? 'bg-purple-500' : color === 'blue' ? 'bg-blue-500' : 'bg-green-500'

  const valueFromMouse = useCallback((clientX: number) => {
    const rect = trackRef.current?.getBoundingClientRect()
    if (!rect) return value
    const ratio = Math.max(0, Math.min(1, (clientX - rect.left) / rect.width))
    const raw = min + ratio * (max - min)
    // Snap to step
    const stepped = Math.round(raw / step) * step
    return Math.max(min, Math.min(max, stepped))
  }, [min, max, step, value])

  const startDrag = useCallback((e: React.MouseEvent) => {
    if (e.button !== 0) return
    e.preventDefault()
    const initial = valueFromMouse(e.clientX)
    // Use onDrag for the initial click if provided, otherwise onChange
    ;(onDrag ?? onChange)(initial)
    const onMove = (me: MouseEvent) => (onDrag ?? onChange)(valueFromMouse(me.clientX))
    const onUp = (me: MouseEvent) => {
      window.removeEventListener('mousemove', onMove)
      window.removeEventListener('mouseup', onUp)
      const final = valueFromMouse(me.clientX)
      if (onCommit) onCommit(final)
      else onChange(final)
    }
    window.addEventListener('mousemove', onMove)
    window.addEventListener('mouseup', onUp)
  }, [onChange, onDrag, onCommit, valueFromMouse])

  if (vertical) {
    return (
      <div className={`flex flex-col items-center ${className}`}>
        <input
          type="range"
          min={min}
          max={max}
          step={step}
          value={value}
          onChange={e => onChange(parseFloat(e.target.value))}
          className={`h-24 w-1.5 cursor-pointer appearance-none rounded-full bg-white/10 [writing-mode:vertical-lr] [direction:rtl]`}
          style={{ WebkitAppearance: 'slider-vertical' } as React.CSSProperties}
        />
      </div>
    )
  }

  return (
    <div
      ref={trackRef}
      className={`relative flex items-center cursor-pointer h-[10px] ${className}`}
      onMouseDown={startDrag}
      onMouseMove={onHover ? (e => {
        const rect = trackRef.current?.getBoundingClientRect()
        if (rect) onHover(Math.max(0, Math.min(1, (e.clientX - rect.left) / rect.width)))
      }) : undefined}
      onMouseLeave={onHover ? (() => onHover(null)) : undefined}
    >
      <div className="relative w-full h-1.5 bg-white/10 rounded-full overflow-hidden pointer-events-none">
        <div
          className={`absolute h-full ${fillColor}`}
          style={{ width: `${percent}%` }}
        />
      </div>
    </div>
  )
}
