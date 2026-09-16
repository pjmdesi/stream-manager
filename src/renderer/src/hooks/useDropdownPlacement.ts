import { useLayoutEffect, useState, type RefObject } from 'react'

/** Height of the frameless window's titlebar strip (the `top-10` rule in
 *  the style guide): a menu flipped upward must stay below it. */
const TITLEBAR_PX = 40
const PAD = 8

/**
 * Which side of its anchor an inline dropdown menu should open on. Menus
 * positioned with `absolute top-full` sit below their button no matter how
 * close the button is to the window's bottom edge, and get clipped there
 * (the Assets options menu when the panel had slid to the sidebar's foot).
 * Measured after every open and again on window resize; the menu renders
 * below first, then flips above when it would run off the bottom and there
 * is room above. Callers switch `top-full mt-*` for `bottom-full mb-*` on
 * the result (style guide, "Anchored popovers").
 */
export function useDropdownPlacement(
  open: boolean,
  anchorRef: RefObject<HTMLElement | null>,
  menuRef: RefObject<HTMLElement | null>,
  gap = 4,
): 'below' | 'above' {
  const [placement, setPlacement] = useState<'below' | 'above'>('below')
  useLayoutEffect(() => {
    if (!open) { setPlacement('below'); return }
    const measure = () => {
      const a = anchorRef.current?.getBoundingClientRect()
      const menuH = menuRef.current?.offsetHeight ?? 0
      if (!a || menuH === 0) return
      const fitsBelow = a.bottom + gap + menuH <= window.innerHeight - PAD
      const fitsAbove = a.top - gap - menuH >= TITLEBAR_PX + PAD
      setPlacement(fitsBelow || !fitsAbove ? 'below' : 'above')
    }
    measure()
    window.addEventListener('resize', measure)
    return () => window.removeEventListener('resize', measure)
  }, [open, anchorRef, menuRef, gap])
  return placement
}
