import { copyFileSync, mkdirSync, readFileSync, readdirSync, rmSync, statSync, writeFileSync } from 'node:fs'
import { basename, dirname, join, relative, resolve, sep } from 'node:path'
import { Marked } from 'marked'

const SAFE_PROTOCOLS = new Set(['http:', 'https:', 'mailto:'])
const SLUG_PATTERN = /^[a-z0-9]+(?:-[a-z0-9]+)*$/

const RESEARCH_GROUPS = [
  {
    id: 'assessments',
    label: 'Assessments',
    docs: [{ slug: 'coordination-topology', path: 'coordination-topology-assessment-2026-09-12.md' }],
    files: [],
  },
]

// Publication is staged: files listed here stay in the repository but are withheld from the site.
// Move an entry into RESEARCH_GROUPS to publish it in the next stage.
const EXCLUDED_FILES = [
  'proxy-audit-2026-09-06.md',
  'security-incident-evidence-2026-09-12.md',
  'relay-scenarios-2026-09-12.md',
  'mcp-forensic-query-notebook-2026-09-12.md',
  'domain-infrastructure-2026-09-12/README.md',
  'domain-infrastructure-2026-09-12/methodology.md',
  'domain-infrastructure-2026-09-12/domain-inventory.md',
  'domain-infrastructure-2026-09-12/functional-roles.md',
  'domain-infrastructure-2026-09-12/case-studies.md',
  'domain-infrastructure-2026-09-12/public-crosswalk.md',
  'domain-infrastructure-2026-09-12/domains.csv',
  'domain-infrastructure-2026-09-12/evidence-ledger.csv',
  'domain-infrastructure-2026-09-12/query-log.csv',
  'domain-infrastructure-2026-09-12/resources.csv',
  'domain-infrastructure-2026-09-12/sources.csv',
]

function escapeHtml(value) {
  return value
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
}

function isSafeDestination(destination) {
  const normalized = [...destination].filter((char) => !/\s/.test(char) && char.charCodeAt(0) > 0x1f).join('')
  if (!/^[a-z][a-z0-9+.-]*:/i.test(normalized)) return true
  try {
    return SAFE_PROTOCOLS.has(new URL(normalized).protocol)
  } catch {
    return false
  }
}

function assertInside(baseDir, targetPath, label) {
  const base = resolve(baseDir)
  const target = resolve(targetPath)
  if (!target.startsWith(base + sep)) throw new Error(`research ${label} escapes ${base}: ${targetPath}`)
}

function createEngine() {
  const engine = new Marked({ gfm: true })
  engine.use({
    renderer: {
      // Research documents quote hostile HTML verbatim; raw HTML must render as text, never execute.
      html(token) {
        return escapeHtml(token.text)
      },
      // The page owns the document heading, so markdown headings start one level deeper.
      heading(token) {
        const level = Math.min(6, token.depth + 1)
        return `<h${level}>${this.parser.parseInline(token.tokens)}</h${level}>\n`
      },
      // Only relative and known-safe URL schemes survive; javascript:/data: render as plain text.
      link({ href, title, tokens }) {
        const text = this.parser.parseInline(tokens)
        if (!isSafeDestination(href)) return text
        const titleAttribute = title ? ` title="${escapeHtml(title)}"` : ''
        return `<a href="${escapeHtml(href)}"${titleAttribute}>${text}</a>`
      },
      image({ href, title, text }) {
        if (!isSafeDestination(href)) return escapeHtml(text ?? '')
        const titleAttribute = title ? ` title="${escapeHtml(title)}"` : ''
        return `<img src="${escapeHtml(href)}" alt="${escapeHtml(text ?? '')}"${titleAttribute}>`
      },
    },
  })
  return engine
}

export function renderMarkdown(markdown, engine = createEngine()) {
  return engine.parse(markdown)
}

export function extractTitle(markdown) {
  const match = markdown.match(/^#\s+(.+?)\s*$/m)
  return match ? match[1].trim() : null
}

function listSourceFiles(sourceDir) {
  const found = []
  const walk = (dir) => {
    for (const entry of readdirSync(dir).sort()) {
      const full = join(dir, entry)
      if (statSync(full).isDirectory()) walk(full)
      else if (entry.endsWith('.md') || entry.endsWith('.csv')) found.push(relative(sourceDir, full).split(sep).join('/'))
    }
  }
  walk(sourceDir)
  return found
}

function assertSourceCoverage({ sourceDir, published, excluded }) {
  const duplicates = [...published, ...excluded].filter((path, index, all) => all.indexOf(path) !== index)
  if (duplicates.length > 0) throw new Error(`research manifest lists duplicates: ${[...new Set(duplicates)].join(', ')}`)

  const found = listSourceFiles(sourceDir)
  const known = new Set([...published, ...excluded])
  const missing = published.filter((path) => !found.includes(path))
  const unregistered = found.filter((path) => !known.has(path))
  if (missing.length > 0 || unregistered.length > 0) {
    const parts = []
    if (missing.length > 0) parts.push(`listed but missing: ${missing.join(', ')}`)
    if (unregistered.length > 0) parts.push(`neither published nor excluded: ${unregistered.join(', ')}`)
    throw new Error(`research source coverage mismatch (${parts.join('; ')})`)
  }
}

export function convertResearch({ sourceDir, outDir, groups: groupDefs = RESEARCH_GROUPS, excluded = EXCLUDED_FILES }) {
  const groups = groupDefs.map((group) => ({ ...group }))
  const published = groups.flatMap((group) => [...group.docs.map((doc) => doc.path), ...group.files])
  assertSourceCoverage({ sourceDir, published, excluded })

  const slugs = groups.flatMap((group) => group.docs.map((doc) => doc.slug))
  const invalidSlugs = slugs.filter((slug) => !SLUG_PATTERN.test(slug))
  if (invalidSlugs.length > 0) throw new Error(`invalid research slugs: ${[...new Set(invalidSlugs)].join(', ')}`)

  const duplicateSlugs = slugs.filter((slug, index, all) => all.indexOf(slug) !== index)
  if (duplicateSlugs.length > 0) throw new Error(`research manifest lists duplicate slugs: ${[...new Set(duplicateSlugs)].join(', ')}`)

  rmSync(outDir, { recursive: true, force: true })
  const docsDir = join(outDir, 'docs')
  const filesDir = join(outDir, 'files')
  mkdirSync(docsDir, { recursive: true })

  const engine = createEngine()
  const indexGroups = groups.map((group) => ({
    id: group.id,
    label: group.label,
    docs: group.docs.map(({ slug, path }) => {
      const markdown = readFileSync(join(sourceDir, path), 'utf8')
      const title = extractTitle(markdown) ?? slug
      const htmlPath = join(docsDir, `${slug}.html`)
      assertInside(docsDir, htmlPath, 'document')
      writeFileSync(htmlPath, renderMarkdown(markdown, engine), 'utf8')
      copySource(sourceDir, filesDir, path)
      return { slug, title, source: path, html: `research/docs/${slug}.html`, raw: `research/files/${path}` }
    }),
    files: group.files.map((path) => {
      copySource(sourceDir, filesDir, path)
      return { name: basename(path), raw: `research/files/${path}` }
    }),
  }))

  const index = { source: 'data/validation', groups: indexGroups }
  writeFileSync(join(outDir, 'index.json'), `${JSON.stringify(index, null, 2)}\n`, 'utf8')
  return index
}

function copySource(sourceDir, filesDir, path) {
  const target = join(filesDir, path)
  assertInside(filesDir, target, 'file')
  mkdirSync(dirname(target), { recursive: true })
  copyFileSync(join(sourceDir, path), target)
}

export function syncResearch({ webRoot, target }) {
  const sourceDir = resolve(webRoot, '..', 'data', 'validation')
  return convertResearch({ sourceDir, outDir: join(target, 'research') })
}
