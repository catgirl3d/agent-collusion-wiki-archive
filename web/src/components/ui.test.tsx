import { fireEvent, render, screen } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import { SortHeader } from './ui'

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
