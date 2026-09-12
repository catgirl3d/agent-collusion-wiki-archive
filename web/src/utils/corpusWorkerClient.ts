import type { CorpusWorkerRequest, CorpusWorkerResponse } from './corpus'

export type CorpusWorkerListener = (message: CorpusWorkerResponse) => void

let worker: Worker | null = null
let nextRequestId = 0
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
  getSharedWorker()?.postMessage(request)
}

// The singleton is the point: the worker keeps the decoded corpus and the page map in memory for
// the whole SPA session, so leaving and returning to /search does not trigger a re-download/re-decode.
function getSharedWorker(): Worker | null {
  if (!isCorpusWorkerAvailable()) return null
  if (!worker) {
    worker = new Worker(new URL('../workers/corpusSearch.worker.ts', import.meta.url), { type: 'module' })
    worker.onmessage = (event: MessageEvent<CorpusWorkerResponse>) => {
      for (const listener of [...listeners]) listener(event.data)
    }
  }
  return worker
}

// Test-only teardown: the module singleton survives unmounts by design, so tests must reset it explicitly.
export function resetCorpusWorkerForTests(): void {
  worker?.terminate()
  worker = null
  nextRequestId = 0
  listeners = new Set()
}
