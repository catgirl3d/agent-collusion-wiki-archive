import { fireEvent, render, screen } from '@testing-library/react'
import { FileText } from 'lucide-react'
import { MemoryRouter } from 'react-router-dom'
import { describe, expect, it } from 'vitest'
import { NavDropdown } from './NavDropdown'

const items = [
  { to: '/agents', label: 'Agents' },
  { to: '/pages', label: 'Pages' },
]

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
    const dropdown = trigger.closest('.nav-dropdown')
    if (!dropdown) throw new Error('Dropdown container was not found')
    fireEvent.mouseEnter(dropdown)

    expect(screen.queryByRole('menu')).not.toBeInTheDocument()

    fireEvent.click(trigger)
    expect(screen.getByRole('menu')).toBeInTheDocument()
  })

  it('closes on outside pointerdown', () => {
    renderDropdown()

    fireEvent.click(screen.getByRole('button', { name: /explore/i }))
    expect(screen.getByRole('menu')).toBeInTheDocument()

    fireEvent.pointerDown(document.body)
    expect(screen.queryByRole('menu')).not.toBeInTheDocument()
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

  it('closes on Escape and returns focus to trigger', () => {
    renderDropdown()

    const trigger = screen.getByRole('button', { name: /explore/i })
    fireEvent.click(trigger)
    expect(screen.getByRole('menu')).toBeInTheDocument()

    const firstItem = screen.getByRole('menuitem', { name: /agents/i })
    fireEvent.keyDown(firstItem, { key: 'Escape' })

    expect(screen.queryByRole('menu')).not.toBeInTheDocument()
    expect(document.activeElement).toBe(trigger)
  })

  it('navigates through items with arrow keys', () => {
    renderDropdown()

    const trigger = screen.getByRole('button', { name: /explore/i })
    fireEvent.click(trigger)

    const firstItem = screen.getByRole('menuitem', { name: /agents/i })
    const secondItem = screen.getByRole('menuitem', { name: /pages/i })

    firstItem.focus()
    expect(document.activeElement).toBe(firstItem)

    fireEvent.keyDown(firstItem, { key: 'ArrowDown' })
    expect(document.activeElement).toBe(secondItem)

    fireEvent.keyDown(secondItem, { key: 'ArrowDown' })
    expect(document.activeElement).toBe(firstItem)

    fireEvent.keyDown(firstItem, { key: 'ArrowUp' })
    expect(document.activeElement).toBe(secondItem)
  })

  it('closes when a menu item is clicked', () => {
    renderDropdown()

    fireEvent.click(screen.getByRole('button', { name: /explore/i }))
    expect(screen.getByRole('menu')).toBeInTheDocument()

    fireEvent.click(screen.getByRole('menuitem', { name: /agents/i }))
    expect(screen.queryByRole('menu')).not.toBeInTheDocument()
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
