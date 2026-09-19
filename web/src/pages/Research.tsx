import { useEffect, useMemo, useRef, useState } from 'react'
import { Link, useNavigate, useSearchParams } from 'react-router-dom'
import { Check, Download, Languages, Link2 } from 'lucide-react'
import { loadText } from '../api'
import { Dropdown } from '../components/Dropdown'
import { useData, useJson } from '../components/useQuery'
import type { ResearchDoc, ResearchIndex, ResearchTocItem } from '../types'

function fileName(path: string) {
  return path.split('/').pop() ?? path
}


const DEFAULT_LANGUAGE = 'en'
const NO_TOC: ResearchTocItem[] = []

function familyKey(doc: ResearchDoc): string {
  return doc.base || doc.slug
}

function pickVariant(variants: ResearchDoc[], preferredLang: string): ResearchDoc {
  return (
    variants.find((doc) => doc.lang === preferredLang) ??
    variants.find((doc) => doc.lang === DEFAULT_LANGUAGE) ??
    variants[0]
  )
}

function groupFamilies(docs: ResearchDoc[]): ResearchDoc[][] {
  const families = new Map<string, ResearchDoc[]>()
  for (const doc of docs) {
    const key = familyKey(doc)
    const variants = families.get(key)
    if (variants) variants.push(doc)
    else families.set(key, [doc])
  }
  return [...families.values()]
}

function ResearchSkeleton() {
  return (
    <div className="research-skeleton" aria-busy="true" aria-label="Loading document content">
      <div className="skeleton-line skeleton-title" />
      <div className="skeleton-line skeleton-meta" />
      <div className="skeleton-block">
        <div className="skeleton-line" style={{ width: '96%' }} />
        <div className="skeleton-line" style={{ width: '92%' }} />
        <div className="skeleton-line" style={{ width: '98%' }} />
        <div className="skeleton-line" style={{ width: '70%' }} />
      </div>
      <div className="skeleton-line skeleton-heading" />
      <div className="skeleton-block">
        <div className="skeleton-line" style={{ width: '100%' }} />
        <div className="skeleton-line" style={{ width: '94%' }} />
        <div className="skeleton-line" style={{ width: '88%' }} />
        <div className="skeleton-line" style={{ width: '60%' }} />
      </div>
      <div className="skeleton-line skeleton-heading" />
      <div className="skeleton-block">
        <div className="skeleton-line" style={{ width: '95%' }} />
        <div className="skeleton-line" style={{ width: '91%' }} />
        <div className="skeleton-line" style={{ width: '85%' }} />
      </div>
    </div>
  )
}

const SCROLL_HEADER_OFFSET_PX = 100
const SCROLL_ACTIVE_THRESHOLD_PX = 110 // SCROLL_HEADER_OFFSET_PX + 10px hysteresis
const SCROLL_BOTTOM_THRESHOLD_PX = 60
const SCROLL_LOCK_DURATION_MS = 900

export default function Research() {
  const { data, error } = useData<ResearchIndex>('research/index.json')
  const [searchParams] = useSearchParams()
  const navigate = useNavigate()

  const docs = data?.groups.flatMap((group) => group.docs) ?? []
  const requested = searchParams.get('doc')
  const active = docs.find((doc) => doc.slug === requested) ?? docs[0] ?? null
  const content = useJson(() => (active ? loadText(active.html) : Promise.resolve('')), [active?.html])

  const languages = useMemo(() => data?.languages ?? [], [data])
  const translationsByLang = useMemo(
    () => new Map((active?.translations ?? []).map((translation) => [translation.lang, translation.slug])),
    [active],
  )
  const languageOptions = useMemo(
    () =>
      languages.map((language) => ({
        value: language.code,
        label: language.label,
        disabled: !translationsByLang.has(language.code),
      })),
    [languages, translationsByLang],
  )
  const availableLanguagesCount = languageOptions.filter((option) => !option.disabled).length
  const activeLanguageLabel =
    languages.find((language) => language.code === active?.lang)?.label ?? active?.lang?.toUpperCase() ?? ''

  const [activeId, setActiveId] = useState<string>('')
  const [copied, setCopied] = useState(false)
  const isClickScrollingRef = useRef(false)
  const clickScrollTimerRef = useRef<number | null>(null)

  const metaInfo = active?.meta ?? null
  const toc = active?.toc ?? NO_TOC
  const enrichedHtml = content.data ?? ''
  const hasToc = toc.length > 0

  useEffect(() => {
    if (toc.length === 0 || content.loading) return

    let rafId: number | null = null

    const onScroll = () => {
      if (isClickScrollingRef.current) return
      if (rafId !== null) return
      rafId = requestAnimationFrame(() => {
        rafId = null
        if (isClickScrollingRef.current) return

        const isBottom =
          window.innerHeight + window.scrollY >=
          document.documentElement.scrollHeight - SCROLL_BOTTOM_THRESHOLD_PX

        if (isBottom) {
          setActiveId(toc[toc.length - 1].id)
          return
        }

        const headings = toc
          .map((item) => {
            const el = document.getElementById(item.id)
            return el ? { id: item.id, top: el.getBoundingClientRect().top } : null
          })
          .filter(Boolean) as { id: string; top: number }[]

        if (headings.length === 0) return

        const passed = headings.filter((h) => h.top <= SCROLL_ACTIVE_THRESHOLD_PX)
        if (passed.length > 0) {
          setActiveId(passed[passed.length - 1].id)
        } else {
          setActiveId(headings[0].id)
        }
      })
    }

    const unlock = () => {
      isClickScrollingRef.current = false
      if (clickScrollTimerRef.current !== null) {
        clearTimeout(clickScrollTimerRef.current)
        clickScrollTimerRef.current = null
      }
    }

    window.addEventListener('scroll', onScroll, { passive: true })
    window.addEventListener('wheel', unlock, { passive: true })
    window.addEventListener('touchmove', unlock, { passive: true })
    onScroll()

    return () => {
      window.removeEventListener('scroll', onScroll)
      window.removeEventListener('wheel', unlock)
      window.removeEventListener('touchmove', unlock)
      if (rafId !== null) cancelAnimationFrame(rafId)
      unlock()
    }
  }, [toc, content.loading])

  const handleTocClick = (e: React.MouseEvent<HTMLAnchorElement>, id: string) => {
    e.preventDefault()
    const el = document.getElementById(id)
    if (el) {
      isClickScrollingRef.current = true
      setActiveId(id)
      window.history.replaceState(null, '', `#${id}`)

      const y = el.getBoundingClientRect().top + window.scrollY - SCROLL_HEADER_OFFSET_PX
      window.scrollTo({ top: Math.max(0, y), behavior: 'smooth' })

      if (clickScrollTimerRef.current !== null) {
        clearTimeout(clickScrollTimerRef.current)
      }
      clickScrollTimerRef.current = window.setTimeout(() => {
        isClickScrollingRef.current = false
        clickScrollTimerRef.current = null
      }, SCROLL_LOCK_DURATION_MS)
    }
  }

  const handleCopyLink = () => {
    navigator.clipboard.writeText(window.location.href)
    setCopied(true)
    setTimeout(() => setCopied(false), 2000)
  }

  const handleContentClick = (e: React.MouseEvent<HTMLDivElement>) => {
    const target = (e.target as HTMLElement).closest('a')
    if (!target) return
    const href = target.getAttribute('href')
    if (
      href &&
      (href.startsWith('/page/') || href.startsWith('/search') || href.startsWith('/agents'))
    ) {
      e.preventDefault()
      navigate(href)
    }
  }

  if (error) return <div className="error">Error: {error}</div>
  if (!data) return <div className="loading">Loading…</div>

  return (
    <div className="page">
      <div className="research-page-header">
        <h1>Research</h1>
      </div>

      <div className={`research-layout${hasToc ? ' has-toc' : ''}`}>
        <nav className="card research-nav" aria-label="Research documents">
          {data.groups.map((group) => (
            <section className="research-group" key={group.id}>
              <h2>{group.label}</h2>
              <ul className="research-list">
                {groupFamilies(group.docs).map((variants) => {
                  const navDoc = pickVariant(variants, active?.lang ?? DEFAULT_LANGUAGE)
                  const isActive = active !== null && familyKey(active) === familyKey(navDoc)
                  return (
                    <li key={familyKey(navDoc)}>
                      <Link
                        className={isActive ? 'research-link active' : 'research-link'}
                        to={`/research?doc=${navDoc.slug}`}
                        aria-current={isActive ? 'page' : undefined}
                      >
                        {navDoc.title}
                      </Link>
                    </li>
                  )
                })}
              </ul>
              {group.files.length > 0 && (
                <div className="research-files-section">
                  <div className="research-files-title">Attached files</div>
                  <ul className="research-list research-files">
                    {group.files.map((file) => (
                      <li key={file.raw}>
                        <a href={`/data/${file.raw}`} download={file.name}>
                          {file.name}
                        </a>
                      </li>
                    ))}
                  </ul>
                </div>
              )}
            </section>
          ))}
        </nav>

        <article className="card research-doc">
          {active && (
            <div className="research-doc-meta">
              <div className="research-meta-line">
                <span className="research-badge-status">{metaInfo?.status || 'PRELIMINARY'}</span>
                {metaInfo?.date && (
                  <>
                    <span className="meta-sep" aria-hidden="true">·</span>
                    <span className="meta-item">{metaInfo.date}</span>
                  </>
                )}
                {metaInfo?.author && (
                  <>
                    <span className="meta-sep" aria-hidden="true">·</span>
                    <span className="meta-item">{metaInfo.author}</span>
                  </>
                )}
              </div>
              <div className="research-actions">
                {active && availableLanguagesCount > 1 && (
                  <Dropdown
                    ariaLabel="Select language"
                    className="lang-dropdown-trigger"
                    menuClassName="lang-dropdown-menu"
                    align="right"
                    value={active.lang}
                    options={languageOptions}
                    renderTriggerLabel={() => (
                      <span className="lang-trigger-content">
                        <Languages size={13} className="lang-icon" aria-hidden="true" />
                        <span className="lang-code-text">{activeLanguageLabel}</span>
                      </span>
                    )}
                    onChange={(lang) => {
                      const slug = translationsByLang.get(lang)
                      if (slug && slug !== active.slug) {
                        navigate(`/research?doc=${slug}`)
                      }
                    }}
                  />
                )}
                <button
                  type="button"
                  className={`action-icon-btn${copied ? ' copied' : ''}`}
                  onClick={handleCopyLink}
                  title={copied ? 'Link copied!' : 'Copy link to this document'}
                  aria-label={copied ? 'Link copied!' : 'Copy link'}
                >
                  {copied ? <Check size={14} /> : <Link2 size={14} />}
                </button>
                <a
                  className="action-icon-btn"
                  href={`/data/${active.raw}`}
                  download={fileName(active.source)}
                  title="Download raw Markdown"
                  aria-label="Download raw Markdown"
                >
                  <Download size={14} />
                </a>
              </div>
            </div>
          )}
          {content.error && <div className="error">Error loading document: {content.error}</div>}
          {content.loading ? (
            <ResearchSkeleton />
          ) : (
            <div
              className="markdown-body"
              dangerouslySetInnerHTML={{ __html: enrichedHtml }}
              onClick={handleContentClick}
            />
          )}
        </article>

        {hasToc && (
          <aside
            className={`card research-toc${content.loading ? ' is-loading' : ''}`}
            aria-label="Table of contents"
          >
            <div className="research-toc-header">
              <span className="research-toc-title">On this page</span>
            </div>
            <ul className="research-toc-list">
              {toc.map((item) => {
                const isActive = activeId === item.id

                return (
                  <li key={item.id} className={`research-toc-item level-${item.level}`}>
                    <a
                      href={`#${item.id}`}
                      aria-label={`Jump to ${item.text}`}
                      className={isActive ? 'active' : undefined}
                      onClick={(e) => handleTocClick(e, item.id)}
                    >
                      <span className="toc-node" aria-hidden="true">
                        <span className="toc-node-dot" />
                      </span>
                      <span className="toc-item-text">{item.text}</span>
                    </a>
                  </li>
                )
              })}
            </ul>
            <div className="research-toc-footer">
              <button
                type="button"
                className="btn-back-top"
                onClick={() => window.scrollTo({ top: 0, behavior: 'smooth' })}
              >
                <span>Back to top ↑</span>
              </button>
            </div>
          </aside>
        )}
      </div>
    </div>
  )
}
