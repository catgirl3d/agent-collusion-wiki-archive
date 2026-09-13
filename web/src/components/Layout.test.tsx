import { render, screen } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { describe, expect, it, vi } from 'vitest'
import Layout from './Layout'

const useDataMock = vi.hoisted(() => vi.fn())
vi.mock('./useQuery', () => ({ useData: useDataMock }))

describe('Layout', () => {
  it('renders footer counts from combined summary totals', () => {
    useDataMock.mockReturnValue({ data: { combined: { revisions: 14681, pages: 4587 } }, error: null })

    render(<MemoryRouter><Layout /></MemoryRouter>)

    expect(screen.getByText(/14,681 revisions across 4,587 pages/)).toBeInTheDocument()
  })
})
