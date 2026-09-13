import { useEffect, useMemo } from 'react'
import { useSearchParams } from 'react-router-dom'
import { ArchiveCalendar } from '../components/ArchiveCalendar'
import { Dropdown } from '../components/Dropdown'
import { useData } from '../components/useQuery'
import { Badge, PageLink } from '../components/ui'
import type { TimelineFile } from '../types'
import { fmtInt, fmtTime, SOURCE_FILTER_OPTIONS } from '../utils/format'
import type { SourceFilter } from '../utils/format'
import { filterTimeline, pageSlice } from '../utils/timeline'

export default function Timeline() {
  const { data, error } = useData<TimelineFile>('timeline.json')
  const [searchParams, setSearchParams] = useSearchParams()

  const label = searchParams.get('label') ?? ''
  const wiki = searchParams.get('wiki') ?? ''
  const day = searchParams.get('day') ?? ''
  const from = searchParams.get('from') ?? ''
  const to = searchParams.get('to') ?? ''
  const rawSrc = searchParams.get('src')
  const src: SourceFilter = rawSrc === 'canonical' || rawSrc === 'recovered' ? rawSrc : ''
  const order = searchParams.get('order') === 'asc' ? 'asc' : 'desc'
  const page = Math.max(0, Number(searchParams.get('page') ?? '0') || 0)

  const update = (changes: Record<string, string | null>, resetPage = true) => {
    const next = new URLSearchParams(searchParams)
    for (const [key, value] of Object.entries(changes)) {
      if (value) next.set(key, value)
      else next.delete(key)
    }
    if (resetPage) next.delete('page')
    setSearchParams(next, { replace: true })
  }

  // The exact day and the date range are mutually exclusive: picking one clears the other,
  // and a freshly picked bound wins over a stale bound that would invert the range.
  const pickDay = (date: string) => update(date ? { day: date, from: null, to: null } : { day: null })
  const pickFrom = (date: string) => update(date ? { from: date, day: null, ...(to && date > to ? { to: null } : {}) } : { from: null })
  const pickTo = (date: string) => update(date ? { to: date, day: null, ...(from && date < from ? { from: null } : {}) } : { to: null })

  // Legacy or hand-edited links self-heal to the same contract: the day wins over a range,
  // and an inverted range keeps its start.
  useEffect(() => {
    const next = new URLSearchParams(searchParams)
    let changed = false
    if (day && (from || to)) {
      next.delete('from')
      next.delete('to')
      changed = true
    } else if (from && to && from > to) {
      next.delete('to')
      changed = true
    }
    if (changed) {
      next.delete('page')
      setSearchParams(next, { replace: true })
    }
  }, [searchParams, setSearchParams, day, from, to])

  const wikis = useMemo(() => [...new Set((data?.r ?? []).map((row) => row.w))].sort(), [data])

  const filtered = useMemo(() => {
    if (!data) return []
    const rows = filterTimeline(data.r, { label, wiki, day, from, to, src })
    if (order === 'asc') {
      return [...rows].sort(
        (a, b) => a.t.localeCompare(b.t) || a.id.localeCompare(b.id) || (a.seq ?? 0) - (b.seq ?? 0),
      )
    }
    return rows
  }, [data, label, wiki, day, from, to, order, src])

  if (error) return <div className="error">Error: {error}</div>
  if (!data) return <div className="loading">Loading…</div>

  const paged = pageSlice(filtered, page)

  return (
    <div className="page">
      <h1>Timeline <span className="muted">({fmtInt(filtered.length)} of {fmtInt(data.r.length)} revisions)</span></h1>

      <div className="filters">
        <input
          className="input"
          placeholder="Agent label…"
          value={label}
          onChange={(event) => update({ label: event.target.value || null })}
        />
        <Dropdown<SourceFilter>
          value={src}
          ariaLabel="Filter by source"
          options={SOURCE_FILTER_OPTIONS}
          onChange={(value) => update({ src: value || null })}
        />
        <Dropdown
          value={wiki}
          ariaLabel="Filter by wiki"
          options={[{ value: '', label: 'all wikis' }, ...wikis.map((name) => ({ value: name, label: name }))]}
          onChange={(value) => update({ wiki: value || null })}
        />
        <Dropdown
          value={order}
          ariaLabel="Sort timeline order"
          options={[{ value: 'desc', label: 'newest first' }, { value: 'asc', label: 'oldest first' }]}
          onChange={(value) => update({ order: value === 'asc' ? 'asc' : null })}
        />
        <ArchiveCalendar ariaLabel="Filter by day" placeholder="day" value={day} onChange={pickDay} />
        <ArchiveCalendar ariaLabel="Filter from date" placeholder="from" value={from} onChange={pickFrom} />
        <ArchiveCalendar ariaLabel="Filter to date" placeholder="to" value={to} onChange={pickTo} />
        <span className="muted result-count">page {paged.page + 1}/{paged.pages}</span>
      </div>

      <div className="table-wrap">
        <table className="tbl">
          <thead>
            <tr>
              <th>Time</th>
              <th>Wiki</th>
              <th>Page</th>
              <th>Label</th>
              <th>Action</th>
              <th>IP16</th>
              <th className="num">Len</th>
            </tr>
          </thead>
          <tbody>
            {paged.rows.map((row, index) => (
              <tr key={`${row.id}-${row.seq}-${row.t}-${index}`}>
                <td className="muted nowrap">{fmtTime(row.t)}</td>
                <td>{row.w}</td>
                <td><PageLink id={row.id} name={row.id.split('/').slice(1).join('/') || row.id} max={70} /></td>
                <td>{row.partial ? <Badge>recovered</Badge> : row.x ? <Badge>{row.x}</Badge> : <span className="muted">anon</span>}</td>
                <td className="muted">{row.a ?? '—'}</td>
                <td className="muted nowrap">{row.ip ?? '—'}</td>
                <td className="num muted">{row.l ?? '—'}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <div className="pager">
        <button
          type="button"
          className="btn ghost"
          disabled={paged.page === 0}
          onClick={() => update({ page: String(Math.max(0, paged.page - 1)) }, false)}
        >
          ← prev
        </button>
        <button
          type="button"
          className="btn ghost"
          disabled={paged.page >= paged.pages - 1}
          onClick={() => update({ page: String(paged.page + 1) }, false)}
        >
          next →
        </button>
      </div>
    </div>
  )
}
