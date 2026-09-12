import { Client } from '@modelcontextprotocol/client'
import { InMemoryTransport } from '@modelcontextprotocol/client'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { ArchiveApiError } from '../src/api.js'
import { ArchiveDataError } from '../src/assets.js'
import { ArchiveQueryError } from '../src/research.js'
import { createArchiveMcpServer, installShutdownHandlers } from '../src/server.js'

afterEach(() => {
  vi.restoreAllMocks()
})

function fakeApi() {
  return {
    getStats: async () => ({ counts: { pages: 1 } }),
    searchArchive: async (q: string, limit?: number) => ({ q, limit }),
    listAgents: async (params: unknown) => ({ params }),
    getAgent: async (name: string) => ({ name }),
    listPages: async (params: unknown) => ({ params }),
    getPage: async (slug: string) => ({ slug }),
    getPageById: async (id: string) => ({ id }),
    getPageRevisions: async (slug: string, params: unknown) => ({ slug, params }),
    listEvents: async (params: unknown) => ({ params }),
    searchFts: async (params: unknown) => ({ params }),
    searchArtifacts: async (params: unknown) => ({ params }),
    getAgentLinks: async (params: unknown) => ({ params }),
    listConflicts: async (params: unknown) => ({ params }),
    getApiContract: async () => ({ openapi: '3.0.0' }),
  }
}

function fakeResearch() {
  return {
    listRevisions: async (args: unknown) => ({ args }),
    searchCorpus: async (args: unknown) => ({ args }),
    getActivity: async (args: unknown) => ({ args }),
  }
}

async function connectedClient() {
  const server = createArchiveMcpServer(fakeApi(), fakeResearch())
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair()
  await server.connect(serverTransport)
  const client = new Client({ name: 'test-client', version: '1.0.0' })
  await client.connect(clientTransport)
  return { client, server }
}

describe('archive MCP server', () => {
  it('registers all read-only archive tools', async () => {
    const { client } = await connectedClient()
    const tools = await client.listTools()

    expect(tools.tools.map((tool) => tool.name)).toEqual([
      'get_stats',
      'get_activity',
      'search_archive',
      'list_agents',
      'get_agent',
      'list_pages',
      'get_page',
      'get_page_by_id',
      'get_page_revisions',
      'list_revisions',
      'list_events',
      'search_content',
      'search_corpus',
      'search_artifacts',
      'get_agent_links',
      'list_conflict_pages',
      'get_api_contract',
    ])
    expect(tools.tools.every((tool) => tool.annotations?.readOnlyHint === true)).toBe(true)
    expect(tools.tools.find((tool) => tool.name === 'get_agent')?.description).toContain('2,000')
    expect(tools.tools.find((tool) => tool.name === 'get_page')?.description).toBe('Return metadata for one generated page slug.')
    expect(tools.tools.find((tool) => tool.name === 'search_content')?.description).toContain('truncated')
    expect(tools.tools.find((tool) => tool.name === 'search_corpus')?.description).toContain('case-insensitive')
    expect(tools.tools.find((tool) => tool.name === 'list_revisions')?.description).toContain('Cross-page revision timeline')
    expect(tools.tools.find((tool) => tool.name === 'list_conflict_pages')?.description).toContain('full conflict list')

    const listEventsSchema = tools.tools.find((tool) => tool.name === 'list_events')?.inputSchema
    expect((listEventsSchema as { properties?: { type?: { enum?: string[] } } })?.properties?.type?.enum).toEqual([
      'save',
      'delete',
      'revert',
      'probe',
    ])
  })

  it('calls the API through a tool and serializes the result as JSON text', async () => {
    const { client } = await connectedClient()
    const result = await client.callTool({ name: 'get_page_revisions', arguments: { slug: 'Page', include_body: true } })

    expect(result.isError).not.toBe(true)
    expect(JSON.parse(String(result.content[0].text))).toEqual({
      slug: 'Page',
      params: { label: undefined, withBody: true, limit: undefined, offset: undefined },
    })

    const page = await client.callTool({ name: 'get_page_by_id', arguments: { id: 'wiki/Page' } })
    expect(JSON.parse(String(page.content[0].text))).toEqual({ id: 'wiki/Page' })
  })

  it('maps discovery tool arguments to the API', async () => {
    const { client } = await connectedClient()
    const calls = [
      ['search_content', { q: 'serveo', mode: 'prefix', wiki: 'wiki', limit: 10, offset: 2 }],
      ['search_artifacts', { flag: 'tunnel', host: 'pinggy', slug: 'Page', id: 'wiki/Page', wiki: 'wiki', limit: 10, offset: 2 }],
      ['get_agent_links', { label: 'A', other: 'B' }],
      ['list_conflict_pages', { minChurn: 1, zzz: true, front: false, limit: 10, offset: 2 }],
      ['get_api_contract', undefined],
    ] as const

    for (const [name, args] of calls) {
      const result = await client.callTool({ name, arguments: args })
      expect(result.isError).not.toBe(true)
    }

    expect(JSON.parse(String((await client.callTool({ name: 'search_content', arguments: { q: 'x' } })).content[0].text))).toEqual({
      params: { q: 'x', mode: undefined, wiki: undefined, limit: undefined, offset: undefined },
    })
    expect(JSON.parse(String((await client.callTool({ name: 'search_artifacts', arguments: calls[1][1] })).content[0].text))).toEqual({
      params: { flag: 'tunnel', host: 'pinggy', slug: 'Page', id: 'wiki/Page', wiki: 'wiki', limit: 10, offset: 2 },
    })
    expect(JSON.parse(String((await client.callTool({ name: 'get_agent_links', arguments: calls[2][1] })).content[0].text))).toEqual({
      params: { label: 'A', other: 'B' },
    })
    expect(JSON.parse(String((await client.callTool({ name: 'list_conflict_pages', arguments: calls[3][1] })).content[0].text))).toEqual({
      params: { minChurn: 1, zzz: true, front: false, limit: 10, offset: 2 },
    })
    expect(JSON.parse(String((await client.callTool({ name: 'get_api_contract', arguments: calls[4][1] })).content[0].text))).toEqual({
      openapi: '3.0.0',
    })
    expect(JSON.parse(String((await client.callTool({ name: 'get_page_revisions', arguments: { slug: 'Page', contains: 'needle' } })).content[0].text))).toEqual({
      slug: 'Page',
      params: { label: undefined, contains: 'needle', seq: undefined, withBody: false, limit: undefined, offset: undefined },
    })
  })

  it('maps local research tool arguments', async () => {
    const { client } = await connectedClient()

    const revisions = await client.callTool({
      name: 'list_revisions',
      arguments: { label: 'MapHelper', from: '2026-06-18', to: '2026-06-22', order: 'asc', limit: 5 },
    })
    expect(revisions.isError).not.toBe(true)
    expect(JSON.parse(String(revisions.content[0].text))).toEqual({
      args: { label: 'MapHelper', wiki: undefined, id: undefined, slug: undefined, day: undefined, from: '2026-06-18', to: '2026-06-22', order: 'asc', limit: 5, offset: undefined },
    })

    const corpus = await client.callTool({ name: 'search_corpus', arguments: { q: 'STATE5-ID', case_sensitive: true } })
    expect(corpus.isError).not.toBe(true)
    expect(JSON.parse(String(corpus.content[0].text))).toEqual({
      args: { q: 'STATE5-ID', wiki: undefined, label: undefined, from: undefined, to: undefined, caseSensitive: true, limit: undefined, offset: undefined },
    })

    const activity = await client.callTool({ name: 'get_activity', arguments: { by: 'day', wiki: 'dse' } })
    expect(activity.isError).not.toBe(true)
    expect(JSON.parse(String(activity.content[0].text))).toEqual({ args: { by: 'day', wiki: 'dse', from: undefined, to: undefined } })
  })

  it('forwards sanitized API, data, and query error codes from tool handlers', async () => {
    const cases = [
      {
        research: {
          listRevisions: async () => {
            throw new ArchiveApiError('no usable query tokens (stop words or shorter than 3 characters)', 400, 'no_usable_tokens')
          },
          searchCorpus: async () => ({}),
          getActivity: async () => ({}),
        },
        tool: 'list_revisions' as const,
        args: {},
        expected: { error: 'no usable query tokens (stop words or shorter than 3 characters)', code: 'no_usable_tokens' },
      },
      {
        research: {
          listRevisions: async () => ({}),
          searchCorpus: async () => {
            throw new ArchiveDataError('archive_data_invalid', 'corpus row 2 is malformed')
          },
          getActivity: async () => ({}),
        },
        tool: 'search_corpus' as const,
        args: { q: 'abc' },
        expected: { error: 'corpus row 2 is malformed', code: 'archive_data_invalid' },
      },
      {
        research: {
          listRevisions: async () => {
            throw new ArchiveQueryError('from must not be after to')
          },
          searchCorpus: async () => ({}),
          getActivity: async () => ({}),
        },
        tool: 'list_revisions' as const,
        args: { from: '2026-06-22', to: '2026-06-18' },
        expected: { error: 'from must not be after to', code: 'invalid_param' },
      },
    ]

    for (const testCase of cases) {
      const server = createArchiveMcpServer(fakeApi(), testCase.research)
      const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair()
      await server.connect(serverTransport)
      const client = new Client({ name: 'error-code-test-client', version: '1.0.0' })
      await client.connect(clientTransport)

      const result = await client.callTool({ name: testCase.tool, arguments: testCase.args })
      expect(result.isError).toBe(true)
      expect(JSON.parse(String(result.content[0].text))).toEqual(testCase.expected)
    }
  })

  it('returns safe MCP errors when the API throws', async () => {
    const api = fakeApi()
    api.searchFts = async () => {
      throw new Error('private details')
    }
    const server = createArchiveMcpServer(api, fakeResearch())
    const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair()
    await server.connect(serverTransport)
    const client = new Client({ name: 'error-test-client', version: '1.0.0' })
    await client.connect(clientTransport)

    const result = await client.callTool({ name: 'search_content', arguments: { q: 'x' } })
    expect(result.isError).toBe(true)
    expect(JSON.parse(String(result.content[0].text))).toEqual({ error: 'MCP request failed' })
  })

  it('rejects unknown event types before invoking the API', async () => {
    const api = fakeApi()
    const listEvents = vi.fn(async (params: unknown) => ({ params }))
    api.listEvents = listEvents
    const server = createArchiveMcpServer(api, fakeResearch())
    const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair()
    await server.connect(serverTransport)
    const client = new Client({ name: 'event-type-test-client', version: '1.0.0' })
    await client.connect(clientTransport)

    const invalid = await client.callTool({ name: 'list_events', arguments: { type: 'edit' } })
    expect(invalid.isError).toBe(true)
    expect(listEvents).not.toHaveBeenCalled()

    const valid = await client.callTool({ name: 'list_events', arguments: { type: 'save' } })
    expect(valid.isError).not.toBe(true)
    expect(listEvents).toHaveBeenCalledWith({
      type: 'save',
      day: undefined,
      from: undefined,
      to: undefined,
      q: undefined,
      act: undefined,
      wiki: undefined,
      limit: undefined,
      offset: undefined,
    })
  })

  it('rejects invalid input before invoking a tool handler', async () => {
    const { client } = await connectedClient()
    const result = await client.callTool({ name: 'search_archive', arguments: { q: '' } })

    expect(result.isError).toBe(true)
  })

  it('closes the stdio server and exits 0 on SIGINT or SIGTERM', async () => {
    const listeners = new Map<string, Array<() => void>>()
    const target = {
      on(signal: string, listener: () => void) {
        listeners.set(signal, [...(listeners.get(signal) ?? []), listener])
      },
      exit: vi.fn(),
    }
    const close = vi.fn().mockResolvedValue(undefined)

    installShutdownHandlers({ close }, target)
    expect([...listeners.keys()].sort()).toEqual(['SIGINT', 'SIGTERM'])

    for (const listener of listeners.get('SIGTERM') ?? []) listener()
    await vi.waitFor(() => expect(target.exit).toHaveBeenCalledWith(0))
    expect(close).toHaveBeenCalledTimes(1)

    for (const listener of listeners.get('SIGINT') ?? []) listener()
    expect(close).toHaveBeenCalledTimes(1)
  })

  it('exits 1 when the shutdown close fails', async () => {
    const listeners = new Map<string, Array<() => void>>()
    const target = {
      on(signal: string, listener: () => void) {
        listeners.set(signal, [...(listeners.get(signal) ?? []), listener])
      },
      exit: vi.fn(),
    }
    const close = vi.fn().mockRejectedValue(new Error('close failed'))
    const error = vi.spyOn(console, 'error').mockImplementation(() => undefined)

    installShutdownHandlers({ close }, target)
    for (const listener of listeners.get('SIGINT') ?? []) listener()
    await vi.waitFor(() => expect(target.exit).toHaveBeenCalledWith(1))
    expect(error).toHaveBeenCalledWith('close failed')
  })

  it('refuses oversized tool results instead of flooding the MCP context', async () => {
    const api = fakeApi()
    api.getStats = async () => ({ body: 'x'.repeat(2_000_001) })
    const server = createArchiveMcpServer(api, fakeResearch())
    const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair()
    await server.connect(serverTransport)
    const client = new Client({ name: 'size-test-client', version: '1.0.0' })
    await client.connect(clientTransport)

    const result = await client.callTool({ name: 'get_stats' })
    expect(result.isError).toBe(true)
    expect(JSON.parse(String(result.content[0].text))).toEqual({
      error: 'MCP result is too large; reduce limit or omit revision bodies',
    })
  })
})
