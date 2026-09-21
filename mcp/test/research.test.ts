import { createHash } from 'node:crypto'
import { gzipSync } from 'node:zlib'
import { describe, expect, it } from 'vitest'
import { ArchiveDataError, DATA_PATHS } from '../src/assets.js'
import type { AssetReader } from '../src/research.js'
import type { ActivityDay, Summary, SummaryCorpus, TimelineFile } from '../src/research.js'
import {
  ArchiveQueryError,
  ArchiveResearch,
  countOccurrences,
  parseCorpus,
  snippetAround,
} from '../src/research.js'

const corpusRecords = [
  {
    page_id: 'dse/PageA',
    wiki: 'dse',
    seq: 1,
    rev_id: 'a1',
    write_date: '2026-06-18T10:00:00Z',
    label: 'AgentX',
    body: 'STATE5-ID appears twice: STATE5-ID and tunnel host',
  },
  {
    page_id: 'dse/PageA',
    wiki: 'dse',
    seq: 2,
    rev_id: 'a2',
    write_date: '2026-06-19T10:00:00Z',
    label: 'AgentY',
    body: 'other text with Needle',
  },
  {
    page_id: 'dse/PageB',
    wiki: 'dse',
    seq: 1,
    rev_id: 'b1',
    write_date: '2026-06-20T10:00:00Z',
    label: 'AgentX',
    body: 'state5-id lowercase',
  },
]

const corpusPlain = new TextEncoder().encode(`${corpusRecords.map((row) => JSON.stringify(row)).join('\n')}\n`)
const corpusGzip = new Uint8Array(gzipSync(corpusPlain))

function sha256(bytes: Uint8Array): string {
  return createHash('sha256').update(bytes).digest('hex')
}

function makeSummary(
  gzip: Uint8Array = corpusGzip,
  plain: Uint8Array = corpusPlain,
): Summary & { corpus: SummaryCorpus } {
  return {
    export_generated_at: '2026-06-21T00:00:00Z',
    counts: { revisions: corpusRecords.length },
    corpus: {
      path: 'corpus/revisions.jsonl.gz',
      sha256: sha256(gzip),
      compressed_bytes: gzip.byteLength,
      decoded_sha256: sha256(plain),
      decoded_bytes: plain.byteLength,
      revisions: corpusRecords.length,
    },
  }
}

const pages = {
  p: [
    { id: 'dse/PageA', s: 'dse_PageA~', n: 'PageA' },
    { id: 'dse/PageB', s: 'dse_PageB~', n: 'PageB' },
  ],
}

const timeline: TimelineFile = {
  meta: { schema_version: 1, export_generated_at: '2026-06-21T00:00:00Z', count: 3, order: 'time_desc' },
  r: [
    { t: '2026-06-20T10:00:00Z', w: 'dse', id: 'dse/PageB', s: 'dse_PageB~', seq: 1, x: 'AgentX', a: 'form_edit', ip: '20.1', l: 20 },
    { t: '2026-06-19T10:00:00Z', w: 'dse', id: 'dse/PageA', s: 'dse_PageA~', seq: 2, x: 'AgentY', a: 'form_edit', ip: null, l: 18 },
    { t: '2026-06-18T10:00:00Z', w: 'dse', id: 'dse/PageA', s: 'dse_PageA~', seq: 1, x: 'AgentX', a: 'form_edit', ip: null, l: 40 },
  ],
}

const combinedTimeline: TimelineFile = {
  meta: { schema_version: 1, export_generated_at: '2026-06-21T00:00:00Z', count: 4, order: 'time_desc' },
  r: [
    ...timeline.r,
    { t: '2026-06-17T10:00:00Z', w: 'other', id: 'other/Page', s: 'other_Page~', seq: 1, x: null, a: null, ip: null, l: null, partial: true },
  ],
}

const activityDays = [
  { date: '2026-06-18', wiki: 'dse', saves: 5, deletes: 0, reverts: 0, probes: 1, bytes: 100 },
  { date: '2026-06-19', wiki: 'dse', saves: 2, deletes: 1, reverts: 0, probes: 0, bytes: 50 },
  { date: '2026-06-20', wiki: 'probier', saves: 7, deletes: 0, reverts: 0, probes: 0, bytes: 70 },
]

const activityHours = [{ hour: '04', saves: 1 }]

type FakeState = {
  summary: ReturnType<typeof makeSummary>
  calls: string[]
  failCorpus: boolean
  pages: unknown
  timeline: typeof timeline | typeof combinedTimeline
  activityDays: unknown
  activityHours: unknown
}

function fakeAssets(): { state: FakeState; assets: AssetReader } {
  const state: FakeState = {
    summary: makeSummary(),
    calls: [],
    failCorpus: false,
    pages,
    timeline,
    activityDays,
    activityHours,
  }
  const assets = {
    async getJson(path: string) {
      state.calls.push(path)
      switch (path) {
        case DATA_PATHS.summary:
          return state.summary
        case DATA_PATHS.pages:
          return state.pages
        case DATA_PATHS.timeline:
          return state.timeline
        case DATA_PATHS.activityByDay:
          return state.activityDays
        case DATA_PATHS.activityByHour:
          return state.activityHours
        default:
          throw new Error(`unexpected path ${path}`)
      }
    },
    async getBytes(path: string) {
      state.calls.push(path)
      if (path !== DATA_PATHS.corpus) throw new Error(`unexpected path ${path}`)
      if (state.failCorpus) throw new ArchiveDataError('archive_data_unavailable', 'corpus is unavailable')
      return corpusGzip
    },
  } as unknown as AssetReader
  return { state, assets }
}

describe('parseCorpus', () => {
  it('verifies both representations and normalizes gzip records', () => {
    const records = parseCorpus(corpusGzip, makeSummary())
    expect(records).toHaveLength(3)
    expect(records[0]).toEqual({
      w: 'dse',
      id: 'dse/PageA',
      seq: 1,
      t: '2026-06-18T10:00:00Z',
      x: 'AgentX',
      body: 'STATE5-ID appears twice: STATE5-ID and tunnel host',
    })
  })

  it('accepts plain JSONL when the delivery layer already decoded the gzip', () => {
    expect(parseCorpus(corpusPlain, makeSummary())).toHaveLength(3)
  })

  it('rejects mismatched hashes, malformed rows, and oversized input', () => {
    const tampered = new Uint8Array(corpusGzip)
    tampered[tampered.length - 1] ^= 0xff
    expect(() => parseCorpus(tampered, makeSummary())).toThrow(ArchiveDataError)

    const wrongSummary = makeSummary()
    wrongSummary.corpus.decoded_sha256 = '0'.repeat(64)
    expect(() => parseCorpus(corpusPlain, wrongSummary)).toThrow(ArchiveDataError)

    const malformed = new TextEncoder().encode(`${JSON.stringify(corpusRecords[0])}\nnot json\n`)
    const malformedSummary = makeSummary(corpusGzip, malformed)
    expect(() => parseCorpus(malformed, malformedSummary)).toThrow('corpus row 2 is not valid JSON')

    const oversized = new Uint8Array(8 * 1024 * 1024 + 1)
    oversized[0] = 0x1f
    oversized[1] = 0x8b
    const oversizedError = (() => {
      try {
        parseCorpus(oversized, makeSummary())
      } catch (error) {
        return error
      }
      return null
    })()
    expect((oversizedError as ArchiveDataError).code).toBe('archive_data_too_large')
  })

  it('rejects a corpus whose row count disagrees with the summary', () => {
    const summary = makeSummary()
    summary.corpus.revisions = 99
    expect(() => parseCorpus(corpusGzip, summary)).toThrow('corpus has 3 rows, summary declares 99')
  })
})

describe('literal matching', () => {
  it('counts non-overlapping occurrences case-insensitively by default', () => {
    expect(countOccurrences('aaaa', 'aa', true)).toEqual({ count: 2, first: 0 })
    expect(countOccurrences('STATe5-ID state5-id', 'state5-id', false)).toEqual({ count: 2, first: 0 })
    expect(countOccurrences('STATe5-ID state5-id', 'state5-id', true)).toEqual({ count: 1, first: 10 })
    expect(countOccurrences('nothing here', 'zzz', false)).toEqual({ count: 0, first: -1 })
  })

  it('builds whitespace-collapsed snippets around the first match', () => {
    const body = `${'x'.repeat(100)}\nvALUE\t  inside   ${'y'.repeat(100)}`
    const snippet = snippetAround(body, 100, 'value'.length)
    expect(snippet).toContain('vALUE inside')
    expect(snippet).not.toMatch(/\s{2,}/)
  })
})

describe('ArchiveResearch searchCorpus', () => {
  it('returns exact totals, occurrences, and filters', async () => {
    const { assets } = fakeAssets()
    const research = new ArchiveResearch(assets)

    const lower = await research.searchCorpus({ q: 'state5-id' })
    expect(lower.total).toBe(2)
    expect(lower.matches.map((match) => match.id)).toEqual(['dse/PageB', 'dse/PageA'])
    expect(lower.matches[1]).toMatchObject({ n: 'PageA', s: 'dse_PageA~', occurrences: 2, x: 'AgentX' })
    expect(lower.matches[1].snippet).toContain('STATE5-ID')

    const cased = await research.searchCorpus({ q: 'STATE5-ID', caseSensitive: true })
    expect(cased.total).toBe(1)

    const labelled = await research.searchCorpus({ q: 'needle', label: 'AgentY' })
    expect(labelled.total).toBe(1)
    expect(labelled.matches[0].id).toBe('dse/PageA')

    const ranged = await research.searchCorpus({ q: 'state5-id', from: '2026-06-19', to: '2026-06-20' })
    expect(ranged.total).toBe(1)

    const wrongWiki = await research.searchCorpus({ q: 'state5-id', wiki: 'probier' })
    expect(wrongWiki.total).toBe(0)
  })

  it('reuses the last query result for offset pagination without reloading the corpus', async () => {
    const { state, assets } = fakeAssets()
    const research = new ArchiveResearch(assets)

    const first = await research.searchCorpus({ q: 'state5-id', limit: 1, offset: 0 })
    const corpusLoads = state.calls.filter((path) => path === DATA_PATHS.corpus).length
    const second = await research.searchCorpus({ q: 'state5-id', limit: 1, offset: 1 })

    expect(first.total).toBe(2)
    expect(second.total).toBe(2)
    expect(state.calls.filter((path) => path === DATA_PATHS.corpus).length).toBe(corpusLoads)
    expect(second.matches[0].id).toBe('dse/PageA')
    expect(second.offset).toBe(1)
  })

  it('rejects a structurally invalid pages.json with archive_data_invalid', async () => {
    const { state, assets } = fakeAssets()
    state.pages = { unexpected: true }
    const research = new ArchiveResearch(assets)

    await expect(research.searchCorpus({ q: 'state5-id' })).rejects.toMatchObject({ code: 'archive_data_invalid' })
  })

  it('rejects null page entries with archive_data_invalid', async () => {
    const { state, assets } = fakeAssets()
    state.pages = { p: [null] }
    const research = new ArchiveResearch(assets)

    await expect(research.searchCorpus({ q: 'state5-id' })).rejects.toMatchObject({ code: 'archive_data_invalid' })
  })

  it('fails closed when a match references a page missing from pages.json', async () => {
    const { state, assets } = fakeAssets()
    state.pages = { p: [pages.p[0]] }
    const research = new ArchiveResearch(assets)

    await expect(research.searchCorpus({ q: 'lowercase' })).rejects.toMatchObject({ code: 'archive_data_invalid' })
  })

  it('validates query length and date ranges', async () => {
    const { assets } = fakeAssets()
    const research = new ArchiveResearch(assets)

    await expect(research.searchCorpus({ q: 'ab' })).rejects.toBeInstanceOf(ArchiveQueryError)
    await expect(research.searchCorpus({ q: 'abc', from: '2026-06-22', to: '2026-06-18' })).rejects.toThrow(
      'from must not be after to',
    )
  })
})

describe('ArchiveResearch listRevisions and getActivity', () => {
  it('filters and orders the timeline', async () => {
    const { assets } = fakeAssets()
    const research = new ArchiveResearch(assets)

    const byLabel = await research.listRevisions({ label: 'AgentX' })
    expect(byLabel.total).toBe(2)
    const ascending = await research.listRevisions({ label: 'AgentX', order: 'asc' })
    expect(ascending.revisions.map((row) => row.t)).toEqual(['2026-06-18T10:00:00Z', '2026-06-20T10:00:00Z'])

    const byPage = await research.listRevisions({ slug: 'dse_PageA~' })
    expect(byPage.total).toBe(2)

    const byDay = await research.listRevisions({ day: '2026-06-19' })
    expect(byDay.total).toBe(1)
    expect(byDay.revisions[0].x).toBe('AgentY')

    const paged = await research.listRevisions({ limit: 1, offset: 1 })
    expect(paged.total).toBe(3)
    expect(paged.revisions).toHaveLength(1)
    await expect(research.listRevisions({ order: 'sideways' as 'asc' })).rejects.toBeInstanceOf(ArchiveQueryError)
  })

  it('filters daily activity and rejects unsupported hourly filters', async () => {
    const { assets } = fakeAssets()
    const research = new ArchiveResearch(assets)

    const days = await research.getActivity({ by: 'day', wiki: 'dse', from: '2026-06-19' })
    expect(days.total).toBe(1)
    expect(days.rows[0].date).toBe('2026-06-19')

    const hours = await research.getActivity({ by: 'hour' })
    expect(hours).toMatchObject({ by: 'hour', total: 1 })

    await expect(research.getActivity({ by: 'hour', wiki: 'dse' })).rejects.toThrow(
      'hourly activity has no wiki/date dimensions',
    )
  })

  it('rejects structurally invalid activity assets with archive_data_invalid', async () => {
    const { state, assets } = fakeAssets()
    state.activityDays = { unexpected: true }
    await expect(new ArchiveResearch(assets).getActivity({ by: 'day' })).rejects.toMatchObject({
      code: 'archive_data_invalid',
    })

    state.activityHours = { unexpected: true }
    await expect(new ArchiveResearch(assets).getActivity({ by: 'hour' })).rejects.toMatchObject({
      code: 'archive_data_invalid',
    })
  })

  it('rejects malformed activity rows with archive_data_invalid', async () => {
    const { state, assets } = fakeAssets()
    state.activityDays = [{ unexpected: true }]
    await expect(new ArchiveResearch(assets).getActivity({ by: 'day' })).rejects.toMatchObject({
      code: 'archive_data_invalid',
    })

    state.activityHours = [{ unexpected: true }]
    await expect(new ArchiveResearch(assets).getActivity({ by: 'hour' })).rejects.toMatchObject({
      code: 'archive_data_invalid',
    })
  })

  it('accepts a combined timeline with recovered partial rows', async () => {
    const { state, assets } = fakeAssets()
    state.summary = {
      ...state.summary,
      supplement: { counts: { revisions: 1 } },
      combined: { revisions: 4 },
    }
    state.timeline = combinedTimeline

    const result = await new ArchiveResearch(assets).listRevisions({})

    expect(result.total).toBe(4)
    expect(result.revisions.at(-1)).toMatchObject({ id: 'other/Page', partial: true })
  })

  it('rejects a timeline from a different data release than the summary', async () => {
    const { state, assets } = fakeAssets()
    state.summary = { ...state.summary, export_generated_at: '2026-06-22T00:00:00Z' }

    await expect(new ArchiveResearch(assets).listRevisions({})).rejects.toThrow(
      'timeline.json does not match summary generation',
    )
  })

  it('treats a missing summary timestamp the same as an explicit null timeline timestamp', async () => {
    const { state, assets } = fakeAssets()
    state.summary = { ...state.summary, export_generated_at: undefined }
    state.timeline = { ...timeline, meta: { ...timeline.meta, export_generated_at: null } }

    const result = await new ArchiveResearch(assets).listRevisions({})

    expect(result.total).toBe(3)
  })

  it('rejects a timeline when only the summary omits the generation timestamp', async () => {
    const { state, assets } = fakeAssets()
    state.summary = { ...state.summary, export_generated_at: null }

    await expect(new ArchiveResearch(assets).listRevisions({})).rejects.toThrow(
      'timeline.json does not match summary generation',
    )
  })
  it('rejects a timeline whose row count disagrees with the combined summary', async () => {
    const { state, assets } = fakeAssets()
    state.summary = { ...state.summary, combined: { revisions: 4 } }
    state.timeline = { ...timeline, meta: { ...timeline.meta, count: 3 } }

    await expect(new ArchiveResearch(assets).listRevisions({})).rejects.toThrow(
      'timeline.json does not match summary counts',
    )
  })

  it('rejects a summary where canonical and supplement revisions do not sum to combined', async () => {
    const { state, assets } = fakeAssets()
    state.summary = {
      ...state.summary,
      counts: { revisions: 2 },
      supplement: { counts: { revisions: 2 } },
      combined: { revisions: 3 },
    }
    await expect(new ArchiveResearch(assets).listRevisions({})).rejects.toThrow(
      'summary counts do not match combined revisions',
    )
  })

  it('invalidates caches when the summary version changes', async () => {
    const { state, assets } = fakeAssets()
    const research = new ArchiveResearch(assets)

    await research.searchCorpus({ q: 'state5-id' })
    expect(state.calls.filter((path) => path === DATA_PATHS.corpus)).toHaveLength(1)

    state.summary = { ...state.summary, export_generated_at: '2026-06-22T00:00:00Z' }
    const next = await research.searchCorpus({ q: 'state5-id' })
    expect(next.total).toBe(2)
    expect(state.calls.filter((path) => path === DATA_PATHS.corpus)).toHaveLength(2)
  })

  it('does not reuse or overwrite an in-flight corpus load across summary versions', async () => {
    const summaryState = makeSummary()
    let releaseFirst: (() => void) | null = null
    const firstGate = new Promise<void>((resolve) => {
      releaseFirst = () => resolve()
    })
    let corpusCalls = 0

    const assets = {
      async getJson(path: string) {
        switch (path) {
          case DATA_PATHS.summary:
            return summaryState
          case DATA_PATHS.pages:
            return pages
          default:
            throw new Error(`unexpected path ${path}`)
        }
      },
      async getBytes(path: string) {
        if (path !== DATA_PATHS.corpus) throw new Error(`unexpected path ${path}`)
        corpusCalls += 1
        if (corpusCalls === 1) {
          await firstGate
          return corpusGzip
        }
        return corpusGzip
      },
    } as unknown as AssetReader

    const research = new ArchiveResearch(assets)
    const oldest = research.searchCorpus({ q: 'state5-id' })
    await new Promise((resolve) => setTimeout(resolve, 0))

    summaryState.export_generated_at = '2026-06-22T00:00:00Z'
    const newest = await research.searchCorpus({ q: 'state5-id' })
    releaseFirst?.()
    await oldest

    expect(newest.total).toBe(2)
    expect(corpusCalls).toBe(2)

    // The slow first load must not clobber the newer cache entry.
    const cached = await research.searchCorpus({ q: 'state5-id' })
    expect(cached.total).toBe(2)
    expect(corpusCalls).toBe(2)
  })
})
