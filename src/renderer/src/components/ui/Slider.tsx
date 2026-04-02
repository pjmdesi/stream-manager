import React from 'react'

interface SliderProps {
  value: number
  min?: number
  max?: number
  step?: number
  onChange: (value: number) => void
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
  className = '',
  color = 'purple',
  vertical = false
}) => {
  const percent = ((value - min) / (max - min)) * 100

  const trackColors = {
    purple: 'accent-purple-500',
    blue: 'accent-blue-500',
    green: 'accent-green-500'
  }

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
          className={`h-24 w-1.5 cursor-pointer appearance-none rounded-full bg-white/10 ${trackColors[color]} [writing-mode:vertical-lr] [direction:rtl]`}
          style={{ WebkitAppearance: 'slider-vertical' } as React.CSSProperties}
        />
      </div>
    )
  }

  return (
    <div className={`relative flex items-center ${className}`}>
      <div className="relative w-full h-1.5 bg-white/10 rounded-full overflow-hidden">
        <div
          className={`absolute h-full transition-all ${color === 'purple' ? 'bg-purple-500' : color === 'blue' ? 'bg-blue-500' : 'bg-green-500'}`}
          style={{ width: `${percent}%` }}
        />
      </div>
      <input
        type="range"
        min={min}
        max={max}
        step={step}
        value={value}
        onChange={e => onChange(parseFloat(e.target.value))}
        className={`absolute inset-0 w-full opacity-0 cursor-pointer h-6`}
      />
    </div>
  )
}
