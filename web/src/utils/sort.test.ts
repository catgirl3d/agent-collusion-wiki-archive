import { describe, expect, it } from 'vitest'
import {
  compareNullableNumber,
  compareNullableText,
  resolveSort,
  toggleSortState,
  updateSortSearchParams,
  writeSortParams,
  type SortDir,
} from './sort'

const keys = ['time', 'wiki', 'hits'] as const
const defaults: Record<(typeof keys)[number], SortDir> = {
  time: 'desc',
  wiki: 'asc',
  hits: 'desc',
}

describe('sort URL helpers', () => {
  it('resolves a valid sort and its explicit direction', () => {
    expect(resolveSort('wiki', 'desc', keys, defaults)).toEqual({ sort: 'wiki', dir: 'desc' })
  })

  it('uses the first key default and ignores a direction without a valid sort', () => {
    expect(resolveSort(null, 'asc', keys, defaults)).toEqual({ sort: 'time', dir: 'desc' })
    expect(resolveSort('unknown', 'asc', keys, defaults)).toEqual({ sort: 'time', dir: 'desc' })
  })

  it('uses a column default when a valid sort has no direction', () => {
    expect(resolveSort('wiki', null, keys, defaults)).toEqual({ sort: 'wiki', dir: 'asc' })
  })

  it('flips an active column and applies the new column default', () => {
    expect(toggleSortState({ sort: 'time', dir: 'desc' }, 'time', defaults)).toEqual({ sort: 'time', dir: 'asc' })
    expect(toggleSortState({ sort: 'time', dir: 'asc' }, 'wiki', defaults)).toEqual({ sort: 'wiki', dir: 'asc' })
  })

  it('writes non-canonical pairs and removes the canonical pair', () => {
    const params = new URLSearchParams('q=needle&page=2')
    writeSortParams(params, { sort: 'hits', dir: 'desc' }, { sort: 'time', dir: 'desc' })
    expect(params.toString()).toBe('q=needle&page=2&sort=hits&dir=desc')

    writeSortParams(params, { sort: 'time', dir: 'desc' }, { sort: 'time', dir: 'desc' })
    expect(params.toString()).toBe('q=needle&page=2')
  })

  it('keeps nullable values last in either direction', () => {
    expect(compareNullableText(null, 'AgentA', 'asc')).toBeGreaterThan(0)
    expect(compareNullableText(null, 'AgentA', 'desc')).toBeGreaterThan(0)
    expect(compareNullableText(undefined, 'AgentA', 'asc')).toBeGreaterThan(0)
    expect(compareNullableText(undefined, 'AgentA', 'desc')).toBeGreaterThan(0)
    expect(compareNullableNumber(null, 10, 'asc')).toBeGreaterThan(0)
    expect(compareNullableNumber(null, 10, 'desc')).toBeGreaterThan(0)
    expect(compareNullableNumber(undefined, 10, 'asc')).toBeGreaterThan(0)
    expect(compareNullableNumber(undefined, 10, 'desc')).toBeGreaterThan(0)
  })

  it('updates sort params without mutating the current URL', () => {
    const current = new URLSearchParams('q=needle&page=3')
    const next = updateSortSearchParams(current, { sort: 'time', dir: 'desc' }, 'hits', defaults, { sort: 'time', dir: 'desc' })

    expect(next.toString()).toBe('q=needle&sort=hits&dir=desc')
    expect(current.toString()).toBe('q=needle&page=3')
  })
})
