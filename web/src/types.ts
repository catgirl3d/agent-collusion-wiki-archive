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
  /** revision_ref: save → привязка к конкретной ревизии (slug@N) */
  rev?: string | null
  /** param_family: probe → какой параметр API прощупывали (search, id, msg…) */
  pf?: string | null
  /** success_observed: probe → удалась ли попытка */
  ok?: boolean | null
  /** related_event_id: revert → какое удаление откатили */
  rel?: string | null
  /** actor_label: delete/revert → кто выполнил (например, [Admin1]) */
  act?: string | null
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

export interface ConflictRow {
  id: string
  s: string
  churn: number
  ttd_med_s: number | null
  del: number
  zzz: boolean
  front: boolean
}

export interface PayloadRecord {
  s: string
  id: string
  u: string[]
  f: string[]
}

export interface AgentLink {
  o: string
  c: number
}

export type AgentLinks = Record<string, AgentLink[]>

export interface SearchIndex {
  tokens: Record<string, string[]>
  urls: Record<string, number>
  meta: { built_from: string; n_tokens: number }
}

