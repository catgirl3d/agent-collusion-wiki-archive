/**
 * Canonical ordering: returns [a, b] sorted with localeCompare so URLs never duplicate pair orderings.
 */
export function canonicalPair(a: string, b: string): [string, string] {
  return a.localeCompare(b) <= 0 ? [a, b] : [b, a]
}

export interface PairSelection {
  a: string
  b: string
}

/**
 * Parse pairA/pairB from URL params. Returns null when absent, equal, empty,
 * or (when validLabels given) any label is unknown. Result is canonicalized.
 */
export function parsePair(params: URLSearchParams, validLabels?: Iterable<string>): PairSelection | null {
  const rawA = params.get('pairA')
  const rawB = params.get('pairB')
  if (!rawA || !rawB || rawA === rawB || rawA.trim() === '' || rawB.trim() === '') {
    return null
  }
  if (validLabels !== undefined) {
    const set = validLabels instanceof Set ? validLabels : new Set(validLabels)
    if (!set.has(rawA) || !set.has(rawB)) {
      return null
    }
  }
  const [a, b] = canonicalPair(rawA, rawB)
  return { a, b }
}

/**
 * Set pairA/pairB in canonical order into a copy of params.
 * Deletes `pairPage` unless opts.keepPage. Returns a new URLSearchParams.
 */
export function setPair(
  params: URLSearchParams,
  a: string,
  b: string,
  opts?: { keepPage?: boolean },
): URLSearchParams {
  const next = new URLSearchParams(params)
  const [canA, canB] = canonicalPair(a, b)
  next.set('pairA', canA)
  next.set('pairB', canB)
  if (!opts?.keepPage) {
    next.delete('pairPage')
  }
  return next
}

/**
 * Remove pairA, pairB and pairPage from a copy of params.
 */
export function clearPair(params: URLSearchParams): URLSearchParams {
  const next = new URLSearchParams(params)
  next.delete('pairA')
  next.delete('pairB')
  next.delete('pairPage')
  return next
}

/**
 * Validate `pairPage` param. Returns the id or null when absent,
 * or (when validPageIds given) not found in the set.
 */
export function parsePairPage(params: URLSearchParams, validPageIds?: Iterable<string>): string | null {
  const rawPage = params.get('pairPage')
  if (!rawPage || rawPage.trim() === '') {
    return null
  }
  if (validPageIds !== undefined) {
    const set = validPageIds instanceof Set ? validPageIds : new Set(validPageIds)
    if (!set.has(rawPage)) {
      return null
    }
  }
  return rawPage
}
