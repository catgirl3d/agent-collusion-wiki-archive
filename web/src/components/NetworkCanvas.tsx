import type { Core, EdgeSingular, ElementDefinition, LayoutOptions, NodeSingular } from 'cytoscape'
import { forwardRef, useEffect, useImperativeHandle, useRef, useState } from 'react'
import type { PairSelection } from '../utils/pairSelection'
import type { NetworkData } from '../utils/network'

export interface NetworkCanvasHandle {
  zoomIn: () => void
  zoomOut: () => void
  fit: () => void
  highlightNode: (nodeId: string) => void
}

interface NetworkCanvasProps {
  networkData: NetworkData
  layoutName: 'cose' | 'concentric' | 'circle'
  validatedPair: PairSelection | null
  selParam: string | null
  activeAgent: string
  onNodeSelect: (nodeId: string) => void
  onEdgeSelect: (a: string, b: string) => void
  onBackgroundTap: () => void
}

const getLayoutOptions = (name: NetworkCanvasProps['layoutName']): LayoutOptions => {
  switch (name) {
    case 'cose':
      return { name: 'cose', idealEdgeLength: (edge: EdgeSingular) => edge.data('isDirect') ? 170 : 230, nodeOverlap: 45, refresh: 20, fit: true, padding: 60, randomize: false, componentSpacing: 110, nodeRepulsion: (node: NodeSingular) => node.data('isCenter') ? 4000000 : 2500000, edgeElasticity: (edge: EdgeSingular) => edge.data('isDirect') ? 80 : 30, gravity: 4, numIter: 1600, initialTemp: 260, coolingFactor: 0.95, minTemp: 1.0 }
    case 'concentric':
      return { name: 'concentric', fit: true, padding: 60, concentric: (node: NodeSingular) => node.data('isCenter') ? 2 : 1, levelWidth: () => 1, minNodeSpacing: 65 }
    case 'circle':
      return { name: 'circle', fit: true, padding: 60 }
  }
}

const toElements = (data: NetworkData): ElementDefinition[] => [
  ...data.nodes.map((n) => ({ data: { id: n.id, label: n.label, isCenter: n.isCenter }, classes: n.isCenter ? 'center-node' : 'coagent-node' })),
  ...data.edges.map((e) => ({ data: { id: `${e.source}--${e.target}`, source: e.source, target: e.target, weight: e.weight, isDirect: e.isDirect }, classes: e.isDirect ? 'direct-edge' : 'peer-edge' })),
]

const NetworkCanvas = forwardRef<NetworkCanvasHandle, NetworkCanvasProps>(function NetworkCanvas({ networkData, layoutName, validatedPair, selParam, activeAgent, onNodeSelect, onEdgeSelect, onBackgroundTap }, ref) {
  const containerRef = useRef<HTMLDivElement>(null)
  const cyRef = useRef<Core | null>(null)
  const dataRef = useRef(networkData)
  const previousDataRef = useRef(networkData)
  const callbackRefs = useRef({ onNodeSelect, onEdgeSelect, onBackgroundTap })
  const [cyReady, setCyReady] = useState(0)

  useEffect(() => {
    dataRef.current = networkData
    callbackRefs.current = { onNodeSelect, onEdgeSelect, onBackgroundTap }
  }, [networkData, onNodeSelect, onEdgeSelect, onBackgroundTap])

  useImperativeHandle(ref, () => ({
    zoomIn: () => { const cy = cyRef.current; if (cy) cy.zoom({ level: cy.zoom() * 1.3, renderedPosition: { x: cy.width() / 2, y: cy.height() / 2 } }) },
    zoomOut: () => { const cy = cyRef.current; if (cy) cy.zoom({ level: cy.zoom() * 0.75, renderedPosition: { x: cy.width() / 2, y: cy.height() / 2 } }) },
    fit: () => cyRef.current?.fit(undefined, 60),
    highlightNode: (nodeId) => {
      const cy = cyRef.current
      if (!cy) return
      cy.elements().removeClass('highlighted dimmed')
      const node = cy.getElementById(nodeId)
      if (node && node.length > 0) {
        const neighborhood = node.neighborhood().add(node)
        neighborhood.addClass('highlighted')
        cy.elements().not(neighborhood).addClass('dimmed')
      }
    },
  }), [])

  useEffect(() => {
    if (!containerRef.current) return
    let cancelled = false
    let cy: Core | null = null
    let resizeObserver: ResizeObserver | null = null

    const mount = async () => {
      const { default: cytoscape } = await import('cytoscape')
      if (cancelled || !containerRef.current) return
      cy = cytoscape({
        container: containerRef.current,
        elements: [],
        style: [
          { selector: 'node', style: { shape: 'round-rectangle', 'background-color': '#0f172a', 'border-width': 2, 'border-color': '#334155', label: 'data(label)', color: '#cbd5e1', 'font-family': 'ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace', 'font-size': '12px', 'font-weight': 600, 'text-valign': 'center', 'text-halign': 'center', padding: '10px 16px', width: 'label', height: 34, 'text-wrap': 'wrap', 'text-max-width': '140px', 'transition-property': 'background-color, border-color, color', 'transition-duration': 150 } },
          { selector: 'node.center-node', style: { 'background-color': 'rgba(56, 189, 248, 0.25)', 'border-width': 2.5, 'border-color': '#38bdf8', color: '#ffffff', 'font-weight': 'bold', 'font-size': '13.5px', height: 42, padding: '12px 20px', 'text-max-width': '160px' } },
          { selector: 'node:selected, node.highlighted', style: { 'border-color': '#38bdf8', 'background-color': 'rgba(56, 189, 248, 0.35)', color: '#f8fafc' } },
          { selector: 'edge', style: { 'curve-style': 'bezier', 'line-color': 'rgba(56, 189, 248, 0.6)', width: 'mapData(weight, 1, 12, 2, 5.5)', label: 'data(weight)', 'font-size': '11px', 'font-weight': 600, 'font-family': 'ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace', color: '#7dd3fc', 'text-background-color': '#0b0f19', 'text-background-opacity': 0.9, 'text-background-padding': '3px', 'text-background-shape': 'roundrectangle', 'text-rotation': 'autorotate' } },
          { selector: 'edge.peer-edge', style: { 'line-color': 'rgba(168, 85, 247, 0.65)', 'line-style': 'dashed', width: 'mapData(weight, 1, 12, 1.5, 4)', color: '#d8b4fe' } },
          { selector: 'node.dimmed, edge.dimmed', style: { opacity: 0.15 } },
          { selector: 'edge.selected-pair', style: { 'line-color': '#fb7185', width: 5, opacity: 1, 'z-index': 999 } },
        ],
        userZoomingEnabled: true, userPanningEnabled: true, boxSelectionEnabled: false,
      })
      cy.on('tap', 'node', (event) => callbackRefs.current.onNodeSelect(event.target.id()))
      cy.on('tap', 'edge', (event) => callbackRefs.current.onEdgeSelect(event.target.source().id(), event.target.target().id()))
      cy.on('tap', (event) => { if (event.target === cy) callbackRefs.current.onBackgroundTap() })
      resizeObserver = new ResizeObserver(() => cy?.resize())
      resizeObserver.observe(containerRef.current)
      cyRef.current = cy
      if (dataRef.current.nodes.length) cy.batch(() => cy?.add(toElements(dataRef.current)))
      setCyReady((value) => value + 1)
    }
    void mount()
    return () => { cancelled = true; resizeObserver?.disconnect(); cy?.destroy(); cyRef.current = null; setCyReady(0) }
  }, [])

  useEffect(() => {
    const cy = cyRef.current
    if (!cy) return
    const dataChanged = previousDataRef.current !== networkData
    previousDataRef.current = networkData
    if (dataChanged) {
      cy.batch(() => {
        cy.elements().remove()
        if (networkData.nodes.length) cy.add(toElements(networkData))
      })
    }
    if (networkData.nodes.length) cy.layout(getLayoutOptions(layoutName)).run()
  }, [networkData, layoutName, cyReady])

  useEffect(() => {
    const cy = cyRef.current
    if (!cy || cy.elements().empty()) return
    cy.edges().removeClass('selected-pair')
    if (validatedPair) cy.edges().filter((edge) => (edge.source().id() === validatedPair.a && edge.target().id() === validatedPair.b) || (edge.source().id() === validatedPair.b && edge.target().id() === validatedPair.a)).addClass('selected-pair')
  }, [validatedPair, networkData, cyReady])

  useEffect(() => {
    const cy = cyRef.current
    if (!cy || cy.elements().empty()) return
    cy.elements().removeClass('highlighted dimmed')
    if (selParam) {
      const node = cy.getElementById(selParam)
      if (node && node.length > 0) {
        const neighborhood = node.neighborhood().add(node)
        neighborhood.addClass('highlighted')
        cy.elements().not(neighborhood).addClass('dimmed')
      }
    }
  }, [selParam, networkData, cyReady])

  return <div ref={containerRef} className="network-cytoscape-canvas" role="img" aria-label={`Shared-page graph for ${activeAgent}: ${networkData.nodes.length} agents, ${networkData.edges.length} links`} />
})

export default NetworkCanvas
