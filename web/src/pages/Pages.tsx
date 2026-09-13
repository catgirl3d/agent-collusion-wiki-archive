import { useDeferredValue, useMemo, useState } from 'react'
import { Link, useSearchParams } from 'react-router-dom'
import { ArchiveCalendar } from '../components/ArchiveCalendar'
import { Dropdown } from '../components/Dropdown'
import { useData } from '../components/useQuery'
import { Badge, Chip, PageLink } from '../components/ui'
import type { DayActivity, PagesIndex, PayloadRecord, SearchIndex } from '../types'
import {
  WIKIS,
  aggregateDays,
  filterPages,
  filterPagesByDay,
  fmtInt,
  SOURCE_FILTER_OPTIONS,
  toCsv,
  wikiColor,
} from '../utils/format'
import type { SourceFilter } from '../utils/format'
import { downloadBlob } from '../utils/download'
import { PAYLOAD_FLAG_COLORS } from '../utils/payload'
import { lookupTokenPostings } from '../utils/search'

const PAGE_LIMIT = 50

const PAYLOAD_FLAGS_ORDER = ['b64', 'hex', 'script', 'inject', 'homoglyph', 'high-entropy', 'tunnel', 'redirect'] as const

export default function Pages() {
  const { data, error, loading } = useData<PagesIndex>('pages.json')
  const [query, setQuery] = useState('')
  const [wiki, setWiki] = useState('')
  const [src, setSrc] = useState<SourceFilter>('')
  const [deletedOnly, setDeletedOnly] = useState(false)
  const [minRevs, setMinRevs] = useState(0)
  const [fam, setFam] = useState('')
  const [payloadFlag, setPayloadFlag] = useState('')
  const [limit, setLimit] = useState(PAGE_LIMIT)
  const [copied, setCopied] = useState(false)
  const [searchParams, setSearchParams] = useSearchParams()
  const day = searchParams.get('day') ?? ''

  const deferredQuery = useDeferredValue(query)
  // the full-text index is only needed for queries of ≥3 chars (build.py tokenizer minimum)
  const needsIndex = deferredQuery.trim().length >= 3
  const { data: searchIndex } = useData<SearchIndex>('search_index.json')
  // the payload index is small (~70 KB) — loaded for the badge column and flag filter
  const { data: payloadIndex } = useData<PayloadRecord[]>('payload_index.json')
  // per-day activity — for the hint shown when a day has no text edits (deletions only)
  const { data: activity } = useData<DayActivity[]>('activity_by_day.json')

  const payloadByPage = useMemo(() => {
    const map = new Map<string, string[]>()
    if (!payloadIndex) return map
    for (const record of payloadIndex) {
      map.set(record.id, record.f)
      map.set(record.s, record.f)
    }
    return map
  }, [payloadIndex])

  const tokenSlugs = useMemo(
    () => (needsIndex ? lookupTokenPostings(searchIndex, deferredQuery) : null),
    [needsIndex, searchIndex, deferredQuery],
  )

  const filtered = useMemo(
    () => (data ? filterPagesByDay(filterPages(data.p, { query: deferredQuery, wiki, fam, deletedOnly, minRevs, tokenSlugs, payloadFlag, payloadFlags: payloadByPage, src }), day) : []),
    [data, day, deferredQuery, wiki, fam, deletedOnly, minRevs, tokenSlugs, payloadFlag, payloadByPage, src],
  )

  const dayStats = useMemo(() => {
    if (!day || !activity) return null
    return aggregateDays(activity).find((a) => a.date === day) ?? null
  }, [day, activity])

  const families = useMemo(() => {
    if (!data) return []
    const counts = new Map<string, number>()
    for (const page of data.p) if (page.fam) counts.set(page.fam, (counts.get(page.fam) ?? 0) + 1)
    return [...counts.entries()].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
  }, [data])

  const exportFile = (extension: 'json' | 'csv') => {
    const timestamp = Math.floor(Date.now() / 1000)
    const content = extension === 'json' ? JSON.stringify(filtered) : toCsv(filtered as unknown as Record<string, unknown>[])
    downloadBlob(
      `pages-slice-${timestamp}.${extension}`,
      content,
      extension === 'json' ? 'application/json' : 'text/csv;charset=utf-8',
    )
  }

  const copyPython = () => {
    const timestamp = Math.floor(Date.now() / 1000)
    void navigator.clipboard.writeText(`import pandas as pd\n# Full index:\ndf = pd.read_json("/data/pages.json")\n# Or load your exported slice file:\n# df = pd.read_json("pages-slice-${timestamp}.json")\nprint(df.head())`).then(() => {
      setCopied(true)
      window.setTimeout(() => setCopied(false), 2000)
    })
  }

  if (error) return <div className="error">Error: {error}</div>
  if (!data || loading) return <div className="loading">Loading…</div>

  const shown = filtered.slice(0, limit)

  return (
    <div className="page">
      <h1>Pages <span className="muted">({fmtInt(data.p.length)})</span></h1>

      <div className="filters">
        <ArchiveCalendar
          ariaLabel="Filter by day"
          value={day}
          onChange={(date) => { const next = new URLSearchParams(searchParams); if (date) next.set('day', date); else next.delete('day'); setSearchParams(next); setLimit(PAGE_LIMIT) }}
        />
        <input aria-label="Search pages" className="input" placeholder="Search name / id / agent label / full text…" value={query} onChange={(e) => { setQuery(e.target.value); setLimit(PAGE_LIMIT) }} />
        <Dropdown
          value={src}
          ariaLabel="Filter by source"
           options={SOURCE_FILTER_OPTIONS}
          onChange={(value) => { setSrc(value); setLimit(PAGE_LIMIT) }}
        />
        <Dropdown
          value={wiki}
          ariaLabel="Filter by wiki"
          options={[{ value: '', label: 'all wikis' }, ...WIKIS.map((w) => ({ value: w, label: w }))]}
          onChange={(value) => { setWiki(value); setLimit(PAGE_LIMIT) }}
        />
        <Dropdown
          value={fam}
          ariaLabel="Filter by family"
          options={[{ value: '', label: 'all families' }, ...families.map(([name, count]) => ({ value: name, label: `${name} (${count})` }))]}
          onChange={(value) => { setFam(value); setLimit(PAGE_LIMIT) }}
        />
        <Dropdown
          value={minRevs}
          ariaLabel="Minimum revisions"
          options={[{ value: 0, label: 'any revs' }, { value: 2, label: '≥ 2 revs' }, { value: 10, label: '≥ 10 revs' }, { value: 50, label: '≥ 50 revs' }]}
          onChange={(value) => { setMinRevs(value); setLimit(PAGE_LIMIT) }}
        />
        <Dropdown
          value={payloadFlag}
          ariaLabel="Filter by payload flag"
          options={[
            { value: '', label: 'all payload flags' },
            ...PAYLOAD_FLAGS_ORDER.map((flag) => ({
              value: flag,
              label: `${flag} (${payloadByPage && data ? data.p.filter((p) => (payloadByPage.get(p.id) ?? []).includes(flag)).length : 0})`,
            })),
          ]}
          onChange={(value) => { setPayloadFlag(value); setLimit(PAGE_LIMIT) }}
        />
        <label className="check">
          <input type="checkbox" checked={deletedOnly} onChange={(e) => { setDeletedOnly(e.target.checked); setLimit(PAGE_LIMIT) }} />
          deleted only
        </label>
        <span className="muted result-count">{fmtInt(filtered.length)} of {fmtInt(data.p.length)}{tokenSlugs !== null && ` · full-text: ${tokenSlugs.length} pages`}</span>
      </div>
      {day && filtered.length === 0 && dayStats && (
        <div className="day-empty">
          {dayStats.deletes > 0
            ? <>No revisions saved on this date. <Link className="link" to={`/events?day=${day}`}>View {fmtInt(dayStats.deletes)} deletion{dayStats.deletes === 1 ? '' : 's'} in Events →</Link></>
            : <span className="muted">No activity on this date.</span>}
        </div>
      )}

      <div className="filters">
        <button type="button" className="btn" onClick={() => exportFile('json')}>Export JSON</button>
        <button type="button" className="btn" onClick={() => exportFile('csv')}>Export CSV</button>
        <button type="button" className="btn" onClick={copyPython}>{copied ? 'Copied!' : 'Copy as Python'}</button>
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
              <th>Payload</th>
            </tr>
          </thead>
          <tbody>
            {shown.map((p) => {
              const flags = payloadByPage.get(p.id) ?? []
              return (
              <tr key={p.id} className={p.d ? 'row-deleted' : undefined}>
                <td>
                  <PageLink id={p.id} name={p.n} max={64} />
                   {p.d && <Chip tone="del">deleted</Chip>}
                   {p.partial && <Chip>recovered</Chip>}
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
                <td className="payload-cell">
                  {flags.length > 0
                    ? PAYLOAD_FLAGS_ORDER.filter((flag) => flags.includes(flag)).map((flag) => (
                        <Badge key={flag} color={PAYLOAD_FLAG_COLORS[flag]}>{flag}</Badge>
                      ))
                    : <span className="muted">—</span>}
                </td>
              </tr>
              )
            })}
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
