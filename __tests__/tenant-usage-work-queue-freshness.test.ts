import { beforeEach, describe, expect, it, vi } from 'vitest'

type Row = Record<string, unknown>
type RequestRecord = { table: string; method: string; params: URLSearchParams }
const io = vi.hoisted(() => ({
  tables: {} as Record<string, Row[]>,
  failures: {} as Record<string, { code: string; message: string }>,
  countOverrides: {} as Record<string, string | null>,
  companyReply: undefined as unknown,
  requests: [] as RequestRecord[],
  cache: new Map<string, Promise<unknown>>(),
  activeCounts: new Map<string, { activeCustomers: number }>(),
  actorSummaries: [] as unknown[],
  actorScope: undefined as unknown,
  gate: undefined as undefined | ((request: RequestRecord) => Promise<void>),
  inFlight: 0,
  maxInFlight: 0,
}))
vi.mock('next/cache', () => ({
  // The external Next cache port remains warm across calls inside each test.
  // Readers, SDK query builders, filtering and work-item mapping stay real.
  unstable_cache: (reader: () => Promise<unknown>, keys: string[]) => () => {
    const key = keys.join(':')
    if (!io.cache.has(key)) io.cache.set(key, reader())
    return io.cache.get(key)
  },
}))
vi.mock('@/lib/ediel/actorTesting', () => ({
  listActorTestingSummaries: async (scope: unknown) => {
    io.actorScope = scope
    return io.actorSummaries
  },
}))
vi.mock('@/lib/supabase/service', async () => {
  const { createClient } = await import('@supabase/supabase-js')
  return {
    supabaseService: createClient('http://127.0.0.1:54321', 'synthetic-unit-key', {
      auth: { persistSession: false, autoRefreshToken: false },
      global: {
        fetch: async (input, init) => {
          const url = new URL(input instanceof Request ? input.url : String(input))
          const request = { table: url.pathname.split('/').at(-1)!, method: init?.method ?? 'GET', params: url.searchParams }
          io.requests.push(request)
          io.inFlight++
          io.maxInFlight = Math.max(io.maxInFlight, io.inFlight)
          try {
            await io.gate?.(request)
            if (io.failures[request.table]) return new Response(JSON.stringify(io.failures[request.table]), { status: 500 })
            if (request.table === 'gridex_customer_portfolio_active_counts') {
              const { p_company_ids: companyIds } = JSON.parse(String(init?.body)) as { p_company_ids: string[] }
              const rows = companyIds.map(companyId => ({
                company_id: companyId,
                active_customers: io.activeCounts.get(companyId)?.activeCustomers ?? 0,
                active_metering_points: 0,
              }))
              return new Response(JSON.stringify(rows), { headers: { 'content-type': 'application/json' } })
            }
            if (request.table === 'companies' && io.companyReply !== undefined) {
              return new Response(JSON.stringify(io.companyReply), { headers: { 'content-type': 'application/json' } })
            }
            let rows = [...(io.tables[request.table] ?? [])]
            for (const [field, value] of url.searchParams) {
              if (['select', 'order', 'limit'].includes(field)) continue
              const dot = value.indexOf('.')
              const operator = value.slice(0, dot)
              const argument = value.slice(dot + 1)
              if (operator === 'eq') rows = rows.filter(row => String(row[field]) === argument)
              else if (operator === 'is' && argument === 'null') rows = rows.filter(row => row[field] === null)
              else throw new Error('Unsupported synthetic usage query: ' + field + '=' + value)
            }
            if (request.method === 'HEAD') {
              const count = Object.hasOwn(io.countOverrides, request.table) ? io.countOverrides[request.table] : String(rows.length)
              return new Response(null, { headers: count === null ? {} : { 'content-range': '0-0/' + count } })
            }
            const order = url.searchParams.get('order')
            if (order) {
              const [column, direction] = order.split('.')
              rows.sort((a, b) => {
                if (a[column] == null) return b[column] == null ? 0 : direction === 'desc' ? -1 : 1
                if (b[column] == null) return direction === 'desc' ? 1 : -1
                return String(a[column]).localeCompare(String(b[column])) * (direction === 'desc' ? -1 : 1)
              })
            }
            const limit = url.searchParams.get('limit')
            if (limit) rows = rows.slice(0, Number(limit))
            return new Response(JSON.stringify(rows), { headers: { 'content-type': 'application/json' } })
          } finally { io.inFlight-- }
        },
      },
    }),
  }
})

import * as usage from '@/lib/tenant/usageStats'
import { listPlatformWorkQueueItems } from '@/lib/platform/workQueue'

const companyA = '11111111-1111-4111-8111-111111111111'
const companyB = '22222222-2222-4222-8222-222222222222'
const operational = [
  { table: 'customer_blockers', status: 'open', id: 'usage-blockers-' },
  { table: 'customer_info_requests', status: 'waiting_response', id: 'usage-info-requests-' },
  { table: 'billing_export_run_items', status: 'blocked', id: 'usage-billing-blocked-' },
]
function company(id = companyA, name: string | null = 'Synthetic company'): Row {
  return { id, name, status: 'active', created_at: '2026-10-01T00:00:00Z' }
}
async function freshRows(): Promise<Array<Record<string, unknown>>> {
  const read = Reflect.get(usage, 'listTenantOperationalUsageStats')
  expect(read).toBeTypeOf('function')
  return read()
}
function scopedRequests(table: string, companyId = companyA) {
  return io.requests.filter(request => request.table === table && request.params.get('company_id') === 'eq.' + companyId)
}

beforeEach(() => {
  io.tables = { companies: [company()] }
  io.failures = {}
  io.countOverrides = {}
  io.companyReply = undefined
  io.requests = []
  io.cache.clear()
  io.activeCounts = new Map([[companyA, { activeCustomers: 7 }]])
  io.actorSummaries = []
  io.actorScope = undefined
  io.gate = undefined
  io.inFlight = 0
  io.maxInFlight = 0
})

describe('fresh platform operations with warm tenant statistics', () => {
  it.each(operational)('shows newly actionable $table while cached statistics remain zero', async ({ table, status, id }) => {
    expect((await usage.listTenantUsageStats())[0].customerBlockers).toBe(0)
    io.tables[table] = [{ id: 'synthetic-row', company_id: companyA, status }]
    const items = await listPlatformWorkQueueItems()
    expect(items.find(item => item.id === id + companyA)).toMatchObject({ companyId: companyA, metric: 1, status: 'warning' })
    const stats = (await usage.listTenantUsageStats())[0]
    expect([stats.customerBlockers, stats.waitingInfoRequests, stats.blockedBillingRows]).toEqual([0, 0, 0])
  })
  it.each(operational)('removes a closed $table item while cached statistics retain the old count', async ({ table, status, id }) => {
    io.tables[table] = [{ id: 'synthetic-row', company_id: companyA, status }]
    await usage.listTenantUsageStats()
    expect((await listPlatformWorkQueueItems()).some(item => item.id === id + companyA)).toBe(true)
    io.tables[table][0].status = 'closed'
    expect((await listPlatformWorkQueueItems()).some(item => item.id === id + companyA)).toBe(false)
    const stats = (await usage.listTenantUsageStats())[0]
    expect([stats.customerBlockers, stats.waitingInfoRequests, stats.blockedBillingRows]).toContain(1)
  })
  it('rereads company inventory and binds counts and labels to each current company', async () => {
    await usage.listTenantUsageStats()
    io.tables.companies.push(company(companyB, 'Synthetic second company'))
    io.tables.customer_blockers = [
      ...Array.from({ length: 11 }, (_, i) => ({ id: 'a' + i, company_id: companyA, status: 'open' })),
      { id: 'b', company_id: companyB, status: 'open' },
      { id: 'foreign', company_id: 'foreign', status: 'open' },
    ]
    const items = await listPlatformWorkQueueItems()
    expect(items).toHaveLength(2)
    expect(items[0]).toMatchObject({ companyId: companyA, metric: 11, status: 'critical' })
    expect(items[1]).toMatchObject({ companyId: companyB, companyName: 'Synthetic second company', metric: 1, status: 'warning' })
    expect(await usage.listTenantUsageStats()).toHaveLength(1)
  })
  it('does not load statistical counts or the supplied-customer RPC for a fresh operational read', async () => {
    expect(await freshRows()).toMatchObject([{ companyId: companyA, customerBlockers: 0, waitingInfoRequests: 0, blockedBillingRows: 0 }])
    const counts = io.requests.filter(request => request.method === 'HEAD')
    expect(counts.map(request => request.table).sort()).toEqual(['billing_export_run_items', 'customer_blockers', 'customer_info_requests'])
    expect(io.requests.some(request => request.table.startsWith('gridex_'))).toBe(false)
  })
  it('reuses the identical authorization scope count once but preserves both statistical fields and supplied-customer definition', async () => {
    io.tables.companies.push(company(companyB))
    io.tables.authorization_scopes = [{ id: 'a', company_id: companyA }, { id: 'b', company_id: companyB }]
    const rows = await usage.listTenantUsageStats()
    expect(rows.map(row => [row.authorizations, row.authorizationScopes, row.activeCustomers])).toEqual([[1, 1, 7], [1, 1, 0]])
    expect(scopedRequests('authorization_scopes', companyA)).toHaveLength(1)
    expect(scopedRequests('authorization_scopes', companyB)).toHaveLength(1)
  })
  it('preserves optional relation compatibility only for cached statistics', async () => {
    io.failures.authorization_scopes = { code: '42P01', message: 'Synthetic optional relation does not exist' }
    expect((await usage.listTenantUsageStats())[0]).toMatchObject({ authorizations: 0, authorizationScopes: 0 })
  })
  it('keeps the same five nullable activity hints and chooses their latest valid timestamp', async () => {
    io.tables.platform_usage_events = [{ company_id: companyA, occurred_at: '2026-10-01T00:00:00Z' }]
    io.tables.customers = [{ company_id: companyA, updated_at: 'not-a-date' }]
    io.tables.customer_contracts = [{ company_id: companyA, updated_at: null }]
    io.tables.ediel_messages = [{ company_id: companyA, updated_at: '2026-10-12T00:00:00Z' }]
    io.tables.billing_export_runs = [{ company_id: companyB, updated_at: '2026-10-14T00:00:00Z' }]
    expect(await freshRows()).toMatchObject([{ lastActivityAt: '2026-10-12T00:00:00Z' }])
    const timestamps = io.requests.filter(request => request.method === 'GET' && request.table !== 'companies')
    expect(timestamps.map(request => request.table).sort()).toEqual(['billing_export_runs', 'customer_contracts', 'customers', 'ediel_messages', 'platform_usage_events'])
    expect(timestamps.every(request => request.params.get('company_id') === 'eq.' + companyA)).toBe(true)
  })
  it('retains null activity hints on missing or failed timestamp reads without hiding count errors', async () => {
    io.failures.platform_usage_events = { code: '42501', message: 'Synthetic optional activity hint denied' }
    expect(await freshRows()).toMatchObject([{ lastActivityAt: null, customerBlockers: 0 }])
  })
  it('preserves platform actor semantics while independently loading fresh operational usage', async () => {
    io.actorSummaries = [{ company: { id: companyA, name: 'Synthetic actor', status: 'paused', created_at: null, updated_at: null }, missingSetup: [], blockedTests: 0, actorTestStatus: null, goLiveBlockers: [], productionReadiness: null, latestRunAt: null }]
    io.tables.customer_blockers = [{ id: 'b', company_id: companyA, status: 'open' }]
    expect((await listPlatformWorkQueueItems()).map(item => [item.type, item.status])).toEqual([['tenant_status', 'critical'], ['usage', 'warning']])
    expect(io.actorScope).toEqual({ scope: 'platform' })
  })
})

describe('operational unavailability and bounded company inventory', () => {
  it.each(['42P01', '42703', 'PGRST205', '42501', '08006'])('propagates operational count failure %s instead of healthy empty queue', async code => {
    await usage.listTenantUsageStats()
    io.failures.customer_blockers = { code, message: 'Synthetic operational count unavailable' }
    await expect(listPlatformWorkQueueItems()).rejects.toMatchObject({ code })
  })
  it.each(['customer_info_requests', 'billing_export_run_items'])('also propagates unavailable count for %s', async table => {
    await usage.listTenantUsageStats()
    io.failures[table] = { code: '42501', message: 'Synthetic operational count denied' }
    await expect(listPlatformWorkQueueItems()).rejects.toMatchObject({ code: '42501' })
    delete io.failures[table]
    io.countOverrides[table] = null
    await expect(listPlatformWorkQueueItems()).rejects.toMatchObject({ code: 'TENANT_OPERATIONAL_COUNT_UNAVAILABLE' })
  })
  it.each([null, '-1', 'NaN'])('refuses unavailable or invalid exact count %j', async count => {
    await usage.listTenantUsageStats()
    io.countOverrides.customer_blockers = count
    await expect(listPlatformWorkQueueItems()).rejects.toMatchObject({ code: 'TENANT_OPERATIONAL_COUNT_UNAVAILABLE' })
  })
  it.each([
    null,
    {},
    [{ name: 'Missing id' }],
    [company('')],
    [company('not-a-company-uuid')],
    [{ ...company(), name: 42 }],
    [company(), company()],
  ])('refuses malformed company inventory before issuing company-scoped reads: %j', async rows => {
    io.companyReply = rows
    await expect(freshRows()).rejects.toMatchObject({ code: 'TENANT_OPERATIONAL_COMPANIES_UNAVAILABLE' })
    expect(io.requests.map(request => request.table)).toEqual(['companies'])
  })
  it('propagates company discovery errors before company-scoped reads', async () => {
    io.failures.companies = { code: '42501', message: 'Synthetic company inventory denied' }
    await expect(freshRows()).rejects.toMatchObject({ code: '42501' })
    expect(io.requests.map(request => request.table)).toEqual(['companies'])
  })
  it('accepts a genuine empty inventory and null company name', async () => {
    io.tables.companies = []
    expect(await freshRows()).toEqual([])
    io.tables.companies = [company(companyA, null)]
    expect(await freshRows()).toMatchObject([{ companyName: 'Bolag utan namn' }])
  })
  it('keeps the existing 250-company discovery bound without claiming all-company completeness', async () => {
    io.tables.companies = Array.from({ length: 251 }, (_, i) => company('00000000-0000-4000-8000-' + String(i).padStart(12, '0')))
    expect(await freshRows()).toHaveLength(250)
  })
  it('limits simultaneous per-company reads while processing more than one company batch', async () => {
    io.tables.companies = Array.from({ length: 11 }, (_, i) => company('00000000-0000-4000-8000-' + String(i).padStart(12, '0')))
    io.gate = async request => {
      if (request.table !== 'companies') await new Promise<void>(resolve => setImmediate(resolve))
    }
    expect(await freshRows()).toHaveLength(11)
    expect(io.maxInFlight).toBeLessThanOrEqual(48)
    expect(io.maxInFlight).toBeGreaterThan(1)
  })
})
