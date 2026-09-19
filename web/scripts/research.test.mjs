import { mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { afterEach, describe, expect, it } from 'vitest'
import {
  buildArchiveLink,
  convertResearch,
  enhanceHtml,
  extractMetadata,
  extractTitle,
  parseFrontmatter,
  renderMarkdown,
  resolveDocLanguage,
} from './research.mjs'

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..')
const tempDirs = []

function tempDir() {
  const dir = mkdtempSync(join(tmpdir(), 'research-test-'))
  tempDirs.push(dir)
  return dir
}

function write(dir, path, content) {
  const target = join(dir, ...path.split('/'))
  mkdirSync(dirname(target), { recursive: true })
  writeFileSync(target, content, 'utf8')
}

const fixtureGroups = [
  {
    id: 'assessments',
    label: 'Assessments',
    docs: [{ slug: 'first-report', path: 'first-report.md' }],
    files: ['tables.csv'],
  },
]

afterEach(() => {
  while (tempDirs.length > 0) rmSync(tempDirs.pop(), { recursive: true, force: true })
})

describe('resolveDocLanguage', () => {
  it('maps base documents, suffixes and aliases to language families', () => {
    expect(resolveDocLanguage('report')).toEqual({ lang: 'en', base: 'report' })
    expect(resolveDocLanguage('report-ru')).toEqual({ lang: 'ru', base: 'report' })
    expect(resolveDocLanguage('report-uk')).toEqual({ lang: 'uk', base: 'report' })
    expect(resolveDocLanguage('report-ua')).toEqual({ lang: 'uk', base: 'report' })
    expect(resolveDocLanguage('report-de')).toEqual({ lang: 'de', base: 'report' })
  })

  it('treats unsupported suffixes as part of the base slug', () => {
    expect(resolveDocLanguage('report-es')).toEqual({ lang: 'en', base: 'report-es' })
    expect(resolveDocLanguage('ru')).toEqual({ lang: 'en', base: 'ru' })
  })
})

describe('extractTitle', () => {
  it('takes the first level-one heading as the document title', () => {
    expect(extractTitle('intro\n\n# Real title\n\n## Section')).toBe('Real title')
  })

  it('returns null when the document has no level-one heading', () => {
    expect(extractTitle('## Only subheading')).toBeNull()
  })
})

describe('renderMarkdown', () => {
  it('escapes raw HTML in prose and code so hostile markup cannot execute', () => {
    const html = renderMarkdown('probe <script>alert(1)</script>\n\n```\n<script>document.write("x")</script>\n```\n')

    expect(html).toContain('&lt;script&gt;')
    expect(html).not.toMatch(/<script/i)
    expect(html).toContain('&lt;script&gt;document.write')
  })

  it('demotes headings below the page-level heading', () => {
    const html = renderMarkdown('# Title\n\n## Section\n\n### Detail')

    expect(html).toContain('<h2>Title</h2>')
    expect(html).toContain('<h3>Section</h3>')
    expect(html).toContain('<h4>Detail</h4>')
    expect(html).not.toContain('<h1>')
  })

  it('renders GFM tables used by the reports', () => {
    const html = renderMarkdown('| A | B |\n|---|---|\n| 1 | 2 |\n')

    expect(html).toContain('<table>')
    expect(html).toContain('<th>A</th>')
    expect(html).toContain('<td>1</td>')
  })

  it('strips links and images with dangerous URL schemes', () => {
    const link = renderMarkdown('[click](javascript:alert(1))')

    expect(link).not.toContain('<a')
    expect(link).not.toContain('javascript:')
    expect(link).toContain('click')

    const image = renderMarkdown('![shot](data:text/html,<script>alert(1)</script>)')

    expect(image).not.toContain('<img')
    expect(image).not.toMatch(/<script[\s>]/i)
  })

  it('keeps relative and http links intact', () => {
    expect(renderMarkdown('[ok](https://example.com)')).toContain('<a href="https://example.com">ok</a>')
    expect(renderMarkdown('[rel](./other.md)')).toContain('<a href="./other.md">rel</a>')
  })
})

describe('archive links', () => {
  it('builds default search, agent, and page links from one codespan caption', () => {
    const html = renderMarkdown(
      '[`scheduler`](archive:search?case=1&word=0)\n\n[`MapHelper`](archive:agent)\n\n[`dse/Page`](archive:page)',
    )

    expect(html).toContain(
      '<a href="/search?q=scheduler&amp;case=1&amp;word=0" class="archive-query-link"><code>scheduler</code></a>',
    )
    expect(html).toContain('<a href="/agents?q=MapHelper" class="archive-agent-link"><code>MapHelper</code></a>')
    expect(html).toContain('<a href="/page/dse%2FPage" class="archive-page-ref"><code>dse/Page</code></a>')
  })

  it('builds every allowed search filter with URLSearchParams encoding', () => {
    const html = renderMarkdown(
      '[Search](archive:search?q=scheduler%20%26%20%C3%BC&wiki=de%2Fwiki&label=MapHelper%2B1&from=2026-01-02&to=2026-01-03&case=1&word=0)',
    )

    expect(html).toContain(
      'href="/search?q=scheduler+%26+%C3%BC&amp;wiki=de%2Fwiki&amp;label=MapHelper%2B1&amp;from=2026-01-02&amp;to=2026-01-03&amp;case=1&amp;word=0" class="archive-query-link"',
    )
  })

  it('allows arbitrary Markdown captions when q or id is explicit', () => {
    const html = renderMarkdown(
      '[**Find** *scheduler*](archive:search?q=scheduler)\n\n[Agent **MapHelper**](archive:agent?q=MapHelper%2F1)\n\n[Wiki <b>page</b>](archive:page?id=wiki%2FPage%3Fv%3D1)',
    )

    expect(html).toContain('<a href="/search?q=scheduler" class="archive-query-link"><strong>Find</strong> <em>scheduler</em></a>')
    expect(html).toContain('<a href="/agents?q=MapHelper%2F1" class="archive-agent-link">Agent <strong>MapHelper</strong></a>')
    expect(html).toContain('<a href="/page/wiki%2FPage%3Fv%3D1" class="archive-page-ref">Wiki &lt;b&gt;page&lt;/b&gt;</a>')
  })

  it('keeps enhanceHtml summary callouts without inferring links from table HTML', () => {
    const summary = enhanceHtml('<h3 id="bottom-line">Bottom line</h3><p>Summary.</p>')
    const table = enhanceHtml(renderMarkdown('| Literal query | Label |\n|---|---|\n| `scheduler` | `MapHelper` |'))

    expect(summary).toContain('class="research-callout-summary"')
    expect(table).toContain('<code>scheduler</code>')
    expect(table).toContain('<code>MapHelper</code>')
    expect(table).not.toContain('archive-query-link')
    expect(table).not.toContain('archive-agent-link')
  })

  it('escapes hostile captions and keeps reserved destination characters encoded', () => {
    const html = renderMarkdown(
      '[<img src=x onerror=alert(1)>](archive:search?q=%22%3E%3Cscript%3Ealert%281%29%3C%2Fscript%3E)',
    )

    expect(html).toContain(
      'href="/search?q=%22%3E%3Cscript%3Ealert%281%29%3C%2Fscript%3E" class="archive-query-link"',
    )
    expect(html).toContain('&lt;img src=x onerror=alert(1)&gt;')
    expect(html).not.toMatch(/<img|<script/i)
  })
})

describe('archive link validation', () => {
  it('rejects unknown types in the centralized builder', () => {
    expect(() => buildArchiveLink('unknown', {})).toThrow(/unknown archive link type "unknown"/i)
  })

  it('rejects unknown types and parameters', () => {
    expect(() => renderMarkdown('[x](archive:unknown)')).toThrow(/unknown archive link type/i)
    expect(() => renderMarkdown('[`x`](archive:search?q=x&page=1)')).toThrow(/unknown archive search parameter "page"/i)
    expect(() => renderMarkdown('[`x`](archive:search?q=x&sort=desc)')).toThrow(/unknown archive search parameter "sort"/i)
    expect(() => renderMarkdown('[`x`](archive:search?q=x&dir=asc)')).toThrow(/unknown archive search parameter "dir"/i)
    expect(() => renderMarkdown('[`x`](archive:agent?label=x)')).toThrow(/unknown archive agent parameter "label"/i)
    expect(() => renderMarkdown('[`x`](archive:page?q=x)')).toThrow(/unknown archive page parameter "q"/i)
  })

  it('rejects duplicate parameters', () => {
    expect(() => renderMarkdown('[`x`](archive:search?q=one&q=two)')).toThrow(/duplicate archive search parameter "q"/i)
    expect(() => renderMarkdown('[`x`](archive:search?q=x&case=1&case=0)')).toThrow(/duplicate archive search parameter "case"/i)
  })

  it('rejects empty required payloads and invalid boolean filters', () => {
    expect(() => renderMarkdown('[caption](archive:search?q=)')).toThrow(/archive search q must not be empty/i)
    expect(() => renderMarkdown('[caption](archive:agent?q=)')).toThrow(/archive agent q must not be empty/i)
    expect(() => renderMarkdown('[caption](archive:page?id=)')).toThrow(/archive page id must not be empty/i)
    expect(() => renderMarkdown('[`x`](archive:search?q=x&case=2)')).toThrow(/archive search parameter "case" must be 0 or 1/i)
    expect(() => renderMarkdown('[`x`](archive:search?q=x&word=true)')).toThrow(/archive search parameter "word" must be 0 or 1/i)
  })

  it('requires a single codespan caption when the required payload is implicit', () => {
    expect(() => renderMarkdown('[scheduler](archive:search)')).toThrow(/archive search requires explicit q or a single codespan caption/i)
    expect(() => renderMarkdown('[**MapHelper**](archive:agent)')).toThrow(/archive agent requires explicit q or a single codespan caption/i)
    expect(() => renderMarkdown('[dse/Page](archive:page)')).toThrow(/archive page requires explicit id or a single codespan caption/i)
    expect(() => renderMarkdown('[` `](archive:search)')).toThrow(/archive search q must not be empty/i)
  })
})

describe('convertResearch', () => {
  it('publishes documents, raw sources, and data files with a manifest', () => {
    const sourceDir = tempDir()
    const outDir = join(tempDir(), 'research')
    const report = '# Report title\n\n| A |\n|---|\n| 1 |\n'
    write(sourceDir, 'first-report.md', report)
    write(sourceDir, 'tables.csv', 'a,b\n1,2\n')

    const index = convertResearch({ sourceDir, outDir, groups: fixtureGroups, excluded: [] })

    expect(index.source).toBe('data/validation')
    expect(index.groups[0].docs[0]).toMatchObject({
      slug: 'first-report',
      title: 'Report title',
      html: 'research/docs/first-report.html',
      raw: 'research/files/first-report.md',
    })
    expect(index.groups[0].files[0]).toMatchObject({ name: 'tables.csv', raw: 'research/files/tables.csv' })
    expect(readFileSync(join(outDir, 'docs', 'first-report.html'), 'utf8')).toContain(
      '<h2 id="report-title">Report title</h2>',
    )
    expect(readFileSync(join(outDir, 'files', 'first-report.md'), 'utf8')).toBe(report)
    expect(readFileSync(join(outDir, 'files', 'tables.csv'), 'utf8')).toBe('a,b\n1,2\n')
  })

  it('preserves implicit dse codespan page references', () => {
    const sourceDir = tempDir()
    const outDir = join(tempDir(), 'research')
    write(sourceDir, 'first-report.md', '# Report title\n\n`dse/Page`\n')

    convertResearch({
      sourceDir,
      outDir,
      groups: [{ id: 'g', label: 'G', docs: [{ slug: 'first-report', path: 'first-report.md' }], files: [] }],
      excluded: [],
    })

    expect(readFileSync(join(outDir, 'docs', 'first-report.html'), 'utf8')).toContain(
      '<a href="/page/dse%2FPage" class="archive-page-ref" title="View wiki page dse/Page">dse/Page</a>',
    )
  })

  it('includes the source path when archive-link rendering fails', () => {
    const sourceDir = tempDir()
    write(sourceDir, 'first-report.md', '# Report title\n\n[caption](archive:search)\n')

    expect(() =>
      convertResearch({
        sourceDir,
        outDir: join(tempDir(), 'research'),
        groups: [{ id: 'g', label: 'G', docs: [{ slug: 'first-report', path: 'first-report.md' }], files: [] }],
        excluded: [],
      }),
    ).toThrow(/first-report\.md.*single codespan/i)
  })

  it('fails when a research file is neither published nor excluded', () => {
    const sourceDir = tempDir()
    write(sourceDir, 'first-report.md', '# Report title\n')
    write(sourceDir, 'tables.csv', 'a\n')
    write(sourceDir, 'new-draft.md', '# Unregistered\n')

    expect(() => convertResearch({ sourceDir, outDir: join(tempDir(), 'research'), groups: fixtureGroups, excluded: [] })).toThrow(
      /neither published nor excluded: new-draft\.md/,
    )
  })

  it('fails when an excluded file is also listed as published', () => {
    const sourceDir = tempDir()
    write(sourceDir, 'first-report.md', '# Report title\n')
    write(sourceDir, 'tables.csv', 'a\n')

    expect(() =>
      convertResearch({ sourceDir, outDir: join(tempDir(), 'research'), groups: fixtureGroups, excluded: ['tables.csv'] }),
    ).toThrow(/duplicates/)
  })

  it('links translated variants and marks only existing languages', () => {
    const sourceDir = tempDir()
    const outDir = join(tempDir(), 'research')
    write(sourceDir, 'first-report.md', '# Report title\n')
    write(sourceDir, 'first-report-ru.md', '# Заголовок\n')

    const index = convertResearch({
      sourceDir,
      outDir,
      groups: [
        {
          id: 'g',
          label: 'G',
          docs: [
            { slug: 'first-report', path: 'first-report.md' },
            { slug: 'first-report-ru', path: 'first-report-ru.md' },
          ],
          files: [],
        },
      ],
      excluded: [],
    })

    expect(index.languages).toEqual([
      { code: 'en', label: 'EN' },
      { code: 'de', label: 'DE' },
      { code: 'uk', label: 'UA' },
      { code: 'ru', label: 'RU' },
    ])
    expect(index.groups[0].docs[0]).toMatchObject({ lang: 'en', base: 'first-report' })
    expect(index.groups[0].docs[0].translations).toEqual([
      { lang: 'en', slug: 'first-report' },
      { lang: 'ru', slug: 'first-report-ru' },
    ])
    expect(index.groups[0].docs[1]).toMatchObject({ lang: 'ru', base: 'first-report' })
    expect(index.groups[0].docs[1].translations).toEqual(index.groups[0].docs[0].translations)
  })

  it('decodes HTML entities in TOC text and anchor labels', () => {
    const sourceDir = tempDir()
    const outDir = join(tempDir(), 'research')
    write(sourceDir, 'first-report.md', '# Report title\n\n## A & B < C\n')

    const index = convertResearch({
      sourceDir,
      outDir,
      groups: [{ id: 'g', label: 'G', docs: [{ slug: 'first-report', path: 'first-report.md' }], files: [] }],
      excluded: [],
    })

    expect(index.groups[0].docs[0].toc).toEqual([{ id: 'a-b-c', text: 'A & B < C', level: 3 }])
    expect(readFileSync(join(outDir, 'docs', 'first-report.html'), 'utf8')).toContain(
      'aria-label="Direct link to A &amp; B &lt; C"',
    )
  })

  it('keeps a translation-only document as its own family', () => {
    const sourceDir = tempDir()
    write(sourceDir, 'first-report-ru.md', '# Заголовок\n')

    const index = convertResearch({
      sourceDir,
      outDir: join(tempDir(), 'research'),
      groups: [{ id: 'g', label: 'G', docs: [{ slug: 'first-report-ru', path: 'first-report-ru.md' }], files: [] }],
      excluded: [],
    })

    expect(index.groups[0].docs[0]).toMatchObject({ lang: 'ru', base: 'first-report' })
    expect(index.groups[0].docs[0].translations).toEqual([{ lang: 'ru', slug: 'first-report-ru' }])
  })

  it('rejects two variants of the same language in one family', () => {
    const sourceDir = tempDir()
    write(sourceDir, 'first-report-uk.md', '# Заголовок\n')
    write(sourceDir, 'first-report-ua.md', '# Заголовок\n')

    expect(() =>
      convertResearch({
        sourceDir,
        outDir: join(tempDir(), 'research'),
        groups: [
          {
            id: 'g',
            label: 'G',
            docs: [
              { slug: 'first-report-uk', path: 'first-report-uk.md' },
              { slug: 'first-report-ua', path: 'first-report-ua.md' },
            ],
            files: [],
          },
        ],
        excluded: [],
      }),
    ).toThrow(/duplicate uk translation for base first-report/)
  })

  it('rejects slugs that are not plain path segments', () => {
    const sourceDir = tempDir()
    write(sourceDir, 'first-report.md', '# Report title\n')
    write(sourceDir, 'tables.csv', 'a\n')

    expect(() =>
      convertResearch({
        sourceDir,
        outDir: join(tempDir(), 'research'),
        groups: [{ id: 'g', label: 'G', docs: [{ slug: '../escape', path: 'first-report.md' }], files: ['tables.csv'] }],
        excluded: [],
      }),
    ).toThrow(/invalid research slugs: \.\.\/escape/)
  })
})

describe('parseFrontmatter and extractMetadata', () => {
  it('parses YAML frontmatter and extracts metadata', () => {
    const markdown = `---\ndate: 2026-09-19\nauthor: Test Author\nstatus: PRELIMINARY\nsummary_heading: Bottom line\n---\n\n# Document Title\n\nContent here.\n`
    const { meta: frontmatter, body } = parseFrontmatter(markdown)
    expect(frontmatter).toEqual({
      date: '2026-09-19',
      author: 'Test Author',
      status: 'PRELIMINARY',
      summary_heading: 'Bottom line',
    })
    expect(body).toContain('# Document Title')

    const meta = extractMetadata(body, frontmatter)
    expect(meta).toEqual({
      date: '2026-09-19',
      author: 'Test Author',
      status: 'PRELIMINARY',
      summary_heading: 'Bottom line',
    })
  })

  it('falls back to regex extraction when frontmatter is absent', () => {
    const markdown = `# Title\n\nDate: 2026-09-15.\n\nAuthor: Legacy Author\n\nStatus: CONFIRMED\n\nContent.\n`
    const { meta: frontmatter, body } = parseFrontmatter(markdown)
    expect(frontmatter).toEqual({})

    const meta = extractMetadata(body, frontmatter)
    expect(meta.date).toBe('2026-09-15')
    expect(meta.author).toBe('Legacy Author')
    expect(meta.status).toBe('CONFIRMED')
  })
})

describe('published research package', () => {
  it('publishes only the staged selection from data/validation without executable markup', () => {
    const sourceDir = join(repoRoot, 'data', 'validation')
    const outDir = join(tempDir(), 'research')

    const index = convertResearch({ sourceDir, outDir })
    const docs = index.groups.flatMap((group) => group.docs)
    const files = index.groups.flatMap((group) => group.files)

    expect(index.languages.map((language) => language.code)).toEqual(['en', 'de', 'uk', 'ru'])
    expect(docs.map((doc) => doc.slug)).toEqual([
      'coordination-topology',
      'coordination-topology-ru',
      'coordination-topology-uk',
      'coordination-topology-de',
    ])
    expect(docs[0].lang).toBe('en')
    expect(docs[0].base).toBe('coordination-topology')
    expect(docs[0].translations).toEqual([
      { lang: 'en', slug: 'coordination-topology' },
      { lang: 'de', slug: 'coordination-topology-de' },
      { lang: 'uk', slug: 'coordination-topology-uk' },
      { lang: 'ru', slug: 'coordination-topology-ru' },
    ])
    expect(docs[1]).toMatchObject({ lang: 'ru', base: 'coordination-topology' })
    expect(docs[0].title).toBe('Coordination topology assessment: scheduler, cohorts, relays, and hierarchy claims')
    expect(files).toHaveLength(0)
    expect(docs.map((doc) => doc.slug)).not.toContain('proxy-audit')
    expect(docs[0].meta).toEqual({
      date: '2026-09-19',
      author: 'Alina Lisova',
      status: 'PRELIMINARY',
    })
    expect(docs[0].toc.length).toBeGreaterThan(0)
    expect(readdirSync(join(outDir, 'docs')).sort()).toEqual([
      'coordination-topology-de.html',
      'coordination-topology-ru.html',
      'coordination-topology-uk.html',
      'coordination-topology.html',
    ])
    expect(readdirSync(join(outDir, 'files')).sort()).toEqual([
      'coordination-topology-assessment.de.md',
      'coordination-topology-assessment.md',
      'coordination-topology-assessment.ru.md',
      'coordination-topology-assessment.uk.md',
    ])

    for (const doc of docs) {
      const html = readFileSync(join(outDir, ...doc.html.replace('research/', '').split('/')), 'utf8')
      expect(html).not.toMatch(/<script[\s>]/i)
      expect(html).not.toMatch(/href\s*=\s*["']javascript:/i)
    }
  })

  describe('renderMarkdown alerts', () => {
    it('renders > [!NOTE] as a note alert with icon and title', () => {
      const html = renderMarkdown('> [!NOTE]\n> Useful information that users should know.')
      expect(html).toContain('class="markdown-alert markdown-alert-note"')
      expect(html).toContain('class="markdown-alert-title"')
      expect(html).toContain('<span>Note</span>')
      expect(html).toContain('<p>Useful information that users should know.</p>')
      expect(html).not.toContain('<blockquote>')
    })

    it('renders > [!WARNING] and preserves multi-paragraph content', () => {
      const html = renderMarkdown('> [!WARNING]\n> Critical warning line.\n>\n> Second paragraph.')
      expect(html).toContain('class="markdown-alert markdown-alert-warning"')
      expect(html).toContain('<span>Warning</span>')
      expect(html).toContain('<p>Critical warning line.</p>')
      expect(html).toContain('<p>Second paragraph.</p>')
    })

    it('supports TIP, IMPORTANT, and CAUTION alerts', () => {
      expect(renderMarkdown('> [!TIP]\n> Helpful tip')).toContain('markdown-alert-tip')
      expect(renderMarkdown('> [!IMPORTANT]\n> Key fact')).toContain('markdown-alert-important')
      expect(renderMarkdown('> [!CAUTION]\n> Danger ahead')).toContain('markdown-alert-caution')
    })

    it('leaves standard blockquotes without [!TAG] as <blockquote>', () => {
      const html = renderMarkdown('> Regular blockquote text.')
      expect(html).toContain('<blockquote>')
      expect(html).not.toContain('markdown-alert')
    })
  })
})
