// ops-api-remediation: Paket 17 — supported client release matrix after the
// documentation-only release 2026-10-09.1.
import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import {
  API_CONTRACT_PROFILE_REGISTRY,
  API_CONTRACT_REVISION_PATTERN,
  assessApiContractCompatibility,
  isCompatibleResponseRevision,
  type ApiSurface,
} from '@/lib/integrations/apiContractCompatibility'
import {
  API_COMPATIBILITY_CLASSIFICATION,
  MINIMUM_TENANT_INTEGRATION_VERSION,
  STAFF_API_CONTRACT_VERSION,
  WEBSITE_INTEGRATION_CONTRACT_VERSION,
} from '@/lib/integrations/websiteIntegrationContract'
import { buildOpenApiReleaseManifest } from '@/lib/integrations/openApiReleaseManifest'
import {
  refreshPublicContractFeed,
  type PublicContractFeedFailure,
  type PublicContractFeedSnapshotStore,
  type VerifiedPublicContractFeedSnapshot,
} from '@/lib/integrations/publicContractFeedSnapshot'
import website from '@/docs/openapi/website-integration-v1.json'
import customer from '@/docs/openapi/customer-portal-v1.json'
import staff from '@/docs/openapi/staff-v1.json'

const SURFACES: ApiSurface[] = ['website', 'customer', 'staff', 'staff_onboarding']
const POLICY = 'You do not need to match the latest documentation revision exactly to use a supported API version.'

function profiles(surface: ApiSurface) {
  return API_CONTRACT_PROFILE_REGISTRY.filter((profile) => profile.surface === surface && profile.status === 'supported')
}

describe('supported client release matrix', () => {
  it('lists 2026-10-09.1 as the current release while keeping every older profile', () => {
    expect(WEBSITE_INTEGRATION_CONTRACT_VERSION).toBe('2026-10-09.1')
    expect(STAFF_API_CONTRACT_VERSION).toBe('2026-10-09.1')
    for (const surface of ['website', 'customer'] as const) {
      expect(profiles(surface).map((p) => p.revision)).toEqual(['2026-10-02.3', '2026-10-04.1', '2026-10-09.1'])
    }
    for (const surface of ['staff', 'staff_onboarding'] as const) {
      expect(profiles(surface).map((p) => p.revision)).toEqual(['2026-10-04.1', '2026-10-09.1'])
    }
  })

  it.each(SURFACES)('accepts every registered %s profile with its capabilities', (surface) => {
    for (const profile of profiles(surface)) {
      expect(profile.revision).toMatch(API_CONTRACT_REVISION_PATTERN)
      const result = assessApiContractCompatibility({
        surface,
        major: 'v1',
        clientProfile: profile.revision,
        requiredCapabilities: profile.capabilities,
        registry: API_CONTRACT_PROFILE_REGISTRY,
      })
      expect(result).toEqual({ ok: true, profile })
    }
  })

  it.each(SURFACES)('the current release equals the newest registered %s profile and is the default', (surface) => {
    const newest = [...profiles(surface)].sort((a, b) => a.revision.localeCompare(b.revision, 'en', { numeric: true })).at(-1)
    expect(newest?.revision).toBe(WEBSITE_INTEGRATION_CONTRACT_VERSION)
    const defaulted = assessApiContractCompatibility({ surface, major: 'v1', clientProfile: null, requiredCapabilities: [], registry: API_CONTRACT_PROFILE_REGISTRY })
    expect(defaulted.ok && defaulted.profile.revision).toBe(WEBSITE_INTEGRATION_CONTRACT_VERSION)
  })

  it('published OpenAPI documents and the manifest carry the current release', () => {
    for (const document of [website, customer, staff]) {
      expect(document.info.version).toBe(WEBSITE_INTEGRATION_CONTRACT_VERSION)
      expect(document['x-contract-schema-version']).toBe(WEBSITE_INTEGRATION_CONTRACT_VERSION)
    }
    const manifest = buildOpenApiReleaseManifest()
    expect(manifest.release_version).toBe(WEBSITE_INTEGRATION_CONTRACT_VERSION)
    expect(manifest.specifications.website.immutable_url).toContain(`/api/v1/openapi/${WEBSITE_INTEGRATION_CONTRACT_VERSION}/`)
    expect(manifest.specifications.staff.immutable_url).toContain(`/api/v1/openapi/${WEBSITE_INTEGRATION_CONTRACT_VERSION}/`)
  })

  it('the docs-only release did not raise the minimum and stays backward-compatible', () => {
    expect(MINIMUM_TENANT_INTEGRATION_VERSION).toBe('2026-10-02.3')
    expect(buildOpenApiReleaseManifest().minimum_tenant_integration_version).toBe('2026-10-02.3')
    expect(API_COMPATIBILITY_CLASSIFICATION).toEqual({ release: 'backward-compatible', website: 'backward-compatible', customerPortal: 'backward-compatible' })
    for (const surface of ['website', 'customer'] as const) {
      expect(assessApiContractCompatibility({ surface, major: 'v1', clientProfile: MINIMUM_TENANT_INTEGRATION_VERSION, requiredCapabilities: [], registry: API_CONTRACT_PROFILE_REGISTRY }).ok).toBe(true)
    }
  })

  it('keeps every previously published operation, parameter requirement and response of 2026-10-04.1', () => {
    for (const [name, current] of [['website-integration-v1', website], ['customer-portal-v1', customer], ['staff-v1', staff]] as const) {
      const previous = JSON.parse(readFileSync(`docs/openapi/releases/2026-10-04.1/${name}.json`, 'utf8'))
      const currentPaths = current.paths as Record<string, Record<string, { parameters?: Array<{ name?: string; $ref?: string; required?: boolean }>; responses?: Record<string, unknown> }>>
      for (const [path, item] of Object.entries(previous.paths as Record<string, Record<string, { parameters?: Array<{ name?: string; $ref?: string; required?: boolean }>; responses?: Record<string, unknown> }>>)) {
        for (const [method, operation] of Object.entries(item)) {
          const next = currentPaths[path]?.[method]
          expect(next, `${name} ${method} ${path}`).toBeDefined()
          for (const status of Object.keys(operation.responses ?? {})) expect(next?.responses?.[status], `${name} ${method} ${path} ${status}`).toBeDefined()
          const key = (p: { name?: string; $ref?: string }) => p.$ref ?? p.name
          const nextRequired = new Set((next?.parameters ?? []).filter((p) => p.required).map(key))
          const previousRequired = new Set((operation.parameters ?? []).filter((p) => p.required).map(key))
          expect([...nextRequired].filter((p) => !previousRequired.has(p)), `${name} ${method} ${path} adds no required parameter`).toEqual([])
        }
      }
      for (const [schema, value] of Object.entries(previous.components.schemas as Record<string, { required?: string[] }>)) {
        if (['OpenApiReleaseManifest', 'OpenApiReleaseSpecification'].includes(schema)) continue
        const next = (current.components.schemas as Record<string, { required?: string[] }>)[schema]
        expect(next, `${name} schema ${schema}`).toBeDefined()
        expect(next.required ?? []).toEqual(value.required ?? [])
      }
    }
  })

  it('every developer entry page and the migration guide state the compatibility policy', () => {
    for (const file of ['app/developers/page.tsx', 'app/developers/customer-portal-api/page.tsx', 'app/developers/staff-api/page.tsx', 'docs/api-migration-guide.md', 'docs/api-compatibility-policy.md']) {
      expect(readFileSync(file, 'utf8'), file).toContain(POLICY)
    }
    const guide = readFileSync('docs/api-migration-guide.md', 'utf8')
    expect(guide).toContain('V1 has no breaking changes')
    expect(guide).toContain('api-compatibility-policy.md')
    expect(guide).not.toMatch(/\btenant\b/i)
    expect(guide).not.toMatch(/\bOPS\b/)
  })
})

class MemoryStore implements PublicContractFeedSnapshotStore {
  snapshot: VerifiedPublicContractFeedSnapshot | null = null
  failures: PublicContractFeedFailure[] = []
  async load() { return this.snapshot }
  async save(snapshot: VerifiedPublicContractFeedSnapshot) { this.snapshot = structuredClone(snapshot) }
  async recordFailure(failure: PublicContractFeedFailure) { this.failures.push(structuredClone(failure)) }
}

const organizationReference = 'tenant_0123456789abcdef0123456789abcdef0123'
function feed(revision: string) {
  const contracts = [{ offer_reference: 'offer_1' }]
  return {
    data: contracts,
    contracts,
    meta: { tenant_reference: organizationReference, contract_schema_version: revision, count: 1, publication_revision: 7, feed_state: 'contracts_present', empty_feed_authorization: null },
    request_id: '00000000-0000-4000-8000-000000000001',
  }
}

describe('reference helper accepts responses labelled with any supported revision', () => {
  const supported = [...new Set(API_CONTRACT_PROFILE_REGISTRY.filter((p) => p.surface === 'website').map((p) => p.revision))]
  it.each(supported)('revision %s', async (revision) => {
    expect(isCompatibleResponseRevision(revision, 'v1')).toBe(true)
    for (const expectedSchemaVersion of supported) {
      const store = new MemoryStore()
      const result = await refreshPublicContractFeed({
        endpoint: 'https://app.gridex.se/api/v1/website/public-contracts',
        apiKey: 'test-only',
        expectedTenantReference: organizationReference,
        expectedSchemaVersion,
        store,
        fetchImpl: (async () => new Response(JSON.stringify(feed(revision)), { status: 200, headers: { 'content-type': 'application/json', etag: '"feed"' } })) as typeof fetch,
        now: () => new Date('2026-10-09T12:00:00.000Z'),
      })
      expect(result.source).toBe('fresh')
      expect(store.snapshot?.contractSchemaVersion).toBe(revision)
    }
  })
})
