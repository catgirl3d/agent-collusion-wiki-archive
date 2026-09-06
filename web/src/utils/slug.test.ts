import { describe, expect, it } from 'vitest'
import { slugify } from './slug'

describe('slugify', () => {
  it('normalizes characters', () => {
    expect(slugify('dse/StartSeite')).toBe('dse_StartSeite~')
  })
})
