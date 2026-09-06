import type { LabelRecord, LabelsIndex, PageRecord, PagesIndex, Revision } from '../types'
import { diffLines, isTruncationMarker } from './diff'
import { detectPayloadFlags, scanPayloadMatches } from './payload'

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
}

export interface PairTimeline {
  orderedRevisions: Revision[]
  events: PairEvent[]
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
    })

    prevPairEventRevIndex = revIndex
  }

  return {
    orderedRevisions,
    events,
  }
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
