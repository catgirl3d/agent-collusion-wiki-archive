import { execFileSync } from 'node:child_process'
import { createHash } from 'node:crypto'
import { copyFileSync, mkdirSync, readFileSync, readdirSync, rmSync, statSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const webRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const processed = resolve(webRoot, '..', 'data', 'processed')
const rawCorpus = resolve(webRoot, '..', 'data', 'raw', 'revisions.jsonl.gz')
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

function publishCorpus() {
  const summary = JSON.parse(readFileSync(join(processed, 'summary.json'), 'utf8'))
  const corpus = summary?.corpus
  if (!corpus || typeof corpus.sha256 !== 'string') {
    throw new Error('summary.json has no corpus metadata; run `python data/scripts/build.py`')
  }

  let bytes
  try {
    bytes = readFileSync(rawCorpus)
  } catch {
    throw new Error(`missing corpus source ${rawCorpus}; run \`python data/scripts/build.py\``)
  }

  const revisionMismatch = corpus.revisions !== summary?.counts?.revisions
  if (sha256(bytes) !== corpus.sha256 || bytes.length !== corpus.compressed_bytes || revisionMismatch) {
    throw new Error('corpus source and processed summary are out of sync; run `python data/scripts/build.py`')
  }

  const corpusDir = join(target, 'corpus')
  mkdirSync(corpusDir, { recursive: true })
  copyFileSync(rawCorpus, join(corpusDir, 'revisions.jsonl.gz'))
  return bytes.length
}

function main() {
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
  console.log(`synced ${processed} -> ${target} (+ corpus/revisions.jsonl.gz, ${corpusBytes} bytes)`)

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
