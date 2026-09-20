import { useCallback, useEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { ExternalLink, FileText, Search } from 'lucide-react'

interface SelectionPopupProps {
  containerRef: React.RefObject<HTMLElement | null>
}

interface PopupState {
  visible: boolean
  top: number
  left: number
  text: string
  placement: 'above' | 'below'
}

export function SelectionPopup({ containerRef }: SelectionPopupProps) {
  const [state, setState] = useState<PopupState>({
    visible: false,
    top: 0,
    left: 0,
    text: '',
    placement: 'above',
  })
  const popupRef = useRef<HTMLDivElement>(null)

  const updatePopup = useCallback(() => {
    const container = containerRef.current
    if (!container) return

    const selection = window.getSelection()
    if (!selection || selection.isCollapsed) {
      setState((prev) => (prev.visible ? { ...prev, visible: false } : prev))
      return
    }

    const text = selection.toString().trim()
    if (!text) {
      setState((prev) => (prev.visible ? { ...prev, visible: false } : prev))
      return
    }

    // Ensure selection intersects or is inside the container
    const anchor = selection.anchorNode
    const focus = selection.focusNode
    if (!anchor || !focus || !container.contains(anchor) || !container.contains(focus)) {
      setState((prev) => (prev.visible ? { ...prev, visible: false } : prev))
      return
    }

    if (selection.rangeCount === 0) return
    const range = selection.getRangeAt(0)
    const rect = range.getBoundingClientRect()
    if (rect.width === 0 && rect.height === 0) {
      setState((prev) => (prev.visible ? { ...prev, visible: false } : prev))
      return
    }

    const POPUP_HEIGHT = 44
    const GAP = 8
    const TOPBAR_OFFSET = 64
    const POPUP_HALF_WIDTH = 125

    const placeAbove = rect.top - POPUP_HEIGHT - GAP > TOPBAR_OFFSET
    const top = placeAbove ? rect.top - GAP : rect.bottom + GAP
    const rawLeft = rect.left + rect.width / 2
    // Clamp horizontally to prevent overflowing the viewport
    const left = Math.max(POPUP_HALF_WIDTH + 12, Math.min(window.innerWidth - POPUP_HALF_WIDTH - 12, rawLeft))

    setState({
      visible: true,
      top,
      left,
      text,
      placement: placeAbove ? 'above' : 'below',
    })
  }, [containerRef])

  useEffect(() => {
    const handleMouseUp = () => {
      setTimeout(updatePopup, 10)
    }

    const handleKeyUp = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        const sel = window.getSelection()
        if (sel) sel.removeAllRanges()
        setState((prev) => ({ ...prev, visible: false }))
        return
      }
      setTimeout(updatePopup, 10)
    }

    const handleScrollOrResize = () => {
      const selection = window.getSelection()
      if (!selection || selection.isCollapsed) {
        setState((prev) => (prev.visible ? { ...prev, visible: false } : prev))
      } else {
        updatePopup()
      }
    }

    const handleSelectionChange = () => {
      const selection = window.getSelection()
      if (!selection || selection.isCollapsed) {
        setState((prev) => (prev.visible ? { ...prev, visible: false } : prev))
      }
    }

    document.addEventListener('mouseup', handleMouseUp)
    document.addEventListener('keyup', handleKeyUp)
    document.addEventListener('selectionchange', handleSelectionChange)
    window.addEventListener('scroll', handleScrollOrResize, { passive: true })
    window.addEventListener('resize', handleScrollOrResize, { passive: true })

    return () => {
      document.removeEventListener('mouseup', handleMouseUp)
      document.removeEventListener('keyup', handleKeyUp)
      document.removeEventListener('selectionchange', handleSelectionChange)
      window.removeEventListener('scroll', handleScrollOrResize)
      window.removeEventListener('resize', handleScrollOrResize)
    }
  }, [updatePopup])

  if (!state.visible) return null

  const handleSearchText = () => {
    const url = `/search?q=${encodeURIComponent(state.text)}`
    window.open(url, '_blank', 'noopener,noreferrer')
  }

  const handleSearchPage = () => {
    const url = `/pages?q=${encodeURIComponent(state.text)}`
    window.open(url, '_blank', 'noopener,noreferrer')
  }

  return createPortal(
    <div
      ref={popupRef}
      className={`selection-popup selection-popup-${state.placement}`}
      style={{ top: `${state.top}px`, left: `${state.left}px` }}
      onMouseDown={(e) => {
        // Prevent click from collapsing text selection
        e.preventDefault()
      }}
      role="toolbar"
      aria-label="Selection actions"
    >
      <button
        type="button"
        className="selection-popup-btn"
        onClick={handleSearchText}
        title="Search text in corpus (opens in new tab)"
      >
        <Search size={13} aria-hidden="true" />
        <span>Search text</span>
        <ExternalLink size={11} className="selection-popup-ext" aria-hidden="true" />
      </button>
      <span className="selection-popup-divider" aria-hidden="true" />
      <button
        type="button"
        className="selection-popup-btn"
        onClick={handleSearchPage}
        title="Search page in catalog (opens in new tab)"
      >
        <FileText size={13} aria-hidden="true" />
        <span>Search page</span>
        <ExternalLink size={11} className="selection-popup-ext" aria-hidden="true" />
      </button>
    </div>,
    document.body,
  )
}
