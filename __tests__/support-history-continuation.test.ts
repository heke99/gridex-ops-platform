// ops-api-review: F8, F9
import { NextRequest } from 'next/server'
import { beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'
import { CUSTOMER_A1, CUSTOMER_A2, TENANT_A, TENANT_B, db, nextId, resetSupportDb } from './helpers/supportPortalHarness'

vi.mock('@/lib/supabase/service', async () => (await import('./helpers/supportPortalHarness')).serviceMock)

const auth = vi.hoisted(() => ({ customerId: '', companyId: '' }))
vi.mock('@/lib/integrations/apiAuth', async (importOriginal) => {
  const original = await importOriginal<typeof import('@/lib/integrations/apiAuth')>()
  return {
    ...original,
    requireIntegrationApiAccess: async () => ({ ok: true, client: { id: 'client-a', company_id: auth.companyId, scopes: ['customer_support.read', 'customer_support.write'] }, context: {}, rateLimit: null }),
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
      customer: { id: 'ident-a1', company_id: auth.companyId, customer_id: auth.customerId, external_customer_id: null, customer_number: 'A-1', email: null, auth_user_id: null, customer_portal_user_id: null, match_strength: 'strong', match_method: 'test', provider: 'test' },
    }),
  }
})

function request(method: string, path: string, body?: unknown, key?: string) {
  return new NextRequest(`https://app.gridex.se${path}`, {
    method,
    headers: { 'content-type': 'application/json', ...(key ? { 'idempotency-key': key } : {}) },
    body: body === undefined ? undefined : JSON.stringify(body),
  })
}
const params = (reference: string) => ({ params: Promise.resolve({ reference }) })

async function openCase(key = 'key-case-0001-abcdefgh'): Promise<string> {
  const cases = await import('@/app/api/v1/customer/support/cases/route')
  const created = await cases.POST(request('POST', '/api/v1/customer/support/cases', { title: 'Faktura', message: 'Hej.' }, key))
  expect(created.status).toBe(201)
  return (await created.json()).data.case_reference
}

beforeAll(async () => {
  await import('@/app/api/v1/customer/support/cases/route')
  await import('@/app/api/v1/customer/support/cases/[reference]/route')
  await import('@/app/api/v1/customer/support/cases/[reference]/messages/route')
  await import('@/app/api/v1/customer/support/cases/[reference]/attachments/route')
}, 60_000)

beforeEach(() => {
  resetSupportDb()
  auth.customerId = CUSTOMER_A1
  auth.companyId = TENANT_A
})

async function seedMessages(count: number) {
  const reference = await openCase()
  const template = db.customer_case_events.find((row) => row.event_type === 'support_customer_message')!
  expect(template).toBeTruthy()
  const caseId = String(db.customer_cases[0].id)
  db.customer_case_events = [
    ...Array.from({ length: count }, (_, i) => ({ ...template, id: nextId(), customer_case_id: caseId, message: `Customer message ${i}`, created_at: new Date(Date.UTC(2024, 0, 1) + Math.floor(i / 3) * 86_400_000).toISOString() })),
    // Internal notes must never appear or shift continuation.
    { ...template, id: nextId(), customer_case_id: caseId, event_type: 'support_internal_note', message: 'internal', payload: { visibility: 'internal' }, created_at: new Date(Date.UTC(2023, 0, 1)).toISOString() },
  ]
  return reference
}

async function seedAttachments(count: number) {
  const reference = await openCase()
  const caseId = String(db.customer_cases[0].id)
  const row = (i: number, extra: Record<string, unknown> = {}) => ({
    id: nextId(), company_id: TENANT_A, customer_id: CUSTOMER_A1, customer_case_id: caseId, public_reference: `support_attachment_${String(i).padStart(24, 'a')}`,
    file_name: `f${i}.pdf`, detected_mime_type: 'application/pdf', byte_size: 10, sha256: 'a'.repeat(64), storage_path: `p/${i}`, visibility: 'customer', uploaded_by_kind: 'customer', scan_status: 'released',
    created_at: new Date(Date.UTC(2024, 0, 1) + Math.floor(i / 2) * 86_400_000).toISOString(), ...extra,
  })
  db.customer_case_attachments = [
    ...Array.from({ length: count }, (_, i) => row(i)),
    row(9000, { visibility: 'internal', public_reference: 'support_attachment_internal' }),
    row(9001, { scan_status: 'quarantined', public_reference: 'support_attachment_quarantined' }),
  ]
  return reference
}

describe('F8 support message history continuation', () => {
  it('keeps the V1 first page (oldest 500, body shape unchanged) and returns the 501st message via cursor', async () => {
    const reference = await seedMessages(501)
    const route = await import('@/app/api/v1/customer/support/cases/[reference]/messages/route')
    const first = await route.GET(request('GET', `/api/v1/customer/support/cases/${reference}/messages`), params(reference))
    expect(first.status).toBe(200)
    const firstBody = await first.json()
    expect(firstBody.data).toHaveLength(500)
    expect(firstBody).not.toHaveProperty('page')
    expect(firstBody.data[0].body).toBe('Customer message 0')
    const cursor = first.headers.get('x-gridex-next-cursor')
    expect(cursor).toBeTruthy()

    const second = await route.GET(request('GET', `/api/v1/customer/support/cases/${reference}/messages?cursor=${encodeURIComponent(cursor!)}`), params(reference))
    expect(second.status).toBe(200)
    const secondBody = await second.json()
    expect(secondBody.data.map((m: { body: string }) => m.body)).toEqual(['Customer message 500'])
    expect(second.headers.get('x-gridex-next-cursor')).toBeNull()
    const all = [...firstBody.data, ...secondBody.data].map((m: { message_reference: string }) => m.message_reference)
    expect(new Set(all).size).toBe(501)
    expect(JSON.stringify([firstBody, secondBody])).not.toContain('internal')
  })

  it('case detail keeps its 500-message preview and announces continuation', async () => {
    const reference = await seedMessages(501)
    const route = await import('@/app/api/v1/customer/support/cases/[reference]/route')
    const detail = await route.GET(request('GET', `/api/v1/customer/support/cases/${reference}`), params(reference))
    expect(detail.status).toBe(200)
    expect((await detail.json()).data.messages).toHaveLength(500)
    expect(detail.headers.get('x-gridex-next-cursor')).toBeTruthy()
  })

  it('no continuation header at exactly 500 messages', async () => {
    const reference = await seedMessages(500)
    const route = await import('@/app/api/v1/customer/support/cases/[reference]/messages/route')
    const first = await route.GET(request('GET', `/api/v1/customer/support/cases/${reference}/messages`), params(reference))
    expect((await first.json()).data).toHaveLength(500)
    expect(first.headers.get('x-gridex-next-cursor')).toBeNull()
  })

  it('rejects tampered, other-case, other-customer and other-tenant cursors', async () => {
    const reference = await seedMessages(501)
    const route = await import('@/app/api/v1/customer/support/cases/[reference]/messages/route')
    const cursor = (await route.GET(request('GET', '/x'), params(reference))).headers.get('x-gridex-next-cursor')!
    const get = (ref: string, c: string) => route.GET(request('GET', `/x?cursor=${encodeURIComponent(c)}`), params(ref))

    const tampered = await get(reference, cursor.slice(0, -2) + (cursor.endsWith('AA') ? 'BB' : 'AA'))
    expect(tampered.status).toBe(400)
    expect((await tampered.json()).error.code).toBe('invalid_cursor')
    expect((await get(reference, 'anything')).status).toBe(400)

    const otherCase = await openCase('key-case-0002-abcdefgh')
    expect((await get(otherCase, cursor)).status).toBe(400)

    auth.customerId = CUSTOMER_A2
    const otherCustomerCase = await openCase('key-case-0003-abcdefgh')
    expect((await get(otherCustomerCase, cursor)).status).toBe(400)
    expect((await get(reference, cursor)).status).toBe(404)

    auth.companyId = TENANT_B
    auth.customerId = CUSTOMER_A1
    expect([400, 404]).toContain((await get(reference, cursor)).status)
  })
})

describe('F9 support attachment list continuation', () => {
  it('keeps the V1 first page (oldest 100) and returns the 101st released attachment via cursor', async () => {
    const reference = await seedAttachments(101)
    const route = await import('@/app/api/v1/customer/support/cases/[reference]/attachments/route')
    const first = await route.GET(request('GET', `/x`), params(reference))
    expect(first.status).toBe(200)
    const firstBody = await first.json()
    expect(firstBody).not.toHaveProperty('page')
    expect(firstBody.data).toHaveLength(100)
    const cursor = first.headers.get('x-gridex-next-cursor')
    expect(cursor).toBeTruthy()
    const second = await route.GET(request('GET', `/x?cursor=${encodeURIComponent(cursor!)}`), params(reference))
    const secondBody = await second.json()
    expect(secondBody.data.map((a: { attachment_reference: string }) => a.attachment_reference)).toEqual([db.customer_case_attachments[100].public_reference])
    expect(second.headers.get('x-gridex-next-cursor')).toBeNull()
    const refs = [...firstBody.data, ...secondBody.data].map((a: { attachment_reference: string }) => a.attachment_reference)
    expect(new Set(refs).size).toBe(101)
    expect(refs).not.toContain('support_attachment_internal')
    expect(refs).not.toContain('support_attachment_quarantined')
  })

  it('rejects a tampered cursor and a message cursor reused on attachments', async () => {
    const reference = await seedAttachments(101)
    const route = await import('@/app/api/v1/customer/support/cases/[reference]/attachments/route')
    const cursor = (await route.GET(request('GET', '/x'), params(reference))).headers.get('x-gridex-next-cursor')!
    const tampered = await route.GET(request('GET', `/x?cursor=${encodeURIComponent(cursor.slice(0, -2) + (cursor.endsWith('AA') ? 'BB' : 'AA'))}`), params(reference))
    expect(tampered.status).toBe(400)
    const template = db.customer_case_events.find((row) => row.event_type === 'support_customer_message')!
    db.customer_case_events = Array.from({ length: 501 }, (_, i) => ({ ...template, id: nextId(), created_at: new Date(Date.UTC(2024, 0, 1) + i * 1000).toISOString() }))
    const messages = await import('@/app/api/v1/customer/support/cases/[reference]/messages/route')
    const messageCursor = (await messages.GET(request('GET', '/x'), params(reference))).headers.get('x-gridex-next-cursor')!
    expect(messageCursor).toBeTruthy()
    expect((await route.GET(request('GET', `/x?cursor=${encodeURIComponent(messageCursor)}`), params(reference))).status).toBe(400)
  })
})
