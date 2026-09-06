import { execFileSync } from 'node:child_process'
import { copyFileSync, mkdirSync, readdirSync, rmSync, statSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const webRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const processed = resolve(webRoot, '..', 'data', 'processed')
const target = join(webRoot, 'public', 'data')

try {
  rmSync(target, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 })
} catch (e) {
  // Dev server on Windows can hold a lock on public/data; warn instead of failing silently,
  // otherwise stale files would masquerade as fresh ones.
  console.warn(`! could not clean ${target} (${e instanceof Error ? e.message : String(e)}) — stale files may remain`)
}
mkdirSync(target, { recursive: true })

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

copyRecursive(processed, target)
console.log(`synced ${processed} -> ${target}`)

if (!process.env.CI) {
  try {
    execFileSync('git', ['check-ignore', 'public/data'], { cwd: webRoot, stdio: 'ignore' })
  } catch {
    console.warn('! public/data is not git-ignored — add it to avoid committing a duplicate')
  }
}
