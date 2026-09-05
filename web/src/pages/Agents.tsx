import { Fragment, useDeferredValue, useMemo, useState } from 'react'
import { useData } from '../components/useQuery'
import { Badge, PageLink } from '../components/ui'
import type { LabelsIndex } from '../types'
import { filterLabels, fmtInt } from '../utils/format'

const RESULT_LIMIT = 50

export default function Agents() {
  const { data, error } = useData<LabelsIndex>('labels.json')
  const [query, setQuery] = useState('')
  const [limit, setLimit] = useState(RESULT_LIMIT)
  const [open, setOpen] = useState<string | null>(null)

  const deferredQuery = useDeferredValue(query)
  const filtered = useMemo(() => (data ? filterLabels(data.l, deferredQuery) : []), [data, deferredQuery])
  const shown = filtered.slice(0, limit)

  if (error) return <div className="error">Ошибка: {error}</div>
  if (!data) return <div className="loading">Загрузка…</div>

  return (
    <div className="page">
      <h1>Agent labels <span className="muted">({fmtInt(data.l.length)} + {fmtInt(data.n_anon)} anonymous)</span></h1>

      <div className="filters">
        <input
          className="input"
          placeholder="Search agent…"
          value={query}
          onChange={(e) => {
            setQuery(e.target.value)
            setLimit(RESULT_LIMIT)
          }}
        />
        <span className="muted result-count">{fmtInt(filtered.length)}</span>
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
              <th />
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
                  <td>
                    {l.pgs.length > 0 && (
                      <button type="button" className="btn ghost sm" onClick={() => setOpen(open === l.x ? null : l.x)}>
                        {open === l.x ? 'hide' : 'pages'}
                      </button>
                    )}
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
          <button type="button" className="btn" onClick={() => setLimit((n) => n + RESULT_LIMIT)}>
            Load more ({fmtInt(filtered.length - shown.length)} remaining)
          </button>
        </div>
      )}
    </div>
  )
}