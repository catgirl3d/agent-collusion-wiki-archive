import { useEffect, useState } from 'react'
import { loadJson } from '../api'

interface QueryState<T> {
  data: T | null
  error: string | null
  loading: boolean
}

function depsChanged(previous: unknown[], next: unknown[]): boolean {
  return previous.length !== next.length || next.some((value, index) => !Object.is(value, previous[index]))
}

export function useJson<T>(load: () => Promise<T>, deps: unknown[]): QueryState<T> {
  const [state, setState] = useState<QueryState<T>>({ data: null, error: null, loading: true })
  const [trackedDeps, setTrackedDeps] = useState(deps)

  // Render-time reset (React "adjusting state when props change"): a deps change must not
  // render the previous request's data, not even for the frame before the fetch effect runs.
  if (depsChanged(trackedDeps, deps)) {
    setTrackedDeps(deps)
    setState({ data: null, error: null, loading: true })
  }

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