import { describe, expect, it } from 'vitest'
import { isNavItemActive, isResearchActive } from './nav-items'

describe('isNavItemActive', () => {
  it('returns true for exact path match', () => {
    expect(isNavItemActive({ to: '/pages' }, '/pages')).toBe(true)
    expect(isNavItemActive({ to: '/agents' }, '/agents')).toBe(true)
  })

  it('returns true for sub-paths of to', () => {
    expect(isNavItemActive({ to: '/pages' }, '/pages/subpage')).toBe(true)
    expect(isNavItemActive({ to: '/agents' }, '/agents/overview')).toBe(true)
  })

  it('returns false for non-matching paths', () => {
    expect(isNavItemActive({ to: '/pages' }, '/dashboard')).toBe(false)
    expect(isNavItemActive({ to: '/pages' }, '/page-other')).toBe(false)
  })

  it('uses custom isActive predicate when provided', () => {
    const item = {
      to: '/pages',
      isActive: (pathname: string) => pathname.startsWith('/page'),
    }
    expect(isNavItemActive(item, '/page/detail-123')).toBe(true)
    expect(isNavItemActive(item, '/pages')).toBe(true)
    expect(isNavItemActive(item, '/dashboard')).toBe(false)
  })
})

describe('isResearchActive', () => {
  it('is active on root path /', () => {
    expect(isResearchActive('/')).toBe(true)
  })

  it('is active on /research and /reports paths', () => {
    expect(isResearchActive('/research')).toBe(true)
    expect(isResearchActive('/research/doc-1')).toBe(true)
    expect(isResearchActive('/reports')).toBe(true)
    expect(isResearchActive('/reports/summary')).toBe(true)
  })

  it('is not active on other routes', () => {
    expect(isResearchActive('/dashboard')).toBe(false)
    expect(isResearchActive('/pages')).toBe(false)
    expect(isResearchActive('/agents')).toBe(false)
  })
})
