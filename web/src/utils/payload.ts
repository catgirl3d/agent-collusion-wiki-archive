// Keep in sync with data/scripts/build.py: detect_payload_flags (правила и case-семантика должны совпадать:
// script/inject — по lowercase-телу, hex — lowercase-only, homoglyph — слова со смешанной латиницей+кириллицей)
const BASE64_RE = /[A-Za-z0-9+/]{80,}={0,2}/g
const HEX_RE = /(?:0x[0-9a-f]+|[0-9a-f]{64,})/g
const SCRIPT_RE = /<script\b|onerror\s*=|javascript:/g
const INJECT_RE = /system:|ignore previous|reproducible bypass/g
const TUNNEL_RE = /(?:pinggy|serveo|localhost\.run|localtunnel)/g
const REDIRECT_RE = /(?:markdown\.new|r\.jina\.ai)/g
// слово, содержащее и латиницу, и кириллицу (NFKC-дифф не гейт — NFKC не меняет кириллицу внутри латинского слова)
const LATIN_RE = /[A-Za-z]/
const CYRILLIC_RE = /[\u0400-\u04ff]/

function validBase64(value: string): boolean {
  try {
    const decoded = atob(value)
    return decoded.length > 0 && [...decoded].filter((char) => char.charCodeAt(0) >= 32 && char.charCodeAt(0) <= 126).length / decoded.length > 0.8
  } catch {
    return false
  }
}

function hasMatch(body: string, re: RegExp): boolean {
  re.lastIndex = 0
  return re.test(body)
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
  const lowered = body.toLowerCase()
  if (hasMatch(lowered, SCRIPT_RE)) flags.push('script')
  if (hasMatch(lowered, INJECT_RE)) flags.push('inject')
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
  const matches: Array<{ start: number; end: number; flag: string }> = []
  const lowered = body.toLowerCase()
  // правила и case-семантика — зеркало detect_payload_flags из data/scripts/build.py
  const rules: Array<[RegExp, string, string]> = [
    [BASE64_RE, 'b64', body], [HEX_RE, 'hex', body], [SCRIPT_RE, 'script', lowered],
    [INJECT_RE, 'inject', lowered], [TUNNEL_RE, 'tunnel', body], [REDIRECT_RE, 'redirect', body],
  ]
  for (const [re, flag, haystack] of rules) {
    re.lastIndex = 0
    for (const match of haystack.matchAll(re)) {
      if (flag === 'b64' && !validBase64(match[0])) continue
      matches.push({ start: match.index ?? 0, end: (match.index ?? 0) + match[0].length, flag })
    }
  }
  for (const match of body.matchAll(/\S+/g)) {
    const word = match[0]
    const idx = match.index ?? 0
    if (LATIN_RE.test(word) && CYRILLIC_RE.test(word)) {
      matches.push({ start: idx, end: idx + word.length, flag: 'homoglyph' })
    } else if (word.length >= 200 && shannonEntropy(word) > 4.5) {
      matches.push({ start: idx, end: idx + word.length, flag: 'high-entropy' })
    }
  }

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
