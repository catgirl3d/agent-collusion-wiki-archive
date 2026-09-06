import { fireEvent, render, screen } from '@testing-library/react'
import type { PairEvent, PairTimeline, SharedPageEntry } from '../utils/pairEvidence'
import type { PageRecord, Revision } from '../types'
import { describe, expect, it, vi } from 'vitest'
import { PairEvidencePanel } from './PairEvidencePanel'

const page: PageRecord = {
  id: 'wiki/Shared', s: 'shared', w: 'wiki', n: 'Shared', r: 2, f: '2024-01-01', l: '2024-01-02',
  d: false, del: 0, fam: '', lb: 2, labs: ['agent-a', 'agent-b'],
}

function revision(body: string, seq: number): Revision {
  return { seq, time: `2024-01-0${seq}T00:00:00Z`, label: seq % 2 ? 'agent-a' : 'agent-b', ip16: null, summary: null, len: body.length, body, action: null, round: null }
}

function event(revIndex: number): PairEvent {
  return {
    revIndex, seq: revIndex + 1, time: `2024-01-0${revIndex + 1}T00:00:00Z`, label: revIndex % 2 ? 'agent-a' : 'agent-b',
    summary: revIndex === 0 ? 'initial save' : null, len: 10, action: null, round: null, baselineIndex: revIndex === 0 ? null : revIndex - 1,
    baselineLabel: revIndex === 0 ? null : 'agent-a', baselineSeq: revIndex === 0 ? null : revIndex, interveningOther: 0,
    analysis: revIndex === 0 ? { op: 'initial', delta: 10, added: 0, removed: 0, truncated: false } : { op: 'replace', delta: 1, added: 1, removed: 1, truncated: false },
    payloadFlags: revIndex === 1 ? ['script'] : [],
  }
}

function timeline(count = 2): PairTimeline {
  const orderedRevisions = Array.from({ length: count }, (_, i) => revision(i === 1 ? '<script>alert(1)</script>' : `body-${i}`, i + 1))
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
})
