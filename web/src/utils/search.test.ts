import { describe, expect, it } from 'vitest'
import { lookupTokenPostings } from './search'
import type { SearchIndex } from '../types'

describe('full-text search and token postings', () => {
  const index: SearchIndex = {
    tokens: {
      bypass: ['dse_StartSeite~', 'dse_BypassPage~'],
      zzz: ['dse_ZZZPage~'],
    },
    urls: { 'pinggy.io': 5 },
    meta: { built_from: 'test', n_tokens: 2 },
  }

  it('lookupTokenPostings returns slugs for terms >= 3 chars', () => {
    expect(lookupTokenPostings(index, 'bypass')).toEqual(['dse_StartSeite~', 'dse_BypassPage~'])
    expect(lookupTokenPostings(index, 'by')).toBeNull()
    expect(lookupTokenPostings(index, 'unknown')).toEqual([])
    expect(lookupTokenPostings(null, 'bypass')).toBeNull()
  })

  it('lookupTokenPostings intersects postings of multi-word queries', () => {
    const multi: SearchIndex = {
      tokens: {
        bypass: ['dse_StartSeite~', 'dse_BypassPage~', 'dse_Shared~'],
        probe: ['dse_BypassPage~', 'dse_Shared~', 'dse_ProbePage~'],
        simple: ['dse_Simplest~'],
      },
      urls: {},
      meta: { built_from: 'test', n_tokens: 3 },
    }
    expect(lookupTokenPostings(multi, 'bypass probe')!.sort()).toEqual(['dse_BypassPage~', 'dse_Shared~'])
    expect(lookupTokenPostings(multi, 'bypass simple')).toEqual([])
  })

  it('lookupTokenPostings normalizes case, punctuation and ignores short words', () => {
    const multi: SearchIndex = {
      tokens: {
        bypass: ['dse_StartSeite~', 'dse_BypassPage~', 'dse_Shared~'],
        probe: ['dse_BypassPage~', 'dse_Shared~', 'dse_ProbePage~'],
      },
      urls: {},
      meta: { built_from: 'test', n_tokens: 2 },
    }
    // BY_PASS splits into by + pass; by is dropped (<3), pass is missing from the index → []
    expect(lookupTokenPostings(multi, 'Probe BY_PASS!')).toEqual([])
    // mixed case + punctuation normalize to ready tokens
    expect(lookupTokenPostings(multi, 'Probe, BYpass!')!.sort()).toEqual(['dse_BypassPage~', 'dse_Shared~'])
    // the short word "by" is dropped — only probe remains
    expect(lookupTokenPostings(multi, 'by probe')!.sort()).toEqual(['dse_BypassPage~', 'dse_ProbePage~', 'dse_Shared~'])
  })
})
