import { createHash } from 'node:crypto'
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { afterEach, describe, expect, it, vi } from 'vitest'

const temporaryRoots: string[] = []

interface ReleaseCheckResult {
  tarballPath: string
  integrity: string
  packageName: string
  packageVersion: string
}

interface ReleaseModule {
  parseReleaseCheckOutput: (output: string) => ReleaseCheckResult
  runRelease: (options?: {
    runNpm?: (args: string[], options?: { cwd?: string; captureStdout?: boolean; stdio?: string }) => Promise<{ stdout: string }>
    confirm?: (details: ReleaseCheckResult) => Promise<string>
    confirmLogin?: () => Promise<boolean>
  }) => Promise<{ published: boolean }>
}

afterEach(async () => {
  await Promise.all(temporaryRoots.splice(0).map((root) => rm(root, { recursive: true, force: true })))
})

function isReleaseModule(value: unknown): value is ReleaseModule {
  return (
    typeof value === 'object' &&
    value !== null &&
    'parseReleaseCheckOutput' in value &&
    typeof value.parseReleaseCheckOutput === 'function' &&
    'runRelease' in value &&
    typeof value.runRelease === 'function'
  )
}

async function loadReleaseModule(): Promise<ReleaseModule | null> {
  try {
    const value: unknown = await import('../scripts/release.mjs')
    return isReleaseModule(value) ? value : null
  } catch {
    return null
  }
}

async function createCheckedTarball() {
  const root = await mkdtemp(join(tmpdir(), 'archive release тест-'))
  temporaryRoots.push(root)
  const tarballPath = join(root, 'archive-mcp-0.1.2.tgz')
  const contents = Buffer.from('verified package bytes')
  await writeFile(tarballPath, contents)

  return {
    tarballPath,
    integrity: `sha512-${createHash('sha512').update(contents).digest('base64')}`,
  }
}

function checkOutput(tarballPath: string, integrity: string) {
  return [
    `TARBALL_PATH=${tarballPath}`,
    `INTEGRITY=${integrity}`,
    'PACKAGE_NAME=@catgirl3d/agent-collusion-archive-mcp',
    'PACKAGE_VERSION=0.1.2',
  ].join('\r\n')
}

describe('MCP interactive release', () => {
  it('parses one complete release-check result with spaces and Unicode in its path', async () => {
    const release = await loadReleaseModule()
    expect(release?.parseReleaseCheckOutput).toBeTypeOf('function')
    if (!release) return

    const tarball = await createCheckedTarball()
    expect(release.parseReleaseCheckOutput(checkOutput(tarball.tarballPath, tarball.integrity))).toEqual({
      tarballPath: tarball.tarballPath,
      integrity: tarball.integrity,
      packageName: '@catgirl3d/agent-collusion-archive-mcp',
      packageVersion: '0.1.2',
    })
  })

  it('rejects ambiguous duplicate release-check markers', async () => {
    const release = await loadReleaseModule()
    expect(release?.parseReleaseCheckOutput).toBeTypeOf('function')
    if (!release) return

    const tarball = await createCheckedTarball()
    expect(() =>
      release.parseReleaseCheckOutput(
        `${checkOutput(tarball.tarballPath, tarball.integrity)}\nTARBALL_PATH=${tarball.tarballPath}`,
      ),
    ).toThrow(/exactly one.*TARBALL_PATH/)
  })

  it('runs checks, requires the exact release confirmation, and publishes the verified snapshot', async () => {
    const release = await loadReleaseModule()
    expect(release?.runRelease).toBeTypeOf('function')
    if (!release) return

    const tarball = await createCheckedTarball()
    const order: string[] = []
    const runNpm = vi.fn(async (args: string[], options?: { stdio?: string; captureStdout?: boolean; cwd?: string }) => {
      if (args[0] === 'run') {
        order.push('check')
        return { stdout: checkOutput(tarball.tarballPath, tarball.integrity) }
      }
      if (args[0] === 'whoami') {
        order.push('auth')
        return { stdout: 'catgirl3d\n' }
      }
      order.push('publish')
      expect(options?.stdio).toBe('inherit')
      expect(args).toEqual([
        'publish',
        expect.stringMatching(/archive-mcp-0\.1\.2\.tgz$/),
        '--access',
        'public',
        '--tag',
        'latest',
        '--registry',
        'https://registry.npmjs.org',
      ])
      expect(await readFile(args[1])).toEqual(await readFile(tarball.tarballPath))
      return { stdout: '' }
    })
    const confirm = vi.fn(async ({ packageName, packageVersion }: { packageName: string; packageVersion: string }) => {
      order.push('confirm')
      return `publish ${packageName}@${packageVersion}`
    })

    await expect(release.runRelease({ runNpm, confirm })).resolves.toEqual({ published: true })
    expect(order).toEqual(['check', 'auth', 'confirm', 'publish'])
    expect(runNpm.mock.calls[0][0]).toEqual(['run', 'release:check'])
  })

  it('offers npm login when the session is missing and publishes only after a successful login', async () => {
    const release = await loadReleaseModule()
    expect(release?.runRelease).toBeTypeOf('function')
    if (!release) return

    const tarball = await createCheckedTarball()
    const order: string[] = []
    const runNpm = vi.fn(async (args: string[]) => {
      if (args[0] === 'run') {
        order.push('check')
        return { stdout: checkOutput(tarball.tarballPath, tarball.integrity) }
      }
      if (args[0] === 'whoami') {
        order.push('whoami')
        if (order.filter((entry) => entry === 'whoami').length === 1) throw new Error('npm whoami failed with exit code 1')
        return { stdout: 'catgirl3d\n' }
      }
      if (args[0] === 'login') {
        order.push('login')
        return { stdout: '' }
      }
      order.push('publish')
      return { stdout: '' }
    })
    const confirmLogin = vi.fn(async () => {
      order.push('confirmLogin')
      return true
    })
    const confirm = vi.fn(async ({ packageName, packageVersion }: { packageName: string; packageVersion: string }) => {
      order.push('confirm')
      return `publish ${packageName}@${packageVersion}`
    })

    await expect(release.runRelease({ runNpm, confirm, confirmLogin })).resolves.toEqual({ published: true })
    expect(order).toEqual(['check', 'whoami', 'confirmLogin', 'login', 'whoami', 'confirm', 'publish'])
    expect(runNpm.mock.calls.map(([args]) => args[0])).toEqual(['run', 'whoami', 'login', 'whoami', 'publish'])
  })

  it('does not publish when npm login is declined', async () => {
    const release = await loadReleaseModule()
    expect(release?.runRelease).toBeTypeOf('function')
    if (!release) return

    const tarball = await createCheckedTarball()
    const runNpm = vi.fn(async (args: string[]) => {
      if (args[0] === 'run') return { stdout: checkOutput(tarball.tarballPath, tarball.integrity) }
      throw new Error('npm whoami failed with exit code 1')
    })
    const confirmLogin = vi.fn(async () => false)
    const confirm = vi.fn()

    await expect(release.runRelease({ runNpm, confirm, confirmLogin })).resolves.toEqual({ published: false })
    expect(runNpm.mock.calls.map(([args]) => args[0])).toEqual(['run', 'whoami'])
    expect(confirm).not.toHaveBeenCalled()
  })

  it('does not publish when npm login does not restore the session', async () => {
    const release = await loadReleaseModule()
    expect(release?.runRelease).toBeTypeOf('function')
    if (!release) return

    const tarball = await createCheckedTarball()
    const runNpm = vi.fn(async (args: string[]) => {
      if (args[0] === 'run') return { stdout: checkOutput(tarball.tarballPath, tarball.integrity) }
      if (args[0] === 'login') return { stdout: '' }
      throw new Error('npm whoami failed with exit code 1')
    })
    const confirmLogin = vi.fn(async () => true)
    const confirm = vi.fn()

    await expect(release.runRelease({ runNpm, confirm, confirmLogin })).rejects.toThrow(/authentication/)
    expect(runNpm.mock.calls.map(([args]) => args[0])).toEqual(['run', 'whoami', 'login', 'whoami'])
    expect(confirm).not.toHaveBeenCalled()
  })

  it('does not publish when confirmation is declined', async () => {
    const release = await loadReleaseModule()
    expect(release?.runRelease).toBeTypeOf('function')
    if (!release) return

    const tarball = await createCheckedTarball()
    const runNpm = vi.fn(async () => ({ stdout: checkOutput(tarball.tarballPath, tarball.integrity) }))
    const confirm = vi.fn(async () => 'cancel')

    await expect(release.runRelease({ runNpm, confirm })).resolves.toEqual({ published: false })
    expect(runNpm).toHaveBeenCalledTimes(2)
  })

  it('does not publish if the checked artifact changes before publication', async () => {
    const release = await loadReleaseModule()
    expect(release?.runRelease).toBeTypeOf('function')
    if (!release) return

    const tarball = await createCheckedTarball()
    const runNpm = vi.fn(async () => ({ stdout: checkOutput(tarball.tarballPath, tarball.integrity) }))
    const confirm = vi.fn(async ({ tarballPath }: { tarballPath: string }) => {
      await writeFile(tarballPath, 'changed after release check')
      return 'publish @catgirl3d/agent-collusion-archive-mcp@0.1.2'
    })

    await expect(release.runRelease({ runNpm, confirm })).rejects.toThrow(/integrity/)
    expect(runNpm).toHaveBeenCalledTimes(2)
  })

  it('does not ask for confirmation or publish after the release check fails', async () => {
    const release = await loadReleaseModule()
    expect(release?.runRelease).toBeTypeOf('function')
    if (!release) return

    const runNpm = vi.fn(async () => {
      throw new Error('release check failed')
    })
    const confirm = vi.fn()

    await expect(release.runRelease({ runNpm, confirm })).rejects.toThrow('release check failed')
    expect(confirm).not.toHaveBeenCalled()
    expect(runNpm).toHaveBeenCalledTimes(1)
  })

  it('preserves the exact publish snapshot when npm publish fails', async () => {
    const release = await loadReleaseModule()
    expect(release?.runRelease).toBeTypeOf('function')
    if (!release) return

    const tarball = await createCheckedTarball()
    let failedPublishPath = ''
    const runNpm = vi.fn(async (args: string[]) => {
      if (args[0] === 'run') return { stdout: checkOutput(tarball.tarballPath, tarball.integrity) }
      if (args[0] === 'whoami') return { stdout: 'catgirl3d\n' }
      failedPublishPath = args[1]
      throw new Error('npm publish failed')
    })
    const confirm = vi.fn(async ({ packageName, packageVersion }: { packageName: string; packageVersion: string }) =>
      `publish ${packageName}@${packageVersion}`,
    )

    let publishError: unknown
    try {
      await release.runRelease({ runNpm, confirm })
    } catch (error) {
      publishError = error
    }
    expect(publishError).toMatchObject({ message: 'npm publish failed' })
    temporaryRoots.push(dirname(failedPublishPath))
    await expect(readFile(failedPublishPath)).resolves.toEqual(await readFile(tarball.tarballPath))
  })
})
