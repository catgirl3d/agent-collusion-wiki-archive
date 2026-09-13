import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { MemoryRouter, Route, Routes } from 'react-router-dom'
import { afterEach, describe, expect, it, vi } from 'vitest'
import Timeline from './Timeline'

const loadJsonMock = vi.hoisted(() => vi.fn())
vi.mock('../api', () => ({ loadJson: loadJsonMock }))

const timeline = {
  meta: { schema_version: 1, export_generated_at: '2026-06-21T00:00:00Z', count: 2, order: 'time_desc' },
  r: [
    { t: '2026-06-20T10:00:00Z', w: 'dse', id: 'dse/PageB', s: 'dse_PageB~', seq: 1, x: 'AgentX', a: 'form_edit', ip: '20.1', l: 20 },
    { t: '2026-06-19T10:00:00Z', w: 'dse', id: 'dse/PageA', s: 'dse_PageA~', seq: 2, x: 'AgentY', a: 'form_edit', ip: null, l: 18 },
  ],
}

const activity = [
  { date: '2026-06-19', wiki: 'dse', saves: 1, deletes: 0, reverts: 0, probes: 0, bytes: 10 },
  { date: '2026-06-20', wiki: 'dse', saves: 1, deletes: 0, reverts: 0, probes: 0, bytes: 10 },
]

function stubArchiveData() {
  loadJsonMock.mockImplementation((path: string) => {
    if (path === 'timeline.json') return Promise.resolve(timeline)
    if (path === 'activity_by_day.json') return Promise.resolve(activity)
    return Promise.reject(new Error(`Unexpected data request: ${path}`))
  })
}

function renderTimeline(entry = '/timeline') {
  render(
    <MemoryRouter initialEntries={[entry]}>
      <Routes>
        <Route path="/timeline" element={<Timeline />} />
      </Routes>
    </MemoryRouter>,
  )
}

async function openCalendar(label: string) {
  await waitFor(() => expect(screen.getByRole('button', { name: label })).toBeEnabled())
  fireEvent.click(screen.getByRole('button', { name: label }))
  expect(await screen.findByRole('dialog', { name: label })).toBeInTheDocument()
}

describe('Timeline', () => {
  afterEach(() => {
    loadJsonMock.mockReset()
  })

  it('applies the label filter from the URL and renders rows', async () => {
    stubArchiveData()
    renderTimeline('/timeline?label=AgentX')

    expect(screen.getByText('Loading…')).toBeInTheDocument()
    await screen.findByRole('link', { name: 'PageB' })
    expect(screen.queryByRole('link', { name: 'PageA' })).toBeNull()
    expect(screen.getByText(/1 of 2 revisions/)).toBeInTheDocument()

    for (const label of ['Filter by day', 'Filter from date', 'Filter to date']) {
      await waitFor(() => expect(screen.getByRole('button', { name: label })).toBeEnabled())
      fireEvent.click(screen.getByRole('button', { name: label }))
      expect(await screen.findByRole('dialog', { name: label })).toBeInTheDocument()
      expect(await screen.findByRole('checkbox', { name: 'only days with data' })).toBeChecked()
      fireEvent.click(screen.getByRole('button', { name: label }))
    }
  })

  it('marks recovered rows and filters them without calling them anonymous', async () => {
    loadJsonMock.mockImplementation((path: string) => path === 'timeline.json'
      ? Promise.resolve({ ...timeline, meta: { ...timeline.meta, count: 1 }, r: [{ ...timeline.r[0], x: null, partial: true }] })
      : Promise.resolve(activity))
    render(<MemoryRouter initialEntries={['/timeline']}><Routes><Route path="/timeline" element={<Timeline />} /></Routes></MemoryRouter>)
    await screen.findByRole('link', { name: 'PageB' })
    expect(screen.getByText('recovered')).toBeInTheDocument()
    expect(screen.queryByText('anon')).toBeNull()
    fireEvent.click(screen.getByRole('combobox', { name: 'Filter by source' }))
    fireEvent.click(screen.getByRole('option', { name: 'full only' }))
    expect(screen.queryByRole('link', { name: 'PageB' })).toBeNull()
  })

  it('clears the date range when an exact day is picked', async () => {
    stubArchiveData()
    renderTimeline()

    await screen.findByRole('link', { name: 'PageB' })

    await openCalendar('Filter from date')
    fireEvent.click(screen.getByRole('button', { name: '19' }))
    await waitFor(() => expect(screen.getByRole('button', { name: 'Filter from date' })).toHaveTextContent('2026-06-19'))

    await openCalendar('Filter by day')
    fireEvent.click(screen.getByRole('button', { name: '20' }))

    await waitFor(() => expect(screen.getByRole('button', { name: 'Filter by day' })).toHaveTextContent('2026-06-20'))
    expect(screen.getByRole('button', { name: 'Filter from date' })).not.toHaveTextContent('2026-06-19')
    expect(await screen.findByText(/1 of 2 revisions/)).toBeInTheDocument()
  })

  it('drops the range start when the picked end date is earlier', async () => {
    stubArchiveData()
    renderTimeline('/timeline?from=2026-06-20')

    await screen.findByRole('link', { name: 'PageB' })

    await openCalendar('Filter to date')
    fireEvent.click(screen.getByRole('button', { name: '19' }))

    await waitFor(() => expect(screen.getByRole('button', { name: 'Filter to date' })).toHaveTextContent('2026-06-19'))
    expect(screen.getByRole('button', { name: 'Filter from date' })).not.toHaveTextContent('2026-06-20')
    expect(await screen.findByText(/1 of 2 revisions/)).toBeInTheDocument()
  })

  it('normalizes a legacy URL where an exact day competes with a range', async () => {
    stubArchiveData()
    renderTimeline('/timeline?day=2026-06-19&from=2026-06-20')

    expect(await screen.findByText(/1 of 2 revisions/)).toBeInTheDocument()
    await waitFor(() => expect(screen.getByRole('button', { name: 'Filter by day' })).toHaveTextContent('2026-06-19'))
    expect(screen.getByRole('button', { name: 'Filter from date' })).not.toHaveTextContent('2026-06-20')
  })

  it('normalizes an inverted legacy range by keeping its start', async () => {
    stubArchiveData()
    renderTimeline('/timeline?from=2026-06-20&to=2026-06-19')

    expect(await screen.findByText(/1 of 2 revisions/)).toBeInTheDocument()
    await waitFor(() => expect(screen.getByRole('button', { name: 'Filter from date' })).toHaveTextContent('2026-06-20'))
    expect(screen.getByRole('button', { name: 'Filter to date' })).not.toHaveTextContent('2026-06-19')
  })
})
