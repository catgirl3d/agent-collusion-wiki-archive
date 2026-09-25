import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { CorpusWorkerRequest, CorpusWorkerResponse } from '../utils/corpus'

describe('corpusSearch worker boundary', () => {
  beforeEach(() => {
    vi.resetModules()
  })

  it('sorts the complete match set before applying pagination', async () => {
    const lines = [
      JSON.stringify({ page_id: 'dse/Low', wiki: 'dse', seq: 1, write_date: '2026-06-20T00:00:00Z', label: 'A', body: 'needle' }),
      JSON.stringify({ page_id: 'dse/High', wiki: 'dse', seq: 2, write_date: '2026-06-19T00:00:00Z', label: 'B', body: 'needle needle' }),
    ].join('\n')
    const bytes = new TextEncoder().encode(lines)
    const digest = [...new Uint8Array(await crypto.subtle.digest('SHA-256', bytes))].map((b) => b.toString(16).padStart(2, '0')).join('')
    const summary = { export_generated_at: 'v1', corpus: { sha256: 'unused', compressed_bytes: 0, decoded_sha256: digest, decoded_bytes: bytes.byteLength, revisions: 2 } }
    const responses: Record<string, Response> = {
      '/data/summary.json': new Response(JSON.stringify(summary), { headers: { 'content-type': 'application/json' } }),
      '/data/corpus/revisions.jsonl.gz': new Response(bytes, { headers: { 'content-type': 'application/octet-stream' } }),
      '/data/pages.json': new Response(JSON.stringify({ p: [{ id: 'dse/Low', n: 'Low' }, { id: 'dse/High', n: 'High' }] }), { headers: { 'content-type': 'application/json' } }),
    }
    vi.stubGlobal('fetch', (url: string) => Promise.resolve(responses[url]))
    const posted: CorpusWorkerResponse[] = []
    const scope = { onmessage: null as ((event: MessageEvent<CorpusWorkerRequest>) => void) | null, postMessage: (message: CorpusWorkerResponse) => posted.push(message) }
    vi.stubGlobal('self', scope)
    await import('./corpusSearch.worker')
    if (!scope.onmessage) throw new Error('Worker message handler was not registered')
    scope.onmessage({ data: { type: 'search', requestId: 1, q: 'needle', caseSensitive: false, limit: 1, offset: 0, sort: 'hits', dir: 'desc' } } as MessageEvent<CorpusWorkerRequest>)
    await vi.waitFor(() => { expect(posted.find((message) => message.type === 'result')).toBeDefined(); })
    const result = posted.find((message): message is Extract<CorpusWorkerResponse, { type: 'result' }> => message.type === 'result')
    if (!result) throw new Error('Worker result was not posted')
    expect(result.result.matches.map((match) => match.id)).toEqual(['dse/High'])
  })

  it('reports malformed search parameters without fetching archive data', async () => {
    const fetchMock = vi.fn()
    vi.stubGlobal('fetch', fetchMock)
    const posted: CorpusWorkerResponse[] = []
    const scope = { onmessage: null as ((event: MessageEvent<CorpusWorkerRequest>) => void) | null, postMessage: (message: CorpusWorkerResponse) => posted.push(message) }
    vi.stubGlobal('self', scope)
    await import('./corpusSearch.worker')
    if (!scope.onmessage) throw new Error('Worker message handler was not registered')
    scope.onmessage({ data: { type: 'search', requestId: 2, q: 'x', caseSensitive: false, limit: 1, offset: 0 } } as MessageEvent<CorpusWorkerRequest>)
    await vi.waitFor(() => { expect(posted).toHaveLength(1); })
    expect(posted[0]).toMatchObject({ type: 'error', code: 'invalid_param' })
    expect(fetchMock).not.toHaveBeenCalled()
  })
})
