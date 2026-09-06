import type { AgentLinks } from '../types'

export interface NetworkNode {
  id: string
  label: string
  isCenter: boolean
  wikis: string[]
  revs: number
  pagesCount: number
}

export interface NetworkEdge {
  source: string
  target: string
  weight: number
  isDirect: boolean
}

export interface NetworkData {
  nodes: NetworkNode[]
  edges: NetworkEdge[]
}

export function buildNetwork(
  links: AgentLinks,
  activeAgent: string,
  opts: { minShared: number; depth: 'cluster' | 'ego' },
): NetworkData {
  if (!activeAgent || !links[activeAgent]) return { nodes: [], edges: [] }

  const rootCoAgents = links[activeAgent].filter((a) => a.c >= opts.minShared)
  const nodeIds = new Set<string>([activeAgent, ...rootCoAgents.map((a) => a.o)])
  const edges: NetworkEdge[] = []
  const seenEdges = new Set<string>()

  for (const ca of rootCoAgents) {
    seenEdges.add(`${activeAgent}->${ca.o}`)
    edges.push({ source: activeAgent, target: ca.o, weight: Math.min(ca.c, 12), isDirect: true })
  }

  if (opts.depth === 'cluster') {
    for (const ca of rootCoAgents) {
      const peerLinks = (links[ca.o] || []).filter(
        (p) => p.c >= opts.minShared && nodeIds.has(p.o) && p.o !== ca.o && p.o !== activeAgent,
      )
      for (const pl of peerLinks) {
        const key = ca.o < pl.o ? `${ca.o}---${pl.o}` : `${pl.o}---${ca.o}`
        if (!seenEdges.has(key)) {
          seenEdges.add(key)
          // Link counts are asymmetric (top-20 cap in data build); use the iterated side's weight.
          edges.push({
            source: ca.o < pl.o ? ca.o : pl.o,
            target: ca.o < pl.o ? pl.o : ca.o,
            weight: Math.min(pl.c, 12),
            isDirect: false,
          })
        }
      }
    }
  }

  const nodes = Array.from(nodeIds).map((id) => ({
    id,
    label: id,
    isCenter: id === activeAgent,
    wikis: [],
    revs: 0,
    pagesCount: 0,
  }))

  return { nodes, edges }
}
