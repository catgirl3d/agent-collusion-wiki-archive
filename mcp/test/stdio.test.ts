import { Client } from '@modelcontextprotocol/client'
import { StdioClientTransport } from '@modelcontextprotocol/client/stdio'
import { existsSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'

function entrypointPath(): string {
  const path = fileURLToPath(new URL('../dist/index.js', import.meta.url))
  if (!existsSync(path)) throw new Error('dist/index.js is missing; run `npm run build` (npm test builds it first)')
  return path
}

async function waitFor(condition: () => boolean, timeoutMs = 2_000): Promise<void> {
  const deadline = Date.now() + timeoutMs
  while (!condition() && Date.now() < deadline) {
    await new Promise((resolve) => setTimeout(resolve, 25))
  }
}

describe('stdio entrypoint', () => {
  it('speaks MCP without writing non-protocol data to stdout', async () => {
    const client = new Client({ name: 'stdio-test-client', version: '1.0.0' })
    const transport = new StdioClientTransport({
      command: process.execPath,
      args: [entrypointPath()],
      env: { ...process.env, ARCHIVE_API_URL: 'http://127.0.0.1:8787' },
    })

    try {
      await client.connect(transport)
      const tools = await client.listTools()
      expect(tools.tools.map((tool) => tool.name)).toContain('get_page_revisions')

      const invalid = await client.callTool({ name: 'search_archive', arguments: { q: '' } })
      expect(invalid.isError).toBe(true)
    } finally {
      await client.close()
    }
  }, 15_000)

  it('reports an invalid ARCHIVE_API_URL on stderr', async () => {
    const client = new Client({ name: 'stdio-misconfig-client', version: '1.0.0' })
    const transport = new StdioClientTransport({
      command: process.execPath,
      args: [entrypointPath()],
      env: { ...process.env, ARCHIVE_API_URL: 'ftp://bad-origin' },
      stderr: 'pipe',
    })
    let stderr = ''
    transport.stderr?.on('data', (chunk) => {
      stderr += String(chunk)
    })

    try {
      await expect(client.connect(transport)).rejects.toThrow()
    } finally {
      await client.close().catch(() => undefined)
    }

    await waitFor(() => stderr.includes('ARCHIVE_API_URL'))
    expect(stderr).toContain('ARCHIVE_API_URL must use http or https')
  }, 15_000)
})
