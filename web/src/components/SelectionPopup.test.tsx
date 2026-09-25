import { fireEvent, render, screen } from '@testing-library/react'
import { createRef } from 'react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { SelectionPopup } from './SelectionPopup'

describe('SelectionPopup', () => {
  afterEach(() => {
    vi.restoreAllMocks()
  })

  it('does not render when there is no text selection', () => {
    const containerRef = createRef<HTMLDivElement>()
    render(
      <div ref={containerRef}>
        <p>Some text</p>
        <SelectionPopup containerRef={containerRef} />
      </div>,
    )

    expect(screen.queryByRole('toolbar', { name: 'Selection actions' })).toBeNull()
  })

  it('renders English buttons and opens correct URLs in new tab upon selection', async () => {
    const openSpy = vi.spyOn(window, 'open').mockImplementation(() => null)
    const containerRef = createRef<HTMLDivElement>()
    const { container } = render(
      <div ref={containerRef}>
        <p>Selected test phrase</p>
        <SelectionPopup containerRef={containerRef} />
      </div>,
    )

    const p = container.querySelector('p')!
    const textNode = p.firstChild!

    const mockRange = {
      getBoundingClientRect: () => ({
        top: 200,
        bottom: 220,
        left: 100,
        right: 250,
        width: 150,
        height: 20,
      }),
    }

    const mockSelection = {
      isCollapsed: false,
      rangeCount: 1,
      anchorNode: textNode,
      focusNode: textNode,
      toString: () => 'Selected test phrase',
      getRangeAt: () => mockRange,
      removeAllRanges: vi.fn(),
    }

    vi.spyOn(window, 'getSelection').mockReturnValue(mockSelection as unknown as Selection)

    fireEvent.mouseUp(document)

    expect(await screen.findByRole('toolbar', { name: 'Selection actions' })).toBeInTheDocument()
    const searchText = screen.getByRole('button', { name: /search text/i })
    const searchPage = screen.getByRole('button', { name: /search page/i })
    expect(searchText).toHaveClass('btn', 'ghost', 'sm', 'selection-popup-btn')
    expect(searchPage).toHaveClass('btn', 'ghost', 'sm', 'selection-popup-btn')

    fireEvent.click(screen.getByRole('button', { name: /search text/i }))
    expect(openSpy).toHaveBeenCalledWith(
      '/search?q=Selected%20test%20phrase',
      '_blank',
      'noopener,noreferrer',
    )

    fireEvent.click(screen.getByRole('button', { name: /search page/i }))
    expect(openSpy).toHaveBeenCalledWith(
      '/pages?q=Selected%20test%20phrase',
      '_blank',
      'noopener,noreferrer',
    )

    // Test Escape key dismissal
    fireEvent.keyUp(document, { key: 'Escape' })
    expect(mockSelection.removeAllRanges).toHaveBeenCalled()
    expect(screen.queryByRole('toolbar', { name: 'Selection actions' })).toBeNull()
  })
})
