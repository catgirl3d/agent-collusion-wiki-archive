import { useDeferredValue, useMemo, useState } from 'react'
import { useData } from '../components/useQuery'
import { Badge, PageLink } from '../components/ui'
import type { ConflictRow, PageRecord, PagesIndex } from '../types'
import { fmtDuration } from '../utils/format'

const PAGE_SIZE = 50
const ZZZ_COLOR = '#f59e0b'
const FRONT_COLOR = '#38bdf8'

export default function Conflicts() {
  const { data: conflicts, error: conflictsError } = useData<ConflictRow[]>('conflicts.json')
  const { data: pages, error: pagesError } = useData<PagesIndex>('pages.json')
  const [query, setQuery] = useState('')
  const [frontOnly, setFrontOnly] = useState(false)
  const [zzzOnly, setZzzOnly] = useState(false)
  const [page, setPage] = useState(0)
  const deferredQuery = useDeferredValue(query)

  const names = useMemo(() => {
    if (!pages) return new Map<string, string>()
    return new Map<string, string>(pages.p.map((record: PageRecord) => [record.id, record.n]))
  }, [pages])

  const filtered = useMemo(() => {
    if (!conflicts) return []
    const q = deferredQuery.trim().toLowerCase()
    return conflicts.filter((row) => {
      if (q && !(`${names.get(row.id) ?? ''} ${row.id}`.toLowerCase().includes(q))) return false
      if (frontOnly && !row.front) return false
      if (zzzOnly && !row.zzz) return false
      return true
    })
  }, [conflicts, deferredQuery, frontOnly, names, zzzOnly])

  const error = conflictsError ?? pagesError
  if (error) return <div className="error">Error: {error}</div>
  if (!conflicts || !pages) return <div className="loading">Loading…</div>

  const pagesCount = Math.max(1, Math.ceil(filtered.length / PAGE_SIZE))
  const currentPage = Math.min(page, pagesCount - 1)
  const shown = filtered.slice(currentPage * PAGE_SIZE, (currentPage + 1) * PAGE_SIZE)

  const resetPage = <T,>(callback: (value: T) => void, value: T) => {
    callback(value)
    setPage(0)
  }

  return (
    <div className="page">
      <h1>Conflicts <span className="muted">({conflicts.length})</span></h1>
      <div className="filters">
        <input
          className="input"
          aria-label="Search conflicts"
          placeholder="Search page / id…"
          value={query}
          onChange={(event) => resetPage(setQuery, event.target.value)}
        />
        <label className="check">
          <input type="checkbox" checked={frontOnly} onChange={(event) => resetPage(setFrontOnly, event.target.checked)} />
          front only
        </label>
        <label className="check">
          <input type="checkbox" checked={zzzOnly} onChange={(event) => resetPage(setZzzOnly, event.target.checked)} />
          zzz only
        </label>
        <span className="muted result-count">{filtered.length} shown · page {currentPage + 1}/{pagesCount}</span>
      </div>

      <div className="table-wrap">
        <table className="tbl">
          <thead>
            <tr>
              <th>Page</th>
              <th className="num">Churn</th>
              <th>Median TTD</th>
              <th className="num">Del</th>
              <th>Flags</th>
            </tr>
          </thead>
          <tbody>
            {shown.map((row) => (
              <tr key={row.id}>
                <td><PageLink id={row.id} name={names.get(row.id) ?? row.id} max={72} /></td>
                <td className="num">{row.churn}</td>
                <td className="mono nowrap">{fmtDuration(row.ttd_med_s)}</td>
                <td className="num muted">{row.del || ''}</td>
                <td>
                  {row.zzz && <Badge color={ZZZ_COLOR}>zzz</Badge>}
                  {row.front && <Badge color={FRONT_COLOR}>front</Badge>}
                  {!row.zzz && !row.front && <span className="muted">—</span>}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <div className="pager">
        <button type="button" className="btn ghost" disabled={currentPage === 0} onClick={() => setPage((value) => value - 1)}>← prev</button>
        <button type="button" className="btn ghost" disabled={currentPage >= pagesCount - 1} onClick={() => setPage((value) => value + 1)}>next →</button>
      </div>
    </div>
  )
}
