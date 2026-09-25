import { describe, expect, it } from 'vitest'
import {
  SOURCE_FILTER_OPTIONS,
  EVENT_FILTER_OPTIONS,
  EVENT_METADATA,
  WIKIS,
  eventColor,
  eventPageId,
  filterEventsByDay,
  filterLabels,
  filterPages,
  filterPagesByDay,
  aggregateDays,
  fmtBytes,
  fmtCompact,
  fmtInt,
  fmtRoundLabel,
  fmtTime,
  fmtTimeSeconds,
  toCsv,
  wikiColor,
} from './format'
import type { DayActivity, LabelRecord, PageRecord, RecentEvent } from '../types'

const p = (over: Partial<PageRecord>): PageRecord => ({
  id: 'dse/Test',
  w: 'dse',
  n: 'Test',
  r: 3,
  f: '2026-06-01',
  l: '2026-06-02',
  d: false,
  del: 0,
  fam: 'off_store_unclassified',
  lb: 1,
  labs: ['AgentA'],
  ...over,
})

describe('formatting', () => {
  it('fmtCompact rounds thousands and millions', () => {
    expect(fmtCompact(14591)).toBe('14.6K')
    expect(fmtCompact(4579)).toBe('4,579')
    expect(fmtCompact(3_200_000)).toBe('3.2M')
  })

  it('fmtInt adds thousands separators', () => {
    expect(fmtInt(14591)).toBe('14,591')
  })

  it('defines the shared source filter options', () => {
    expect(SOURCE_FILTER_OPTIONS).toEqual([
      { value: '', label: 'all sources' },
      { value: 'canonical', label: 'full only' },
      { value: 'recovered', label: 'recovered only' },
    ])
  })

  it('fmtBytes converts byte sizes', () => {
    expect(fmtBytes(512)).toBe('512 B')
    expect(fmtBytes(2048)).toBe('2.0 KB')
    expect(fmtBytes(3 * 1024 * 1024)).toBe('3.0 MB')
  })

  it('fmtTime normalizes ISO and tolerates null', () => {
    expect(fmtTime('2026-06-22T08:45:55Z')).toBe('2026-06-22 08:45Z')
    expect(fmtTime(null)).toBe('—')
  })

  it('wikiColor returns the default color for an unknown wiki', () => {
    expect(wikiColor('dse')).toBe('#4f8cff')
    expect(wikiColor('zzz')).toBe('#64748b')
  })

  it('eventColor maps event types', () => {
    expect(eventColor('save')).toBe('#4f8cff')
    expect(eventColor('delete')).toBe('#ef4444')
  })

  it('derives event filter options and colors from canonical metadata', () => {
    expect(EVENT_FILTER_OPTIONS).toEqual([
      { value: '', label: 'all types' },
      ...EVENT_METADATA.map(({ type, label }) => ({ value: type, label })),
    ])
    for (const { type, color } of EVENT_METADATA) expect(eventColor(type)).toBe(color)
  })
})

describe('filterPages', () => {
  const rows: PageRecord[] = [
    p({ id: 'dse/CashierData', n: 'CashierData', labs: ['AgentA'], r: 12 }),
    p({ id: 'probier/AgentX', n: 'AgentX', w: 'probier', labs: ['AgentB'], r: 2, d: true, del: 2 }),
    p({ id: 'fractal/SandBox', n: 'SandBox', w: 'fractal', labs: ['AgentC'], r: 1 }),
  ]

  it('searches by name, id, and agent label case-insensitively', () => {
    expect(filterPages(rows, { query: 'cashier', wiki: '', deletedOnly: false, minRevs: 0 })).toHaveLength(1)
    expect(filterPages(rows, { query: 'agentb', wiki: '', deletedOnly: false, minRevs: 0 })).toHaveLength(1)
  })

  it('filters by wiki', () => {
    expect(filterPages(rows, { query: '', wiki: 'probier', deletedOnly: false, minRevs: 0 }).map((x) => x.id)).toEqual(['probier/AgentX'])
  })

  it('shows only deleted pages with deletedOnly', () => {
    expect(filterPages(rows, { query: '', wiki: '', deletedOnly: true, minRevs: 0 }).map((x) => x.id)).toEqual(['probier/AgentX'])
  })

  it('filters by minimum revisions', () => {
    expect(filterPages(rows, { query: '', wiki: '', deletedOnly: false, minRevs: 5 })).toHaveLength(1)
  })

  it('filters by fam, and an empty fam shows every record', () => {
    const withEmptyFam = p({ id: 'dse/EmptyFam', fam: '' })
    expect(filterPages([...rows, withEmptyFam], { query: '', wiki: '', fam: 'off_store_unclassified', deletedOnly: false, minRevs: 0 })).toHaveLength(3)
    expect(filterPages([...rows, withEmptyFam], { query: '', wiki: '', fam: '', deletedOnly: false, minRevs: 0 })).toHaveLength(4)
  })

  it('allows an unknown wiki in the WIKIS list (empty filter)', () => {
    expect(WIKIS).toContain('usemod')
  })

  it('filters pages by canonical or recovered source', () => {
    const recovered = p({ id: 'usemod/SandBox', w: 'usemod', partial: true })
    expect(filterPages([...rows, recovered], { query: '', wiki: '', deletedOnly: false, minRevs: 0, src: 'canonical' })).toEqual(rows)
    expect(filterPages([...rows, recovered], { query: '', wiki: '', deletedOnly: false, minRevs: 0, src: 'recovered' })).toEqual([recovered])
  })
})

describe('toCsv', () => {
  it('escapes commas, quotes, and newlines while preserving unicode', () => {
    expect(toCsv([
      { name: 'Алина, агент', note: 'он сказал "да"\nвторая строка' },
    ])).toBe('name,note\r\n"Алина, агент","он сказал ""да""\nвторая строка"')
  })

  it('uses the given columns and empty values', () => {
    expect(toCsv([{ b: 2, a: 1 }], ['a', 'missing', 'b'])).toBe('a,missing,b\r\n1,,2')
  })
})

describe('day filters and aggregation', () => {
  it('filters pages by an inclusive date range', () => {
    const rows = [
      p({ id: 'dse/Exact', f: '2026-06-18', l: '2026-06-18' }),
      p({ id: 'dse/Range', f: '2026-06-17', l: '2026-06-19' }),
      p({ id: 'dse/Before', f: '2026-06-01', l: '2026-06-17' }),
    ]
    expect(filterPagesByDay(rows, '2026-06-18').map((row) => row.id)).toEqual(['dse/Exact', 'dse/Range'])
    expect(filterPagesByDay(rows, '2026-06-20')).toEqual([])
  })

  it('filters events by the first ten timestamp characters', () => {
    const events: RecentEvent[] = [
      { t: '2026-06-18T00:01:00Z', type: 'save', wiki: 'dse', page: 'A', action: null, ip16: null },
      { t: '2026-06-19T00:01:00Z', type: 'delete', wiki: 'dse', page: 'B', action: null, ip16: null },
    ]
    expect(filterEventsByDay(events, '2026-06-18')).toHaveLength(1)
    expect(filterEventsByDay(events, '2026-06-20')).toEqual([])
  })

  it('aggregates saves and deletes by date and sorts newest dates first', () => {
    const rows: DayActivity[] = [
      { date: '2026-06-18', wiki: 'dse', saves: 3, deletes: 1, reverts: 0, probes: 0, bytes: 10 },
      { date: '2026-06-17', wiki: 'dse', saves: 2, deletes: 0, reverts: 0, probes: 0, bytes: 10 },
      { date: '2026-06-18', wiki: 'probier', saves: 4, deletes: 2, reverts: 0, probes: 0, bytes: 10 },
    ]
    expect(aggregateDays(rows)).toEqual([
      { date: '2026-06-18', saves: 7, deletes: 3, count: 10, rec: 0 },
      { date: '2026-06-17', saves: 2, deletes: 0, count: 2, rec: 0 },
    ])
  })

  it('aggregates recovered save counts separately', () => {
    expect(aggregateDays([{ date: '2026-05-11', wiki: 'usemod', saves: 3, deletes: 0, reverts: 0, probes: 0, bytes: 0, rec: 3 }])).toEqual([
      { date: '2026-05-11', saves: 3, deletes: 0, count: 3, rec: 3 },
    ])
  })
})

describe('filterLabels', () => {
  const labels: LabelRecord[] = [
    { x: 'AgentDataHelperX', r: 100, f: '2026-06-01', t: '2026-06-20', p: 5, h: false, w: ['dse'], pgs: [] },
    { x: 'Alpha', r: 2, f: '2026-06-02', t: '2026-06-03', p: 1, h: true, w: ['probier'], pgs: [] },
  ]

  it('filters by substring case-insensitively', () => {
    expect(filterLabels(labels, 'alpha')).toHaveLength(1)
    expect(filterLabels(labels, 'helper')).toHaveLength(1)
  })

  it('returns everything for an empty query', () => {
    expect(filterLabels(labels, '')).toHaveLength(2)
  })

  it('keeps only the labels allowed by the ip16 slice, combined with the query', () => {
    const allowed = new Set(['AgentDataHelperX'])

    expect(filterLabels(labels, '', allowed).map((label) => label.x)).toEqual(['AgentDataHelperX'])
    expect(filterLabels(labels, 'alpha', allowed)).toHaveLength(0)
    expect(filterLabels(labels, 'helper', null)).toHaveLength(1)
  })
})

describe('filterPages with tokenSlugs and payloadFlags', () => {
  it('filterPages matches via tokenSlugs even if title does not contain the word', () => {
    const rows = [
      p({ id: 'dse/StartSeite', s: 'dse_StartSeite~', n: 'StartSeite' }),
      p({ id: 'dse/Other', s: 'dse_Other~', n: 'Other' }),
    ]
    const tokenSlugs = ['dse_StartSeite~']
    const matched = filterPages(rows, { query: 'bypass', wiki: '', deletedOnly: false, minRevs: 0, tokenSlugs })
    expect(matched.map((r) => r.id)).toEqual(['dse/StartSeite'])
  })

  it('filterPages by payloadFlag keeps only pages with that flag', () => {
    const rows = [
      p({ id: 'dse/WithHex', s: 'dse_WithHex~' }),
      p({ id: 'dse/WithRedirect', s: 'dse_WithRedirect~' }),
      p({ id: 'dse/Clean', s: 'dse_Clean~' }),
    ]
    const payloadFlags = new Map<string, string[]>([
      ['dse/WithHex', ['hex']],
      ['dse_WithRedirect~', ['redirect']],
    ])
    const hex = filterPages(rows, { query: '', wiki: '', deletedOnly: false, minRevs: 0, payloadFlag: 'hex', payloadFlags: payloadFlags })
    expect(hex.map((r) => r.id)).toEqual(['dse/WithHex'])
    const redirect = filterPages(rows, { query: '', wiki: '', deletedOnly: false, minRevs: 0, payloadFlag: 'redirect', payloadFlags: payloadFlags })
    // matches by slug key as well
    expect(redirect.map((r) => r.id)).toEqual(['dse/WithRedirect'])
    // without a flag filter — all pages
    const all = filterPages(rows, { query: '', wiki: '', deletedOnly: false, minRevs: 0 })
    expect(all.length).toBe(3)
  })
})

describe('fmtTimeSeconds', () => {
  it('formats timestamp with seconds-preserving UTC precision', () => {
    expect(fmtTimeSeconds('2026-06-22T08:45:55Z')).toBe('2026-06-22 08:45:55Z')
  })

  it('returns dash on null and raw input on invalid date', () => {
    expect(fmtTimeSeconds(null)).toBe('—')
    expect(fmtTimeSeconds('not-a-date')).toBe('not-a-date')
  })

  it('preserves existing fmtTime minute precision', () => {
    expect(fmtTime('2026-06-22T08:45:55Z')).toBe('2026-06-22 08:45Z')
  })
})


describe('eventPageId', () => {
  it('prefixes wiki for canonical ids from recent events', () => {
    expect(eventPageId({ wiki: 'dse', page: 'AgentZzzHighMapJun21' })).toBe('dse/AgentZzzHighMapJun21')
  })

  it('keeps ids that already start with the wiki prefix', () => {
    expect(eventPageId({ wiki: 'dse', page: 'dse/--help' })).toBe('dse/--help')
  })

  it('prefixes titles containing slashes that are not wiki-prefixed', () => {
    expect(eventPageId({ wiki: 'dse', page: 'Foo/Bar' })).toBe('dse/Foo/Bar')
  })

  it('handles empty normalized values from build.py without throwing', () => {
    expect(eventPageId({ wiki: '', page: 'SomePage' })).toBe('SomePage')
    expect(eventPageId({ wiki: 'dse', page: '' })).toBe('')
  })
})

describe('fmtRoundLabel', () => {
  it('returns null when no non-null reference remains', () => {
    expect(fmtRoundLabel(null)).toBeNull()
    expect(fmtRoundLabel([])).toBeNull()
    expect(fmtRoundLabel([null])).toBeNull()
    expect(fmtRoundLabel([null, null])).toBeNull()
  })

  it('compacts canonical references to their round number', () => {
    expect(fmtRoundLabel(['dse~Page#round-1'])).toBe('r1')
  })

  it('joins multiple references and keeps unknown shapes verbatim', () => {
    expect(fmtRoundLabel(['dse~A#round-2', 'dse~B#round-1', null])).toBe('r2, r1')
    expect(fmtRoundLabel(['custom-round'])).toBe('rcustom-round')
  })
})
