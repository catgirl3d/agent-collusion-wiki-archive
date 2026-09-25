import { fireEvent, render, screen } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { describe, expect, it, vi } from 'vitest'
import type { PagesIndex, PayloadRecord, SearchIndex } from '../types'
import Pages from './Pages'

const loadJsonMock = vi.hoisted(() => vi.fn())
vi.mock('../api', () => ({ loadJson: loadJsonMock }))

const pages: PagesIndex = {
  p: [
    { id: 'dse/MatchPage', s: 'dse_MatchPage~', w: 'dse', n: 'MatchPage', r: 1, f: '2026-06-01', l: '2026-06-01', d: false, del: 0, fam: '', lb: 0, labs: [] },
    { id: 'dse/BySlug', s: 'dse_BySlug~', w: 'dse', n: 'BySlug', r: 1, f: '2026-06-01', l: '2026-06-01', d: false, del: 0, fam: '', lb: 0, labs: [] },
    { id: 'dse/ScriptPage', s: 'dse_ScriptPage~', w: 'dse', n: 'ScriptPage', r: 1, f: '2026-06-01', l: '2026-06-01', d: false, del: 0, fam: '', lb: 0, labs: [] },
  ],
  order: 'last',
}

const payloadIndex: PayloadRecord[] = [
  { id: 'dse/MatchPage', s: 'dse_MatchPage~', f: ['hex', 'hex'], u: [] },
  { id: 'dse/OldBySlug', s: 'dse_BySlug~', f: ['hex', 'script'], u: [] },
  { id: 'dse/ScriptPage', s: 'dse_ScriptPage~', f: ['script'], u: [] },
]

const searchIndex: SearchIndex = {
  tokens: { match: ['dse_MatchPage~'] },
  urls: {},
  meta: { built_from: 'test', n_tokens: 1 },
}

describe('Pages payload flag counts', () => {
  it('keeps global option counts correct while the page search changes', async () => {
    const responses: Record<string, unknown> = {
      'pages.json': pages,
      'payload_index.json': payloadIndex,
      'search_index.json': searchIndex,
      'activity_by_day.json': [],
    }
    loadJsonMock.mockImplementation((path: string) => path in responses
      ? Promise.resolve(responses[path])
      : Promise.reject(new Error(`Unexpected data request: ${path}`)))

    render(<MemoryRouter><Pages /></MemoryRouter>)

    expect(await screen.findByText('3 of 3')).toBeInTheDocument()
    fireEvent.click(screen.getByRole('combobox', { name: 'Filter by payload flag' }))
    expect(screen.getByRole('option', { name: 'hex (2)' })).toBeInTheDocument()
    expect(screen.getByRole('option', { name: 'script (2)' })).toBeInTheDocument()

    fireEvent.change(screen.getByRole('textbox', { name: 'Search pages' }), { target: { value: 'Match' } })

    expect(await screen.findByRole('link', { name: 'MatchPage' })).toBeInTheDocument()
    expect(screen.queryByRole('link', { name: 'BySlug' })).not.toBeInTheDocument()
    expect(screen.queryByRole('link', { name: 'ScriptPage' })).not.toBeInTheDocument()
    expect(screen.getByRole('option', { name: 'hex (2)' })).toBeInTheDocument()
    expect(screen.getByRole('option', { name: 'script (2)' })).toBeInTheDocument()
  })
})
