import { fireEvent, render, screen } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { afterEach, describe, expect, it, vi } from 'vitest'
import Research from './Research'

const loadJsonMock = vi.hoisted(() => vi.fn())
const loadTextMock = vi.hoisted(() => vi.fn())
vi.mock('../api', () => ({ loadJson: loadJsonMock, loadText: loadTextMock }))

const index = {
  source: 'data/validation',
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
        },
        {
          slug: 'relay-scenarios',
          title: 'Relay scenarios',
          source: 'relay-scenarios.md',
          html: 'research/docs/relay-scenarios.html',
          raw: 'research/files/relay-scenarios.md',
        },
        {
          slug: 'broken-doc',
          title: 'Broken document',
          source: 'broken-doc.md',
          html: 'research/docs/broken-doc.html',
          raw: 'research/files/broken-doc.md',
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
        },
      ],
      files: [{ name: 'domains.csv', raw: 'research/files/domain-infrastructure/domains.csv' }],
    },
  ],
}

const bodies: Record<string, string> = {
  'research/docs/coordination-topology.html': '<h2>Coordination topology</h2><p>First body</p>',
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
})

describe('Research', () => {
  it('lists grouped documents and renders the first document by default', async () => {
    renderResearch()

    expect(await screen.findByText('First body')).toBeInTheDocument()
    expect(screen.getByRole('heading', { level: 2, name: 'Assessments' })).toBeInTheDocument()
    expect(screen.getByRole('heading', { level: 2, name: 'Domain and external infrastructure' })).toBeInTheDocument()
    expect(loadTextMock).toHaveBeenCalledWith('research/docs/coordination-topology.html')
    expect(screen.getByRole('link', { name: 'Coordination topology' })).toHaveAttribute('aria-current', 'page')
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

  it('reports a document loading failure', async () => {
    renderResearch('/research?doc=broken-doc')

    expect(await screen.findByText(/Error loading document: HTTP 404/)).toBeInTheDocument()
  })
})
