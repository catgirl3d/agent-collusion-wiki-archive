import { useEffect, useMemo, useRef, useState } from 'react'
import { useNavigate, useSearchParams } from 'react-router-dom'
import { loadJson, revisionFile } from '../api'
import { Dropdown } from '../components/Dropdown'
import { PairEvidencePanel } from '../components/PairEvidencePanel'
import NetworkCanvas, { type NetworkCanvasHandle } from '../components/NetworkCanvas'
import { Badge, Button, Card, Chip } from '../components/ui'
import { useData } from '../components/useQuery'
import type { AgentLinks, LabelsIndex, PagesIndex, Revision } from '../types'
import { fmtInt, wikiColor } from '../utils/format'
import { buildNetwork } from '../utils/network'
import { buildPairTimeline, getSharedPages, type PairTimeline } from '../utils/pairEvidence'
import { clearPair, parsePair, parsePairPage, setPair } from '../utils/pairSelection'

export default function Network() {
  const [searchParams, setSearchParams] = useSearchParams()
  const navigate = useNavigate()
  const { data: links, loading: loadingLinks, error: errorLinks } = useData<AgentLinks>('agent_links.json')
  const { data: labelsIndex, loading: loadingLabels } = useData<LabelsIndex>('labels.json')
  const { data: pagesIndex, loading: loadingPages } = useData<PagesIndex>('pages.json')
  const canvasRef = useRef<NetworkCanvasHandle>(null)
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
  const depth = (scopeParam === 'ego' ? 'ego' : 'cluster')
  const layoutName = (layoutParam === 'concentric' || layoutParam === 'circle' ? layoutParam : 'cose')

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
  }>(() => requestKey === null
    ? { key: null, status: 'idle', timeline: null }
    : { key: requestKey, status: selectedPageRecord?.s ? 'loading' : 'error', timeline: null })
  const [trackedRequest, setTrackedRequest] = useState(() => ({
    pair: validatedPair,
    pageId: selectedPageId,
    slug: selectedPageRecord?.s,
  }))

  if (
    trackedRequest.pair !== validatedPair ||
    trackedRequest.pageId !== selectedPageId ||
    trackedRequest.slug !== selectedPageRecord?.s
  ) {
    setTrackedRequest({
      pair: validatedPair,
      pageId: selectedPageId,
      slug: selectedPageRecord?.s,
    })
    setPageState(requestKey === null
      ? { key: null, status: 'idle', timeline: null }
      : { key: requestKey, status: selectedPageRecord?.s ? 'loading' : 'error', timeline: null })
  }

  useEffect(() => {
    if (!validatedPair || !selectedPageId) return

    // Do not guess a revision filename; the render-time request state reports this as an error.
    const slug = selectedPageRecord?.s
    if (!slug || !requestKey) return

    const key = requestKey

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
  }, [validatedPair, selectedPageId, selectedPageRecord?.s, requestKey])

  // Close search suggestions on outside pointerdown
  useEffect(() => {
    const handlePointerDown = (e: MouseEvent) => {
      if (searchWrapRef.current && !searchWrapRef.current.contains(e.target as Node)) {
        setIsOpen(false)
        setActiveIndex(-1)
      }
    }
    document.addEventListener('pointerdown', handlePointerDown)
    return () => { document.removeEventListener('pointerdown', handlePointerDown); }
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
              <Button size="sm" onClick={() => { setFocalAgent(presets[0]); }}>
                Show top syndicate
              </Button>
            </div>
          )}
        </div>
      </div>
    )
  }

  const inspectedAgent = (selParam && links[selParam]) ? selParam : activeAgent
  const inspectedMeta = labelsMap.get(inspectedAgent)
  const inspectedLinks = (links[inspectedAgent] || []).filter((a) => a.c >= minShared)

  const handleNodeSelect = (nodeId: string) => {
    const next = new URLSearchParams(searchParams)
    if (nodeId === activeAgent) next.delete('sel')
    else next.set('sel', nodeId)
    setSearchParams(clearPair(next), { replace: true })
  }

  const handleEdgeSelect = (a: string, b: string) => {
    const next = setPair(new URLSearchParams(searchParams), a, b)
    if (activeAgent) next.set('agent', activeAgent)
    setSearchParams(next, { replace: true })
  }

  const handleBackgroundTap = () => {
    let next = new URLSearchParams(searchParams)
    if (next.has('sel')) next.delete('sel')
    next = clearPair(next)
    if (next.toString() !== searchParams.toString()) setSearchParams(next, { replace: true })
  }

  return (
    <div className="page network-page">
      <header className="network-header">
        <div>
          <h1>Co-editing Network</h1>
          <p className="muted">Shared-page graph across {fmtInt(allAgents.length)} agent labels.</p>
        </div>
        <div className="network-preset-chips">
          <span className="muted text-xs uppercase tracking-wider">Top linked labels:</span>
          {presets.map((agent) => (
            <Button
              key={agent}
              type="button"
              variant="ghost"
              size="sm"
              className="mono"
              aria-pressed={activeAgent === agent}
              onClick={() => { setFocalAgent(agent); }}
            >
              {agent.length > 18 ? `${agent.slice(0, 16)}…` : agent}
            </Button>
          ))}
        </div>
      </header>

      <div className="network-controls-bar surface-panel">
        {/* Search Input with Suggestions */}
        <div
          ref={searchWrapRef}
          className="network-search-wrap"
        >
          <input
            className="input"
            placeholder="Search any agent label…"
            aria-label="Search agent label"
            role="combobox"
            aria-autocomplete="list"
            aria-expanded={isOpen && suggestions.length > 0}
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
          <div
            id="network-search-suggestions"
            className="network-suggestions-popover"
            role="listbox"
            aria-label="Agent search suggestions"
            style={{ display: isOpen && suggestions.length > 0 ? undefined : 'none' }}
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
        </div>

        {/* Min Shared Edits Filter */}
        <div className="control-group">
          <label htmlFor="min-shared-select" className="control-label">Min shared:</label>
          <Dropdown
            id="min-shared-select"
            value={minShared}
            className="sm"
            options={[
              { value: 2, label: '≥ 2 pages' },
              { value: 3, label: '≥ 3 pages' },
              { value: 5, label: '≥ 5 pages' },
              { value: 10, label: '≥ 10 pages' },
            ]}
            onChange={(val) => {
              const next = new URLSearchParams(searchParams)
              if (val === 2) {
                next.delete('min')
              } else {
                next.set('min', String(val))
              }
              setSearchParams(next, { replace: true })
            }}
          />
        </div>

        {/* Depth / Cluster Scope */}
        <div className="control-group">
          <label htmlFor="depth-select" className="control-label">Scope:</label>
          <Dropdown
            id="depth-select"
            value={depth}
            className="sm"
            options={[
              { value: 'cluster', label: 'Cluster (with peer links)' },
              { value: 'ego', label: 'Ego network (1-hop)' },
            ]}
            onChange={(val) => {
              const next = new URLSearchParams(searchParams)
              if (val === 'cluster') {
                next.delete('scope')
              } else {
                next.set('scope', val)
              }
              setSearchParams(next, { replace: true })
            }}
          />
        </div>

        {/* Layout Switch */}
        <div className="control-group">
          <label htmlFor="layout-select" className="control-label">Layout:</label>
          <Dropdown
            id="layout-select"
            value={layoutName}
            className="sm"
            options={[
              { value: 'cose', label: 'Physics (Springs)' },
              { value: 'concentric', label: 'Concentric (Radial)' },
              { value: 'circle', label: 'Circular' },
            ]}
            onChange={(val) => {
              const next = new URLSearchParams(searchParams)
              if (val === 'cose') {
                next.delete('layout')
              } else {
                next.set('layout', val)
              }
              setSearchParams(next, { replace: true })
            }}
          />
        </div>

        {/* View Controls */}
        <div className="network-btn-group">
          <Button
            variant="ghost"
            size="sm"
            onClick={() => {
              canvasRef.current?.zoomIn()
            }}
            title="Zoom In"
          >
            +
          </Button>
          <Button
            variant="ghost"
            size="sm"
            onClick={() => {
              canvasRef.current?.zoomOut()
            }}
            title="Zoom Out"
          >
            −
          </Button>
          <Button
            variant="ghost"
            size="sm"
            onClick={() => canvasRef.current?.fit()}
            title="Fit to view"
          >
            Fit
          </Button>
        </div>
      </div>

      <div className="network-workspace">
        {/* Main Cytoscape Canvas */}
        <Card className="network-canvas-container">
          <NetworkCanvas
            ref={canvasRef}
            networkData={networkData}
            layoutName={layoutName}
            validatedPair={validatedPair}
            selParam={selParam}
            activeAgent={activeAgent}
            onNodeSelect={handleNodeSelect}
            onEdgeSelect={handleEdgeSelect}
            onBackgroundTap={handleBackgroundTap}
          />

          <div className="network-canvas-legend">
            <div className="legend-line-row">
              <span className="legend-sample direct" /> Direct link to {activeAgent.slice(0, 14)}
            </div>
            {depth === 'cluster' && (
              <div className="legend-line-row">
                <span className="legend-sample peer" /> peer co-editing link
              </div>
            )}
          </div>
        </Card>

        {/* Inspector Sidebar */}
        <Card as="aside" className="network-inspector-sidebar">
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
                Promise.resolve(navigate(
                  `/page/${encodeURIComponent(pageId)}?${setPair(new URLSearchParams(searchParams), validatedPair.a, validatedPair.b, { keepPage: true }).toString()}`
                )).catch((error: unknown) => {
                  console.error('Unable to open the selected page from the network', error)
                })
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
                  <Button
                    size="sm"
                    onClick={() => { setFocalAgent(inspectedAgent); }}
                  >
                    Focus graph on this agent →
                  </Button>
                )}
                <Button to={`/agents?q=${encodeURIComponent(inspectedAgent)}`} variant="ghost" size="sm">
                  View in Agent Catalog ↗
                </Button>
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
                          canvasRef.current?.highlightNode(ca.o)
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
        </Card>
      </div>
    </div>
  )
}
