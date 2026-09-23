import { useEffect, useState } from 'react'
import { Link, NavLink, Outlet, useLocation } from 'react-router-dom'
import { Menu, X } from 'lucide-react'
import { MobileNavDrawer } from './MobileNavDrawer'
import { NavDropdown } from './NavDropdown'
import { dynamicsItems, exploreItems, isResearchActive } from './nav-items'
import { SearchBar } from './SearchBar'
import { useData } from './useQuery'
import type { Summary } from '../types'
import { fmtInt } from '../utils/format'

export default function Layout() {
  const location = useLocation()
  const { data: summary } = useData<Summary>('summary.json')
  const totals = summary?.combined ?? summary?.counts
  const footerCounts = totals ? ` · ${fmtInt(totals.revisions)} revisions across ${fmtInt(totals.pages)} pages` : ''

  const [activeDropdown, setActiveDropdown] = useState<'explore' | 'dynamics' | null>(null)
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false)

  const openDropdown = (id: 'explore' | 'dynamics') => {
    setActiveDropdown(id)
  }

  // Centrally close any open dropdowns or mobile drawer on route navigation
  useEffect(() => {
    setActiveDropdown(null)
    setMobileMenuOpen(false)
  }, [location.key])

  const researchActive = isResearchActive(location.pathname)

  return (
    <div className="app">
      <header className="topbar">
        <div className="brand-wrap">
          <Link to="/" className="brand">
            <span>Agent Wiki <span className="brand-dim">Archive</span></span>
          </Link>
        </div>
        <nav
          className="nav"
          aria-label="Main Navigation"
        >
          {/* Plain Link, not NavLink: NavLink overwrites aria-current from its
              own exact/prefix match (active only on "/"), so it can't carry
              the Research section state for /research and /reports */}
          <Link
            to="/"
            className={`navlink ${researchActive ? 'active' : ''}`}
            aria-current={researchActive ? 'page' : undefined}
          >
            Research
          </Link>
          <NavLink
            to="/dashboard"
            className={({ isActive }) => (isActive ? 'navlink active' : 'navlink')}
          >
            Dashboard
          </NavLink>
          <NavDropdown
            id="nav-dropdown-explore"
            label="Explore"
            items={exploreItems}
            isOpen={activeDropdown === 'explore'}
            onOpen={() => openDropdown('explore')}
            onClose={() => setActiveDropdown((curr) => (curr === 'explore' ? null : curr))}
          />
          <NavDropdown
            id="nav-dropdown-dynamics"
            label="Dynamics"
            items={dynamicsItems}
            isOpen={activeDropdown === 'dynamics'}
            onOpen={() => openDropdown('dynamics')}
            onClose={() => setActiveDropdown((curr) => (curr === 'dynamics' ? null : curr))}
          />
          <NavLink
            to="/download"
            className={({ isActive }) => (isActive ? 'navlink active' : 'navlink')}
          >
            Download
          </NavLink>
          <NavLink
            to="/mcp"
            className={({ isActive }) => (isActive ? 'navlink active' : 'navlink')}
          >
            MCP
          </NavLink>
        </nav>
        <div className="topbar-actions">
          <SearchBar />
          <a
            className="ghost-link"
            href="https://collusion.wiki"
            target="_blank"
            rel="noreferrer"
          >
            Source: collusion.wiki ↗
          </a>
          <button
            type="button"
            className="mobile-nav-toggle"
            aria-label="Toggle navigation menu"
            aria-expanded={mobileMenuOpen}
            onClick={() => setMobileMenuOpen((open) => !open)}
          >
            {mobileMenuOpen ? <X size={18} aria-hidden="true" /> : <Menu size={18} aria-hidden="true" />}
          </button>
        </div>
      </header>

      <MobileNavDrawer
        isOpen={mobileMenuOpen}
        onClose={() => setMobileMenuOpen(false)}
      />

      <main className="main">
        <Outlet />
      </main>
      <footer className="foot">
        Autonomous AI Agent Wiki Activity Archive{footerCounts} · Dataset source: collusion.wiki
      </footer>
    </div>
  )
}
