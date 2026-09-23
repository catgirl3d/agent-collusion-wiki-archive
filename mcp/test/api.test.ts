import { afterEach, describe, expect, it, vi } from 'vitest'
import { ArchiveApiClient, ArchiveApiError, DEFAULT_API_URL } from '../src/api.js'

function response(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } })
}

function hangingFetch() {
  return vi.fn(
    (_request: Request | URL | string, init?: RequestInit) =>
      new Promise<Response>((_, reject) => {
        init?.signal?.addEventListener('abort', () => reject(new DOMException('aborted', 'AbortError')))
      }),
  )
}

afterEach(() => {
  vi.unstubAllEnvs()
})

describe('ArchiveApiClient', () => {
  it('uses the public default API URL when no environment override is set', async () => {
    const previous = process.env.ARCHIVE_API_URL
    delete process.env.ARCHIVE_API_URL

    try {
      const fetchImpl = vi.fn().mockResolvedValue(response({ ok: true }))
      const api = new ArchiveApiClient({ fetchImpl })

      await api.getStats()

      expect(DEFAULT_API_URL).toBe('https://agent-collusion.uk/api')
      expect(fetchImpl).toHaveBeenCalledTimes(1)
      expect(String(fetchImpl.mock.calls[0][0])).toBe('https://agent-collusion.uk/api/stats')
    } finally {
      if (previous === undefined) delete process.env.ARCHIVE_API_URL
      else process.env.ARCHIVE_API_URL = previous
    }
  })

  it.each(['https://host/api', 'https://host'])('resolves ARCHIVE_API_URL=%s to the API base', async (baseUrl) => {
    vi.stubEnv('ARCHIVE_API_URL', baseUrl)
    const fetchImpl = vi.fn().mockResolvedValue(response({ ok: true }))
    const api = new ArchiveApiClient({ fetchImpl })

    await api.getStats()

    expect(fetchImpl).toHaveBeenCalledTimes(1)
    expect(String(fetchImpl.mock.calls[0][0])).toBe('https://host/api/stats')
  })

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

  it('serializes discovery routes and extended filters without dropping false or zero', async () => {
    const fetchImpl = vi.fn().mockImplementation(() => Promise.resolve(response({ ok: true })))
    const api = new ArchiveApiClient({ baseUrl: 'https://archive.example', fetchImpl })

    await api.searchFts({ q: 'state & five', mode: 'prefix', wiki: 'wiki', limit: 0, offset: 0 })
    await api.searchArtifacts({ flag: 'tunnel', host: 'relay.example', slug: 'Page /', id: 'wiki/Page', wiki: 'wiki', limit: 1, offset: 0 })
    await api.getAgentLinks({ label: 'A & B', other: 'C/D' })
    await api.listConflicts({ minChurn: 0, zzz: false, front: true, limit: 0, offset: 0 })
    await api.getApiContract()
    await api.getPageRevisions('Slug', { contains: 'needle & more', withBody: false, limit: 0, offset: 0 })
    await api.listEvents({ act: 'lead_status_changed', wiki: 'wiki', limit: 0, offset: 0 })
    await api.listAgents({ sort: 'pages', limit: 0, offset: 0 })

    expect(String(fetchImpl.mock.calls[0][0])).toBe('https://archive.example/api/fts?q=state+%26+five&mode=prefix&wiki=wiki&limit=0&offset=0')
    expect(String(fetchImpl.mock.calls[1][0])).toBe('https://archive.example/api/artifacts?flag=tunnel&host=relay.example&slug=Page+%2F&id=wiki%2FPage&wiki=wiki&limit=1&offset=0')
    expect(String(fetchImpl.mock.calls[2][0])).toBe('https://archive.example/api/links?label=A+%26+B&other=C%2FD')
    expect(String(fetchImpl.mock.calls[3][0])).toBe('https://archive.example/api/conflicts?minChurn=0&zzz=false&front=true&limit=0&offset=0')
    expect(String(fetchImpl.mock.calls[4][0])).toBe('https://archive.example/api/openapi')
    expect(String(fetchImpl.mock.calls[5][0])).toBe('https://archive.example/api/pages/Slug/revisions?contains=needle+%26+more&limit=0&offset=0&body=0')
    expect(String(fetchImpl.mock.calls[6][0])).toBe('https://archive.example/api/events?act=lead_status_changed&wiki=wiki&limit=0&offset=0')
    expect(String(fetchImpl.mock.calls[7][0])).toBe('https://archive.example/api/agents?sort=pages&limit=0&offset=0')
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

  it('forwards the sanitized Worker error message and code', async () => {
    const fetchImpl = vi.fn().mockResolvedValue(
      new Response(
        JSON.stringify({ error: 'no usable query tokens (stop words or shorter than 3 characters)', code: 'no_usable_tokens' }),
        { status: 400, headers: { 'content-type': 'application/json' } },
      ),
    )
    const api = new ArchiveApiClient({ baseUrl: 'https://archive.example', fetchImpl })

    await expect(api.searchFts({ q: 'the' })).rejects.toEqual(
      new ArchiveApiError('no usable query tokens (stop words or shorter than 3 characters)', 400, 'no_usable_tokens'),
    )
  })

  it('falls back to a generic error for non-JSON, malformed, and oversized error bodies', async () => {
    const html = new ArchiveApiClient({
      baseUrl: 'https://archive.example',
      fetchImpl: vi.fn().mockResolvedValue(
        new Response('<html>private upstream details</html>', { status: 502, headers: { 'content-type': 'text/html' } }),
      ),
    })
    await expect(html.getStats()).rejects.toEqual(new ArchiveApiError('Archive API returned HTTP 502', 502))

    const malformed = new ArchiveApiClient({
      baseUrl: 'https://archive.example',
      fetchImpl: vi.fn().mockResolvedValue(
        new Response('{oops', { status: 400, headers: { 'content-type': 'application/json' } }),
      ),
    })
    await expect(malformed.getStats()).rejects.toEqual(new ArchiveApiError('Archive API returned HTTP 400', 400))

    const oversized = new ArchiveApiClient({
      baseUrl: 'https://archive.example',
      fetchImpl: vi.fn().mockResolvedValue(
        new Response(JSON.stringify({ error: 'x'.repeat(500), code: 'y'.repeat(100) }), {
          status: 400,
          headers: { 'content-type': 'application/json' },
        }),
      ),
    })
    const error = await oversized.getStats().catch((caught: unknown) => caught)
    expect(error).toBeInstanceOf(ArchiveApiError)
    expect((error as ArchiveApiError).message).toHaveLength(300)
    expect((error as ArchiveApiError).code).toHaveLength(64)
  })

  it('serializes revision seq and event date-range filters', async () => {
    const fetchImpl = vi.fn().mockImplementation(() => Promise.resolve(response({ ok: true })))
    const api = new ArchiveApiClient({ baseUrl: 'https://archive.example', fetchImpl })

    await api.getPageRevisions('Slug', { seq: 42, withBody: true })
    await api.listEvents({ from: '2026-06-01', to: '2026-06-22', limit: 5 })

    expect(String(fetchImpl.mock.calls[0][0])).toBe('https://archive.example/api/pages/Slug/revisions?seq=42&body=1')
    expect(String(fetchImpl.mock.calls[1][0])).toBe('https://archive.example/api/events?from=2026-06-01&to=2026-06-22&limit=5')
  })

  it.each([
    ['not a url', 'baseUrl must be a valid URL'],
    ['ftp://archive.example', 'baseUrl must use http or https'],
    ['https://archive.example/custom', 'baseUrl must point to the Worker API base (/api)'],
    ['https://user:pass@archive.example', 'baseUrl must not include credentials, query, or fragment'],
    ['https://archive.example/api?', 'baseUrl must not include credentials, query, or fragment'],
    ['https://archive.example/api#', 'baseUrl must not include credentials, query, or fragment'],
  ])('rejects unsafe base URL %s', (baseUrl, message) => {
    expect(() => new ArchiveApiClient({ baseUrl })).toThrow(message)
  })

  it('reports an invalid ARCHIVE_API_URL under the environment variable name', () => {
    vi.stubEnv('ARCHIVE_API_URL', 'ftp://archive.example')

    expect(() => new ArchiveApiClient()).toThrow('ARCHIVE_API_URL must use http or https')
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
            controller.enqueue(new TextEncoder().encode('x'.repeat(2_000_001)))
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
      headers: { get: (name: string) => (name === 'content-length' ? '2000001' : null) },
      body: { cancel },
    } as unknown as Response)
    const api = new ArchiveApiClient({ baseUrl: 'https://archive.example', fetchImpl })

    await expect(api.getStats()).rejects.toEqual(
      new ArchiveApiError('Archive API response is too large; reduce limit or omit revision bodies'),
    )
    expect(cancel).toHaveBeenCalledOnce()
  })
})
