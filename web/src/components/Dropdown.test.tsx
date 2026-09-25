import { fireEvent, render, screen } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import { Dropdown } from './Dropdown'

const wikiOptions = [
  { value: '', label: 'all wikis' },
  { value: 'dse', label: 'dse' },
  { value: 'meta', label: 'meta' },
]

describe('Dropdown', () => {
  it('opens the option list and reports the selected string value', () => {
    const onChange = vi.fn()
    render(<Dropdown value="" options={wikiOptions} onChange={onChange} />)

    const trigger = screen.getByRole('combobox', { name: 'all wikis' })
    expect(trigger).toHaveAttribute('aria-expanded', 'false')

    fireEvent.click(trigger)
    expect(screen.getByRole('listbox')).toHaveAccessibleName('all wikis')

    fireEvent.click(screen.getByRole('option', { name: 'dse' }))

    expect(onChange).toHaveBeenCalledWith('dse')
    expect(screen.queryByRole('listbox')).not.toBeInTheDocument()
  })

  it('preserves numeric option values and supports keyboard selection', () => {
    const onChange = vi.fn()
    render(
      <Dropdown
        value={2}
        options={[
          { value: 2, label: '≥ 2 pages' },
          { value: 5, label: '≥ 5 pages' },
        ]}
        onChange={onChange}
      />,
    )

    const trigger = screen.getByRole('combobox', { name: '≥ 2 pages' })
    fireEvent.keyDown(trigger, { key: 'ArrowDown' })
    expect(trigger).toHaveAttribute('aria-activedescendant', expect.stringContaining('-option-0'))
    fireEvent.keyDown(trigger, { key: 'ArrowDown' })
    fireEvent.keyDown(trigger, { key: 'Enter' })

    expect(onChange).toHaveBeenCalledWith(5)
  })

  it('closes on Escape or outside pointerdown without changing the value', () => {
    const onChange = vi.fn()
    render(<Dropdown value="" options={wikiOptions} onChange={onChange} />)

    const trigger = screen.getByRole('combobox', { name: 'all wikis' })
    fireEvent.click(trigger)
    fireEvent.keyDown(document, { key: 'Escape' })
    expect(screen.queryByRole('listbox')).not.toBeInTheDocument()

    fireEvent.click(trigger)
    fireEvent.pointerDown(document.body)
    expect(screen.queryByRole('listbox')).not.toBeInTheDocument()
    expect(onChange).not.toHaveBeenCalled()
  })

  it('closes on Tab without returning focus to the trigger', () => {
    render(<Dropdown value="" options={wikiOptions} onChange={vi.fn()} />)

    const trigger = screen.getByRole('combobox', { name: 'all wikis' })
    fireEvent.click(trigger)
    fireEvent.keyDown(trigger, { key: 'Tab' })

    expect(screen.queryByRole('listbox')).not.toBeInTheDocument()
  })

  it('keeps the active option attached to its value when options reorder', () => {
    const { rerender } = render(<Dropdown value="dse" options={wikiOptions} onChange={vi.fn()} />)
    const trigger = screen.getByRole('combobox', { name: 'dse' })

    fireEvent.click(trigger)
    rerender(
      <Dropdown
        value="dse"
        options={[
          { value: 'dse', label: 'dse' },
          { value: 'meta', label: 'meta' },
          { value: '', label: 'all wikis' },
        ]}
        onChange={vi.fn()}
      />,
    )

    expect(trigger).toHaveAttribute('aria-activedescendant', expect.stringContaining('-option-0'))
  })

  it('keeps an external label associated with the trigger', () => {
    render(
      <>
        <label htmlFor="min-shared-select">Min shared:</label>
        <Dropdown
          id="min-shared-select"
          value={2}
          options={[{ value: 2, label: '≥ 2 pages' }]}
          onChange={vi.fn()}
        />
      </>,
    )

    const trigger = screen.getByRole('combobox', { name: 'Min shared:' })
    fireEvent.click(trigger)

    expect(screen.getByRole('listbox')).toHaveAccessibleName('Min shared:')
  })

  it('scrolls the active option into view during keyboard navigation', () => {
    const scrollIntoView = vi.spyOn(HTMLElement.prototype, 'scrollIntoView')
    render(
      <Dropdown
        value="one"
        options={[
          { value: 'one', label: 'one' },
          { value: 'two', label: 'two' },
          { value: 'three', label: 'three' },
        ]}
        onChange={vi.fn()}
      />,
    )

    const trigger = screen.getByRole('combobox', { name: 'one' })
    fireEvent.click(trigger)
    scrollIntoView.mockClear()
    fireEvent.keyDown(trigger, { key: 'End' })

    expect(scrollIntoView).toHaveBeenCalledWith({ block: 'nearest' })
  })

  it('shows the controlled value while options are still loading', () => {
    render(<Dropdown value="dse" options={[{ value: '', label: 'all wikis' }]} onChange={vi.fn()} />)

    expect(screen.getByRole('combobox', { name: 'dse' })).toBeInTheDocument()
  })

  it('ignores clicks on disabled options and skips them with arrow keys', () => {
    const onChange = vi.fn()
    render(
      <Dropdown
        value="en"
        options={[
          { value: 'en', label: 'EN' },
          { value: 'ru', label: 'RU', disabled: true },
          { value: 'de', label: 'DE' },
        ]}
        onChange={onChange}
      />,
    )

    const trigger = screen.getByRole('combobox', { name: 'EN' })
    fireEvent.click(trigger)

    const ruOption = screen.getByRole('option', { name: 'RU' })
    expect(ruOption).toBeDisabled()
    expect(ruOption).toHaveAttribute('aria-disabled', 'true')

    fireEvent.click(ruOption)
    expect(onChange).not.toHaveBeenCalled()
    expect(screen.getByRole('listbox')).toBeInTheDocument()

    fireEvent.keyDown(trigger, { key: 'ArrowDown' })
    expect(trigger).toHaveAttribute('aria-activedescendant', expect.stringContaining('-option-2'))

    fireEvent.keyDown(trigger, { key: 'ArrowUp' })
    expect(trigger).toHaveAttribute('aria-activedescendant', expect.stringContaining('-option-0'))

    fireEvent.keyDown(trigger, { key: 'ArrowDown' })
    fireEvent.keyDown(trigger, { key: 'Enter' })
    expect(onChange).toHaveBeenCalledWith('de')
  })

  it('skips disabled options for Home and End', () => {
    render(
      <Dropdown
        value="b"
        options={[
          { value: 'a', label: 'A', disabled: true },
          { value: 'b', label: 'B' },
          { value: 'c', label: 'C', disabled: true },
          { value: 'd', label: 'D' },
        ]}
        onChange={vi.fn()}
      />,
    )

    const trigger = screen.getByRole('combobox', { name: 'B' })
    fireEvent.click(trigger)
    expect(trigger).toHaveAttribute('aria-activedescendant', expect.stringContaining('-option-1'))

    fireEvent.keyDown(trigger, { key: 'End' })
    expect(trigger).toHaveAttribute('aria-activedescendant', expect.stringContaining('-option-3'))

    fireEvent.keyDown(trigger, { key: 'Home' })
    expect(trigger).toHaveAttribute('aria-activedescendant', expect.stringContaining('-option-1'))
  })

  it('falls back to the first enabled option when the selected option is disabled', () => {
    render(
      <Dropdown
        value="a"
        options={[
          { value: 'a', label: 'A', disabled: true },
          { value: 'b', label: 'B' },
          { value: 'c', label: 'C' },
        ]}
        onChange={vi.fn()}
      />,
    )

    const trigger = screen.getByRole('combobox', { name: 'A' })
    fireEvent.click(trigger)

    expect(trigger).toHaveAttribute('aria-activedescendant', expect.stringContaining('-option-1'))
  })

  it('supports align, menuClassName and renderTriggerLabel', () => {
    render(
      <Dropdown
        value="en"
        align="right"
        menuClassName="lang-dropdown-menu"
        options={[{ value: 'en', label: 'English' }]}
        renderTriggerLabel={(opt) => <span>Custom: {opt?.label}</span>}
        onChange={vi.fn()}
      />,
    )

    const trigger = screen.getByRole('combobox')
    expect(trigger).toHaveTextContent('Custom: English')

    fireEvent.click(trigger)
    const listbox = screen.getByRole('listbox')
    expect(listbox).toHaveClass('align-right')
    expect(listbox).toHaveClass('lang-dropdown-menu')
  })
})
