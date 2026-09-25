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
    { x: 'ZetaBot', r: 40, f: '2026-08-01', t: '2026-08-01', p: 12, h: false, w: ['dse'], pgs: [] },
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

  it('shows the distinct IP16 prefix count for each label', async () => {
    stubAgentsData()
    renderAgents()

    const rows = await findTable()
    await rows.findByText('AgentRelent')

    expect(rows.getByRole('button', { name: 'AgentRelent: 1 IP16 prefixes' })).toHaveTextContent('1')
    expect(rows.getByRole('button', { name: 'LinkHelper: 1 IP16 prefixes' })).toHaveTextContent('1')
    expect(rows.getByRole('button', { name: 'MapHelper: 1 IP16 prefixes' })).toHaveTextContent('1')
    expect(rows.getByRole('button', { name: 'ZetaBot: 0 IP16 prefixes' })).toHaveTextContent('0')

    fireEvent.click(rows.getByRole('button', { name: 'ZetaBot: 0 IP16 prefixes' }))
    expect(await rows.findByText('No IP16 prefixes')).toHaveClass('muted')
  })

  it('expands prefixes for labels without pages and filters by a selected prefix', async () => {
    stubAgentsData()
    renderAgents()

    const rows = await findTable()
    await rows.findByText('MapHelper')
    fireEvent.click(rows.getByRole('button', { name: 'MapHelper: 1 IP16 prefixes' }))

    expect(await rows.findByText('IP16 prefixes')).toBeInTheDocument()
    const prefixButton = rows.getByRole('button', { name: 'Filter agents by IP16 prefix 57.1 (3 revisions)' })
    expect(prefixButton).toBeInTheDocument()

    fireEvent.click(prefixButton)

    await waitFor(() => expect(currentSearch().get('ip')).toBe('57.1'))
    expect(rows.getByText('MapHelper')).toBeInTheDocument()
    expect(rows.queryByText('AgentRelent')).toBeNull()
    expect(rows.queryByText('LinkHelper')).toBeNull()
    expect(rows.queryByText('ZetaBot')).toBeNull()
  })

  it('shows a muted IP16 placeholder when the index fails and keeps the table usable', async () => {
    stubFailingIp16()
    renderAgents()

    const rows = await findTable()
    await rows.findByText('AgentRelent')
    expect(rows.getByText('MapHelper')).toBeInTheDocument()

    const agentRow = rows.getByRole('row', { name: /AgentRelent/ })
    expect(within(agentRow).getByText('—')).toHaveClass('muted')
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

  it('sorts by revisions descending on the first click and writes the URL', async () => {
    stubAgentsData()
    renderAgents()

    const rows = await findTable()
    fireEvent.click(screen.getByRole('button', { name: 'Revs' }))

    await waitFor(() => {
      expect(currentSearch().get('sort')).toBe('revs')
      expect(currentSearch().get('dir')).toBe('desc')
    })
    const tableRows = rows.getAllByRole('row')
    expect(tableRows[1]).toHaveTextContent('ZetaBot')
    expect(tableRows[2]).toHaveTextContent('AgentRelent')
    expect(tableRows[3]).toHaveTextContent('LinkHelper')
    expect(tableRows[4]).toHaveTextContent('MapHelper')
  })

  it('sorts by IP16 prefix count and toggles the direction', async () => {
    stubAgentsData()
    renderAgents()

    const rows = await findTable()
    const ip16Header = screen.getByRole('button', { name: 'IP16' })
    fireEvent.click(ip16Header)

    await waitFor(() => {
      expect(currentSearch().get('sort')).toBe('ip16')
      expect(currentSearch().get('dir')).toBe('desc')
    })
    let tableRows = rows.getAllByRole('row')
    expect(tableRows[4]).toHaveTextContent('ZetaBot')

    fireEvent.click(ip16Header)

    await waitFor(() => expect(currentSearch().get('dir')).toBe('asc'))
    tableRows = rows.getAllByRole('row')
    expect(tableRows[1]).toHaveTextContent('ZetaBot')
  })

  it('toggles the active sort column to ascending on the second click', async () => {
    stubAgentsData()
    renderAgents()

    const rows = await findTable()
    const revsHeader = screen.getByRole('button', { name: 'Revs' })
    fireEvent.click(revsHeader)
    await waitFor(() => expect(currentSearch().get('dir')).toBe('desc'))
    fireEvent.click(revsHeader)

    await waitFor(() => expect(currentSearch().get('dir')).toBe('asc'))
    const tableRows = rows.getAllByRole('row')
    expect(tableRows[1]).toHaveTextContent('MapHelper')
    expect(tableRows[2]).toHaveTextContent('LinkHelper')
    expect(tableRows[3]).toHaveTextContent('AgentRelent')
    expect(tableRows[4]).toHaveTextContent('ZetaBot')
  })

  it('uses each column default direction and clears sort params for canonical order', async () => {
    stubAgentsData()
    renderAgents()

    const rows = await findTable()
    fireEvent.click(screen.getByRole('button', { name: 'First' }))
    await waitFor(() => {
      expect(currentSearch().get('sort')).toBe('first')
      expect(currentSearch().get('dir')).toBe('asc')
    })

    fireEvent.click(screen.getByRole('button', { name: 'Last' }))
    await waitFor(() => {
      expect(currentSearch().get('sort')).toBe('last')
      expect(currentSearch().get('dir')).toBe('desc')
    })

    fireEvent.click(screen.getByRole('button', { name: 'Label' }))
    await waitFor(() => {
      expect(currentSearch().has('sort')).toBe(false)
      expect(currentSearch().has('dir')).toBe(false)
    })
    const tableRows = rows.getAllByRole('row')
    expect(tableRows[1]).toHaveTextContent('AgentRelent')
    expect(tableRows[2]).toHaveTextContent('LinkHelper')
    expect(tableRows[3]).toHaveTextContent('MapHelper')
    expect(tableRows[4]).toHaveTextContent('ZetaBot')
  })

  it('sorts the filtered subset after applying the ip16 filter', async () => {
    stubAgentsData()
    renderAgents('/agents?ip=20.165')

    const rows = await findTable()
    fireEvent.click(screen.getByRole('button', { name: 'First' }))

    await waitFor(() => expect(currentSearch().get('sort')).toBe('first'))
    const tableRows = rows.getAllByRole('row')
    expect(tableRows[1]).toHaveTextContent('LinkHelper')
    expect(tableRows[1]).toHaveTextContent('2026-05-01')
    expect(tableRows[2]).toHaveTextContent('AgentRelent')
    expect(tableRows[2]).toHaveTextContent('2026-05-24')
    expect(rows.queryByText('ZetaBot')).toBeNull()
  })

  it('exposes aria-sort only on the active column', async () => {
    stubAgentsData()
    renderAgents()
    await findTable()

    fireEvent.click(screen.getByRole('button', { name: 'Revs' }))

    expect(screen.getByRole('columnheader', { name: 'Revs' })).toHaveAttribute('aria-sort', 'descending')
    expect(screen.getByRole('columnheader', { name: 'Label' })).not.toHaveAttribute('aria-sort')
  })

  it('resets the load limit when sorting changes', async () => {
    const manyLabels = Array.from({ length: 60 }, (_, i) => ({
      x: 'Bot' + String(i).padStart(2, '0'),
      r: i,
      f: '2026-06-01',
      t: '2026-06-02',
      p: 1,
      h: false,
      w: ['dse'],
      pgs: [],
    }))
    loadJsonMock.mockImplementation((path: string) => {
      if (path === 'labels.json') return Promise.resolve({ n_anon: 0, l: manyLabels })
      if (path === 'labels_ip16.json') return Promise.resolve({ meta: { schema_version: 1, prefixes: 0 }, prefixes: {} })
      return Promise.reject(new Error(`Unexpected data request: ${path}`))
    })
    renderAgents()

    const rows = await findTable()
    await waitFor(() => expect(rows.getAllByRole('row')).toHaveLength(51))
    fireEvent.click(screen.getByRole('button', { name: /^Load more\b/ }))
    await waitFor(() => expect(rows.getAllByRole('row')).toHaveLength(61))

    fireEvent.click(screen.getByRole('button', { name: 'Revs' }))

    await waitFor(() => expect(rows.getAllByRole('row')).toHaveLength(51))
    expect(rows.getAllByRole('row')[1]).toHaveTextContent('Bot59')
    expect(currentSearch().get('sort')).toBe('revs')
    expect(currentSearch().get('dir')).toBe('desc')
  })

  it('drops invalid sort params from the URL and keeps canonical row order', async () => {
    stubAgentsData()
    renderAgents('/agents?sort=bogus&dir=desc')

    const rows = await findTable()
    await waitFor(() => {
      expect(currentSearch().has('sort')).toBe(false)
      expect(currentSearch().has('dir')).toBe(false)
    })
    const tableRows = rows.getAllByRole('row')
    expect(tableRows[1]).toHaveTextContent('AgentRelent')
    expect(tableRows[2]).toHaveTextContent('LinkHelper')
    expect(tableRows[3]).toHaveTextContent('MapHelper')
    expect(tableRows[4]).toHaveTextContent('ZetaBot')
  })
})
