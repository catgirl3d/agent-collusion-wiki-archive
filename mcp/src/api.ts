export const DEFAULT_API_URL = 'http://127.0.0.1:8787'
const DEFAULT_TIMEOUT_MS = 15_000
const MIN_TIMEOUT_MS = 100
const MAX_TIMEOUT_MS = 120_000
export const MAX_RESPONSE_BYTES = 2_000_000

type QueryValue = string | number | boolean | undefined

export type PageListParams = {
  q?: string
  wiki?: string
  fam?: string
  deleted?: boolean
  minRevs?: number
  sort?: 'revs' | 'labels'
  limit?: number
  offset?: number
}

export type AgentListParams = {
  q?: string
  sort?: 'name' | 'r' | 'pages'
  limit?: number
  offset?: number
}

export type RevisionListParams = {
  label?: string
  withBody?: boolean
  contains?: string
  limit?: number
  offset?: number
}

export type EventListParams = {
  type?: string
  day?: string
  q?: string
  act?: string
  wiki?: string
  limit?: number
  offset?: number
}

export type SearchFtsParams = {
  q: string
  mode?: 'exact' | 'prefix'
  wiki?: string
  limit?: number
  offset?: number
}

export type SearchArtifactsParams = {
  flag?: string
  host?: string
  slug?: string
  id?: string
  wiki?: string
  limit?: number
  offset?: number
}

export type AgentLinksParams = {
  label: string
  other?: string
}

export type ConflictListParams = {
  minChurn?: number
  zzz?: boolean
  front?: boolean
  limit?: number
  offset?: number
}

export interface ArchiveApi {
  getStats(): Promise<unknown>
  searchArchive(query: string, limit?: number): Promise<unknown>
  listAgents(params?: AgentListParams): Promise<unknown>
  getAgent(name: string): Promise<unknown>
  listPages(params?: PageListParams): Promise<unknown>
  getPage(slug: string): Promise<unknown>
  getPageById(id: string): Promise<unknown>
  getPageRevisions(slug: string, params?: RevisionListParams): Promise<unknown>
  listEvents(params?: EventListParams): Promise<unknown>
  searchFts(params: SearchFtsParams): Promise<unknown>
  searchArtifacts(params?: SearchArtifactsParams): Promise<unknown>
  getAgentLinks(params: AgentLinksParams): Promise<unknown>
  listConflicts(params?: ConflictListParams): Promise<unknown>
  getApiContract(): Promise<unknown>
}

export class ArchiveApiError extends Error {
  readonly status?: number

  constructor(message: string, status?: number) {
    super(message)
    this.name = 'ArchiveApiError'
    this.status = status
  }
}

export type ArchiveApiClientOptions = {
  baseUrl?: string
  fetchImpl?: typeof globalThis.fetch
  timeoutMs?: number
}

function readBaseUrl(value: string, label = 'ARCHIVE_API_URL'): URL {
  let url: URL
  try {
    url = new URL(value)
  } catch {
    throw new Error(`${label} must be a valid URL`)
  }

  if (url.protocol !== 'http:' && url.protocol !== 'https:') {
    throw new Error(`${label} must use http or https`)
  }
  if (url.username || url.password || url.search || url.hash) {
    throw new Error(`${label} must not include credentials, query, or fragment`)
  }
  if (url.pathname !== '/' && url.pathname !== '') {
    throw new Error(`${label} must point to the Worker origin`)
  }

  url.pathname = '/'
  return url
}

function readTimeoutMs(configured: number | undefined): number {
  const raw = configured ?? process.env.ARCHIVE_API_TIMEOUT_MS
  if (raw === undefined || (typeof raw === 'string' && raw.trim() === '')) return DEFAULT_TIMEOUT_MS

  const label = configured === undefined ? 'ARCHIVE_API_TIMEOUT_MS' : 'timeoutMs'
  const value = typeof raw === 'string' ? Number(raw) : raw
  if (!Number.isInteger(value) || value < MIN_TIMEOUT_MS || value > MAX_TIMEOUT_MS) {
    throw new Error(`${label} must be an integer between ${MIN_TIMEOUT_MS} and ${MAX_TIMEOUT_MS}`)
  }
  return value
}

function addQuery(url: URL, params: Record<string, QueryValue>): void {
  for (const [key, value] of Object.entries(params)) {
    if (value !== undefined) url.searchParams.set(key, String(value))
  }
}

function pathSegment(value: string): string {
  return encodeURIComponent(value)
}

function oversizedResponseError(): ArchiveApiError {
  return new ArchiveApiError('Archive API response is too large; reduce limit or omit revision bodies')
}

async function readResponseBody(response: Response): Promise<string> {
  const contentLength = Number(response.headers.get('content-length'))
  if (Number.isFinite(contentLength) && contentLength > MAX_RESPONSE_BYTES) {
    await response.body?.cancel().catch(() => undefined)
    throw oversizedResponseError()
  }

  if (!response.body) {
    const body = await response.text()
    if (Buffer.byteLength(body, 'utf8') > MAX_RESPONSE_BYTES) throw oversizedResponseError()
    return body
  }

  const reader = response.body.getReader()
  const decoder = new TextDecoder()
  let body = ''
  let size = 0
  try {
    while (true) {
      const { done, value } = await reader.read()
      if (done) break
      size += value.byteLength
      if (size > MAX_RESPONSE_BYTES) {
        await reader.cancel().catch(() => undefined)
        throw oversizedResponseError()
      }
      body += decoder.decode(value, { stream: true })
    }
  } finally {
    reader.releaseLock()
  }

  return body + decoder.decode()
}

export class ArchiveApiClient implements ArchiveApi {
  private readonly baseUrl: URL
  private readonly fetchImpl: typeof globalThis.fetch
  private readonly timeoutMs: number

  constructor(options: ArchiveApiClientOptions = {}) {
    const baseUrlLabel = options.baseUrl === undefined ? 'ARCHIVE_API_URL' : 'baseUrl'
    this.baseUrl = readBaseUrl(options.baseUrl ?? process.env.ARCHIVE_API_URL ?? DEFAULT_API_URL, baseUrlLabel)
    this.fetchImpl = options.fetchImpl ?? globalThis.fetch.bind(globalThis)
    this.timeoutMs = readTimeoutMs(options.timeoutMs)
  }

  async getStats(): Promise<unknown> {
    return this.request('/api/stats')
  }

  async searchArchive(query: string, limit?: number): Promise<unknown> {
    return this.request('/api/search', { q: query, limit })
  }

  async listAgents(params: AgentListParams = {}): Promise<unknown> {
    return this.request('/api/agents', params)
  }

  async getAgent(name: string): Promise<unknown> {
    return this.request(`/api/agents/${pathSegment(name)}`)
  }

  async listPages(params: PageListParams = {}): Promise<unknown> {
    return this.request('/api/pages', params)
  }

  async getPage(slug: string): Promise<unknown> {
    return this.request(`/api/pages/${pathSegment(slug)}`)
  }

  async getPageById(id: string): Promise<unknown> {
    return this.request('/api/pages/by-id', { id })
  }

  async getPageRevisions(slug: string, params: RevisionListParams = {}): Promise<unknown> {
    const { withBody = false, ...query } = params
    return this.request(`/api/pages/${pathSegment(slug)}/revisions`, {
      ...query,
      body: withBody ? '1' : '0',
    })
  }

  async listEvents(params: EventListParams = {}): Promise<unknown> {
    return this.request('/api/events', params)
  }

  async searchFts(params: SearchFtsParams): Promise<unknown> {
    return this.request('/api/fts', params)
  }

  async searchArtifacts(params: SearchArtifactsParams = {}): Promise<unknown> {
    return this.request('/api/artifacts', params)
  }

  async getAgentLinks(params: AgentLinksParams): Promise<unknown> {
    return this.request('/api/links', params)
  }

  async listConflicts(params: ConflictListParams = {}): Promise<unknown> {
    return this.request('/api/conflicts', params)
  }

  async getApiContract(): Promise<unknown> {
    return this.request('/api/openapi')
  }

  private async request<T>(path: string, params: Record<string, QueryValue> = {}): Promise<T> {
    if (!path.startsWith('/api/')) throw new Error('ArchiveApiClient only supports Worker API routes')

    const url = new URL(path, this.baseUrl)
    addQuery(url, params)
    const controller = new AbortController()
    const timeout = setTimeout(() => controller.abort(), this.timeoutMs)

    try {
      const response = await this.fetchImpl(url, {
        method: 'GET',
        headers: { accept: 'application/json' },
        redirect: 'error',
        signal: controller.signal,
      })

      if (!response.ok) {
        await response.body?.cancel().catch(() => undefined)
        throw new ArchiveApiError(`Archive API returned HTTP ${response.status}`, response.status)
      }

      const body = await readResponseBody(response)

      try {
        return JSON.parse(body) as T
      } catch {
        throw new ArchiveApiError('Archive API returned invalid JSON')
      }
    } catch (error) {
      if (error instanceof ArchiveApiError) throw error
      if (controller.signal.aborted) {
        throw new ArchiveApiError(`Archive API request timed out after ${this.timeoutMs} ms`)
      }
      throw new ArchiveApiError('Unable to reach archive API')
    } finally {
      clearTimeout(timeout)
    }
  }
}
