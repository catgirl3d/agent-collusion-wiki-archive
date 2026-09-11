import { describe, expect, it, vi } from 'vitest'

type AssetValue = unknown | Response

const pageOne = {
  id: 'wiki/Page One', s: 'Page_One~_h12345678', w: 'wiki', n: 'Page One', r: 3,
  f: 'Family A', l: '2026-01-03', d: false, del: 0, fam: 'Family A', lb: 2, labs: ['Alice', 'release'],
}
const pageTwo = {
  id: 'wiki/Deleted', s: 'Deleted', w: 'wiki', n: 'Deleted', r: 8,
  f: 'Family B', l: '2026-01-04', d: true, del: 1, fam: 'Family B', lb: 5, labs: ['Bob'],
}
const pageThree = {
  id: 'other/Notes', s: 'Notes', w: 'other', n: 'Notes', r: 1,
  f: 'Family A', l: '2026-01-05', d: false, del: 0, fam: 'Family A', lb: 1, labs: ['Alice'],
}
const labels = {
  n_anon: 4,
  l: [
    { x: 'Alice', r: 7, f: 'first', t: '2026-01-01', p: 2, h: false, w: ['wiki'], pgs: ['Page_One~_h12345678', 'Notes'] },
    { x: 'Bob', r: 4, f: 'second', t: '2026-01-02', p: 1, h: true, w: ['wiki'], pgs: ['Deleted'] },
  ],
}
const revisions = [
  { label: 'Alice', body: 'first body', t: '2026-01-03T10:00:00Z' },
  { label: 'Bob', body: 'second body', t: '2026-01-04T10:00:00Z' },
]
const events = [
  { type: 'edit', t: '2026-01-03T10:00:00Z', page: 'Page One', action: 'update', ip16: 'aabb' },
  { type: 'delete', t: '2026-01-04T10:00:00Z', page: 'Deleted', action: 'remove', ip16: 'ccdd' },
  { type: 'edit', t: '2026-01-05T10:00:00Z', page: 'Notes', action: 'update', ip16: 'eeff' },
]

const assets: Record<string, AssetValue> = {
  '/data/summary.json': { pages: 3, revisions: 12 },
  '/data/pages.json': { p: [pageOne, pageTwo, pageThree] },
  '/data/labels.json': labels,
  '/data/revisions/Page_One~_h12345678.json': revisions,
  '/data/recent_events.json': events,
}

async function handlerForTest() {
  vi.resetModules()
  return (await import('../src/index')).default
}

function environment(overrides: Record<string, AssetValue> = {}) {
  const calls: string[] = []
  const values = { ...assets, ...overrides }
  const fetch = vi.fn(async (request: Request) => {
    const path = new URL(request.url).pathname
    calls.push(path)
    const value = values[path]
    if (value instanceof Response) return value
    if (value === undefined) return new Response('missing', { status: 404 })
    return Response.json(value)
  })
  return { env: { ASSETS: { fetch } }, calls, fetch }
}

async function request(path: string, init?: RequestInit, overrides: Record<string, AssetValue> = {}) {
  const worker = await handlerForTest()
  const setup = environment(overrides)
  const response = await worker.fetch(new Request(`https://worker.test${path}`, init), setup.env)
  return { response, setup }
}

async function json(response: Response) {
  return response.json() as Promise<Record<string, any>>
}

describe('Worker API default fetch handler', () => {
  it('handles API preflight and rejects non-GET API methods', async () => {
    const preflight = await request('/api/health', { method: 'OPTIONS' })
    expect(preflight.response.status).toBe(200)
    expect(preflight.response.headers.get('access-control-allow-methods')).toBe('GET, OPTIONS')

    const method = await request('/api/health', { method: 'POST' })
    expect(method.response.status).toBe(405)
    expect(await json(method.response)).toEqual({ error: 'method not allowed, use GET' })
  })

  it('falls back static and preserves non-API request', async () => {
    const setup = environment({ '/index.html': new Response('html', { status: 200 }) })
    const worker = await handlerForTest()
    const req = new Request('https://worker.test/index.html')
    const response = await worker.fetch(req, setup.env)
    expect(response.status).toBe(200)
    expect(await response.text()).toBe('html')
    expect(setup.fetch).toHaveBeenCalledWith(req)
  })

  it('serves health and openapi without assets', async () => {
    const health = await request('/api/health')
    expect(await json(health.response)).toEqual({ status: 'ok' })
    expect(health.response.headers.get('cache-control')).toBe('no-store')

    const openapi = await request('/api/openapi')
    const body = await json(openapi.response)
    expect(body.openapi).toBe('3.0.0')
    expect(body.routes).toContain('GET /api/events?type=&day=YYYY-MM-DD&q=&limit=&offset=')
    expect(openapi.setup.calls).toEqual([])
  })

  it('returns stats and caches the asset within an isolate', async () => {
    const worker = await handlerForTest()
    const setup = environment()
    await worker.fetch(new Request('https://worker.test/api/stats'), setup.env)
    const second = await worker.fetch(new Request('https://worker.test/api/stats'), setup.env)
    expect(await json(second)).toEqual(assets['/data/summary.json'])
    expect(setup.calls).toEqual(['/data/summary.json'])
  })

  it('filters, sorts, and paginates pages', async () => {
    const result = await request('/api/pages?q=alice&fam=Family%20A&minRevs=2&sort=revs&limit=1&offset=0')
    expect(await json(result.response)).toMatchObject({ total: 1, limit: 1, offset: 0, pages: [pageOne] })

    const deleted = await request('/api/pages?deleted=true&sort=labels')
    expect((await json(deleted.response)).pages).toEqual([pageTwo])
  })

  it.each([
    ['/api/pages/by-id', 400, 'missing ?id=<page_id>'],
    ['/api/pages/by-id?id=wiki%2Fmissing', 404, 'page not found'],
  ])('handles by-id error %s', async (path, status, error) => {
    const result = await request(path)
    expect(result.response.status).toBe(status)
    expect(await json(result.response)).toEqual({ error })
  })

  it('returns a page by exact id', async () => {
    const result = await request('/api/pages/by-id?id=wiki%2FPage%20One')
    expect(result.response.status).toBe(200)
    expect(await json(result.response)).toEqual(pageOne)
  })

  it.each([
    ['/api/pages/bad%20slug', 400, 'invalid slug'],
    ['/api/pages/Missing~_h00000000', 404, 'page not found'],
  ])('handles page slug error %s', async (path, status, error) => {
    const result = await request(path)
    expect(result.response.status).toBe(status)
    expect(await json(result.response)).toEqual({ error })
  })

  it('returns page metadata by slug', async () => {
    const result = await request('/api/pages/Page_One~_h12345678')
    expect(await json(result.response)).toEqual(pageOne)
  })

  it('filters revisions, omits body, and paginates', async () => {
    const result = await request('/api/pages/Page_One~_h12345678/revisions?label=Alice&body=0&limit=1&offset=0')
    expect(await json(result.response)).toEqual({
      slug: 'Page_One~_h12345678', total: 1, limit: 1, offset: 0, label: 'Alice', withBody: false,
      revisions: [{ label: 'Alice', t: '2026-01-03T10:00:00Z' }],
    })
  })

  it('returns revision bodies and reports invalid or missing revision assets', async () => {
    const success = await request('/api/pages/Page_One~_h12345678/revisions?body=1')
    expect((await json(success.response)).revisions).toEqual(revisions)

    const invalid = await request('/api/pages/bad%20slug/revisions')
    expect(invalid.response.status).toBe(400)
    const missing = await request('/api/pages/Unknown~_h00000000/revisions')
    expect(missing.response.status).toBe(404)
    expect(await json(missing.response)).toEqual({ error: 'revisions not found for slug' })
  })

  it('clears a rejected asset cache entry so a later request retries', async () => {
    const worker = await handlerForTest()
    const setup = environment()
    const path = '/api/pages/Retry~_h00000000/revisions'
    expect((await worker.fetch(new Request(`https://worker.test${path}`), setup.env)).status).toBe(404)
    expect((await worker.fetch(new Request(`https://worker.test${path}`), setup.env)).status).toBe(404)
    expect(setup.calls).toEqual([
      '/data/revisions/Retry~_h00000000.json',
      '/data/revisions/Retry~_h00000000.json',
    ])
  })

  it('lists agents with query, count, preview, and pagination', async () => {
    const result = await request('/api/agents?q=ali&limit=1&offset=0')
    expect(await json(result.response)).toEqual({ total: 1, n_anon: 4, limit: 1, offset: 0, agents: [{
      x: 'Alice', r: 7, f: 'first', t: '2026-01-01', p: 2, h: false, w: ['wiki'], pgsCount: 2,
      pgsPreview: ['Page_One~_h12345678', 'Notes'],
    }] })
  })

  it.each([
    [`/api/agents/${'a'.repeat(201)}`, 400, 'invalid agent name'],
    ['/api/agents/Unknown', 404, 'agent not found'],
  ])('handles agent detail error %s', async (path, status, error) => {
    const result = await request(path)
    expect(result.response.status).toBe(status)
    expect(await json(result.response)).toEqual({ error })
  })

  it('returns agent detail with full page pointers', async () => {
    const result = await request('/api/agents/Alice')
    expect(await json(result.response)).toEqual(labels.l[0])
  })

  it('filters and paginates events', async () => {
    const result = await request('/api/events?type=edit&day=2026-01-03&q=page&limit=1&offset=0')
    expect(await json(result.response)).toEqual({ total: 1, scope: 'full_history', limit: 1, offset: 0, events: [events[0]] })
  })

  it('requires search query and returns page and agent hits', async () => {
    const missing = await request('/api/search')
    expect(missing.response.status).toBe(400)
    expect(await json(missing.response)).toEqual({ error: 'missing ?q=' })

    const result = await request('/api/search?q=alice&limit=1')
    expect(await json(result.response)).toEqual({ q: 'alice', ftsBodies: false,
      pages: [{ id: pageOne.id, s: pageOne.s, w: pageOne.w, n: pageOne.n, r: pageOne.r }],
      agents: [{ x: 'Alice', r: 7, p: 2 }], })
  })

  it('returns unknown route and converts asset failures to 500', async () => {
    const unknown = await request('/api/nope')
    expect(unknown.response.status).toBe(404)
    expect(await json(unknown.response)).toEqual({ error: 'unknown api route, see /api/openapi' })

    const failure = await request('/api/stats', {}, { '/data/summary.json': new Response('broken', { status: 503 }) })
    expect(failure.response.status).toBe(500)
    expect(await json(failure.response)).toEqual({ error: 'asset /data/summary.json: HTTP 503' })
  })
})
