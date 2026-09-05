import { execSync } from 'node:child_process'
import { copyFileSync, mkdirSync, readdirSync, rmSync, statSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const webRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const processed = resolve(webRoot, '..', 'data', 'processed')
const target = join(webRoot, 'public', 'data')

rmSync(target, { recursive: true, force: true })
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
    execSync('git check-ignore public/data >nul 2>&1', { cwd: webRoot, stdio: 'pipe' })
  } catch {
    console.warn('! public/data не в .gitignore — добавь его, чтобы не коммитить дубликат')
  }
}