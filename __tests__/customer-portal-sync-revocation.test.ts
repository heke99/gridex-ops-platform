import { NextRequest } from 'next/server'
import { beforeEach, expect, it, vi } from 'vitest'

const fixture = vi.hoisted(() => ({
  replay: true,
  identityStatus: 'disabled',
  accountStatus: 'active',
  accountActive: true,
  upsertError: null as { code: string; message: string } | null,
  failed: vi.fn(async () => undefined),
  completed: vi.fn(async () => undefined),
}))

vi.mock('@/lib/api/strictRequest', async (importOriginal) => ({
  ...await importOriginal<typeof import('@/lib/api/strictRequest')>(),
  claimPortalWriteIdempotency: async () => ({
    replay: fixture.replay,
    recordId: 'claim-a',
    statusCode: 200,
    responseBody: { data: { status: 'linked', access_granted: true } },
  }),
  failPortalWriteIdempotency: fixture.failed,
  completePortalWriteIdempotency: fixture.completed,
}))

vi.mock('@/lib/integrations/apiAuth', () => ({
  requireIntegrationApiAccess: async () => ({
    ok: true, context: { companyId: '00000000-0000-4000-8000-00000000a001' },
    client: { id: 'client-a' },
  }),
  logIntegrationApiRequest: async () => undefined,
}))

vi.mock('@/lib/customer-portal/externalApi', () => ({
  customerPortalJson: (body: unknown, init?: ResponseInit) => Response.json(body, init),
  normalizeDigits: (value: string | null | undefined) => (value ?? '').replace(/\D/g, ''),
  normalizeEmail: (value: string | null | undefined) => (value ?? '').trim().toLowerCase(),
  normalizeFacility: (value: string | null | undefined) => (value ?? '').trim(),
}))

vi.mock('@/lib/supabase/service', () => ({
  supabaseService: {
    from(table: string) {
      const filters: Record<string, unknown> = {}
      let writing = false
      const query = {
        select: () => query,
        eq: (field: string, value: unknown) => { filters[field] = value; return query },
        ilike: (field: string, value: unknown) => { filters[field] = value; return query },
        or: () => query,
        in: () => query,
        limit: () => query,
        upsert: () => { writing = true; return query },
        maybeSingle: async () => ({ data: rows()[0] ?? null, error: null }),
        single: async () => writing
          ? { data: null, error: fixture.upsertError }
          : { data: rows()[0] ?? null, error: null },
        then: (resolve: (value: unknown) => unknown) => resolve({ data: rows(), error: null }),
      }
      function rows(): Record<string, unknown>[] {
        const source: Record<string, unknown>[] = table === 'customer_portal_identities'
          ? [{ status: fixture.identityStatus, company_id: '00000000-0000-4000-8000-00000000a001', provider: 'gridex_website', external_customer_id: 'EXT-1', auth_user_id: '00000000-0000-4000-8000-00000000a301' }]
          : table === 'customer_portal_accounts'
            ? [{ status: fixture.accountStatus, is_active: fixture.accountActive, company_id: '00000000-0000-4000-8000-00000000a001' }]
            : table === 'customers'
              ? [{ id: 'customer-a', company_id: '00000000-0000-4000-8000-00000000a001', customer_number: 'C-1', email: 'customer@example.test', personal_number: null, org_number: null }]
              : []
        return source.filter((row) => Object.entries(filters).every(([key, value]) => row[key] === value))
      }
      return query
    },
  },
}))

import { POST } from '@/app/api/v1/customer-portal/sync/route'

function request() {
  return new NextRequest('https://gridex.test/api/v1/customer-portal/sync', {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      'idempotency-key': 'retry-0001',
      'x-gridex-customer-portal-user-id': '00000000-0000-4000-8000-00000000a301',
      'x-gridex-auth-user-id': '00000000-0000-4000-8000-00000000a301',
    },
    body: JSON.stringify({
      external_customer_id: 'EXT-1',
      customer_portal_user_id: '00000000-0000-4000-8000-00000000a301',
      auth_user_id: '00000000-0000-4000-8000-00000000a301',
      email: 'customer@example.test', customer_number: 'C-1',
    }),
  })
}

beforeEach(() => {
  fixture.replay = true
  fixture.identityStatus = 'disabled'
  fixture.accountStatus = 'active'
  fixture.accountActive = true
  fixture.upsertError = null
  fixture.failed.mockClear()
  fixture.completed.mockClear()
})

it('rejects a completed linked replay after identity revocation without invalidating the completed idempotency record', async () => {
  const response = await POST(request())
  expect(response.status).toBe(409)
  expect((await response.json()).code).toBe('portal_identity_revoked')
  expect(fixture.failed).not.toHaveBeenCalled()
})

it('rejects a linked replay when the account has disabled status but a stale true flag', async () => {
  fixture.identityStatus = 'active'
  fixture.accountStatus = 'disabled'
  const response = await POST(request())
  expect(response.status).toBe(409)
  expect(fixture.failed).not.toHaveBeenCalled()
})

it('still replays a linked result for an active identity and account', async () => {
  fixture.identityStatus = 'active'
  const response = await POST(request())
  expect(response.status).toBe(200)
  expect((await response.json()).data.access_granted).toBe(true)
  expect(fixture.failed).not.toHaveBeenCalled()
})

it('maps a database revocation collision on a fresh sync to a controlled conflict', async () => {
  fixture.replay = false
  fixture.identityStatus = 'active'
  fixture.upsertError = { code: '23514', message: 'customer_portal_identity_revoked' }
  const response = await POST(request())
  expect(response.status).toBe(409)
  expect((await response.json()).code).toBe('portal_identity_revoked')
  expect(fixture.failed).toHaveBeenCalledOnce()
  expect(fixture.completed).not.toHaveBeenCalled()
})
