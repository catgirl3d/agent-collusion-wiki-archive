import { afterEach, describe, expect, it, vi } from 'vitest'
import type { CorpusWorkerRequest, CorpusWorkerResponse } from './corpus'
import {
  createCorpusRequestId,
  isCorpusWorkerAvailable,
  postCorpusRequest,
  requestRevisionBody,
  resetCorpusWorkerForTests,
  subscribeCorpusWorker,
} from './corpusWorkerClient'

class FakeWorker {
  static instances: FakeWorker[] = []
  onmessage: ((event: MessageEvent<CorpusWorkerResponse>) => void) | null = null
  messages: CorpusWorkerRequest[] = []
  terminated = false

  constructor() {
    FakeWorker.instances.push(this)
  }

  postMessage(message: CorpusWorkerRequest) {
    this.messages.push(message)
  }

  terminate() {
    this.terminated = true
  }

  respond(payload: CorpusWorkerResponse) {
    this.onmessage?.({ data: payload } as MessageEvent<CorpusWorkerResponse>)
  }
}

function request(requestId: number): CorpusWorkerRequest {
  return { type: 'search', requestId, q: 'STATE5-ID', caseSensitive: false, limit: 20, offset: 0 }
}

afterEach(() => {
  resetCorpusWorkerForTests()
  FakeWorker.instances = []
})

describe('corpusWorkerClient', () => {
  it('creates one worker lazily and keeps it alive when subscribers leave', () => {
    vi.stubGlobal('Worker', FakeWorker as unknown as typeof Worker)

    const unsubscribe = subscribeCorpusWorker(() => {})
    expect(FakeWorker.instances).toHaveLength(0)

    postCorpusRequest(request(1))
    expect(FakeWorker.instances).toHaveLength(1)

    unsubscribe()
    postCorpusRequest(request(2))

    expect(FakeWorker.instances).toHaveLength(1)
    expect(FakeWorker.instances[0].terminated).toBe(false)
    expect(FakeWorker.instances[0].messages).toHaveLength(2)
  })

  it('delivers responses to active subscribers only', () => {
    vi.stubGlobal('Worker', FakeWorker as unknown as typeof Worker)

    const first = vi.fn()
    const second = vi.fn()
    const unsubscribeFirst = subscribeCorpusWorker(first)
    subscribeCorpusWorker(second)

    postCorpusRequest(request(1))
    const progress: CorpusWorkerResponse = { type: 'progress', requestId: 1, phase: 'search' }
    FakeWorker.instances[0].respond(progress)
    expect(first).toHaveBeenCalledWith(progress)
    expect(second).toHaveBeenCalledWith(progress)

    unsubscribeFirst()
    const result: CorpusWorkerResponse = {
      type: 'result',
      requestId: 1,
      result: { q: 'STATE5-ID', case_sensitive: false, total: 0, limit: 20, offset: 0, matches: [] },
    }
    FakeWorker.instances[0].respond(result)

    expect(first).toHaveBeenCalledTimes(1)
    expect(second).toHaveBeenCalledTimes(2)
    expect(second).toHaveBeenLastCalledWith(result)
  })

  it('keeps request ids unique across page mount lifetimes', () => {
    vi.stubGlobal('Worker', FakeWorker as unknown as typeof Worker)

    const unsubscribeFirstMount = subscribeCorpusWorker(() => {})
    const firstId = createCorpusRequestId()
    postCorpusRequest(request(firstId))
    unsubscribeFirstMount()

    const unsubscribeSecondMount = subscribeCorpusWorker(() => {})
    const secondId = createCorpusRequestId()
    postCorpusRequest(request(secondId))

    expect(secondId).toBeGreaterThan(firstId)
    expect(FakeWorker.instances[0].messages.map((message) => message.requestId)).toEqual([firstId, secondId])
    unsubscribeSecondMount()
  })

  it('reset terminates the worker, drops subscribers, and restarts ids', () => {
    vi.stubGlobal('Worker', FakeWorker as unknown as typeof Worker)

    const listener = vi.fn()
    subscribeCorpusWorker(listener)
    const firstId = createCorpusRequestId()
    postCorpusRequest(request(firstId))
    const instance = FakeWorker.instances[0]

    resetCorpusWorkerForTests()
    expect(instance.terminated).toBe(true)
    instance.respond({ type: 'progress', requestId: firstId, phase: 'search' })
    expect(listener).not.toHaveBeenCalled()

    expect(createCorpusRequestId()).toBe(1)
    postCorpusRequest(request(1))
    expect(FakeWorker.instances).toHaveLength(2)
  })

  it('reports unavailable without Worker and ignores posts', () => {
    vi.stubGlobal('Worker', undefined)

    expect(isCorpusWorkerAvailable()).toBe(false)
    expect(() => postCorpusRequest(request(1))).not.toThrow()
    expect(FakeWorker.instances).toHaveLength(0)
  })

  it('resolves a revision body request through the worker round trip', async () => {
    vi.stubGlobal('Worker', FakeWorker as unknown as typeof Worker)

    const promise = requestRevisionBody({ w: 'dse', id: 'dse/PageA', seq: 1, t: '2026-06-18T10:00:00Z' })
    const message = FakeWorker.instances[0].messages[0]
    expect(message).toMatchObject({ type: 'body', w: 'dse', id: 'dse/PageA', seq: 1, t: '2026-06-18T10:00:00Z' })

    FakeWorker.instances[0].respond({ type: 'body', requestId: message.requestId, body: 'full text' })
    await expect(promise).resolves.toBe('full text')
  })

  it('rejects a revision body request on a worker error response', async () => {
    vi.stubGlobal('Worker', FakeWorker as unknown as typeof Worker)

    const promise = requestRevisionBody({ w: 'dse', id: 'dse/PageA', seq: null, t: '2026-06-18T10:00:00Z' })
    const message = FakeWorker.instances[0].messages[0]
    FakeWorker.instances[0].respond({ type: 'error', requestId: message.requestId, error: 'revision not found in corpus' })
    await expect(promise).rejects.toThrow('revision not found in corpus')
  })

  it('does not deliver revision body responses to search subscribers', async () => {
    vi.stubGlobal('Worker', FakeWorker as unknown as typeof Worker)

    const listener = vi.fn()
    subscribeCorpusWorker(listener)
    const promise = requestRevisionBody({ w: 'dse', id: 'dse/PageA', seq: 1, t: '2026-06-18T10:00:00Z' })
    const message = FakeWorker.instances[0].messages[0]
    FakeWorker.instances[0].respond({ type: 'body', requestId: message.requestId, body: 'full text' })

    await expect(promise).resolves.toBe('full text')
    expect(listener).not.toHaveBeenCalled()
  })

  it('rejects pending revision body requests when the worker resets', async () => {
    vi.stubGlobal('Worker', FakeWorker as unknown as typeof Worker)

    const promise = requestRevisionBody({ w: 'dse', id: 'dse/PageA', seq: 1, t: '2026-06-18T10:00:00Z' })
    const requestId = FakeWorker.instances[0].messages[0].requestId
    resetCorpusWorkerForTests()
    await expect(promise).rejects.toThrow('corpus worker was reset')

    const listener = vi.fn()
    subscribeCorpusWorker(listener)
    FakeWorker.instances[0].respond({ type: 'body', requestId, body: 'orphan' })
    expect(listener).not.toHaveBeenCalled()
  })

  it('rejects revision body requests without Worker', async () => {
    vi.stubGlobal('Worker', undefined)

    await expect(
      requestRevisionBody({ w: 'dse', id: 'dse/PageA', seq: 1, t: '2026-06-18T10:00:00Z' }),
    ).rejects.toThrow('web worker is unavailable')
  })

  it('cleans up pending body request when postMessage throws synchronously', async () => {
    class ThrowingWorker extends FakeWorker {
      override postMessage() {
        throw new Error('post failed')
      }
    }
    vi.stubGlobal('Worker', ThrowingWorker as unknown as typeof Worker)

    await expect(requestRevisionBody({ w: 'dse', id: 'dse/PageA', seq: 1, t: '2026-06-18T10:00:00Z' })).rejects.toThrow('post failed')

    vi.stubGlobal('Worker', FakeWorker as unknown as typeof Worker)
    resetCorpusWorkerForTests()
    const promise = requestRevisionBody({ w: 'dse', id: 'dse/PageA', seq: 1, t: '2026-06-18T10:00:00Z' })
    const message = FakeWorker.instances.at(-1)?.messages[0]
    expect(message).toBeDefined()
    FakeWorker.instances.at(-1)?.respond({ type: 'body', requestId: message!.requestId, body: 'recovered' })
    await expect(promise).resolves.toBe('recovered')
  })
})
