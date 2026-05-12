import React, { useEffect, useRef } from 'react'
import { X } from 'lucide-react'

interface ModalProps {
  isOpen: boolean
  onClose: () => void
  title: string
  children: React.ReactNode
  width?: 'sm' | 'md' | 'lg' | 'xl' | '2xl'
  footer?: React.ReactNode
  dismissible?: boolean
  /** When true, skip the fixed overlay + backdrop (caller handles positioning and animation) */
  noOverlay?: boolean
}

export const Modal: React.FC<ModalProps> = ({
  isOpen,
  onClose,
  title,
  children,
  width = 'md',
  footer,
  dismissible = true,
  noOverlay = false,
}) => {
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if (e.key === 'Escape' && dismissible) onClose()
    }
    if (isOpen) {
      window.addEventListener('keydown', handler)
      if (!noOverlay) document.body.style.overflow = 'hidden'
    }
    return () => {
      window.removeEventListener('keydown', handler)
      if (!noOverlay) document.body.style.overflow = ''
    }
  }, [isOpen, onClose, noOverlay])

  // Auto-focus rules: when the modal opens, focus the first interactive
  // input in the body (so the user can start typing immediately). If the
  // body has no inputs (info-only confirm modals), focus the rightmost
  // footer "action" button — primary / danger / success variants, marked
  // via Button's data-variant attribute — so Enter confirms. Children
  // that explicitly manage their own focus opt out by claiming focus
  // first; we detect that via document.activeElement and bail.
  //
  // A MutationObserver on the footer watches for `disabled` attribute
  // changes so a primary button that starts disabled (e.g. while the
  // modal loads its initial data) still gets focus the moment it enables.
  const bodyRef = useRef<HTMLDivElement>(null)
  const footerRef = useRef<HTMLDivElement>(null)
  useEffect(() => {
    if (!isOpen) return

    const ACTION_SELECTOR = 'button[data-variant="primary"]:not([disabled]), button[data-variant="danger"]:not([disabled]), button[data-variant="success"]:not([disabled])'

    const tryFocus = () => {
      const body = bodyRef.current
      if (body && body.contains(document.activeElement)) return // child claimed focus

      const input = body?.querySelector<HTMLElement>(
        'input:not([type="hidden"]):not([disabled]), textarea:not([disabled]), select:not([disabled]), [contenteditable="true"]'
      )
      if (input) {
        input.focus()
        if (input instanceof HTMLInputElement || input instanceof HTMLTextAreaElement) {
          input.select?.()
        }
        return
      }
      const footer = footerRef.current
      if (!footer) return
      const action = footer.querySelectorAll<HTMLButtonElement>(ACTION_SELECTOR)
      if (action.length > 0) { action[action.length - 1].focus(); return }
      // No action variant available — fall back to rightmost any-button.
      const all = footer.querySelectorAll<HTMLButtonElement>('button:not([disabled])')
      if (all.length > 0) all[all.length - 1].focus()
    }

    // setTimeout(0) lets children's mount effects (autoFocus props, refs,
    // etc.) run first so we can detect them via activeElement.
    const initial = setTimeout(tryFocus, 0)

    let observer: MutationObserver | null = null
    const obsTimer = setTimeout(() => {
      const footer = footerRef.current
      if (!footer) return
      observer = new MutationObserver(() => {
        // Only re-focus when nothing in the modal currently holds keyboard
        // focus, or when focus is on a fallback (cancel) button. This
        // avoids stealing focus from a user who has Tabbed somewhere.
        const focused = document.activeElement as HTMLElement | null
        if (!focused) { tryFocus(); return }
        if (focused.matches?.(ACTION_SELECTOR)) return
        // If user focused an input or some other body element, leave them.
        if (bodyRef.current?.contains(focused)) return
        tryFocus()
      })
      observer.observe(footer, { attributes: true, subtree: true, attributeFilter: ['disabled'] })
    }, 0)

    return () => {
      clearTimeout(initial)
      clearTimeout(obsTimer)
      observer?.disconnect()
    }
  }, [isOpen])

  if (!isOpen) return null

  const widthClasses = {
    sm: 'max-w-sm',
    md: 'max-w-md',
    lg: 'max-w-lg',
    xl: 'max-w-2xl',
    '2xl': 'max-w-4xl'
  }

  const panel = (
    <div className={`relative w-full ${widthClasses[width]} bg-navy-700 border border-white/10 rounded-xl shadow-2xl shadow-black/50 flex flex-col max-h-[90vh]`}>
      <div className="flex items-center justify-between px-6 py-4 border-b border-white/10 shrink-0">
        <h2 className="text-lg font-semibold text-white">{title}</h2>
        {dismissible && (
          <button
            onClick={onClose}
            className="p-1.5 rounded-lg text-gray-400 hover:text-gray-200 hover:bg-white/5 transition-colors"
          >
            <X size={16} />
          </button>
        )}
      </div>
      <div ref={bodyRef} className="flex-1 overflow-y-auto px-6 py-4">
        {children}
      </div>
      {footer && (
        <div ref={footerRef} className="px-6 py-4 border-t border-white/10 flex justify-end gap-2 shrink-0">
          {footer}
        </div>
      )}
    </div>
  )

  if (noOverlay) return panel

  return (
    <div className="fixed inset-x-0 bottom-0 top-10 z-50 flex items-center justify-center p-4">
      <div
        className="absolute inset-0 bg-black/60 backdrop-blur-sm"
        onClick={dismissible ? onClose : undefined}
      />
      {panel}
    </div>
  )
}
