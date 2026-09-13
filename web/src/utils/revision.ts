export function compareCanonicalRevisionOrder(
  a: { t: string; id: string; seq: number | null },
  b: { t: string; id: string; seq: number | null },
): number {
  return b.t.localeCompare(a.t) || a.id.localeCompare(b.id) || (a.seq ?? 0) - (b.seq ?? 0)
}
