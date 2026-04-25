import React from 'react'
import { Check } from 'lucide-react'

interface CheckboxProps {
  checked: boolean
  onChange: (checked: boolean) => void
  label?: React.ReactNode
  color?: 'purple' | 'red' | 'green' | 'blue'
  size?: 'sm' | 'md'
  disabled?: boolean
  className?: string
}

const COLOR_MAP = {
  purple: 'bg-purple-700 border-purple-700',
  red:    'bg-red-500 border-red-500',
  green:  'bg-green-600 border-green-600',
  blue:   'bg-blue-500 border-blue-500',
}

export function Checkbox({
  checked,
  onChange,
  label,
  color = 'purple',
  size = 'md',
  disabled = false,
  className = '',
}: CheckboxProps) {
  const boxSize = size === 'sm' ? 'w-3.5 h-3.5' : 'w-4 h-4'
  const iconSize = size === 'sm' ? 10 : 11
  const textSize = size === 'sm' ? 'text-xs' : 'text-sm'

  return (
    <button
      type="button"
      role="checkbox"
      aria-checked={checked}
      onClick={() => !disabled && onChange(!checked)}
      disabled={disabled}
      className={`flex items-center gap-2 select-none text-left ${disabled ? 'opacity-50 cursor-not-allowed' : 'cursor-pointer'} ${className}`}
    >
      <div className={`${boxSize} rounded border-2 flex items-center justify-center transition-colors shrink-0 ${
        checked ? COLOR_MAP[color] : 'border-gray-600 hover:border-gray-400'
      }`}>
        {checked && <Check size={iconSize} className="text-white" strokeWidth={3} />}
      </div>
      {label && <span className={`${textSize} text-gray-300`}>{label}</span>}
    </button>
  )
}
