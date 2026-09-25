import { mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { dirname, isAbsolute, join, relative, resolve, sep } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'

const WEB_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const ORIGIN = 'https://agent-collusion.uk'
const SITE_NAME = 'Agent Wiki Archive'
const TITLE_LIMIT = 60
const DESCRIPTION_LIMIT = 160
const HUB_DESCRIPTION = 'Three research reports on autonomous AI agents across public wikis: coordination topology, IP16 network catalog, and OpenAI wiki incident acknowledgment.'
const REPORT_DESCRIPTION = 'Research report on autonomous AI agent activity across public wikis.'

export function escapeHtml(value) {
  return value
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#39;')
}

export function pickStylesheets(distIndexHtml) {
  return [...distIndexHtml.matchAll(/<link\b[^>]*>/gi)]
    .map(([tag]) => tag)
    .filter((tag) => /(?:^|\s)rel\s*=\s*(?:"stylesheet"|'stylesheet'|stylesheet(?=\s|\/?>))/i.test(tag))
}

function escapeWithinLimit(value, limit) {
  let escaped = ''
  for (const character of value) {
    const encoded = escapeHtml(character)
    if (escaped.length + encoded.length > limit) break
    escaped += encoded
  }
  return escaped
}

function buildHead({ title, description, canonical, styles, openGraphType, ogTitle = title }) {
  const safeTitle = escapeHtml(title)
  const safeOgTitle = escapeHtml(ogTitle)
  const safeDescription = escapeWithinLimit(description, DESCRIPTION_LIMIT)
  const openGraph = openGraphType
    ? `
<meta property="og:type" content="${openGraphType}" />
<meta property="og:site_name" content="${SITE_NAME}" />
<meta property="og:title" content="${safeOgTitle}" />
<meta property="og:description" content="${safeDescription}" />
<meta property="og:url" content="${escapeHtml(canonical)}" />
<meta name="twitter:card" content="summary" />`
    : ''

  return `<head>
<meta charset="UTF-8" />
<meta name="viewport" content="width=device-width, initial-scale=1.0" />
<title>${safeTitle}</title>
<meta name="description" content="${safeDescription}" />
<link rel="canonical" href="${escapeHtml(canonical)}" />${openGraph}
${styles.join('\n')}
</head>`
}

function buildMetaLine(meta, fields) {
  const values = fields
    .map((field) => meta?.[field])
    .filter((value) => typeof value === 'string' && value.length > 0)
    .map(escapeHtml)
  return values.length > 0 ? `<p class="research-meta">${values.join(' · ')}</p>` : ''
}

function buildDocDescription(doc) {
  const details = [doc.meta?.status, doc.meta?.date, doc.meta?.author]
    .filter((value) => typeof value === 'string' && value.length > 0)
    .join(', ')
  return `${doc.title}${details ? ` — ${details}` : ''}. ${REPORT_DESCRIPTION}`
}

function buildDocTitle(title) {
  const suffix = ` — ${SITE_NAME}`
  if (title.length + suffix.length <= TITLE_LIMIT) return `${title}${suffix}`
  if (title.length <= TITLE_LIMIT) return title

  let trimmedTitle = ''
  for (const word of title.trim().split(/\s+/)) {
    const candidate = trimmedTitle ? `${trimmedTitle} ${word}` : word
    if (candidate.length > TITLE_LIMIT) {
      if (!trimmedTitle) return word.slice(0, TITLE_LIMIT)
      break
    }
    trimmedTitle = candidate
  }
  return trimmedTitle
}

export function buildDocPage({ doc, siblings, fragment, styles, origin }) {
  const canonical = `${origin}/research/${doc.slug}`
  const title = buildDocTitle(doc.title)
  const ogTitle = `${doc.title} — ${SITE_NAME}`
  const siblingLinks = siblings
    .filter((sibling) => sibling.slug !== doc.slug)
    .map((sibling) => `<a href="/research/${escapeHtml(sibling.slug)}">${escapeHtml(sibling.title)}</a>`)
    .join('\n')
  const navigation = [
    '<a href="/research">Research reports</a>',
    siblingLinks,
  ].filter(Boolean).join('\n')

  return `<!doctype html>
<html lang="en">
${buildHead({ title, description: buildDocDescription(doc), canonical, styles, openGraphType: 'article', ogTitle })}
<body>
<header><a href="/">← ${SITE_NAME}</a></header>
<main>
<h1>${escapeHtml(doc.title)}</h1>
${buildMetaLine(doc.meta, ['status', 'date', 'author'])}
<nav aria-label="Research reports">
${navigation}
</nav>
<article class="markdown-body">${fragment}</article>
</main>
</body>
</html>
`
}

export function buildHubPage({ docs, styles, origin }) {
  const entries = docs.map((doc) => `<li>
<a href="/research/${escapeHtml(doc.slug)}">${escapeHtml(doc.title)}</a>
${buildMetaLine(doc.meta, ['status', 'date'])}
</li>`).join('\n')

  return `<!doctype html>
<html lang="en">
${buildHead({
    title: `Research reports — ${SITE_NAME}`,
    description: HUB_DESCRIPTION,
    canonical: `${origin}/research`,
    styles,
    openGraphType: 'website',
  })}
<body>
<header><a href="/">← ${SITE_NAME}</a></header>
<main>
<h1>Research reports</h1>
<ul>
${entries}
</ul>
</main>
</body>
</html>
`
}

export function buildSitemapXml(entries, origin) {
  const baseOrigin = origin.replace(/\/+$/, '')
  const urls = entries.map(({ loc }) => {
    const absoluteLoc = /^https?:\/\//i.test(loc)
      ? loc
      : `${baseOrigin}${loc.startsWith('/') ? loc : `/${loc}`}`
    return `  <url>\n    <loc>${escapeHtml(absoluteLoc)}</loc>\n  </url>`
  }).join('\n')

  return `<?xml version="1.0" encoding="UTF-8"?>
<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">
${urls}
</urlset>
`
}

export function buildSitemapEntries(index, origin) {
  const baseOrigin = origin.replace(/\/+$/, '')
  const docs = index.groups.flatMap((group) => group.docs)
  return [
    { loc: `${baseOrigin}/` },
    { loc: `${baseOrigin}/research` },
    ...docs.map((doc) => ({ loc: `${baseOrigin}/research/${doc.slug}` })),
  ]
}

function readRequiredFile(filePath, label) {
  try {
    return readFileSync(filePath, 'utf8')
  } catch (error) {
    if (error.code === 'ENOENT') throw new Error(`missing ${label}: ${filePath}`, { cause: error })
    throw error
  }
}

function assertInside(baseDir, targetPath, label) {
  const relativePath = relative(baseDir, targetPath)
  if (!relativePath || relativePath === '..' || relativePath.startsWith(`..${sep}`) || isAbsolute(relativePath)) {
    throw new Error(`${label} escapes ${baseDir}`)
  }
}

export function validateResearchDocs(docs, researchOutputDir) {
  const seenSlugs = new Set()

  return docs.map((doc) => {
    const slug = doc?.slug
    if (typeof slug !== 'string') {
      throw new Error(`invalid research slug ${JSON.stringify(slug)}: expected a lowercase hyphenated slug`)
    }

    const flatPath = resolve(researchOutputDir, `${slug}.html`)
    const directoryIndexPath = resolve(researchOutputDir, slug, 'index.html')
    assertInside(researchOutputDir, flatPath, `research output path for slug ${JSON.stringify(slug)}`)
    assertInside(researchOutputDir, directoryIndexPath, `research output path for slug ${JSON.stringify(slug)}`)

    if (!/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(slug)) {
      throw new Error(`invalid research slug ${JSON.stringify(slug)}: expected ^[a-z0-9]+(?:-[a-z0-9]+)*$`)
    }
    if (slug === 'index') throw new Error(`reserved research slug ${JSON.stringify(slug)}`)
    if (seenSlugs.has(slug)) throw new Error(`duplicate research slug ${JSON.stringify(slug)}`)
    if (typeof doc.title !== 'string') throw new Error(`research document ${JSON.stringify(slug)} is missing its title`)

    seenSlugs.add(slug)
    return { doc, flatPath, directoryIndexPath }
  })
}

function writePage(filePath, html) {
  mkdirSync(dirname(filePath), { recursive: true })
  writeFileSync(filePath, html, 'utf8')
}

export async function run({ webRoot = WEB_ROOT } = {}) {
  const publicDataDir = join(webRoot, 'public', 'data')
  const dataDir = join(publicDataDir, 'research')
  const distDir = join(webRoot, 'dist')
  const indexHtmlPath = join(distDir, 'index.html')
  const styles = pickStylesheets(readRequiredFile(indexHtmlPath, 'Vite entry HTML'))
  if (styles.length === 0) throw new Error(`no stylesheet links found in ${indexHtmlPath}`)

  const indexPath = join(dataDir, 'index.json')
  const indexContents = readRequiredFile(indexPath, 'research index')
  let index
  try {
    index = JSON.parse(indexContents)
  } catch (error) {
    throw new Error(`invalid research index ${indexPath}: ${error.message}`, { cause: error })
  }
  if (!Array.isArray(index?.groups)) throw new Error(`invalid research index ${indexPath}: groups must be an array`)

  const docs = index.groups.flatMap((group, groupIndex) => {
    if (!group || !Array.isArray(group.docs)) {
      throw new Error(`invalid research index ${indexPath}: groups[${groupIndex}].docs must be an array`)
    }
    return group.docs
  })
  const researchOutputDir = join(distDir, 'research')
  const validatedDocs = validateResearchDocs(docs, researchOutputDir)
  const siblings = validatedDocs.map(({ doc }) => ({ slug: doc.slug, title: doc.title }))
  const fragments = validatedDocs.map((validatedDoc) => {
    const { doc } = validatedDoc
    if (typeof doc.html !== 'string') {
      throw new Error(`research document ${doc.slug} is missing its html path`)
    }
    const fragmentPath = resolve(join(publicDataDir, doc.html))
    assertInside(dataDir, fragmentPath, `research fragment path ${doc.html}`)
    return { ...validatedDoc, fragment: readRequiredFile(fragmentPath, `research fragment ${doc.html}`) }
  })

  const hub = buildHubPage({ docs, styles, origin: ORIGIN })
  const pages = fragments.map(({ doc, fragment, ...outputPaths }) => ({
    ...outputPaths,
    html: buildDocPage({ doc, siblings, fragment, styles, origin: ORIGIN }),
  }))
  const sitemap = buildSitemapXml(buildSitemapEntries(index, ORIGIN), ORIGIN)
  const outputs = [
    { path: join(distDir, 'research.html'), html: hub },
    { path: join(researchOutputDir, 'index.html'), html: hub },
    ...pages.flatMap(({ flatPath, directoryIndexPath, html }) => [
      { path: flatPath, html },
      { path: directoryIndexPath, html },
    ]),
    { path: join(distDir, 'sitemap.xml'), html: sitemap },
  ]
  for (const output of outputs) {
    writePage(output.path, output.html)
  }
  console.log(`static research pages: ${docs.length} documents, hub, sitemap`)
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? '').href) await run()
