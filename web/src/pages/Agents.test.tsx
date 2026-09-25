import { fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { MemoryRouter, Route, Routes, useLocation } from 'react-router-dom'
import { afterEach, describe, expect, it, vi } from 'vitest'
import Agents from './Agents'

const loadJsonMock = vi.hoisted(() => vi.fn())
vi.mock('../api', () => ({ loadJson: loadJsonMock }))

const labels = {
  n_anon: 1,
  l: [
    { x: 'AgentRelent', r: 14, f: '2026-05-24', t: '2026-07-02', p: 9, h: false, w: ['dse'], pgs: ['dse/PageA'] },
    { x: 'LinkHelper', r: 4, f: '2026-05-01', t: '2026-05-02', p: 2, h: false, w: ['dse'], pgs: [] },
    { x: 'MapHelper', r: 3, f: '2026-06-01', t: '2026-06-02', p: 1, h: true, w: ['probier'], pgs: [] },
  ],
}

const ip16 = {
  meta: { schema_version: 1, prefixes: 2 },
  prefixes: {
    '20.165': {
      r: 18,
      l: [['AgentRelent', 14], ['LinkHelper', 4]],
      w: ['dse'],
      f: '2026-05-01T00:00:00Z',
      t: '2026-07-02T17:24:40Z',
    },
    '57.1': {
      r: 3,
      l: [['MapHelper', 3]],
      w: ['probier'],
      f: '2026-06-01T00:00:00Z',
      t: '2026-06-02T00:00:00Z',
    },
  },
}

function stubAgentsData() {
  loadJsonMock.mockImplementation((path: string) => {
    if (path === 'labels.json') return Promise.resolve(labels)
    if (path === 'labels_ip16.json') return Promise.resolve(ip16)
    return Promise.reject(new Error(`Unexpected data request: ${path}`))
  })
}

function stubFailingIp16() {
  loadJsonMock.mockImplementation((path: string) => {
    if (path === 'labels.json') return Promise.resolve(labels)
    if (path === 'labels_ip16.json') return Promise.reject(new Error('HTTP 404 for labels_ip16.json'))
    return Promise.reject(new Error(`Unexpected data request: ${path}`))
  })
}

function LocationProbe() {
  const location = useLocation()
  return <div data-testid="location">{location.search}</div>
}

function renderAgents(entry = '/agents') {
  render(
    <MemoryRouter initialEntries={[entry]}>
      <LocationProbe />
      <Routes>
        <Route path="/agents" element={<Agents />} />
      </Routes>
    </MemoryRouter>,
  )
}

function currentSearch(): URLSearchParams {
  return new URLSearchParams(screen.getByTestId('location').textContent ?? '')
}

async function findTable() {
  return within(await screen.findByRole('table'))
}

describe('Agents', () => {
  afterEach(() => {
    loadJsonMock.mockReset()
  })

  it('applies the ip16 filter from the URL and shows the prefix summary', async () => {
    stubAgentsData()
    renderAgents('/agents?ip=20.165')

    expect(screen.getByText('Loading…')).toBeInTheDocument()
    const rows = await findTable()
    await rows.findByText('AgentRelent')
    expect(rows.queryByText('MapHelper')).toBeNull()
    expect(rows.getByText('LinkHelper')).toBeInTheDocument()
    expect(screen.getByLabelText('Filter by IP16')).toHaveValue('20.165')

    const panel = await screen.findByRole('region', { name: 'IP16 20.165 summary' })
    expect(panel).toHaveTextContent('2 labels')
    expect(panel).toHaveTextContent('18 labeled revisions')
    expect(panel).toHaveTextContent('1 prefixes')
    expect(panel).toHaveTextContent('2026-05-01')
    expect(panel).toHaveTextContent('2026-07-02')
    expect(panel).toHaveTextContent('ip16 is a truncated /16 network indicator')
  })

  it('writes the ip16 filter back to the URL and clears it', async () => {
    stubAgentsData()
    renderAgents('/agents')

    const rows = await findTable()
    await rows.findByText('AgentRelent')
    fireEvent.change(screen.getByLabelText('Filter by IP16'), { target: { value: '57' } })
    await waitFor(() => expect(currentSearch().get('ip')).toBe('57'))
    expect(rows.queryByText('AgentRelent')).toBeNull()
    expect(rows.getByText('MapHelper')).toBeInTheDocument()

    fireEvent.change(screen.getByLabelText('Filter by IP16'), { target: { value: '' } })
    await waitFor(() => expect(currentSearch().has('ip')).toBe(false))
    expect(await rows.findByText('AgentRelent')).toBeInTheDocument()
    expect(screen.queryByRole('region', { name: /summary/ })).toBeNull()
  })

  it('clears a whitespace-only ip16 param and keeps every label', async () => {
    stubAgentsData()
    renderAgents('/agents?ip=%20')

    const rows = await findTable()
    await rows.findByText('AgentRelent')
    await waitFor(() => expect(currentSearch().has('ip')).toBe(false))
    expect(screen.getByLabelText('Filter by IP16')).toHaveValue('')
    expect(rows.getByText('MapHelper')).toBeInTheDocument()
    expect(screen.queryByRole('region', { name: /summary/ })).toBeNull()
  })

  it('combines the ip16 slice with the name search', async () => {
    stubAgentsData()
    renderAgents('/agents?ip=20.165')

    const rows = await findTable()
    await rows.findByText('AgentRelent')
    fireEvent.change(screen.getByLabelText('Search agents'), { target: { value: 'link' } })
    await waitFor(() => expect(rows.queryByText('AgentRelent')).toBeNull())
    expect(rows.getByText('LinkHelper')).toBeInTheDocument()

    // The summary keeps describing the whole prefix slice, not the searched subset.
    expect(screen.getByRole('region', { name: 'IP16 20.165 summary' })).toHaveTextContent('2 labels')
  })

  it('reuses the timeline label badges to narrow the table, and toggles them off', async () => {
    stubAgentsData()
    renderAgents('/agents?ip=20.165')

    const rows = await findTable()
    await rows.findByText('AgentRelent')
    const panel = screen.getByRole('region', { name: 'IP16 20.165 summary' })
    const badge = () => within(panel).getByRole('button', { name: /LinkHelper/ })
    expect(badge()).toHaveAttribute('aria-pressed', 'false')

    fireEvent.click(badge())
    await waitFor(() => expect(rows.queryByText('AgentRelent')).toBeNull())
    expect(rows.getByText('LinkHelper')).toBeInTheDocument()
    expect(screen.getByLabelText('Search agents')).toHaveValue('LinkHelper')
    expect(badge()).toHaveAttribute('aria-pressed', 'true')
    expect(badge()).toHaveAttribute('title', 'Clear the label filter')

    fireEvent.click(badge())
    await waitFor(() => expect(screen.getByLabelText('Search agents')).toHaveValue(''))
    expect(await rows.findByText('AgentRelent')).toBeInTheDocument()
    expect(badge()).toHaveAttribute('aria-pressed', 'false')
  })

  it('hides the summary and the rows when no prefix matches', async () => {
    stubAgentsData()
    renderAgents('/agents?ip=999')

    const rows = await findTable()
    await waitFor(() => expect(rows.queryAllByRole('row')).toHaveLength(1))
    expect(screen.queryByRole('region', { name: /summary/ })).toBeNull()
  })

  it('applies the search query from the URL', async () => {
    stubAgentsData()
    renderAgents('/agents?q=map')

    const rows = await findTable()
    await rows.findByText('MapHelper')
    expect(rows.queryByText('AgentRelent')).toBeNull()
  })

  it('keeps the label table usable when the ip16 index fails to load', async () => {
    stubFailingIp16()
    renderAgents('/agents')

    const rows = await findTable()
    await rows.findByText('AgentRelent')
    expect(rows.getByText('MapHelper')).toBeInTheDocument()
    expect(screen.getByText('ip16 index failed to load; the ip16 filter is disabled')).toBeInTheDocument()
    expect(screen.getByLabelText('Filter by IP16')).toBeDisabled()
    expect(screen.queryByRole('region', { name: /summary/ })).toBeNull()
  })

  it('does not silently filter by ip16 when the index failed to load', async () => {
    stubFailingIp16()
    renderAgents('/agents?ip=20.165')

    const rows = await findTable()
    await rows.findByText('AgentRelent')
    expect(rows.getByText('MapHelper')).toBeInTheDocument()
    expect(screen.getByText('ip16 index failed to load; the ip16 filter is disabled')).toBeInTheDocument()
  })

  it('lets the user clear a deep-linked ip16 filter when the index failed to load', async () => {
    stubFailingIp16()
    renderAgents('/agents?ip=20.165')

    const rows = await findTable()
    await rows.findByText('AgentRelent')
    fireEvent.click(screen.getByRole('button', { name: 'clear ip16 filter' }))

    await waitFor(() => expect(currentSearch().has('ip')).toBe(false))
    expect(rows.getByText('MapHelper')).toBeInTheDocument()
    expect(screen.getByText('ip16 index failed to load; the ip16 filter is disabled')).toBeInTheDocument()
  })

  it('disables the ip16 filter while the index is still loading', async () => {
    loadJsonMock.mockImplementation((path: string) => {
      if (path === 'labels.json') return Promise.resolve(labels)
      if (path === 'labels_ip16.json') return new Promise(() => {})
      return Promise.reject(new Error(`Unexpected data request: ${path}`))
    })
    renderAgents('/agents?ip=20.165')

    const rows = await findTable()
    await rows.findByText('AgentRelent')
    expect(rows.getByText('MapHelper')).toBeInTheDocument()
    expect(screen.getByLabelText('Filter by IP16')).toBeDisabled()
    expect(screen.getByText('loading ip16 index…')).toBeInTheDocument()
  })
})
