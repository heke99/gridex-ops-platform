import { NextRequest } from 'next/server'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const ids = vi.hoisted(() => ({
  user: '1e47e4a2-6137-40e4-8cf3-a03cf82ff2de',
  company: '9dfbe999-7619-4728-96d6-e6d524f0310c',
  other: '528201d2-4cd5-4b80-b71b-2ba16edd0158',
  normalized: '675b8923-5f72-4c26-9f39-9d687f06b92d',
  contract: '26b0bee4-ab04-4820-8424-89b5acc7bd67',
  close: 'e91dbc8a-c4db-4ee5-b096-96b3fef8a32a',
}))
const ports = vi.hoisted(() => ({
  user: true,
  contexts: [] as Record<string, unknown>[],
  contextCompanies: [] as (string | null)[],
  operationalCompanies: [] as Array<{ user: string; company: string }>,
  operational: true,
  calls: [] as Array<{ pathname: string; method: string; body: unknown }>,
  reply: { status: 200, body: null } as { status: number; body: unknown },
  legacyLoads: 0,
}))

vi.mock('next/headers', () => ({
  cookies: async () => ({
    get: (key: string) => key === 'gridex_admin_selected_company_id' ? { value: ids.company } : undefined,
  }),
}))

vi.mock('@/lib/supabase/server', () => ({
  createSupabaseServerClient: async () => ({
    auth: { getUser: async () => ({ data: { user: ports.user ? { id: ids.user } : null }, error: null }) },
    rpc: async (name: string, args: { p_selected_company_id: string | null }) => {
      if (name !== 'canonical_authenticated_tenant_context' || !ports.contexts.length) {
        throw new Error('unexpected authenticated context lookup')
      }
      ports.contextCompanies.push(args.p_selected_company_id)
      return { data: ports.contexts.shift(), error: null }
    },
  }),
}))

vi.mock('@/lib/tenant/scope', () => ({
  assertUserCanOperateCompany: async (user: string, company: string) => {
    ports.operationalCompanies.push({ user, company })
    if (!ports.operational) throw new Error('Bolaget är pausat eller inte operativt.')
    return company
  },
}))

vi.mock('@/lib/supabase/service', async () => {
  const { createClient } = await import('@supabase/supabase-js')
  return {
    supabaseService: createClient('http://127.0.0.1:1', 'synthetic-test-only', {
      auth: { persistSession: false, autoRefreshToken: false },
      global: {
        async fetch(input, init) {
          const request = new Request(input, init)
          const pathname = new URL(request.url).pathname
          if (![
            '/rest/v1/rpc/gridex_requalify_planned_move_out_metering_value_v1',
            '/rest/v1/rpc/gridex_read_mixed_e66_billing_readiness_batch_v1',
          ].includes(pathname)) throw new Error('unexpected service transport')
          ports.calls.push({ pathname, method: request.method, body: await request.json() })
          return Response.json(ports.reply.body, { status: ports.reply.status })
        },
      },
    }),
  }
})

vi.mock('@/lib/billing/sourceBasis', () => ({
  loadQualifiedBillingValues: async () => { ports.legacyLoads += 1; throw new Error('unexpected legacy load') },
}))

vi.mock('@/lib/billing/meterValueBillingMatcher', () => ({
  updateMeterValueBillingReadiness: async () => { throw new Error('unexpected legacy gate write') },
}))

import { POST } from '@/app/api/internal/billing/requalify-single-e66/route'
import { POST as legacyMixedPost } from '@/app/api/internal/billing/qualify-mixed-e66/route'

const permissions = ['metering.write', 'billing_underlay.write']
const command = { normalizedValueId: ids.normalized, environment: 'test' }
const expectedCall = {
  pathname: '/rest/v1/rpc/gridex_requalify_planned_move_out_metering_value_v1',
  method: 'POST',
  body: {
    p_company_id: ids.company,
    p_actor_user_id: ids.user,
    p_environment: 'test',
    p_normalized_value_id: ids.normalized,
  },
}
const nativeClose = {
  contractId: ids.contract,
  eventId: ids.close,
  effectiveDate: '2026-10-20',
  cutoffAt: '2026-10-20T22:00:00+00:00',
  recordedAt: '2026-10-21T08:47:03.123456+00:00',
}

function context(extra: Record<string, unknown> = {}) {
  return {
    authorized: true,
    user_id: ids.user,
    is_platform_admin: false,
    selected_company_id: ids.company,
    roles: ['company_admin'],
    permissions,
    active_permission_keys: permissions,
    denied_permissions: [],
    ...extra,
  }
}

function request(body: unknown = command, endpoint = 'requalify-single-e66', contentType = 'application/json') {
  return new NextRequest('http://127.0.0.1/api/internal/billing/' + endpoint, {
    method: 'POST',
    headers: { 'content-type': contentType },
    body: JSON.stringify(body),
  })
}

function nativeError(status: number, code: string, message: string) {
  ports.reply = { status, body: { code, message, details: 'INTERNAL_DETAIL', hint: null } }
}

beforeEach(() => {
  vi.restoreAllMocks()
  vi.spyOn(console, 'error').mockImplementation(() => undefined)
  ports.user = true
  ports.contexts = [context(), context()]
  ports.contextCompanies = []
  ports.operationalCompanies = []
  ports.operational = true
  ports.calls = []
  ports.reply = {
    status: 200,
    body: { normalizedValueId: ids.normalized, receipt: nativeClose, replayed: false },
  }
  ports.legacyLoads = 0
})

describe('scheduled move-out billing gate, one already eligible E66 observation', () => {
  it('shows why the existing ordinary mixed route cannot service a single value', async () => {
    expect((await legacyMixedPost(request(command, 'qualify-mixed-e66'))).status).toBe(400)
    expect(ports.calls).toEqual([])
    ports.contexts = [context(), context()]
    nativeError(404, 'P0002', 'mixed_e66_billing_readiness_projection_missing')
    expect((await legacyMixedPost(request({ rawUnderlayId: ids.normalized }, 'qualify-mixed-e66'))).status).toBe(404)
    expect(ports.calls.map(call => call.pathname)).toEqual(['/rest/v1/rpc/gridex_read_mixed_e66_billing_readiness_batch_v1'])
    expect(ports.legacyLoads).toBe(0)
  })

  it.each([false, true])('binds one exact source request and returns only the result (replayed=%s)', async replayed => {
    ports.reply.body = { normalizedValueId: ids.normalized, receipt: nativeClose, replayed }
    const result = await POST(request({ ...command, normalizedValueId: ids.normalized.toUpperCase() }))
    expect(result.status).toBe(200)
    expect(await result.json()).toEqual({ data: { normalizedValueId: ids.normalized, replayed } })
    expect(ports.contextCompanies).toEqual([ids.company, ids.company])
    expect(ports.operationalCompanies).toEqual([{ user: ids.user, company: ids.company }])
    expect(ports.calls).toEqual([expectedCall])
  })

  it('passes a requested Ediel environment as a native scope, without fallbacks', async () => {
    nativeError(400, '23514', 'planned_move_out_requalification_value_scope_mismatch')
    const result = await POST(request({ ...command, environment: 'production' }))
    expect(result.status).toBe(404)
    expect(ports.calls).toEqual([{ ...expectedCall, body: { ...expectedCall.body, p_environment: 'production' } }])
  })

  it('rejects a request without a session before any company lookup', async () => {
    ports.user = false
    expect((await POST(request())).status).toBe(401)
    expect(ports.contextCompanies).toEqual([])
    expect(ports.calls).toEqual([])
  })

  it.each(permissions)('requires both permissions, even if %s is granted', async permission => {
    ports.contexts = [context({ permissions: [permission] })]
    expect((await POST(request())).status).toBe(403)
    expect(ports.operationalCompanies).toEqual([])
    expect(ports.calls).toEqual([])
  })

  it('does not select a default company on behalf of a platform operator', async () => {
    ports.contexts = [context({ is_platform_admin: true, selected_company_id: null })]
    expect((await POST(request())).status).toBe(403)
    expect(ports.operationalCompanies).toEqual([])
    expect(ports.calls).toEqual([])
  })

  it('refuses a permission revoked in the operational scope recheck', async () => {
    ports.contexts = [context(), context({ denied_permissions: ['billing_underlay.write'] })]
    expect((await POST(request())).status).toBe(500)
    expect(ports.contextCompanies).toEqual([ids.company, ids.company])
    expect(ports.calls).toEqual([])
  })

  it('refuses a canonical company mismatch in the operational scope recheck', async () => {
    ports.contexts = [context(), context({ selected_company_id: ids.other })]
    expect((await POST(request())).status).toBe(500)
    expect(ports.calls).toEqual([])
  })

  it('keeps a paused company outside the native command', async () => {
    ports.operational = false
    expect((await POST(request())).status).toBe(500)
    expect(ports.contextCompanies).toEqual([ids.company])
    expect(ports.calls).toEqual([])
  })

  it('accepts only JSON for the browser-session command', async () => {
    expect((await POST(request(command, 'requalify-single-e66', 'text/plain'))).status).toBe(415)
    expect(ports.operationalCompanies).toEqual([])
    expect(ports.calls).toEqual([])
  })

  it.each([
    ['unknown environment', { ...command, environment: 'prod' }],
    ['invalid identity', { ...command, normalizedValueId: 'misspelled' }],
    ['client-selected company', { ...command, companyId: ids.other }],
    ['client-selected actor', { ...command, actorUserId: ids.other }],
    ['client-selected close event', { ...command, receipt: nativeClose }],
    ['array input', [command]],
  ])('rejects %s before operational read and native work', async (_description, body) => {
    expect((await POST(request(body))).status).toBe(400)
    expect(ports.operationalCompanies).toEqual([])
    expect(ports.calls).toEqual([])
  })

  it.each([
    ['42501', 'planned_move_out_requalification_forbidden', 403],
    ['42501', 'utilts_execution_actor_forbidden', 403],
    ['22023', 'planned_move_out_requalification_scope_required', 400],
    ['23514', 'planned_move_out_requalification_value_scope_mismatch', 404],
    ['23514', 'planned_move_out_requalification_close_scope_mismatch', 409],
    ['23514', 'planned_move_out_requalification_receipt_required', 409],
    ['40001', 'billing_source_discovery_changed', 409],
    ['40001', 'billing_supply_discovery_changed', 409],
    ['40001', 'unrelated_transaction_failure', 500],
    ['23514', 'unrelated_constraint', 500],
    ['XX000', 'planned_move_out_requalification_close_scope_mismatch', 500],
    ['PGRST202', 'Could not find the function public.gridex_requalify_planned_move_out_metering_value_v1(...) in the schema cache', 503],
    ['PGRST202', 'Unrelated schema lookup failed', 500],
  ] as const)('maps %s %s without exposing private details or falling back', async (code, message, status) => {
    nativeError(400, code, message)
    const result = await POST(request())
    expect(result.status).toBe(status)
    const publicBody = await result.text()
    expect(publicBody).not.toContain(message)
    expect(publicBody).not.toContain('INTERNAL_DETAIL')
    expect(ports.calls).toEqual([expectedCall])
  })

  it.each([
    ['absent', null],
    ['mismatched', { normalizedValueId: ids.other, receipt: nativeClose, replayed: false }],
    ['unverified close', { normalizedValueId: ids.normalized, replayed: false }],
    ['malformed close', { normalizedValueId: ids.normalized, receipt: { ...nativeClose, cutoffAt: '2026-10-20' }, replayed: false }],
  ])('refuses %s native evidence without inventing success', async (_description, body) => {
    ports.reply.body = body
    const result = await POST(request())
    expect(result.status).toBe(500)
    expect(await result.json()).toMatchObject({ code: 'single_e66_billing_requalification_failed', trace_id: expect.any(String) })
    expect(ports.calls).toEqual([expectedCall])
  })
})
