import { describe, expect, it } from 'vitest'
import { compareCanonicalRevisionOrder } from './revision'

describe('canonical revision order', () => {
  it('orders by newest time, then id, then sequence', () => {
    expect(compareCanonicalRevisionOrder(
      { t: '2026-06-18T00:00:00Z', id: 'wiki/PageB', seq: 2 },
      { t: '2026-06-19T00:00:00Z', id: 'wiki/PageA', seq: 1 },
    )).toBeGreaterThan(0)
    expect(compareCanonicalRevisionOrder(
      { t: '2026-06-19T00:00:00Z', id: 'wiki/PageA', seq: 1 },
      { t: '2026-06-19T00:00:00Z', id: 'wiki/PageA', seq: 2 },
    )).toBeLessThan(0)
  })
})
