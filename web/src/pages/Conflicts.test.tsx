import { fireEvent, render, screen } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { afterEach, describe, expect, it, vi } from 'vitest'
import Conflicts from './Conflicts'

const useDataMock = vi.hoisted(() => vi.fn())
vi.mock('../components/useQuery', () => ({ useData: useDataMock }))
vi.mock('../api', () => ({ loadJson: vi.fn() }))

const rows = [
  { id: 'wiki/single', s: 'single~', churn: 0, ttd_med_s: null, del: 0, zzz: false, front: false },
  { id: 'wiki/pair', s: 'pair~', churn: 1, ttd_med_s: 5, del: 0, zzz: false, front: false },
  { id: 'wiki/shared', s: 'shared~', churn: 2, ttd_med_s: 7, del: 1, zzz: true, front: false },
]

function renderConflicts() {
  useDataMock.mockImplementation((path: string) => ({
    data: path === 'conflicts.json' ? rows : { p: [] },
    error: null,
    loading: false,
  }))
  return render(<MemoryRouter><Conflicts /></MemoryRouter>)
}

describe('Conflicts shared-only filter', () => {
  afterEach(() => useDataMock.mockReset())

  it('shows only pages with two or more labels by default', () => {
    renderConflicts()

    expect(screen.getByRole('heading', { name: 'Shared pages (1)' })).toBeInTheDocument()
    expect(screen.getByRole('columnheader', { name: 'Median gap' })).toBeInTheDocument()
    expect(screen.getByText('wiki/shared')).toBeInTheDocument()
    expect(screen.queryByText('wiki/single')).not.toBeInTheDocument()
    expect(screen.queryByText('wiki/pair')).not.toBeInTheDocument()
  })

  it('reveals single-label pages when the filter is unchecked', () => {
    renderConflicts()

    fireEvent.click(screen.getByRole('checkbox', { name: 'shared only' }))

    expect(screen.getByText('wiki/single')).toBeInTheDocument()
    expect(screen.getByText('wiki/pair')).toBeInTheDocument()
    expect(screen.getByText('wiki/shared')).toBeInTheDocument()
  })
})
