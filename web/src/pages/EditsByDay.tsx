import { useDeferredValue, useMemo, useState } from 'react'
import { Link } from 'react-router-dom'
import { useData } from '../components/useQuery'
import type { DayActivity } from '../types'
import { aggregateDays, fmtInt } from '../utils/format'

export default function EditsByDay() {
  const { data, error } = useData<DayActivity[]>('activity_by_day.json')
  const [query, setQuery] = useState('')
  const deferredQuery = useDeferredValue(query)

  const days = useMemo(() => {
    if (!data) return []
    const q = deferredQuery.trim()
    return aggregateDays(data).filter((day) => !q || day.date.includes(q))
  }, [data, deferredQuery])

  if (error) return <div className="error">Ошибка: {error}</div>
  if (!data) return <div className="loading">Загрузка…</div>

  const maxSaves = Math.max(1, ...days.map((day) => day.saves))

  return (
    <div className="page">
      <h1>Edits by day <span className="muted">({fmtInt(days.length)} days)</span></h1>
      <div className="filters">
        <input className="input" placeholder="Search YYYY-MM-DD…" value={query} onChange={(e) => setQuery(e.target.value)} />
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
                <td className="num">{fmtInt(day.count)}</td>
                <td className="nowrap"><Link className="link" to={`/events?day=${day.date}`}>events</Link>{' · '}<Link className="link" to={`/pages?day=${day.date}`}>pages</Link></td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  )
}
