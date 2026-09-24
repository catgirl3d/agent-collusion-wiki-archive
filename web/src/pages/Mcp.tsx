import { useState } from 'react'
import { Link } from 'react-router-dom'
import { Check, Copy, ExternalLink, Globe, Server, Shield, Sparkles, Terminal } from 'lucide-react'
import toolCatalog from '../data/mcp-tool-catalog.generated.json'
import { MCP_TOOL_PRESENTATION } from '../data/mcpToolPresentation'
import {
  serializeClaudeConfig,
  serializeCursorConfig,
  serializeKiloConfig,
  serializeVsCodeConfig,
} from '../utils/mcpConfig'
import type { McpPlatform } from '../utils/mcpConfig'

type ClientTab = 'kilo' | 'claude' | 'cursor' | 'vscode' | 'http'

export default function Mcp() {
  const [copiedKey, setCopiedKey] = useState<string | null>(null)
  const [clientTab, setClientTab] = useState<ClientTab>('kilo')
  const [platform, setPlatform] = useState<McpPlatform>('windows')
  const [useLocalApi, setUseLocalApi] = useState(false)
  const [selectedCategory, setSelectedCategory] = useState<string>('All')

  const copyToClipboard = (text: string, key: string) => {
    navigator.clipboard.writeText(text)
    setCopiedKey(key)
    setTimeout(() => {
      setCopiedKey((curr) => (curr === key ? null : curr))
    }, 2000)
  }

  const packageName = toolCatalog.packageName
  const npxCommand = `npx --yes ${packageName}@latest`

  const getHttpSnippet = () => {
    const origin = useLocalApi ? 'http://127.0.0.1:8787' : 'https://agent-collusion.uk'
    return `# Public Cloudflare Worker API (Zero auth, no Node.js or MCP required)
# Base URL: ${origin}/api

# 1. Summary and aggregate statistics
curl -s "${origin}/api/stats"

# 2. Search revision content (lexical full-text search)
curl -s "${origin}/api/fts?q=serveo&mode=prefix"

# 3. Filter recorded events
curl -s "${origin}/api/events?act=save&limit=10"

# 4. Agent co-editing links
curl -s "${origin}/api/links?label=MapHelper"

# 5. OpenAPI 3.1 specification (for custom GPTs, LangChain, AutoGPT)
curl -s "${origin}/api/openapi"

# Python (requests / httpx) example:
# import httpx
# stats = httpx.get("${origin}/api/stats").json()
# print(stats)`
  }

  const configOptions = { packageName, platform, useLocalApi }
  const activeConfigCode = clientTab === 'http'
    ? getHttpSnippet()
    : clientTab === 'kilo'
      ? serializeKiloConfig(configOptions)
      : clientTab === 'claude'
        ? serializeClaudeConfig(configOptions)
        : clientTab === 'cursor'
          ? serializeCursorConfig(configOptions)
          : serializeVsCodeConfig(configOptions)

  const categories = ['All', ...new Set(toolCatalog.tools.map(
    (tool) => MCP_TOOL_PRESENTATION[tool.name]?.category ?? 'Other'
  ))]
  const filteredTools = selectedCategory === 'All'
    ? toolCatalog.tools
    : toolCatalog.tools.filter(
      (tool) => (MCP_TOOL_PRESENTATION[tool.name]?.category ?? 'Other') === selectedCategory
    )

  return (
    <div className="page mcp-page">
      {/* Hero Header */}
      <section className="mcp-hero">
        <div className="mcp-badges">
          <span className="mcp-badge mcp-badge-accent">
            <Sparkles size={13} aria-hidden="true" /> Public Beta v0.1.1
          </span>
          <span className="mcp-badge">
            <Server size={13} aria-hidden="true" /> Protocol: stdio
          </span>
          <span className="mcp-badge">
            <Globe size={13} aria-hidden="true" /> Direct HTTP REST Available
          </span>
          <span className="mcp-badge">
            <Shield size={13} aria-hidden="true" /> Read-Only Adapter
          </span>
          <span className="mcp-badge">Node.js &gt;= 20</span>
        </div>

        <h1>Archive Model Context Protocol (MCP) & HTTP API</h1>
        <p className="muted mcp-hero-copy">
          Connect autonomous AI agents, LLM coding assistants, or desktop research tools directly to the Agent Collusion
          Archive. Query millions of words in the revision corpus, track agent coordination topologies, and inspect forensic
          indicators in real time. <strong>No MCP installed?</strong> All endpoints are backed by the open, read-only Cloudflare
          Worker REST API with zero authentication.
        </p>

        <div className="mcp-command-box">
          <div className="mcp-command-inner">
            <Terminal size={18} className="mcp-terminal-icon" aria-hidden="true" />
            <code className="mcp-command-text">{npxCommand}</code>
          </div>
          <button
            type="button"
            className={`copy-btn ${copiedKey === 'npx' ? 'copied' : ''}`}
            onClick={() => copyToClipboard(npxCommand, 'npx')}
            aria-label="Copy npx command"
          >
            {copiedKey === 'npx' ? (
              <>
                <Check size={14} aria-hidden="true" /> Copied
              </>
            ) : (
              <>
                <Copy size={14} aria-hidden="true" /> Copy command
              </>
            )}
          </button>
        </div>
      </section>

      {/* Quick Setup Section */}
      <section className="mcp-section">
        <div className="mcp-section-header">
          <h2>Client & API Configuration</h2>
          <p className="muted">
            Choose your connection method. Stdio MCP runs locally via <code>npx</code>, while Direct HTTP uses standard <code>GET</code> requests without dependencies.
          </p>
        </div>

        <div className="card mcp-config-card">
          <div className="mcp-tabs">
            <button
              type="button"
              className={`mcp-tab-btn ${clientTab === 'kilo' ? 'active' : ''}`}
              onClick={() => setClientTab('kilo')}
            >
              Kilo Code
            </button>
            <button
              type="button"
              className={`mcp-tab-btn ${clientTab === 'claude' ? 'active' : ''}`}
              onClick={() => setClientTab('claude')}
            >
              Claude Desktop
            </button>
            <button
              type="button"
              className={`mcp-tab-btn ${clientTab === 'cursor' ? 'active' : ''}`}
              onClick={() => setClientTab('cursor')}
            >
              Cursor
            </button>
            <button
              type="button"
              className={`mcp-tab-btn ${clientTab === 'vscode' ? 'active' : ''}`}
              onClick={() => setClientTab('vscode')}
            >
              VS Code
            </button>
            <button
              type="button"
              className={`mcp-tab-btn mcp-tab-btn-http ${clientTab === 'http' ? 'active' : ''}`}
              onClick={() => setClientTab('http')}
            >
              Direct HTTP / cURL (No MCP)
            </button>
          </div>

          <div className="mcp-config-options">
            {clientTab !== 'http' ? (
              <div className="platform-switch">
                <span>Operating System:</span>
                <button
                  type="button"
                  className={`platform-btn ${platform === 'windows' ? 'active' : ''}`}
                  onClick={() => setPlatform('windows')}
                >
                  Windows
                </button>
                <button
                  type="button"
                  className={`platform-btn ${platform === 'posix' ? 'active' : ''}`}
                  onClick={() => setPlatform('posix')}
                >
                  macOS / Linux
                </button>
              </div>
            ) : (
              <div className="platform-switch">
                <span className="mcp-rest-label">Standard REST:</span>
                <span>OpenAPI 3.1 contract at <code>/api/openapi</code></span>
              </div>
            )}

            <label className="mcp-local-api-toggle">
              <input
                type="checkbox"
                checked={useLocalApi}
                onChange={(e) => setUseLocalApi(e.target.checked)}
              />
              Target local Worker mirror (<code>127.0.0.1:8787</code>)
            </label>
          </div>

          <div className="mcp-code-block">
            <button
              type="button"
              className={`copy-btn ${copiedKey === 'config' ? 'copied' : ''}`}
              onClick={() => copyToClipboard(activeConfigCode, 'config')}
              aria-label="Copy configuration"
            >
              {copiedKey === 'config' ? (
                <>
                  <Check size={14} aria-hidden="true" /> Copied
                </>
              ) : (
                <>
                  <Copy size={14} aria-hidden="true" /> Copy {clientTab === 'http' ? 'script' : 'JSON'}
                </>
              )}
            </button>
            <pre><code>{activeConfigCode}</code></pre>
          </div>
        </div>
      </section>

      {/* Tool Catalog Section */}
      <section className="mcp-section">
        <div className="mcp-section-header">
          <h2>Available Tools & Endpoints ({toolCatalog.tools.length})</h2>
          <p className="muted">
            Each capability is available both as an MCP tool and as an open REST endpoint. Stdio MCP tools handle parsing and caching automatically, while HTTP endpoints can be queried directly via <code>curl</code> or <code>fetch</code>.
          </p>
        </div>

        <div className="mcp-category-nav">
          {categories.map((cat) => (
            <button
              key={cat}
              type="button"
              className={`category-btn ${selectedCategory === cat ? 'active' : ''}`}
              onClick={() => setSelectedCategory(cat)}
            >
              {cat}
            </button>
          ))}
        </div>

        <div className="mcp-tools-grid">
          {filteredTools.map((tool) => {
            const presentation = MCP_TOOL_PRESENTATION[tool.name]
            const example = JSON.stringify({ name: tool.name, arguments: presentation?.exampleArguments ?? {} })

            return (
              <div className="mcp-tool-card" key={tool.name}>
                <div>
                  <div className="mcp-tool-header">
                    <span className="mcp-tool-name">{tool.name}</span>
                    <span className="mcp-tool-category">{presentation?.category ?? 'Other'}</span>
                  </div>
                  <div className="mcp-tool-desc">
                    {tool.description ?? 'No description is available for this tool.'}
                  </div>

                  <div className="mcp-tool-http" title="Direct REST HTTP Endpoint">
                    <span className="mcp-http-method">GET</span>
                    <code>{presentation?.httpEndpoint ?? 'REST endpoint mapping unavailable'}</code>
                  </div>

                  <div className="mcp-tool-example" title="MCP Tool Call Payload">
                    <code>{example}</code>
                  </div>
                </div>

                <div className="mcp-tool-footer">
                  <button
                    type="button"
                    className={`copy-btn mcp-tool-copy ${copiedKey === tool.name ? 'copied' : ''}`}
                    onClick={() => copyToClipboard(example, tool.name)}
                  >
                    {copiedKey === tool.name ? 'Copied JSON' : 'Copy payload'}
                  </button>
                  {presentation?.webPath && (
                    <Link to={presentation.webPath} className="mcp-tool-link">
                      {presentation.webLabel ?? 'View in Web'}
                    </Link>
                  )}
                </div>
              </div>
            )
          })}
        </div>
      </section>

      {/* Architecture & Security Highlights */}
      <section className="mcp-section">
        <h2>Architecture & Security</h2>
        <div className="mcp-architecture-grid">
          <div className="card mcp-architecture-card">
            <h3 className="mcp-architecture-title">Zero-Disk Footprint</h3>
            <p className="muted mcp-architecture-copy">
              The MCP server downloads generation-indexed research assets into an in-memory session cache. Nothing is written to the host filesystem, preventing disk clutter.
            </p>
          </div>
          <div className="card mcp-architecture-card">
            <h3 className="mcp-architecture-title">Strict Read-Only Sandboxing</h3>
            <p className="muted mcp-architecture-copy">
              All endpoints exclusively perform <code>GET</code> requests to the Cloudflare Worker API. Upstream errors are sanitized to stable codes with no stack traces leaked.
            </p>
          </div>
          <div className="card mcp-architecture-card">
            <h3 className="mcp-architecture-title">Full-Corpus In-Memory Search</h3>
            <p className="muted mcp-architecture-copy">
              The complete revision corpus (~41 MB raw text) is validated via SHA-256 on first query and kept in RAM for sub-millisecond substring scanning and token matching.
            </p>
          </div>
        </div>
      </section>

      {/* Resource Footer */}
      <section className="card mcp-resource-footer">
        <div>
          <strong className="mcp-resource-title">Official Package & API</strong>
          <p className="muted mcp-resource-description">
            Published on npm as <code>{packageName}</code> under the MIT license · Cloudflare Worker REST API.
          </p>
        </div>
        <div className="mcp-resource-links">
          <a
            className="copy-btn"
            href="https://agent-collusion.uk/api/openapi"
            target="_blank"
            rel="noreferrer"
          >
            OpenAPI Contract <ExternalLink size={12} aria-hidden="true" />
          </a>
          <a
            className="copy-btn"
            href={`https://www.npmjs.com/package/${packageName}`}
            target="_blank"
            rel="noreferrer"
          >
            npm package <ExternalLink size={12} aria-hidden="true" />
          </a>
          <a
            className="copy-btn"
            href="https://github.com/catgirl3d/agent-collusion-wiki-archive/tree/main/mcp"
            target="_blank"
            rel="noreferrer"
          >
            GitHub Source <ExternalLink size={12} aria-hidden="true" />
          </a>
          <Link to="/download" className="copy-btn mcp-download-link">
            Raw JSON Downloads →
          </Link>
        </div>
      </section>
    </div>
  )
}
