import type { CorpusMatch, CorpusRecord, CorpusRevisionKey, CorpusSearchResult } from '../types'

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
  wholeWord?: boolean
  wiki?: string
  label?: string
  from?: string
  to?: string
}

export function isWordChar(char: string): boolean {
  return /[\p{L}\p{N}_]/u.test(char)
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}

function codePointBefore(text: string, index: number): string {
  if (index <= 0) return ''
  const code = text.charCodeAt(index - 1)
  if (code >= 0xdc00 && code <= 0xdfff && index >= 2) {
    const lead = text.charCodeAt(index - 2)
    if (lead >= 0xd800 && lead <= 0xdbff) return text.slice(index - 2, index)
  }
  return text[index - 1]
}

function codePointAfter(text: string, index: number): string {
  if (index >= text.length) return ''
  const code = text.codePointAt(index)
  return code === undefined ? '' : String.fromCodePoint(code)
}

function scanMatchRanges(
  body: string,
  query: string,
  caseSensitive: boolean,
  wholeWord: boolean,
  visit: (start: number, end: number) => void,
): void {
  if (!query) return
  const pattern = new RegExp(escapeRegExp(query), caseSensitive ? 'gu' : 'giu')
  let match = pattern.exec(body)
  while (match !== null) {
    const start = match.index
    const end = start + match[0].length
    const insideWord = wholeWord && (isWordChar(codePointBefore(body, start)) || isWordChar(codePointAfter(body, end)))
    if (insideWord) {
      pattern.lastIndex = start + 1
    } else {
      visit(start, end)
      pattern.lastIndex = end
    }
    match = pattern.exec(body)
  }
}

export function findMatchRanges(
  body: string,
  query: string,
  caseSensitive: boolean,
  wholeWord = false,
): Array<{ start: number; end: number }> {
  const ranges: Array<{ start: number; end: number }> = []
  scanMatchRanges(body, query, caseSensitive, wholeWord, (start, end) => {
    ranges.push({ start, end })
  })
  return ranges
}

export function countOccurrences(
  body: string,
  query: string,
  caseSensitive: boolean,
  wholeWord = false,
): { count: number; first: number } {
  let count = 0
  let first = -1
  scanMatchRanges(body, query, caseSensitive, wholeWord, (start) => {
    if (first === -1) first = start
    count += 1
  })
  return { count, first }
}

export function snippetAround(body: string, index: number, length: number): string {
  const start = Math.max(0, index - 60)
  const end = Math.min(body.length, index + length + 60)
  return body.slice(start, end).replace(/\s+/g, ' ').trim()
}

const LF = 0x0a
const CR = 0x0d
const ASCII_MAX = 0x80
const TWO_BYTE_MAX = 0x800
const SURROGATE_HIGH_MIN = 0xd800
const SURROGATE_HIGH_MAX = 0xdbff

export function measureBody(body: string): { bytes: number; lines: number } {
  let bytes = 0
  let lines = body.length ? 1 : 0
  for (let i = 0; i < body.length; i += 1) {
    const code = body.charCodeAt(i)
    if (code === LF || code === CR) {
      lines += 1
      bytes += 1
      if (code === CR && body.charCodeAt(i + 1) === LF) {
        bytes += 1
        i += 1
      }
      continue
    }
    if (code < ASCII_MAX) bytes += 1
    else if (code < TWO_BYTE_MAX) bytes += 2
    else if (code >= SURROGATE_HIGH_MIN && code <= SURROGATE_HIGH_MAX) {
      bytes += 4
      i += 1
    } else bytes += 3
  }
  return { bytes, lines }
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
    const found = countOccurrences(record.body, filters.q, filters.caseSensitive, Boolean(filters.wholeWord))
    if (!found.count) continue
    const page = pages.get(record.id)
    if (!page) throw new Error(`corpus references unknown page ${record.id}`)
    const stats = measureBody(record.body)
    matches.push({
      w: record.w,
      id: record.id,
      s: page.s ?? '',
      n: page.n,
      seq: record.seq,
      t: record.t,
      x: record.x,
      occurrences: found.count,
      bytes: stats.bytes,
      lines: stats.lines,
      snippet: snippetAround(record.body, found.first, filters.q.length),
    })
  }
  matches.sort((a, b) => b.t.localeCompare(a.t) || a.id.localeCompare(b.id) || (a.seq ?? 0) - (b.seq ?? 0))
  return matches
}

export type CorpusWorkerProgressPhase = 'download' | 'decode' | 'search'

export type CorpusSearchRequest = {
  type: 'search'
  requestId: number
  q: string
  wiki?: string
  label?: string
  from?: string
  to?: string
  caseSensitive: boolean
  wholeWord?: boolean
  limit: number
  offset: number
}

export type CorpusBodyRequest = CorpusRevisionKey & {
  type: 'body'
  requestId: number
}

export type CorpusWorkerRequest = CorpusSearchRequest | CorpusBodyRequest

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
  | { type: 'body'; requestId: number; body: string }
  | { type: 'error'; requestId: number; error: string; code?: string }

export type CorpusSearchEvent = Exclude<CorpusWorkerResponse, { type: 'body' }>
