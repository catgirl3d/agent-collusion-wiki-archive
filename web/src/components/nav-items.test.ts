import { describe, expect, it } from 'vitest'
import { clampFloatingLeft } from './nav-items'

describe('clampFloatingLeft', () => {
  it('keeps the trigger left edge when the menu fits', () => {
    expect(clampFloatingLeft(100, 250, 1024)).toBe(100)
  })

  it('clamps a negative trigger edge to the 8px margin', () => {
    expect(clampFloatingLeft(-20, 250, 1024)).toBe(8)
  })

  it('pins the right edge when the menu would overflow (360px viewport)', () => {
    // Reported case: trigger at 300px, 280px menu on a 360px screen
    // used to render at left=122 and overflow by ~30px
    expect(clampFloatingLeft(300, 280, 360)).toBe(72)
  })

  it('never goes below the 8px margin, even on tiny viewports', () => {
    expect(clampFloatingLeft(0, 300, 200)).toBe(8)
  })
})
