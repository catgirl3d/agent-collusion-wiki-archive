import { readFileSync } from 'node:fs'
import { McpServer } from '@modelcontextprotocol/server'
import { z } from 'zod'
import type {
  AgentListParams,
  AgentLinksParams,
  ArchiveApi,
  ConflictListParams,
  EventListParams,
  PageListParams,
  RevisionListParams,
  SearchArtifactsParams,
  SearchFtsParams,
} from './api.js'
import { ArchiveApiClient, ArchiveApiError, MAX_RESPONSE_BYTES } from './api.js'
import { ArchiveDataError } from './assets.js'
import { ArchiveQueryError, ArchiveResearch } from './research.js'
import type { GetActivityArgs, ListRevisionsArgs, ResearchApi, SearchCorpusArgs } from './research.js'

const packageManifest = JSON.parse(readFileSync(new URL('../package.json', import.meta.url), 'utf8')) as {
  version: string
}
const nonEmptyText = (label: string, max = 200) => z.string().trim().min(1).max(max).describe(label)
const pageLimit = z.number().int().min(1).max(100).optional().describe('Number of rows to return (1-100).')
const pageOffset = z.number().int().min(0).max(100_000).optional().describe('Number of rows to skip.')
const utcDate = (label: string) =>
  z.string().trim().regex(/^\d{4}-\d{2}-\d{2}$/).describe(`${label} (UTC date, inclusive).`)

function errorResult(text: string, code?: string) {
  const payload = code ? { error: text, code } : { error: text }
  return { content: [{ type: 'text' as const, text: JSON.stringify(payload) }], isError: true }
}

interface ClosableHandle { close(): Promise<unknown> }
interface ShutdownTarget {
  on(signal: 'SIGINT' | 'SIGTERM', listener: () => void): unknown
  exit(code: number): void
}

export const SHUTDOWN_TIMEOUT_MS = 5_000

export function installShutdownHandlers(handle: ClosableHandle, proc: ShutdownTarget = process): void {
  let closing = false
  const shutdown = () => {
    if (closing) return
    closing = true
    let settled = false
    const finish = (code: number) => {
      if (settled) return
      settled = true
      clearTimeout(timeout)
      proc.exit(code)
    }
    const timeout = setTimeout(() => {
      console.error('MCP server shutdown timed out')
      finish(1)
    }, SHUTDOWN_TIMEOUT_MS)
    handle.close().then(
      () => { finish(0); },
      (error: unknown) => {
        console.error(error instanceof Error ? error.message : error)
        finish(1)
      },
    )
  }
  proc.on('SIGINT', shutdown)
  proc.on('SIGTERM', shutdown)
}

function failure(error: unknown) {
  if (error instanceof ArchiveApiError) return errorResult(error.message, error.code)
  if (error instanceof ArchiveDataError) return errorResult(error.message, error.code)
  if (error instanceof ArchiveQueryError) return errorResult(error.message, error.code)
  return errorResult('MCP request failed')
}

function result(data: unknown) {
  const text = JSON.stringify(data)
  if (Buffer.byteLength(text, 'utf8') > MAX_RESPONSE_BYTES) {
    return errorResult('MCP result is too large; reduce limit or omit revision bodies')
  }
  return { content: [{ type: 'text' as const, text }] }
}

async function call(operation: () => Promise<unknown>) {
  try {
    return result(await operation())
  } catch (error) {
    return failure(error)
  }
}

export function createArchiveMcpServer(
  api: ArchiveApi = new ArchiveApiClient(),
  research: ResearchApi = new ArchiveResearch(),
): McpServer {
  const server = new McpServer({ name: 'agent-collusion-archive', version: packageManifest.version })

  server.registerTool(
    'get_stats',
    {
      title: 'Archive statistics',
      description: 'Return aggregate statistics for the agent collusion archive.',
      annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false },
    },
    async () => call(() => api.getStats()),
  )

  server.registerTool(
    'get_activity',
    {
      title: 'Get activity aggregates',
      description:
        'Return archive activity. by=day gives per-wiki saves/deletes/reverts/probes/bytes with optional wiki and UTC date range; by=hour gives the global UTC-hour save distribution (save events only) and rejects wiki/date filters. Recovered saves are reported in the optional rec field.',
      inputSchema: {
        by: z.enum(['day', 'hour']).describe('Aggregate granularity.'),
        wiki: z.string().trim().max(100).optional().describe('Optional exact wiki filter (by=day only).'),
        from: utcDate('Optional inclusive start date').optional(),
        to: utcDate('Optional inclusive end date').optional(),
      },
      annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false },
    },
    async ({ by, wiki, from, to }) => call(() => research.getActivity({ by, wiki, from, to } satisfies GetActivityArgs)),
  )

  server.registerTool(
    'search_archive',
    {
      title: 'Search archive names',
      description: 'Search page names, page IDs, page labels, and agent names. Revision bodies are not searched.',
      inputSchema: {
        q: nonEmptyText('Search text.'),
        limit: z.number().int().min(1).max(50).optional().describe('Maximum hits per result group (1-50).'),
      },
      annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false },
    },
    async ({ q, limit }) => call(() => api.searchArchive(q, limit)),
  )

  server.registerTool(
    'list_agents',
    {
      title: 'List agents',
      description: 'List labeled agents with revision counts and page previews.',
      inputSchema: {
        q: z.string().trim().max(200).optional().describe('Optional substring filter for an agent name.'),
        sort: z.enum(['name', 'r', 'pages']).optional().describe('Sort by agent name, revisions, or pages.'),
        limit: pageLimit,
        offset: pageOffset,
      },
      annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false },
    },
    async ({ q, sort, limit, offset }) => call(() => api.listAgents({ q, sort, limit, offset } satisfies AgentListParams)),
  )

  server.registerTool(
    'get_agent',
    {
      title: 'Get agent details',
      description: 'Return one exact agent label and up to 2,000 canonical page IDs from the Worker index. The list may be truncated at 2,000.',
      inputSchema: { name: nonEmptyText('Exact agent label.') },
      annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false },
    },
    async ({ name }) => call(() => api.getAgent(name)),
  )

  server.registerTool(
    'list_pages',
    {
      title: 'List pages',
      description: 'Filter and paginate the lightweight page index.',
      inputSchema: {
        q: z.string().trim().max(200).optional().describe('Optional substring filter for page name, ID, or labels.'),
        wiki: z.string().trim().max(100).optional().describe('Optional exact wiki filter.'),
        fam: z.string().trim().max(200).optional().describe('Optional page family.'),
        deleted: z.boolean().optional().describe('Only return deleted pages when true.'),
        minRevs: z.number().int().min(0).max(100_000).optional().describe('Minimum revision count (default 0).'),
        sort: z.enum(['revs', 'labels']).optional().describe('Sort by revision count or label count.'),
        limit: pageLimit,
        offset: pageOffset,
      },
      annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false },
    },
    async ({ q, wiki, fam, deleted, minRevs, sort, limit, offset }) =>
      call(() => api.listPages({ q, wiki, fam, deleted, minRevs, sort, limit, offset } satisfies PageListParams)),
  )

  server.registerTool(
    'get_page',
    {
      title: 'Get page metadata',
      description: 'Return metadata for one generated page slug.',
      inputSchema: { slug: nonEmptyText('Exact generated page slug.') },
      annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false },
    },
    async ({ slug }) => call(() => api.getPage(slug)),
  )

  server.registerTool(
    'get_page_by_id',
    {
      title: 'Get page by ID',
      description: 'Return page metadata for an exact canonical page ID, such as wiki/Page. Use its s field for revision queries.',
      inputSchema: { id: nonEmptyText('Exact canonical page ID.') },
      annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false },
    },
    async ({ id }) => call(() => api.getPageById(id)),
  )

  server.registerTool(
    'get_page_revisions',
    {
      title: 'Get page revisions',
      description: 'Return paginated revisions for one generated page slug (the s field from a page lookup). Bodies are omitted unless include_body is true. Recovered rows carry partial: true, have no label or body, and retain added/removed lines. Pass seq to select one revision from a timeline or corpus hit.',
      inputSchema: {
        slug: nonEmptyText('Exact generated page slug.'),
        label: z.string().trim().max(200).optional().describe('Optional exact agent label filter.'),
        contains: z.string().trim().max(200).optional().describe('Optional case-insensitive raw substring filter; snippets are returned without bodies.'),
        seq: z.number().int().min(0).optional().describe('Optional exact revision sequence within the page.'),
        include_body: z.boolean().optional().describe('Include saved revision text. Defaults to false.'),
        limit: z.number().int().min(1).max(500).optional().describe('Number of revisions to return (1-500).'),
        offset: pageOffset,
      },
      annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false },
    },
    async ({ slug, label, contains, seq, include_body, limit, offset }) =>
      call(() =>
        api.getPageRevisions(slug, {
          label,
          contains,
          seq,
          withBody: include_body ?? false,
          limit,
          offset,
        } satisfies RevisionListParams),
      ),
  )

  server.registerTool(
    'list_revisions',
    {
      title: 'List revisions timeline',
      description:
        'Cross-page revision timeline sorted by time (desc by default): use it to reconstruct everything one agent label did without walking pages. Filters: exact label/wiki/id/slug, UTC day or from/to range. Recovered rows carry partial: true and have no label or body; retrieve their added/removed lines with get_page_revisions using the returned slug and seq.',
      inputSchema: {
        label: z.string().trim().max(200).optional().describe('Optional exact agent label.'),
        wiki: z.string().trim().max(100).optional().describe('Optional exact wiki.'),
        id: nonEmptyText('Optional exact canonical page ID.', 300).optional(),
        slug: nonEmptyText('Optional exact generated page slug.', 200).optional(),
        day: utcDate('Optional exact UTC day').optional(),
        from: utcDate('Optional inclusive start date').optional(),
        to: utcDate('Optional inclusive end date').optional(),
        order: z.enum(['asc', 'desc']).optional().describe('Time order; desc is the default.'),
        limit: z.number().int().min(1).max(500).optional().describe('Number of revisions to return (1-500).'),
        offset: pageOffset,
      },
      annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false },
    },
    async ({ label, wiki, id, slug, day, from, to, order, limit, offset }) =>
      call(() => research.listRevisions({ label, wiki, id, slug, day, from, to, order, limit, offset } satisfies ListRevisionsArgs)),
  )

  server.registerTool(
    'list_events',
    {
      title: 'List events',
      description: 'Filter and paginate recorded archive events.',
      inputSchema: {
        type: z.enum(['save', 'delete', 'revert', 'probe']).optional().describe('Event type filter (save, delete, revert, or probe).'),
        day: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional().describe('UTC day in YYYY-MM-DD format.'),
        from: utcDate('Optional inclusive start date').optional(),
        to: utcDate('Optional inclusive end date').optional(),
        q: z.string().trim().max(200).optional().describe('Optional substring filter.'),
        act: z.string().trim().max(200).optional().describe('Optional exact actor label filter (for example [Admin1]).'),
        wiki: z.string().trim().max(100).optional().describe('Optional exact wiki filter.'),
        limit: z.number().int().min(1).max(200).optional().describe('Number of events to return (1-200).'),
        offset: pageOffset,
      },
      annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false },
    },
    async ({ type, day, from, to, q, act, wiki, limit, offset }) =>
      call(() => api.listEvents({ type, day, from, to, q, act, wiki, limit, offset } satisfies EventListParams)),
  )

  server.registerTool(
    'search_content',
    {
      title: 'Search revision content',
      description:
        'Search revision BODY tokens only; page names are not searched (use search_archive for names). Exact mode matches whole tokens; prefix mode expands token-level prefixes (queries are limited to 200 characters and 16 usable tokens). The index is complete for the current data release; the legacy truncated flag stays false unless postings were capped. For a corpus-wide literal substring use search_corpus; for an exact substring inside one page use get_page_revisions with contains.',
      inputSchema: {
        q: nonEmptyText('Required body-token query.', 200),
        mode: z.enum(['exact', 'prefix']).optional().describe('Token matching mode; exact is the default.'),
        wiki: z.string().trim().max(100).optional().describe('Optional exact wiki filter.'),
        limit: pageLimit,
        offset: pageOffset,
      },
      annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false },
    },
    async ({ q, mode, wiki, limit, offset }) =>
      call(() => api.searchFts({ q, mode, wiki, limit, offset } satisfies SearchFtsParams)),
  )

  server.registerTool(
    'search_corpus',
    {
      title: 'Search corpus text',
      description:
        'Literal substring search across all revision bodies (case-insensitive by default). The corpus is scanned locally in the MCP process: the first search loads about 3.2 MB gzip (~41 MB decoded) and caches it for the session. Returns one row per matching revision with the exact occurrence count and a snippet. Paginate with limit/offset without rescanning; set case_sensitive for exact-case matching.',
      inputSchema: {
        q: z.string().trim().min(3).max(120).describe('Literal substring, 3-120 characters.'),
        wiki: z.string().trim().max(100).optional().describe('Optional exact wiki filter.'),
        label: z.string().trim().max(200).optional().describe('Optional exact agent label filter.'),
        from: utcDate('Optional inclusive start date').optional(),
        to: utcDate('Optional inclusive end date').optional(),
        case_sensitive: z.boolean().optional().describe('Match case exactly; default is case-insensitive.'),
        limit: z.number().int().min(1).max(100).optional().describe('Number of matches to return (1-100).'),
        offset: pageOffset,
      },
      annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false },
    },
    async ({ q, wiki, label, from, to, case_sensitive, limit, offset }) =>
      call(() =>
        research.searchCorpus({
          q,
          wiki,
          label,
          from,
          to,
          caseSensitive: case_sensitive,
          limit,
          offset,
        } satisfies SearchCorpusArgs),
      ),
  )

  server.registerTool(
    'search_artifacts',
    {
      title: 'Search indexed artifacts',
      description: 'Search flags and hosts from the payload index, with optional exact page slug, ID, and wiki filters.',
      inputSchema: {
        flag: z.string().trim().max(50).optional().describe('Optional exact payload flag filter (b64, hex, script, inject, homoglyph, high-entropy, tunnel, redirect, proxy, callback, exec, data-uri, beacon, traversal).'),
        host: z.string().trim().max(200).optional().describe('Optional case-insensitive host substring filter.'),
        slug: z.string().trim().max(200).optional().describe('Optional exact generated page slug filter.'),
        id: z.string().trim().max(300).optional().describe('Optional exact canonical page ID filter.'),
        wiki: z.string().trim().max(100).optional().describe('Optional exact wiki filter.'),
        limit: pageLimit,
        offset: pageOffset,
      },
      annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false },
    },
    async ({ flag, host, slug, id, wiki, limit, offset }) =>
      call(() => api.searchArtifacts({ flag, host, slug, id, wiki, limit, offset } satisfies SearchArtifactsParams)),
  )

  server.registerTool(
    'get_agent_links',
    {
      title: 'Get agent links',
      description: 'Without other, return { label, links } with precomputed top links. With other, return the shared-page intersection across indexed pages (up to 2,000 stored pages per agent).',
      inputSchema: {
        label: nonEmptyText('Required exact agent label.', 200),
        other: z.string().trim().min(1).max(200).optional().describe('Optional exact other agent label for the pair intersection.'),
      },
      annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false },
    },
    async ({ label, other }) => call(() => api.getAgentLinks({ label, other } satisfies AgentLinksParams)),
  )

  server.registerTool(
    'list_conflict_pages',
    {
      title: 'List pages by label churn',
      description: 'Rank all pages by distinct-label churn and filter by flags; minChurn is 0 by default, use minChurn >= 2 for shared pages only. Results are not limited to the old top-500 cutoff.',
      inputSchema: {
        minChurn: z.number().int().min(0).max(100_000).optional().describe('Minimum distinct-label churn (default 0).'),
        zzz: z.boolean().optional().describe('Only return pages whose name contains ZZZ (case-insensitive) when true.'),
        front: z.boolean().optional().describe('Only return wiki front pages (StartSeite/Willkommen) when true.'),
        limit: z.number().int().min(1).max(200).optional().describe('Number of conflict rows to return (1-200).'),
        offset: pageOffset,
      },
      annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false },
    },
    async ({ minChurn, zzz, front, limit, offset }) =>
      call(() => api.listConflicts({ minChurn, zzz, front, limit, offset } satisfies ConflictListParams)),
  )

  server.registerTool(
    'get_api_contract',
    {
      title: 'Get API contract',
      description: 'Return the raw OpenAPI 3.1 contract from the Worker API.',
      annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false },
    },
    async () => call(() => api.getApiContract()),
  )

  return server
}
