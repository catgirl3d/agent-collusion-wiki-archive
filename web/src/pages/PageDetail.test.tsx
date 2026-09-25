import { fireEvent, render, screen, within } from '@testing-library/react'
import { MemoryRouter, Route, Routes } from 'react-router-dom'
import { describe, expect, it, vi } from 'vitest'
import PageDetail from './PageDetail'

const loadJsonMock = vi.hoisted(() => vi.fn())
vi.mock('../api', async () => {
  const actual = await vi.importActual<typeof import('../api')>('../api')
  return { ...actual, loadJson: loadJsonMock }
})

function mockSingleRevisionPage() {
  const responses: Record<string, unknown> = {
    'pages.json': { p: [{ id: 'usemod/SandBox', w: 'usemod', n: 'SandBox', r: 1, f: '2026-05-11', l: '2026-05-11', d: false, del: 0, fam: '', lb: 0, labs: [], partial: true }], order: 'last' },
    'payload_index.json': [], 'agent_links.json': {}, 'labels.json': { l: [], n_anon: 0 },
    'revisions/usemod_SandBox~.json': [
      { seq: 1, time: '2026-05-11T00:00:00Z', label: null, ip16: null, summary: null, len: null, body: '', action: null, round: null, partial: true, added: ['new line'], removed: ['old line'] },
    ],
  }
  loadJsonMock.mockImplementation((path: string) => path in responses ? Promise.resolve(responses[path]) : Promise.reject(new Error(`Unexpected data request: ${path}`)))
}

function mockBigPage(count: number, oldestBody = 'oldest body', payloadIndex: unknown[] = []) {
  const revisions = Array.from({ length: count }, (_, index) => ({
    seq: index + 1,
    time: new Date(Date.UTC(2026, 3, 1, 0, 0, index)).toISOString(),
    label: null,
    ip16: null,
    summary: null,
    len: (index === 0 ? oldestBody : `r${String(index + 1)}`).length,
    body: index === 0 ? oldestBody : `r${String(index + 1)}`,
    action: null,
    round: null,
  }))
  const responses: Record<string, unknown> = {
    'pages.json': { p: [{ id: 'main/Big', s: 'main_Big~', w: 'main', n: 'Big', r: count, f: '2026-04-01', l: '2026-04-02', d: false, del: 0, fam: '', lb: 0, labs: [] }], order: 'last' },
    'payload_index.json': payloadIndex,
    'agent_links.json': {},
    'labels.json': { l: [], n_anon: 0 },
    'revisions/main_Big~.json': revisions,
  }
  loadJsonMock.mockImplementation((path: string) => path in responses ? Promise.resolve(responses[path]) : Promise.reject(new Error(`Unexpected data request: ${path}`)))
}

function renderPageDetail(initialEntries: string[]) {  return render(
    <MemoryRouter initialEntries={initialEntries}>
      <Routes>
        <Route path="/page/*" element={<PageDetail />} />
        <Route path="/pages" element={<div>Pages index</div>} />
      </Routes>
    </MemoryRouter>,
  )
}

describe('PageDetail', () => {
  it('opens shared-page links when the tooltip trigger receives focus', async () => {
    const responses: Record<string, unknown> = {
      'pages.json': {
        p: [
          { id: 'main/Current', s: 'main_Current~', w: 'main', n: 'Current', r: 1, f: '2026-05-11', l: '2026-05-11', d: false, del: 0, fam: '', lb: 0, labs: [] },
          { id: 'main/Shared', w: 'main', n: 'Shared page', r: 1, f: '2026-05-11', l: '2026-05-11', d: false, del: 0, fam: '', lb: 0, labs: [] },
        ],
        order: 'last',
      },
      'payload_index.json': [],
      'agent_links.json': { 'Agent A': [{ o: 'Agent B', c: 1 }] },
      'labels.json': {
        l: [
          { x: 'Agent A', pgs: ['main/Current', 'main/Shared'] },
          { x: 'Agent B', pgs: ['main/Shared'] },
        ],
        n_anon: 0,
      },
      'revisions/main_Current~.json': [
        { seq: 1, time: '2026-05-11T00:00:00Z', label: 'Agent A', ip16: null, summary: null, len: 7, body: 'current', action: null, round: null },
      ],
    }
    loadJsonMock.mockImplementation((path: string) => path in responses ? Promise.resolve(responses[path]) : Promise.reject(new Error(`Unexpected data request: ${path}`)))
    renderPageDetail(['/page/main%2FCurrent'])

    const trigger = await screen.findByRole('button', { name: '1 shared page' })
    const tooltip = screen.getByRole('tooltip')
    expect(tooltip.closest('button')).toBeNull()

    trigger.focus()

    expect(trigger).toHaveFocus()
    expect(tooltip).toBeVisible()
    const sharedPageLink = await within(tooltip).findByRole('link', { name: 'Shared page' })
    expect(sharedPageLink).toBeVisible()

    sharedPageLink.focus()

    expect(sharedPageLink).toHaveFocus()
  })

  it('shows a not-found boundary after the page index has loaded', async () => {
    loadJsonMock.mockImplementation((path: string) => {
      const responses: Record<string, unknown> = {
        'pages.json': { p: [], order: 'last' }, 'payload_index.json': [], 'agent_links.json': {}, 'labels.json': { l: [], n_anon: 0 },
      }
      return path in responses ? Promise.resolve(responses[path]) : Promise.reject(new Error(`Unexpected data request: ${path}`))
    })
    render(
      <MemoryRouter initialEntries={['/page/missing-page']}>
        <Routes>
          <Route path="/page/*" element={<PageDetail />} />
        </Routes>
      </MemoryRouter>,
    )

    expect(screen.getByText('Loading…')).toBeInTheDocument()
    await screen.findByText('Browse all pages')
    expect(document.querySelector('.error')).toHaveTextContent('Page missing-page not found in the archive index.')
    expect(screen.getByRole('link', { name: 'Browse all pages' })).toHaveAttribute('href', '/pages')
  })

  it('renders recovered revision lines and omits a body diff', async () => {
    const responses: Record<string, unknown> = {
      'pages.json': { p: [{ id: 'usemod/SandBox', w: 'usemod', n: 'SandBox', r: 1, f: '2026-05-11', l: '2026-05-11', d: false, del: 0, fam: '', lb: 0, labs: [], partial: true }], order: 'last' },
      'payload_index.json': [], 'agent_links.json': {}, 'labels.json': { l: [], n_anon: 0 },
      'revisions/usemod_SandBox~.json': [
        { seq: 1, time: '2026-05-11T00:00:00Z', label: null, ip16: null, summary: null, len: null, body: '', action: null, round: null, partial: true, added: ['new line'], removed: ['old line'] },
      ],
    }
    loadJsonMock.mockImplementation((path: string) => path in responses ? Promise.resolve(responses[path]) : Promise.reject(new Error(`Unexpected data request: ${path}`)))
    render(<MemoryRouter initialEntries={['/page/usemod%2FSandBox']}><Routes><Route path="/page/*" element={<PageDetail />} /></Routes></MemoryRouter>)
    expect((await screen.findAllByText('Recovered partial revision — full body not retained')).length).toBe(2)
    expect(loadJsonMock).toHaveBeenCalledWith('revisions/usemod_SandBox~.json')
    expect(screen.getByText('+new line')).toBeInTheDocument()
    expect(screen.getByText('-old line')).toBeInTheDocument()
    expect(screen.getAllByText('recovered').length).toBeGreaterThanOrEqual(2)
    expect(screen.queryByText(/DiffView/)).toBeNull()
    expect(screen.getByRole('button', { name: 'hide diff' })).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: 'hide diff' }))
    expect(screen.getByRole('button', { name: 'view diff' })).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: 'view diff' }))
    expect(screen.getByRole('button', { name: 'hide diff' })).toBeInTheDocument()
  })

  it('shows inline payload evidence for a retained revision body', async () => {
    const responses: Record<string, unknown> = {
      'pages.json': { p: [{ id: 'main/Example', w: 'main', n: 'Example', r: 1, f: '2026-05-11', l: '2026-05-11', d: false, del: 0, fam: '', lb: 0, labs: [] }], order: 'last' },
      'payload_index.json': [{ id: 'main/Example', s: 'main_Example~', f: ['beacon', 'tunnel'], u: [] }],
      'agent_links.json': {}, 'labels.json': { l: [], n_anon: 0 },
      'revisions/main_Example~.json': [
        { seq: 1, time: '2026-05-10T00:00:00Z', label: null, ip16: null, summary: null, len: null, body: `UNIQUE_OLDER_MARKER ${'x'.repeat(300)} https://api.counterapi.dev/v1/x/seen/up`, action: null, round: null },
        { seq: 2, time: '2026-05-11T00:00:00Z', label: null, ip16: null, summary: null, len: 15, body: 'neutral newer body', action: null, round: null },
      ],
    }
    loadJsonMock.mockImplementation((path: string) => path in responses ? Promise.resolve(responses[path]) : Promise.reject(new Error(`Unexpected data request: ${path}`)))
    render(<MemoryRouter initialEntries={['/page/main%2FExample']}><Routes><Route path="/page/*" element={<PageDetail />} /></Routes></MemoryRouter>)

    await screen.findByText('What matched these flags?')
    fireEvent.click(screen.getByText('What matched these flags?'))
    expect(await screen.findByText(/counterapi\.dev/)).toBeVisible()
    screen.getAllByText('beacon').forEach((element) => expect(element).toBeVisible())
    expect(screen.getByText('no retained match in loaded revisions')).toBeVisible()
    const article = document.getElementById('rev-0')
    expect(article).not.toBeNull()
    if (!article) throw new Error('Expected older revision article')
    expect(within(article).queryByText(/UNIQUE_OLDER_MARKER/)).toBeNull()
    expect(within(article).getByRole('button', { name: 'view body' })).toBeInTheDocument()
    const openButton = screen.getByRole('button', { name: 'Open revision #1' })
    fireEvent.click(openButton)
    expect(await within(article).findByText(/UNIQUE_OLDER_MARKER/)).toBeVisible()
    expect(within(article).getByRole('button', { name: 'hide body' })).toBeInTheDocument()
  })

  it('shows the global empty state when no retained body matches', async () => {
    const responses: Record<string, unknown> = {
      'pages.json': { p: [{ id: 'main/Empty', w: 'main', n: 'Empty', r: 1, f: '2026-05-11', l: '2026-05-11', d: false, del: 0, fam: '', lb: 0, labs: [] }], order: 'last' },
      'payload_index.json': [{ id: 'main/Empty', s: 'main_Empty~', f: ['beacon'], u: [] }],
      'agent_links.json': {}, 'labels.json': { l: [], n_anon: 0 },
      'revisions/main_Empty~.json': [{ seq: 1, time: '2026-05-11T00:00:00Z', label: null, ip16: null, summary: null, len: 15, body: 'ordinary content', action: null, round: null }],
    }
    loadJsonMock.mockImplementation((path: string) => path in responses ? Promise.resolve(responses[path]) : Promise.reject(new Error(`Unexpected data request: ${path}`)))
    render(<MemoryRouter initialEntries={['/page/main%2FEmpty']}><Routes><Route path="/page/*" element={<PageDetail />} /></Routes></MemoryRouter>)
    fireEvent.click(await screen.findByText('What matched these flags?'))
    expect(await screen.findByText('No retained revision body contains this pattern (recovered or truncated data).')).toBeVisible()
  })

  it('goes back to the previous in-app route when the page was reached from another route', async () => {
    mockSingleRevisionPage()
    renderPageDetail(['/pages', '/page/usemod%2FSandBox'])

    fireEvent.click(await screen.findByRole('button', { name: '← back' }))
    expect(screen.getByText('Pages index')).toBeInTheDocument()
  })

  it('falls back to the pages index when the page was opened without in-app history', async () => {
    mockSingleRevisionPage()
    renderPageDetail(['/page/usemod%2FSandBox'])

    fireEvent.click(await screen.findByRole('button', { name: '← back' }))
    expect(screen.getByText('Pages index')).toBeInTheDocument()
  })

  it('renders payload flags and domains as badges', async () => {
    const responses: Record<string, unknown> = {
      'pages.json': { p: [{ id: 'usemod/SandBox', s: 'sb-hash', w: 'usemod', n: 'SandBox', r: 1, f: '2026-05-11', l: '2026-05-11', d: false, del: 0, fam: '', lb: 0, labs: [] }], order: 'last' },
      'payload_index.json': [{ id: 'usemod/SandBox', s: 'sb-hash', f: ['tunnel', 'redirect'], u: ['api.datausa.io', 'prowiki.org'] }],
      'agent_links.json': {},
      'labels.json': { l: [], n_anon: 0 },
      'revisions/sb-hash.json': [],
    }
    loadJsonMock.mockImplementation((path: string) => path in responses ? Promise.resolve(responses[path]) : Promise.reject(new Error(`Unexpected data request: ${path}`)))
    renderPageDetail(['/page/usemod%2FSandBox'])

    expect(await screen.findByText('payload:')).toBeInTheDocument()
    const tunnelBadge = screen.getByText('tunnel')
    expect(tunnelBadge).toHaveClass('badge')
    const redirectBadge = screen.getByText('redirect')
    expect(redirectBadge).toHaveClass('badge')

    const domainBadge1 = screen.getByText('api.datausa.io')
    expect(domainBadge1).toHaveClass('badge', 'payload-domain')
    expect(domainBadge1).toHaveAttribute('title', 'api.datausa.io')

    const domainBadge2 = screen.getByText('prowiki.org')
    expect(domainBadge2).toHaveClass('badge', 'payload-domain')
    expect(domainBadge2).toHaveAttribute('title', 'prowiki.org')
  })

  it('renders the revision history with incremental load more', async () => {
    mockBigPage(120)
    renderPageDetail(['/page/main%2FBig'])

    expect(await screen.findByText(/showing 50 of 120 revisions/)).toBeInTheDocument()
    expect(document.querySelectorAll('article.rev')).toHaveLength(50)
    expect(screen.getByText('#120')).toBeInTheDocument()
    expect(screen.getByText('#71')).toBeInTheDocument()
    expect(screen.queryByText('#70')).toBeNull()

    fireEvent.click(screen.getByRole('button', { name: /Load older revisions/ }))

    expect(screen.getByText(/showing 100 of 120 revisions/)).toBeInTheDocument()
    expect(document.querySelectorAll('article.rev')).toHaveLength(100)
    expect(screen.getByText('#70')).toBeInTheDocument()
    expect(screen.getByText('#120')).toBeInTheDocument()

    fireEvent.click(screen.getByRole('button', { name: /Load older revisions/ }))

    expect(screen.getByText(/showing 120 of 120 revisions/)).toBeInTheDocument()
    expect(document.querySelectorAll('article.rev')).toHaveLength(120)
    expect(screen.getByText('#1')).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: /Load older revisions/ })).toBeNull()
  })

  it('keeps every revision available in the compare selectors', async () => {
    mockBigPage(120)
    renderPageDetail(['/page/main%2FBig'])

    fireEvent.click(await screen.findByRole('combobox', { name: 'Compare from revision' }))

    expect(screen.getAllByRole('option')).toHaveLength(120)
  })

  it('opens the history page holding a revision picked from payload evidence', async () => {
    mockBigPage(60, 'UNIQUE_OLDEST_MARKER https://api.counterapi.dev/v1/x/seen/up', [{ id: 'main/Big', s: 'main_Big~', f: ['beacon'], u: [] }])
    renderPageDetail(['/page/main%2FBig'])

    expect(await screen.findByText(/showing 50 of 60 revisions/)).toBeInTheDocument()
    expect(document.querySelectorAll('article.rev')).toHaveLength(50)

    fireEvent.click(await screen.findByText('What matched these flags?'))
    fireEvent.click(await screen.findByRole('button', { name: 'Open revision #1' }))

    expect(await screen.findByText(/showing 60 of 60 revisions/)).toBeInTheDocument()
    const article = document.getElementById('rev-0')
    expect(article).not.toBeNull()
    if (!article) throw new Error('Expected oldest revision article')
    expect(within(article).getByText(/UNIQUE_OLDEST_MARKER/)).toBeVisible()
  })
})
