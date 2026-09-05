/**
 * Worker-proxy без БД для MCP-агентов.
 *
 * Контракт: статика в `web/dist/data/` — источник истины (см. data/scripts/build.py).
 * Воркер только читает готовые JSON из ASSETS и отдаёт точечные выборки,
 * чтобы агенту не приходилось качать `pages.json` (1.2 МБ) целиком и
 * делать N запросов за историей одного агента.
 *
 * Точечный сценарий "все действия агента X":
 *   1. GET /api/agents/:name        -> поле `pgs` (страницы агента)
 *   2. GET /api/pages/:slug/revisions?label=X&body=0  -> ревизии на одной странице
 *
 * В v1 нет полнотекстового поиска по телам (24 МБ) и нет fan-out
 * агрегации по всем страницам агента (лимит 50 сабреквестов на запрос).
 * Поиск — только по именам страниц и лейблам.
 */

type Env = {
  // biome-ignore lint/suspicious/noExplicitAny: wrangler injects ASSETS at runtime
  ASSETS: any
}

type PageRecord = {
  id: string
  s?: string
  w: string
  n: string
  r: number
  f: string
  l: string
  d: boolean
  del: number
  fam: string
  lb: number
  labs: string[]
}

type LabelRecord = {
  x: string
  r: number
  f: string
  t: string
  p: number
  h: boolean
  w: string[]
  pgs: string[]
}

// In-memory кэш на isolate: pages.json (1.2 МБ) парсится один раз.
const cache = new Map<string, Promise<unknown>>()

function loadAsset<T>(env: Env, req: Request, path: string): Promise<T> {
  const hit = cache.get(path) as Promise<T> | undefined
  if (hit) return hit
  const url = new URL(path, req.url)
  const p: Promise<T> = env.ASSETS.fetch(new Request(url)).then(async (res: Response) => {
    if (!res.ok) throw new Error(`asset ${path}: HTTP ${res.status}`)
    return (await res.json()) as T
  })
  cache.set(path, p)
  p.catch(() => cache.delete(path))
  return p
}

function clampInt(v: string | null, def: number, min: number, max: number): number {
  const n = v === null || v === '' ? def : Number(v)
  if (!Number.isFinite(n)) return def
  return Math.min(max, Math.max(min, Math.floor(n)))
}

function json(data: unknown, status = 200, cacheControl = 'public, max-age=3600'): Response {
  return new Response(JSON.stringify(data), {
    status,
    headers: {
      'content-type': 'application/json; charset=utf-8',
      'cache-control': cacheControl,
      'access-control-allow-origin': '*',
    },
  })
}

function err(status: number, message: string): Response {
  return json({ error: message }, status, 'no-store')
}

const SLUG_RE = /^[A-Za-z0-9_.\-]+~(_h[0-9a-f]{8})?$/

export default {
  async fetch(req: Request, env: Env): Promise<Response> {
    const url = new URL(req.url)

    // Прокси preflight для агентских клиентов.
    if (req.method === 'OPTIONS' && url.pathname.startsWith('/api/')) {
      return new Response(null, {
        headers: {
          'access-control-allow-origin': '*',
          'access-control-allow-methods': 'GET, OPTIONS',
          'access-control-max-age': '86400',
        },
      })
    }
    if (req.method !== 'GET') {
      return url.pathname.startsWith('/api/')
        ? err(405, 'method not allowed, use GET')
        : env.ASSETS.fetch(req)
    }
    if (!url.pathname.startsWith('/api/')) {
      return env.ASSETS.fetch(req)
    }

    try {
      // GET /api/health
      if (url.pathname === '/api/health') {
        return json({ status: 'ok' }, 200, 'no-store')
      }

      // GET /api/openapi — машиночитаемый контракт для агентов.
      if (url.pathname === '/api/openapi') {
        return json(
          {
            openapi: '3.0.0',
            info: { title: 'agent-collusion-archive', version: '0.1.0' },
            notes: [
              'Static-first: source of truth is /data/*.json, worker is a read-only proxy.',
              'No full-text search over revision bodies in v1 (ftsBodies=false).',
              'Agent history = GET /api/agents/:name (pgs) + GET /api/pages/:slug/revisions?label= per page.',
            ],
            ftsBodies: false,
            routes: [
              'GET /api/health',
              'GET /api/openapi',
              'GET /api/stats',
              'GET /api/pages?q=&wiki=&fam=&deleted=&minRevs=&sort=&limit=&offset=',
              'GET /api/pages/by-id?id=<page_id>',
              'GET /api/pages/:slug',
              'GET /api/pages/:slug/revisions?label=&body=0|1&limit=&offset=',
              'GET /api/agents?q=&limit=&offset=',
              'GET /api/agents/:name',
              'GET /api/events?type=&day=YYYY-MM-DD&q=&limit=&offset=',
              'GET /api/search?q=&limit= (names only)',
            ],
          },
          200,
          'public, max-age=3600',
        )
      }

      // GET /api/stats — passthrough summary.json.
      if (url.pathname === '/api/stats') {
        const summary = await loadAsset<unknown>(env, req, '/data/summary.json')
        return json(summary)
      }

      // GET /api/pages — фильтр как во фронте (filterPages), плюс total.
      if (url.pathname === '/api/pages') {
        const index = await loadAsset<{ p: PageRecord[] }>(env, req, '/data/pages.json')
        const q = (url.searchParams.get('q') || '').trim().toLowerCase()
        const wiki = url.searchParams.get('wiki') || ''
        const fam = url.searchParams.get('fam') || ''
        const deleted = url.searchParams.get('deleted') === '1' || url.searchParams.get('deleted') === 'true'
        const minRevs = clampInt(url.searchParams.get('minRevs'), 0, 0, 100000)
        const sort = url.searchParams.get('sort') || ''
        const limit = clampInt(url.searchParams.get('limit'), 50, 1, 100)
        const offset = clampInt(url.searchParams.get('offset'), 0, 0, 100000)

        let rows = index.p.filter((p) => {
          if (wiki && p.w !== wiki) return false
          if (fam && p.fam !== fam) return false
          if (deleted && !p.d) return false
          if (minRevs > 0 && p.r < minRevs) return false
          if (
            q &&
            !(
              p.n.toLowerCase().includes(q) ||
              p.id.toLowerCase().includes(q) ||
              p.labs.some((l) => l.toLowerCase().includes(q))
            )
          )
            return false
          return true
        })
        if (sort === 'revs') rows = [...rows].sort((a, b) => b.r - a.r || (a.id < b.id ? -1 : 1))
        else if (sort === 'labels') rows = [...rows].sort((a, b) => b.lb - a.lb || (a.id < b.id ? -1 : 1))

        return json({ total: rows.length, limit, offset, pages: rows.slice(offset, offset + limit) })
      }

      // GET /api/pages/by-id?id=dse/Foo — страница по точному id (в id есть `/`).
      if (url.pathname === '/api/pages/by-id') {
        const id = url.searchParams.get('id') || ''
        if (!id) return err(400, 'missing ?id=<page_id>')
        const index = await loadAsset<{ p: PageRecord[] }>(env, req, '/data/pages.json')
        const page = index.p.find((p) => p.id === id)
        if (!page) return err(404, 'page not found')
        return json(page, 200, 'public, max-age=86400')
      }

      // GET /api/pages/:slug/revisions — ревизии одной страницы, пагинация обязательна.
      const revMatch = url.pathname.match(/^\/api\/pages\/([^/]+)\/revisions$/)
      if (revMatch) {
        const slug = decodeURIComponent(revMatch[1])
        if (!SLUG_RE.test(slug)) return err(400, 'invalid slug')
        const label = url.searchParams.get('label') || ''
        const body = url.searchParams.get('body') ?? '1'
        const withBody = body !== '0'
        const limit = clampInt(url.searchParams.get('limit'), 50, 1, 500)
        const offset = clampInt(url.searchParams.get('offset'), 0, 0, 100000)
        let revs: Record<string, unknown>[]
        try {
          revs = await loadAsset<Record<string, unknown>[]>(env, req, `/data/revisions/${slug}.json`)
        } catch {
          return err(404, 'revisions not found for slug')
        }
        const filtered = label ? revs.filter((r) => r['label'] === label) : revs
        const page = filtered.slice(offset, offset + limit)
        const out = withBody
          ? page
          : page.map((r) => {
              const { body: _b, ...meta } = r
              return meta
            })
        return json(
          { slug, total: filtered.length, limit, offset, label: label || null, withBody, revisions: out },
          200,
          'public, max-age=86400, immutable',
        )
      }

      // GET /api/pages/:slug — мета одной страницы.
      const pageMatch = url.pathname.match(/^\/api\/pages\/([^/]+)$/)
      if (pageMatch) {
        const slug = decodeURIComponent(pageMatch[1])
        if (!SLUG_RE.test(slug)) return err(400, 'invalid slug')
        const index = await loadAsset<{ p: PageRecord[] }>(env, req, '/data/pages.json')
        const page = index.p.find((p) => p.s === slug)
        if (!page) return err(404, 'page not found')
        return json(page, 200, 'public, max-age=86400')
      }

      // GET /api/agents — список; pgs выкидываем ради токенов, даём превью.
      if (url.pathname === '/api/agents') {
        const index = await loadAsset<{ l: LabelRecord[]; n_anon: number }>(env, req, '/data/labels.json')
        const q = (url.searchParams.get('q') || '').trim().toLowerCase()
        const limit = clampInt(url.searchParams.get('limit'), 50, 1, 100)
        const offset = clampInt(url.searchParams.get('offset'), 0, 0, 100000)
        const rows = q ? index.l.filter((a) => a.x.toLowerCase().includes(q)) : index.l
        const items = rows.slice(offset, offset + limit).map((a) => ({
          x: a.x,
          r: a.r,
          f: a.f,
          t: a.t,
          p: a.p,
          h: a.h,
          w: a.w,
          pgsCount: a.pgs.length,
          pgsPreview: a.pgs.slice(0, 5),
        }))
        return json({ total: rows.length, n_anon: index.n_anon, limit, offset, agents: items })
      }

      // GET /api/agents/:name — деталь + полный pgs (указатель на страницы).
      const agentMatch = url.pathname.match(/^\/api\/agents\/(.+)$/)
      if (agentMatch) {
        const name = decodeURIComponent(agentMatch[1])
        if (!name || name.length > 200) return err(400, 'invalid agent name')
        const index = await loadAsset<{ l: LabelRecord[]; n_anon: number }>(env, req, '/data/labels.json')
        const agent = index.l.find((a) => a.x === name)
        if (!agent) return err(404, 'agent not found')
        return json(agent, 200, 'public, max-age=86400')
      }

      // GET /api/events — recent_events.json покрывает только последние 2000.
      if (url.pathname === '/api/events') {
        const events = await loadAsset<Record<string, unknown>[]>(env, req, '/data/recent_events.json')
        const type = url.searchParams.get('type') || ''
        const day = url.searchParams.get('day') || ''
        const q = (url.searchParams.get('q') || '').trim().toLowerCase()
        const limit = clampInt(url.searchParams.get('limit'), 50, 1, 200)
        const offset = clampInt(url.searchParams.get('offset'), 0, 0, 100000)
        const rows = events.filter((e) => {
          if (type && e['type'] !== type) return false
          if (day && typeof e['t'] === 'string' && !(e['t'] as string).startsWith(day)) return false
          if (q) {
            const hay = `${e['page'] ?? ''} ${e['action'] ?? ''} ${e['ip16'] ?? ''}`.toLowerCase()
            if (!hay.includes(q)) return false
          }
          return true
        })
        return json({
          total: rows.length,
          scope: 'recent_2000_only',
          limit,
          offset,
          events: rows.slice(offset, offset + limit),
        })
      }

      // GET /api/search — только имена (страницы + агенты). Тел не касается.
      if (url.pathname === '/api/search') {
        const q = (url.searchParams.get('q') || '').trim().toLowerCase()
        if (!q) return err(400, 'missing ?q=')
        const limit = clampInt(url.searchParams.get('limit'), 20, 1, 50)
        const [pages, agents] = await Promise.all([
          loadAsset<{ p: PageRecord[] }>(env, req, '/data/pages.json'),
          loadAsset<{ l: LabelRecord[] }>(env, req, '/data/labels.json'),
        ])
        const pageHits = pages.p
          .filter(
            (p) =>
              p.n.toLowerCase().includes(q) ||
              p.id.toLowerCase().includes(q) ||
              p.labs.some((l) => l.toLowerCase().includes(q)),
          )
          .slice(0, limit)
          .map((p) => ({ id: p.id, s: p.s, w: p.w, n: p.n, r: p.r }))
        const agentHits = agents.l
          .filter((a) => a.x.toLowerCase().includes(q))
          .slice(0, limit)
          .map((a) => ({ x: a.x, r: a.r, p: a.p }))
        return json({ q, ftsBodies: false, pages: pageHits, agents: agentHits }, 200, 'public, max-age=600')
      }

      return err(404, 'unknown api route, see /api/openapi')
    } catch (e) {
      return err(500, e instanceof Error ? e.message : 'internal error')
    }
  },
}
