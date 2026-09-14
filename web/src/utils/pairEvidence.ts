import type { LabelRecord, LabelsIndex, PageRecord, PagesIndex, Revision } from '../types'
import { diffLines, isTruncationMarker } from './diff'
import { detectPayloadFlags, extractLineArtifacts, extractTechnicalArtifacts, scanPayloadMatches, type TechnicalArtifact } from './payload'

export type RevisionOperation = 'unchanged' | 'initial' | 'append' | 'additive' | 'destructive' | 'replace' | 'mixed'

export interface RevisionAnalysis {
  op: RevisionOperation
  delta: number
  added: number
  removed: number
  truncated: boolean
}

export interface SharedPageEntry {
  id: string
  page: PageRecord | null
}

export interface PairEvent {
  revIndex: number
  seq: number | null
  time: string | null
  label: string
  summary: string | null
  len: number | null
  action: string | null
  round: string | null
  baselineIndex: number | null
  baselineLabel: string | null
  baselineSeq: number | null
  interveningOther: number
  analysis: RevisionAnalysis
  payloadFlags: string[]
  gapSeconds: number | null
}

export interface PairTimeline {
  orderedRevisions: Revision[]
  events: PairEvent[]
}

export const SIGNATURE_EXTRACTOR_VERSION = 'sig-extractor-v2'
export type SignatureStatus = 'second-actor-added' | 'retained' | 're-added-after-third-party'
export interface ArtifactObservation {
  pageId: string
  revIndex: number
  baselineIndex: number | null
  label: string
  artifactType: TechnicalArtifact['artifactType']
  canonicalValue: string
  beforePresent: boolean
  afterPresent: boolean
  time: string | null
  coverageStatus: 'complete' | 'unknown-genesis'
  extractorVersion: string
  identity: string
}
export interface PairObservation {
  leftLabel: string
  rightLabel: string
  artifact: string
  status: SignatureStatus
  observationRefs: string[]
  gapSeconds: number | null
  interveningOther: number
}
export interface SharedObservationRef {
  revIndex: number
  label: string
  seq: number | null
}
export interface SharedSignatureObservation {
  artifactType: TechnicalArtifact['artifactType']
  canonicalValue: string
  counts: Record<string, number>
  refs: SharedObservationRef[]
  statuses: SignatureStatus[]
  firstEvent: number
  techniqueKey?: string
  payloadClass?: 'tunnel' | 'redirect'
}
export interface SharedTechniqueObservation {
  key: string
  kind: 'service-family' | 'payload-class'
  counts: Record<string, number>
  exactValues: string[]
  firstEvent: number
}
export interface RetainedDomainObservation {
  canonicalValue: string
  labels: string[]
}
export interface PairEvidenceDerivation {
  artifacts: SharedSignatureObservation[]
  techniques: SharedTechniqueObservation[]
  commonHosts: SharedSignatureObservation[]
  coordinationLines: SharedSignatureObservation[]
  retainedDomains: RetainedDomainObservation[]
  artifactObservations: ArtifactObservation[]
  pairObservations: PairObservation[]
  firstPairEvent: PairEvent | null
  coverageStatus: 'complete' | 'unknown-genesis'
}

export interface PatternSignals {
  additive: number
  destructive: number
  mixed: number
  alternating: number
}

/** Single source of the observable-pattern chip labels shared by cards and the panel. */
export const PATTERN_SIGNAL_LABELS: Array<{ key: keyof PatternSignals; label: string }> = [
  { key: 'additive', label: 'additive/relay-like' },
  { key: 'destructive', label: 'destructive/overwrite-like' },
  { key: 'alternating', label: 'alternating' },
  { key: 'mixed', label: 'mixed operations' },
]

/** Returns `"<label> (<count>)"` chips for every non-zero signal, in fixed order. */
export function formatPatternSignals(signals: PatternSignals): Array<{ key: keyof PatternSignals; label: string; count: number }> {
  return PATTERN_SIGNAL_LABELS
    .map(({ key, label }) => ({ key, label, count: signals[key] }))
    .filter((chip) => chip.count > 0)
}

export interface PayloadSnippet {
  flag: string
  text: string
}

export interface PayloadEvidenceEntry {
  flag: string
  text: string
  revIndex: number
  time: string | null
  label: string | null
}

// Payload flag rules, Base64 validation and match scanning live in payload.ts (SSOT,
// kept in sync with data/scripts/build.py); this module only consumes them.

/**
 * Builds an id→record map once per PagesIndex; memoize the result and reuse it across
 * shared-page queries instead of re-indexing pages.json every time.
 */
export function buildPageRecordMap(pagesIndex: PagesIndex | null): Map<string, PageRecord> {
  const map = new Map<string, PageRecord>()
  if (pagesIndex?.p) {
    for (const p of pagesIndex.p) {
      if (p?.id) map.set(p.id, p)
    }
  }
  return map
}

/** Shared page ids for a label pair against a prebuilt label record lookup. */
function sharedIdsForPair(
  leftLabel: string,
  rightLabel: string,
  labelByX: Map<string, LabelRecord>,
): string[] {
  const leftRec = labelByX.get(leftLabel)
  const rightRec = labelByX.get(rightLabel)
  if (!leftRec?.pgs || !rightRec?.pgs) return []
  const rightPageSet = new Set(rightRec.pgs)
  const seen = new Set<string>()
  const shared: string[] = []
  for (const pageId of leftRec.pgs) {
    if (rightPageSet.has(pageId) && !seen.has(pageId)) {
      seen.add(pageId)
      shared.push(pageId)
    }
  }
  return shared
}

function labelMapOf(labelsIndex: LabelsIndex | null): Map<string, LabelRecord> {
  const map = new Map<string, LabelRecord>()
  if (labelsIndex?.l) {
    for (const rec of labelsIndex.l) {
      if (rec?.x) map.set(rec.x, rec)
    }
  }
  return map
}

/**
 * Intersect the two labels' page sets and map IDs to PageRecord entries.
 * Missing or unmapped page records are preserved as { id, page: null }.
 */
export function getSharedPages(
  leftLabel: string,
  rightLabel: string,
  labelsIndex: LabelsIndex | null,
  pagesIndex: PagesIndex | null,
): SharedPageEntry[] {
  if (!leftLabel || !rightLabel) return []
  const labelByX = labelMapOf(labelsIndex)
  const pageRecords = buildPageRecordMap(pagesIndex)
  return sharedIdsForPair(leftLabel, rightLabel, labelByX).map((id) => ({
    id,
    page: pageRecords.get(id) ?? null,
  }))
}

/**
 * Batch variant: shared pages for EVERY label paired with `leftLabel` in one pass.
 * Reuses a single labels lookup and a single page-record map for the whole batch.
 */
export function getSharedPagesForAll(
  leftLabel: string,
  labelsIndex: LabelsIndex | null,
  pagesIndex: PagesIndex | null,
): Map<string, SharedPageEntry[]> {
  const labelByX = labelMapOf(labelsIndex)
  const pageRecords = buildPageRecordMap(pagesIndex)
  const result = new Map<string, SharedPageEntry[]>()
  if (!labelsIndex?.l || !leftLabel) return result
  for (const rec of labelsIndex.l) {
    if (!rec?.x || rec.x === leftLabel) continue
    result.set(
      rec.x,
      sharedIdsForPair(leftLabel, rec.x, labelByX).map((id) => ({
        id,
        page: pageRecords.get(id) ?? null,
      })),
    )
  }
  return result
}

/**
 * Compare before and after text to analyze line changes and classify operation type.
 */
export function analyzeRevisionChange(before: string | null | undefined, after: string): RevisionAnalysis {
  const safeAfter = after ?? ''
  if (before == null) {
    return {
      op: 'initial',
      delta: safeAfter.length,
      added: 0,
      removed: 0,
      truncated: false,
    }
  }

  if (before === safeAfter) {
    return {
      op: 'unchanged',
      delta: 0,
      added: 0,
      removed: 0,
      truncated: false,
    }
  }

  const delta = safeAfter.length - before.length
  const rows = diffLines(before, safeAfter)

  const isTruncated = rows.some(isTruncationMarker)
  if (isTruncated) {
    return {
      op: 'mixed',
      delta,
      added: 0,
      removed: 0,
      truncated: true,
    }
  }

  let added = 0
  let removed = 0
  for (const r of rows) {
    if (r.kind === 'add') added++
    else if (r.kind === 'del') removed++
  }

  let op: RevisionOperation = 'unchanged'
  if (removed === 0 && added > 0) {
    op = safeAfter.startsWith(before) ? 'append' : 'additive'
  } else if (added === 0 && removed > 0) {
    op = 'destructive'
  } else if (added > 0 && removed > 0) {
    op = 'replace'
  } else {
    op = 'unchanged'
  }

  return {
    op,
    delta,
    added,
    removed,
    truncated: false,
  }
}

/**
 * Sort revisions chronologically. Revisions with a known seq order by seq (ties by original
 * array position). Null-seq revisions have no reliable sequence: they fall back to comparing
 * archived timestamps, and finally to original array position — never unconditionally ahead
 * of or behind the known-seq block.
 */
function stableSortRevisions(revisions: Revision[]): Revision[] {
  const indexed = (revisions ?? []).map((rev, originalIndex) => ({ rev, seq: rev.seq ?? null, originalIndex }))
  const timeOf = (entry: { rev: Revision }): number => {
    const parsed = entry.rev.time ? Date.parse(entry.rev.time) : NaN
    return Number.isNaN(parsed) ? Number.POSITIVE_INFINITY : parsed
  }
  indexed.sort((a, b) => {
    if (a.seq !== null && b.seq !== null) {
      return a.seq !== b.seq ? a.seq - b.seq : a.originalIndex - b.originalIndex
    }
    if (a.seq === null && b.seq === null) return a.originalIndex - b.originalIndex
    // Mixed known/unknown seq: both carry archive timestamps (seq order matches time order in
    // the generator), so compare on time and settle exact ties by original position. This keeps
    // the comparator transitive — unlike index-based interleaving or a hard -1/1 branch.
    const byTime = timeOf(a) - timeOf(b)
    return byTime !== 0 ? byTime : a.originalIndex - b.originalIndex
  })
  return indexed.map((entry) => entry.rev)
}

function parsedGap(previous: string | null, current: string | null): number | null {
  if (!previous || !current) return null
  const before = Date.parse(previous)
  const after = Date.parse(current)
  if (!Number.isFinite(before) || !Number.isFinite(after) || after < before) return null
  return (after - before) / 1000
}

/**
 * Build pair timeline for two labels across page revisions.
 * Events exclude revision bodies and resolve baselines against previous chronological revisions.
 */
export function buildPairTimeline(revisions: Revision[], leftLabel: string, rightLabel: string): PairTimeline {
  if (!revisions || revisions.length === 0) {
    return { orderedRevisions: [], events: [] }
  }

  const orderedRevisions = stableSortRevisions(revisions)
  const events: PairEvent[] = []
  let prevPairEventRevIndex = -1

  for (let revIndex = 0; revIndex < orderedRevisions.length; revIndex++) {
    const rev = orderedRevisions[revIndex]
    if (!rev || (rev.label !== leftLabel && rev.label !== rightLabel)) {
      continue
    }

    const startIdx = prevPairEventRevIndex === -1 ? 0 : prevPairEventRevIndex + 1
    let interveningOther = 0
    for (let k = startIdx; k < revIndex; k++) {
      const interveningLabel = orderedRevisions[k]?.label
      if (interveningLabel !== leftLabel && interveningLabel !== rightLabel) {
        interveningOther++
      }
    }

    const baselineIndex = revIndex === 0 ? null : revIndex - 1
    const baselineRev = baselineIndex !== null ? orderedRevisions[baselineIndex] : null
    const baselineLabel = baselineRev?.label ?? null
    const baselineSeq = baselineRev?.seq ?? null

    const currentBody = rev.body ?? ''
    const baselineBody = baselineRev ? (baselineRev.body ?? '') : null
    const analysis = analyzeRevisionChange(baselineBody, currentBody)
    const payloadFlags = detectPayloadFlags(currentBody)

    events.push({
      revIndex,
      seq: rev.seq ?? null,
      time: rev.time ?? null,
      label: rev.label!,
      summary: rev.summary ?? null,
      len: rev.len ?? null,
      action: rev.action ?? null,
      round: rev.round ?? null,
      baselineIndex,
      baselineLabel,
      baselineSeq,
      interveningOther,
      analysis,
      payloadFlags,
      gapSeconds: parsedGap(events.at(-1)?.time ?? null, rev.time ?? null),
    })

    prevPairEventRevIndex = revIndex
  }

  return {
    orderedRevisions,
    events,
  }
}

function artifactKey(type: string, value: string): string { return `${type}:${value}` }
function observationIdentity(pageId: string, revIndex: number, label: string, type: string, value: string): string {
  return [pageId, revIndex, label, type, value, SIGNATURE_EXTRACTOR_VERSION].join('|')
}

function sortedSignatureItems(items: SharedSignatureObservation[]): SharedSignatureObservation[] {
  return items.sort((a, b) => {
    const count = (Object.values(b.counts).reduce((x, y) => x + y, 0) - Object.values(a.counts).reduce((x, y) => x + y, 0))
    return count || a.firstEvent - b.firstEvent || a.canonicalValue.localeCompare(b.canonicalValue)
  })
}

/** Derives page-local shared signatures without line-diff attribution. */
export function derivePairEvidence(
  pageId: string,
  timeline: PairTimeline,
  leftLabel: string,
  rightLabel: string,
): PairEvidenceDerivation {
  const coverageStatus = timeline.orderedRevisions[0]?.seq === 1 ? 'complete' : 'unknown-genesis'
  const bodySets = new Map<number, Map<string, TechnicalArtifact>>()
  const getSet = (index: number): Map<string, TechnicalArtifact> => {
    if (!bodySets.has(index)) {
      const map = new Map<string, TechnicalArtifact>()
      for (const artifact of extractTechnicalArtifacts(timeline.orderedRevisions[index]?.body ?? '')) map.set(artifactKey(artifact.artifactType, artifact.canonicalValue), artifact)
      for (const line of extractLineArtifacts(timeline.orderedRevisions[index]?.body ?? '')) map.set(`line:${line}`, { artifactType: 'line', canonicalValue: line })
      bodySets.set(index, map)
    }
    return bodySets.get(index)!
  }
  const artifactObservations: ArtifactObservation[] = []
  const pairObservations: PairObservation[] = []
  const additions = new Map<string, Map<string, { count: number; firstEvent: number; refs: SharedObservationRef[]; statuses: SignatureStatus[]; artifact: TechnicalArtifact }>>()
  const firstAdded = new Map<string, string>()
  const retained = new Set<string>()
  const retainedLabelsByKey = new Map<string, Set<string>>()

  for (let eventIndex = 0; eventIndex < timeline.events.length; eventIndex++) {
    const event = timeline.events[eventIndex]
    const after = getSet(event.revIndex)
    const isGenesis = event.revIndex === 0 && coverageStatus === 'complete'
    const before = event.baselineIndex === null ? new Map() : getSet(event.baselineIndex)
    const candidates = new Set([...after.keys(), ...before.keys()])
    for (const key of candidates) {
      const artifact = after.get(key) ?? before.get(key)!
      const beforePresent = before.has(key)
      const afterPresent = after.has(key)
      const eligibleAdd = afterPresent && !beforePresent && (event.revIndex !== 0 || isGenesis)
      const identity = observationIdentity(pageId, event.revIndex, event.label, artifact.artifactType, artifact.canonicalValue)
      const isRetained = afterPresent && firstAdded.has(key) && event.label !== firstAdded.get(key) && !additions.get(key)?.has(event.label) && !retained.has(`${key}:${event.label}`)
      if (eligibleAdd || isRetained) {
        // second-actor-added is artifact-relative: only the label other than the artifact's
        // first adder earns it. A same-actor re-add carries no status unless a third-party
        // revision removed the artifact in between.
        const isFirstAdder = firstAdded.get(key) === event.label
        const afterThirdPartyRemoval = event.baselineLabel !== null && event.baselineLabel !== leftLabel && event.baselineLabel !== rightLabel && beforePresent === false
        const status: SignatureStatus | null = eligibleAdd && firstAdded.has(key)
          ? (afterThirdPartyRemoval ? 're-added-after-third-party' : isFirstAdder ? null : 'second-actor-added')
          : isRetained ? 'retained' : null
        const observation: ArtifactObservation = { pageId, revIndex: event.revIndex, baselineIndex: event.baselineIndex, label: event.label, artifactType: artifact.artifactType, canonicalValue: artifact.canonicalValue, beforePresent, afterPresent, time: event.time, coverageStatus, extractorVersion: SIGNATURE_EXTRACTOR_VERSION, identity }
        artifactObservations.push(observation)
        if (eligibleAdd) {
          const list = additions.get(key) ?? new Map()
          const actor = list.get(event.label) ?? { count: 0, firstEvent: eventIndex, refs: [], statuses: [], artifact }
          actor.count++
          actor.firstEvent = Math.min(actor.firstEvent, eventIndex)
          actor.refs.push({ revIndex: event.revIndex, label: event.label, seq: event.seq })
          if (status) actor.statuses.push(status)
          list.set(event.label, actor)
          additions.set(key, list)
        }
        if (status) pairObservations.push({ leftLabel, rightLabel, artifact: key, status, observationRefs: [identity], gapSeconds: event.gapSeconds, interveningOther: event.interveningOther })
        if (eligibleAdd && !firstAdded.has(key)) firstAdded.set(key, event.label)
        if (status === 'retained') {
          retained.add(`${key}:${event.label}`)
          const labels = retainedLabelsByKey.get(key) ?? new Set<string>()
          labels.add(event.label)
          retainedLabelsByKey.set(key, labels)
        }
      }
    }
  }
  const shared: SharedSignatureObservation[] = []
  const techniques = new Map<string, SharedTechniqueObservation>()
  for (const [key, byActor] of additions) {
    if (!byActor.has(leftLabel) || !byActor.has(rightLabel)) continue
    const left = byActor.get(leftLabel)!
    const right = byActor.get(rightLabel)!
    const separator = key.indexOf(':')
    const artifactType = key.slice(0, separator) as TechnicalArtifact['artifactType']
    const canonicalValue = key.slice(separator + 1)
    const item = { artifactType, canonicalValue, counts: { [leftLabel]: left.count, [rightLabel]: right.count }, refs: [...left.refs, ...right.refs].sort((a, b) => a.revIndex - b.revIndex), statuses: [...new Set([...left.statuses, ...right.statuses])], firstEvent: Math.min(left.firstEvent, right.firstEvent), ...(left.artifact.techniqueKey ? { techniqueKey: left.artifact.techniqueKey } : {}), ...(left.artifact.payloadClass ? { payloadClass: left.artifact.payloadClass } : {}) }
    shared.push(item)
  }
  // Technique rows are class-level: each actor's eligible additions are accumulated
  // independently over ALL artifacts of the class/family — an exact artifact shared by
  // both actors is not required. Suppress the row only when both sides added exactly the
  // same value set (a pure duplicate of the shared exact artifacts); a partial overlap
  // keeps the row because it still reports class-level diversity.
  const leftTechniqueValues = new Map<string, Set<string>>()
  const rightTechniqueValues = new Map<string, Set<string>>()
  const techniqueFirstEvent = new Map<string, number>()
  for (const byActor of additions.values()) {
    const left = byActor.get(leftLabel)
    const right = byActor.get(rightLabel)
    if (!left && !right) continue
    const artifact = (left ?? right)!.artifact
    const techniqueKeys = [artifact.techniqueKey, artifact.payloadClass].filter((value): value is string => Boolean(value))
    for (const techniqueKey of techniqueKeys) {
      if (left) {
        const values = leftTechniqueValues.get(techniqueKey) ?? new Set<string>()
        values.add(artifact.canonicalValue)
        leftTechniqueValues.set(techniqueKey, values)
      }
      if (right) {
        const values = rightTechniqueValues.get(techniqueKey) ?? new Set<string>()
        values.add(artifact.canonicalValue)
        rightTechniqueValues.set(techniqueKey, values)
      }
      const first = Math.min(left ? left.firstEvent : Number.POSITIVE_INFINITY, right ? right.firstEvent : Number.POSITIVE_INFINITY)
      techniqueFirstEvent.set(techniqueKey, Math.min(techniqueFirstEvent.get(techniqueKey) ?? Number.POSITIVE_INFINITY, first))
    }
  }
  for (const [key, leftValues] of leftTechniqueValues) {
    const rightValues = rightTechniqueValues.get(key)
    if (!rightValues || rightValues.size === 0) continue
    const fullyShared = leftValues.size === rightValues.size && [...leftValues].every((value) => rightValues.has(value))
    if (fullyShared) continue
    techniques.set(key, { key, kind: key === 'tunnel' || key === 'redirect' ? 'payload-class' : 'service-family', counts: { [leftLabel]: leftValues.size, [rightLabel]: rightValues.size }, exactValues: [...new Set([...leftValues, ...rightValues])].sort(), firstEvent: techniqueFirstEvent.get(key)! })
  }
  const allShared = sortedSignatureItems(shared)
  const artifacts = allShared.filter((item) => (item.artifactType !== 'domain' && item.artifactType !== 'line') || item.techniqueKey || item.payloadClass)
  const coordinationLines = allShared.filter((item) => item.artifactType === 'line')
  const additionsArtifactByKey = new Map<string, TechnicalArtifact>()
  for (const [key, byActor] of additions) {
    const first = byActor.values().next().value
    if (first) additionsArtifactByKey.set(key, first.artifact)
  }
  // Within one pair only the non-first label can retain, so "kept by others" reduces
  // to: the other label kept infrastructure the first label added. Restricted to
  // tunnel/redirect domains to stay a neutral infrastructure fact, not generic noise.
  // Exact-shared domains (both labels added) stay in artifacts and are not repeated here.
  const retainedDomains = [...retainedLabelsByKey.entries()]
    .filter(([key]) => key.startsWith('domain:'))
    .filter(([key]) => {
      const byActor = additions.get(key)
      return !(byActor?.has(leftLabel) && byActor?.has(rightLabel))
    })
    .filter(([key]) => {
      const artifact = additionsArtifactByKey.get(key)
      return artifact?.payloadClass === 'tunnel' || artifact?.payloadClass === 'redirect'
    })
    .map(([key, labels]) => ({ canonicalValue: key.slice('domain:'.length), labels: [...labels].sort() }))
    .sort((a, b) => a.canonicalValue.localeCompare(b.canonicalValue))
  return { artifacts, techniques: [...techniques.values()].sort((a, b) => a.key.localeCompare(b.key)), commonHosts: allShared.filter((item) => item.artifactType === 'domain' && !item.techniqueKey && !item.payloadClass), coordinationLines, retainedDomains, artifactObservations, pairObservations, firstPairEvent: timeline.events[0] ?? null, coverageStatus }
}

/**
 * Compute pattern signals from pair events.
 */
export function derivePatternSignals(events: PairEvent[]): PatternSignals {
  let additive = 0
  let destructive = 0
  let mixed = 0
  let alternating = 0

  if (!events || events.length === 0) {
    return { additive: 0, destructive: 0, mixed: 0, alternating: 0 }
  }

  for (let i = 0; i < events.length; i++) {
    const op = events[i].analysis.op
    if (op === 'append' || op === 'additive') {
      additive++
    } else if (op === 'destructive' || op === 'replace') {
      destructive++
    } else if (op === 'mixed') {
      mixed++
    }

    if (i > 0) {
      const prevLabel = events[i - 1].label
      const currLabel = events[i].label
      if (currLabel !== prevLabel) {
        let returns = false
        for (let j = i + 1; j < events.length; j++) {
          if (events[j].label === prevLabel) {
            returns = true
            break
          }
        }
        if (returns) {
          alternating++
        }
      }
    }
  }

  return { additive, destructive, mixed, alternating }
}

function extractSnippetAround(
  body: string,
  matchStart: number,
  matchEnd: number,
  maxLen = 120,
): { text: string; start: number; end: number } {
  const matchLen = matchEnd - matchStart
  if (body.length <= maxLen) {
    return { text: body.trim(), start: 0, end: body.length }
  }

  let winStart = 0
  let winEnd = body.length

  if (matchLen >= maxLen) {
    winStart = matchStart
    winEnd = Math.min(body.length, matchStart + maxLen)
  } else {
    const extra = maxLen - matchLen
    const half = Math.floor(extra / 2)
    winStart = Math.max(0, matchStart - half)
    winEnd = Math.min(body.length, winStart + maxLen)
    if (winEnd - winStart < maxLen) {
      winStart = Math.max(0, winEnd - maxLen)
    }
  }

  if (winStart > 0) {
    let spaceIdx = -1
    for (let i = winStart; i <= matchStart; i++) {
      if (/\s/.test(body[i])) {
        spaceIdx = i
        break
      }
    }
    if (spaceIdx !== -1) {
      winStart = spaceIdx + 1
    }
  }

  if (winEnd < body.length) {
    let spaceIdx = -1
    for (let i = winEnd - 1; i >= matchEnd; i--) {
      if (/\s/.test(body[i])) {
        spaceIdx = i
        break
      }
    }
    if (spaceIdx !== -1) {
      winEnd = spaceIdx
    }
  }

  return {
    text: body.slice(winStart, winEnd).trim(),
    start: winStart,
    end: winEnd,
  }
}

export function collectPayloadEvidence(
  revisions: Revision[],
  flags: string[],
  options?: { perFlagCap?: number; maxScanRevisions?: number; charBudget?: number },
): { entries: PayloadEvidenceEntry[]; scannedRevisions: number } {
  const perFlagCap = options?.perFlagCap ?? 3
  const maxScanRevisions = options?.maxScanRevisions ?? 200
  const charBudget = options?.charBudget ?? 4_000_000
  const counts = new Map(flags.map((flag) => [flag, 0]))
  const seen = new Set<string>()
  const entries: PayloadEvidenceEntry[] = []
  let scannedRevisions = 0
  let scannedChars = 0

  for (let i = revisions.length - 1; i >= 0 && scannedRevisions < maxScanRevisions; i--) {
    const needed = new Set(flags.filter((flag) => (counts.get(flag) ?? 0) < perFlagCap))
    if (needed.size === 0) break
    const revision = revisions[i]
    const text = revision.body || (revision.partial ? [...(revision.added ?? []), ...(revision.removed ?? [])].join('\n') : '')
    if (!text) continue
    if (scannedChars + text.length > charBudget) break
    scannedRevisions++
    scannedChars += text.length
    const matches = scanPayloadMatches(text, needed).sort((a, b) => a.start - b.start)
    for (const match of matches) {
      if ((counts.get(match.flag) ?? 0) >= perFlagCap) continue
      const maxLen = Math.max(120, Math.min(match.end - match.start + 40, 500))
      const snippet = extractSnippetAround(text, match.start, match.end, maxLen).text.trim()
      const key = `${match.flag}\0${snippet}`
      if (!snippet || seen.has(key)) continue
      seen.add(key)
      counts.set(match.flag, (counts.get(match.flag) ?? 0) + 1)
      entries.push({ flag: match.flag, text: snippet, revIndex: i, time: revision.time ?? null, label: revision.label ?? null })
    }
  }

  return { entries, scannedRevisions }
}

/**
 * Scan body for payload flags and extract up to 5 deduped, bounded snippets centered on matches.
 */
export function getPayloadEvidence(body: string): { flags: string[]; snippets: PayloadSnippet[] } {
  if (!body) {
    return { flags: [], snippets: [] }
  }

  const flags = detectPayloadFlags(body)
  if (flags.length === 0) {
    return { flags: [], snippets: [] }
  }

  const matches = scanPayloadMatches(body, new Set(flags)).sort(
    (a, b) => a.start - b.start || b.end - a.end,
  )

  const snippets: PayloadSnippet[] = []
  const acceptedWindows: Array<{ start: number; end: number }> = []

  for (const m of matches) {
    if (snippets.length >= 5) break

    const { text, start, end } = extractSnippetAround(body, m.start, m.end, 120)
    if (!text) continue

    // Dedupe overlapping or identical
    const isIdentical = snippets.some((s) => s.text === text)
    if (isIdentical) continue

    const overlaps = acceptedWindows.some((w) => Math.max(w.start, start) < Math.min(w.end, end))
    if (overlaps) continue

    snippets.push({ flag: m.flag, text })
    acceptedWindows.push({ start, end })
  }

  return { flags, snippets }
}
