import { useEffect, useMemo, useState } from 'react'
import { Link, useNavigate, useSearchParams } from 'react-router-dom'
import { loadText } from '../api'
import { useData, useJson } from '../components/useQuery'
import type { ResearchIndex } from '../types'

function fileName(path: string) {
  return path.split('/').pop() ?? path
}

function headingToId(text: string): string {
  return text
    .toLowerCase()
    .replace(/<[^>]+>/g, '')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
}

interface TocItem {
  id: string
  text: string
  level: number
}

export default function Research() {
  const { data, error } = useData<ResearchIndex>('research/index.json')
  const [searchParams] = useSearchParams()
  const navigate = useNavigate()

  const docs = data?.groups.flatMap((group) => group.docs) ?? []
  const requested = searchParams.get('doc')
  const active = docs.find((doc) => doc.slug === requested) ?? docs[0] ?? null
  const content = useJson(() => (active ? loadText(active.html) : Promise.resolve('')), [active?.html])

  const [activeId, setActiveId] = useState<string>('')
  const [copied, setCopied] = useState(false)

  const { enrichedHtml, toc, stats, metaInfo } = useMemo(() => {
    if (!content.data) {
      return { enrichedHtml: '', toc: [], stats: null, metaInfo: null }
    }

    const parser = new DOMParser()
    const doc = parser.parseFromString(content.data, 'text/html')

    const rawText = doc.body.textContent || ''
    const words = rawText.trim().split(/\s+/).filter(Boolean).length
    const readingTime = Math.max(1, Math.round(words / 200))

    // Parse status and date metadata if embedded in the document
    const dateMatch = rawText.match(/Date:\s*([0-9]{4}-[0-9]{2}-[0-9]{2})/)
    const statusMatch = rawText.match(/Status:\s*([A-Z]+)[^.\n]*/)

    // Extract headings for Table of Contents & attach anchor links
    const headings = Array.from(doc.querySelectorAll('h2, h3'))
    const tocItems: TocItem[] = []
    const usedIds = new Set<string>()

    headings.forEach((heading, index) => {
      const text = heading.textContent?.trim() || ''
      const level = parseInt(heading.tagName[1], 10)

      let id = headingToId(text) || `section-${index}`
      if (usedIds.has(id)) {
        id = `${id}-${index}`
      }
      usedIds.add(id)
      heading.id = id

      // Exclude main document title heading (first h2) from TOC to avoid redundancy
      const isDocTitle = index === 0 && level === 2
      if (!isDocTitle && text) {
        tocItems.push({ id, text, level })
      }

      const anchor = doc.createElement('a')
      anchor.className = 'heading-anchor'
      anchor.href = `#${id}`
      anchor.setAttribute('aria-label', `Direct link to ${text}`)
      anchor.textContent = '#'
      heading.appendChild(anchor)
    })

    // Auto-link dse/... wiki page references to actual archive pages
    const codeTags = Array.from(doc.querySelectorAll('code'))
    codeTags.forEach((code) => {
      if (code.parentElement?.tagName.toLowerCase() === 'pre') return
      const text = code.textContent?.trim() || ''
      if (/^dse\/[A-Za-z0-9_-]+$/.test(text)) {
        const a = doc.createElement('a')
        a.href = `/page/${encodeURIComponent(text)}`
        a.className = 'archive-page-ref'
        a.title = `View wiki page ${text}`
        a.textContent = text
        code.replaceWith(a)
      }
    })

    // Highlight key "Bottom line" / findings block
    const bottomLine = Array.from(doc.querySelectorAll('h3')).find(
      (h) => h.textContent?.trim().toLowerCase().includes('bottom line'),
    )
    if (bottomLine && bottomLine.parentNode) {
      const callout = doc.createElement('div')
      callout.className = 'research-callout-summary'
      const badge = doc.createElement('div')
      badge.className = 'callout-badge'
      badge.textContent = 'KEY FINDING / EXECUTIVE SUMMARY'
      callout.appendChild(badge)

      let curr: Element | null = bottomLine
      const elementsToMove: Element[] = []
      while (curr && (curr === bottomLine || !['H2', 'H3'].includes(curr.tagName))) {
        const next: Element | null = curr.nextElementSibling
        elementsToMove.push(curr)
        curr = next
      }
      bottomLine.parentNode.insertBefore(callout, bottomLine)
      elementsToMove.forEach((el) => callout.appendChild(el))
    }

    return {
      enrichedHtml: doc.body.innerHTML,
      toc: tocItems,
      stats: { words, readingTime },
      metaInfo: {
        date: dateMatch ? dateMatch[1] : null,
        status: statusMatch ? statusMatch[1].trim() : null,
      },
    }
  }, [content.data])

  useEffect(() => {
    if (toc.length === 0) return

    let rafId: number | null = null
    const onScroll = () => {
      if (rafId !== null) return
      rafId = requestAnimationFrame(() => {
        rafId = null
        const offset = 120
        const isBottom =
          window.innerHeight + window.scrollY >=
          document.documentElement.scrollHeight - 60

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

        const passed = headings.filter((h) => h.top <= offset)
        if (passed.length > 0) {
          setActiveId(passed[passed.length - 1].id)
        } else {
          setActiveId(headings[0].id)
        }
      })
    }

    window.addEventListener('scroll', onScroll, { passive: true })
    onScroll()

    return () => {
      window.removeEventListener('scroll', onScroll)
      if (rafId !== null) cancelAnimationFrame(rafId)
    }
  }, [toc])

  const handleTocClick = (e: React.MouseEvent<HTMLAnchorElement>, id: string) => {
    e.preventDefault()
    const el = document.getElementById(id)
    if (el) {
      const y = el.getBoundingClientRect().top + window.scrollY - 100
      window.scrollTo({ top: Math.max(0, y), behavior: 'smooth' })
      setActiveId(id)
      window.history.replaceState(null, '', `#${id}`)
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
    if (href && href.startsWith('/page/')) {
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
        <p className="muted research-caveat">
          Machine-assisted research documents produced from this archive, published progressively.
          Each document keeps its own status line and caveats: the reports are preliminary and do not
          establish intent, identity, exploit execution, or collusion.
        </p>
      </div>

      <div className={`research-layout${toc.length > 0 ? ' has-toc' : ''}`}>
        <nav className="card research-nav" aria-label="Research documents">
          {data.groups.map((group) => (
            <section className="research-group" key={group.id}>
              <h2>{group.label}</h2>
              <ul className="research-list">
                {group.docs.map((doc) => (
                  <li key={doc.slug}>
                    <Link
                      className={doc.slug === active?.slug ? 'research-link active' : 'research-link'}
                      to={`/research?doc=${doc.slug}`}
                      aria-current={doc.slug === active?.slug ? 'page' : undefined}
                    >
                      {doc.title}
                    </Link>
                  </li>
                ))}
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
                {stats && (
                  <>
                    <span className="meta-sep" aria-hidden="true">·</span>
                    <span className="meta-item">{stats.readingTime} min read</span>
                  </>
                )}
              </div>
              <div className="research-actions">
                <button
                  type="button"
                  className="action-link"
                  onClick={handleCopyLink}
                  title="Copy link to this document"
                >
                  {copied ? 'Copied' : 'Copy link'}
                </button>
                <a
                  className="action-link"
                  href={`/data/${active.raw}`}
                  download={fileName(active.source)}
                >
                  Download raw Markdown
                </a>
              </div>
            </div>
          )}
          {content.error && <div className="error">Error loading document: {content.error}</div>}
          {content.loading && <div className="loading">Loading…</div>}
          {/* Build-time HTML from data/validation; raw HTML inside the documents is escaped by the converter. */}
          <div
            className="markdown-body"
            dangerouslySetInnerHTML={{ __html: enrichedHtml }}
            onClick={handleContentClick}
          />
        </article>

        {toc.length > 0 && (
          <aside className="card research-toc" aria-label="Table of contents">
            <div className="research-toc-header">
              <span className="research-toc-title">On this page</span>
              {stats && <span className="research-toc-time">{stats.readingTime}m read</span>}
            </div>
            <ul className="research-toc-list">
              {toc.map((item) => (
                <li key={item.id} className={`research-toc-item level-${item.level}`}>
                  <a
                    href={`#${item.id}`}
                    aria-label={`Jump to ${item.text}`}
                    className={activeId === item.id ? 'active' : undefined}
                    onClick={(e) => handleTocClick(e, item.id)}
                  >
                    {item.text}
                  </a>
                </li>
              ))}
            </ul>
            <div className="research-toc-footer">
              <button
                type="button"
                className="btn-back-top"
                onClick={() => window.scrollTo({ top: 0, behavior: 'smooth' })}
              >
                Back to top ↑
              </button>
            </div>
          </aside>
        )}
      </div>
    </div>
  )
}
