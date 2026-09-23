import { fireEvent, render, screen } from '@testing-library/react'
import { BrowserRouter } from 'react-router-dom'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
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

  it('renders the header, badges, and npx command', () => {
    renderComponent()

    expect(screen.getByRole('heading', { level: 1 })).toHaveTextContent('Archive Model Context Protocol (MCP) & HTTP API')
    expect(screen.getByText(/Public Beta v0\.1\.1/)).toBeInTheDocument()
    expect(screen.getByText(/Direct HTTP REST Available/)).toBeInTheDocument()
    expect(screen.getByText('npx --yes @catgirl3d/agent-collusion-archive-mcp@latest')).toBeInTheDocument()
  })

  it('allows copying the npx command', async () => {
    renderComponent()

    const copyBtn = screen.getByLabelText('Copy npx command')
    fireEvent.click(copyBtn)

    expect(navigator.clipboard.writeText).toHaveBeenCalledWith(
      'npx --yes @catgirl3d/agent-collusion-archive-mcp@latest'
    )
    expect(await screen.findByText('Copied')).toBeInTheDocument()
  })

  it('switches client tabs and formats client configurations correctly', () => {
    renderComponent()

    // Default: Kilo Code on Windows
    expect(screen.getByText(/"agent-collusion-archive":/)).toBeInTheDocument()
    expect(screen.getByText(/"cmd",/)).toBeInTheDocument()

    // Switch to POSIX
    fireEvent.click(screen.getByText('macOS / Linux'))
    expect(screen.queryByText(/"cmd",/)).not.toBeInTheDocument()

    // Switch to Claude Desktop
    fireEvent.click(screen.getByText('Claude Desktop'))
    expect(screen.getByText(/"mcpServers":/)).toBeInTheDocument()

    // Switch to Cursor / VS Code
    fireEvent.click(screen.getByText('Cursor / VS Code'))
    expect(screen.getByText(/"type": "command"/)).toBeInTheDocument()

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

  it('filters tool catalog by category and renders HTTP endpoints alongside MCP payloads', () => {
    renderComponent()

    // Initially "All" is active, tools from various categories exist
    expect(screen.getByText('search_corpus')).toBeInTheDocument()
    expect(screen.getByText('list_conflict_pages')).toBeInTheDocument()
    expect(screen.getByText('/api/conflicts?minChurn=2')).toBeInTheDocument()

    // Filter to Corpus & Search
    fireEvent.click(screen.getByRole('button', { name: 'Corpus & Search' }))
    expect(screen.getByText('search_corpus')).toBeInTheDocument()
    expect(screen.getByText('/api/fts?q=serveo&mode=prefix')).toBeInTheDocument()
    expect(screen.queryByText('list_conflict_pages')).not.toBeInTheDocument()

    // Filter to Agents & Dynamics
    fireEvent.click(screen.getByRole('button', { name: 'Agents & Dynamics' }))
    expect(screen.queryByText('search_corpus')).not.toBeInTheDocument()
    expect(screen.getByText('list_conflict_pages')).toBeInTheDocument()
    expect(screen.getByText('/api/links?label=MapHelper')).toBeInTheDocument()
  })
})
