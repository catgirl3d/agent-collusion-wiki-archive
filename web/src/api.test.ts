import { afterEach, describe, expect, it, vi } from 'vitest'
import { loadJson, loadText, revisionFile } from './api'
import { slugify } from './utils/slug'

const DATA_BASE = '/data'
const CACHE_CAPACITY = 32

function deferred<T>() {
  let resolve!: (value: T | PromiseLike<T>) => void
  let reject!: (reason?: unknown) => void
  const promise = new Promise<T>((resolvePromise, rejectPromise) => {
    resolve = resolvePromise
    reject = rejectPromise
  })
  return { promise, resolve, reject }
}

describe('revisionFile', () => {
  it('uses the slugified page ID when the supplied slug is empty', () => {
    const pageId = 'wiki/Some page'
    expect(revisionFile(pageId, '')).toBe(`revisions/${slugify(pageId)}.json`)
  })
})

function mockFetchOnce(status: number): ReturnType<typeof vi.fn> {
  return vi.fn().mockResolvedValue(new Response('{"x":1}', { status }))
}

describe('loadJson cache', () => {
  afterEach(() => {
    vi.restoreAllMocks()
  })

  it('returns data from the network and caches a successful response', async () => {
    const fetchMock = mockFetchOnce(200)
    vi.stubGlobal('fetch', fetchMock)

    const first = await loadJson<{ x: number }>('pages.json')
    const second = await loadJson<{ x: number }>('pages.json')

    expect(first).toEqual({ x: 1 })
    expect(second).toEqual({ x: 1 })
    expect(fetchMock).toHaveBeenCalledTimes(1)
    expect(fetchMock).toHaveBeenCalledWith(`${DATA_BASE}/pages.json`)
  })

  it('deduplicates concurrent requests for the same path', async () => {
    const response = deferred<Response>()
    const fetchMock = vi.fn().mockReturnValue(response.promise)
    vi.stubGlobal('fetch', fetchMock)

    const first = loadJson<{ x: number }>('concurrent.json')
    const second = loadJson<{ x: number }>('concurrent.json')

    expect(fetchMock).toHaveBeenCalledTimes(1)
    expect(second).toBe(first)
    response.resolve(new Response('{"x":1}', { status: 200 }))
    await expect(first).resolves.toEqual({ x: 1 })
    await expect(second).resolves.toEqual({ x: 1 })
  })

  it('throws on an HTTP error status and does not cache the rejected promise', async () => {
    const fetchMock = vi.fn().mockResolvedValue(new Response('not found', { status: 404 }))
    vi.stubGlobal('fetch', fetchMock)

    await expect(loadJson('missing.json')).rejects.toThrow('HTTP 404 for missing.json')
    await expect(loadJson('missing.json')).rejects.toThrow('HTTP 404 for missing.json')
    expect(fetchMock).toHaveBeenCalledTimes(2)
  })

  it('retries after a network error instead of caching the rejection forever', async () => {
    const fetchMock = vi
      .fn()
      .mockRejectedValueOnce(new TypeError('Failed to fetch'))
      .mockResolvedValueOnce(new Response('{"x":1}', { status: 200 }))
    vi.stubGlobal('fetch', fetchMock)

    await expect(loadJson('flaky.json')).rejects.toThrow('Failed to fetch')
    await expect(loadJson('flaky.json')).resolves.toEqual({ x: 1 })
    expect(fetchMock).toHaveBeenCalledTimes(2)
  })

  it('evicts the least recently used completed response at capacity', async () => {
    const fetchMock = vi.fn().mockImplementation((input: string) => {
      return Promise.resolve(new Response(JSON.stringify({ path: input }), { status: 200 }))
    })
    vi.stubGlobal('fetch', fetchMock)
    const paths = Array.from({ length: CACHE_CAPACITY + 1 }, (_, index) => `eviction-${String(index)}.json`)

    for (const path of paths) {
      await loadJson(path)
    }

    await loadJson(paths[0])
    expect(fetchMock).toHaveBeenCalledTimes(CACHE_CAPACITY + 2)
    await loadJson(paths[paths.length - 1])
    expect(fetchMock).toHaveBeenCalledTimes(CACHE_CAPACITY + 2)
  })

  it('refreshes recency on cache hits before evicting a response', async () => {
    const fetchMock = vi.fn().mockImplementation(() => {
      return Promise.resolve(new Response('{"x":1}', { status: 200 }))
    })
    vi.stubGlobal('fetch', fetchMock)
    const paths = Array.from({ length: CACHE_CAPACITY + 1 }, (_, index) => `recency-${String(index)}.json`)

    for (const path of paths.slice(0, CACHE_CAPACITY)) {
      await loadJson(path)
    }
    await loadJson(paths[0])
    await loadJson(paths[CACHE_CAPACITY])

    expect(fetchMock).toHaveBeenCalledTimes(CACHE_CAPACITY + 1)
    await loadJson(paths[0])
    expect(fetchMock).toHaveBeenCalledTimes(CACHE_CAPACITY + 1)
    await loadJson(paths[1])
    expect(fetchMock).toHaveBeenCalledTimes(CACHE_CAPACITY + 2)
  })

  it('keeps an active request available while completed responses fill the cache', async () => {
    const activeResponse = deferred<Response>()
    const fetchMock = vi.fn().mockImplementation((input: string) => {
      if (input === `${DATA_BASE}/active-during-eviction.json`) return activeResponse.promise
      return Promise.resolve(new Response('{"x":1}', { status: 200 }))
    })
    vi.stubGlobal('fetch', fetchMock)
    const first = loadJson<{ x: number }>('active-during-eviction.json')

    for (let index = 0; index < CACHE_CAPACITY; index++) {
      await loadJson(`completed-during-active-${String(index)}.json`)
    }

    const second = loadJson<{ x: number }>('active-during-eviction.json')
    expect(second).toBe(first)
    expect(fetchMock).toHaveBeenCalledTimes(CACHE_CAPACITY + 1)
    activeResponse.resolve(new Response('{"x":2}', { status: 200 }))
    await expect(Promise.all([first, second])).resolves.toEqual([{ x: 2 }, { x: 2 }])
  })

  it('starts a fresh request after a pending request rejects', async () => {
    const firstResponse = deferred<Response>()
    const secondResponse = deferred<Response>()
    const responses = [firstResponse, secondResponse]
    const fetchMock = vi.fn(() => {
      const response = responses.shift()
      if (!response) throw new Error('Unexpected retry fetch')
      return response.promise
    })
    vi.stubGlobal('fetch', fetchMock)

    const first = loadJson<{ attempt: number }>('retry-pending.json')
    firstResponse.reject(new TypeError('Failed to fetch'))
    await expect(first).rejects.toThrow('Failed to fetch')

    const second = loadJson<{ attempt: number }>('retry-pending.json')
    const secondConsumer = loadJson<{ attempt: number }>('retry-pending.json')
    expect(fetchMock).toHaveBeenCalledTimes(2)
    expect(secondConsumer).toBe(second)
    secondResponse.resolve(new Response('{"attempt":2}', { status: 200 }))
    await expect(Promise.all([second, secondConsumer])).resolves.toEqual([{ attempt: 2 }, { attempt: 2 }])
  })

  it('deduplicates more active paths than the completed cache capacity', async () => {
    const paths = Array.from({ length: CACHE_CAPACITY + 1 }, (_, index) => `parallel-${String(index)}.json`)
    const responses = new Map(paths.map((path) => [
      `${DATA_BASE}/${path}`,
      deferred<Response>(),
    ]))
    const fetchMock = vi.fn((input: string) => {
      const response = responses.get(input)
      if (!response) throw new Error(`Unexpected fetch ${input}`)
      return response.promise
    })
    vi.stubGlobal('fetch', fetchMock)

    const first = paths.map((path) => loadJson<{ path: string }>(path))
    const second = paths.map((path) => loadJson<{ path: string }>(path))

    expect(fetchMock).toHaveBeenCalledTimes(CACHE_CAPACITY + 1)
    for (let index = 0; index < paths.length; index++) {
      const path = paths[index]
      expect(second[index]).toBe(first[index])

      const response = responses.get(`${DATA_BASE}/${path}`)
      if (!response) throw new Error(`Missing deferred response for ${path}`)
      response.resolve(new Response(JSON.stringify({ path }), { status: 200 }))
    }

    const expected = paths.map((path) => ({ path }))
    const results = await Promise.all([...first, ...second])
    expect(results.slice(0, paths.length)).toEqual(expected)
    expect(results.slice(paths.length)).toEqual(expected)
  })
})

describe('loadText cache', () => {
  afterEach(() => {
    vi.restoreAllMocks()
  })

  it('returns text from the network and caches a successful response', async () => {
    const fetchMock = vi.fn().mockResolvedValue(new Response('<h2>Title</h2>', { status: 200 }))
    vi.stubGlobal('fetch', fetchMock)

    const first = await loadText('research/docs/sample.html')
    const second = await loadText('research/docs/sample.html')

    expect(first).toBe('<h2>Title</h2>')
    expect(second).toBe('<h2>Title</h2>')
    expect(fetchMock).toHaveBeenCalledTimes(1)
    expect(fetchMock).toHaveBeenCalledWith(`${DATA_BASE}/research/docs/sample.html`)
  })

  it('throws on an HTTP error status for a missing document', async () => {
    const fetchMock = vi.fn().mockResolvedValue(new Response('missing', { status: 404 }))
    vi.stubGlobal('fetch', fetchMock)

    await expect(loadText('research/docs/missing.html')).rejects.toThrow('HTTP 404 for research/docs/missing.html')
  })
})
