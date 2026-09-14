import { fireEvent, render, screen } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { describe, expect, it, vi } from 'vitest'
import { Button, SortHeader } from './ui'

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
