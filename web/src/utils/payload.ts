// Mirrors data/scripts/build.py: detect_payload_flags for the shared flag set and case semantics
// (script/inject/tunnel/redirect are case-insensitive and matched against the raw body, so every match
// offset indexes the original string; hex stays lowercase-only; homoglyph = words mixing latin and cyrillic).
// Known divergence: Python derives tunnel/redirect only from parsed URL hosts, while this scanner also
// flags bare service mentions in body text.
const BASE64_RE = /[A-Za-z0-9+/]{80,}={0,2}/g
const HEX_RE = /(?:0x[0-9a-f]+|[0-9a-f]{64,})/g
const SCRIPT_RE = /<script\b|onerror\s*=|javascript:/gi
const INJECT_RE = /system:|ignore previous|reproducible bypass/gi
const TUNNEL_RE = /(?:pinggy|serveo|localhost\.run|localtunnel)/gi
const REDIRECT_RE = /(?:markdown\.new|r\.jina\.ai)/gi
const URL_RE = /https?:\/\/[^\s<>'"]+/gi
const URL_TRIM_CHARS = '.,;:!?)"]'
// слово, содержащее и латиницу, и кириллицу (NFKC-дифф не гейт — NFKC не меняет кириллицу внутри латинского слова)
const LATIN_RE = /[A-Za-z]/
const CYRILLIC_RE = /[\u0400-\u04ff]/

export function validBase64(value: string): boolean {
  try {
    const decoded = atob(value)
    // Count printable ASCII in a loop: spreading a large decoded string into an array
    // allocates megabyte-scale arrays and causes GC spikes on big payloads.
    let printable = 0
    for (let i = 0; i < decoded.length; i++) {
      const code = decoded.charCodeAt(i)
      if (code >= 32 && code <= 126) printable++
    }
    return decoded.length > 0 && printable / decoded.length > 0.8
  } catch {
    return false
  }
}

export interface PayloadMatch {
  start: number
  end: number
  flag: string
}

export type TechnicalArtifactType = 'domain' | 'endpoint' | 'prompt' | 'line'

export interface TechnicalArtifact {
  artifactType: TechnicalArtifactType
  canonicalValue: string
  techniqueKey?: string
  payloadClass?: 'tunnel' | 'redirect'
}

/**
 * Short procedural lines are coordination evidence only when they are distinctive enough to match
 * and too long to be boilerplate punctuation. Structural wiki markup prefixes (`{`, `|`, `<` and
 * the existing `= * # ! >`) are excluded; leading `:`, `;`, `-` are kept because they prefix
 * prose (indented replies, list items) that can carry real coordination content.
 */
export const LINE_MIN_LENGTH = 12
export const LINE_MAX_LENGTH = 120
const LINE_EXCLUDE_RE = /^(?:[=*#!><|{\s]|https?:\/\/|\[\[)/
const HTTP_SCHEME_RE = /https?:\/\//
const WHITESPACE_RE = /\s+/g

/** Extracts short distinctive single lines for cross-label coordination matching. */
export function extractLineArtifacts(body: string): string[] {
  const lines = new Set<string>()
  for (const rawLine of body.split('\n')) {
    const normalized = rawLine.trim().toLowerCase().replace(WHITESPACE_RE, ' ')
    if (normalized.length < LINE_MIN_LENGTH || normalized.length > LINE_MAX_LENGTH) continue
    if (LINE_EXCLUDE_RE.test(normalized)) continue
    if (HTTP_SCHEME_RE.test(normalized)) continue
    lines.add(normalized)
  }
  return [...lines]
}

export function canonicalUrlHost(value: string): string | null {
  let trimmed = value
  while (trimmed && URL_TRIM_CHARS.includes(trimmed.at(-1)!)) trimmed = trimmed.slice(0, -1)
  try {
    const parsed = new URL(trimmed)
    if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') return null
    const host = parsed.hostname.toLowerCase().replace(/^\[|\]$/g, '').replace(/^www\./, '')
    return host || null
  } catch {
    return null
  }
}

function isIpLiteral(host: string): boolean {
  if (/^(?:\d{1,3}\.){3}\d{1,3}$/.test(host)) {
    return host.split('.').every((part) => Number(part) <= 255)
  }
  return host.includes(':')
}

/** Extracts the normalized technical artifacts used by pair-level attribution. */
export function extractTechnicalArtifacts(body: string): TechnicalArtifact[] {
  const artifacts = new Map<string, TechnicalArtifact>()
  for (const match of body.matchAll(URL_RE)) {
    const host = canonicalUrlHost(match[0])
    if (!host) continue
    const artifactType = isIpLiteral(host) ? 'endpoint' : 'domain'
    const techniqueKey = artifactType === 'domain'
      ? (host.includes('pinggy') ? 'pinggy' : host.includes('serveo') ? 'serveo' : host.includes('localhost.run') ? 'localhost.run' : host.includes('localtunnel') ? 'localtunnel' : undefined)
      : undefined
    const payloadClass = artifactType === 'domain' ? (testRegex(TUNNEL_RE, host) ? 'tunnel' : testRegex(REDIRECT_RE, host) ? 'redirect' : undefined) : undefined
    const artifact: TechnicalArtifact = { artifactType: artifactType as TechnicalArtifactType, canonicalValue: host, ...(techniqueKey ? { techniqueKey } : {}), ...(payloadClass ? { payloadClass: payloadClass as 'tunnel' | 'redirect' } : {}) }
    artifacts.set(`${artifactType}:${host}`, artifact)
  }
  // scanPayloadMatches reports offsets into the original body (all rules are case-insensitive),
  // so the marker is sliced from `body` and lowercased only for canonicalization.
  for (const match of scanPayloadMatches(body, new Set(['inject']))) {
    if (match.flag !== 'inject') continue
    const marker = body.slice(match.start, match.end).toLowerCase()
    // `system:` is intentionally excluded from prompt artifacts: corpus evidence shows it is
    // dominated by non-instruction text (e.g. "task/system:" log lines), while the inject flag
    // still reports it for triage.
    if (marker === 'ignore previous' || marker === 'reproducible bypass') {
      artifacts.set(`prompt:${marker}`, { artifactType: 'prompt', canonicalValue: marker })
    }
  }
  return [...artifacts.values()]
}

/**
 * Single source of truth for flag-to-match scanning: rule regexes, case semantics
 * (script/inject/tunnel/redirect are case-insensitive over the raw body) and Base64
 * validation — mirrors data/scripts/build.py detect_payload_flags. Callers must pass
 * activeFlags to restrict which rules produce matches. Every reported offset indexes
 * the passed body, so callers can slice it directly.
 */
export function scanPayloadMatches(body: string, activeFlags?: Set<string>): PayloadMatch[] {
  const matches: PayloadMatch[] = []
  const rules: Array<[RegExp, string]> = [
    [BASE64_RE, 'b64'],
    [HEX_RE, 'hex'],
    [SCRIPT_RE, 'script'],
    [INJECT_RE, 'inject'],
    [TUNNEL_RE, 'tunnel'],
    [REDIRECT_RE, 'redirect'],
  ]
  for (const [re, flag] of rules) {
    if (activeFlags && !activeFlags.has(flag)) continue
    re.lastIndex = 0
    for (const match of body.matchAll(re)) {
      if (flag === 'b64' && !validBase64(match[0])) continue
      matches.push({ start: match.index ?? 0, end: (match.index ?? 0) + match[0].length, flag })
    }
  }
  const checkHomoglyph = !activeFlags || activeFlags.has('homoglyph')
  const checkEntropy = !activeFlags || activeFlags.has('high-entropy')
  for (const match of body.matchAll(/\S+/g)) {
    const word = match[0]
    const idx = match.index ?? 0
    if (checkHomoglyph && LATIN_RE.test(word) && CYRILLIC_RE.test(word)) {
      matches.push({ start: idx, end: idx + word.length, flag: 'homoglyph' })
    } else if (checkEntropy && word.length >= 200 && shannonEntropy(word) > 4.5) {
      matches.push({ start: idx, end: idx + word.length, flag: 'high-entropy' })
    }
  }
  return matches
}

/**
 * Stateful /g regexes must never leak lastIndex between calls: a prior scan that
 * matched (e.g. detectPayloadFlags over a large body) leaves lastIndex past the end
 * of a short host string, silently failing later .test() calls. Reset before and
 * after every single-value test.
 */
function testRegex(re: RegExp, value: string): boolean {
  re.lastIndex = 0
  const matched = re.test(value)
  re.lastIndex = 0
  return matched
}

function hasMatch(body: string, re: RegExp): boolean {
  return testRegex(re, body)
}

export function shannonEntropy(s: string): number {
  if (!s) return 0
  const counts = new Map<string, number>()
  for (const ch of s) counts.set(ch, (counts.get(ch) ?? 0) + 1)
  const n = s.length
  let ent = 0
  for (const count of counts.values()) {
    const p = count / n
    ent -= p * Math.log2(p)
  }
  return ent
}

export function detectPayloadFlags(body: string): string[] {
  const flags: string[] = []
  const base64 = body.match(BASE64_RE)?.some(validBase64)
  if (base64) flags.push('b64')
  if (hasMatch(body, HEX_RE)) flags.push('hex')
  if (hasMatch(body, SCRIPT_RE)) flags.push('script')
  if (hasMatch(body, INJECT_RE)) flags.push('inject')
  if (body.split(/\s+/).some((word) => LATIN_RE.test(word) && CYRILLIC_RE.test(word))) flags.push('homoglyph')
  if (hasMatch(body, TUNNEL_RE)) flags.push('tunnel')
  if (hasMatch(body, REDIRECT_RE)) flags.push('redirect')
  // high-entropy никогда не единственный вердикт (зеркало build.py)
  if (flags.length > 0 && body.split(/\s+/).some((chunk) => chunk.length >= 200 && shannonEntropy(chunk) > 4.5)) {
    flags.push('high-entropy')
  }
  return flags
}

export interface PayloadSegment {
  text: string
  flag?: string
}

export function highlightMatches(body: string): PayloadSegment[] {
  const matches = scanPayloadMatches(body)
  matches.sort((a, b) => a.start - b.start || b.end - a.end)

  const segments: PayloadSegment[] = []
  let cursor = 0
  for (const match of matches) {
    if (match.start < cursor) continue
    if (match.start > cursor) segments.push({ text: body.slice(cursor, match.start) })
    segments.push({ text: body.slice(match.start, match.end), flag: match.flag })
    cursor = match.end
  }
  if (cursor < body.length) segments.push({ text: body.slice(cursor) })
  return segments.length ? segments : [{ text: body }]
}

// Цвета бейджей payload-флагов: единая палитра для списков и карточек страниц
export const PAYLOAD_FLAG_COLORS: Record<string, string> = {
  inject: '#fb7185', script: '#fb7185', b64: '#fbbf24', hex: '#f59e0b', 'high-entropy': '#f59e0b',
  tunnel: '#60a5fa', redirect: '#38bdf8', homoglyph: '#a855f7',
}
