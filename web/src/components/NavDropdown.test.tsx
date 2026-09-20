import { act, fireEvent, render, screen } from '@testing-library/react'
import { FileText } from 'lucide-react'
import { useEffect } from 'react'
import { MemoryRouter, useNavigate } from 'react-router-dom'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { NavDropdown } from './NavDropdown'

function Go({ to }: { to: string }) {
  const navigate = useNavigate()
  useEffect(() => {
    navigate(to)
  }, [navigate, to])
  return null
}

const items = [
  { to: '/agents', label: 'Agents' },
  { to: '/pages', label: 'Pages' },
]

function mockNarrowScreen() {
  const originalMatchMedia = window.matchMedia
  window.matchMedia = ((query: string) => ({
    matches: query === '(max-width: 900px)',
    media: query,
    addEventListener: () => {},
    removeEventListener: () => {},
  })) as unknown as typeof window.matchMedia
  return () => {
    window.matchMedia = originalMatchMedia
  }
}

function renderDropdown() {
  return render(
    <MemoryRouter initialEntries={['/']}>
      <NavDropdown label="Explore" items={items} />
    </MemoryRouter>
  )
}

describe('NavDropdown', () => {
  it('opens on trigger click and closes on second click', () => {
    renderDropdown()

    expect(screen.queryByRole('menu')).not.toBeInTheDocument()

    fireEvent.click(screen.getByRole('button', { name: /explore/i }))
    expect(screen.getByRole('menu')).toBeInTheDocument()

    fireEvent.click(screen.getByRole('button', { name: /explore/i }))
    expect(screen.queryByRole('menu')).not.toBeInTheDocument()
  })

  it('does not open on hover, only on click', () => {
    renderDropdown()

    const trigger = screen.getByRole('button', { name: /explore/i })
    fireEvent.mouseEnter(trigger.closest('.nav-dropdown')!)

    expect(screen.queryByRole('menu')).not.toBeInTheDocument()

    fireEvent.click(trigger)
    expect(screen.getByRole('menu')).toBeInTheDocument()
  })

  afterEach(() => {
    vi.useRealTimers()
  })

  it('closes 200ms after the mouse leaves the menu container', () => {
    vi.useFakeTimers()
    renderDropdown()

    const trigger = screen.getByRole('button', { name: /explore/i })
    fireEvent.click(trigger)
    expect(screen.getByRole('menu')).toBeInTheDocument()

    // Not instant: still open right after leaving
    fireEvent.mouseLeave(trigger.closest('.nav-dropdown')!)
    expect(screen.getByRole('menu')).toBeInTheDocument()

    act(() => {
      vi.advanceTimersByTime(200)
    })
    expect(screen.queryByRole('menu')).not.toBeInTheDocument()
  })

  it('cancels the scheduled close when the mouse re-enters in time', () => {
    vi.useFakeTimers()
    renderDropdown()

    const container = screen.getByRole('button', { name: /explore/i }).closest('.nav-dropdown')!
    fireEvent.click(screen.getByRole('button', { name: /explore/i }))

    fireEvent.mouseLeave(container)
    act(() => {
      vi.advanceTimersByTime(100)
    })
    fireEvent.mouseEnter(container)
    act(() => {
      vi.advanceTimersByTime(200)
    })

    expect(screen.getByRole('menu')).toBeInTheDocument()
  })

  it('closes when keyboard focus leaves the dropdown (tab out)', () => {
    renderDropdown()

    fireEvent.click(screen.getByRole('button', { name: /explore/i }))
    const menu = screen.getByRole('menu')
    expect(menu).toBeInTheDocument()

    fireEvent.blur(menu, { relatedTarget: document.body })

    expect(screen.queryByRole('menu')).not.toBeInTheDocument()
  })

  it('stays open when focus moves between trigger and menu items', () => {
    renderDropdown()

    fireEvent.click(screen.getByRole('button', { name: /explore/i }))
    const menu = screen.getByRole('menu')

    const firstItem = screen.getByRole('menuitem', { name: /agents/i })
    fireEvent.blur(menu, { relatedTarget: firstItem })

    expect(screen.getByRole('menu')).toBeInTheDocument()
  })

  it('only references the menu id via aria-controls while open', () => {
    renderDropdown()

    const trigger = screen.getByRole('button', { name: /explore/i })
    expect(trigger).not.toHaveAttribute('aria-controls')

    fireEvent.click(trigger)
    const menu = screen.getByRole('menu')
    expect(trigger).toHaveAttribute('aria-controls', menu.getAttribute('id'))

    fireEvent.click(trigger)
    expect(trigger).not.toHaveAttribute('aria-controls')
  })

  it('portals the menu to document body on narrow screens', () => {
    const restore = mockNarrowScreen()
    try {
      renderDropdown()

      fireEvent.click(screen.getByRole('button', { name: /explore/i }))

      const floating = document.body.querySelector('.nav-menu--floating[role="menu"]')
      expect(floating).not.toBeNull()
    } finally {
      restore()
    }
  })

  it('renders no inline menu copy while floating on narrow screens', () => {
    const restore = mockNarrowScreen()
    try {
      renderDropdown()

      const trigger = screen.getByRole('button', { name: /explore/i })
      fireEvent.click(trigger)

      expect(document.body.querySelector('.nav-menu--floating[role="menu"]')).not.toBeNull()
      expect(trigger.closest('.nav-dropdown')!.querySelector('.nav-menu')).toBeNull()
    } finally {
      restore()
    }
  })

  it('closes on same-path navigation (query change, pathname untouched)', () => {
    const { rerender } = render(
      <MemoryRouter initialEntries={['/agents']}>
        <NavDropdown label="Explore" items={items} />
        <Go to="/agents?page=2" />
      </MemoryRouter>
    )

    fireEvent.click(screen.getByRole('button', { name: /explore/i }))
    expect(screen.getByRole('menu')).toBeInTheDocument()

    rerender(
      <MemoryRouter initialEntries={['/agents']}>
        <NavDropdown label="Explore" items={items} />
        <Go to="/agents?page=3" />
      </MemoryRouter>
    )

    expect(screen.queryByRole('menu')).not.toBeInTheDocument()
  })

  it('follows the trigger when the topbar scrolls (position, not just presence)', () => {
    const restoreMedia = mockNarrowScreen()
    const originalRect = Element.prototype.getBoundingClientRect
    const originalInnerWidth = window.innerWidth
    let triggerLeft = 300
    Element.prototype.getBoundingClientRect = vi.fn(() => ({
      left: triggerLeft,
      bottom: 50,
      top: 30,
      right: triggerLeft + 80,
      width: 80,
      height: 20,
      x: triggerLeft,
      y: 30,
      toJSON: () => {},
    })) as unknown as typeof Element.prototype.getBoundingClientRect
    Object.defineProperty(window, 'innerWidth', { value: 1024, configurable: true })

    try {
      render(
        <div className="topbar">
          <MemoryRouter initialEntries={['/']}>
            <NavDropdown label="Explore" items={items} />
          </MemoryRouter>
        </div>
      )

      fireEvent.click(screen.getByRole('button', { name: /explore/i }))
      const menu = screen.getByRole('menu')
      expect(menu).toHaveStyle({ left: '300px', top: '58px' })

      // Header swipe moves the trigger: the floating menu must follow it
      triggerLeft = 100
      fireEvent.scroll(document.querySelector('.topbar')!)
      expect(screen.getByRole('menu')).toHaveStyle({ left: '100px', top: '58px' })
    } finally {
      Element.prototype.getBoundingClientRect = originalRect
      Object.defineProperty(window, 'innerWidth', { value: originalInnerWidth, configurable: true })
      restoreMedia()
    }
  })

  it('keeps the floating menu on menu/topbar scroll, closes on page scroll', () => {
    const restore = mockNarrowScreen()
    try {
      render(
        <div className="topbar">
          <MemoryRouter initialEntries={['/']}>
            <NavDropdown label="Explore" items={items} />
          </MemoryRouter>
        </div>
      )

      fireEvent.click(screen.getByRole('button', { name: /explore/i }))
      expect(screen.getByRole('menu')).toBeInTheDocument()

      // Scroll inside the menu: local, menu stays
      fireEvent.scroll(screen.getByRole('menu'))
      expect(screen.getByRole('menu')).toBeInTheDocument()

      // Swipe on the header: trigger follows, menu stays
      fireEvent.scroll(document.querySelector('.topbar')!)
      expect(screen.getByRole('menu')).toBeInTheDocument()

      // Page scroll behind the menu dismisses it
      fireEvent.scroll(document)
      expect(screen.queryByRole('menu')).not.toBeInTheDocument()
    } finally {
      restore()
    }
  })

  it('renders item icons as decorative (aria-hidden) without changing accessible names', () => {
    render(
      <MemoryRouter initialEntries={['/']}>
        <NavDropdown
          label="Explore"
          items={[{ to: '/agents', label: 'Agents', description: 'Agent identities', icon: FileText }]}
        />
      </MemoryRouter>
    )

    fireEvent.click(screen.getByRole('button', { name: /explore/i }))

    const menuItem = screen.getByRole('menuitem', { name: /agents/i })
    const icon = menuItem.querySelector('svg.nav-menu-item-icon')
    expect(icon).not.toBeNull()
    expect(icon?.getAttribute('aria-hidden')).toBe('true')
  })
})
