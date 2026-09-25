import { readFileSync, readdirSync } from 'node:fs'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import Ajv2020 from 'ajv/dist/2020'
import addFormats from 'ajv-formats'
import { describe, expect, it } from 'vitest'

type JsonSchema = Record<string, unknown>
interface OpenApiDocument {
  paths: Record<string, { get?: { operationId?: string; responses?: Record<string, unknown> } } | undefined>
  components: {
    schemas: Record<string, JsonSchema>
    responses: Record<string, unknown>
  }
}

interface CoverageEntry {
  path: string
  operationId: string
  assetPath: string
  assetRowsPath: string[]
  responseItemsPath: string[]
  itemSchemaName: string
}

const projectRoot = fileURLToPath(new URL('../../', import.meta.url))
const contract = JSON.parse(
  readFileSync(join(projectRoot, 'worker/src/openapi.json'), 'utf8'),
) as OpenApiDocument

const coverageRegistry: CoverageEntry[] = [
  {
    path: '/api/stats',
    operationId: 'getStats',
    assetPath: 'data/processed/summary.json',
    assetRowsPath: [],
    responseItemsPath: [],
    itemSchemaName: 'StatsSummary',
  },
  {
    path: '/api/pages',
    operationId: 'listPages',
    assetPath: 'data/processed/pages.json',
    assetRowsPath: ['p'],
    responseItemsPath: ['pages', '[]'],
    itemSchemaName: 'Page',
  },
  {
    path: '/api/pages/by-id',
    operationId: 'getPageById',
    assetPath: 'data/processed/pages.json',
    assetRowsPath: ['p'],
    responseItemsPath: [],
    itemSchemaName: 'Page',
  },
  {
    path: '/api/pages/{slug}',
    operationId: 'getPage',
    assetPath: 'data/processed/pages.json',
    assetRowsPath: ['p'],
    responseItemsPath: [],
    itemSchemaName: 'Page',
  },
  {
    path: '/api/pages/{slug}/revisions',
    operationId: 'listPageRevisions',
    assetPath: 'data/processed/revisions/*.json',
    assetRowsPath: [],
    responseItemsPath: ['revisions', '[]'],
    itemSchemaName: 'Revision',
  },
  {
    path: '/api/agents/{name}',
    operationId: 'getAgent',
    assetPath: 'data/processed/labels.json',
    assetRowsPath: ['l'],
    responseItemsPath: [],
    itemSchemaName: 'Agent',
  },
  {
    path: '/api/events',
    operationId: 'listEvents',
    assetPath: 'data/processed/recent_events.json',
    assetRowsPath: [],
    responseItemsPath: ['events', '[]'],
    itemSchemaName: 'Event',
  },
  {
    path: '/api/links',
    operationId: 'getAgentLinks',
    assetPath: 'data/processed/agent_links.json',
    assetRowsPath: ['*', '[]'],
    responseItemsPath: ['links', '[]'],
    itemSchemaName: 'AgentLink',
  },
  {
    path: '/api/conflicts',
    operationId: 'listConflictPages',
    assetPath: 'data/processed/conflicts.json',
    assetRowsPath: [],
    responseItemsPath: ['conflicts', '[]'],
    itemSchemaName: 'Conflict',
  },
]

const intentionallyExcludedAssetBackedBranches = [
  {
    path: '/api/agents',
    operationId: 'listAgents',
    reason: 'Projects label rows into AgentSummary, dropping pgs and deriving pgsCount/pgsPreview.',
  },
  {
    path: '/api/search',
    operationId: 'searchNames',
    reason: 'Joins pages and labels, filters by query, and projects separate page/agent hit shapes.',
  },
  {
    path: '/api/fts',
    operationId: 'searchBodyTokens',
    reason: 'Joins token postings to pages and projects query-specific PageView rows.',
  },
  {
    path: '/api/artifacts',
    operationId: 'listArtifacts',
    reason: 'Joins payload findings to pages and projects ArtifactPage rows.',
  },
  {
    path: '/api/links',
    operationId: 'getAgentLinks',
    reason: 'The other= pair branch computes a shared-page intersection from labels instead of serving agent_links rows.',
  },
] as const

const ajv = new Ajv2020({
  allErrors: true,
  strict: false,
  coerceTypes: false,
  useDefaults: false,
  removeAdditional: false,
})
addFormats(ajv)

const validators = new Map<string, ReturnType<typeof ajv.compile>>()

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
}

function resolveSchema(schema: JsonSchema, document = contract): JsonSchema {
  if (typeof schema.$ref !== 'string') return schema
  const match = /^#\/components\/schemas\/([^/]+)$/.exec(schema.$ref)
  if (!match || !Object.hasOwn(document.components.schemas, match[1])) {
    throw new Error(`unsupported or missing schema reference: ${schema.$ref}`)
  }
  return document.components.schemas[match[1]]
}

function schemaAtPath(schema: JsonSchema, path: string[], document = contract): JsonSchema | undefined {
  const resolved = resolveSchema(schema, document)
  for (const composition of ['oneOf', 'anyOf', 'allOf']) {
    const branches = resolved[composition]
    if (Array.isArray(branches)) {
      const matches = branches
        .filter(isRecord)
        .map((branch) => schemaAtPath(branch, path, document))
        .filter((branch): branch is JsonSchema => branch !== undefined)
      if (matches.length === 0) return undefined
      const references = new Set(matches.map((match) => match.$ref ?? JSON.stringify(match)))
      if (references.size > 1) throw new Error(`ambiguous response item schema at ${path.join('.')}`)
      return matches[0]
    }
  }
  if (path.length === 0) return schema

  const [step, ...remaining] = path
  const next = step === '[]'
    ? resolved.items
    : isRecord(resolved.properties)
      ? resolved.properties[step]
      : undefined
  return isRecord(next) ? schemaAtPath(next, remaining, document) : undefined
}

function responseItemSchema(entry: CoverageEntry): JsonSchema {
  const operation = contract.paths[entry.path]?.get
  if (operation?.operationId !== entry.operationId) {
    throw new Error(`missing mapped operation ${entry.operationId} at ${entry.path}`)
  }

  const successResponse = operation.responses?.['200']
  if (!isRecord(successResponse)) throw new Error(`missing 200 response for ${entry.operationId}`)
  let response: Record<string, unknown> = successResponse
  if (typeof response.$ref === 'string') {
    const match = /^#\/components\/responses\/([^/]+)$/.exec(response.$ref)
    if (!match || !contract.components.responses[match[1]]) {
      throw new Error(`unsupported or missing response reference: ${response.$ref}`)
    }
    const referencedResponse = contract.components.responses[match[1]]
    if (!isRecord(referencedResponse)) throw new Error(`invalid response component: ${match[1]}`)
    response = referencedResponse
  }

  const content = isRecord(response.content) ? response.content : undefined
  const jsonContent = content && isRecord(content['application/json']) ? content['application/json'] : undefined
  const responseSchema = jsonContent && isRecord(jsonContent.schema) ? jsonContent.schema : undefined
  if (!responseSchema) throw new Error(`missing JSON response schema for ${entry.operationId}`)

  const itemSchema = schemaAtPath(responseSchema, entry.responseItemsPath)
  if (!itemSchema) throw new Error(`missing response item schema for ${entry.operationId}`)
  const expectedRef = `#/components/schemas/${entry.itemSchemaName}`
  if (itemSchema.$ref !== expectedRef) {
    throw new Error(`${entry.operationId} item schema changed: expected ${expectedRef}, got ${String(itemSchema.$ref)}`)
  }
  return itemSchema
}

function rewriteComponentRefs(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(rewriteComponentRefs)
  if (!isRecord(value)) return value
  return Object.fromEntries(Object.entries(value).map(([key, entry]) => [
    key,
    key === '$ref' && typeof entry === 'string'
      ? entry.replace(/^#\/components\/schemas\//, '#/$defs/')
      : rewriteComponentRefs(entry),
  ]))
}

function validatorFor(schemaName: string) {
  const cached = validators.get(schemaName)
  if (cached) return cached

  if (!Object.hasOwn(contract.components.schemas, schemaName)) {
    throw new Error(`missing component schema: ${schemaName}`)
  }
  const componentSchema = contract.components.schemas[schemaName]
  const root = rewriteComponentRefs({
    $schema: 'https://json-schema.org/draft/2020-12/schema',
    $defs: contract.components.schemas,
    ...componentSchema,
  })
  const validator = ajv.compile(root as Parameters<typeof ajv.compile>[0])
  validators.set(schemaName, validator)
  return validator
}

function undeclaredFields(value: unknown, schema: JsonSchema, path: string): string[] {
  const resolved = resolveSchema(schema)
  if (['oneOf', 'anyOf', 'allOf'].some((key) => key in resolved)) {
    throw new Error(`field coverage does not support composed item schema at ${path}`)
  }

  if (Array.isArray(value)) {
    return isRecord(resolved.items)
      ? value.flatMap((item, index) => undeclaredFields(item, resolved.items as JsonSchema, `${path}[${String(index)}]`))
      : []
  }
  if (!isRecord(value)) return []

  const properties = isRecord(resolved.properties) ? resolved.properties : {}
  const dictionarySchema = isRecord(resolved.additionalProperties) && Object.keys(resolved.additionalProperties).length > 0
    ? resolved.additionalProperties as JsonSchema
    : undefined

  return Object.entries(value).flatMap(([key, child]) => {
    const childSchema = properties[key]
    if (isRecord(childSchema)) return undeclaredFields(child, childSchema, `${path}.${key}`)
    if (dictionarySchema) return undeclaredFields(child, dictionarySchema, `${path}.${key}`)
    return [`${path}.${key}`]
  })
}

function selectRows(value: unknown, path: string[]): unknown[] {
  if (path.length === 0) return Array.isArray(value) ? value : [value]

  const [step, ...remaining] = path
  if (step === '*') {
    if (!isRecord(value)) throw new Error('dictionary selector applied to a non-object asset')
    return Object.values(value).flatMap((child) => selectRows(child, remaining))
  }
  if (step === '[]') {
    if (!Array.isArray(value)) throw new Error('array selector applied to a non-array asset')
    return value.flatMap((child) => selectRows(child, remaining))
  }
  if (!isRecord(value) || !Object.hasOwn(value, step)) {
    throw new Error(`missing asset row selector: ${step}`)
  }
  return selectRows(value[step], remaining)
}

function assetFiles(assetPath: string): { relativePath: string; fullPath: string }[] {
  if (assetPath.endsWith('/*.json')) {
    const relativeDirectory = assetPath.slice(0, -'/*.json'.length)
    const fullDirectory = join(projectRoot, ...relativeDirectory.split('/'))
    return readdirSync(fullDirectory)
      .filter((file) => file.endsWith('.json'))
      .sort()
      .map((file) => ({ relativePath: `${relativeDirectory}/${file}`, fullPath: join(fullDirectory, file) }))
  }

  return [{ relativePath: assetPath, fullPath: join(projectRoot, ...assetPath.split('/')) }]
}

interface Issue { message: string; count: number; first: string }

function collectCoverageIssues(entries: CoverageEntry[]): Map<string, Issue> {
  const issues = new Map<string, Issue>()
  const addIssue = (key: string, message: string, source: string) => {
    const current = issues.get(key)
    if (current) current.count += 1
    else issues.set(key, { message, count: 1, first: source })
  }

  for (const entry of entries) {
    responseItemSchema(entry)
    const validate = validatorFor(entry.itemSchemaName)
    const files = assetFiles(entry.assetPath)
    if (files.length === 0) throw new Error(`no processed assets found for ${entry.operationId}: ${entry.assetPath}`)
    let rowCount = 0

    for (const file of files) {
      const asset = JSON.parse(readFileSync(file.fullPath, 'utf8')) as unknown
      const rows = selectRows(asset, entry.assetRowsPath)
      rowCount += rows.length

      rows.forEach((row, index) => {
        const source = `${file.relativePath}[${String(index)}]`
        if (!validate(row)) {
          for (const error of validate.errors ?? []) {
            const detail = `${error.instancePath || '/'} ${error.keyword} ${error.message ?? ''}`.trim()
            addIssue(
              `AJV ${entry.operationId} ${detail}`,
              `AJV ${entry.itemSchemaName} at ${detail}`,
              `${entry.operationId} ${source}`,
            )
          }
        }

        for (const field of undeclaredFields(row, contract.components.schemas[entry.itemSchemaName], '$')) {
          addIssue(
            `undeclared ${entry.operationId} ${field}`,
            `Undeclared field ${entry.itemSchemaName}${field.slice(1)}`,
            `${entry.operationId} ${source}`,
          )
        }
      })
    }

    if (rowCount === 0) throw new Error(`no processed rows found for ${entry.operationId}: ${entry.assetPath}`)
  }

  return issues
}

describe('processed asset schema coverage', () => {
  it('validates every registered direct asset-backed response row against its item schema', () => {
    const issues = collectCoverageIssues(coverageRegistry)
    const report = [...issues.values()]
      .sort((left, right) => left.message.localeCompare(right.message))
      .map((issue) => `- ${issue.message} (${String(issue.count)} rows; first at ${issue.first})`)
      .join('\n')

    expect(issues.size, report || 'All registered asset rows match their response schemas.').toBe(0)
  })

  it('covers every AgentLink row in the real label-keyed asset dictionary', () => {
    const entry = coverageRegistry.find((candidate) => candidate.itemSchemaName === 'AgentLink')
    if (!entry) throw new Error('Missing AgentLink coverage entry')
    const issues = collectCoverageIssues([entry])
    expect(issues.size, [...issues.values()].map((issue) => issue.message).join('\n')).toBe(0)
  })

  it('allows schema-shaped dictionaries but detects undeclared nested fields', () => {
    const summaryPath = join(projectRoot, 'data/processed/summary.json')
    const summary: unknown = JSON.parse(readFileSync(summaryPath, 'utf8'))
    if (!isRecord(summary)) throw new Error('Expected the processed summary to be an object')
    const withDictionaryEntry = structuredClone(summary)
    if (!isRecord(withDictionaryEntry.per_wiki)) throw new Error('Expected per_wiki to be an object')
    const perWiki = withDictionaryEntry.per_wiki
    perWiki.__coverage_fixture__ = {
      revisions: { value: 1, population_id: 'fixture' },
    }
    const schema = contract.components.schemas.StatsSummary

    expect(validatorFor('StatsSummary')(withDictionaryEntry)).toBe(true)
    expect(undeclaredFields(withDictionaryEntry, schema, '$')).toEqual([])

    const fixture = perWiki.__coverage_fixture__
    if (!isRecord(fixture) || !isRecord(fixture.revisions)) {
      throw new Error('Expected the coverage fixture to have a revisions object')
    }
    fixture.revisions.fakeNestedField = true
    expect(validatorFor('StatsSummary')(withDictionaryEntry)).toBe(true)
    expect(undeclaredFields(withDictionaryEntry, schema, '$')).toContain(
      '$.per_wiki.__coverage_fixture__.revisions.fakeNestedField',
    )
  })

  it('records asset-backed transformed branches that are intentionally outside row passthrough coverage', () => {
    for (const excluded of intentionallyExcludedAssetBackedBranches) {
      expect(contract.paths[excluded.path]?.get?.operationId, excluded.reason).toBe(excluded.operationId)
      expect(excluded.reason.length).toBeGreaterThan(0)
    }
  })
})
