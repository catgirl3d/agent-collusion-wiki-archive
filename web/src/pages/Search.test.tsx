import { act, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { MemoryRouter, Route, Routes, RouterProvider, createMemoryRouter } from 'react-router-dom'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { CorpusWorkerRequest, CorpusWorkerResponse } from '../utils/corpus'
import { resetCorpusWorkerForTests } from '../utils/corpusWorkerClient'
import Search from './Search'

const loadJsonMock = vi.hoisted(() => vi.fn())
vi.mock('../api', () => ({ loadJson: loadJsonMock }))

class FakeWorker {
  static instances: FakeWorker[] = []
  onmessage: ((event: MessageEvent<CorpusWorkerResponse>) => void) | null = null
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

const activity = [
  { date: '2026-06-16', wiki: 'dse', saves: 1, deletes: 0, reverts: 0, probes: 0, bytes: 10 },
  { date: '2026-06-17', wiki: 'dse', saves: 1, deletes: 0, reverts: 0, probes: 0, bytes: 10 },
  { date: '2026-06-20', wiki: '', saves: 0, deletes: 0, reverts: 0, probes: 1, bytes: 0 },
]

function matchResult(requestId: number, snippet: string, q: string): CorpusWorkerResponse {
  return {
    type: 'result',
    requestId,
    result: {
      q,
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
          bytes: 1900,
          lines: 12,
          snippet,
        },
      ],
    },
  }
}

function requireSearchRequest(message: CorpusWorkerRequest) {
  if (message.type !== 'search') throw new Error('expected a search request')
  return message
}

afterEach(() => {
  loadJsonMock.mockReset()
  resetCorpusWorkerForTests()
  FakeWorker.instances = []
})

function stubSearchData(summaryData: unknown = summary) {
  loadJsonMock.mockImplementation((path: string) => {
    if (path === 'summary.json') return Promise.resolve(summaryData)
    if (path === 'activity_by_day.json') return Promise.resolve(activity)
    return Promise.reject(new Error(`Unexpected data request: ${path}`))
  })
}

describe('Search', () => {
  it('uses the archive calendar for both date filters', async () => {
    stubSearchData()

    render(
      <MemoryRouter initialEntries={['/search']}>
        <Routes>
          <Route path="/search" element={<Search />} />
        </Routes>
      </MemoryRouter>,
    )

    for (const label of ['Filter from date', 'Filter to date']) {
      await screen.findByRole('button', { name: label })
      await waitFor(() => expect(screen.getByRole('button', { name: label })).toBeEnabled())
      fireEvent.click(screen.getByRole('button', { name: label }))

      expect(await screen.findByRole('dialog', { name: label })).toBeInTheDocument()
      expect(screen.getByText('June 2026')).toBeInTheDocument()
      expect(screen.getByRole('checkbox', { name: 'only days with data' })).toBeChecked()
      expect(screen.getByRole('button', { name: '15' })).toBeDisabled()
      expect(screen.getByRole('button', { name: '16' })).toBeEnabled()
      fireEvent.click(screen.getByRole('button', { name: label }))
    }
  })

  it('clears the range start when a new end date would invert the range', async () => {
    stubSearchData()
    vi.stubGlobal('Worker', FakeWorker as unknown as typeof Worker)

    render(
      <MemoryRouter initialEntries={['/search?q=STATE5-ID&from=2026-06-20']}>
        <Routes>
          <Route path="/search" element={<Search />} />
        </Routes>
      </MemoryRouter>,
    )

    const worker = FakeWorker.instances[0]
    await waitFor(() => expect(worker.messages).toHaveLength(1))
    expect(worker.messages[0]).toMatchObject({ from: '2026-06-20' })

    fireEvent.click(screen.getByRole('button', { name: 'Filter to date' }))
    expect(await screen.findByRole('dialog', { name: 'Filter to date' })).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: '16' }))

    await waitFor(() => expect(worker.messages).toHaveLength(2))
    const request = requireSearchRequest(worker.messages[1])
    expect(request.from).toBeUndefined()
    expect(request.to).toBe('2026-06-16')
    expect(screen.getByRole('button', { name: 'Filter from date' })).not.toHaveTextContent('2026-06-20')
  })

  it('clears the range end when a new start date would invert the range', async () => {
    stubSearchData()
    vi.stubGlobal('Worker', FakeWorker as unknown as typeof Worker)

    render(
      <MemoryRouter initialEntries={['/search?q=STATE5-ID&to=2026-06-16']}>
        <Routes>
          <Route path="/search" element={<Search />} />
        </Routes>
      </MemoryRouter>,
    )

    const worker = FakeWorker.instances[0]
    await waitFor(() => expect(worker.messages).toHaveLength(1))
    expect(worker.messages[0]).toMatchObject({ to: '2026-06-16' })

    fireEvent.click(screen.getByRole('button', { name: 'Filter from date' }))
    expect(await screen.findByRole('dialog', { name: 'Filter from date' })).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: '20' }))

    await waitFor(() => expect(worker.messages).toHaveLength(2))
    const request = requireSearchRequest(worker.messages[1])
    expect(request.to).toBeUndefined()
    expect(request.from).toBe('2026-06-20')
    expect(screen.getByRole('button', { name: 'Filter to date' })).not.toHaveTextContent('2026-06-16')
  })

  it('keeps both range bounds when they stay ordered', async () => {
    stubSearchData()
    vi.stubGlobal('Worker', FakeWorker as unknown as typeof Worker)

    render(
      <MemoryRouter initialEntries={['/search?q=STATE5-ID&from=2026-06-16']}>
        <Routes>
          <Route path="/search" element={<Search />} />
        </Routes>
      </MemoryRouter>,
    )

    const worker = FakeWorker.instances[0]
    await waitFor(() => expect(worker.messages).toHaveLength(1))

    fireEvent.click(screen.getByRole('button', { name: 'Filter to date' }))
    expect(await screen.findByRole('dialog', { name: 'Filter to date' })).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: '20' }))

    await waitFor(() => expect(worker.messages).toHaveLength(2))
    expect(worker.messages[1]).toMatchObject({ from: '2026-06-16', to: '2026-06-20' })
  })

  it('keeps the opposite bound when a date picker is cleared', async () => {
    stubSearchData()
    vi.stubGlobal('Worker', FakeWorker as unknown as typeof Worker)

    render(
      <MemoryRouter initialEntries={['/search?q=STATE5-ID&from=2026-06-16&to=2026-06-20']}>
        <Routes>
          <Route path="/search" element={<Search />} />
        </Routes>
      </MemoryRouter>,
    )

    const worker = FakeWorker.instances[0]
    await waitFor(() => expect(worker.messages).toHaveLength(1))
    expect(worker.messages[0]).toMatchObject({ from: '2026-06-16', to: '2026-06-20' })

    await waitFor(() => expect(screen.getByRole('button', { name: 'Filter from date' })).toBeEnabled())
    fireEvent.click(screen.getByRole('button', { name: 'Filter from date' }))
    expect(await screen.findByRole('dialog', { name: 'Filter from date' })).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: 'clear' }))

    await waitFor(() => expect(worker.messages).toHaveLength(2))
    const request = requireSearchRequest(worker.messages[1])
    expect(request.from).toBeUndefined()
    expect(request.to).toBe('2026-06-20')
    expect(screen.getByRole('button', { name: 'Filter from date' })).not.toHaveTextContent('2026-06-16')
  })

  it('renders matches as inert text after a submitted search', async () => {
    stubSearchData()
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
              bytes: 35,
              lines: 1,
              snippet: 'STATE5-ID <script>alert(1)</script>',
            },
          ],
        },
      })
    })

    expect(await screen.findByText(/1 matching revisions/)).toBeInTheDocument()
    expect(document.querySelector('mark.mark-search')).toHaveTextContent('STATE5-ID')
    const snippet = screen.getByText(/alert\(1\)/)
    expect(snippet.querySelector('script')).toBeNull()
    expect(screen.getByRole('link', { name: 'PageA' })).toHaveAttribute('href', '/page/dse%2FPageA')
  })

  it('clears stale matches when the URL query changes', async () => {
    stubSearchData()
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
              bytes: 9,
              lines: 1,
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
    stubSearchData()
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

  it('triggers search with wholeWord and caseSensitive filters when toggled', async () => {
    stubSearchData()
    vi.stubGlobal('Worker', FakeWorker as unknown as typeof Worker)

    render(
      <MemoryRouter initialEntries={['/search?q=user']}>
        <Routes>
          <Route path="/search" element={<Search />} />
        </Routes>
      </MemoryRouter>,
    )

    const worker = FakeWorker.instances[0]
    await waitFor(() => expect(worker.messages).toHaveLength(1))
    expect(worker.messages[0]).toMatchObject({ q: 'user', caseSensitive: false, wholeWord: false })

    fireEvent.click(screen.getByLabelText(/whole word/i))
    await waitFor(() => expect(worker.messages).toHaveLength(2))
    expect(worker.messages[1]).toMatchObject({ q: 'user', caseSensitive: false, wholeWord: true })

    fireEvent.click(screen.getByLabelText(/case sensitive/i))
    await waitFor(() => expect(worker.messages).toHaveLength(3))
    expect(worker.messages[2]).toMatchObject({ q: 'user', caseSensitive: true, wholeWord: true })
  })

  it('re-runs an identical search instead of hanging on starting…', async () => {
    stubSearchData()
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
    act(() => {
      worker.respond(matchResult(worker.messages[0].requestId, 'STATE5-ID', 'STATE5-ID'))
    })
    expect(await screen.findByText(/1 matching revisions/)).toBeInTheDocument()

    fireEvent.click(screen.getByRole('button', { name: 'Search' }))
    expect(screen.getByText('starting…')).toBeInTheDocument()
    await waitFor(() => expect(worker.messages).toHaveLength(2))
    expect(worker.messages[1]).toMatchObject({ q: 'STATE5-ID', offset: 0 })

    act(() => {
      worker.respond(matchResult(worker.messages[1].requestId, 'STATE5-ID', 'STATE5-ID'))
    })
    expect(await screen.findByText(/1 matching revisions/)).toBeInTheDocument()
    expect(screen.queryByText('starting…')).toBeNull()
  })

  it('highlights only whole-word matches in the snippet', async () => {
    stubSearchData()
    vi.stubGlobal('Worker', FakeWorker as unknown as typeof Worker)

    render(
      <MemoryRouter initialEntries={['/search?q=user&word=1']}>
        <Routes>
          <Route path="/search" element={<Search />} />
        </Routes>
      </MemoryRouter>,
    )

    const worker = FakeWorker.instances[0]
    await waitFor(() => expect(worker.messages).toHaveLength(1))
    act(() => {
      worker.respond(matchResult(worker.messages[0].requestId, 'username user superuser', 'user'))
    })
    expect(await screen.findByText(/1 matching revisions/)).toBeInTheDocument()

    const marks = document.querySelectorAll('mark.mark-search')
    expect(marks).toHaveLength(1)
    expect(marks[0]).toHaveTextContent('user')
  })

  it('highlights only case-sensitive matches in the snippet', async () => {
    stubSearchData()
    vi.stubGlobal('Worker', FakeWorker as unknown as typeof Worker)

    render(
      <MemoryRouter initialEntries={['/search?q=User&case=1']}>
        <Routes>
          <Route path="/search" element={<Search />} />
        </Routes>
      </MemoryRouter>,
    )

    const worker = FakeWorker.instances[0]
    await waitFor(() => expect(worker.messages).toHaveLength(1))
    act(() => {
      worker.respond(matchResult(worker.messages[0].requestId, 'user User', 'User'))
    })
    expect(await screen.findByText(/1 matching revisions/)).toBeInTheDocument()

    const marks = document.querySelectorAll('mark.mark-search')
    expect(marks).toHaveLength(1)
    expect(marks[0]).toHaveTextContent('User')
  })

  it('highlights queries whose whitespace was collapsed in the snippet', async () => {
    stubSearchData()
    vi.stubGlobal('Worker', FakeWorker as unknown as typeof Worker)

    render(
      <MemoryRouter initialEntries={['/search?q=a%20%20b']}>
        <Routes>
          <Route path="/search" element={<Search />} />
        </Routes>
      </MemoryRouter>,
    )

    const worker = FakeWorker.instances[0]
    await waitFor(() => expect(worker.messages).toHaveLength(1))
    expect(worker.messages[0]).toMatchObject({ q: 'a  b' })
    act(() => {
      worker.respond(matchResult(worker.messages[0].requestId, 'a b', 'a  b'))
    })
    expect(await screen.findByText(/1 matching revisions/)).toBeInTheDocument()

    const marks = document.querySelectorAll('mark.mark-search')
    expect(marks).toHaveLength(1)
    expect(marks[0]).toHaveTextContent('a b')
  })

  it('loads the full revision body on demand and collapses it again', async () => {
    stubSearchData()
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
    act(() => {
      worker.respond(matchResult(worker.messages[0].requestId, 'STATE5-ID', 'STATE5-ID'))
    })
    expect(await screen.findByText(/1 matching revisions/)).toBeInTheDocument()

    fireEvent.click(screen.getByRole('button', { name: /full text/ }))
    await waitFor(() => expect(worker.messages).toHaveLength(2))
    expect(worker.messages[1]).toMatchObject({
      type: 'body',
      w: 'dse',
      id: 'dse/PageA',
      seq: 1,
      t: '2026-06-18T10:00:00Z',
    })
    expect(screen.getByRole('button', { name: 'loading…' })).toBeDisabled()
    expect(screen.getByText(/1.9 KB · 12 lines/)).toBeInTheDocument()

    await act(async () => {
      worker.respond({
        type: 'body',
        requestId: worker.messages[1].requestId,
        body: 'first line\nsecond line',
      })
    })

    const body = await screen.findByText((_, element) => element?.classList.contains('revision-body') ?? false)
    expect(body.textContent).toBe('first line\nsecond line')
    expect(screen.getByRole('button', { name: /hide full text/ })).toHaveAttribute('aria-expanded', 'true')

    fireEvent.click(screen.getByRole('button', { name: /hide full text/ }))
    expect(document.querySelector('.revision-body')).toBeNull()
    expect(screen.getByRole('button', { name: /full text/ })).toHaveAttribute('aria-expanded', 'false')
  })

  it('retries loading the full revision body after a worker error', async () => {
    stubSearchData()
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
    act(() => {
      worker.respond(matchResult(worker.messages[0].requestId, 'STATE5-ID', 'STATE5-ID'))
    })
    expect(await screen.findByText(/1 matching revisions/)).toBeInTheDocument()

    fireEvent.click(screen.getByRole('button', { name: /full text/ }))
    await waitFor(() => expect(worker.messages).toHaveLength(2))
    await act(async () => {
      worker.respond({
        type: 'error',
        requestId: worker.messages[1].requestId,
        error: 'revision not found in corpus',
      })
    })
    expect(await screen.findByText(/revision not found in corpus/)).toBeInTheDocument()

    fireEvent.click(screen.getByRole('button', { name: /hide full text/ }))
    expect(screen.queryByText(/revision not found in corpus/)).toBeNull()

    fireEvent.click(screen.getByRole('button', { name: /full text/ }))
    await waitFor(() => expect(worker.messages).toHaveLength(3))
    await act(async () => {
      worker.respond({
        type: 'body',
        requestId: worker.messages[2].requestId,
        body: 'recovered body',
      })
    })
    expect(await screen.findByText(/recovered body/)).toBeInTheDocument()
  })

  it('ignores a late revision body response after the search changes', async () => {
    stubSearchData()
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
    act(() => {
      worker.respond(matchResult(worker.messages[0].requestId, 'STATE5-ID', 'STATE5-ID'))
    })
    expect(await screen.findByText(/1 matching revisions/)).toBeInTheDocument()

    fireEvent.click(screen.getByRole('button', { name: /full text/ }))
    await waitFor(() => expect(worker.messages).toHaveLength(2))
    expect(worker.messages[1]).toMatchObject({ type: 'body' })

    fireEvent.click(screen.getByLabelText(/case sensitive/))
    await waitFor(() => expect(worker.messages).toHaveLength(3))
    act(() => {
      worker.respond(matchResult(worker.messages[2].requestId, 'STATE5-ID', 'STATE5-ID'))
    })
    expect(await screen.findByText(/1 matching revisions/)).toBeInTheDocument()

    await act(async () => {
      worker.respond({ type: 'body', requestId: worker.messages[1].requestId, body: 'late body' })
    })

    expect(screen.queryByText(/late body/)).toBeNull()
    expect(screen.queryByRole('button', { name: /hide full text/ })).toBeNull()
  })

  it('keeps one worker alive when leaving and returning to the search page', async () => {
    stubSearchData()
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
})
