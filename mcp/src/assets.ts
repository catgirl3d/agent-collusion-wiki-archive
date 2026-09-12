import { DEFAULT_API_URL, readBaseUrl, readTimeoutMs } from './api.js'

export const DATA_PATHS = {
  summary: '/data/summary.json',
  pages: '/data/pages.json',
  timeline: '/data/timeline.json',
  activityByDay: '/data/activity_by_day.json',
  activityByHour: '/data/activity_by_hour.json',
  corpus: '/data/corpus/revisions.jsonl.gz',
} as const

export type DataPath = (typeof DATA_PATHS)[keyof typeof DATA_PATHS]

export const JSON_ASSET_MAX_BYTES = 4 * 1024 * 1024
export const CORPUS_MAX_RECEIVED_BYTES = 64 * 1024 * 1024
export const CORPUS_MAX_GZIP_BYTES = 8 * 1024 * 1024
export const CORPUS_MAX_DECODED_BYTES = 64 * 1024 * 1024
export const CORPUS_MAX_ROWS = 100_000

export type ArchiveDataCode =
  | 'archive_data_unavailable'
  | 'archive_data_invalid'
  | 'archive_data_too_large'

export class ArchiveDataError extends Error {
  readonly code: ArchiveDataCode

  constructor(code: ArchiveDataCode, message: string) {
    super(message)
    this.name = 'ArchiveDataError'
    this.code = code
  }
}

export function isValidDataPath(path: string): path is DataPath {
  return (Object.values(DATA_PATHS) as string[]).includes(path)
}

export function isGzip(bytes: Uint8Array): boolean {
  return bytes.length >= 2 && bytes[0] === 0x1f && bytes[1] === 0x8b
}

async function readBoundedBytes(response: Response, maxBytes: number, label: string): Promise<Uint8Array> {
  const contentLength = Number(response.headers?.get?.('content-length'))
  if (Number.isFinite(contentLength) && contentLength > maxBytes) {
    await response.body?.cancel().catch(() => undefined)
    throw new ArchiveDataError('archive_data_too_large', `${label} is too large (${contentLength} bytes)`)
  }

  if (!response.body) {
    const buffer = new Uint8Array(await response.arrayBuffer())
    if (buffer.byteLength > maxBytes) {
      throw new ArchiveDataError('archive_data_too_large', `${label} is too large (${buffer.byteLength} bytes)`)
    }
    return buffer
  }

  const reader = response.body.getReader()
  const chunks: Uint8Array[] = []
  let size = 0
  try {
    while (true) {
      const { done, value } = await reader.read()
      if (done) break
      size += value.byteLength
      if (size > maxBytes) {
        await reader.cancel().catch(() => undefined)
        throw new ArchiveDataError('archive_data_too_large', `${label} is too large (over ${maxBytes} bytes)`)
      }
      chunks.push(value)
    }
  } finally {
    reader.releaseLock()
  }

  const merged = new Uint8Array(size)
  let offset = 0
  for (const chunk of chunks) {
    merged.set(chunk, offset)
    offset += chunk.byteLength
  }
  return merged
}

export type ArchiveAssetsOptions = {
  baseUrl?: string
  fetchImpl?: typeof globalThis.fetch
  timeoutMs?: number
}

/**
 * Fixed-path reader for published static data assets. It shares origin and
 * timeout validation with the API client but never accepts arbitrary paths.
 */
export class ArchiveAssets {
  private readonly baseUrl: URL
  private readonly fetchImpl: typeof globalThis.fetch
  private readonly timeoutMs: number

  constructor(options: ArchiveAssetsOptions = {}) {
    const baseUrlLabel = options.baseUrl === undefined ? 'ARCHIVE_API_URL' : 'baseUrl'
    this.baseUrl = readBaseUrl(options.baseUrl ?? process.env.ARCHIVE_API_URL ?? DEFAULT_API_URL, baseUrlLabel)
    this.fetchImpl = options.fetchImpl ?? globalThis.fetch.bind(globalThis)
    this.timeoutMs = readTimeoutMs(options.timeoutMs)
  }

  async getJson<T>(path: DataPath, maxBytes = JSON_ASSET_MAX_BYTES): Promise<T> {
    const bytes = await this.requestBytes(path, maxBytes)
    try {
      return JSON.parse(new TextDecoder().decode(bytes)) as T
    } catch {
      throw new ArchiveDataError('archive_data_invalid', `${path} is not valid JSON`)
    }
  }

  async getBytes(path: DataPath, maxBytes: number): Promise<Uint8Array> {
    return this.requestBytes(path, maxBytes)
  }

  private async requestBytes(path: string, maxBytes: number): Promise<Uint8Array> {
    if (!isValidDataPath(path)) {
      throw new ArchiveDataError('archive_data_invalid', `unsupported data path: ${path}`)
    }

    const url = new URL(path, this.baseUrl)
    const controller = new AbortController()
    const timeout = setTimeout(() => controller.abort(), this.timeoutMs)

    try {
      const response = await this.fetchImpl(url, {
        method: 'GET',
        headers: { accept: 'application/json, application/octet-stream' },
        redirect: 'error',
        signal: controller.signal,
      })

      if (!response.ok) {
        await response.body?.cancel().catch(() => undefined)
        throw new ArchiveDataError('archive_data_unavailable', `${path} returned HTTP ${response.status}`)
      }

      const contentType = (response.headers?.get?.('content-type') ?? '').toLowerCase()
      if (contentType.includes('text/html')) {
        await response.body?.cancel().catch(() => undefined)
        throw new ArchiveDataError('archive_data_invalid', `${path} returned HTML instead of data`)
      }

      return await readBoundedBytes(response, maxBytes, path)
    } catch (error) {
      if (error instanceof ArchiveDataError) throw error
      if (controller.signal.aborted) {
        throw new ArchiveDataError('archive_data_unavailable', `${path} request timed out after ${this.timeoutMs} ms`)
      }
      throw new ArchiveDataError('archive_data_unavailable', `${path} is unavailable`)
    } finally {
      clearTimeout(timeout)
    }
  }
}
