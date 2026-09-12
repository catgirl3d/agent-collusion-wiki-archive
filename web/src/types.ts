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
  corpus?: CorpusMeta
}

export interface CorpusMeta {
  path: string
  sha256: string
  compressed_bytes: number
  decoded_sha256: string
  decoded_bytes: number
  revisions: number
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
  /** revision_ref: save → pins the exact revision (slug@N) */
  rev?: string | null
  /** param_family: probe → which API parameter was probed (search, id, msg…) */
  pf?: string | null
  /** success_observed: probe → whether the attempt succeeded */
  ok?: boolean | null
  /** related_event_id: revert → which deletion was reverted */
  rel?: string | null
  /** actor_label: delete/revert → who performed it (e.g. [Admin1]) */
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

export interface TimelineEntry {
  t: string
  w: string
  id: string
  s: string
  seq: number | null
  x: string | null
  a: string | null
  ip: string | null
  l: number | null
}

export interface TimelineFile {
  meta: { schema_version: number; export_generated_at: string | null; count: number; order: string }
  r: TimelineEntry[]
}

export interface CorpusRecord {
  w: string
  id: string
  seq: number | null
  t: string
  x: string | null
  body: string
}

export interface CorpusMatch {
  w: string
  id: string
  s: string
  n: string
  seq: number | null
  t: string
  x: string | null
  occurrences: number
  snippet: string
}

export interface CorpusSearchResult {
  q: string
  case_sensitive: boolean
  whole_word?: boolean
  total: number
  limit: number
  offset: number
  matches: CorpusMatch[]
}

