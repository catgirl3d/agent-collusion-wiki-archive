import type { CorpusRecord, Summary } from '../types'
import {
  CORPUS_MAX_DECODED_BYTES,
  CORPUS_MAX_GZIP_BYTES,
  CORPUS_MAX_QUERY,
  CORPUS_MAX_RECEIVED_BYTES,
  CORPUS_MAX_ROWS,
  CORPUS_MIN_QUERY,
  CORPUS_URL,
  JSON_ASSET_MAX_BYTES,
  createJsonlParser,
  isGzip,
  isRealDate,
  searchRecords,
} from '../utils/corpus'
import type { CorpusPageMap, CorpusWorkerRequest, CorpusWorkerResponse } from '../utils/corpus'
import { createLruCache } from '../utils/lru'

const PROGRESS_STEP_BYTES = 4 * 1024 * 1024

type CorpusErrorCode = 'invalid_param' | 'archive_data_unavailable' | 'archive_data_invalid' | 'archive_data_too_large'

class CorpusWorkerError extends Error {
  readonly code: CorpusErrorCode

  constructor(code: CorpusErrorCode, message: string) {
    super(message)
    this.name = 'CorpusWorkerError'
    this.code = code
  }
}

const workerScope = self as unknown as {
  postMessage(message: CorpusWorkerResponse): void
  onmessage: ((event: MessageEvent<CorpusWorkerRequest>) => void) | null
}

let summary: Summary | null = null
let version = ''
let loadPromise: Promise<{ records: CorpusRecord[]; pages: CorpusPageMap }> | null = null
const SEARCH_CACHE_CAPACITY = 20
const searchCache = createLruCache<string, ReturnType<typeof searchRecords>>(SEARCH_CACHE_CAPACITY)

let pending: CorpusWorkerRequest | null = null
let running = false

workerScope.onmessage = (event) => {
  const message = event.data
  if (!message || message.type !== 'search') return
  pending = message
  if (!running) void drain()
}

async function drain(): Promise<void> {
  running = true
  while (pending) {
    const request = pending
    pending = null
    await handle(request)
  }
  running = false
}

async function handle(request: CorpusWorkerRequest): Promise<void> {
  try {
    const result = await runSearch(request)
    workerScope.postMessage({ type: 'result', requestId: request.requestId, result })
  } catch (error) {
    workerScope.postMessage({
      type: 'error',
      requestId: request.requestId,
      error: error instanceof Error ? error.message : 'corpus search failed',
      code: error instanceof CorpusWorkerError ? error.code : undefined,
    })
  }
}

function progress(requestId: number, update: Omit<Extract<CorpusWorkerResponse, { type: 'progress' }>, 'type' | 'requestId'>): void {
  workerScope.postMessage({ type: 'progress', requestId, ...update })
}

function assertDate(value: string | undefined, name: string): void {
  if (value === undefined || value === '') return
  if (!isRealDate(value)) throw new CorpusWorkerError('invalid_param', `${name} must be a real UTC date (YYYY-MM-DD)`)
}

async function runSearch(request: CorpusWorkerRequest) {
  const q = request.q.trim()
  if (q.length < CORPUS_MIN_QUERY || q.length > CORPUS_MAX_QUERY) {
    throw new CorpusWorkerError('invalid_param', `q must be between ${CORPUS_MIN_QUERY} and ${CORPUS_MAX_QUERY} characters`)
  }
  assertDate(request.from, 'from')
  assertDate(request.to, 'to')
  if (request.from && request.to && request.from > request.to) {
    throw new CorpusWorkerError('invalid_param', 'from must not be after to')
  }

  const limit = Math.min(100, Math.max(1, Math.floor(request.limit || 20)))
  const offset = Math.min(100_000, Math.max(0, Math.floor(request.offset || 0)))

  summary = await fetchSummary()
  const nextVersion = `${summary.export_generated_at ?? ''}|${summary.corpus?.sha256 ?? ''}`
  if (nextVersion !== version) {
    version = nextVersion
    loadPromise = null
    searchCache.clear()
  }
  if (!summary.corpus) throw new CorpusWorkerError('archive_data_invalid', 'summary.json is missing corpus metadata')

  const key = JSON.stringify([
    summary.corpus.sha256,
    summary.export_generated_at ?? '',
    q,
    request.caseSensitive,
    Boolean(request.wholeWord),
    request.wiki ?? '',
    request.label ?? '',
    request.from ?? '',
    request.to ?? '',
  ])

  let matches = searchCache.get(key)
  if (!matches) {
    progress(request.requestId, { phase: 'search' })
    const loaded = await loadCorpus(request.requestId, summary)
    matches = searchRecords(loaded.records, loaded.pages, {
      q,
      caseSensitive: request.caseSensitive,
      wholeWord: Boolean(request.wholeWord),
      wiki: request.wiki,
      label: request.label,
      from: request.from,
      to: request.to,
    })
    searchCache.set(key, matches)
  }

  return {
    q,
    case_sensitive: request.caseSensitive,
    whole_word: Boolean(request.wholeWord),
    total: matches.length,
    limit,
    offset,
    matches: matches.slice(offset, offset + limit),
  }
}

async function fetchSummary(): Promise<Summary> {
  return fetchJsonBounded<Summary>('/data/summary.json', 'summary.json', { cache: 'no-cache' })
}

async function loadCorpus(requestId: number, current: Summary): Promise<{ records: CorpusRecord[]; pages: CorpusPageMap }> {
  if (loadPromise) return loadPromise
  loadPromise = (async () => {
    const meta = current.corpus
    if (!meta) throw new CorpusWorkerError('archive_data_invalid', 'summary.json is missing corpus metadata')

    let response: Response
    try {
      response = await fetch(CORPUS_URL, { cache: 'no-store' })
    } catch {
      throw new CorpusWorkerError('archive_data_unavailable', 'corpus is unavailable')
    }
    if (!response.ok) {
      throw new CorpusWorkerError('archive_data_unavailable', `corpus returned HTTP ${response.status}`)
    }
    const contentType = response.headers.get('content-type') ?? ''
    if (contentType.includes('text/html')) {
      throw new CorpusWorkerError('archive_data_invalid', 'corpus returned HTML instead of data')
    }

    const totalBytes = Number(response.headers.get('content-length')) || undefined
    const received = await readAll(response, CORPUS_MAX_RECEIVED_BYTES, 'corpus', (loadedBytes) =>
      progress(requestId, { phase: 'download', loadedBytes, totalBytes }),
    )

    let decoded: Uint8Array
    if (isGzip(received)) {
      if (received.byteLength > CORPUS_MAX_GZIP_BYTES) {
        throw new CorpusWorkerError('archive_data_too_large', `corpus gzip exceeds ${CORPUS_MAX_GZIP_BYTES} bytes`)
      }
      const digest = await sha256Hex(received)
      if (digest !== meta.sha256 || received.byteLength !== meta.compressed_bytes) {
        throw new CorpusWorkerError('archive_data_invalid', 'corpus gzip does not match summary metadata')
      }
      decoded = await gunzipInto(received, meta.decoded_bytes, requestId)
    } else {
      decoded = received
    }

    if (decoded.byteLength > CORPUS_MAX_DECODED_BYTES) {
      throw new CorpusWorkerError('archive_data_too_large', `corpus exceeds ${CORPUS_MAX_DECODED_BYTES} decoded bytes`)
    }
    const decodedDigest = await sha256Hex(decoded)
    if (decodedDigest !== meta.decoded_sha256 || decoded.byteLength !== meta.decoded_bytes) {
      throw new CorpusWorkerError('archive_data_invalid', 'corpus data does not match summary metadata')
    }

    const parsed: CorpusRecord[] = []
    const parser = createJsonlParser((record, row) => {
      if (parsed.length >= CORPUS_MAX_ROWS) {
        throw new CorpusWorkerError('archive_data_too_large', `corpus exceeds ${CORPUS_MAX_ROWS} rows`)
      }
      parsed.push(record)
      if (row % 2000 === 0) progress(requestId, { phase: 'decode', rows: row })
    })
    const decoder = new TextDecoder()
    const chunkSize = 1 << 20
    for (let offset = 0; offset < decoded.byteLength; offset += chunkSize) {
      parser.push(decoder.decode(decoded.subarray(offset, offset + chunkSize), { stream: true }))
    }
    parser.push(decoder.decode())
    parser.finish()

    if (parsed.length !== meta.revisions) {
      throw new CorpusWorkerError(
        'archive_data_invalid',
        `corpus has ${parsed.length} rows, summary declares ${meta.revisions}`,
      )
    }
    progress(requestId, { phase: 'decode', rows: parsed.length })

    const pageMap = await fetchPages()
    return { records: parsed, pages: pageMap }
  })()

  try {
    return await loadPromise
  } catch (error) {
    loadPromise = null
    throw error
  }
}

async function fetchPages(): Promise<CorpusPageMap> {
  const file = await fetchJsonBounded<{ p: Array<{ id: string; s?: string; n: string }> }>('/data/pages.json', 'pages.json')
  return new Map(file.p.map((page) => [page.id, page]))
}

async function fetchJsonBounded<T>(path: string, label: string, init?: RequestInit): Promise<T> {
  let response: Response
  try {
    response = await fetch(path, init)
  } catch {
    throw new CorpusWorkerError('archive_data_unavailable', `${label} is unavailable`)
  }
  if (!response.ok) {
    throw new CorpusWorkerError('archive_data_unavailable', `${label} returned HTTP ${response.status}`)
  }
  const contentType = response.headers.get('content-type') ?? ''
  if (contentType.includes('text/html')) {
    throw new CorpusWorkerError('archive_data_invalid', `${label} returned HTML instead of data`)
  }
  const bytes = await readAll(response, JSON_ASSET_MAX_BYTES, label)
  try {
    return JSON.parse(new TextDecoder().decode(bytes)) as T
  } catch {
    throw new CorpusWorkerError('archive_data_invalid', `${label} is not valid JSON`)
  }
}

async function readAll(
  response: Response,
  maxBytes: number,
  label: string,
  onProgress?: (loadedBytes: number) => void,
): Promise<Uint8Array> {
  if (!response.body) {
    const buffer = new Uint8Array(await response.arrayBuffer())
    if (buffer.byteLength > maxBytes) {
      throw new CorpusWorkerError('archive_data_too_large', `${label} exceeds ${maxBytes} bytes`)
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
        throw new CorpusWorkerError('archive_data_too_large', `${label} exceeds ${maxBytes} bytes`)
      }
      chunks.push(value)
      onProgress?.(size)
    }
  } finally {
    reader.releaseLock()
  }
  return mergeChunks(chunks, size)
}

function asArrayBufferView(bytes: Uint8Array): Uint8Array<ArrayBuffer> {
  if (bytes.buffer instanceof ArrayBuffer) {
    return new Uint8Array(bytes.buffer, bytes.byteOffset, bytes.byteLength)
  }
  const copy = new Uint8Array(bytes.byteLength)
  copy.set(bytes)
  return copy
}

async function gunzipInto(bytes: Uint8Array, expectedBytes: number, requestId: number): Promise<Uint8Array> {
  if (typeof DecompressionStream === 'undefined') {
    throw new CorpusWorkerError('archive_data_unavailable', 'this browser cannot decompress the corpus')
  }
  if (expectedBytes > CORPUS_MAX_DECODED_BYTES) {
    throw new CorpusWorkerError('archive_data_too_large', `corpus exceeds ${CORPUS_MAX_DECODED_BYTES} decoded bytes`)
  }
  // The decoded size is known from summary metadata, so decompress into one preallocated buffer
  // instead of retaining a chunk list plus a merged copy (halves peak memory for the 41 MB corpus).
  const output = new Uint8Array(expectedBytes)
  const stream = new Blob([asArrayBufferView(bytes)]).stream().pipeThrough(new DecompressionStream('gzip'))
  const reader = stream.getReader()
  let size = 0
  let reported = 0
  try {
    while (true) {
      const { done, value } = await reader.read()
      if (done) break
      if (size + value.byteLength > output.byteLength) {
        await reader.cancel().catch(() => undefined)
        throw new CorpusWorkerError('archive_data_invalid', 'corpus data does not match summary metadata')
      }
      output.set(value, size)
      size += value.byteLength
      if (size - reported >= PROGRESS_STEP_BYTES) {
        reported = size
        progress(requestId, { phase: 'decode', loadedBytes: size })
      }
    }
  } finally {
    reader.releaseLock()
  }
  if (size !== expectedBytes) {
    throw new CorpusWorkerError('archive_data_invalid', 'corpus data does not match summary metadata')
  }
  return output
}

function mergeChunks(chunks: Uint8Array[], size: number): Uint8Array {
  const merged = new Uint8Array(size)
  let offset = 0
  for (const chunk of chunks) {
    merged.set(chunk, offset)
    offset += chunk.byteLength
  }
  return merged
}

async function sha256Hex(bytes: Uint8Array): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', asArrayBufferView(bytes))
  return [...new Uint8Array(digest)].map((byte) => byte.toString(16).padStart(2, '0')).join('')
}
