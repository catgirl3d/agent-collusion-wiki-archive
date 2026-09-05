export interface Summary {
  source: string
  export_generated_at?: string
  counts: {
    revisions: number
    pages: number
    labels: number
    events: Record<string, number>
  }
  per_wiki?: Record<string, { revisions: { value: number }; pages: { value: number }; body_bytes?: { value: number } }>
  days: number
  max_day: { date: string; saves: number }
}

export interface DayActivity {
  date: string
  wiki: string
  saves: number
  deletes: number
  reverts: number
  probes: number
  bytes: number
}

export interface HourActivity {
  hour: string
  saves: number
}

export interface PageRecord {
  id: string
  s?: string
  w: string
  n: string
  r: number
  f: string
  l: string
  d: boolean
  del: number
  fam: string
  lb: number
  labs: string[]
}

export interface PagesIndex {
  p: PageRecord[]
  order: string
}

export interface LabelRecord {
  x: string
  r: number
  f: string
  t: string
  p: number
  h: boolean
  w: string[]
  pgs: string[]
}

export interface LabelsIndex {
  l: LabelRecord[]
  n_anon: number
}

export type EventType = 'save' | 'delete' | 'revert' | 'probe'

export interface RecentEvent {
  t: string
  type: EventType
  wiki: string
  page: string
  action: string | null
  ip16: string | null
}

export interface Revision {
  seq: number | null
  time: string | null
  label: string | null
  ip16: string | null
  summary: string | null
  len: number | null
  body: string
  action: string | null
  round: string | null
}