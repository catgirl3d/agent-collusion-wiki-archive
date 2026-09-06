import { describe, expect, it } from 'vitest'
import {
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
  fmtTime,
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

describe('форматирование', () => {
  it('fmtCompact округляет тысячи и миллионы', () => {
    expect(fmtCompact(14591)).toBe('14.6K')
    expect(fmtCompact(4579)).toBe('4,579')
    expect(fmtCompact(3_200_000)).toBe('3.2M')
  })

  it('fmtInt добавляет разделители', () => {
    expect(fmtInt(14591)).toBe('14,591')
  })

  it('fmtBytes конвертирует размеры', () => {
    expect(fmtBytes(512)).toBe('512 B')
    expect(fmtBytes(2048)).toBe('2.0 KB')
    expect(fmtBytes(3 * 1024 * 1024)).toBe('3.0 MB')
  })

  it('fmtTime нормализует ISO и не падает на null', () => {
    expect(fmtTime('2026-06-22T08:45:55Z')).toBe('2026-06-22 08:45Z')
    expect(fmtTime(null)).toBe('—')
  })

  it('wikiColor отдаёт цвет по умолчанию для неизвестной вики', () => {
    expect(wikiColor('dse')).toBe('#4f8cff')
    expect(wikiColor('zzz')).toBe('#64748b')
  })

  it('eventColor мапит типы событий', () => {
    expect(eventColor('save')).toBe('#4f8cff')
    expect(eventColor('delete')).toBe('#ef4444')
  })
})

describe('filterPages', () => {
  const rows: PageRecord[] = [
    p({ id: 'dse/CashierData', n: 'CashierData', labs: ['AgentA'], r: 12 }),
    p({ id: 'probier/AgentX', n: 'AgentX', w: 'probier', labs: ['AgentB'], r: 2, d: true, del: 2 }),
    p({ id: 'fractal/SandBox', n: 'SandBox', w: 'fractal', labs: ['AgentC'], r: 1 }),
  ]

  it('ищет по имени, id и метке агента без учёта регистра', () => {
    expect(filterPages(rows, { query: 'cashier', wiki: '', deletedOnly: false, minRevs: 0 })).toHaveLength(1)
    expect(filterPages(rows, { query: 'agentb', wiki: '', deletedOnly: false, minRevs: 0 })).toHaveLength(1)
  })

  it('фильтрует по вики', () => {
    expect(filterPages(rows, { query: '', wiki: 'probier', deletedOnly: false, minRevs: 0 }).map((x) => x.id)).toEqual(['probier/AgentX'])
  })

  it('показывает только удалённые при deletedOnly', () => {
    expect(filterPages(rows, { query: '', wiki: '', deletedOnly: true, minRevs: 0 }).map((x) => x.id)).toEqual(['probier/AgentX'])
  })

  it('фильтрует по минимуму ревизий', () => {
    expect(filterPages(rows, { query: '', wiki: '', deletedOnly: false, minRevs: 5 })).toHaveLength(1)
  })

  it('фильтрует по fam, а пустой fam показывает все записи', () => {
    const withEmptyFam = p({ id: 'dse/EmptyFam', fam: '' })
    expect(filterPages([...rows, withEmptyFam], { query: '', wiki: '', fam: 'off_store_unclassified', deletedOnly: false, minRevs: 0 })).toHaveLength(3)
    expect(filterPages([...rows, withEmptyFam], { query: '', wiki: '', fam: '', deletedOnly: false, minRevs: 0 })).toHaveLength(4)
  })

  it('допускает неизвестную вику в списке WIKIS (пустой фильтр)', () => {
    expect(WIKIS.length).toBeGreaterThanOrEqual(5)
  })
})

describe('toCsv', () => {
  it('экранирует запятые, кавычки, переводы строк и сохраняет unicode', () => {
    expect(toCsv([
      { name: 'Алина, агент', note: 'он сказал "да"\nвторая строка' },
    ])).toBe('name,note\r\n"Алина, агент","он сказал ""да""\nвторая строка"')
  })

  it('использует переданные колонки и пустые значения', () => {
    expect(toCsv([{ b: 2, a: 1 }], ['a', 'missing', 'b'])).toBe('a,missing,b\r\n1,,2')
  })
})

describe('day-фильтры и агрегация', () => {
  it('фильтрует страницы по включительному диапазону дат', () => {
    const rows = [
      p({ id: 'dse/Exact', f: '2026-06-18', l: '2026-06-18' }),
      p({ id: 'dse/Range', f: '2026-06-17', l: '2026-06-19' }),
      p({ id: 'dse/Before', f: '2026-06-01', l: '2026-06-17' }),
    ]
    expect(filterPagesByDay(rows, '2026-06-18').map((row) => row.id)).toEqual(['dse/Exact', 'dse/Range'])
    expect(filterPagesByDay(rows, '2026-06-20')).toEqual([])
  })

  it('фильтрует события по первым десяти символам timestamp', () => {
    const events: RecentEvent[] = [
      { t: '2026-06-18T00:01:00Z', type: 'save', wiki: 'dse', page: 'A', action: null, ip16: null },
      { t: '2026-06-19T00:01:00Z', type: 'delete', wiki: 'dse', page: 'B', action: null, ip16: null },
    ]
    expect(filterEventsByDay(events, '2026-06-18')).toHaveLength(1)
    expect(filterEventsByDay(events, '2026-06-20')).toEqual([])
  })

  it('агрегирует saves и deletes по дате и сортирует свежие даты сверху', () => {
    const rows: DayActivity[] = [
      { date: '2026-06-18', wiki: 'dse', saves: 3, deletes: 1, reverts: 0, probes: 0, bytes: 10 },
      { date: '2026-06-17', wiki: 'dse', saves: 2, deletes: 0, reverts: 0, probes: 0, bytes: 10 },
      { date: '2026-06-18', wiki: 'probier', saves: 4, deletes: 2, reverts: 0, probes: 0, bytes: 10 },
    ]
    expect(aggregateDays(rows)).toEqual([
      { date: '2026-06-18', saves: 7, deletes: 3, count: 10 },
      { date: '2026-06-17', saves: 2, deletes: 0, count: 2 },
    ])
  })
})

describe('filterLabels', () => {
  const labels: LabelRecord[] = [
    { x: 'AgentDataHelperX', r: 100, f: '2026-06-01', t: '2026-06-20', p: 5, h: false, w: ['dse'], pgs: [] },
    { x: 'Alpha', r: 2, f: '2026-06-02', t: '2026-06-03', p: 1, h: true, w: ['probier'], pgs: [] },
  ]

  it('фильтрует по подстроке без учёта регистра', () => {
    expect(filterLabels(labels, 'alpha')).toHaveLength(1)
    expect(filterLabels(labels, 'helper')).toHaveLength(1)
  })

  it('возвращает все при пустом запросе', () => {
    expect(filterLabels(labels, '')).toHaveLength(2)
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
    // матч и по slug-ключу
    expect(redirect.map((r) => r.id)).toEqual(['dse/WithRedirect'])
    // без флага-фильтра — все страницы
    const all = filterPages(rows, { query: '', wiki: '', deletedOnly: false, minRevs: 0 })
    expect(all.length).toBe(3)
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
