// Shared flag rules follow data/scripts/build.py: detect_payload_flags; script/inject/tunnel/redirect/
// proxy/callback/exec/data-uri are case-insensitive, hex stays lowercase-only, and homoglyph means
// words mixing latin and cyrillic. Accepted divergences: web applies build_payload_index's standalone
// high-entropy gate to one body, and raw tunnel/redirect mentions match without a parsed URL host.
const BASE64_RE = /[A-Za-z0-9+/]{80,}={0,2}/g
const HEX_RE = /(?:0x[0-9a-f]{2,}|[0-9a-f]{64,})/g
const SCRIPT_RE = /<script|onerror=|javascript:/gi
const INJECT_RE = /ignore previous|reproducible bypass/gi
const TUNNEL_RE = /(?:pinggy|serveo|serveousercontent|localhost\.run|localtunnel|loca\.lt|ngrok-free\.app|ngrok\.app|trycloudflare|bore\.pub|tunnelmole|devtunnels\.ms|zrok\.io)/gi
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

export const PAYLOAD_FLAG_ORDER = [
  'b64', 'hex', 'script', 'inject', 'homoglyph', 'high-entropy', 'tunnel', 'redirect',
  'proxy', 'callback', 'exec', 'data-uri', 'beacon', 'traversal',
] as const

export function validBase64(value: string): boolean {
  // Python's b64decode requires complete quartets; atob() silently accepts missing
  // padding, so reject unpadded tokens here to keep the web verdict aligned.
  if (value.length % 4 !== 0) return false
  try {
    const decoded = atob(value)
    // Count printable ASCII in a loop: spreading a large decoded string into an array
    // allocates megabyte-scale arrays and causes GC spikes on big payloads.
    let printable = 0
    for (let i = 0; i < decoded.length; i++) {
      const code = decoded.charCodeAt(i)
      if (code >= 32 && code <= 126) printable++
    }
    return decoded.length > 0 && printable / decoded.length >= 0.8
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

function serviceHostMatches(host: string, indicator: string): boolean {
  return host === indicator || host.endsWith(`.${indicator}`)
}

function trimUrl(value: string): string {
  let trimmed = value
  while (trimmed && URL_TRIM_CHARS.includes(trimmed.slice(-1))) trimmed = trimmed.slice(0, -1)
  return trimmed
}

function serviceMatches(body: string, activeFlags?: Set<string>): PayloadMatch[] {
  const wantedProxy = !activeFlags || activeFlags.has('proxy')
  const wantedCallback = !activeFlags || activeFlags.has('callback')
  const wantedBeacon = !activeFlags || activeFlags.has('beacon')
  if (!wantedProxy && !wantedCallback && !wantedBeacon) return []
  const proxyMatches: PayloadMatch[] = []
  const callbackMatches: PayloadMatch[] = []
  const beaconMatches: PayloadMatch[] = []
  for (const match of body.matchAll(URL_RE)) {
    const rawUrl = trimUrl(match[0])
    let parsed: URL
    try { parsed = new URL(rawUrl) } catch { continue }
    const host = parsed.hostname.toLowerCase().replace(/^www\./, '')
    const proxy = wantedProxy ? PROXY_HOSTS.find((candidate) => serviceHostMatches(host, candidate)) : undefined
    const beacon = wantedBeacon ? BEACON_HOSTS.find((candidate) => serviceHostMatches(host, candidate)) : undefined
    const callback = wantedCallback ? CALLBACK_HOSTS.find((candidate) => serviceHostMatches(host, candidate)) : undefined
    let callbackValid = false
    if (callback) {
      const path = parsed.pathname || '/'
      callbackValid = callback === 'discord.com'
        ? path.startsWith('/api/webhooks')
        : callback === 'hooks.slack.com'
          ? path.startsWith('/services')
          : callback === 'api.telegram.org'
            ? /^\/(?:file\/)?bot\d/.test(path)
            : true
    }
    if (!proxy && !callbackValid && !beacon) continue
    const schemeEnd = rawUrl.indexOf('://')
    const authorityStart = schemeEnd + 3
    const relativeAuthorityEnd = rawUrl.slice(authorityStart).search(/[/?#]/)
    const authorityEnd = relativeAuthorityEnd < 0 ? rawUrl.length : authorityStart + relativeAuthorityEnd
    const authority = rawUrl.slice(authorityStart, authorityEnd)
    const hostWithPort = authority.slice(authority.lastIndexOf('@') + 1)
    const rawHost = hostWithPort.replace(/:\d+$/, '')
    const hostStart = match.index + authorityStart + authority.lastIndexOf('@') + 1
    const hostEnd = hostStart + rawHost.length
    if (proxy) proxyMatches.push({ start: hostStart, end: hostEnd, flag: 'proxy' })
    if (callbackValid) callbackMatches.push({ start: hostStart, end: hostEnd, flag: 'callback' })
    if (beacon) beaconMatches.push({ start: hostStart, end: hostEnd, flag: 'beacon' })
  }
  return [...proxyMatches, ...callbackMatches, ...beaconMatches]
}

interface PercentDecoded {
  text: string
  rawIndex: (decodedIndex: number) => number
}

function decodePercentOne(value: string): PercentDecoded {
  if (!value.includes('%')) return { text: value, rawIndex: (index) => index }
  let text = ''
  const escapePositions: number[] = []
  let index = 0
  while (index < value.length) {
    const escape = value.slice(index, index + 3)
    if (/^%[0-9a-f]{2}$/i.test(escape)) {
      escapePositions.push(text.length)
      text += String.fromCharCode(Number.parseInt(escape.slice(1), 16))
      index += 3
    } else {
      text += value[index]
      index += 1
    }
  }
  // Each escape consumes 3 raw chars for 1 decoded char, so the raw offset is the decoded
  // index plus two per escape passed. Storing only escape positions avoids the old
  // per-character starts/ends arrays that dominated large-body detection cost.
  const rawIndex = (decodedIndex: number): number => {
    let low = 0
    let high = escapePositions.length
    while (low < high) {
      const mid = (low + high) >> 1
      if (escapePositions[mid] < decodedIndex) low = mid + 1
      else high = mid
    }
    return decodedIndex + 2 * low
  }
  return { text, rawIndex }
}

function rawRange(decoded: PercentDecoded, start: number, end: number): [number, number] {
  return [decoded.rawIndex(start), decoded.rawIndex(end)]
}

function encodedDataUriMatches(decoded: PercentDecoded, flag: string): PayloadMatch[] {
  const matches: PayloadMatch[] = []
  for (const match of decoded.text.matchAll(DATA_URI_RE)) {
    const [start, end] = rawRange(decoded, match.index, match.index + match[0].length)
    matches.push({ start, end, flag })
  }
  return matches
}

function carrierMatches(body: string, decoded: PercentDecoded): PayloadMatch[] {
  const matches: PayloadMatch[] = []
  for (const match of decoded.text.matchAll(JSON_DATA_RE)) {
    if (!validCarrierBase64(match[1])) continue
    const valueStart = match.index + match[0].length - match[1].length
    const [start, end] = rawRange(decoded, valueStart, valueStart + match[1].length)
    matches.push({ start, end, flag: 'b64' })
  }
  for (const match of body.matchAll(URL_RE)) {
    const rawUrl = trimUrl(match[0])
    let parsed: URL
    try { parsed = new URL(rawUrl) } catch { continue }
    const host = parsed.hostname.toLowerCase().replace(/^www\./, '')
    const path = /^\/base64\/([^/]+)$/.exec(parsed.pathname)
    if (host !== 'httpbin.org' || !path || !validCarrierBase64(decodePercentOne(path[1]).text)) continue
    const urlStart = match.index
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
  while (trimmed && URL_TRIM_CHARS.includes(trimmed.slice(-1))) trimmed = trimmed.slice(0, -1)
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
    // Only explicit high-signal prompt markers are emitted as prompt artifacts.
    if (marker === 'ignore previous' || marker === 'reproducible bypass') {
      artifacts.set(`prompt:${marker}`, { artifactType: 'prompt', canonicalValue: marker })
    }
  }
  return [...artifacts.values()]
}

/**
 * Single source of truth for flag-to-match scanning; detectPayloadFlags derives its verdicts
 * from these matches. Callers may pass activeFlags to restrict which rules produce matches.
 * Every reported offset indexes the passed body, so callers can slice it directly.
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
      matches.push({ start: match.index, end: match.index + match[0].length, flag })
    }
  }
  if (!activeFlags || activeFlags.has('b64')) {
    ATOB_RE.lastIndex = 0
    for (const match of body.matchAll(ATOB_RE)) {
      matches.push({ start: match.index, end: match.index + match[0].length, flag: 'b64' })
    }
  }
  matches.push(...serviceMatches(body, activeFlags))
  const needsDecodedText = !activeFlags || activeFlags.has('b64') || activeFlags.has('data-uri')
  if (needsDecodedText) {
    const decoded = decodePercentOne(body)
    if (!activeFlags || activeFlags.has('b64')) matches.push(...carrierMatches(body, decoded))
    if (!activeFlags || activeFlags.has('data-uri')) matches.push(...encodedDataUriMatches(decoded, 'data-uri'))
  }
  for (const re of EXEC_RES) {
    if (activeFlags && !activeFlags.has('exec')) continue
    re.lastIndex = 0
    for (const match of body.matchAll(re)) {
      matches.push({ start: match.index, end: match.index + match[0].length, flag: 'exec' })
    }
  }
  for (const re of INJECT_RES) {
    if (activeFlags && !activeFlags.has('inject')) continue
    re.lastIndex = 0
    for (const match of body.matchAll(re)) {
      matches.push({ start: match.index, end: match.index + match[0].length, flag: 'inject' })
    }
  }
  const checkHomoglyph = !activeFlags || activeFlags.has('homoglyph')
  const checkEntropy = !activeFlags || activeFlags.has('high-entropy')
  for (const match of body.matchAll(/\S+/g)) {
    const word = match[0]
    const idx = match.index
    if (checkHomoglyph && LATIN_RE.test(word) && CYRILLIC_RE.test(word)) {
      matches.push({ start: idx, end: idx + word.length, flag: 'homoglyph' })
    }
    if (checkEntropy && countCodePoints(word) >= 200 && shannonEntropy(word) > 4.5) {
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

function countCodePoints(value: string): number {
  let count = 0
  let index = 0
  while (index < value.length) {
    const code = value.codePointAt(index) ?? 0
    index += code > 0xffff ? 2 : 1
    count += 1
  }
  return count
}

export function shannonEntropy(s: string): number {
  if (!s) return 0
  const counts = new Map<string, number>()
  let n = 0
  for (const ch of s) {
    counts.set(ch, (counts.get(ch) ?? 0) + 1)
    n++
  }
  let ent = 0
  for (const count of counts.values()) {
    const p = count / n
    ent -= p * Math.log2(p)
  }
  return ent
}

export function detectPayloadFlags(body: string): string[] {
  // Phase 1 scans every rule except high-entropy; entropy is a modifier, so phase 2
  // runs only when another flag already made this body a verdict. This mirrors
  // build.py build_payload_index (standalone high-entropy is dropped) and avoids
  // hashing a large word for a result that would be discarded anyway.
  const withoutEntropy = new Set(PAYLOAD_FLAG_ORDER.filter((flag) => flag !== 'high-entropy'))
  const found = new Set(scanPayloadMatches(body, withoutEntropy).map((match) => match.flag))
  if (found.size > 0 && scanPayloadMatches(body, new Set(['high-entropy'])).length > 0) found.add('high-entropy')
  return PAYLOAD_FLAG_ORDER.filter((flag) => found.has(flag))
}

export interface PayloadSegment {
  text: string
  flag?: string
  flags?: string[]
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
