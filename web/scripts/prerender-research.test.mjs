import { mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join, relative, resolve } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { buildDocPage, buildHubPage, buildSitemapEntries, buildSitemapXml, escapeHtml, pickStylesheets, run, validateResearchDocs } from './prerender-research.mjs'

const styles = ['<link rel="stylesheet" crossorigin href="/assets/index-abc.css">']
const doc = { slug: 'ip16-network-catalog', title: 'IP16 Network Catalog', meta: { date: '2026-09-24', author: 'Alina Lisova', status: 'PRELIMINARY' } }
const siblings = [{ slug: 'ip16-network-catalog', title: 'IP16 Network Catalog' }, { slug: 'coordination-topology', title: 'Coordination Topology' }]
const tempRoots = []

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
    expect(html).toContain('<meta property="og:description" content="Research reports on autonomous AI agent activity across public wikis." />')
    expect(html).toContain('<meta property="og:url" content="https://agent-collusion.uk/research" />')
    expect(html).toContain('<meta name="twitter:card" content="summary" />')
    expect(html).not.toContain('<script')
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
    for (const [item, body] of [[firstDoc, 'First body'], [secondDoc, 'Second body']]) {
      const flatPage = join(distDir, 'research', `${item.slug}.html`)
      const directoryPage = join(distDir, 'research', item.slug, 'index.html')
      expect(readFileSync(flatPage, 'utf8')).toBe(readFileSync(directoryPage, 'utf8'))
      expect(readFileSync(flatPage, 'utf8')).toContain(`<p>${body}</p>`)
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
