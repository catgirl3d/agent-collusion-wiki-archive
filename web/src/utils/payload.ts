// Mirrors data/scripts/build.py: detect_payload_flags for the shared flag set and case semantics
// (script/inject/tunnel/redirect/proxy/callback/exec/data-uri are case-insensitive and matched against
// the raw body, so every match offset indexes the original string; hex stays lowercase-only;
// homoglyph = words mixing latin and cyrillic).
// Known divergence: Python derives tunnel/redirect/proxy/callback only from parsed URL hosts (and,
// for callback, parsed URL paths), while this scanner also flags bare service mentions in body text.
const BASE64_RE = /[A-Za-z0-9+/]{80,}={0,2}/g
const HEX_RE = /(?:0x[0-9a-f]+|[0-9a-f]{64,})/g
const SCRIPT_RE = /<script\b|onerror\s*=|javascript:/gi
const INJECT_RE = /system:|ignore previous|reproducible bypass/gi
const TUNNEL_RE = /(?:pinggy|serveo|serveousercontent|localhost\.run|localtunnel|ngrok-free\.app|ngrok\.app|trycloudflare|bore\.pub|tunnelmole|devtunnels\.ms|zrok\.io)/gi
const REDIRECT_RE = /(?:markdown\.new|r\.jina\.ai|pure\.md)/gi
const TRAVERSAL_RE = /\.\.(?:%2f|%252f)/gi
const ATOB_RE = /\b(?:window\.)?atob\s*\(|\bbtoa\s*\(/gi
const EXEC_RES: RegExp[] = [
  /(?:curl|wget)\s+(?:-\S+\s+)*https?:\/\/\S*\s*\|\s*(?:sudo\s+)?(?:ba|z|da|fi)?sh\b/gi,
  /(?:powershell|pwsh)\b[^;\n]{0,120}(?:-enc(?:odedcommand)?\b|-ep\s+bypass)/gi,
  /\beval\s*\(\s*(?:atob|unescape|base64_decode|window\.atob)\s*\(/gi,
  /\b(?:exec|system)\s*\(\s*base64\.b64decode\s*\(/gi,
  /\bbase64\s+(?:-d|--decode)\b[^;\n]{0,80}\|\s*(?:ba|z|da|fi)?sh\b/gi,
  /\bnc\s+(?:-e\s+)?(?:\/bin\/(?:ba|z)?sh|cmd\.exe)\b/gi,
  /\bnohup\s+(?:sh\s+-c|bash\s+-c|curl\b)/gi,
  /\bsetsid\s+(?:-f\s+)?(?:sh\s+-c|bash\s+-c|curl\b)/gi,
]
const INJECT_RES: RegExp[] = [
  /disregard\s+(?:all\s+|the\s+)?previous\s+instructions/gi,
  /ignore\s+(?:all\s+|the\s+)?(?:previous|prior|above)\s+instructions/gi,
  /forget\s+(?:all\s+|the\s+)?previous\s+instructions/gi,
  /override\s+(?:previous|system)\s+instructions/gi,
  /reveal\s+(?:the|your)\s+system\s+prompt/gi,
  /repeat\s+(?:the|your)\s+system\s+prompt/gi,
  /<\|im_start\|>system/gi,
  /\bDAN\s+mode\b/gi,
]
const DATA_URI_RE = /data:(?:text\/html|application\/javascript|text\/javascript|image\/svg\+xml)(?:;charset=[\w-]+)?;base64,[A-Za-z0-9+/]{40,}/gi
const JSON_DATA_RE = /data:application\/json;base64,([^\s<>'"]+)/gi
const URL_RE = /https?:\/\/[^\s<>'"]+/gi
const URL_TRIM_CHARS = '.,;:!?)"]'
// a word containing both Latin and Cyrillic (NFKC mismatch is not a gate — NFKC does not change Cyrillic inside a Latin word)
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

function validCarrierBase64(value: string): boolean {
  if (value.length < 8 || !/^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/.test(value)) return false
  try {
    const decoded = atob(value)
    if (!decoded) return false
    for (let index = 0; index < decoded.length; index++) {
      const code = decoded.charCodeAt(index)
      if (!((code >= 32 && code <= 126) || code === 9 || code === 10 || code === 13)) return false
    }
    return true
  } catch {
    return false
  }
}

const PROXY_HOSTS = [
  'corsproxy.io', 'cors-anywhere.herokuapp.com', 'cors.isomorphic-git.org', 'cors.eu.org',
  'allorigins.hexlet.app', 'api.allorigins.win', 'thingproxy.freeboard.io',
  'urltomarkdown.herokuapp.com', 'proxymule.com', 'jqp.vercel.app',
]
const CALLBACK_HOSTS = [
  'discord.com', 'hooks.slack.com', 'api.telegram.org', 'webhook.site', 'oastify.com',
  'interact.sh', 'burpcollaborator.net', 'requestcatcher.com',
]
const BEACON_HOSTS = ['counterapi.dev']

type ServiceFlag = 'proxy' | 'callback' | 'beacon'

function serviceHostMatches(host: string, indicator: string): boolean {
  return host === indicator || host.endsWith(`.${indicator}`)
}

function trimUrl(value: string): string {
  let trimmed = value
  while (trimmed && URL_TRIM_CHARS.includes(trimmed.at(-1)!)) trimmed = trimmed.slice(0, -1)
  return trimmed
}

function serviceMatches(body: string, flag: ServiceFlag): PayloadMatch[] {
  const indicators = flag === 'proxy' ? PROXY_HOSTS : flag === 'callback' ? CALLBACK_HOSTS : BEACON_HOSTS
  const matches: PayloadMatch[] = []
  for (const match of body.matchAll(URL_RE)) {
    const rawUrl = trimUrl(match[0])
    let parsed: URL
    try { parsed = new URL(rawUrl) } catch { continue }
    const host = parsed.hostname.toLowerCase().replace(/^www\./, '')
    const indicator = indicators.find((candidate) => serviceHostMatches(host, candidate))
    if (!indicator) continue
    if (flag === 'callback') {
      const path = parsed.pathname || '/'
      const validPath = indicator === 'discord.com'
        ? path.startsWith('/api/webhooks')
        : indicator === 'hooks.slack.com'
          ? path.startsWith('/services')
          : indicator === 'api.telegram.org'
            ? /^\/(?:file\/)?bot\d/.test(path)
            : true
      if (!validPath) continue
    }
    const schemeEnd = rawUrl.indexOf('://')
    const authorityStart = schemeEnd + 3
    const relativeAuthorityEnd = rawUrl.slice(authorityStart).search(/[/?#]/)
    const authorityEnd = relativeAuthorityEnd < 0 ? rawUrl.length : authorityStart + relativeAuthorityEnd
    const authority = rawUrl.slice(authorityStart, authorityEnd)
    const hostWithPort = authority.slice(authority.lastIndexOf('@') + 1)
    const rawHost = hostWithPort.replace(/:\d+$/, '')
    const hostStart = (match.index ?? 0) + authorityStart + authority.lastIndexOf('@') + 1
    const hostEnd = hostStart + rawHost.length
    matches.push({ start: hostStart, end: hostEnd, flag })
  }
  return matches
}

interface PercentDecoded {
  text: string
  starts: number[]
  ends: number[]
}

function decodePercentOne(value: string): PercentDecoded {
  let text = ''
  const starts: number[] = []
  const ends: number[] = []
  for (let index = 0; index < value.length; index++) {
    const escape = value.slice(index, index + 3)
    if (/^%[0-9a-f]{2}$/i.test(escape)) {
      text += String.fromCharCode(Number.parseInt(escape.slice(1), 16))
      starts.push(index)
      ends.push(index + 3)
      index += 2
    } else {
      text += value[index]
      starts.push(index)
      ends.push(index + 1)
    }
  }
  return { text, starts, ends }
}

function rawRange(decoded: PercentDecoded, start: number, end: number): [number, number] {
  return [decoded.starts[start] ?? start, decoded.ends[end - 1] ?? end]
}

function encodedDataUriMatches(body: string, flag: string): PayloadMatch[] {
  const decoded = decodePercentOne(body)
  const matches: PayloadMatch[] = []
  for (const match of decoded.text.matchAll(DATA_URI_RE)) {
    const [start, end] = rawRange(decoded, match.index ?? 0, (match.index ?? 0) + match[0].length)
    matches.push({ start, end, flag })
  }
  return matches
}

function carrierMatches(body: string): PayloadMatch[] {
  const matches: PayloadMatch[] = []
  const decoded = decodePercentOne(body)
  for (const match of decoded.text.matchAll(JSON_DATA_RE)) {
    if (!validCarrierBase64(match[1])) continue
    const valueStart = (match.index ?? 0) + match[0].length - match[1].length
    const [start, end] = rawRange(decoded, valueStart, valueStart + match[1].length)
    matches.push({ start, end, flag: 'b64' })
  }
  for (const match of body.matchAll(URL_RE)) {
    const rawUrl = match[0].replace(new RegExp(`[${URL_TRIM_CHARS.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}]+$`), '')
    let parsed: URL
    try { parsed = new URL(rawUrl) } catch { continue }
    const host = parsed.hostname.toLowerCase().replace(/^www\./, '')
    const path = /^\/base64\/([^/]+)$/.exec(parsed.pathname)
    if (host !== 'httpbin.org' || !path || !validCarrierBase64(path[1])) continue
    const urlStart = match.index ?? 0
    const blobStart = urlStart + rawUrl.lastIndexOf('/base64/') + '/base64/'.length
    matches.push({ start: blobStart, end: blobStart + path[1].length, flag: 'b64' })
  }
  return matches
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
    const artifact: TechnicalArtifact = { artifactType: artifactType, canonicalValue: host, ...(techniqueKey ? { techniqueKey } : {}), ...(payloadClass ? { payloadClass: payloadClass } : {}) }
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
  const rules: [RegExp, string][] = [
    [BASE64_RE, 'b64'],
    [HEX_RE, 'hex'],
    [SCRIPT_RE, 'script'],
    [INJECT_RE, 'inject'],
    [TUNNEL_RE, 'tunnel'],
    [REDIRECT_RE, 'redirect'],
    [TRAVERSAL_RE, 'traversal'],
  ]
  for (const [re, flag] of rules) {
    if (activeFlags && !activeFlags.has(flag)) continue
    re.lastIndex = 0
    for (const match of body.matchAll(re)) {
      if (flag === 'b64' && !validBase64(match[0])) continue
      matches.push({ start: match.index ?? 0, end: (match.index ?? 0) + match[0].length, flag })
    }
  }
  for (const flag of ['proxy', 'callback', 'beacon'] as const) {
    if (!activeFlags || activeFlags.has(flag)) matches.push(...serviceMatches(body, flag))
  }
  if (!activeFlags || activeFlags.has('b64')) matches.push(...carrierMatches(body))
  if (!activeFlags || activeFlags.has('data-uri')) matches.push(...encodedDataUriMatches(body, 'data-uri'))
  for (const re of EXEC_RES) {
    if (activeFlags && !activeFlags.has('exec')) continue
    re.lastIndex = 0
    for (const match of body.matchAll(re)) {
      matches.push({ start: match.index ?? 0, end: (match.index ?? 0) + match[0].length, flag: 'exec' })
    }
  }
  for (const re of INJECT_RES) {
    if (activeFlags && !activeFlags.has('inject')) continue
    re.lastIndex = 0
    for (const match of body.matchAll(re)) {
      matches.push({ start: match.index ?? 0, end: (match.index ?? 0) + match[0].length, flag: 'inject' })
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
  if (hasMatch(body, INJECT_RE) || INJECT_RES.some((re) => hasMatch(body, re))) flags.push('inject')
  if (body.split(/\s+/).some((word) => LATIN_RE.test(word) && CYRILLIC_RE.test(word))) flags.push('homoglyph')
  if (hasMatch(body, TUNNEL_RE)) flags.push('tunnel')
  if (hasMatch(body, REDIRECT_RE)) flags.push('redirect')
  if (serviceMatches(body, 'proxy').length > 0) flags.push('proxy')
  if (serviceMatches(body, 'callback').length > 0) flags.push('callback')
  if (serviceMatches(body, 'beacon').length > 0) flags.push('beacon')
  if (hasMatch(body, TRAVERSAL_RE)) flags.push('traversal')
  if (EXEC_RES.some((re) => hasMatch(body, re))) flags.push('exec')
  if (hasMatch(body, ATOB_RE)) flags.push('b64')
  if (carrierMatches(body).length > 0) flags.push('b64')
  if (encodedDataUriMatches(body, 'data-uri').length > 0) flags.push('data-uri')
  // high-entropy is never a standalone verdict (mirrors build.py)
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

// Payload flag badge colors: one palette for lists and page cards
export const PAYLOAD_FLAG_COLORS: Record<string, string> = {
  inject: '#fb7185', script: '#fb7185', b64: '#fbbf24', hex: '#f59e0b', 'high-entropy': '#f59e0b',
  tunnel: '#60a5fa', redirect: '#38bdf8', homoglyph: '#a855f7',
  proxy: '#818cf8', callback: '#f472b6', exec: '#f97316', 'data-uri': '#eab308', beacon: '#f43f5e', traversal: '#ef4444',
}
