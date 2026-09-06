import { useMemo, useState } from 'react'
import { Link, useNavigate, useParams } from 'react-router-dom'
import { loadJson, revisionFile } from '../api'
import { Badge, Chip, PageLink } from '../components/ui'
import { useData, useJson } from '../components/useQuery'
import type { AgentLinks, LabelsIndex, PageRecord, PagesIndex, PayloadRecord, Revision } from '../types'
import { fmtInt, fmtTime, wikiColor } from '../utils/format'
import { PAYLOAD_FLAG_COLORS, detectPayloadFlags, highlightMatches } from '../utils/payload'

function DiffLine({ text }: { text: string }) {
  const segments = highlightMatches(text)
  return (
    <>
      {segments.map((seg, idx) =>
        seg.flag ? (
          <mark key={idx} className="mark-payload" data-flag={seg.flag}>
            {seg.text}
          </mark>
        ) : (
          <span key={idx}>{seg.text}</span>
        ),
      )}
    </>
  )
}

function Body({ body, enabled }: { body: string; enabled: boolean }) {
  if (!enabled || body.length > 200_000) return <>{body}</>
  return <>{highlightMatches(body).map((segment, i) => segment.flag ? <mark key={i} className="mark-payload" data-flag={segment.flag}>{segment.text}</mark> : <span key={i}>{segment.text}</span>)}</>
}

function AgentGraph({ label, links, pagesById }: { label: string; links: AgentLinks; pagesById: Map<string, PageRecord[]> }) {
  const coAgents = useMemo(() => {
    const raw = links[label] || []
    return [...raw]
      .sort((a, b) => b.c - a.c || a.o.localeCompare(b.o))
      .slice(0, 10)
  }, [links, label])
  const allLabelPages = useMemo(() => pagesById.get(label) ?? [], [pagesById, label])
  const displayLabelPages = useMemo(() => allLabelPages.slice(0, 6), [allLabelPages])
  const coAgentSet = useMemo(() => new Set(coAgents.map((a) => a.o)), [coAgents])

  if (!coAgents.length && !allLabelPages.length) return null

  const maxC = Math.max(1, ...coAgents.map((a) => a.c))
  const sharedPageLinksTop10 = coAgents.reduce((sum, a) => sum + a.c, 0)
  return (
    <section className="card agent-dossier-card">
      <div className="agent-dossier-header-bar">
        <div>
          <div className="agent-title-row">
            <span className="muted uppercase tracking-wider text-xs">Coordination Dossier</span>
            <Badge color="#38bdf8">cluster root</Badge>
          </div>
          <h2 className="mono agent-dominant-name">
            <Link to={`/agents?q=${encodeURIComponent(label)}`} className="link">
              {label}
            </Link>
          </h2>
        </div>
        <div className="agent-cluster-metrics">
          <div className="agent-metric-item">
            <span className="metric-val">{(links[label] || []).length}</span>
            <span className="metric-lbl">Co-conspirators</span>
          </div>
          <div className="agent-metric-item">
            <span className="metric-val">{sharedPageLinksTop10}</span>
            <span className="metric-lbl">Shared page links (top 10)</span>
          </div>
          <div className="agent-metric-item">
            <span className="metric-val">{allLabelPages.length}</span>
            <span className="metric-lbl">Target Pages</span>
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
            Pages edited by {label.length > 20 ? `${label.slice(0, 18)}…` : label} <span className="muted">({allLabelPages.length})</span>
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
              Top Collaborating Agents <span className="muted">({coAgents.length})</span>
            </h3>
            <div className="syndicate-cards-grid">
              {coAgents.map((agent) => {
                const strengthPct = Math.min(100, Math.round((agent.c / maxC) * 100))
                const agentPages = pagesById.get(agent.o) ?? []
                const agentPageIds = new Set(agentPages.map((ap) => ap.id))
                const mutualPages = allLabelPages.filter((p) => agentPageIds.has(p.id))
                const peerLinks = (links[agent.o] || []).filter((p) => coAgentSet.has(p.o) && p.o !== agent.o)

                return (
                  <article key={agent.o} className="syndicate-card">
                  <header className="syndicate-card-head">
                    <Link to={`/agents?q=${encodeURIComponent(agent.o)}`} className="syndicate-agent-name mono">
                      {agent.o}
                    </Link>
                    <Badge color={agent.c >= 4 ? '#fb7185' : '#38bdf8'}>
                      {agent.c} shared
                    </Badge>
                  </header>

                  <div className="collusion-meter">
                    <div className="meter-label">
                      <span>Coordination strength</span>
                      <span className="mono">{strengthPct}%</span>
                    </div>
                    <div className="meter-track">
                      <div
                        className={`meter-fill ${agent.c >= 4 ? 'high' : 'medium'}`}
                        style={{ width: `${strengthPct}%` }}
                      />
                    </div>
                  </div>

                  {mutualPages.length > 0 && (
                    <div className="syndicate-shared-pages">
                      <span className="muted text-xs">Shared targets:</span>
                      <div className="shared-chips">
                        {mutualPages.slice(0, 2).map((p) => (
                          <span key={p.id} className="chip-mini">
                            <PageLink id={p.id} name={p.n || p.id} max={22} />
                          </span>
                        ))}
                        {mutualPages.length > 2 && (
                          <span className="muted text-xs">+{mutualPages.length - 2}</span>
                        )}
                      </div>
                    </div>
                  )}

                  {peerLinks.length > 0 && (
                    <div className="syndicate-peers">
                      <span className="muted text-xs">Cluster peers:</span>
                      <span className="peer-tags">
                        {peerLinks.slice(0, 3).map((p) => (
                          <span key={p.o} className="peer-tag mono">{p.o}</span>
                        ))}
                        {peerLinks.length > 3 && <span className="muted text-xs">+{peerLinks.length - 3}</span>}
                      </span>
                    </div>
                  )}

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

function diffLines(a: string, b: string): Array<{ kind: 'ctx' | 'add' | 'del'; text: string }> {
  if (a === b) return []
  const al = a.split('\n')
  const bl = b.split('\n')

  // Common prefix stripping
  let start = 0
  while (start < al.length && start < bl.length && al[start] === bl[start]) {
    start++
  }

  // Common suffix stripping
  let aEnd = al.length - 1
  let bEnd = bl.length - 1
  while (aEnd >= start && bEnd >= start && al[aEnd] === bl[bEnd]) {
    aEnd--
    bEnd--
  }

  const prefix: Array<{ kind: 'ctx'; text: string }> = []
  const pStart = Math.max(0, start - 3)
  for (let i = pStart; i < start; i++) {
    prefix.push({ kind: 'ctx', text: al[i] })
  }

  const suffix: Array<{ kind: 'ctx'; text: string }> = []
  const sEnd = Math.min(al.length, aEnd + 1 + 3)
  for (let i = aEnd + 1; i < sEnd; i++) {
    suffix.push({ kind: 'ctx', text: al[i] })
  }

  const midA = al.slice(start, aEnd + 1)
  const midB = bl.slice(start, bEnd + 1)
  const n = midA.length
  const m = midB.length

  if (n > 600 || m > 600) {
    return [
      ...prefix,
      { kind: 'del', text: `... [${n} lines modified] ...` },
      { kind: 'add', text: `... [${m} lines modified] ...` },
      ...suffix,
    ]
  }

  const dp: number[][] = Array.from({ length: n + 1 }, () => Array(m + 1).fill(0))
  for (let i = n - 1; i >= 0; i--) {
    for (let j = m - 1; j >= 0; j--) {
      dp[i][j] = midA[i] === midB[j] ? dp[i + 1][j + 1] + 1 : Math.max(dp[i + 1][j], dp[i][j + 1])
    }
  }

  const middle: Array<{ kind: 'ctx' | 'add' | 'del'; text: string }> = []
  let i = 0
  let j = 0
  while (i < n && j < m) {
    if (midA[i] === midB[j]) {
      middle.push({ kind: 'ctx', text: midA[i] })
      i++
      j++
    } else if (dp[i + 1][j] >= dp[i][j + 1]) {
      middle.push({ kind: 'del', text: midA[i] })
      i++
    } else {
      middle.push({ kind: 'add', text: midB[j] })
      j++
    }
  }
  while (i < n) middle.push({ kind: 'del', text: midA[i++] })
  while (j < m) middle.push({ kind: 'add', text: midB[j++] })

  return [...prefix, ...middle, ...suffix]
}

export function DiffView({ before, after }: { before: string; after: string }) {
  const lines = useMemo(() => diffLines(before, after), [before, after])
  if (before === after) return <div className="muted">No changes between these revisions.</div>
  return (
    <pre className="diff">
      {lines.map((l, i) => (
        <div key={i} className={`diff-${l.kind}`}>
          {l.kind === 'add' ? '+' : l.kind === 'del' ? '−' : ' '} <DiffLine text={l.text} />
        </div>
      ))}
    </pre>
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

  const { data: index } = useJson<PagesIndex>(() => loadJson<PagesIndex>('pages.json'), [])
  const { data: payloadIndex } = useData<PayloadRecord[]>('payload_index.json')
  const { data: agentLinks } = useData<AgentLinks>('agent_links.json')
  // pgs в labels.json не усечён (в отличие от labs в pages.json, обрезанных до 8) — источник страниц лейбла для графа
  const { data: labelsIndex } = useData<LabelsIndex>('labels.json')

  const meta: PageRecord | undefined = useMemo(
    () => (index ? index.p.find((p) => p.id === decoded) : undefined),
    [index, decoded],
  )

  const { data: revs, error } = useJson<Revision[]>(
    () => (decoded ? loadJson<Revision[]>(revisionFile(decoded, meta?.s)) : Promise.reject(new Error('no page id'))),
    [decoded, meta?.s],
  )

  const [sel, setSel] = useState<{ from: number; to: number } | null>(null)
  const [expanded, setExpanded] = useState<Record<number, boolean>>({})

  const payload = useMemo(() => payloadIndex?.find((item) => item.s === meta?.s || item.id === decoded), [payloadIndex, meta?.s, decoded])
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

  if (error) return <div className="error">Ошибка загрузки: {error}</div>
  if (!revs) return <div className="loading">Загрузка…</div>

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
      {agentLinks && dominantLabel && <AgentGraph label={dominantLabel} links={agentLinks} pagesById={labelPagesById} />}

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
