import { render, screen } from '@testing-library/react'
import { MemoryRouter, Route, Routes } from 'react-router-dom'
import { describe, expect, it, vi } from 'vitest'
import PageDetail from './PageDetail'

describe('PageDetail', () => {
  it('shows a not-found boundary after the page index has loaded', async () => {
    const responses: Record<string, unknown> = {
      '/data/pages.json': { p: [], order: 'last' },
      '/data/payload_index.json': [],
      '/data/agent_links.json': {},
      '/data/labels.json': { l: [], n_anon: 0 },
    }
    const fetchMock = vi.fn((input: RequestInfo | URL) => {
      const path = new URL(String(input), 'http://localhost').pathname
      if (!(path in responses)) return Promise.reject(new Error(`Unexpected data request: ${path}`))
      return Promise.resolve({ ok: true, json: async () => responses[path] } as Response)
    })
    vi.stubGlobal('fetch', fetchMock)

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
    const requestedPaths = fetchMock.mock.calls.map(([input]) => new URL(String(input), 'http://localhost').pathname)
    expect(requestedPaths).toEqual(expect.arrayContaining([
      '/data/pages.json',
      '/data/payload_index.json',
      '/data/agent_links.json',
      '/data/labels.json',
    ]))
  })
})
