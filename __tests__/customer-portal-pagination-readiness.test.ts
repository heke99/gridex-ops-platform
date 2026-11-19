import { createClient } from '@supabase/supabase-js'
import { NextRequest } from 'next/server'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { GET as getDocuments } from '@/app/api/v1/customer/documents/route'
import { GET as getEvents } from '@/app/api/v1/customer/events/route'
import { bindAuthenticatedApiResponseProfile } from '@/lib/integrations/apiResponseProfile'
import type { IntegrationApiClient } from '@/lib/integrations/apiAuth'

const companyId = '00000000-0000-4000-8000-000000000001'
const customerId = '00000000-0000-4000-8000-000000000002'
const retentionRpc = 'ediel_require_portal_retention_access_v1'
const requestAudit = 'customer_portal_api_access_logs'
const privateDatabaseDetail = 'synthetic private schema detail'
const secretDatabaseHint = 'synthetic private database hint'
const endpoints = [
  { path: 'documents', rpc: 'portal_customer_documents_page_v1', scope: 'customer_documents.read', get: getDocuments },
  { path: 'events', rpc: 'portal_customer_events_page_v1', scope: 'customer_events.read', get: getEvents },
] as const

type Failure = { name: string; code: string; message: string; status: number }
const transport = vi.hoisted(() => ({
  calls: [] as Array<{ name: string; method: string | undefined; body: Record<string, unknown> }>,
  logs: [] as Array<{ statusCode: number; errorCode?: string; requestId?: string }>,
  scopes: [] as Array<readonly string[]>,
  failure: null as Failure | null,
  legacy: false,
  authorized: true,
}))

vi.mock('server-only', () => ({}))
vi.mock('@/lib/integrations/apiAuth', async original => ({
  ...await original<typeof import('@/lib/integrations/apiAuth')>(),
  logIntegrationApiRequest: async (log: typeof transport.logs[number]) => { transport.logs.push(log) },
}))
vi.mock('@/lib/customer-portal/externalApi', async original => {
  const actual = await original<typeof import('@/lib/customer-portal/externalApi')>()
  return {
    ...actual,
    requireCustomerPortalApiContext: async (request: NextRequest, scope: string[]) => {
      transport.scopes.push(scope)
      if (!transport.authorized) return actual.requireCustomerPortalApiContext(request, scope)
      const client = {
        id: 'synthetic-client', company_id: companyId,
        metadata: transport.legacy ? { api_contract_profiles: { customer: '2026-10-04.1' } } : {},
      } as IntegrationApiClient
      bindAuthenticatedApiResponseProfile(client)
      return {
        ok: true, client, startedAt: 0,
        identity: { customer_id: customerId, external_customer_id: null, customer_number: null, provider: 'fixture' },
      }
    },
  }
})
vi.mock('@/lib/supabase/service', () => ({
  supabaseService: createClient('https://fixture.invalid', 'synthetic-key', {
    auth: { persistSession: false, autoRefreshToken: false },
    global: { fetch: async (input, init) => {
      const url = new URL(String(input))
      const name = url.pathname.split('/').at(-1) ?? ''
      if (url.origin !== 'https://fixture.invalid' || ![retentionRpc, requestAudit, ...endpoints.map(e => e.rpc)].includes(name)) {
        throw new Error(`Unexpected synthetic transport operation: ${name}`)
      }
      transport.calls.push({ name, method: init?.method, body: JSON.parse(String(init?.body ?? '{}')) })
      const failure = transport.failure
      if (failure?.name === name) return Response.json({
        code: failure.code, message: failure.message, details: privateDatabaseDetail, hint: secretDatabaseHint,
      }, { status: failure.status })
      if (name === requestAudit) return new Response(null, { status: 201 })
      return Response.json(name === retentionRpc ? null : [])
    } },
  }),
}))

const request = (path: string) => new NextRequest(`https://fixture.invalid/api/v1/customer/${path}?limit=1`)
const missingCached = (name: string): Failure => ({
  name, code: 'PGRST202', status: 404,
  message: `Could not find the function public.${name}(p_company_id, p_customer_id, p_limit) in the schema cache`,
})

beforeEach(() => {
  Object.assign(transport, { calls: [], logs: [], scopes: [], failure: null, legacy: false, authorized: true })
  vi.spyOn(console, 'error').mockImplementation(() => undefined)
})
afterEach(() => vi.restoreAllMocks())

function expectSafeEnvelope(response: Response, body: { error: Record<string, unknown>; request_id: string; correlation_id: string }) {
  expect(body.request_id).toEqual(expect.any(String))
  expect(body.correlation_id).toBe(body.request_id)
  expect(response.headers.get('X-Request-ID')).toBe(body.request_id)
  expect(response.headers.get('Cache-Control')).toBe('no-store')
  expect(JSON.stringify(body)).not.toContain(privateDatabaseDetail)
  expect(JSON.stringify(body)).not.toContain(secretDatabaseHint)
}

describe.each(endpoints)('mounted customer $path pagination', ({ path, rpc, scope, get }) => {
  it.each(['PGRST202', '42883'] as const)('returns retryable 503 for the exact missing RPC (%s)', async code => {
    transport.failure = code === 'PGRST202' ? missingCached(rpc) : {
      name: rpc, code, status: 404, message: `function public.${rpc}(uuid, uuid, integer) does not exist`,
    }
    const response = await get(request(path))
    expect(response.status).toBe(503)
    const body = await response.json()
    expect(body.error).toMatchObject({ code: 'platform_schema_not_ready', retryable: true, field: null, blockers: [] })
    expectSafeEnvelope(response, body)
    expect(transport.scopes).toEqual([[scope]])
    expect(transport.calls.map(call => call.name)).toEqual([retentionRpc, requestAudit, rpc])
    expect(transport.calls[2]).toMatchObject({ method: 'POST', body: { p_company_id: companyId, p_customer_id: customerId, p_limit: 2 } })
    expect(transport.logs).toEqual([expect.objectContaining({ statusCode: 503, errorCode: 'platform_schema_not_ready', requestId: body.request_id })])
  })

  it('preserves the legacy representation while reporting the missing RPC', async () => {
    transport.legacy = true
    transport.failure = missingCached(rpc)
    const response = await get(request(path))
    expect(response.status).toBe(503)
    expect(response.headers.get('X-Gridex-Contract-Version')).toBe('2026-10-04.1')
    const body = await response.json()
    expect(body.contract_schema_version).toBe('2026-10-04.1')
    expect(body.error.code).toBe('platform_schema_not_ready')
    expectSafeEnvelope(response, body)
  })

  it('accepts the alternate missing-RPC wording documented by PostgREST', async () => {
    transport.failure = {
      ...missingCached(rpc),
      message: `Could not find the public.${rpc}(p_company_id, p_customer_id, p_limit) function in the schema cache`,
    }
    const response = await get(request(path))
    expect(response.status).toBe(503)
    expect((await response.json()).error.code).toBe('platform_schema_not_ready')
  })

  it.each(['permission denied', 'unrelated missing RPC', 'retention failed'] as const)('keeps the existing 500 on %s', async kind => {
    const cases = {
      'permission denied': { name: rpc, code: '42501', message: 'ordinary SQL denial', status: 403 },
      'unrelated missing RPC': { ...missingCached(`${rpc}_other`), name: rpc },
      'retention failed': missingCached(retentionRpc),
    }
    transport.failure = cases[kind]
    const response = await get(request(path))
    expect(response.status).toBe(500)
    const body = await response.json()
    expect(body.error).toMatchObject({ code: 'customer_portal_internal_error', retryable: false })
    expectSafeEnvelope(response, body)
    expect(transport.logs).toEqual([expect.objectContaining({ statusCode: 500, errorCode: 'customer_portal_internal_error' })])
    if (kind === 'retention failed') expect(transport.calls.map(call => call.name)).toEqual([retentionRpc])
  })

  it('retains the normal empty page', async () => {
    const response = await get(request(path))
    expect(response.status).toBe(200)
    expect(await response.json()).toMatchObject({ data: [], page: { returned: 0, has_more: false, next_cursor: null } })
  })

  it('uses the existing anonymous error before any read or audit write', async () => {
    transport.authorized = false
    const response = await get(request(path))
    expect(response.status).toBe(401)
    expect(transport.calls).toEqual([])
  })
})
