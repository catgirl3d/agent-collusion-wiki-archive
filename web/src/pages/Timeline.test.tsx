import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { MemoryRouter, Route, Routes, useLocation, useNavigate } from 'react-router-dom'
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

function LocationProbe() {
  const location = useLocation()
  return <div data-testid="location">{location.search}</div>
}

function HistoryBack() {
  const navigate = useNavigate()
  return <button type="button" aria-label="go back" onClick={() => navigate(-1)} />
}

function renderTimeline(entry = '/timeline') {
  render(
    <MemoryRouter initialEntries={[entry]}>
      <LocationProbe />
      <HistoryBack />
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

function currentSearch(): URLSearchParams {
  return new URLSearchParams(screen.getByTestId('location').textContent ?? '')
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

  it('filters by the IP16 substring from the URL and writes it back', async () => {
    stubArchiveData()
    renderTimeline('/timeline?ip=20')

    await screen.findByRole('link', { name: 'PageB' })
    expect(screen.queryByRole('link', { name: 'PageA' })).toBeNull()
    expect(screen.getByText(/1 of 2 revisions/)).toBeInTheDocument()
    expect(screen.getByLabelText('Filter by IP16')).toHaveValue('20')

    fireEvent.change(screen.getByLabelText('Filter by IP16'), { target: { value: '57' } })
    await waitFor(() => expect(currentSearch().get('ip')).toBe('57'))
    expect(await screen.findByText(/0 of 2 revisions/)).toBeInTheDocument()
    expect(screen.queryByRole('link', { name: 'PageB' })).toBeNull()

    fireEvent.change(screen.getByLabelText('Filter by IP16'), { target: { value: '' } })
    await waitFor(() => expect(currentSearch().has('ip')).toBe(false))
    expect(await screen.findByRole('link', { name: 'PageA' })).toBeInTheDocument()
  })

  it('shows an IP16 dossier for the prefix slice and drills into a label', async () => {
    const dossier = {
      meta: { schema_version: 1, export_generated_at: '2026-06-21T00:00:00Z', count: 4, order: 'time_desc' },
      r: [
        { t: '2026-06-20T10:00:00Z', w: 'dse', id: 'dse/PageB', s: 'dse_PageB~', seq: 1, x: 'AgentX', a: 'form_edit', ip: '20.1', l: 20 },
        { t: '2026-06-19T10:00:00Z', w: 'dse', id: 'dse/PageA', s: 'dse_PageA~', seq: 2, x: 'AgentX', a: 'form_edit', ip: '20.2', l: 18 },
        { t: '2026-06-18T10:00:00Z', w: 'dse', id: 'dse/PageC', s: 'dse_PageC~', seq: 1, x: 'AgentY', a: 'form_edit', ip: '20.2', l: 10 },
        { t: '2026-06-17T10:00:00Z', w: 'dse', id: 'dse/PageD', s: 'dse_PageD~', seq: 1, x: 'AgentZ', a: 'form_edit', ip: '57.1', l: 10 },
      ],
    }
    loadJsonMock.mockImplementation((path: string) => path === 'timeline.json' ? Promise.resolve(dossier) : Promise.resolve(activity))
    renderTimeline('/timeline?ip=20&label=AgentX')

    const panel = await screen.findByRole('region', { name: 'IP16 20 dossier' })
    expect(panel).toHaveTextContent('3 revisions')
    expect(panel).toHaveTextContent('2 labels')
    expect(panel).toHaveTextContent('3 pages')
    expect(panel).toHaveTextContent('2026-06-18')
    expect(panel).toHaveTextContent('2026-06-20')
    expect(screen.getByRole('link', { name: 'PageB' })).toBeInTheDocument()
    expect(screen.queryByRole('link', { name: 'PageC' })).toBeNull()
    expect(screen.getByRole('button', { name: /AgentX/ })).toHaveAttribute('aria-pressed', 'true')

    fireEvent.click(screen.getByRole('button', { name: /AgentY/ }))
    await waitFor(() => expect(currentSearch().get('label')).toBe('AgentY'))
    expect(await screen.findByRole('link', { name: 'PageC' })).toBeInTheDocument()
    expect(screen.queryByRole('link', { name: 'PageA' })).toBeNull()
    expect(screen.getByRole('button', { name: /AgentY/ })).toHaveAttribute('aria-pressed', 'true')

    fireEvent.click(screen.getByRole('button', { name: /AgentY/ }))
    await waitFor(() => expect(currentSearch().has('label')).toBe(false))
    expect(await screen.findByRole('link', { name: 'PageA' })).toBeInTheDocument()
  })

  it('hides the IP16 dossier without an ip filter', async () => {
    stubArchiveData()
    renderTimeline('/timeline?label=AgentX')

    await screen.findByRole('link', { name: 'PageB' })
    expect(screen.queryByRole('region', { name: /dossier/ })).toBeNull()
  })

  it('hides the IP16 dossier and does not filter when ip query contains only whitespace', async () => {
    stubArchiveData()
    renderTimeline('/timeline?ip=%20')

    await screen.findByRole('link', { name: 'PageB' })
    expect(await screen.findByRole('link', { name: 'PageA' })).toBeInTheDocument()
    expect(screen.queryByRole('region', { name: /dossier/ })).toBeNull()
    await waitFor(() => expect(currentSearch().has('ip')).toBe(false))
  })

  it('expands the dossier label list past the top 12', async () => {
    const manyLabels = Array.from({ length: 14 }, (_, index) => ({
      t: '2026-06-20T10:00:00Z',
      w: 'dse',
      id: `dse/Page${index}`,
      s: `dse_Page${index}~`,
      seq: index,
      x: `Agent${String(index).padStart(2, '0')}`,
      a: 'form_edit',
      ip: '20.1',
      l: 10,
    }))
    loadJsonMock.mockImplementation((path: string) => path === 'timeline.json'
      ? Promise.resolve({ meta: { ...timeline.meta, count: manyLabels.length }, r: manyLabels })
      : Promise.resolve(activity))
    renderTimeline('/timeline?ip=20')

    const panel = await screen.findByRole('region', { name: 'IP16 20 dossier' })
    expect(panel).toHaveTextContent('14 revisions')
    expect(screen.queryByRole('button', { name: /Agent13/ })).toBeNull()

    fireEvent.click(screen.getByRole('button', { name: '+2 more' }))
    expect(await screen.findByRole('button', { name: /Agent13/ })).toBeInTheDocument()

    fireEvent.click(screen.getByRole('button', { name: 'show top 12' }))
    expect(screen.queryByRole('button', { name: /Agent13/ })).toBeNull()
  })

  it('sorts by clickable headers and resets pagination', async () => {
    stubArchiveData()
    renderTimeline('/timeline?page=2')

    await screen.findByRole('link', { name: 'PageB' })
    expect(screen.getAllByRole('link', { name: /Page/ })[0]).toHaveTextContent('PageB')

    fireEvent.click(screen.getByRole('button', { name: 'Time' }))
    await waitFor(() => expect(currentSearch().get('sort')).toBe('time'))
    expect(currentSearch().get('dir')).toBe('asc')
    expect(currentSearch().has('page')).toBe(false)
    expect(screen.getByRole('columnheader', { name: /Time/ })).toHaveAttribute('aria-sort', 'ascending')
    expect(screen.getAllByRole('link', { name: /Page/ })[0]).toHaveTextContent('PageA')

    fireEvent.click(screen.getByRole('button', { name: 'Time' }))
    await waitFor(() => expect(currentSearch().has('sort')).toBe(false))
    expect(currentSearch().has('dir')).toBe(false)
    expect(screen.getAllByRole('link', { name: /Page/ })[0]).toHaveTextContent('PageB')

    fireEvent.click(screen.getByRole('button', { name: 'go back' }))
    await waitFor(() => expect(currentSearch().get('sort')).toBe('time'))
    expect(currentSearch().get('dir')).toBe('asc')
    expect(screen.getByRole('columnheader', { name: /Time/ })).toHaveAttribute('aria-sort', 'ascending')
  })

  it('uses the column default for Len and toggles it', async () => {
    stubArchiveData()
    renderTimeline()

    await screen.findByRole('link', { name: 'PageB' })
    fireEvent.click(screen.getByRole('button', { name: 'Len' }))
    await waitFor(() => expect(currentSearch().get('sort')).toBe('len'))
    expect(currentSearch().get('dir')).toBe('desc')
    expect(screen.getByRole('columnheader', { name: /Len/ })).toHaveAttribute('aria-sort', 'descending')

    fireEvent.click(screen.getByRole('button', { name: 'Len' }))
    await waitFor(() => expect(currentSearch().get('dir')).toBe('asc'))
    expect(screen.getByRole('columnheader', { name: /Len/ })).toHaveAttribute('aria-sort', 'ascending')
    expect(screen.getAllByRole('link', { name: /Page/ })[0]).toHaveTextContent('PageA')
  })

  it('migrates the legacy order parameter to the shared sort URL', async () => {
    stubArchiveData()
    renderTimeline('/timeline?order=asc')

    await screen.findByRole('link', { name: 'PageA' })
    await waitFor(() => expect(currentSearch().get('sort')).toBe('time'))
    expect(currentSearch().get('dir')).toBe('asc')
    expect(currentSearch().has('order')).toBe(false)
    expect(screen.getAllByRole('link', { name: /Page/ })[0]).toHaveTextContent('PageA')
  })

  it('preserves filters and page while migrating legacy order', async () => {
    stubArchiveData()
    renderTimeline('/timeline?order=asc&page=3&label=AgentX')

    await screen.findByRole('link', { name: 'PageB' })
    await waitFor(() => expect(currentSearch().get('sort')).toBe('time'))
    expect(currentSearch().get('dir')).toBe('asc')
    expect(currentSearch().get('label')).toBe('AgentX')
    expect(currentSearch().has('order')).toBe(false)
    expect(currentSearch().get('page')).toBe('3')
  })

  it('gives a modern sort pair priority over legacy order', async () => {
    stubArchiveData()
    renderTimeline('/timeline?sort=len&dir=desc&order=asc')

    await screen.findByRole('link', { name: 'PageB' })
    await waitFor(() => expect(currentSearch().has('order')).toBe(false))
    expect(currentSearch().get('sort')).toBe('len')
    expect(currentSearch().get('dir')).toBe('desc')
  })

  it('keeps the page when only sort URL formatting is normalized', async () => {
    stubArchiveData()
    renderTimeline('/timeline?sort=time&dir=desc&page=3')

    await screen.findByRole('link', { name: 'PageB' })
    await waitFor(() => expect(currentSearch().has('sort')).toBe(false))
    expect(currentSearch().has('dir')).toBe(false)
    expect(currentSearch().get('page')).toBe('3')
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
    fireEvent.click(screen.getByRole('button', { name: 'June 19, 2026' }))
    await waitFor(() => expect(screen.getByRole('button', { name: 'Filter from date' })).toHaveTextContent('2026-06-19'))

    await openCalendar('Filter by day')
    fireEvent.click(screen.getByRole('button', { name: 'June 20, 2026' }))

    await waitFor(() => expect(screen.getByRole('button', { name: 'Filter by day' })).toHaveTextContent('2026-06-20'))
    expect(screen.getByRole('button', { name: 'Filter from date' })).not.toHaveTextContent('2026-06-19')
    await waitFor(() => expect(currentSearch().get('day')).toBe('2026-06-20'))
    expect(currentSearch().has('from')).toBe(false)
    expect(await screen.findByText(/1 of 2 revisions/)).toBeInTheDocument()
  })

  it('clears the exact day when a new range start is picked', async () => {
    stubArchiveData()
    renderTimeline('/timeline?day=2026-06-19')

    await openCalendar('Filter from date')
    fireEvent.click(screen.getByRole('button', { name: 'June 20, 2026' }))

    await waitFor(() => expect(screen.getByRole('button', { name: 'Filter from date' })).toHaveTextContent('2026-06-20'))
    expect(screen.getByRole('button', { name: 'Filter by day' })).not.toHaveTextContent('2026-06-19')
    await waitFor(() => expect(currentSearch().get('from')).toBe('2026-06-20'))
    expect(currentSearch().has('day')).toBe(false)
    expect(await screen.findByText(/1 of 2 revisions/)).toBeInTheDocument()
  })

  it('clears the exact day when a new range end is picked', async () => {
    stubArchiveData()
    renderTimeline('/timeline?day=2026-06-19')

    await openCalendar('Filter to date')
    fireEvent.click(screen.getByRole('button', { name: 'June 20, 2026' }))

    await waitFor(() => expect(screen.getByRole('button', { name: 'Filter to date' })).toHaveTextContent('2026-06-20'))
    expect(screen.getByRole('button', { name: 'Filter by day' })).not.toHaveTextContent('2026-06-19')
    await waitFor(() => expect(currentSearch().get('to')).toBe('2026-06-20'))
    expect(currentSearch().has('day')).toBe(false)
    expect(await screen.findByRole('heading', { name: /2 of 2 revisions/ })).toBeInTheDocument()
  })

  it('drops the range start when the picked end date is earlier', async () => {
    stubArchiveData()
    renderTimeline('/timeline?from=2026-06-20')

    await screen.findByRole('link', { name: 'PageB' })

    await openCalendar('Filter to date')
    fireEvent.click(screen.getByRole('button', { name: 'June 19, 2026' }))

    await waitFor(() => expect(screen.getByRole('button', { name: 'Filter to date' })).toHaveTextContent('2026-06-19'))
    expect(screen.getByRole('button', { name: 'Filter from date' })).not.toHaveTextContent('2026-06-20')
    expect(await screen.findByText(/1 of 2 revisions/)).toBeInTheDocument()
  })

  it('normalizes a legacy URL where an exact day competes with a range', async () => {
    stubArchiveData()
    renderTimeline('/timeline?day=2026-06-19&from=2026-06-20&page=3')

    expect(await screen.findByText(/1 of 2 revisions/)).toBeInTheDocument()
    await waitFor(() => expect(currentSearch().get('day')).toBe('2026-06-19'))
    expect(currentSearch().has('from')).toBe(false)
    expect(currentSearch().has('page')).toBe(false)
    await waitFor(() => expect(screen.getByRole('button', { name: 'Filter by day' })).toHaveTextContent('2026-06-19'))
    expect(screen.getByRole('button', { name: 'Filter from date' })).not.toHaveTextContent('2026-06-20')
  })

  it('normalizes an inverted legacy range by keeping its start', async () => {
    stubArchiveData()
    renderTimeline('/timeline?from=2026-06-20&to=2026-06-19&page=2')

    expect(await screen.findByText(/1 of 2 revisions/)).toBeInTheDocument()
    await waitFor(() => expect(currentSearch().get('from')).toBe('2026-06-20'))
    expect(currentSearch().has('to')).toBe(false)
    expect(currentSearch().has('page')).toBe(false)
    await waitFor(() => expect(screen.getByRole('button', { name: 'Filter from date' })).toHaveTextContent('2026-06-20'))
    expect(screen.getByRole('button', { name: 'Filter to date' })).not.toHaveTextContent('2026-06-19')
  })

  it('clears only the exact day when the day picker is cleared', async () => {
    stubArchiveData()
    renderTimeline('/timeline?day=2026-06-19&label=AgentX')

    expect(await screen.findByText(/0 of 2 revisions/)).toBeInTheDocument()

    await openCalendar('Filter by day')
    fireEvent.click(screen.getByRole('button', { name: 'clear' }))

    await waitFor(() => expect(screen.getByRole('button', { name: 'Filter by day' })).toHaveTextContent('day'))
    expect(currentSearch().has('day')).toBe(false)
    expect(currentSearch().get('label')).toBe('AgentX')
    expect(await screen.findByRole('link', { name: 'PageB' })).toBeInTheDocument()
    expect(screen.getByText(/1 of 2 revisions/)).toBeInTheDocument()
  })

  it('clears only the range start when the from picker is cleared', async () => {
    stubArchiveData()
    renderTimeline('/timeline?from=2026-06-20&to=2026-06-20')

    expect(await screen.findByText(/1 of 2 revisions/)).toBeInTheDocument()

    await openCalendar('Filter from date')
    fireEvent.click(screen.getByRole('button', { name: 'clear' }))

    await waitFor(() => expect(screen.getByRole('button', { name: 'Filter from date' })).toHaveTextContent('from'))
    expect(currentSearch().has('from')).toBe(false)
    expect(currentSearch().get('to')).toBe('2026-06-20')
    expect(await screen.findByRole('link', { name: 'PageA' })).toBeInTheDocument()
    expect(screen.getByRole('heading', { name: /2 of 2 revisions/ })).toBeInTheDocument()
  })

  it('clears only the range end when the to picker is cleared', async () => {
    stubArchiveData()
    renderTimeline('/timeline?from=2026-06-19&to=2026-06-19')

    expect(await screen.findByText(/1 of 2 revisions/)).toBeInTheDocument()

    await openCalendar('Filter to date')
    fireEvent.click(screen.getByRole('button', { name: 'clear' }))

    await waitFor(() => expect(screen.getByRole('button', { name: 'Filter to date' })).toHaveTextContent('to'))
    expect(currentSearch().has('to')).toBe(false)
    expect(currentSearch().get('from')).toBe('2026-06-19')
    expect(await screen.findByRole('link', { name: 'PageB' })).toBeInTheDocument()
    expect(screen.getByRole('heading', { name: /2 of 2 revisions/ })).toBeInTheDocument()
  })

  it('normalizes invalid source and fractional page', async () => {
    stubArchiveData()
    renderTimeline('/timeline?src=invalid&page=2.5&sort=time&dir=desc')
    await screen.findByRole('link', { name: 'PageB' })
    await waitFor(() => expect(currentSearch().has('src')).toBe(false))
    expect(currentSearch().get('page')).toBe('2')
  })

  it('preserves a valid page during cosmetic sort normalization', async () => {
    stubArchiveData()
    renderTimeline('/timeline?sort=time&dir=desc&page=3')
    await screen.findByRole('link', { name: 'PageB' })
    await waitFor(() => expect(currentSearch().has('sort')).toBe(false))
    expect(currentSearch().get('page')).toBe('3')
  })

  it('exposes durable labels for text filters', async () => {
    stubArchiveData()
    renderTimeline()
    await screen.findByRole('link', { name: 'PageB' })
    expect(screen.getByLabelText('Filter by agent label')).toBeInTheDocument()
  })
})
