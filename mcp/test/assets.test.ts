import { describe, expect, it, vi } from 'vitest'
import { ArchiveAssets, DATA_PATHS } from '../src/assets.js'

function response(body: unknown): Response {
  return new Response(JSON.stringify(body), { headers: { 'content-type': 'application/json' } })
}

describe('ArchiveAssets', () => {
  it.each(['https://host/api', 'https://host'])('resolves static data from the origin for %s', async (baseUrl) => {
    const fetchImpl = vi.fn().mockResolvedValue(response({ ok: true }))
    const assets = new ArchiveAssets({ baseUrl, fetchImpl })

    await expect(assets.getJson(DATA_PATHS.summary)).resolves.toEqual({ ok: true })

    expect(fetchImpl).toHaveBeenCalledTimes(1)
    expect(String(fetchImpl.mock.calls[0][0])).toBe('https://host/data/summary.json')
  })
})
