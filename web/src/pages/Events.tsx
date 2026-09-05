import { useDeferredValue, useMemo, useState } from 'react'
import { useData } from '../components/useQuery'
import { Badge, PageLink } from '../components/ui'
import type { EventType, RecentEvent } from '../types'
import { eventColor, fmtTime } from '../utils/format'

const PAGE_SIZE = 50

const TYPE_COLORS: Record<EventType, string> = {
  save: '#4f8cff',
  delete: '#ef4444',
  revert: '#ff9f43',
  probe: '#16a34a',
}

export default function Events() {
  const { data, error } = useData<RecentEvent[]>('recent_events.json')
  const [type, setType] = useState<'' | EventType>('')
  const [query, setQuery] = useState('')
  const [page, setPage] = useState(0)

  const deferredQuery = useDeferredValue(query)

  const filtered = useMemo(() => {
    if (!data) return []
    const q = deferredQuery.trim().toLowerCase()
    return data.filter((e) => {
      if (type && e.type !== type) return false
      if (q && !(e.page?.toLowerCase().includes(q) || e.ip16?.toLowerCase().includes(q) || e.action?.toLowerCase().includes(q))) return false
      return true
    })
  }, [data, type, deferredQuery])

  if (error) return <div className="error">Ошибка: {error}</div>
  if (!data) return <div className="loading">Загрузка…</div>

  const pages = Math.max(1, Math.ceil(filtered.length / PAGE_SIZE))
  const cur = Math.min(page, pages - 1)
  const shown = filtered.slice(cur * PAGE_SIZE, (cur + 1) * PAGE_SIZE)

  return (
    <div className="page">
      <h1>Events <span className="muted">({filtered.length} shown of {data.length})</span></h1>

      <div className="filters">
        <select className="input" value={type} onChange={(e) => { setType(e.target.value as '' | EventType); setPage(0) }}>
          <option value="">all types</option>
          {(Object.keys(TYPE_COLORS) as EventType[]).map((t) => (
            <option key={t} value={t}>{t}</option>
          ))}
        </select>
        <input className="input" placeholder="Search page / ip16 / action…" value={query} onChange={(e) => { setQuery(e.target.value); setPage(0) }} />
        <span className="muted result-count">
          page {cur + 1}/{pages}
        </span>
      </div>

      <div className="table-wrap">
        <table className="tbl">
          <thead>
            <tr>
              <th>Time</th>
              <th>Type</th>
              <th>Wiki</th>
              <th>Page / target</th>
              <th>Action</th>
              <th>IP16</th>
            </tr>
          </thead>
          <tbody>
            {shown.map((e, i) => (
              <tr key={`${e.t}-${i}`}>
                <td className="muted nowrap">{fmtTime(e.t)}</td>
                <td><Badge color={eventColor(e.type)}>{e.type}</Badge></td>
                <td>{e.wiki}</td>
                <td>
                  {e.page ? (
                    <PageLink id={e.page} name={e.page} max={70} />
                  ) : (
                    <span className="muted">—</span>
                  )}
                </td>
                <td className="muted">{e.action ?? '—'}</td>
                <td className="muted nowrap">{e.ip16 ?? '—'}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <div className="pager">
        <button type="button" className="btn ghost" disabled={cur === 0} onClick={() => setPage((p) => p - 1)}>← prev</button>
        <button type="button" className="btn ghost" disabled={cur >= pages - 1} onClick={() => setPage((p) => p + 1)}>next →</button>
      </div>
    </div>
  )
}