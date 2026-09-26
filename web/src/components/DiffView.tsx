import { useMemo } from 'react'
import { diffLines } from '../utils/diff'
import { highlightMatches } from '../utils/payload'

function DiffLine({ text }: { text: string }) {
  const segments = highlightMatches(text)
  return (
    <>
      {segments.map((seg, idx) =>
        seg.flag ? (
          <mark
            key={idx}
            className="mark-payload"
            data-flag={seg.flag}
            data-flags={seg.flags?.join(' ')}
            title={seg.flags?.join(', ')}
          >
            {seg.text}
          </mark>
        ) : (
          <span key={idx}>{seg.text}</span>
        ),
      )}
    </>
  )
}

export function DiffView({ before, after }: { before: string; after: string }) {
  const lines = useMemo(() => diffLines(before, after), [before, after])
  if (before === after) return <div className="muted">No changes between these revisions.</div>
  return (
    <pre className="diff">
      {lines.map((l, i) => (
        <div key={i} className={`diff-${l.kind}`}>
          {l.kind === 'add' ? '+' : l.kind === 'del' ? '−' : ' '} <DiffLine text={l.text} />
        </div>
      ))}
    </pre>
  )
}
