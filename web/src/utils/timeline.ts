import type { TimelineEntry } from '../types'
import { matchesSource, type SourceFilter } from './format'

export type TimelineFilters = {
  label?: string
  wiki?: string
  day?: string
  from?: string
  to?: string
  src?: SourceFilter
}

export const TIMELINE_PAGE_SIZE = 100

export function filterTimeline(rows: TimelineEntry[], filters: TimelineFilters): TimelineEntry[] {
  const label = filters.label?.trim() ?? ''
  const wiki = filters.wiki ?? ''
  const day = filters.day ?? ''
  const from = filters.from ?? ''
  const to = filters.to ?? ''

  return rows.filter((row) => {
    if (label && row.x !== label) return false
    if (wiki && row.w !== wiki) return false
    if (!matchesSource(row.partial, filters.src)) return false
    const eventDay = row.t.slice(0, 10)
    if (day && eventDay !== day) return false
    if (from && eventDay < from) return false
    if (to && eventDay > to) return false
    return true
  })
}

export function pageSlice<T>(
  rows: T[],
  page: number,
  pageSize = TIMELINE_PAGE_SIZE,
): { page: number; pages: number; rows: T[] } {
  const pages = Math.max(1, Math.ceil(rows.length / pageSize))
  const current = Math.min(Math.max(page, 0), pages - 1)
  return {
    page: current,
    pages,
    rows: rows.slice(current * pageSize, (current + 1) * pageSize),
  }
}
