import { render, screen } from '@testing-library/react'
import { describe, expect, it } from 'vitest'
import { DiffView } from './DiffView'

describe('DiffView', () => {
  it('reports unchanged revisions without rendering a diff', () => {
    render(<DiffView before="same" after="same" />)

    expect(screen.getByText('No changes between these revisions.')).toBeInTheDocument()
    expect(screen.queryByRole('document')).not.toBeInTheDocument()
  })

  it('shows added and removed lines and marks payload text', () => {
    render(<DiffView before={'safe\nold'} after={'safe\n<script>alert(1)</script>'} />)

    expect(screen.getByText('old')).toBeInTheDocument()
    const markedScript = document.querySelector('mark[data-flag="script"]')
    expect(markedScript).toHaveTextContent('<script')
    expect(markedScript).toHaveClass('mark-payload')
    expect(document.querySelector('.diff-del')).toHaveTextContent('old')
    expect(document.querySelector('.diff-add')).toHaveTextContent('<script>alert(1)</script>')
  })
})
