import { useEffect, useMemo, useState } from 'react'
import { Link, useNavigate, useParams, useSearchParams } from 'react-router-dom'
import { buildPairTimeline, derivePatternSignals, formatPatternSignals, getSharedPages, getSharedPagesForAll, type SharedPageEntry } from '../utils/pairEvidence'
import { loadJson, revisionFile } from '../api'
import { Badge, Chip, PageLink } from '../components/ui'
import { DiffView } from '../components/DiffView'
import { PairEvidencePanel } from '../components/PairEvidencePanel'
import { useData, useJson } from '../components/useQuery'
import type { AgentLinks, LabelsIndex, PageRecord, PagesIndex, PayloadRecord, Revision } from '../types'
import { fmtInt, fmtTime, fmtTimeSeconds, wikiColor } from '../utils/format'
import { PAYLOAD_FLAG_COLORS, detectPayloadFlags, highlightMatches } from '../utils/payload'
import { clearPair, parsePair, setPair } from '../utils/pairSelection'


function Body({ body, enabled }: { body: string; enabled: boolean }) {
  if (!enabled || body.length > 200_000) return <>{body}</>
  return <>{highlightMatches(body).map((segment, i) => segment.flag ? <mark key={i} className="mark-payload" data-flag={segment.flag}>{segment.text}</mark> : <span key={i}>{segment.text}</span>)}</>
}

function AgentGraph({
  label,
  links,
  labelsIndex,
  pagesIndex,
  pagesById,
  revs,
  selectedPartner,
  onSelectPair,
}: {
  label: string
  links: AgentLinks
  labelsIndex: LabelsIndex | null
  pagesIndex: PagesIndex | null
  pagesById: Map<string, PageRecord[]>
  revs: Revision[] | null
  selectedPartner: string | null
  onSelectPair: (partner: string) => void
}) {
  const coAgents = useMemo(() => {
    const raw = links[label] || []
    return [...raw]
      .sort((a, b) => b.c - a.c || a.o.localeCompare(b.o))
      .slice(0, 10)
  }, [links, label])
  const allLabelPages = useMemo(() => pagesById.get(label) ?? [], [pagesById, label])
  const displayLabelPages = useMemo(() => allLabelPages.slice(0, 6), [allLabelPages])

  // Exact shared-page intersection from labels.json pgs for all linked labels in one pass
  // (agent_links c is only an edge weight). Entries include metadata-missing IDs; the card
  // preview shows only named ones.
  const exactSharedByLabel = useMemo(
    () => getSharedPagesForAll(label, labelsIndex ?? null, pagesIndex ?? null),
    [labelsIndex, pagesIndex, label],
  )

  const totalIndexedLinks = (links[label] || []).length

  const crossLabelTransitions = useMemo(() => {
    if (!revs || revs.length < 2) return 0
    let count = 0
    let prevLabel: string | null = null
    for (const r of revs) {
      if (r.label) {
        if (prevLabel && prevLabel !== r.label) count++
        prevLabel = r.label
      }
    }
    return count
  }, [revs])

  const cardEvidenceMap = useMemo(() => {
    if (!revs || !label) return null
    const map = new Map<string, { count: number; latestTime: string | null; chips: string[] }>()
    for (const agent of coAgents) {
      const timeline = buildPairTimeline(revs, label, agent.o)
      const events = timeline.events
      const count = events.length
      const latestEvent = count > 0 ? events[count - 1] : null
      const latestTime = latestEvent?.time ? fmtTimeSeconds(latestEvent.time) : null
      const signals = derivePatternSignals(events)
      const chips = formatPatternSignals(signals).map((chip) => `${chip.count} ${chip.label}`)
      map.set(agent.o, { count, latestTime, chips })
    }
    return map
  }, [revs, label, coAgents])

  if (!coAgents.length && !allLabelPages.length) return null

  return (
    <section className="card agent-dossier-card">
      <div className="agent-dossier-header-bar">
        <div>
          <div className="agent-title-row">
            <span className="muted uppercase tracking-wider text-xs">Shared Activity Dossier</span>
            <Badge color="#38bdf8">focused label</Badge>
          </div>
          <h2 className="mono agent-dominant-name">
            <Link to={`/agents?q=${encodeURIComponent(label)}`} className="link">
              {label}
            </Link>
          </h2>
        </div>
        <div className="agent-cluster-metrics">
          <div className="agent-metric-item">
            <span className="metric-val">
              {coAgents.length} / {totalIndexedLinks}
              {totalIndexedLinks > 10 && <span className="muted text-xs"> capped top 10</span>}
            </span>
            <span className="metric-lbl">linked labels shown / indexed</span>
          </div>
          {revs != null && (
            <div className="agent-metric-item">
              <span className="metric-val">{crossLabelTransitions}</span>
              <span className="metric-lbl">cross-label transitions on this page</span>
            </div>
          )}
          <div className="agent-metric-item">
            <span className="metric-val">{allLabelPages.length}</span>
            <span className="metric-lbl">target pages</span>
          </div>
          <Link to={`/network?agent=${encodeURIComponent(label)}`} className="btn sm">
            Explore in Network Graph →
          </Link>
        </div>
      </div>

      <div className="agent-dossier-grid">
        {/* Left Column: Target pages edited by root agent */}
        <div className="agent-dossier-pages-col">
          <h3 className="section-subtitle">
            Target pages <span className="muted">(showing {displayLabelPages.length} of {allLabelPages.length})</span>
          </h3>
          <div className="dossier-page-list">
            {displayLabelPages.map((page) => (
              <div key={page.id} className="dossier-page-item">
                <Chip tone="wiki"><span style={{ color: wikiColor(page.w) }}>{page.w}</span></Chip>
                <div className="dossier-page-name">
                  <PageLink id={page.id} name={page.n || page.id} max={38} />
                </div>
                {page.r && <span className="badge-revs">{page.r} revs</span>}
              </div>
            ))}
          </div>
        </div>

        {/* Right Column: Collaborator Syndicate Grid */}
        {coAgents.length > 0 && (
          <div className="agent-dossier-syndicate-col">
            <h3 className="section-subtitle">
              Linked labels <span className="muted">({totalIndexedLinks > 10 ? 'top 10 of indexed links' : coAgents.length})</span>
            </h3>
            <div className="syndicate-cards-grid">
              {coAgents.map((agent) => {
                // Full exact intersection incl. metadata-missing IDs; preview shows only named pages.
                const exactShared = exactSharedByLabel.get(agent.o) ?? []
                const sharedCount = exactShared.length
                const namedShared = exactShared.filter((s) => s.page !== null).slice(0, 2)
                const isSelected = selectedPartner === agent.o
                const evidence = cardEvidenceMap?.get(agent.o)

                return (
                  <article key={agent.o} className={`syndicate-card${isSelected ? ' selected' : ''}`}>
                    <header className="syndicate-card-head">
                      <Link to={`/agents?q=${encodeURIComponent(agent.o)}`} className="syndicate-agent-name mono">
                        {agent.o}
                      </Link>
                      <Badge color="#38bdf8">
                        {sharedCount} shared {sharedCount === 1 ? 'page' : 'pages'}
                      </Badge>
                    </header>

                    {evidence && (
                      <div className="syndicate-evidence-preview">
                        <div className="muted text-xs">
                          <span>{evidence.count} pair event{evidence.count === 1 ? '' : 's'} on this page</span>
                          {evidence.latestTime && <span> · last observed {evidence.latestTime}</span>}
                        </div>
                        {evidence.chips.length > 0 && (
                          <div className="evidence-chips" style={{ display: 'flex', flexWrap: 'wrap', gap: 4, marginTop: 4 }}>
                            {evidence.chips.map((chipText) => (
                              <span key={chipText} className="chip-mini mono">
                                {chipText}
                              </span>
                            ))}
                          </div>
                        )}
                      </div>
                    )}

                    {sharedCount > 0 && (
                      <div className="syndicate-shared-pages">
                        <span className="muted text-xs">shared pages:</span>
                        <div className="shared-chips">
                          {namedShared.map((s) => (
                            <span key={s.id} className="chip-mini">
                              <PageLink id={s.id} name={s.page!.n || s.id} max={22} />
                            </span>
                          ))}
                          {sharedCount > namedShared.length && (
                            <span className="muted text-xs">+{sharedCount - namedShared.length}</span>
                          )}
                        </div>
                      </div>
                    )}

                    <div className="syndicate-card-actions">
                      <button
                        type="button"
                        className="btn sm primary"
                        aria-pressed={isSelected}
                        onClick={() => onSelectPair(agent.o)}
                      >
                        Open pair evidence
                      </button>
                    </div>

                    <footer className="syndicate-card-foot">
                      <Link to={`/agents?q=${encodeURIComponent(agent.o)}`} className="link text-xs">
                        Inspect agent dossier →
                      </Link>
                    </footer>
                  </article>
                )
              })}
            </div>
          </div>
        )}
      </div>
    </section>
  )
}


export default function PageDetail() {
  const params = useParams()
  // React Router v7 already decodes URL parameters in matchRoutes/matchPathImpl;
  // avoiding double-decode prevents URIError and corruption of literal '%' in IDs
  const decoded = params['*'] || params.pageId || ''

  // keyed by page id: resets sel/expanded when navigating between /page/* routes
  return <PageDetailView key={decoded} pageId={decoded} />
}

function PageDetailView({ pageId: decoded }: { pageId: string }) {
  const navigate = useNavigate()
  const [searchParams, setSearchParams] = useSearchParams()

  const { data: index } = useData<PagesIndex>('pages.json')
  const { data: payloadIndex } = useData<PayloadRecord[]>('payload_index.json')
  const { data: agentLinks } = useData<AgentLinks>('agent_links.json')
  // labels.json pgs is untruncated (unlike labs in pages.json, capped at 8) — the source of a label's pages for the graph
  const { data: labelsIndex } = useData<LabelsIndex>('labels.json')

  // Bare-id URLs (e.g. /page/AgentZzzHighMapJun21 from older links) resolve to a canonical
  // wiki-prefixed record ONLY when exactly one page matches; ambiguous or unknown ids never
  // fall through to a guessed revision request.
  const resolved: { id: string; meta?: PageRecord } | null = useMemo(() => {
    if (!index || !decoded) return null
    const exact = index.p.find((p) => p.id === decoded)
    if (exact) return { id: decoded, meta: exact }
    if (decoded.includes('/')) return null
    const matches = index.p.filter((p) => p.id.endsWith('/' + decoded))
    return matches.length === 1 ? { id: matches[0].id, meta: matches[0] } : null
  }, [index, decoded])

  // Redirect bare-id URLs to their canonical form once resolved.
  const canonicalId = resolved && resolved.id !== decoded ? resolved.id : null
  useEffect(() => {
    if (canonicalId) {
      navigate('/page/' + encodeURIComponent(canonicalId) + '?' + searchParams.toString(), { replace: true })
    }
  }, [canonicalId, navigate, searchParams])

  const lookupId = resolved?.id
  const meta: PageRecord | undefined = resolved?.meta

  // Fetch only when the index is loaded AND the id is canonically resolved; unknown/ambiguous
  // ids never request a guessed revision file (which would return the SPA HTML fallback and
  // crash JSON.parse). While the index is still loading the fetch is deferred via an
  // immediately-resolved empty sentinel (a never-settling promise would hang "loading" forever).
  const indexReady = Boolean(index)
  const { data: revs, error } = useJson<Revision[]>(
    () => {
      if (!indexReady) return Promise.resolve([] as Revision[])
      if (!resolved) return Promise.reject(new Error('not-found'))
      return loadJson<Revision[]>(revisionFile(resolved.id, resolved.meta?.s))
    },
    [indexReady, resolved, lookupId],
  )

  const [sel, setSel] = useState<{ from: number; to: number } | null>(null)
  const [expanded, setExpanded] = useState<Record<number, boolean>>({})

  const payload = useMemo(() => (lookupId ? payloadIndex?.find((item) => item.s === meta?.s || item.id === lookupId) : undefined), [payloadIndex, meta?.s, lookupId])
  const dominantLabel = useMemo(() => {
    if (!revs) return ''
    const counts = new Map<string, number>()
    for (const rev of revs) if (rev.label) counts.set(rev.label, (counts.get(rev.label) || 0) + 1)
    return [...counts].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))[0]?.[0] || ''
  }, [revs])

  const labelPagesById = useMemo(() => {
    const map = new Map<string, PageRecord[]>()
    if (!labelsIndex || !index) return map
    const records = new Map(index.p.map((p) => [p.id, p]))
    for (const label of labelsIndex.l) {
      if (!label.x) continue
      map.set(label.x, label.pgs.map((pid) => records.get(pid)).filter((p): p is PageRecord => Boolean(p)))
    }
    return map
  }, [labelsIndex, index])

  const validLabels = useMemo(() => {
    if (!labelsIndex) return undefined
    const set = new Set<string>()
    for (const l of labelsIndex.l) {
      if (l.x) set.add(l.x)
    }
    return set
  }, [labelsIndex])

  const pair = useMemo(() => parsePair(searchParams, validLabels), [searchParams, validLabels])

  // The pair itself is URL state: it stays valid across any shared page even when the dominant
  // label differs. dominantLabel is used only for opening a pair FROM a card (handleSelectPair).
  const pairTimeline = useMemo(() => {
    if (!pair || !revs) return null
    return buildPairTimeline(revs, pair.a, pair.b)
  }, [pair, revs])

  const sharedPages = useMemo(() => {
    if (!pair) return [] as SharedPageEntry[]
    return getSharedPages(pair.a, pair.b, labelsIndex ?? null, index ?? null)
  }, [pair, labelsIndex, index])

  // Panel mounts only when the CURRENT page is a member of the exact pair intersection —
  // a copied URL pointing at an unrelated page falls back to the overview (plan data boundary).
  const currentPageInPair = useMemo(
    () => (lookupId ? sharedPages.some((entry) => entry.id === lookupId) : false),
    [sharedPages, lookupId],
  )

  const handleSelectPair = (partner: string) => {
    if (!dominantLabel) return
    const next = setPair(searchParams, dominantLabel, partner)
    const shared = getSharedPages(dominantLabel, partner, labelsIndex ?? null, index ?? null)
    // Panel renders only when the current page belongs to the pair intersection; if it does not,
    // navigate to the first metadata-backed shared page so the evidence is actually shown.
    if (!lookupId || !shared.some((entry) => entry.id === lookupId)) {
      const target = shared.find((entry) => entry.page !== null)
      if (target) {
        navigate('/page/' + encodeURIComponent(target.id) + '?' + next.toString())
        return
      }
    }
    setSearchParams(next)
  }

  const handleClosePair = () => {
    setSearchParams(clearPair(searchParams))
  }

  const toggleExpand = (idx: number) => {
    setExpanded((prev) => ({ ...prev, [idx]: !isExpanded(idx) }))
  }

  const isExpanded = (idx: number) => {
    if (expanded[idx] !== undefined) return expanded[idx]
    return idx === (revs ? revs.length - 1 : 0)
  }

  const [from, to] = useMemo(() => {
    if (sel) return [sel.from, sel.to]
    if (revs && revs.length >= 2) return [revs.length - 2, revs.length - 1]
    return [0, revs ? revs.length - 1 : 0]
  }, [sel, revs])

  if (error) {
    const notFound = !resolved
    return (
      <div className="error">
        {notFound ? (
          <>
            Page <code className="mono">{decoded}</code> not found in the archive index.{' '}
            <Link to="/pages" className="link">Browse all pages</Link>
          </>
        ) : (
          <>Ошибка загрузки: {error}</>
        )}
      </div>
    )
  }
  // Index still loading (empty sentinel) or revisions pending: show loading,
  // never a transient "not found" flash before pages.json arrives.
  if (!revs || (!indexReady && !error)) return <div className="loading">Загрузка…</div>

  return (
    <div className="page">
      <button type="button" className="btn ghost" onClick={() => navigate(-1)}>← back</button>
      <h1 className="mono">{decoded}</h1>
      {meta && (
        <p className="muted">
          <Chip tone="wiki"><span style={{ color: wikiColor(meta.w) }}>{meta.w}</span></Chip>{' '}
          {fmtInt(meta.r)} revisions · first {meta.f} · last {meta.l}
          {meta.d && <Chip tone="del">deleted live</Chip>}
          {meta.fam && <span> · family: <code>{meta.fam}</code></span>}
        </p>
      )}
      {payload && <div className="payload-strip"><span className="muted mono">payload:</span>{payload.f.map((flag) => <Badge key={flag} color={PAYLOAD_FLAG_COLORS[flag]}>{flag}</Badge>)}{payload.u.map((domain) => <span key={domain} className="payload-domain mono">{domain}</span>)}</div>}
      {agentLinks && dominantLabel && (
        <AgentGraph
          label={dominantLabel}
          links={agentLinks}
          labelsIndex={labelsIndex ?? null}
          pagesIndex={index ?? null}
          pagesById={labelPagesById}
          revs={revs}
          selectedPartner={pair ? (pair.a === dominantLabel ? pair.b : pair.b === dominantLabel ? pair.a : null) : null}
          onSelectPair={handleSelectPair}
        />
      )}
      {pair && pairTimeline && currentPageInPair && (
        <PairEvidencePanel
          leftLabel={pair.a}
          rightLabel={pair.b}
          sharedPages={sharedPages}
          selectedPageId={lookupId ?? null}
          timeline={pairTimeline}
          onClose={handleClosePair}
          onOpenPageInPageDetail={(pageId) => {
            navigate('/page/' + encodeURIComponent(pageId) + '?' + setPair(searchParams, pair.a, pair.b, { keepPage: true }).toString())
          }}
          sourceMode="page"
        />
      )}

      <section className="card">
        <h2>Compare revisions</h2>
        <div className="filters">
          <select className="input" value={from} onChange={(e) => setSel({ from: Number(e.target.value), to })}>
            {revs.map((r, i) => (
              <option key={i} value={i}>
                #{i + 1} {fmtTime(r.time)} {r.label ? `· ${r.label}` : ''}
              </option>
            ))}
          </select>
          <span className="muted">→</span>
          <select className="input" value={to} onChange={(e) => setSel({ from, to: Number(e.target.value) })}>
            {revs.map((r, i) => (
              <option key={i} value={i}>
                #{i + 1} {fmtTime(r.time)} {r.label ? `· ${r.label}` : ''}
              </option>
            ))}
          </select>
        </div>
        {revs[from] && revs[to] && <DiffView before={revs[from].body} after={revs[to].body} />}
      </section>

      <section className="card">
        <h2>Revision history ({revs.length})</h2>
        {[...revs].reverse().map((r, ri) => {
          const i = revs.length - 1 - ri
          const open = isExpanded(i)
          return (
            <article key={i} className="rev">
              <header className="rev-head">
                <strong>#{i + 1}</strong>
                <span className="muted nowrap">{fmtTime(r.time)}</span>
                {r.label && <Badge>{r.label}</Badge>}
                {r.ip16 && <span className="muted nowrap">ip16:{r.ip16}</span>}
                {r.summary && <span className="sum">{r.summary}</span>}
                <span className="muted nowrap">{r.len != null ? fmtInt(r.len) : ''} chars</span>
                <button
                  type="button"
                  className="btn ghost sm"
                  style={{ marginLeft: 'auto' }}
                  onClick={() => toggleExpand(i)}
                >
                  {open ? 'hide body' : 'view body'}
                </button>
              </header>
              {open && <pre className="body">{r.body ? <Body body={r.body} enabled={r.body.length <= 200_000 && Boolean(payload?.f.length || detectPayloadFlags(r.body).length)} /> : <i className="muted">(empty)</i>}</pre>}
            </article>
          )
        })}
      </section>
    </div>
  )
}
