import { McpServer } from '@modelcontextprotocol/server'
import { z } from 'zod'
import type {
  AgentListParams,
  ArchiveApi,
  EventListParams,
  PageListParams,
  RevisionListParams,
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
        limit: pageLimit,
        offset: pageOffset,
      },
      annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false },
    },
    async ({ q, limit, offset }) => call(() => api.listAgents({ q, limit, offset } satisfies AgentListParams)),
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
        wiki: z.string().trim().max(100).optional(),
        fam: z.string().trim().max(200).optional().describe('Optional page family.'),
        deleted: z.boolean().optional().describe('Only return deleted pages when true.'),
        minRevs: z.number().int().min(0).max(100_000).optional(),
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
        include_body: z.boolean().optional().describe('Include saved revision text. Defaults to false.'),
        limit: z.number().int().min(1).max(500).optional().describe('Number of revisions to return (1-500).'),
        offset: pageOffset,
      },
      annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false },
    },
    async ({ slug, label, include_body, limit, offset }) =>
      call(() =>
        api.getPageRevisions(slug, {
          label,
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
        type: z.string().trim().max(50).optional(),
        day: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional().describe('UTC day in YYYY-MM-DD format.'),
        q: z.string().trim().max(200).optional().describe('Optional substring filter.'),
        limit: z.number().int().min(1).max(200).optional(),
        offset: pageOffset,
      },
      annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false },
    },
    async ({ type, day, q, limit, offset }) =>
      call(() => api.listEvents({ type, day, q, limit, offset } satisfies EventListParams)),
  )

  return server
}
