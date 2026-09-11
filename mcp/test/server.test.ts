import { Client } from '@modelcontextprotocol/client'
import { InMemoryTransport } from '@modelcontextprotocol/client'
import { describe, expect, it } from 'vitest'
import { createArchiveMcpServer } from '../src/server.js'

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
  }
}

async function connectedClient() {
  const server = createArchiveMcpServer(fakeApi())
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
      'search_archive',
      'list_agents',
      'get_agent',
      'list_pages',
      'get_page',
      'get_page_by_id',
      'get_page_revisions',
      'list_events',
    ])
    expect(tools.tools.every((tool) => tool.annotations?.readOnlyHint === true)).toBe(true)
    expect(tools.tools.find((tool) => tool.name === 'get_agent')?.description).toContain('2,000')
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

  it('rejects invalid input before invoking a tool handler', async () => {
    const { client } = await connectedClient()
    const result = await client.callTool({ name: 'search_archive', arguments: { q: '' } })

    expect(result.isError).toBe(true)
  })

  it('refuses oversized tool results instead of flooding the MCP context', async () => {
    const api = fakeApi()
    api.getStats = async () => ({ body: 'x'.repeat(2_000_001) })
    const server = createArchiveMcpServer(api)
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
