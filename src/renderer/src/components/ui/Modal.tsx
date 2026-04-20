import React, { useEffect } from 'react'
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
      <div className="flex-1 overflow-y-auto px-6 py-4">
        {children}
      </div>
      {footer && (
        <div className="px-6 py-4 border-t border-white/10 flex justify-end gap-2 shrink-0">
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
