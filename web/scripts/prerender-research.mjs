import { mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { dirname, isAbsolute, join, relative, resolve, sep } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'

const WEB_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const ORIGIN = 'https://agent-collusion.uk'
const SITE_NAME = 'Agent Wiki Archive'
const HUB_DESCRIPTION = 'Research reports on autonomous AI agent activity across public wikis.'
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

function buildHead({ title, description, canonical, styles, article = false }) {
  const safeTitle = escapeHtml(title)
  const safeDescription = escapeWithinLimit(description, 300)
  const openGraph = article
    ? `
<meta property="og:type" content="article" />
<meta property="og:site_name" content="${SITE_NAME}" />
<meta property="og:title" content="${safeTitle}" />
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

export function buildDocPage({ doc, siblings, fragment, styles, origin }) {
  const canonical = `${origin}/research/${doc.slug}`
  const title = `${doc.title} — ${SITE_NAME}`
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
${buildHead({ title, description: buildDocDescription(doc), canonical, styles, article: true })}
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
  const urls = entries.map(({ loc, lastmod }) => {
    const absoluteLoc = /^https?:\/\//i.test(loc)
      ? loc
      : `${baseOrigin}${loc.startsWith('/') ? loc : `/${loc}`}`
    const lastmodElement = lastmod ? `\n    <lastmod>${escapeHtml(lastmod)}</lastmod>` : ''
    return `  <url>\n    <loc>${escapeHtml(absoluteLoc)}</loc>${lastmodElement}\n  </url>`
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
    ...docs.map((doc) => ({
      loc: `${baseOrigin}/research/${doc.slug}`,
      ...(doc.meta?.date ? { lastmod: doc.meta.date } : {}),
    })),
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

function assertInside(baseDir, targetPath, sourcePath) {
  const relativePath = relative(baseDir, targetPath)
  if (!relativePath || relativePath === '..' || relativePath.startsWith(`..${sep}`) || isAbsolute(relativePath)) {
    throw new Error(`research fragment path escapes ${baseDir}: ${sourcePath}`)
  }
}

function writePage(filePath, html) {
  mkdirSync(dirname(filePath), { recursive: true })
  writeFileSync(filePath, html, 'utf8')
}

export async function run() {
  const publicDataDir = join(WEB_ROOT, 'public', 'data')
  const dataDir = join(publicDataDir, 'research')
  const distDir = join(WEB_ROOT, 'dist')
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
    if (!Array.isArray(group.docs)) {
      throw new Error(`invalid research index ${indexPath}: groups[${groupIndex}].docs must be an array`)
    }
    return group.docs
  })
  const siblings = docs.map(({ slug, title }) => ({ slug, title }))
  const researchOutputDir = join(distDir, 'research')
  const hub = buildHubPage({ docs, styles, origin: ORIGIN })
  writePage(join(distDir, 'research.html'), hub)
  writePage(join(researchOutputDir, 'index.html'), hub)

  for (const doc of docs) {
    if (typeof doc.html !== 'string') {
      throw new Error(`research document ${doc.slug} is missing its html path`)
    }
    const fragmentPath = resolve(join(publicDataDir, doc.html))
    assertInside(dataDir, fragmentPath, doc.html)
    const fragment = readRequiredFile(fragmentPath, `research fragment ${doc.html}`)
    const page = buildDocPage({ doc, siblings, fragment, styles, origin: ORIGIN })
    writePage(join(researchOutputDir, `${doc.slug}.html`), page)
    writePage(join(researchOutputDir, doc.slug, 'index.html'), page)
  }

  const sitemap = buildSitemapXml(buildSitemapEntries(index, ORIGIN), ORIGIN)
  writeFileSync(join(distDir, 'sitemap.xml'), sitemap, 'utf8')
  console.log(`static research pages: ${docs.length} documents, hub, sitemap`)
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? '').href) await run()
