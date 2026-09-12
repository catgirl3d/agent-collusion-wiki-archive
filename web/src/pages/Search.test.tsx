import { act, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { MemoryRouter, Route, Routes, RouterProvider, createMemoryRouter } from 'react-router-dom'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { CorpusWorkerRequest, CorpusWorkerResponse } from '../utils/corpus'
import { resetCorpusWorkerForTests } from '../utils/corpusWorkerClient'
import Search from './Search'

class FakeWorker {
  static instances: FakeWorker[] = []
  onmessage: ((event: MessageEvent<CorpusWorkerResponse>) => void) | null = null
  onerror: (() => void) | null = null
  messages: CorpusWorkerRequest[] = []
  terminated = false

  constructor() {
    FakeWorker.instances.push(this)
  }

  postMessage(message: CorpusWorkerRequest) {
    this.messages.push(message)
  }

  terminate() {
    this.terminated = true
  }

  respond(payload: CorpusWorkerResponse) {
    this.onmessage?.({ data: payload } as MessageEvent<CorpusWorkerResponse>)
  }

  fail() {
    this.onerror?.()
  }
}

const summary = {
  export_generated_at: '2026-06-21T00:00:00Z',
  counts: { revisions: 1, pages: 1, labels: 1, events: {} },
  days: 1,
  max_day: { date: '2026-06-20', saves: 1 },
  per_wiki: { dse: { revisions: { value: 1 }, pages: { value: 1 } } },
  corpus: {
    path: 'corpus/revisions.jsonl.gz',
    sha256: 'a'.repeat(64),
    compressed_bytes: 10,
    decoded_sha256: 'b'.repeat(64),
    decoded_bytes: 20,
    revisions: 1,
  },
}

afterEach(() => {
  resetCorpusWorkerForTests()
  FakeWorker.instances = []
})

describe('Search', () => {
  it('renders matches as inert text after a submitted search', async () => {
    const fetchMock = vi.fn((input: RequestInfo | URL) => {
      const path = new URL(String(input), 'http://localhost').pathname
      if (path === '/data/summary.json') return Promise.resolve({ ok: true, json: async () => summary } as Response)
      return Promise.reject(new Error(`Unexpected data request: ${path}`))
    })
    vi.stubGlobal('fetch', fetchMock)
    vi.stubGlobal('Worker', FakeWorker as unknown as typeof Worker)

    render(
      <MemoryRouter initialEntries={['/search']}>
        <Routes>
          <Route path="/search" element={<Search />} />
        </Routes>
      </MemoryRouter>,
    )

    fireEvent.change(screen.getByPlaceholderText(/Literal text/), { target: { value: 'STATE5-ID' } })
    fireEvent.click(screen.getByRole('button', { name: 'Search' }))

    const worker = FakeWorker.instances[0]
    await waitFor(() => expect(worker.messages).toHaveLength(1))
    const request = worker.messages[0]
    expect(request).toMatchObject({ q: 'STATE5-ID', caseSensitive: false, limit: 20, offset: 0 })

    act(() => {
      worker.respond({
        type: 'result',
        requestId: request.requestId,
        result: {
          q: 'STATE5-ID',
          case_sensitive: false,
          total: 1,
          limit: 20,
          offset: 0,
          matches: [
            {
              w: 'dse',
              id: 'dse/PageA',
              s: 'dse_PageA~',
              n: 'PageA',
              seq: 1,
              t: '2026-06-18T10:00:00Z',
              x: 'AgentX',
              occurrences: 2,
              snippet: 'STATE5-ID <script>alert(1)</script>',
            },
          ],
        },
      })
    })

    expect(await screen.findByText(/1 matching revisions/)).toBeInTheDocument()
    const snippet = screen.getByText(/alert\(1\)/)
    expect(snippet.querySelector('script')).toBeNull()
    expect(screen.getByRole('link', { name: 'PageA' })).toHaveAttribute('href', '/page/dse%2FPageA')
  })

  it('clears stale matches when the URL query changes', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: true, json: async () => summary } as Response))
    vi.stubGlobal('Worker', FakeWorker as unknown as typeof Worker)

    const router = createMemoryRouter([{ path: '/search', element: <Search /> }], {
      initialEntries: ['/search?q=STATE5-ID'],
    })
    render(<RouterProvider router={router} />)

    const worker = FakeWorker.instances[0]
    await waitFor(() => expect(worker.messages).toHaveLength(1))
    act(() => {
      worker.respond({
        type: 'result',
        requestId: worker.messages[0].requestId,
        result: {
          q: 'STATE5-ID',
          case_sensitive: false,
          total: 1,
          limit: 20,
          offset: 0,
          matches: [
            {
              w: 'dse',
              id: 'dse/PageA',
              s: 'dse_PageA~',
              n: 'PageA',
              seq: 1,
              t: '2026-06-18T10:00:00Z',
              x: 'AgentX',
              occurrences: 1,
              snippet: 'STATE5-ID',
            },
          ],
        },
      })
    })
    expect(await screen.findByRole('link', { name: 'PageA' })).toBeInTheDocument()

    await act(async () => {
      await router.navigate('/search?q=another')
    })

    expect(screen.queryByRole('link', { name: 'PageA' })).toBeNull()
    expect(screen.getByText('starting…')).toBeInTheDocument()

    await waitFor(() => expect(worker.messages).toHaveLength(2))
    act(() => {
      worker.respond({
        type: 'result',
        requestId: worker.messages[1].requestId,
        result: { q: 'another', case_sensitive: false, total: 0, limit: 20, offset: 0, matches: [] },
      })
    })
    expect(await screen.findByText(/0 matching revisions/)).toBeInTheDocument()
  })

  it('shows worker errors with their code', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: true, json: async () => summary } as Response))
    vi.stubGlobal('Worker', FakeWorker as unknown as typeof Worker)

    render(
      <MemoryRouter initialEntries={['/search?q=state5-id']}>
        <Routes>
          <Route path="/search" element={<Search />} />
        </Routes>
      </MemoryRouter>,
    )

    const worker = FakeWorker.instances[0]
    await waitFor(() => expect(worker.messages).toHaveLength(1))
    act(() => {
      worker.respond({
        type: 'error',
        requestId: worker.messages[0].requestId,
        error: 'corpus data does not match summary metadata',
        code: 'archive_data_invalid',
      })
    })

    expect(await screen.findByText(/corpus data does not match summary metadata/)).toBeInTheDocument()
    expect(screen.getByText(/archive_data_invalid/)).toBeInTheDocument()
  })

  it('keeps one worker alive when leaving and returning to the search page', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: true, json: async () => summary } as Response))
    vi.stubGlobal('Worker', FakeWorker as unknown as typeof Worker)

    const router = createMemoryRouter(
      [
        { path: '/search', element: <Search /> },
        { path: '/dashboard', element: <div>dashboard</div> },
      ],
      { initialEntries: ['/search?q=STATE5-ID'] },
    )
    render(<RouterProvider router={router} />)

    const worker = FakeWorker.instances[0]
    await waitFor(() => expect(worker.messages).toHaveLength(1))
    act(() => {
      worker.respond({
        type: 'result',
        requestId: worker.messages[0].requestId,
        result: { q: 'STATE5-ID', case_sensitive: false, total: 0, limit: 20, offset: 0, matches: [] },
      })
    })
    expect(await screen.findByText(/0 matching revisions/)).toBeInTheDocument()

    await act(async () => {
      await router.navigate('/dashboard')
    })
    expect(screen.queryByText(/0 matching revisions/)).toBeNull()

    await act(async () => {
      await router.navigate('/search?q=STATE5-ID')
    })

    expect(FakeWorker.instances).toHaveLength(1)
    expect(worker.terminated).toBe(false)

    await waitFor(() => expect(worker.messages).toHaveLength(2))
    expect(worker.messages[1].requestId).not.toBe(worker.messages[0].requestId)
    act(() => {
      worker.respond({
        type: 'result',
        requestId: worker.messages[1].requestId,
        result: { q: 'STATE5-ID', case_sensitive: false, total: 0, limit: 20, offset: 0, matches: [] },
      })
    })
    expect(await screen.findByText(/0 matching revisions/)).toBeInTheDocument()
  })

  it('shows a load failure instead of staying on the loading state', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: true, json: async () => summary } as Response))
    vi.stubGlobal('Worker', FakeWorker as unknown as typeof Worker)

    render(
      <MemoryRouter initialEntries={['/search?q=STATE5-ID']}>
        <Routes>
          <Route path="/search" element={<Search />} />
        </Routes>
      </MemoryRouter>,
    )

    const worker = FakeWorker.instances[0]
    await waitFor(() => expect(worker.messages).toHaveLength(1))
    expect(screen.getByText('starting…')).toBeInTheDocument()

    act(() => {
      worker.fail()
    })

    expect(await screen.findByText(/corpus search worker failed to load/)).toBeInTheDocument()
    expect(screen.getByText(/worker_failed/)).toBeInTheDocument()
    expect(screen.queryByText('starting…')).toBeNull()
  })
})
