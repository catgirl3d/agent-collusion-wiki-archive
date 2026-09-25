import { fireEvent, render, screen } from '@testing-library/react'
import { buildPairTimeline, type PairEvent, type PairTimeline, type SharedPageEntry } from '../utils/pairEvidence'
import type { PageRecord, Revision } from '../types'
import { describe, expect, it, vi } from 'vitest'
import { PairEvidencePanel } from './PairEvidencePanel'

const page: PageRecord = {
  id: 'wiki/Shared', s: 'shared', w: 'wiki', n: 'Shared', r: 2, f: '2024-01-01', l: '2024-01-02',
  d: false, del: 0, fam: '', lb: 2, labs: ['agent-a', 'agent-b'],
}

function revision(body: string, seq: number): Revision {
  return { seq, time: `2024-01-0${String(seq)}T00:00:00Z`, label: seq % 2 ? 'agent-a' : 'agent-b', ip16: null, summary: null, len: body.length, body, action: null, round: null }
}

function event(revIndex: number): PairEvent {
  return {
    revIndex, seq: revIndex + 1, time: `2024-01-0${String(revIndex + 1)}T00:00:00Z`, label: revIndex % 2 ? 'agent-a' : 'agent-b',
    summary: revIndex === 0 ? 'initial save' : null, len: 10, action: null, round: null, baselineIndex: revIndex === 0 ? null : revIndex - 1,
    baselineLabel: revIndex === 0 ? null : 'agent-a', baselineSeq: revIndex === 0 ? null : revIndex, interveningOther: 0,
    analysis: revIndex === 0 ? { op: 'initial', delta: 10, added: 0, removed: 0, truncated: false } : { op: 'replace', delta: 1, added: 1, removed: 1, truncated: false },
    payloadFlags: revIndex === 1 ? ['script'] : [],
    gapSeconds: revIndex === 0 ? null : 86400,
  }
}

function timeline(count = 2): PairTimeline {
  const orderedRevisions = Array.from({ length: count }, (_, i) => revision(i === 1 ? '<script>alert(1)</script>' : `body-${String(i)}`, i + 1))
  return { orderedRevisions, events: Array.from({ length: count }, (_, i) => event(i)) }
}

function renderPanel(overrides: Partial<React.ComponentProps<typeof PairEvidencePanel>> = {}) {
  const props = {
    leftLabel: 'agent-a', rightLabel: 'agent-b', sharedPages: [{ id: page.id, page }] as SharedPageEntry[], selectedPageId: page.id,
    timeline: timeline(), onClose: vi.fn(), onOpenPageInPageDetail: vi.fn(), onSelectPage: vi.fn(), sourceMode: 'page' as const,
    ...overrides,
  }
  return render(<PairEvidencePanel {...props} />)
}

describe('PairEvidencePanel', () => {
  it.each([
    ['loading', 'Loading revisions for Shared…'],
    ['error', 'Could not load revisions for this page. Try the full page history.'],
  ] as const)('renders the %s timeline state', (state, text) => {
    renderPanel({ timeline: state })
    expect(screen.getByText(text)).toBeInTheDocument()
  })

  it('renders empty shared-page and empty timeline states', () => {
    renderPanel({ sharedPages: [], selectedPageId: null, timeline: { orderedRevisions: [], events: [] } })

    expect(screen.getByText('No shared pages recorded for this pair.')).toBeInTheDocument()
    expect(screen.getByText('No pair events observed on this page for these labels.')).toBeInTheDocument()
  })

  it('formats revision round references and hides null-only rounds', () => {
    const tl = timeline()
    tl.events[0] = { ...tl.events[0], round: ['dse~Page#round-1'] }
    tl.events[1] = { ...tl.events[1], round: ['dse~Page#round-2', 'dse~Other#round-3', null] }

    const { container } = renderPanel({ timeline: tl })

    expect(screen.getByText('r1')).toBeInTheDocument()
    expect(screen.getByText('r2, r3')).toBeInTheDocument()
    expect(container.querySelectorAll('.pair-round-badge')).toHaveLength(2)
  })

  it('omits the round badge when only null references remain', () => {
    const tl = timeline()
    tl.events[0] = { ...tl.events[0], round: [null] }

    const { container } = renderPanel({ timeline: tl })

    expect(container.querySelectorAll('.pair-round-badge')).toHaveLength(0)
  })

  it('shows selected page metadata and calls the page selection callback', () => {
    const onSelectPage = vi.fn()
    const secondPage = { ...page, id: 'wiki/Other', n: 'Other' }
    renderPanel({ sharedPages: [{ id: page.id, page }, { id: secondPage.id, page: secondPage }], onSelectPage })

    expect(screen.getByText('Page: Shared')).toBeInTheDocument()
    expect(document.querySelector('button[aria-current="true"]')).toHaveTextContent('Shared')

    fireEvent.click(screen.getByRole('button', { name: /Otherwiki/ }))
    expect(onSelectPage).toHaveBeenCalledWith(secondPage.id)
  })

  it('expands and collapses an event to reveal the diff and payload marking', () => {
    renderPanel()
    const eventButton = screen.getByRole('button', { name: /agent-a.*replace/ })

    expect(eventButton).toHaveAttribute('aria-expanded', 'false')
    fireEvent.click(eventButton)
    expect(eventButton).toHaveAttribute('aria-expanded', 'true')
    expect(document.querySelector('mark[data-flag="script"]')).toHaveTextContent('<script')
    expect(document.querySelector('.diff-add')).toHaveTextContent('<script>alert(1)</script>')
    fireEvent.click(eventButton)
    expect(eventButton).toHaveAttribute('aria-expanded', 'false')
  })

  it('loads older events and resets the window when page selection changes', () => {
    const manyEvents = timeline(51)
    const { rerender } = renderPanel({ timeline: manyEvents })

    expect(screen.getByText('showing 50 of 51 pair events')).toBeInTheDocument()
    expect(screen.getAllByRole('button', { name: /agent-/ })).toHaveLength(50)
    fireEvent.click(screen.getByRole('button', { name: /Load older/ }))
    expect(screen.getByText('showing 51 of 51 pair events')).toBeInTheDocument()
    expect(screen.getAllByRole('button', { name: /agent-/ })).toHaveLength(51)

    const firstVisible = screen.getAllByRole('button', { name: /agent-/ })[0]
    fireEvent.click(firstVisible)
    expect(firstVisible).toHaveAttribute('aria-expanded', 'true')

    const props = {
      leftLabel: 'agent-a', rightLabel: 'agent-b', sharedPages: [{ id: page.id, page }] as SharedPageEntry[], selectedPageId: 'wiki/Other',
      timeline: manyEvents, onClose: vi.fn(), onOpenPageInPageDetail: vi.fn(), onSelectPage: vi.fn(), sourceMode: 'page' as const,
    }
    rerender(<PairEvidencePanel {...props} />)
    expect(screen.getByText('showing 50 of 51 pair events')).toBeInTheDocument()
    expect(screen.queryByText('showing 51 of 51 pair events')).not.toBeInTheDocument()
  }, 15_000)

  it('reports preceding third-party revisions for the first pair edit and no gap text', () => {
    const revisions: Revision[] = [
      { ...revision('plain', 1), label: 'third-party-x' },
      { ...revision('body from a', 2), label: 'agent-a' },
      { ...revision('body from a then b', 3), label: 'agent-b' },
    ]
    renderPanel({ timeline: buildPairTimeline(revisions, 'agent-a', 'agent-b') })

    const summary = document.querySelector('.pair-sequence-summary')
    expect(summary).toHaveTextContent('First pair edit: agent-a · rev #2 · Preceding third-party revisions: 1')
    expect(summary).not.toHaveTextContent('after previous pair edit')
  })

  it('keeps coordination-line React keys unique when lines share the first 24 characters', () => {
    const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => undefined)
    const lineA = 'confirmed sequence: alpha bravo charlie delta'
    const lineB = 'confirmed sequence: alpha bravo charlie echo'
    try {
      const revisions: Revision[] = [
        { ...revision('filler', 1), label: 'x-party' },
        { ...revision(lineA, 2), label: 'agent-a' },
        { ...revision('filler', 3), label: 'x-party' },
        { ...revision(lineA, 4), label: 'agent-b' },
        { ...revision(`${lineA}\n${lineB}`, 5), label: 'agent-a' },
        { ...revision('filler', 6), label: 'x-party' },
        { ...revision(`${lineA}\n${lineB}`, 7), label: 'agent-b' },
      ]
      const { container } = renderPanel({ timeline: buildPairTimeline(revisions, 'agent-a', 'agent-b') })

      const chips = container.querySelectorAll('.pair-coordination-lines .pair-technique-chip')
      expect(chips).toHaveLength(2)
      expect(chips[0]).toHaveTextContent(lineA)
      expect(chips[1]).toHaveTextContent(lineB)
      const duplicateKeyWarnings = errorSpy.mock.calls.filter((args) =>
        args.some((value) => typeof value === 'string' && /same key/i.test(value)),
      )
      expect(duplicateKeyWarnings).toHaveLength(0)
    } finally {
      errorSpy.mockRestore()
    }
  })

  it('renders the full common-host list inside the disclosure without wrapper elements', () => {
    const hosts = Array.from({ length: 6 }, (_, index) => `https://h${String(index)}.example.test/page`).join(' ')
    const revisions: Revision[] = [
      { ...revision(hosts, 1), label: 'agent-a' },
      { ...revision('cleared', 2), label: 'x-party' },
      { ...revision(hosts, 3), label: 'agent-b' },
    ]
    renderPanel({ timeline: buildPairTimeline(revisions, 'agent-a', 'agent-b') })

    const summary = screen.getByText('Common hosts (6)')
    expect(summary).toBeInTheDocument()
    expect(screen.queryByText(/\+1 more/)).not.toBeInTheDocument()
    const disclosure = summary.closest('details')
    if (!disclosure) throw new Error('Common-host disclosure was not found')
    expect(disclosure.querySelectorAll('.pair-signature-list > .pair-signature-chip')).toHaveLength(6)
    expect(disclosure.querySelectorAll('.pair-signature-list > *:not(.pair-signature-chip)')).toHaveLength(0)
  })

  it('does not claim no signatures when only techniques are observed', () => {
    const revisions: Revision[] = [
      { ...revision('bridge https://x.pinggy.io/a', 1), label: 'agent-a' },
      { ...revision('bridge https://y.pinggy.io/b', 2), label: 'agent-b' },
    ]
    renderPanel({ timeline: buildPairTimeline(revisions, 'agent-a', 'agent-b') })

    expect(screen.queryByText(/No shared technical signatures observed/)).not.toBeInTheDocument()
    expect(screen.getByText('Shared techniques')).toBeInTheDocument()
  })

  it('labels exact shared flagged hosts by payload class and plain domains as domain', () => {
    const body = 'tunnel https://x.pinggy.io/a plus https://plain.example.test/page'
    const revisions: Revision[] = [
      { ...revision(body, 1), label: 'agent-a' },
      { ...revision('cleared', 2), label: 'x-party' },
      { ...revision(body, 3), label: 'agent-b' },
    ]
    const { container } = renderPanel({ timeline: buildPairTimeline(revisions, 'agent-a', 'agent-b') })

    const chipFor = (value: string) => [...container.querySelectorAll('.pair-signature-chip')]
      .find((chip) => chip.querySelector('.pair-signature-value')?.textContent === value)
    expect(chipFor('x.pinggy.io')?.querySelector('.pair-signature-kind')).toHaveTextContent('tunnel')
    expect(chipFor('plain.example.test')?.querySelector('.pair-signature-kind')).toHaveTextContent('domain')
  })

  it('renders disclosed coordination lines as the same chips as the compact list', () => {
    const lines = Array.from({ length: 6 }, (_, index) => `coordination line number ${String(index)} for pair panel`)
    const body = lines.join('\n')
    const revisions: Revision[] = [
      { ...revision(body, 1), label: 'agent-a' },
      { ...revision('cleared', 2), label: 'x-party' },
      { ...revision(body, 3), label: 'agent-b' },
    ]
    renderPanel({ timeline: buildPairTimeline(revisions, 'agent-a', 'agent-b') })

    const disclosure = screen.getByText('Show 2 more lines').closest('details')
    if (!disclosure) throw new Error('Coordination-line disclosure was not found')
    expect(disclosure.querySelectorAll('.pair-signature-list > .pair-technique-chip')).toHaveLength(2)
  })

  it('renders overflow sequence observations with mono values', () => {
    const hosts = ['a', 'b', 'c', 'd', 'e'].map((prefix) => `https://${prefix}.example.test/page`).join(' ')
    const revisions: Revision[] = [
      { ...revision(hosts, 1), label: 'agent-a' },
      { ...revision('cleared', 2), label: 'x-party' },
      { ...revision(hosts, 3), label: 'agent-b' },
    ]
    const { container } = renderPanel({ timeline: buildPairTimeline(revisions, 'agent-a', 'agent-b') })

    expect(container.querySelectorAll('.pair-sequence-observations .mono')).toHaveLength(5)
  })

  it('shows the delay since the previous pair event in sequence observations', () => {
    const revisions: Revision[] = [
      { ...revision('https://x.pinggy.io/a', 1), label: 'agent-a', time: '2026-06-01T00:00:00Z' },
      { ...revision('cleared', 2), label: 'x-party', time: '2026-06-01T00:00:10Z' },
      { ...revision('https://x.pinggy.io/a', 3), label: 'agent-b', time: '2026-06-01T00:00:47Z' },
    ]
    renderPanel({ timeline: buildPairTimeline(revisions, 'agent-a', 'agent-b') })

    const rows = document.querySelectorAll('.pair-sequence-observations > div')
    expect(rows).toHaveLength(1)
    expect(rows[0]).toHaveTextContent('re-added-after-third-party')
    expect(rows[0]).toHaveTextContent('+47s')
  })

  it('omits the delay when the previous pair-event time is unusable', () => {
    const revisions: Revision[] = [
      { ...revision('https://x.pinggy.io/a', 1), label: 'agent-a', time: null },
      { ...revision('cleared', 2), label: 'x-party', time: '2026-06-01T00:00:10Z' },
      { ...revision('https://x.pinggy.io/a', 3), label: 'agent-b', time: '2026-06-01T00:00:47Z' },
    ]
    renderPanel({ timeline: buildPairTimeline(revisions, 'agent-a', 'agent-b') })

    const rows = document.querySelectorAll('.pair-sequence-observations > div')
    expect(rows).toHaveLength(1)
    expect(rows[0]).toHaveTextContent('re-added-after-third-party')
    expect(rows[0].querySelector('.text-xs')).toBeNull()
  })

  it('renders retained domains with the label that kept them', () => {
    const host = 'https://bvryr-16-146-184-55.run.pinggy-free.link/'
    const revisions: Revision[] = [
      revision(`bridge ${host}`, 1),
      revision(`bridge ${host} updated`, 2),
    ]
    renderPanel({ timeline: buildPairTimeline(revisions, 'agent-a', 'agent-b') })

    const chip = document.querySelector('.pair-retained-domains .pair-technique-chip')
    if (!chip) throw new Error('Retained-domain chip was not found')
    expect(chip).toHaveTextContent('retained')
    expect(chip).toHaveTextContent('kept by agent-b')
  })
})
