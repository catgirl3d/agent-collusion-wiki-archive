import { fireEvent, render, screen } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { describe, expect, it, vi } from 'vitest'
import Events from './Events'
import type { RecentEvent } from '../types'

const useDataMock = vi.hoisted(() => vi.fn())
vi.mock('../components/useQuery', () => ({ useData: useDataMock }))

function makeEvents(count: number): RecentEvent[] {
  return Array.from({ length: count }, (_, i) => ({
    t: new Date(Date.UTC(2026, 5, 1, 0, 0, i)).toISOString(),
    type: 'save',
    wiki: 'dse',
    page: `Page${i}`,
    action: 'edit',
    ip16: '2.0',
  }))
}

function renderEvents(data: RecentEvent[]) {
  useDataMock.mockReturnValue({ data, error: null })
  return render(
    <MemoryRouter>
      <Events />
    </MemoryRouter>,
  )
}

describe('Events', () => {
  it('gives the event search input a durable accessible name', () => {
    renderEvents([])

    expect(screen.getByRole('textbox', { name: 'Search page / ip16 / action' })).toBeInTheDocument()
  })

  it('reports the shown range against the full event count', () => {
    renderEvents(makeEvents(3))

    expect(screen.getByText('(3 events)')).toBeInTheDocument()
    expect(screen.getByText('showing 1–3 of 3 · page 1/1')).toBeInTheDocument()
  })

  it('keeps the header filtered when a query matches every event', async () => {
    renderEvents(makeEvents(3))

    fireEvent.change(screen.getByRole('textbox', { name: 'Search page / ip16 / action' }), { target: { value: 'page' } })

    expect(await screen.findByText('(3 of 3 events match)')).toBeInTheDocument()
    expect(screen.queryByText('(3 events)')).toBeNull()
  })

  it('pages through the full set without claiming everything is rendered', () => {
    renderEvents(makeEvents(120))

    expect(screen.getByText('showing 1–50 of 120 · page 1/3')).toBeInTheDocument()

    fireEvent.click(screen.getByRole('button', { name: 'next →' }))

    expect(screen.getByText('showing 51–100 of 120 · page 2/3')).toBeInTheDocument()
    expect(screen.queryByText('showing 1–120 of 120 · page 1/1')).not.toBeInTheDocument()
  })

  it('splits matched events from the total and renders an empty state', async () => {
    const events = makeEvents(3)
    events[1] = { ...events[1], page: 'AgentZzz' }
    renderEvents(events)

    const search = screen.getByRole('textbox', { name: 'Search page / ip16 / action' })
    fireEvent.change(search, { target: { value: 'AgentZzz' } })

    expect(await screen.findByText('(1 of 3 events match)')).toBeInTheDocument()
    expect(screen.getByText('showing 1–1 of 1 · page 1/1')).toBeInTheDocument()

    fireEvent.change(search, { target: { value: 'nothing-matches-this' } })

    expect(await screen.findByText('(0 of 3 events match)')).toBeInTheDocument()
    expect(screen.getByText('no matches')).toBeInTheDocument()
    expect(screen.getByText('No matching events')).toBeInTheDocument()
  })
})
