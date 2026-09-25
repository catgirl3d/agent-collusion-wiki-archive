import { useEffect, useMemo, useRef, useState, type ReactElement } from 'react'
import type { PairEvent, PairTimeline, SharedPageEntry } from '../utils/pairEvidence'
import { derivePairEvidence, derivePatternSignals, formatPatternSignals, getPayloadEvidence } from '../utils/pairEvidence'
import { fmtDuration, fmtRoundLabel, fmtTimeSeconds, wikiColor } from '../utils/format'
import { PAYLOAD_FLAG_COLORS } from '../utils/payload'
import { DiffView } from './DiffView'
import { Badge, Button, Card, Chip } from './ui'


/** Timeline rows shown per render window; "Load older" extends by the same amount. */
const TIMELINE_PAGE_SIZE = 50

export interface PairEvidencePanelProps {
  leftLabel: string
  rightLabel: string
  sharedPages: SharedPageEntry[]
  selectedPageId: string | null
  timeline: PairTimeline | 'loading' | 'error' | null
  onClose: () => void
  onOpenPageInPageDetail: (pageId: string) => void
  onSelectPage?: (pageId: string) => void
  sourceMode: 'page' | 'network'
}

function isPairTimeline(timeline: PairTimeline | 'loading' | 'error' | null | undefined): timeline is PairTimeline {
  return typeof timeline === 'object' && timeline !== null && 'events' in timeline
}

function EventRow({
  event,
  timeline,
  leftLabel,
  rightLabel,
  isExpanded,
  onToggleExpand,
}: {
  event: PairEvent
  timeline: PairTimeline
  leftLabel: string
  rightLabel: string
  isExpanded: boolean
  onToggleExpand: () => void
}) {
  const isThirdPartyBaseline =
    event.baselineLabel !== null &&
    event.baselineLabel !== leftLabel &&
    event.baselineLabel !== rightLabel

  const afterBody = timeline.orderedRevisions[event.revIndex]?.body ?? ''
  const hasBaseline =
    event.baselineIndex !== null &&
    event.baselineIndex >= 0 &&
    event.baselineIndex < timeline.orderedRevisions.length
  const beforeBody = hasBaseline ? timeline.orderedRevisions[event.baselineIndex!].body ?? '' : ''

  const payloadEvidence = useMemo(() => (isExpanded ? getPayloadEvidence(afterBody) : null), [isExpanded, afterBody])

  const roundLabel = fmtRoundLabel(event.round)
  const deltaFormatted = event.analysis.delta > 0 ? `+${event.analysis.delta}` : `${event.analysis.delta}`
  const deltaClass =
    event.analysis.delta > 0
      ? 'pair-delta-pos'
      : event.analysis.delta < 0
        ? 'pair-delta-neg'
        : 'pair-delta-zero'

  return (
    <article className={`pair-event-row${isExpanded ? ' expanded' : ''}`}>
      <button
        type="button"
        className="pair-event-head"
        aria-expanded={isExpanded}
        onClick={onToggleExpand}
      >
        <span className="pair-seq">#{event.seq ?? event.revIndex + 1}</span>
        <span className="pair-time">{fmtTimeSeconds(event.time)}</span>
        <Badge
          className="mono pair-actor-badge"
          style={{
            color: event.label === leftLabel ? 'var(--accent)' : 'var(--text)',
            borderColor: event.label === leftLabel ? 'var(--border-accent)' : 'var(--border)',
          }}
        >
          {event.label}
        </Badge>
        {event.action && <Badge className="pair-action-badge">{event.action}</Badge>}
        {roundLabel && <Badge className="pair-round-badge">{roundLabel}</Badge>}
        <span className={deltaClass}>delta {deltaFormatted} chars</span>
        <Badge className="pair-op-badge">{event.analysis.op}</Badge>
        {event.analysis.truncated && (
          <span className="muted text-xs pair-truncated-note">large diff approximated</span>
        )}
        {event.payloadFlags.map((flag) => (
          <Badge
            key={flag}
            style={{
              background: `${PAYLOAD_FLAG_COLORS[flag] ?? '#f59e0b'}22`,
              color: PAYLOAD_FLAG_COLORS[flag] ?? '#f59e0b',
              borderColor: `${PAYLOAD_FLAG_COLORS[flag] ?? '#f59e0b'}44`,
            }}
          >
            {flag}
          </Badge>
        ))}
        {(event.interveningOther > 0 || isThirdPartyBaseline) && (
          <span className="pair-intervening text-xs">
            {event.interveningOther > 0 && (
              <span>
                intervening: {event.interveningOther} other-label{' '}
                {event.interveningOther === 1 ? 'revision' : 'revisions'}
              </span>
            )}
            {event.interveningOther > 0 && isThirdPartyBaseline && <span> · </span>}
            {isThirdPartyBaseline && (
              <span>
                baseline by <span className="mono">{event.baselineLabel}</span>
              </span>
            )}
          </span>
        )}
        {event.summary && (
          <span className="pair-event-summary" title={event.summary}>
            {event.summary}
          </span>
        )}
      </button>

      {isExpanded && (
        <div className="pair-event-body">
          {event.analysis.op === 'initial' || !hasBaseline ? (
            <div className="muted text-sm pair-no-baseline">initial revision (no baseline)</div>
          ) : (
            <DiffView before={beforeBody} after={afterBody} />
          )}

          {payloadEvidence && payloadEvidence.snippets.length > 0 && (
            <div className="pair-snippets-list">
              <div className="pair-snippets-title uppercase">Observed payload snippets:</div>
              {payloadEvidence.snippets.map((snip, idx) => (
                <pre key={idx} className="pair-snippet" data-flag={snip.flag}>
                  <Badge
                    style={{
                      background: `${PAYLOAD_FLAG_COLORS[snip.flag] ?? '#f59e0b'}22`,
                      color: PAYLOAD_FLAG_COLORS[snip.flag] ?? '#f59e0b',
                      fontSize: '10.5px',
                      padding: '1px 5px',
                    }}
                  >
                    {snip.flag}
                  </Badge>{' '}
                  {snip.text}
                </pre>
              ))}
            </div>
          )}
        </div>
      )}
    </article>
  )
}

export function PairEvidencePanel({
  leftLabel,
  rightLabel,
  sharedPages,
  selectedPageId,
  timeline,
  onClose,
  onOpenPageInPageDetail,
  onSelectPage,
  sourceMode,
}: PairEvidencePanelProps): ReactElement {
  const selectedRowRef = useRef<HTMLButtonElement | null>(null)
  const [limit, setLimit] = useState(TIMELINE_PAGE_SIZE)
  const [expandedRevIndex, setExpandedRevIndex] = useState<number | null>(null)

  // Render-time state reset (React "adjusting state when props change"): a changed selection key
  // resets pagination/expansion during render, no cascading effect render needed.
  const selectionKey = `${leftLabel}|${rightLabel}|${selectedPageId ?? ''}|${isPairTimeline(timeline) ? timeline.events.length : timeline ?? ''}`
  const [prevSelectionKey, setPrevSelectionKey] = useState(selectionKey)
  if (prevSelectionKey !== selectionKey) {
    setPrevSelectionKey(selectionKey)
    setLimit(TIMELINE_PAGE_SIZE)
    setExpandedRevIndex(null)
  }

  // Auto-scroll selected row into view on mount or selection change
  useEffect(() => {
    if (selectedRowRef.current && typeof selectedRowRef.current.scrollIntoView === 'function') {
      selectedRowRef.current.scrollIntoView({ block: 'nearest' })
    }
  }, [selectedPageId])

  const selectedEntry = useMemo(
    () => (selectedPageId ? sharedPages.find((entry) => entry.id === selectedPageId) : null),
    [sharedPages, selectedPageId],
  )

  const selectedPageName = selectedPageId
    ? selectedEntry?.page?.n || selectedEntry?.id || selectedPageId
    : null

  const isReady = isPairTimeline(timeline)

  const signals = useMemo(() => {
    if (isReady) {
      return derivePatternSignals(timeline.events)
    }
    return null
  }, [isReady, timeline])

  const signatures = useMemo(
    () => (isReady ? derivePairEvidence(selectedPageId ?? '', timeline, leftLabel, rightLabel) : null),
    [isReady, timeline, selectedPageId, leftLabel, rightLabel],
  )

  const reversedEvents = useMemo(() => {
    if (!isReady) return []
    return [...timeline.events].reverse()
  }, [isReady, timeline])

  const visibleEvents = useMemo(() => reversedEvents.slice(0, limit), [reversedEvents, limit])

  const renderDisclosure = (label: string, children: ReactElement) => (
    <details className="pair-signature-disclosure"><summary>{label}</summary>{children}</details>
  )

  const signatureChip = (item: NonNullable<typeof signatures>['artifacts'][number], key: string) => (
    <Chip key={key} className="pair-signature-chip" title={item.canonicalValue}>
      <span className="pair-signature-kind">{item.payloadClass ?? item.artifactType}</span>
      <span className="mono pair-signature-value">{item.canonicalValue}</span>
      <span className="pair-signature-count">{leftLabel} {item.counts[leftLabel] ?? 0} · {rightLabel} {item.counts[rightLabel] ?? 0}</span>
      <span className="pair-signature-refs">{item.refs.slice(0, 2).map((ref) => `${ref.label} · rev #${ref.seq ?? ref.revIndex + 1}`).join(' · ')}</span>
    </Chip>
  )

  const techniqueChip = (technique: NonNullable<typeof signatures>['techniques'][number]) => (
    <Chip key={technique.key} className="pair-technique-chip"><span>technique</span> {technique.key}</Chip>
  )

  const lineChip = (item: NonNullable<typeof signatures>['coordinationLines'][number], truncate: boolean) => (
    <Chip key={item.canonicalValue} className="pair-technique-chip"><span>line</span> <span className="mono">{truncate ? `${item.canonicalValue.slice(0, 80)}${item.canonicalValue.length > 80 ? '…' : ''}` : item.canonicalValue}</span></Chip>
  )

  const retainedChip = (domain: NonNullable<typeof signatures>['retainedDomains'][number], truncate: boolean) => (
    <Chip key={domain.canonicalValue} className="pair-technique-chip"><span>retained</span> {truncate ? `${domain.canonicalValue.slice(0, 60)}${domain.canonicalValue.length > 60 ? '…' : ''}` : domain.canonicalValue} <span className="muted">kept by {domain.labels.join(', ')}</span></Chip>
  )

  const observationRow = (observation: NonNullable<typeof signatures>['pairObservations'][number]) => (
    <div key={`${observation.artifact}:${observation.status}:${observation.observationRefs[0]}`}>
      <span className="pair-status-label">{observation.status}</span>{' '}
      <span className="mono">{observation.artifact.split(':').slice(1).join(':')}</span>
      {observation.gapSeconds !== null && <span className="muted text-xs"> +{fmtDuration(observation.gapSeconds)}</span>}
    </div>
  )

  const hasSharedEvidence = signatures !== null && (signatures.artifacts.length > 0 || signatures.techniques.length > 0 || signatures.coordinationLines.length > 0 || signatures.retainedDomains.length > 0 || signatures.commonHosts.length > 0)

  return (
    <Card as="section" className="pair-evidence-panel" aria-label="Shared pair evidence">
      {/* 1. Header */}
      <div className="pair-header">
        <div className="pair-header-main">
          <div className="pair-title-row">
            <h2 className="pair-title">Shared pair evidence</h2>
            <span className="mono pair-labels">
              {leftLabel} ↔ {rightLabel}
            </span>
          </div>
          <div className="pair-header-meta text-xs muted">
            <span>
              {sharedPages.length} shared {sharedPages.length === 1 ? 'page' : 'pages'}
            </span>
            <span>·</span>
            <span>
              Page: {selectedPageName ?? 'no page selected'}
            </span>
            {selectedPageId && sourceMode === 'network' && (
              <>
                <span>·</span>
                <Button
                  size="sm"
                  variant="ghost"
                  className="pair-open-page-btn"
                  onClick={() => onOpenPageInPageDetail(selectedPageId)}
                  title="Open page in PageDetail"
                >
                  Open in PageDetail
                </Button>
              </>
            )}
          </div>
        </div>
        <Button
          size="sm"
          variant="ghost"
          className="pair-close-btn"
          onClick={onClose}
          aria-label="Close pair evidence panel"
        >
          Close
        </Button>
      </div>

      {/* 2. Shared technical signatures */}
      <div className="pair-section pair-signatures-section surface-panel">
        <div className="pair-section-head">
          <h3 className="section-subtitle">Shared technical signatures</h3>
          <p className="pair-signature-definition">Shared means observed in new additions by both selected labels; it does not establish information transfer.</p>
          <p className="pair-signature-scope muted text-xs">Selected page only · {sharedPages.length} shared pages total · other pages not analyzed</p>
        </div>
        {timeline === 'loading' ? <div className="muted text-xs">Loading signatures…</div> : timeline === 'error' ? <div className="muted text-xs">Signatures unavailable</div> : !signatures ? <div className="muted text-xs">Select a shared page to view signatures.</div> : (
          <>
            {signatures.firstPairEvent && <div className="pair-sequence-summary"><strong>Observed sequence</strong>: First pair edit: {signatures.firstPairEvent.label} · rev #{signatures.firstPairEvent.seq ?? signatures.firstPairEvent.revIndex + 1} · Preceding third-party revisions: {signatures.firstPairEvent.interveningOther}</div>}
            {signatures.pairObservations.length > 0 && <div className="pair-sequence-observations">{signatures.pairObservations.slice(0, 4).map((observation) => observationRow(observation))}{signatures.pairObservations.length > 4 && renderDisclosure(`Show ${signatures.pairObservations.length - 4} more sequence observations`, <div>{signatures.pairObservations.slice(4).map((observation) => observationRow(observation))}</div>)}</div>}
            {signatures.artifacts.length > 0 && <div className="pair-signature-list">{signatures.artifacts.slice(0, 4).map((item) => signatureChip(item, `${item.artifactType}:${item.canonicalValue}`))}</div>}
            {!hasSharedEvidence && <div className="pair-signature-empty">No shared technical signatures observed on this page. Cross-page recurrence, unrecognized phrases/families, bare service mentions, subnet/ASN/provider inference, and wholesale-copy distinction are not checked here.</div>}
            {signatures.artifacts.length > 4 && renderDisclosure(`Show ${signatures.artifacts.length - 4} more flagged signatures`, <div className="pair-signature-list">{signatures.artifacts.slice(4).map((item) => signatureChip(item, `${item.artifactType}:${item.canonicalValue}`))}</div>)}
            {signatures.commonHosts.length > 0 && renderDisclosure(`Common hosts (${signatures.commonHosts.length})`, <div className="pair-signature-list">{signatures.commonHosts.map((item) => signatureChip(item, item.canonicalValue))}</div>)}
            {signatures.techniques.length > 0 && <div className="pair-techniques"><strong>Shared techniques</strong><span className="muted text-xs"> Class-level evidence; different exact values can underlie one row.</span><div className="pair-signature-list">{signatures.techniques.slice(0, 4).map((technique) => techniqueChip(technique))}</div>{signatures.techniques.length > 4 && renderDisclosure(`Show ${signatures.techniques.length - 4} more techniques`, <div className="pair-signature-list">{signatures.techniques.slice(4).map((technique) => techniqueChip(technique))}</div>)}</div>}
            {signatures.coordinationLines.length > 0 && <div className="pair-coordination-lines"><strong>Coordination lines</strong><span className="muted text-xs"> Same short line added by both labels; wording is observed, intent is not inferred.</span><div className="pair-signature-list">{signatures.coordinationLines.slice(0, 4).map((item) => lineChip(item, true))}</div>{signatures.coordinationLines.length > 4 && renderDisclosure(`Show ${signatures.coordinationLines.length - 4} more lines`, <div className="pair-signature-list">{signatures.coordinationLines.slice(4).map((item) => lineChip(item, false))}</div>)}</div>}
            {signatures.retainedDomains.length > 0 && <div className="pair-retained-domains"><strong>Retained domains</strong><span className="muted text-xs"> Added by one label, kept by the other; infrastructure reuse, not shared addition.</span><div className="pair-signature-list">{signatures.retainedDomains.slice(0, 4).map((domain) => retainedChip(domain, true))}</div>{signatures.retainedDomains.length > 4 && renderDisclosure(`Show ${signatures.retainedDomains.length - 4} more domains`, <div className="pair-signature-list">{signatures.retainedDomains.slice(4).map((domain) => retainedChip(domain, false))}</div>)}</div>}
            {signatures.coverageStatus === 'unknown-genesis' && <div className="pair-unknown-genesis">Page history starts before the archive; the earliest revision body was not attributed.</div>}
          </>
        )}
      </div>

      {/* 3. Observed patterns */}
      <div className="pair-section pair-patterns-section">
        <div className="pair-section-head">
          <h3 className="section-subtitle">Observed patterns</h3>
          <p className="pair-patterns-note muted text-xs">
            Heuristic counts over pair events on the selected page only, not a verdict.
          </p>
        </div>
        {signals ? (
          <div className="pair-patterns">
            {formatPatternSignals(signals).map((chip) => (
              <Chip key={chip.key} className="pair-signal-chip">
                {chip.label} <span className="mono">({chip.count})</span>
              </Chip>
            ))}
            {signals.additive === 0 &&
              signals.destructive === 0 &&
              signals.alternating === 0 &&
              signals.mixed === 0 &&
              (timeline as PairTimeline).events.length > 0 && (
                <Chip className="pair-signal-chip muted">no operation signals</Chip>
              )}
            {(timeline as PairTimeline).events.length === 0 && (
              <Chip className="pair-signal-chip muted">no pair events on this page</Chip>
            )}
          </div>
        ) : timeline === 'loading' ? (
          <div className="pair-patterns muted text-xs">Loading patterns…</div>
        ) : timeline === 'error' ? (
          <div className="pair-patterns muted text-xs">Patterns unavailable</div>
        ) : (
          <div className="pair-patterns muted text-xs">Select a shared page to view pattern signals.</div>
        )}
      </div>

      {/* 4. Shared-page list (full, never capped) */}
      <div className="pair-section pair-page-list-section">
        <div className="pair-section-head">
          <h3 className="section-subtitle">Shared pages ({sharedPages.length})</h3>
        </div>
        <div className="pair-page-list surface-panel" role="list">
          {sharedPages.length === 0 ? (
            <div className="muted text-xs p-2">No shared pages recorded for this pair.</div>
          ) : (
            sharedPages.map((entry) => {
              const isSelected = entry.id === selectedPageId
              const hasMeta = entry.page !== null
              const isTimelineForThis = isSelected && isReady

              if (!hasMeta) {
                return (
                  <button
                    key={entry.id}
                    type="button"
                    disabled
                    className="pair-page-row disabled"
                    aria-disabled="true"
                  >
                    <div className="pair-page-row-main">
                      <span className="mono text-xs">{entry.id}</span>
                    </div>
                    <div className="pair-page-row-meta text-xs muted">
                      <span>page metadata missing</span>
                    </div>
                  </button>
                )
              }

              const page = entry.page!
              return (
                <button
                  key={entry.id}
                  type="button"
                  ref={isSelected ? selectedRowRef : undefined}
                  className={`pair-page-row${isSelected ? ' selected' : ''}`}
                  aria-current={isSelected ? 'true' : undefined}
                  onClick={() => {
                    if (onSelectPage) onSelectPage(entry.id)
                    else onOpenPageInPageDetail(entry.id)
                  }}
                >
                  <div className="pair-page-row-main">
                    <span className="pair-page-name">{page.n || entry.id}</span>
                    <Badge
                      style={{
                        background: `${wikiColor(page.w)}22`,
                        color: wikiColor(page.w),
                        borderColor: `${wikiColor(page.w)}44`,
                      }}
                    >
                      {page.w}
                    </Badge>
                  </div>
                  <div className="pair-page-row-meta text-xs muted">
                    <span>
                      page context: {page.r} {page.r === 1 ? 'rev' : 'revs'}
                      {page.f && page.l ? ` · page activity ${page.f}..${page.l}` : ''}
                    </span>
                    {isTimelineForThis && (
                      <Badge
                        style={{ background: 'var(--accent-glow)', color: 'var(--accent)' }}
                      >
                        {timeline.events.length} pair{' '}
                        {timeline.events.length === 1 ? 'event' : 'events'}
                      </Badge>
                    )}
                  </div>
                </button>
              )
            })
          )}
        </div>
      </div>

      {/* 5. Timeline section */}
      {timeline === 'loading' && (
        <div className="pair-timeline-loading surface-panel muted text-sm">
          Loading revisions for {selectedPageName ?? 'selected page'}…
        </div>
      )}

      {timeline === 'error' && (
        <div className="pair-timeline-error surface-panel text-sm">
          Could not load revisions for this page. Try the full page history.
        </div>
      )}

      {isReady && (
        <div className="pair-section pair-timeline-section">
          <div className="pair-timeline-head">
            <h3 className="section-subtitle">
              Pair timeline ({reversedEvents.length}{' '}
              {reversedEvents.length === 1 ? 'event' : 'events'})
            </h3>
            <span className="text-xs muted">
              showing {visibleEvents.length} of {reversedEvents.length} pair events
            </span>
          </div>

          {reversedEvents.length === 0 ? (
            <div className="pair-timeline-empty surface-panel muted text-sm">
              No pair events observed on this page for these labels.
            </div>
          ) : (
            <div className="pair-timeline">
              {visibleEvents.map((ev) => (
                <EventRow
                  key={ev.revIndex}
                  event={ev}
                  timeline={timeline}
                  leftLabel={leftLabel}
                  rightLabel={rightLabel}
                  isExpanded={expandedRevIndex === ev.revIndex}
                  onToggleExpand={() =>
                    setExpandedRevIndex((prev) => (prev === ev.revIndex ? null : ev.revIndex))
                  }
                />
              ))}

              {limit < reversedEvents.length && (
                <div className="pair-timeline-footer">
                  <Button
                    size="sm"
                    variant="ghost"
                    className="pair-load-older-btn"
                    onClick={() => setLimit((prev) => prev + TIMELINE_PAGE_SIZE)}
                  >
                    Load older ({reversedEvents.length - limit} remaining)
                  </Button>
                </div>
              )}
            </div>
          )}
        </div>
      )}

      {/* 6. Footer line */}
      {(!timeline || !selectedPageId) && (
        <footer className="pair-panel-footer text-xs muted">
          open a page to see its full revision history
        </footer>
      )}
    </Card>
  )
}
