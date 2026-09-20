import { act, fireEvent, render, screen } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { afterEach, describe, expect, it, vi } from 'vitest'
import Layout from './Layout'

const useDataMock = vi.hoisted(() => vi.fn())
vi.mock('./useQuery', () => ({ useData: useDataMock }))

describe('Layout', () => {
  afterEach(() => {
    vi.useRealTimers()
  })

  it('renders footer counts from combined summary totals', () => {
    useDataMock.mockReturnValue({ data: { combined: { revisions: 14681, pages: 4587 } }, error: null })

    render(<MemoryRouter><Layout /></MemoryRouter>)

    expect(screen.getByText(/14,681 revisions across 4,587 pages/)).toBeInTheDocument()
  })

  it('renders top-level navigation links and grouped dropdown triggers', () => {
    useDataMock.mockReturnValue({ data: null, error: null })

    render(
      <MemoryRouter initialEntries={['/']}>
        <Layout />
      </MemoryRouter>
    )

    expect(screen.getByRole('link', { name: /^research$/i })).toHaveClass('active')
    expect(screen.getByRole('link', { name: /^dashboard$/i })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: /^explore$/i })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: /^dynamics$/i })).toBeInTheDocument()
    expect(screen.getByRole('link', { name: /^download$/i })).toBeInTheDocument()
    expect(screen.getByRole('link', { name: /source: collusion\.wiki/i })).toBeInTheDocument()
  })

  it('toggles dropdown items on click and highlights active section', () => {
    useDataMock.mockReturnValue({ data: null, error: null })

    render(
      <MemoryRouter initialEntries={['/pages']}>
        <Layout />
      </MemoryRouter>
    )

    const exploreTrigger = screen.getByRole('button', { name: /explore/i })
    expect(exploreTrigger).toHaveClass('active')

    // Open dropdown
    fireEvent.click(exploreTrigger)
    expect(screen.getByRole('menu', { name: 'Explore' })).toBeInTheDocument()
    expect(screen.getByRole('menuitem', { name: /pages/i })).toBeInTheDocument()
    expect(screen.getByRole('menuitem', { name: /agents/i })).toBeInTheDocument()
    expect(screen.getByRole('menuitem', { name: /text search/i })).toBeInTheDocument()

    // Close on second click
    fireEvent.click(exploreTrigger)
    expect(screen.queryByRole('menu', { name: 'Explore' })).not.toBeInTheDocument()
  })

  it('opens dropdowns on click only, switches without overlap, closes on direct links', () => {
    useDataMock.mockReturnValue({ data: null, error: null })

    render(
      <MemoryRouter initialEntries={['/']}>
        <Layout />
      </MemoryRouter>
    )

    const exploreTrigger = screen.getByRole('button', { name: /^explore$/i })
    const dynamicsTrigger = screen.getByRole('button', { name: /^dynamics$/i })
    const downloadLink = screen.getByRole('link', { name: /^download$/i })

    // Hover does not open
    fireEvent.mouseEnter(exploreTrigger.closest('.nav-dropdown')!)
    expect(screen.queryByRole('menu', { name: 'Explore' })).not.toBeInTheDocument()

    // Click on Explore opens Explore
    fireEvent.click(exploreTrigger)
    expect(screen.getByRole('menu', { name: 'Explore' })).toBeInTheDocument()
    expect(screen.queryByRole('menu', { name: 'Dynamics' })).not.toBeInTheDocument()

    // Clicking Dynamics closes Explore and opens Dynamics (0ms overlap)
    fireEvent.click(dynamicsTrigger)
    expect(screen.queryByRole('menu', { name: 'Explore' })).not.toBeInTheDocument()
    expect(screen.getByRole('menu', { name: 'Dynamics' })).toBeInTheDocument()

    // Clicking Download navigates away, closing Dynamics via route change
    fireEvent.click(downloadLink)
    expect(screen.queryByRole('menu', { name: 'Dynamics' })).not.toBeInTheDocument()
  })

  it('highlights Research only on research pages, not on every URL', () => {
    useDataMock.mockReturnValue({ data: null, error: null })

    const { unmount } = render(
      <MemoryRouter initialEntries={['/agents']}>
        <Layout />
      </MemoryRouter>
    )
    const researchElsewhere = screen.getByRole('link', { name: 'Research' })
    expect(researchElsewhere).not.toHaveClass('active')
    expect(researchElsewhere).not.toHaveAttribute('aria-current')
    unmount()

    render(
      <MemoryRouter initialEntries={['/research']}>
        <Layout />
      </MemoryRouter>
    )
    const researchActive = screen.getByRole('link', { name: 'Research' })
    expect(researchActive).toHaveClass('active')
    expect(researchActive).toHaveAttribute('aria-current', 'page')
  })

  it('does not slam a newly opened dropdown shut when the previous close timer fires', () => {
    vi.useFakeTimers()
    useDataMock.mockReturnValue({ data: null, error: null })

    render(
      <MemoryRouter initialEntries={['/']}>
        <Layout />
      </MemoryRouter>
    )

    fireEvent.click(screen.getByRole('button', { name: /^explore$/i }))
    expect(screen.getByRole('menu', { name: 'Explore' })).toBeInTheDocument()

    // Slip off Explore (arms its 200ms close timer), then open Dynamics
    fireEvent.mouseLeave(screen.getByRole('button', { name: /^explore$/i }).closest('.nav-dropdown')!)
    fireEvent.click(screen.getByRole('button', { name: /^dynamics$/i }))
    expect(screen.getByRole('menu', { name: 'Dynamics' })).toBeInTheDocument()

    act(() => {
      vi.advanceTimersByTime(300)
    })

    expect(screen.getByRole('menu', { name: 'Dynamics' })).toBeInTheDocument()
    expect(screen.queryByRole('menu', { name: 'Explore' })).not.toBeInTheDocument()
  })
})
