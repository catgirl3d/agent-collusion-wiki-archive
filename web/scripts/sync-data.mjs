import { execFileSync } from 'node:child_process'
import { createHash } from 'node:crypto'
import { copyFileSync, mkdirSync, readFileSync, readdirSync, rmSync, statSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const webRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const processed = resolve(webRoot, '..', 'data', 'processed')
const rawCorpus = resolve(webRoot, '..', 'data', 'raw', 'revisions.jsonl.gz')
const rawSupplement = resolve(webRoot, '..', 'data', 'raw', 'other-wikis.json.gz')
const target = join(webRoot, 'public', 'data')

function sha256(buffer) {
  return createHash('sha256').update(buffer).digest('hex')
}

function copyRecursive(src, dst) {
  for (const entry of readdirSync(src)) {
    const s = join(src, entry)
    const d = join(dst, entry)
    if (statSync(s).isDirectory()) copyRecursive(s, d)
    else {
      mkdirSync(dirname(d), { recursive: true })
      copyFileSync(s, d)
    }
  }
}

function readSummary() {
  return JSON.parse(readFileSync(join(processed, 'summary.json'), 'utf8'))
}

function readVerifiedSource(sourcePath, expectedSha256, expectedBytes, label) {
  let bytes
  try {
    bytes = readFileSync(sourcePath)
  } catch {
    throw new Error(`missing ${label} source ${sourcePath}; run \`python data/scripts/build.py\``)
  }
  if (sha256(bytes) !== expectedSha256 || bytes.length !== expectedBytes) {
    throw new Error(`${label} source and processed summary are out of sync; run \`python data/scripts/build.py\``)
  }
  return bytes
}

function verifyEventsHead() {
  let full
  let head
  try {
    full = JSON.parse(readFileSync(join(processed, 'recent_events.json'), 'utf8'))
    head = JSON.parse(readFileSync(join(processed, 'events_head.json'), 'utf8'))
  } catch {
    throw new Error('missing recent_events.json or events_head.json in data/processed; run `python data/scripts/build.py`')
  }
  if (!Array.isArray(full) || !Array.isArray(head) || JSON.stringify(head) !== JSON.stringify(full.slice(0, head.length))) {
    throw new Error('events_head.json is not a prefix of recent_events.json; run `python data/scripts/build.py`')
  }
  return head.length
}

function publishCorpus() {
  const summary = readSummary()
  const corpus = summary?.corpus
  if (!corpus || typeof corpus.sha256 !== 'string') {
    throw new Error('summary.json has no corpus metadata; run `python data/scripts/build.py`')
  }
  const bytes = readVerifiedSource(rawCorpus, corpus.sha256, corpus.compressed_bytes, 'corpus')
  if (corpus.revisions !== summary?.counts?.revisions) {
    throw new Error('corpus source and processed summary are out of sync; run `python data/scripts/build.py`')
  }
  const corpusDir = join(target, 'corpus')
  mkdirSync(corpusDir, { recursive: true })
  copyFileSync(rawCorpus, join(corpusDir, 'revisions.jsonl.gz'))
  return bytes.length
}

function publishSupplement() {
  const summary = readSummary()
  const supplement = summary?.supplement
  if (!supplement) return 0
  const bytes = readVerifiedSource(rawSupplement, supplement.sha256, supplement.bytes, 'supplement')
  const canonical = summary.counts?.revisions
  const recovered = supplement.counts?.revisions
  const combined = summary.combined?.revisions
  if (canonical !== undefined && recovered !== undefined && combined !== undefined && canonical + recovered !== combined) {
    throw new Error('supplement source and processed summary are out of sync; run `python data/scripts/build.py`')
  }
  copyFileSync(rawSupplement, join(target, 'other-wikis.json.gz'))
  return bytes.length
}

function main() {
  // Checked before the target is wiped: a broken artifact must fail the sync without emptying public/data.
  const headEntries = verifyEventsHead()

  try {
    rmSync(target, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 })
  } catch (e) {
    // Dev server on Windows can hold a lock on public/data; warn instead of failing silently,
    // otherwise stale files would masquerade as fresh ones.
    console.warn(`! could not clean ${target} (${e instanceof Error ? e.message : String(e)}) — stale files may remain`)
  }
  mkdirSync(target, { recursive: true })

  copyRecursive(processed, target)
  const corpusBytes = publishCorpus()
  const supplementBytes = publishSupplement()
  console.log(`synced ${processed} -> ${target} (+ corpus/revisions.jsonl.gz, ${corpusBytes} bytes${supplementBytes ? `, other-wikis.json.gz, ${supplementBytes} bytes` : ''})`)
  console.log(`verified events_head.json == recent_events.json[:${headEntries}]`)

  if (!process.env.CI) {
    try {
      execFileSync('git', ['check-ignore', 'public/data'], { cwd: webRoot, stdio: 'ignore' })
    } catch {
      console.warn('! public/data is not git-ignored — add it to avoid committing a duplicate')
    }
  }
}

try {
  main()
} catch (error) {
  console.error(error instanceof Error ? error.message : error)
  process.exit(1)
}
