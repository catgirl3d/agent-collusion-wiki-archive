import { Fragment, useDeferredValue, useEffect, useMemo, useState } from 'react'
import { useSearchParams } from 'react-router-dom'
import { useData } from '../components/useQuery'
import { Badge, Button, Card, LoadMore, PageLink, SortHeader } from '../components/ui'
import { Ip16LabelList } from '../components/Ip16LabelList'
import type { LabelsIndex, LabelsIp16Index } from '../types'
import { filterLabels, fmtInt, toCsv } from '../utils/format'
import {
  IP16_CAVEAT,
  matchIp16Prefixes,
  ip16PrefixesByLabel,
  summarizeIp16Slice,
  type Ip16SliceSummary,
} from '../utils/ip16'
import { AGENTS_SORT_DEFAULT, AGENTS_SORT_DEFAULTS, AGENTS_SORT_KEYS, sortAgentLabels, type AgentsSortKey } from '../utils/agents'
import { resolveSort, updateSortSearchParams, writeSortParams } from '../utils/sort'
import { downloadBlob } from '../utils/download'

const RESULT_LIMIT = 50

function Ip16PrefixSummary({
  ip,
  summary,
  activeLabel,
  onPickLabel,
}: {
  ip: string
  summary: Ip16SliceSummary
  activeLabel: string
  onPickLabel: (label: string) => void
}) {
  return (
    <Card as="section" className="ip16-dossier" aria-label={`IP16 ${ip} summary`}>
      <div className="ip16-dossier-head">
        <h2 className="ip16-dossier-title">IP16 <span className="mono">{ip}</span></h2>
        <span className="muted">aggregated over the labels observed from the matched /16 prefixes; the name search is excluded</span>
      </div>

      <div className="ip16-metrics">
        <span className="ip16-metric"><b>{fmtInt(summary.labels)}</b> labels</span>
        <span className="ip16-metric"><b>{fmtInt(summary.revisions)}</b> labeled revisions</span>
        <span className="ip16-metric" title={summary.prefixes.join(', ')}><b>{fmtInt(summary.prefixes.length)}</b> prefixes</span>
        <span className="ip16-metric" title={summary.wikis.join(', ')}><b>{fmtInt(summary.wikis.length)}</b> wikis</span>
        {summary.first && summary.last && (
          <span className="ip16-metric"><b>{summary.first.slice(0, 10)}</b> → <b>{summary.last.slice(0, 10)}</b></span>
        )}
      </div>

      <Ip16LabelList
        stats={summary.labelWeights}
        activeLabel={activeLabel}
        onPickLabel={onPickLabel}
        ariaLabel="Labels on the matched prefixes"
      />

      <span className="muted ip16-caveat">{IP16_CAVEAT}</span>
    </Card>
  )
}

export default function Agents() {
  const { data, error } = useData<LabelsIndex>('labels.json')
  const { data: ip16Index, error: ip16Error } = useData<LabelsIp16Index>('labels_ip16.json')
  const [searchParams, setSearchParams] = useSearchParams()
  // URL ?q= is the external source of truth: applied as a key-reset when the param changes
  const urlQ = searchParams.get('q') ?? ''
  const rawIp = searchParams.get('ip')
  const ip = rawIp?.trim() ?? ''
  const rawSort = searchParams.get('sort')
  const rawDir = searchParams.get('dir')
  const sortState = useMemo(
    () => resolveSort(rawSort, rawDir, AGENTS_SORT_KEYS, AGENTS_SORT_DEFAULTS),
    [rawSort, rawDir],
  )
  const [query, setQuery] = useState(urlQ)
  const [lastUrlQ, setLastUrlQ] = useState(urlQ)
  const [limit, setLimit] = useState(RESULT_LIMIT)
  const [open, setOpen] = useState<string | null>(null)

  if (urlQ !== lastUrlQ) {
    setLastUrlQ(urlQ)
    setQuery(urlQ)
    setLimit(RESULT_LIMIT)
  }

  const update = (changes: Record<string, string | null>) => {
    const next = new URLSearchParams(searchParams)
    for (const [key, value] of Object.entries(changes)) {
      if (value) next.set(key, value)
      else next.delete(key)
    }
    setSearchParams(next, { replace: true })
    setLimit(RESULT_LIMIT)
  }

  const toggleSort = (key: AgentsSortKey) => {
    const next = updateSortSearchParams(searchParams, sortState, key, AGENTS_SORT_DEFAULTS, AGENTS_SORT_DEFAULT)
    setSearchParams(next, { replace: true })
    setLimit(RESULT_LIMIT)
  }

  // Legacy or hand-edited links self-heal like the timeline: a whitespace-only ip is dropped.
  useEffect(() => {
    const next = new URLSearchParams(searchParams)
    let changed = false
    if (rawIp !== null && rawIp !== ip) {
      if (ip) next.set('ip', ip)
      else next.delete('ip')
      changed = true
    }
    const beforeSort = next.toString()
    writeSortParams(next, sortState, AGENTS_SORT_DEFAULT)
    if (next.toString() !== beforeSort) changed = true
    if (changed) setSearchParams(next, { replace: true })
  }, [rawIp, ip, searchParams, setSearchParams, sortState])

  // The ip16 index is an enhancement: it may still be loading or may fail without
  // taking the label index down with it. While it is not ready the filter stays
  // disabled instead of silently showing unfiltered rows for an ?ip= request.
  const ip16Status: 'ready' | 'loading' | 'error' = ip16Error ? 'error' : ip16Index ? 'ready' : 'loading'
  const prefixesByLabel = useMemo(() => ip16PrefixesByLabel(ip16Index ?? null), [ip16Index])
  const matchedPrefixes = useMemo(() => (ip16Index ? matchIp16Prefixes(ip16Index, ip) : []), [ip16Index, ip])
  const ipSummary = useMemo(
    () => (ip16Index && ip ? summarizeIp16Slice(ip16Index, matchedPrefixes) : null),
    [ip16Index, ip, matchedPrefixes],
  )
  const allowedLabels = useMemo(
    () => (ip && ipSummary ? new Set(ipSummary.labelWeights.map((stat) => stat.x)) : null),
    [ip, ipSummary],
  )

  const deferredQuery = useDeferredValue(query)
  const filtered = useMemo(
    () => (data ? filterLabels(data.l, deferredQuery, allowedLabels) : []),
    [data, deferredQuery, allowedLabels],
  )
  const sorted = useMemo(
    () => sortAgentLabels(filtered, sortState.sort, sortState.dir, (label) => prefixesByLabel.get(label)?.length ?? 0),
    [filtered, sortState, prefixesByLabel],
  )
  const shown = sorted.slice(0, limit)

  const exportCsv = () => {
    const timestamp = Math.floor(Date.now() / 1000)
    const rows = sorted.map(({ x, r, p, f, t, h }) => ({ label: x, revs: r, pages: p, first: f, last: t, h }))
    downloadBlob(`agents-slice-${String(timestamp)}.csv`, toCsv(rows), 'text/csv;charset=utf-8')
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
        <input
          className="input"
          aria-label="Filter by IP16"
          placeholder="IP16…"
          value={ip}
          disabled={ip16Status !== 'ready'}
          onChange={(event) => { update({ ip: event.target.value || null }); }}
        />
        {ip16Status === 'error' && (
          <span className="error" role="status">ip16 index failed to load; the ip16 filter is disabled</span>
        )}
        {ip16Status === 'error' && ip && (
          <Button variant="ghost" size="sm" onClick={() => { update({ ip: null }); }}>clear ip16 filter</Button>
        )}
        {ip16Status === 'loading' && (
          <span className="muted" role="status">loading ip16 index…</span>
        )}
        <span className="muted result-count">{fmtInt(filtered.length)}</span>
        <Button onClick={exportCsv}>Export CSV</Button>
      </div>

      {ipSummary && ipSummary.labels > 0 && (
        <Ip16PrefixSummary
          key={ip}
          ip={ip}
          summary={ipSummary}
          activeLabel={query.trim()}
          onPickLabel={(value) => {
            setQuery(value === query.trim() ? '' : value)
            setLimit(RESULT_LIMIT)
          }}
        />
      )}

      <div className="table-wrap">
        <table className="tbl">
          <thead>
            <tr>
              <SortHeader label="Label" sortKey="label" current={sortState} onToggle={toggleSort} />
              <SortHeader label="Revs" sortKey="revs" current={sortState} numeric onToggle={toggleSort} />
              <SortHeader label="Pages" sortKey="pages" current={sortState} numeric onToggle={toggleSort} />
              <SortHeader label="First" sortKey="first" current={sortState} onToggle={toggleSort} />
              <SortHeader label="Last" sortKey="last" current={sortState} onToggle={toggleSort} />
              <SortHeader label="IP16" sortKey="ip16" current={sortState} numeric onToggle={toggleSort} />
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
                  <td className="num">
                    {ip16Status === 'ready' ? (
                      <Button
                        variant="ghost"
                        size="sm"
                        aria-label={`${l.x || '(empty)'}: ${fmtInt(prefixesByLabel.get(l.x)?.length ?? 0)} IP16 prefixes`}
                        aria-expanded={open === l.x}
                        onClick={() => { setOpen(open === l.x ? null : l.x); }}
                      >
                        {fmtInt(prefixesByLabel.get(l.x)?.length ?? 0)}
                      </Button>
                    ) : <span className="muted">—</span>}
                  </td>
                  <td>{l.w.join(', ') || '—'}</td>
                  <td>{l.h ? <Badge>human?</Badge> : <span className="muted">agent</span>}</td>
                  <td className="nowrap">
                    <div style={{ display: 'flex', gap: '6px' }}>
                      {l.pgs.length > 0 && (
                        <Button variant="ghost" size="sm" onClick={() => { setOpen(open === l.x ? null : l.x); }}>
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
                    <td colSpan={9}>
                      {l.pgs.length > 0 && (
                        <div className="pages-list">
                          {l.pgs.slice(0, 60).map((pid) => (
                            <PageLink key={pid} id={pid} name={pid} max={90} />
                          ))}
                          {l.pgs.length > 60 && <span className="muted">… and {l.pgs.length - 60} more</span>}
                        </div>
                      )}
                      {ip16Status === 'ready' && (
                        <div>
                          <strong>IP16 prefixes</strong>
                          {(prefixesByLabel.get(l.x)?.length ?? 0) > 0 ? (
                            <div className="pages-list">
                              {(prefixesByLabel.get(l.x) ?? []).map(([prefix, weight]) => {
                                const revisionLabel = `${fmtInt(weight)} ${weight === 1 ? 'revision' : 'revisions'}`
                                return (
                                  <Button
                                    key={prefix}
                                    variant="ghost"
                                    size="sm"
                                    aria-label={`Filter agents by IP16 prefix ${prefix} (${revisionLabel})`}
                                    title={`Filter agents by IP16 prefix ${prefix}`}
                                    onClick={() => update({ ip: prefix })}
                                  >
                                    <span className="mono">{prefix}</span> <span className="muted">{fmtInt(weight)} revs</span>
                                  </Button>
                                )
                              })}
                            </div>
                          ) : <span className="muted">No IP16 prefixes</span>}
                        </div>
                      )}
                    </td>
                  </tr>
                )}
              </Fragment>
            ))}
          </tbody>
        </table>
      </div>

      <LoadMore
        loaded={shown.length}
        total={filtered.length}
        onLoadMore={() => { setLimit((n) => n + RESULT_LIMIT); }}
        step={RESULT_LIMIT}
        unit="remaining"
      />
    </div>
  )
}
