import { fireEvent, render, screen } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { describe, expect, it, vi } from 'vitest'
import { Button, LoadMore, ScrollTopButton, SortHeader } from './ui'

describe('SortHeader', () => {
  it('exposes the active direction and delegates clicks', () => {
    const onToggle = vi.fn()
    render(
      <table>
        <thead>
          <tr>
            <SortHeader label="Hits" sortKey="hits" current={{ sort: 'hits', dir: 'desc' }} numeric onToggle={onToggle} />
          </tr>
        </thead>
      </table>,
    )

    const header = screen.getByRole('columnheader', { name: /Hits/ })
    expect(header).toHaveAttribute('scope', 'col')
    expect(header).toHaveAttribute('aria-sort', 'descending')
    fireEvent.click(screen.getByRole('button', { name: 'Hits' }))
    expect(onToggle).toHaveBeenCalledWith('hits')
  })

  it('allows an inactive header to omit its direction', () => {
    render(
      <table>
        <thead>
          <tr>
            <SortHeader label="Wiki" sortKey="wiki" current={{ sort: 'hits', dir: 'desc' }} onToggle={() => undefined} />
          </tr>
        </thead>
      </table>,
    )

    const header = screen.getByRole('columnheader', { name: 'Wiki' })
    expect(header).not.toHaveAttribute('aria-sort')
    expect(header.querySelector('.sort-arrow')).toBeNull()
  })
})

describe('Button', () => {
  it('renders a plain primary button and merges caller classes', () => {
    const onClick = vi.fn()
    render(<Button className="cal-nav" onClick={onClick}>next →</Button>)

    const button = screen.getByRole('button', { name: 'next →' })
    expect(button).toHaveAttribute('type', 'button')
    expect(button).toHaveClass('btn', 'cal-nav')
    expect(button).not.toHaveClass('ghost')
    expect(button).not.toHaveClass('sm')
    fireEvent.click(button)
    expect(onClick).toHaveBeenCalledTimes(1)
  })

  it('emits ghost and sm classes for the corresponding variants', () => {
    render(<Button variant="ghost" size="sm">pages</Button>)

    expect(screen.getByRole('button', { name: 'pages' })).toHaveClass('btn', 'ghost', 'sm')
  })

  it('blocks clicks while disabled', () => {
    const onClick = vi.fn()
    render(<Button disabled onClick={onClick}>next →</Button>)

    const button = screen.getByRole('button', { name: 'next →' })
    expect(button).toBeDisabled()
    fireEvent.click(button)
    expect(onClick).not.toHaveBeenCalled()
  })

  it('lets an explicit submit type override the button default', () => {
    render(<Button type="submit">Search</Button>)

    expect(screen.getByRole('button', { name: 'Search' })).toHaveAttribute('type', 'submit')
  })

  it('renders a router link with the same button classes when to is provided', () => {
    render(
      <MemoryRouter>
        <Button to="/agents?q=alpha" variant="ghost" size="sm" title="Agent dossier">Agent dossier</Button>
      </MemoryRouter>,
    )

    const link = screen.getByRole('link', { name: 'Agent dossier' })
    expect(link).toHaveAttribute('href', '/agents?q=alpha')
    expect(link).toHaveAttribute('title', 'Agent dossier')
    expect(link).toHaveClass('btn', 'ghost', 'sm')
  })
})

describe('LoadMore', () => {
  it('renders load more button with remaining count and triggers callback', () => {
    const onLoadMore = vi.fn()
    render(<LoadMore loaded={50} total={120} onLoadMore={onLoadMore} step={50} />)

    const button = screen.getByRole('button', { name: 'Load more (70 left)' })
    expect(button).toBeInTheDocument()
    expect(button).not.toHaveAttribute('aria-busy')
    fireEvent.click(button)
    expect(onLoadMore).toHaveBeenCalledTimes(1)
  })

  it('renders scroll to top button when loaded exceeds step threshold', () => {
    const scrollTo = vi.spyOn(window, 'scrollTo').mockImplementation(() => {})
    render(<LoadMore loaded={100} total={100} onLoadMore={() => {}} step={50} />)

    expect(screen.queryByRole('button', { name: /Load more/ })).toBeNull()
    const topButton = screen.getByRole('button', { name: 'Scroll to top' })
    expect(topButton).toBeInTheDocument()
    fireEvent.click(topButton)
    expect(scrollTo).toHaveBeenCalledWith({ top: 0, behavior: 'smooth' })
    scrollTo.mockRestore()
  })

  it('renders custom label', () => {
    render(
      <LoadMore
        loaded={25}
        total={75}
        onLoadMore={() => {}}
        unit="parcels"
        label="Show older revisions (50 remaining)"
      />,
    )

    expect(screen.getByRole('button', { name: 'Show older revisions (50 remaining)' })).toBeInTheDocument()
  })

  it('renders custom action with remaining count and unit', () => {
    render(
      <LoadMore
        loaded={25}
        total={75}
        onLoadMore={() => {}}
        action="Show older revisions"
        unit="remaining"
      />,
    )

    expect(screen.getByRole('button', { name: 'Show older revisions (50 remaining)' })).toBeInTheDocument()
  })

  it('hides the scroll to top button when showScrollTop is false', () => {
    const { container } = render(<LoadMore loaded={100} total={100} onLoadMore={() => {}} step={50} showScrollTop={false} />)

    expect(container).toBeEmptyDOMElement()
  })

  it('disables the button and shows loading text when loading is true', () => {
    const onLoadMore = vi.fn()
    render(<LoadMore loaded={50} total={120} onLoadMore={onLoadMore} loading />)

    const button = screen.getByRole('button', { name: 'Loading…' })
    expect(button).toBeDisabled()
    expect(button).toHaveAttribute('aria-busy', 'true')
    fireEvent.click(button)
    expect(onLoadMore).not.toHaveBeenCalled()
  })

  it('disables the button when disabled is true', () => {
    const onLoadMore = vi.fn()
    render(<LoadMore loaded={50} total={120} onLoadMore={onLoadMore} disabled />)

    const button = screen.getByRole('button', { name: 'Load more (70 left)' })
    expect(button).toBeDisabled()
    fireEvent.click(button)
    expect(onLoadMore).not.toHaveBeenCalled()
  })

  it('returns null when everything is loaded and not exceeding threshold', () => {
    const { container } = render(<LoadMore loaded={30} total={30} onLoadMore={() => {}} step={50} />)
    expect(container).toBeEmptyDOMElement()
  })
})

describe('ScrollTopButton', () => {
  it('exposes an accessible label with a hidden arrow by default', () => {
    render(<ScrollTopButton />)

    const topButton = screen.getByRole('button', { name: 'Scroll to top' })
    expect(topButton.querySelector('[aria-hidden="true"]')).toHaveTextContent('↑')
  })

  it('scrolls to the top and accepts a custom label', () => {
    const scrollTo = vi.spyOn(window, 'scrollTo').mockImplementation(() => {})
    render(<ScrollTopButton>Back to top</ScrollTopButton>)

    const topButton = screen.getByRole('button', { name: 'Back to top' })
    expect(topButton).toHaveClass('btn', 'ghost')
    fireEvent.click(topButton)
    expect(scrollTo).toHaveBeenCalledWith({ top: 0, behavior: 'smooth' })
    scrollTo.mockRestore()
  })
})

