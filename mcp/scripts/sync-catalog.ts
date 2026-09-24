import { mkdir, readFile, writeFile } from 'node:fs/promises'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { Client, InMemoryTransport } from '@modelcontextprotocol/client'
import { createArchiveMcpServer } from '../src/server.js'

type SyncMode = 'write' | 'check'

const repositoryRoot = resolve(dirname(fileURLToPath(import.meta.url)), '../..')
const catalogPath = 'web/src/data/mcp-tool-catalog.generated.json'
const packagePath = 'mcp/package.json'
const readmePath = 'mcp/README.md'
const llmsPath = 'web/public/llms.txt'
const indexPath = 'web/index.html'

function normalizeLineEndings(text: string): string {
  return text.replace(/\r\n/g, '\n')
}

function replacePackageNames(text: string, packageName: string, path: string): string {
  const ownPackagePattern = path === readmePath
    ? /^`(@[a-z\d._-]+\/[a-z\d._-]+)` is a read-only MCP adapter/m
    : path === llmsPath
      ? /^- \*\*Package\*\*: `(@[a-z\d._-]+\/[a-z\d._-]+)`/m
      : /<strong>MCP Adapter:<\/strong> <code>npx --yes (@[a-z\d._-]+\/[a-z\d._-]+)@latest<\/code>/
  const previousPackageName = text.match(ownPackagePattern)?.[1]
  if (!previousPackageName) throw new Error(`${path} has no MCP package reference to synchronize`)

  return text.replace(/@[a-z\d._-]+\/[a-z\d._-]+/gi, (name) =>
    name === previousPackageName ? packageName : name
  )
}

function replaceExactlyOnce(
  text: string,
  pattern: RegExp,
  replacement: (match: string, ...groups: string[]) => string,
  label: string,
) {
  let replacements = 0
  const updated = text.replace(pattern, (...matches: string[]) => {
    replacements += 1
    return replacement(matches[1]!, ...matches.slice(2, -2))
  })

  if (replacements !== 1) throw new Error(`Expected one ${label} in the source document, found ${replacements}`)
  return updated
}

function requireLaunchCommand(text: string, packageName: string, path: string): string {
  if (!text.includes(`npx --yes ${packageName}@latest`)) {
    throw new Error(`${path} is missing the package launch command`)
  }
  return text
}

function readSection(text: string, heading: string, level: number, stopLevel = level): string {
  const lines = text.replace(/\r\n/g, '\n').split('\n')
  const matches = lines.flatMap((line, index) => line.trim() === `${'#'.repeat(level)} ${heading}` ? [index] : [])
  if (matches.length !== 1) throw new Error(`${readmePath}: expected one ${heading} section, found ${matches.length}`)

  const start = matches[0]! + 1
  const end = lines.findIndex((line, index) => index >= start && new RegExp(`^#{1,${stopLevel}} `).test(line))
  return lines.slice(start, end === -1 ? undefined : end).join('\n')
}

function readExample(section: string, language: 'bash' | 'json' | 'jsonc', marker: string, label: string, startsWith = false): string {
  const blocks = [...section.matchAll(/^```(bash|jsonc|json)\s*\n([\s\S]*?)^```\s*$/gm)]
    .filter((match) => match[1] === language && (startsWith ? match[2]!.trimStart().startsWith(marker) : match[2]!.includes(marker)))
  if (blocks.length !== 1) throw new Error(`${readmePath}: expected one ${label} example, found ${blocks.length}`)
  return blocks[0]![2]!.trim()
}

function checkExample(label: string, actual: unknown, expected: unknown): void {
  if (JSON.stringify(actual) !== JSON.stringify(expected)) {
    throw new Error(`${readmePath}: ${label} must be ${JSON.stringify(expected)}; update this example manually`)
  }
}

function validateReadme(text: string, packageName: string, tools: Array<{ name: string }>): string {
  const toolLines = readSection(text, 'Tools', 2, 3).split('\n')
  const names: string[] = []
  for (const line of toolLines) {
    const entry = line.match(/^- `([^`]+)`(?:\s|$)/)
    if (entry) names.push(entry[1]!)
    else if (line.startsWith('- `')) throw new Error(`${readmePath}: malformed Tools entry: ${line}`)
  }
  const expectedNames = new Set(tools.map(({ name }) => name))
  const seen = new Set<string>()
  const duplicates: string[] = []
  for (const name of names) {
    if (seen.has(name)) duplicates.push(name)
    seen.add(name)
  }
  const missing = [...expectedNames].filter((name) => !seen.has(name))
  const unexpected = names.filter((name) => !expectedNames.has(name))
  if (missing.length || unexpected.length || duplicates.length) {
    throw new Error(`${readmePath}: Tools list mismatch (missing: ${missing.join(', ') || 'none'}; unexpected: ${unexpected.join(', ') || 'none'}; duplicate: ${duplicates.join(', ') || 'none'}). Update README entries manually.`)
  }

  const packageArgument = `${packageName}@latest`
  const beta = readSection(text, 'Public beta', 2)
  checkExample('Public beta command', readExample(beta, 'bash', 'npx ', 'Public beta command'), `npx --yes ${packageArgument}`)

  const kilo = readSection(text, 'Kilo Code', 3)
  const claude = readSection(text, 'Claude Desktop', 3)
  type Example = { mcp?: Record<string, { command?: unknown }>; mcpServers?: Record<string, { command?: unknown; args?: unknown }>; command?: unknown; args?: unknown }
  const parse = (snippet: string, label: string, fragment = false): Example => {
    try {
      return JSON.parse(fragment ? `{${snippet}}` : snippet) as Example
    } catch {
      throw new Error(`${readmePath}: ${label} is not valid JSON; update this example manually`)
    }
  }
  const kiloConfig = parse(readExample(kilo, 'jsonc', '"mcp"', 'Kilo Code'), 'Kilo Code')
  checkExample('Kilo Code command', kiloConfig.mcp?.['agent-collusion-archive']?.command, ['cmd', '/c', 'npx', '--yes', packageArgument])

  const claudeConfig = parse(readExample(claude, 'json', '"mcpServers"', 'Claude Desktop'), 'Claude Desktop')
  checkExample('Claude Desktop command', claudeConfig.mcpServers?.['agent-collusion-archive']?.command, 'npx')
  checkExample('Claude Desktop args', claudeConfig.mcpServers?.['agent-collusion-archive']?.args, ['--yes', packageArgument])

  const fallback = parse(readExample(claude, 'json', '"command"', 'Windows fallback', true), 'Windows fallback', true)
  checkExample('Windows fallback command', fallback.command, 'cmd.exe')
  checkExample('Windows fallback args', fallback.args, ['/c', 'npx', '--yes', packageArgument])
  return text
}

function synchronizeLaunchCommand(text: string, packageName: string, path: string): string {
  return replaceExactlyOnce(
    text,
    /^(- \*\*Launch Command\*\*: `)([^`]+)(`\s*)$/m,
    (prefix, _command, suffix) => `${prefix}npx --yes ${packageName}@latest${suffix}`,
    `${path} launch command`,
  )
}

function synchronizeToolCount(text: string, toolCount: number): string {
  return replaceExactlyOnce(
    text,
    /(^- \*\*Features\*\*:\s*)(\d+)( dedicated research tools)/m,
    (prefix, _count, suffix) => `${prefix}${toolCount}${suffix}`,
    'llms.txt tool count',
  )
}

async function readToolCatalog() {
  const server = createArchiveMcpServer()
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair()
  const client = new Client({ name: 'archive-catalog-sync', version: '1.0.0' })

  try {
    await server.connect(serverTransport)
    await client.connect(clientTransport)
    const { tools } = await client.listTools()

    return tools.map(({ name, title, description, inputSchema }) => ({
      name,
      ...(title === undefined ? {} : { title }),
      ...(description === undefined ? {} : { description }),
      inputSchema,
    }))
  } finally {
    await client.close()
    await server.close()
  }
}

async function expectedFiles(root: string): Promise<Map<string, string>> {
  const packageJson = JSON.parse(await readFile(resolve(root, packagePath), 'utf8')) as {
    name?: unknown
    version?: unknown
  }
  if (typeof packageJson.name !== 'string' || packageJson.name.length === 0) {
    throw new Error(`${packagePath} must define a non-empty package name`)
  }
  if (typeof packageJson.version !== 'string' || packageJson.version.length === 0) {
    throw new Error(`${packagePath} must define a non-empty package version`)
  }

  const packageName = packageJson.name
  const packageVersion = packageJson.version
  const tools = await readToolCatalog()
  const catalog = `${JSON.stringify({ packageName, packageVersion, tools }, null, 2)}\n`

  const [readme, llms, index] = await Promise.all([
    readFile(resolve(root, readmePath), 'utf8'),
    readFile(resolve(root, llmsPath), 'utf8'),
    readFile(resolve(root, indexPath), 'utf8'),
  ])

  const synchronizedReadme = validateReadme(replacePackageNames(readme, packageName, readmePath), packageName, tools)
  const synchronizedLlms = synchronizeToolCount(
    synchronizeLaunchCommand(replacePackageNames(llms, packageName, llmsPath), packageName, llmsPath),
    tools.length,
  )
  const synchronizedIndex = requireLaunchCommand(replacePackageNames(index, packageName, indexPath), packageName, indexPath)

  return new Map([
    [catalogPath, catalog],
    [readmePath, synchronizedReadme],
    [llmsPath, synchronizedLlms],
    [indexPath, synchronizedIndex],
  ])
}

export async function syncCatalog(mode: SyncMode, root = repositoryRoot): Promise<void> {
  const outputs = await expectedFiles(root)
  const stalePaths: string[] = []

  for (const [relativePath, expected] of outputs) {
    try {
      const actual = normalizeLineEndings(await readFile(resolve(root, relativePath), 'utf8'))
      if (actual !== normalizeLineEndings(expected)) stalePaths.push(relativePath)
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error
      stalePaths.push(relativePath)
    }
  }

  if (mode === 'check') {
    if (stalePaths.length > 0) {
      throw new Error(`MCP catalog artifacts are stale: ${stalePaths.join(', ')}. Run npm run catalog:write.`)
    }
    return
  }

  for (const relativePath of stalePaths) {
    const target = resolve(root, relativePath)
    await mkdir(dirname(target), { recursive: true })
    await writeFile(target, outputs.get(relativePath)!, 'utf8')
  }
}

function parseMode(args: string[]): SyncMode {
  if (args.length !== 1 || (args[0] !== '--write' && args[0] !== '--check')) {
    throw new Error('Usage: sync-catalog.ts --write | --check')
  }
  return args[0] === '--write' ? 'write' : 'check'
}

async function main() {
  try {
    await syncCatalog(parseMode(process.argv.slice(2)))
  } catch (error) {
    console.error(error instanceof Error ? error.message : String(error))
    process.exitCode = 1
  }
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  void main()
}
