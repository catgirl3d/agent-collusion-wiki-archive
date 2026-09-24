import { useEffect, useMemo, useState } from 'react'
import { useSearchParams } from 'react-router-dom'
import { ArchiveCalendar } from '../components/ArchiveCalendar'
import { Dropdown } from '../components/Dropdown'
import { useData } from '../components/useQuery'
import { Badge, Button, Card, LoadMore, PageLink, SortHeader } from '../components/ui'
import type { TimelineFile } from '../types'
import { fmtInt, fmtTime, SOURCE_FILTER_OPTIONS } from '../utils/format'
import type { SourceFilter } from '../utils/format'
import {
  filterTimeline,
  getTimelinePageName,
  sortTimelineRows,
  summarizeTimeline,
  TIMELINE_PAGE_SIZE,
  TIMELINE_SORT_DEFAULT,
  TIMELINE_SORT_DEFAULTS,
  TIMELINE_SORT_KEYS,
  type TimelineSortKey,
  type TimelineSummary,
} from '../utils/timeline'
import { resolveSort, updateSortSearchParams, writeSortParams } from '../utils/sort'
import { applyDateBound } from '../utils/dateRange'

const MAX_PAGE = 5_000
const IP16_TOP_LABELS = 12

function Ip16Dossier({
  ip,
  summary,
  activeLabel,
  onPickLabel,
}: {
  ip: string
  summary: TimelineSummary
  activeLabel: string
  onPickLabel: (value: string) => void
}) {
  const [expanded, setExpanded] = useState(false)
  const shown = expanded ? summary.topLabels : summary.topLabels.slice(0, IP16_TOP_LABELS)
  const hidden = summary.topLabels.length - shown.length

  return (
    <Card as="section" className="ip16-dossier" aria-label={`IP16 ${ip} dossier`}>
      <div className="ip16-dossier-head">
        <h2 className="ip16-dossier-title">IP16 <span className="mono">{ip}</span></h2>
        <span className="muted">aggregated over the prefix slice; the label filter is excluded</span>
      </div>

      <div className="ip16-metrics">
        <span className="ip16-metric"><b>{fmtInt(summary.total)}</b> revisions</span>
        <span className="ip16-metric"><b>{fmtInt(summary.labels)}</b> labels</span>
        {summary.anon > 0 && <span className="ip16-metric"><b>{fmtInt(summary.anon)}</b> anonymous</span>}
        {summary.recovered > 0 && <span className="ip16-metric"><b>{fmtInt(summary.recovered)}</b> recovered</span>}
        <span className="ip16-metric"><b>{fmtInt(summary.pages)}</b> pages</span>
        <span className="ip16-metric" title={summary.wikis.join(', ')}><b>{fmtInt(summary.wikis.length)}</b> wikis</span>
        {summary.first && summary.last && (
          <span className="ip16-metric"><b>{summary.first.slice(0, 10)}</b> → <b>{summary.last.slice(0, 10)}</b></span>
        )}
      </div>

      <div className={`ip16-labels${expanded ? ' is-expanded' : ''}`} role="group" aria-label="Top labels for this prefix">
        {shown.map((stat) => {
          const active = stat.x === activeLabel
          return (
            <Button
              key={stat.x}
              type="button"
              variant="ghost"
              size="sm"
              className={`ip16-label${active ? ' active' : ''}`}
              aria-pressed={active}
              title={active ? 'Clear the label filter' : `Filter the table by ${stat.x}`}
              onClick={() => onPickLabel(stat.x)}
            >
              <span>{stat.x}</span>
              <span className="n">{fmtInt(stat.n)}</span>
            </Button>
          )
        })}
        {hidden > 0 && (
          <Button type="button" variant="ghost" size="sm" className="ip16-label ip16-label-more" onClick={() => setExpanded(true)}>
            +{fmtInt(hidden)} more
          </Button>
        )}
        {expanded && summary.topLabels.length > IP16_TOP_LABELS && (
          <Button type="button" variant="ghost" size="sm" className="ip16-label ip16-label-more" onClick={() => setExpanded(false)}>
            show top {IP16_TOP_LABELS}
          </Button>
        )}
      </div>

      <span className="muted ip16-caveat">ip16 is a truncated /16 network indicator; it cannot identify a host, organization, or person.</span>
    </Card>
  )
}

export default function Timeline() {
  const { data, error } = useData<TimelineFile>('timeline.json')
  const [searchParams, setSearchParams] = useSearchParams()

  const label = searchParams.get('label') ?? ''
  const wiki = searchParams.get('wiki') ?? ''
  const rawIp = searchParams.get('ip')
  const ip = rawIp?.trim() ?? ''
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
    if (rawIp !== null && rawIp !== ip) {
      if (ip) next.set('ip', ip)
      else next.delete('ip')
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
  }, [searchParams, setSearchParams, day, from, to, sortState, rawSrc, src, rawPage, page, rawIp, ip])

  const wikis = useMemo(() => [...new Set((data?.r ?? []).map((row) => row.w))].sort(), [data])

  const filtered = useMemo(() => {
    if (!data) return []
    const rows = filterTimeline(data.r, { label, wiki, ip, day, from, to, src })
    return sortTimelineRows(rows, sortState.sort, sortState.dir)
  }, [data, label, wiki, ip, day, from, to, sortState, src])

  // The dossier describes the whole prefix slice under the non-label filters, so its label
  // ranking stays a navigation list while the table narrows to one label.
  const ipSlice = useMemo(
    () => (data && ip ? filterTimeline(data.r, { wiki, ip, day, from, to, src }) : []),
    [data, wiki, ip, day, from, to, src],
  )
  const ipSummary = useMemo(() => (ip ? summarizeTimeline(ipSlice) : null), [ip, ipSlice])

  const pickIpLabel = (value: string) => update({ label: value === label ? null : value })

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
        <input
          className="input"
          aria-label="Filter by IP16"
          placeholder="IP16…"
          value={ip}
          onChange={(event) => update({ ip: event.target.value || null })}
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

      {ipSummary && ipSummary.total > 0 && (
        <Ip16Dossier key={ip} ip={ip} summary={ipSummary} activeLabel={label} onPickLabel={pickIpLabel} />
      )}

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
