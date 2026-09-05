import { useDeferredValue, useMemo, useState } from 'react'
import { useData } from '../components/useQuery'
import { Chip, PageLink } from '../components/ui'
import type { PagesIndex } from '../types'
import { WIKIS, filterPages, fmtInt, wikiColor } from '../utils/format'

const PAGE_LIMIT = 50

export default function Pages() {
  const { data, error, loading } = useData<PagesIndex>('pages.json')
  const [query, setQuery] = useState('')
  const [wiki, setWiki] = useState('')
  const [deletedOnly, setDeletedOnly] = useState(false)
  const [minRevs, setMinRevs] = useState(0)
  const [limit, setLimit] = useState(PAGE_LIMIT)

  const deferredQuery = useDeferredValue(query)

  const filtered = useMemo(
    () => (data ? filterPages(data.p, { query: deferredQuery, wiki, deletedOnly, minRevs }) : []),
    [data, deferredQuery, wiki, deletedOnly, minRevs],
  )

  if (error) return <div className="error">Ошибка: {error}</div>
  if (!data || loading) return <div className="loading">Загрузка…</div>

  const shown = filtered.slice(0, limit)

  return (
    <div className="page">
      <h1>Pages <span className="muted">({fmtInt(data.p.length)})</span></h1>

      <div className="filters">
        <input className="input" placeholder="Search name / id / agent label…" value={query} onChange={(e) => { setQuery(e.target.value); setLimit(PAGE_LIMIT) }} />
        <select className="input" value={wiki} onChange={(e) => { setWiki(e.target.value); setLimit(PAGE_LIMIT) }}>
          <option value="">all wikis</option>
          {WIKIS.map((w) => (
            <option key={w} value={w}>{w}</option>
          ))}
        </select>
        <select className="input" value={minRevs} onChange={(e) => { setMinRevs(Number(e.target.value)); setLimit(PAGE_LIMIT) }}>
          <option value={0}>any revs</option>
          <option value={2}>≥ 2 revs</option>
          <option value={10}>≥ 10 revs</option>
          <option value={50}>≥ 50 revs</option>
        </select>
        <label className="check">
          <input type="checkbox" checked={deletedOnly} onChange={(e) => { setDeletedOnly(e.target.checked); setLimit(PAGE_LIMIT) }} />
          deleted only
        </label>
        <span className="muted result-count">{fmtInt(filtered.length)} of {fmtInt(data.p.length)}</span>
      </div>

      <div className="table-wrap">
        <table className="tbl pages">
          <thead>
            <tr>
              <th>Page</th>
              <th>Wiki</th>
              <th className="num">Revs</th>
              <th className="num">Dels</th>
              <th>First</th>
              <th>Last</th>
              <th className="num">Labels</th>
              <th>Agents</th>
            </tr>
          </thead>
          <tbody>
            {shown.map((p) => (
              <tr key={p.id} className={p.d ? 'row-deleted' : undefined}>
                <td>
                  <PageLink id={p.id} name={p.n} max={64} />
                  {p.d && <Chip tone="del">deleted</Chip>}
                </td>
                <td>
                  <Chip tone="wiki" ><span style={{ color: wikiColor(p.w) }}>{p.w}</span></Chip>
                </td>
                <td className="num">{p.r}</td>
                <td className="num muted">{p.del || ''}</td>
                <td className="muted nowrap">{p.f}</td>
                <td className="muted nowrap">{p.l}</td>
                <td className="num">{p.lb}</td>
                <td className="labs-cell">
                  {p.labs.slice(0, 3).map((l) => (
                    <span key={l} className="mini-lab">{l}</span>
                  ))}
                  {p.lb > 3 && <span className="muted">+{p.lb - 3}</span>}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {filtered.length > shown.length && (
        <button type="button" className="btn" onClick={() => setLimit((n) => n + PAGE_LIMIT)}>
          Load more ({fmtInt(filtered.length - shown.length)} left)
        </button>
      )}
    </div>
  )
}