import { useDeferredValue, useMemo, useState } from 'react'
import { useSearchParams } from 'react-router-dom'
import { ArchiveCalendar } from '../components/ArchiveCalendar'
import { Dropdown } from '../components/Dropdown'
import { useData } from '../components/useQuery'
import { Badge, PageLink } from '../components/ui'
import type { EventType, RecentEvent } from '../types'
import { EVENT_FILTER_OPTIONS, eventColor, eventPageId, filterEventsByDay, fmtInt, fmtTime } from '../utils/format'

const PAGE_SIZE = 50

export default function Events() {
  const { data, error } = useData<RecentEvent[]>('recent_events.json')
  const [type, setType] = useState<'' | EventType>('')
  const [query, setQuery] = useState('')
  const [page, setPage] = useState(0)
  const [searchParams, setSearchParams] = useSearchParams()
  const day = searchParams.get('day') ?? ''

  const deferredQuery = useDeferredValue(query)

  const filtered = useMemo(() => {
    if (!data) return []
    const q = deferredQuery.trim().toLowerCase()
    return filterEventsByDay(data, day).filter((e) => {
      if (type && e.type !== type) return false
      if (q && !(e.page?.toLowerCase().includes(q) || e.ip16?.toLowerCase().includes(q) || e.action?.toLowerCase().includes(q))) return false
      return true
    })
  }, [data, day, type, deferredQuery])

  if (error) return <div className="error">Error: {error}</div>
  if (!data) return <div className="loading">Loading…</div>

  const pages = Math.max(1, Math.ceil(filtered.length / PAGE_SIZE))
  const cur = Math.min(page, pages - 1)
  const shown = filtered.slice(cur * PAGE_SIZE, (cur + 1) * PAGE_SIZE)

  return (
    <div className="page">
      <h1>Events <span className="muted">({filtered.length} shown of {fmtInt(data.length)})</span></h1>

      <div className="filters">
        <ArchiveCalendar
          ariaLabel="Filter by day"
          value={day}
          onChange={(date) => { const next = new URLSearchParams(searchParams); if (date) next.set('day', date); else next.delete('day'); setSearchParams(next); setPage(0) }}
        />
        <Dropdown
          value={type}
          ariaLabel="Filter by event type"
          options={EVENT_FILTER_OPTIONS}
          onChange={(value) => { setType(value); setPage(0) }}
        />
        <input aria-label="Search page / ip16 / action" className="input" placeholder="Search page / ip16 / action…" value={query} onChange={(e) => { setQuery(e.target.value); setPage(0) }} />
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
              <th>Details</th>
            </tr>
          </thead>
          <tbody>
            {shown.map((e, i) => (
              <tr key={`${e.t}-${i}`}>
                <td className="muted nowrap">{fmtTime(e.t)}</td>
                <td><Badge color={eventColor(e.type)}>{e.type}</Badge></td>
                <td>{e.wiki || '—'}</td>
                <td>
                  {e.page ? (
                    <PageLink id={eventPageId(e)} name={e.page} max={70} />
                  ) : (
                    <span className="muted">—</span>
                  )}
                </td>
                <td className="muted">{e.action ?? '—'}</td>
                <td className="muted nowrap">{e.ip16 ?? '—'}</td>
                <td className="muted">
                  {e.type === 'probe' && e.pf && (
                    <>
                      <Badge color="#16a34a">{e.pf}</Badge>{' '}
                      {e.ok === false && <Badge color="#f87171">failed</Badge>}
                    </>
                  )}
                  {e.type === 'save' && e.rev && <span className="mono" title={e.rev}>{e.rev}</span>}
                  {(e.type === 'revert' || e.type === 'delete') && e.act && <Badge color="#fbbf24">{e.act}</Badge>}
                   {e.type === 'revert' && e.rel && <span className="mono" title={e.rel}> {e.rel}</span>}
                   {e.partial && <Badge>recovered</Badge>}
                   {!e.partial && !((e.type === 'probe' && e.pf) || (e.type === 'save' && e.rev) || ((e.type === 'revert' || e.type === 'delete') && e.act) || (e.type === 'revert' && e.rel)) && '—'}
                </td>
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
