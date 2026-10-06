import React from 'react'
import { Rocket } from 'lucide-react'
import { lucideIcon } from '../../lib/lucideIcon'

/** A launch group's chosen icon (kebab-case Lucide name, as the launcher
 *  page stores it), with Rocket as the fallback when the group has no icon
 *  or the name no longer resolves. Shared by the launcher page and the nav
 *  row's launcher action. */
export function GroupIcon({ name, size = 16 }: { name?: string; size?: number }) {
  const Icon = (name && lucideIcon(name)) || Rocket
  return <Icon size={size} />
}
