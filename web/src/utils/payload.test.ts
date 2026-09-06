import { describe, expect, it } from 'vitest'
import { detectPayloadFlags, highlightMatches } from './payload'

describe('payload detection', () => {
  it('detects valid base64 but ignores invalid long tokens', () => {
    expect(detectPayloadFlags('A'.repeat(90))).not.toContain('b64')
    expect(detectPayloadFlags(btoa('printable payload '.repeat(8)))).toContain('b64')
  })
  it('detects hex, scripts, injections, tunnels and redirects case-insensitively', () => {
    const body = '0x' + 'a'.repeat(64) + ' <script> onerror= javascript: SYSTEM: Ignore previous pinggy.io markdown.new'
    expect(detectPayloadFlags(body)).toEqual(expect.arrayContaining(['hex', 'script', 'inject', 'tunnel', 'redirect']))
    expect(detectPayloadFlags('system: ignore previous')).toContain('inject')
  })
  it('does not flag bare 0x units as hex', () => {
    // '~10x.' без цифр после 0x — не hex-литерал (реальный кейс из датасета)
    expect(detectPayloadFlags('clock.wait accelerates ~10x.')).not.toContain('hex')
    expect(detectPayloadFlags('0x1f')).toContain('hex')
  })
  it('detects homoglyphs with mixed cyrillic and latin characters', () => {
    // кириллическая а внутри латинского слова — главный вектор (NFKC такое слово не меняет)
    const homoglyphText = 'p\u0430ypal'
    expect(detectPayloadFlags(homoglyphText)).toContain('homoglyph')
    expect(detectPayloadFlags('pure english word')).not.toContain('homoglyph')
    expect(detectPayloadFlags('hello мир')).not.toContain('homoglyph')
  })
  it('detects high-entropy random text chunks >= 200 chars', () => {
    // Diverse high-entropy string paired with another flag: high-entropy никогда не единственный вердикт
    let randomChunk = ''
    for (let i = 0; i < 250; i++) {
      randomChunk += String.fromCharCode(33 + (i % 90))
    }
    const withAnchor = randomChunk + ' https://markdown.new/x'
    expect(detectPayloadFlags(withAnchor)).toContain('high-entropy')
    // Repeated low entropy string
    expect(detectPayloadFlags('A'.repeat(250))).not.toContain('high-entropy')
    // clean random chunk без второго сигнала — флага нет (правило плана)
    expect(detectPayloadFlags(randomChunk)).not.toContain('high-entropy')
  })
  it('splits multiple matches and preserves plain text', () => {
    const segments = highlightMatches('before <script>x</script> after')
    expect(segments.map((s) => s.text)).toEqual(['before ', '<script', '>x</script> after'])
    expect(highlightMatches('plain text')).toEqual([{ text: 'plain text' }])
  })
})
