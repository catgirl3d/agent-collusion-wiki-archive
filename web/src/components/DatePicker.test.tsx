import { act, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { MONTHS } from '../utils/date'
import { ArchiveCalendar } from './ArchiveCalendar'
import { DatePicker } from './DatePicker'

const loadJsonMock = vi.hoisted(() => vi.fn())
vi.mock('../api', () => ({ loadJson: loadJsonMock }))

const activity = [
  { date: '2026-06-16', wiki: 'dse', saves: 2565, deletes: 0, reverts: 0, probes: 0, bytes: 0 },
  { date: '2026-06-17', wiki: 'dse', saves: 1261, deletes: 0, reverts: 0, probes: 0, bytes: 0 },
  { date: '2026-06-20', wiki: '', saves: 0, deletes: 0, reverts: 0, probes: 2, bytes: 0 },
]

function renderCalendar(props: Partial<Parameters<typeof ArchiveCalendar>[0]> = {}) {
  loadJsonMock.mockResolvedValue(activity)
  const onChange = vi.fn()
  render(
    <MemoryRouter>
      <ArchiveCalendar value="" onChange={onChange} {...props} />
    </MemoryRouter>,
  )
  return { onChange }
}

afterEach(() => {
  loadJsonMock.mockReset()
})

describe('ArchiveCalendar', () => {
  it('renders available days as enabled and days without activity as disabled', async () => {
    renderCalendar()

    await screen.findByRole('button', { name: /pick a date/i })
    await waitFor(() => expect(screen.getByRole('button', { name: /pick a date/i })).toBeEnabled())
    fireEvent.click(screen.getByRole('button', { name: /pick a date/i }))
    await waitFor(() => expect(screen.getByRole('dialog')).toBeInTheDocument())

    expect(screen.getByRole('button', { name: '16' })).toBeEnabled()
    expect(screen.getByRole('button', { name: '17' })).toBeEnabled()
    expect(screen.getByRole('button', { name: '20' })).toBeEnabled()
    expect(screen.getByRole('button', { name: '15' })).toBeDisabled()
    expect(screen.getByRole('button', { name: '18' })).toBeDisabled()
  })

  it('allows every day when disableInactiveDays is false', async () => {
    renderCalendar({ disableInactiveDays: false })

    await screen.findByRole('button', { name: /pick a date/i })
    await waitFor(() => expect(screen.getByRole('button', { name: /pick a date/i })).toBeEnabled())
    fireEvent.click(screen.getByRole('button', { name: /pick a date/i }))
    await waitFor(() => expect(screen.getByRole('dialog')).toBeInTheDocument())

    expect(screen.getByRole('button', { name: '15' })).toBeEnabled()
    expect(screen.getByRole('button', { name: '18' })).toBeEnabled()
  })

  it('reports the picked day and closes the popup', async () => {
    const { onChange } = renderCalendar()

    await screen.findByRole('button', { name: /pick a date/i })
    await waitFor(() => expect(screen.getByRole('button', { name: /pick a date/i })).toBeEnabled())
    fireEvent.click(screen.getByRole('button', { name: /pick a date/i }))
    fireEvent.click(await screen.findByRole('button', { name: '17' }))

    expect(onChange).toHaveBeenCalledWith('2026-06-17')
    expect(screen.queryByRole('dialog')).toBeNull()
  })

  it('limits month navigation to the archive range', async () => {
    renderCalendar()

    await screen.findByRole('button', { name: /pick a date/i })
    fireEvent.click(screen.getByRole('button', { name: /pick a date/i }))

    await waitFor(() => expect(screen.getByText('June 2026')).toBeInTheDocument())
    expect(screen.getByRole('button', { name: 'Previous month' })).toBeDisabled()
    expect(screen.getByRole('button', { name: 'Next month' })).toBeDisabled()
  })

  it('shows a disabled trigger while activity data is loading and recovers after it resolves', async () => {
    let resolveActivity!: (rows: unknown) => void
    loadJsonMock.mockImplementation(() => new Promise((resolve) => { resolveActivity = resolve }))

    render(
      <MemoryRouter>
        <ArchiveCalendar value="" onChange={() => {}} />
      </MemoryRouter>,
    )
    const trigger = await screen.findByRole('button', { name: /pick a date/i })
    expect(trigger).toBeDisabled()
    expect(screen.queryByRole('dialog')).toBeNull()

    await act(async () => {
      resolveActivity(activity)
    })

    await waitFor(() => expect(screen.getByRole('button', { name: /pick a date/i })).toBeEnabled())
    fireEvent.click(screen.getByRole('button', { name: /pick a date/i }))
    expect(await screen.findByText('June 2026')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: '16' })).toBeEnabled()
  })

  it('falls back to an unbounded date picker when the activity fetch fails', async () => {
    loadJsonMock.mockRejectedValue(new Error('HTTP 500 for activity_by_day.json'))

    render(
      <MemoryRouter>
        <ArchiveCalendar value="" onChange={() => {}} />
      </MemoryRouter>,
    )

    await waitFor(() => expect(screen.getByRole('button', { name: /pick a date/i })).toBeEnabled())
    fireEvent.click(screen.getByRole('button', { name: /pick a date/i }))
    expect(await screen.findByRole('dialog')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: '15' })).toBeEnabled()
    expect(screen.getByRole('button', { name: 'Previous month' })).toBeEnabled()
    expect(screen.getByRole('button', { name: 'Next month' })).toBeEnabled()
  })

  it('closes the popup on Escape and on outside pointerdown without picking', async () => {
    const { onChange } = renderCalendar()

    fireEvent.click(await screen.findByRole('button', { name: /pick a date/i }))
    fireEvent.keyDown(document, { key: 'Escape' })
    expect(screen.queryByRole('dialog')).toBeNull()

    fireEvent.click(screen.getByRole('button', { name: /pick a date/i }))
    fireEvent.pointerDown(document.body)
    expect(screen.queryByRole('dialog')).toBeNull()

    expect(onChange).not.toHaveBeenCalled()
  })

  it('clears the current value via the clear button', async () => {
    const { onChange } = renderCalendar({ value: '2026-06-17' })

    await screen.findByRole('button', { name: /pick a date/i })
    await waitFor(() => expect(screen.getByRole('button', { name: /pick a date/i })).toBeEnabled())
    fireEvent.click(screen.getByRole('button', { name: /pick a date/i }))
    fireEvent.click(await screen.findByRole('button', { name: 'clear' }))

    expect(onChange).toHaveBeenCalledWith('')
    expect(screen.queryByRole('dialog')).toBeNull()
  })
})

describe('DatePicker', () => {
  it('opens on the fallback month and selects any day without availability rules', () => {
    const onChange = vi.fn()
    render(
      <MemoryRouter>
        <DatePicker value="" onChange={onChange} fallbackMonth="2026-06-17" />
      </MemoryRouter>,
    )

    fireEvent.click(screen.getByRole('button', { name: /pick a date/i }))
    expect(screen.getByText('June 2026')).toBeInTheDocument()
    for (const day of ['1', '15', '30']) expect(screen.getByRole('button', { name: day })).toBeEnabled()

    fireEvent.click(screen.getByRole('button', { name: '15' }))
    expect(onChange).toHaveBeenCalledWith('2026-06-15')
  })

  it('defaults to the current UTC month when no value and no fallbackMonth', () => {
    render(
      <MemoryRouter>
        <DatePicker value="" onChange={() => {}} />
      </MemoryRouter>,
    )

    fireEvent.click(screen.getByRole('button', { name: /pick a date/i }))
    const now = new Date()
    const month = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'][now.getUTCMonth()]
    expect(screen.getByText(`${month} ${now.getUTCFullYear()}`)).toBeInTheDocument()
  })
})
