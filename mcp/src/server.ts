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
import { ArchiveApiClient, ArchiveApiError } from './api.js'

const nonEmptyText = (label: string, max = 200) => z.string().trim().min(1).max(max).describe(label)
const pageLimit = z.number().int().min(1).max(100).optional().describe('Number of rows to return (1-100).')
const pageOffset = z.number().int().min(0).max(100_000).optional().describe('Number of rows to skip.')
const MAX_TOOL_RESULT_BYTES = 2_000_000

function failure(error: unknown) {
  const message = error instanceof ArchiveApiError ? error.message : 'MCP request failed'
  return { content: [{ type: 'text' as const, text: JSON.stringify({ error: message }) }], isError: true }
}

function result(data: unknown) {
  const text = JSON.stringify(data)
  if (Buffer.byteLength(text, 'utf8') > MAX_TOOL_RESULT_BYTES) {
    return failure(new ArchiveApiError('MCP result is too large; reduce limit or omit revision bodies'))
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

export function createArchiveMcpServer(api: ArchiveApi = new ArchiveApiClient()): McpServer {
  const server = new McpServer({ name: 'agent-collusion-archive', version: '0.1.0' })

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
      description: 'Return metadata for one generated page slug. Use the s field from this result for revision queries.',
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
      description: 'Return paginated revisions for one generated page slug (the s field from a page lookup). Bodies are omitted unless include_body is true.',
      inputSchema: {
        slug: nonEmptyText('Exact generated page slug.'),
        label: z.string().trim().max(200).optional().describe('Optional exact agent label filter.'),
        contains: z.string().trim().max(200).optional().describe('Optional case-insensitive raw substring filter; snippets are returned without bodies.'),
        include_body: z.boolean().optional().describe('Include saved revision text. Defaults to false.'),
        limit: z.number().int().min(1).max(500).optional().describe('Number of revisions to return (1-500).'),
        offset: pageOffset,
      },
      annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false },
    },
    async ({ slug, label, contains, include_body, limit, offset }) =>
      call(() =>
        api.getPageRevisions(slug, {
          label,
          contains,
          withBody: include_body ?? false,
          limit,
          offset,
        } satisfies RevisionListParams),
      ),
  )

  server.registerTool(
    'list_events',
    {
      title: 'List events',
      description: 'Filter and paginate recorded archive events.',
      inputSchema: {
        type: z.enum(['save', 'delete', 'revert', 'probe']).optional().describe('Event type filter (save, delete, revert, or probe).'),
        day: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional().describe('UTC day in YYYY-MM-DD format.'),
        q: z.string().trim().max(200).optional().describe('Optional substring filter.'),
        act: z.string().trim().max(200).optional().describe('Optional exact event action filter.'),
        wiki: z.string().trim().max(100).optional().describe('Optional exact wiki filter.'),
        limit: z.number().int().min(1).max(200).optional().describe('Number of events to return (1-200).'),
        offset: pageOffset,
      },
      annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false },
    },
    async ({ type, day, q, act, wiki, limit, offset }) =>
      call(() => api.listEvents({ type, day, q, act, wiki, limit, offset } satisfies EventListParams)),
  )

  server.registerTool(
    'search_content',
    {
      title: 'Search revision content',
      description:
        'Search revision BODY tokens only; page names are not searched (use search_archive for names). Exact mode matches whole tokens; prefix mode expands token-level prefixes (queries are limited to 200 characters and 16 usable tokens). Postings are adaptively capped, so truncated=true means results may be incomplete. Results are sorted by revision count descending. For an exact substring inside one page, use get_page_revisions with contains.',
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
    'search_artifacts',
    {
      title: 'Search indexed artifacts',
      description: 'Search flags and hosts from the payload index, with optional exact page slug, ID, and wiki filters.',
      inputSchema: {
        flag: z.string().trim().max(50).optional().describe('Optional exact payload flag filter (b64, hex, script, inject, homoglyph, high-entropy, tunnel, redirect).'),
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
        other: z.string().trim().max(200).optional().describe('Optional exact other agent label for the pair intersection.'),
      },
      annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false },
    },
    async ({ label, other }) => call(() => api.getAgentLinks({ label, other } satisfies AgentLinksParams)),
  )

  server.registerTool(
    'list_conflict_pages',
    {
      title: 'List conflict pages',
      description: 'Filter the full conflict list; results are not limited to the old top-500 cutoff.',
      inputSchema: {
        minChurn: z.number().int().min(0).max(100_000).optional().describe('Minimum distinct-label churn (default 0).'),
        zzz: z.boolean().optional().describe('Only return pages whose name starts with ZZZ when true.'),
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
      description: 'Return the raw Worker OpenAPI-style API contract document.',
      annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false },
    },
    async () => call(() => api.getApiContract()),
  )

  return server
}
