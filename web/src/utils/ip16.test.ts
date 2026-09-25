import { describe, expect, it } from 'vitest'
import type { LabelsIp16Index } from '../types'
import { matchIp16Prefixes, summarizeIp16Slice } from './ip16'

const index: LabelsIp16Index = {
  meta: { schema_version: 1, prefixes: 3 },
  prefixes: {
    '20.165': {
      r: 4,
      l: [['AgentRelent', 3], ['LinkHelper', 1]],
      w: ['dse', 'fractal'],
      f: '2026-05-24T11:53:57Z',
      t: '2026-07-02T17:24:40Z',
    },
    '20.97': {
      r: 2,
      l: [['AgentRelent', 2]],
      w: ['probier'],
      f: '2026-06-01T00:00:00Z',
      t: '2026-06-01T00:00:00Z',
    },
    '2.202': {
      r: 1,
      l: [['[Admin1]', 1]],
      w: ['dse'],
      f: '2026-07-14T13:56:54Z',
      t: '2026-07-14T13:56:54Z',
    },
  },
}

describe('matchIp16Prefixes', () => {
  it('matches prefixes by substring and returns them sorted', () => {
    expect(matchIp16Prefixes(index, '20')).toEqual(['2.202', '20.165', '20.97'])
    expect(matchIp16Prefixes(index, ' .165 ')).toEqual(['20.165'])
    expect(matchIp16Prefixes(index, '   ')).toEqual([])
    expect(matchIp16Prefixes(index, '20.165')).toEqual(['20.165'])
    expect(matchIp16Prefixes(index, '2')).toEqual(['2.202', '20.165', '20.97'])
    expect(matchIp16Prefixes(index, '')).toEqual([])
    expect(matchIp16Prefixes(null, '20')).toEqual([])
  })
})

describe('summarizeIp16Slice', () => {
  it('unions labels and sums weights across the matched prefixes', () => {
    const summary = summarizeIp16Slice(index, ['20.165', '20.97'])

    expect(summary.prefixes).toEqual(['20.165', '20.97'])
    expect(summary.labels).toBe(2)
    expect(summary.revisions).toBe(6)
    expect(summary.wikis).toEqual(['dse', 'fractal', 'probier'])
    expect(summary.first).toBe('2026-05-24T11:53:57Z')
    expect(summary.last).toBe('2026-07-02T17:24:40Z')
    expect(summary.labelWeights).toEqual([
      { x: 'AgentRelent', n: 5 },
      { x: 'LinkHelper', n: 1 },
    ])
  })

  it('orders equal weights by label name', () => {
    const tied: LabelsIp16Index = {
      meta: { schema_version: 1, prefixes: 1 },
      prefixes: {
        '10.1': { r: 2, l: [['zeta', 1], ['alpha', 1]], w: ['dse'], f: '2026-05-11T00:00:00Z', t: '2026-05-11T00:00:00Z' },
      },
    }

    expect(summarizeIp16Slice(tied, ['10.1']).labelWeights).toEqual([
      { x: 'alpha', n: 1 },
      { x: 'zeta', n: 1 },
    ])
  })

  it('returns an empty slice when no prefix matches', () => {
    expect(summarizeIp16Slice(index, [])).toEqual({
      prefixes: [],
      labels: 0,
      revisions: 0,
      wikis: [],
      first: null,
      last: null,
      labelWeights: [],
    })
  })
})
