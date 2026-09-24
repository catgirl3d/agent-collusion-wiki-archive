import { readFileSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { Client, InMemoryTransport } from '@modelcontextprotocol/client'
import { describe, expect, it } from 'vitest'
import type { ArchiveApi } from '../src/api.js'
import type { ResearchApi } from '../src/research.js'
import { createArchiveMcpServer } from '../src/server.js'
import { MCP_TOOL_PRESENTATION } from '../../web/src/data/mcpToolPresentation.js'

const repositoryRoot = resolve(dirname(fileURLToPath(import.meta.url)), '../..')
const catalog = JSON.parse(
  readFileSync(join(repositoryRoot, 'web/src/data/mcp-tool-catalog.generated.json'), 'utf8'),
) as { tools: Array<{ name: string }> }

describe('MCP tool presentation examples', () => {
  it('accepts every generated tool example through MCP input validation', async () => {
    const calls: Array<{ tool: string; args: unknown[] }> = []
    const recordCall = (tool: string, ...args: unknown[]) => {
      calls.push({ tool, args })
      return Promise.resolve({ ok: true })
    }
    const api: ArchiveApi = {
      getStats: () => recordCall('get_stats'),
      searchArchive: (query, limit) => recordCall('search_archive', query, limit),
      listAgents: (params) => recordCall('list_agents', params),
      getAgent: (name) => recordCall('get_agent', name),
      listPages: (params) => recordCall('list_pages', params),
      getPage: (slug) => recordCall('get_page', slug),
      getPageById: (id) => recordCall('get_page_by_id', id),
      getPageRevisions: (slug, params) => recordCall('get_page_revisions', slug, params),
      listEvents: (params) => recordCall('list_events', params),
      searchFts: (params) => recordCall('search_content', params),
      searchArtifacts: (params) => recordCall('search_artifacts', params),
      getAgentLinks: (params) => recordCall('get_agent_links', params),
      listConflicts: (params) => recordCall('list_conflict_pages', params),
      getApiContract: () => recordCall('get_api_contract'),
    }
    const research: ResearchApi = {
      listRevisions: (args) => recordCall('list_revisions', args),
      searchCorpus: (args) => recordCall('search_corpus', args),
      getActivity: (args) => recordCall('get_activity', args),
    }
    const server = createArchiveMcpServer(api, research)
    const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair()
    const client = new Client({ name: 'tool-examples-test-client', version: '1.0.0' })

    await server.connect(serverTransport)
    await client.connect(clientTransport)

    try {
      for (const { name } of catalog.tools) {
        expect(Object.hasOwn(MCP_TOOL_PRESENTATION, name), `missing presentation for ${name}`).toBe(true)

        const result = await client.callTool({
          name,
          arguments: MCP_TOOL_PRESENTATION[name].exampleArguments,
        })

        expect(result.isError, `example arguments rejected for ${name}`).not.toBe(true)
      }

      expect(calls.map(({ tool }) => tool).sort()).toEqual(catalog.tools.map(({ name }) => name).sort())
      expect(calls.find(({ tool }) => tool === 'get_agent')?.args).toEqual(['MapHelper'])
    } finally {
      await client.close()
      await server.close()
    }
  })
})
