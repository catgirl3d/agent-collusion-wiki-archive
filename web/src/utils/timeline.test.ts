import { describe, expect, it } from 'vitest'
import type { TimelineEntry } from '../types'
import { filterTimeline, getTimelinePageName, sortTimelineRows } from './timeline'

const rows: TimelineEntry[] = [
  { t: '2026-06-20T10:00:00Z', w: 'dse', id: 'dse/PageB', s: 'dse_PageB~', seq: 1, x: 'AgentX', a: 'form_edit', ip: '20.1', l: 20 },
  { t: '2026-06-19T10:00:00Z', w: 'dse', id: 'dse/PageA', s: 'dse_PageA~', seq: 2, x: 'AgentY', a: 'form_edit', ip: null, l: 18 },
  { t: '2026-06-18T10:00:00Z', w: 'probier', id: 'probier/PageC', s: 'probier_PageC~', seq: 1, x: 'AgentX', a: 'create', ip: null, l: 40 },
]

const sortingRows: TimelineEntry[] = [
  { t: '2026-06-20T10:00:00Z', w: 'z', id: 'z/PageC', s: 'z_PageC~', seq: 1, x: null, a: 'edit', ip: '30', l: 10 },
  { t: '2026-06-19T10:00:00Z', w: 'a', id: 'a/PageA', s: 'a_PageA~', seq: 1, x: 'AgentA', a: 'delete', ip: '20', l: 20 },
  { t: '2026-06-19T10:00:00Z', w: 'a', id: 'a/PageA', s: 'a_PageA~', seq: 2, x: 'AgentA', a: 'save', ip: '10', l: 5 },
  { t: '2026-06-18T10:00:00Z', w: 'b', id: 'b/PageB', s: 'b_PageB~', seq: 1, x: 'AgentB', a: null, ip: null, l: null },
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

describe('timeline sorting', () => {
  it('uses the same page name that the table displays', () => {
    expect(getTimelinePageName('wiki/Page/With/Slash')).toBe('Page/With/Slash')
    expect(getTimelinePageName('StandalonePage')).toBe('StandalonePage')
  })

  it('keeps the source order for the default newest-first view', () => {
    expect(sortTimelineRows(sortingRows, 'time', 'desc')).toBe(sortingRows)
  })

  it('sorts time ascending with stable id and sequence tie-breakers', () => {
    expect(sortTimelineRows(sortingRows, 'time', 'asc').map((row) => `${row.id}:${row.seq}`)).toEqual([
      'b/PageB:1',
      'a/PageA:1',
      'a/PageA:2',
      'z/PageC:1',
    ])
  })

  it('sorts all columns in both directions and keeps nulls last', () => {
    expect(sortTimelineRows(sortingRows, 'wiki', 'asc').map((row) => row.id)).toEqual(['a/PageA', 'a/PageA', 'b/PageB', 'z/PageC'])
    expect(sortTimelineRows(sortingRows, 'page', 'desc').map((row) => row.id)).toEqual(['z/PageC', 'b/PageB', 'a/PageA', 'a/PageA'])
    expect(sortTimelineRows(sortingRows, 'label', 'asc').map((row) => row.x)).toEqual(['AgentA', 'AgentA', 'AgentB', null])
    expect(sortTimelineRows(sortingRows, 'label', 'desc').map((row) => row.x)).toEqual(['AgentB', 'AgentA', 'AgentA', null])
    expect(sortTimelineRows(sortingRows, 'action', 'asc').map((row) => row.a)).toEqual(['delete', 'edit', 'save', null])
    expect(sortTimelineRows(sortingRows, 'ip', 'desc').map((row) => row.ip)).toEqual(['30', '20', '10', null])
    expect(sortTimelineRows(sortingRows, 'len', 'desc').map((row) => row.l)).toEqual([20, 10, 5, null])
    expect(sortTimelineRows(sortingRows, 'len', 'asc').map((row) => row.l)).toEqual([5, 10, 20, null])
  })

  it('sorts Page by the displayed page name rather than the wiki prefix', () => {
    const source: TimelineEntry[] = [
      { ...sortingRows[0], id: 'wikiA/Zulu' },
      { ...sortingRows[1], id: 'wikiZ/Alpha' },
    ]

    expect(sortTimelineRows(source, 'page', 'asc').map((row) => row.id)).toEqual(['wikiZ/Alpha', 'wikiA/Zulu'])
  })

  it('does not mutate the filtered source rows', () => {
    const source = [...sortingRows]
    const ordered = sortTimelineRows(source, 'len', 'desc')

    expect(ordered).not.toBe(source)
    expect(source.map((row) => row.id)).toEqual(sortingRows.map((row) => row.id))
  })

  it('places a later high-length row on the first page after sorting', () => {
    const source: TimelineEntry[] = [
      { ...sortingRows[0], id: 'z/Low', l: 1 },
      { ...sortingRows[1], id: 'a/High', l: 100 },
      { ...sortingRows[2], id: 'b/Middle', l: 50 },
    ]
    const ordered = sortTimelineRows(source, 'len', 'desc')

    expect(ordered.slice(0, 1).map((row) => row.id)).toEqual(['a/High'])
  })
})
