export type DiffRowKind = 'ctx' | 'add' | 'del'

export interface DiffRow {
  kind: DiffRowKind
  text: string
}

const DIFF_TRUNCATION_LINE_LIMIT = 600

function truncatedMarker(lines: number): string {
  return `... [${String(lines)} lines modified] ...`
}

/** True when a row is the "[N lines modified]" fallback marker emitted for oversized diffs. */
export function isTruncationMarker(row: DiffRow): boolean {
  return row.text.startsWith('... [') && row.text.endsWith(' lines modified] ...')
}

export function diffLines(a: string, b: string): DiffRow[] {
  if (a === b) return []
  const al = a.split('\n')
  const bl = b.split('\n')

  // Common prefix stripping
  let start = 0
  while (start < al.length && start < bl.length && al[start] === bl[start]) {
    start++
  }

  // Common suffix stripping
  let aEnd = al.length - 1
  let bEnd = bl.length - 1
  while (aEnd >= start && bEnd >= start && al[aEnd] === bl[bEnd]) {
    aEnd--
    bEnd--
  }

  const prefix: DiffRow[] = []
  const pStart = Math.max(0, start - 3)
  for (let i = pStart; i < start; i++) {
    prefix.push({ kind: 'ctx', text: al[i] })
  }

  const suffix: DiffRow[] = []
  const sEnd = Math.min(al.length, aEnd + 1 + 3)
  for (let i = aEnd + 1; i < sEnd; i++) {
    suffix.push({ kind: 'ctx', text: al[i] })
  }

  const midA = al.slice(start, aEnd + 1)
  const midB = bl.slice(start, bEnd + 1)
  const n = midA.length
  const m = midB.length

  if (n > DIFF_TRUNCATION_LINE_LIMIT || m > DIFF_TRUNCATION_LINE_LIMIT) {
    return [
      ...prefix,
      { kind: 'del', text: truncatedMarker(n) },
      { kind: 'add', text: truncatedMarker(m) },
      ...suffix,
    ]
  }

  const dp: number[][] = Array.from({ length: n + 1 }, () => Array<number>(m + 1).fill(0))
  for (let i = n - 1; i >= 0; i--) {
    for (let j = m - 1; j >= 0; j--) {
      dp[i][j] = midA[i] === midB[j] ? dp[i + 1][j + 1] + 1 : Math.max(dp[i + 1][j], dp[i][j + 1])
    }
  }

  const middle: DiffRow[] = []
  let i = 0
  let j = 0
  while (i < n && j < m) {
    if (midA[i] === midB[j]) {
      middle.push({ kind: 'ctx', text: midA[i] })
      i++
      j++
    } else if (dp[i + 1][j] >= dp[i][j + 1]) {
      middle.push({ kind: 'del', text: midA[i] })
      i++
    } else {
      middle.push({ kind: 'add', text: midB[j] })
      j++
    }
  }
  while (i < n) middle.push({ kind: 'del', text: midA[i++] })
  while (j < m) middle.push({ kind: 'add', text: midB[j++] })

  return [...prefix, ...middle, ...suffix]
}
