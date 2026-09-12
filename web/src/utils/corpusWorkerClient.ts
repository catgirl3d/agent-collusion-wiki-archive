import type { CorpusWorkerRequest, CorpusWorkerResponse } from './corpus'

export type CorpusWorkerListener = (message: CorpusWorkerResponse) => void

const WORKER_FAILED_MESSAGE = 'corpus search worker failed to load'

let worker: Worker | null = null
let nextRequestId = 0
let lastRequestId = 0
let listeners = new Set<CorpusWorkerListener>()

export function isCorpusWorkerAvailable(): boolean {
  return typeof Worker !== 'undefined'
}

// Request ids are app-wide because the worker outlives any single page mount: a response for a
// previous mount must never be mistaken for the current page's response.
export function createCorpusRequestId(): number {
  nextRequestId += 1
  return nextRequestId
}

export function subscribeCorpusWorker(listener: CorpusWorkerListener): () => void {
  listeners.add(listener)
  return () => {
    listeners.delete(listener)
  }
}

export function postCorpusRequest(request: CorpusWorkerRequest): void {
  lastRequestId = request.requestId
  getSharedWorker()?.postMessage(request)
}

function broadcast(message: CorpusWorkerResponse): void {
  for (const listener of [...listeners]) listener(message)
}

// A worker that fails to load (missing chunk, parse error, CSP) or dies from an uncaught error never
// answers, so without this the page would keep loading forever. Report the failure under the latest
// request id so the page's request filter accepts it as the answer to its current request.
function reportWorkerFailure(): void {
  broadcast({ type: 'error', requestId: lastRequestId, error: WORKER_FAILED_MESSAGE, code: 'worker_failed' })
}

// The singleton is the point: the worker keeps the decoded corpus and the page map in memory for
// the whole SPA session, so leaving and returning to /search does not trigger a re-download/re-decode.
function getSharedWorker(): Worker | null {
  if (!isCorpusWorkerAvailable()) return null
  if (!worker) {
    let created: Worker
    try {
      created = new Worker(new URL('../workers/corpusSearch.worker.ts', import.meta.url), { type: 'module' })
    } catch {
      reportWorkerFailure()
      return null
    }
    created.onmessage = (event: MessageEvent<CorpusWorkerResponse>) => {
      broadcast(event.data)
    }
    created.onerror = () => {
      // Drop the dead instance so the next request retries with a fresh worker; a late error from
      // an already replaced worker must not surface as a failure of the current request.
      const isCurrent = worker === created
      if (isCurrent) worker = null
      created.terminate()
      if (isCurrent) reportWorkerFailure()
    }
    worker = created
  }
  return worker
}

// Test-only teardown: the module singleton survives unmounts by design, so tests must reset it explicitly.
export function resetCorpusWorkerForTests(): void {
  worker?.terminate()
  worker = null
  nextRequestId = 0
  lastRequestId = 0
  listeners = new Set()
}
