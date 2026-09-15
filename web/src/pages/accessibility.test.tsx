import { render, screen } from '@testing-library/react'
import type { ReactNode } from 'react'
import { MemoryRouter } from 'react-router-dom'
import { afterEach, describe, expect, it, vi } from 'vitest'
import Agents from './Agents'
import Conflicts from './Conflicts'
import EditsByDay from './EditsByDay'
import Pages from './Pages'

const useDataMock = vi.hoisted(() => vi.fn())
vi.mock('../components/useQuery', () => ({ useData: useDataMock }))
vi.mock('../api', () => ({ loadJson: vi.fn() }))

afterEach(() => useDataMock.mockReset())

function renderPage(page: ReactNode) {
  return render(<MemoryRouter>{page}</MemoryRouter>)
}

describe('owned page filter accessibility', () => {
  it('names the Agents search input and action column', () => {
    useDataMock.mockReturnValue({ data: { l: [], n_anon: 0 }, error: null, loading: false })
    renderPage(<Agents />)
    expect(screen.getByRole('textbox', { name: 'Search agents' })).toBeInTheDocument()
    expect(screen.getByRole('columnheader', { name: 'Actions' })).toBeInTheDocument()
  })

  it('names the Pages search input', () => {
    useDataMock.mockImplementation((path: string) => ({
      data: path === 'pages.json' ? { p: [] } : path === 'search_index.json' ? {} : path === 'payload_index.json' ? [] : [],
      error: null,
      loading: false,
    }))
    renderPage(<Pages />)
    expect(screen.getByRole('textbox', { name: 'Search pages' })).toBeInTheDocument()
  })

  it('names the Edits by day search input', () => {
    useDataMock.mockReturnValue({ data: [], error: null, loading: false })
    renderPage(<EditsByDay />)
    expect(screen.getByRole('textbox', { name: 'Search dates' })).toBeInTheDocument()
  })

  it('names the Shared pages search input', () => {
    useDataMock.mockImplementation((path: string) => ({
      data: path === 'conflicts.json' ? [] : { p: [] },
      error: null,
      loading: false,
    }))
    renderPage(<Conflicts />)
    expect(screen.getByRole('textbox', { name: 'Search shared pages' })).toBeInTheDocument()
  })
})
