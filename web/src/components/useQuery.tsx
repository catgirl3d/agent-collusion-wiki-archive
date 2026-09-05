import { useEffect, useState } from 'react'
import { loadJson } from '../api'

interface QueryState<T> {
  data: T | null
  error: string | null
  loading: boolean
}

export function useJson<T>(load: () => Promise<T>, deps: unknown[]): QueryState<T> {
  const [state, setState] = useState<QueryState<T>>({ data: null, error: null, loading: true })

  useEffect(() => {
    let alive = true
    load().then(
      (data) => alive && setState({ data, error: null, loading: false }),
      (err: unknown) => alive && setState({ data: null, error: err instanceof Error ? err.message : String(err), loading: false }),
    )
    return () => {
      alive = false
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, deps)

  return state
}

export function useData<T>(path: string): QueryState<T> {
  return useJson(() => loadJson<T>(path), [path])
}