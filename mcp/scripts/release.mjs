import { createHash } from 'node:crypto'
import { spawn } from 'node:child_process'
import { copyFile, mkdtemp, readFile, rm, stat } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { basename, dirname, isAbsolute, join, resolve } from 'node:path'
import { createInterface } from 'node:readline/promises'
import { fileURLToPath } from 'node:url'

const packageRoot = dirname(dirname(fileURLToPath(import.meta.url)))
const packageName = '@catgirl3d/agent-collusion-archive-mcp'
const registry = 'https://registry.npmjs.org'

function readSingleMarker(lines, key) {
  const prefix = `${key}=`
  const values = lines.filter((line) => line.startsWith(prefix)).map((line) => line.slice(prefix.length))
  if (values.length !== 1 || values[0].length === 0) {
    throw new Error(`release:check must print exactly one non-empty ${key} marker`)
  }
  return values[0]
}

export function parseReleaseCheckOutput(output) {
  const lines = output.split('\n').map((line) => line.endsWith('\r') ? line.slice(0, -1) : line)
  const tarballPath = readSingleMarker(lines, 'TARBALL_PATH')
  const integrity = readSingleMarker(lines, 'INTEGRITY')
  const reportedPackageName = readSingleMarker(lines, 'PACKAGE_NAME')
  const packageVersion = readSingleMarker(lines, 'PACKAGE_VERSION')

  if (!isAbsolute(tarballPath)) throw new Error('release:check must print an absolute TARBALL_PATH')
  if (reportedPackageName !== packageName) throw new Error(`unexpected package name in release result: ${reportedPackageName}`)
  if (!/^sha512-[A-Za-z0-9+/]+={0,2}$/.test(integrity)) throw new Error('release:check printed an invalid SHA-512 integrity value')

  return { tarballPath, integrity, packageName: reportedPackageName, packageVersion }
}

function npmInvocation(args) {
  const npmExecPath = process.env.npm_execpath
  if (!npmExecPath) throw new Error('npm_execpath is unavailable; start the release with `npm run release`')
  return { command: process.execPath, args: [npmExecPath, ...args] }
}

function runNpm(args, { cwd = packageRoot, captureStdout = false, stdio = 'inherit' } = {}) {
  const invocation = npmInvocation(args)
  return new Promise((resolveCommand, rejectCommand) => {
    const child = spawn(invocation.command, invocation.args, {
      cwd,
      shell: false,
      windowsHide: true,
      stdio: captureStdout ? ['inherit', 'pipe', 'inherit'] : stdio,
    })
    let stdout = ''
    let settled = false

    child.stdout?.setEncoding('utf8')
    child.stdout?.on('data', (chunk) => {
      stdout += chunk
      process.stdout.write(chunk)
    })
    child.once('error', (error) => {
      if (settled) return
      settled = true
      rejectCommand(new Error(`npm ${args.join(' ')} could not start: ${error.message}`))
    })
    child.once('close', (code, signal) => {
      if (settled) return
      settled = true
      if (code !== 0) {
        rejectCommand(new Error(`npm ${args.join(' ')} failed with ${signal ? `signal ${signal}` : `exit code ${code}`}`))
        return
      }
      resolveCommand({ stdout })
    })
  })
}

async function assertIntegrity(path, expectedIntegrity) {
  const contents = await readFile(path)
  const actualIntegrity = `sha512-${createHash('sha512').update(contents).digest('base64')}`
  if (actualIntegrity !== expectedIntegrity) throw new Error(`verified tarball integrity changed: ${path}`)
}

async function ask(prompt) {
  const readline = createInterface({ input: process.stdin, output: process.stdout })
  try {
    return (await readline.question(prompt)).trim()
  } finally {
    readline.close()
  }
}

async function confirmPublication(details) {
  process.stdout.write([
    '',
    `Package:  ${details.packageName}@${details.packageVersion}`,
    `Tarball:  ${details.tarballPath}`,
    `Registry: ${registry}`,
    'Access:   public',
    'Tag:      latest',
    `SHA-512:  ${details.integrity}`,
    '',
  ].join('\n'))

  return ask(`Type "publish ${details.packageName}@${details.packageVersion}" to continue: `)
}

async function confirmLogin() {
  const answer = (await ask('Not signed in to npm. Run `npm login --auth-type=web` now? [y/N] ')).toLowerCase()
  return answer === 'y' || answer === 'yes'
}

async function ensureNpmAuthentication(run, confirmLoginPrompt) {
  try {
    await run(['whoami'], { cwd: packageRoot, captureStdout: true })
    return true
  } catch {
    // Fall through to the login prompt.
  }

  if (!(await confirmLoginPrompt())) return false

  await run(['login', '--auth-type=web'], { cwd: packageRoot, stdio: 'inherit' })
  try {
    await run(['whoami'], { cwd: packageRoot, captureStdout: true })
  } catch {
    throw new Error('npm authentication is still unavailable after login; no package was published')
  }
  return true
}

export async function runRelease({ runNpm: run = runNpm, confirm = confirmPublication, confirmLogin: confirmLoginPrompt = confirmLogin } = {}) {
  const check = await run(['run', 'release:check'], { cwd: packageRoot, captureStdout: true })
  const checked = parseReleaseCheckOutput(check.stdout)
  const metadata = await stat(checked.tarballPath)
  if (!metadata.isFile() || !checked.tarballPath.endsWith('.tgz')) {
    throw new Error('release:check TARBALL_PATH must point to a .tgz file')
  }

  const snapshotDirectory = await mkdtemp(join(tmpdir(), 'archive-mcp-release-'))
  const snapshotPath = join(snapshotDirectory, basename(checked.tarballPath))
  let preserveSnapshot = false
  try {
    await copyFile(checked.tarballPath, snapshotPath)
    await assertIntegrity(snapshotPath, checked.integrity)

    if (!(await ensureNpmAuthentication(run, confirmLoginPrompt))) {
      return { published: false }
    }

    const publication = { ...checked, tarballPath: snapshotPath }
    const answer = await confirm(publication)
    if (answer !== `publish ${checked.packageName}@${checked.packageVersion}`) {
      return { published: false }
    }

    await assertIntegrity(snapshotPath, checked.integrity)
    try {
      await run(
        [
          'publish',
          snapshotPath,
          '--access',
          'public',
          '--tag',
          'latest',
          '--registry',
          registry,
        ],
        { cwd: packageRoot, stdio: 'inherit' },
      )
    } catch (error) {
      preserveSnapshot = true
      process.stderr.write(`Verified tarball retained at: ${snapshotPath}\n`)
      throw error
    }
    return { published: true }
  } finally {
    if (!preserveSnapshot) await rm(snapshotDirectory, { recursive: true, force: true })
  }
}

async function main() {
  if (!process.stdin.isTTY || !process.stdout.isTTY) {
    throw new Error('MCP release requires an interactive terminal for confirmation and npm authentication')
  }

  const result = await runRelease()
  if (!result.published) process.stdout.write('\nMCP release cancelled; no package was published.\n')
}

if (process.argv[1] && fileURLToPath(import.meta.url) === resolve(process.argv[1])) {
  main().catch((error) => {
    console.error(`MCP release failed: ${error instanceof Error ? error.message : String(error)}`)
    process.exitCode = 1
  })
}
