import { act, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { useState } from 'react'
import { useJson } from './useQuery'
import { describe, expect, it, vi } from 'vitest'

function Probe({ load, deps = [] }: { load: () => Promise<string>; deps?: unknown[] }) {
  const state = useJson(load, deps)
  if (state.loading) return <span>loading</span>
  if (state.error) return <span>error: {state.error}</span>
  return <span>value: {state.data}</span>
}

describe('useJson', () => {
  it('exposes loading then resolved data', async () => {
    render(<Probe load={() => Promise.resolve('ready')} />)

    expect(screen.getByText('loading')).toBeInTheDocument()
    expect(await screen.findByText('value: ready')).toBeInTheDocument()
  })

  it('exposes a useful message when loading fails', async () => {
    render(<Probe load={() => Promise.reject(new Error('network unavailable'))} />)

    expect(await screen.findByText('error: network unavailable')).toBeInTheDocument()
  })

  it('keeps the latest request authoritative when an older request resolves first', async () => {
    let resolveFirst!: (value: string) => void
    let resolveSecond!: (value: string) => void
    const firstRequest = new Promise<string>((resolve) => { resolveFirst = resolve })
    const secondRequest = new Promise<string>((resolve) => { resolveSecond = resolve })
    const load = vi.fn((key: string) => key === 'first' ? firstRequest : secondRequest)

    function ChangingProbe() {
      const [key, setKey] = useState('first')
      const state = useJson(() => load(key), [key])
      return (
        <>
          <button type="button" onClick={() => setKey('second')}>switch request</button>
          {state.loading && <span>loading</span>}
          {state.data && <span>value: {state.data}</span>}
        </>
      )
    }

    render(<ChangingProbe />)
    expect(screen.getByText('loading')).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: 'switch request' }))
    await waitFor(() => expect(load).toHaveBeenCalledTimes(2))
    expect(screen.getByText('loading')).toBeInTheDocument()

    await act(async () => {
      resolveFirst('stale value')
      await firstRequest
    })
    expect(screen.getByText('loading')).toBeInTheDocument()
    expect(screen.queryByText('value: stale value')).not.toBeInTheDocument()

    await act(async () => {
      resolveSecond('current value')
      await secondRequest
    })
    expect(screen.getByText('value: current value')).toBeInTheDocument()
    expect(screen.queryByText('value: stale value')).not.toBeInTheDocument()
  })
})
