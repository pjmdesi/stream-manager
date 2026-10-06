import * as LucideIcons from 'lucide-react'
import type { ComponentType } from 'react'

export type LucideIconComponent = ComponentType<{ size?: number; className?: string }>

/** Lucide's kebab-case icon name as its export name (`folder-open` to
 *  `FolderOpen`). Icon names are stored kebab-case (launcher groups, the
 *  icon picker's tag list) and resolved at render time. */
export function toPascal(name: string): string {
  return name.split('-').map(s => s.charAt(0).toUpperCase() + s.slice(1)).join('')
}

/** The icon component for a kebab-case Lucide name, or undefined when the
 *  installed Lucide has no such icon (a renamed glyph after a bump, or a
 *  name that was never one). Lucide icons are forwardRef objects, which is
 *  what the type check keys on. */
export function lucideIcon(name: string): LucideIconComponent | undefined {
  const icon = (LucideIcons as unknown as Record<string, unknown>)[toPascal(name)]
  return typeof icon === 'object' && icon !== null ? (icon as LucideIconComponent) : undefined
}
