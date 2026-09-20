import { useEffect, useId, useRef, useState, type FocusEvent, type KeyboardEvent } from 'react'
import { createPortal } from 'react-dom'
import { NavLink, useLocation } from 'react-router-dom'
import { isNavItemActive } from './nav-items'
import { clampFloatingLeft } from './nav-items'
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
  // Parked keyboard focus request for a portal menu that hasn't mounted yet
  const [pendingFocusIndex, setPendingFocusIndex] = useState<number | null>(null)

  const containerRef = useRef<HTMLDivElement>(null)
  const menuRef = useRef<HTMLDivElement>(null)
  const triggerRef = useRef<HTMLButtonElement>(null)
  const itemRefs = useRef<Array<HTMLAnchorElement | null>>([])
  const closeTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const location = useLocation()
  const instanceId = useId().replaceAll(':', '')
  const menuId = id ?? `nav-dropdown-${instanceId}`

  const isGroupActive = items.some((item) => isNavItemActive(item, location.pathname))

  const cancelScheduledClose = () => {
    if (closeTimerRef.current) {
      clearTimeout(closeTimerRef.current)
      closeTimerRef.current = null
    }
  }

  // Grace period on mouse leave so a brief pointer slip across the
  // container edge doesn't kill the menu; re-entering cancels it.
  // Never armed while closed: a stale timer must not outlive its menu.
  const scheduleClose = () => {
    if (!open) return
    cancelScheduledClose()
    closeTimerRef.current = setTimeout(() => {
      closeTimerRef.current = null
      closeRef.current()
    }, 200)
  }

  // Unmount cleanup. Written as an explicit thunk so it doesn't read
  // like a forgotten function call.
  useEffect(() => () => cancelScheduledClose(), [])

  // A pending mouse-leave close dies with the menu: when Explore closes
  // (e.g. Dynamics was clicked), its timer must not slam the new menu shut.
  // A keyboard focus request into a not-yet-mounted portal menu dies too.
  useEffect(() => {
    if (!open) {
      setPendingFocusIndex(null)
      if (closeTimerRef.current) {
        clearTimeout(closeTimerRef.current)
        closeTimerRef.current = null
      }
    }
  }, [open])

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

  // Latest-close ref: effects below must react to navigation/open state,
  // not to the identity of the inline onClose prop (which changes every
  // parent render) — otherwise they'd refire in loops
  const closeRef = useRef(handleClose)
  useEffect(() => {
    closeRef.current = handleClose
  })

  // Close on navigation: key changes on every PUSH/REPLACE, including
  // same-path query/hash changes that leave pathname untouched.
  // Skipped on mount so an initially-open controlled menu isn't slammed shut.
  const skipRouteCloseRef = useRef(true)
  useEffect(() => {
    if (skipRouteCloseRef.current) {
      skipRouteCloseRef.current = false
      return
    }
    closeRef.current()
  }, [location.key])

  // Close on outside pointer interaction (the floating mobile menu lives
  // in a portal outside the container, so it is checked separately)
  useEffect(() => {
    if (!open) return

    function handlePointerDown(event: PointerEvent) {
      const target = event.target as Node
      if (containerRef.current?.contains(target) || menuRef.current?.contains(target)) {
        return
      }
      closeRef.current()
    }

    document.addEventListener('pointerdown', handlePointerDown)
    return () => {
      document.removeEventListener('pointerdown', handlePointerDown)
    }
  }, [open])

  // Close when keyboard focus leaves the dropdown entirely (portal menu included)
  const handleBlur = (event: FocusEvent<HTMLDivElement>) => {
    const next = event.relatedTarget as Node | null
    if (event.currentTarget.contains(next) || menuRef.current?.contains(next)) {
      return
    }
    handleClose()
  }

  // Keyboard focus into the menu. On desktop the items mount synchronously
  // so rAF finds them; on mobile the portal mounts a frame later, so a miss
  // is parked in state and consumed by the portal-mount effect below
  const focusItem = (index: number) => {
    const el = itemRefs.current[index]
    if (el) {
      el.focus()
      setPendingFocusIndex(null)
    } else {
      setPendingFocusIndex(index)
    }
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

  // On narrow screens the sticky topbar is a horizontal scroll container,
  // which clips absolutely positioned menus — so the menu is portaled to
  // document.body with fixed positioning instead of rendering inline
  const [floatingMenu, setFloatingMenu] = useState<boolean>(
    () =>
      typeof window !== 'undefined' &&
      typeof window.matchMedia === 'function' &&
      window.matchMedia('(max-width: 900px)').matches
  )

  useEffect(() => {
    if (typeof window.matchMedia !== 'function') return
    const mq = window.matchMedia('(max-width: 900px)')
    const onChange = (event: MediaQueryListEvent) => setFloatingMenu(event.matches)
    mq.addEventListener('change', onChange)
    return () => mq.removeEventListener('change', onChange)
  }, [])

  const [floatingPos, setFloatingPos] = useState<{ top: number; left: number } | null>(null)

  useEffect(() => {
    if (!open || !floatingMenu) return
    // 250px first-frame estimate (menu min-width); corrected below once mounted
    const measure = (menuWidth = 250) => {
      const rect = triggerRef.current?.getBoundingClientRect()
      if (!rect) return
      const next = {
        top: rect.bottom + 8,
        left: clampFloatingLeft(rect.left, menuWidth, window.innerWidth),
      }
      // Identity guard: identical values keep the reference so effects don't loop
      setFloatingPos((pos) =>
        pos && pos.top === next.top && pos.left === next.left ? pos : next
      )
    }
    measure()
    // Scrolling the page dismisses the menu; scrolling the header just moves
    // the trigger, so the menu follows it; scrolling inside the menu is local
    const onScrollCapture = (event: Event) => {
      const target = event.target as Node | null
      if (target && (menuRef.current?.contains(target) || containerRef.current?.contains(target))) {
        return
      }
      if (target instanceof Element && target.closest('.topbar')) {
        measure()
        return
      }
      closeRef.current()
    }
    const onResize = () => measure()
    window.addEventListener('resize', onResize)
    document.addEventListener('scroll', onScrollCapture, true)
    return () => {
      window.removeEventListener('resize', onResize)
      document.removeEventListener('scroll', onScrollCapture, true)
    }
  }, [open, floatingMenu])

  // Correct the first-frame width estimate with the real measured menu width
  useEffect(() => {
    if (!open || !floatingMenu || !floatingPos) return
    const rect = triggerRef.current?.getBoundingClientRect()
    if (!rect) return
    const width = menuRef.current?.offsetWidth || 250
    const next = {
      top: rect.bottom + 8,
      left: clampFloatingLeft(rect.left, width, window.innerWidth),
    }
    setFloatingPos((pos) =>
      pos && pos.top === next.top && pos.left === next.left ? pos : next
    )
  }, [open, floatingMenu, floatingPos])

  // Consume a keyboard focus request parked while the portal was mounting
  useEffect(() => {
    if (open && floatingMenu && floatingPos && pendingFocusIndex !== null) {
      itemRefs.current[pendingFocusIndex]?.focus()
      setPendingFocusIndex(null)
    }
  }, [open, floatingMenu, floatingPos, pendingFocusIndex])

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
        onKeyDown={(e) => handleItemKeyDown(e, index)}
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
      onMouseEnter={cancelScheduledClose}
      onMouseLeave={scheduleClose}
      onBlur={handleBlur}
    >
      <button
        ref={triggerRef}
        type="button"
        className={`navlink nav-trigger ${isGroupActive ? 'active' : ''}`}
        aria-haspopup="menu"
        aria-expanded={open}
        aria-controls={open ? menuId : undefined}
        onClick={() => (open ? handleClose() : handleOpen())}
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

      {/* Inline only on desktop: on mobile the menu mounts straight into the
          portal once measured — rendering both would remount the focused
          element and replay the animation */}
      {open && !floatingMenu && (
        <div id={menuId} ref={menuRef} className="nav-menu" role="menu" aria-label={label}>
          {menuItems}
        </div>
      )}
      {open &&
        floatingMenu &&
        floatingPos &&
        createPortal(
          <div
            id={menuId}
            ref={menuRef}
            className="nav-menu nav-menu--floating"
            role="menu"
            aria-label={label}
            style={{ top: floatingPos.top, left: floatingPos.left }}
          >
            {menuItems}
          </div>,
          document.body
        )}
    </div>
  )
}
