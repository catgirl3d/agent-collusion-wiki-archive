import { useMemo } from 'react'
import type { DayActivity } from '../types'
import { useData } from './useQuery'

export interface ArchiveDays {
  ready: boolean
  error: string | null
  available: Set<string>
  min: string
  max: string
}

export function useArchiveDays(): ArchiveDays {
  const { data, error } = useData<DayActivity[]>('activity_by_day.json')
  return useMemo(() => {
    const available = new Set<string>()
    let min = ''
    let max = ''
    if (data) {
      for (const row of data) {
        if (row.saves + row.deletes + row.reverts + row.probes <= 0) continue
        available.add(row.date)
        if (!min || row.date < min) min = row.date
        if (!max || row.date > max) max = row.date
      }
    }
    return { ready: data !== null, error, available, min, max }
  }, [data, error])
}
