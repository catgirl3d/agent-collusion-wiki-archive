import '@testing-library/jest-dom/vitest'
import { cleanup } from '@testing-library/react'
import { afterEach, vi } from 'vitest'

afterEach(() => {
  cleanup()
  vi.restoreAllMocks()
  vi.unstubAllGlobals()
})

Object.defineProperty(window, 'scrollTo', { value: () => undefined, writable: true })

const scrollIntoView: unknown = Reflect.get(HTMLElement.prototype, 'scrollIntoView')
if (!scrollIntoView) {
  HTMLElement.prototype.scrollIntoView = () => undefined
}
