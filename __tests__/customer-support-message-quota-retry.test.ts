import { randomUUID } from 'node:crypto'
import { createClient } from '@supabase/supabase-js'
import { NextRequest, NextResponse } from 'next/server'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { POST } from '@/app/api/v1/customer/support/cases/[reference]/messages/route'

type Row = Record<string, unknown>

const fixture = vi.hoisted(() => ({
  origin: 'https://fixture.invalid',
  ledger: null as Row | null,
  rpcError: null as { code: string; message: string } | null,
  transitions: [] as string[],
  messageCalls: 0,
  messagesWritten: 0,
  authorized: true,
}))

const companyId = '00000000-0000-4000-8000-000000000001'
const customerId = '00000000-0000-4000-8000-000000000002'
const caseId = '00000000-0000-4000-8000-000000000003'
const clientId = '00000000-0000-4000-8000-000000000004'
const identityId = '00000000-0000-4000-8000-000000000005'
const reference = 'support_case_synthetic_fixture'
const operation = '/api/v1/customer/support/cases/[reference]/messages'
const idempotencyKey = 'synthetic-message-attempt'
const message = 'Samma meddelande efter att timkvoten släppt.'
const quota = { code: 'P0001', message: 'support_message_quota_exceeded' }

vi.mock('server-only', () => ({}))
vi.mock('@/lib/supabase/service', () => ({
  supabaseService: createClient(fixture.origin, 'fixture-key', {
    auth: { persistSession: false, autoRefreshToken: false },
    global: { fetch: fixtureFetch },
  }),
}))
vi.mock('@/lib/customer-portal/externalApi', async (original) => ({
  ...await original<typeof import('@/lib/customer-portal/externalApi')>(),
  requireCustomerPortalApiContext: async (_request: NextRequest, scopes: string[], options: unknown) => {
    expect(scopes).toEqual(['customer_support.write'])
    expect(options).toEqual({ enforceBinding: true })
    if (!fixture.authorized) return { ok: false, response: NextResponse.json({ error: { code: 'scope_required' } }, { status: 403 }) }
    return {
      ok: true, client: { id: clientId, company_id: companyId },
      identity: { id: identityId, customer_id: customerId }, startedAt: Date.now(),
    }
  },
}))
vi.mock('@/lib/integrations/apiAuth', async (original) => ({
  ...await original<typeof import('@/lib/integrations/apiAuth')>(),
  logIntegrationApiRequest: vi.fn(),
}))

function bodyOf(init?: RequestInit): Row {
  expect(typeof init?.body).toBe('string')
  return JSON.parse(String(init?.body)) as Row
}

async function fixtureFetch(input: RequestInfo | URL, init?: RequestInit): Promise<Response> {
  const url = new URL(input instanceof Request ? input.url : String(input))
  expect(url.origin).toBe(fixture.origin)
  const method = init?.method ?? 'GET'
  const search = url.searchParams
  const table = url.pathname.split('/').at(-1)

  if (table === 'customer_cases' && method === 'GET') {
    expect(search.get('company_id')).toBe(`eq.${companyId}`)
    expect(search.get('customer_id')).toBe(`eq.${customerId}`)
    expect(search.get('metadata->>support_case')).toBe('eq.true')
    expect(search.get('metadata->>support_public_reference')).toBe(`eq.${reference}`)
    return Response.json([{ id: caseId, company_id: companyId, customer_id: customerId, status: 'open' }])
  }

  if (url.pathname === '/rest/v1/rpc/gridex_add_customer_support_message_v1' && method === 'POST') {
    fixture.messageCalls += 1
    expect(bodyOf(init)).toEqual({
      p_company_id: companyId, p_customer_id: customerId, p_case_id: caseId,
      p_api_client_id: clientId, p_portal_identity_id: identityId, p_message: message,
    })
    if (fixture.rpcError) return Response.json(fixture.rpcError, { status: 400 })
    fixture.messagesWritten += 1
    return Response.json({
      id: randomUUID(), customer_case_id: caseId, event_type: 'support_customer_message',
      message, payload: { visibility: 'customer' }, created_at: '2026-11-19T12:00:00Z',
    })
  }

  if (table !== 'customer_portal_write_idempotency') throw new Error(`Unexpected synthetic operation ${method} ${table}`)
  if (method === 'POST') {
    const row = bodyOf(init)
    expect(row).toMatchObject({ company_id: companyId, customer_id: customerId, api_client_id: clientId, route: operation, idempotency_key: idempotencyKey, status: 'processing' })
    if (fixture.ledger) return Response.json({ code: '23505', message: 'unique idempotency scope' }, { status: 409 })
    fixture.ledger = { ...row, id: randomUUID() }
    fixture.transitions.push('processing')
    return Response.json([fixture.ledger])
  }
  if (method === 'GET') {
    expect(Object.fromEntries([...search].filter(([field]) => field !== 'select'))).toEqual({
      company_id: `eq.${companyId}`, customer_id: `eq.${customerId}`, api_client_id: `eq.${clientId}`,
      route: `eq.${operation}`, idempotency_key: `eq.${idempotencyKey}`,
    })
    return Response.json(fixture.ledger ? [fixture.ledger] : [])
  }
  expect(search.get('id')).toBe(`eq.${fixture.ledger?.id}`)
  expect(search.get('company_id')).toBe(`eq.${companyId}`)
  expect(search.get('status')).toBe('eq.processing')
  expect(fixture.ledger?.status).toBe('processing')
  if (method === 'DELETE') {
    fixture.ledger = null
    fixture.transitions.push('released')
    return new Response(null, { status: 204 })
  }
  if (method === 'PATCH') {
    const patch = bodyOf(init)
    fixture.ledger = { ...fixture.ledger, ...patch }
    fixture.transitions.push(String(patch.status))
    return search.has('select') ? Response.json([{ id: fixture.ledger.id }]) : new Response(null, { status: 204 })
  }
  throw new Error(`Unexpected synthetic ledger method ${method}`)
}

function post(text = message) {
  return POST(new NextRequest(`${fixture.origin}/api/v1/customer/support/cases/${reference}/messages`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'Idempotency-Key': idempotencyKey },
    body: JSON.stringify({ message: text }),
  }), { params: Promise.resolve({ reference }) })
}

beforeEach(() => {
  Object.assign(fixture, { ledger: null, rpcError: null, transitions: [], messageCalls: 0, messagesWritten: 0, authorized: true })
})

describe('API-68 next attempt after the customer support message quota', () => {
  it('keeps the key free on two refusals, then writes and replays exactly one message', async () => {
    fixture.rpcError = quota
    const limited = await post()
    const limitedAgain = await post()
    fixture.rpcError = null
    const sent = await post()
    const replay = await post()
    const different = await post('Alternativ text med samma nyckel')

    expect([limited.status, limitedAgain.status, sent.status, replay.status, different.status]).toEqual([429, 429, 201, 201, 409])
    expect(limited.headers.get('Retry-After')).toBe('3600')
    expect(limitedAgain.headers.get('Retry-After')).toBe('3600')
    expect((await limited.json()).error.code).toBe('support_quota_exceeded')
    expect(sent.headers.get('Idempotency-Replayed')).toBe('false')
    expect(replay.headers.get('Idempotency-Replayed')).toBe('true')
    const sentBody = await sent.json()
    const replayBody = await replay.json()
    expect(replayBody.data).toEqual(sentBody.data)
    expect(replayBody.contract_schema_version).toBe(sentBody.contract_schema_version)
    expect(replayBody.request_id).not.toBe(sentBody.request_id)
    expect((await different.json()).error.code).toBe('idempotency_conflict')
    expect(fixture.transitions).toEqual(['processing', 'released', 'processing', 'released', 'processing', 'completed'])
    expect([fixture.messageCalls, fixture.messagesWritten]).toEqual([3, 1])
  })

  it.each([
    ['unproven quota string', { code: 'XX000', message: quota.message }, 500],
    ['closed case', { code: 'P0001', message: 'support_case_closed' }, 409],
  ])('preserves existing failed-key handling for %s', async (_label, rpcError, status) => {
    fixture.rpcError = rpcError
    const refused = await post()
    expect(refused.status).toBe(status)
    expect(refused.headers.has('Retry-After')).toBe(false)
    fixture.rpcError = null
    const subsequent = await post()
    expect(subsequent.status).toBe(409)
    expect((await subsequent.json()).error.code).toBe('idempotency_previous_attempt_failed')
    expect(fixture.transitions).toEqual(['processing', 'failed'])
    expect([fixture.messageCalls, fixture.messagesWritten]).toEqual([1, 0])
  })

  it('rejects missing authorization before the ledger and message command', async () => {
    fixture.authorized = false
    const refused = await post()
    expect(refused.status).toBe(403)
    expect(refused.headers.has('Retry-After')).toBe(false)
    expect(fixture.transitions).toEqual([])
    expect(fixture.messageCalls).toBe(0)
  })
})
