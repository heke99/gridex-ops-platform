// ops-api-review: F10
import { NextRequest } from 'next/server'
import { beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'
import { CUSTOMER_A1, CUSTOMER_A2, TENANT_A, db, objects, resetSupportDb } from './helpers/supportPortalHarness'

vi.mock('@/lib/supabase/service', async () => (await import('./helpers/supportPortalHarness')).serviceMock)

const auth = vi.hoisted(() => ({ customerId: '', scopes: [] as string[] }))
vi.mock('@/lib/integrations/apiAuth', async (importOriginal) => {
  const original = await importOriginal<typeof import('@/lib/integrations/apiAuth')>()
  return {
    ...original,
    requireIntegrationApiAccess: async (_request: unknown, required: unknown) => {
      const missing = original.missingIntegrationApiScopes(auth.scopes, Array.isArray(required) ? required as string[] : [])
      if (missing.length) return { ok: false, status: 403, error: 'scope saknas', errorCode: 'api_scope_missing', client: null }
      return { ok: true, client: { id: 'client-a', company_id: TENANT_A, scopes: auth.scopes }, context: {}, rateLimit: null }
    },
    logIntegrationApiRequest: async () => undefined,
    currentIntegrationApiResponseContext: () => null,
  }
})
vi.mock('@/lib/customer-portal/customerResolver', async (importOriginal) => {
  const original = await importOriginal<typeof import('@/lib/customer-portal/customerResolver')>()
  return {
    ...original,
    resolvePortalCustomer: async () => ({
      ok: true,
      binding: 'portal_account',
      customer: { id: 'ident-a1', company_id: TENANT_A, customer_id: auth.customerId, external_customer_id: null, customer_number: 'A-1', email: null, auth_user_id: null, customer_portal_user_id: null, match_strength: 'strong', match_method: 'test', provider: 'test' },
    }),
  }
})

const pdf = (body = '1 0 obj << /Type /Catalog >> endobj') => Buffer.from(`%PDF-1.7\n${body}\n%%EOF\n`, 'latin1')
const params = (reference: string) => ({ params: Promise.resolve({ reference }) })
function upload(reference: string, bytes: Buffer, key: string) {
  return new NextRequest(`https://app.gridex.se/api/v1/customer/support/cases/${reference}/attachments`, {
    method: 'POST', headers: { 'content-type': 'application/pdf', 'idempotency-key': key }, body: new Uint8Array(bytes),
  })
}
async function openCase(): Promise<string> {
  const cases = await import('@/app/api/v1/customer/support/cases/route')
  const created = await cases.POST(new NextRequest('https://app.gridex.se/api/v1/customer/support/cases', {
    method: 'POST', headers: { 'content-type': 'application/json', 'idempotency-key': 'key-case-0001-abcdefgh' }, body: JSON.stringify({ title: 'Faktura', message: 'Se bilaga.' }),
  }))
  expect(created.status).toBe(201)
  return (await created.json()).data.case_reference
}

beforeAll(async () => {
  await import('@/app/api/v1/customer/support/cases/route')
  await import('@/app/api/v1/customer/support/cases/[reference]/attachments/route')
}, 60_000)

beforeEach(() => {
  resetSupportDb()
  auth.customerId = CUSTOMER_A1
  auth.scopes = ['customer_support.read', 'customer_support.write']
})

describe('F10 closure vs. idempotent replay precedence for support attachments', () => {
  it('replays a previously completed upload after closure with the original result and no new file', async () => {
    const reference = await openCase()
    const route = await import('@/app/api/v1/customer/support/cases/[reference]/attachments/route')
    const first = await route.POST(upload(reference, pdf(), 'key-att-replay-abcdefgh'), params(reference))
    expect(first.status).toBe(201)
    const original = await first.json()
    db.customer_cases[0].status = 'closed'
    const filesBefore = db.customer_case_attachments.length
    const objectsBefore = objects.size

    const replay = await route.POST(upload(reference, pdf(), 'key-att-replay-abcdefgh'), params(reference))
    expect(replay.status).toBe(201)
    expect(replay.headers.get('idempotency-replayed')).toBe('true')
    expect((await replay.json()).data).toEqual(original.data)
    expect(db.customer_case_attachments).toHaveLength(filesBefore)
    expect(objects.size).toBe(objectsBefore)
  })

  it('closure blocks a new write (new key) with 409 support_case_closed and stores nothing', async () => {
    const reference = await openCase()
    db.customer_cases[0].status = 'closed'
    const route = await import('@/app/api/v1/customer/support/cases/[reference]/attachments/route')
    const response = await route.POST(upload(reference, pdf(), 'key-att-new-abcdefghij'), params(reference))
    expect(response.status).toBe(409)
    expect((await response.json()).error.code).toBe('support_case_closed')
    expect(db.customer_case_attachments).toHaveLength(0)
    expect(objects.size).toBe(0)
  })

  it('same key with different bytes after closure is an idempotency conflict, never a new file', async () => {
    const reference = await openCase()
    const route = await import('@/app/api/v1/customer/support/cases/[reference]/attachments/route')
    expect((await route.POST(upload(reference, pdf(), 'key-att-replay-abcdefgh'), params(reference))).status).toBe(201)
    db.customer_cases[0].status = 'closed'
    const conflict = await route.POST(upload(reference, pdf('2 0 obj << >> endobj'), 'key-att-replay-abcdefgh'), params(reference))
    expect(conflict.status).toBe(409)
    expect(db.customer_case_attachments).toHaveLength(1)
  })

  it('current auth and ownership are checked before any replay is returned', async () => {
    const reference = await openCase()
    const route = await import('@/app/api/v1/customer/support/cases/[reference]/attachments/route')
    expect((await route.POST(upload(reference, pdf(), 'key-att-replay-abcdefgh'), params(reference))).status).toBe(201)
    db.customer_cases[0].status = 'closed'

    auth.scopes = ['customer_support.read']
    const noScope = await route.POST(upload(reference, pdf(), 'key-att-replay-abcdefgh'), params(reference))
    expect(noScope.status).toBe(403)
    expect(noScope.headers.get('idempotency-replayed')).toBeNull()

    auth.scopes = ['customer_support.read', 'customer_support.write']
    auth.customerId = CUSTOMER_A2
    const otherCustomer = await route.POST(upload(reference, pdf(), 'key-att-replay-abcdefgh'), params(reference))
    expect(otherCustomer.status).toBe(404)
    expect(otherCustomer.headers.get('idempotency-replayed')).toBeNull()
    expect(db.customer_case_attachments).toHaveLength(1)
  })
})
