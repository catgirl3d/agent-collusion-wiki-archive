import { fireEvent, render, screen } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import Dashboard from './Dashboard'

const loadJsonMock = vi.hoisted(() => vi.fn())
vi.mock('../api', () => ({ loadJson: loadJsonMock }))

class ResizeObserverStub {
  observe() { return undefined }
  unobserve() { return undefined }
  disconnect() { return undefined }
}

const summary = {
  source: 'https://collusion.wiki/explorer/download.html',
  counts: { revisions: 14591, pages: 4579, labels: 3103, events: { save: 14591 } },
  days: 55,
  max_day: { date: '2026-06-18', saves: 5884 },
}
const byDay = [
  { date: '2026-05-11', wiki: 'publictestwiki', saves: 9, deletes: 0, reverts: 0, probes: 0, bytes: 0, rec: 9 },
]
const byHour = [{ hour: '19', saves: 3 }]

function mockData(value: unknown) {
  loadJsonMock.mockImplementation((path: string) => {
    if (path === 'summary.json') return Promise.resolve(value)
    if (path === 'activity_by_day.json') return Promise.resolve(byDay)
    if (path === 'activity_by_hour.json') return Promise.resolve(byHour)
    if (path === 'events_head.json') return Promise.resolve([])
    return Promise.resolve({})
  })
}

describe('Dashboard', () => {
  beforeEach(() => {
    vi.stubGlobal('ResizeObserver', ResizeObserverStub)
  })

  afterEach(() => {
    loadJsonMock.mockReset()
    loadJsonMock.mockImplementation(() => Promise.resolve({}))
  })

  it('renders when the supplement block has no counts', async () => {
    mockData({ ...summary, supplement: { source: 'x', recovered: '2026-09-07', sha256: 'z', bytes: 1 } })

    render(
      <MemoryRouter>
        <Dashboard />
      </MemoryRouter>,
    )

    expect(await screen.findByText('14,591 full + 0 recovered')).toBeInTheDocument()
  })

  it('shows combined totals with the recovered split', async () => {
    mockData({
      ...summary,
      combined: { revisions: 14681, pages: 4587 },
      supplement: { source: 'x', recovered: '2026-09-07', sha256: 'z', bytes: 1, counts: { pages: 8, revisions: 90 } },
    })

    render(
      <MemoryRouter>
        <Dashboard />
      </MemoryRouter>,
    )

    expect(await screen.findByText('14,591 full + 90 recovered')).toBeInTheDocument()
    expect(screen.getByText('4,579 full + 8 recovered')).toBeInTheDocument()
  })

  it('includes recovered wiki totals in the edits table', async () => {
    mockData({
      ...summary,
      per_wiki: { dse: { revisions: { value: 3 }, pages: { value: 1 }, body_bytes: { value: 10 } } },
      supplement: {
        source: 'x', recovered: '2026-09-07', sha256: 'z', bytes: 1,
        counts: { pages: 8, revisions: 90 },
        per_wiki: { publictestwiki: { pages: 4, revisions: 58 } },
      },
    })

    render(
      <MemoryRouter>
        <Dashboard />
      </MemoryRouter>,
    )

    expect(await screen.findByText('publictestwiki')).toBeInTheDocument()
    expect(screen.getByText('58')).toBeInTheDocument()
    expect(screen.getByText('4 pages')).toBeInTheDocument()
    expect(screen.getByText('—')).toBeInTheDocument()
  })

  it('renders semantic column headers for dashboard tables', async () => {
    mockData(summary)

    render(
      <MemoryRouter>
        <Dashboard />
      </MemoryRouter>,
    )

    const tables = await screen.findAllByRole('table')
    for (const table of tables) {
      expect(table.querySelectorAll('thead th[scope="col"]').length).toBeGreaterThan(0)
    }
  })

  it('wraps dashboard tables in horizontal scroll containers', async () => {
    mockData(summary)

    render(
      <MemoryRouter>
        <Dashboard />
      </MemoryRouter>,
    )

    const tables = await screen.findAllByRole('table')
    for (const table of tables) {
      expect(table.closest('.table-wrap')).not.toBeNull()
    }
  })

  it('loads the events head instead of the full event set', async () => {
    mockData(summary)

    render(
      <MemoryRouter>
        <Dashboard />
      </MemoryRouter>,
    )

    await screen.findByText('14,591 full + 0 recovered')
    expect(loadJsonMock).toHaveBeenCalledWith('events_head.json')
    expect(loadJsonMock).not.toHaveBeenCalledWith('recent_events.json')
  })

  it('keeps the dashboard usable when the events head fails and recovers on retry', async () => {
    let headAttempts = 0
    loadJsonMock.mockImplementation((path: string) => {
      if (path === 'summary.json') return Promise.resolve(summary)
      if (path === 'activity_by_day.json') return Promise.resolve(byDay)
      if (path === 'activity_by_hour.json') return Promise.resolve(byHour)
      if (path === 'events_head.json') {
        headAttempts += 1
        if (headAttempts === 1) return Promise.reject(new Error('head unavailable'))
        return Promise.resolve([{ t: '2026-07-14T13:56:54Z', type: 'delete', wiki: 'dse', page: 'AgentZzzHighMapJun21', action: 'delete', ip16: '2.202' }])
      }
      return Promise.resolve({})
    })

    render(
      <MemoryRouter>
        <Dashboard />
      </MemoryRouter>,
    )

    expect(await screen.findByText(/Error loading latest events: head unavailable/)).toBeInTheDocument()
    expect(screen.getByText('14,591 full + 0 recovered')).toBeInTheDocument()

    fireEvent.click(screen.getByRole('button', { name: 'retry' }))

    expect(await screen.findByText('AgentZzzHighMapJun21')).toBeInTheDocument()
    expect(headAttempts).toBe(2)
  })
})
