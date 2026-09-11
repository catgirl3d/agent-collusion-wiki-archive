import { serveStdio } from '@modelcontextprotocol/server/stdio'
import { createArchiveMcpServer } from './server.js'

const handle = serveStdio(() => createArchiveMcpServer(), {
  onerror: (error) => {
    console.error(error.message)
  },
})

process.on('SIGINT', () => {
  handle.close().catch((error: unknown) => {
    console.error(error instanceof Error ? error.message : error)
    process.exit(1)
  })
})
