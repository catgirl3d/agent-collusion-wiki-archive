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
  supplement?: {
    source: string
    recovered: string
    sha256: string
    bytes: number
    counts?: { pages: number; revisions: number }
    per_wiki?: Record<string, { pages: number; revisions: number }>
  }
  combined?: { revisions: number; pages: number }
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
  rec?: number
}

export interface HourActivity {
  hour: string
  saves: number
  rec?: number
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
  partial?: boolean
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

type RecentEventFields = {
  t: string
  wiki: string
  page: string
  action?: string | null
  ip16: string | null
  /** revision_ref: save → pins the exact revision (slug@N) */
  rev?: string | null
  /** param_family: probe → which API parameter was probed (search, id, msg…) */
  pf?: string | null
  /** success_observed: probe → whether the attempt succeeded */
  ok?: boolean | null
  /** actor_label: delete/revert → who performed it (e.g. [Admin1]) */
  act?: string | null
  partial?: boolean
}

export type RecentEvent = RecentEventFields & (
  | { type: 'save'; rel?: string[] }
  | { type: 'revert'; rel?: string }
  | { type: 'delete' | 'probe'; rel?: string | string[] }
)

export interface Revision {
  seq: number | null
  time: string | null
  label: string | null
  ip16: string | null
  summary: string | null
  len: number | null
  body: string
  action: string | null
  /** round_id references: the raw export stores them as a list */
  round: (string | null)[] | null
  partial?: boolean
  append?: boolean
  added?: string[]
  removed?: string[]
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
  partial?: boolean
}

export interface TimelineFile {
  meta: { schema_version: number; export_generated_at: string | null; count: number; order: string; supplement_count?: number }
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

export interface CorpusRevisionKey {
  w: string
  id: string
  seq: number | null
  t: string
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
  bytes: number
  lines: number
  snippet: string
}

export interface CorpusSearchResult {
  q: string
  case_sensitive: boolean
  total: number
  limit: number
  offset: number
  matches: CorpusMatch[]
}

export interface ResearchTocItem {
  id: string
  text: string
  level: number
}

export interface ResearchMeta {
  date: string | null
  author: string
  status: string | null
}

export interface ResearchLanguage {
  code: string
  label: string
}

export interface ResearchTranslation {
  lang: string
  slug: string
}

export interface ResearchDoc {
  slug: string
  title: string
  source: string
  html: string
  raw: string
  lang: string
  base: string
  translations: ResearchTranslation[]
  meta?: ResearchMeta
  toc?: ResearchTocItem[]
}

export interface ResearchFile {
  name: string
  raw: string
}

export interface ResearchGroup {
  id: string
  label: string
  docs: ResearchDoc[]
  files: ResearchFile[]
}

export interface ResearchIndex {
  source: string
  languages: ResearchLanguage[]
  groups: ResearchGroup[]
}

