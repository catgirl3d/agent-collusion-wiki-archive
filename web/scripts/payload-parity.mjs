#!/usr/bin/env node
// Cross-language payload parity: Python canonical verdicts vs the web detector over
// every revision body in data/raw. Differences must fall into the divergence classes
// documented in data/validation/payload_flags_golden.json::_meta.known_divergences, and
// the whole-corpus class set is pinned by data/validation/payload_parity_baseline.json
// (counts + body digests per class), so any change to the divergence set fails here.
//
// Run:      npm --prefix web run payload:parity
// Refresh:  npm --prefix web run payload:parity -- --write-baseline
import { execFileSync } from 'node:child_process'
import { createHash } from 'node:crypto'
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

import { detectPayloadFlags } from '../src/utils/payload.ts'
import { classifyPayloadDivergence } from '../src/test/payloadParity.ts'

const here = dirname(fileURLToPath(import.meta.url))
const repoRoot = resolve(here, '..', '..')
const baselinePath = join(repoRoot, 'data', 'validation', 'payload_parity_baseline.json')
const writeBaseline = process.argv.includes('--write-baseline')
const workDir = mkdtempSync(join(tmpdir(), 'payload-parity-'))
const exportPath = join(workDir, 'py_flags.ndjson')

function sha256(value) {
  return createHash('sha256').update(value, 'utf8').digest('hex')
}

try {
  const exporterOutput = execFileSync(
    process.env.PYTHON ?? 'python',
    [join(repoRoot, 'data', 'scripts', 'export_payload_flags.py'), exportPath],
    { encoding: 'utf8' },
  )
  const exported = Number.parseInt(/exported (\d+)/.exec(exporterOutput)?.[1] ?? '', 10)
  if (!Number.isFinite(exported) || exported <= 0) {
    throw new Error(`exporter reported no bodies: ${exporterOutput.trim()}`)
  }

  const lines = readFileSync(exportPath, 'utf8').split('\n').filter(Boolean)
  if (lines.length !== exported) {
    throw new Error(`exporter reported ${exported} bodies but the NDJSON holds ${lines.length} lines`)
  }

  const counts = new Map()
  const digests = new Map()
  const unexpected = new Map()
  let unexpectedCount = 0

  for (const line of lines) {
    const row = JSON.parse(line)
    const webFlags = detectPayloadFlags(row.body)
    const kind = classifyPayloadDivergence(row.body, row.flags, webFlags)
    counts.set(kind, (counts.get(kind) ?? 0) + 1)
    if (!digests.has(kind)) digests.set(kind, [])
    digests.get(kind).push(sha256(row.body))
    if (kind === 'unexpected') {
      unexpectedCount += 1
      const signature = `python-only:${row.flags.filter((flag) => !webFlags.includes(flag)).sort().join(',') || '-'} web-only:${webFlags.filter((flag) => !row.flags.includes(flag)).sort().join(',') || '-'}`
      const entry = unexpected.get(signature) ?? { count: 0, examples: [] }
      entry.count += 1
      if (entry.examples.length < 3) {
        entry.examples.push({
          page_id: row.page_id,
          seq: row.seq,
          python: row.flags,
          web: webFlags,
          snippet: row.body.slice(0, 160),
        })
      }
      unexpected.set(signature, entry)
    }
  }

  const summary = {
    total_bodies: lines.length,
    classes: Object.fromEntries(
      [...counts.entries()].sort().map(([kind, count]) => [
        kind,
        { count, digest: sha256(digests.get(kind).sort().join('\n')) },
      ]),
    ),
  }

  console.log(`payload parity over ${summary.total_bodies} bodies`)
  for (const [kind, value] of Object.entries(summary.classes)) console.log(`  ${kind}: ${value.count}`)

  if (unexpectedCount > 0) {
    console.error(`unexpected divergences: ${unexpectedCount}`)
    for (const [signature, entry] of unexpected) {
      console.error(`  ${signature} (${entry.count})`)
      for (const example of entry.examples) console.error('   ', JSON.stringify(example))
    }
    process.exitCode = 1
  } else if (writeBaseline) {
    writeFileSync(
      baselinePath,
      JSON.stringify(
        {
          _meta: {
            command: 'npm --prefix web run payload:parity',
            regenerate: 'npm --prefix web run payload:parity -- --write-baseline',
            source: 'data/raw/revisions.jsonl.gz',
            note: 'Per-class body digests pin the whole-corpus divergence set; regenerate only for intentional corpus or documented-divergence changes.',
          },
          ...summary,
        },
        null,
        2,
      ) + '\n',
      'utf8',
    )
    console.log(`wrote ${baselinePath}`)
  } else if (!existsSync(baselinePath)) {
    console.error(`missing baseline ${baselinePath}; run: npm --prefix web run payload:parity -- --write-baseline`)
    process.exitCode = 1
  } else {
    const baseline = JSON.parse(readFileSync(baselinePath, 'utf8'))
    const problems = []
    if (baseline.total_bodies !== summary.total_bodies) {
      problems.push(`total bodies ${baseline.total_bodies} -> ${summary.total_bodies}`)
    }
    for (const kind of new Set([...Object.keys(baseline.classes ?? {}), ...Object.keys(summary.classes)])) {
      const before = baseline.classes?.[kind]
      const after = summary.classes[kind]
      if (!before || !after) {
        problems.push(`class ${kind} ${before ? 'disappeared' : 'appeared'}`)
        continue
      }
      if (before.count !== after.count) problems.push(`class ${kind} count ${before.count} -> ${after.count}`)
      if (before.digest !== after.digest) problems.push(`class ${kind} digest changed`)
    }
    if (problems.length) {
      console.error('parity baseline mismatch:')
      for (const problem of problems) console.error(`  ${problem}`)
      process.exitCode = 1
    }
  }
} finally {
  rmSync(workDir, { recursive: true, force: true })
}