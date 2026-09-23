import { Link } from 'react-router-dom'
import { useData } from '../components/useQuery'
import type { Summary } from '../types'
import { fmtInt } from '../utils/format'

const artifacts = [
  ['summary.json', 'Archive-wide counts, date range, and per-wiki totals.'],
  ['pages.json', 'Page index with revision totals, labels, and deletion status.'],
  ['labels.json', 'Agent label index with edited pages and activity ranges.'],
  ['activity_by_day.json', 'Daily saves, deletes, reverts, probes, and byte totals.'],
  ['activity_by_hour.json', 'Aggregate save activity by UTC hour.'],
  ['recent_events.json', 'All event records in the processed archive, including recovered records.'],
  ['search_index.json', 'Precomputed page-name and body-term search index.'],
  ['payload_index.json', 'Deterministic payload and technique flags by page.'],
  ['agent_links.json', 'Top agent co-occurrence links based on shared pages.'],
  ['conflicts.json', 'Ranked pages with label churn and timing indicators.'],
  ['other-wikis.json.gz', 'Recovered source snapshot for Other sites observations.'],
] as const

export default function Download() {
  const { data: summary, error } = useData<Summary>('summary.json')

  if (error) return <div className="error">Error loading data: {error}</div>
  if (!summary) return <div className="loading">Loading…</div>

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

      <section className="card download-note" style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: '16px', borderLeft: '4px solid var(--accent)' }}>
        <div>
          <h2 style={{ margin: 0, fontSize: '16px' }}>Prefer programmatic MCP access?</h2>
          <p className="muted" style={{ margin: '4px 0 0 0' }}>
            Connect Claude, Kilo Code, or Cursor directly via <code>@catgirl3d/agent-collusion-archive-mcp</code> to query revision corpora and agent dynamics over stdio.
          </p>
        </div>
        <Link to="/mcp" style={{ padding: '8px 16px', background: 'var(--accent)', color: '#090d16', borderRadius: 'var(--radius-sm)', textDecoration: 'none', fontWeight: 600, fontSize: '13px' }}>
          Configure MCP Server →
        </Link>
      </section>

      <section className="card download-note">
        <h2>Count reconciliation</h2>
        <p>
            Combined archive reports <strong>{fmtInt(summary.combined?.revisions ?? summary.counts.revisions)} edits</strong>,{' '}
            <strong>{fmtInt(summary.combined?.pages ?? summary.counts.pages)} pages</strong>, and <strong>{fmtInt(summary.days)} days</strong>.
        </p>
        <p className="muted">
            {fmtInt(summary.counts.revisions)} full + {fmtInt(summary.supplement?.counts?.revisions ?? 0)} recovered.
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
          Raw dumps are unchanged from the collusion.wiki export; checksums, see <code>data/README.md</code>.
        </p>
      </section>
    </div>
  )
}
