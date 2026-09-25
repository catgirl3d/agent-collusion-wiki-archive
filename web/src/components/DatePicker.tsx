import { useEffect, useRef, useState } from 'react'
import { MONTHS, monthCells, parseYearMonth, stepMonth } from '../utils/date'
import { Button } from './ui'

const WEEKDAYS = ['Mo', 'Tu', 'We', 'Th', 'Fr', 'Sa', 'Su']

export interface DatePickerProps {
  value: string
  onChange: (date: string) => void
  placeholder?: string
  ariaLabel?: string
  /** Initial visible month when value is empty: 'today' or an ISO date. */
  fallbackMonth?: string
  /** Returns false for days that must be rendered gray and unclickable. */
  isDayEnabled?: (date: string) => boolean
  /** When true, the popup shows a toggle to lift the day-availability restriction; when false, the restriction remains strict. */
  allowLiftRestriction?: boolean
  /** Label for the availability restriction toggle. */
  restrictionLabel?: string
  /** Month bounds for navigation; empty means unbounded. */
  minMonth?: string
  maxMonth?: string
}

export function DatePicker({ value, onChange, placeholder = 'date…', ariaLabel = 'Pick a date', fallbackMonth = 'today', isDayEnabled, allowLiftRestriction = false, restrictionLabel = 'only enabled days', minMonth = '', maxMonth = '' }: DatePickerProps) {
  const [open, setOpen] = useState(false)
  const [view, setView] = useState({ y: 0, m: 0 })
  const [onlyEnabledDays, setOnlyEnabledDays] = useState(true)
  const rootRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (!open) return
    const onPointerDown = (event: PointerEvent) => {
      if (rootRef.current && event.target instanceof Node && !rootRef.current.contains(event.target)) setOpen(false)
    }
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') setOpen(false)
    }
    document.addEventListener('pointerdown', onPointerDown)
    document.addEventListener('keydown', onKeyDown)
    return () => {
      document.removeEventListener('pointerdown', onPointerDown)
      document.removeEventListener('keydown', onKeyDown)
    }
  }, [open])

  const initialView = () => {
    const base = value || (fallbackMonth === 'today' ? '' : fallbackMonth)
    return base ? parseYearMonth(base) : { y: new Date().getUTCFullYear(), m: new Date().getUTCMonth() }
  }

  const toggle = () => {
    if (open) {
      setOpen(false)
      return
    }
    setView(initialView())
    setOpen(true)
  }

  const viewMonth = `${String(view.y)}-${String(view.m + 1).padStart(2, '0')}`
  const canPrev = !minMonth || viewMonth > minMonth
  const canNext = !maxMonth || viewMonth < maxMonth

  const pick = (date: string) => {
    onChange(date === value ? '' : date)
    setOpen(false)
  }

  const cells = monthCells(view.y, view.m)

  return (
    <div className="cal" ref={rootRef}>
      <button
        type="button"
        className={`input cal-trigger${value ? ' has-value' : ''}`}
        aria-label={ariaLabel}
        aria-expanded={open}
        onClick={toggle}
      >
        {value || <span className="cal-placeholder">{placeholder}</span>}
        <span className="cal-caret" aria-hidden="true">▾</span>
      </button>
      {open && (
        <div className="cal-popup" role="dialog" aria-label={ariaLabel}>
          <div className="cal-head">
            <Button
              variant="ghost"
              size="sm"
              className="cal-nav"
              aria-label="Previous month"
              disabled={!canPrev}
              onClick={() => { setView(({ y, m }) => stepMonth(y, m, -1)); }}
            >
              ←
            </Button>
            <span className="cal-title">{MONTHS[view.m]} {view.y}</span>
            <Button
              variant="ghost"
              size="sm"
              className="cal-nav"
              aria-label="Next month"
              disabled={!canNext}
              onClick={() => { setView(({ y, m }) => stepMonth(y, m, 1)); }}
            >
              →
            </Button>
          </div>
          {allowLiftRestriction && isDayEnabled && (
            <label className="check cal-restriction">
              <input
                type="checkbox"
                checked={onlyEnabledDays}
                onChange={(event) => { setOnlyEnabledDays(event.target.checked); }}
              />
              {restrictionLabel}
            </label>
          )}
          <div className="cal-grid">
            {WEEKDAYS.map((day) => (
              <span key={day} className="cal-dow">{day}</span>
            ))}
            {cells.map((date, index) =>
              date === null ? (
                <span key={`blank-${String(index)}`} />
              ) : (
                <button
                  key={date}
                  type="button"
                  disabled={isDayEnabled && onlyEnabledDays ? !isDayEnabled(date) : false}
                  className={`cal-day${date === value ? ' selected' : ''}`}
                  aria-label={`${MONTHS[view.m]} ${String(Number(date.slice(8, 10)))}, ${String(view.y)}`}
                  aria-pressed={date === value}
                  onClick={() => { pick(date); }}
                >
                  {Number(date.slice(8, 10))}
                </button>
              ),
            )}
          </div>
          {value && (
            <div className="cal-foot">
              <Button
                variant="ghost"
                size="sm"
                onClick={() => {
                  onChange('')
                  setOpen(false)
                }}
              >
                clear
              </Button>
            </div>
          )}
        </div>
      )}
    </div>
  )
}
