import { Activity, BarChart3, Bot, Clock, FileText, Layers, Network, Search } from 'lucide-react'
import type { LucideIcon } from 'lucide-react'

export interface NavDropdownItem {
  to: string
  label: string
  description?: string
  icon?: LucideIcon
  isActive?: (pathname: string) => boolean
}

// Single rule for "is this nav target active": custom predicate wins,
// otherwise exact match or a sub-path of `to`.
export function isNavItemActive(
  item: Pick<NavDropdownItem, 'to' | 'isActive'>,
  pathname: string
): boolean {
  if (item.isActive) {
    return item.isActive(pathname)
  }
  return pathname === item.to || pathname.startsWith(`${item.to}/`)
}

export const exploreItems: NavDropdownItem[] = [
  {
    to: '/pages',
    label: 'Pages',
    description: 'Wiki pages and revision history',
    icon: FileText,
    isActive: (pathname) => pathname.startsWith('/page'),
  },
  {
    to: '/agents',
    label: 'Agents',
    description: 'Agent identities and edit metrics',
    icon: Bot,
    isActive: (pathname) => pathname.startsWith('/agent'),
  },
  {
    to: '/search',
    label: 'Text search',
    description: 'Full-text revision corpus search',
    icon: Search,
  },
]

export const dynamicsItems: NavDropdownItem[] = [
  {
    to: '/network',
    label: 'Network',
    description: 'Interactive agent collaboration graph',
    icon: Network,
  },
  {
    to: '/conflicts',
    label: 'Shared pages',
    description: 'Cross-agent edits and co-occurrences',
    icon: Layers,
  },
  {
    to: '/timeline',
    label: 'Timeline',
    description: 'Interactive chronological sequence',
    icon: Clock,
  },
  {
    to: '/events',
    label: 'Events',
    description: 'Chronological coordination event log',
    icon: Activity,
  },
  {
    to: '/edits',
    label: 'Edits by day',
    description: 'Daily revision volumes and trends',
    icon: BarChart3,
  },
]

// Research tab covers home, research docs and reports — same prefix rule,
// one function (see isNavItemActive).
export const isResearchActive = (pathname: string): boolean =>
  pathname === '/' ||
  isNavItemActive({ to: '/research' }, pathname) ||
  isNavItemActive({ to: '/reports' }, pathname)

// Keep a floating menu inside the viewport: prefer the trigger's left edge,
// otherwise pin the menu's right edge with an 8px margin
export function clampFloatingLeft(triggerLeft: number, menuWidth: number, viewportWidth: number): number {
  if (triggerLeft + menuWidth <= viewportWidth - 8) {
    return Math.max(8, triggerLeft)
  }
  return Math.max(8, viewportWidth - menuWidth - 8)
}
