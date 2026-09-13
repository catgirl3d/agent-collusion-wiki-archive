import type { DayActivity, LabelRecord, PageRecord, RecentEvent } from '../types'
import { slugify } from './slug'

export function fmtInt(n: number): string {
  return n.toLocaleString('en-US')
}

export function fmtCompact(n: number): string {
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`
  if (n >= 10_000) return `${(n / 1000).toFixed(1)}K`
  return n.toLocaleString('en-US')
}

export function fmtBytes(n: number): string {
  if (n >= 1_048_576) return `${(n / 1_048_576).toFixed(1)} MB`
  if (n >= 1024) return `${(n / 1024).toFixed(1)} KB`
  return `${n} B`
}

export function fmtTime(iso: string | null): string {
  if (!iso) return '—'
  const d = new Date(iso)
  if (Number.isNaN(d.getTime())) return iso
  return d.toISOString().replace('T', ' ').slice(0, 16) + 'Z'
}

/** Seconds-preserving archived UTC timestamp for pair evidence rows. */
export function fmtTimeSeconds(iso: string | null): string {
  if (!iso) return '—'
  const d = new Date(iso)
  if (Number.isNaN(d.getTime())) return iso
  return d.toISOString().replace('T', ' ').slice(0, 19) + 'Z'
}

export function fmtDate(iso: string | undefined | null): string {
  if (!iso) return '—'
  const y = iso.slice(0, 4)
  const m = iso.slice(5, 7)
  const day = iso.slice(8, 10)
  return `${y}-${m}-${day}`
}

export function fmtDuration(seconds: number | null): string {
  if (seconds === null || !Number.isFinite(seconds) || seconds < 0) return '—'
  const total = Math.floor(seconds)
  const hours = Math.floor(total / 3600)
  const minutes = Math.floor((total % 3600) / 60)
  const remainder = total % 60
  if (hours > 0) return `${hours}h ${minutes}m ${remainder}s`
  if (minutes > 0) return `${minutes}m ${remainder}s`
  return `${remainder}s`
}

const WIKI_COLORS: Record<string, string> = {
  dse: '#4f8cff',
  probier: '#ff9f43',
  fractal: '#16a34a',
  publictestwiki: '#a855f7',
  uncyclopedia: '#ef4444',
  usemod: '#eab308',
  dorfwiki: '#14b8a6',
  other: '#64748b',
}

export function wikiColor(wiki: string): string {
  return WIKI_COLORS[wiki] ?? WIKI_COLORS.other
}

export type SourceFilter = '' | 'canonical' | 'recovered'

export const SOURCE_FILTER_OPTIONS: Array<{ value: SourceFilter; label: string }> = [
  { value: '', label: 'all sources' },
  { value: 'canonical', label: 'full only' },
  { value: 'recovered', label: 'recovered only' },
]

export function matchesSource(partial: boolean | undefined, src: SourceFilter | undefined): boolean {
  if (src === 'canonical') return !partial
  if (src === 'recovered') return Boolean(partial)
  return true
}

export interface PagesFilter {
  query: string
  wiki: string
  fam?: string
  deletedOnly: boolean
  minRevs: number
  tokenSlugs?: string[] | null
  payloadFlag?: string
  payloadFlags?: Map<string, string[]>
  src?: SourceFilter
}

export function filterPages(pages: PageRecord[], f: PagesFilter): PageRecord[] {
  const q = f.query.trim().toLowerCase()
  const slugSet = f.tokenSlugs ? new Set(f.tokenSlugs) : null
  const flagMap = f.payloadFlag ? f.payloadFlags : undefined
  return pages.filter((p) => {
    if (!matchesSource(p.partial, f.src)) return false
    if (f.wiki && p.w !== f.wiki) return false
    if (f.fam && p.fam !== f.fam) return false
    if (f.deletedOnly && !p.d) return false
    if (f.minRevs > 0 && p.r < f.minRevs) return false
    if (q) {
      const inMeta = p.n.toLowerCase().includes(q) || p.id.toLowerCase().includes(q) || p.labs.some((l) => l.toLowerCase().includes(q))
      const inIndex = slugSet ? slugSet.has(p.s ?? slugify(p.id)) : false
      if (!inMeta && !inIndex) return false
    }
    if (flagMap && !(flagMap.get(p.id) ?? flagMap.get(p.s ?? '') ?? []).includes(f.payloadFlag!)) return false
    return true
  })
}

export function filterPagesByDay(pages: PageRecord[], day: string): PageRecord[] {
  if (!day) return pages
  return pages.filter((p) => p.f <= day && day <= p.l)
}

export function filterEventsByDay(events: RecentEvent[], day: string): RecentEvent[] {
  if (!day) return events
  return events.filter((e) => e.t.slice(0, 10) === day)
}

export interface AggregatedDay {
  date: string
  saves: number
  deletes: number
  count: number
  rec: number
}

export function aggregateDays(rows: DayActivity[]): AggregatedDay[] {
  const byDate = new Map<string, AggregatedDay>()
  for (const row of rows) {
    const current = byDate.get(row.date) ?? { date: row.date, saves: 0, deletes: 0, count: 0, rec: 0 }
    current.saves += row.saves
    current.deletes += row.deletes
    current.count += row.saves + row.deletes
    current.rec += row.rec ?? 0
    byDate.set(row.date, current)
  }
  return [...byDate.values()].sort((a, b) => b.date.localeCompare(a.date))
}

export function filterLabels(labels: LabelRecord[], query: string): LabelRecord[] {
  const q = query.trim().toLowerCase()
  if (!q) return labels
  return labels.filter((l) => l.x.toLowerCase().includes(q))
}

/**
 * Canonical page id for links from recent events: recent_events.json stores wiki and page
 * separately, while PageDetail routes and pages.json ids are wiki-prefixed ("dse/PageName").
 */
export function eventPageId(e: Pick<RecentEvent, 'wiki' | 'page'>): string {
  if (!e.page) return ''
  // Page titles may legitimately contain '/' (e.g. "Foo/Bar"); only treat the page as
  // already-canonical when it literally starts with "<wiki>/". Empty wiki (build.py
  // normalization) keeps the bare title.
  return e.wiki && e.page.startsWith(`${e.wiki}/`) ? e.page : e.wiki ? `${e.wiki}/${e.page}` : e.page
}

export function toCsv(rows: Record<string, unknown>[], columns?: string[]): string {
  const keys = columns ?? (rows.length > 0 ? Object.keys(rows[0]) : [])
  const escape = (value: unknown): string => {
    if (value === null || value === undefined) return ''
    const text = typeof value === 'object' ? JSON.stringify(value) : String(value)
    return /[",\r\n]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text
  }
  return [keys.map(escape).join(','), ...rows.map((row) => keys.map((key) => escape(row[key])).join(','))].join('\r\n')
}

export const WIKIS = ['dse', 'probier', 'fractal', 'publictestwiki', 'uncyclopedia', 'usemod', 'dorfwiki'] as const

export function eventColor(t: string): string {
  switch (t) {
    case 'save':
      return '#4f8cff'
    case 'delete':
      return '#ef4444'
    case 'revert':
      return '#ff9f43'
    case 'probe':
      return '#16a34a'
    default:
      return '#64748b'
  }
}
