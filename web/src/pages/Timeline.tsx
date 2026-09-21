import { useEffect, useMemo } from 'react'
import { useSearchParams } from 'react-router-dom'
import { ArchiveCalendar } from '../components/ArchiveCalendar'
import { Dropdown } from '../components/Dropdown'
import { useData } from '../components/useQuery'
import { Badge, LoadMore, PageLink, SortHeader } from '../components/ui'
import type { TimelineFile } from '../types'
import { fmtInt, fmtTime, SOURCE_FILTER_OPTIONS } from '../utils/format'
import type { SourceFilter } from '../utils/format'
import {
  filterTimeline,
  getTimelinePageName,
  sortTimelineRows,
  TIMELINE_PAGE_SIZE,
  TIMELINE_SORT_DEFAULT,
  TIMELINE_SORT_DEFAULTS,
  TIMELINE_SORT_KEYS,
  type TimelineSortKey,
} from '../utils/timeline'
import { resolveSort, updateSortSearchParams, writeSortParams } from '../utils/sort'
import { applyDateBound } from '../utils/dateRange'

const MAX_PAGE = 5_000

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
  const rawSort = searchParams.get('sort')
  const legacyOrder = searchParams.get('order')
  const rawDir = rawSort ? searchParams.get('dir') : (legacyOrder === 'asc' ? 'asc' : null)
  const sortState = useMemo(
    () => resolveSort(rawSort ?? (legacyOrder === 'asc' ? 'time' : null), rawDir, TIMELINE_SORT_KEYS, TIMELINE_SORT_DEFAULTS),
    [rawSort, rawDir, legacyOrder],
  )
  const rawPage = searchParams.get('page')
  const parsedPage = rawPage === null ? 0 : Number(rawPage)
  const page = Number.isFinite(parsedPage) ? Math.min(MAX_PAGE, Math.max(0, Math.floor(parsedPage))) : 0

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
  const pickFrom = (date: string) => {
    const range = applyDateBound({ from, to }, 'from', date)
    update(date ? { from: date, to: range.to || null, day: null } : { from: null })
  }
  const pickTo = (date: string) => {
    const range = applyDateBound({ from, to }, 'to', date)
    update(date ? { from: range.from || null, to: date, day: null } : { to: null })
  }

  // Legacy or hand-edited links self-heal to the same contract: the day wins over a range,
  // and an inverted range keeps its start.
  useEffect(() => {
    const next = new URLSearchParams(searchParams)
    let changed = false
    let resetPage = false
    if (rawSrc !== null && src === '') {
      next.delete('src')
      changed = true
    }
    if (day && (from || to)) {
      next.delete('from')
      next.delete('to')
      changed = true
      resetPage = true
    } else if (from && to && from > to) {
      next.delete('to')
      changed = true
      resetPage = true
    }
    if (next.has('order')) {
      next.delete('order')
      changed = true
    }
    if (rawPage !== null && rawPage !== String(page)) {
      if (page === 0) next.delete('page')
      else next.set('page', String(page))
      changed = true
    }
    const beforeSort = next.toString()
    writeSortParams(next, sortState, TIMELINE_SORT_DEFAULT)
    if (next.toString() !== beforeSort) changed = true
    if (changed) {
      if (resetPage) next.delete('page')
      setSearchParams(next, { replace: true })
    }
  }, [searchParams, setSearchParams, day, from, to, sortState, rawSrc, src, rawPage, page])

  const wikis = useMemo(() => [...new Set((data?.r ?? []).map((row) => row.w))].sort(), [data])

  const filtered = useMemo(() => {
    if (!data) return []
    const rows = filterTimeline(data.r, { label, wiki, day, from, to, src })
    return sortTimelineRows(rows, sortState.sort, sortState.dir)
  }, [data, label, wiki, day, from, to, sortState, src])

  const toggleSort = (key: TimelineSortKey) => {
    const next = updateSortSearchParams(searchParams, sortState, key, TIMELINE_SORT_DEFAULTS, TIMELINE_SORT_DEFAULT)
    setSearchParams(next)
  }

  if (error) return <div className="error">Error: {error}</div>
  if (!data) return <div className="loading">Loading…</div>

  const visibleCount = Math.min(filtered.length, (page + 1) * TIMELINE_PAGE_SIZE)
  const shownRows = filtered.slice(0, visibleCount)

  return (
    <div className="page">
      <h1>Timeline <span className="muted">({fmtInt(filtered.length)} of {fmtInt(data.r.length)} revisions)</span></h1>

      <div className="filters">
        <input
          className="input"
          aria-label="Filter by agent label"
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
        <ArchiveCalendar ariaLabel="Filter by day" placeholder="day" value={day} onChange={pickDay} />
        <ArchiveCalendar ariaLabel="Filter from date" placeholder="from" value={from} onChange={pickFrom} />
        <ArchiveCalendar ariaLabel="Filter to date" placeholder="to" value={to} onChange={pickTo} />
        <span className="muted result-count">{filtered.length === 0 ? 'no matches' : `showing ${fmtInt(shownRows.length)} of ${fmtInt(filtered.length)} revisions`}</span>
      </div>

      <div className="table-wrap">
        <table className="tbl">
          <thead>
            <tr>
              <SortHeader label="Time" sortKey="time" current={sortState} onToggle={toggleSort} />
              <SortHeader label="Wiki" sortKey="wiki" current={sortState} onToggle={toggleSort} />
              <SortHeader label="Page" sortKey="page" current={sortState} onToggle={toggleSort} />
              <SortHeader label="Label" sortKey="label" current={sortState} onToggle={toggleSort} />
              <SortHeader label="Action" sortKey="action" current={sortState} onToggle={toggleSort} />
              <SortHeader label="IP16" sortKey="ip" current={sortState} onToggle={toggleSort} />
              <SortHeader label="Len" sortKey="len" current={sortState} numeric onToggle={toggleSort} />
            </tr>
          </thead>
          <tbody>
            {shownRows.map((row, index) => (
              <tr key={`${row.id}-${row.seq}-${row.t}-${index}`}>
                <td className="muted nowrap">{fmtTime(row.t)}</td>
                <td>{row.w}</td>
                <td><PageLink id={row.id} name={getTimelinePageName(row.id)} max={70} /></td>
                <td>{row.partial ? <Badge>recovered</Badge> : row.x ? <Badge>{row.x}</Badge> : <span className="muted">anon</span>}</td>
                <td className="muted">{row.a ?? '—'}</td>
                <td className="muted nowrap">{row.ip ?? '—'}</td>
                <td className="num muted">{row.l ?? '—'}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <LoadMore
        loaded={shownRows.length}
        total={filtered.length}
        onLoadMore={() => update({ page: String(page + 1) }, false)}
        step={TIMELINE_PAGE_SIZE}
      />
    </div>
  )
}
