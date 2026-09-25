import { fireEvent, render, screen, waitFor, within } from '@testing-library/react'
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
    const exploreDropdown = exploreTrigger.closest('.nav-dropdown')
    if (!exploreDropdown) throw new Error('Explore dropdown container was not found')
    fireEvent.mouseEnter(exploreDropdown)
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

  it('opens and closes mobile navigation drawer on toggle, close button, and escape', () => {
    useDataMock.mockReturnValue({ data: null, error: null })

    render(
      <MemoryRouter initialEntries={['/']}>
        <Layout />
      </MemoryRouter>
    )

    const toggleBtn = screen.getByRole('button', { name: /toggle navigation menu/i })
    expect(toggleBtn).toHaveAttribute('aria-expanded', 'false')
    expect(screen.queryByRole('dialog', { name: /mobile navigation/i })).not.toBeInTheDocument()

    // Open mobile menu
    fireEvent.click(toggleBtn)
    expect(toggleBtn).toHaveAttribute('aria-expanded', 'true')
    expect(screen.getByRole('dialog', { name: /mobile navigation/i })).toBeInTheDocument()

    // Close via close button in drawer
    const closeBtn = screen.getByRole('button', { name: /close navigation menu/i })
    expect(closeBtn).toHaveClass('btn', 'ghost', 'icon')
    fireEvent.click(closeBtn)
    expect(screen.queryByRole('dialog', { name: /mobile navigation/i })).not.toBeInTheDocument()
    expect(toggleBtn).toHaveAttribute('aria-expanded', 'false')

    // Open again and close via Escape
    fireEvent.click(toggleBtn)
    expect(screen.getByRole('dialog', { name: /mobile navigation/i })).toBeInTheDocument()
    fireEvent.keyDown(window, { key: 'Escape' })
    expect(screen.queryByRole('dialog', { name: /mobile navigation/i })).not.toBeInTheDocument()
  })

  it('renders all section links in mobile drawer and closes drawer on link click', () => {
    useDataMock.mockReturnValue({ data: null, error: null })

    render(
      <MemoryRouter initialEntries={['/']}>
        <Layout />
      </MemoryRouter>
    )

    const toggleBtn = screen.getByRole('button', { name: /toggle navigation menu/i })
    fireEvent.click(toggleBtn)

    const drawer = screen.getByRole('dialog', { name: /mobile navigation/i })
    expect(drawer).toBeInTheDocument()

    // Verify groups and links are present in drawer
    expect(within(drawer).getByText('Explore')).toBeInTheDocument()
    expect(within(drawer).getByText('Dynamics')).toBeInTheDocument()

    const pagesLink = within(drawer).getByRole('link', { name: /^pages/i })
    fireEvent.click(pagesLink)

    // Route change closes drawer
    expect(screen.queryByRole('dialog', { name: /mobile navigation/i })).not.toBeInTheDocument()
  })

  it('manages focus within mobile drawer, traps tab navigation, and sets aria-current', async () => {
    useDataMock.mockReturnValue({ data: null, error: null })

    render(
      <MemoryRouter initialEntries={['/']}>
        <Layout />
      </MemoryRouter>
    )

    const toggleBtn = screen.getByRole('button', { name: /toggle navigation menu/i })
    toggleBtn.focus()
    expect(document.activeElement).toBe(toggleBtn)

    fireEvent.click(toggleBtn)

    const drawer = screen.getByRole('dialog', { name: /mobile navigation/i })
    expect(drawer).toBeInTheDocument()

    // Verify Research link has aria-current="page"
    const researchLink = within(drawer).getByRole('link', { name: /^research$/i })
    expect(researchLink).toHaveAttribute('aria-current', 'page')

    // Verify focus moves into drawer close button
    const closeBtn = within(drawer).getByRole('button', { name: /close navigation menu/i })
    await waitFor(() => { expect(document.activeElement).toBe(closeBtn); })

    // Test Tab wrapping: focus on last link, press Tab -> wraps to closeBtn
    const links = within(drawer).getAllByRole('link')
    const lastLink = links[links.length - 1]
    lastLink.focus()
    expect(document.activeElement).toBe(lastLink)

    fireEvent.keyDown(window, { key: 'Tab' })
    expect(document.activeElement).toBe(closeBtn)

    // Test Shift+Tab wrapping: focus on closeBtn, press Shift+Tab -> wraps to lastLink
    fireEvent.keyDown(window, { key: 'Tab', shiftKey: true })
    expect(document.activeElement).toBe(lastLink)

    // Close via Escape and verify focus restores to toggleBtn
    fireEvent.keyDown(window, { key: 'Escape' })
    expect(screen.queryByRole('dialog', { name: /mobile navigation/i })).not.toBeInTheDocument()
    expect(document.activeElement).toBe(toggleBtn)
  })
})
