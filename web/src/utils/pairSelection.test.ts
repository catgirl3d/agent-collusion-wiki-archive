import { describe, expect, it } from 'vitest'
import {
  canonicalPair,
  clearPair,
  parsePair,
  parsePairPage,
  setPair,
} from './pairSelection'

describe('canonicalPair', () => {
  it('orders pair labels regardless of input order', () => {
    expect(canonicalPair('AgentA', 'AgentB')).toEqual(['AgentA', 'AgentB'])
    expect(canonicalPair('AgentB', 'AgentA')).toEqual(['AgentA', 'AgentB'])
    expect(canonicalPair('Beta', 'Alpha')).toEqual(['Alpha', 'Beta'])
    expect(canonicalPair('Same', 'Same')).toEqual(['Same', 'Same'])
  })
})

describe('parsePair', () => {
  it('returns null when pairA or pairB is missing', () => {
    expect(parsePair(new URLSearchParams(''))).toBeNull()
    expect(parsePair(new URLSearchParams('pairA=AgentA'))).toBeNull()
    expect(parsePair(new URLSearchParams('pairB=AgentB'))).toBeNull()
  })

  it('returns null when pairA or pairB is empty', () => {
    expect(parsePair(new URLSearchParams('pairA=&pairB=AgentB'))).toBeNull()
    expect(parsePair(new URLSearchParams('pairA=AgentA&pairB='))).toBeNull()
    expect(parsePair(new URLSearchParams('pairA=   &pairB=AgentB'))).toBeNull()
  })

  it('returns null when labels are equal', () => {
    expect(parsePair(new URLSearchParams('pairA=AgentA&pairB=AgentA'))).toBeNull()
  })

  it('canonicalizes order in valid pair selection', () => {
    const sorted = parsePair(new URLSearchParams('pairA=AgentA&pairB=AgentB'))
    expect(sorted).toEqual({ a: 'AgentA', b: 'AgentB' })

    const inverted = parsePair(new URLSearchParams('pairA=AgentB&pairB=AgentA'))
    expect(inverted).toEqual({ a: 'AgentA', b: 'AgentB' })
  })

  it('returns null when any label is not in validLabels set', () => {
    const valid = new Set(['AgentA', 'AgentB', 'AgentC'])
    expect(parsePair(new URLSearchParams('pairA=AgentA&pairB=AgentB'), valid)).toEqual({
      a: 'AgentA',
      b: 'AgentB',
    })
    expect(parsePair(new URLSearchParams('pairA=AgentA&pairB=Unknown'), valid)).toBeNull()
    expect(parsePair(new URLSearchParams('pairA=Unknown&pairB=AgentB'), valid)).toBeNull()
    expect(parsePair(new URLSearchParams('pairA=Unknown1&pairB=Unknown2'), valid)).toBeNull()
  })

  it('accepts non-Set iterables for validLabels', () => {
    const validList = ['AgentA', 'AgentB']
    expect(parsePair(new URLSearchParams('pairA=AgentB&pairB=AgentA'), validList)).toEqual({
      a: 'AgentA',
      b: 'AgentB',
    })
    expect(parsePair(new URLSearchParams('pairA=AgentA&pairB=AgentC'), validList)).toBeNull()
  })
})

describe('setPair', () => {
  it('writes canonical order and does not mutate input params', () => {
    const params = new URLSearchParams('existing=123')
    const updated = setPair(params, 'AgentB', 'AgentA')

    expect(updated.get('pairA')).toBe('AgentA')
    expect(updated.get('pairB')).toBe('AgentB')
    expect(updated.get('existing')).toBe('123')

    // Verify immutability
    expect(params.has('pairA')).toBe(false)
    expect(params.has('pairB')).toBe(false)
  })

  it('clears pairPage by default', () => {
    const params = new URLSearchParams('pairPage=dse/Test&other=val')
    const updated = setPair(params, 'Alpha', 'Beta')

    expect(updated.get('pairA')).toBe('Alpha')
    expect(updated.get('pairB')).toBe('Beta')
    expect(updated.has('pairPage')).toBe(false)
    expect(updated.get('other')).toBe('val')
  })

  it('preserves pairPage when keepPage is true', () => {
    const params = new URLSearchParams('pairPage=dse/Test&other=val')
    const updated = setPair(params, 'Alpha', 'Beta', { keepPage: true })

    expect(updated.get('pairA')).toBe('Alpha')
    expect(updated.get('pairB')).toBe('Beta')
    expect(updated.get('pairPage')).toBe('dse/Test')
    expect(updated.get('other')).toBe('val')
  })
})

describe('clearPair', () => {
  it('removes pairA, pairB, and pairPage while preserving unrelated params', () => {
    const params = new URLSearchParams('pairA=AgentA&pairB=AgentB&pairPage=dse/Page&agent=Root&tab=revs')
    const cleared = clearPair(params)

    expect(cleared.has('pairA')).toBe(false)
    expect(cleared.has('pairB')).toBe(false)
    expect(cleared.has('pairPage')).toBe(false)
    expect(cleared.get('agent')).toBe('Root')
    expect(cleared.get('tab')).toBe('revs')

    // Original params are intact
    expect(params.get('pairA')).toBe('AgentA')
    expect(params.get('pairPage')).toBe('dse/Page')
  })
})

describe('parsePairPage', () => {
  it('returns null when pairPage param is absent or empty', () => {
    expect(parsePairPage(new URLSearchParams(''))).toBeNull()
    expect(parsePairPage(new URLSearchParams('pairA=A&pairB=B'))).toBeNull()
    expect(parsePairPage(new URLSearchParams('pairPage='))).toBeNull()
    expect(parsePairPage(new URLSearchParams('pairPage=   '))).toBeNull()
  })

  it('returns page id when present without validPageIds', () => {
    expect(parsePairPage(new URLSearchParams('pairPage=dse/StartSeite'))).toBe('dse/StartSeite')
  })

  it('validates against validPageIds when provided', () => {
    const validPages = new Set(['dse/StartSeite', 'probier/Sandbox'])
    expect(parsePairPage(new URLSearchParams('pairPage=dse/StartSeite'), validPages)).toBe('dse/StartSeite')
    expect(parsePairPage(new URLSearchParams('pairPage=unknown/Page'), validPages)).toBeNull()
  })
})
