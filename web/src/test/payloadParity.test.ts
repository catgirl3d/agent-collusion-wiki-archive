import { describe, expect, it } from 'vitest'
import { classifyPayloadDivergence } from './payloadParity'

describe('payload divergence classifier', () => {
  it('accepts standalone high-entropy only when it is the whole Python verdict', () => {
    expect(classifyPayloadDivergence('q'.repeat(250), ['high-entropy'], [])).toBe('standalone-high-entropy')
    expect(
      classifyPayloadDivergence('<script> ' + 'q'.repeat(220), ['script', 'high-entropy'], ['script']),
    ).toBe('unexpected')
  })

  it('accepts web-only differences only for tunnel/redirect mention flags', () => {
    expect(classifyPayloadDivergence('relay via ngrok-free.app', [], ['tunnel'])).toBe('web-only-host-mention')
    expect(classifyPayloadDivergence('inject body', [], ['beacon'])).toBe('unexpected')
  })

  it('requires an actual nested URL for python-only host differences', () => {
    const documented = 'https://jqp.vercel.app/api/v0?url=https%3A%2F%2Fpure%2Emd%2Fx'
    expect(classifyPayloadDivergence(documented, ['proxy', 'redirect'], ['proxy'])).toBe(
      'python-only-encoded-nested-host',
    )
    expect(classifyPayloadDivergence('https://example.com %3A%2F%2F', ['redirect'], [])).toBe('unexpected')
    expect(
      classifyPayloadDivergence('https://example.com/wrap?u=https%3A%2F%2Fr%2Ejina%2Eai%2Fx', ['redirect'], []),
    ).toBe('unexpected')
  })

  it('treats unknown flag combinations as unexpected', () => {
    expect(classifyPayloadDivergence('body', ['b64', 'script'], ['script'])).toBe('unexpected')
    expect(classifyPayloadDivergence('body', ['redirect', 'proxy'], ['redirect', 'tunnel'])).toBe('unexpected')
  })
})