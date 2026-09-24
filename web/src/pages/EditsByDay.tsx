import { useDeferredValue, useMemo, useState } from 'react'
import { ArchiveCalendar } from '../components/ArchiveCalendar'
import { TextLink } from '../components/ui'
import { useData } from '../components/useQuery'
import type { DayActivity } from '../types'
import { aggregateDays, fmtInt } from '../utils/format'

export default function EditsByDay() {
  const { data, error } = useData<DayActivity[]>('activity_by_day.json')
  const [query, setQuery] = useState('')
  const [day, setDay] = useState('')
  const deferredQuery = useDeferredValue(query)

  const days = useMemo(() => {
    if (!data) return []
    const q = deferredQuery.trim()
    return aggregateDays(data).filter((row) => (!q || row.date.includes(q)) && (!day || row.date === day))
  }, [data, deferredQuery, day])

  if (error) return <div className="error">Error: {error}</div>
  if (!data) return <div className="loading">Loading…</div>

  const maxSaves = Math.max(1, ...days.map((day) => day.saves))

  return (
    <div className="page">
      <h1>Edits by day <span className="muted">({fmtInt(days.length)} days)</span></h1>
      <div className="filters">
        <input aria-label="Search dates" className="input" placeholder="Search YYYY-MM-DD…" value={query} onChange={(e) => setQuery(e.target.value)} />
        <ArchiveCalendar
          ariaLabel="Filter by day"
          placeholder="filter by day…"
          value={day}
          onChange={setDay}
        />
        <span className="muted result-count">saves + deletes</span>
      </div>
      <div className="table-wrap">
        <table className="tbl">
          <thead><tr><th>Date</th><th>Activity</th><th className="num">Saves</th><th className="num">Deletes</th><th className="num">Count</th><th>Drill down</th></tr></thead>
          <tbody>
            {days.map((day) => (
              <tr key={day.date}>
                <td className="mono nowrap">{day.date}</td>
                <td><div className="daybar-track"><div className="daybar" style={{ width: `${(day.saves / maxSaves) * 100}%` }} /></div></td>
                <td className="num">{fmtInt(day.saves)}</td>
                <td className="num">{fmtInt(day.deletes)}</td>
                <td className="num">{fmtInt(day.count)}{day.rec > 0 && <span className="muted"> (incl. {fmtInt(day.rec)} recovered)</span>}</td>
                <td className="nowrap"><TextLink to={`/events?day=${day.date}`}>events</TextLink>{' · '}<TextLink to={`/pages?day=${day.date}`}>pages</TextLink></td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  )
}
