export type SortDir = 'asc' | 'desc'

export type SortState<K extends string> = {
  sort: K
  dir: SortDir
}

export function isSortDir(value: unknown): value is SortDir {
  return value === 'asc' || value === 'desc'
}

export function compareNullableText(a: string | null | undefined, b: string | null | undefined, dir: SortDir): number {
  if (a == null && b == null) return 0
  if (a == null) return 1
  if (b == null) return -1
  const result = a.localeCompare(b)
  return dir === 'asc' ? result : -result
}

export function compareNullableNumber(a: number | null | undefined, b: number | null | undefined, dir: SortDir): number {
  if (a == null && b == null) return 0
  if (a == null) return 1
  if (b == null) return -1
  const result = a - b
  return dir === 'asc' ? result : -result
}

export function resolveSort<K extends string>(
  rawSort: string | null | undefined,
  rawDir: string | null | undefined,
  keys: readonly [K, ...K[]],
  defaults: Record<K, SortDir>,
): SortState<K> {
  const sort = keys.includes(rawSort as K) ? rawSort as K : keys[0]
  const dir = keys.includes(rawSort as K) && isSortDir(rawDir) ? rawDir : defaults[sort]
  return { sort, dir }
}

export function toggleSortState<K extends string>(
  current: SortState<K>,
  key: K,
  defaults: Record<K, SortDir>,
): SortState<K> {
  return key === current.sort
    ? { sort: key, dir: current.dir === 'asc' ? 'desc' : 'asc' }
    : { sort: key, dir: defaults[key] }
}

export function writeSortParams<K extends string>(
  params: URLSearchParams,
  state: SortState<K>,
  canonical: SortState<K>,
): void {
  params.delete('sort')
  params.delete('dir')
  if (state.sort !== canonical.sort || state.dir !== canonical.dir) {
    params.set('sort', state.sort)
    params.set('dir', state.dir)
  }
}

export function updateSortSearchParams<K extends string>(
  currentParams: URLSearchParams,
  current: SortState<K>,
  key: K,
  defaults: Record<K, SortDir>,
  canonical: SortState<K>,
): URLSearchParams {
  const next = new URLSearchParams(currentParams)
  writeSortParams(next, toggleSortState(current, key, defaults), canonical)
  next.delete('page')
  return next
}
