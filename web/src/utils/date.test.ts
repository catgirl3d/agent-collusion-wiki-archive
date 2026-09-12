import { describe, expect, it } from 'vitest'
import { isoDate, monthCells, parseYearMonth, stepMonth } from './date'

describe('parseYearMonth', () => {
  it('extracts year and zero-based month from an ISO date', () => {
    expect(parseYearMonth('2026-06-17')).toEqual({ y: 2026, m: 5 })
    expect(parseYearMonth('2026-01-01')).toEqual({ y: 2026, m: 0 })
    expect(parseYearMonth('2026-12-31')).toEqual({ y: 2026, m: 11 })
  })
})

describe('isoDate', () => {
  it('pads month and day to two digits', () => {
    expect(isoDate(2026, 0, 1)).toBe('2026-01-01')
    expect(isoDate(2026, 11, 31)).toBe('2026-12-31')
  })
})

describe('monthCells', () => {
  it('starts on the first Monday slot and covers every day of the month', () => {
    const cells = monthCells(2026, 5)
    expect(cells[0]).toBe('2026-06-01')
    expect(cells).toContain('2026-06-30')
    expect(cells.filter((cell) => cell !== null)).toHaveLength(30)
  })

  it('pads the leading gap with nulls for a mid-week month start', () => {
    const cells = monthCells(2026, 3)
    expect(cells.slice(0, 2)).toEqual([null, null])
    expect(cells[2]).toBe('2026-04-01')
  })

  it('pads the trailing row to a multiple of seven', () => {
    for (const month of [0, 5, 8]) {
      const cells = monthCells(2026, month)
      expect(cells.length % 7).toBe(0)
    }
  })
})

describe('stepMonth', () => {
  it('steps within the year and wraps across year boundaries', () => {
    expect(stepMonth(2026, 5, 1)).toEqual({ y: 2026, m: 6 })
    expect(stepMonth(2026, 5, -1)).toEqual({ y: 2026, m: 4 })
    expect(stepMonth(2026, 11, 1)).toEqual({ y: 2027, m: 0 })
    expect(stepMonth(2026, 0, -1)).toEqual({ y: 2025, m: 11 })
  })
})
