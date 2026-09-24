import { readFileSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'
import { MCP_TOOL_PRESENTATION } from '../../web/src/data/mcpToolPresentation.js'

const repositoryRoot = resolve(dirname(fileURLToPath(import.meta.url)), '../..')

type RecentEvent = { type?: unknown; act?: unknown }

type OpenApiParameter = { name: string; in: string }
type ParameterReference = OpenApiParameter | { $ref: string }
type OpenApiOperation = { parameters?: ParameterReference[] }
type OpenApiContract = {
  paths: Record<string, { get?: OpenApiOperation }>
  components: { parameters: Record<string, OpenApiParameter> }
  'x-data-assets': Array<{ path: string }>
}

type ArgumentAlias = {
  tool: string
  mcpArg: string
  httpParam: string
  reason: string
}

const argumentAliases: ArgumentAlias[] = [
  {
    tool: 'get_page_revisions',
    mcpArg: 'include_body',
    httpParam: 'body',
    reason: 'The MCP boolean is adapted to Worker body=1/0 in mcp/src/api.ts.',
  },
]

const openApi = JSON.parse(
  readFileSync(join(repositoryRoot, 'worker/src/openapi.json'), 'utf8'),
) as OpenApiContract

function eventExampleMatchesData(example: Record<string, unknown>, events: RecentEvent[]): boolean {
  return events.some((event) => Object.hasOwn(event, 'type') && event.type === example.type)
    && (!Object.hasOwn(example, 'act') || events.some((event) =>
      Object.hasOwn(event, 'act') && event.act === example.act))
}

function endpointUrl(endpoint: string): URL {
  const withoutAnnotation = endpoint.replace(/\s+\(decompressed in-memory\)(?=\?|$)/, '')
  return new URL(withoutAnnotation, 'https://worker.invalid')
}

function endpointKind(endpoint: string): 'api' | 'data' {
  if (endpoint.startsWith('/api/')) return 'api'
  if (endpoint.startsWith('/data/')) return 'data'
  throw new Error(`Unsupported MCP endpoint form: ${endpoint}`)
}

function isDocumentedDataAsset(pathname: string): boolean {
  return openApi['x-data-assets'].some(({ path }) => path === pathname)
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}

function findGetOperation(pathname: string): OpenApiOperation {
  const exactMatch = openApi.paths[pathname]
  if (exactMatch?.get) return exactMatch.get

  const matches = Object.entries(openApi.paths).filter(([pathTemplate]) => {
    const expression = pathTemplate
      .split('/')
      .map((segment) => segment.startsWith('{') && segment.endsWith('}')
        ? '[^/]+'
        : escapeRegExp(segment))
      .join('/')
    return new RegExp(`^${expression}$`).test(pathname)
  })

  if (matches.length !== 1 || !matches[0][1].get) {
    throw new Error(`Expected one GET OpenAPI operation for ${pathname}; found ${matches.length}`)
  }

  return matches[0][1].get
}

function resolveParameters(operation: OpenApiOperation): OpenApiParameter[] {
  return (operation.parameters ?? []).map((parameter) => {
    if (!('$ref' in parameter)) return parameter

    const prefix = '#/components/parameters/'
    if (!parameter.$ref.startsWith(prefix)) {
      throw new Error(`Unsupported OpenAPI parameter reference: ${parameter.$ref}`)
    }

    const name = parameter.$ref.slice(prefix.length).replace(/~1/g, '/').replace(/~0/g, '~')
    const resolved = openApi.components.parameters[name]
    if (!resolved) throw new Error(`Unresolved OpenAPI parameter reference: ${parameter.$ref}`)
    return resolved
  })
}

function validateExampleArguments(
  tool: string,
  exampleArguments: Record<string, unknown>,
  parameters: OpenApiParameter[],
  aliases: ArgumentAlias[],
): string[] {
  const parameterNames = new Set(
    parameters.filter(({ in: location }) => location === 'query' || location === 'path')
      .map(({ name }) => name),
  )
  const toolAliases = aliases.filter((alias) => alias.tool === tool)
  const issues: string[] = []

  for (const alias of toolAliases) {
    if (!parameterNames.has(alias.httpParam)) {
      issues.push(`Alias target "${alias.httpParam}" is not documented for ${tool}.`)
    }
    if (!Object.hasOwn(exampleArguments, alias.mcpArg)) {
      issues.push(`Unused argument alias "${alias.mcpArg}" for ${tool}.`)
    }
  }

  for (const argument of Object.keys(exampleArguments)) {
    if (parameterNames.has(argument)) continue

    const alias = toolAliases.find(({ mcpArg }) => mcpArg === argument)
    if (!alias) issues.push(`Undocumented example argument "${argument}" for ${tool}.`)
  }

  return issues
}

describe('MCP tool presentation contract', () => {
  it('matches list_events example filters against real recent event rows', () => {
    const events = JSON.parse(
      readFileSync(join(repositoryRoot, 'data/processed/recent_events.json'), 'utf8'),
    ) as RecentEvent[]
    const example = MCP_TOOL_PRESENTATION.list_events.exampleArguments

    expect(eventExampleMatchesData(example, events)).toBe(true)
    expect(eventExampleMatchesData({ ...example, act: '[Admin1]' }, events)).toBe(true)
    expect(eventExampleMatchesData({ ...example, type: 'not-an-event-type' }, events)).toBe(false)
    expect(eventExampleMatchesData({ ...example, act: 'save' }, events)).toBe(false)
  })

  it('cross-checks every API argument and static-data endpoint without silent skips', () => {
    const apiTools: string[] = []
    const dataTools: string[] = []

    for (const [tool, presentation] of Object.entries(MCP_TOOL_PRESENTATION)) {
      const kind = endpointKind(presentation.httpEndpoint)
      const url = endpointUrl(presentation.httpEndpoint)

      if (kind === 'data') {
        dataTools.push(tool)
        expect(
          isDocumentedDataAsset(url.pathname),
          `${tool}: ${url.pathname} must be a documented data asset`,
        ).toBe(true)
        continue
      }

      apiTools.push(tool)
      const parameters = resolveParameters(findGetOperation(url.pathname))
      const queryParameterNames = new Set(
        parameters.filter(({ in: location }) => location === 'query').map(({ name }) => name),
      )

      for (const queryName of new Set(url.searchParams.keys())) {
        expect(queryParameterNames.has(queryName), `${tool}: undocumented endpoint query ${queryName}`)
          .toBe(true)
      }

      const issues = validateExampleArguments(
        tool,
        presentation.exampleArguments,
        parameters,
        argumentAliases,
      )
      expect(issues, `${tool}: ${issues.join(' ')}`).toEqual([])
    }

    expect(argumentAliases).toHaveLength(1)
    expect(apiTools).toHaveLength(14)
    expect(dataTools).toHaveLength(3)
    expect(apiTools.length + dataTools.length).toBe(Object.keys(MCP_TOOL_PRESENTATION).length)
    expect(isDocumentedDataAsset('/data/not-a-published-asset.json')).toBe(false)

    const getPageRevisionsParameters = [
      { name: 'slug', in: 'path' },
      { name: 'body', in: 'query' },
    ]
    expect(validateExampleArguments(
      'get_page_revisions',
      { slug: 'example~', include_body: true },
      getPageRevisionsParameters,
      argumentAliases,
    )).toEqual([])
    expect(validateExampleArguments(
      'get_page_revisions',
      { slug: 'example~', unknown: true },
      getPageRevisionsParameters,
      argumentAliases,
    )).toContain('Undocumented example argument "unknown" for get_page_revisions.')
    expect(validateExampleArguments(
      'get_page_revisions',
      { slug: 'example~' },
      getPageRevisionsParameters,
      argumentAliases,
    )).toContain('Unused argument alias "include_body" for get_page_revisions.')
    expect(validateExampleArguments(
      'get_page_revisions',
      { slug: 'example~', include_body: true },
      [{ name: 'slug', in: 'path' }],
      argumentAliases,
    )).toContain('Alias target "body" is not documented for get_page_revisions.')
    expect(() => endpointKind('/other/endpoint')).toThrow('Unsupported MCP endpoint form')
  })
})
