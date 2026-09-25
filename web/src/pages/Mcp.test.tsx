import openapiDocument from '../../../worker/src/openapi.json'
import llmsDocument from '../../public/llms.txt?raw'
import { fireEvent, render, screen } from '@testing-library/react'
import { BrowserRouter } from 'react-router-dom'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import toolCatalog from '../data/mcp-tool-catalog.generated.json'
import { MCP_TOOL_PRESENTATION } from '../data/mcpToolPresentation'
import Mcp from './Mcp'

interface OpenApiParameter { $ref?: string; name?: string; in?: string; schema?: { enum?: unknown[] } }
interface WorkerOpenApi {
  paths: Record<string, { parameters?: OpenApiParameter[]; get?: { parameters?: OpenApiParameter[] } }>
  components: { parameters: Partial<Record<string, OpenApiParameter>> }
}

const workerOpenApi = openapiDocument as WorkerOpenApi
type CatalogTool = Omit<(typeof toolCatalog.tools)[number], 'description'> & { description?: string }

const tools: CatalogTool[] = toolCatalog.tools
const toolPresentations: Partial<typeof MCP_TOOL_PRESENTATION> = MCP_TOOL_PRESENTATION

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

const resolveParameter = (parameter: OpenApiParameter): OpenApiParameter => {
  if (parameter.$ref === undefined) return parameter

  const reference = parameter.$ref.slice(parameter.$ref.lastIndexOf('/') + 1)
  const resolved = workerOpenApi.components.parameters[reference]
  if (resolved === undefined) throw new Error(`unresolvable OpenAPI parameter reference: ${parameter.$ref}`)
  return resolved
}

const documentedQueryParameters = new Map(
  Object.entries(workerOpenApi.paths).map(([path, item]) => [
    path,
    new Map(
      [...(item.parameters ?? []), ...(item.get?.parameters ?? [])]
        .map(resolveParameter)
        .filter((parameter): parameter is OpenApiParameter & { name: string } => parameter.in === 'query' && parameter.name !== undefined)
        .map((parameter) => [parameter.name, parameter])
    ),
  ])
)

const documentedApiPathPatterns = Object.keys(workerOpenApi.paths)
  .filter((path) => path.startsWith('/api/'))
  .map(
    (path) =>
      [
        path,
        new RegExp(
          `^${path
            .split('/')
            .map((segment) =>
              segment.startsWith('{') && segment.endsWith('}')
                ? '[^/]+'
                : segment.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
            )
            .join('/')}$`
        ),
      ] as const
  )

const expectDocumentedApiExample = (exampleUrl: string) => {
  const url = new URL(exampleUrl, 'https://agent-collusion.uk')
  const documented = documentedApiPathPatterns.find(([, pattern]) => pattern.test(url.pathname))
  expect(documented, `no documented Worker API path for ${url.pathname}`).toBeDefined()

  const parameters = documentedQueryParameters.get(documented?.[0] ?? '')
  for (const [name, value] of url.searchParams) {
    const parameter = parameters?.get(name)
    expect(parameter, `${String(documented?.[0])} does not document query parameter ${name}`).toBeDefined()
    const allowed = parameter?.schema?.enum
    if (allowed !== undefined) expect(allowed).toContain(value)
  }
}

describe('Mcp page', () => {
  beforeEach(() => {
    Object.assign(navigator, {
      clipboard: {
        writeText: vi.fn().mockImplementation(() => Promise.resolve()),
      },
    })
  })

  afterEach(() => {
    vi.restoreAllMocks()
  })

  const renderComponent = () => {
    return render(
      <BrowserRouter>
        <Mcp />
      </BrowserRouter>
    )
  }

  const getDisplayedConfig = (container: HTMLElement): Record<string, unknown> => {
    const parsed: unknown = JSON.parse(container.querySelector('.mcp-code-block pre code')?.textContent ?? 'null')
    if (!isRecord(parsed)) throw new Error('Displayed configuration must be a JSON object')
    return parsed
  }

  it('renders the header, badges, and npx command', () => {
    renderComponent()

    expect(screen.getByRole('heading', { level: 1 })).toHaveTextContent('Archive Model Context Protocol (MCP) & HTTP API')
    expect(screen.getByText(`Public Beta v${toolCatalog.packageVersion}`)).toBeInTheDocument()
    expect(screen.getByText(/Direct HTTP REST Available/)).toBeInTheDocument()
    expect(screen.getByText(`npx --yes ${toolCatalog.packageName}@latest`)).toBeInTheDocument()
  })

  it('allows copying the npx command', async () => {
    const writeText = vi.fn().mockImplementation(() => Promise.resolve())
    Object.assign(navigator, { clipboard: { writeText } })
    renderComponent()

    const copyBtn = screen.getByLabelText('Copy npx command')
    fireEvent.click(copyBtn)

    expect(writeText).toHaveBeenCalledWith(
      `npx --yes ${toolCatalog.packageName}@latest`
    )
    expect(await screen.findByText('Copied')).toBeInTheDocument()
  })

  it('does not show copied success when clipboard writing fails', async () => {
    const failure = new Error('Clipboard unavailable')
    const loggedErrors: unknown[][] = []
    const errorReported = new Promise<void>((resolve) => {
      vi.spyOn(console, 'error').mockImplementation((...args: unknown[]) => {
        loggedErrors.push(args)
        resolve()
      })
    })
    Object.assign(navigator, {
      clipboard: {
        writeText: vi.fn().mockRejectedValue(failure),
      },
    })
    renderComponent()

    fireEvent.click(screen.getByLabelText('Copy npx command'))

    await errorReported
    expect(loggedErrors).toContainEqual(['Clipboard write failed', failure])
    expect(screen.queryByText('Copied')).not.toBeInTheDocument()
  })

  it('switches client tabs and formats client configurations correctly', () => {
    const { container } = renderComponent()

    // Default: Kilo Code on Windows
    expect(screen.getByRole('button', { name: 'Kilo Code' })).toHaveAttribute('aria-pressed', 'true')
    expect(screen.getByText(/"agent-collusion-archive":/)).toBeInTheDocument()
    expect(screen.getByText(/"cmd",/)).toBeInTheDocument()

    // Switch to POSIX
    fireEvent.click(screen.getByText('macOS / Linux'))
    expect(screen.queryByText(/"cmd",/)).not.toBeInTheDocument()

    // Switch to Claude Desktop
    fireEvent.click(screen.getByText('Claude Desktop'))
    expect(screen.getByRole('button', { name: 'Claude Desktop' })).toHaveAttribute('aria-pressed', 'true')
    expect(screen.getByRole('button', { name: 'Kilo Code' })).toHaveAttribute('aria-pressed', 'false')
    expect(screen.getByText(/"mcpServers":/)).toBeInTheDocument()

    const packageArgument = `${toolCatalog.packageName}@latest`

    // Switch to Cursor
    fireEvent.click(screen.getByRole('button', { name: 'Cursor' }))
    expect(getDisplayedConfig(container)).toEqual({
      mcpServers: {
        'agent-collusion-archive': {
          type: 'stdio',
          command: 'npx',
          args: ['--yes', packageArgument],
        },
      },
    })

    // VS Code uses its own native top-level key
    fireEvent.click(screen.getByRole('button', { name: 'VS Code' }))
    expect(getDisplayedConfig(container)).toEqual({
      servers: {
        'agent-collusion-archive': {
          type: 'stdio',
          command: 'npx',
          args: ['--yes', packageArgument],
        },
      },
    })

    // Switch to Direct HTTP / cURL
    fireEvent.click(screen.getByText(/Direct HTTP \/ cURL/))
    expect(screen.getByText(/curl -s "https:\/\/agent-collusion\.uk\/api\/stats"/)).toBeInTheDocument()
    expect(screen.getByText(/OpenAPI 3\.1 specification/)).toBeInTheDocument()
  })

  it('adds ARCHIVE_API_URL environment override or local curl base when local mirror checkbox is enabled', () => {
    renderComponent()

    // Test in HTTP tab
    fireEvent.click(screen.getByText(/Direct HTTP \/ cURL/))
    expect(screen.getByText(/https:\/\/agent-collusion\.uk\/api/)).toBeInTheDocument()

    const checkbox = screen.getByRole('checkbox', { name: /Target local Worker mirror/i })
    fireEvent.click(checkbox)
    expect(screen.getByText(/http:\/\/127\.0\.0\.1:8787\/api/)).toBeInTheDocument()

    // Switch back to Kilo
    fireEvent.click(screen.getByText('Kilo Code'))
    expect(screen.getByText(/ARCHIVE_API_URL/)).toBeInTheDocument()
    expect(screen.getByText(/http:\/\/127\.0\.0\.1:8787\/api/)).toBeInTheDocument()
  })

  it('renders generated tools in server order with their descriptions and example calls', () => {
    const { container } = renderComponent()
    const cards = Array.from(container.querySelectorAll('.mcp-tool-card'))

    expect(cards).toHaveLength(tools.length)
    expect(screen.getByRole('heading', { name: `Available Tools & Endpoints (${String(tools.length)})` })).toBeInTheDocument()
    expect(cards.map((card) => card.querySelector('.mcp-tool-name')?.textContent)).toEqual(
      tools.map((tool) => tool.name)
    )

    for (const [index, tool] of tools.entries()) {
      const card = cards.at(index)
      const presentation = toolPresentations[tool.name]

      expect(card?.querySelector('.mcp-tool-desc')?.textContent).toBe(
        tool.description ?? 'No description is available for this tool.'
      )
      expect(card?.querySelector('.mcp-tool-category')?.textContent).toBe(presentation?.category ?? 'Other')
      expect(card?.querySelector('.mcp-tool-http code')?.textContent).toBe(
        presentation?.httpEndpoint ?? 'REST endpoint mapping unavailable'
      )
      expect(card?.querySelector('.mcp-tool-example code')?.textContent).toBe(
        JSON.stringify({ name: tool.name, arguments: presentation?.exampleArguments ?? {} })
      )
      expect(card?.querySelector('.mcp-tool-link')?.getAttribute('href') ?? null).toBe(
        presentation?.webPath ?? null
      )
    }
  })

  it('keeps presentation keys aligned with the generated catalog and examples for all 17 tools', () => {
    const toolNames = new Set(toolCatalog.tools.map((tool) => tool.name))
    const unknownPresentationKeys = Object.keys(MCP_TOOL_PRESENTATION).filter((name) => !toolNames.has(name))
    const missingExamples = tools
      .filter((tool) => !Object.hasOwn(MCP_TOOL_PRESENTATION, tool.name)
        || !Object.hasOwn(MCP_TOOL_PRESENTATION[tool.name], 'exampleArguments'))
      .map((tool) => tool.name)

    expect(toolCatalog.tools).toHaveLength(17)
    expect(unknownPresentationKeys).toEqual([])
    expect(missingExamples).toEqual([])
    expect(toolPresentations.get_agent?.exampleArguments).toEqual({ name: 'MapHelper' })
  })

  it('keeps REST examples within the documented Worker API surface', () => {
    const { container } = renderComponent()
    fireEvent.click(screen.getByText('Direct HTTP / cURL (No MCP)'))

    const examples = Object.values(MCP_TOOL_PRESENTATION)
      .map((presentation) => presentation.httpEndpoint)
      .filter((endpoint) => endpoint.startsWith('/api/'))

    const curlSnippet = Array.from(container.querySelectorAll('pre'))
      .map((block) => block.textContent)
      .find((text) => text.includes('curl -s'))
    expect(curlSnippet, 'the page must render the curl examples').toBeDefined()
    for (const match of curlSnippet?.matchAll(/(?:https?:\/\/[^\s"']+)?\/api\/[^\s"']*/g) ?? []) {
      examples.push(match[0])
    }

    const llms = llmsDocument
    for (const match of llms.matchAll(/https:\/\/agent-collusion\.uk\/api\/[^\s)`]+/g)) {
      examples.push(match[0])
    }

    expect(examples.length).toBeGreaterThan(10)
    for (const example of examples) expectDocumentedApiExample(example)
  })

  it('keeps example arguments within the generated MCP tool schemas', () => {
    for (const tool of tools) {
      const presentation = toolPresentations[tool.name]
      expect(presentation, `missing presentation for ${tool.name}`).toBeDefined()

      const properties =
        (tool.inputSchema as { properties?: Record<string, unknown> }).properties ?? {}
      for (const [name, value] of Object.entries(presentation?.exampleArguments ?? {})) {
        const property = properties[name] as { enum?: unknown[] } | undefined
        expect(property, `${tool.name} does not declare argument ${name}`).toBeDefined()
        const allowed = property?.enum
        expect(allowed === undefined || allowed.includes(value)).toBe(true)
      }
    }
  })

  it('renders a server tool with generic metadata when its presentation is missing', () => {
    const tool = tools.at(0)
    if (!tool) throw new Error('The generated MCP tool catalog is empty')

    const previousPresentation = toolPresentations[tool.name]
    Reflect.deleteProperty(toolPresentations, tool.name)

    try {
      const { container } = renderComponent()
      const card = Array.from(container.querySelectorAll('.mcp-tool-card')).find(
        (item) => item.querySelector('.mcp-tool-name')?.textContent === tool.name
      )

      expect(card).toBeDefined()
      expect(card?.querySelector('.mcp-tool-category')?.textContent).toBe('Other')
      expect(card?.querySelector('.mcp-tool-http code')?.textContent).toBe('REST endpoint mapping unavailable')
      expect(card?.querySelector('.mcp-tool-example code')?.textContent).toBe(
        JSON.stringify({ name: tool.name, arguments: {} })
      )
    } finally {
      if (previousPresentation !== undefined) toolPresentations[tool.name] = previousPresentation
    }
  })

  it('filters generated tools by their presentation category', () => {
    const { container } = renderComponent()
    const firstTool = tools.at(0)
    if (!firstTool) throw new Error('The generated MCP tool catalog is empty')

    const category = toolPresentations[firstTool.name]?.category ?? 'Other'
    fireEvent.click(screen.getByRole('button', { name: category }))

    const visibleToolNames = Array.from(container.querySelectorAll('.mcp-tool-name'))
      .map((item) => item.textContent)
    const expectedToolNames = tools
      .filter((tool) => (toolPresentations[tool.name]?.category ?? 'Other') === category)
      .map((tool) => tool.name)

    expect(visibleToolNames).toEqual(expectedToolNames)
  })

  it('shares one pressed-button state across category and platform filters', () => {
    renderComponent()
    const firstTool = tools.at(0)
    if (!firstTool) throw new Error('The generated MCP tool catalog is empty')

    const allCategory = screen.getByRole('button', { name: 'All' })
    const categoryName = toolPresentations[firstTool.name]?.category ?? 'Other'
    const category = screen.getByRole('button', { name: categoryName })

    expect(allCategory).toHaveAttribute('aria-pressed', 'true')
    expect(category).toHaveAttribute('aria-pressed', 'false')
    fireEvent.click(category)
    expect(category).toHaveAttribute('aria-pressed', 'true')
    expect(allCategory).toHaveAttribute('aria-pressed', 'false')

    const windows = screen.getByRole('button', { name: 'Windows' })
    const posix = screen.getByRole('button', { name: 'macOS / Linux' })
    expect(windows).toHaveAttribute('aria-pressed', 'true')
    expect(posix).toHaveAttribute('aria-pressed', 'false')
    fireEvent.click(posix)
    expect(posix).toHaveAttribute('aria-pressed', 'true')
    expect(windows).toHaveAttribute('aria-pressed', 'false')
  })
})
