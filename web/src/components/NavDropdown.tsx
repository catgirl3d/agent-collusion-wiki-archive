import { useEffect, useId, useRef, useState, type FocusEvent, type KeyboardEvent } from 'react'
import { NavLink, useLocation } from 'react-router-dom'
import { isNavItemActive } from './nav-items'
import type { NavDropdownItem } from './nav-items'

export interface NavDropdownProps {
  label: string
  items: readonly NavDropdownItem[]
  id?: string
  isOpen?: boolean
  onOpen?: () => void
  onClose?: () => void
}

export function NavDropdown({ label, items, id, isOpen, onOpen, onClose }: NavDropdownProps) {
  const [internalOpen, setInternalOpen] = useState(false)
  const isControlled = typeof isOpen === 'boolean'
  const open = isControlled ? isOpen : internalOpen

  const containerRef = useRef<HTMLDivElement>(null)
  const triggerRef = useRef<HTMLButtonElement>(null)
  const itemRefs = useRef<(HTMLAnchorElement | null)[]>([])
  const location = useLocation()
  const instanceId = useId().replaceAll(':', '')
  const menuId = id ?? `nav-dropdown-${instanceId}`

  const isGroupActive = items.some((item) => isNavItemActive(item, location.pathname))

  const handleOpen = () => {
    if (isControlled) {
      onOpen?.()
    } else {
      setInternalOpen(true)
    }
  }

  const handleClose = () => {
    if (isControlled) {
      onClose?.()
    } else {
      setInternalOpen(false)
    }
  }

  const closeRef = useRef(handleClose)
  useEffect(() => {
    closeRef.current = handleClose
  })

  // Close on outside pointer interaction
  useEffect(() => {
    if (!open) return

    function handlePointerDown(event: PointerEvent) {
      const target = event.target as Node
      if (containerRef.current?.contains(target)) {
        return
      }
      closeRef.current()
    }

    document.addEventListener('pointerdown', handlePointerDown)
    return () => {
      document.removeEventListener('pointerdown', handlePointerDown)
    }
  }, [open])

  // Close when keyboard focus leaves the dropdown entirely
  const handleBlur = (event: FocusEvent<HTMLDivElement>) => {
    const next = event.relatedTarget as Node | null
    if (event.currentTarget.contains(next)) {
      return
    }
    handleClose()
  }

  const focusItem = (index: number) => {
    itemRefs.current[index]?.focus()
  }

  const handleTriggerKeyDown = (event: KeyboardEvent<HTMLButtonElement>) => {
    if (event.key === 'ArrowDown' || event.key === 'Enter' || event.key === ' ') {
      event.preventDefault()
      handleOpen()
      requestAnimationFrame(() => {
        focusItem(0)
      })
    } else if (event.key === 'ArrowUp') {
      event.preventDefault()
      handleOpen()
      requestAnimationFrame(() => {
        focusItem(items.length - 1)
      })
    } else if (event.key === 'Escape' && open) {
      event.preventDefault()
      handleClose()
    }
  }

  const handleItemKeyDown = (event: KeyboardEvent<HTMLAnchorElement>, index: number) => {
    if (event.key === 'ArrowDown') {
      event.preventDefault()
      const nextIndex = (index + 1) % items.length
      itemRefs.current[nextIndex]?.focus()
    } else if (event.key === 'ArrowUp') {
      event.preventDefault()
      const prevIndex = (index - 1 + items.length) % items.length
      itemRefs.current[prevIndex]?.focus()
    } else if (event.key === 'Escape') {
      event.preventDefault()
      handleClose()
      triggerRef.current?.focus()
    }
  }

  const menuItems = items.map((item, index) => {
    const active = isNavItemActive(item, location.pathname)
    const Icon = item.icon
    return (
      <NavLink
        key={item.to}
        ref={(el) => {
          itemRefs.current[index] = el
        }}
        to={item.to}
        role="menuitem"
        className={`nav-menu-item ${active ? 'active' : ''}`}
        onKeyDown={(e) => { handleItemKeyDown(e, index); }}
        onClick={handleClose}
      >
        <span className="nav-menu-item-text">
          <span className="nav-menu-item-title-row">
            {Icon && <Icon className="nav-menu-item-icon" size={16} aria-hidden="true" />}
            <span className="nav-menu-item-title">{item.label}</span>
          </span>
          {item.description && (
            <span className="nav-menu-item-desc">{item.description}</span>
          )}
        </span>
      </NavLink>
    )
  })

  return (
    <div
      ref={containerRef}
      className={`nav-dropdown ${open ? 'open' : ''}`}
      onBlur={handleBlur}
    >
      <button
        ref={triggerRef}
        type="button"
        className={`navlink nav-trigger ${isGroupActive ? 'active' : ''}`}
        aria-haspopup="menu"
        aria-expanded={open}
        aria-controls={open ? menuId : undefined}
        onClick={() => {
          if (open) handleClose()
          else handleOpen()
        }}
        onKeyDown={handleTriggerKeyDown}
      >
        <span>{label}</span>
        <svg
          className={`nav-chevron ${open ? 'rotated' : ''}`}
          width="12"
          height="12"
          viewBox="0 0 12 12"
          aria-hidden="true"
        >
          <path
            d="M2.5 4.5L6 8L9.5 4.5"
            fill="none"
            stroke="currentColor"
            strokeWidth="1.5"
            strokeLinecap="round"
            strokeLinejoin="round"
          />
        </svg>
      </button>

      {open && (
        <div id={menuId} className="nav-menu" role="menu" aria-label={label}>
          {menuItems}
        </div>
      )}
    </div>
  )
}
