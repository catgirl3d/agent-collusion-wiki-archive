import { describe, expect, it } from 'vitest'
import { buildDocPage, buildHubPage, buildSitemapXml, escapeHtml, pickStylesheets } from './prerender-research.mjs'

const styles = ['<link rel="stylesheet" crossorigin href="/assets/index-abc.css">']
const doc = { slug: 'ip16-network-catalog', title: 'IP16 Network Catalog', meta: { date: '2026-09-24', author: 'Alina Lisova', status: 'PRELIMINARY' } }
const siblings = [{ slug: 'ip16-network-catalog', title: 'IP16 Network Catalog' }, { slug: 'coordination-topology', title: 'Coordination Topology' }]

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
  it('links every report and is self-canonical', () => {
    const html = buildHubPage({ docs: siblings, styles, origin: 'https://agent-collusion.uk' })
    expect(html).toContain('href="/research/ip16-network-catalog"')
    expect(html).toContain('href="/research/coordination-topology"')
    expect(html).toContain('rel="canonical" href="https://agent-collusion.uk/research"')
    expect(html).not.toContain('<script')
  })
})

describe('buildSitemapXml', () => {
  it('lists canonical urls, optional lastmod, escaped values', () => {
    const xml = buildSitemapXml([{ loc: '/research' }, { loc: '/research/x', lastmod: '2026-09-24' }, { loc: '/a&b' }], 'https://agent-collusion.uk')
    expect(xml.startsWith('<?xml version="1.0" encoding="UTF-8"?>')).toBe(true)
    expect(xml).toContain('<loc>https://agent-collusion.uk/research</loc>')
    expect(xml).toContain('<lastmod>2026-09-24</lastmod>')
    expect(xml).toContain('https://agent-collusion.uk/a&amp;b')
    expect(xml).not.toContain('<lastmod></lastmod>')
  })
})
