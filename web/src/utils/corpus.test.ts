import { describe, expect, it } from 'vitest'
import type { CorpusRecord } from '../types'
import {
  countOccurrences,
  createJsonlParser,
  isGzip,
  isRealDate,
  searchRecords,
  snippetAround,
} from './corpus'

function record(overrides: Partial<CorpusRecord> = {}): CorpusRecord {
  return {
    w: 'dse',
    id: 'dse/PageA',
    seq: 1,
    t: '2026-06-18T10:00:00Z',
    x: 'AgentX',
    body: 'STATE5-ID appears twice: STATE5-ID',
    ...overrides,
  }
}

describe('literal matching helpers', () => {
  it('counts non-overlapping occurrences case-insensitively by default', () => {
    expect(countOccurrences('aaaa', 'aa', true)).toEqual({ count: 2, first: 0 })
    expect(countOccurrences('STATe5-ID state5-id', 'state5-id', false)).toEqual({ count: 2, first: 0 })
    expect(countOccurrences('STATe5-ID state5-id', 'state5-id', true)).toEqual({ count: 1, first: 10 })
    expect(countOccurrences('nothing here', 'zzz', false)).toEqual({ count: 0, first: -1 })
    expect(countOccurrences('username user superuser user_id', 'user', false, false)).toEqual({ count: 4, first: 0 })
    expect(countOccurrences('username user superuser user_id', 'user', false, true)).toEqual({ count: 1, first: 9 })
  })

  it('collapses whitespace in snippets', () => {
    const body = `${'x'.repeat(100)}\nvALUE\t  inside   ${'y'.repeat(100)}`
    const snippet = snippetAround(body, 100, 'value'.length)
    expect(snippet).toContain('vALUE inside')
    expect(snippet).not.toMatch(/\s{2,}/)
  })

  it('validates dates and gzip magic', () => {
    expect(isRealDate('2026-06-18')).toBe(true)
    expect(isRealDate('2026-13-01')).toBe(false)
    expect(isRealDate('18-06-2026')).toBe(false)
    expect(isGzip(new Uint8Array([0x1f, 0x8b, 0x00]))).toBe(true)
    expect(isGzip(new TextEncoder().encode('{"page_id"'))).toBe(false)
  })
})

describe('createJsonlParser', () => {
  it('parses records across chunk boundaries', () => {
    const seen: CorpusRecord[] = []
    const parser = createJsonlParser((item) => seen.push(item))
    parser.push('{"page_id": "dse/PageA", "wiki": "dse", "seq": 1, "write_date": "2026-06-18T10:00:00Z", "label": "AgentX", "body": "hel')
    parser.push('lo"}\n{"page_id": "dse/PageB", "wiki": "dse", "seq": 2, "write_date": "2026-06-19T10:00:00Z", "label": null, "body": "world"}\n')
    parser.finish()

    expect(seen).toHaveLength(2)
    expect(seen[0]).toMatchObject({ id: 'dse/PageA', w: 'dse', x: 'AgentX', body: 'hello' })
    expect(seen[1]).toMatchObject({ id: 'dse/PageB', x: null, body: 'world' })
  })

  it('rejects malformed and incomplete rows with a row number', () => {
    const parser = createJsonlParser(() => undefined)
    expect(() => parser.push('not json\n')).toThrow('corpus row 1 is not valid JSON')

    const missing = createJsonlParser(() => undefined)
    expect(() => missing.push('{"page_id": "dse/PageA"}\n')).toThrow('corpus row 1 is malformed')
  })
})

describe('searchRecords', () => {
  const pages = new Map([
    ['dse/PageA', { id: 'dse/PageA', s: 'dse_PageA~', n: 'PageA' }],
    ['dse/PageB', { id: 'dse/PageB', s: 'dse_PageB~', n: 'PageB' }],
  ])
  const records = [
    record(),
    record({ id: 'dse/PageB', seq: 2, t: '2026-06-20T10:00:00Z', x: 'AgentY', body: 'other text with Needle' }),
    record({ id: 'dse/PageB', seq: 1, t: '2026-06-19T10:00:00Z', x: 'AgentX', body: 'state5-id lowercase' }),
  ]

  it('returns matches with counts, page names, and time-desc order', () => {
    const matches = searchRecords(records, pages, { q: 'state5-id', caseSensitive: false })
    expect(matches.map((match) => match.id)).toEqual(['dse/PageB', 'dse/PageA'])
    expect(matches[1]).toMatchObject({ n: 'PageA', s: 'dse_PageA~', occurrences: 2, x: 'AgentX' })
    expect(matches[1].snippet).toContain('STATE5-ID')

    const cased = searchRecords(records, pages, { q: 'STATE5-ID', caseSensitive: true })
    expect(cased).toHaveLength(1)

    const wholeWordMatches = searchRecords(records, pages, { q: 'state', caseSensitive: false, wholeWord: true })
    expect(wholeWordMatches).toHaveLength(0)
    const substringMatches = searchRecords(records, pages, { q: 'state', caseSensitive: false, wholeWord: false })
    expect(substringMatches).toHaveLength(2)
  })

  it('applies wiki, label, and date filters before matching', () => {
    expect(searchRecords(records, pages, { q: 'state5-id', caseSensitive: false, label: 'AgentY' })).toHaveLength(0)
    expect(searchRecords(records, pages, { q: 'needle', caseSensitive: false, label: 'AgentY' })).toHaveLength(1)
    expect(searchRecords(records, pages, { q: 'state5-id', caseSensitive: false, from: '2026-06-19' })).toHaveLength(1)
    expect(searchRecords(records, pages, { q: 'state5-id', caseSensitive: false, to: '2026-06-18' })).toHaveLength(1)
    expect(searchRecords(records, pages, { q: 'state5-id', caseSensitive: false, wiki: 'probier' })).toHaveLength(0)
  })

  it('fails closed when a match references a page missing from the index', () => {
    const limited = new Map([['dse/PageA', { id: 'dse/PageA', s: 'dse_PageA~', n: 'PageA' }]])
    expect(() => searchRecords(records, limited, { q: 'lowercase', caseSensitive: false })).toThrow(
      'corpus references unknown page dse/PageB',
    )
  })

  it('never mutates the input records', () => {
    const frozen = [Object.freeze(record())]
    expect(() => searchRecords(frozen as CorpusRecord[], pages, { q: 'state5', caseSensitive: false })).not.toThrow()
    expect(frozen[0].body).toBe('STATE5-ID appears twice: STATE5-ID')
  })
})
