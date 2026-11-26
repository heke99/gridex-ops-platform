import { createHash } from 'node:crypto'
import { NextRequest } from 'next/server'
import { beforeEach, expect, it, vi } from 'vitest'
import { POST as createCase } from '@/app/api/v1/customer/support/cases/route'
import { POST as postMessage } from '@/app/api/v1/customer/support/cases/[reference]/messages/route'
import { CUSTOMER_A1, TENANT_A, db, resetSupportDb } from './helpers/supportPortalHarness'

vi.mock('@/lib/supabase/service', async () => (await import('./helpers/supportPortalHarness')).serviceMock)

const auth = vi.hoisted(() => ({ scopes: ['customer_support.write'] }))

vi.mock('@/lib/integrations/apiAuth', async original => {
  const api = await original<typeof import('@/lib/integrations/apiAuth')>()
  return {
    ...api,
    requireIntegrationApiAccess: async (_request: unknown, required: unknown) => {
      const missing = api.missingIntegrationApiScopes(auth.scopes, Array.isArray(required) ? required : [])
      if (missing.length) return { ok: false, status: 403, error: 'Scope saknas.', errorCode: 'api_scope_missing' }
      return { ok: true, client: { id: 'client-a', company_id: TENANT_A, scopes: auth.scopes } }
    },
    logIntegrationApiRequest: async () => undefined,
    currentIntegrationApiResponseContext: () => null,
  }
})
vi.mock('@/lib/customer-portal/customerResolver', async original => ({
  ...await original<typeof import('@/lib/customer-portal/customerResolver')>(),
  resolvePortalCustomer: async () => ({
    ok: true,
    binding: 'portal_account',
    customer: { id: 'portal-identity', company_id: TENANT_A, customer_id: CUSTOMER_A1 },
  }),
}))

const operation = '/api/v1/customer/support/cases/[reference]/messages'

function request(path: string, key: string, body: Record<string, string>) {
  return new NextRequest(new URL(path, 'http://127.0.0.1:1'), {
    method: 'POST',
    headers: { 'content-type': 'application/json', 'idempotency-key': key },
    body: JSON.stringify(body),
  })
}

async function openCase(key: string) {
  const response = await createCase(request('/api/v1/customer/support/cases', key, {
    title: 'Syntetiskt kundärende',
    message: 'Första meddelandet.',
  }))
  expect(response.status).toBe(201)
  const reference = String((await response.json()).data.case_reference)
  const row = db.customer_cases.find(row => (row.metadata as Record<string, unknown>).support_public_reference === reference)
  expect(row).toBeDefined()
  return { reference, id: row?.id }
}

function send(reference: string, key: string, body: Record<string, string>) {
  return postMessage(request(`/api/v1/customer/support/cases/${reference}/messages`, key, body),
    { params: Promise.resolve({ reference }) })
}

function messageReceipts() {
  return db.customer_portal_write_idempotency.filter(row => row.route === operation)
}

function expectedMessageHash(input: { message: string; reference: string }) {
  return createHash('sha256').update(JSON.stringify({ message: input.message, reference: input.reference })).digest('hex')
}

beforeEach(() => {
  resetSupportDb()
  auth.scopes = ['customer_support.write']
})

it('records the authoritative case reference for each independent ordinary write', async () => {
  const first = await openCase('case-first-0123456789')
  const second = await openCase('case-second-0123456789')
  const body = { message: 'Samma testtext för två ärenden.', reference: 'Syntetisk klientanteckning' }

  const firstResponse = await send(first.reference, 'message-first-0123456789', body)
  const secondResponse = await send(second.reference, 'message-second-0123456789', body)
  expect(firstResponse.status).toBe(201)
  expect(secondResponse.status).toBe(201)
  expect(db.customer_case_events.filter(row => row.message === body.message).map(row => row.customer_case_id))
    .toEqual([first.id, second.id])
  expect(messageReceipts().map(row => row.request_hash)).toEqual([
    expectedMessageHash({ message: body.message, reference: first.reference }),
    expectedMessageHash({ message: body.message, reference: second.reference }),
  ])
})

it('preserves the ordinary request digest, exact completed response and one event', async () => {
  const { reference, id } = await openCase('case-ordinary-0123456789')
  const body = { message: 'Vanlig uppföljning.' }
  const first = await send(reference, 'message-ordinary-0123456789', body)
  expect(first.status).toBe(201)
  expect(first.headers.get('idempotency-replayed')).toBe('false')
  expect(messageReceipts()).toHaveLength(1)
  expect(messageReceipts()[0].request_hash).toBe(expectedMessageHash({ ...body, reference }))
  const replay = await send(reference, 'message-ordinary-0123456789', body)
  expect(replay.status).toBe(201)
  expect(replay.headers.get('idempotency-replayed')).toBe('true')
  expect((await replay.json()).data).toEqual((await first.json()).data)
  expect(db.customer_case_events.filter(row => row.message === body.message).map(row => row.customer_case_id))
    .toEqual([id])
})

it('keeps effects and result bound to the original ordinary path when reusing a key', async () => {
  const first = await openCase('case-path-first-0123456789')
  const second = await openCase('case-path-second-0123456789')
  const body = { message: 'En ordinarie följdfråga.' }
  expect((await send(first.reference, 'message-path-0123456789', body)).status).toBe(201)

  const conflict = await send(second.reference, 'message-path-0123456789', body)
  expect(conflict.status).toBe(409)
  expect(await conflict.json()).toMatchObject({ error: { code: 'idempotency_conflict' } })
  expect(conflict.headers.get('idempotency-replayed')).toBeNull()
  expect(messageReceipts()).toHaveLength(1)
  expect(db.customer_case_events.filter(row => row.message === body.message).map(row => row.customer_case_id))
    .toEqual([first.id])
})

it('denies an actor lacking write scope before examining the idempotency receipt', async () => {
  const { reference } = await openCase('case-scope-0123456789')
  auth.scopes = ['customer_support.read']
  const denied = await send(reference, 'message-scope-0123456789', { message: 'Ordinarie uppföljning.' })
  expect(denied.status).toBe(403)
  expect(messageReceipts()).toHaveLength(0)
})
