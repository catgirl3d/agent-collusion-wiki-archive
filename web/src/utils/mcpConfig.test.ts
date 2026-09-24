import { describe, expect, it } from 'vitest'
import {
  serializeClaudeConfig,
  serializeCursorConfig,
  serializeKiloConfig,
  serializeVsCodeConfig,
} from './mcpConfig'

const packageName = '@test/archive-mcp'

const options = (platform: 'windows' | 'posix', useLocalApi: boolean) => ({
  packageName,
  platform,
  useLocalApi,
})

describe('MCP client configuration serializers', () => {
  it('preserves Kilo config shape and its local environment field', () => {
    expect(JSON.parse(serializeKiloConfig(options('windows', true)))).toEqual({
      mcp: {
        'agent-collusion-archive': {
          type: 'local',
          command: ['cmd', '/c', 'npx', '--yes', '@test/archive-mcp@latest'],
          enabled: true,
          environment: { ARCHIVE_API_URL: 'http://127.0.0.1:8787/api' },
        },
      },
    })

    expect(JSON.parse(serializeKiloConfig(options('posix', false)))).toEqual({
      mcp: {
        'agent-collusion-archive': {
          type: 'local',
          command: ['npx', '--yes', '@test/archive-mcp@latest'],
          enabled: true,
        },
      },
    })
  })

  it('serializes Claude Desktop with native mcpServers and platform-specific commands', () => {
    expect(JSON.parse(serializeClaudeConfig(options('windows', true)))).toEqual({
      mcpServers: {
        'agent-collusion-archive': {
          command: 'cmd.exe',
          args: ['/c', 'npx', '--yes', '@test/archive-mcp@latest'],
          env: { ARCHIVE_API_URL: 'http://127.0.0.1:8787/api' },
        },
      },
    })

    expect(JSON.parse(serializeClaudeConfig(options('posix', false)))).toEqual({
      mcpServers: {
        'agent-collusion-archive': {
          command: 'npx',
          args: ['--yes', '@test/archive-mcp@latest'],
        },
      },
    })
  })

  it('serializes Cursor with stdio mcpServers and optional local env', () => {
    expect(JSON.parse(serializeCursorConfig(options('windows', false)))).toEqual({
      mcpServers: {
        'agent-collusion-archive': {
          type: 'stdio',
          command: 'cmd.exe',
          args: ['/c', 'npx', '--yes', '@test/archive-mcp@latest'],
        },
      },
    })

    expect(JSON.parse(serializeCursorConfig(options('posix', true)))).toEqual({
      mcpServers: {
        'agent-collusion-archive': {
          type: 'stdio',
          command: 'npx',
          args: ['--yes', '@test/archive-mcp@latest'],
          env: { ARCHIVE_API_URL: 'http://127.0.0.1:8787/api' },
        },
      },
    })
  })

  it('serializes VS Code with native servers and optional local env', () => {
    expect(JSON.parse(serializeVsCodeConfig(options('windows', true)))).toEqual({
      servers: {
        'agent-collusion-archive': {
          type: 'stdio',
          command: 'cmd.exe',
          args: ['/c', 'npx', '--yes', '@test/archive-mcp@latest'],
          env: { ARCHIVE_API_URL: 'http://127.0.0.1:8787/api' },
        },
      },
    })

    expect(JSON.parse(serializeVsCodeConfig(options('posix', false)))).toEqual({
      servers: {
        'agent-collusion-archive': {
          type: 'stdio',
          command: 'npx',
          args: ['--yes', '@test/archive-mcp@latest'],
        },
      },
    })
  })
})
