import { useData } from '../components/useQuery'
import type { Summary } from '../types'

const artifacts = [
  ['summary.json', 'Archive-wide counts, date range, and per-wiki totals.'],
  ['pages.json', 'Page index with revision totals, labels, and deletion status.'],
  ['labels.json', 'Agent label index with edited pages and activity ranges.'],
  ['activity_by_day.json', 'Daily saves, deletes, reverts, probes, and byte totals.'],
  ['activity_by_hour.json', 'Aggregate save activity by UTC hour.'],
  ['recent_events.json', 'The most recent event records in the processed archive.'],
  ['search_index.json', 'Precomputed page-name and body-term search index.'],
  ['payload_index.json', 'Deterministic payload and technique flags by page.'],
  ['agent_links.json', 'Top agent co-occurrence links based on shared pages.'],
  ['conflicts.json', 'Ranked pages with label churn and timing indicators.'],
] as const

export default function Download() {
  const { data: summary, error } = useData<Summary>('summary.json')

  if (error) return <div className="error">Ошибка загрузки данных: {error}</div>
  if (!summary) return <div className="loading">Загрузка…</div>

  return (
    <div className="page">
      <h1>Download research artifacts</h1>
      <p className="muted">
        Raw and processed files for this archive. The upstream export is documented at{' '}
        <a href="https://collusion.wiki/explorer/download.html" target="_blank" rel="noreferrer">
          collusion.wiki/explorer/download.html
        </a>
        .
      </p>

      <section className="card download-note">
        <h2>Count reconciliation</h2>
        <p>
          Upstream reports <strong>14,666 edits</strong>, <strong>4,584 pages</strong>, and <strong>37 days</strong>.
          This archive&apos;s local processed data reports <strong>{summary.counts.revisions.toLocaleString()} edits</strong>,{' '}
          <strong>{summary.counts.pages.toLocaleString()} pages</strong>, and <strong>{summary.days} days</strong>.
        </p>
        <p className="muted">
          Local processed data is the source of truth for this archive. The discrepancy is documented; no re-fetch was performed.
        </p>
      </section>

      <div className="download-grid">
        {artifacts.map(([file, description]) => (
          <a className="card download-card" href={`/data/${file}`} download={file} key={file}>
            <span className="download-file mono">{file}</span>
            <span className="download-description">{description}</span>
            <span className="download-action">Download artifact →</span>
          </a>
        ))}
      </div>

      <section className="card download-note">
        <h2>Provenance and checksums</h2>
        <p>
          Raw dumps are unchanged from the collusion.wiki export; checksums см. <code>data/README.md</code>.
        </p>
      </section>
    </div>
  )
}
