import type { TimelineEntry } from '../types'
import { matchesSource, type SourceFilter } from './format'
import {
  compareNullableNumber,
  compareNullableText,
  type SortDir,
  type SortState,
} from './sort'
import { compareCanonicalRevisionOrder } from './revision'

export type TimelineFilters = {
  label?: string
  wiki?: string
  day?: string
  from?: string
  to?: string
  src?: SourceFilter
}

export const TIMELINE_PAGE_SIZE = 100
export const TIMELINE_SORT_KEYS = ['time', 'wiki', 'page', 'label', 'action', 'ip', 'len'] as const
export type TimelineSortKey = (typeof TIMELINE_SORT_KEYS)[number]
export const TIMELINE_SORT_DEFAULTS: Record<TimelineSortKey, SortDir> = {
  time: 'desc',
  wiki: 'asc',
  page: 'asc',
  label: 'asc',
  action: 'asc',
  ip: 'asc',
  len: 'desc',
}
export const TIMELINE_SORT_DEFAULT: SortState<TimelineSortKey> = {
  sort: TIMELINE_SORT_KEYS[0],
  dir: TIMELINE_SORT_DEFAULTS[TIMELINE_SORT_KEYS[0]],
}

export function getTimelinePageName(id: string): string {
  const name = id.slice(id.indexOf('/') + 1)
  return name || id
}

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

function comparePrimary(a: TimelineEntry, b: TimelineEntry, sort: TimelineSortKey, dir: SortDir): number {
  switch (sort) {
    case 'time': {
      return compareNullableText(a.t, b.t, dir)
    }
    case 'wiki': {
      return compareNullableText(a.w, b.w, dir)
    }
    case 'page': {
      return compareNullableText(getTimelinePageName(a.id), getTimelinePageName(b.id), dir)
    }
    case 'label':
      return compareNullableText(a.x, b.x, dir)
    case 'action':
      return compareNullableText(a.a, b.a, dir)
    case 'ip':
      return compareNullableText(a.ip, b.ip, dir)
    case 'len':
      return compareNullableNumber(a.l, b.l, dir)
  }
}

export function sortTimelineRows(rows: TimelineEntry[], sort: TimelineSortKey, dir: SortDir): TimelineEntry[] {
  // The archive source is already in the canonical newest-first order.
  if (sort === TIMELINE_SORT_DEFAULT.sort && dir === TIMELINE_SORT_DEFAULT.dir) return rows
  return [...rows].sort((a, b) => (
    comparePrimary(a, b, sort, dir)
    || compareCanonicalRevisionOrder(a, b)
  ))
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
