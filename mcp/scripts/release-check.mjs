import { createHash } from 'node:crypto'
import { spawn } from 'node:child_process'
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

import { Client } from '@modelcontextprotocol/client'
import { StdioClientTransport } from '@modelcontextprotocol/client/stdio'

const packageRoot = resolve(fileURLToPath(new URL('../', import.meta.url)))
const npmExecPath = process.env.npm_execpath
const requiredPackFiles = ['package.json', 'README.md', 'CHANGELOG.md', 'LICENSE', 'dist/index.js']
const handshakeTimeoutMs = 15_000

function errorMessage(error) {
  return error instanceof Error ? error.message : String(error)
}

function formatCommand(command, args) {
  return [command, ...args].map((part) => JSON.stringify(part)).join(' ')
}

function npmInvocation(args) {
  if (!npmExecPath) {
    throw new Error('npm_execpath is unavailable; run this verifier through `npm run release:check`')
  }
  return { command: process.execPath, args: [npmExecPath, ...args] }
}

function runCommand(command, args, { cwd, printOutput = false } = {}) {
  const commandText = formatCommand(command, args)

  return new Promise((resolveCommand, rejectCommand) => {
    const child = spawn(command, args, {
      cwd,
      shell: false,
      windowsHide: true,
    })
    let stdout = ''
    let stderr = ''
    let settled = false

    child.stdout?.setEncoding('utf8')
    child.stderr?.setEncoding('utf8')
    child.stdout?.on('data', (chunk) => {
      stdout += chunk
    })
    child.stderr?.on('data', (chunk) => {
      stderr += chunk
    })
    child.once('error', (error) => {
      if (settled) return
      settled = true
      rejectCommand(new Error(`${commandText} could not start: ${errorMessage(error)}`))
    })
    child.once('close', (code, signal) => {
      if (settled) return
      settled = true
      if (code !== 0) {
        const diagnostics = [
          `${commandText} failed with ${signal ? `signal ${signal}` : `exit code ${code}`}`,
          stderr.trim() ? `stderr:\n${stderr.trim()}` : '',
          stdout.trim() ? `stdout:\n${stdout.trim()}` : '',
        ].filter(Boolean)
        rejectCommand(new Error(diagnostics.join('\n')))
        return
      }
      if (printOutput) {
        if (stdout) process.stdout.write(stdout)
        if (stderr) process.stderr.write(stderr)
      }
      resolveCommand({ stdout, stderr })
    })
  })
}

function runNpm(args, options = {}) {
  const invocation = npmInvocation(args)
  return runCommand(invocation.command, invocation.args, { cwd: packageRoot, ...options })
}

function assertCondition(condition, message) {
  if (!condition) throw new Error(message)
}

function normalizePackPath(value) {
  const normalized = value.replaceAll('\\', '/').replace(/^\.\//, '')
  return normalized.startsWith('package/') ? normalized.slice('package/'.length) : normalized
}

function isForbiddenPackPath(path) {
  return (
    /^(?:src|test|node_modules|data)(?:\/|$)/.test(path) ||
    path.startsWith('web/public/data/') ||
    /(?:^|\/)(?:package-lock\.json|npm-shrinkwrap\.json|yarn\.lock|pnpm-lock\.yaml)$/.test(path)
  )
}

function isAllowedByManifest(path, manifestFiles) {
  if (path === 'package.json') return true
  return manifestFiles.some((entry) => path === entry || path.startsWith(`${entry}/`))
}

async function inspectPackResult(packResult) {
  assertCondition(Array.isArray(packResult) && packResult.length === 1, 'npm pack --json must return exactly one package result')
  const result = packResult[0]
  assertCondition(typeof result.filename === 'string', 'npm pack result is missing filename')
  assertCondition(typeof result.integrity === 'string' && result.integrity.startsWith('sha512-'), 'npm pack result is missing sha512 integrity')
  assertCondition(Array.isArray(result.files), 'npm pack result is missing its file list')

  const manifest = JSON.parse(await readFile(join(packageRoot, 'package.json'), 'utf8'))
  assertCondition(typeof manifest.name === 'string' && typeof manifest.version === 'string', 'package.json must define name and version')
  const expectedTarballName = `${manifest.name.replace(/^@/, '').replace('/', '-')}-${manifest.version}.tgz`
  assertCondition(result.filename === expectedTarballName, `unexpected tarball filename: ${result.filename}`)
  assertCondition(Array.isArray(manifest.files), 'package.json must define a files allowlist')
  const manifestFiles = manifest.files.map((entry) => normalizePackPath(String(entry)))
  const packFiles = result.files.map((entry) => normalizePackPath(String(entry.path)))
  const uniquePackFiles = new Set(packFiles)

  for (const requiredPath of requiredPackFiles) {
    assertCondition(uniquePackFiles.has(requiredPath), `tarball is missing required file: ${requiredPath}`)
  }

  const forbiddenFiles = packFiles.filter((path) => isForbiddenPackPath(path))
  assertCondition(forbiddenFiles.length === 0, `tarball contains forbidden files: ${forbiddenFiles.join(', ')}`)

  const outsideAllowlist = packFiles.filter((path) => !isAllowedByManifest(path, manifestFiles))
  assertCondition(outsideAllowlist.length === 0, `tarball contains files outside the manifest allowlist: ${outsideAllowlist.join(', ')}`)

  const entrypoint = await readFile(join(packageRoot, 'dist', 'index.js'), 'utf8')
  assertCondition(entrypoint.startsWith('#!/usr/bin/env node'), 'emitted dist/index.js must begin with the Node shebang')

  const tarballPath = join(packageRoot, result.filename)
  const tarball = await readFile(tarballPath)
  const localIntegrity = `sha512-${createHash('sha512').update(tarball).digest('base64')}`
  assertCondition(localIntegrity === result.integrity, 'local tarball integrity does not match npm pack result')

  return { tarballPath, integrity: result.integrity, files: packFiles, name: manifest.name, version: manifest.version }
}

function withoutArchiveApiUrl() {
  return Object.fromEntries(
    Object.entries(process.env).filter(([key, value]) => key !== 'ARCHIVE_API_URL' && value !== undefined),
  )
}

function withTimeout(promise, message) {
  let timer
  const timeout = new Promise((_, reject) => {
    timer = setTimeout(() => reject(new Error(message)), handshakeTimeoutMs)
    timer.unref?.()
  })
  return Promise.race([promise, timeout]).finally(() => clearTimeout(timer))
}

function assertTransportHealthy(transportError, phase) {
  if (transportError) throw new Error(`MCP transport reported an error during ${phase}: ${errorMessage(transportError)}`)
}

function handshakeFailure(error, transportError, stderr) {
  const diagnostics = [errorMessage(error)]
  if (transportError) diagnostics.push(`transport error: ${errorMessage(transportError)}`)
  if (stderr.trim()) diagnostics.push(`child stderr:\n${stderr.trim()}`)
  return new Error(`installed-bin MCP handshake failed\n${diagnostics.join('\n')}`)
}

async function verifyInstalledBinary(consumerRoot, packageName, version) {
  const installedManifestPath = join(consumerRoot, 'node_modules', ...packageName.split('/'), 'package.json')
  const installedManifest = JSON.parse(await readFile(installedManifestPath, 'utf8'))
  assertCondition(installedManifest.name === packageName, 'installed tarball package name does not match release metadata')
  assertCondition(installedManifest.version === version, 'installed tarball package version does not match release metadata')

  const client = new Client({ name: 'release-check-client', version })
  const invocation = npmInvocation(['exec', '--prefix', consumerRoot, '--', 'agent-collusion-archive-mcp'])
  const transport = new StdioClientTransport({
    command: invocation.command,
    args: invocation.args,
    cwd: consumerRoot,
    env: withoutArchiveApiUrl(),
    stderr: 'pipe',
  })
  let stderr = ''
  let transportError
  transport.stderr?.on('data', (chunk) => {
    stderr += String(chunk)
  })
  transport.onerror = (error) => {
    transportError = error
  }

  let failure
  let toolNames = []
  try {
    await withTimeout(client.connect(transport), 'MCP initialize timed out')
    assertTransportHealthy(transportError, 'initialize')
    const listed = await withTimeout(client.listTools(), 'MCP tools/list timed out')
    assertTransportHealthy(transportError, 'tools/list')
    toolNames = listed.tools.map((tool) => tool.name)
    assertCondition(toolNames.includes('get_stats'), 'installed MCP server did not advertise get_stats')
    assertCondition(toolNames.includes('search_content'), 'installed MCP server did not advertise search_content')

    const invalid = await withTimeout(
      client.callTool({ name: 'search_archive', arguments: { q: '' } }),
      'MCP search_archive validation timed out',
    )
    assertTransportHealthy(transportError, 'tools/call')
    assertCondition(invalid.isError === true, 'empty search_archive query did not return the expected tool error')
  } catch (error) {
    failure = handshakeFailure(error, transportError, stderr)
  } finally {
    try {
      await client.close()
    } catch (error) {
      if (failure) {
        process.stderr.write(`MCP client close failed after handshake failure: ${errorMessage(error)}\n`)
      } else {
        failure = new Error(`MCP client close failed: ${errorMessage(error)}`)
      }
    }
  }
  if (!failure && transportError) {
    failure = handshakeFailure(new Error('MCP transport reported an error before handshake success'), transportError, stderr)
  }

  if (failure) throw failure
  console.log(`Installed-bin MCP handshake OK: ${toolNames.length} tools; empty search_archive rejected`)
}

async function main() {
  console.log(`Package root: ${packageRoot}`)

  const testInvocation = npmInvocation(['test'])
  console.log(`$ ${formatCommand(testInvocation.command, testInvocation.args)}`)
  await runNpm(['test'], { printOutput: true })

  const typecheckInvocation = npmInvocation(['run', 'typecheck'])
  console.log(`$ ${formatCommand(typecheckInvocation.command, typecheckInvocation.args)}`)
  await runNpm(['run', 'typecheck'], { printOutput: true })

  const packInvocation = npmInvocation(['pack', '--json'])
  console.log(`$ ${formatCommand(packInvocation.command, packInvocation.args)}`)
  const packResult = await runNpm(['pack', '--json'])
  if (packResult.stderr) process.stderr.write(packResult.stderr)
  let parsedPackResult
  try {
    parsedPackResult = JSON.parse(packResult.stdout)
  } catch (error) {
    throw new Error(`npm pack --json returned invalid JSON: ${errorMessage(error)}\n${packResult.stdout}`)
  }
  const artifact = await inspectPackResult(parsedPackResult)
  console.log(`Pack inspection OK: ${artifact.files.length} files; shebang and manifest allowlist verified`)

  let consumerRoot
  let failure
  try {
    consumerRoot = await mkdtemp(join(tmpdir(), 'agent-collusion-mcp-consumer-'))
    await writeFile(
      join(consumerRoot, 'package.json'),
      `${JSON.stringify({ name: 'agent-collusion-mcp-release-check-consumer', version: '0.0.0', private: true }, null, 2)}\n`,
    )
    const installInvocation = npmInvocation(['install', '--ignore-scripts', artifact.tarballPath])
    console.log(`$ ${formatCommand(installInvocation.command, installInvocation.args)}`)
    await runCommand(installInvocation.command, installInvocation.args, {
      cwd: consumerRoot,
      printOutput: true,
    })
    await verifyInstalledBinary(consumerRoot, artifact.name, artifact.version)
  } catch (error) {
    failure = error
  } finally {
    if (consumerRoot) {
      try {
        await rm(consumerRoot, { recursive: true, force: true })
        console.log(`Removed temporary consumer project: ${consumerRoot}`)
      } catch (error) {
        const cleanupFailure = new Error(`failed to remove temporary consumer project ${consumerRoot}: ${errorMessage(error)}`)
        if (failure) {
          process.stderr.write(`${cleanupFailure.message}\n`)
        } else {
          failure = cleanupFailure
        }
      }
    }
  }
  if (failure) throw failure

  console.log(`TARBALL_PATH=${artifact.tarballPath}`)
  console.log(`INTEGRITY=${artifact.integrity}`)
  console.log(`PACKAGE_NAME=${artifact.name}`)
  console.log(`PACKAGE_VERSION=${artifact.version}`)
}

try {
  await main()
} catch (error) {
  console.error(`release:check failed: ${error instanceof Error && error.stack ? error.stack : errorMessage(error)}`)
  process.exitCode = 1
}
