import { useEffect, useRef, useState, type FocusEvent, type FormEvent } from 'react'
import { useLocation, useNavigate, useSearchParams } from 'react-router-dom'

export function SearchBar() {
  const [searchParams] = useSearchParams()
  const location = useLocation()
  const navigate = useNavigate()
  const inputRef = useRef<HTMLInputElement>(null)
  const containerRef = useRef<HTMLFormElement>(null)

  const routeKey = `${location.pathname}${location.search}`
  const urlQ = location.pathname === '/search' ? (searchParams.get('q') ?? '') : ''
  const [searchState, setSearchState] = useState(() => ({ routeKey, query: urlQ, expanded: false }))
  if (searchState.routeKey !== routeKey) {
    setSearchState({ routeKey, query: urlQ, expanded: false })
  }
  const { query, expanded } = searchState
  const setQuery = (value: string) => { setSearchState((current) => ({ ...current, query: value })); }
  const setExpanded = (value: boolean) => { setSearchState((current) => ({ ...current, expanded: value })); }
  // Never auto-expand on mount: on /search the page has its own search form,
  // and pulling focus into the header input on navigation is disruptive

  // Auto-focus input when expanding
  useEffect(() => {
    if (expanded) {
      inputRef.current?.focus()
      inputRef.current?.select()
    }
  }, [expanded])

  // Global Ctrl+K / Cmd+K shortcut (layout-independent via event.code)
  useEffect(() => {
    function handleKeyDown(event: KeyboardEvent) {
      const isKKey =
        event.code === 'KeyK' ||
        event.key.toLowerCase() === 'k' ||
        event.key.toLowerCase() === 'л'

      if ((event.ctrlKey || event.metaKey) && !event.shiftKey && !event.altKey && isKKey) {
        event.preventDefault()
        setExpanded(true)
        inputRef.current?.focus()
        inputRef.current?.select()
      }
    }
    window.addEventListener('keydown', handleKeyDown)
    return () => { window.removeEventListener('keydown', handleKeyDown); }
  }, [])

  const handleSubmit = (event: FormEvent) => {
    event.preventDefault()
    // The header input collapses on navigation: release DOM focus so it
    // doesn't stick in the invisible zero-width field. Collapse explicitly:
    // submitting the already-current URL navigates nowhere, so the sync
    // effect below would never fire and the bar would stick open.
    inputRef.current?.blur()
    setExpanded(false)
    const trimmed = query.trim()
    const destination = trimmed ? `/search?q=${encodeURIComponent(trimmed)}` : '/search'
    Promise.resolve(navigate(destination)).catch((error: unknown) => {
      console.error('Search navigation failed', error)
    })
  }

  const handleClear = () => {
    setQuery('')
    inputRef.current?.focus()
  }

  const handleBlur = (e: FocusEvent<HTMLFormElement>) => {
    if (containerRef.current?.contains(e.relatedTarget)) {
      return
    }
    if (!query.trim()) {
      setExpanded(false)
    }
  }

  const isMac = typeof navigator !== 'undefined' && /Mac|iPod|iPhone|iPad/.test(navigator.platform ?? '')
  const shortcutText = isMac ? '⌘K' : 'Ctrl K'

  return (
    <form
      ref={containerRef}
      className={`search-bar-form ${expanded ? 'is-expanded' : 'is-collapsed'}`}
      role="search"
      onSubmit={handleSubmit}
      onBlur={handleBlur}
    >
      <button
        type="button"
        className="search-bar-toggle-btn"
        aria-label="Search archive"
        title={`Search archive (${shortcutText})`}
        tabIndex={expanded ? -1 : 0}
        aria-hidden={expanded}
        onClick={() => {
          if (!expanded) {
            setExpanded(true)
            inputRef.current?.focus()
          }
        }}
      >
        <svg
          width="15"
          height="15"
          viewBox="0 0 16 16"
          fill="none"
          stroke="currentColor"
          strokeWidth="2"
          strokeLinecap="round"
          strokeLinejoin="round"
          aria-hidden="true"
        >
          <circle cx="7" cy="7" r="5" />
          <path d="M11 11L15 15" />
        </svg>
      </button>

      <input
        ref={inputRef}
        type="search"
        className="search-bar-input"
        placeholder="Search text / revisions…"
        aria-label="Search revisions text"
        tabIndex={expanded ? 0 : -1}
        value={query}
        onChange={(e) => { setQuery(e.target.value); }}
        onFocus={() => { setExpanded(true); }}
        onKeyDown={(e) => {
          // Escape always collapses: with a non-empty query the field would
          // otherwise stick open (blur alone only closes empty input)
          if (e.key === 'Escape') {
            setExpanded(false)
            inputRef.current?.blur()
          }
        }}
      />

      {expanded && (
        query ? (
          <button
            type="button"
            className="search-bar-clear"
            aria-label="Clear search"
            onClick={handleClear}
          >
            <svg width="12" height="12" viewBox="0 0 12 12" fill="none" stroke="currentColor" strokeWidth="2">
              <path d="M2 2L10 10M10 2L2 10" strokeLinecap="round" />
            </svg>
          </button>
        ) : (
          <kbd className="search-bar-kbd">{shortcutText}</kbd>
        )
      )}
    </form>
  )
}
