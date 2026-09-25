export interface DateRange { from: string; to: string }

export function applyDateBound(range: DateRange, bound: 'from' | 'to', value: string): DateRange {
  const next = { ...range, [bound]: value }
  if (next.from && next.to && next.from > next.to) next[bound === 'from' ? 'to' : 'from'] = ''
  return next
}
