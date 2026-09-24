import { fireEvent, render, screen } from '@testing-library/react'
import { BrowserRouter } from 'react-router-dom'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import toolCatalog from '../data/mcp-tool-catalog.generated.json'
import { MCP_TOOL_PRESENTATION } from '../data/mcpToolPresentation'
import Mcp from './Mcp'

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

  const getDisplayedConfig = (container: HTMLElement) =>
    JSON.parse(container.querySelector('.mcp-code-block pre code')?.textContent ?? 'null')

  it('renders the header, badges, and npx command', () => {
    renderComponent()

    expect(screen.getByRole('heading', { level: 1 })).toHaveTextContent('Archive Model Context Protocol (MCP) & HTTP API')
    expect(screen.getByText(/Public Beta v0\.1\.1/)).toBeInTheDocument()
    expect(screen.getByText(/Direct HTTP REST Available/)).toBeInTheDocument()
    expect(screen.getByText(`npx --yes ${toolCatalog.packageName}@latest`)).toBeInTheDocument()
  })

  it('allows copying the npx command', async () => {
    renderComponent()

    const copyBtn = screen.getByLabelText('Copy npx command')
    fireEvent.click(copyBtn)

    expect(navigator.clipboard.writeText).toHaveBeenCalledWith(
      `npx --yes ${toolCatalog.packageName}@latest`
    )
    expect(await screen.findByText('Copied')).toBeInTheDocument()
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

    expect(cards).toHaveLength(toolCatalog.tools.length)
    expect(screen.getByRole('heading', { name: `Available Tools & Endpoints (${toolCatalog.tools.length})` })).toBeInTheDocument()
    expect(cards.map((card) => card.querySelector('.mcp-tool-name')?.textContent)).toEqual(
      toolCatalog.tools.map((tool) => tool.name)
    )

    for (const [index, tool] of toolCatalog.tools.entries()) {
      const card = cards[index]
      const presentation = MCP_TOOL_PRESENTATION[tool.name]

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
    const missingExamples = toolCatalog.tools
      .filter((tool) => !Object.hasOwn(MCP_TOOL_PRESENTATION, tool.name)
        || !Object.hasOwn(MCP_TOOL_PRESENTATION[tool.name], 'exampleArguments'))
      .map((tool) => tool.name)

    expect(toolCatalog.tools).toHaveLength(17)
    expect(unknownPresentationKeys).toEqual([])
    expect(missingExamples).toEqual([])
    expect(MCP_TOOL_PRESENTATION.get_agent.exampleArguments).toEqual({ name: 'MapHelper' })
  })

  it('renders a server tool with generic metadata when its presentation is missing', () => {
    const tool = toolCatalog.tools[0]
    if (!tool) throw new Error('The generated MCP tool catalog is empty')

    const presentations = MCP_TOOL_PRESENTATION as Partial<Record<string, unknown>>
    const previousPresentation = presentations[tool.name]
    delete presentations[tool.name]

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
      if (previousPresentation !== undefined) presentations[tool.name] = previousPresentation
    }
  })

  it('filters generated tools by their presentation category', () => {
    const { container } = renderComponent()
    const firstTool = toolCatalog.tools[0]
    if (!firstTool) throw new Error('The generated MCP tool catalog is empty')

    const category = MCP_TOOL_PRESENTATION[firstTool.name]?.category ?? 'Other'
    fireEvent.click(screen.getByRole('button', { name: category }))

    const visibleToolNames = Array.from(container.querySelectorAll('.mcp-tool-name'))
      .map((item) => item.textContent)
    const expectedToolNames = toolCatalog.tools
      .filter((tool) => (MCP_TOOL_PRESENTATION[tool.name]?.category ?? 'Other') === category)
      .map((tool) => tool.name)

    expect(visibleToolNames).toEqual(expectedToolNames)
  })

  it('shares one pressed-button state across category and platform filters', () => {
    renderComponent()
    const firstTool = toolCatalog.tools[0]
    if (!firstTool) throw new Error('The generated MCP tool catalog is empty')

    const allCategory = screen.getByRole('button', { name: 'All' })
    const categoryName = MCP_TOOL_PRESENTATION[firstTool.name]?.category ?? 'Other'
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
