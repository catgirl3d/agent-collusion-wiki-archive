import { copyFileSync, mkdirSync, readFileSync, readdirSync, rmSync, statSync, writeFileSync } from 'node:fs'
import { basename, dirname, join, relative, resolve, sep } from 'node:path'
import { Marked } from 'marked'

const SAFE_PROTOCOLS = new Set(['http:', 'https:', 'mailto:'])
const SLUG_PATTERN = /^[a-z0-9]+(?:-[a-z0-9]+)*$/
const ARCHIVE_SEARCH_PARAMETERS = ['q', 'wiki', 'label', 'from', 'to', 'case', 'word']
const ARCHIVE_LINK_TYPES = new Set(['search', 'agent', 'page'])

const RESEARCH_GROUPS = [
  {
    id: 'assessments',
    label: 'Research Reports',
    docs: [
      { slug: 'coordination-topology', path: 'coordination-topology-assessment.md' },
      { slug: 'coordination-topology-ru', path: 'coordination-topology-assessment.ru.md' },
      { slug: 'coordination-topology-uk', path: 'coordination-topology-assessment.uk.md' },
      { slug: 'coordination-topology-de', path: 'coordination-topology-assessment.de.md' },
    ],
    files: [],
  },
]

// Single source of truth for language variants: slug suffix, dropdown label, and display order.
const RESEARCH_LANGUAGES = [
  { code: 'en', label: 'EN', suffix: '', aliases: [] },
  { code: 'de', label: 'DE', suffix: '-de', aliases: [] },
  { code: 'uk', label: 'UA', suffix: '-uk', aliases: ['-ua'] },
  { code: 'ru', label: 'RU', suffix: '-ru', aliases: [] },
]

export function resolveDocLanguage(slug) {
  for (const language of RESEARCH_LANGUAGES) {
    for (const suffix of [language.suffix, ...language.aliases]) {
      if (suffix && slug.endsWith(suffix) && slug.length > suffix.length) {
        return { lang: language.code, base: slug.slice(0, -suffix.length) }
      }
    }
  }
  const baseLanguage = RESEARCH_LANGUAGES.find((language) => language.suffix === '')
  return { lang: baseLanguage.code, base: slug }
}

// Publication is staged: files listed here stay in the repository but are withheld from the site.
// Move an entry into RESEARCH_GROUPS to publish it in the next stage.
const EXCLUDED_FILES = [
  'proxy-audit.md',
  'security-incident-evidence.md',
  'relay-scenarios.md',
  'mcp-forensic-query-notebook.md',
  'domain-infrastructure/README.md',
  'domain-infrastructure/methodology.md',
  'domain-infrastructure/domain-inventory.md',
  'domain-infrastructure/functional-roles.md',
  'domain-infrastructure/case-studies.md',
  'domain-infrastructure/public-crosswalk.md',
  'domain-infrastructure/domains.csv',
  'domain-infrastructure/evidence-ledger.csv',
  'domain-infrastructure/query-log.csv',
  'domain-infrastructure/resources.csv',
  'domain-infrastructure/sources.csv',
]

function escapeHtml(value) {
  return value
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
}

const HTML_ENTITIES = {
  '&amp;': '&',
  '&lt;': '<',
  '&gt;': '>',
  '&quot;': '"',
  '&#39;': "'",
}

function decodeHtmlEntities(value) {
  return value.replace(/&(?:amp|lt|gt|quot|#39);/g, (entity) => HTML_ENTITIES[entity])
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

export function parseFrontmatter(content) {
  const match = content.match(/^---\r?\n([\s\S]*?)\r?\n---\r?\n/)
  if (!match) return { meta: {}, body: content }
  const rawYaml = match[1]
  const body = content.slice(match[0].length)
  const meta = {}
  for (const line of rawYaml.split(/\r?\n/)) {
    const colonIdx = line.indexOf(':')
    if (colonIdx === -1) continue
    const key = line.slice(0, colonIdx).trim()
    let val = line.slice(colonIdx + 1).trim()
    if ((val.startsWith('"') && val.endsWith('"')) || (val.startsWith("'") && val.endsWith("'"))) {
      val = val.slice(1, -1)
    }
    meta[key] = val
  }
  return { meta, body }
}

export function extractMetadata(body, frontmatter = {}) {
  const meta = {
    date: frontmatter.date ?? null,
    author: frontmatter.author ?? null,
    status: frontmatter.status ?? null,
    summary_heading: frontmatter.summary_heading ?? null,
  }
  if (!meta.date) {
    const match = body.match(/(?:Date|Дата|Datum):\s*([0-9]{4}-[0-9]{2}-[0-9]{2})/i)
    if (match) meta.date = match[1]
  }
  if (!meta.author) {
    const match = body.match(/(?:Author|Автор|Autor):\s*([^.\n]+)/i)
    meta.author = match ? match[1].trim() : 'Alina Lisova'
  }
  if (!meta.status) {
    const match = body.match(/(?:Status|Статус):\s*([A-Za-zА-Яа-яІіЇїЄєÄäÖöÜüß]+)[^.\n]*/i)
    if (match) meta.status = match[1].trim()
  }
  return meta
}

export function cleanMarkdownBody(body) {
  return body.replace(/^(?:Date|Author|Status|Дата|Автор|Статус|Datum|Autor):\s*.*$\r?\n?/gim, '')
}

export function headingToId(text) {
  return text
    .toLowerCase()
    .replace(/<[^>]+>/g, '')
    .replace(/[^a-z0-9а-яіїєäöüß_-]+/g, '-')
    .replace(/^-+|-+$/g, '')
}

function archiveLinkError(href, message) {
  return new Error(`invalid archive link "${href}": ${message}`)
}

function parseArchiveDestination(href) {
  const destination = href.slice('archive:'.length)
  const queryIndex = destination.indexOf('?')
  const type = queryIndex === -1 ? destination : destination.slice(0, queryIndex)
  const query = queryIndex === -1 ? '' : destination.slice(queryIndex + 1)

  if (!type || type.includes('#')) throw archiveLinkError(href, `unknown archive link type "${type}"`)
  if (query.includes('#')) throw archiveLinkError(href, 'fragments are not supported')
  if (!ARCHIVE_LINK_TYPES.has(type)) throw archiveLinkError(href, `unknown archive link type "${type}"`)

  const parameters = new URLSearchParams(query)
  const seen = new Set()
  for (const [name] of parameters) {
    if (seen.has(name)) throw archiveLinkError(href, `duplicate archive ${type} parameter "${name}"`)
    seen.add(name)
  }

  const allowed = type === 'search' ? new Set(ARCHIVE_SEARCH_PARAMETERS) : new Set([type === 'page' ? 'id' : 'q'])
  for (const name of seen) {
    if (!allowed.has(name)) throw archiveLinkError(href, `unknown archive ${type} parameter "${name}"`)
  }

  for (const name of ['case', 'word']) {
    if (parameters.has(name) && !/^[01]$/.test(parameters.get(name))) {
      throw archiveLinkError(href, `archive ${type} parameter "${name}" must be 0 or 1`)
    }
  }

  return { type, parameters }
}

function captionPayload(type, requiredParameter, parameters, tokens, href) {
  const explicit = parameters.has(requiredParameter)
  const value = explicit ? parameters.get(requiredParameter) : tokens.length === 1 && tokens[0].type === 'codespan' ? tokens[0].text : null
  if (value === null) {
    throw archiveLinkError(href, `archive ${type} requires explicit ${requiredParameter} or a single codespan caption`)
  }
  const payload = value.trim()
  if (!payload) throw archiveLinkError(href, `archive ${type} ${requiredParameter} must not be empty`)
  return payload
}

export function buildArchiveLink(type, values) {
  if (type === 'search') {
    const parameters = new URLSearchParams()
    for (const name of ARCHIVE_SEARCH_PARAMETERS) {
      if (values[name] !== undefined) parameters.set(name, values[name])
    }
    return { href: `/search?${parameters}`, className: 'archive-query-link' }
  }
  if (type === 'agent') {
    const parameters = new URLSearchParams({ q: values.q })
    return { href: `/agents?${parameters}`, className: 'archive-agent-link' }
  }
  if (type === 'page') return { href: `/page/${encodeURIComponent(values.id)}`, className: 'archive-page-ref' }
  throw new Error(`unknown archive link type "${type}"`)
}

export function resolveArchiveLink(href, tokens) {
  const { type, parameters } = parseArchiveDestination(href)
  const requiredParameter = type === 'page' ? 'id' : 'q'
  const payload = captionPayload(type, requiredParameter, parameters, tokens, href)
  const values = Object.fromEntries(parameters)
  values[requiredParameter] = payload
  return buildArchiveLink(type, values)
}

export function enhanceHtml(html, { summaryHeading } = {}) {
  let result = html

  const escaped = summaryHeading ? summaryHeading.replace(/[.*+?^${}()|[\]\\]/g, '\\$&') : null
  const summaryRegex = escaped
    ? new RegExp(`<h3 id="[^"]*">\\s*(?:${escaped})`, 'i')
    : /<h3 id="[^"]*">\s*(?:Bottom line|Главный вывод|Головний висновок|Fazit)/i

  const match = result.match(summaryRegex)
  if (match && match.index !== undefined) {
    const startIndex = match.index
    const rest = result.slice(startIndex)
    const nextHeadingMatch = rest.slice(1).match(/<h[23][\s>]/)
    const endIndex = nextHeadingMatch ? startIndex + 1 + nextHeadingMatch.index : result.length

    const before = result.slice(0, startIndex)
    const calloutContent = result.slice(startIndex, endIndex)
    const after = result.slice(endIndex)

    result = `${before}<div class="research-callout-summary">\n<div class="callout-badge">KEY FINDING / EXECUTIVE SUMMARY</div>\n${calloutContent}</div>\n${after}`
  }

  return result
}

const ALERT_ICONS = {
  note: '<svg class="alert-icon" viewBox="0 0 16 16" width="16" height="16" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><circle cx="8" cy="8" r="6.5"/><line x1="8" y1="11" x2="8" y2="7.5"/><circle cx="8" cy="5" r="0.5" fill="currentColor"/></svg>',
  tip: '<svg class="alert-icon" viewBox="0 0 16 16" width="16" height="16" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M6 13.5h4M7 15h2M4.5 6.5a3.5 3.5 0 1 1 6.5 2c-.6.8-1 1.4-1 2.5H6c0-1.1-.4-1.7-1-2.5a3.5 3.5 0 0 1-.5-2Z"/></svg>',
  important: '<svg class="alert-icon" viewBox="0 0 16 16" width="16" height="16" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><circle cx="8" cy="8" r="6.5"/><line x1="8" y1="4.5" x2="8" y2="8.5"/><circle cx="8" cy="11.5" r="0.5" fill="currentColor"/></svg>',
  warning: '<svg class="alert-icon" viewBox="0 0 16 16" width="16" height="16" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="m8 1.5 6.5 12H1.5L8 1.5ZM8 6.5v3.5M8 12.5v.5"/></svg>',
  caution: '<svg class="alert-icon" viewBox="0 0 16 16" width="16" height="16" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><polygon points="5 1.5 11 1.5 14.5 5 14.5 11 11 14.5 5 14.5 1.5 11 1.5 5 5 1.5"/><line x1="8" y1="5" x2="8" y2="8.5"/><line x1="8" y1="11.5" x2="8.01" y2="11.5"/></svg>',
}

const ALERT_TITLES = {
  note: 'Note',
  tip: 'Tip',
  important: 'Important',
  warning: 'Warning',
  caution: 'Caution',
}

export function createEngine({ onHeading, onCodeSpan } = {}) {
  const engine = new Marked({ gfm: true })
  let linkCaptionDepth = 0
  engine.use({
    renderer: {
      // Research documents quote hostile HTML verbatim; raw HTML must render as text, never execute.
      html(token) {
        return escapeHtml(token.text)
      },
      // The page owns the document heading, so markdown headings start one level deeper.
      heading(token) {
        const level = Math.min(6, token.depth + 1)
        const text = this.parser.parseInline(token.tokens)
        if (onHeading) {
          return onHeading({ level, text, depth: token.depth })
        }
        return `<h${level}>${text}</h${level}>\n`
      },
      codespan(token) {
        if (linkCaptionDepth === 0 && onCodeSpan) {
          const custom = onCodeSpan(token.text)
          if (custom !== undefined) return custom
        }
        return `<code>${escapeHtml(token.text)}</code>`
      },
      // Only relative and known-safe URL schemes survive; javascript:/data: render as plain text.
      link({ href, title, tokens }) {
        if (/^archive:/i.test(href)) {
          const resolved = resolveArchiveLink(href, tokens)
          let text
          linkCaptionDepth++
          try {
            text = this.parser.parseInline(tokens)
          } finally {
            linkCaptionDepth--
          }
          const titleAttribute = title ? ` title="${escapeHtml(title)}"` : ''
          return `<a href="${escapeHtml(resolved.href)}" class="${resolved.className}"${titleAttribute}>${text}</a>`
        }

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
      blockquote(token) {
        const body = this.parser.parse(token.tokens)
        const match = body.match(/^\s*<p>\s*\[!(NOTE|TIP|IMPORTANT|WARNING|CAUTION)\](?:\s*<br\s*\/?>|\s+)?([\s\S]*?)<\/p>([\s\S]*)$/i)
        if (match) {
          const type = match[1].toLowerCase()
          const icon = ALERT_ICONS[type] ?? ''
          const title = ALERT_TITLES[type] ?? type.toUpperCase()
          const firstParagraphRest = match[2].trim()
          const restOfBody = match[3]
          const content = firstParagraphRest ? `<p>${firstParagraphRest}</p>${restOfBody}` : restOfBody
          return `<div class="markdown-alert markdown-alert-${type}">\n<div class="markdown-alert-title">${icon}<span>${title}</span></div>\n${content}</div>\n`
        }
        return `<blockquote>\n${body}</blockquote>\n`
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

  const languageBySlug = new Map()
  const familyMembers = new Map()
  for (const slug of slugs) {
    const { lang, base } = resolveDocLanguage(slug)
    languageBySlug.set(slug, { lang, base })
    let members = familyMembers.get(base)
    if (!members) {
      members = new Map()
      familyMembers.set(base, members)
    }
    const existing = members.get(lang)
    if (existing) throw new Error(`duplicate ${lang} translation for base ${base}: ${existing}, ${slug}`)
    members.set(lang, slug)
  }

  rmSync(outDir, { recursive: true, force: true })
  const docsDir = join(outDir, 'docs')
  const filesDir = join(outDir, 'files')
  mkdirSync(docsDir, { recursive: true })

  const indexGroups = groups.map((group) => ({
    id: group.id,
    label: group.label,
    docs: group.docs.map(({ slug, path }) => {
      const rawMarkdown = readFileSync(join(sourceDir, path), 'utf8')
      const { meta: frontmatter, body } = parseFrontmatter(rawMarkdown)
      const meta = extractMetadata(body, frontmatter)
      const cleanBody = cleanMarkdownBody(body)
      const title = extractTitle(cleanBody) ?? frontmatter.title ?? slug

      let headingIdx = 0
      const usedIds = new Set()
      const toc = []

      const engine = createEngine({
        onHeading({ level, text }) {
          const plainText = decodeHtmlEntities(text.replace(/<[^>]+>/g, '')).trim()
          let id = headingToId(plainText) || `section-${headingIdx}`
          if (usedIds.has(id)) {
            id = `${id}-${headingIdx}`
          }
          usedIds.add(id)

          const isDocTitle = headingIdx === 0 && level === 2
          headingIdx++

          if (!isDocTitle && plainText) {
            toc.push({ id, text: plainText, level })
            return `<h${level} id="${id}">${text}<a href="#${id}" class="heading-anchor" aria-label="Direct link to ${escapeHtml(plainText)}">#</a></h${level}>\n`
          }

          return `<h${level} id="${id}">${text}</h${level}>\n`
        },
        onCodeSpan(text) {
          const trimmed = text.trim()
          if (/^dse\/[A-Za-z0-9_-]+$/.test(trimmed)) {
            return `<a href="/page/${encodeURIComponent(trimmed)}" class="archive-page-ref" title="View wiki page ${escapeHtml(trimmed)}">${escapeHtml(trimmed)}</a>`
          }
          return undefined
        },
      })

      let rawHtml
      try {
        rawHtml = renderMarkdown(cleanBody, engine)
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error)
        throw new Error(`research document ${path}: ${message}`, { cause: error })
      }
      const html = enhanceHtml(rawHtml, { summaryHeading: meta.summary_heading })

      const htmlPath = join(docsDir, `${slug}.html`)
      assertInside(docsDir, htmlPath, 'document')
      writeFileSync(htmlPath, html, 'utf8')
      copySource(sourceDir, filesDir, path)

      const { lang, base } = languageBySlug.get(slug)
      const members = familyMembers.get(base)
      const translations = RESEARCH_LANGUAGES
        .filter((language) => members.has(language.code))
        .map((language) => ({ lang: language.code, slug: members.get(language.code) }))

      return {
        slug,
        title,
        source: path,
        html: `research/docs/${slug}.html`,
        raw: `research/files/${path}`,
        lang,
        base,
        translations,
        meta: {
          date: meta.date,
          author: meta.author,
          status: meta.status,
        },
        toc,
      }
    }),
    files: group.files.map((path) => {
      copySource(sourceDir, filesDir, path)
      return { name: basename(path), raw: `research/files/${path}` }
    }),
  }))

  const index = {
    source: 'data/validation',
    languages: RESEARCH_LANGUAGES.map(({ code, label }) => ({ code, label })),
    groups: indexGroups,
  }
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
