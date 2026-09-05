import { useMemo, useState } from 'react'
import { useNavigate, useParams } from 'react-router-dom'
import { loadJson, revisionFile } from '../api'
import { Badge, Chip } from '../components/ui'
import { useJson } from '../components/useQuery'
import type { PageRecord, PagesIndex, Revision } from '../types'
import { fmtInt, fmtTime, wikiColor } from '../utils/format'

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
          {l.kind === 'add' ? '+' : l.kind === 'del' ? '−' : ' '} {l.text}
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
              {open && <pre className="body">{r.body || <i className="muted">(empty)</i>}</pre>}
            </article>
          )
        })}
      </section>
    </div>
  )
}