import { fireEvent, render, screen } from '@testing-library/react'
import { createRef } from 'react'
import { MemoryRouter } from 'react-router-dom'
import { describe, expect, it, vi } from 'vitest'
import { Badge, Button, Card, Chip, LoadMore, PageLink, ScrollTopButton, SortHeader, TextLink } from './ui'

describe('TextLink', () => {
  it('uses the shared inline-link treatment and preserves router link props', () => {
    render(
      <MemoryRouter>
        <TextLink to="/events?day=2026-09-24" className="day-link" title="Open events" aria-label="Events">
          events
        </TextLink>
      </MemoryRouter>,
    )

    const link = screen.getByRole('link', { name: 'Events' })
    expect(link).toHaveAttribute('href', '/events?day=2026-09-24')
    expect(link).toHaveAttribute('title', 'Open events')
    expect(link).toHaveClass('link', 'day-link')
  })

  it('keeps PageLink on its archive route while sharing the inline link component', () => {
    render(
      <MemoryRouter>
        <PageLink id="A/B" name="Archive page" />
      </MemoryRouter>,
    )

    expect(screen.getByRole('link', { name: 'Archive page' })).toHaveAttribute('href', '/page/A%2FB')
  })
})

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
  it('forwards refs to native button elements', () => {
    const buttonRef = createRef<HTMLButtonElement>()
    render(<Button ref={buttonRef}>Action</Button>)

    expect(buttonRef.current).toBe(screen.getByRole('button', { name: 'Action' }))
  })

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

  it('renders a native anchor when href is provided and forwards download attributes', () => {
    render(
      <Button
        href="https://example.com/archive.json"
        variant="ghost"
        size="xs"
        className="copy-link"
        target="_blank"
        rel="noreferrer"
        download="archive.json"
      >
        Download
      </Button>,
    )

    const link = screen.getByRole('link', { name: 'Download' })
    expect(link).toHaveAttribute('href', 'https://example.com/archive.json')
    expect(link).toHaveAttribute('target', '_blank')
    expect(link).toHaveAttribute('rel', 'noreferrer')
    expect(link).toHaveAttribute('download', 'archive.json')
    expect(link).toHaveClass('btn', 'ghost', 'xs', 'copy-link')
  })

  it('renders an accessible square icon button variant', () => {
    render(
      <Button variant="ghost" size="icon" aria-label="Copy link">
        <span aria-hidden="true">copy</span>
      </Button>,
    )

    expect(screen.getByRole('button', { name: 'Copy link' })).toHaveClass('btn', 'ghost', 'icon')
  })
})

describe('Badge and Chip', () => {
  it('preserves badge styles while applying its color and native span attributes', () => {
    render(
      <Badge
        color="#38bdf8"
        className="pair-actor-badge"
        style={{ borderColor: 'red' }}
        title="Actor label"
        aria-label="Actor"
        data-testid="actor-badge"
      >
        MapHelper
      </Badge>,
    )

    const badge = screen.getByTestId('actor-badge')
    expect(badge).toHaveClass('badge', 'pair-actor-badge')
    expect(badge).toHaveAttribute('title', 'Actor label')
    expect(badge).toHaveAttribute('aria-label', 'Actor')
    expect(badge.style.backgroundColor).toBe('rgba(56, 189, 248, 0.133)')
    expect(badge.style.color).toBe('rgb(56, 189, 248)')
    expect(badge.style.borderColor).toBe('red')
  })

  it('preserves chip tone while merging feature classes and native span attributes', () => {
    render(
      <Chip
        tone="wiki"
        className="pair-signal-chip"
        style={{ borderRadius: '4px' }}
        title="Wiki signal"
        data-testid="wiki-chip"
      >
        ExampleWiki
      </Chip>,
    )

    const chip = screen.getByTestId('wiki-chip')
    expect(chip).toHaveClass('chip', 'chip-wiki', 'pair-signal-chip')
    expect(chip).toHaveAttribute('title', 'Wiki signal')
    expect(chip.style.borderRadius).toBe('4px')
  })
})

describe('Card', () => {
  it('renders the requested semantic element and forwards native props and ref', () => {
    const articleRef = createRef<HTMLElement>()
    render(
      <Card
        as="article"
        className="research-doc"
        aria-label="Research document"
        data-testid="research-card"
        ref={articleRef}
        style={{ padding: '2px' }}
      >
        Document content
      </Card>,
    )

    const card = screen.getByTestId('research-card')
    expect(card.tagName).toBe('ARTICLE')
    expect(card).toHaveClass('card', 'research-doc')
    expect(card).toHaveAttribute('aria-label', 'Research document')
    expect(card.style.padding).toBe('2px')
    expect(articleRef.current).toBe(card)
  })

  it('defaults to a div and keeps caller classes', () => {
    render(<Card className="compact" data-testid="basic-card">Content</Card>)

    const card = screen.getByTestId('basic-card')
    expect(card.tagName).toBe('DIV')
    expect(card).toHaveClass('card', 'compact')
  })

  it('exposes the shared compact surface variant', () => {
    render(<Card variant="compact" data-testid="compact-card">Content</Card>)

    expect(screen.getByTestId('compact-card')).toHaveClass('card', 'card-compact')
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
    const scrollTo = vi.spyOn(window, 'scrollTo').mockImplementation(() => undefined)
    render(<LoadMore loaded={100} total={100} onLoadMore={vi.fn()} step={50} />)

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
        onLoadMore={vi.fn()}
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
        onLoadMore={vi.fn()}
        action="Show older revisions"
        unit="remaining"
      />,
    )

    expect(screen.getByRole('button', { name: 'Show older revisions (50 remaining)' })).toBeInTheDocument()
  })

  it('hides the scroll to top button when showScrollTop is false', () => {
    const { container } = render(<LoadMore loaded={100} total={100} onLoadMore={vi.fn()} step={50} showScrollTop={false} />)

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
    const { container } = render(<LoadMore loaded={30} total={30} onLoadMore={vi.fn()} step={50} />)
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
    const scrollTo = vi.spyOn(window, 'scrollTo').mockImplementation(() => undefined)
    render(<ScrollTopButton>Back to top</ScrollTopButton>)

    const topButton = screen.getByRole('button', { name: 'Back to top' })
    expect(topButton).toHaveClass('btn', 'ghost')
    fireEvent.click(topButton)
    expect(scrollTo).toHaveBeenCalledWith({ top: 0, behavior: 'smooth' })
    scrollTo.mockRestore()
  })

  it('runs an additional caller handler with the requested button size', () => {
    const scrollTo = vi.spyOn(window, 'scrollTo').mockImplementation(() => undefined)
    const onClick = vi.fn()
    render(<ScrollTopButton size="sm" onClick={onClick}>Back to top</ScrollTopButton>)

    const topButton = screen.getByRole('button', { name: 'Back to top' })
    fireEvent.click(topButton)

    expect(scrollTo).toHaveBeenCalledWith({ top: 0, behavior: 'smooth' })
    expect(onClick).toHaveBeenCalledOnce()
    expect(topButton).toHaveClass('btn', 'ghost', 'sm')
    scrollTo.mockRestore()
  })
})
