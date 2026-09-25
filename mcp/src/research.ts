import { createHash } from 'node:crypto'
import { gunzipSync } from 'node:zlib'
import {
  ArchiveAssets,
  ArchiveDataError,
  CORPUS_MAX_DECODED_BYTES,
  CORPUS_MAX_GZIP_BYTES,
  CORPUS_MAX_RECEIVED_BYTES,
  CORPUS_MAX_ROWS,
  DATA_PATHS,
  isGzip,
} from './assets.js'

export interface SummaryCorpus {
  path: string
  sha256: string
  compressed_bytes: number
  decoded_sha256: string
  decoded_bytes: number
  revisions: number
}

export interface Summary {
  export_generated_at?: string | null
  counts?: { revisions?: number }
  supplement?: { sha256?: string; counts?: { pages?: number; revisions?: number } }
  combined?: { revisions?: number; pages?: number }
  corpus?: SummaryCorpus
}

export interface TimelineEntry {
  t: string
  w: string
  id: string
  s: string
  seq: number | null
  x: string | null
  a: string | null
  ip: string | null
  l: number | null
  partial?: boolean
}

export interface TimelineFile {
  meta: { schema_version: number; export_generated_at: string | null; count: number; order: string; supplement_count?: number }
  r: TimelineEntry[]
}

export interface CorpusRecord {
  w: string
  id: string
  seq: number | null
  t: string
  x: string | null
  body: string
}

export interface PageEntry { id: string; s?: string; n: string }

export interface ActivityDay {
  date: string
  wiki: string
  saves: number
  deletes: number
  reverts: number
  probes: number
  bytes: number
  rec?: number
}

export interface ActivityHour { hour: string; saves: number; rec?: number }

export interface CorpusMatch {
  w: string
  id: string
  s: string
  n: string
  seq: number | null
  t: string
  x: string | null
  occurrences: number
  snippet: string
}

export class ArchiveQueryError extends Error {
  readonly code = 'invalid_param'

  constructor(message: string) {
    super(message)
    this.name = 'ArchiveQueryError'
  }
}

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/

function isRealDate(value: string): boolean {
  if (!DATE_RE.test(value)) return false
  const parsed = new Date(`${value}T00:00:00Z`)
  return !Number.isNaN(parsed.getTime()) && parsed.toISOString().slice(0, 10) === value
}

function assertDate(value: string | undefined, name: string): string | undefined {
  if (value === undefined || value === '') return undefined
  if (!isRealDate(value)) throw new ArchiveQueryError(`${name} must be a real UTC date (YYYY-MM-DD)`)
  return value
}

function assertRange(from: string | undefined, to: string | undefined): void {
  if (from && to && from > to) throw new ArchiveQueryError('from must not be after to')
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function isPageEntry(value: unknown): value is PageEntry {
  return isRecord(value) && typeof value.id === 'string'
}

function isActivityDay(value: unknown): value is ActivityDay {
  return isRecord(value) && typeof value.date === 'string' && typeof value.wiki === 'string'
}

function isActivityHour(value: unknown): value is ActivityHour {
  return isRecord(value) && typeof value.hour === 'string'
}

function sha256Hex(bytes: Uint8Array): string {
  return createHash('sha256').update(bytes).digest('hex')
}

function invalidRow(row: number): ArchiveDataError {
  return new ArchiveDataError('archive_data_invalid', `corpus row ${String(row)} is malformed`)
}

function normalizeCorpusRecord(raw: unknown, row: number): CorpusRecord {
  if (typeof raw !== 'object' || raw === null) throw invalidRow(row)
  const value = raw as Record<string, unknown>
  const id = value.page_id
  const wiki = value.wiki ?? (typeof id === 'string' ? id.split('/')[0] : undefined)
  const seq = value.seq
  const time = value.write_date ?? value.time
  const label = value.label
  const body = value.body
  if (typeof id !== 'string' || !id) throw invalidRow(row)
  if (typeof wiki !== 'string' || !wiki) throw invalidRow(row)
  if (typeof time !== 'string' || !time) throw invalidRow(row)
  if (typeof body !== 'string') throw invalidRow(row)
  if (seq !== null && seq !== undefined && typeof seq !== 'number') throw invalidRow(row)
  if (label !== null && label !== undefined && typeof label !== 'string') throw invalidRow(row)
  return {
    w: wiki,
    id,
    seq: typeof seq === 'number' ? seq : null,
    t: time,
    x: typeof label === 'string' ? label : null,
    body,
  }
}

export function parseCorpus(bytes: Uint8Array, summary: Summary): CorpusRecord[] {
  const corpus = summary.corpus
  if (!corpus) throw new ArchiveDataError('archive_data_invalid', 'summary.json is missing corpus metadata')

  let decoded: Uint8Array
  if (isGzip(bytes)) {
    if (bytes.byteLength > CORPUS_MAX_GZIP_BYTES) {
      throw new ArchiveDataError('archive_data_too_large', `corpus gzip exceeds ${String(CORPUS_MAX_GZIP_BYTES)} bytes`)
    }
    if (sha256Hex(bytes) !== corpus.sha256 || bytes.byteLength !== corpus.compressed_bytes) {
      throw new ArchiveDataError('archive_data_invalid', 'corpus gzip does not match summary metadata')
    }
    try {
      decoded = new Uint8Array(gunzipSync(bytes, { maxOutputLength: CORPUS_MAX_DECODED_BYTES }))
    } catch (error) {
      if ((error as { code?: string }).code === 'ERR_BUFFER_TOO_LARGE') {
        throw new ArchiveDataError('archive_data_too_large', `corpus exceeds ${String(CORPUS_MAX_DECODED_BYTES)} decoded bytes`)
      }
      throw new ArchiveDataError('archive_data_invalid', 'corpus gzip could not be decompressed')
    }
  } else {
    decoded = bytes
  }

  if (decoded.byteLength > CORPUS_MAX_DECODED_BYTES) {
    throw new ArchiveDataError('archive_data_too_large', `corpus exceeds ${String(CORPUS_MAX_DECODED_BYTES)} decoded bytes`)
  }
  if (sha256Hex(decoded) !== corpus.decoded_sha256 || decoded.byteLength !== corpus.decoded_bytes) {
    throw new ArchiveDataError('archive_data_invalid', 'corpus data does not match summary metadata')
  }

  const text = new TextDecoder().decode(decoded)
  const records: CorpusRecord[] = []
  let start = 0
  for (let index = 0; index <= text.length; index += 1) {
    if (index !== text.length && text.charCodeAt(index) !== 10) continue
    const line = text.slice(start, index).trim()
    start = index + 1
    if (!line) continue
    if (records.length >= CORPUS_MAX_ROWS) {
      throw new ArchiveDataError('archive_data_too_large', `corpus exceeds ${String(CORPUS_MAX_ROWS)} rows`)
    }
    let raw: unknown
    try {
      raw = JSON.parse(line)
    } catch {
      throw new ArchiveDataError('archive_data_invalid', `corpus row ${String(records.length + 1)} is not valid JSON`)
    }
    records.push(normalizeCorpusRecord(raw, records.length + 1))
  }

  if (records.length !== corpus.revisions) {
    throw new ArchiveDataError(
      'archive_data_invalid',
      `corpus has ${String(records.length)} rows, summary declares ${String(corpus.revisions)}`,
    )
  }
  return records
}

export function countOccurrences(body: string, query: string, caseSensitive: boolean): { count: number; first: number } {
  const haystack = caseSensitive ? body : body.toLowerCase()
  const needle = caseSensitive ? query : query.toLowerCase()
  let count = 0
  let first = -1
  let index = haystack.indexOf(needle)
  while (index !== -1) {
    if (first === -1) first = index
    count += 1
    index = haystack.indexOf(needle, index + needle.length)
  }
  return { count, first }
}

export function snippetAround(body: string, index: number, length: number): string {
  const start = Math.max(0, index - 60)
  const end = Math.min(body.length, index + length + 60)
  return body.slice(start, end).replace(/\s+/g, ' ').trim()
}

export interface ListRevisionsArgs {
  label?: string
  wiki?: string
  id?: string
  slug?: string
  day?: string
  from?: string
  to?: string
  order?: 'asc' | 'desc'
  limit?: number
  offset?: number
}

export interface SearchCorpusArgs {
  q: string
  wiki?: string
  label?: string
  from?: string
  to?: string
  caseSensitive?: boolean
  limit?: number
  offset?: number
}

export interface GetActivityArgs {
  by: 'day' | 'hour'
  wiki?: string
  from?: string
  to?: string
}

export interface ResearchApi {
  listRevisions: (args: ListRevisionsArgs) => Promise<unknown>
  searchCorpus: (args: SearchCorpusArgs) => Promise<unknown>
  getActivity: (args: GetActivityArgs) => Promise<unknown>
}

export type AssetReader = Pick<ArchiveAssets, 'getJson' | 'getBytes'>

interface CacheEntry<T> { version: string; value: T }

function versionOf(summary: Summary): string {
  return `${summary.export_generated_at ?? ''}|${summary.corpus?.sha256 ?? ''}|${summary.supplement?.sha256 ?? ''}`
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, Math.floor(value)))
}

export class ArchiveResearch {
  private readonly assets: AssetReader
  private timelineCache: CacheEntry<TimelineFile> | null = null
  private pagesCache: CacheEntry<Map<string, PageEntry>> | null = null
  private corpusCache: CacheEntry<CorpusRecord[]> | null = null
  private corpusInFlight: { version: string; promise: Promise<CorpusRecord[]> } | null = null
  private latestCorpusVersion: string | null = null
  private dayCache: CacheEntry<ActivityDay[]> | null = null
  private hourCache: CacheEntry<ActivityHour[]> | null = null
  private lastSearch: { key: string; matches: CorpusMatch[] } | null = null

  constructor(assets: AssetReader = new ArchiveAssets()) {
    this.assets = assets
  }

  async getSummary(): Promise<Summary> {
    return this.assets.getJson<Summary>(DATA_PATHS.summary)
  }

  private async getTimeline(summary: Summary): Promise<TimelineFile> {
    const version = versionOf(summary)
    if (this.timelineCache?.version === version) return this.timelineCache.value
    const file = await this.assets.getJson<{
      meta: TimelineFile['meta'] | null | undefined
      r: TimelineEntry[] | null | undefined
    } | null>(DATA_PATHS.timeline)
    const meta = file?.meta
    const revisions = file?.r
    if (meta?.schema_version !== 1 || !Array.isArray(revisions)) {
      throw new ArchiveDataError('archive_data_invalid', 'timeline.json has an unsupported schema')
    }
    const timeline: TimelineFile = { meta, r: revisions }
    // A missing timestamp and an explicit null both mean "generation unknown".
    if ((timeline.meta.export_generated_at ?? null) !== (summary.export_generated_at ?? null)) {
      throw new ArchiveDataError('archive_data_invalid', 'timeline.json does not match summary generation')
    }
    if (timeline.meta.count !== timeline.r.length) {
      throw new ArchiveDataError('archive_data_invalid', 'timeline.json count does not match its rows')
    }
    const expectedCount = summary.combined?.revisions ?? summary.counts?.revisions
    if (expectedCount !== undefined && timeline.r.length !== expectedCount) {
      throw new ArchiveDataError('archive_data_invalid', 'timeline.json does not match summary counts')
    }
    const canonicalCount = summary.counts?.revisions
    const supplementCount = summary.supplement?.counts?.revisions
    const combinedCount = summary.combined?.revisions
    if (
      canonicalCount !== undefined &&
      supplementCount !== undefined &&
      combinedCount !== undefined &&
      canonicalCount + supplementCount !== combinedCount
    ) {
      throw new ArchiveDataError('archive_data_invalid', 'summary counts do not match combined revisions')
    }
    this.timelineCache = { version, value: timeline }
    return timeline
  }

  private async getPages(summary: Summary): Promise<Map<string, PageEntry>> {
    const version = versionOf(summary)
    if (this.pagesCache?.version === version) return this.pagesCache.value
    const file = await this.assets.getJson<{ p?: unknown } | null>(DATA_PATHS.pages)
    const pages = file?.p
    if (!Array.isArray(pages) || !pages.every(isPageEntry)) {
      throw new ArchiveDataError('archive_data_invalid', 'pages.json has an unsupported schema')
    }
    const map = new Map(pages.map((page) => [page.id, page]))
    this.pagesCache = { version, value: map }
    return map
  }

  private async getCorpus(summary: Summary): Promise<CorpusRecord[]> {
    const version = versionOf(summary)
    this.latestCorpusVersion = version
    if (this.corpusCache?.version === version) return this.corpusCache.value
    if (this.corpusInFlight?.version === version) return this.corpusInFlight.promise

    // A load started for another data release must not be reused: its records would be
    // cached under the wrong version. Track the latest requested version so a slow older
    // load can never overwrite a newer cache entry.
    const load = {
      version,
      promise: this.assets
        .getBytes(DATA_PATHS.corpus, CORPUS_MAX_RECEIVED_BYTES)
        .then((bytes) => parseCorpus(bytes, summary)),
    }
    this.corpusInFlight = load
    load.promise.catch(() => {
      if (this.corpusInFlight === load) this.corpusInFlight = null
    })

    const value = await load.promise
    if (this.corpusInFlight === load) this.corpusInFlight = null
    if (this.latestCorpusVersion === version) this.corpusCache = { version, value }
    return value
  }

  async listRevisions(args: ListRevisionsArgs) {
    const requestedOrder: unknown = args.order
    if (
      requestedOrder !== null
      && requestedOrder !== undefined
      && requestedOrder !== 'desc'
      && requestedOrder !== 'asc'
    ) {
      throw new ArchiveQueryError('order must be desc or asc')
    }
    const order = requestedOrder === 'asc' ? 'asc' : 'desc'
    const day = assertDate(args.day, 'day')
    const from = assertDate(args.from, 'from')
    const to = assertDate(args.to, 'to')
    assertRange(from, to)
    const limit = clamp(args.limit ?? 100, 1, 500)
    const offset = clamp(args.offset ?? 0, 0, 100_000)

    const summary = await this.getSummary()
    const timeline = await this.getTimeline(summary)
    const rows = timeline.r.filter((row) => {
      if (args.label && row.x !== args.label) return false
      if (args.wiki && row.w !== args.wiki) return false
      if (args.id && row.id !== args.id) return false
      if (args.slug && row.s !== args.slug) return false
      const eventDay = row.t.slice(0, 10)
      if (day && eventDay !== day) return false
      if (from && eventDay < from) return false
      if (to && eventDay > to) return false
      return true
    })
    const ordered =
      order === 'asc'
        ? [...rows].sort(
            (a, b) => a.t.localeCompare(b.t) || a.id.localeCompare(b.id) || (a.seq ?? 0) - (b.seq ?? 0),
          )
        : [...rows].sort(
            // Canonical project order: time follows the requested direction,
            // tie-breakers always ascend (matches searchCorpus and the build pipeline).
            (a, b) => b.t.localeCompare(a.t) || a.id.localeCompare(b.id) || (a.seq ?? 0) - (b.seq ?? 0),
          )

    return {
      export_generated_at: summary.export_generated_at ?? null,
      total: rows.length,
      limit,
      offset,
      order,
      revisions: ordered.slice(offset, offset + limit),
    }
  }

  async searchCorpus(args: SearchCorpusArgs) {
    const q = args.q.trim()
    if (q.length < 3 || q.length > 120) throw new ArchiveQueryError('q must be between 3 and 120 characters')
    const caseSensitive = args.caseSensitive === true
    const from = assertDate(args.from, 'from')
    const to = assertDate(args.to, 'to')
    assertRange(from, to)
    const limit = clamp(args.limit ?? 20, 1, 100)
    const offset = clamp(args.offset ?? 0, 0, 100_000)

    const summary = await this.getSummary()
    const key = JSON.stringify([
      summary.corpus?.sha256 ?? '',
      summary.export_generated_at ?? '',
      q,
      caseSensitive,
      args.wiki ?? '',
      args.label ?? '',
      from ?? '',
      to ?? '',
    ])

    let matches = this.lastSearch?.key === key ? this.lastSearch.matches : null
    if (!matches) {
      const [corpus, pages] = await Promise.all([this.getCorpus(summary), this.getPages(summary)])
      matches = []
      for (const record of corpus) {
        if (args.wiki && record.w !== args.wiki) continue
        if (args.label && record.x !== args.label) continue
        const eventDay = record.t.slice(0, 10)
        if (from && eventDay < from) continue
        if (to && eventDay > to) continue
        const found = countOccurrences(record.body, q, caseSensitive)
        if (!found.count) continue
        const page = pages.get(record.id)
        if (!page) {
          throw new ArchiveDataError('archive_data_invalid', `corpus references unknown page ${record.id}`)
        }
        matches.push({
          w: record.w,
          id: record.id,
          s: page.s ?? '',
          n: page.n,
          seq: record.seq,
          t: record.t,
          x: record.x,
          occurrences: found.count,
          snippet: snippetAround(record.body, found.first, q.length),
        })
      }
      matches.sort((a, b) => b.t.localeCompare(a.t) || a.id.localeCompare(b.id) || (a.seq ?? 0) - (b.seq ?? 0))
      this.lastSearch = { key, matches }
    }

    return {
      q,
      case_sensitive: caseSensitive,
      total: matches.length,
      limit,
      offset,
      matches: matches.slice(offset, offset + limit),
    }
  }

  async getActivity(args: GetActivityArgs) {
    const by: unknown = args.by
    if (by !== 'day' && by !== 'hour') throw new ArchiveQueryError('by must be day or hour')
    const from = assertDate(args.from, 'from')
    const to = assertDate(args.to, 'to')
    assertRange(from, to)

    const summary = await this.getSummary()
    const version = versionOf(summary)

    if (by === 'hour') {
      if (args.wiki || from || to) {
        throw new ArchiveQueryError('hourly activity has no wiki/date dimensions; use by=day for filters')
      }
      if (this.hourCache?.version !== version) {
        const hours = await this.assets.getJson<ActivityHour[]>(DATA_PATHS.activityByHour)
        if (!Array.isArray(hours) || !hours.every(isActivityHour)) {
          throw new ArchiveDataError('archive_data_invalid', 'activity_by_hour.json has an unsupported schema')
        }
        this.hourCache = { version, value: hours }
      }
      const rows = this.hourCache.value
      return { by: 'hour', export_generated_at: summary.export_generated_at ?? null, total: rows.length, rows }
    }

    if (this.dayCache?.version !== version) {
      const days = await this.assets.getJson<ActivityDay[]>(DATA_PATHS.activityByDay)
      if (!Array.isArray(days) || !days.every(isActivityDay)) {
        throw new ArchiveDataError('archive_data_invalid', 'activity_by_day.json has an unsupported schema')
      }
      this.dayCache = { version, value: days }
    }
    const rows = this.dayCache.value.filter((row) => {
      if (args.wiki && row.wiki !== args.wiki) return false
      if (from && row.date < from) return false
      if (to && row.date > to) return false
      return true
    })
    return { by: 'day', export_generated_at: summary.export_generated_at ?? null, total: rows.length, rows }
  }
}
