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
  onerror: (() => void) | null = null
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

  fail() {
    this.onerror?.()
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
    vi.stubGlobal('Worker', FakeWorker)

    const unsubscribe = subscribeCorpusWorker(vi.fn())
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
    vi.stubGlobal('Worker', FakeWorker)

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
    vi.stubGlobal('Worker', FakeWorker)

    const unsubscribeFirstMount = subscribeCorpusWorker(vi.fn())
    const firstId = createCorpusRequestId()
    postCorpusRequest(request(firstId))
    unsubscribeFirstMount()

    const unsubscribeSecondMount = subscribeCorpusWorker(vi.fn())
    const secondId = createCorpusRequestId()
    postCorpusRequest(request(secondId))

    expect(secondId).toBeGreaterThan(firstId)
    expect(FakeWorker.instances[0].messages.map((message) => message.requestId)).toEqual([firstId, secondId])
    unsubscribeSecondMount()
  })

  it('reset terminates the worker, drops subscribers, and restarts ids', () => {
    vi.stubGlobal('Worker', FakeWorker)

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
    expect(() => { postCorpusRequest(request(1)); }).not.toThrow()
    expect(FakeWorker.instances).toHaveLength(0)
  })

  it('resolves a revision body request through the worker round trip', async () => {
    vi.stubGlobal('Worker', FakeWorker)

    const promise = requestRevisionBody({ w: 'dse', id: 'dse/PageA', seq: 1, t: '2026-06-18T10:00:00Z' })
    const message = FakeWorker.instances[0].messages[0]
    expect(message).toMatchObject({ type: 'body', w: 'dse', id: 'dse/PageA', seq: 1, t: '2026-06-18T10:00:00Z' })

    FakeWorker.instances[0].respond({ type: 'body', requestId: message.requestId, body: 'full text' })
    await expect(promise).resolves.toBe('full text')
  })

  it('rejects a revision body request on a worker error response', async () => {
    vi.stubGlobal('Worker', FakeWorker)

    const promise = requestRevisionBody({ w: 'dse', id: 'dse/PageA', seq: null, t: '2026-06-18T10:00:00Z' })
    const message = FakeWorker.instances[0].messages[0]
    FakeWorker.instances[0].respond({ type: 'error', requestId: message.requestId, error: 'revision not found in corpus' })
    await expect(promise).rejects.toThrow('revision not found in corpus')
  })

  it('does not deliver revision body responses to search subscribers', async () => {
    vi.stubGlobal('Worker', FakeWorker)

    const listener = vi.fn()
    subscribeCorpusWorker(listener)
    const promise = requestRevisionBody({ w: 'dse', id: 'dse/PageA', seq: 1, t: '2026-06-18T10:00:00Z' })
    const message = FakeWorker.instances[0].messages[0]
    FakeWorker.instances[0].respond({ type: 'body', requestId: message.requestId, body: 'full text' })

    await expect(promise).resolves.toBe('full text')
    expect(listener).not.toHaveBeenCalled()
  })

  it('rejects pending revision body requests when the worker resets', async () => {
    vi.stubGlobal('Worker', FakeWorker)

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
    vi.stubGlobal('Worker', ThrowingWorker)

    await expect(requestRevisionBody({ w: 'dse', id: 'dse/PageA', seq: 1, t: '2026-06-18T10:00:00Z' })).rejects.toThrow('post failed')

    vi.stubGlobal('Worker', FakeWorker)
    resetCorpusWorkerForTests()
    const promise = requestRevisionBody({ w: 'dse', id: 'dse/PageA', seq: 1, t: '2026-06-18T10:00:00Z' })
    const worker = FakeWorker.instances.at(-1)
    const message = worker?.messages[0]
    if (!worker || !message) throw new Error('Revision body request was not posted')
    worker.respond({ type: 'body', requestId: message.requestId, body: 'recovered' })
    await expect(promise).resolves.toBe('recovered')
  })

  it('reports a synchronous construction failure and retries with a fresh worker', () => {
    class RetryWorker {
      static attempts = 0
      onmessage: ((event: MessageEvent<CorpusWorkerResponse>) => void) | null = null
      onerror: (() => void) | null = null
      messages: CorpusWorkerRequest[] = []

      constructor() {
        RetryWorker.attempts += 1
        if (RetryWorker.attempts === 1) throw new Error('blocked by policy')
      }

      postMessage(message: CorpusWorkerRequest) {
        this.messages.push(message)
      }

      terminate = vi.fn()
    }
    vi.stubGlobal('Worker', RetryWorker)

    const listener = vi.fn()
    subscribeCorpusWorker(listener)

    expect(() => { postCorpusRequest(request(5)); }).not.toThrow()
    expect(listener).toHaveBeenCalledWith({
      type: 'error',
      requestId: 5,
      error: 'corpus search worker failed to load',
      code: 'worker_failed',
    })

    postCorpusRequest(request(6))
    expect(RetryWorker.attempts).toBe(2)
  })

  it('rejects pending body requests and reports asynchronous worker failure before retrying', async () => {
    vi.stubGlobal('Worker', FakeWorker)
    const listener = vi.fn()
    subscribeCorpusWorker(listener)

    postCorpusRequest(request(1))
    const failed = FakeWorker.instances[0]
    const promise = requestRevisionBody({ w: 'dse', id: 'dse/PageA', seq: 1, t: '2026-06-18T10:00:00Z' })

    failed.fail()

    await expect(promise).rejects.toThrow('corpus search worker failed to load')
    expect(listener).toHaveBeenCalledWith({
      type: 'error',
      requestId: 1,
      error: 'corpus search worker failed to load',
      code: 'worker_failed',
    })
    expect(failed.terminated).toBe(true)

    postCorpusRequest(request(2))
    expect(FakeWorker.instances).toHaveLength(2)
    expect(FakeWorker.instances[1].terminated).toBe(false)
  })

  it('ignores a late error from a replaced worker', () => {
    vi.stubGlobal('Worker', FakeWorker)
    const listener = vi.fn()
    subscribeCorpusWorker(listener)

    postCorpusRequest(request(1))
    const stale = FakeWorker.instances[0]
    stale.fail()
    postCorpusRequest(request(2))
    listener.mockClear()

    stale.fail()

    expect(listener).not.toHaveBeenCalled()
    expect(FakeWorker.instances[1].terminated).toBe(false)
  })
})
