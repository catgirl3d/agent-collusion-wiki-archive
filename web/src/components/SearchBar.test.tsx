import { fireEvent, render, screen } from '@testing-library/react'
import { Link, MemoryRouter, useLocation } from 'react-router-dom'
import { describe, expect, it } from 'vitest'
import { SearchBar } from './SearchBar'

function Navigator({ to }: { to: string }) {
  return <Link to={to}>Navigate to {to}</Link>
}

function LocationSpy() {
  const location = useLocation()
  return <output data-testid="location">{location.pathname}{location.search}</output>
}

describe('SearchBar', () => {
  it('renders collapsed icon button by default and expands on click', () => {
    render(
      <MemoryRouter initialEntries={['/']}>
        <SearchBar />
      </MemoryRouter>
    )

    const form = screen.getByRole('search')
    expect(form).toHaveClass('is-collapsed')

    const toggleButton = screen.getByRole('button', { name: /search archive/i })
    expect(toggleButton).toBeInTheDocument()

    fireEvent.click(toggleButton)
    expect(form).toHaveClass('is-expanded')

    const input = screen.getByRole('searchbox', { name: /search revisions text/i })
    expect(input).toBeInTheDocument()
    expect(screen.getByText(/ctrl k|⌘k/i)).toBeInTheDocument()
  })

  it('navigates to /search?q=... on submit with text', () => {
    render(
      <MemoryRouter initialEntries={['/']}>
        <SearchBar />
        <LocationSpy />
      </MemoryRouter>
    )

    const toggleButton = screen.getByRole('button', { name: /search archive/i })
    fireEvent.click(toggleButton)

    const input = screen.getByRole('searchbox', { name: /search revisions text/i })
    fireEvent.change(input, { target: { value: 'orchestrator' } })
    fireEvent.submit(input.closest('form')!)

    expect(screen.getByTestId('location')).toHaveTextContent('/search?q=orchestrator')
    expect(screen.getByRole('searchbox')).toHaveValue('orchestrator')
  })

  it('collapses on submit even when the URL does not change', () => {
    render(
      <MemoryRouter initialEntries={['/search?q=test']}>
        <SearchBar />
        <LocationSpy />
      </MemoryRouter>
    )

    fireEvent.click(screen.getByRole('button', { name: /search archive/i }))
    expect(screen.getByRole('search')).toHaveClass('is-expanded')

    // Submitting the already-current URL navigates nowhere: the bar must
    // still collapse via handleSubmit, not via the location sync effect
    fireEvent.submit(screen.getByRole('search'))

    expect(screen.getByTestId('location')).toHaveTextContent('/search?q=test')
    expect(screen.getByRole('search')).toHaveClass('is-collapsed')
  })

  it('clears query when clear button is clicked', () => {
    render(
      <MemoryRouter initialEntries={['/']}>
        <SearchBar />
      </MemoryRouter>
    )

    const toggleButton = screen.getByRole('button', { name: /search archive/i })
    fireEvent.click(toggleButton)

    const input = screen.getByRole('searchbox', { name: /search revisions text/i })
    fireEvent.change(input, { target: { value: 'hello' } })
    expect(input).toHaveValue('hello')

    const clearButton = screen.getByRole('button', { name: /clear search/i })
    fireEvent.click(clearButton)
    expect(input).toHaveValue('')
  })

  it('expands and focuses input on Ctrl+K keydown (English layout)', () => {
    render(
      <MemoryRouter initialEntries={['/']}>
        <SearchBar />
      </MemoryRouter>
    )

    const form = screen.getByRole('search')
    expect(form).toHaveClass('is-collapsed')

    fireEvent.keyDown(window, { key: 'k', code: 'KeyK', ctrlKey: true })

    expect(form).toHaveClass('is-expanded')
    const input = screen.getByRole('searchbox', { name: /search revisions text/i })
    expect(document.activeElement).toBe(input)
  })

  it('expands and focuses input on Ctrl+K keydown with Russian layout (key: л)', () => {
    render(
      <MemoryRouter initialEntries={['/']}>
        <SearchBar />
      </MemoryRouter>
    )

    const form = screen.getByRole('search')
    expect(form).toHaveClass('is-collapsed')

    fireEvent.keyDown(window, { key: 'л', code: 'KeyK', ctrlKey: true })

    expect(form).toHaveClass('is-expanded')
    const input = screen.getByRole('searchbox', { name: /search revisions text/i })
    expect(document.activeElement).toBe(input)
  })

  it('does not expand on Ctrl+Shift+K (preserves Firefox Web Console shortcut)', () => {
    render(
      <MemoryRouter initialEntries={['/']}>
        <SearchBar />
      </MemoryRouter>
    )

    const form = screen.getByRole('search')
    expect(form).toHaveClass('is-collapsed')

    fireEvent.keyDown(window, { key: 'K', code: 'KeyK', ctrlKey: true, shiftKey: true })

    expect(form).toHaveClass('is-collapsed')
  })

  it('stays collapsed on /search and does not steal focus (page has its own form)', () => {
    render(
      <MemoryRouter initialEntries={['/search?q=hello']}>
        <SearchBar />
      </MemoryRouter>
    )

    const form = screen.getByRole('search')
    expect(form).toHaveClass('is-collapsed')
    expect(document.activeElement).not.toBe(screen.getByRole('searchbox'))
  })

  it('collapses on Escape with empty query even on /search', () => {
    render(
      <MemoryRouter initialEntries={['/search']}>
        <SearchBar />
      </MemoryRouter>
    )

    fireEvent.click(screen.getByRole('button', { name: /search archive/i }))
    expect(screen.getByRole('search')).toHaveClass('is-expanded')

    fireEvent.keyDown(screen.getByRole('searchbox'), { key: 'Escape' })
    expect(screen.getByRole('search')).toHaveClass('is-collapsed')
  })

  it('collapses on blur with empty query even on /search', () => {
    render(
      <MemoryRouter initialEntries={['/search']}>
        <SearchBar />
      </MemoryRouter>
    )

    fireEvent.click(screen.getByRole('button', { name: /search archive/i }))
    expect(screen.getByRole('search')).toHaveClass('is-expanded')

    fireEvent.blur(screen.getByRole('searchbox'), { relatedTarget: document.body })
    expect(screen.getByRole('search')).toHaveClass('is-collapsed')
  })

  it('blurs the header input on submit so focus does not stick in the collapsed field', () => {
    render(
      <MemoryRouter initialEntries={['/']}>
        <SearchBar />
      </MemoryRouter>
    )

    fireEvent.click(screen.getByRole('button', { name: /search archive/i }))
    const input = screen.getByRole('searchbox')
    fireEvent.change(input, { target: { value: 'orchestrator' } })
    expect(document.activeElement).toBe(input)

    fireEvent.submit(screen.getByRole('search'))

    expect(screen.getByRole('search')).toHaveClass('is-collapsed')
    expect(document.activeElement).not.toBe(input)
  })

  it('removes the decorative loupe button from tab order when expanded', () => {
    const { container } = render(
      <MemoryRouter initialEntries={['/']}>
        <SearchBar />
      </MemoryRouter>
    )
    const loupe = () => container.querySelector('.search-bar-toggle-btn')!

    expect(screen.getByRole('button', { name: /search archive/i })).toHaveAttribute('tabindex', '0')

    fireEvent.click(screen.getByRole('button', { name: /search archive/i }))

    // aria-hidden drops it from the a11y tree, so assert via the DOM node
    expect(loupe()).toHaveAttribute('tabindex', '-1')
    expect(loupe()).toHaveAttribute('aria-hidden', 'true')
  })

  it('ignores Ctrl+Alt+K (AltGr) so national layouts can type through', () => {
    render(
      <MemoryRouter initialEntries={['/']}>
        <SearchBar />
      </MemoryRouter>
    )

    const form = screen.getByRole('search')
    expect(form).toHaveClass('is-collapsed')

    fireEvent.keyDown(window, { key: 'k', code: 'KeyK', ctrlKey: true, altKey: true })

    expect(form).toHaveClass('is-collapsed')
  })

  it('collapses on Escape even with a non-empty query, preserving the text', () => {
    render(
      <MemoryRouter initialEntries={['/search?q=test']}>
        <SearchBar />
      </MemoryRouter>
    )

    fireEvent.click(screen.getByRole('button', { name: /search archive/i }))
    const input = screen.getByRole('searchbox')
    expect(input).toHaveValue('test')
    expect(screen.getByRole('search')).toHaveClass('is-expanded')

    fireEvent.keyDown(input, { key: 'Escape' })

    expect(screen.getByRole('search')).toHaveClass('is-collapsed')
    expect(input).toHaveValue('test')
  })

  it('resets query when navigating away from /search', async () => {
    render(
      <MemoryRouter initialEntries={['/search?q=hello']}>
        <SearchBar />
        <LocationSpy />
        <Navigator to="/" />
      </MemoryRouter>
    )

    fireEvent.click(screen.getByRole('link', { name: 'Navigate to /' }))
    expect(await screen.findByText('/')).toBeInTheDocument()
    expect(screen.getByRole('search')).toHaveClass('is-collapsed')
    expect(screen.getByRole('searchbox')).toHaveValue('')
  })
})
