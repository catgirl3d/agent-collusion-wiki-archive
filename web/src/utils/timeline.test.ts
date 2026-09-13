import { describe, expect, it } from 'vitest'
import type { TimelineEntry } from '../types'
import { filterTimeline, pageSlice } from './timeline'

const rows: TimelineEntry[] = [
  { t: '2026-06-20T10:00:00Z', w: 'dse', id: 'dse/PageB', s: 'dse_PageB~', seq: 1, x: 'AgentX', a: 'form_edit', ip: '20.1', l: 20 },
  { t: '2026-06-19T10:00:00Z', w: 'dse', id: 'dse/PageA', s: 'dse_PageA~', seq: 2, x: 'AgentY', a: 'form_edit', ip: null, l: 18 },
  { t: '2026-06-18T10:00:00Z', w: 'probier', id: 'probier/PageC', s: 'probier_PageC~', seq: 1, x: 'AgentX', a: 'create', ip: null, l: 40 },
]

describe('filterTimeline', () => {
  it('filters by exact label, wiki, day, and inclusive date range', () => {
    expect(filterTimeline(rows, { label: 'AgentX' }).map((row) => row.id)).toEqual(['dse/PageB', 'probier/PageC'])
    expect(filterTimeline(rows, { wiki: 'dse' })).toHaveLength(2)
    expect(filterTimeline(rows, { day: '2026-06-19' }).map((row) => row.id)).toEqual(['dse/PageA'])
    expect(filterTimeline(rows, { from: '2026-06-19', to: '2026-06-20' })).toHaveLength(2)
    expect(filterTimeline(rows, { from: '2026-06-21' })).toHaveLength(0)
  })

  it('treats an empty label as no filter and keeps anonymous rows visible', () => {
    expect(filterTimeline(rows, { label: '   ' })).toHaveLength(3)
    const anon: TimelineEntry[] = [{ ...rows[0], x: null }]
    expect(filterTimeline(anon, {})).toHaveLength(1)
    expect(filterTimeline(anon, { label: 'AgentX' })).toHaveLength(0)
  })

  it('filters canonical and recovered rows by source', () => {
    const recovered = { ...rows[0], id: 'usemod/SandBox', partial: true }
    expect(filterTimeline([...rows, recovered], { src: 'canonical' }).every((row) => !row.partial)).toBe(true)
    expect(filterTimeline([...rows, recovered], { src: 'recovered' })).toEqual([recovered])
  })
})

describe('pageSlice', () => {
  it('clamps the page and reports the total page count', () => {
    expect(pageSlice([1, 2, 3, 4, 5], 0, 2)).toEqual({ page: 0, pages: 3, rows: [1, 2] })
    expect(pageSlice([1, 2, 3, 4, 5], 2, 2)).toEqual({ page: 2, pages: 3, rows: [5] })
    expect(pageSlice([1, 2, 3, 4, 5], 99, 2)).toEqual({ page: 2, pages: 3, rows: [5] })
    expect(pageSlice([], 4, 2)).toEqual({ page: 0, pages: 1, rows: [] })
  })
})
