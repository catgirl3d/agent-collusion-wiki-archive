import { useEffect, useMemo, useRef, useState } from 'react'
import type { FormEvent } from 'react'
import { useSearchParams } from 'react-router-dom'
import { useData } from '../components/useQuery'
import { Badge, PageLink } from '../components/ui'
import type { CorpusSearchResult, Summary } from '../types'
import type { CorpusWorkerRequest, CorpusWorkerResponse } from '../utils/corpus'
import { CORPUS_MAX_QUERY, CORPUS_MIN_QUERY, findMatchRanges } from '../utils/corpus'
import {
  createCorpusRequestId,
  isCorpusWorkerAvailable,
  postCorpusRequest,
  subscribeCorpusWorker,
} from '../utils/corpusWorkerClient'
import { fmtBytes, fmtInt, fmtTime } from '../utils/format'

const PAGE_SIZE = 20

type SearchState =
  | { status: 'idle' }
  | { status: 'loading'; message: string }
  | { status: 'ready'; result: CorpusSearchResult }
  | { status: 'error'; message: string; code?: string }

type SearchForm = {
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

function HighlightSnippet({
  snippet,
  query,
  caseSensitive,
  wholeWord,
}: {
  snippet: string
  query: string
  caseSensitive: boolean
  wholeWord: boolean
}) {
  const q = query.trim()
  if (!q) return <>{snippet}</>

  const ranges = findMatchRanges(snippet, q.replace(/\s+/g, ' '), caseSensitive, wholeWord)
  if (!ranges.length) return <>{snippet}</>

  const parts: React.ReactNode[] = []
  let lastIndex = 0
  for (const { start, end } of ranges) {
    if (start > lastIndex) {
      parts.push(snippet.slice(lastIndex, start))
    }
    parts.push(
      <mark key={start} className="mark-search">
        {snippet.slice(start, end)}
      </mark>,
    )
    lastIndex = end
  }

  if (lastIndex < snippet.length) {
    parts.push(snippet.slice(lastIndex))
  }

  return <>{parts}</>
}

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
  const page = Math.max(0, Number(searchParams.get('page') ?? '0') || 0)

  const urlKey = [urlQ, urlWiki, urlLabel, urlFrom, urlTo, urlCase ? '1' : '', urlWord ? '1' : ''].join('\u0000')
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
  // Render-time reset (React "adjusting state when props change"): URL is the source of truth for bookmarkable searches.
  // Clearing the previous ready result here prevents showing stale matches under a new URL while the worker answers.
  if (urlKey !== lastUrlKey) {
    setLastUrlKey(urlKey)
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

  const latestRequest = useRef(0)
  const lastRunKey = useRef('')

  const workerUnavailable = !isCorpusWorkerAvailable()
  const wikis = useMemo(() => Object.keys(summary?.per_wiki ?? {}).sort(), [summary])

  useEffect(() => {
    if (workerUnavailable) return
    return subscribeCorpusWorker((message) => {
      if (!message || message.requestId !== latestRequest.current) return
      if (message.type === 'progress') setState({ status: 'loading', message: progressMessage(message) })
      else if (message.type === 'result') setState({ status: 'ready', result: message.result })
      else setState({ status: 'error', message: message.error, code: message.code })
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
      limit: PAGE_SIZE,
      offset: Math.max(0, Number(searchParams.get('page') ?? '0') || 0) * PAGE_SIZE,
    }
    postCorpusRequest(message)
  }, [searchParams, runId, workerUnavailable])

  const visibleState: SearchState = urlQ.trim() ? state : { status: 'idle' }

  const applySearchParams = (nextForm: SearchForm) => {
    setSearchParams(buildSearchParams(nextForm))
  }

  const submit = (event: FormEvent) => {
    event.preventDefault()
    const next = buildSearchParams(form)
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
    setForm(nextForm)
    if (nextForm.q.trim()) {
      applySearchParams(nextForm)
    }
  }

  const goToPage = (nextPage: number) => {
    const next = new URLSearchParams(searchParams)
    if (nextPage > 0) next.set('page', String(nextPage))
    else next.delete('page')
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
          placeholder={`Literal text (${CORPUS_MIN_QUERY}-${CORPUS_MAX_QUERY} characters)…`}
          value={form.q}
          onChange={(event) => setForm({ ...form, q: event.target.value })}
        />
        <select className="input" value={form.wiki} onChange={(event) => updateFilter({ wiki: event.target.value })}>
          <option value="">all wikis</option>
          {wikis.map((name) => (
            <option key={name} value={name}>{name}</option>
          ))}
        </select>
        <input
          className="input"
          placeholder="Agent label…"
          value={form.label}
          onChange={(event) => setForm({ ...form, label: event.target.value })}
        />
        <label className="muted">from <input className="input" type="date" value={form.from} onChange={(event) => updateFilter({ from: event.target.value })} /></label>
        <label className="muted">to <input className="input" type="date" value={form.to} onChange={(event) => updateFilter({ to: event.target.value })} /></label>
        <label className="muted">
          <input
            type="checkbox"
            checked={form.caseSensitive}
            onChange={(event) => updateFilter({ caseSensitive: event.target.checked })}
          />{' '}
          case sensitive
        </label>
        <label className="muted">
          <input
            type="checkbox"
            checked={form.wholeWord}
            onChange={(event) => updateFilter({ wholeWord: event.target.checked })}
          />{' '}
          whole word
        </label>
        <button type="submit" className="btn">Search</button>
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
              {fmtInt(visibleState.result.total)} matching revisions · page {Math.floor(visibleState.result.offset / PAGE_SIZE) + 1}/{Math.max(1, Math.ceil(visibleState.result.total / PAGE_SIZE))}
            </span>
          </div>
          <div className="table-wrap">
            <table className="tbl">
              <thead>
                <tr>
                  <th>Time</th>
                  <th>Wiki</th>
                  <th>Page</th>
                  <th>Label</th>
                  <th className="num">Hits</th>
                  <th>Snippet</th>
                </tr>
              </thead>
              <tbody>
                {visibleState.result.matches.map((match) => (
                  <tr key={`${match.id}-${match.seq}-${match.t}`}>
                    <td className="muted nowrap">{fmtTime(match.t)}</td>
                    <td>{match.w}</td>
                    <td><PageLink id={match.id} name={match.n} max={60} /></td>
                    <td>{match.x ? <Badge>{match.x}</Badge> : <span className="muted">anon</span>}</td>
                    <td className="num">{fmtInt(match.occurrences)}</td>
                    <td className="muted mono">
                      <HighlightSnippet
                        snippet={match.snippet}
                        query={urlQ}
                        caseSensitive={urlCase}
                        wholeWord={urlWord}
                      />
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          {visibleState.result.matches.length === 0 && <div className="muted">No matches in the selected scope.</div>}
          <div className="pager">
            <button type="button" className="btn ghost" disabled={visibleState.result.offset === 0} onClick={() => goToPage(page - 1)}>← prev</button>
            <button
              type="button"
              className="btn ghost"
              disabled={visibleState.result.offset + PAGE_SIZE >= visibleState.result.total}
              onClick={() => goToPage(page + 1)}
            >
              next →
            </button>
          </div>
        </>
      )}
    </div>
  )
}
