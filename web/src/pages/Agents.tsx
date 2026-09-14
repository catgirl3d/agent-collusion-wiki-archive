import { Fragment, useDeferredValue, useMemo, useState } from 'react'
import { useSearchParams } from 'react-router-dom'
import { useData } from '../components/useQuery'
import { Badge, Button, PageLink } from '../components/ui'
import type { LabelsIndex } from '../types'
import { filterLabels, fmtInt, toCsv } from '../utils/format'
import { downloadBlob } from '../utils/download'

const RESULT_LIMIT = 50

export default function Agents() {
  const { data, error } = useData<LabelsIndex>('labels.json')
  const [searchParams] = useSearchParams()
  // URL ?q= is the external source of truth: applied as a key-reset when the param changes
  const urlQ = searchParams.get('q') ?? ''
  const [query, setQuery] = useState(urlQ)
  const [lastUrlQ, setLastUrlQ] = useState(urlQ)
  const [limit, setLimit] = useState(RESULT_LIMIT)
  const [open, setOpen] = useState<string | null>(null)

  if (urlQ !== lastUrlQ) {
    setLastUrlQ(urlQ)
    setQuery(urlQ)
    setLimit(RESULT_LIMIT)
  }

  const deferredQuery = useDeferredValue(query)
  const filtered = useMemo(() => (data ? filterLabels(data.l, deferredQuery) : []), [data, deferredQuery])
  const shown = filtered.slice(0, limit)

  const exportCsv = () => {
    const timestamp = Math.floor(Date.now() / 1000)
    const rows = filtered.map(({ x, r, p, f, t, h }) => ({ label: x, revs: r, pages: p, first: f, last: t, h }))
    downloadBlob(`agents-slice-${timestamp}.csv`, toCsv(rows), 'text/csv;charset=utf-8')
  }

  if (error) return <div className="error">Error: {error}</div>
  if (!data) return <div className="loading">Loading…</div>

  return (
    <div className="page">
      <h1>Agent labels <span className="muted">({fmtInt(data.l.length)} + {fmtInt(data.n_anon)} anonymous)</span></h1>

      <div className="filters">
        <input
          className="input"
          aria-label="Search agents"
          placeholder="Search agent…"
          value={query}
          onChange={(e) => {
            setQuery(e.target.value)
            setLimit(RESULT_LIMIT)
          }}
        />
        <span className="muted result-count">{fmtInt(filtered.length)}</span>
        <Button onClick={exportCsv}>Export CSV</Button>
      </div>

      <div className="table-wrap">
        <table className="tbl">
          <thead>
            <tr>
              <th>Label</th>
              <th className="num">Revs</th>
              <th className="num">Pages</th>
              <th>First</th>
              <th>Last</th>
              <th>Wikis</th>
              <th>Kind</th>
              <th aria-label="Actions" />
            </tr>
          </thead>
          <tbody>
            {shown.map((l) => (
              <Fragment key={l.x}>
                <tr className={open === l.x ? 'row-open' : undefined}>
                  <td className="mono">{l.x || '(empty)'}</td>
                  <td className="num">{fmtInt(l.r)}</td>
                  <td className="num">{fmtInt(l.p)}</td>
                  <td className="muted nowrap">{l.f}</td>
                  <td className="muted nowrap">{l.t}</td>
                  <td>{l.w.join(', ') || '—'}</td>
                  <td>{l.h ? <Badge>human?</Badge> : <span className="muted">agent</span>}</td>
                  <td className="nowrap">
                    <div style={{ display: 'flex', gap: '6px' }}>
                      {l.pgs.length > 0 && (
                        <Button variant="ghost" size="sm" onClick={() => setOpen(open === l.x ? null : l.x)}>
                          {open === l.x ? 'hide' : 'pages'}
                        </Button>
                      )}
                      <Button
                        to={`/timeline?label=${encodeURIComponent(l.x)}`}
                        variant="ghost"
                        size="sm"
                        title="Reconstruct this agent's revision timeline"
                      >
                        timeline
                      </Button>
                      <Button to={`/network?agent=${encodeURIComponent(l.x)}`} variant="ghost" size="sm" title="Explore syndicate network">
                        network
                      </Button>
                    </div>
                  </td>
                </tr>
                {open === l.x && (
                  <tr className="row-detail">
                    <td colSpan={8}>
                      <div className="pages-list">
                        {l.pgs.slice(0, 60).map((pid) => (
                          <PageLink key={pid} id={pid} name={pid} max={90} />
                        ))}
                        {l.pgs.length > 60 && <span className="muted">… and {l.pgs.length - 60} more</span>}
                      </div>
                    </td>
                  </tr>
                )}
              </Fragment>
            ))}
          </tbody>
        </table>
      </div>

      {filtered.length > shown.length && (
        <div style={{ marginTop: 16 }}>
          <Button onClick={() => setLimit((n) => n + RESULT_LIMIT)}>
            Load more ({fmtInt(filtered.length - shown.length)} remaining)
          </Button>
        </div>
      )}
    </div>
  )
}
