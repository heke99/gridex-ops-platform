import { NextRequest } from 'next/server'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { GET, POST } from '@/app/api/cron/reconciliation/daily/route'

const db = vi.hoisted(() => ({
  fetch: vi.fn<typeof fetch>(),
  schemaReady: vi.fn(),
  rpcRejection: null as { companyId: string; error: Error } | null,
}))
vi.mock('@/lib/platform/schemaReadiness', () => ({ assertPlatformSchemaReady: db.schemaReady }))
vi.mock('@/lib/supabase/service', async () => {
  const { createClient } = await vi.importActual<typeof import('@supabase/supabase-js')>('@supabase/supabase-js')
  const client = createClient('https://reconciliation.test', 'synthetic-service-key', {
    auth: { autoRefreshToken: false, persistSession: false },
    global: { fetch: db.fetch },
  })
  return {
    supabaseService: {
      from: client.from.bind(client),
      rpc: (name: string, params: Record<string, unknown>) => {
        if (name === 'canonical_run_architecture_reconciliation' && db.rpcRejection &&
            params.p_company_id === db.rpcRejection.companyId) {
          return Promise.reject(db.rpcRejection.error)
        }
        return client.rpc(name, params)
      },
    },
  }
})

const tenants = [
  '425790b4-6bca-4045-b63b-e926630687ad',
  'c70dbc3c-24fc-4388-9017-f9c52e818fe7',
]
const canonicalCounts = {
  membership_without_role: 0,
  role_without_auth_identity: 0,
  duplicate_membership: 1,
  duplicate_role: 0,
  accepted_invite_without_access: 0,
  active_client_not_ready: 0,
  deprecated_event_bus_backlog: 0,
  due_stranded_outbox: 0,
  provisioning_dead_letter: 0,
  stuck_provisioning: 0,
  manual_review_over_sla: 0,
  manual_review_without_owner: 0,
  application_without_repair: 0,
  contract_missing_customer_or_site: 0,
  contract_without_metering_point: 0,
  switch_without_contract: 0,
  ediel_live_without_valid_tenant: 0,
  invalid_lifecycle: 0,
}

const checkedAt = '2026-11-19T06:30:00Z'
const rawError = 'synthetic upstream diagnostic text'

function json(data: unknown, status = 200) {
  return new Response(JSON.stringify(data), { status, headers: { 'Content-Type': 'application/json' } })
}

function request(query = '', authorized = true, method = 'GET') {
  return new NextRequest(`https://gridex.test/api/cron/reconciliation/daily${query}`, {
    method,
    headers: authorized ? { 'x-cron-secret': 'synthetic-reconciliation-secret' } : {},
  })
}

type DatabaseOptions = {
  appSourceMissing?: boolean
  appFinding?: boolean
  repeatingInventory?: boolean
  transportFailed?: boolean
  fetchRejected?: boolean
  canonicalPayload?: (companyId: string) => unknown
}

function mockDatabase(options: DatabaseOptions = {}) {
  const calls = {
    inventoryCursors: [] as (string | null)[],
    canonicals: [] as string[],
    acquire: [] as Record<string, unknown>[],
    release: [] as Record<string, unknown>[],
    otherCompanyFilters: [] as (string | null)[],
  }
  db.fetch.mockImplementation(async (input, init) => {
    const url = new URL(String(input))
    expect(url.origin).toBe('https://reconciliation.test')
    const table = url.pathname.split('/').pop()
    if (table === 'gridex_acquire_automation_lock' || table === 'gridex_release_automation_lock') {
      calls[table === 'gridex_acquire_automation_lock' ? 'acquire' : 'release'].push(JSON.parse(String(init?.body)))
      return json(true)
    }
    if (table === 'companies') {
      expect(url.searchParams.get('status')).toBe('neq.deleted_test_only')
      expect(url.searchParams.get('order')).toBe('id.asc')
      const cursor = url.searchParams.get('id')
      calls.inventoryCursors.push(cursor)
      const eligible = options.repeatingInventory ? tenants : tenants.filter(id => cursor === null || id > cursor.slice(3))
      // PostgREST may cap a read below the requested limit. Existing unpaged
      // calls get both rows in the non-pagination tests to isolate reporting.
      const rows = url.searchParams.has('limit') ? eligible.slice(0, 1) : eligible
      return json(rows.map(id => ({ id })))
    }
    if (table === 'canonical_run_architecture_reconciliation') {
      const { p_company_id: companyId } = JSON.parse(String(init?.body))
      expect(tenants).toContain(companyId)
      calls.canonicals.push(companyId)
      if (options.fetchRejected && companyId === tenants[1]) throw new Error(rawError)
      if (options.transportFailed && companyId === tenants[1]) {
        return json({ code: '57014', message: rawError }, 400)
      }
      const data = options.canonicalPayload
        ? options.canonicalPayload(companyId)
        : { checked_at: checkedAt, companies: { [companyId]: canonicalCounts } }
      return json(data)
    }
    calls.otherCompanyFilters.push(url.searchParams.get('company_id'))
    if (table === 'customer_contracts' && options.appSourceMissing) {
      return json({ code: '42P01', message: rawError }, 400)
    }
    if (table === 'billing_underlays' && options.appFinding) {
      return json(['underlay-1', 'underlay-2'].map(id => ({ id, contract_id: 'synthetic-contract', underlay_year: 2026, underlay_month: 11 })))
    }
    return json([])
  })
  return calls
}

beforeEach(() => {
  db.fetch.mockReset()
  db.rpcRejection = null
  db.schemaReady.mockReset().mockResolvedValue(undefined)
  vi.stubEnv('RECONCILIATION_CRON_SECRET', 'synthetic-reconciliation-secret')
})

afterEach(() => {
  vi.unstubAllEnvs()
})

it('discovers all ordered companies below the read cap and keeps verified findings a successful run', async () => {
  const calls = mockDatabase({ appFinding: true })
  const response = await GET(request())
  expect(response.status).toBe(200)
  const body = await response.json()

  expect(body).toMatchObject({ ok: true, execution: 'completed' })
  expect(body.result.canonicalArchitecture).toMatchObject({ company_count: 2, failed_count: 0, ok: true })
  expect(body.result.canonicalArchitecture.companies.map((item: { company_id: string }) => item.company_id)).toEqual(tenants)
  expect(body.result.coverage).toMatchObject({
    complete: true,
    application: { verified_count: 8, failed_count: 0, unverified_count: 0 },
    canonical: { verified_check_count: 36, failed_check_count: 0, unverified_check_count: 0 },
  })
  expect(body.result.findings).toMatchObject({ canonical_check_count: 2, application_check_count: 1 })
  expect(calls.inventoryCursors).toEqual([null, `gt.${tenants[0]}`, `gt.${tenants[1]}`])
  expect(calls.canonicals.sort()).toEqual(tenants)
  expect(calls.acquire).toHaveLength(1)
  expect(calls.release).toHaveLength(1)
  expect(calls.acquire[0].p_lock_token).toBe(calls.release[0].p_lock_token)
})

it('reports the selected company, failed RPC, and missing application sources without upstream detail', async () => {
  const calls = mockDatabase({ appSourceMissing: true, transportFailed: true })
  const response = await GET(request())
  expect(response.status).toBe(503)
  const text = await response.text()
  expect(text).not.toContain(rawError)
  const body = JSON.parse(text)
  expect(body).toMatchObject({ ok: false, execution: 'completed' })
  expect(body.result.canonicalArchitecture).toMatchObject({ company_count: 2, failed_count: 1, ok: false })
  expect(body.result.canonicalArchitecture.companies[1]).toMatchObject({ company_id: tenants[1], ok: false, error_code: '57014' })
  expect(body.result.coverage).toMatchObject({
    complete: false,
    application: { verified_count: 5, failed_count: 0, unverified_count: 3 },
    canonical: { verified_check_count: 18, failed_check_count: 0, unverified_check_count: 18 },
  })
  expect(body.result.findings.canonical_check_count).toBe(1)
  expect(calls.release).toHaveLength(1)
})

it('separates a failed native check from a missing check inside a successful RPC and retains company scope', async () => {
  const calls = mockDatabase({ canonicalPayload: companyId => {
    const counts: Record<string, number> = { ...canonicalCounts }
    delete counts.duplicate_role
    delete counts.invalid_lifecycle
    return { checked_at: checkedAt, companies: { [companyId]: { ...counts, duplicate_role_error: '42P01' } } }
  } })
  const response = await POST(request(`?company_id=${tenants[0]}`, true, 'POST'))
  expect(response.status).toBe(503)
  const body = await response.json()
  const company = body.result.canonicalArchitecture.companies[0]
  expect(body.result.canonicalArchitecture).toMatchObject({ company_count: 1, failed_count: 0, ok: false })
  expect(company).toMatchObject({ company_id: tenants[0], ok: false, coverage: { failed_checks: ['duplicate_role'], unverified_checks: ['invalid_lifecycle'] } })
  expect(company.checks.companies[tenants[0]].duplicate_role_error).toBe('42P01')
  expect(body.result.findings.canonical_check_count).toBe(1)
  expect(calls.inventoryCursors).toEqual([])
  expect(calls.canonicals).toEqual([tenants[0]])
  expect(calls.otherCompanyFilters.every(filter => filter === `eq.${tenants[0]}`)).toBe(true)
  expect(calls.acquire[0].p_company_id).toBe(tenants[0])
})

it.each([
  { name: 'missing envelope', payload: () => null },
  { name: 'foreign company evidence', payload: () => ({ checked_at: checkedAt, companies: { 'unselected-fixture': canonicalCounts } }) },
  { name: 'invalid check timestamp', payload: (id: string) => ({ checked_at: 'unparsed date', companies: { [id]: canonicalCounts } }) },
])('does not certify $name', async ({ payload }) => {
  mockDatabase({ canonicalPayload: payload })
  const response = await GET(request(`?company_id=${tenants[0]}`))
  expect(response.status).toBe(503)
  const text = await response.text()
  expect(text).not.toContain('unselected-fixture')
  expect(text).not.toContain('unparsed date')
  expect(JSON.parse(text)).toMatchObject({ ok: false, result: { coverage: { canonical: { verified_check_count: 0, unverified_check_count: 18 } } } })
})

it('fails inventory without dispatching company RPCs if the returned cursor stops advancing', async () => {
  const errorLog = vi.spyOn(console, 'error').mockImplementation(() => undefined)
  try {
    const calls = mockDatabase({ repeatingInventory: true })
    const response = await GET(request())
    expect(response.status).toBe(500)
    expect(await response.json()).toMatchObject({ ok: false, execution: 'failed', code: 'daily_reconciliation_failed' })
    expect(calls.inventoryCursors).toEqual([null, `gt.${tenants[0]}`])
    expect(calls.canonicals).toEqual([])
    expect(calls.release).toHaveLength(1)
  } finally {
    errorLog.mockRestore()
  }
})

it('rejects conflicting native evidence and arbitrary error fields without clearing verified findings', async () => {
  mockDatabase({ canonicalPayload: id => ({
    checked_at: checkedAt,
    companies: { [id]: { ...canonicalCounts, duplicate_role_error: '42P01', invalid_lifecycle: null, invalid_lifecycle_error: rawError } },
  }) })
  const response = await GET(request(`?company_id=${tenants[0]}`))
  expect(response.status).toBe(503)
  const text = await response.text()
  expect(text).not.toContain(rawError)
  const body = JSON.parse(text)
  expect(body.result.canonicalArchitecture.companies[0].coverage.unverified_checks).toEqual(['duplicate_role', 'invalid_lifecycle'])
  expect(body.result.coverage.canonical).toMatchObject({ verified_check_count: 16, failed_check_count: 0, unverified_check_count: 2 })
  expect(body.result.findings.canonical_check_count).toBe(1)
})

it.each(['fetch', 'RPC'] as const)('retains other company evidence when the %s promise rejects', async source => {
  const calls = mockDatabase({ fetchRejected: source === 'fetch' })
  if (source === 'RPC') db.rpcRejection = { companyId: tenants[1], error: new Error(rawError) }
  const response = await GET(request())
  expect(response.status).toBe(503)
  const text = await response.text()
  expect(text).not.toContain(rawError)
  const body = JSON.parse(text)
  expect(body.result.canonicalArchitecture).toMatchObject({ company_count: 2, failed_count: 1, ok: false })
  expect(body.result.canonicalArchitecture.companies).toMatchObject([
    { company_id: tenants[0], ok: true, finding_count: 1 },
    { company_id: tenants[1], ok: false, error_code: 'reconciliation_check_failed' },
  ])
  expect(body.result.coverage.canonical).toMatchObject({ verified_check_count: 18, unverified_check_count: 18 })
  expect(calls.release).toHaveLength(1)
})

it('rejects unauthenticated calls before schema, inventory or lock work', async () => {
  const response = await GET(request('', false))
  expect(response.status).toBe(401)
  expect(db.schemaReady).not.toHaveBeenCalled()
  expect(db.fetch).not.toHaveBeenCalled()
})
