import type { Core, EdgeSingular, ElementDefinition, LayoutOptions, NodeSingular } from 'cytoscape'
import { useEffect, useMemo, useRef, useState } from 'react'
import { Link, useNavigate, useSearchParams } from 'react-router-dom'
import { loadJson, revisionFile } from '../api'
import { PairEvidencePanel } from '../components/PairEvidencePanel'
import { Badge, Chip } from '../components/ui'
import { useData } from '../components/useQuery'
import type { AgentLinks, LabelsIndex, PagesIndex, Revision } from '../types'
import { fmtInt, wikiColor } from '../utils/format'
import { buildNetwork, type NetworkData } from '../utils/network'
import { buildPairTimeline, getSharedPages, type PairTimeline } from '../utils/pairEvidence'
import { clearPair, parsePair, parsePairPage, setPair } from '../utils/pairSelection'

const getLayoutOptions = (name: 'cose' | 'concentric' | 'circle'): LayoutOptions => {
  switch (name) {
    case 'cose':
      return {
        name: 'cose',
        idealEdgeLength: (edge: EdgeSingular) => (edge.data('isDirect') ? 170 : 230),
        nodeOverlap: 45,
        refresh: 20,
        fit: true,
        padding: 60,
        randomize: false,
        componentSpacing: 110,
        nodeRepulsion: (node: NodeSingular) => (node.data('isCenter') ? 4000000 : 2500000),
        edgeElasticity: (edge: EdgeSingular) => (edge.data('isDirect') ? 80 : 30),
        gravity: 4,
        numIter: 1600,
        initialTemp: 260,
        coolingFactor: 0.95,
        minTemp: 1.0,
      }
    case 'concentric':
      return {
        name: 'concentric',
        fit: true,
        padding: 60,
        concentric: (node: NodeSingular) => (node.data('isCenter') ? 2 : 1),
        levelWidth: () => 1,
        minNodeSpacing: 65,
      }
    case 'circle':
      return {
        name: 'circle',
        fit: true,
        padding: 60,
      }
  }
}

const toElements = (data: NetworkData): ElementDefinition[] => [
  ...data.nodes.map((n) => ({
    data: { id: n.id, label: n.label, isCenter: n.isCenter },
    classes: n.isCenter ? 'center-node' : 'coagent-node',
  })),
  ...data.edges.map((e) => ({
    data: {
      id: `${e.source}--${e.target}`,
      source: e.source,
      target: e.target,
      weight: e.weight,
      isDirect: e.isDirect,
    },
    classes: e.isDirect ? 'direct-edge' : 'peer-edge',
  })),
]

export default function Network() {
  const [searchParams, setSearchParams] = useSearchParams()
  const navigate = useNavigate()
  const { data: links, loading: loadingLinks, error: errorLinks } = useData<AgentLinks>('agent_links.json')
  const { data: labelsIndex, loading: loadingLabels } = useData<LabelsIndex>('labels.json')
  const { data: pagesIndex, loading: loadingPages } = useData<PagesIndex>('pages.json')
  const containerRef = useRef<HTMLDivElement>(null)
  const cyRef = useRef<Core | null>(null)
  const searchWrapRef = useRef<HTMLDivElement>(null)

  const [searchInput, setSearchInput] = useState('')
  const [isOpen, setIsOpen] = useState(false)
  const [activeIndex, setActiveIndex] = useState(-1)

  const agentParam = searchParams.get('agent')
  const selParam = searchParams.get('sel')
  const minParam = searchParams.get('min')
  const scopeParam = searchParams.get('scope')
  const layoutParam = searchParams.get('layout')

  const minShared = (minParam && ['2', '3', '5', '10'].includes(minParam)) ? Number(minParam) : 2
  const depth = (scopeParam === 'ego' ? 'ego' : 'cluster') as 'cluster' | 'ego'
  const layoutName = (layoutParam === 'concentric' || layoutParam === 'circle' ? layoutParam : 'cose') as 'cose' | 'concentric' | 'circle'

  // Available agent names for search suggestions
  const allAgents = useMemo(() => {
    if (!links) return []
    return Object.keys(links).sort()
  }, [links])

  // Labels map for quick metadata lookup
  const labelsMap = useMemo(() => {
    if (!labelsIndex) return new Map<string, LabelsIndex['l'][number]>()
    return new Map<string, LabelsIndex['l'][number]>(labelsIndex.l.map((lab) => [lab.x, lab]))
  }, [labelsIndex])

  // Top agents by collaborator count — preset focal points derived from data
  const presets = useMemo(() => {
    if (!links) return []
    return Object.keys(links)
      .sort((a, b) => links[b].length - links[a].length)
      .slice(0, 5)
  }, [links])

  // Pick active root agent (from URL, or top preset). Unknown ?agent= stays unresolved.
  const activeAgent = useMemo(() => {
    if (!links) return ''
    if (agentParam) return links[agentParam] ? agentParam : ''
    return presets[0] ?? ''
  }, [agentParam, links, presets])

  const setFocalAgent = (name: string) => {
    let next = new URLSearchParams(searchParams)
    next.set('agent', name)
    next.delete('sel')
    next = clearPair(next)
    setSearchParams(next)
  }

  // Filtered autocomplete suggestions
  const suggestions = useMemo(() => {
    const q = searchInput.trim().toLowerCase()
    if (!q || q.length < 2) return []
    return allAgents.filter((a) => a.toLowerCase().includes(q)).slice(0, 8)
  }, [allAgents, searchInput])

  // Build subnetwork nodes and edges
  const networkData = useMemo(() => {
    const data = buildNetwork(links ?? {}, activeAgent, { minShared, depth })
    const nodes = data.nodes.map((node) => {
      const lab = labelsMap.get(node.id)
      return {
        ...node,
        wikis: lab?.w || [],
        revs: lab?.r || 0,
        pagesCount: lab?.p || 0,
      }
    })
    return { nodes, edges: data.edges }
  }, [links, activeAgent, minShared, depth, labelsMap])

  const rawPair = useMemo(() => parsePair(searchParams), [searchParams])

  const validatedPair = useMemo(() => {
    if (!rawPair) return null
    // Any rendered edge (direct or peer) may open the pair inspector; validation is edge
    // existence in the CURRENT network, not endpoint membership of the focal agent.
    const edgeExists = networkData.edges.some(
      (e) =>
        (e.source === rawPair.a && e.target === rawPair.b) ||
        (e.source === rawPair.b && e.target === rawPair.a),
    )
    if (!edgeExists) return null
    return rawPair
  }, [rawPair, networkData.edges])

  const sharedPages = useMemo(() => {
    if (!validatedPair) return []
    return getSharedPages(validatedPair.a, validatedPair.b, labelsIndex, pagesIndex)
  }, [validatedPair, labelsIndex, pagesIndex])

  const selectedPageId = useMemo(() => {
    if (!validatedPair || sharedPages.length === 0) return null
    return parsePairPage(searchParams, sharedPages.map((s) => s.id))
  }, [searchParams, validatedPair, sharedPages])

  const selectedPageRecord = useMemo(() => {
    if (!pagesIndex || !selectedPageId) return null
    return pagesIndex.p.find((p) => p.id === selectedPageId) ?? null
  }, [pagesIndex, selectedPageId])

  // Request key binds the state to the exact (pair, page, slug) query — a newer selection never
  // renders an older response, even during the render pass before the fetch effect runs.
  const requestKey = validatedPair && selectedPageId
    ? `${validatedPair.a}|${validatedPair.b}|${selectedPageId}|${selectedPageRecord?.s ?? ''}`
    : null

  const [pageState, setPageState] = useState<{
    key: string | null
    status: 'idle' | 'loading' | 'ready' | 'error'
    timeline: PairTimeline | null
  }>({ key: null, status: 'idle', timeline: null })


  useEffect(() => {
    if (!validatedPair || !selectedPageId) {
      setPageState({ key: null, status: 'idle', timeline: null })
      return
    }

    // No canonical page record/slug -> do NOT guess a revision filename; surface a local error
    // while the shared-page list stays visible.
    const slug = selectedPageRecord?.s
    if (!slug) {
      // Keep the key consistent with requestKey so the render gate surfaces this local error.
      const key = `${validatedPair!.a}|${validatedPair!.b}|${selectedPageId}|`
      setPageState({ key, status: 'error', timeline: null })
      return
    }

    const key = `${validatedPair.a}|${validatedPair.b}|${selectedPageId}|${slug}`
    setPageState({ key, status: 'loading', timeline: null })

    let alive = true
    loadJson<Revision[]>(revisionFile(selectedPageId, slug))
      .then((revs) => {
        if (!alive) return
        setPageState({
          key,
          status: 'ready',
          timeline: buildPairTimeline(revs, validatedPair.a, validatedPair.b),
        })
      })
      .catch(() => {
        if (!alive) return
        setPageState({ key, status: 'error', timeline: null })
      })

    return () => {
      alive = false
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps -- requestKey is derived from exactly these inputs
  }, [validatedPair, selectedPageId, selectedPageRecord?.s])

  const [cyReady, setCyReady] = useState(0)

  // Refs to avoid stale closures in Cytoscape event handlers (updated post-commit)
  const searchParamsRef = useRef(searchParams)
  const activeAgentRef = useRef(activeAgent)
  const setSearchParamsRef = useRef(setSearchParams)
  const networkDataRef = useRef(networkData)
  const layoutNameRef = useRef(layoutName)
  useEffect(() => {
    searchParamsRef.current = searchParams
    activeAgentRef.current = activeAgent
    setSearchParamsRef.current = setSearchParams
    networkDataRef.current = networkData
    layoutNameRef.current = layoutName
  }, [searchParams, activeAgent, setSearchParams, networkData, layoutName])

  // Remount the canvas only when the container itself mounts/unmounts:
  // data loaded AND the active agent resolves (otherwise an early-return page hides the div).
  const cyMountKey = Boolean(links && (!agentParam || links[agentParam]))

  // Initialize Cytoscape instance once
  useEffect(() => {
    if (!containerRef.current) return

    let cancelled = false
    let cy: Core | null = null
    let resizeObserver: ResizeObserver | null = null

    const mount = async () => {
      const { default: cytoscape } = await import('cytoscape')
      if (cancelled || !containerRef.current) return

      const instance = cy = cytoscape({
      container: containerRef.current,
      elements: [],
      style: [
        {
          selector: 'node',
          style: {
            'shape': 'round-rectangle',
            'background-color': '#0f172a',
            'border-width': 2,
            'border-color': '#334155',
            'label': 'data(label)',
            'color': '#cbd5e1',
            'font-family': 'ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace',
            'font-size': '12px',
            'font-weight': 600,
            'text-valign': 'center',
            'text-halign': 'center',
            'padding': '10px 16px',
            'width': 'label',
            'height': 34,
            'text-wrap': 'wrap',
            'text-max-width': '140px',
            'transition-property': 'background-color, border-color, color',
            'transition-duration': 150,
          },
        },
        {
          selector: 'node.center-node',
          style: {
            'background-color': 'rgba(56, 189, 248, 0.25)',
            'border-width': 2.5,
            'border-color': '#38bdf8',
            'color': '#ffffff',
            'font-weight': 'bold',
            'font-size': '13.5px',
            'height': 42,
            'padding': '12px 20px',
            'text-max-width': '160px',
          },
        },
        {
          selector: 'node:selected, node.highlighted',
          style: {
            'border-color': '#38bdf8',
            'background-color': 'rgba(56, 189, 248, 0.35)',
            'color': '#f8fafc',
          },
        },
        {
          selector: 'edge',
          style: {
            'curve-style': 'bezier',
            'line-color': 'rgba(56, 189, 248, 0.6)',
            'width': 'mapData(weight, 1, 12, 2, 5.5)',
            'label': 'data(weight)',
            'font-size': '11px',
            'font-weight': 600,
            'font-family': 'ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace',
            'color': '#7dd3fc',
            'text-background-color': '#0b0f19',
            'text-background-opacity': 0.9,
            'text-background-padding': '3px',
            'text-background-shape': 'roundrectangle',
            'text-rotation': 'autorotate',
          },
        },
        {
          selector: 'edge.peer-edge',
          style: {
            'line-color': 'rgba(168, 85, 247, 0.65)',
            'line-style': 'dashed',
            'width': 'mapData(weight, 1, 12, 1.5, 4)',
            'color': '#d8b4fe',
          },
        },
        {
          selector: 'node.dimmed, edge.dimmed',
          style: {
            'opacity': 0.15,
          },
        },
        {
          selector: 'edge.selected-pair',
          style: {
            'line-color': '#fb7185',
            'width': 5,
            'opacity': 1,
            'z-index': 999,
          },
        },
      ],
      userZoomingEnabled: true,
      userPanningEnabled: true,
      boxSelectionEnabled: false,
    })

    instance.on('tap', 'node', (evt) => {
      const node = evt.target
      const nodeId = node.id()
      // Selecting a node switches the inspector back to the agent dossier: clear the stale pair.
      let next = new URLSearchParams(searchParamsRef.current)
      if (nodeId === activeAgentRef.current) {
        next.delete('sel')
      } else {
        next.set('sel', nodeId)
      }
      next = clearPair(next)
      setSearchParamsRef.current(next, { replace: true })
    })

    instance.on('tap', 'edge', (evt) => {
      const edge = evt.target
      const a = edge.source().id()
      const b = edge.target().id()
      const next = setPair(new URLSearchParams(searchParamsRef.current), a, b)
      // Persist the graph root so a copied link restores the same rendered network
      // instead of falling back to the default focal agent.
      if (activeAgentRef.current) next.set('agent', activeAgentRef.current)
      setSearchParamsRef.current(next, { replace: true })
    })

    instance.on('tap', (evt) => {
      if (evt.target === instance) {
        let next = new URLSearchParams(searchParamsRef.current)
        if (next.has('sel')) {
          next.delete('sel')
        }
        next = clearPair(next)
        if (next.toString() !== searchParamsRef.current.toString()) {
          setSearchParamsRef.current(next, { replace: true })
        }
      }
    })

    resizeObserver = new ResizeObserver(() => {
      cy?.resize()
    })
    resizeObserver.observe(containerRef.current)

    cyRef.current = instance
    if (networkDataRef.current.nodes.length) {
      instance.batch(() => instance.add(toElements(networkDataRef.current)))
      instance.layout(getLayoutOptions(layoutNameRef.current)).run()
    }
    setCyReady((c) => c + 1)
    }
    void mount()

    return () => {
      cancelled = true
      resizeObserver?.disconnect()
      cy?.destroy()
      cyRef.current = null
      setCyReady(0)
    }
  }, [cyMountKey])
  // Replace elements when data changes; rerun layout on data or layout changes.
  const prevDataRef = useRef(networkData)
  useEffect(() => {
    const cy = cyRef.current
    if (!cy || !networkData.nodes.length) return

    const dataChanged = prevDataRef.current !== networkData
    prevDataRef.current = networkData

    if (dataChanged) {
      cy.batch(() => {
        cy.elements().remove()
        cy.add(toElements(networkData))
      })
    }

    cy.layout(getLayoutOptions(layoutName)).run()
  }, [networkData, layoutName])

  // Sync selected-pair edge styling
  useEffect(() => {
    const cy = cyRef.current
    if (!cy || cy.elements().empty()) return

    cy.edges().removeClass('selected-pair')
    if (validatedPair) {
      const { a, b } = validatedPair
      const matched = cy.edges().filter(
        (e) =>
          (e.source().id() === a && e.target().id() === b) ||
          (e.source().id() === b && e.target().id() === a),
      )
      matched.addClass('selected-pair')
    }
  }, [validatedPair, networkData, cyReady])

  // Sync node highlighting with selParam
  useEffect(() => {
    const cy = cyRef.current
    if (!cy || cy.elements().empty()) return

    cy.elements().removeClass('highlighted dimmed')
    if (selParam) {
      const node = cy.getElementById(selParam)
      if (node && node.length > 0) {
        const nh = node.neighborhood().add(node)
        nh.addClass('highlighted')
        cy.elements().not(nh).addClass('dimmed')
      }
    }
  }, [selParam, networkData, cyReady])

  // Close search suggestions on outside pointerdown
  useEffect(() => {
    const handlePointerDown = (e: MouseEvent) => {
      if (searchWrapRef.current && !searchWrapRef.current.contains(e.target as Node)) {
        setIsOpen(false)
        setActiveIndex(-1)
      }
    }
    document.addEventListener('pointerdown', handlePointerDown)
    return () => document.removeEventListener('pointerdown', handlePointerDown)
  }, [])

  const handleSearchKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (suggestions.length === 0) return

    if (e.key === 'ArrowDown') {
      e.preventDefault()
      setIsOpen(true)
      setActiveIndex((prev) => (prev + 1 < suggestions.length ? prev + 1 : 0))
    } else if (e.key === 'ArrowUp') {
      e.preventDefault()
      setIsOpen(true)
      setActiveIndex((prev) => (prev - 1 >= 0 ? prev - 1 : suggestions.length - 1))
    } else if (e.key === 'Enter') {
      e.preventDefault()
      const target = activeIndex >= 0 && suggestions[activeIndex] ? suggestions[activeIndex] : suggestions[0]
      if (target) {
        setFocalAgent(target)
        setSearchInput('')
        setIsOpen(false)
        setActiveIndex(-1)
      }
    } else if (e.key === 'Escape') {
      e.preventDefault()
      setIsOpen(false)
      setActiveIndex(-1)
    }
  }

  if (errorLinks) return <div className="error">Error loading network data: {errorLinks}</div>
  if (loadingLinks || loadingLabels || loadingPages || !links) return <div className="loading">Loading network explorer…</div>

  if (agentParam && !links[agentParam]) {
    return (
      <div className="page network-page">
        <div className="error">
          Agent "{agentParam}" not found in the network index.
          {presets.length > 0 && (
            <div style={{ marginTop: 12 }}>
              <button type="button" className="btn primary sm" onClick={() => setFocalAgent(presets[0])}>
                Show top syndicate
              </button>
            </div>
          )}
        </div>
      </div>
    )
  }

  const inspectedAgent = (selParam && links[selParam]) ? selParam : activeAgent
  const inspectedMeta = labelsMap.get(inspectedAgent)
  const inspectedLinks = (links[inspectedAgent] || []).filter((a) => a.c >= minShared)

  return (
    <div className="page network-page">
      <header className="network-header">
        <div>
          <h1>Syndicate Network Explorer</h1>
          <p className="muted">Interactive collusion graph across {fmtInt(allAgents.length)} agent labels.</p>
        </div>
        <div className="network-preset-chips">
          <span className="muted text-xs uppercase tracking-wider">Top syndicates:</span>
          {presets.map((agent) => (
            <button
              key={agent}
              type="button"
              className={`preset-chip mono ${activeAgent === agent ? 'active' : ''}`}
              onClick={() => setFocalAgent(agent)}
            >
              {agent.length > 18 ? `${agent.slice(0, 16)}…` : agent}
            </button>
          ))}
        </div>
      </header>

      <div className="network-controls-bar">
        {/* Search Input with Suggestions */}
        <div
          ref={searchWrapRef}
          className="network-search-wrap"
          role="combobox"
          aria-haspopup="listbox"
          aria-expanded={isOpen && suggestions.length > 0}
          aria-owns="network-search-suggestions"
        >
          <input
            className="input"
            placeholder="Search any agent label…"
            aria-label="Search agent label"
            aria-autocomplete="list"
            aria-controls="network-search-suggestions"
            aria-activedescendant={
              isOpen && activeIndex >= 0 && suggestions[activeIndex]
                ? `suggestion-option-${activeIndex}`
                : undefined
            }
            value={searchInput}
            onChange={(e) => {
              setSearchInput(e.target.value)
              setIsOpen(true)
              setActiveIndex(-1)
            }}
            onFocus={() => {
              if (suggestions.length > 0) setIsOpen(true)
            }}
            onBlur={() => {
              setTimeout(() => {
                setIsOpen(false)
                setActiveIndex(-1)
              }, 150)
            }}
            onKeyDown={handleSearchKeyDown}
          />
          {isOpen && suggestions.length > 0 && (
            <div
              id="network-search-suggestions"
              className="network-suggestions-popover"
              role="listbox"
              aria-label="Agent search suggestions"
            >
              {suggestions.map((sug, idx) => (
                <button
                  key={sug}
                  id={`suggestion-option-${idx}`}
                  type="button"
                  role="option"
                  aria-selected={activeIndex === idx}
                  className={`suggestion-item mono ${activeIndex === idx ? 'active' : ''}`}
                  onClick={() => {
                    setFocalAgent(sug)
                    setSearchInput('')
                    setIsOpen(false)
                    setActiveIndex(-1)
                  }}
                >
                  {sug}
                </button>
              ))}
            </div>
          )}
        </div>

        {/* Min Shared Edits Filter */}
        <div className="control-group">
          <label htmlFor="min-shared-select" className="control-label">Min shared:</label>
          <select
            id="min-shared-select"
            className="input sm"
            value={minShared}
            onChange={(e) => {
              const next = new URLSearchParams(searchParams)
              const val = Number(e.target.value)
              if (val === 2) {
                next.delete('min')
              } else {
                next.set('min', String(val))
              }
              setSearchParams(next, { replace: true })
            }}
          >
            <option value={2}>≥ 2 pages</option>
            <option value={3}>≥ 3 pages</option>
            <option value={5}>≥ 5 pages</option>
            <option value={10}>≥ 10 pages</option>
          </select>
        </div>

        {/* Depth / Cluster Scope */}
        <div className="control-group">
          <label htmlFor="depth-select" className="control-label">Scope:</label>
          <select
            id="depth-select"
            className="input sm"
            value={depth}
            onChange={(e) => {
              const next = new URLSearchParams(searchParams)
              const val = e.target.value
              if (val === 'cluster') {
                next.delete('scope')
              } else {
                next.set('scope', val)
              }
              setSearchParams(next, { replace: true })
            }}
          >
            <option value="cluster">Cluster (with peer links)</option>
            <option value="ego">Ego network (1-hop)</option>
          </select>
        </div>

        {/* Layout Switch */}
        <div className="control-group">
          <label htmlFor="layout-select" className="control-label">Layout:</label>
          <select
            id="layout-select"
            className="input sm"
            value={layoutName}
            onChange={(e) => {
              const next = new URLSearchParams(searchParams)
              const val = e.target.value
              if (val === 'cose') {
                next.delete('layout')
              } else {
                next.set('layout', val)
              }
              setSearchParams(next, { replace: true })
            }}
          >
            <option value="cose">Physics (Springs)</option>
            <option value="concentric">Concentric (Radial)</option>
            <option value="circle">Circular</option>
          </select>
        </div>

        {/* View Controls */}
        <div className="network-btn-group">
          <button
            type="button"
            className="btn ghost sm"
            onClick={() => {
              const cy = cyRef.current
              if (cy) {
                cy.zoom({
                  level: cy.zoom() * 1.3,
                  renderedPosition: { x: cy.width() / 2, y: cy.height() / 2 },
                })
              }
            }}
            title="Zoom In"
          >
            +
          </button>
          <button
            type="button"
            className="btn ghost sm"
            onClick={() => {
              const cy = cyRef.current
              if (cy) {
                cy.zoom({
                  level: cy.zoom() * 0.75,
                  renderedPosition: { x: cy.width() / 2, y: cy.height() / 2 },
                })
              }
            }}
            title="Zoom Out"
          >
            −
          </button>
          <button
            type="button"
            className="btn ghost sm"
            onClick={() => cyRef.current?.fit(undefined, 60)}
            title="Fit to view"
          >
            Fit
          </button>
        </div>
      </div>

      <div className="network-workspace">
        {/* Main Cytoscape Canvas */}
        <div className="network-canvas-container">
          <div
            ref={containerRef}
            className="network-cytoscape-canvas"
            role="img"
            aria-label={`Collusion graph for ${activeAgent}: ${networkData.nodes.length} agents, ${networkData.edges.length} links`}
          />

          <div className="network-canvas-legend">
            <div className="legend-line-row">
              <span className="legend-sample direct" /> Direct link to {activeAgent.slice(0, 14)}
            </div>
            {depth === 'cluster' && (
              <div className="legend-line-row">
                <span className="legend-sample peer" /> Peer collusion link
              </div>
            )}
          </div>
        </div>

        {/* Inspector Sidebar */}
        <aside className="network-inspector-sidebar">
          {validatedPair ? (
            <PairEvidencePanel
              leftLabel={validatedPair.a}
              rightLabel={validatedPair.b}
              sharedPages={sharedPages}
              selectedPageId={selectedPageId}
              timeline={
                !selectedPageId || pageState.key !== requestKey
                  ? null
                  : pageState.status === 'loading'
                    ? 'loading'
                    : pageState.status === 'error'
                      ? 'error'
                      : pageState.timeline
              }
              onClose={() => {
                setSearchParams(clearPair(searchParams))
              }}
              onOpenPageInPageDetail={(pageId) => {
                navigate(
                  `/page/${encodeURIComponent(pageId)}?${setPair(new URLSearchParams(searchParams), validatedPair.a, validatedPair.b, { keepPage: true }).toString()}`
                )
              }}
              onSelectPage={(pageId) => {
                const next = new URLSearchParams(searchParams)
                next.set('pairPage', pageId)
                setSearchParams(next, { replace: true })
              }}
              sourceMode="network"
            />
          ) : (
            <>
              <header className="inspector-head">
                <span className="muted uppercase tracking-wider text-xs">Agent Dossier</span>
                {inspectedAgent === activeAgent && <Badge color="#38bdf8">network root</Badge>}
              </header>

              <h3 className="mono inspected-agent-title">{inspectedAgent}</h3>

              {inspectedMeta && (
                <div className="inspected-metrics-grid">
                  <div className="metric-box">
                    <span className="val">{fmtInt(inspectedMeta.r)}</span>
                    <span className="lbl">Revisions</span>
                  </div>
                  <div className="metric-box">
                    <span className="val">{fmtInt(inspectedMeta.p)}</span>
                    <span className="lbl">Pages</span>
                  </div>
                  <div className="metric-box">
                    <span className="val">{inspectedMeta.f}</span>
                    <span className="lbl">First Seen</span>
                  </div>
                  <div className="metric-box">
                    <span className="val">{inspectedMeta.t}</span>
                    <span className="lbl">Last Seen</span>
                  </div>
                </div>
              )}

              {inspectedMeta?.w && inspectedMeta.w.length > 0 && (
                <div className="inspected-wikis-row">
                  <span className="muted text-xs">Active wikis:</span>
                  <div className="wiki-chips">
                    {inspectedMeta.w.map((w: string) => (
                      <Chip key={w} tone="wiki">
                        <span style={{ color: wikiColor(w) }}>{w}</span>
                      </Chip>
                    ))}
                  </div>
                </div>
              )}

              <div className="inspected-actions">
                {inspectedAgent !== activeAgent && (
                  <button
                    type="button"
                    className="btn sm primary"
                    onClick={() => setFocalAgent(inspectedAgent)}
                  >
                    Focus graph on this agent →
                  </button>
                )}
                <Link to={`/agents?q=${encodeURIComponent(inspectedAgent)}`} className="btn ghost sm">
                  View in Agent Catalog ↗
                </Link>
              </div>

              <section className="inspected-links-section">
                <h4>
                  Linked labels <span className="muted">({inspectedLinks.length})</span>
                </h4>
                <div className="collaborators-list">
                  {inspectedLinks.map((ca) => (
                    <div key={ca.o} className="collaborator-row">
                      <button
                        type="button"
                        className="collaborator-name-btn mono"
                        onClick={() => {
                          // Collaborator selection shows the agent dossier: clear the stale pair.
                          let next = new URLSearchParams(searchParams)
                          if (ca.o === activeAgent) {
                            next.delete('sel')
                          } else {
                            next.set('sel', ca.o)
                          }
                          next = clearPair(next)
                          setSearchParams(next, { replace: true })
                          const node = cyRef.current?.getElementById(ca.o)
                          if (node && node.length > 0) {
                            cyRef.current?.elements().removeClass('highlighted dimmed')
                            const nh = node.neighborhood().add(node)
                            nh.addClass('highlighted')
                            cyRef.current?.elements().not(nh).addClass('dimmed')
                          }
                        }}
                      >
                        {ca.o}
                      </button>
                      <Badge color={ca.c >= 4 ? '#fb7185' : '#38bdf8'}>
                        {ca.c} shared
                      </Badge>
                    </div>
                  ))}
                  {inspectedLinks.length === 0 && (
                    <div className="muted text-xs">No collaborators with ≥ {minShared} shared pages.</div>
                  )}
                </div>
              </section>
            </>
          )}
        </aside>
      </div>
    </div>
  )
}
