import { useEffect, useMemo, useState } from 'react'
import { Link, useLocation, useNavigate, useParams, useSearchParams } from 'react-router-dom'
import { buildPairTimeline, collectPayloadEvidence, derivePatternSignals, formatPatternSignals, getSharedPages, getSharedPagesForAll, type SharedPageEntry } from '../utils/pairEvidence'
import { loadJson, revisionFile } from '../api'
import { Dropdown } from '../components/Dropdown'
import { Badge, Button, Card, Chip, LoadMore, PageLink, TextLink } from '../components/ui'
import { DiffView } from '../components/DiffView'
import { PairEvidencePanel } from '../components/PairEvidencePanel'
import { useData, useJson } from '../components/useQuery'
import type { AgentLinks, LabelsIndex, PageRecord, PagesIndex, PayloadRecord, Revision } from '../types'
import { fmtInt, fmtTime } from '../utils/format'
import { PAYLOAD_FLAG_COLORS, detectPayloadFlags, highlightMatches } from '../utils/payload'
import { clearPair, parsePair, setPair } from '../utils/pairSelection'

// The history list is newest-first and rendered one page at a time: the largest archived pages
// hold thousands of revisions (each article adds ~10 DOM nodes even when collapsed).
const REVISIONS_PER_PAGE = 50


function Body({ body, enabled }: { body: string; enabled: boolean }) {
  if (!enabled || body.length > 200_000) return <>{body}</>
  return <>{highlightMatches(body).map((segment, i) => segment.flag ? <mark key={i} className="mark-payload" data-flag={segment.flag}>{segment.text}</mark> : <span key={i}>{segment.text}</span>)}</>
}

function RecoveredBody({ revision }: { revision: Revision }) {
  return (
    <div>
      <p className="muted">Recovered partial revision — full body not retained</p>
      {(revision.added ?? []).map((line, index) => <div className="mono" key={`a-${String(index)}`}>+{line}</div>)}
      {(revision.removed ?? []).map((line, index) => <div className="mono" key={`r-${String(index)}`}>-{line}</div>)}
    </div>
  )
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
  links: Partial<AgentLinks>
  labelsIndex: LabelsIndex | null
  pagesIndex: PagesIndex | null
  pagesById: Map<string, PageRecord[]>
  revs: Revision[] | null
  selectedPartner: string | null
  onSelectPair: (partner: string) => void
}) {
  const coAgents = useMemo(() => {
    const raw = links[label] ?? []
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

  const totalIndexedLinks = (links[label] ?? []).length

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
      const latestTime = latestEvent?.time ? fmtTime(latestEvent.time) : null
      const signals = derivePatternSignals(events)
      const chips = formatPatternSignals(signals).map((chip) => `${String(chip.count)} ${chip.label}`)
      map.set(agent.o, { count, latestTime, chips })
    }
    return map
  }, [revs, label, coAgents])

  if (!coAgents.length && !allLabelPages.length) return null

  return (
    <Card as="section" className="agent-dossier-card">
      <div className="agent-dossier-header-bar">
        <div>
          <div className="agent-title-row">
            <span className="muted uppercase tracking-wider text-xs">Shared Activity Dossier</span>
            <Badge color="#38bdf8">focused label</Badge>
          </div>
          <h2 className="mono agent-dominant-name">
            <TextLink to={`/agents?q=${encodeURIComponent(label)}`}>
              {label}
            </TextLink>
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
          <Button to={`/network?agent=${encodeURIComponent(label)}`} size="sm">
            Explore in Network Graph →
          </Button>
        </div>
      </div>

      <details className="dossier-guide">
        <summary>How to read this block</summary>
        <ul>
          <li><strong>Focused label</strong> — the label with the most archived revisions on this page; it can differ from the label in the page ID.</li>
          <li><strong>Target pages</strong> — all pages where this label has archived revisions; the counter shows the full total, the list is a preview.</li>
          <li><strong>Linked labels</strong> — labels that co-edited at least 2 of the same pages, ranked by shared-page count; the top 10 are shown. The card badge is the exact intersection of both page sets.</li>
          <li><strong>Cross-label transitions</strong> — adjacent revisions on this page whose labels differ; a count of interleaved editing, not a handoff or a conflict.</li>
          <li><strong>Pair events and chips</strong> — revisions by either card label on this page. Chips compare a revision with the immediately preceding page revision: additive/relay-like = lines only added, destructive/overwrite-like = lines removed or replaced, alternating = the labels switch away and back, mixed operations = change not classified.</li>
          <li><strong>Pair evidence</strong> — revision timeline of the pair on this page; edits by other labels appear as intervening context.</li>
        </ul>
        <p className="muted">Co-editing, shared pages and timestamps are archive observations; they do not prove intent, direction or information transfer.</p>
      </details>

      <div className="agent-dossier-grid">
        {/* Left Column: Target pages edited by root agent */}
        <div className="agent-dossier-pages-col">
          <h3 className="section-subtitle">
            Target pages <span className="muted">(showing {displayLabelPages.length} of {allLabelPages.length})</span>
          </h3>
          <div className="dossier-page-list">
            {displayLabelPages.map((page) => (
              <div key={page.id} className="dossier-page-item">
                <Chip tone="wiki">{page.w}</Chip>
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
                const namedShared = exactShared.filter(
                  (sharedPage): sharedPage is SharedPageEntry & { page: PageRecord } => sharedPage.page !== null,
                )
                const isSelected = selectedPartner === agent.o
                const evidence = cardEvidenceMap?.get(agent.o)

                return (
                  <Card as="article" variant="compact" key={agent.o} className={`syndicate-card${isSelected ? ' selected' : ''}`}>
                    <header className="syndicate-card-head">
                      <Link to={`/agents?q=${encodeURIComponent(agent.o)}`} className="syndicate-agent-name mono">
                        {agent.o}
                      </Link>
                      <span className="syndicate-shared-control">
                        <button
                          type="button"
                          className="syndicate-shared-trigger"
                          aria-label={`${String(sharedCount)} shared ${sharedCount === 1 ? 'page' : 'pages'}`}
                        >
                          <Badge color="#38bdf8">
                            {sharedCount} shared {sharedCount === 1 ? 'page' : 'pages'}
                          </Badge>
                        </button>
                        <span className="syndicate-shared-pop" role="tooltip">
                          <span className="syndicate-shared-pop-title muted text-xs">
                            shared pages
                          </span>
                          {namedShared.map((s) => (
                            <PageLink key={s.id} id={s.id} name={s.page.n || s.id} max={40} />
                          ))}
                          {sharedCount > namedShared.length && (
                            <span className="muted text-xs">
                              +{String(sharedCount - namedShared.length)} without page metadata
                            </span>
                          )}
                        </span>
                      </span>
                    </header>

                    {evidence && (
                      <div className="syndicate-card-stats">
                        <span className="syndicate-stat" title={`${String(evidence.count)} pair event${evidence.count === 1 ? '' : 's'} on this page`}>
                          <span className="syndicate-stat-val mono">{evidence.count}</span>
                          <span className="metric-lbl">pair events</span>
                        </span>
                        {evidence.latestTime && (
                          <span className="syndicate-stat syndicate-stat-end" title={`last observed ${evidence.latestTime}`}>
                            <span className="syndicate-stat-val syndicate-stat-date mono">{evidence.latestTime}</span>
                            <span className="metric-lbl">last observed</span>
                          </span>
                        )}
                      </div>
                    )}

                    {evidence && evidence.chips.length > 0 && (
                      <div className="syndicate-card-chips">
                        {evidence.chips.map((chipText) => (
                          <Chip key={chipText} className="chip-mini mono">
                            {chipText}
                          </Chip>
                        ))}
                      </div>
                    )}

                    <div className="syndicate-card-actions">
                      <Button
                        size="sm"
                        variant={isSelected ? 'primary' : 'ghost'}
                        aria-pressed={isSelected}
                        onClick={() => { onSelectPair(agent.o); }}
                      >
                        Pair evidence
                      </Button>
                      <Button to={`/agents?q=${encodeURIComponent(agent.o)}`} variant="ghost" size="sm">
                        Agent dossier
                      </Button>
                    </div>
                  </Card>
                )
              })}
            </div>
          </div>
        )}
      </div>
    </Card>
  )
}


export default function PageDetail() {
  const params = useParams()
  // React Router v7 already decodes URL parameters in matchRoutes/matchPathImpl;
  // avoiding double-decode prevents URIError and corruption of literal '%' in IDs
  const decoded = [params['*'], params.pageId].find((value) => Boolean(value)) ?? ''

  // keyed by page id: resets sel/expanded when navigating between /page/* routes
  return <PageDetailView key={decoded} pageId={decoded} />
}

function PageDetailView({ pageId: decoded }: { pageId: string }) {
  const navigate = useNavigate()
  const location = useLocation()
  const [searchParams, setSearchParams] = useSearchParams()

  // "default" is React Router's key for the entry the document was opened with: a direct
  // link, new tab, or external referrer has no in-app history, so navigate(-1) would leave
  // the SPA (or do nothing) — fall back to the pages index instead.
  const canGoBack = location.key !== 'default'

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
      Promise.resolve(navigate('/page/' + encodeURIComponent(canonicalId) + '?' + searchParams.toString(), { replace: true })).catch((error: unknown) => {
        console.error('Unable to navigate to the canonical page URL', error)
      })
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
  const [expanded, setExpanded] = useState<Partial<Record<number, boolean>>>({})
  const [evidenceOpen, setEvidenceOpen] = useState(false)
  const [revLimit, setRevLimit] = useState(REVISIONS_PER_PAGE)

  const payload = useMemo(() => (lookupId ? payloadIndex?.find((item) => item.s === meta?.s || item.id === lookupId) : undefined), [payloadIndex, meta?.s, lookupId])
  const evidence = useMemo(() => evidenceOpen && payload && revs ? collectPayloadEvidence(revs, payload.f) : null, [evidenceOpen, payload, revs])
  const dominantLabel = useMemo(() => {
    if (!revs) return ''
    const counts = new Map<string, number>()
    for (const rev of revs) if (rev.label) counts.set(rev.label, (counts.get(rev.label) ?? 0) + 1)
    return [...counts].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))[0]?.[0] ?? ''
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
        Promise.resolve(navigate('/page/' + encodeURIComponent(target.id) + '?' + next.toString())).catch((error: unknown) => {
          console.error('Unable to navigate to the shared page', error)
        })
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
            <TextLink to="/pages">Browse all pages</TextLink>
          </>
        ) : (
          <>Error loading: {error}</>
        )}
      </div>
    )
  }
  // Index still loading (empty sentinel) or revisions pending: show loading,
  // never a transient "not found" flash before pages.json arrives.
  if (!revs || (!indexReady && !error)) return <div className="loading">Loading…</div>
  const revisionOptions = revs.map((revision, index) => ({
    value: index,
    label: `#${String(index + 1)} ${fmtTime(revision.time)}${revision.label ? ` · ${revision.label}` : ''}${revision.partial ? ' · recovered' : ''}`,
  }))

  const visibleRevisions: number[] = []
  for (let i = revs.length - 1; i >= 0 && visibleRevisions.length < revLimit; i--) visibleRevisions.push(i)

  // Payload evidence can point at an older revision: expand the limit if needed,
  // then focus and scroll to the article once React has committed the revision to the DOM.
  const openRevision = (index: number) => {
    setExpanded((prev) => ({ ...prev, [index]: true }))
    const needed = revs.length - index
    if (needed > revLimit) setRevLimit(needed)
    requestAnimationFrame(() => {
      const element = document.getElementById(`rev-${String(index)}`)
      if (!element) return
      element.focus({ preventScroll: true })
      const reduceMotion = typeof window.matchMedia === 'function' && window.matchMedia('(prefers-reduced-motion: reduce)').matches
      element.scrollIntoView({ behavior: reduceMotion ? 'auto' : 'smooth', block: 'start' })
    })
  }

  return (
    <div className="page">
      <Button
        variant="ghost"
        onClick={() => {
          Promise.resolve(canGoBack ? navigate(-1) : navigate('/pages')).catch((error: unknown) => {
            console.error('Unable to navigate back from the page detail', error)
          })
        }}
      >
        ← back
      </Button>
      <h1 className="mono">{decoded}</h1>
      {meta && (
        <p className="muted">
          <Chip tone="wiki">{meta.w}</Chip>{' '}
          {fmtInt(meta.r)} revisions · first {meta.f} · last {meta.l}
           {meta.d && <Chip tone="del">deleted live</Chip>}
           {meta.partial && <Badge>recovered</Badge>}
          {meta.fam && <span> · family: <code>{meta.fam}</code></span>}
        </p>
      )}
      {payload && (
        <div className="payload-strip">
          <span className="muted mono">payload:</span>
          {payload.f.map((flag) => (
            <Badge key={flag} color={PAYLOAD_FLAG_COLORS[flag]}>{flag}</Badge>
          ))}
          {payload.u.map((domain) => (
            <Badge key={domain} className="payload-domain" title={domain}>{domain}</Badge>
          ))}
        </div>
      )}
      {payload && payload.f.length > 0 && (
        <details className="payload-evidence" onToggle={(event) => { setEvidenceOpen(event.currentTarget.open); }}>
          <summary>What matched these flags?</summary>
          {evidenceOpen && evidence && (evidence.entries.length ? (
            payload.f.map((flag) => {
              const entries = evidence.entries.filter((entry) => entry.flag === flag)
              return (
                <div className="payload-evidence-group" key={flag}>
                  <Badge color={PAYLOAD_FLAG_COLORS[flag]}>{flag}</Badge>
                  {entries.length ? (
                    <div className="pair-snippets-list">
                      {entries.map((entry, entryIndex) => (
                        <div key={`${entry.flag}-${String(entry.revIndex)}-${String(entryIndex)}`}>
                          <div className="payload-evidence-meta muted text-sm">
                            <span>#{entry.revIndex + 1} {fmtTime(entry.time)}</span>{entry.label && <span> · {entry.label}</span>}
                            <Button variant="ghost" size="sm" aria-label={`Open revision #${String(entry.revIndex + 1)}`} onClick={() => { openRevision(entry.revIndex); }}>open revision</Button>
                          </div>
                          <pre className="pair-snippet" data-flag={flag}>{highlightMatches(entry.text).map((segment, segmentIndex) => segment.flag ? <mark key={segmentIndex} className="mark-payload" data-flag={segment.flag}>{segment.text}</mark> : <span key={segmentIndex}>{segment.text}</span>)}</pre>
                        </div>
                      ))}
                    </div>
                  ) : <p className="muted text-sm">no retained match in loaded revisions</p>}
                </div>
              )
            })
          ) : <p className="muted text-sm">No retained revision body contains this pattern (recovered or truncated data).</p>)}
        </details>
      )}
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
            Promise.resolve(navigate('/page/' + encodeURIComponent(pageId) + '?' + setPair(searchParams, pair.a, pair.b, { keepPage: true }).toString())).catch((error: unknown) => {
              console.error('Unable to navigate to the selected page', error)
            })
          }}
          sourceMode="page"
        />
      )}

      <Card as="section">
        <h2>Compare revisions</h2>
        <div className="filters">
          <Dropdown ariaLabel="Compare from revision" value={from} options={revisionOptions} onChange={(value) => { setSel({ from: value, to }); }} />
          <span className="muted">→</span>
          <Dropdown ariaLabel="Compare to revision" value={to} options={revisionOptions} onChange={(value) => { setSel({ from, to: value }); }} />
        </div>
        {revs[from] && revs[to] && (revs[from].partial || revs[to].partial)
          ? <p className="muted">Recovered partial revision — full body not retained</p>
          : revs[from] && revs[to] && <DiffView before={revs[from].body} after={revs[to].body} />}
      </Card>

      <Card as="section">
        <h2>
          Revision history ({fmtInt(revs.length)}){' '}
          {revs.length > 0 && (
            <span className="muted">showing {fmtInt(visibleRevisions.length)} of {fmtInt(revs.length)} revisions</span>
          )}
        </h2>
        {visibleRevisions.map((i) => {
          const r = revs[i]
          const open = isExpanded(i)
          return (
            <article key={i} id={`rev-${String(i)}`} tabIndex={-1} className="rev">
              <header className="rev-head">
                <strong>#{i + 1}</strong>
                <span className="muted nowrap">{fmtTime(r.time)}</span>
                {r.partial ? <Badge>recovered</Badge> : r.label && <Badge>{r.label}</Badge>}
                {r.ip16 && <span className="muted nowrap">ip16:{r.ip16}</span>}
                {r.summary && <span className="sum">{r.summary}</span>}
                <span className="muted nowrap">{r.partial ? '—' : r.len != null ? `${fmtInt(r.len)} chars` : ''}</span>
                <Button
                  variant="ghost"
                  size="sm"
                  style={{ marginLeft: 'auto' }}
                  onClick={() => { toggleExpand(i); }}
                >
                  {r.partial ? (open ? 'hide diff' : 'view diff') : (open ? 'hide body' : 'view body')}
                </Button>
              </header>
              {open && (
                r.partial ? (
                  <div className="body">
                    <RecoveredBody revision={r} />
                  </div>
                ) : (
                  <pre className="body">
                    {r.body ? <Body body={r.body} enabled={r.body.length <= 200_000 && ((payload?.f.length ?? 0) > 0 || detectPayloadFlags(r.body).length > 0)} /> : <i className="muted">(empty)</i>}
                  </pre>
                )
              )}
            </article>
          )
        })}
        <LoadMore
          loaded={visibleRevisions.length}
          total={revs.length}
          onLoadMore={() => { setRevLimit((prev) => prev + REVISIONS_PER_PAGE); }}
          step={REVISIONS_PER_PAGE}
          unit="remaining"
          action="Load older revisions"
        />
      </Card>
    </div>
  )
}
