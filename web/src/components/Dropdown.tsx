import { useEffect, useId, useRef, useState, type KeyboardEvent, type ReactNode } from 'react'

export interface DropdownOption<Value extends string | number> {
  value: Value
  label: ReactNode
}

export interface DropdownProps<Value extends string | number> {
  value: Value
  options: readonly DropdownOption<Value>[]
  onChange: (value: Value) => void
  id?: string
  ariaLabel?: string
  className?: string
  disabled?: boolean
}

export function Dropdown<Value extends string | number>({
  value,
  options,
  onChange,
  id,
  ariaLabel,
  className = '',
  disabled = false,
}: DropdownProps<Value>) {
  const [open, setOpen] = useState(false)
  const [activeValue, setActiveValue] = useState<Value | null>(null)
  const rootRef = useRef<HTMLDivElement>(null)
  const triggerRef = useRef<HTMLButtonElement>(null)
  const optionRefs = useRef<Array<HTMLButtonElement | null>>([])
  const instanceId = useId().replaceAll(':', '')
  const triggerId = id ?? `dropdown-trigger-${instanceId}`
  const listboxId = `dropdown-options-${instanceId}`
  const selectedIndex = options.findIndex((option) => option.value === value)
  const selectedOption = options[selectedIndex]
  const fallbackIndex = selectedIndex >= 0 ? selectedIndex : 0
  const activeValueIndex = options.findIndex((option) => option.value === activeValue)
  const activeOptionIndex = activeValueIndex >= 0 ? activeValueIndex : fallbackIndex
  const displayedLabel = selectedOption?.label ?? (value === '' ? 'select…' : String(value))
  const fallbackAriaLabel = typeof displayedLabel === 'string' || typeof displayedLabel === 'number' ? String(displayedLabel) : undefined

  useEffect(() => {
    if (!open) return

    const onPointerDown = (event: PointerEvent) => {
      if (rootRef.current && event.target instanceof Node && !rootRef.current.contains(event.target)) {
        setOpen(false)
      }
    }
    const onDocumentKeyDown = (event: globalThis.KeyboardEvent) => {
      if (event.key === 'Escape') {
        setOpen(false)
        triggerRef.current?.focus()
      }
    }

    document.addEventListener('pointerdown', onPointerDown)
    document.addEventListener('keydown', onDocumentKeyDown)
    return () => {
      document.removeEventListener('pointerdown', onPointerDown)
      document.removeEventListener('keydown', onDocumentKeyDown)
    }
  }, [open])

  useEffect(() => {
    if (open) optionRefs.current[activeOptionIndex]?.scrollIntoView({ block: 'nearest' })
  }, [activeOptionIndex, open])

  const close = () => {
    setOpen(false)
    triggerRef.current?.focus()
  }

  const select = (option: DropdownOption<Value>) => {
    if (option.value !== value) onChange(option.value)
    close()
  }

  const openWithIndex = (index: number) => {
    if (disabled || options.length === 0) return
    setActiveValue(options[index]?.value ?? null)
    setOpen(true)
  }

  const handleTriggerKeyDown = (event: KeyboardEvent<HTMLButtonElement>) => {
    if (disabled || options.length === 0) return

    if (event.key === 'Escape' && open) {
      event.preventDefault()
      close()
      return
    }

    if (event.key === 'Tab' && open) {
      setOpen(false)
      return
    }

    if (event.key === 'Enter' || event.key === ' ') {
      event.preventDefault()
      if (!open) {
        openWithIndex(fallbackIndex)
      } else if (options[activeOptionIndex]) {
        select(options[activeOptionIndex])
      }
      return
    }

    if (event.key === 'ArrowDown') {
      event.preventDefault()
      if (!open) {
        openWithIndex(fallbackIndex)
      } else {
        const nextIndex = Math.min(activeOptionIndex + 1, options.length - 1)
        setActiveValue(options[nextIndex]?.value ?? null)
      }
      return
    }

    if (event.key === 'ArrowUp') {
      event.preventDefault()
      if (!open) {
        openWithIndex(fallbackIndex)
      } else {
        const nextIndex = Math.max(activeOptionIndex - 1, 0)
        setActiveValue(options[nextIndex]?.value ?? null)
      }
      return
    }

    if (event.key === 'Home' && open) {
      event.preventDefault()
      setActiveValue(options[0]?.value ?? null)
      return
    }

    if (event.key === 'End' && open) {
      event.preventDefault()
      setActiveValue(options[options.length - 1]?.value ?? null)
    }
  }

  return (
    <div className="dropdown" ref={rootRef}>
      <button
        ref={triggerRef}
        id={triggerId}
        type="button"
        role="combobox"
        className={`dropdown-trigger input ${className}`.trim()}
        aria-label={ariaLabel ?? (id ? undefined : fallbackAriaLabel)}
        aria-haspopup="listbox"
        aria-expanded={open}
        aria-controls={open ? listboxId : undefined}
        aria-activedescendant={open && options[activeOptionIndex] ? `${listboxId}-option-${activeOptionIndex}` : undefined}
        disabled={disabled || options.length === 0}
        onClick={() => (open ? close() : openWithIndex(fallbackIndex))}
        onKeyDown={handleTriggerKeyDown}
      >
        <span>{displayedLabel}</span>
        <span className="dropdown-caret" aria-hidden="true">▾</span>
      </button>
      {open && options.length > 0 && (
        <div
          id={listboxId}
          className="dropdown-menu"
          role="listbox"
          aria-labelledby={triggerId}
        >
          {options.map((option, index) => (
            <button
              ref={(element) => { optionRefs.current[index] = element }}
              key={String(option.value)}
              id={`${listboxId}-option-${index}`}
              type="button"
              tabIndex={-1}
              role="option"
              aria-selected={option.value === value}
              className={`dropdown-option${activeOptionIndex === index ? ' active' : ''}`}
              onMouseEnter={() => setActiveValue(option.value)}
              onClick={() => select(option)}
            >
              {option.label}
            </button>
          ))}
        </div>
      )}
    </div>
  )
}
