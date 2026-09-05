import type { LabelRecord, PageRecord } from '../types'

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

export function fmtDate(iso: string | undefined | null): string {
  if (!iso) return '—'
  const y = iso.slice(0, 4)
  const m = iso.slice(5, 7)
  const day = iso.slice(8, 10)
  return `${y}-${m}-${day}`
}

const WIKI_COLORS: Record<string, string> = {
  dse: '#4f8cff',
  probier: '#ff9f43',
  fractal: '#16a34a',
  publictestwiki: '#a855f7',
  uncyclopedia: '#ef4444',
  dorfwiki: '#14b8a6',
  other: '#64748b',
}

export function wikiColor(wiki: string): string {
  return WIKI_COLORS[wiki] ?? WIKI_COLORS.other
}

export interface PagesFilter {
  query: string
  wiki: string
  deletedOnly: boolean
  minRevs: number
}

export function filterPages(pages: PageRecord[], f: PagesFilter): PageRecord[] {
  const q = f.query.trim().toLowerCase()
  return pages.filter((p) => {
    if (f.wiki && p.w !== f.wiki) return false
    if (f.deletedOnly && !p.d) return false
    if (f.minRevs > 0 && p.r < f.minRevs) return false
    if (q && !(p.n.toLowerCase().includes(q) || p.id.toLowerCase().includes(q) || p.labs.some((l) => l.toLowerCase().includes(q)))) return false
    return true
  })
}

export function filterLabels(labels: LabelRecord[], query: string): LabelRecord[] {
  const q = query.trim().toLowerCase()
  if (!q) return labels
  return labels.filter((l) => l.x.toLowerCase().includes(q))
}

export const WIKIS = ['dse', 'probier', 'fractal', 'publictestwiki', 'uncyclopedia', 'dorfwiki'] as const

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