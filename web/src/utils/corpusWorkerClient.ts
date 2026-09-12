import type { CorpusRevisionKey } from '../types'
import type { CorpusSearchEvent, CorpusWorkerRequest, CorpusWorkerResponse } from './corpus'

export type CorpusWorkerListener = (message: CorpusSearchEvent) => void

type PendingBodyRequest = {
  resolve: (body: string) => void
  reject: (error: Error) => void
}

let worker: Worker | null = null
let nextRequestId = 0
let listeners = new Set<CorpusWorkerListener>()
let pendingBodyRequests = new Map<number, PendingBodyRequest>()

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

export function requestRevisionBody(target: CorpusRevisionKey): Promise<string> {
  const shared = getSharedWorker()
  if (!shared) return Promise.reject(new Error('web worker is unavailable'))
  const requestId = createCorpusRequestId()
  return new Promise<string>((resolve, reject) => {
    pendingBodyRequests.set(requestId, { resolve, reject })
    try {
      shared.postMessage({ type: 'body', requestId, w: target.w, id: target.id, seq: target.seq, t: target.t })
    } catch (error) {
      pendingBodyRequests.delete(requestId)
      reject(error instanceof Error ? error : new Error('failed to request revision body'))
    }
  })
}

// The singleton is the point: the worker keeps the decoded corpus and the page map in memory for
// the whole SPA session, so leaving and returning to /search does not trigger a re-download/re-decode.
function getSharedWorker(): Worker | null {
  if (!isCorpusWorkerAvailable()) return null
  if (!worker) {
    worker = new Worker(new URL('../workers/corpusSearch.worker.ts', import.meta.url), { type: 'module' })
    worker.onmessage = (event: MessageEvent<CorpusWorkerResponse>) => {
      const message = event.data
      const pending = message ? pendingBodyRequests.get(message.requestId) : undefined
      if (pending && message.type === 'body') {
        pendingBodyRequests.delete(message.requestId)
        pending.resolve(message.body)
        return
      }
      if (pending && message.type === 'error') {
        pendingBodyRequests.delete(message.requestId)
        pending.reject(new Error(message.error))
        return
      }
      if (message.type === 'body') return
      for (const listener of [...listeners]) listener(message)
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
  for (const pending of pendingBodyRequests.values()) pending.reject(new Error('corpus worker was reset'))
  pendingBodyRequests = new Map()
}
