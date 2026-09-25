import { act, fireEvent, render, screen } from '@testing-library/react'
import { MemoryRouter, Route, Routes } from 'react-router-dom'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { AgentLinks, LabelsIndex, PagesIndex, Revision } from '../types'
import Network from './Network'

const loadJsonMock = vi.hoisted(() => vi.fn())
const cytoscapeMock = vi.hoisted(() => vi.fn())

vi.mock('../api', async () => {
  const actual = await vi.importActual<typeof import('../api')>('../api')
  return { ...actual, loadJson: loadJsonMock }
})

vi.mock('cytoscape', () => ({ default: cytoscapeMock }))

const agentLinks: AgentLinks = {
  'agent-a': [{ o: 'agent-b', c: 2 }],
  'agent-b': [{ o: 'agent-a', c: 2 }],
}

const labelsIndex: LabelsIndex = {
  l: [
    { x: 'agent-a', r: 2, f: '2026-01-01', t: '2026-01-02', p: 2, h: false, w: ['wiki'], pgs: ['wiki/PageA', 'wiki/PageB'] },
    { x: 'agent-b', r: 2, f: '2026-01-01', t: '2026-01-02', p: 2, h: false, w: ['wiki'], pgs: ['wiki/PageA', 'wiki/PageB'] },
  ],
  n_anon: 0,
}

const pagesIndex: PagesIndex = {
  p: [
    { id: 'wiki/PageA', s: 'page-a-history', w: 'wiki', n: 'Page A', r: 1, f: '2026-01-01', l: '2026-01-01', d: false, del: 0, fam: '', lb: 2, labs: ['agent-a', 'agent-b'] },
    { id: 'wiki/PageB', s: 'page-b-history', w: 'wiki', n: 'Page B', r: 1, f: '2026-01-01', l: '2026-01-01', d: false, del: 0, fam: '', lb: 2, labs: ['agent-a', 'agent-b'] },
  ],
  order: 'last',
}

function deferred<T>() {
  let resolvePromise!: (value: T) => void
  let isSettled = false
  const promise = new Promise<T>((resolve) => {
    resolvePromise = resolve
  }).then((value) => {
    isSettled = true
    return value
  })

  return {
    promise,
    resolve: resolvePromise,
    get settled() {
      return isSettled
    },
  }
}

function revision(label: string, summary: string): Revision {
  const body = `Revision body for ${summary}`
  return {
    seq: 1,
    time: '2026-01-01T00:00:00Z',
    label,
    ip16: null,
    summary,
    len: body.length,
    body,
    action: null,
    round: null,
  }
}

function stubCytoscape() {
  const elements = {
    empty: () => false,
    remove: vi.fn(),
    removeClass: vi.fn(),
    not: vi.fn(() => ({ addClass: vi.fn() })),
  }
  const edges = {
    removeClass: vi.fn(),
    filter: vi.fn(() => ({ addClass: vi.fn() })),
  }

  cytoscapeMock.mockReturnValue({
    on: vi.fn(),
    destroy: vi.fn(),
    elements: () => elements,
    edges: () => edges,
    add: vi.fn(),
    batch: (callback: () => void) => {
      callback()
    },
    layout: () => ({ run: vi.fn() }),
  })
}

describe('Network', () => {
  afterEach(() => {
    loadJsonMock.mockReset()
    cytoscapeMock.mockReset()
  })

  it('keeps page B timeline visible when page A revisions arrive late', async () => {
    const pageARevisions = deferred<Revision[]>()
    const pageBRevisions = deferred<Revision[]>()

    loadJsonMock.mockImplementation((path: string) => {
      if (path === 'agent_links.json') return Promise.resolve(agentLinks)
      if (path === 'labels.json') return Promise.resolve(labelsIndex)
      if (path === 'pages.json') return Promise.resolve(pagesIndex)
      if (path === 'revisions/page-a-history.json') return pageARevisions.promise
      if (path === 'revisions/page-b-history.json') return pageBRevisions.promise
      return Promise.reject(new Error(`Unexpected data request: ${path}`))
    })
    stubCytoscape()
    vi.stubGlobal('ResizeObserver', class {
      observe = vi.fn()
      disconnect = vi.fn()
    })

    render(
      <MemoryRouter initialEntries={['/network?agent=agent-a&pairA=agent-a&pairB=agent-b&pairPage=wiki%2FPageA']}>
        <Routes>
          <Route path="/network" element={<Network />} />
        </Routes>
      </MemoryRouter>,
    )

    expect(await screen.findByText('Loading revisions for Page A…')).toBeInTheDocument()
    expect(loadJsonMock).toHaveBeenCalledWith('revisions/page-a-history.json')
    expect(pageARevisions.settled).toBe(false)

    fireEvent.click(screen.getByRole('button', { name: /Page B/ }))
    expect(await screen.findByText('Loading revisions for Page B…')).toBeInTheDocument()
    expect(loadJsonMock).toHaveBeenCalledWith('revisions/page-b-history.json')
    expect(pageARevisions.settled).toBe(false)
    expect(pageBRevisions.settled).toBe(false)

    await act(async () => {
      pageBRevisions.resolve([revision('agent-b', 'B-READY-REVISION')])
      await pageBRevisions.promise
    })
    expect(pageBRevisions.settled).toBe(true)
    expect(screen.getByText('B-READY-REVISION')).toBeInTheDocument()
    expect(screen.queryByText('A-LATE-REVISION')).not.toBeInTheDocument()

    await act(async () => {
      pageARevisions.resolve([revision('agent-a', 'A-LATE-REVISION')])
      await pageARevisions.promise
    })
    expect(pageARevisions.settled).toBe(true)
    expect(screen.getByText('B-READY-REVISION')).toBeInTheDocument()
    expect(screen.queryByText('A-LATE-REVISION')).not.toBeInTheDocument()
  })
})
