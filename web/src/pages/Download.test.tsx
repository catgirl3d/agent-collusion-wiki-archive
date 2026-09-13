import { render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import Download from './Download'

const loadJsonMock = vi.hoisted(() => vi.fn())
vi.mock('../api', () => ({ loadJson: loadJsonMock }))

const summary = {
  source: 'https://collusion.wiki/explorer/download.html',
  counts: { revisions: 14591, pages: 4579, labels: 3103, events: { save: 14591 } },
  days: 55,
  max_day: { date: '2026-06-18', saves: 5884 },
}

describe('Download', () => {
  afterEach(() => {
    loadJsonMock.mockReset()
    vi.restoreAllMocks()
  })

  it('renders when the supplement block has no counts', async () => {
    loadJsonMock.mockResolvedValue({ ...summary, supplement: { source: 'x', recovered: '2026-09-07', sha256: 'z', bytes: 1 } })

    render(<Download />)

    expect(await screen.findByText(/full \+ 0 recovered\./)).toBeInTheDocument()
  })

  it('shows recovered revision totals when present', async () => {
    loadJsonMock.mockResolvedValue({
      ...summary,
      supplement: { source: 'x', recovered: '2026-09-07', sha256: 'z', bytes: 1, counts: { pages: 8, revisions: 90 } },
    })

    render(<Download />)

    expect(await screen.findByText(/full \+ 90 recovered\./)).toBeInTheDocument()
  })

  it('uses stable en-US formatting for archive counts', async () => {
    const originalToLocaleString = Number.prototype.toLocaleString
    const localeSpy = vi.spyOn(Number.prototype, 'toLocaleString').mockImplementation(function (
      this: number,
      locales?: Intl.LocalesArgument,
      options?: Intl.NumberFormatOptions,
    ) {
      if (locales === undefined) return String(this).replace(/\B(?=(\d{3})+(?!\d))/g, '.')
      return originalToLocaleString.call(this, locales, options)
    })
    loadJsonMock.mockResolvedValue({
      ...summary,
      combined: { revisions: 14591, pages: 4579 },
      supplement: { source: 'x', recovered: '2026-09-07', sha256: 'z', bytes: 1, counts: { pages: 8, revisions: 90 } },
    })

    render(<Download />)

    await screen.findByText('Count reconciliation')
    expect(document.body.textContent).toContain('14,591 edits')
    expect(document.body.textContent).toContain('4,579 pages')
    expect(document.body.textContent).toContain('14,591 full + 90 recovered.')
    expect(localeSpy).toHaveBeenCalledWith('en-US')
  })
})
