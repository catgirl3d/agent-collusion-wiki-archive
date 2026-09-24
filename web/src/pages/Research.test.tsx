import { act, fireEvent, render, screen, within } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { afterEach, describe, expect, it, vi } from 'vitest'
import Research from './Research'

const loadJsonMock = vi.hoisted(() => vi.fn())
const loadTextMock = vi.hoisted(() => vi.fn())
vi.mock('../api', () => ({ loadJson: loadJsonMock, loadText: loadTextMock }))

const coordinationTranslations = [
  { lang: 'en', slug: 'coordination-topology' },
  { lang: 'ru', slug: 'coordination-topology-ru' },
]

const index = {
  source: 'data/validation',
  languages: [
    { code: 'en', label: 'EN' },
    { code: 'de', label: 'DE' },
    { code: 'uk', label: 'UA' },
    { code: 'ru', label: 'RU' },
  ],
  groups: [
    {
      id: 'assessments',
      label: 'Assessments',
      docs: [
        {
          slug: 'coordination-topology',
          title: 'Coordination topology',
          source: 'coordination-topology-assessment.md',
          html: 'research/docs/coordination-topology.html',
          raw: 'research/files/coordination-topology-assessment.md',
          lang: 'en',
          base: 'coordination-topology',
          translations: coordinationTranslations,
          meta: { date: '2026-09-19', author: 'Alina Lisova', status: 'PRELIMINARY' },
          toc: [
            { id: 'section-1', text: 'Section 1', level: 2 },
            { id: 'section-2', text: '2. Top heading', level: 2 },
            { id: 'section-3', text: '1.1 Nested heading', level: 3 },
          ],
        },
        {
          slug: 'coordination-topology-ru',
          title: 'Топология координации',
          source: 'coordination-topology-assessment.ru.md',
          html: 'research/docs/coordination-topology-ru.html',
          raw: 'research/files/coordination-topology-assessment.ru.md',
          lang: 'ru',
          base: 'coordination-topology',
          translations: coordinationTranslations,
          meta: { date: '2026-09-19', author: 'Alina Lisova', status: 'PRELIMINARY' },
          toc: [{ id: 'section-1-ru', text: 'Раздел 1', level: 2 }],
        },
        {
          slug: 'relay-scenarios',
          title: 'Relay scenarios',
          source: 'relay-scenarios.md',
          html: 'research/docs/relay-scenarios.html',
          raw: 'research/files/relay-scenarios.md',
          lang: 'en',
          base: 'relay-scenarios',
          translations: [{ lang: 'en', slug: 'relay-scenarios' }],
        },
        {
          slug: 'broken-doc',
          title: 'Broken document',
          source: 'broken-doc.md',
          html: 'research/docs/broken-doc.html',
          raw: 'research/files/broken-doc.md',
          lang: 'en',
          base: 'broken-doc',
          translations: [{ lang: 'en', slug: 'broken-doc' }],
        },
        {
          slug: 'solo-report-ru',
          title: 'Solo Russian report',
          source: 'solo-report.ru.md',
          html: 'research/docs/solo-report-ru.html',
          raw: 'research/files/solo-report.ru.md',
          lang: 'ru',
          base: 'solo-report',
          translations: [{ lang: 'ru', slug: 'solo-report-ru' }],
        },
      ],
      files: [],
    },
    {
      id: 'domain-infrastructure',
      label: 'Domain and external infrastructure',
      docs: [
        {
          slug: 'domain-overview',
          title: 'Domain overview',
          source: 'domain-infrastructure/README.md',
          html: 'research/docs/domain-overview.html',
          raw: 'research/files/domain-infrastructure/README.md',
          lang: 'en',
          base: 'domain-overview',
          translations: [{ lang: 'en', slug: 'domain-overview' }],
        },
      ],
      files: [{ name: 'domains.csv', raw: 'research/files/domain-infrastructure/domains.csv' }],
    },
  ],
}

const bodies: Record<string, string> = {
  'research/docs/coordination-topology.html':
    '<h2 id="section-1">Coordination topology</h2><p>First body</p><p><a class="heading-anchor" href="#section-1" aria-label="Direct link to Section 1">#</a></p>',
  'research/docs/coordination-topology-ru.html': '<h2>Топология координации</h2><p>Русский текст</p>',
  'research/docs/relay-scenarios.html': '<h2>Relay scenarios</h2><p>Second body</p>',
  'research/docs/domain-overview.html': '<h2>Domain overview</h2><p>Domain body</p>',
}

function renderResearch(entry = '/research') {
  loadJsonMock.mockResolvedValue(index)
  loadTextMock.mockImplementation((path: string) => {
    const body = bodies[path]
    return body ? Promise.resolve(body) : Promise.reject(new Error(`HTTP 404 for ${path}`))
  })
  return render(
    <MemoryRouter initialEntries={[entry]}>
      <Research />
    </MemoryRouter>,
  )
}

afterEach(() => {
  loadJsonMock.mockReset()
  loadTextMock.mockReset()
  vi.restoreAllMocks()
})

describe('Research', () => {
  it('lists grouped documents and renders the first document by default', async () => {
    renderResearch()

    expect(await screen.findByText('First body')).toBeInTheDocument()
    expect(screen.getByRole('heading', { level: 2, name: 'Assessments' })).toBeInTheDocument()
    expect(screen.getByRole('heading', { level: 2, name: 'Domain and external infrastructure' })).toBeInTheDocument()
    expect(loadTextMock).toHaveBeenCalledWith('research/docs/coordination-topology.html')
    expect(screen.getByText('PRELIMINARY')).toBeInTheDocument()
    expect(screen.getByText('Alina Lisova')).toBeInTheDocument()
    expect(screen.getByText('Section 1')).toBeInTheDocument()
    expect(screen.getByRole('link', { name: 'Coordination topology' })).toHaveAttribute('aria-current', 'page')
  })

  it('preserves author numbering and heading levels in the TOC', async () => {
    renderResearch()
    await screen.findByText('First body')

    expect(screen.getByText('2. Top heading')).toBeInTheDocument()
    const nested = screen.getByText('1.1 Nested heading')
    expect(nested).toBeInTheDocument()
    expect(nested.closest('li')).toHaveClass('level-3')
    expect(document.querySelector('.toc-item-index')).toBeNull()
  })

  it('switches documents when another entry is selected', async () => {
    renderResearch()
    await screen.findByText('First body')

    fireEvent.click(screen.getByRole('link', { name: 'Relay scenarios' }))

    expect(await screen.findByText('Second body')).toBeInTheDocument()
    expect(loadTextMock).toHaveBeenCalledWith('research/docs/relay-scenarios.html')
    expect(screen.getByRole('link', { name: 'Relay scenarios' })).toHaveAttribute('aria-current', 'page')
  })

  it('opens the document named by the doc search parameter', async () => {
    renderResearch('/research?doc=domain-overview')

    expect(await screen.findByText('Domain body')).toBeInTheDocument()
    expect(loadTextMock).toHaveBeenCalledWith('research/docs/domain-overview.html')
  })

  it('links raw sources and data files under /data/research', async () => {
    renderResearch()
    await screen.findByText('First body')

    const raw = screen.getByRole('link', { name: 'Download raw Markdown' })
    expect(raw).toHaveAttribute('href', '/data/research/files/coordination-topology-assessment.md')
    expect(raw).toHaveAttribute('download', 'coordination-topology-assessment.md')

    const csv = screen.getByRole('link', { name: 'domains.csv' })
    expect(csv).toHaveAttribute('href', '/data/research/files/domain-infrastructure/domains.csv')
  })

  it('marks the table of contents as loading until the document body resolves', async () => {
    loadJsonMock.mockResolvedValue(index)
    let resolveText!: (value: string) => void
    const textPromise = new Promise<string>((resolve) => {
      resolveText = resolve
    })
    loadTextMock.mockReturnValue(textPromise)
    render(
      <MemoryRouter initialEntries={['/research']}>
        <Research />
      </MemoryRouter>,
    )

    const toc = await screen.findByLabelText('Table of contents')
    expect(toc).toHaveClass('is-loading')
    expect(screen.getByLabelText('Loading document content')).toBeInTheDocument()

    await act(async () => {
      resolveText(bodies['research/docs/coordination-topology.html'])
      await textPromise
    })

    expect(await screen.findByText('First body')).toBeInTheDocument()
    expect(screen.getByLabelText('Table of contents')).not.toHaveClass('is-loading')
  })

  it('reports a document loading failure', async () => {
    renderResearch('/research?doc=broken-doc')

    expect(await screen.findByText(/Error loading document: HTTP 404/)).toBeInTheDocument()
  })

  it('switches document language via language dropdown', async () => {
    renderResearch()
    await screen.findByText('First body')

    const langTrigger = screen.getByRole('combobox', { name: 'Select language' })
    expect(langTrigger).toHaveTextContent('EN')

    fireEvent.click(langTrigger)
    const ruOption = screen.getByRole('option', { name: 'RU' })
    expect(ruOption).not.toBeDisabled()
    expect(screen.getByRole('option', { name: 'UA' })).toBeDisabled()

    fireEvent.click(ruOption)
    expect(await screen.findByText('Русский текст')).toBeInTheDocument()
    expect(loadTextMock).toHaveBeenCalledWith('research/docs/coordination-topology-ru.html')
  })

  it('shows a translation-only document in the navigation', async () => {
    renderResearch()
    await screen.findByText('First body')

    const link = screen.getByRole('link', { name: 'Solo Russian report' })
    expect(link).toHaveAttribute('href', '/research?doc=solo-report-ru')
  })

  it('scrolls to in-document heading anchors with the header offset', async () => {
    const scrollTo = vi.spyOn(window, 'scrollTo').mockImplementation(() => {})
    renderResearch()
    await screen.findByText('First body')

    const heading = document.getElementById('section-1')!
    vi.spyOn(heading, 'getBoundingClientRect').mockReturnValue({
      top: 400,
      bottom: 430,
      left: 0,
      right: 100,
      width: 100,
      height: 30,
      x: 0,
      y: 400,
      toJSON: () => {},
    })

    const anchor = screen.getByRole('link', { name: 'Direct link to Section 1' })
    expect(fireEvent.click(anchor)).toBe(false)

    expect(scrollTo).toHaveBeenCalledWith({ top: 300, behavior: 'smooth' })
    expect(window.location.hash).toBe('#section-1')
  })

  it('keeps navigation usable with a legacy index without language metadata', async () => {
    const legacyIndex = {
      source: 'data/validation',
      groups: [
        {
          id: 'assessments',
          label: 'Assessments',
          docs: [
            {
              slug: 'legacy-doc',
              title: 'Legacy document',
              source: 'legacy.md',
              html: 'research/docs/legacy.html',
              raw: 'research/files/legacy.md',
            },
            {
              slug: 'legacy-doc-ru',
              title: 'Legacy RU document',
              source: 'legacy.ru.md',
              html: 'research/docs/legacy-ru.html',
              raw: 'research/files/legacy.ru.md',
            },
          ],
          files: [],
        },
      ],
    }
    loadJsonMock.mockResolvedValue(legacyIndex)
    loadTextMock.mockResolvedValue('<h2>Legacy heading</h2><p>Legacy text</p>')
    render(
      <MemoryRouter initialEntries={['/research']}>
        <Research />
      </MemoryRouter>,
    )

    expect(await screen.findByText('Legacy text')).toBeInTheDocument()
    expect(screen.getByRole('link', { name: 'Legacy document' })).toBeInTheDocument()
    expect(screen.getByRole('link', { name: 'Legacy RU document' })).toBeInTheDocument()
  })

  it('toggles left nav panel and right toc panel collapse', async () => {
    loadJsonMock.mockResolvedValue(index)
    loadTextMock.mockResolvedValue('<h2>Section 1</h2><p>Section 1 body</p>')
    const { container } = render(
      <MemoryRouter initialEntries={['/research?doc=coordination-topology']}>
        <Research />
      </MemoryRouter>,
    )

    await screen.findByText('Section 1 body')

    const layout = container.querySelector('.research-layout')!
    expect(layout).toHaveClass('has-toc')
    expect(layout).not.toHaveClass('is-nav-collapsed')
    expect(layout).not.toHaveClass('is-toc-collapsed')

    // Nav collapse button
    const collapseNavBtn = screen.getByRole('button', { name: 'Collapse reports list' })
    fireEvent.click(collapseNavBtn)

    expect(layout).toHaveClass('is-nav-collapsed')
    const expandNavBtn = screen.getByRole('button', { name: 'Expand reports list' })
    expect(expandNavBtn).toBeInTheDocument()

    // TOC collapse button
    const collapseTocBtn = screen.getByRole('button', { name: 'Collapse table of contents' })
    expect(collapseTocBtn).toHaveClass('toc-toggle-btn')
    fireEvent.click(collapseTocBtn)

    expect(layout).toHaveClass('is-toc-collapsed')
    const expandTocBtn = screen.getByRole('button', { name: 'Expand table of contents' })
    expect(expandTocBtn).toBeInTheDocument()

    // Re-expand nav
    fireEvent.click(expandNavBtn)
    expect(layout).not.toHaveClass('is-nav-collapsed')

    // Re-expand TOC
    fireEvent.click(expandTocBtn)
    expect(layout).not.toHaveClass('is-toc-collapsed')
  })

  it('does not render toc toggle button when document has no toc', async () => {
    loadJsonMock.mockResolvedValue(index)
    loadTextMock.mockResolvedValue('<p>No TOC body</p>')
    render(
      <MemoryRouter initialEntries={['/research?doc=broken-doc']}>
        <Research />
      </MemoryRouter>,
    )

    await screen.findByText('No TOC body')
    expect(screen.getByRole('button', { name: 'Collapse reports list' })).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: /table of contents/i })).not.toBeInTheDocument()
  })

  it('opens mobile toc drawer, navigates on item click, and closes on escape or close button', async () => {
    loadJsonMock.mockResolvedValue(index)
    loadTextMock.mockResolvedValue('<h2>Section 1</h2><p>Section 1 body</p>')
    render(
      <MemoryRouter initialEntries={['/research?doc=coordination-topology']}>
        <Research />
      </MemoryRouter>,
    )

    await screen.findByText('Section 1 body')

    // Open drawer via TOC button
    const tocBtn = screen.getByRole('button', { name: 'Collapse table of contents' })
    fireEvent.click(tocBtn)

    const drawer = screen.getByRole('dialog', { name: 'Table of contents' })
    expect(drawer).toBeInTheDocument()

    // Close via close button
    const closeBtn = within(drawer).getByRole('button', { name: 'Close table of contents' })
    fireEvent.click(closeBtn)
    expect(screen.queryByRole('dialog', { name: 'Table of contents' })).not.toBeInTheDocument()

    // Reopen and close via escape
    fireEvent.click(screen.getByRole('button', { name: 'Expand table of contents' }))
    expect(screen.getByRole('dialog', { name: 'Table of contents' })).toBeInTheDocument()
    fireEvent.keyDown(window, { key: 'Escape' })
    expect(screen.queryByRole('dialog', { name: 'Table of contents' })).not.toBeInTheDocument()

    // Reopen and click item
    fireEvent.click(screen.getByRole('button', { name: 'Collapse table of contents' }))
    const itemDrawer = screen.getByRole('dialog', { name: 'Table of contents' })
    const drawerItem = within(itemDrawer).getByRole('link', { name: 'Jump to Section 1' })
    fireEvent.click(drawerItem)
    expect(screen.queryByRole('dialog', { name: 'Table of contents' })).not.toBeInTheDocument()
  })
})
