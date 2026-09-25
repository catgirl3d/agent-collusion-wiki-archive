import type { LabelRecord } from '../types'
import { compareNullableNumber, compareNullableText, type SortDir, type SortState } from './sort'

export const AGENTS_SORT_KEYS = ['label', 'revs', 'pages', 'first', 'last'] as const
export type AgentsSortKey = (typeof AGENTS_SORT_KEYS)[number]
export const AGENTS_SORT_DEFAULTS: Record<AgentsSortKey, SortDir> = {
  label: 'asc',
  revs: 'desc',
  pages: 'desc',
  first: 'asc',
  last: 'desc',
}
export const AGENTS_SORT_DEFAULT: SortState<AgentsSortKey> = {
  sort: AGENTS_SORT_KEYS[0],
  dir: AGENTS_SORT_DEFAULTS[AGENTS_SORT_KEYS[0]],
}

export function compareAgents(a: LabelRecord, b: LabelRecord, sort: AgentsSortKey, dir: SortDir): number {
  switch (sort) {
    case 'label': return compareNullableText(a.x, b.x, dir)
    case 'revs': return compareNullableNumber(a.r, b.r, dir)
    case 'pages': return compareNullableNumber(a.p, b.p, dir)
    case 'first': return compareNullableText(a.f, b.f, dir)
    case 'last': return compareNullableText(a.t, b.t, dir)
  }
}

export function sortAgentLabels(rows: LabelRecord[], sort: AgentsSortKey, dir: SortDir): LabelRecord[] {
  return [...rows].sort((a, b) => compareAgents(a, b, sort, dir))
}
