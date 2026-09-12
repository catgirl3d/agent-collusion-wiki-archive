import { afterEach, describe, expect, it, vi } from 'vitest'
import { loadJson } from './api'

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
