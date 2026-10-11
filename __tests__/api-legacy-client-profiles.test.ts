// ops-api-remediation: package 4, F16/F17 cache boundary (reference helper client matrix)
import { describe, expect, it, vi } from 'vitest'
import {
  PublicContractFeedRefreshError,
  refreshPublicContractFeed,
  type PublicContractFeedFailure,
  type PublicContractFeedSnapshotStore,
  type VerifiedPublicContractFeedSnapshot,
} from '@/lib/integrations/publicContractFeedSnapshot'

class DurableTestStore implements PublicContractFeedSnapshotStore {
  snapshot: VerifiedPublicContractFeedSnapshot | null = null
  failures: PublicContractFeedFailure[] = []
  async load() {
    return this.snapshot
  }
  async save(snapshot: VerifiedPublicContractFeedSnapshot) {
    this.snapshot = structuredClone(snapshot)
  }
  async recordFailure(failure: PublicContractFeedFailure) {
    this.failures.push(structuredClone(failure))
  }
}

const tenantReference = 'tenant_0123456789abcdef0123456789abcdef0123'
const schemaVersion = '2026-08-03.1'

function payload(contracts: Record<string, unknown>[], authorizedEmpty = false) {
  return {
    data: contracts,
    contracts,
    meta: {
      tenant_reference: tenantReference,
      contract_schema_version: schemaVersion,
      count: contracts.length,
      publication_revision: 7,
      feed_state: contracts.length ? 'contracts_present' : 'canonical_empty',
      empty_feed_authorization: contracts.length
        ? null
        : authorizedEmpty
          ? {
              authorized: true,
              reason: 'canonical_unpublished_or_archived',
              publication_revision: 7,
              canonical_source: 'canonical_public_contract_delivery_readiness_v',
              affected_offer_references: ['offer_1'],
              blockers: ['PUBLICATION_NOT_PUBLISHED'],
            }
          : null,
    },
    request_id: '00000000-0000-4000-8000-000000000001',
  }
}

function jsonResponse(body: unknown, status = 200, etag = '"contracts-test"') {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json', etag },
  })
}

async function refresh(
  store: DurableTestStore,
  fetchImpl: typeof fetch,
) {
  return refreshPublicContractFeed({
    endpoint: 'https://app.gridex.se/api/v1/website/public-contracts',
    apiKey: 'test-only',
    expectedTenantReference: tenantReference,
    expectedSchemaVersion: schemaVersion,
    store,
    fetchImpl,
    now: () => new Date('2026-08-02T20:00:00.000Z'),
  })
}

function withMeta(changes: Record<string, unknown>) {
  const body = payload([{ offer_reference: 'offer_1' }])
  return { ...body, meta: { ...body.meta, ...changes } }
}

describe('package 4: reference helper does not require an exact documentation revision', () => {
  it.each(['2026-10-02.3', '2026-10-04.1', '2027-03-01.1'])('accepts server revision %s with an older expectedSchemaVersion', async (revision) => {
    const store = new DurableTestStore()
    const result = await refresh(store, (async () => jsonResponse(withMeta({ contract_schema_version: revision }))) as typeof fetch)
    expect(result.source).toBe('fresh')
    expect(store.snapshot?.contractSchemaVersion).toBe(revision)
  })
  it('works without expectedSchemaVersion at all', async () => {
    const store = new DurableTestStore()
    const result = await refreshPublicContractFeed({ endpoint: 'https://app.gridex.se/api/v1/website/public-contracts', apiKey: 'test-only', expectedTenantReference: tenantReference, store, fetchImpl: (async () => jsonResponse(payload([{ offer_reference: 'offer_1' }]))) as typeof fetch })
    expect(result.source).toBe('fresh')
  })
  it('rejects an unsupported major and keeps the verified snapshot', async () => {
    const store = new DurableTestStore()
    await refresh(store, (async () => jsonResponse(payload([{ offer_reference: 'offer_1' }]))) as typeof fetch)
    const before = structuredClone(store.snapshot)
    const result = await refresh(store, (async () => jsonResponse(withMeta({ contract_major: 'v2' }))) as typeof fetch)
    expect(result).toMatchObject({ source: 'last_known_good', degraded: true, failure: { code: 'PUBLIC_CONTRACT_SCHEMA_MISMATCH' } })
    expect(store.snapshot).toEqual(before)
  })
  it('still rejects a broken business payload (missing offer_reference)', async () => {
    const store = new DurableTestStore()
    await expect(refresh(store, (async () => jsonResponse(payload([{ name: 'no reference' }]))) as typeof fetch)).rejects.toMatchObject({ code: 'PUBLIC_CONTRACT_SCHEMA_INVALID' })
  })
  it('never reuses another tenant snapshot for 304 or as last known good', async () => {
    const store = new DurableTestStore()
    await refresh(store, (async () => jsonResponse(payload([{ offer_reference: 'offer_1' }]))) as typeof fetch)
    store.snapshot = { ...store.snapshot!, tenantReference: 'tenant_other' }
    const seen: Array<string | null> = []
    const fetch304 = (async (_url: string, init?: RequestInit) => {
      seen.push(new Headers(init?.headers).get('if-none-match'))
      return new Response(null, { status: 304 })
    }) as unknown as typeof fetch
    await expect(refresh(store, fetch304)).rejects.toMatchObject({ code: 'PUBLIC_CONTRACT_304_WITHOUT_SNAPSHOT' })
    expect(seen).toEqual([null])
  })
})
