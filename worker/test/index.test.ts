import { describe, expect, it, vi } from 'vitest'
import { readFileSync } from 'node:fs'
import { PAYLOAD_FLAGS, tokenizeBody } from '../src/index'

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
const partialPage = {
  id: 'publictestwiki/Recovered', s: 'Recovered~', w: 'publictestwiki', n: 'Recovered', r: 1,
  f: '', l: '2026-05-11', d: false, del: 0, fam: '', lb: 0, labs: [], partial: true,
}
const labels = {
  n_anon: 4,
  l: [
    { x: 'Alice', r: 7, f: 'first', t: '2026-01-01', p: 2, h: false, w: ['wiki'], pgs: ['Page_One~_h12345678', 'Notes'] },
    { x: 'Bob', r: 4, f: 'second', t: '2026-01-02', p: 1, h: true, w: ['wiki'], pgs: ['Deleted', pageOne.s] },
    { x: 'Aaron', r: 1, f: 'third', t: '2026-01-03', p: 0, h: false, w: ['wiki'], pgs: [] },
  ],
}
const revisions = [
  { seq: 1, label: 'Alice', body: 'first body', t: '2026-01-03T10:00:00Z' },
  { seq: 2, label: 'Bob', body: 'prefix '.repeat(20) + 'Needle   appears here', t: '2026-01-04T10:00:00Z' },
]
const partialRevisions = [
  { seq: 0, label: null, added: ['recovered line'], removed: ['old line'], partial: true, time: '2026-05-11T10:00:00Z' },
]
const events = [
  { type: 'edit', act: '[Admin1]', wiki: 'wiki', t: '2026-01-03T10:00:00Z', page: 'Page One', action: 'update', ip16: 'aabb' },
  { type: 'delete', act: '[Admin2]', wiki: 'other', t: '2026-01-04T10:00:00Z', page: 'Deleted', action: 'remove', ip16: 'ccdd' },
  { type: 'edit', act: '[Admin1]', wiki: 'other', t: '2026-01-05T10:00:00Z', page: 'Notes', action: 'update', ip16: 'eeff' },
]
const partialEvent = { type: 'save', wiki: 'publictestwiki', t: '2026-05-11T10:00:00Z', page: 'Recovered', ip16: '1122', partial: true }

const fts = {
  tokens: { alpha: [0, 2], alphabet: [1], beta: [0], capped: [0] },
  meta: { postings_cap: 1, truncated_totals: { capped: 2 } },
}
const payload = [
  { s: pageOne.s, id: pageOne.id, u: ['early.example', 'relay.example'], f: ['tunnel'] },
  { s: pageTwo.s, id: pageTwo.id, u: ['other.example'], f: ['redirect'] },
]
const conflicts = [
  { id: 'low/id', s: 'low~', churn: 1, ttd_med_s: 2, del: 0, zzz: true, front: false },
  ...Array.from({ length: 501 }, (_, index) => ({ id: `high/${index}`, s: `high_${index}~`, churn: 10, ttd_med_s: 3, del: 0, zzz: false, front: false })),
]

const assets: Record<string, AssetValue> = {
  '/data/summary.json': { pages: 3, revisions: 12 },
  '/data/pages.json': { p: [pageOne, pageTwo, pageThree, partialPage] },
  '/data/labels.json': labels,
  '/data/revisions/Page_One~_h12345678.json': revisions,
  '/data/revisions/Recovered~.json': partialRevisions,
  '/data/recent_events.json': events,
  '/data/fts_index.json': fts,
  '/data/payload_index.json': payload,
  '/data/conflicts.json': conflicts,
  '/data/agent_links.json': { Alice: [{ o: 'Bob', c: 2 }] },
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
    expect(await json(method.response)).toEqual({ error: 'method not allowed, use GET', code: 'method_not_allowed' })
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
    expect(body.routes).toContain('GET /api/pages?q=&wiki=&fam=&deleted=&minRevs=&sort=&limit=&offset= (src filtering is client-side only)')
    expect(body.routes).toContain('GET /api/events?type=&act=&wiki=&day=YYYY-MM-DD&from=YYYY-MM-DD&to=YYYY-MM-DD&q=&limit=&offset=')
    expect(body.dataAssets.map((asset: { path: string }) => asset.path)).toContain('/data/corpus/revisions.jsonl.gz')
    expect(openapi.setup.calls).toEqual([])
  })

  it('serves OpenAPI with or without a trailing slash', async () => {
    const canonical = await request('/api/openapi')
    const trailingSlash = await request('/api/openapi/')

    expect(trailingSlash.response.status).toBe(200)
    expect(await json(trailingSlash.response)).toEqual(await json(canonical.response))
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
    ['/api/pages/by-id', 400, 'missing ?id=<page_id>', 'missing_param'],
    ['/api/pages/by-id?id=wiki%2Fmissing', 404, 'page not found', 'not_found'],
  ])('handles by-id error %s', async (path, status, error, code) => {
    const result = await request(path)
    expect(result.response.status).toBe(status)
    expect(await json(result.response)).toEqual({ error, code })
  })

  it('returns a page by exact id', async () => {
    const result = await request('/api/pages/by-id?id=wiki%2FPage%20One')
    expect(result.response.status).toBe(200)
    expect(await json(result.response)).toEqual(pageOne)
  })

  it.each([
    ['/api/pages/bad%20slug', 400, 'invalid slug', 'invalid_slug'],
    ['/api/pages/Missing~_h00000000', 404, 'page not found', 'not_found'],
  ])('handles page slug error %s', async (path, status, error, code) => {
    const result = await request(path)
    expect(result.response.status).toBe(status)
    expect(await json(result.response)).toEqual({ error, code })
  })

  it('returns page metadata by slug', async () => {
    const result = await request('/api/pages/Page_One~_h12345678')
    expect(await json(result.response)).toEqual(pageOne)
  })

  it('passes recovered provenance through pages, revisions, events, and search', async () => {
    const pages = await request('/api/pages?wiki=publictestwiki')
    expect((await json(pages.response)).pages).toEqual([partialPage])

    const byId = await request('/api/pages/by-id?id=publictestwiki%2FRecovered')
    expect(await json(byId.response)).toEqual(partialPage)

    const withBody = await request('/api/pages/Recovered~/revisions?body=1')
    expect((await json(withBody.response)).revisions).toEqual(partialRevisions)
    const withoutBody = await request('/api/pages/Recovered~/revisions?body=0')
    expect((await json(withoutBody.response)).revisions).toEqual([{
      seq: 0, label: null, added: ['recovered line'], removed: ['old line'], partial: true, time: '2026-05-11T10:00:00Z',
    }])

    const eventResult = await request('/api/events?wiki=publictestwiki', {}, { '/data/recent_events.json': [partialEvent] })
    expect((await json(eventResult.response)).events).toEqual([partialEvent])

    const search = await request('/api/search?q=recovered')
    expect((await json(search.response)).pages).toEqual([{
      id: partialPage.id, s: partialPage.s, w: partialPage.w, n: partialPage.n, r: partialPage.r, partial: true,
    }])
    const canonicalSearch = await request('/api/search?q=page')
    expect((await json(canonicalSearch.response)).pages[0].partial).toBeUndefined()
  })

  it('filters revisions, omits body, and paginates', async () => {
    const result = await request('/api/pages/Page_One~_h12345678/revisions?label=Alice&body=0&limit=1&offset=0')
    expect(await json(result.response)).toEqual({
      slug: 'Page_One~_h12345678', total: 1, limit: 1, offset: 0, label: 'Alice', contains: null, q: null, seq: null, withBody: false,
      revisions: [{ seq: 1, label: 'Alice', t: '2026-01-03T10:00:00Z' }],
    })
  })

  it('selects one revision by seq and rejects invalid seq values', async () => {
    const result = await request('/api/pages/Page_One~_h12345678/revisions?seq=1&body=0')
    expect(await json(result.response)).toMatchObject({ total: 1, seq: 1, revisions: [{ label: 'Alice' }] })
    const missing = await request('/api/pages/Page_One~_h12345678/revisions?seq=99&body=0')
    expect(await json(missing.response)).toMatchObject({ total: 0, seq: 99, revisions: [] })
    const bad = await request('/api/pages/Page_One~_h12345678/revisions?seq=-1')
    expect(bad.response.status).toBe(400)
    expect(await json(bad.response)).toEqual({ error: 'seq must be a non-negative integer', code: 'invalid_param' })
    const fractional = await request('/api/pages/Page_One~_h12345678/revisions?seq=1.5')
    expect(fractional.response.status).toBe(400)
  })

  it('returns revision bodies and reports invalid or missing revision assets', async () => {
    const success = await request('/api/pages/Page_One~_h12345678/revisions?body=1')
    expect((await json(success.response)).revisions).toEqual(revisions)

    const invalid = await request('/api/pages/bad%20slug/revisions')
    expect(invalid.response.status).toBe(400)
    const missing = await request('/api/pages/Unknown~_h00000000/revisions')
    expect(missing.response.status).toBe(404)
    expect(await json(missing.response)).toEqual({ error: 'revisions not found for slug', code: 'not_found' })

    const upstreamError = await request(
      '/api/pages/Page_One~_h12345678/revisions',
      undefined,
      { '/data/revisions/Page_One~_h12345678.json': new Response('upstream error', { status: 500 }) }
    )
    expect(upstreamError.response.status).toBe(500)
    expect(await json(upstreamError.response)).toEqual({ error: 'internal error', code: 'internal_error' })
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
    [`/api/agents/${'a'.repeat(201)}`, 400, 'invalid agent name', 'invalid_param'],
    ['/api/agents/Unknown', 404, 'agent not found', 'not_found'],
  ])('handles agent detail error %s', async (path, status, error, code) => {
    const result = await request(path)
    expect(result.response.status).toBe(status)
    expect(await json(result.response)).toEqual({ error, code })
  })

  it('returns agent detail with full page pointers', async () => {
    const result = await request('/api/agents/Alice')
    expect(await json(result.response)).toEqual(labels.l[0])
  })

  it('filters and paginates events', async () => {
    const result = await request('/api/events?type=edit&day=2026-01-03&q=page&limit=1&offset=0')
    expect(await json(result.response)).toEqual({ total: 1, scope: 'full_history', limit: 1, offset: 0, events: [events[0]] })
  })

  it('searches exact and prefix body tokens with honest truncation', async () => {
    const exact = await request('/api/fts?q=alpha')
    const exactBody = await json(exact.response)
    expect(exactBody).toMatchObject({ q: 'alpha', mode: 'exact', tokens: ['alpha'], truncated: false, total: 2 })
    expect(exactBody.pages.map((page: any) => page.w)).toEqual(['wiki', 'other'])
    const filtered = await request('/api/fts?q=alpha&wiki=other')
    expect((await json(filtered.response)).pages.map((page: any) => page.id)).toEqual(['other/Notes'])
    const prefix = await request('/api/fts?q=alp&mode=prefix')
    expect((await json(prefix.response)).pages.map((page: any) => page.id)).toEqual(['wiki/Deleted', 'wiki/Page One', 'other/Notes'])
    const mixed = await request('/api/fts?q=alpha+unknown')
    expect(await json(mixed.response)).toMatchObject({ truncated: false, total: 0, pages: [] })
    const missing = await request('/api/fts?q=zzzmissingtoken')
    expect(await json(missing.response)).toMatchObject({ truncated: false, total: 0, pages: [] })
    const capped = await request('/api/fts?q=capped')
    expect((await json(capped.response)).truncated).toBe(true)
    expect((await request('/api/fts')).response.status).toBe(400)
    expect(await json((await request('/api/fts')).response)).toMatchObject({ error: 'missing ?q=' })
    expect((await request('/api/fts?q=alpha&mode=nope')).response.status).toBe(400)
    const noTokens = await request('/api/fts?q=a')
    expect(noTokens.response.status).toBe(400)
    expect(await json(noTokens.response)).toMatchObject({ error: 'no usable query tokens (stop words or shorter than 3 characters)' })
    const prototype = await request('/api/fts?q=constructor')
    expect(await json(prototype.response)).toMatchObject({ truncated: false, total: 0, pages: [] })
    expect((await request('/api/fts?q=' + 'a'.repeat(201))).response.status).toBe(400)
    const manyTokens = Array.from({ length: 17 }, (_, index) => `tok${index}`).join('+')
    expect((await request(`/api/fts?q=${manyTokens}`)).response.status).toBe(400)
  })

  it('searches artifacts and validates flags', async () => {
    const result = await request('/api/artifacts?host=EARLY&flag=tunnel')
    expect(await json(result.response)).toMatchObject({ total: 1, pages: [{ id: pageOne.id, u: payload[0].u, f: payload[0].f }] })
    const invalid = await request('/api/artifacts?flag=unknown')
    expect(invalid.response.status).toBe(400)
  })

  it('serves links and exact pair intersections', async () => {
    expect(await json((await request('/api/links?label=Alice')).response)).toEqual({ label: 'Alice', links: [{ o: 'Bob', c: 2 }] })
    expect(await json((await request('/api/links?label=Alice&other=Bob')).response)).toEqual({
      label: 'Alice', other: 'Bob', sharedCount: 1, sharedPages: [pageOne.s],
    })
    expect((await request('/api/links?label=Unknown')).response.status).toBe(404)
    expect((await request('/api/links?label=Alice&other=Unknown')).response.status).toBe(404)
    expect((await request('/api/links?label=constructor')).response.status).toBe(404)
    expect((await request('/api/links?label=__proto__')).response.status).toBe(404)
  })

  it('filters the complete conflicts list', async () => {
    const result = await request('/api/conflicts?minChurn=0&zzz=true&limit=200')
    expect(await json(result.response)).toMatchObject({ total: 1, conflicts: [conflicts[0]] })
  })

  it('treats explicit false conflict flags as no filter', async () => {
    const flagged = [
      { id: 'a/zzz', s: 'a_zzz~', churn: 5, zzz: true, front: false },
      { id: 'b/front', s: 'b_front~', churn: 5, zzz: false, front: true },
      { id: 'c/plain', s: 'c_plain~', churn: 5, zzz: false, front: false },
    ]
    const overrides = { '/data/conflicts.json': flagged }
    const get = async (query: string) =>
      json((await request(`/api/conflicts?minChurn=0${query}&limit=200`, undefined, overrides)).response)

    expect((await get('')).total).toBe(3)
    expect((await get('&zzz=false')).total).toBe(3)
    expect((await get('&front=false')).total).toBe(3)
    expect((await get('&zzz=true')).total).toBe(1)
    expect((await get('&front=true')).total).toBe(1)
  })

  it('rejects revision body values other than 0 or 1', async () => {
    const bad = await request('/api/pages/Page_One~_h12345678/revisions?body=2')
    expect(bad.response.status).toBe(400)
    expect(await json(bad.response)).toMatchObject({ code: 'invalid_param' })
  })

  it('distinguishes missing revision assets from corrupt ones', async () => {
    const missing = await request('/api/pages/Missing~_h00000000/revisions')
    expect(missing.response.status).toBe(404)
    expect(await json(missing.response)).toMatchObject({ code: 'not_found' })

    const corrupt = await request('/api/pages/Page_One~_h12345678/revisions', undefined, {
      '/data/revisions/Page_One~_h12345678.json': new Response('not json', { status: 200 }),
    })
    expect(corrupt.response.status).toBe(500)
    expect(await json(corrupt.response)).toMatchObject({ code: 'internal_error' })

    const misleading = await request('/api/pages/Page_One~_h12345678/revisions', undefined, {
      '/data/revisions/Page_One~_h12345678.json': new Response('HTTP 404 missing page', { status: 200 }),
    })
    expect(misleading.response.status).toBe(500)
    expect(await json(misleading.response)).toMatchObject({ code: 'internal_error' })
  })

  it('filters revisions by raw contains and emits snippets only without bodies', async () => {
    const result = await request('/api/pages/Page_One~_h12345678/revisions?label=Bob&contains=NEEDLE&body=0')
    const body = await json(result.response)
    expect(body.q).toBe('NEEDLE')
    expect(body.contains).toBe('NEEDLE')
    expect(body.total).toBe(1)
    expect(body.revisions[0]).toMatchObject({ label: 'Bob', snippet: expect.stringContaining('Needle appears here') })
    expect(body.revisions[0].snippet).not.toMatch(/\s{2,}/)
    const full = await request('/api/pages/Page_One~_h12345678/revisions?contains=NEEDLE&body=1')
    const fullBody = await json(full.response)
    expect(fullBody.revisions[0]).toMatchObject({ body: expect.stringContaining('Needle   appears') })
    expect(fullBody.revisions[0].snippet).toBeUndefined()
    expect((await json((await request('/api/pages/Page_One~_h12345678/revisions?contains=')).response)).q).toBe('')
    const emptyContains = await json((await request('/api/pages/Page_One~_h12345678/revisions?contains=')).response)
    expect(emptyContains.contains).toBe('')
    expect((await request('/api/pages/Page_One~_h12345678/revisions?contains=' + 'x'.repeat(201))).response.status).toBe(400)
  })

  it('filters events and supports agent sort modes with fallback', async () => {
    const event = await request('/api/events?act=%5BAdmin1%5D&wiki=wiki')
    expect((await json(event.response)).total).toBe(1)
    const pages = await request('/api/agents?sort=pages')
    expect((await json(pages.response)).agents[0].x).toBe('Alice')
    const byName = await request('/api/agents?sort=name')
    expect((await json(byName.response)).agents[0].x).toBe('Aaron')
    const stored = await request('/api/agents')
    expect((await json(stored.response)).agents[0].x).toBe('Alice')
    const fallback = await request('/api/agents?sort=unknown')
    expect((await json(fallback.response)).agents[0].x).toBe('Alice')
  })

  it('filters events by inclusive from/to dates and validates bounds', async () => {
    const range = await request('/api/events?from=2026-01-03&to=2026-01-04')
    const ranged = await json(range.response)
    expect(ranged.total).toBe(2)
    expect(ranged.events.map((event: { type: string }) => event.type)).toEqual(['edit', 'delete'])
    const fromOnly = await request('/api/events?from=2026-01-04')
    expect((await json(fromOnly.response)).total).toBe(2)
    const toOnly = await request('/api/events?to=2026-01-03')
    expect((await json(toOnly.response)).total).toBe(1)
    const invalidFrom = await request('/api/events?from=2026-13-01')
    expect(invalidFrom.response.status).toBe(400)
    expect(await json(invalidFrom.response)).toEqual({ error: 'from must be a real UTC date (YYYY-MM-DD)', code: 'invalid_param' })
    const invalidDay = await request('/api/events?day=01-02-2026')
    expect(invalidDay.response.status).toBe(400)
    expect(await json(invalidDay.response)).toEqual({ error: 'day must be a real UTC date (YYYY-MM-DD)', code: 'invalid_param' })
    const reversed = await request('/api/events?from=2026-02-01&to=2026-01-01')
    expect(reversed.response.status).toBe(400)
    expect(await json(reversed.response)).toEqual({ error: 'from must not be after to', code: 'invalid_param' })
  })

  it('matches tokenizer golden fixture and advertises new routes', async () => {
    const fixture = JSON.parse(readFileSync(new URL('../../data/validation/token_golden.json', import.meta.url), 'utf8'))
    for (const testCase of fixture.cases) expect(tokenizeBody(testCase.text).sort()).toEqual(testCase.tokens.sort())
    const body = await json((await request('/api/openapi')).response)
    expect(body.ftsBodies).toBe(true)
    expect(body.routes).toContain('GET /api/fts?q=&mode=exact|prefix&wiki=&limit=&offset=')
    expect(body.routes).toContain('GET /api/artifacts?flag=&host=&slug=&id=&wiki=&limit=&offset=')
    expect(body.routes).toContain('GET /api/pages/:slug/revisions?label=&contains=&seq=&body=0|1&limit=&offset=')
    expect(body.dataAssets.map((asset: { path: string }) => asset.path)).toEqual([
      '/data/timeline.json',
      '/data/activity_by_day.json',
      '/data/activity_by_hour.json',
      '/data/corpus/revisions.jsonl.gz',
      '/data/other-wikis.json.gz',
    ])

    const buildSource = readFileSync(new URL('../../data/scripts/build.py', import.meta.url), 'utf8')
    const flagsLiteral = buildSource.match(/PAYLOAD_FLAGS = \(([^)]*)\)/)
    expect(flagsLiteral).not.toBeNull()
    const buildFlags = [...(flagsLiteral?.[1] ?? '').matchAll(/"([^"]+)"/g)].map((match) => match[1])
    expect(buildFlags).toEqual(PAYLOAD_FLAGS)
  })

  it('requires search query and returns page and agent hits', async () => {
    const missing = await request('/api/search')
    expect(missing.response.status).toBe(400)
    expect(await json(missing.response)).toEqual({ error: 'missing ?q=', code: 'missing_param' })

    const result = await request('/api/search?q=alice&limit=1')
    expect(await json(result.response)).toEqual({ q: 'alice', ftsBodies: false,
      pages: [{ id: pageOne.id, s: pageOne.s, w: pageOne.w, n: pageOne.n, r: pageOne.r }],
      agents: [{ x: 'Alice', r: 7, p: 2 }], })
  })

  it('returns unknown route and converts asset failures to 500', async () => {
    const unknown = await request('/api/nope')
    expect(unknown.response.status).toBe(404)
    expect(await json(unknown.response)).toEqual({ error: 'unknown api route, see /api/openapi', code: 'not_found' })

    const logged = vi.spyOn(console, 'error').mockImplementation(() => undefined)
    const failure = await request('/api/stats', {}, { '/data/summary.json': new Response('broken', { status: 503 }) })
    expect(failure.response.status).toBe(500)
    expect(await json(failure.response)).toEqual({ error: 'internal error', code: 'internal_error' })
    logged.mockRestore()
  })

  it('logs internal asset failures without leaking their details to clients', async () => {
    const logged = vi.spyOn(console, 'error').mockImplementation(() => undefined)
    const failure = await request('/api/stats', {}, { '/data/summary.json': new Response('broken', { status: 503 }) })
    const body = await json(failure.response)

    expect(body).toEqual({ error: 'internal error', code: 'internal_error' })
    expect(JSON.stringify(body)).not.toContain('/data/summary.json')
    expect(logged).toHaveBeenCalledWith('archive worker request failed', expect.any(Error))
    logged.mockRestore()
  })
})
