import { describe, expect, it } from 'vitest'
import type { LabelsIndex, PagesIndex, Revision } from '../types'
import {
  analyzeRevisionChange,
  buildPairTimeline,
  derivePatternSignals,
  getPayloadEvidence,
  getSharedPages,
  type PairEvent,
} from './pairEvidence'

describe('getSharedPages', () => {
  it('intersects complete page sets and preserves unmapped page IDs as null', () => {
    const labelsIndex: LabelsIndex = {
      l: [
        {
          x: 'AgentA',
          r: 10,
          f: '2026-01-01',
          t: '2026-02-01',
          p: 4,
          h: false,
          w: ['main'],
          pgs: ['page-1', 'page-2', 'page-3', 'page-4', 'page-only-a'],
        },
        {
          x: 'AgentB',
          r: 10,
          f: '2026-01-01',
          t: '2026-02-01',
          p: 4,
          h: false,
          w: ['main'],
          pgs: ['page-1', 'page-2', 'page-3', 'page-4', 'page-only-b'],
        },
      ],
      n_anon: 0,
    }

    const pagesIndex: PagesIndex = {
      p: [
        {
          id: 'page-1',
          s: 'page_1',
          w: 'main',
          n: 'Page One',
          r: 5,
          f: '2026-01-01',
          l: '2026-01-05',
          d: false,
          del: 0,
          fam: 'wiki',
          lb: 2,
          labs: ['AgentA', 'AgentB'],
        },
        {
          id: 'page-2',
          s: 'page_2',
          w: 'main',
          n: 'Page Two',
          r: 5,
          f: '2026-01-01',
          l: '2026-01-05',
          d: false,
          del: 0,
          fam: 'wiki',
          lb: 2,
          labs: ['AgentA', 'AgentB'],
        },
        {
          id: 'page-3',
          s: 'page_3',
          w: 'main',
          n: 'Page Three',
          r: 5,
          f: '2026-01-01',
          l: '2026-01-05',
          d: false,
          del: 0,
          fam: 'wiki',
          lb: 2,
          labs: ['AgentA', 'AgentB'],
        },
      ],
      order: 'r',
    }

    const shared = getSharedPages('AgentA', 'AgentB', labelsIndex, pagesIndex)

    // All 4 shared pages must be present without preview cap
    expect(shared).toHaveLength(4)
    expect(shared.map((s) => s.id)).toEqual(['page-1', 'page-2', 'page-3', 'page-4'])

    // Mapped records
    expect(shared[0].page?.n).toBe('Page One')
    expect(shared[1].page?.n).toBe('Page Two')
    expect(shared[2].page?.n).toBe('Page Three')

    // Unmapped page ID preserved as null without guessed slug
    expect(shared[3]).toEqual({
      id: 'page-4',
      page: null,
    })
  })

  it('returns empty array when either label is unknown or missing', () => {
    const labelsIndex: LabelsIndex = {
      l: [
        {
          x: 'AgentA',
          r: 1,
          f: '2026-01-01',
          t: '2026-02-01',
          p: 1,
          h: false,
          w: ['main'],
          pgs: ['page-1'],
        },
      ],
      n_anon: 0,
    }

    expect(getSharedPages('AgentA', 'UnknownAgent', labelsIndex, null)).toEqual([])
    expect(getSharedPages('AgentA', 'AgentB', null, null)).toEqual([])
    expect(getSharedPages('', 'AgentA', labelsIndex, null)).toEqual([])
  })
})

describe('analyzeRevisionChange', () => {
  it('handles initial revision when before is null or undefined', () => {
    const res = analyzeRevisionChange(null, 'Hello world')
    expect(res).toEqual({
      op: 'initial',
      delta: 11,
      added: 0,
      removed: 0,
      truncated: false,
    })

    const resUndef = analyzeRevisionChange(undefined, 'Test')
    expect(resUndef).toEqual({
      op: 'initial',
      delta: 4,
      added: 0,
      removed: 0,
      truncated: false,
    })
  })

  it('handles unchanged content', () => {
    const res = analyzeRevisionChange('Same content\nline 2', 'Same content\nline 2')
    expect(res).toEqual({
      op: 'unchanged',
      delta: 0,
      added: 0,
      removed: 0,
      truncated: false,
    })
  })

  it('identifies append when new lines are added at the end', () => {
    const before = 'Line 1\nLine 2'
    const after = 'Line 1\nLine 2\nLine 3'
    const res = analyzeRevisionChange(before, after)
    expect(res.op).toBe('append')
    expect(res.added).toBeGreaterThan(0)
    expect(res.removed).toBe(0)
    expect(res.delta).toBe(after.length - before.length)
    expect(res.truncated).toBe(false)
  })

  it('identifies additive when lines are added not as a simple append prefix', () => {
    const before = 'Line 2\nLine 3'
    const after = 'Line 1\nLine 2\nLine 3'
    const res = analyzeRevisionChange(before, after)
    expect(res.op).toBe('additive')
    expect(res.added).toBeGreaterThan(0)
    expect(res.removed).toBe(0)
    expect(res.truncated).toBe(false)
  })

  it('identifies destructive when lines are only deleted', () => {
    const before = 'Line 1\nLine 2\nLine 3'
    const after = 'Line 1\nLine 3'
    const res = analyzeRevisionChange(before, after)
    expect(res.op).toBe('destructive')
    expect(res.removed).toBeGreaterThan(0)
    expect(res.added).toBe(0)
    expect(res.delta).toBe(after.length - before.length)
    expect(res.truncated).toBe(false)
  })

  it('identifies replace when both additions and removals occur', () => {
    const before = 'Line 1\nOld Line\nLine 3'
    const after = 'Line 1\nNew Line\nLine 3'
    const res = analyzeRevisionChange(before, after)
    expect(res.op).toBe('replace')
    expect(res.added).toBeGreaterThan(0)
    expect(res.removed).toBeGreaterThan(0)
    expect(res.truncated).toBe(false)
  })

  it('identifies truncated mixed for >600 line fallback diffs', () => {
    const beforeLines = Array.from({ length: 650 }, (_, i) => `Before line ${i}`)
    const afterLines = Array.from({ length: 650 }, (_, i) => `After line ${i}`)
    const before = beforeLines.join('\n')
    const after = afterLines.join('\n')

    const res = analyzeRevisionChange(before, after)
    expect(res.truncated).toBe(true)
    expect(res.op).toBe('mixed')
    expect(res.added).toBe(0)
    expect(res.removed).toBe(0)
    expect(res.delta).toBe(after.length - before.length)
  })
})

describe('buildPairTimeline', () => {
  it('filters to pair actors only, preserves chronological order, and counts intervening third-label revisions', () => {
    const revisions: Revision[] = [
      {
        seq: 1,
        time: '2026-06-01T10:00:00Z',
        label: 'AgentA',
        ip16: null,
        summary: 'Initial by A',
        len: 10,
        body: 'Initial text by A',
        action: 'edit',
        round: '1',
      },
      {
        seq: 2,
        time: '2026-06-01T10:10:00Z',
        label: 'AgentX', // Third party
        ip16: null,
        summary: 'Intervening edit by X',
        len: 25,
        body: 'Initial text by A\nIntervening from X',
        action: 'edit',
        round: '1',
      },
      {
        seq: 3,
        time: '2026-06-01T10:20:00Z',
        label: 'AgentB',
        ip16: null,
        summary: 'Follow-up by B',
        len: 40,
        body: 'Initial text by A\nIntervening from X\nAppended by B',
        action: 'edit',
        round: '1',
      },
    ]

    const tl = buildPairTimeline(revisions, 'AgentA', 'AgentB')

    // Timeline only includes AgentA and AgentB
    expect(tl.events).toHaveLength(2)
    expect(tl.events.map((e) => e.label)).toEqual(['AgentA', 'AgentB'])

    // First event (AgentA)
    const evA = tl.events[0]
    expect(evA.revIndex).toBe(0)
    expect(evA.baselineIndex).toBeNull()
    expect(evA.baselineLabel).toBeNull()
    expect(evA.interveningOther).toBe(0)
    expect(evA.analysis.op).toBe('initial')

    // Second event (AgentB)
    const evB = tl.events[1]
    expect(evB.revIndex).toBe(2)
    expect(evB.baselineIndex).toBe(1)
    expect(evB.baselineLabel).toBe('AgentX')
    expect(evB.baselineSeq).toBe(2)
    expect(evB.interveningOther).toBe(1)
    expect(evB.analysis.op).toBe('append')
  })

  it('resolves event revIndex against orderedRevisions without copying body into events', () => {
    const revisions: Revision[] = [
      {
        seq: 2,
        time: '2026-06-01T11:00:00Z',
        label: 'AgentB',
        ip16: null,
        summary: 'Second',
        len: 20,
        body: 'Second body text',
        action: null,
        round: null,
      },
      {
        seq: 1,
        time: '2026-06-01T10:00:00Z',
        label: 'AgentA',
        ip16: null,
        summary: 'First',
        len: 10,
        body: 'First body text',
        action: null,
        round: null,
      },
    ]

    const tl = buildPairTimeline(revisions, 'AgentA', 'AgentB')

    // Revisions were sorted by seq ascending
    expect(tl.orderedRevisions[0].seq).toBe(1)
    expect(tl.orderedRevisions[1].seq).toBe(2)

    // Events point to correct ordered index
    expect(tl.events[0].revIndex).toBe(0)
    expect(tl.orderedRevisions[tl.events[0].revIndex].body).toBe('First body text')

    expect(tl.events[1].revIndex).toBe(1)
    expect(tl.orderedRevisions[tl.events[1].revIndex].body).toBe('Second body text')

    // Events must never have body property
    for (const ev of tl.events) {
      expect(ev).not.toHaveProperty('body')
    }
  })

  it('handles third-party baseline correctly for diff operations', () => {
    const revisions: Revision[] = [
      {
        seq: 1,
        time: '2026-06-01T10:00:00Z',
        label: 'ThirdParty',
        ip16: null,
        summary: null,
        len: 20,
        body: 'Line 1\nLine 2\nLine 3',
        action: null,
        round: null,
      },
      {
        seq: 2,
        time: '2026-06-01T10:05:00Z',
        label: 'AgentA',
        ip16: null,
        summary: null,
        len: 10,
        body: 'Line 1\nLine 3', // deleted Line 2
        action: null,
        round: null,
      },
    ]

    const tl = buildPairTimeline(revisions, 'AgentA', 'AgentB')
    expect(tl.events).toHaveLength(1)
    const ev = tl.events[0]
    expect(ev.baselineIndex).toBe(0)
    expect(ev.baselineLabel).toBe('ThirdParty')
    expect(ev.interveningOther).toBe(1)
    expect(ev.analysis.op).toBe('destructive')
  })

  it('orders null-seq revisions by timestamp against known-seq neighbors', () => {
    const revisions: Revision[] = [
      { seq: 1, time: '2026-06-01T10:00:00Z', label: 'AgentA', ip16: null, summary: null, len: 5, body: 'one', action: null, round: null },
      { seq: null, time: '2026-06-01T12:00:00Z', label: 'AgentB', ip16: null, summary: null, len: 5, body: 'two', action: null, round: null },
      { seq: 3, time: '2026-06-01T11:00:00Z', label: 'AgentA', ip16: null, summary: null, len: 5, body: 'three', action: null, round: null },
    ]
    const tl = buildPairTimeline(revisions, 'AgentA', 'AgentB')
    // Known seqs never reorder among themselves (seq 1 before seq 3). The null-seq entry is
    // NOT pinned to the front: it sorts against each known-seq neighbor by timestamp, and
    // 12:00 > 11:00 places it after seq 3.
    expect(tl.orderedRevisions.map((r) => r.body)).toEqual(['one', 'three', 'two'])
  })

  it('sorts null-seq revisions before a known-seq revision with a later timestamp', () => {
    const revisions: Revision[] = [
      { seq: null, time: '2026-06-01T09:00:00Z', label: 'AgentB', ip16: null, summary: null, len: 5, body: 'early', action: null, round: null },
      { seq: 1, time: '2026-06-01T10:00:00Z', label: 'AgentA', ip16: null, summary: null, len: 5, body: 'one', action: null, round: null },
    ]
    const tl = buildPairTimeline(revisions, 'AgentA', 'AgentB')
    expect(tl.orderedRevisions.map((r) => r.body)).toEqual(['early', 'one'])
  })
})

describe('derivePatternSignals', () => {
  function makeMockEvent(label: string, op: PairEvent['analysis']['op']): PairEvent {
    return {
      revIndex: 0,
      seq: 1,
      time: '2026-01-01',
      label,
      summary: null,
      len: 10,
      action: null,
      round: null,
      baselineIndex: null,
      baselineLabel: null,
      baselineSeq: null,
      interveningOther: 0,
      analysis: {
        op,
        delta: 10,
        added: 1,
        removed: 0,
        truncated: false,
      },
      payloadFlags: [],
    }
  }

  it('detects alternating sequence A -> B -> A', () => {
    const events: PairEvent[] = [
      makeMockEvent('AgentA', 'append'),
      makeMockEvent('AgentB', 'additive'),
      makeMockEvent('AgentA', 'append'),
    ]

    const signals = derivePatternSignals(events)
    expect(signals.alternating).toBe(1)
    expect(signals.additive).toBe(3)
    expect(signals.destructive).toBe(0)
    expect(signals.mixed).toBe(0)
  })

  it('counts destructive and mixed operations independently', () => {
    const events: PairEvent[] = [
      makeMockEvent('AgentA', 'destructive'),
      makeMockEvent('AgentB', 'replace'),
      makeMockEvent('AgentA', 'mixed'),
    ]

    const signals = derivePatternSignals(events)
    expect(signals.destructive).toBe(2) // destructive + replace
    expect(signals.mixed).toBe(1)
    expect(signals.additive).toBe(0)
    expect(signals.alternating).toBe(1)
  })

  it('returns zeros for empty events array', () => {
    expect(derivePatternSignals([])).toEqual({
      additive: 0,
      destructive: 0,
      mixed: 0,
      alternating: 0,
    })
  })
})

describe('getPayloadEvidence', () => {
  it('returns empty snippets when body has no payload flags', () => {
    const res = getPayloadEvidence('Just innocent wiki documentation text with no payloads.')
    expect(res.flags).toEqual([])
    expect(res.snippets).toEqual([])
  })

  it('extracts snippets attributed to flags present in the body', () => {
    const body = 'Start of text with <script>evilPayload()</script> inside the page.'
    const res = getPayloadEvidence(body)
    expect(res.flags).toContain('script')
    expect(res.snippets.length).toBeGreaterThanOrEqual(1)
    expect(res.snippets[0].flag).toBe('script')
    expect(res.snippets[0].text).toContain('<script')
    expect(res.snippets[0].text.length).toBeLessThanOrEqual(120)
  })

  it('deduplicates overlapping matches and caps at 5 snippets', () => {
    // Repeated inject triggers spread out
    const parts = [
      'system: trigger alpha and more context text here',
      'system: trigger beta and more context text here',
      'system: trigger gamma and more context text here',
      'system: trigger delta and more context text here',
      'system: trigger epsilon and more context text here',
      'system: trigger zeta and more context text here',
      'system: trigger eta and more context text here',
    ]
    const body = parts.join('\n\n')
    const res = getPayloadEvidence(body)
    expect(res.snippets.length).toBeLessThanOrEqual(5)

    // Overlapping triggers in close proximity
    const closeBody = 'system: ignore previous command right here in one sentence'
    const closeRes = getPayloadEvidence(closeBody)
    expect(closeRes.snippets.length).toBe(1)
  })
})

describe('robustness on edge cases', () => {
  it('handles empty revisions, null labels, null seq, and malformed inputs gracefully without throwing', () => {
    expect(() => buildPairTimeline([], 'AgentA', 'AgentB')).not.toThrow()

    const malformedRevisions: Revision[] = [
      {
        seq: null,
        time: null,
        label: null,
        ip16: null,
        summary: null,
        len: null,
        body: '',
        action: null,
        round: null,
      },
      {
        seq: 1,
        time: null,
        label: 'AgentA',
        ip16: null,
        summary: null,
        len: null,
        body: 'Hello',
        action: null,
        round: null,
      },
    ]

    expect(() => buildPairTimeline(malformedRevisions, 'AgentA', 'AgentB')).not.toThrow()
    const tl = buildPairTimeline(malformedRevisions, 'AgentA', 'AgentB')
    expect(tl.events).toHaveLength(1)
    expect(tl.events[0].label).toBe('AgentA')

    expect(() => analyzeRevisionChange(null, '')).not.toThrow()
    expect(() => analyzeRevisionChange('', '')).not.toThrow()
    expect(() => getPayloadEvidence('')).not.toThrow()
  })
})
