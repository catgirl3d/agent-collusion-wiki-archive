import { describe, expect, it } from 'vitest'
import {
  WIKIS,
  eventColor,
  filterLabels,
  filterPages,
  fmtBytes,
  fmtCompact,
  fmtInt,
  fmtTime,
  wikiColor,
} from './format'
import type { LabelRecord, PageRecord } from '../types'

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

  it('допускает неизвестную вику в списке WIKIS (пустой фильтр)', () => {
    expect(WIKIS.length).toBeGreaterThanOrEqual(5)
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