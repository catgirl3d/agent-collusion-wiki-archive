import { useMemo, useState } from 'react'
import { useNavigate, useParams } from 'react-router-dom'
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
  const navigate = useNavigate()
  const coAgents = (links[label] || []).slice(0, 8)
  const labelPages = (pagesById.get(label) ?? []).slice(0, 5)
  if (!coAgents.length || !labelPages.length) return null

  const maxC = Math.max(1, ...coAgents.map((a) => a.c))
  const W = 560
  const H = 320
  const cx = W / 2
  const cy = H / 2
  const R = 128
  const pillW = (name: string) => Math.max(48, name.length * 6.2 + 16)
  const centerW = Math.max(72, label.length * 6.2 + 18)
  const openAgent = (name: string) => navigate(`/agents?q=${encodeURIComponent(name)}`)

  return (
    <section className="card agent-graph">
      <h2>Agent graph</h2>
      <div className="agent-graph-layout">
        <div className="agent-graph-pages">
          <strong className="mono">{label}</strong>
          <ul>
            {labelPages.map((page) => (
              <li key={page.id}>
                <PageLink id={page.id} name={page.n || page.id} max={64} />
              </li>
            ))}
          </ul>
        </div>
        <svg className="agent-graph-svg" viewBox={`0 0 ${W} ${H}`} role="img" aria-label={`Co-agents for ${label}`}>
          {coAgents.map((agent, i) => {
            const angle = (i / coAgents.length) * Math.PI * 2 - Math.PI / 2
            const x = cx + Math.cos(angle) * R
            const y = cy + Math.sin(angle) * R
            const w = pillW(agent.o)
            const strength = agent.c / maxC
            return (
              <g key={agent.o}>
                <line x1={cx} y1={cy} x2={x} y2={y} className="graph-link" style={{ strokeWidth: 1 + strength * 3, opacity: 0.3 + strength * 0.7 }} />
                <g
                  className="graph-node"
                  transform={`translate(${x - w / 2} ${y - 14})`}
                  role="link"
                  tabIndex={0}
                  aria-label={`${agent.o}, ${agent.c} shared edits`}
                  onClick={() => openAgent(agent.o)}
                  onKeyDown={(e) => { if (e.key === 'Enter') openAgent(agent.o) }}
                >
                  <rect width={w} height={28} rx="12" />
                  <text x={w / 2} y={18} textAnchor="middle" className="graph-node-text">{agent.o}</text>
                  <title>{`${agent.o}: ${agent.c} shared edits`}</title>
                </g>
                <text x={x} y={y + 26} textAnchor="middle" className="graph-weight">{agent.c}</text>
              </g>
            )
          })}
          <g
            className="graph-center"
            transform={`translate(${cx - centerW / 2} ${cy - 16})`}
            role="link"
            tabIndex={0}
            aria-label={label}
            onClick={() => openAgent(label)}
            onKeyDown={(e) => { if (e.key === 'Enter') openAgent(label) }}
          >
            <rect width={centerW} height={32} rx="14" />
            <text x={centerW / 2} y={20} textAnchor="middle" className="graph-center-text">{label}</text>
            <title>{label}</title>
          </g>
        </svg>
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
