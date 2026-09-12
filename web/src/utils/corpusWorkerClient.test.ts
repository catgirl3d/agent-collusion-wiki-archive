import { afterEach, describe, expect, it, vi } from 'vitest'
import type { CorpusWorkerRequest, CorpusWorkerResponse } from './corpus'
import {
  createCorpusRequestId,
  isCorpusWorkerAvailable,
  postCorpusRequest,
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

  it('reports a fatal worker error and retries with a fresh worker', () => {
    vi.stubGlobal('Worker', FakeWorker as unknown as typeof Worker)

    const listener = vi.fn()
    subscribeCorpusWorker(listener)

    postCorpusRequest(request(1))
    const failed = FakeWorker.instances[0]
    failed.fail()

    expect(failed.terminated).toBe(true)
    expect(listener).toHaveBeenCalledWith({
      type: 'error',
      requestId: 1,
      error: 'corpus search worker failed to load',
      code: 'worker_failed',
    })

    postCorpusRequest(request(2))
    expect(FakeWorker.instances).toHaveLength(2)
    expect(FakeWorker.instances[1].messages).toEqual([request(2)])
  })

  it('ignores a late error from a worker that is no longer shared', () => {
    vi.stubGlobal('Worker', FakeWorker as unknown as typeof Worker)

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

  it('reports a synchronous construction failure without crashing and retries', () => {
    class BlockedWorker {
      static attempts = 0
      constructor() {
        BlockedWorker.attempts += 1
        throw new Error('blocked by policy')
      }
    }
    vi.stubGlobal('Worker', BlockedWorker as unknown as typeof Worker)

    const listener = vi.fn()
    subscribeCorpusWorker(listener)

    expect(() => postCorpusRequest(request(5))).not.toThrow()
    expect(listener).toHaveBeenCalledWith({
      type: 'error',
      requestId: 5,
      error: 'corpus search worker failed to load',
      code: 'worker_failed',
    })

    postCorpusRequest(request(6))
    expect(BlockedWorker.attempts).toBe(2)
  })

  it('reports unavailable without Worker and ignores posts', () => {
    vi.stubGlobal('Worker', undefined)

    expect(isCorpusWorkerAvailable()).toBe(false)
    expect(() => postCorpusRequest(request(1))).not.toThrow()
    expect(FakeWorker.instances).toHaveLength(0)
  })
})
