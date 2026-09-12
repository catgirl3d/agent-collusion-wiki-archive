import { DatePicker } from './DatePicker'
import { useArchiveDays } from './useArchiveDays'

export interface ArchiveCalendarProps {
  value: string
  onChange: (date: string) => void
  placeholder?: string
  ariaLabel?: string
  /**
   * When true (default), the popup shows an "only days with data" toggle and starts
   * with days without recorded activity disabled; the user can lift the restriction.
   * When false, the toggle is hidden and days without recorded activity remain disabled.
   */
  allowLiftRestriction?: boolean
}

export function ArchiveCalendar({ value, onChange, placeholder = 'date…', ariaLabel = 'Pick a date', allowLiftRestriction = true }: ArchiveCalendarProps) {
  const { ready, error, available, min, max } = useArchiveDays()

  // On fetch failure the fallback keeps date input available: all days enabled, no bounds.
  if (error) {
    return (
      <DatePicker
        value={value}
        onChange={onChange}
        placeholder={placeholder}
        ariaLabel={ariaLabel}
        fallbackMonth={value || min || max || 'today'}
      />
    )
  }

  if (!ready) {
    return (
      <div className="cal">
        <button type="button" className="input cal-trigger" aria-label={ariaLabel} disabled>
          <span className="cal-placeholder">Loading…</span>
          <span className="cal-caret" aria-hidden="true">▾</span>
        </button>
      </div>
    )
  }

  return (
    <DatePicker
      value={value}
      onChange={onChange}
      placeholder={placeholder}
      ariaLabel={ariaLabel}
      fallbackMonth={value || max || min}
      minMonth={min ? min.slice(0, 7) : ''}
      maxMonth={max ? max.slice(0, 7) : ''}
      isDayEnabled={(date) => available.has(date)}
      allowLiftRestriction={allowLiftRestriction}
      restrictionLabel="only days with data"
    />
  )
}
