import { describe, expect, it } from 'vitest'
import type { LabelRecord } from '../types'
import {
  AGENTS_SORT_DEFAULT,
  AGENTS_SORT_DEFAULTS,
  AGENTS_SORT_KEYS,
  compareAgents,
  sortAgentLabels,
} from './agents'

const rows: LabelRecord[] = [
  { x: 'Alpha', r: 5, f: '2026-05-01', t: '2026-06-01', p: 3, h: false, w: ['dse'], pgs: [] },
  { x: 'beta', r: 9, f: '2026-04-01', t: '2026-05-01', p: 2, h: false, w: ['dse'], pgs: [] },
  { x: 'Copper', r: 9, f: '2026-03-01', t: '2026-07-01', p: 1, h: true, w: [], pgs: [] },
]

describe('agent label sorting', () => {
  it('sorts labels in locale collation order in both directions', () => {
    const unordered: LabelRecord[] = [rows[2], rows[1], rows[0]]

    expect(sortAgentLabels(unordered, 'label', 'asc').map(({ x }) => x)).toEqual(['Alpha', 'beta', 'Copper'])
    expect(sortAgentLabels(unordered, 'label', 'desc').map(({ x }) => x)).toEqual(['Copper', 'beta', 'Alpha'])
  })

  it('sorts revision counts numerically in both directions', () => {
    expect(sortAgentLabels(rows, 'revs', 'asc').map(({ x }) => x)).toEqual(['Alpha', 'beta', 'Copper'])
    expect(sortAgentLabels(rows, 'revs', 'desc').map(({ x }) => x)).toEqual(['beta', 'Copper', 'Alpha'])
  })

  it('sorts page counts numerically in both directions', () => {
    expect(sortAgentLabels(rows, 'pages', 'asc').map(({ x }) => x)).toEqual(['Copper', 'beta', 'Alpha'])
    expect(sortAgentLabels(rows, 'pages', 'desc').map(({ x }) => x)).toEqual(['Alpha', 'beta', 'Copper'])
  })

  it('sorts first revision dates lexicographically in both directions', () => {
    expect(sortAgentLabels(rows, 'first', 'asc').map(({ x }) => x)).toEqual(['Copper', 'beta', 'Alpha'])
    expect(sortAgentLabels(rows, 'first', 'desc').map(({ x }) => x)).toEqual(['Alpha', 'beta', 'Copper'])
  })

  it('sorts last revision dates lexicographically in both directions', () => {
    expect(sortAgentLabels(rows, 'last', 'asc').map(({ x }) => x)).toEqual(['beta', 'Alpha', 'Copper'])
    expect(sortAgentLabels(rows, 'last', 'desc').map(({ x }) => x)).toEqual(['Copper', 'Alpha', 'beta'])
  })

  it('keeps equal revision counts in their input order', () => {
    const tiedRows: LabelRecord[] = [rows[2], rows[1], rows[0]]

    expect(sortAgentLabels(tiedRows, 'revs', 'desc').map(({ x }) => x)).toEqual(['Copper', 'beta', 'Alpha'])
  })

  it('orders an empty label before text ascending and after text descending', () => {
    const emptyLabel: LabelRecord = { ...rows[0], x: '' }

    expect(compareAgents(emptyLabel, rows[0], 'label', 'asc')).toBeLessThan(0)
    expect(compareAgents(emptyLabel, rows[0], 'label', 'desc')).toBeGreaterThan(0)
  })

  it('does not mutate the input array while sorting', () => {
    const snapshot = structuredClone(rows)

    sortAgentLabels(rows, 'pages', 'asc')

    expect(rows).toEqual(snapshot)
  })

  it('exposes the expected keys and sort defaults', () => {
    expect(AGENTS_SORT_KEYS).toEqual(['label', 'revs', 'pages', 'first', 'last'])
    expect(Object.keys(AGENTS_SORT_DEFAULTS)).toEqual(['label', 'revs', 'pages', 'first', 'last'])
    expect(AGENTS_SORT_DEFAULTS).toEqual({
      label: 'asc',
      revs: 'desc',
      pages: 'desc',
      first: 'asc',
      last: 'desc',
    })
    expect(AGENTS_SORT_DEFAULT).toEqual({ sort: 'label', dir: 'asc' })
  })
})
