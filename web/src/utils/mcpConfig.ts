export type McpPlatform = 'windows' | 'posix'

export interface McpConfigOptions {
  packageName: string
  platform: McpPlatform
  useLocalApi: boolean
}

const SERVER_NAME = 'agent-collusion-archive'
const LOCAL_API_ENV = { ARCHIVE_API_URL: 'http://127.0.0.1:8787/api' }

function getStdioCommand({ packageName, platform }: McpConfigOptions) {
  const packageArgument = `${packageName}@latest`

  return platform === 'windows'
    ? { command: 'cmd.exe', args: ['/c', 'npx', '--yes', packageArgument] }
    : { command: 'npx', args: ['--yes', packageArgument] }
}

function serialize(config: object) {
  return JSON.stringify(config, null, 2)
}

export function serializeKiloConfig(options: McpConfigOptions) {
  const packageArgument = `${options.packageName}@latest`
  const command = options.platform === 'windows'
    ? ['cmd', '/c', 'npx', '--yes', packageArgument]
    : ['npx', '--yes', packageArgument]

  return serialize({
    mcp: {
      [SERVER_NAME]: {
        type: 'local',
        command,
        enabled: true,
        ...(options.useLocalApi ? { environment: LOCAL_API_ENV } : {}),
      },
    },
  })
}

export function serializeClaudeConfig(options: McpConfigOptions) {
  return serialize({
    mcpServers: {
      [SERVER_NAME]: {
        ...getStdioCommand(options),
        ...(options.useLocalApi ? { env: LOCAL_API_ENV } : {}),
      },
    },
  })
}

export function serializeCursorConfig(options: McpConfigOptions) {
  return serialize({
    mcpServers: {
      [SERVER_NAME]: {
        type: 'stdio',
        ...getStdioCommand(options),
        ...(options.useLocalApi ? { env: LOCAL_API_ENV } : {}),
      },
    },
  })
}

export function serializeVsCodeConfig(options: McpConfigOptions) {
  return serialize({
    servers: {
      [SERVER_NAME]: {
        type: 'stdio',
        ...getStdioCommand(options),
        ...(options.useLocalApi ? { env: LOCAL_API_ENV } : {}),
      },
    },
  })
}
