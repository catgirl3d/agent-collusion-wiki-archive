import { serveStdio } from '@modelcontextprotocol/server/stdio'
import { createArchiveMcpServer, installShutdownHandlers } from './server.js'

const handle = serveStdio(() => createArchiveMcpServer(), {
  onerror: (error) => {
    console.error(error.message)
  },
})

installShutdownHandlers(handle)
