export function parseYearMonth(date: string): { y: number; m: number } {
  return { y: Number(date.slice(0, 4)), m: Number(date.slice(5, 7)) - 1 }
}

export function isoDate(year: number, month: number, day: number): string {
  return `${year}-${String(month + 1).padStart(2, '0')}-${String(day).padStart(2, '0')}`
}

/** 7-cell (or padded to 7) month grid: null = blank cell, string = ISO date. */
export function monthCells(year: number, month: number): (string | null)[] {
  const first = new Date(Date.UTC(year, month, 1))
  const startOffset = (first.getUTCDay() + 6) % 7
  const daysInMonth = new Date(Date.UTC(year, month + 1, 0)).getUTCDate()
  const cells: (string | null)[] = []
  for (let i = 0; i < startOffset; i++) cells.push(null)
  for (let day = 1; day <= daysInMonth; day++) cells.push(isoDate(year, month, day))
  while (cells.length % 7 !== 0) cells.push(null)
  return cells
}

export function stepMonth(year: number, month: number, delta: number): { y: number; m: number } {
  const next = new Date(Date.UTC(year, month + delta, 1))
  return { y: next.getUTCFullYear(), m: next.getUTCMonth() }
}
