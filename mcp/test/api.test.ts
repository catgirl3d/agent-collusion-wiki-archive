import { afterEach, describe, expect, it, vi } from 'vitest'
import { ArchiveApiClient, ArchiveApiError } from '../src/api.js'

function response(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } })
}

function hangingFetch() {
  return vi.fn(
    (_request: Request | URL, init?: RequestInit) =>
      new Promise<Response>((_, reject) => {
        init?.signal?.addEventListener('abort', () => reject(new DOMException('aborted', 'AbortError')))
      }),
  )
}

afterEach(() => {
  vi.unstubAllEnvs()
})

describe('ArchiveApiClient', () => {
  it('uses GET and encodes path segments and query parameters', async () => {
    const fetchImpl = vi.fn().mockResolvedValue(response({ ok: true }))
    const api = new ArchiveApiClient({ baseUrl: 'https://archive.example', fetchImpl })

    await api.getPageRevisions('Page /? #', { label: 'Агент & one', withBody: false, limit: 3, offset: 2 })

    expect(fetchImpl).toHaveBeenCalledTimes(1)
    const [request, init] = fetchImpl.mock.calls[0]
    const url = new URL(String(request))
    expect(url.origin + url.pathname).toBe('https://archive.example/api/pages/Page%20%2F%3F%20%23/revisions')
    expect(Object.fromEntries(url.searchParams)).toEqual({
      label: 'Агент & one',
      limit: '3',
      offset: '2',
      body: '0',
    })
    expect(init).toMatchObject({ method: 'GET', redirect: 'error' })
  })

  it('omits undefined query values and maps include-body to the Worker contract', async () => {
    const fetchImpl = vi
      .fn()
      .mockResolvedValueOnce(response({ pages: [] }))
      .mockResolvedValueOnce(response({ revisions: [] }))
      .mockResolvedValueOnce(response({ revisions: [] }))
      .mockResolvedValueOnce(response({ id: 'wiki/Page' }))
    const api = new ArchiveApiClient({ baseUrl: 'http://localhost:8787/', fetchImpl })

    await api.listPages({ q: undefined, deleted: true, sort: 'labels' })
    await api.getPageRevisions('Slug', { withBody: true })
    await api.getPageRevisions('Default')
    await api.getPageById('wiki/Page')

    expect(String(fetchImpl.mock.calls[0][0])).toBe('http://localhost:8787/api/pages?deleted=true&sort=labels')
    expect(String(fetchImpl.mock.calls[1][0])).toBe('http://localhost:8787/api/pages/Slug/revisions?body=1')
    expect(String(fetchImpl.mock.calls[2][0])).toBe('http://localhost:8787/api/pages/Default/revisions?body=0')
    expect(String(fetchImpl.mock.calls[3][0])).toBe('http://localhost:8787/api/pages/by-id?id=wiki%2FPage')
  })

  it('converts non-success, malformed, and network responses to safe errors', async () => {
    const failed = vi.fn().mockResolvedValue(new Response('private upstream details', { status: 503 }))
    const api = new ArchiveApiClient({ baseUrl: 'https://archive.example', fetchImpl: failed })
    await expect(api.getStats()).rejects.toEqual(new ArchiveApiError('Archive API returned HTTP 503', 503))

    const malformed = new ArchiveApiClient({
      baseUrl: 'https://archive.example',
      fetchImpl: vi.fn().mockResolvedValue(new Response('not json', { status: 200 })),
    })
    await expect(malformed.getStats()).rejects.toEqual(new ArchiveApiError('Archive API returned invalid JSON'))

    const network = new ArchiveApiClient({
      baseUrl: 'https://archive.example',
      fetchImpl: vi.fn().mockRejectedValue(new TypeError('socket details')),
    })
    await expect(network.getStats()).rejects.toEqual(new ArchiveApiError('Unable to reach archive API'))
  })

  it('cancels an HTTP error body before returning a safe error', async () => {
    const cancel = vi.fn().mockResolvedValue(undefined)
    const fetchImpl = vi.fn().mockResolvedValue({
      ok: false,
      status: 404,
      body: { cancel },
    } as unknown as Response)
    const api = new ArchiveApiClient({ baseUrl: 'https://archive.example', fetchImpl })

    await expect(api.getStats()).rejects.toEqual(new ArchiveApiError('Archive API returned HTTP 404', 404))
    expect(cancel).toHaveBeenCalledOnce()
  })

  it.each([
    ['ftp://archive.example', 'ARCHIVE_API_URL must use http or https'],
    ['https://archive.example/path', 'ARCHIVE_API_URL must point to the Worker origin'],
    ['https://user:pass@archive.example', 'ARCHIVE_API_URL must not include credentials, query, or fragment'],
  ])('rejects unsafe base URL %s', (baseUrl, message) => {
    expect(() => new ArchiveApiClient({ baseUrl })).toThrow(message)
  })

  it('reports timeout without exposing the underlying abort error', async () => {
    const api = new ArchiveApiClient({ baseUrl: 'https://archive.example', fetchImpl: hangingFetch(), timeoutMs: 100 })

    await expect(api.getStats()).rejects.toEqual(new ArchiveApiError('Archive API request timed out after 100 ms'))
  })

  it('resolves the timeout from ARCHIVE_API_TIMEOUT_MS when no option is given', async () => {
    vi.stubEnv('ARCHIVE_API_TIMEOUT_MS', '100')
    const api = new ArchiveApiClient({ baseUrl: 'https://archive.example', fetchImpl: hangingFetch() })

    await expect(api.getStats()).rejects.toEqual(new ArchiveApiError('Archive API request timed out after 100 ms'))
  })

  it('prefers an explicit timeout option over ARCHIVE_API_TIMEOUT_MS', async () => {
    vi.stubEnv('ARCHIVE_API_TIMEOUT_MS', '5000')
    const api = new ArchiveApiClient({ baseUrl: 'https://archive.example', fetchImpl: hangingFetch(), timeoutMs: 100 })

    await expect(api.getStats()).rejects.toEqual(new ArchiveApiError('Archive API request timed out after 100 ms'))
  })

  it('rejects an invalid ARCHIVE_API_TIMEOUT_MS', () => {
    vi.stubEnv('ARCHIVE_API_TIMEOUT_MS', '50')

    expect(() => new ArchiveApiClient({ baseUrl: 'https://archive.example' })).toThrow(
      'ARCHIVE_API_TIMEOUT_MS must be an integer between 100 and 120000',
    )
  })

  it('stops reading an oversized chunked response before parsing JSON', async () => {
    const fetchImpl = vi.fn().mockResolvedValue(
      new Response(
        new ReadableStream({
          start(controller) {
            controller.enqueue(new TextEncoder().encode('x'.repeat(4_000_001)))
            controller.close()
          },
        }),
        { status: 200 },
      ),
    )
    const api = new ArchiveApiClient({ baseUrl: 'https://archive.example', fetchImpl })

    await expect(api.getStats()).rejects.toEqual(
      new ArchiveApiError('Archive API response is too large; reduce limit or omit revision bodies'),
    )
  })

  it('stops an oversized response announced by content-length before reading the body', async () => {
    const cancel = vi.fn().mockResolvedValue(undefined)
    const fetchImpl = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      headers: { get: (name: string) => (name === 'content-length' ? '4000001' : null) },
      body: { cancel },
    } as unknown as Response)
    const api = new ArchiveApiClient({ baseUrl: 'https://archive.example', fetchImpl })

    await expect(api.getStats()).rejects.toEqual(
      new ArchiveApiError('Archive API response is too large; reduce limit or omit revision bodies'),
    )
    expect(cancel).toHaveBeenCalledOnce()
  })
})
