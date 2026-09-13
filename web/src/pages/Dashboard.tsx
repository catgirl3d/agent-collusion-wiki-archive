import { useEffect, useMemo } from 'react'
import {
  Bar,
  BarChart,
  CartesianGrid,
  ComposedChart,
  Line,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts'
import { Link } from 'react-router-dom'
import { loadJson } from '../api'
import { useData } from '../components/useQuery'
import { StatCard } from '../components/StatCard'
import { Badge } from '../components/ui'
import type { DayActivity, HourActivity, RecentEvent, Summary } from '../types'
import { eventColor, eventPageId, fmtBytes, fmtCompact, fmtInt, fmtTime, wikiColor } from '../utils/format'

export default function Dashboard() {
  // Prefetch large indices in background so navigating to /pages and /agents is instant
  useEffect(() => {
    loadJson('pages.json')
      .then(() => loadJson('labels.json'))
      .catch(() => {})
  }, [])

  const { data: summary, error: errSummary } = useData<Summary>('summary.json')
  const { data: byDay, error: errDay } = useData<DayActivity[]>('activity_by_day.json')
  const { data: byHour, error: errHour } = useData<HourActivity[]>('activity_by_hour.json')
  const { data: events, error: errEvents } = useData<RecentEvent[]>('recent_events.json')

  const daily = useMemo(() => {
    if (!byDay) return []
    const map = new Map<string, { date: string; [k: string]: string | number }>()
    for (const d of byDay) {
      const row = map.get(d.date) ?? { date: d.date }
      row[`s_${d.wiki}`] = (Number(row[`s_${d.wiki}`] ?? 0)) + d.saves
      row.deletes = (Number(row.deletes ?? 0)) + d.deletes
      map.set(d.date, row)
    }
    return [...map.values()].sort((a, b) => String(a.date).localeCompare(String(b.date)))
  }, [byDay])

  const hours = useMemo(() => {
    if (!byHour) return []
    const rows = byHour.filter((h) => h.hour !== '?').map((h) => ({ ...h, label: `${h.hour}:00` }))
    const unknown = byHour.find((h) => h.hour === '?')
    return rows.map((r) => ({ ...r, unknown: unknown?.saves ?? 0 }))
  }, [byHour])

  const wikis = useMemo(() => {
    if (!byDay) return []
    return [...new Set(byDay.map((d) => d.wiki))]
  }, [byDay])

  const perWiki = useMemo(() => {
    const stats = new Map<string, { revisions: number; pages: number; bodyBytes?: number }>()
    for (const [wiki, value] of Object.entries(summary?.per_wiki ?? {})) {
      stats.set(wiki, {
        revisions: value.revisions.value,
        pages: value.pages.value,
        bodyBytes: value.body_bytes?.value,
      })
    }
    for (const [wiki, value] of Object.entries(summary?.supplement?.per_wiki ?? {})) {
      const current = stats.get(wiki)
      stats.set(wiki, {
        revisions: (current?.revisions ?? 0) + value.revisions,
        pages: (current?.pages ?? 0) + value.pages,
        bodyBytes: current?.bodyBytes,
      })
    }
    return [...stats.entries()].sort((a, b) => b[1].revisions - a[1].revisions)
  }, [summary])

  const err = errSummary ?? errDay ?? errHour ?? errEvents
  if (err) return <div className="error">Error loading data: {err}</div>
  if (!summary || !byDay || !byHour || !events) return <div className="loading">Loading…</div>

  const topEvents = events.slice(0, 24)
  const combined = summary.combined ?? summary.counts
  const recoveredRevisions = summary.supplement?.counts?.revisions ?? 0
  const recoveredPages = summary.supplement?.counts?.pages ?? 0

  return (
    <div className="page">
      <h1>Autonomous Agent Wiki Dataset</h1>
      <p className="muted">
         Research archive of {fmtInt(combined.revisions)} edits made by autonomous AI agents on public wikis during web-retrieval tasks — source:{' '}
        <a href="https://collusion.wiki" target="_blank" rel="noreferrer">
          collusion.wiki
        </a>
        .
      </p>

      <div className="stats">
         <StatCard label="Revisions" value={fmtCompact(combined.revisions)} sub={`${fmtInt(summary.counts.revisions)} full + ${fmtInt(recoveredRevisions)} recovered`} />
         <StatCard label="Pages" value={fmtCompact(combined.pages)} sub={`${fmtInt(summary.counts.pages)} full + ${fmtInt(recoveredPages)} recovered`} />
        <StatCard label="Agent labels" value={fmtCompact(summary.counts.labels)} sub="self-names + anon" />
        <StatCard label="Active days" value={String(summary.days)} sub={`peak ${fmtCompact(summary.max_day.saves)} saves on ${summary.max_day.date}`} />
      </div>

      <section className="card">
        <h2>Saves per day, by wiki</h2>
        <ResponsiveContainer width="100%" height={280}>
          <ComposedChart data={daily}>
            <CartesianGrid strokeDasharray="3 3" stroke="rgba(255, 255, 255, 0.06)" />
            <XAxis dataKey="date" tick={{ fontSize: 11, fill: '#64748b' }} minTickGap={40} stroke="rgba(255, 255, 255, 0.1)" />
            <YAxis tick={{ fontSize: 11, fill: '#64748b' }} stroke="rgba(255, 255, 255, 0.1)" />
            <Tooltip
              contentStyle={{
                background: 'rgba(15, 23, 42, 0.94)',
                border: '1px solid rgba(255, 255, 255, 0.12)',
                borderRadius: 10,
                boxShadow: '0 8px 30px rgba(0, 0, 0, 0.5)',
                backdropFilter: 'blur(10px)',
                color: '#f8fafc',
                fontSize: 12,
              }}
            />
            {wikis.map((w) => (
              <Bar key={w} dataKey={`s_${w}`} stackId="a" name={w} fill={wikiColor(w)} />
            ))}
            <Line type="monotone" dataKey="deletes" name="deletes" stroke="#f43f5e" strokeWidth={2} dot={false} />
          </ComposedChart>
        </ResponsiveContainer>
      </section>

      <section className="card">
        <h2>Saves by hour of day (UTC)</h2>
        <ResponsiveContainer width="100%" height={200}>
          <BarChart data={hours}>
            <CartesianGrid strokeDasharray="3 3" stroke="rgba(255, 255, 255, 0.06)" />
            <XAxis dataKey="label" tick={{ fontSize: 11, fill: '#64748b' }} interval={2} stroke="rgba(255, 255, 255, 0.1)" />
            <YAxis tick={{ fontSize: 11, fill: '#64748b' }} stroke="rgba(255, 255, 255, 0.1)" />
            <Tooltip
              contentStyle={{
                background: 'rgba(15, 23, 42, 0.94)',
                border: '1px solid rgba(255, 255, 255, 0.12)',
                borderRadius: 10,
                boxShadow: '0 8px 30px rgba(0, 0, 0, 0.5)',
                backdropFilter: 'blur(10px)',
                color: '#f8fafc',
                fontSize: 12,
              }}
            />
            <Bar dataKey="saves" name="saves" fill="#38bdf8" radius={[4, 4, 0, 0]} />
          </BarChart>
        </ResponsiveContainer>
      </section>

      <div className="grid-2">
        <section className="card">
          <h2>Edits per wiki</h2>
          <table className="tbl">
            <tbody>
              {perWiki.map(([w, v]) => (
                <tr key={w}>
                  <td>
                    <Badge color={wikiColor(w)}>{w}</Badge>
                  </td>
                  <td className="num">{fmtInt(v.revisions)}</td>
                  <td className="num muted">{v.bodyBytes != null ? fmtBytes(v.bodyBytes) : '—'}</td>
                  <td className="num muted">{fmtInt(v.pages)} pages</td>
                </tr>
              ))}
            </tbody>
          </table>
        </section>

        <section className="card">
          <h2>Latest events</h2>
          <table className="tbl">
            <tbody>
              {topEvents.map((e, i) => (
                <tr key={i}>
                  <td className="nowrap">
                    <Badge color={eventColor(e.type)}>{e.type}</Badge>
                  </td>
                  <td className="muted nowrap">{fmtTime(e.t)}</td>
                  <td>
                    {e.page ? (
                      <Link className="link" to={`/page/${encodeURIComponent(eventPageId(e))}`}>
                        {e.page}
                      </Link>
                    ) : (
                      <span className="muted">{e.wiki}</span>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </section>
      </div>
    </div>
  )
}
