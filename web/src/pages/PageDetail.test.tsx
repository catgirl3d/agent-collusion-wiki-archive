import { fireEvent, render, screen } from '@testing-library/react'
import { MemoryRouter, Route, Routes } from 'react-router-dom'
import { describe, expect, it, vi } from 'vitest'
import PageDetail from './PageDetail'

const loadJsonMock = vi.hoisted(() => vi.fn())
vi.mock('../api', () => ({
  loadJson: loadJsonMock,
  revisionFile: (pageId: string, slug?: string) => `revisions/${slug || pageId}.json`,
}))

describe('PageDetail', () => {
  it('shows a not-found boundary after the page index has loaded', async () => {
    loadJsonMock.mockImplementation((path: string) => {
      const responses: Record<string, unknown> = {
        'pages.json': { p: [], order: 'last' }, 'payload_index.json': [], 'agent_links.json': {}, 'labels.json': { l: [], n_anon: 0 },
      }
      return path in responses ? Promise.resolve(responses[path]) : Promise.reject(new Error(`Unexpected data request: ${path}`))
    })
    render(
      <MemoryRouter initialEntries={['/page/missing-page']}>
        <Routes>
          <Route path="/page/*" element={<PageDetail />} />
        </Routes>
      </MemoryRouter>,
    )

    expect(screen.getByText('Loading…')).toBeInTheDocument()
    await screen.findByText('Browse all pages')
    expect(document.querySelector('.error')).toHaveTextContent('Page missing-page not found in the archive index.')
    expect(screen.getByRole('link', { name: 'Browse all pages' })).toHaveAttribute('href', '/pages')
  })

  it('renders recovered revision lines and omits a body diff', async () => {
    const responses: Record<string, unknown> = {
      'pages.json': { p: [{ id: 'usemod/SandBox', s: 'usemod_SandBox~', w: 'usemod', n: 'SandBox', r: 1, f: '2026-05-11', l: '2026-05-11', d: false, del: 0, fam: '', lb: 0, labs: [], partial: true }], order: 'last' },
      'payload_index.json': [], 'agent_links.json': {}, 'labels.json': { l: [], n_anon: 0 },
      'revisions/usemod_SandBox~.json': [
        { seq: 1, time: '2026-05-11T00:00:00Z', label: null, ip16: null, summary: null, len: null, body: '', action: null, round: null, partial: true, added: ['new line'], removed: ['old line'] },
      ],
    }
    loadJsonMock.mockImplementation((path: string) => path in responses ? Promise.resolve(responses[path]) : Promise.reject(new Error(`Unexpected data request: ${path}`)))
    render(<MemoryRouter initialEntries={['/page/usemod%2FSandBox']}><Routes><Route path="/page/*" element={<PageDetail />} /></Routes></MemoryRouter>)
    expect((await screen.findAllByText('Recovered partial revision — full body not retained')).length).toBe(2)
    expect(screen.getByText('+new line')).toBeInTheDocument()
    expect(screen.getByText('-old line')).toBeInTheDocument()
    expect(screen.getAllByText('recovered').length).toBeGreaterThanOrEqual(2)
    expect(screen.queryByText(/DiffView/)).toBeNull()
    expect(screen.getByRole('button', { name: 'hide diff' })).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: 'hide diff' }))
    expect(screen.getByRole('button', { name: 'view diff' })).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: 'view diff' }))
    expect(screen.getByRole('button', { name: 'hide diff' })).toBeInTheDocument()
  })
})
