import React from 'react'
import { useAnimationConfig } from '../../hooks/useAnimationConfig'

interface CollapsibleLabelProps {
  /**
   * Tailwind class(es) for the EXPANDED state at the desired
   * container-query breakpoint. Must include both:
   *   - `@bp:grid-cols-[1fr]` to expand the column
   *   - `@bp:ms-0` to release the negative margin that hides the
   *     parent button's gap while collapsed
   * E.g. `"@xl:grid-cols-[1fr] @xl:ms-0"`. Must be statically present
   * at the call site so Tailwind's JIT picks the classes up.
   */
  expandClass: string
  /**
   * Negative margin-inline-start used to cancel the parent button's
   * `gap-*` while collapsed. Defaults to `-ms-2` to match the shared
   * `Button` component's `gap-2`. Override for parents with a
   * different gap, e.g. `-ms-1.5` to cancel `gap-1.5`.
   */
  collapsedMarginStart?: string
  /**
   * Optional JS-driven state override. When `undefined`, visibility is
   * controlled purely by the container query in `expandClass`. Set
   * `true` to force collapsed (or `false` to force expanded)
   * regardless of container width — useful when an animation should
   * kick in immediately rather than waiting for the container-query
   * crossover, which can lag mid-slide if the parent's width is
   * itself animating past the breakpoint partway through.
   */
  collapsed?: boolean
  children: React.ReactNode
}

/**
 * Smoothly animates an inline label between collapsed (width 0,
 * icon-only) and expanded (icon + label) states based on a Tailwind
 * container-query breakpoint. Replaces the
 * `<span className="hidden @bp:inline">Label</span>` pattern, which
 * uses `display:none` and can't be CSS-transitioned.
 *
 * The trick: `display: inline-grid` with `grid-template-columns: 0fr`
 * collapses the column to 0 width; `1fr` expands it. Modern Chromium
 * interpolates between `0fr` and `1fr` smoothly. The wrapper also
 * lifts a negative `margin-inline-start` to cancel the parent button's
 * gap when collapsed, releasing it as the label expands so the
 * icon-only state has no leftover whitespace.
 *
 * Respects the user's disable-animations / slow-animations settings
 * via `useAnimationConfig`.
 *
 *   // gap-2 parent (the shared Button component's default):
 *   <CollapsibleLabel expandClass="@2xl:grid-cols-[1fr] @2xl:ms-0">
 *     Templates
 *   </CollapsibleLabel>
 *
 *   // gap-1.5 parent (e.g. PANEL_ACTION_BUTTON_BASE on bare buttons):
 *   <CollapsibleLabel
 *     expandClass="@xl:grid-cols-[1fr] @xl:ms-0"
 *     collapsedMarginStart="-ms-1.5"
 *   >
 *     Player
 *   </CollapsibleLabel>
 */
export const CollapsibleLabel: React.FC<CollapsibleLabelProps> = ({
  expandClass,
  collapsedMarginStart = '-ms-2',
  collapsed,
  children,
}) => {
  const anim = useAnimationConfig()
  // When the JS state override is set, ignore `expandClass` and apply
  // a fixed state class. The default (`collapsed === undefined`) leaves
  // visibility to the container query for natural responsive behavior.
  const stateClass = collapsed === true
    ? `grid-cols-[0fr] ${collapsedMarginStart}`
    : collapsed === false
      ? 'grid-cols-[1fr] ms-0'
      : `grid-cols-[0fr] ${collapsedMarginStart} ${expandClass}`
  return (
    <span
      className={`inline-grid transition-[grid-template-columns,margin-inline-start] ease-linear ${stateClass}`}
      style={{ transitionDuration: `${anim.duration(200)}ms` }}
    >
      <span className="overflow-hidden whitespace-nowrap min-w-0">
        {children}
      </span>
    </span>
  )
}
