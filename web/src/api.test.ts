import { afterEach, describe, expect, it, vi } from 'vitest'
import { loadJson, loadText } from './api'

const DATA_BASE = '/data'

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
