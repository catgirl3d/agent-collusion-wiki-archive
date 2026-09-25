import { describe, expect, it } from 'vitest'
import type { CorpusMatch, CorpusRecord } from '../types'
import {
  countOccurrences,
  createJsonlParser,
  findMatchRanges,
  isGzip,
  isRealDate,
  measureBody,
  selectMatches,
  searchRecords,
  sortMatches,
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

  it('reports highlight ranges that match the occurrence count', () => {
    expect(findMatchRanges('username user superuser user_id', 'user', false)).toEqual([
      { start: 0, end: 4 },
      { start: 9, end: 13 },
      { start: 19, end: 23 },
      { start: 24, end: 28 },
    ])
    expect(findMatchRanges('username user superuser user_id', 'user', false, true)).toEqual([{ start: 9, end: 13 }])
    expect(findMatchRanges('a user b user c', 'user', false, true)).toEqual([
      { start: 2, end: 6 },
      { start: 9, end: 13 },
    ])
    expect(findMatchRanges('user safeUser', 'user', false)).toEqual([
      { start: 0, end: 4 },
      { start: 9, end: 13 },
    ])
    expect(findMatchRanges('user safeUser', 'user', false, true)).toEqual([{ start: 0, end: 4 }])
    expect(findMatchRanges('anything', '', false)).toEqual([])
  })

  it('matches queries literally instead of as regular expressions', () => {
    expect(findMatchRanges('a.b axb', 'a.b', false)).toEqual([{ start: 0, end: 3 }])
    expect(findMatchRanges('cost ($5) x', '($5)', false)).toEqual([{ start: 5, end: 9 }])
  })

  it('keeps ranges aligned when case folding changes length', () => {
    expect(findMatchRanges('İxİ', 'x', false)).toEqual([{ start: 1, end: 2 }])
    expect(findMatchRanges('İSTATE5-ID', 'state5-id', false)).toEqual([{ start: 1, end: 10 }])
    expect(countOccurrences('İstate5-id', 'STATE5-ID', false)).toEqual({ count: 1, first: 1 })
  })

  it('treats astral letters as word characters at whole-word boundaries', () => {
    expect(findMatchRanges('a𝕏user𝕏b', 'user', false)).toEqual([{ start: 3, end: 7 }])
    expect(findMatchRanges('a𝕏user𝕏b', 'user', false, true)).toEqual([])
    expect(findMatchRanges('𝕏 user 𝕏', 'user', false, true)).toEqual([{ start: 3, end: 7 }])
  })

  it('measures utf-8 bytes and visual lines', () => {
    expect(measureBody('')).toEqual({ bytes: 0, lines: 0 })
    expect(measureBody('a\nb')).toEqual({ bytes: 3, lines: 2 })
    expect(measureBody('a\n')).toEqual({ bytes: 2, lines: 2 })
    expect(measureBody('a\r\nb')).toEqual({ bytes: 4, lines: 2 })
    expect(measureBody('a\rb')).toEqual({ bytes: 3, lines: 2 })
    expect(measureBody('é')).toEqual({ bytes: 2, lines: 1 })
    expect(measureBody('𝕏')).toEqual({ bytes: 4, lines: 1 })
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
    expect(() => { parser.push('not json\n'); }).toThrow('corpus row 1 is not valid JSON')

    const missing = createJsonlParser(() => undefined)
    expect(() => { missing.push('{"page_id": "dse/PageA"}\n'); }).toThrow('corpus row 1 is malformed')
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
    expect(matches[1]).toMatchObject({
      n: 'PageA',
      s: 'dse_PageA~',
      occurrences: 2,
      x: 'AgentX',
      bytes: 'STATE5-ID appears twice: STATE5-ID'.length,
      lines: 1,
    })
    expect(matches[1].snippet).toContain('STATE5-ID')

    const cased = searchRecords(records, pages, { q: 'STATE5-ID', caseSensitive: true })
    expect(cased).toHaveLength(1)

    const wholeWordMatches = searchRecords(records, pages, { q: 'state', caseSensitive: false, wholeWord: true })
    expect(wholeWordMatches).toHaveLength(0)
    const substringMatches = searchRecords(records, pages, { q: 'state', caseSensitive: false, wholeWord: false })
    expect(substringMatches).toHaveLength(2)
  })

  it('reports body byte size and line count for each match', () => {
    const body = 'café line\nsecond line\nthird'
    const multiline = record({ body })
    const matches = searchRecords([multiline], pages, { q: 'line', caseSensitive: false })
    expect(matches[0]).toMatchObject({ bytes: new TextEncoder().encode(body).length, lines: 3 })
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

function match(overrides: Partial<CorpusMatch> = {}): CorpusMatch {
  return {
    w: 'dse',
    id: 'dse/PageA',
    s: 'dse_PageA~',
    n: 'PageA',
    seq: 1,
    t: '2026-06-18T10:00:00Z',
    x: 'AgentX',
    occurrences: 1,
    bytes: 10,
    lines: 1,
    snippet: 'snippet',
    ...overrides,
  }
}

describe('corpus sorting', () => {
  it('sorts hits before slicing the requested page', () => {
    const matches = [
      match({ id: 'dse/Low', n: 'Low', t: '2026-06-20T10:00:00Z', occurrences: 1 }),
      match({ id: 'dse/High', n: 'High', t: '2026-06-19T10:00:00Z', occurrences: 9 }),
      match({ id: 'dse/Middle', n: 'Middle', t: '2026-06-18T10:00:00Z', occurrences: 5 }),
    ]

    expect(selectMatches(matches, 'hits', 'desc', 0, 2).map((item) => item.id)).toEqual(['dse/High', 'dse/Middle'])
    expect(selectMatches(matches, 'hits', 'desc', 1, 1).map((item) => item.id)).toEqual(['dse/Middle'])
    expect(selectMatches(matches, 'hits', 'desc', 2, 1).map((item) => item.id)).toEqual(['dse/Low'])
    expect(matches.map((item) => item.id)).toEqual(['dse/Low', 'dse/High', 'dse/Middle'])
  })

  it('sorts every supported key in both directions', () => {
    const matches = [
      match({ id: 'z/PageB', w: 'z', n: 'PageB', x: 'AgentB', t: '2026-06-20T10:00:00Z', occurrences: 2 }),
      match({ id: 'a/PageA', w: 'a', n: 'PageA', x: 'AgentA', t: '2026-06-19T10:00:00Z', occurrences: 8 }),
    ]

    expect(sortMatches(matches, 'time', 'asc').map((item) => item.id)).toEqual(['a/PageA', 'z/PageB'])
    expect(sortMatches(matches, 'wiki', 'asc').map((item) => item.id)).toEqual(['a/PageA', 'z/PageB'])
    expect(sortMatches(matches, 'page', 'desc').map((item) => item.id)).toEqual(['z/PageB', 'a/PageA'])
    expect(sortMatches(matches, 'label', 'desc').map((item) => item.id)).toEqual(['z/PageB', 'a/PageA'])
    expect(sortMatches(matches, 'hits', 'desc').map((item) => item.id)).toEqual(['a/PageA', 'z/PageB'])
  })

  it('keeps anonymous labels last and uses stable tie-breakers', () => {
    const matches = [
      match({ id: 'dse/PageB', x: null, seq: 2, t: '2026-06-19T10:00:00Z' }),
      match({ id: 'dse/PageA', x: 'AgentA', seq: 2, t: '2026-06-19T10:00:00Z' }),
      match({ id: 'dse/PageC', x: 'AgentB', seq: 1, t: '2026-06-19T10:00:00Z' }),
      match({ id: 'dse/PageA', x: 'AgentA', seq: 1, t: '2026-06-19T10:00:00Z' }),
    ]

    expect(sortMatches(matches, 'label', 'asc').map((item) => `${item.id}:${item.seq}`)).toEqual([
      'dse/PageA:1',
      'dse/PageA:2',
      'dse/PageC:1',
      'dse/PageB:2',
    ])
    expect(sortMatches(matches, 'label', 'desc').map((item) => `${item.id}:${item.seq}`)).toEqual([
      'dse/PageC:1',
      'dse/PageA:1',
      'dse/PageA:2',
      'dse/PageB:2',
    ])
  })

  it('does not mutate the input for non-default orders', () => {
    const matches = [match({ id: 'dse/PageB', occurrences: 9 }), match({ id: 'dse/PageA', occurrences: 1 })]
    const ordered = sortMatches(matches, 'hits', 'desc')

    expect(ordered).not.toBe(matches)
    expect(matches.map((item) => item.id)).toEqual(['dse/PageB', 'dse/PageA'])
  })
})
