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

describe('tenant public-contract last-known-good behavior', () => {
  it('persists only a fully verified successful feed', async () => {
    const store = new DurableTestStore()
    const result = await refresh(
      store,
      vi.fn(async () =>
        jsonResponse(payload([{ offer_reference: 'offer_1', name: 'Rörligt' }])),
      ) as typeof fetch,
    )
    expect(result.source).toBe('fresh')
    expect(store.snapshot?.contracts).toHaveLength(1)
    expect(store.snapshot?.fingerprintSha256).toMatch(/^[a-f0-9]{64}$/)
  })

  it.each([
    ['timeout', vi.fn(async () => Promise.reject(new Error('timeout')))],
    ['HTTP 500', vi.fn(async () => jsonResponse({ error: {} }, 500))],
    [
      'invalid JSON',
      vi.fn(async () => new Response('{', { status: 200 })),
    ],
    [
      'schema mismatch',
      vi.fn(async () =>
        jsonResponse({
          ...payload([{ offer_reference: 'offer_1' }]),
          meta: {
            ...payload([{ offer_reference: 'offer_1' }]).meta,
            contract_schema_version: 'obsolete',
          },
        }),
      ),
    ],
  ])('keeps the durable snapshot after %s', async (_name, fetchMock) => {
    const store = new DurableTestStore()
    await refresh(
      store,
      vi.fn(async () =>
        jsonResponse(payload([{ offer_reference: 'offer_1' }])),
      ) as typeof fetch,
    )
    const before = structuredClone(store.snapshot)
    const result = await refresh(store, fetchMock as unknown as typeof fetch)
    expect(result.source).toBe('last_known_good')
    expect(result.degraded).toBe(true)
    expect(store.snapshot).toEqual(before)
    expect(store.failures).toHaveLength(1)
  })

  it('aborts a slow OPS request and preserves last-known-good', async () => {
    const store = new DurableTestStore()
    await refresh(
      store,
      vi.fn(async () =>
        jsonResponse(payload([{ offer_reference: 'offer_1' }])),
      ) as typeof fetch,
    )
    const fetchImpl = vi.fn(
      async (_input: RequestInfo | URL, init?: RequestInit) =>
        new Promise<Response>((_resolve, reject) => {
          init?.signal?.addEventListener('abort', () => {
            reject(new DOMException('Aborted', 'AbortError'))
          })
        }),
    ) as typeof fetch
    const result = await refreshPublicContractFeed({
      endpoint: 'https://app.gridex.se/api/v1/website/public-contracts',
      apiKey: 'test-only',
      expectedTenantReference: tenantReference,
      expectedSchemaVersion: schemaVersion,
      store,
      fetchImpl,
      timeoutMs: 1_000,
      now: () => new Date('2026-08-02T20:00:00.000Z'),
    })
    expect(result.source).toBe('last_known_good')
    expect(result.failure?.code).toBe('PUBLIC_CONTRACT_TIMEOUT')
    expect(result.snapshot.contracts).toHaveLength(1)
  })

  it('does not erase a verified snapshot for an unauthorized empty result', async () => {
    const store = new DurableTestStore()
    await refresh(
      store,
      vi.fn(async () =>
        jsonResponse(payload([{ offer_reference: 'offer_1' }])),
      ) as typeof fetch,
    )
    const result = await refresh(
      store,
      vi.fn(async () => jsonResponse(payload([], false))) as typeof fetch,
    )
    expect(result.source).toBe('last_known_good')
    expect(store.snapshot?.contracts).toHaveLength(1)
    expect(result.failure?.code).toBe('UNVERIFIED_EMPTY_PUBLIC_CONTRACT_FEED')
  })

  it('replaces the snapshot only for an explicitly authorized canonical empty feed', async () => {
    const store = new DurableTestStore()
    await refresh(
      store,
      vi.fn(async () =>
        jsonResponse(payload([{ offer_reference: 'offer_1' }])),
      ) as typeof fetch,
    )
    const result = await refresh(
      store,
      vi.fn(async () => jsonResponse(payload([], true))) as typeof fetch,
    )
    expect(result.source).toBe('fresh')
    expect(result.snapshot.feedState).toBe('canonical_empty')
    expect(store.snapshot?.contracts).toEqual([])
  })

  it('restores the same durable snapshot after a process restart', async () => {
    const durableStore = new DurableTestStore()
    await refresh(
      durableStore,
      vi.fn(async () =>
        jsonResponse(payload([{ offer_reference: 'offer_1' }])),
      ) as typeof fetch,
    )
    const restartedProcessStore = durableStore
    const result = await refresh(
      restartedProcessStore,
      vi.fn(async () => jsonResponse({ error: {} }, 503)) as typeof fetch,
    )
    expect(result.source).toBe('last_known_good')
    expect(result.snapshot.contracts[0]?.offer_reference).toBe('offer_1')
  })

  it('fails cold start when no verified snapshot exists', async () => {
    const store = new DurableTestStore()
    await expect(
      refresh(
        store,
        vi.fn(async () => jsonResponse({ error: {} }, 503)) as typeof fetch,
      ),
    ).rejects.toBeInstanceOf(PublicContractFeedRefreshError)
  })
})
