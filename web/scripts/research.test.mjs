import { mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { afterEach, describe, expect, it } from 'vitest'
import { convertResearch, extractTitle, renderMarkdown } from './research.mjs'

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
    expect(readFileSync(join(outDir, 'docs', 'first-report.html'), 'utf8')).toContain('<h2>Report title</h2>')
    expect(readFileSync(join(outDir, 'files', 'first-report.md'), 'utf8')).toBe(report)
    expect(readFileSync(join(outDir, 'files', 'tables.csv'), 'utf8')).toBe('a,b\n1,2\n')
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

describe('published research package', () => {
  it('publishes only the staged selection from data/validation without executable markup', () => {
    const sourceDir = join(repoRoot, 'data', 'validation')
    const outDir = join(tempDir(), 'research')

    const index = convertResearch({ sourceDir, outDir })
    const docs = index.groups.flatMap((group) => group.docs)
    const files = index.groups.flatMap((group) => group.files)

    expect(docs.map((doc) => doc.slug)).toEqual(['coordination-topology'])
    expect(docs[0].title).toBe('Coordination topology assessment: scheduler, cohorts, relays, and hierarchy claims')
    expect(files).toHaveLength(0)
    expect(docs.map((doc) => doc.slug)).not.toContain('proxy-audit')
    expect(readdirSync(join(outDir, 'docs'))).toEqual(['coordination-topology.html'])
    expect(readdirSync(join(outDir, 'files'))).toEqual(['coordination-topology-assessment.md'])

    for (const doc of docs) {
      const html = readFileSync(join(outDir, ...doc.html.replace('research/', '').split('/')), 'utf8')
      expect(html).not.toMatch(/<script[\s>]/i)
      expect(html).not.toMatch(/href\s*=\s*["']javascript:/i)
    }
  })
})
