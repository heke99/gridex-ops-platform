import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { NextRequest } from 'next/server'
import { beforeEach, expect, it, vi } from 'vitest'

const ids = vi.hoisted(() => ({
  company: '9dfbe999-7619-4728-96d6-e6d524f0310c',
  otherCompany: '528201d2-4cd5-4b80-b71b-2ba16edd0158',
  actor: '1e47e4a2-6137-40e4-8cf3-a03cf82ff2de',
  test: '675b8923-5f72-4c26-9f39-9d687f06b92d',
  production: '675b8923-5f72-4c26-9f39-9d687f06b92e',
  testSource: '26b0bee4-ab04-4820-8424-89b5acc7bd67',
  productionSource: 'e91dbc8a-c4db-4ee5-b096-96b3fef8a32a',
  raw: '3f679be5-a005-44ce-a3ca-3888e6375dbe',
}))
const port = vi.hoisted(() => ({
  contexts: [] as Record<string, unknown>[],
  pagePermissions: [] as string[],
  pageCompany: '',
  tables: {} as Record<string, Record<string, unknown>[]>,
  basis: {} as Record<string, Record<string, unknown>>,
  calls: [] as { path: string; query: URLSearchParams; method: string; body: unknown }[],
  postStatus: 200,
}))

vi.mock('next/headers', () => ({ cookies: async () => ({ get: () => ({ value: ids.company }) }) }))
vi.mock('@/lib/supabase/server', () => ({
  createSupabaseServerClient: async () => ({
    auth: { getUser: async () => ({ data: { user: { id: ids.actor } }, error: null }) },
    rpc: async (name: string) => {
      if (name !== 'canonical_authenticated_tenant_context' || !port.contexts.length) throw new Error('unexpected auth transport')
      return { data: port.contexts.shift(), error: null }
    },
  }),
}))
vi.mock('@/lib/tenant/scope', () => ({
  assertUserCanOperateCompany: async (_actor: string, companyId: string) => companyId,
}))
vi.mock('@/lib/supabase/service', async () => {
  const { createClient } = await import('@supabase/supabase-js')
  return { supabaseService: createClient('http://127.0.0.1:1', 'synthetic-only', {
    auth: { persistSession: false, autoRefreshToken: false },
    global: { async fetch(input, init) {
      const request = new Request(input, init)
      const url = new URL(request.url)
      const body = request.method === 'POST' ? await request.json() : null
      const path = url.pathname.split('/').at(-1) ?? ''
      port.calls.push({ path, query: url.searchParams, method: request.method, body })
      if (path === 'gridex_read_billing_source_values_compact_v1') {
        return Response.json(body.p_value_ids.map((valueId: string) => port.basis[valueId]).filter(Boolean))
      }
      if (path === 'gridex_requalify_planned_move_out_metering_value_v1') {
        if (port.postStatus === 409) {
          return Response.json({ code: '23514', message: 'planned_move_out_requalification_close_scope_mismatch' }, { status: 400 })
        }
        return Response.json({
          normalizedValueId: body.p_normalized_value_id.toUpperCase(),
          replayed: false,
          receipt: {
            contractId: ids.raw, eventId: ids.testSource, effectiveDate: '2026-10-30',
            cutoffAt: '2026-10-30T23:00:00+00:00', recordedAt: '2026-11-01T08:00:00.123456+00:00',
          },
        })
      }
      if (request.method !== 'GET' || !Object.hasOwn(port.tables, path)) throw new Error('unexpected data transport')
      const rows = port.tables[path].filter(row => [...url.searchParams.entries()].every(([column, effect]) => {
        const field = column.startsWith('point.') ? (row.point as Record<string, unknown>)?.[column.slice(6)] : row[column]
        if (effect.startsWith('eq.')) return field === effect.slice(3)
        if (effect === 'not.is.null') return field != null
        return true
      }))
      return Response.json(rows.slice(0, Number(url.searchParams.get('limit') ?? rows.length)))
    } },
  }) }
})

vi.mock('@/lib/admin/guards', () => ({ isPlatformAdminContext: () => false }))
vi.mock('@/lib/tenant/adminScope', () => ({
  resolveAdminSelectedCompanyReadScope: async () => ({ companyId: port.pageCompany }),
}))
vi.mock('@/lib/auth/requirePermissionServer', () => ({
  requirePermissionServer: async (required: string) => {
    if (required !== 'metering.read') throw new Error('unexpected page role')
    return { userId: ids.actor, companyId: port.pageCompany, email: null, permissions: port.pagePermissions }
  },
}))
vi.mock('@/lib/cis/db', () => ({
  listAllGridOwnerDataRequests: async () => [],
  listAllMeteringValues: async () => [],
}))
vi.mock('@/lib/admin/meteringBusinessData', () => ({
  loadMeteringBusinessData: async () => ({}),
  filterMeteringBusinessRows: () => [],
  readMeteringCustomerCardIds: async () => new Set(),
  METERING_REQUEST_ROW_LIMIT: 20,
}))
vi.mock('@/components/admin/AdminHeader', () => ({ default: () => createElement('h1', null, 'Mätvärden') }))
vi.mock('@/components/admin/customers/MeteringBusinessView', () => ({ default: () => createElement('div', null, 'Senaste mätvärden') }))
vi.mock('@/app/admin/metering/_components', () => ({}))

import AdminMeteringPage from '@/app/admin/metering/page'
import { GET, POST } from '@/app/api/internal/billing/requalify-single-e66/route'

const endpoint = 'http://127.0.0.1/api/internal/billing/requalify-single-e66'
const point = '735999222222222222'
const from = '2026-10-25T02:15:00.123456+01:00'
const until = '2026-10-25T02:30:00.123456+01:00'
const permissions = ['metering.write', 'billing_underlay.write']
const testHash = 'a'.repeat(64)
const productionHash = 'b'.repeat(64)

function authContext(extra: Record<string, unknown> = {}) {
  return {
    authorized: true, user_id: ids.actor, selected_company_id: ids.company,
    roles: ['company_admin'], permissions, active_permission_keys: permissions, denied_permissions: [],
    ...extra,
  }
}

function storedCandidate(id: string, source: string) {
  return {
    id, company_id: ids.company, source_message_id: source, source_metering_value_id: ids.raw,
    period_start: from, period_end: until, revision_status: 'current', billing_status: 'billable',
    billing_gate_status: 'eligible', supply_period_id: ids.raw, direction: 'consumption',
    point: { company_id: ids.company, normalized_metering_point_id: point },
  }
}

function storageBasis(row: ReturnType<typeof storedCandidate>, sourcePayloadHash: string) {
  return {
    ...row,
    // PostgreSQL may return a different offset without changing the exact instant.
    period_start: '2026-10-25T01:15:00.123456+00:00',
    period_end: '2026-10-25T01:30:00.123456+00:00',
    quantity_kwh: '0.25',
    billing_source_basis: {
      version: 1, qualified: true, normalizedValueId: row.id, sourceMessageId: row.source_message_id,
      sourcePayloadHash, quantityType: '136', quantityKwh: '0.25',
    },
    billing_source_message: { id: row.source_message_id, company_id: ids.company, message_family: 'UTILTS', message_code: 'E66' },
  }
}

function storedSource(id: string, environment: string, hash: string) {
  return {
    id, company_id: ids.company, environment, immutable_payload_hash: hash,
    direction: 'inbound', message_standard: 'edifact', message_family: 'UTILTS', message_code: 'E66',
  }
}

function lookup(extra: Record<string, string> = {}) {
  const query = new URLSearchParams({ point, from, until, environment: 'test', ...extra })
  return GET(new NextRequest(endpoint + '?' + query))
}

beforeEach(() => {
  vi.restoreAllMocks()
  vi.spyOn(console, 'error').mockImplementation(() => undefined)
  const test = storedCandidate(ids.test, ids.testSource)
  const production = storedCandidate(ids.production, ids.productionSource)
  port.contexts = [authContext(), authContext()]
  port.pagePermissions = ['metering.read', ...permissions]
  port.pageCompany = ids.company
  port.tables = {
    normalized_metering_values: [
      ...Array.from({ length: 205 }, () => ({ ...production, period_start: '2026-11-20T00:00:00+00:00' })),
      { ...test, company_id: ids.otherCompany },
      { ...test, revision_status: 'replaced' },
      test, production,
    ],
    ediel_messages: [storedSource(ids.testSource, 'test', testHash), storedSource(ids.productionSource, 'production', productionHash)],
  }
  port.basis = { [ids.test]: storageBasis(test, testHash), [ids.production]: storageBasis(production, productionHash) }
  port.calls = []
  port.postStatus = 200
})

it('mounts the operator form on ordinary Staff Mätvärden with both current permissions', async () => {
  const markup = renderToStaticMarkup(await AdminMeteringPage({ searchParams: Promise.resolve({}) }))
  expect(markup).toContain('Senaste mätvärden')
  expect(markup).toContain('Ompröva ett E66-mätvärde')
  expect(markup).toContain('name="environment"')
  expect(markup).toContain('name="from"')
  expect(markup).toContain('name="until"')
  expect(markup).not.toContain('Ompröva faktureringsgrinden')
  expect(port.calls).toEqual([])
})

it('keeps the ordinary page but hides the action for read-only, partial or stale roles', async () => {
  for (const missing of permissions) {
    port.pagePermissions = ['metering.read', ...permissions.filter(permission => permission !== missing)]
    const markup = renderToStaticMarkup(await AdminMeteringPage({ searchParams: Promise.resolve({}) }))
    expect(markup).toContain('Senaste mätvärden')
    expect(markup).not.toContain('Ompröva ett E66-mätvärde')
  }
  port.pagePermissions = ['metering.read', ...permissions]
  port.contexts = [authContext({ denied_permissions: [permissions[1]] })]
  const markup = renderToStaticMarkup(await AdminMeteringPage({ searchParams: Promise.resolve({}) }))
  expect(markup).not.toContain('Ompröva ett E66-mätvärde')
  expect(port.calls).toEqual([])
})

it.each(['test', 'production'] as const)('finds one historical %s before the cap, checks authority and sends that exact selection only', async environment => {
  const response = await lookup({ environment, point: '735 999 222 222 222 222' })
  expect(response.status).toBe(200)
  expect(response.headers.get('cache-control')).toBe('no-store')
  const selection = (await response.json()).data
  expect(selection).toEqual({
    normalizedValueId: ids[environment], environment,
    periodStart: '2026-10-25T01:15:00.123456+00:00',
    periodEnd: '2026-10-25T01:30:00.123456+00:00',
  })
  const filters = port.calls[0].query
  expect(Object.fromEntries(filters)).toMatchObject({
    company_id: 'eq.' + ids.company, 'point.company_id': 'eq.' + ids.company,
    'point.normalized_metering_point_id': 'eq.' + point, revision_status: 'eq.current',
    period_start: 'eq.' + from, period_end: 'eq.' + until, limit: '3',
  })
  expect(filters.get('select')).toContain('normalized_metering_values_company_meter_fkey!inner')
  expect(port.calls[1]).toMatchObject({
    path: 'gridex_read_billing_source_values_compact_v1',
    body: { p_company_id: ids.company, p_value_ids: expect.arrayContaining([ids.test, ids.production]) },
  })
  expect(port.calls.slice(2).map(call => call.query.get('immutable_payload_hash'))).toEqual(['eq.' + testHash, 'eq.' + productionHash])
  expect(port.calls.filter(call => call.path.startsWith('gridex_requalify')).length).toBe(0)

  port.contexts = [authContext(), authContext()]
  const confirm = await POST(new NextRequest(endpoint, {
    method: 'POST', headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ normalizedValueId: selection.normalizedValueId.toUpperCase(), environment: selection.environment }),
  }))
  expect(confirm.status).toBe(200)
  expect(await confirm.json()).toEqual({ data: { normalizedValueId: ids[environment], replayed: false } })
  expect(port.calls.at(-1)).toMatchObject({
    path: 'gridex_requalify_planned_move_out_metering_value_v1',
    body: { p_company_id: ids.company, p_actor_user_id: ids.actor, p_environment: environment, p_normalized_value_id: ids[environment] },
  })
})

it('distinguishes absent and over-budget exact matches without qualifying unrelated rows', async () => {
  expect((await lookup({ point: '1111' })).status).toBe(404)
  expect(port.calls).toHaveLength(1)
  port.contexts = [authContext(), authContext()]
  port.calls = []
  port.tables.normalized_metering_values.push(storedCandidate('675b8923-5f72-4c26-9f39-9d687f06b92f', ids.testSource))
  expect((await lookup()).status).toBe(409)
  expect(port.calls).toHaveLength(1)
  expect(port.calls[0].query.get('limit')).toBe('3')
})

it('holds two qualified exact matches in the same Ediel environment', async () => {
  port.tables.ediel_messages[1].environment = 'test'
  expect((await lookup()).status).toBe(409)
  expect(port.calls.map(call => call.path)).toEqual([
    'normalized_metering_values', 'gridex_read_billing_source_values_compact_v1', 'ediel_messages', 'ediel_messages',
  ])
})

it('fails closed if the immutable source digest no longer matches or qualification is absent', async () => {
  port.tables.ediel_messages[0].immutable_payload_hash = 'c'.repeat(64)
  expect((await lookup()).status).toBe(409)
  port.contexts = [authContext(), authContext()]
  port.basis[ids.test].billing_source_basis = { ...(port.basis[ids.test].billing_source_basis as object), qualified: false }
  expect((await lookup()).status).toBe(409)
  expect(port.calls.every(call => !call.path.startsWith('gridex_requalify'))).toBe(true)
})

const invalidSelectionQueries: Record<string, string>[] = [
  { from: '2026-10-25T02:15:00' },
  { from: '2026-02-30T02:15:00+01:00' },
  { from: until },
  { environment: 'unknown' },
  { companyId: ids.otherCompany },
]

it.each(invalidSelectionQueries)('rejects an invalid or over-scoped exact selection before service reads', async extra => {
  expect((await lookup(extra)).status).toBe(400)
  expect(port.calls).toEqual([])
})

it('does not query service data without both actual permissions', async () => {
  port.contexts = [authContext({ permissions: ['metering.write'] })]
  expect((await lookup()).status).toBe(403)
  expect(port.calls).toEqual([])
})

it('returns a hold when the native close authority changes between lookup and confirmation', async () => {
  const { data } = await (await lookup()).json()
  port.postStatus = 409
  port.contexts = [authContext(), authContext()]
  const response = await POST(new NextRequest(endpoint, {
    method: 'POST', headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ normalizedValueId: data.normalizedValueId, environment: data.environment }),
  }))
  expect(response.status).toBe(409)
  expect(await response.json()).not.toHaveProperty('data')
})
