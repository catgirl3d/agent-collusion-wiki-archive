import { describe, expect, it } from 'vitest'
import type { AgentLinks } from '../types'
import { buildNetwork } from './network'

const options = { minShared: 2, depth: 'cluster' as const }

describe('buildNetwork', () => {
  it('does not duplicate root-to-coagent edges when backlinks exist', () => {
    const links: AgentLinks = { root: [{ o: 'alpha', c: 4 }], alpha: [{ o: 'root', c: 3 }] }
    const graph = buildNetwork(links, 'root', options)
    expect(graph.edges).toEqual([{ source: 'root', target: 'alpha', weight: 4, isDirect: true }])
  })

  it('filters direct and peer links below minShared', () => {
    const links: AgentLinks = {
      root: [{ o: 'alpha', c: 2 }, { o: 'beta', c: 1 }],
      alpha: [{ o: 'beta', c: 1 }],
    }
    expect(buildNetwork(links, 'root', options).edges).toEqual([
      { source: 'root', target: 'alpha', weight: 2, isDirect: true },
    ])
  })

  it('has no peer edges in ego mode', () => {
    const links: AgentLinks = { root: [{ o: 'alpha', c: 3 }, { o: 'beta', c: 3 }], alpha: [{ o: 'beta', c: 3 }] }
    expect(buildNetwork(links, 'root', { ...options, depth: 'ego' }).edges).toHaveLength(2)
  })

  it('includes peer edges in cluster mode', () => {
    const links: AgentLinks = { root: [{ o: 'alpha', c: 3 }, { o: 'beta', c: 3 }], alpha: [{ o: 'beta', c: 5 }] }
    expect(buildNetwork(links, 'root', options).edges).toContainEqual({
      source: 'alpha', target: 'beta', weight: 5, isDirect: false,
    })
  })

  it('returns an empty graph for an unknown or empty root', () => {
    const links: AgentLinks = { root: [{ o: 'alpha', c: 3 }] }
    expect(buildNetwork(links, 'missing', options)).toEqual({ nodes: [], edges: [] })
    expect(buildNetwork(links, '', options)).toEqual({ nodes: [], edges: [] })
  })

  it('deduplicates asymmetric peer counts and uses the iterated side', () => {
    const links: AgentLinks = {
      root: [{ o: 'alpha', c: 3 }, { o: 'beta', c: 3 }],
      alpha: [{ o: 'beta', c: 4 }],
      beta: [{ o: 'alpha', c: 7 }],
    }
    const peerEdges = buildNetwork(links, 'root', options).edges.filter((edge) => !edge.isDirect)
    expect(peerEdges).toEqual([{ source: 'alpha', target: 'beta', weight: 4, isDirect: false }])
  })
})
