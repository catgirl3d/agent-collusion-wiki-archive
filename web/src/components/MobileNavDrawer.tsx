import { useEffect, useRef } from 'react'
import { Link, NavLink, useLocation } from 'react-router-dom'
import { X } from 'lucide-react'
import { dynamicsItems, exploreItems, isNavItemActive, isResearchActive } from './nav-items'
import type { NavDropdownItem } from './nav-items'

export interface MobileNavDrawerProps {
  isOpen: boolean
  onClose: () => void
}

interface NavSection {
  title: string
  items: readonly NavDropdownItem[]
}

const navSections: readonly NavSection[] = [
  { title: 'Explore', items: exploreItems },
  { title: 'Dynamics', items: dynamicsItems },
]

const FOCUSABLE_SELECTOR = 'button, [href], input, select, textarea, [tabindex]:not([tabindex="-1"])'

export function MobileNavDrawer({ isOpen, onClose }: MobileNavDrawerProps) {
  const location = useLocation()
  const drawerRef = useRef<HTMLElement>(null)
  const closeBtnRef = useRef<HTMLButtonElement>(null)

  // Focus management: focus close button on open, trap Tab, restore focus on close, handle Escape
  useEffect(() => {
    if (!isOpen) return

    const previousActiveElement = document.activeElement as HTMLElement | null

    requestAnimationFrame(() => {
      closeBtnRef.current?.focus()
    })

    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.preventDefault()
        onClose()
        return
      }

      if (e.key === 'Tab') {
        const container = drawerRef.current
        if (!container) return
        const focusables = Array.from(
          container.querySelectorAll<HTMLElement>(FOCUSABLE_SELECTOR)
        ).filter((el) => !el.hasAttribute('disabled') && el.getAttribute('aria-hidden') !== 'true')

        if (focusables.length === 0) return

        const first = focusables[0]
        const last = focusables[focusables.length - 1]

        if (e.shiftKey) {
          if (document.activeElement === first || !container.contains(document.activeElement)) {
            e.preventDefault()
            last.focus()
          }
        } else {
          if (document.activeElement === last || !container.contains(document.activeElement)) {
            e.preventDefault()
            first.focus()
          }
        }
      }
    }

    window.addEventListener('keydown', onKeyDown)
    return () => {
      window.removeEventListener('keydown', onKeyDown)
      previousActiveElement?.focus()
    }
  }, [isOpen, onClose])

  if (!isOpen) return null

  const researchActive = isResearchActive(location.pathname)

  return (
    <>
      <div
        className="mobile-drawer-backdrop"
        onClick={onClose}
        aria-hidden="true"
      />
      <nav
        ref={drawerRef}
        className="mobile-drawer"
        aria-label="Mobile Navigation"
        role="dialog"
        aria-modal="true"
      >
        <div className="mobile-drawer-header">
          <span className="mobile-drawer-title">Navigation</span>
          <button
            ref={closeBtnRef}
            type="button"
            className="mobile-drawer-close"
            aria-label="Close navigation menu"
            onClick={onClose}
          >
            <X size={18} aria-hidden="true" />
          </button>
        </div>
        <div className="mobile-drawer-body">
          <div className="mobile-nav-group-links">
            <Link
              to="/"
              className={`mobile-nav-link ${researchActive ? 'active' : ''}`}
              aria-current={researchActive ? 'page' : undefined}
              onClick={onClose}
            >
              <span className="mobile-nav-link-title">Research</span>
            </Link>
            <NavLink
              to="/dashboard"
              className={({ isActive }) => `mobile-nav-link ${isActive ? 'active' : ''}`}
              onClick={onClose}
            >
              <span className="mobile-nav-link-title">Dashboard</span>
            </NavLink>
          </div>

          {navSections.map(({ title, items }) => (
            <div key={title}>
              <div className="mobile-nav-group-title">{title}</div>
              <div className="mobile-nav-group-links">
                {items.map((item) => {
                  const active = isNavItemActive(item, location.pathname)
                  const Icon = item.icon
                  return (
                    <NavLink
                      key={item.to}
                      to={item.to}
                      className={`mobile-nav-link ${active ? 'active' : ''}`}
                      aria-current={active ? 'page' : undefined}
                      onClick={onClose}
                    >
                      {Icon && <Icon className="mobile-nav-link-icon" size={16} aria-hidden="true" />}
                      <div className="mobile-nav-link-text">
                        <div className="mobile-nav-link-title">{item.label}</div>
                        {item.description && (
                          <div className="mobile-nav-link-desc">{item.description}</div>
                        )}
                      </div>
                    </NavLink>
                  )
                })}
              </div>
            </div>
          ))}

          <div className="mobile-nav-group-links">
            <NavLink
              to="/download"
              className={({ isActive }) => `mobile-nav-link ${isActive ? 'active' : ''}`}
              onClick={onClose}
            >
              <span className="mobile-nav-link-title">Download</span>
            </NavLink>
            <a
              className="mobile-nav-link"
              href="https://collusion.wiki"
              target="_blank"
              rel="noreferrer"
              onClick={onClose}
            >
              <span className="mobile-nav-link-title">Source: collusion.wiki ↗</span>
            </a>
          </div>
        </div>
      </nav>
    </>
  )
}
