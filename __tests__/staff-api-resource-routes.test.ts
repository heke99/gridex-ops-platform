import { createRequire } from 'node:module'
import { NextRequest, NextResponse } from 'next/server'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import document from '@/docs/openapi/staff-support-v1.json'

const { validateResponse } = createRequire(import.meta.url)('../scripts/lib/openapi-schema-validator.cjs') as { validateResponse(document: unknown, path: string, value: unknown, method?: string, status?: string): string[] }
const state = vi.hoisted(() => ({ denied: false, calls: [] as unknown[], authCalls: [] as unknown[], rows: [] as Record<string, unknown>[], command: {} as Record<string, unknown>, error: null as unknown }))
const ids = { companyId: '00000001-0000-4000-8000-000000000001', userId: '00000001-0000-4000-8000-000000000002', sessionId: '00000001-0000-4000-8000-000000000004', nativeSessionId: '00000001-0000-4000-8000-000000000005', sessionRevision: 7, requestId: 'request-test', correlationId: 'correlation-test' }
vi.mock('@/lib/staff-api/auth', () => ({ requireStaffApi: async (_request: NextRequest, input: unknown) => {
  state.authCalls.push(input)
  if (state.denied) return { ok: false, response: NextResponse.json({ error: { code: 'staff_permission_denied' } }, { status: 403 }) }
  return { ok: true, context: { ...ids, client: { id: '00000001-0000-4000-8000-000000000003' }, isPlatformAdmin: false, permissions: ['customers.read', 'cases.read', 'cases.write'], roles: ['support'] } }
} }))
vi.mock('@/lib/supabase/service', () => {
  const client = { rpc: async (name: string, args: unknown) => { state.calls.push({ name, args }); return { data: name === 'staff_api_read_resources' ? { rows: state.rows } : { data: state.command, replayed: true }, error: state.error } } }
  return { supabaseService: client, createSupabaseServiceRequestClient: () => client }
})
const customerReference = `customer_${'A'.repeat(32)}`
const caseReference = `support_case_${'B'.repeat(32)}`
const created = '2026-10-03T12:00:00.000Z'
const request = (path: string, body?: unknown) => new NextRequest(`https://ops.invalid/api/v1/staff/${path}`, body === undefined ? {} : { method: 'POST', headers: { 'Content-Type': 'application/json', 'Idempotency-Key': 'staff-route-test' }, body: JSON.stringify(body) })
beforeEach(() => { state.denied = false; state.calls = []; state.authCalls = []; state.rows = []; state.error = null; state.command = {} })

describe('mounted staff resource HTTP routes and schemas', () => {
  it('uses exact directory permission and a closed safe customer page', async () => {
    const route = await import('@/app/api/v1/staff/customers/route')
    state.rows = [{ id: '00000001-0000-4000-8000-000000000011', customer_number: 'A1', customer_type: 'private', status: 'active', full_name: 'Anna', email: 'fixture@example.invalid', phone: null, created_at: created, personal_number: 'never-return', secret: 'never-return' }]
    const response = await route.GET(request('customers'))
    expect(response.status).toBe(200)
    expect(state.authCalls).toEqual([{ scope: 'staff_customers.read', permission: 'customers.read' }])
    const body = await response.json()
    expect(validateResponse(document, '/api/v1/staff/customers', body)).toEqual([])
    expect(JSON.stringify(body)).not.toContain('never-return')
    expect(body.page).toEqual({ limit: 50, returned: 1, has_more: false, next_cursor: null })
    expect(response.headers.get('cache-control')).toBe('private, no-store')
    expect(response.headers.get('x-gridex-contract-version')).toBe('2026-10-03.1')
  })

  it('all mounted reads and writes stop at a denied guard before database access', async () => {
    state.denied = true
    const reads = [
      (await import('@/app/api/v1/staff/customers/route')).GET(request('customers')),
      (await import('@/app/api/v1/staff/customers/[customerReference]/route')).GET(request(`customers/${customerReference}`), { params: Promise.resolve({ customerReference }) }),
      (await import('@/app/api/v1/staff/customers/[customerReference]/contacts/route')).GET(request(`customers/${customerReference}/contacts`), { params: Promise.resolve({ customerReference }) }),
      (await import('@/app/api/v1/staff/customers/[customerReference]/addresses/route')).GET(request(`customers/${customerReference}/addresses`), { params: Promise.resolve({ customerReference }) }),
      (await import('@/app/api/v1/staff/customers/[customerReference]/facilities/route')).GET(request(`customers/${customerReference}/facilities`), { params: Promise.resolve({ customerReference }) }),
      (await import('@/app/api/v1/staff/support/cases/route')).GET(request('support/cases')),
      (await import('@/app/api/v1/staff/support/cases/[caseReference]/route')).GET(request(`support/cases/${caseReference}`), { params: Promise.resolve({ caseReference }) }),
      (await import('@/app/api/v1/staff/support/cases/[caseReference]/entries/route')).GET(request(`support/cases/${caseReference}/entries`), { params: Promise.resolve({ caseReference }) }),
      (await import('@/app/api/v1/staff/support/assignees/route')).GET(request('support/assignees')),
      (await import('@/app/api/v1/staff/support/cases/route')).POST(request('support/cases', {})),
      (await import('@/app/api/v1/staff/support/cases/[caseReference]/replies/route')).POST(request(`support/cases/${caseReference}/replies`, {}), { params: Promise.resolve({ caseReference }) }),
      (await import('@/app/api/v1/staff/support/cases/[caseReference]/internal-notes/route')).POST(request(`support/cases/${caseReference}/internal-notes`, {}), { params: Promise.resolve({ caseReference }) }),
      (await import('@/app/api/v1/staff/support/cases/[caseReference]/status/route')).POST(request(`support/cases/${caseReference}/status`, {}), { params: Promise.resolve({ caseReference }) }),
      (await import('@/app/api/v1/staff/support/cases/[caseReference]/assignment/route')).POST(request(`support/cases/${caseReference}/assignment`, {}), { params: Promise.resolve({ caseReference }) }),
    ]
    for (const response of await Promise.all(reads)) expect(response.status).toBe(403)
    expect(state.calls).toHaveLength(0)
    const writes = state.authCalls.filter(input => (input as { mutation?: boolean }).mutation)
    expect(writes).toHaveLength(5)
    expect(writes.every(input => JSON.stringify(input) === JSON.stringify({ scope: 'staff_support.write', permission: 'cases.write', mutation: true }))).toBe(true)
  })

  it('projects staff case detail and entries without raw operational metadata', async () => {
    const detail = await import('@/app/api/v1/staff/support/cases/[caseReference]/route')
    state.rows = [{ id: '00000001-0000-4000-8000-000000000011', customer_id: '00000001-0000-4000-8000-000000000012', title: 'Fråga', status: 'open', priority: 'normal', description: 'Internt', created_at: created, updated_at: created, metadata: { secret: true }, company_id: ids.companyId }]
    const response = await detail.GET(request(`support/cases/${caseReference}`), { params: Promise.resolve({ caseReference }) })
    const body = await response.json()
    expect(validateResponse(document, '/api/v1/staff/support/cases/{caseReference}', body)).toEqual([])
    expect(body.data).not.toHaveProperty('metadata')
    expect(body.data).not.toHaveProperty('id')
    const entries = await import('@/app/api/v1/staff/support/cases/[caseReference]/entries/route')
    state.rows = [{ id: '00000001-0000-4000-8000-000000000021', customer_case_id: '00000001-0000-4000-8000-000000000011', event_type: 'support_internal_note', message: 'Internt', payload: { visibility: 'customer', password: 'hidden' }, created_at: created }]
    const entryBody = await (await entries.GET(request(`support/cases/${caseReference}/entries`), { params: Promise.resolve({ caseReference }) })).json()
    expect(entryBody.data[0].visibility).toBe('internal')
    expect(JSON.stringify(entryBody)).not.toContain('hidden')
    expect(validateResponse(document, '/api/v1/staff/support/cases/{caseReference}/entries', entryBody)).toEqual([])
  })

  it('returns the durable replay receipt and rejects spoofed/oversize command input', async () => {
    const route = await import('@/app/api/v1/staff/support/cases/[caseReference]/replies/route')
    state.command = { entry_reference: `support_message_${'C'.repeat(32)}`, case_reference: caseReference, kind: 'staff_reply', visibility: 'customer', author_type: 'staff', author: { staff_reference: `staff_${'D'.repeat(32)}`, display_name: 'Personal' }, body: 'Hej', created_at: created, reply_kind: 'message' }
    const response = await route.POST(request(`support/cases/${caseReference}/replies`, { message: 'Hej' }), { params: Promise.resolve({ caseReference }) })
    expect(response.status).toBe(201)
    expect(response.headers.get('idempotency-replayed')).toBe('true')
    expect(validateResponse(document, '/api/v1/staff/support/cases/{caseReference}/replies', await response.json(), 'post', '201')).toEqual([])
    for (const body of [{ message: 'Hej', actor_user_id: ids.userId }, { message: 'x'.repeat(8001) }, { message: 'Hej', kind: 'internal' }]) {
      const before = state.calls.length
      expect((await route.POST(request(`support/cases/${caseReference}/replies`, body), { params: Promise.resolve({ caseReference }) })).status).toBe(422)
      expect(state.calls.length).toBe(before)
    }
  })

  it('returns the canonical retryable mutation budget response', async () => {
    const route = await import('@/app/api/v1/staff/support/cases/[caseReference]/internal-notes/route')
    state.error = { code: 'P0001', message: 'staff_rate_limited' }
    const response = await route.POST(request(`support/cases/${caseReference}/internal-notes`, { message: 'Intern anteckning' }), { params: Promise.resolve({ caseReference }) })
    expect(response.status).toBe(429)
    expect(response.headers.get('retry-after')).toBe('60')
    const body = await response.json()
    expect(body.error).toMatchObject({ code: 'staff_rate_limited', retryable: true })
    expect(validateResponse(document, '/api/v1/staff/support/cases/{caseReference}/internal-notes', body, 'post', '429')).toEqual([])
    expect(state.calls).toHaveLength(1)
  })

  it('distinguishes temporary session contention from revoked permission', async () => {
    const route = await import('@/app/api/v1/staff/support/cases/[caseReference]/internal-notes/route')
    state.error = { code: '55P03', message: 'staff_session_busy' }
    const response = await route.POST(request(`support/cases/${caseReference}/internal-notes`, { message: 'Intern anteckning' }), { params: Promise.resolve({ caseReference }) })
    expect(response.status).toBe(409)
    expect(response.headers.get('retry-after')).toBe('1')
    expect(await response.json()).toMatchObject({ error: { code: 'staff_session_busy', retryable: true } })
    state.error = { code: '42501', message: 'staff_session_busy' }
    const denied = await route.POST(request(`support/cases/${caseReference}/internal-notes`, { message: 'Intern anteckning' }), { params: Promise.resolve({ caseReference }) })
    expect(denied.status).toBe(403)
    expect(await denied.json()).toMatchObject({ error: { code: 'staff_permission_denied', retryable: false } })
  })

  it('maps database denials/conflicts safely and suppresses database/provider secrets', async () => {
    const route = await import('@/app/api/v1/staff/support/cases/[caseReference]/status/route')
    for (const [error, status, code] of [[{ code: '42501', message: 'secret database policy' }, 403, 'staff_permission_denied'], [{ code: '40001', message: 'support_case_version_conflict' }, 409, 'support_case_version_conflict'], [{ code: 'XX000', message: 'password=secret details' }, 503, 'staff_service_unavailable']] as const) {
      state.error = error
      const response = await route.POST(request(`support/cases/${caseReference}/status`, { status: 'closed', expected_updated_at: created }), { params: Promise.resolve({ caseReference }) })
      expect(response.status).toBe(status)
      const body = await response.json()
      expect(body.error.code).toBe(code)
      expect(JSON.stringify(body)).not.toContain('secret')
    }
  })
})
