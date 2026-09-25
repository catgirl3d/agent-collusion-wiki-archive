/// <reference types="node" />

import { mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, extname, join, relative, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'

const sourceDirectory = resolve(dirname(fileURLToPath(import.meta.url)), '..')

function collectCssFiles(directory: string): string[] {
  return readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const path = join(directory, entry.name)
    return entry.isDirectory()
      ? collectCssFiles(path)
      : entry.isFile() && entry.name.endsWith('.css')
        ? [path]
        : []
  })
}

const sourceExtensions = new Set(['.ts', '.tsx', '.js', '.jsx'])

function collectSourceFiles(directory: string): string[] {
  return readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const path = join(directory, entry.name)
    return entry.isDirectory()
      ? entry.name === 'node_modules'
        ? []
        : collectSourceFiles(path)
      : entry.isFile() && sourceExtensions.has(extname(entry.name)) && !/\.(?:test|spec)\./.test(entry.name)
        ? [path]
        : []
  })
}

function collectInlineRadiusViolations(directory: string): string[] {
  return collectSourceFiles(directory).flatMap((filePath) => {
    const source = readFileSync(filePath, 'utf8')
    const declarations = source.matchAll(/borderRadius\s*:\s*(?:(\d+(?:\.\d+)?)|(['"])(.*?)\2)/g)

    return Array.from(declarations, (match) => {
      const radius = [match[1], match[3]].join('').trim()
      const untokenized = radius.replace(/var\(--radius-[\w-]+\)/g, '').trim()
      const usesOnlyTokensAndZero = untokenized.split(/\s+/).filter(Boolean).every((part) => part === '0')
      if (radius.includes('var(--radius-') && usesOnlyTokensAndZero) return null

      const line = source.slice(0, match.index).split(/\r?\n/).length
      return `${relative(directory, filePath)}:${String(line)}: ${match[0].trim()}`
    }).filter((violation): violation is string => violation !== null)
  })
}

describe('shared design tokens', () => {
  it('uses radius tokens for component shapes and reserves raw values for geometry', () => {
    const violations = collectCssFiles(sourceDirectory).flatMap((filePath) => {
      const css = readFileSync(filePath, 'utf8')
      const declarations = css.matchAll(/border-radius\s*:\s*([^;]+);/g)

      return Array.from(declarations, (match) => {
        const declaration = match[0]
        const value = match[1]
        const line = css.slice(0, match.index).split(/\r?\n/).length
        if (!value) return null
        const radius = value.trim()
        const isGeometricException = ['0', '50%', 'inherit'].includes(radius)
        const untokenized = radius.replace(/var\(--radius-[\w-]+\)/g, '').trim()
        const usesOnlyTokensAndZero = untokenized.split(/\s+/).filter(Boolean).every((part) => part === '0')

        return isGeometricException || (radius.includes('var(--radius-') && usesOnlyTokensAndZero)
          ? null
          : `${relative(sourceDirectory, filePath)}:${String(line)}: ${declaration.trim()}`
      }).filter((violation): violation is string => violation !== null)
    })

    expect(violations).toEqual([])
  })

  it('uses CSS variables for inline border radii', () => {
    expect(collectInlineRadiusViolations(sourceDirectory)).toEqual([])
  })

  it('detects raw inline radii in production source files and excludes test files', () => {
    const fixtureDirectory = mkdtempSync(join(tmpdir(), 'design-tokens-'))
    const fixtures = new Map([
      ['Numeric.tsx', 'const numeric = { borderRadius: 10 }\n'],
      [
        'Quoted.tsx',
        `const single = { borderRadius: '4px' }\nconst double = { borderRadius: "4px" }\n`,
      ],
      ['TypeScript.ts', 'const typescript = { borderRadius: 5 }\n'],
      ['JavaScript.js', `const javascript = { borderRadius: '6px' }\n`],
      ['Jsx.jsx', `const jsx = { borderRadius: "7px" }\n`],
      ['SafeToken.tsx', `const token = { borderRadius: 'var(--radius-md)' }\n`],
      ['Dashboard.jsx', 'const chart = { radius: [4, 4, 0, 0] }\n'],
      ['Ignored.test.tsx', `const test = { borderRadius: '8px' }\n`],
      ['Ignored.spec.js', 'const spec = { borderRadius: 9 }\n'],
    ])

    try {
      for (const [name, content] of fixtures) {
        writeFileSync(join(fixtureDirectory, name), content)
      }

      expect(collectInlineRadiusViolations(fixtureDirectory).sort()).toEqual([
        'Numeric.tsx:1: borderRadius: 10',
        `Quoted.tsx:1: borderRadius: '4px'`,
        `Quoted.tsx:2: borderRadius: "4px"`,
        'TypeScript.ts:1: borderRadius: 5',
        `JavaScript.js:1: borderRadius: '6px'`,
        `Jsx.jsx:1: borderRadius: "7px"`,
      ].sort())
    } finally {
      rmSync(fixtureDirectory, { recursive: true, force: true })
    }
  })
})
