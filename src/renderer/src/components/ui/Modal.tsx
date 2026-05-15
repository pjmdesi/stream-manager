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
  /**
   * Auto-focus policy:
   *   'default'      — focus first input on open + watch footer for a
   *                    primary action that transitions from disabled to
   *                    enabled and refocus it. Right for most modals.
   *   'initial-only' — focus first input on open, then leave focus alone.
   *                    Right for long forms where re-focusing on every
   *                    `disabled` change steals focus mid-edit.
   *   'none'         — never auto-focus anything. Right for edit-mode
   *                    forms where the user opens the modal already
   *                    knowing what they want to change.
   */
  autoFocus?: 'default' | 'initial-only' | 'none'
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
  autoFocus = 'default',
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

  // Auto-focus is controlled by the `autoFocus` prop (see ModalProps docs).
  //
  // On open ('default' or 'initial-only'): focus the first interactive
  // input in the body. If there are no inputs (info-only confirm modals),
  // focus the rightmost footer action button (primary / danger / success
  // via Button's data-variant) so Enter confirms. Children that claim
  // focus themselves (autoFocus on a deeper element) opt out — we detect
  // that via document.activeElement and bail.
  //
  // On enable ('default' only): a MutationObserver on the footer watches
  // for `disabled` attribute changes. When the primary action transitions
  // from disabled to enabled — e.g. a modal that starts disabled while
  // its initial data loads — we move focus to it. This observer NEVER
  // re-focuses inputs; doing so would steal focus mid-edit on long forms
  // (any chip removal or button click that drops the focused element from
  // the DOM would otherwise trigger an input refocus).
  const bodyRef = useRef<HTMLDivElement>(null)
  const footerRef = useRef<HTMLDivElement>(null)
  useEffect(() => {
    if (!isOpen) return
    if (autoFocus === 'none') return

    const ACTION_SELECTOR = 'button[data-variant="primary"]:not([disabled]), button[data-variant="danger"]:not([disabled]), button[data-variant="success"]:not([disabled])'

    const focusInitial = () => {
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

    const focusPrimaryActionIfIdle = () => {
      const focused = document.activeElement as HTMLElement | null
      // Leave the user alone if focus is already on a real interactive
      // element somewhere in the document — they're using the modal.
      if (focused && focused !== document.body && focused.tagName !== 'HTML') return
      const footer = footerRef.current
      if (!footer) return
      const action = footer.querySelectorAll<HTMLButtonElement>(ACTION_SELECTOR)
      if (action.length > 0) action[action.length - 1].focus()
    }

    // setTimeout(0) lets children's mount effects (autoFocus props, refs,
    // etc.) run first so we can detect them via activeElement.
    const initial = setTimeout(focusInitial, 0)

    let observer: MutationObserver | null = null
    let obsTimer: ReturnType<typeof setTimeout> | null = null
    if (autoFocus === 'default') {
      obsTimer = setTimeout(() => {
        const footer = footerRef.current
        if (!footer) return
        observer = new MutationObserver(focusPrimaryActionIfIdle)
        observer.observe(footer, { attributes: true, subtree: true, attributeFilter: ['disabled'] })
      }, 0)
    }

    return () => {
      clearTimeout(initial)
      if (obsTimer) clearTimeout(obsTimer)
      observer?.disconnect()
    }
  }, [isOpen, autoFocus])

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
