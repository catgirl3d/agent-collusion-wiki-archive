/**
 * DB-less worker-proxy for MCP agents.
 *
 * Contract: static data in `web/dist/data/` is the source of truth (see data/scripts/build.py).
 * The worker only reads prebuilt JSON from ASSETS and serves targeted slices,
 * so an agent does not have to download the full `pages.json` (1.2 MB) or make
 * N requests to reconstruct the history of a single agent.
 *
 * Targeted scenario "all actions of agent X":
 *   1. GET /api/agents/:name        -> `pgs` field (agent pages)
 *   2. GET /api/pages/:slug/revisions?label=X&body=0  -> revisions on one page
 *
 * Body-token search is served from the precomputed FTS index; exact substring
 * search remains available per page through the revisions endpoint.
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

type PayloadRecord = { s: string; id: string; u: string[]; f: string[] }
type ConflictRecord = { id: string; s: string; churn: number; ttd_med_s: number | null; del: number; zzz: boolean; front: boolean }

const BODY_STOP_WORDS = new Set([
  'about', 'after', 'again', 'against', 'also', 'among', 'and', 'are', 'been', 'before',
  'being', 'between', 'but', 'can', 'could', 'das', 'der', 'die', 'does', 'for', 'from',
  'haben', 'has', 'have', 'here', 'into', 'ist', 'more', 'nicht', 'oder', 'only', 'other',
  'our', 'over', 'sein', 'sich', 'that', 'the', 'their', 'there', 'these', 'they', 'this', 'those',
  'und', 'unter', 'von', 'war', 'were', 'what', 'when', 'where', 'which', 'with', 'would',
])
export const PAYLOAD_FLAGS = ['b64', 'hex', 'script', 'inject', 'homoglyph', 'high-entropy', 'tunnel', 'redirect']

// Tokenizer semantics are pinned by data/validation/token_golden.json; keep this in sync with build.py::_body_tokens.
export function tokenizeBody(text: string): string[] {
  return [...new Set((text.toLowerCase().match(/[a-z0-9]+/g) || [])
    .filter((token) => token.length >= 3 && token.length <= 25 && !/^\d+$/.test(token) && !BODY_STOP_WORDS.has(token)))]
}

function pageView(p: PageRecord) {
  return { id: p.id, s: p.s, w: p.w, n: p.n, r: p.r, fam: p.fam, lb: p.lb, d: p.d }
}

// In-memory per-isolate cache: pages.json (1.2 MB) is parsed once.
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

function err(status: number, message: string, code = 'error'): Response {
  return json({ error: message, code }, status, 'no-store')
}

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/

function isRealDate(value: string): boolean {
  if (!DATE_RE.test(value)) return false
  const parsed = new Date(`${value}T00:00:00Z`)
  return !Number.isNaN(parsed.getTime()) && parsed.toISOString().slice(0, 10) === value
}

const SLUG_RE = /^[A-Za-z0-9_.\-]+~(_h[0-9a-f]{8})?$/

export default {
  async fetch(req: Request, env: Env): Promise<Response> {
    const url = new URL(req.url)

    // Preflight proxy for agent clients.
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
        ? err(405, 'method not allowed, use GET', 'method_not_allowed')
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

      // GET /api/openapi — machine-readable contract for agents.
      if (url.pathname === '/api/openapi') {
        return json(
          {
            openapi: '3.0.0',
            info: { title: 'agent-collusion-archive', version: '0.1.0' },
            notes: [
              'Static-first: source of truth is /data/*, worker is a read-only asset and point-query proxy.',
              'Body-token search uses the complete precomputed index; the legacy truncated flag stays in responses and is false for the current index. Token queries keep at least one token of 3+ characters (stop words and shorter tokens are dropped) and intersect on AND.',
              'Exact substring search is available per page through revisions?contains=. Corpus-wide literal search runs in research clients over the published data assets, not on the worker.',
              'Agent history = GET /api/agents/:name (pgs) + GET /api/pages/:slug/revisions?label=&seq= per page; pgs lists hold at most 2,000 stored pages per agent.',
              'Errors return {error, code} with stable validation codes; day/from/to use real UTC dates (YYYY-MM-DD), inclusive.',
            ],
            ftsBodies: true,
            dataAssets: [
              { path: '/data/timeline.json', purpose: 'Global revision timeline (time desc) for cross-page agent history.' },
              { path: '/data/activity_by_day.json', purpose: 'Daily save/delete/revert/probe and byte totals.' },
              { path: '/data/activity_by_hour.json', purpose: 'UTC-hour save distribution (save events only).' },
              { path: '/data/corpus/revisions.jsonl.gz', purpose: 'Canonical raw revisions dump (gzip JSONL) for client-side corpus search.' },
            ],
            routes: [
              'GET /api/health',
              'GET /api/openapi',
              'GET /api/stats',
              'GET /api/pages?q=&wiki=&fam=&deleted=&minRevs=&sort=&limit=&offset=',
              'GET /api/pages/by-id?id=<page_id>',
              'GET /api/pages/:slug',
              'GET /api/pages/:slug/revisions?label=&contains=&seq=&body=0|1&limit=&offset=',
              'GET /api/agents?q=&sort=name|r|pages&limit=&offset=',
              'GET /api/agents/:name',
              'GET /api/events?type=&act=&wiki=&day=YYYY-MM-DD&from=YYYY-MM-DD&to=YYYY-MM-DD&q=&limit=&offset=',
              'GET /api/search?q=&limit= (names only)',
              'GET /api/fts?q=&mode=exact|prefix&wiki=&limit=&offset=',
              'GET /api/artifacts?flag=&host=&slug=&id=&wiki=&limit=&offset=',
              'GET /api/links?label=&other=',
              'GET /api/conflicts?minChurn=&zzz=&front=&limit=&offset=',
            ],
          },
          200,
          'public, max-age=3600',
        )
      }

      // GET /api/stats — passthrough of summary.json.
      if (url.pathname === '/api/stats') {
        const summary = await loadAsset<unknown>(env, req, '/data/summary.json')
        return json(summary)
      }

      // GET /api/pages — same filter as the frontend (filterPages), plus total.
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

      // GET /api/pages/by-id?id=dse/Foo — page by exact id (the id contains `/`).
      if (url.pathname === '/api/pages/by-id') {
        const id = url.searchParams.get('id') || ''
        if (!id) return err(400, 'missing ?id=<page_id>', 'missing_param')
        const index = await loadAsset<{ p: PageRecord[] }>(env, req, '/data/pages.json')
        const page = index.p.find((p) => p.id === id)
        if (!page) return err(404, 'page not found', 'not_found')
        return json(page, 200, 'public, max-age=86400')
      }

      // GET /api/pages/:slug/revisions — revisions of one page; pagination is mandatory.
      const revMatch = url.pathname.match(/^\/api\/pages\/([^/]+)\/revisions$/)
      if (revMatch) {
        const slug = decodeURIComponent(revMatch[1])
        if (!SLUG_RE.test(slug)) return err(400, 'invalid slug', 'invalid_slug')
        const label = url.searchParams.get('label') || ''
        const containsParam = url.searchParams.get('contains')
        const contains = containsParam || ''
        if (contains.length > 200) return err(400, 'contains must be 200 characters or fewer', 'invalid_param')
        const seqParam = url.searchParams.get('seq')
        let seq: number | null = null
        if (seqParam !== null) {
          const parsed = Number(seqParam)
          if (!Number.isInteger(parsed) || parsed < 0) return err(400, 'seq must be a non-negative integer', 'invalid_param')
          seq = parsed
        }
        const body = url.searchParams.get('body') ?? '1'
        const withBody = body !== '0'
        const limit = clampInt(url.searchParams.get('limit'), 50, 1, 500)
        const offset = clampInt(url.searchParams.get('offset'), 0, 0, 100000)
        let revs: Record<string, unknown>[]
        try {
          revs = await loadAsset<Record<string, unknown>[]>(env, req, `/data/revisions/${slug}.json`)
        } catch {
          return err(404, 'revisions not found for slug', 'not_found')
        }
        const labelFiltered = label ? revs.filter((r) => r['label'] === label) : revs
        const seqFiltered = seq === null ? labelFiltered : labelFiltered.filter((r) => r['seq'] === seq)
        const needle = containsParam !== null && contains.length > 0 ? contains.toLowerCase() : ''
        const filtered = needle
          ? seqFiltered.filter((r) => typeof r['body'] === 'string' && r['body'].toLowerCase().includes(needle))
          : seqFiltered
        const page = filtered.slice(offset, offset + limit)
        const out = withBody
          ? page
          : page.map((r) => {
              const { body, ...meta } = r
              if (!needle || typeof body !== 'string') return meta
              const match = body.toLowerCase().indexOf(needle)
              const start = Math.max(0, match - 60)
              const end = Math.min(body.length, match + contains.length + 60)
              return { ...meta, snippet: body.slice(start, end).replace(/\s+/g, ' ').trim() }
            })
        return json(
          { slug, total: filtered.length, limit, offset, label: label || null, contains: containsParam, q: containsParam, seq, withBody, revisions: out },
          200,
          'public, max-age=86400, immutable',
        )
      }

      // GET /api/pages/:slug — metadata of a single page.
      const pageMatch = url.pathname.match(/^\/api\/pages\/([^/]+)$/)
      if (pageMatch) {
        const slug = decodeURIComponent(pageMatch[1])
        if (!SLUG_RE.test(slug)) return err(400, 'invalid slug', 'invalid_slug')
        const index = await loadAsset<{ p: PageRecord[] }>(env, req, '/data/pages.json')
        const page = index.p.find((p) => p.s === slug)
        if (!page) return err(404, 'page not found', 'not_found')
        return json(page, 200, 'public, max-age=86400')
      }

      // GET /api/agents — list; pgs is dropped to save tokens, a preview is provided.
      if (url.pathname === '/api/agents') {
        const index = await loadAsset<{ l: LabelRecord[]; n_anon: number }>(env, req, '/data/labels.json')
        const q = (url.searchParams.get('q') || '').trim().toLowerCase()
        const sort = url.searchParams.get('sort') || ''
        const limit = clampInt(url.searchParams.get('limit'), 50, 1, 100)
        const offset = clampInt(url.searchParams.get('offset'), 0, 0, 100000)
        const rows = q ? index.l.filter((a) => a.x.toLowerCase().includes(q)) : index.l
        const sorted = sort === 'name'
          ? [...rows].sort((a, b) => a.x.toLowerCase().localeCompare(b.x.toLowerCase()) || a.x.localeCompare(b.x))
          : sort === 'r'
            ? [...rows].sort((a, b) => b.r - a.r || a.x.localeCompare(b.x))
            : sort === 'pages'
              ? [...rows].sort((a, b) => b.p - a.p || a.x.localeCompare(b.x))
              : rows
        const items = sorted.slice(offset, offset + limit).map((a) => ({
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
        return json({ total: sorted.length, n_anon: index.n_anon, limit, offset, agents: items })
      }

      // GET /api/agents/:name — details + full pgs (pointer to pages).
      const agentMatch = url.pathname.match(/^\/api\/agents\/(.+)$/)
      if (agentMatch) {
        const name = decodeURIComponent(agentMatch[1])
        if (!name || name.length > 200) return err(400, 'invalid agent name', 'invalid_param')
        const index = await loadAsset<{ l: LabelRecord[]; n_anon: number }>(env, req, '/data/labels.json')
        const agent = index.l.find((a) => a.x === name)
        if (!agent) return err(404, 'agent not found', 'not_found')
        return json(agent, 200, 'public, max-age=86400')
      }

      // GET /api/events — full history (recent_events.json without a limit).
      if (url.pathname === '/api/events') {
        const events = await loadAsset<Record<string, unknown>[]>(env, req, '/data/recent_events.json')
        const type = url.searchParams.get('type') || ''
        const act = url.searchParams.get('act') || ''
        const wiki = url.searchParams.get('wiki') || ''
        const day = url.searchParams.get('day') || ''
        const from = url.searchParams.get('from') || ''
        const to = url.searchParams.get('to') || ''
        if (day && !isRealDate(day)) return err(400, 'day must be a real UTC date (YYYY-MM-DD)', 'invalid_param')
        if (from && !isRealDate(from)) return err(400, 'from must be a real UTC date (YYYY-MM-DD)', 'invalid_param')
        if (to && !isRealDate(to)) return err(400, 'to must be a real UTC date (YYYY-MM-DD)', 'invalid_param')
        if (from && to && from > to) return err(400, 'from must not be after to', 'invalid_param')
        const q = (url.searchParams.get('q') || '').trim().toLowerCase()
        const limit = clampInt(url.searchParams.get('limit'), 50, 1, 200)
        const offset = clampInt(url.searchParams.get('offset'), 0, 0, 100000)
        const rows = events.filter((e) => {
          if (type && e['type'] !== type) return false
          if (act && e['act'] !== act) return false
          if (wiki && e['wiki'] !== wiki) return false
          const eventDay = typeof e['t'] === 'string' ? (e['t'] as string).slice(0, 10) : ''
          if (day && eventDay !== day) return false
          if (from && eventDay < from) return false
          if (to && eventDay > to) return false
          if (q) {
            const hay = `${e['page'] ?? ''} ${e['action'] ?? ''} ${e['ip16'] ?? ''}`.toLowerCase()
            if (!hay.includes(q)) return false
          }
          return true
        })
        return json({
          total: rows.length,
          scope: 'full_history',
          limit,
          offset,
          events: rows.slice(offset, offset + limit),
        })
      }

      // GET /api/fts — body-token search against integer postings.
      if (url.pathname === '/api/fts') {
        const q = url.searchParams.get('q') || ''
        if (q.length > 200) return err(400, 'q must be 200 characters or fewer', 'invalid_param')
        if (!q.trim()) return err(400, 'missing ?q=', 'missing_param')
        const tokens = tokenizeBody(q).sort()
        if (!tokens.length) return err(400, 'no usable query tokens (stop words or shorter than 3 characters)', 'no_usable_tokens')
        if (tokens.length > 16) return err(400, 'too many query tokens (max 16)', 'too_many_tokens')
        const modeParam = url.searchParams.get('mode') || 'exact'
        if (modeParam !== 'exact' && modeParam !== 'prefix') return err(400, 'invalid mode', 'invalid_mode')
        const mode = modeParam as 'exact' | 'prefix'
        const wiki = url.searchParams.get('wiki') || ''
        const limit = clampInt(url.searchParams.get('limit'), 20, 1, 100)
        const offset = clampInt(url.searchParams.get('offset'), 0, 0, 100000)
        const [fts, pages] = await Promise.all([
          loadAsset<{ tokens: Record<string, number[]>; meta: { truncated_totals?: Record<string, number> } }>(env, req, '/data/fts_index.json'),
          loadAsset<{ p: PageRecord[] }>(env, req, '/data/pages.json'),
        ])
        const postingSets: Array<Set<number>> = []
        const allKeys = mode === 'prefix' ? Object.keys(fts.tokens) : []
        let missing = 0
        let capped = false
        for (const token of tokens) {
          const keys = mode === 'exact' ? (Object.hasOwn(fts.tokens, token) ? [token] : []) : allKeys.filter((key) => key.startsWith(token))
          if (!keys.length) {
            missing += 1
            continue
          }
          const positions = new Set<number>()
          for (const key of keys) {
            for (const position of fts.tokens[key]) positions.add(position)
            if (Object.hasOwn(fts.meta.truncated_totals ?? {}, key)) capped = true
          }
          postingSets.push(positions)
        }
        let positions: Set<number> = new Set()
        if (postingSets.length) {
          positions = new Set(postingSets[0])
          for (const posting of postingSets.slice(1)) {
            positions = new Set([...positions].filter((position) => posting.has(position)))
          }
          if (missing > 0) positions.clear()
        }
        let rows = [...positions]
          .map((position) => pages.p[position])
          .filter((page): page is PageRecord => Boolean(page) && (!wiki || page.w === wiki))
          .map(pageView)
          .sort((a, b) => b.r - a.r || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0))
        const truncated = capped
        return json({ q, mode, tokens, truncated, total: rows.length, limit, offset, pages: rows.slice(offset, offset + limit) })
      }

      // GET /api/artifacts — payload findings joined to page metadata.
      if (url.pathname === '/api/artifacts') {
        const flag = url.searchParams.get('flag') || ''
        if (flag && !PAYLOAD_FLAGS.includes(flag)) return err(400, `unknown flag; allowed: ${PAYLOAD_FLAGS.join(', ')}`, 'invalid_flag')
        const host = (url.searchParams.get('host') || '').toLowerCase()
        const slug = url.searchParams.get('slug') || ''
        const id = url.searchParams.get('id') || ''
        const wiki = url.searchParams.get('wiki') || ''
        const limit = clampInt(url.searchParams.get('limit'), 50, 1, 100)
        const offset = clampInt(url.searchParams.get('offset'), 0, 0, 100000)
        const [payload, pages] = await Promise.all([
          loadAsset<PayloadRecord[]>(env, req, '/data/payload_index.json'),
          loadAsset<{ p: PageRecord[] }>(env, req, '/data/pages.json'),
        ])
        const pageById = new Map(pages.p.map((page) => [page.id, page]))
        const rows = payload.map((item) => ({ item, page: pageById.get(item.id) })).filter(({ item, page }) => {
          if (!page || (flag && !item.f.includes(flag)) || (host && !item.u.some((value) => value.toLowerCase().includes(host)))) return false
          if (slug && page.s !== slug) return false
          if (id && page.id !== id) return false
          if (wiki && page.w !== wiki) return false
          return true
        }).map(({ item, page }) => ({ ...pageView(page as PageRecord), u: item.u, f: item.f }))
        return json({ total: rows.length, limit, offset, pages: rows.slice(offset, offset + limit) })
      }

      // GET /api/links — precomputed navigation links or exact pair intersection.
      if (url.pathname === '/api/links') {
        const label = url.searchParams.get('label') || ''
        if (!label) return err(400, 'missing ?label=', 'missing_param')
        const other = url.searchParams.get('other')
        if (other === null) {
          const links = await loadAsset<Record<string, Array<Record<string, unknown>>>>(env, req, '/data/agent_links.json')
          if (!Object.hasOwn(links, label)) return err(404, 'agent links not found', 'not_found')
          return json({ label, links: links[label] })
        }
        const labels = await loadAsset<{ l: LabelRecord[] }>(env, req, '/data/labels.json')
        const left = labels.l.find((entry) => entry.x === label)
        const right = labels.l.find((entry) => entry.x === other)
        if (!left || !right) return err(404, 'agent label not found', 'not_found')
        const rightPages = new Set(right.pgs)
        const sharedPages = [...new Set(left.pgs)].filter((page) => rightPages.has(page)).sort()
        return json({ label, other, sharedCount: sharedPages.length, sharedPages })
      }

      // GET /api/conflicts — full conflict list with query filters.
      if (url.pathname === '/api/conflicts') {
        const minChurn = clampInt(url.searchParams.get('minChurn'), 0, 0, 100000)
        const zzzParam = url.searchParams.get('zzz')
        const frontParam = url.searchParams.get('front')
        const zzz = zzzParam === '1' || zzzParam === 'true'
        const front = frontParam === '1' || frontParam === 'true'
        const limit = clampInt(url.searchParams.get('limit'), 50, 1, 200)
        const offset = clampInt(url.searchParams.get('offset'), 0, 0, 100000)
        const conflicts = await loadAsset<ConflictRecord[]>(env, req, '/data/conflicts.json')
        const rows = conflicts.filter((row) => {
          if (row.churn < minChurn) return false
          if (zzzParam !== null && row.zzz !== zzz) return false
          if (frontParam !== null && row.front !== front) return false
          return true
        })
        return json({ total: rows.length, limit, offset, conflicts: rows.slice(offset, offset + limit) })
      }

      // GET /api/search — names only (pages + agents). Bodies are never touched.
      if (url.pathname === '/api/search') {
        const q = (url.searchParams.get('q') || '').trim().toLowerCase()
        if (!q) return err(400, 'missing ?q=', 'missing_param')
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

      return err(404, 'unknown api route, see /api/openapi', 'not_found')
    } catch (e) {
      // Keep internal exception details in logs; clients get a stable, non-leaking error body.
      console.error('archive worker request failed', e)
      return err(500, 'internal error', 'internal_error')
    }
  },
}
