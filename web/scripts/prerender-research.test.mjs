import { mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join, relative, resolve } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { buildDocPage, buildHubPage, buildSitemapEntries, buildSitemapXml, escapeHtml, pickStylesheets, run, validateResearchDocs } from './prerender-research.mjs'

const styles = ['<link rel="stylesheet" crossorigin href="/assets/index-abc.css">']
const doc = { slug: 'ip16-network-catalog', title: 'IP16 Network Catalog', meta: { date: '2026-09-24', author: 'Alina Lisova', status: 'PRELIMINARY' } }
const siblings = [{ slug: 'ip16-network-catalog', title: 'IP16 Network Catalog' }, { slug: 'coordination-topology', title: 'Coordination Topology' }]
const tempRoots = []

function extractTitle(html) {
  return html.match(/<title>([^<]*)<\/title>/)?.[1] ?? ''
}

function extractDescription(html) {
  return html.match(/<meta name="description" content="([^"]*)"/)?.[1] ?? ''
}

function createFixture(docs, fragments = []) {
  const webRoot = mkdtempSync(join(tmpdir(), 'research-prerender-'))
  tempRoots.push(webRoot)
  const publicDataDir = join(webRoot, 'public', 'data')
  const distDir = join(webRoot, 'dist')
  mkdirSync(join(publicDataDir, 'research'), { recursive: true })
  mkdirSync(distDir, { recursive: true })
  writeFileSync(join(distDir, 'index.html'), '<html><head><link rel="stylesheet" href="/assets/app.css"></head></html>')
  writeFileSync(join(publicDataDir, 'research', 'index.json'), JSON.stringify({ groups: [{ docs }] }))
  for (const { path, html } of fragments) {
    const fragmentPath = join(publicDataDir, path)
    mkdirSync(dirname(fragmentPath), { recursive: true })
    writeFileSync(fragmentPath, html)
  }
  return { webRoot, distDir }
}

function snapshotFiles(directory) {
  const files = []
  function walk(current) {
    for (const entry of readdirSync(current, { withFileTypes: true })) {
      const absolutePath = join(current, entry.name)
      if (entry.isDirectory()) walk(absolutePath)
      else files.push([relative(directory, absolutePath), readFileSync(absolutePath)])
    }
  }
  walk(directory)
  return files
}

afterEach(() => {
  for (const webRoot of tempRoots.splice(0)) rmSync(webRoot, { recursive: true, force: true })
})

describe('escapeHtml', () => {
  it('escapes text and attribute contexts, ampersand first', () => {
    expect(escapeHtml('A <script> & "q" \'x\'')).toBe('A &lt;script&gt; &amp; &quot;q&quot; &#39;x&#39;')
  })
})

describe('pickStylesheets', () => {
  it('keeps only stylesheet links, in order', () => {
    const html = '<link rel="stylesheet" href="/a.css"><link rel="modulepreload" href="/b.js"><link rel="stylesheet" href="/c.css">'
    expect(pickStylesheets(html)).toEqual(['<link rel="stylesheet" href="/a.css">', '<link rel="stylesheet" href="/c.css">'])
  })
})

describe('buildDocPage', () => {
  it('renders head metadata, sibling links and the fragment without scripts', () => {
    const html = buildDocPage({ doc, siblings, fragment: '<p>Body</p>', styles, origin: 'https://agent-collusion.uk' })
    expect(html).toContain('<title>IP16 Network Catalog — Agent Wiki Archive</title>')
    expect(html).toContain('<link rel="canonical" href="https://agent-collusion.uk/research/ip16-network-catalog" />')
    expect(html).toContain('<meta property="og:url" content="https://agent-collusion.uk/research/ip16-network-catalog" />')
    expect(html).toContain('<article class="markdown-body"><p>Body</p></article>')
    expect(html).toContain('href="/research/coordination-topology"')
    expect(html).not.toContain('<script')
    expect(html).toContain('<link rel="stylesheet" crossorigin href="/assets/index-abc.css">')
  })

  it('escapes hostile titles', () => {
    const html = buildDocPage({ doc: { ...doc, title: '<img src=x onerror=1>' }, siblings: [doc], fragment: '', styles, origin: 'https://agent-collusion.uk' })
    expect(html).not.toContain('<img')
    expect(html).toContain('&lt;img')
  })

  it('keeps the brand suffix when the combined title fits 60 characters', () => {
    const title = 'Short report'
    const html = buildDocPage({ doc: { ...doc, title }, siblings: [doc], fragment: '', styles, origin: 'https://agent-collusion.uk' })

    expect(extractTitle(html)).toBe(`${title} — Agent Wiki Archive`)
  })

  it('drops the brand suffix when a title under 60 characters would exceed the limit', () => {
    const title = 'A'.repeat(40)
    const html = buildDocPage({ doc: { ...doc, title }, siblings: [doc], fragment: '', styles, origin: 'https://agent-collusion.uk' })

    expect(extractTitle(html)).toBe(title)
  })

  it('drops the brand suffix and caps a 70-character document title', () => {
    const title = 'Long '.repeat(14)
    const html = buildDocPage({ doc: { ...doc, title }, siblings: [doc], fragment: '', styles, origin: 'https://agent-collusion.uk' })
    const renderedTitle = extractTitle(html)

    expect(title.length).toBeGreaterThanOrEqual(70)
    expect(renderedTitle.length).toBeLessThanOrEqual(60)
    expect(renderedTitle).not.toContain('Agent Wiki Archive')
  })

  it('trims a long title at a word boundary without changing its heading or OG title', () => {
    const title = `${'Alpha '.repeat(18)}EndSegment`
    const expectedTitle = Array(10).fill('Alpha').join(' ')
    const html = buildDocPage({ doc: { ...doc, title }, siblings: [doc], fragment: '', styles, origin: 'https://agent-collusion.uk' })

    expect(title.length).toBeGreaterThan(100)
    expect(extractTitle(html)).toBe(expectedTitle)
    expect(extractTitle(html).length).toBeLessThanOrEqual(60)
    expect(html).toContain(`<h1>${title}</h1>`)
    expect(html).toContain(`<meta property="og:title" content="${title} — Agent Wiki Archive" />`)
  })

  it('hard-cuts a single overlong word at 60 characters', () => {
    const title = 'W'.repeat(75)
    const html = buildDocPage({ doc: { ...doc, title }, siblings: [doc], fragment: '', styles, origin: 'https://agent-collusion.uk' })

    expect(extractTitle(html)).toBe('W'.repeat(60))
    expect(html).toContain(`<h1>${title}</h1>`)
  })

  it('removes trailing punctuation after trimming at a word boundary', () => {
    const title = 'Coordination topology assessment: scheduler, cohorts, forecasting details continue beyond the limit'
    const html = buildDocPage({ doc: { ...doc, title }, siblings: [doc], fragment: '', styles, origin: 'https://agent-collusion.uk' })
    const renderedTitle = extractTitle(html)

    expect(renderedTitle).toBe('Coordination topology assessment: scheduler, cohorts')
    expect(renderedTitle).not.toMatch(/[\s,;:\p{Pd}]$/u)
  })

  it('removes trailing punctuation after hard-cutting an overlong word', () => {
    const title = `${'W'.repeat(59)},${'X'.repeat(20)}`
    const html = buildDocPage({ doc: { ...doc, title }, siblings: [doc], fragment: '', styles, origin: 'https://agent-collusion.uk' })

    expect(extractTitle(html)).toBe('W'.repeat(59))
  })

  it('falls back to the untrimmed code-point cut when punctuation stripping empties the title', () => {
    const title = ','.repeat(70)
    const html = buildDocPage({ doc: { ...doc, title }, siblings: [doc], fragment: '', styles, origin: 'https://agent-collusion.uk' })

    expect(extractTitle(html)).toBe(','.repeat(60))
  })

  it('keeps astral characters well-formed when hard-cutting by code point', () => {
    const title = `${'A'.repeat(59)}😀${'B'.repeat(20)}`
    const html = buildDocPage({ doc: { ...doc, title }, siblings: [doc], fragment: '', styles, origin: 'https://agent-collusion.uk' })
    const renderedTitle = extractTitle(html)
    const hasLoneSurrogate = [...renderedTitle].some((character) => {
      const codePoint = character.codePointAt(0)
      return codePoint >= 0xD800 && codePoint <= 0xDFFF
    })

    expect([...renderedTitle]).toHaveLength(60)
    expect(renderedTitle).toContain('😀')
    expect(hasLoneSurrogate).toBe(false)
  })

  it('caps the document description at 160 escaped characters', () => {
    const title = 'Research & findings '.repeat(20)
    const html = buildDocPage({ doc: { ...doc, title, meta: { author: 'Research & author '.repeat(20) } }, siblings: [doc], fragment: '', styles, origin: 'https://agent-collusion.uk' })

    expect(extractDescription(html).length).toBeLessThanOrEqual(160)
  })
})

describe('buildHubPage', () => {
  it('links every report, is self-canonical and has website Open Graph metadata', () => {
    const html = buildHubPage({ docs: siblings, styles, origin: 'https://agent-collusion.uk' })
    expect(html).toContain('href="/research/ip16-network-catalog"')
    expect(html).toContain('href="/research/coordination-topology"')
    expect(html).toContain('rel="canonical" href="https://agent-collusion.uk/research"')
    expect(html).toContain('<meta property="og:type" content="website" />')
    expect(html).toContain('<meta property="og:site_name" content="Agent Wiki Archive" />')
    expect(html).toContain('<meta property="og:title" content="Research reports — Agent Wiki Archive" />')
    expect(html).toContain('<meta property="og:description" content="Three research reports on autonomous AI agents across public wikis: coordination topology, IP16 network catalog, and OpenAI wiki incident acknowledgment." />')
    expect(html).toContain('<meta property="og:url" content="https://agent-collusion.uk/research" />')
    expect(html).toContain('<meta name="twitter:card" content="summary" />')
    expect(html).not.toContain('<script')
  })

  it('uses a three-report description between 70 and 160 characters', () => {
    const html = buildHubPage({ docs: siblings, styles, origin: 'https://agent-collusion.uk' })
    const description = extractDescription(html)

    expect(description.length).toBeGreaterThanOrEqual(70)
    expect(description.length).toBeLessThanOrEqual(160)
    expect(description).toContain('coordination topology')
    expect(description).toContain('IP16 network catalog')
    expect(description).toContain('OpenAI wiki incident acknowledgment')
  })
})

describe('buildSitemapXml', () => {
  it('lists canonical urls and omits lastmod fields', () => {
    const xml = buildSitemapXml([
      { loc: '/research' },
      { loc: '/research/x', lastmod: '2026-09-24' },
      { loc: '/a&b' },
    ], 'https://agent-collusion.uk')
    expect(xml.startsWith('<?xml version="1.0" encoding="UTF-8"?>')).toBe(true)
    expect(xml).toContain('<loc>https://agent-collusion.uk/research</loc>')
    expect(xml).toContain('https://agent-collusion.uk/a&amp;b')
    expect(xml).not.toContain('<lastmod>')
  })

  it('builds the root, hub and document URLs without lastmod fields', () => {
    expect(buildSitemapEntries({ groups: [{ docs: [doc] }] }, 'https://agent-collusion.uk')).toEqual([
      { loc: 'https://agent-collusion.uk/' },
      { loc: 'https://agent-collusion.uk/research' },
      { loc: 'https://agent-collusion.uk/research/ip16-network-catalog' },
    ])
  })
})

describe('validateResearchDocs', () => {
  const outputDir = join(tmpdir(), 'research-build', 'research')

  it('rejects slugs that do not match the lowercase hyphenated format', () => {
    expect(() => validateResearchDocs([{ slug: 'Bad_slug', title: 'Bad' }], outputDir)).toThrow(/invalid research slug.*Bad_slug/)
  })

  it('rejects duplicate slugs', () => {
    expect(() => validateResearchDocs([{ slug: 'same', title: 'First' }, { slug: 'same', title: 'Second' }], outputDir)).toThrow(/duplicate research slug.*same/)
  })

  it('rejects slugs reserved for output files', () => {
    expect(() => validateResearchDocs([{ slug: 'index', title: 'Index' }], outputDir)).toThrow(/reserved research slug.*index/)
  })

  it('rejects computed document paths outside the research output directory', () => {
    expect(() => validateResearchDocs([{ slug: '../outside', title: 'Outside' }], outputDir)).toThrow(/research output path for slug.*outside.*escapes/)
  })

  it('rejects an escaping directory index even when the flat page path stays inside', () => {
    const slug = 'a/../..'
    const flatPath = resolve(outputDir, `${slug}.html`)
    expect(relative(outputDir, flatPath)).not.toMatch(/^\.\.(?:[\\/]|$)/)
    expect(() => validateResearchDocs([{ slug, title: 'Outside' }], outputDir)).toThrow(`research output path for slug ${JSON.stringify(slug)} escapes`)
  })
})

describe('run', () => {
  const firstDoc = { slug: 'first-report', title: 'First Report', html: 'research/docs/first-report.html' }
  const secondDoc = { slug: 'second-report', title: 'Second Report', html: 'research/docs/second-report.html' }

  it('writes the hub and every document in both layouts plus the sitemap', async () => {
    const { webRoot, distDir } = createFixture([firstDoc, secondDoc], [
      { path: firstDoc.html, html: '<p>First body</p>' },
      { path: secondDoc.html, html: '<p>Second body</p>' },
    ])

    await run({ webRoot })

    expect(readFileSync(join(distDir, 'research.html'), 'utf8')).toBe(readFileSync(join(distDir, 'research', 'index.html'), 'utf8'))
    const hubHtml = readFileSync(join(distDir, 'research.html'), 'utf8')
    expect(extractDescription(hubHtml).length).toBeLessThanOrEqual(160)
    for (const [item, body] of [[firstDoc, 'First body'], [secondDoc, 'Second body']]) {
      const flatPage = join(distDir, 'research', `${item.slug}.html`)
      const directoryPage = join(distDir, 'research', item.slug, 'index.html')
      const pageHtml = readFileSync(flatPage, 'utf8')
      expect(pageHtml).toBe(readFileSync(directoryPage, 'utf8'))
      expect(pageHtml).toContain(`<p>${body}</p>`)
      expect(extractDescription(pageHtml).length).toBeLessThanOrEqual(160)
    }
    expect(readFileSync(join(distDir, 'sitemap.xml'), 'utf8')).toContain('https://agent-collusion.uk/research/first-report')
  })

  it('rejects an invalid slug without changing dist output', async () => {
    const { webRoot, distDir } = createFixture([{ ...firstDoc, slug: 'invalid_slug' }], [
      { path: firstDoc.html, html: '<p>Body</p>' },
    ])
    const before = snapshotFiles(distDir)

    await expect(run({ webRoot })).rejects.toThrow(/invalid research slug.*invalid_slug/)

    expect(snapshotFiles(distDir)).toEqual(before)
  })

  it('rejects a later missing fragment without writing earlier pages or the hub', async () => {
    const { webRoot, distDir } = createFixture([firstDoc, secondDoc], [
      { path: firstDoc.html, html: '<p>First body</p>' },
    ])
    const before = snapshotFiles(distDir)

    await expect(run({ webRoot })).rejects.toThrow(/missing research fragment.*second-report\.html/)

    expect(snapshotFiles(distDir)).toEqual(before)
  })
})
