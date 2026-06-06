import React from 'react'
import { CollapsibleLabel } from './CollapsibleLabel'

interface ButtonProps extends React.ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: 'primary' | 'secondary' | 'ghost' | 'danger' | 'success'
  size?: 'icon-sm' | 'sm' | 'md' | 'lg'
  icon?: React.ReactNode
  loading?: boolean
  /**
   * Wraps `children` in a smoothly-animating width container that
   * collapses to icon-only at narrow widths and expands to icon+label
   * at wider widths. Pass the Tailwind class(es) that should trigger
   * expansion, e.g. `"@2xl:grid-cols-[1fr] @2xl:ms-0"`. The classes
   * MUST be statically present at the call site so Tailwind's JIT
   * picks them up.
   *
   * Replaces the `<span className="hidden @2xl:inline">Label</span>`
   * pattern: `display:none` can't be transitioned, but the `0fr`↔`1fr`
   * grid-template-columns trick CAN, so the button's width slides
   * smoothly between states.
   *
   * Implementation uses two nested spans:
   *   outer:  inline-grid grid-cols-[0fr] -ms-2  ← the negative margin
   *           cancels the button's `gap-2` while collapsed so the
   *           icon-only state has no extra whitespace.
   *   inner:  overflow-hidden whitespace-nowrap  ← clips text during
   *                                               the slide.
   * The supplied expansion class lifts `grid-cols-[0fr]→[1fr]` and
   * `-ms-2 → ms-0` in lockstep, both transitioning.
   *
   * Respects the user's disable-animations / slow-animations settings.
   *
   * Example:
   *   <Button icon={<Tags />} collapsibleLabel="@2xl:grid-cols-[1fr] @2xl:ms-0">
   *     Manage Tags
   *   </Button>
   */
  collapsibleLabel?: string
  /**
   * Pass-through to <CollapsibleLabel collapsed>. Set `true` to force
   * the label into the collapsed state regardless of the container
   * query, useful when a slide-animation needs the collapse to fire at
   * t=0 instead of waiting for the container-query crossover mid-slide.
   * Only meaningful when `collapsibleLabel` is also set.
   */
  labelCollapsed?: boolean
}

export const Button: React.FC<ButtonProps> = ({
  variant = 'secondary',
  size = 'md',
  icon,
  loading,
  children,
  className = '',
  disabled,
  collapsibleLabel,
  labelCollapsed,
  ...props
}) => {
  const baseClasses = 'inline-flex items-center gap-2 font-medium rounded-lg transition-all duration-200 focus:outline-none focus:ring-2 focus:ring-offset-1 focus:ring-offset-navy-800 disabled:opacity-50 disabled:cursor-not-allowed'

  const variantClasses = {
    primary: 'bg-purple-800 hover:bg-purple-700 text-white focus:ring-purple-500 shadow-lg shadow-purple-900/30',
    secondary: 'bg-surface-100 hover:bg-surface-200 text-gray-200 border border-white/10 focus:ring-purple-500/50',
    ghost: 'hover:bg-white/5 text-gray-400 hover:text-gray-200 focus:ring-purple-500/50',
    danger: 'bg-red-900/30 hover:bg-red-800/50 text-red-400 border border-red-800/50 focus:ring-red-500/50',
    success: 'bg-green-900/30 hover:bg-green-800/50 text-green-400 border border-green-800/50 focus:ring-green-500/50'
  }

  const sizeClasses = {
    'icon-sm': 'p-2 text-xs',
    sm: 'px-2.5 py-1.5 text-xs',
    md: 'px-4 py-2 text-sm',
    lg: 'px-5 py-2.5 text-base'
  }

  return (
    <button
      className={`${baseClasses} ${variantClasses[variant]} ${sizeClasses[size]} ${className}`}
      disabled={disabled || loading}
      // data-variant lets the Modal autofocus logic distinguish
      // action buttons (primary / danger / success) from cancel-style
      // ghost/secondary ones — see Modal.tsx tryFocus().
      data-variant={variant}
      {...props}
    >
      {loading ? (
        <svg className="animate-spin h-4 w-4" viewBox="0 0 24 24" fill="none">
          <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
          <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
        </svg>
      ) : icon ? (
        <span className="shrink-0">{icon}</span>
      ) : null}
      {collapsibleLabel ? (
        <CollapsibleLabel expandClass={collapsibleLabel} collapsed={labelCollapsed}>
          {children}
        </CollapsibleLabel>
      ) : children}
    </button>
  )
}
