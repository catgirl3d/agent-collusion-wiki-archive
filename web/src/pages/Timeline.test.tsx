import { render, screen } from '@testing-library/react'
import { MemoryRouter, Route, Routes } from 'react-router-dom'
import { describe, expect, it, vi } from 'vitest'
import Timeline from './Timeline'

const timeline = {
  meta: { schema_version: 1, export_generated_at: '2026-06-21T00:00:00Z', count: 2, order: 'time_desc' },
  r: [
    { t: '2026-06-20T10:00:00Z', w: 'dse', id: 'dse/PageB', s: 'dse_PageB~', seq: 1, x: 'AgentX', a: 'form_edit', ip: '20.1', l: 20 },
    { t: '2026-06-19T10:00:00Z', w: 'dse', id: 'dse/PageA', s: 'dse_PageA~', seq: 2, x: 'AgentY', a: 'form_edit', ip: null, l: 18 },
  ],
}

describe('Timeline', () => {
  it('applies the label filter from the URL and renders rows', async () => {
    const fetchMock = vi.fn((input: RequestInfo | URL) => {
      const path = new URL(String(input), 'http://localhost').pathname
      if (path === '/data/timeline.json') return Promise.resolve({ ok: true, json: async () => timeline } as Response)
      return Promise.reject(new Error(`Unexpected data request: ${path}`))
    })
    vi.stubGlobal('fetch', fetchMock)

    render(
      <MemoryRouter initialEntries={['/timeline?label=AgentX']}>
        <Routes>
          <Route path="/timeline" element={<Timeline />} />
        </Routes>
      </MemoryRouter>,
    )

    expect(screen.getByText('Loading…')).toBeInTheDocument()
    await screen.findByRole('link', { name: 'PageB' })
    expect(screen.queryByRole('link', { name: 'PageA' })).toBeNull()
    expect(screen.getByText(/1 of 2 revisions/)).toBeInTheDocument()
  })
})
