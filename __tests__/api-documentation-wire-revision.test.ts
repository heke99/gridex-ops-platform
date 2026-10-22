import { execFileSync } from 'node:child_process'
import { copyFileSync, existsSync, mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { resolve } from 'node:path'
import { createRequire } from 'node:module'
import { describe, expect, it } from 'vitest'
import website from '@/docs/openapi/website-integration-v1.json'
import customer from '@/docs/openapi/customer-portal-v1.json'
import staff from '@/docs/openapi/staff-v1.json'
import onboarding from '@/docs/openapi/staff-onboarding-v1.json'
import { buildOpenApiReleaseManifest } from '@/lib/integrations/openApiReleaseManifest'
import { WEBSITE_INTEGRATION_CONTRACT_VERSION } from '@/lib/integrations/websiteIntegrationContract'

const { releaseManifestSchemas } = createRequire(import.meta.url)('../scripts/lib/openapi-release-schemas.cjs') as {
  releaseManifestSchemas: (documentationVersion: string, minimumVersion: string, options: { runtimeVersion: string; includeStaff: boolean }) => { OpenApiReleaseManifest: unknown }
}
const { validateSchema } = createRequire(import.meta.url)('../scripts/lib/openapi-schema-validator.cjs') as {
  validateSchema: (document: unknown, value: unknown, schema: unknown) => string[]
}
function documentedError(document: unknown, path: string, value: unknown, method: string, status: string): string[] {
  const spec = document as { paths: Record<string, Record<string, { responses: Record<string, { $ref?: string; content?: { 'application/json'?: { schema: unknown } } }> }>>; components: { responses: Record<string, { content?: { 'application/json'?: { schema: unknown } } }> } }
  const response = spec.paths[path][method].responses[status]
  const resolved = response.$ref ? spec.components.responses[response.$ref.split('/').pop()!] : response
  const schema = resolved.content?.['application/json']?.schema
  expect(schema, `${method} ${path}: ${status} error schema`).toBeDefined()
  return validateSchema(document, value, schema)
}
function withoutDescriptions(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(withoutDescriptions)
  if (!value || typeof value !== 'object') return value
  return Object.fromEntries(Object.entries(value).filter(([key]) => key !== 'description').map(([key, child]) => [key, withoutDescriptions(child)]))
}
const error = (code: string) => ({ error: { code, message: 'Request refused.', retryable: false, field: null, blockers: [] }, request_id: 'request-docs', correlation_id: 'request-docs', contract_schema_version: '2026-10-09.1' })

describe('documentation releases preserve the business wire revision', () => {
  it('materializes docs-only revisions, rejects runtime drift before writes, and refuses frozen byte changes', () => {
    const dir = mkdtempSync(resolve(tmpdir(), 'gridex-docs-wire-'))
    const names = ['website-integration-v1', 'customer-portal-v1', 'staff-v1']
    const script = resolve('scripts/materialize-openapi-release.cjs')
    try {
      mkdirSync(resolve(dir, 'docs/openapi'), { recursive: true })
      mkdirSync(resolve(dir, 'scripts/lib'), { recursive: true })
      copyFileSync(resolve('scripts/lib/unit-loopback-network-boundary.cjs'), resolve(dir, 'scripts/lib/unit-loopback-network-boundary.cjs'))
      copyFileSync(resolve('scripts/lib/refactor-safe-static-read.cjs'), resolve(dir, 'scripts/lib/refactor-safe-static-read.cjs'))
      const source = (runtime: string, title = 'Public API') => JSON.stringify({ info: { version: '2026-10-12.1', title }, 'x-contract-schema-version': runtime })
      for (const name of names) writeFileSync(resolve(dir, `docs/openapi/${name}.json`), source('2026-10-09.1'))
      writeFileSync(resolve(dir, 'docs/openapi/staff-v1.json'), source('2026-10-05.2'))
      expect(() => execFileSync(process.execPath, [script], { cwd: dir, stdio: 'pipe' })).toThrow('runtime schema revisions must independently match')
      expect(existsSync(resolve(dir, 'docs/openapi/releases'))).toBe(false)
      writeFileSync(resolve(dir, 'docs/openapi/staff-v1.json'), source('2026-10-09.1'))
      execFileSync(process.execPath, [script], { cwd: dir, stdio: 'pipe' })
      const artifact = resolve(dir, 'docs/openapi/releases/2026-10-12.1/staff-v1.json')
      const frozen = readFileSync(artifact, 'utf8')
      expect(JSON.parse(frozen)['x-contract-schema-version']).toBe('2026-10-09.1')
      writeFileSync(resolve(dir, 'docs/openapi/staff-v1.json'), source('2026-10-09.1', 'Changed'))
      expect(() => execFileSync(process.execPath, [script], { cwd: dir, stdio: 'pipe' })).toThrow('Refusing to mutate immutable OpenAPI release artifact')
      expect(readFileSync(artifact, 'utf8')).toBe(frozen)
    } finally { rmSync(dir, { recursive: true, force: true }) }
  })

  it('generates a closed manifest schema with independent documentation and runtime revisions', () => {
    const schemas = releaseManifestSchemas('2026-10-22.1', '2026-10-02.3', { runtimeVersion: '2026-10-09.1', includeStaff: true })
    const manifest = buildOpenApiReleaseManifest()
    expect(validateSchema(website, manifest, schemas.OpenApiReleaseManifest)).toEqual([])
    expect(validateSchema(website, { ...manifest, runtime_contract_version: '2026-10-22.1' }, schemas.OpenApiReleaseManifest)).not.toEqual([])
  })
  it('publishes new document revisions and immutable URLs while retaining the supported wire revision', () => {
    const manifest = buildOpenApiReleaseManifest()
    expect(manifest.release_version).toBe('2026-10-22.1')
    expect(manifest.guide_version).toBe('2026-10-22.1')
    expect(manifest.runtime_contract_version).toBe('2026-10-09.1')
    expect(manifest.minimum_tenant_integration_version).toBe('2026-10-02.3')
    expect(WEBSITE_INTEGRATION_CONTRACT_VERSION).toBe('2026-10-09.1')
    for (const item of Object.values(manifest.specifications)) {
      expect(item.contract_version).toBe('2026-10-22.1')
      expect(item.immutable_url).toContain('/openapi/2026-10-22.1/')
    }
    for (const document of [website, customer, staff]) {
      expect(document.info.version).toBe('2026-10-22.1')
      expect(document['x-contract-schema-version']).toBe('2026-10-09.1')
      expect(validateSchema(document, manifest, { $ref: '#/components/schemas/OpenApiReleaseManifest' })).toEqual([])
      expect(validateSchema(document, error('organization_paused'), { $ref: '#/components/schemas/ErrorEnvelope' })).toEqual([])
      expect(validateSchema(document, { ...error('organization_paused'), contract_schema_version: '2026-10-22.1' }, { $ref: '#/components/schemas/ErrorEnvelope' })).not.toEqual([])
    }
    expect(onboarding.info.version).toBe('2026-10-05.2')
    expect(onboarding['x-contract-schema-version']).toBe('2026-10-05.2')
  })

  it('retains frozen request contracts and business schemas except verified optional response documentation and the F51 registered address', () => {
    for (const [name, current] of [['website-integration-v1', website], ['customer-portal-v1', customer], ['staff-v1', staff]] as const) {
      const frozen = JSON.parse(readFileSync(`docs/openapi/releases/2026-10-09.1/${name}.json`, 'utf8')) as { components: { schemas: Record<string, unknown> } }
      for (const [schema, expected] of Object.entries(frozen.components.schemas)) {
        if (['OpenApiReleaseManifest', 'OpenApiReleaseSpecification'].includes(schema)) continue
        const actual = structuredClone((current.components.schemas as Record<string, unknown>)[schema]) as { properties?: Record<string, unknown> }
        // These fields are already emitted by mounted runtime paths; only docs were incomplete.
        if (name === 'customer-portal-v1' && schema === 'ClosedPortalResourceEnvelope') delete actual.properties?.page
        if (name === 'customer-portal-v1' && schema === 'CustomerMoveOutData') delete actual.properties?.submitted_at
        // 2026-10-22.1 (F51): the only request change is the required closed customer.registered_address.
        if (name === 'website-integration-v1' && schema === 'CustomerApplicationRequest') {
          const customer = actual.properties!.customer as { required: string[]; properties: Record<string, unknown> }
          expect(customer.properties.registered_address).toEqual({ $ref: '#/components/schemas/CustomerRegisteredAddress' })
          expect(customer.required).toContain('registered_address')
          delete customer.properties.registered_address
          customer.required = customer.required.filter(field => field !== 'registered_address')
        }
        if (name === 'website-integration-v1' && schema === 'WebsiteQuoteValidationData') {
          expect(withoutDescriptions(actual.properties!.market_reference)).toEqual({ anyOf: [{ $ref: '#/components/schemas/MarketReference' }, { type: 'null' }] })
          actual.properties!.market_reference = { $ref: '#/components/schemas/MarketReference' }
        }
        expect(withoutDescriptions(actual), `${name}: ${schema}`).toEqual(withoutDescriptions(expected))
      }
    }
  })

  it('documents a null market reference for a fixed-price quote without changing required fields', () => {
    const validation = website.components.schemas.WebsiteQuoteValidationData
    expect(validateSchema(website, null, validation.properties.market_reference)).toEqual([])
    expect(validation.required).toContain('market_reference')
  })

  it('documents organization closure and pause errors for every authenticated business operation', () => {
    for (const document of [website, customer, staff, onboarding]) {
      for (const [path, pathItem] of Object.entries(document.paths)) {
        if (path.includes('/openapi/')) continue
        for (const [method, operation] of Object.entries(pathItem)) {
          if (!['get', 'post', 'put', 'patch', 'delete'].includes(method)) continue
          for (const [status, code] of [['410', 'organization_closed'], ['423', 'organization_paused']]) {
            const envelope = document === onboarding
              ? { error: { code, message: 'Request refused.' }, request_id: 'request-docs', contract_schema_version: '2026-10-05.2' }
              : error(code)
            expect((operation as { responses: Record<string, unknown> }).responses[status], `${method} ${path}: ${status}`).toBeDefined()
            expect(documentedError(document, path, envelope, method, status), `${method} ${path}: ${status}`).toEqual([])
          }
        }
      }
    }
  })

  it('documents payload_too_large for JSON staff writes using the existing error envelope', () => {
    for (const [path, pathItem] of Object.entries(staff.paths)) {
      for (const [method, operation] of Object.entries(pathItem)) {
        if (!['post', 'put', 'patch', 'delete'].includes(method)) continue
        const op = operation as { requestBody?: { content?: Record<string, unknown> }; responses: Record<string, unknown> }
        if (!op.requestBody?.content?.['application/json']) continue
        expect(op.responses['413'], `${method} ${path}: 413`).toBeDefined()
        expect(documentedError(staff, path, error('payload_too_large'), method, '413')).toEqual([])
      }
    }
  })
})
