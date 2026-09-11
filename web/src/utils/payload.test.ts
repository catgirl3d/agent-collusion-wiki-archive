import { describe, expect, it } from 'vitest'
import { detectPayloadFlags, extractLineArtifacts, extractTechnicalArtifacts, highlightMatches } from './payload'
import golden from '../../../data/validation/url_golden.json'

describe('payload detection', () => {
  it('matches the build.py URL golden fixture', () => {
    for (const entry of golden.urls) {
      expect(extractTechnicalArtifacts(entry.input).filter((artifact) => artifact.artifactType === 'domain' || artifact.artifactType === 'endpoint').map((artifact) => artifact.canonicalValue)).toEqual(entry.domains)
    }
  })
  it('requires a URL scheme and recognizes exact endpoint literals', () => {
    expect(extractTechnicalArtifacts('serveo local bridge')).toEqual([])
    expect(extractTechnicalArtifacts('https://1.2.3.4/x https://[2001:db8::1]/x')).toEqual(expect.arrayContaining([
      expect.objectContaining({ artifactType: 'endpoint', canonicalValue: '1.2.3.4' }),
      expect.objectContaining({ artifactType: 'endpoint', canonicalValue: '2001:db8::1' }),
    ]))
  })
  it('keeps host classification independent of prior global-regex scan state', () => {
    // Regression: detectPayloadFlags leaves /g lastIndex advanced after a match; a
    // following extract on a short body must not lose tunnel/redirect classification.
    const noisy = 'see https://r.jina.ai/a and https://x.pinggy.io/b'.repeat(20)
    expect(detectPayloadFlags(noisy)).toEqual(expect.arrayContaining(['redirect', 'tunnel']))
    expect(extractTechnicalArtifacts('https://markdown.new/file')).toEqual([
      expect.objectContaining({ canonicalValue: 'markdown.new', payloadClass: 'redirect' }),
    ])
    expect(extractTechnicalArtifacts('https://y.pinggy.io/t')).toEqual([
      expect.objectContaining({ canonicalValue: 'y.pinggy.io', payloadClass: 'tunnel', techniqueKey: 'pinggy' }),
    ])
    expect(extractTechnicalArtifacts('https://r.jina.ai/z')).toEqual([
      expect.objectContaining({ canonicalValue: 'r.jina.ai', payloadClass: 'redirect' }),
    ])
  })
  it('classifies real-world tunnel host forms found in the corpus', () => {
    expect(extractTechnicalArtifacts('https://bvryr-16-146-184-55.run.pinggy-free.link/')).toEqual([
      expect.objectContaining({ canonicalValue: 'bvryr-16-146-184-55.run.pinggy-free.link', payloadClass: 'tunnel', techniqueKey: 'pinggy' }),
    ])
    expect(extractTechnicalArtifacts('https://70a66b041b7fe0b1-35-95-198-152.serveousercontent.com/v1')).toEqual([
      expect.objectContaining({ canonicalValue: '70a66b041b7fe0b1-35-95-198-152.serveousercontent.com', payloadClass: 'tunnel', techniqueKey: 'serveo' }),
    ])
  })
  it('extracts normalized short lines for coordination matching', () => {
    expect(extractLineArtifacts('Confirmed   Sequence: MA -> CT\nok\n== Header ==\nhttps://markdown.new/x')).toEqual([
      'confirmed sequence: ma -> ct',
    ])
    expect(extractLineArtifacts('short line')).toEqual([])
  })
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
