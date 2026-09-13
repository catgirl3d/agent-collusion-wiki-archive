import { render, screen } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { describe, expect, it, vi } from 'vitest'
import Events from './Events'

const useDataMock = vi.hoisted(() => vi.fn())
vi.mock('../components/useQuery', () => ({ useData: useDataMock }))

describe('Events', () => {
  it('gives the event search input a durable accessible name', () => {
    useDataMock.mockReturnValue({ data: [], error: null })

    render(<MemoryRouter><Events /></MemoryRouter>)

    expect(screen.getByRole('textbox', { name: 'Search page / ip16 / action' })).toBeInTheDocument()
  })
})
