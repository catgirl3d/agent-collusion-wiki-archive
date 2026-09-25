import type { LabelsIp16Index } from '../types'

export const IP16_TOP_LABELS = 12

export const IP16_CAVEAT = 'ip16 is a truncated /16 network indicator; it cannot identify a host, organization, or person.'

export interface Ip16LabelStat {
  x: string
  n: number
}

export interface Ip16SliceSummary {
  prefixes: string[]
  labels: number
  revisions: number
  wikis: string[]
  first: string | null
  last: string | null
  /** every label on the slice, weight desc then label asc */
  labelWeights: Ip16LabelStat[]
}

/**
 * Trim-then-substring `?ip=` matching, shared by the timeline row filter and the
 * agents prefix matcher so both pages cannot drift apart. An empty query means
 * "no constraint" and matches everything.
 */
export function ip16Matches(value: string | null | undefined, query: string): boolean {
  const q = query.trim()
  return q === '' || (value ?? '').includes(q)
}

/** Prefixes whose /16 indicator contains the trimmed query, as in the timeline filter. */
export function matchIp16Prefixes(index: LabelsIp16Index | null, ip: string): string[] {
  const query = ip.trim()
  if (!index || !query) return []
  return Object.keys(index.prefixes).filter((prefix) => ip16Matches(prefix, query)).sort()
}

/** Aggregates the matched prefix records; revision weights stay disjoint per prefix. */
export function summarizeIp16Slice(index: LabelsIp16Index, prefixes: string[]): Ip16SliceSummary {
  const weights = new Map<string, number>()
  const wikis = new Set<string>()
  let revisions = 0
  let first: string | null = null
  let last: string | null = null

  for (const prefix of prefixes) {
    const record = index.prefixes[prefix]
    if (!record) continue
    revisions += record.r
    for (const [label, count] of record.l) weights.set(label, (weights.get(label) ?? 0) + count)
    for (const wiki of record.w) wikis.add(wiki)
    if (record.f && (first === null || record.f < first)) first = record.f
    if (record.t && (last === null || record.t > last)) last = record.t
  }

  const labelWeights = [...weights]
    .map(([x, n]) => ({ x, n }))
    .sort((a, b) => b.n - a.n || (a.x < b.x ? -1 : a.x > b.x ? 1 : 0))

  return {
    prefixes,
    labels: labelWeights.length,
    revisions,
    wikis: [...wikis].sort(),
    first,
    last,
    labelWeights,
  }
}
