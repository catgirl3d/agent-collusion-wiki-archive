import { describe, expect, it } from 'vitest'
import type { LabelsIndex, PagesIndex, Revision } from '../types'
import {
  analyzeRevisionChange,
  buildPairTimeline,
  derivePatternSignals,
  derivePairEvidence,
  collectPayloadEvidence,
  getPayloadEvidence,
  getSharedPages,
  type PairEvent,
} from './pairEvidence'

const revision = (overrides: Partial<Revision>): Revision => ({
  seq: null, time: null, label: null, ip16: null, summary: null, len: null,
  body: '', action: null, round: null, ...overrides,
})

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

describe('collectPayloadEvidence', () => {
  it('attributes each match to the revision that contains it', () => {
    const result = collectPayloadEvidence([
      revision({ body: 'older https://x.pinggy.io/a', time: '2026-05-01T00:00:00Z', label: 'old-agent' }),
      revision({ body: 'newer https://counterapi.dev/x', time: '2026-05-02T00:00:00Z', label: 'new-agent' }),
    ], ['tunnel', 'beacon'])

    expect(result.entries).toEqual([
      { flag: 'beacon', text: 'newer https://counterapi.dev/x', revIndex: 1, time: '2026-05-02T00:00:00Z', label: 'new-agent' },
      { flag: 'tunnel', text: 'older https://x.pinggy.io/a', revIndex: 0, time: '2026-05-01T00:00:00Z', label: 'old-agent' },
    ])
  })

  it('caps entries per flag', () => {
    const result = collectPayloadEvidence(Array.from({ length: 4 }, (_, i) => revision({ body: `https://x.pinggy.io/${i}` })), ['tunnel'], { perFlagCap: 2 })
    expect(result.entries).toHaveLength(2)
    expect(result.entries.every((entry) => entry.flag === 'tunnel')).toBe(true)
  })

  it('scans recovered partial revision lines', () => {
    const result = collectPayloadEvidence([revision({ partial: true, added: ['GET https://api.counterapi.dev/v1/x/seen/up'] })], ['beacon'])
    expect(result.entries).toEqual([expect.objectContaining({ flag: 'beacon', revIndex: 0 })])
  })

  it('omits flags without a body match', () => {
    expect(collectPayloadEvidence([revision({ body: 'ordinary text' })], ['beacon']).entries).toEqual([])
  })

  it('collects distinct matches for the same flag in one revision', () => {
    const result = collectPayloadEvidence([revision({ body: `${'a'.repeat(100)} https://a.pinggy.io/x ${'b'.repeat(100)} https://b.serveo.net/y` })], ['tunnel'])
    expect(result.entries).toHaveLength(2)
    expect(result.entries.map((entry) => entry.text).join('\n')).toContain('https://a.pinggy.io/x')
    expect(result.entries.map((entry) => entry.text).join('\n')).toContain('https://b.serveo.net/y')
  })

  it('keeps long high-entropy matches intact in evidence snippets', () => {
    const token = Array.from({ length: 250 }, (_, i) => 'ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz23456789'[i % 58]).join('')
    const result = collectPayloadEvidence([revision({ body: token })], ['high-entropy'])
    expect(result.entries).toHaveLength(1)
    expect(result.entries[0].text.length).toBeGreaterThan(120)
    expect(result.entries[0].text).toContain(token.slice(0, 20))
    expect(result.entries[0].text).toContain(token.slice(-20))
  })

  it('does not count a revision rejected by the character budget as scanned', () => {
    const result = collectPayloadEvidence([
      revision({ body: 'x'.repeat(20) + ' https://x.pinggy.io/old' }),
      revision({ body: 'https://x.pinggy.io/new' }),
    ], ['tunnel'], { charBudget: 30 })
    expect(result.scannedRevisions).toBe(1)
    expect(result.entries).toHaveLength(1)
    expect(result.entries[0].revIndex).toBe(1)
  })

  it('applies caps independently for each flag', () => {
    const revisions = Array.from({ length: 4 }, (_, i) => revision({ body: `https://x.pinggy.io/${i} https://counterapi.dev/${i}` }))
    const result = collectPayloadEvidence(revisions, ['tunnel', 'beacon'], { perFlagCap: 2 })
    expect(result.entries.filter((entry) => entry.flag === 'tunnel')).toHaveLength(2)
    expect(result.entries.filter((entry) => entry.flag === 'beacon')).toHaveLength(2)
  })

  it('deduplicates identical matches without consuming a cap slot', () => {
    const result = collectPayloadEvidence([
      revision({ body: 'https://x.pinggy.io/same' }),
      revision({ body: 'https://x.pinggy.io/same' }),
      revision({ body: 'https://x.pinggy.io/third' }),
    ], ['tunnel'], { perFlagCap: 2 })
    expect(result.entries).toHaveLength(2)
    expect(result.entries.map((entry) => entry.text).join('\n')).toContain('same')
    expect(result.entries.map((entry) => entry.text).join('\n')).toContain('third')
  })

  it('limits scanning to the newest maxScanRevisions', () => {
    const result = collectPayloadEvidence([
      revision({ body: 'https://x.pinggy.io/old' }),
      revision({ body: 'https://x.pinggy.io/middle' }),
      revision({ body: 'https://x.pinggy.io/new' }),
    ], ['tunnel'], { maxScanRevisions: 1 })
    expect(result.scannedRevisions).toBe(1)
    expect(result.entries).toEqual([expect.objectContaining({ revIndex: 2 })])
  })

  it('stops at the budget and does not continue to older revisions', () => {
    const result = collectPayloadEvidence([
      revision({ body: 'https://x.pinggy.io/oldest-unique' }),
      revision({ body: 'x'.repeat(40) + ' https://x.pinggy.io/over-budget' }),
      revision({ body: 'https://x.pinggy.io/newest' }),
    ], ['tunnel'], { charBudget: 30 })
    expect(result.scannedRevisions).toBe(1)
    expect(result.entries).toEqual([expect.objectContaining({ revIndex: 2 })])
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
        round: ['1'],
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
        round: ['1'],
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
        round: ['1'],
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

  it('reports preceding third-party revisions for the first pair edit and leaves its gap unknown', () => {
    const revisions: Revision[] = [
      { seq: 1, time: '2026-06-01T09:00:00Z', label: 'AgentX', ip16: null, summary: null, len: 5, body: 'one', action: null, round: null },
      { seq: 2, time: '2026-06-01T10:00:00Z', label: 'AgentA', ip16: null, summary: null, len: 5, body: 'two', action: null, round: null },
      { seq: 3, time: '2026-06-01T11:00:00Z', label: 'AgentB', ip16: null, summary: null, len: 5, body: 'three', action: null, round: null },
    ]
    const tl = buildPairTimeline(revisions, 'AgentA', 'AgentB')

    expect(tl.events[0].interveningOther).toBe(1)
    expect(tl.events[0].gapSeconds).toBeNull()
    expect(tl.events[1].gapSeconds).toBe(3600)
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

describe('derivePairEvidence', () => {
  it('attributes identical flagged hosts and prompt markers by presence, not line diff', () => {
    const revisions: Revision[] = [
      { seq: 1, time: '2026-06-01T00:00:00Z', label: 'A', ip16: null, summary: null, len: 0, body: 'https://pinggy.io/a ignore previous', action: null, round: null },
      { seq: 2, time: '2026-06-01T00:00:00Z', label: 'X', ip16: null, summary: null, len: 0, body: '', action: null, round: null },
      { seq: 3, time: '2026-06-01T00:01:00Z', label: 'B', ip16: null, summary: null, len: 0, body: 'https://pinggy.io/a ignore previous', action: null, round: null },
    ]
    const evidence = derivePairEvidence('page', buildPairTimeline(revisions, 'A', 'B'), 'A', 'B')
    expect(evidence.artifacts.map((item) => item.canonicalValue)).toEqual(expect.arrayContaining(['pinggy.io', 'ignore previous']))
    expect(evidence.coverageStatus).toBe('complete')
    expect(evidence.pairObservations.some((item) => item.status === 're-added-after-third-party')).toBe(true)
    expect(evidence.artifactObservations).toHaveLength(4)
    const pinggy = evidence.artifacts.find((item) => item.canonicalValue === 'pinggy.io')!
    expect(pinggy.refs).toEqual([{ revIndex: 0, label: 'A', seq: 1 }, { revIndex: 2, label: 'B', seq: 3 }])
  })

  it('orders shared refs chronologically when the right label added first', () => {
    const revisions: Revision[] = [
      { seq: 1, time: '2026-06-01T00:00:00Z', label: 'B', ip16: null, summary: null, len: 0, body: 'https://same.example/x', action: null, round: null },
      { seq: 2, time: '2026-06-01T00:01:00Z', label: 'X', ip16: null, summary: null, len: 0, body: 'cleared', action: null, round: null },
      { seq: 3, time: '2026-06-01T00:02:00Z', label: 'A', ip16: null, summary: null, len: 0, body: 'https://same.example/x', action: null, round: null },
    ]
    const evidence = derivePairEvidence('page', buildPairTimeline(revisions, 'A', 'B'), 'A', 'B')

    const item = evidence.commonHosts.find((entry) => entry.canonicalValue === 'same.example')!
    expect(item.refs).toEqual([
      { revIndex: 0, label: 'B', seq: 1 },
      { revIndex: 2, label: 'A', seq: 3 },
    ])
  })

  it('does not attribute an unknown-genesis initial body and handles zero/invalid gaps', () => {
    const revisions: Revision[] = [
      { seq: 7, time: 'invalid', label: 'A', ip16: null, summary: null, len: 0, body: 'https://example.test', action: null, round: null },
      { seq: 8, time: '2026-06-01T00:00:00Z', label: 'B', ip16: null, summary: null, len: 0, body: 'https://example.test https://other.test', action: null, round: null },
    ]
    const timeline = buildPairTimeline(revisions, 'A', 'B')
    expect(timeline.events[1].gapSeconds).toBeNull()
    const evidence = derivePairEvidence('page', timeline, 'A', 'B')
    expect(evidence.coverageStatus).toBe('unknown-genesis')
    expect(evidence.artifactObservations).toHaveLength(1)
  })

  it('emits a class-level technique row when the actors add different exact hosts of one class', () => {
    const revisions: Revision[] = [
      { seq: 1, time: '2026-06-01T00:00:00Z', label: 'A', ip16: null, summary: null, len: 0, body: 'see https://markdown.new/x', action: null, round: null },
      { seq: 2, time: '2026-06-01T00:01:00Z', label: 'B', ip16: null, summary: null, len: 0, body: 'see https://r.jina.ai/y', action: null, round: null },
    ]
    const evidence = derivePairEvidence('page', buildPairTimeline(revisions, 'A', 'B'), 'A', 'B')
    expect(evidence.artifacts).toHaveLength(0)
    expect(evidence.commonHosts).toHaveLength(0)
    expect(evidence.techniques).toHaveLength(1)
    expect(evidence.techniques[0]).toMatchObject({ key: 'redirect', kind: 'payload-class', counts: { A: 1, B: 1 }, exactValues: ['markdown.new', 'r.jina.ai'] })
  })

  it('keeps flagged hosts out of the secondary common-host list', () => {
    const revisions: Revision[] = [
      { seq: 1, time: '2026-06-01T00:00:00Z', label: 'X', ip16: null, summary: null, len: 0, body: 'plain', action: null, round: null },
      { seq: 2, time: '2026-06-01T00:01:00Z', label: 'A', ip16: null, summary: null, len: 0, body: 'https://markdown.new/a https://wiki.example.test/page', action: null, round: null },
      { seq: 3, time: '2026-06-01T00:02:00Z', label: 'X', ip16: null, summary: null, len: 0, body: 'plain', action: null, round: null },
      { seq: 4, time: '2026-06-01T00:03:00Z', label: 'B', ip16: null, summary: null, len: 0, body: 'https://markdown.new/b https://wiki.example.test/page', action: null, round: null },
    ]
    const evidence = derivePairEvidence('page', buildPairTimeline(revisions, 'A', 'B'), 'A', 'B')
    expect(evidence.artifacts.map((item) => item.canonicalValue)).toEqual(['markdown.new'])
    expect(evidence.commonHosts.map((item) => item.canonicalValue)).toEqual(['wiki.example.test'])
  })

  it('emits a service-family technique row for different subdomains of one tunnel family', () => {
    const revisions: Revision[] = [
      { seq: 1, time: '2026-06-01T00:00:00Z', label: 'A', ip16: null, summary: null, len: 0, body: 'ssh over https://x.pinggy.io/a', action: null, round: null },
      { seq: 2, time: '2026-06-01T00:01:00Z', label: 'B', ip16: null, summary: null, len: 0, body: 'ssh over https://y.pinggy.io/b', action: null, round: null },
    ]
    const evidence = derivePairEvidence('page', buildPairTimeline(revisions, 'A', 'B'), 'A', 'B')
    const keys = evidence.techniques.map((row) => row.key).sort()
    expect(keys).toEqual(['pinggy', 'tunnel'])
    expect(evidence.techniques.find((row) => row.key === 'pinggy')).toMatchObject({ kind: 'service-family', counts: { A: 1, B: 1 } })
    expect(evidence.techniques.find((row) => row.key === 'tunnel')).toMatchObject({ kind: 'payload-class' })
  })

  it('keeps a partially shared technique row that still adds class-level diversity', () => {
    const revisions: Revision[] = [
      { seq: 1, time: '2026-06-01T00:00:00Z', label: 'X', ip16: null, summary: null, len: 0, body: 'plain', action: null, round: null },
      { seq: 2, time: '2026-06-01T00:01:00Z', label: 'A', ip16: null, summary: null, len: 0, body: 'https://markdown.new/a https://r.jina.ai/b', action: null, round: null },
      { seq: 3, time: '2026-06-01T00:02:00Z', label: 'X', ip16: null, summary: null, len: 0, body: 'plain', action: null, round: null },
      { seq: 4, time: '2026-06-01T00:03:00Z', label: 'B', ip16: null, summary: null, len: 0, body: 'https://markdown.new/c', action: null, round: null },
    ]
    const evidence = derivePairEvidence('page', buildPairTimeline(revisions, 'A', 'B'), 'A', 'B')
    expect(evidence.artifacts.map((item) => item.canonicalValue)).toEqual(['markdown.new'])
    expect(evidence.techniques).toHaveLength(1)
    expect(evidence.techniques[0]).toMatchObject({ key: 'redirect', counts: { A: 2, B: 1 }, exactValues: ['markdown.new', 'r.jina.ai'] })
  })

  it('suppresses a technique row only when both actors added exactly the same values', () => {
    const revisions: Revision[] = [
      { seq: 1, time: '2026-06-01T00:00:00Z', label: 'X', ip16: null, summary: null, len: 0, body: 'plain', action: null, round: null },
      { seq: 2, time: '2026-06-01T00:01:00Z', label: 'A', ip16: null, summary: null, len: 0, body: 'https://markdown.new/a', action: null, round: null },
      { seq: 3, time: '2026-06-01T00:02:00Z', label: 'X', ip16: null, summary: null, len: 0, body: 'plain', action: null, round: null },
      { seq: 4, time: '2026-06-01T00:03:00Z', label: 'B', ip16: null, summary: null, len: 0, body: 'https://markdown.new/c', action: null, round: null },
    ]
    const evidence = derivePairEvidence('page', buildPairTimeline(revisions, 'A', 'B'), 'A', 'B')
    expect(evidence.artifacts.map((item) => item.canonicalValue)).toEqual(['markdown.new'])
    expect(evidence.techniques).toHaveLength(0)
  })

  it('labels statuses artifact-relative and never marks a same-actor re-add as second-actor-added', () => {
    const revisions: Revision[] = [
      { seq: 1, time: '2026-06-01T00:00:00Z', label: 'A', ip16: null, summary: null, len: 0, body: 'https://pinggy.io/a', action: null, round: null },
      { seq: 2, time: '2026-06-01T00:01:00Z', label: 'A', ip16: null, summary: null, len: 0, body: 'clean', action: null, round: null },
      { seq: 3, time: '2026-06-01T00:02:00Z', label: 'B', ip16: null, summary: null, len: 0, body: 'https://pinggy.io/a v2', action: null, round: null },
      { seq: 4, time: '2026-06-01T00:03:00Z', label: 'X', ip16: null, summary: null, len: 0, body: 'clean', action: null, round: null },
      { seq: 5, time: '2026-06-01T00:04:00Z', label: 'A', ip16: null, summary: null, len: 0, body: 'https://pinggy.io/a v3', action: null, round: null },
      { seq: 6, time: '2026-06-01T00:05:00Z', label: 'B', ip16: null, summary: null, len: 0, body: 'clean', action: null, round: null },
      { seq: 7, time: '2026-06-01T00:06:00Z', label: 'A', ip16: null, summary: null, len: 0, body: 'https://pinggy.io/a v4', action: null, round: null },
    ]
    const evidence = derivePairEvidence('page', buildPairTimeline(revisions, 'A', 'B'), 'A', 'B')
    const item = evidence.artifacts.find((entry) => entry.canonicalValue === 'pinggy.io')
    expect(item).toBeDefined()
    expect(item!.counts).toEqual({ A: 3, B: 1 })
    expect(new Set(item!.statuses)).toEqual(new Set(['second-actor-added', 're-added-after-third-party']))
    const byStatus = new Map(evidence.pairObservations.filter((row) => row.artifact === 'domain:pinggy.io').map((row) => [row.status, row.observationRefs]))
    expect(byStatus.get('second-actor-added')).toEqual(['page|2|B|domain|pinggy.io|sig-extractor-v2'])
    expect(byStatus.get('re-added-after-third-party')).toEqual(['page|4|A|domain|pinggy.io|sig-extractor-v2'])
    // A's re-add at seq 7 (revIndex 6, own selected-label baseline) carries no status
    expect(evidence.pairObservations.filter((row) => row.artifact === 'domain:pinggy.io')).toHaveLength(2)
    expect(evidence.artifactObservations).toHaveLength(4)
  })

  it('matches identical coordination lines added by both labels and keeps them out of flagged artifacts', () => {
    const revisions: Revision[] = [
      { seq: 1, time: '2026-06-01T00:00:00Z', label: 'A', ip16: null, summary: null, len: 0, body: 'CONFIRMED sequence: MA -> CT -> MI -> WV', action: null, round: null },
      { seq: 2, time: '2026-06-01T00:01:00Z', label: 'X', ip16: null, summary: null, len: 0, body: 'cleared', action: null, round: null },
      { seq: 3, time: '2026-06-01T00:02:00Z', label: 'B', ip16: null, summary: null, len: 0, body: 'confirmed   sequence: ma -> ct -> mi -> wv', action: null, round: null },
    ]
    const evidence = derivePairEvidence('page', buildPairTimeline(revisions, 'A', 'B'), 'A', 'B')
    expect(evidence.artifacts).toHaveLength(0)
    expect(evidence.coordinationLines).toHaveLength(1)
    expect(evidence.coordinationLines[0]).toMatchObject({ artifactType: 'line', canonicalValue: 'confirmed sequence: ma -> ct -> mi -> wv' })
    expect(evidence.techniques).toHaveLength(0)
  })

  it('excludes URLs, wiki markup, and short lines from coordination matching', () => {
    const revisions: Revision[] = [
      { seq: 1, time: '2026-06-01T00:00:00Z', label: 'A', ip16: null, summary: null, len: 0, body: 'https://markdown.new/x\n== Header ==\nok\nA normal shared coordination sentence here', action: null, round: null },
      { seq: 2, time: '2026-06-01T00:01:00Z', label: 'X', ip16: null, summary: null, len: 0, body: 'cleared', action: null, round: null },
      { seq: 3, time: '2026-06-01T00:02:00Z', label: 'B', ip16: null, summary: null, len: 0, body: 'https://markdown.new/x\n== Header ==\nok\nA normal shared coordination sentence here', action: null, round: null },
    ]
    const evidence = derivePairEvidence('page', buildPairTimeline(revisions, 'A', 'B'), 'A', 'B')
    expect(evidence.coordinationLines.map((item) => item.canonicalValue)).toEqual(['a normal shared coordination sentence here'])
  })

  it('reports tunnel domains added by one label and retained by the other', () => {
    const revisions: Revision[] = [
      { seq: 1, time: '2026-06-01T00:00:00Z', label: 'A', ip16: null, summary: null, len: 0, body: 'bridge https://bvryr-16-146-184-55.run.pinggy-free.link/', action: null, round: null },
      { seq: 2, time: '2026-06-01T00:01:00Z', label: 'B', ip16: null, summary: null, len: 0, body: 'bridge https://bvryr-16-146-184-55.run.pinggy-free.link/ updated', action: null, round: null },
      { seq: 3, time: '2026-06-01T00:02:00Z', label: 'B', ip16: null, summary: null, len: 0, body: 'bridge https://bvryr-16-146-184-55.run.pinggy-free.link/ updated again', action: null, round: null },
    ]
    const evidence = derivePairEvidence('page', buildPairTimeline(revisions, 'A', 'B'), 'A', 'B')
    expect(evidence.artifacts).toHaveLength(0)
    expect(evidence.retainedDomains).toHaveLength(1)
    expect(evidence.retainedDomains[0]).toMatchObject({ canonicalValue: 'bvryr-16-146-184-55.run.pinggy-free.link', labels: ['B'] })
  })

  it('does not report ordinary hosts kept by the other label as retained infrastructure', () => {
    const revisions: Revision[] = [
      { seq: 1, time: '2026-06-01T00:00:00Z', label: 'A', ip16: null, summary: null, len: 0, body: 'see https://wiki.example.test/page', action: null, round: null },
      { seq: 2, time: '2026-06-01T00:01:00Z', label: 'B', ip16: null, summary: null, len: 0, body: 'see https://wiki.example.test/page now', action: null, round: null },
    ]
    const evidence = derivePairEvidence('page', buildPairTimeline(revisions, 'A', 'B'), 'A', 'B')
    expect(evidence.retainedDomains).toHaveLength(0)
  })

  it('does not emit a retained observation for an actor that already added the artifact', () => {
    const revisions: Revision[] = [
      { seq: 1, time: '2026-06-01T00:00:00Z', label: 'A', ip16: null, summary: null, len: 0, body: 'https://pinggy.io/a', action: null, round: null },
      { seq: 2, time: '2026-06-01T00:01:00Z', label: 'A', ip16: null, summary: null, len: 0, body: 'clean', action: null, round: null },
      { seq: 3, time: '2026-06-01T00:02:00Z', label: 'B', ip16: null, summary: null, len: 0, body: 'https://pinggy.io/a v1', action: null, round: null },
      { seq: 4, time: '2026-06-01T00:03:00Z', label: 'B', ip16: null, summary: null, len: 0, body: 'https://pinggy.io/a v2', action: null, round: null },
    ]
    const evidence = derivePairEvidence('page', buildPairTimeline(revisions, 'A', 'B'), 'A', 'B')
    const statuses = evidence.pairObservations
      .filter((row) => row.artifact === 'domain:pinggy.io')
      .map((row) => row.status)

    expect(statuses).toEqual(['second-actor-added'])
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
      gapSeconds: null,
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

  it('keeps snippet offsets in body coordinates when lowercasing changes length', () => {
    // U+0130 lowercases to two UTF-16 units; before the fix the snippet started after the marker's first char.
    const body = 'z'.repeat(49) + '\u0130  ignore previous' + 'q'.repeat(140)
    const res = getPayloadEvidence(body)
    expect(res.flags).toContain('inject')
    expect(res.snippets).toHaveLength(1)
    expect(res.snippets[0].text).toContain('\u0130')
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
