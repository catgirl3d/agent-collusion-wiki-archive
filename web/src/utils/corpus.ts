import type { CorpusMatch, CorpusRecord, CorpusSearchResult } from '../types'

export const CORPUS_MIN_QUERY = 3
export const CORPUS_MAX_QUERY = 120
export const JSON_ASSET_MAX_BYTES = 4 * 1024 * 1024
export const CORPUS_MAX_RECEIVED_BYTES = 64 * 1024 * 1024
export const CORPUS_MAX_GZIP_BYTES = 8 * 1024 * 1024
export const CORPUS_MAX_DECODED_BYTES = 64 * 1024 * 1024
export const CORPUS_MAX_ROWS = 100_000

export const CORPUS_URL = '/data/corpus/revisions.jsonl.gz'

export type CorpusPageMap = Map<string, { s?: string; n: string }>

export type CorpusFilters = {
  q: string
  caseSensitive: boolean
  wiki?: string
  label?: string
  from?: string
  to?: string
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

export function isRealDate(value: string): boolean {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return false
  const parsed = new Date(`${value}T00:00:00Z`)
  return !Number.isNaN(parsed.getTime()) && parsed.toISOString().slice(0, 10) === value
}

export function isGzip(bytes: Uint8Array): boolean {
  return bytes.length >= 2 && bytes[0] === 0x1f && bytes[1] === 0x8b
}

function invalidRow(row: number): Error {
  return new Error(`corpus row ${row} is malformed`)
}

function parseLine(line: string, row: number): CorpusRecord {
  let raw: unknown
  try {
    raw = JSON.parse(line)
  } catch {
    throw new Error(`corpus row ${row} is not valid JSON`)
  }
  if (typeof raw !== 'object' || raw === null) throw invalidRow(row)
  const value = raw as Record<string, unknown>
  const id = value['page_id']
  const wiki = value['wiki'] ?? (typeof id === 'string' ? id.split('/')[0] : undefined)
  const seq = value['seq']
  const time = value['write_date'] ?? value['time']
  const label = value['label']
  const body = value['body']
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

export type JsonlParser = {
  push(chunk: string): void
  finish(): void
}

export function createJsonlParser(onRecord: (record: CorpusRecord, row: number) => void): JsonlParser {
  let carry = ''
  let row = 0
  const emit = (line: string) => {
    const trimmed = line.trim()
    if (!trimmed) return
    row += 1
    onRecord(parseLine(trimmed, row), row)
  }
  return {
    push(chunk: string) {
      carry += chunk
      let index = carry.indexOf('\n')
      while (index !== -1) {
        emit(carry.slice(0, index))
        carry = carry.slice(index + 1)
        index = carry.indexOf('\n')
      }
    },
    finish() {
      emit(carry)
      carry = ''
    },
  }
}

export function searchRecords(
  records: CorpusRecord[],
  pages: CorpusPageMap,
  filters: CorpusFilters,
): CorpusMatch[] {
  const matches: CorpusMatch[] = []
  for (const record of records) {
    if (filters.wiki && record.w !== filters.wiki) continue
    if (filters.label && record.x !== filters.label) continue
    const day = record.t.slice(0, 10)
    if (filters.from && day < filters.from) continue
    if (filters.to && day > filters.to) continue
    const found = countOccurrences(record.body, filters.q, filters.caseSensitive)
    if (!found.count) continue
    const page = pages.get(record.id)
    if (!page) throw new Error(`corpus references unknown page ${record.id}`)
    matches.push({
      w: record.w,
      id: record.id,
      s: page.s ?? '',
      n: page.n,
      seq: record.seq,
      t: record.t,
      x: record.x,
      occurrences: found.count,
      snippet: snippetAround(record.body, found.first, filters.q.length),
    })
  }
  matches.sort((a, b) => b.t.localeCompare(a.t) || a.id.localeCompare(b.id) || (a.seq ?? 0) - (b.seq ?? 0))
  return matches
}

export type CorpusWorkerProgressPhase = 'download' | 'decode' | 'search'

export type CorpusWorkerRequest = {
  type: 'search'
  requestId: number
  q: string
  wiki?: string
  label?: string
  from?: string
  to?: string
  caseSensitive: boolean
  limit: number
  offset: number
}

export type CorpusWorkerResponse =
  | {
      type: 'progress'
      requestId: number
      phase: CorpusWorkerProgressPhase
      loadedBytes?: number
      totalBytes?: number
      rows?: number
    }
  | { type: 'result'; requestId: number; result: CorpusSearchResult }
  | { type: 'error'; requestId: number; error: string; code?: string }
