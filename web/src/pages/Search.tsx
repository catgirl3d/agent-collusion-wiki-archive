import { useEffect, useMemo, useRef, useState } from 'react'
import type { FormEvent } from 'react'
import { useSearchParams } from 'react-router-dom'
import { ArchiveCalendar } from '../components/ArchiveCalendar'
import { Dropdown } from '../components/Dropdown'
import { useData } from '../components/useQuery'
import { Badge, Button, LoadMore, PageLink, SortHeader } from '../components/ui'
import type { CorpusMatch, CorpusRevisionKey, CorpusSearchResult, Summary } from '../types'
import type { CorpusWorkerRequest, CorpusWorkerResponse } from '../utils/corpus'
import {
  CORPUS_MAX_QUERY,
  CORPUS_MIN_QUERY,
  CORPUS_SORT_DEFAULT,
  CORPUS_SORT_DEFAULTS,
  CORPUS_SORT_KEYS,
  findMatchRanges,
  type CorpusSortKey,
} from '../utils/corpus'
import {
  createCorpusRequestId,
  isCorpusWorkerAvailable,
  postCorpusRequest,
  requestRevisionBody,
  subscribeCorpusWorker,
} from '../utils/corpusWorkerClient'
import { fmtBytes, fmtInt, fmtTime } from '../utils/format'
import { resolveSort, updateSortSearchParams, writeSortParams } from '../utils/sort'
import { applyDateBound } from '../utils/dateRange'

const PAGE_SIZE = 20
const MAX_PAGE = 5_000

type SearchState =
  | { status: 'idle' }
  | { status: 'loading'; message: string }
  | { status: 'ready'; result: CorpusSearchResult }
  | { status: 'error'; message: string; code?: string }

interface SearchForm {
  q: string
  wiki: string
  label: string
  from: string
  to: string
  caseSensitive: boolean
  wholeWord: boolean
}

function progressMessage(message: Extract<CorpusWorkerResponse, { type: 'progress' }>): string {
  if (message.phase === 'download') {
    return message.totalBytes
      ? `downloading corpus ${fmtBytes(message.loadedBytes ?? 0)} / ${fmtBytes(message.totalBytes)}`
      : `downloading corpus ${fmtBytes(message.loadedBytes ?? 0)}`
  }
  if (message.phase === 'decode') {
    return message.rows ? `decoding corpus (${fmtInt(message.rows)} rows)` : 'decoding corpus…'
  }
  return 'searching…'
}

function HighlightText({
  text,
  query,
  caseSensitive,
  wholeWord,
  normalizeWhitespace = true,
}: {
  text: string
  query: string
  caseSensitive: boolean
  wholeWord: boolean
  normalizeWhitespace?: boolean
}) {
  const q = query.trim()
  if (!q) return <>{text}</>

  const needle = normalizeWhitespace ? q.replace(/\s+/g, ' ') : q
  const ranges = findMatchRanges(text, needle, caseSensitive, wholeWord)
  if (!ranges.length) return <>{text}</>

  const parts: React.ReactNode[] = []
  let lastIndex = 0
  for (const { start, end } of ranges) {
    if (start > lastIndex) {
      parts.push(text.slice(lastIndex, start))
    }
    parts.push(
      <mark key={start} className="mark-search">
        {text.slice(start, end)}
      </mark>,
    )
    lastIndex = end
  }

  if (lastIndex < text.length) {
    parts.push(text.slice(lastIndex))
  }

  return <>{parts}</>
}

function rowKey(match: CorpusRevisionKey): string {
  return `${match.w}\u0000${match.id}\u0000${match.seq ?? ''}\u0000${match.t}`
}

type BodyState =
  | { status: 'loading'; open: boolean }
  | { status: 'ready'; open: boolean; body: string }
  | { status: 'error'; open: boolean; message: string }

function buildSearchParams(form: SearchForm): URLSearchParams {
  const next = new URLSearchParams()
  if (form.q.trim()) next.set('q', form.q.trim())
  if (form.wiki) next.set('wiki', form.wiki)
  if (form.label.trim()) next.set('label', form.label.trim())
  if (form.from) next.set('from', form.from)
  if (form.to) next.set('to', form.to)
  if (form.caseSensitive) next.set('case', '1')
  if (form.wholeWord) next.set('word', '1')
  return next
}

export default function Search() {
  const { data: summary } = useData<Summary>('summary.json')
  const [searchParams, setSearchParams] = useSearchParams()
  const urlQ = searchParams.get('q') ?? ''
  const urlWiki = searchParams.get('wiki') ?? ''
  const urlLabel = searchParams.get('label') ?? ''
  const urlFrom = searchParams.get('from') ?? ''
  const urlTo = searchParams.get('to') ?? ''
  const urlCase = searchParams.get('case') === '1'
  const urlWord = searchParams.get('word') === '1'
  const rawPage = searchParams.get('page')
  const parsedPage = rawPage === null ? 0 : Number(rawPage)
  const page = Number.isFinite(parsedPage) ? Math.min(MAX_PAGE, Math.max(0, Math.floor(parsedPage))) : 0
  const rawSort = searchParams.get('sort')
  const rawDir = searchParams.get('dir')
  const sortState = useMemo(
    () => resolveSort(rawSort, rawDir, CORPUS_SORT_KEYS, CORPUS_SORT_DEFAULTS),
    [rawSort, rawDir],
  )

  useEffect(() => {
    const next = new URLSearchParams(searchParams)
    let changed = false
    const beforeSort = next.toString()
    writeSortParams(next, sortState, CORPUS_SORT_DEFAULT)
    changed ||= next.toString() !== beforeSort
    if (rawPage !== null && rawPage !== String(page)) {
      if (page === 0) next.delete('page')
      else next.set('page', String(page))
      changed = true
    }
    if (changed) setSearchParams(next, { replace: true })
  }, [searchParams, setSearchParams, sortState, rawPage, page])

  const urlKey = [urlQ, urlWiki, urlLabel, urlFrom, urlTo, urlCase ? '1' : '', urlWord ? '1' : '', sortState.sort, sortState.dir].join('\u0000')
  const [state, setState] = useState<SearchState>(() =>
    urlQ.trim() ? { status: 'loading', message: 'starting…' } : { status: 'idle' },
  )
  const [form, setForm] = useState<SearchForm>({
    q: urlQ,
    wiki: urlWiki,
    label: urlLabel,
    from: urlFrom,
    to: urlTo,
    caseSensitive: urlCase,
    wholeWord: urlWord,
  })
  const [lastUrlKey, setLastUrlKey] = useState(urlKey)
  const [runId, setRunId] = useState(0)
  const [bodyRows, setBodyRows] = useState<Record<string, BodyState>>({})
  // Render-time reset (React "adjusting state when props change"): URL is the source of truth for bookmarkable searches.
  // Clearing the previous ready result here prevents showing stale matches under a new URL while the worker answers.
  if (urlKey !== lastUrlKey) {
    setLastUrlKey(urlKey)
    setBodyRows({})
    setForm({
      q: urlQ,
      wiki: urlWiki,
      label: urlLabel,
      from: urlFrom,
      to: urlTo,
      caseSensitive: urlCase,
      wholeWord: urlWord,
    })
    setState(urlQ.trim() ? { status: 'loading', message: 'starting…' } : { status: 'idle' })
  }

  const [loadingMore, setLoadingMore] = useState(false)
  const latestRequest = useRef(0)
  const lastRunKey = useRef('')
  const urlKeyRef = useRef(urlKey)

  useEffect(() => {
    urlKeyRef.current = urlKey
  }, [urlKey])

  const workerUnavailable = !isCorpusWorkerAvailable()
  const wikis = useMemo(() => Object.keys(summary?.per_wiki ?? {}).sort(), [summary])

  useEffect(() => {
    if (workerUnavailable) return
    return subscribeCorpusWorker((message) => {
      if (!message || message.requestId !== latestRequest.current) return
      if (message.type === 'progress') setState({ status: 'loading', message: progressMessage(message) })
      else if (message.type === 'result') {
        setLoadingMore(false)
        setState({ status: 'ready', result: message.result })
      }
      else if (message.type === 'error') {
        setLoadingMore(false)
        setState({ status: 'error', message: message.error, code: message.code })
      }
    })
  }, [workerUnavailable])

  useEffect(() => {
    const q = (searchParams.get('q') ?? '').trim()
    if (!q || workerUnavailable) return
    const key = `${searchParams.toString()}|${runId}`
    if (key === lastRunKey.current) return
    lastRunKey.current = key
    const requestId = createCorpusRequestId()
    latestRequest.current = requestId
    const message: CorpusWorkerRequest = {
      type: 'search',
      requestId,
      q,
      wiki: searchParams.get('wiki') || undefined,
      label: searchParams.get('label')?.trim() || undefined,
      from: searchParams.get('from') || undefined,
      to: searchParams.get('to') || undefined,
      caseSensitive: searchParams.get('case') === '1',
      wholeWord: searchParams.get('word') === '1',
      limit: (page + 1) * PAGE_SIZE,
      offset: 0,
      sort: sortState.sort,
      dir: sortState.dir,
    }
    postCorpusRequest(message)
  }, [searchParams, runId, workerUnavailable, sortState.sort, sortState.dir, page])

  const visibleState: SearchState = urlQ.trim() ? state : { status: 'idle' }

  const submit = (event: FormEvent) => {
    event.preventDefault()
    const next = buildSearchParams(form)
    writeSortParams(next, sortState, CORPUS_SORT_DEFAULT)
    if (next.toString() !== searchParams.toString()) {
      setSearchParams(next)
      return
    }
    if (!form.q.trim()) {
      setState({ status: 'idle' })
      return
    }
    setState({ status: 'loading', message: 'starting…' })
    setRunId((id) => id + 1)
  }

  const updateFilter = (patch: Partial<SearchForm>) => {
    const nextForm = { ...form, ...patch }
    // The range boundaries stay ordered: the freshly picked bound wins and the stale one is cleared.
    if ('from' in patch) Object.assign(nextForm, applyDateBound({ from: nextForm.from, to: nextForm.to }, 'from', nextForm.from))
    if ('to' in patch) Object.assign(nextForm, applyDateBound({ from: nextForm.from, to: nextForm.to }, 'to', nextForm.to))
    setForm(nextForm)
    if (nextForm.q.trim()) {
      const next = buildSearchParams(nextForm)
      writeSortParams(next, sortState, CORPUS_SORT_DEFAULT)
      setSearchParams(next)
    }
  }

  const toggleBody = async (match: CorpusMatch) => {
    const key = rowKey(match)
    const requestedUrlKey = urlKey
    const existing = bodyRows[key]
    if (existing?.status === 'error') {
      if (existing.open) {
        setBodyRows((prev) => ({ ...prev, [key]: { ...existing, open: false } }))
        return
      }
    } else if (existing) {
      setBodyRows((prev) => ({ ...prev, [key]: { ...existing, open: !existing.open } }))
      return
    }
    setBodyRows((prev) => ({ ...prev, [key]: { status: 'loading', open: true } }))
    try {
      const body = await requestRevisionBody(match)
      if (urlKeyRef.current !== requestedUrlKey) return
      setBodyRows((prev) => {
        const current = prev[key]
        return { ...prev, [key]: { status: 'ready', open: current?.open ?? true, body } }
      })
    } catch (error) {
      if (urlKeyRef.current !== requestedUrlKey) return
      setBodyRows((prev) => {
        const current = prev[key]
        return {
          ...prev,
          [key]: {
            status: 'error',
            open: current?.open ?? true,
            message: error instanceof Error ? error.message : 'failed to load revision body',
          },
        }
      })
    }
  }

  const goToPage = (nextPage: number) => {
    setLoadingMore(true)
    const next = new URLSearchParams(searchParams)
    if (nextPage > 0) next.set('page', String(nextPage))
    else next.delete('page')
    setSearchParams(next)
  }

  const toggleSort = (key: CorpusSortKey) => {
    const next = updateSortSearchParams(searchParams, sortState, key, CORPUS_SORT_DEFAULTS, CORPUS_SORT_DEFAULT)
    setSearchParams(next)
  }

  if (workerUnavailable && urlQ.trim()) {
    return (
      <div className="page">
        <h1>Text search</h1>
        <div className="error">Error: Web Worker is unavailable in this browser</div>
      </div>
    )
  }

  return (
    <div className="page">
      <h1>Text search</h1>
      <p className="muted">
        Literal substring search across all revision bodies. The corpus is fetched once and scanned locally in your browser
        {summary?.corpus ? ` (~${fmtBytes(summary.corpus.decoded_bytes)} decoded)` : ''}. Results are inert text: archived payloads are never rendered as HTML.
      </p>

      <form className="filters" onSubmit={submit}>
        <input
          className="input"
          aria-label="Search text"
          placeholder={`Literal text (${CORPUS_MIN_QUERY}-${CORPUS_MAX_QUERY} characters)…`}
          value={form.q}
          onChange={(event) => { setForm({ ...form, q: event.target.value }); }}
        />
        <Dropdown
          value={form.wiki}
          ariaLabel="Filter by wiki"
          options={[{ value: '', label: 'all wikis' }, ...wikis.map((name) => ({ value: name, label: name }))]}
          onChange={(value) => { updateFilter({ wiki: value }); }}
        />
        <input
          className="input"
          aria-label="Filter by agent label"
          placeholder="Agent label…"
          value={form.label}
          onChange={(event) => { setForm({ ...form, label: event.target.value }); }}
        />
        <ArchiveCalendar ariaLabel="Filter from date" placeholder="from" value={form.from} onChange={(date) => { updateFilter({ from: date }); }} />
        <ArchiveCalendar ariaLabel="Filter to date" placeholder="to" value={form.to} onChange={(date) => { updateFilter({ to: date }); }} />
        <label className="muted">
          <input
            type="checkbox"
            checked={form.caseSensitive}
            onChange={(event) => { updateFilter({ caseSensitive: event.target.checked }); }}
          />{' '}
          case sensitive
        </label>
        <label className="muted">
          <input
            type="checkbox"
            checked={form.wholeWord}
            onChange={(event) => { updateFilter({ wholeWord: event.target.checked }); }}
          />{' '}
          whole word
        </label>
        <Button type="submit">Search</Button>
      </form>

      {visibleState.status === 'loading' && <div className="loading">{visibleState.message}</div>}
      {visibleState.status === 'error' && (
        <div className="error">
          Error: {visibleState.message}
          {visibleState.code ? <span className="muted"> ({visibleState.code})</span> : null}
        </div>
      )}
      {visibleState.status === 'ready' && (
        <>
          <div className="filters">
            <span className="muted result-count">
              showing {fmtInt(visibleState.result.matches.length)} of {fmtInt(visibleState.result.total)} matching revisions
            </span>
          </div>
          <div className="table-wrap">
            <table className="tbl">
              <thead>
                <tr>
                  <SortHeader label="Time" sortKey="time" current={sortState} onToggle={toggleSort} />
                  <SortHeader label="Wiki" sortKey="wiki" current={sortState} onToggle={toggleSort} />
                  <SortHeader label="Page" sortKey="page" current={sortState} onToggle={toggleSort} />
                  <SortHeader label="Label" sortKey="label" current={sortState} onToggle={toggleSort} />
                  <SortHeader label="Hits" sortKey="hits" current={sortState} numeric onToggle={toggleSort} />
                  <th scope="col">Snippet</th>
                </tr>
              </thead>
              <tbody>
                {visibleState.result.matches.map((match) => {
                  const bodyRow = bodyRows[rowKey(match)]
                  return (
                    <tr key={rowKey(match)}>
                      <td className="muted nowrap">{fmtTime(match.t)}</td>
                      <td>{match.w}</td>
                      <td><PageLink id={match.id} name={match.n} max={60} /></td>
                      <td>{match.x ? <Badge>{match.x}</Badge> : <span className="muted">anon</span>}</td>
                      <td className="num">{fmtInt(match.occurrences)}</td>
                      <td className="muted mono">
                        <HighlightText
                          text={match.snippet}
                          query={urlQ}
                          caseSensitive={urlCase}
                          wholeWord={urlWord}
                        />
                        <div className="snippet-footer">
                          <span className="snippet-meta">
                            {fmtBytes(match.bytes)} · {match.lines === 1 ? '1 line' : `${fmtInt(match.lines)} lines`}
                          </span>
                          <Button
                            variant="ghost"
                            size="sm"
                            disabled={bodyRow?.status === 'loading'}
                            aria-expanded={bodyRow?.open ?? false}
                            onClick={() => {
                              void toggleBody(match)
                            }}
                          >
                            {bodyRow?.status === 'loading' ? 'loading…' : bodyRow?.open ? 'hide full text ▴' : 'full text ▾'}
                          </Button>
                        </div>
                        {bodyRow?.open && bodyRow.status === 'ready' && (
                          <pre className="revision-body">
                            <HighlightText
                              text={bodyRow.body}
                              query={urlQ}
                              caseSensitive={urlCase}
                              wholeWord={urlWord}
                              normalizeWhitespace={false}
                            />
                          </pre>
                        )}
                        {bodyRow?.open && bodyRow.status === 'error' && (
                          <div className="error">Error: {bodyRow.message}</div>
                        )}
                      </td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </div>
          {visibleState.result.matches.length === 0 && <div className="muted">No matches in the selected scope.</div>}
          <LoadMore
            loaded={visibleState.result.matches.length}
            total={visibleState.result.total}
            onLoadMore={() => { goToPage(page + 1); }}
            step={PAGE_SIZE}
            loading={loadingMore}
          />
        </>
      )}
    </div>
  )
}
