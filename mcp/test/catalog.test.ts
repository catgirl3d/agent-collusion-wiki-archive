import { mkdtemp, mkdir, readFile, rm, stat, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { Client, InMemoryTransport } from '@modelcontextprotocol/client'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { createArchiveMcpServer } from '../src/server.js'
import { syncCatalog } from '../scripts/sync-catalog.js'

const repositoryRoot = resolve(dirname(fileURLToPath(import.meta.url)), '../..')
const generatedFiles = [
  'mcp/package.json',
  'mcp/README.md',
  'web/public/llms.txt',
  'web/index.html',
  'web/src/data/mcp-tool-catalog.generated.json',
]
const temporaryRoots: string[] = []

afterEach(async () => {
  await Promise.all(temporaryRoots.splice(0).map((root) => rm(root, { recursive: true, force: true })))
})

async function listServerTools() {
  const server = createArchiveMcpServer()
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair()
  const client = new Client({ name: 'catalog-test-client', version: '1.0.0' })

  try {
    await server.connect(serverTransport)
    await client.connect(clientTransport)
    return (await client.listTools()).tools
  } finally {
    await client.close()
    await server.close()
  }
}

async function createTemporaryWorkspace() {
  const root = await mkdtemp(join(tmpdir(), 'archive-mcp-catalog-'))
  temporaryRoots.push(root)
  const readme = (await readFile(join(repositoryRoot, 'mcp/README.md'), 'utf8')).replace(/\r\n/g, '\n')

  const fixtureFiles: Record<string, string> = {
    'mcp/package.json': JSON.stringify({ name: '@example/archive-mcp', version: '0.0.0' }, null, 2) + '\n',
    'mcp/README.md': `${readme.replaceAll('@catgirl3d/agent-collusion-archive-mcp', '@old/archive-mcp')}\nKeep this paragraph.\n`,
    'web/public/llms.txt': [
      '# MCP fixture',
      '- **Package**: `@old/archive-mcp`',
      '- **Launch Command**: `npx --yes @old/archive-mcp@latest`',
      '- **Features**: 5 dedicated research tools with unchanged details.',
      'Keep this paragraph.',
      '',
    ].join('\n'),
    'web/index.html': '<li><strong>MCP Adapter:</strong> <code>npx --yes @old/archive-mcp@latest</code></li>\n<p>Keep this paragraph.</p>\n',
    'web/src/data/mcp-tool-catalog.generated.json': '{"stale":true}\n',
  }

  await Promise.all(
    Object.entries(fixtureFiles).map(async ([path, contents]) => {
      const target = join(root, path)
      await mkdir(dirname(target), { recursive: true })
      await writeFile(target, contents)
    }),
  )

  return root
}

async function snapshotGeneratedFiles(root: string) {
  return Promise.all(
    generatedFiles.map(async (path) => {
      const target = join(root, path)
      const [contents, metadata] = await Promise.all([readFile(target, 'utf8'), stat(target, { bigint: true })])
      return { contents, modifiedAt: metadata.mtimeNs }
    }),
  )
}

describe('MCP tool catalog synchronization', () => {
  it('lists server tools without making HTTP requests', async () => {
    const fetch = vi.fn()
    vi.stubGlobal('fetch', fetch)

    try {
      await syncCatalog('check', repositoryRoot)
      expect(fetch).not.toHaveBeenCalled()
    } finally {
      vi.unstubAllGlobals()
    }
  })

  it('matches the actual tools/list catalog, including order and schema shape', async () => {
    const catalog = JSON.parse(
      await readFile(join(repositoryRoot, 'web/src/data/mcp-tool-catalog.generated.json'), 'utf8'),
    ) as {
      packageName: string
      packageVersion: string
      tools: Record<string, unknown>[]
    }
    const packageJson = JSON.parse(await readFile(join(repositoryRoot, 'mcp/package.json'), 'utf8')) as {
      name: string
      version: string
    }
    const listedTools = await listServerTools()
    const expectedTools = listedTools.map(({ name, title, description, inputSchema }) => ({
      name,
      ...(title === undefined ? {} : { title }),
      ...(description === undefined ? {} : { description }),
      inputSchema,
    }))

    expect(catalog.packageName).toBe(packageJson.name)
    expect(catalog.packageVersion).toBe(packageJson.version)
    expect(catalog.tools).toEqual(expectedTools)
    expect(catalog.tools.every((tool) => !('annotations' in tool))).toBe(true)
  })

  it('writes package-derived docs and a fresh catalog without changing unrelated text', async () => {
    const root = await createTemporaryWorkspace()

    await syncCatalog('write', root)

    const catalog = JSON.parse(await readFile(join(root, generatedFiles[4]), 'utf8')) as {
      packageName: string
      packageVersion: string
      tools: { name: string }[]
    }
    const readme = await readFile(join(root, generatedFiles[1]), 'utf8')
    const llms = await readFile(join(root, generatedFiles[2]), 'utf8')
    const index = await readFile(join(root, generatedFiles[3]), 'utf8')

    expect(catalog.packageName).toBe('@example/archive-mcp')
    expect(catalog.packageVersion).toBe('0.0.0')
    expect(catalog.tools[0]?.name).toBe('get_stats')
    expect(readme).toContain('`@example/archive-mcp`')
    expect(readme).toContain('npx --yes @example/archive-mcp@latest\n```')
    expect(readme).toContain('Keep this paragraph.')
    expect(llms).toContain('- **Launch Command**: `npx --yes @example/archive-mcp@latest`')
    expect(llms).toContain(`- **Features**: ${String(catalog.tools.length)} dedicated research tools`)
    expect(llms).toContain('Keep this paragraph.')
    expect(index).toContain('<code>npx --yes @example/archive-mcp@latest</code>')
    expect(index).toContain('<p>Keep this paragraph.</p>')

    const beforeCheck = await snapshotGeneratedFiles(root)
    await syncCatalog('check', root)
    expect(await snapshotGeneratedFiles(root)).toEqual(beforeCheck)
  })

  it('preserves unrelated scoped packages and similarly named packages in synchronized documents', async () => {
    const root = await createTemporaryWorkspace()
    const documents = ['mcp/README.md', 'web/public/llms.txt', 'web/index.html']

    for (const path of documents) {
      const target = join(root, path)
      await writeFile(target, `${await readFile(target, 'utf8')}\nUnrelated packages: @vendor/other-mcp, @old/archive-mcp-tools.\n`)
    }

    await syncCatalog('write', root)

    for (const path of documents) {
      expect(await readFile(join(root, path), 'utf8')).toContain(
        'Unrelated packages: @vendor/other-mcp, @old/archive-mcp-tools.',
      )
    }
    await syncCatalog('check', root)
  })

  it('reports stale outputs in check mode without modifying any file', async () => {
    const root = await createTemporaryWorkspace()
    await syncCatalog('write', root)

    const llmsPath = join(root, generatedFiles[2])
    const llms = await readFile(llmsPath, 'utf8')
    await writeFile(llmsPath, llms.replace(/(^- \*\*Features\*\*:\s*)\d+/m, (_match, prefix: string) => `${prefix}0`))
    await writeFile(join(root, generatedFiles[4]), '{"stale":true}\n')
    const beforeCheck = await snapshotGeneratedFiles(root)

    await expect(syncCatalog('check', root)).rejects.toThrow(/stale/i)
    expect(await snapshotGeneratedFiles(root)).toEqual(beforeCheck)
  })

  it('accepts generated artifacts checked out with CRLF line endings', async () => {
    const root = await createTemporaryWorkspace()
    await syncCatalog('write', root)

    for (const path of generatedFiles) {
      const target = join(root, path)
      const contents = await readFile(target, 'utf8')
      await writeFile(target, contents.replace(/\r?\n/g, '\r\n'))
    }

    await expect(syncCatalog('check', root)).resolves.toBeUndefined()
  })

  it('rejects a missing or unknown README tool without modifying checked files', async () => {
    const root = await createTemporaryWorkspace()
    await syncCatalog('write', root)
    const path = join(root, 'mcp/README.md')
    const original = await readFile(path, 'utf8')

    for (const [replacement, diagnostic] of [
      ['', /missing.*get_stats/i],
      ['- `not_an_archive_tool` returns unrelated data.\n', /unexpected.*not_an_archive_tool/i],
    ] as const) {
      await writeFile(path, original.replace(/^- `get_stats`[^\r\n]*\r?\n/m, replacement))
      const before = await snapshotGeneratedFiles(root)
      await expect(syncCatalog('check', root)).rejects.toThrow(diagnostic)
      expect(await snapshotGeneratedFiles(root)).toEqual(before)
    }
  })

  it('checks every README launch example independently without changing the documents', async () => {
    const root = await createTemporaryWorkspace()
    await syncCatalog('write', root)
    const path = join(root, 'mcp/README.md')
    const original = await readFile(path, 'utf8')

    const cases: [string, string, RegExp][] = [
      ['npx --yes @example/archive-mcp@latest\n```', 'npx --no @example/archive-mcp@latest\n```', /Public beta.*command/i],
      ['"cmd",\n        "/c",\n        "npx",\n        "--yes",', '"cmd",\n        "/c",\n        "npx",\n        "--no",', /Kilo Code.*command/i],
      ['"args": ["--yes", "@example/archive-mcp@latest"]', '"args": ["--no", "@example/archive-mcp@latest"]', /Claude Desktop.*args/i],
      ['"args": ["/c", "npx", "--yes", "@example/archive-mcp@latest"]', '"args": ["/c", "npx", "--no", "@example/archive-mcp@latest"]', /Windows fallback.*args/i],
    ]

    for (const [correct, broken, diagnostic] of cases) {
      expect(original).toContain(correct)
      await writeFile(path, original.replace(correct, broken))
      const before = await snapshotGeneratedFiles(root)
      await expect(syncCatalog('check', root)).rejects.toThrow(diagnostic)
      expect(await snapshotGeneratedFiles(root)).toEqual(before)
    }
  })
})
