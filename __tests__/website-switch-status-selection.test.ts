import { NextRequest } from 'next/server'
import { beforeEach, expect, it, vi } from 'vitest'
import { GET as readCheckout } from '@/app/api/v1/website/customer-applications/[applicationId]/route'
import { GET as readSwitch } from '@/app/api/v1/website/switch-status/route'

type Row = Record<string, unknown>
const io = vi.hoisted(() => ({
  rows: {} as Record<string, Row[]>,
  queries: [] as URL[],
  access: vi.fn(),
  switchRowCap: Number.POSITIVE_INFINITY,
}))

vi.mock('server-only', () => ({}))
vi.mock('@/lib/integrations/apiAuth', async original => ({
  ...await original<typeof import('@/lib/integrations/apiAuth')>(),
  requireIntegrationApiAccess: io.access,
  logIntegrationApiRequest: vi.fn(),
}))
vi.mock('@/lib/integrations/tenantContext', async original => ({
  ...await original<typeof import('@/lib/integrations/tenantContext')>(),
  loadExternalTenantContext: async () => ({ tenant_reference: 'synthetic-org' }),
}))
vi.mock('@/lib/supabase/service', async () => {
  const { createClient } = await import('@supabase/supabase-js')
  return {
    supabaseService: createClient('https://synthetic.example.test', 'fixture-only', {
      auth: { autoRefreshToken: false, persistSession: false },
      global: { fetch: fetchFixture },
    }),
  }
})

async function fetchFixture(input: RequestInfo | URL, init?: RequestInit) {
  const request = new Request(input, init)
  const url = new URL(request.url)
  expect(url.origin).toBe('https://synthetic.example.test')
  expect(request.method).toBe('GET')
  io.queries.push(url)
  const table = url.pathname.split('/').at(-1) ?? ''
  const rows = io.rows[table]
  if (!rows) throw new Error(`Unknown fixture table ${table}`)
  const filtered = rows.filter(row => {
    for (const [field, predicate] of url.searchParams) {
      if (['limit', 'select', 'order'].includes(field)) continue
      if (field === 'or') {
        const siteFilter = /^\(customer_site_id\.eq\.([^,]+),and\(customer_site_id\.is\.null,site_id\.eq\.([^)]*)\)\)$/.exec(predicate)
        if (!siteFilter) throw new Error(`Unexpected site predicate ${predicate}`)
        if (row.customer_site_id !== siteFilter[1] && (row.customer_site_id != null || row.site_id !== siteFilter[2])) return false
      } else if (predicate.startsWith('eq.')) {
        if (row[field] !== predicate.slice(3)) return false
      } else if (predicate.startsWith('cs.')) {
        if (!Object.entries(JSON.parse(predicate.slice(3))).every(([k, v]) => (row[field] as Row | undefined)?.[k] === v)) return false
      } else {
        throw new Error(`Unexpected filter ${predicate}`)
      }
    }
    return true
  })
  for (const term of (url.searchParams.get('order') ?? '').split(',').reverse()) {
    if (!term) continue
    const [col, direction] = term.split('.')
    filtered.sort((a, b) => String(a[col]).localeCompare(String(b[col])) * (direction === 'desc' ? -1 : 1))
  }
  const count = Number(url.searchParams.get('limit') ?? filtered.length)
  const returned = table === 'supplier_switch_requests' ? Math.min(count, io.switchRowCap) : count
  const columns = url.searchParams.get('select')?.split(',') ?? []
  return Response.json(filtered.slice(0, returned).map(row => Object.fromEntries(columns.map(field => [field, row[field] ?? null]))))
}

const uuid = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`
const company = uuid(1), customer = uuid(2), applicationId = uuid(3), site = uuid(4), contract = uuid(5), meter = uuid(6)
const first = uuid(10), later = uuid(11)
const number = 'APP-SYNTHETIC-143'
const oldAt = '2026-10-12T10:00:00Z', newAt = '2026-10-13T10:00:00Z'

function switchRow(id: string, status: string, at: string, changes: Row = {}): Row {
  return {
    id, status, company_id: company, customer_id: customer, site_id: site, customer_site_id: site,
    contract_id: contract, customer_contract_id: contract, metering_point_id: meter, created_at: at,
    updated_at: at, ...changes,
  }
}

function checkoutResponse() {
  return readCheckout(new NextRequest(`https://ops.example.test/api/v1/website/customer-applications/${number}`),
    { params: Promise.resolve({ applicationId: number }) })
}

function switchResponse() {
  return readSwitch(new NextRequest(`https://ops.example.test/api/v1/website/switch-status?application_number=${number}`))
}

async function responseStatuses() {
  const checkout = await checkoutResponse()
  const switchStatus = await switchResponse()
  expect(checkout.status).toBe(200)
  expect(switchStatus.status).toBe(200)
  return {
    checkout: (await checkout.json()).data.supplier_switch_status,
    switchStatus: (await switchStatus.json()).data.switch?.status,
  }
}

beforeEach(() => {
  vi.clearAllMocks()
  io.queries = []
  io.switchRowCap = Number.POSITIVE_INFINITY
  io.access.mockResolvedValue({ ok: true, context: { companyId: company }, client: { id: 'synthetic-client' } })
  io.rows = {
    website_customer_applications: [{ id: applicationId, company_id: company, customer_id: customer,
      customer_site_id: site, contract_id: contract, metering_point_id: meter, application_number: number,
      status: 'processing', response_payload: { supplier_switch_request_id: first }, updated_at: oldAt }],
    customer_application_workflows: [], customer_supply_periods: [], customer_contracts: [{
      id: contract, company_id: company, status: 'signed', contract_number: 'SYNTHETIC-C',
    }],
    customer_operation_jobs: [], communication_logs: [], domain_events: [], supplier_switch_events: [],
    supplier_switch_requests: [switchRow(first, 'confirmed', oldAt), switchRow(later, 'failed', newAt)],
  }
})

it('uses the persisted same-tenant switch on both status routes when the later row ties on lineage', async () => {
  io.switchRowCap = 2
  expect(await responseStatuses()).toEqual({ checkout: 'confirmed', switchStatus: 'confirmed' })
  const lookups = io.queries.filter(url => url.pathname.endsWith('/supplier_switch_requests'))
  expect(lookups).toHaveLength(2)
  for (const lookup of lookups) {
    expect(lookup.searchParams.get('id')).toBe('eq.' + first)
    expect(lookup.searchParams.get('customer_id')).toBe('eq.' + customer)
    expect(lookup.searchParams.has('limit')).toBe(false)
  }
  const events = io.queries.filter(url => url.pathname.endsWith('/supplier_switch_events'))
  expect(events).toHaveLength(1)
  expect(events[0].searchParams.get('switch_request_id')).toBe('eq.' + first)
})

it('does not choose a persisted request linked to another customer in the same company', async () => {
  io.rows.supplier_switch_requests[0].customer_id = uuid(22)
  io.rows.supplier_switch_requests[0].status = 'confirmed'
  expect(await responseStatuses()).toEqual({ checkout: 'failed', switchStatus: 'failed' })
})

it('selects the best matching legacy contract rather than a newer other contract in either route', async () => {
  io.rows.website_customer_applications[0].response_payload = {}
  io.rows.supplier_switch_requests[0].customer_site_id = null
  io.rows.supplier_switch_requests[0].customer_contract_id = null
  io.rows.supplier_switch_requests[1].contract_id = uuid(23)
  io.rows.supplier_switch_requests[1].customer_contract_id = uuid(23)
  expect(await responseStatuses()).toEqual({ checkout: 'confirmed', switchStatus: 'confirmed' })
})

it('ignores a stale saved link whose canonical site supersedes a stale matching alias', async () => {
  io.rows.supplier_switch_requests[0].customer_site_id = uuid(22)
  expect(await responseStatuses()).toEqual({ checkout: 'failed', switchStatus: 'failed' })
  const events = io.queries.filter(url => url.pathname.endsWith('/supplier_switch_events'))
  expect(events).toHaveLength(1)
  expect(events[0].searchParams.get('switch_request_id')).toBe('eq.' + later)
})

it.each([50, 2])('finds a verified legacy site behind other switches with response cap %i', async cap => {
  io.switchRowCap = cap
  io.rows.website_customer_applications[0].response_payload = {}
  io.rows.supplier_switch_requests = [
    switchRow(first, 'confirmed', oldAt, { customer_site_id: null, customer_contract_id: null }),
    ...Array.from({ length: 55 }, (_, index) => switchRow(uuid(100 + index), 'failed', newAt, {
      customer_site_id: uuid(24),
    })),
  ]
  expect(await responseStatuses()).toEqual({ checkout: 'confirmed', switchStatus: 'confirmed' })
  const fencedLookups = io.queries.filter(url => url.searchParams.has('or'))
  expect(fencedLookups).toHaveLength(2)
  for (const query of fencedLookups) {
    expect(query.searchParams.get('or')).toBe(`(customer_site_id.eq.${site},and(customer_site_id.is.null,site_id.eq.${site}))`)
    expect(query.searchParams.get('company_id')).toBe('eq.' + company)
    expect(query.searchParams.get('customer_id')).toBe('eq.' + customer)
    expect(query.searchParams.get('order')).toBe('created_at.desc,id.desc')
  }
})

it('keeps the published envelopes when customer-only historical matches are ambiguous', async () => {
  Object.assign(io.rows.website_customer_applications[0], {
    response_payload: {}, customer_site_id: null, contract_id: null, metering_point_id: null,
  })
  const checkout = await checkoutResponse()
  expect(checkout.status).toBe(409)
  expect(await checkout.json()).toMatchObject({ error: { code: 'application_status_lineage_ambiguous' } })
  const switchStatus = await switchResponse()
  expect(switchStatus.status).toBe(200)
  expect(await switchStatus.json()).toMatchObject({ data: { switch: null } })
  expect(io.queries.some(url => url.pathname.endsWith('/supplier_switch_events'))).toBe(false)
})

it('does not read switches when the application has no verified customer', async () => {
  io.rows.website_customer_applications[0].customer_id = null
  expect(await responseStatuses()).toEqual({ checkout: 'not_started', switchStatus: undefined })
  expect(io.queries.some(url => url.pathname.endsWith('/supplier_switch_requests'))).toBe(false)
})

it('retains the ordinary scope and company fence', async () => {
  io.rows.supplier_switch_requests = [switchRow(first, 'confirmed', oldAt, { company_id: uuid(99) }), switchRow(later, 'failed', newAt)]
  expect(await responseStatuses()).toEqual({ checkout: 'failed', switchStatus: 'failed' })
  expect(io.access).toHaveBeenCalledWith(expect.anything(), ['website_switch_status.read'])
  for (const query of io.queries) {
    expect(query.searchParams.get('company_id')).toBe('eq.' + company)
  }
})
