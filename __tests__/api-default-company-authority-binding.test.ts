import { beforeEach, describe, expect, it, vi } from 'vitest'

type DbCall = {
  table?: string
  rpc?: string
  operation: 'select' | 'update' | 'upsert' | 'rpc'
  payload?: unknown
  params?: Record<string, unknown>
  filters: Record<string, unknown>
}

const io = vi.hoisted(() => {
  type Membership = {
    companyId: string
    createdAt: string
    membershipStatus: string
    membershipActive: boolean
    companyStatus: string
    roleStatus: string
    roleActive: boolean
  }
  type Result = { data: unknown; count?: number; error: null | Error }
  type Call = DbCall & { inFilters: Record<string, unknown[]> }
  type Query = PromiseLike<Result> & {
    select: (columns?: string, options?: unknown) => Query
    update: (payload: unknown) => Query
    upsert: (payload: unknown, options?: unknown) => Query
    eq: (column: string, value: unknown) => Query
    in: (column: string, values: unknown[]) => Query
    not: (column: string, operator: string, value: unknown) => Query
    lt: (column: string, value: unknown) => Query
    gt: (column: string, value: unknown) => Query
    lte: (column: string, value: unknown) => Query
    or: (expression: string) => Query
    range: (from: number, to: number) => Query
    order: (column: string, options?: unknown) => Query
    limit: (count: number) => Query
    single: () => Promise<Result>
    maybeSingle: () => Promise<Result>
  }

  const state = {
    cookie: null as string | null,
    platform: false,
    malformedOrdinaryNullContext: false,
    roles: ['custom_role'] as string[],
    permissions: {
      A: ['billing.read', 'billing.write', 'pricing.write'],
      B: ['customers.read'],
    } as Record<string, string[]>,
    memberships: [] as Membership[],
    companies: { A: 'active', B: 'active' } as Record<string, string>,
    operationalOrder: ['B', 'A'] as string[],
    periodLocked: false,
    blockedUnderlay: false,
    noProviderGuid: false,
    noProviderConfig: false,
    calls: [] as DbCall[],
    http: [] as Array<{ company: string; method: string; path: string }>,
  }

  function membership(companyId: string, createdAt: string): Membership {
    return {
      companyId,
      createdAt,
      membershipStatus: 'active',
      membershipActive: true,
      companyStatus: 'active',
      roleStatus: 'active',
      roleActive: true,
    }
  }

  function underlay(companyId: string): Record<string, unknown> {
    return {
      id: `underlay-${companyId}`,
      company_id: companyId,
      customer_id: `customer-${companyId}`,
      metering_point_id: `meter-${companyId}`,
      contract_id: `contract-${companyId}`,
      contract_price_snapshot_id: `snapshot-${companyId}`,
      underlay_year: 2026,
      underlay_month: 8,
      billing_period_start: '2026-08-01',
      billing_period_end: '2026-09-01',
      status: state.blockedUnderlay ? 'pending' : 'validated',
      readiness_status: state.blockedUnderlay ? 'blocked' : 'ready',
      missing_values_count: 0,
      readiness_issues: [],
      billing_block_reason: state.blockedUnderlay ? `private-${companyId}-blocker` : null,
      total_kwh: 10,
      source_meter_value_count: 1,
      price_area: 'SE3',
      energy_direction: 'production',
      settlement_type: 'credit_invoice',
      pricing_snapshot: {
        price_area: 'SE3',
        production: {
          enabled: true,
          compensation_sek_per_kwh: companyId === 'A' ? 1 : 2,
          settlement_mode: 'credit_invoice',
          vat_rate: 0,
        },
      },
    }
  }

  function rowsFor(table: string, filters: Record<string, unknown>): Record<string, unknown>[] {
    const companyId = String(filters.company_id ?? '')
    if (table === 'company_memberships') {
      return state.operationalOrder.flatMap((id) => {
        const row = state.memberships.find((candidate) => candidate.companyId === id)
        if (!row) return []
        return [{
          company_id: row.companyId,
          user_id: 'actor',
          membership_role: 'member',
          status: row.membershipStatus,
          is_active: row.membershipActive,
          companies: {
            id: row.companyId,
            name: `Company ${row.companyId}`,
            slug: row.companyId.toLowerCase(),
            org_number: null,
            status: row.companyStatus,
          },
        }]
      })
    }
    if (table === 'companies') {
      const companyId = String(filters.id ?? '')
      const status = state.companies[companyId]
      return status ? [{ id: companyId, status }] : []
    }
    if (table === 'platform_runtime_readiness') {
      return [{
        id: true,
        is_ready: true,
        schema_version: '20260803093300-gridex-runtime-readiness-v3',
        schema_fingerprint: 'a'.repeat(64),
        blocking_issues: [],
      }]
    }
    if (table === 'billing_period_locks') {
      return state.periodLocked
        ? [{ id: `lock-${companyId}`, company_id: companyId, billing_year: 2026, billing_month: 8, status: 'locked', lock_reason: `private-${companyId}-lock` }]
        : []
    }
    if (table === 'price_period_locks') return []
    if (table === 'billing_underlays') return [underlay(companyId)]
    if (table === 'customer_contracts') {
      return [{ id: `contract-${companyId}`, company_id: companyId, customer_id: `customer-${companyId}`, status: 'active', contract_type: 'fixed', energy_direction: 'production' }]
    }
    if (table === 'contract_price_snapshots') {
      return [{ id: `snapshot-${companyId}`, company_id: companyId, contract_id: `contract-${companyId}`, valid_from: '2026-01-01', snapshot_json: underlay(companyId).pricing_snapshot }]
    }
    if (table === 'billing_underlay_items') {
      return [{
        ...underlay(companyId),
        id: `item-${companyId}`,
        billing_underlay_id: `underlay-${companyId}`,
        period_start: '2026-07-31T22:00:00.000Z',
        period_end: '2026-08-31T22:00:00.000Z',
        quantity_kwh: 10,
        unit: 'kWh',
        status: 'ready_for_pricing',
        warnings: [],
        source_normalized_metering_value_id: `normalized-${companyId}`,
      }]
    }
    if (table === 'pricing_runs') {
      return [{ id: `run-${companyId}`, company_id: companyId, billing_underlay_id: `underlay-${companyId}`, customer_id: `customer-${companyId}`, status: 'success', billing_period_start: '2026-08-01', billing_period_end: '2026-09-01', errors: [] }]
    }
    if (table === 'customer_supply_periods') {
      return [{ id: `supply-${companyId}`, company_id: companyId, customer_id: `customer-${companyId}`, metering_point_id: `meter-${companyId}`, contract_id: `contract-${companyId}`, start_date: '2026-08-01', end_date: null, status: 'active' }]
    }
    if (table === 'pricing_interval_evidence' || table === 'normalized_metering_values') return []
    if (table === 'invoice_export_runs') {
      return [{ id: `export-${companyId}`, company_id: companyId, private_summary: `private-${companyId}` }]
    }
    if (table === 'invoice_export_items') {
      return [{
        id: `invoice-${companyId}`,
        company_id: companyId,
        export_run_id: `export-${companyId}`,
        environment: 'test',
        status: 'sent',
        provider_invoice_guid: state.noProviderGuid ? null : `guid-${companyId}`,
        request_payload: { private_reference: `private-${companyId}` },
      }]
    }
    if (table === 'billing_provider_connections') {
      return state.noProviderConfig ? [] : [{
        id: `connection-${companyId}`,
        company_id: companyId,
        provider: 'capway_aptic',
        environment: 'test',
        status: 'active',
        settings: {
          auth_mode: 'apikey',
          api_key_header: 'X-Synthetic-Key',
          base_url: `https://provider-${companyId.toLowerCase()}.invalid`,
        },
        secret_reference: { api_key_env: 'SYNTHETIC_PROVIDER_KEY' },
      }]
    }
    throw new Error(`Unmodeled test table: ${table}`)
  }

  function execute(call: Call, single = false, strict = false): Result {
    state.calls.push({
      table: call.table,
      operation: call.operation,
      payload: call.payload,
      filters: { ...call.filters },
    })
    if (call.operation !== 'select') return { data: call.payload ?? null, error: null }

    const rows = rowsFor(String(call.table), call.filters).filter((row) =>
      Object.entries(call.filters).every(([key, value]) => row[key] === value) &&
      Object.entries(call.inFilters).every(([key, values]) => values.includes(row[key])),
    )
    if (strict && rows.length === 0) return { data: null, error: new Error('not found for tenant') }
    return { data: single ? rows[0] ?? null : rows, count: rows.length, error: null }
  }

  const from = vi.fn((table: string): Query => {
    const call: Call = { table, operation: 'select', filters: {}, inFilters: {} }
    const query: Query = {
      select: () => query,
      update: (payload: unknown) => { call.operation = 'update'; call.payload = payload; return query },
      upsert: (payload: unknown) => { call.operation = 'upsert'; call.payload = payload; return query },
      eq: (column: string, value: unknown) => { call.filters[column] = value; return query },
      in: (column: string, values: unknown[]) => { call.inFilters[column] = values; return query },
      not: () => query,
      lt: () => query,
      gt: () => query,
      lte: () => query,
      or: () => query,
      range: () => query,
      order: () => query,
      limit: () => query,
      single: async () => execute(call, true, true),
      maybeSingle: async () => execute(call, true),
      then: <TResult1 = Result, TResult2 = never>(
        onfulfilled?: ((value: Result) => TResult1 | PromiseLike<TResult1>) | null,
        onrejected?: ((reason: unknown) => TResult2 | PromiseLike<TResult2>) | null,
      ) => Promise.resolve(execute(call)).then(onfulfilled, onrejected),
    }
    return query
  })

  return {
    state,
    membership,
    from,
    authRpc: vi.fn(),
    serviceRpc: vi.fn(),
    fetch: vi.fn(),
  }
})

vi.mock('react', () => ({ cache: <T,>(fn: T) => fn }))
vi.mock('next/headers', () => ({
  cookies: async () => ({
    get: () => io.state.cookie ? { value: io.state.cookie } : undefined,
  }),
}))
vi.mock('@/lib/supabase/server', () => ({
  createSupabaseServerClient: async () => ({
    auth: { getUser: async () => ({ data: { user: { id: 'actor', email: 'actor@example.test' } }, error: null }) },
    rpc: io.authRpc,
  }),
}))
vi.mock('@/lib/supabase/service', () => ({
  supabaseService: { from: io.from, rpc: io.serviceRpc },
}))

import { GET as readPeriod, POST as writePeriod } from '@/app/api/internal/billing/period-locks/route'
import { POST as generateUnderlay } from '@/app/api/internal/billing/generate-underlay/route'
import { POST as previewPricing } from '@/app/api/internal/pricing/preview/route'
import { POST as repriceUnderlay } from '@/app/api/internal/pricing/reprice/route'
import { POST as lockPreview } from '@/app/api/internal/pricing/lock-preview/route'
import { GET as readExport } from '@/app/api/internal/invoice-exports/[id]/route'
import { GET as refreshProviderStatus } from '@/app/api/internal/invoices/[id]/provider-status/route'
import { invalidatePlatformSchemaReadinessCache } from '@/lib/platform/schemaReadiness'

function jsonRequest(body: Record<string, unknown>): Request {
  return new Request('https://app.gridex.se/api/internal/test', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  })
}

function getRequest(path: string): Request {
  return new Request(`https://app.gridex.se${path}`)
}

type Endpoint = {
  name: string
  write: boolean
  authorityCode: string
  invoke: (companyId: string, explicitCompany?: string | null, request?: Request) => Promise<Response>
}

const endpoints: Endpoint[] = [
  { name: 'period GET', write: false, authorityCode: 'billing_period_lock_read_failed', invoke: () => readPeriod(getRequest('/api/internal/billing/period-locks?billing_month=2026-08')) },
  { name: 'period POST', write: true, authorityCode: 'billing_period_lock_write_failed', invoke: (_companyId, _explicit, request = jsonRequest({ billing_month: '2026-08', action: 'lock' })) => writePeriod(request) },
  { name: 'generate underlay', write: true, authorityCode: 'billing_underlay_generate_failed', invoke: (_companyId, _explicit, request = jsonRequest({ billing_month: '2026-08' })) => generateUnderlay(request) },
  { name: 'pricing preview', write: true, authorityCode: 'pricing_preview_failed', invoke: (companyId, _explicit, request = jsonRequest({ billing_underlay_id: `underlay-${companyId}` })) => previewPricing(request) },
  { name: 'reprice', write: true, authorityCode: 'pricing_reprice_failed', invoke: (companyId, _explicit, request = jsonRequest({ billing_underlay_id: `underlay-${companyId}` })) => repriceUnderlay(request) },
  { name: 'lock preview', write: true, authorityCode: 'pricing_preview_lock_failed', invoke: (companyId, _explicit, request = jsonRequest({ pricing_run_id: `run-${companyId}` })) => lockPreview(request) },
  {
    name: 'invoice export GET',
    write: false,
    authorityCode: 'invoice_export_read_failed',
    invoke: (companyId, explicitCompany = null) => readExport(
      getRequest(`/api/internal/invoice-exports/export-${companyId}${explicitCompany ? `?companyId=${explicitCompany}` : ''}`),
      { params: Promise.resolve({ id: `export-${companyId}` }) },
    ),
  },
  {
    name: 'provider status GET',
    write: true,
    authorityCode: 'invoice_provider_status_failed',
    invoke: (companyId, explicitCompany = null) => refreshProviderStatus(
      getRequest(`/api/internal/invoices/invoice-${companyId}/provider-status${explicitCompany ? `?companyId=${explicitCompany}` : ''}`),
      { params: Promise.resolve({ id: `invoice-${companyId}` }) },
    ),
  },
]

function scopedCompanies(): string[] {
  const companies: string[] = []
  for (const call of io.state.calls as DbCall[]) {
    const companyId = call.filters.company_id ?? call.params?.p_company_id
    if (typeof companyId === 'string') companies.push(companyId)
    if (call.payload && typeof call.payload === 'object' && !Array.isArray(call.payload)) {
      const payloadCompany = (call.payload as Record<string, unknown>).company_id
      if (typeof payloadCompany === 'string') companies.push(payloadCompany)
    }
  }
  return companies
}

function businessCalls(): DbCall[] {
  return (io.state.calls as DbCall[]).filter((call) =>
    call.table !== 'company_memberships' &&
    call.table !== 'companies' &&
    call.table !== 'platform_runtime_readiness',
  )
}

beforeEach(() => {
  vi.clearAllMocks()
  vi.unstubAllGlobals()
  invalidatePlatformSchemaReadinessCache()
  process.env.SYNTHETIC_PROVIDER_KEY = 'synthetic-key'
  io.state.cookie = null
  io.state.platform = false
  io.state.malformedOrdinaryNullContext = false
  io.state.roles = ['custom_role']
  io.state.permissions = {
    A: ['billing.read', 'billing.write', 'pricing.write'],
    B: ['customers.read'],
  }
  io.state.memberships = [
    io.membership('A', '2026-01-01T00:00:00Z'),
    io.membership('B', '2026-02-01T00:00:00Z'),
  ]
  io.state.operationalOrder = ['B', 'A']
  io.state.companies = { A: 'active', B: 'active' }
  io.state.periodLocked = false
  io.state.blockedUnderlay = false
  io.state.noProviderGuid = false
  io.state.noProviderConfig = false
  io.state.calls = []
  io.state.http = []

  io.authRpc.mockImplementation(async (
    name: string,
    args: { p_selected_company_id?: string | null },
  ) => {
    expect(name).toBe('canonical_authenticated_tenant_context')
    const selected = args.p_selected_company_id ?? null
    const eligible = io.state.memberships
      .filter((row) => row.membershipStatus === 'active' && row.membershipActive && row.roleStatus === 'active' && row.roleActive)
      .filter((row) => !selected || row.companyId === selected)
      .sort((left, right) => left.createdAt.localeCompare(right.createdAt))
    const companyId = io.state.platform || io.state.malformedOrdinaryNullContext
      ? selected
      : eligible[0]?.companyId ?? null
    return {
      data: {
        authorized: true,
        user_id: 'actor',
        user_email: 'actor@example.test',
        selected_company_id: companyId,
        is_platform_admin: io.state.platform,
        roles: io.state.platform ? ['platform_admin'] : companyId ? io.state.roles : [],
        permissions: io.state.platform
          ? []
          : io.state.malformedOrdinaryNullContext
            ? ['billing.read', 'billing.write', 'pricing.write']
            : io.state.permissions[companyId ?? ''] ?? [],
      },
      error: null,
    }
  })

  io.serviceRpc.mockImplementation(async (name: string, params: Record<string, unknown>) => {
    if (name === 'gridex_get_user_roles') return { data: io.state.roles, error: null }
    const call: DbCall = { rpc: name, operation: 'rpc', params, filters: {} }
    io.state.calls.push(call)
    if (name === 'gridex_persist_pricing_run') return { data: `new-run-${params.p_company_id}`, error: null }
    if (name === 'gridex_lock_pricing_run') return { data: { status: 'locked' }, error: null }
    if (name === 'gridex_unlock_pricing_runs_for_month') return { data: 1, error: null }
    if (name === 'gridex_store_billing_underlay_batch') {
      const commands = Array.isArray(params.p_commands) ? params.p_commands : []
      return { data: commands.map((_, index) => `generated-${String(params.p_company_id)}-${index}`), error: null }
    }
    throw new Error(`Unmodeled test RPC: ${name}`)
  })

  io.fetch.mockImplementation(async (input: string | URL | Request, init?: RequestInit) => {
    const url = new URL(typeof input === 'string' || input instanceof URL ? input.toString() : input.url)
    const match = /provider-(a|b)\.invalid/.exec(url.hostname)
    const company = match?.[1].toUpperCase()
    if (!company) throw new Error('Unexpected provider host')
    const method = init?.method ?? 'GET'
    io.state.http.push({ company, method, path: url.pathname })
    return new Response(JSON.stringify({ status: 1, financeStatus: 2, privateMarker: `private-${company}` }), {
      status: 200,
      headers: { 'content-type': 'application/json' },
    })
  })
  vi.stubGlobal('fetch', io.fetch)
})

describe('canonical company authority through real API guard, lifecycle, route and receiver imports', () => {
  it.each(endpoints)('$name binds no-cookie operations to SQL-selected A instead of B-first operational order', async ({ invoke }) => {
    const response = await invoke('A')

    expect(response.status).toBe(200)
    expect(scopedCompanies()).not.toContain('B')
    expect(scopedCompanies()).toContain('A')
    expect(io.state.http.every((call) => call.company === 'A')).toBe(true)
  })

  it.each(endpoints)('$name follows the reversed valid SQL selection B instead of A-first operational order', async ({ invoke }) => {
    io.state.memberships = [
      io.membership('A', '2026-02-01T00:00:00Z'),
      io.membership('B', '2026-01-01T00:00:00Z'),
    ]
    io.state.operationalOrder = ['A', 'B']
    io.state.permissions = {
      A: ['customers.read'],
      B: ['billing.read', 'billing.write', 'pricing.write'],
    }

    const response = await invoke('B')

    expect(response.status).toBe(200)
    expect(scopedCompanies()).not.toContain('A')
    expect(scopedCompanies()).toContain('B')
    expect(io.state.http.every((call) => call.company === 'B')).toBe(true)
  })

  it.each([
    { name: 'invoice export camel alias', invoke: () => endpoints[6].invoke('B', 'B') },
    { name: 'provider status camel alias', invoke: () => endpoints[7].invoke('B', 'B') },
    {
      name: 'invoice export snake alias',
      invoke: () => readExport(getRequest('/api/internal/invoice-exports/export-B?company_id=B'), { params: Promise.resolve({ id: 'export-B' }) }),
    },
    {
      name: 'provider status snake alias',
      invoke: () => refreshProviderStatus(getRequest('/api/internal/invoices/invoice-B/provider-status?company_id=B'), { params: Promise.resolve({ id: 'invoice-B' }) }),
    },
  ])('$name rejects explicit B under canonical A before receiver/provider I/O', async ({ invoke }) => {
    io.state.cookie = 'A'

    const response = await invoke()

    expect(response.status).toBe(403)
    expect(businessCalls()).toEqual([])
    expect(io.state.http).toEqual([])
  })

  it('keeps camelCase precedence when both explicit aliases are present', async () => {
    io.state.cookie = 'A'
    const response = await readExport(
      getRequest('/api/internal/invoice-exports/export-A?companyId=A&company_id=B'),
      { params: Promise.resolve({ id: 'export-A' }) },
    )

    expect(response.status).toBe(200)
    expect(scopedCompanies()).not.toContain('B')
  })

  it.each(endpoints)('$name denies missing permission before body or receiver I/O', async ({ invoke, write }) => {
    io.state.permissions.A = ['customers.read']
    const parse = vi.fn(async () => ({ billing_month: '2026-08' }))
    const request = { json: parse } as unknown as Request

    const response = await invoke('A', null, write ? request : undefined)

    expect(response.status).toBe(403)
    expect(parse).not.toHaveBeenCalled()
    expect(io.from).not.toHaveBeenCalled()
    expect(io.serviceRpc).not.toHaveBeenCalled()
    expect(io.state.http).toEqual([])
  })

  it.each(endpoints)('$name fails closed on a malformed ordinary null-company RPC response after successful permission guard', async ({ invoke, name, write, authorityCode }) => {
    // Fault injection only: valid canonical SQL cannot return ordinary permissions without a company.
    io.state.malformedOrdinaryNullContext = true
    io.state.cookie = null
    const parse = vi.fn(async () => ({ billing_month: '2026-08' }))
    const request = { json: parse } as unknown as Request
    const explicitCompany = name === 'invoice export GET' || name === 'provider status GET' ? 'B' : null

    const response = await invoke('B', explicitCompany, write ? request : undefined)

    expect(response.status).toBe(403)
    expect(await response.json()).toMatchObject({ code: authorityCode })
    expect(parse).not.toHaveBeenCalled()
    expect(io.from).not.toHaveBeenCalled()
    expect(io.serviceRpc).not.toHaveBeenCalled()
    expect(io.state.http).toEqual([])
  })

  it.each([
    {
      name: 'inactive memberships',
      disable: () => { for (const row of io.state.memberships) row.membershipStatus = 'disabled' },
    },
    {
      name: 'inactive company role assignments',
      disable: () => { for (const row of io.state.memberships) row.roleStatus = 'disabled' },
    },
  ])('rejects $name from the canonical SQL-shaped fixture before body I/O', async ({ disable }) => {
    disable()
    const parse = vi.fn(async () => ({ billing_month: '2026-08' }))

    const response = await writePeriod({ json: parse } as unknown as Request)

    expect(response.status).toBe(403)
    expect(parse).not.toHaveBeenCalled()
    expect(io.from).not.toHaveBeenCalled()
    expect(io.serviceRpc).not.toHaveBeenCalled()
  })

  it.each(endpoints.filter((endpoint) => endpoint.write))('$name blocks paused A before body/domain/provider effects', async ({ invoke, name }) => {
    const membership = io.state.memberships.find((row) => row.companyId === 'A')
    if (!membership) throw new Error('missing A fixture')
    membership.companyStatus = 'paused'
    const parse = vi.fn(async () => ({ billing_month: '2026-08' }))
    const request = { json: parse } as unknown as Request

    const response = await invoke('A', null, name === 'provider status GET' ? undefined : request)

    expect(response.status).toBe(403)
    expect(parse).not.toHaveBeenCalled()
    expect(businessCalls()).toEqual([])
    expect(io.state.http).toEqual([])
  })

  it.each(endpoints.filter((endpoint) => !endpoint.write))('$name preserves paused-company history reads', async ({ invoke }) => {
    const membership = io.state.memberships.find((row) => row.companyId === 'A')
    if (!membership) throw new Error('missing A fixture')
    membership.companyStatus = 'paused'
    io.state.periodLocked = true

    const response = await invoke('A')

    expect(response.status).toBe(200)
    expect(scopedCompanies()).not.toContain('B')
  })

  it.each(endpoints)('$name preserves selected authoritative platform access without membership', async ({ invoke }) => {
    io.state.platform = true
    io.state.cookie = 'B'
    io.state.memberships = []
    io.state.operationalOrder = []

    const response = await invoke('B', 'B')

    expect(response.status).toBe(200)
    expect((io.state.calls as DbCall[]).some((call) => call.table === 'company_memberships')).toBe(false)
    expect((io.state.calls as DbCall[]).some((call) => call.table === 'companies' && call.filters.id === 'B')).toBe(true)
  })

  it.each([endpoints[6], endpoints[7]])('$name accepts an explicit active platform company without a selected cookie', async ({ invoke }) => {
    io.state.platform = true
    io.state.cookie = null
    io.state.memberships = []
    io.state.operationalOrder = []

    const response = await invoke('B', 'B')

    expect(response.status).toBe(200)
    expect((io.state.calls as DbCall[]).some((call) => call.table === 'company_memberships')).toBe(false)
    expect((io.state.calls as DbCall[]).some((call) => call.table === 'companies' && call.filters.id === 'B')).toBe(true)
  })

  it.each([
    { endpoint: endpoints[6], status: 200 },
    { endpoint: endpoints[7], status: 403 },
  ])('$endpoint.name applies read/write lifecycle policy to an explicit paused platform company', async ({ endpoint, status }) => {
    io.state.platform = true
    io.state.cookie = null
    io.state.memberships = []
    io.state.operationalOrder = []
    io.state.companies.B = 'paused'

    const response = await endpoint.invoke('B', 'B')

    expect(response.status).toBe(status)
    expect((io.state.calls as DbCall[]).some((call) => call.table === 'company_memberships')).toBe(false)
    expect((io.state.calls as DbCall[]).some((call) => call.table === 'companies' && call.filters.id === 'B')).toBe(true)
    if (endpoint.write) expect(io.state.http).toEqual([])
  })

  it.each(endpoints)('$name makes authoritative platform no-selection fail closed before effects', async ({ invoke, write }) => {
    io.state.platform = true
    io.state.cookie = null
    io.state.memberships = []
    io.state.operationalOrder = ['B']
    const parse = vi.fn(async () => ({ billing_month: '2026-08' }))
    const request = { json: parse } as unknown as Request

    const response = await invoke('B', null, write ? request : undefined)

    expect(response.status).toBe(403)
    expect(parse).not.toHaveBeenCalled()
    expect(io.from).not.toHaveBeenCalled()
    expect(io.state.http).toEqual([])
  })

  it.each([endpoints[6], endpoints[7]])('$name does not infer platform authority from a role string', async ({ invoke }) => {
    io.state.cookie = 'A'
    io.state.roles = ['super_admin']

    const response = await invoke('B', 'B')

    expect(response.status).toBe(403)
    expect(businessCalls()).toEqual([])
    expect(io.state.http).toEqual([])
  })

  it('retains the real billing-period lock before underlay persistence', async () => {
    io.state.periodLocked = true

    const response = await generateUnderlay(jsonRequest({ billing_month: '2026-08' }))

    expect(response.status).toBe(409)
    expect((io.state.calls as DbCall[]).some((call) => call.rpc === 'gridex_store_billing_underlay_batch')).toBe(false)
  })

  it('retains the real pricing evidence guard before locking a run', async () => {
    io.state.blockedUnderlay = true

    const response = await lockPreview(jsonRequest({ pricing_run_id: 'run-A' }))

    expect(response.status).toBe(500)
    expect((io.state.calls as DbCall[]).some((call) => call.rpc === 'gridex_lock_pricing_run')).toBe(false)
  })
})
