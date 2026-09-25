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

    expect(screen.getByRole('button', { name: 'June 16, 2026' })).toBeEnabled()
    expect(screen.getByRole('button', { name: 'June 17, 2026' })).toBeEnabled()
    expect(screen.getByRole('button', { name: 'June 20, 2026' })).toBeEnabled()
    expect(screen.getByRole('button', { name: 'June 15, 2026' })).toBeDisabled()
    expect(screen.getByRole('button', { name: 'June 18, 2026' })).toBeDisabled()
  })

  it('lifts the restriction via the toggle and enables every day', async () => {
    renderCalendar()

    await screen.findByRole('button', { name: /pick a date/i })
    await waitFor(() => expect(screen.getByRole('button', { name: /pick a date/i })).toBeEnabled())
    fireEvent.click(screen.getByRole('button', { name: /pick a date/i }))
    await waitFor(() => expect(screen.getByRole('dialog')).toBeInTheDocument())

    const toggle = screen.getByRole('checkbox', { name: /only days with data/i })
    expect(toggle).toBeChecked()

    fireEvent.click(toggle)
    expect(screen.getByRole('button', { name: 'June 15, 2026' })).toBeEnabled()
    expect(screen.getByRole('button', { name: 'June 18, 2026' })).toBeEnabled()

    fireEvent.click(toggle)
    expect(screen.getByRole('button', { name: 'June 15, 2026' })).toBeDisabled()
    expect(screen.getByRole('button', { name: 'June 18, 2026' })).toBeDisabled()
  })

  it('keeps unavailable days disabled when restriction lifting is disallowed', async () => {
    renderCalendar({ allowLiftRestriction: false })

    await screen.findByRole('button', { name: /pick a date/i })
    await waitFor(() => expect(screen.getByRole('button', { name: /pick a date/i })).toBeEnabled())
    fireEvent.click(screen.getByRole('button', { name: /pick a date/i }))
    await waitFor(() => expect(screen.getByRole('dialog')).toBeInTheDocument())

    expect(screen.queryByRole('checkbox', { name: /only days with data/i })).toBeNull()
    expect(screen.getByRole('button', { name: 'June 16, 2026' })).toBeEnabled()
    expect(screen.getByRole('button', { name: 'June 15, 2026' })).toBeDisabled()
    expect(screen.getByRole('button', { name: 'June 18, 2026' })).toBeDisabled()
  })

  it('reports the picked day and closes the popup', async () => {
    const { onChange } = renderCalendar()

    await screen.findByRole('button', { name: /pick a date/i })
    await waitFor(() => expect(screen.getByRole('button', { name: /pick a date/i })).toBeEnabled())
    fireEvent.click(screen.getByRole('button', { name: /pick a date/i }))
    fireEvent.click(await screen.findByRole('button', { name: 'June 17, 2026' }))

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
    let resolveActivity: ((rows: unknown) => void) | undefined
    loadJsonMock.mockImplementation(() => new Promise((resolve) => { resolveActivity = resolve }))

    render(
      <MemoryRouter>
        <ArchiveCalendar value="" onChange={vi.fn()} />
      </MemoryRouter>,
    )
    const trigger = await screen.findByRole('button', { name: /pick a date/i })
    expect(trigger).toBeDisabled()
    expect(screen.queryByRole('dialog')).toBeNull()

    const resolve = resolveActivity
    if (!resolve) throw new Error('Activity request resolver was not registered')
    await act(async () => {
      resolve(activity)
      await Promise.resolve()
    })

    await waitFor(() => expect(screen.getByRole('button', { name: /pick a date/i })).toBeEnabled())
    fireEvent.click(screen.getByRole('button', { name: /pick a date/i }))
    expect(await screen.findByText('June 2026')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'June 16, 2026' })).toBeEnabled()
  })

  it('falls back to an unbounded date picker when the activity fetch fails', async () => {
    loadJsonMock.mockRejectedValue(new Error('HTTP 500 for activity_by_day.json'))

    render(
      <MemoryRouter>
        <ArchiveCalendar value="" onChange={vi.fn()} />
      </MemoryRouter>,
    )

    await waitFor(() => expect(screen.getByRole('button', { name: /pick a date/i })).toBeEnabled())
    fireEvent.click(screen.getByRole('button', { name: /pick a date/i }))
    expect(await screen.findByRole('dialog')).toBeInTheDocument()
    const now = new Date()
    const month = MONTHS[now.getUTCMonth()]
    expect(screen.getByRole('button', { name: `${month} 15, ${String(now.getUTCFullYear())}` })).toBeEnabled()
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
    for (const day of ['1', '15', '30']) expect(screen.getByRole('button', { name: new RegExp(`June ${day}, 2026`) })).toBeEnabled()

    fireEvent.click(screen.getByRole('button', { name: 'June 15, 2026' }))
    expect(onChange).toHaveBeenCalledWith('2026-06-15')
  })

  it('gives calendar days full date names and announces the selected state', () => {
    render(
      <MemoryRouter>
        <DatePicker value="2026-06-17" onChange={vi.fn()} fallbackMonth="2026-06-17" />
      </MemoryRouter>,
    )

    fireEvent.click(screen.getByRole('button', { name: /pick a date/i }))

    expect(screen.getByRole('button', { name: 'June 16, 2026' })).toBeEnabled()
    expect(screen.getByRole('button', { name: 'June 17, 2026' })).toHaveAttribute('aria-pressed', 'true')
    expect(screen.getByRole('button', { name: 'June 16, 2026' })).toHaveAttribute('aria-pressed', 'false')
  })

  it('defaults to the current UTC month when no value and no fallbackMonth', () => {
    render(
      <MemoryRouter>
        <DatePicker value="" onChange={vi.fn()} />
      </MemoryRouter>,
    )

    fireEvent.click(screen.getByRole('button', { name: /pick a date/i }))
    const now = new Date()
    const month = MONTHS[now.getUTCMonth()]
    expect(screen.getByText(`${month} ${String(now.getUTCFullYear())}`)).toBeInTheDocument()
  })

  it('renders the supplied label for a generic availability restriction', () => {
    render(
      <MemoryRouter>
        <DatePicker
          value=""
          onChange={vi.fn()}
          fallbackMonth="2026-06-17"
          isDayEnabled={() => true}
          allowLiftRestriction
          restrictionLabel="only weekdays"
        />
      </MemoryRouter>,
    )

    fireEvent.click(screen.getByRole('button', { name: /pick a date/i }))
    expect(screen.getByRole('checkbox', { name: 'only weekdays' })).toBeChecked()
  })
})
