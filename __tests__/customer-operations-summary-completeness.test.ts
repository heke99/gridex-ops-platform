import React from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { createClient } from '@supabase/supabase-js'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

type Row = Record<string, unknown>
const port = vi.hoisted(() => ({
  parents: [] as Row[], tables: {} as Record<string, Row[]>,
  company: '11111111-1111-4111-8111-111111111111' as string | null, platform: false,
  failures: {} as Record<string, { code: string; message: string }>,
  counts: {} as Record<string, string | null>, bodies: {} as Record<string, unknown>,
  queries: [] as Array<{ table: string; params: Array<[string, string]> }>,
  guardError: null as Error | null,
}))

// Declared HTTP/permission/parent-page ports. The real SDK applies select,
// count and scope predicates; the actual page, reducer and lifecycle run.
function sdk() {
  return createClient('http://127.0.0.1:54321', 'synthetic-summary-key', {
    auth: { persistSession: false, autoRefreshToken: false },
    global: { fetch: async (input, init) => {
      const url = new URL(input instanceof Request ? input.url : String(input))
      const table = url.pathname.split('/').at(-1)!
      if (url.pathname.includes('/rpc/')) {
        expect(table).toBe('gridex_staff_customer_search_v1')
        return new Response(JSON.stringify({ customer_ids: port.parents.map(row => row.id), total: port.parents.length }), { headers: { 'content-type': 'application/json' } })
      }
      port.queries.push({ table, params: [...url.searchParams] })
      if (port.failures[table]) return new Response(JSON.stringify(port.failures[table]), { status: 500 })
      let rows = [...(port.tables[table] ?? [])]
      for (const [field, filter] of url.searchParams) {
        if (filter.startsWith('eq.')) rows = rows.filter(row => String(row[field]) === filter.slice(3))
        if (filter.startsWith('in.(')) {
          const values = filter.slice(4, -1).split(',').map(value => value.replaceAll('"', ''))
          rows = rows.filter(row => values.includes(String(row[field])))
        }
      }
      const order = url.searchParams.get('order')
      if (order) rows.sort((a, b) => {
        for (const entry of order.split(',')) {
          const [field, direction] = entry.split('.')
          const result = String(a[field] ?? '').localeCompare(String(b[field] ?? ''))
          if (result) return result * (direction === 'desc' ? -1 : 1)
        }
        return 0
      })
      const total = rows.length
      rows = rows.slice(0, Number(url.searchParams.get('limit') ?? Infinity))
      const select = url.searchParams.get('select')
      if (select && select !== '*') rows = rows.map(row => Object.fromEntries(select.split(',').map(field => [field.trim(), row[field.trim()]])))
      const body = Object.hasOwn(port.bodies, table) ? port.bodies[table] : rows
      const headers = new Headers({ 'content-type': 'application/json' })
      const requestHeaders = new Headers(init?.headers ?? (input instanceof Request ? input.headers : undefined))
      if (requestHeaders.get('prefer')?.includes('count=exact')) {
        const count = Object.hasOwn(port.counts, table) ? port.counts[table] : String(total)
        if (count !== null) headers.set('content-range', rows.length ? `0-${rows.length - 1}/${count}` : `*/${count}`)
      }
      return new Response(JSON.stringify(body), { headers })
    } },
  })
}
vi.mock('@/lib/supabase/service', () => ({ supabaseService: sdk() }))
vi.mock('@/lib/admin/guards', () => ({ requireAdminPageKeyAccess: async () => {
  if (port.guardError) throw port.guardError
  return { userId: 'operator', email: 'operator@example.test', companyId: port.company, permissions: [], roles: [], isPlatformAdmin: port.platform }
} }))
vi.mock('@/lib/tenant/adminScope', () => ({ resolveAdminTenantReadScope: async () => ({ companyId: port.company, isPlatformAdmin: port.platform }) }))
vi.mock('@/lib/tenant/scope', () => ({
  getOperationalCompanyScope: async () => ({ companyId: 'legacy-other', companyName: 'Valt bolag', isPlatformAdmin: port.platform }),
  isMissingRelationError: (error: { code?: string } | null) => ['42P01', 'PGRST205'].includes(error?.code ?? ''),
}))
vi.mock('@/lib/customers/getCustomers', () => ({ listCustomersPage: async () => ({
  rows: port.parents, total: port.parents.length, page: 1, pageSize: 100, totalPages: 1,
  counts: { all: port.parents.length, draft: 0, pending_verification: 0, active: port.parents.length, inactive: 0, moved: 0, terminated: 0, blocked: 0, archived: 0 },
}) }))
vi.mock('@/lib/customer-contracts/db', () => ({ listLatestCustomerContractsByCustomerIds: async () => new Map() }))
vi.mock('@/components/admin/AdminHeader', () => ({ default: ({ title }: { title: string }) => React.createElement('header', null, title) }))
vi.mock('@/components/admin/customers/CustomerActionsMenu', () => ({ default: ({ children }: { children: React.ReactNode }) => React.createElement('div', null, children) }))
vi.mock('next/link', () => ({ default: ({ href, children }: { href: string; children: React.ReactNode }) => React.createElement('a', { href }, children) }))

import { AdminCustomersPage } from '@/app/admin/customers/page.part-2'
import { readCustomerOperationsRows } from '@/lib/customers/operationsSummaryRead'

const COMPANY = '11111111-1111-4111-8111-111111111111'
const OTHER = '22222222-2222-4222-8222-222222222222'
const id = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`
const A = id(1), B = id(2), SITE_A = id(3), SITE_B = id(4), REQUEST_A = id(5), REQUEST_B = id(6)
function parent(customerId = A, companyId: string | null = COMPANY): Row {
  return { id: customerId, company_id: companyId, full_name: customerId === A ? 'Kund A' : 'Kund B', customer_number: 'SYNTHETIC', status: 'active', customer_type: 'private', site_count: 1, active_site_count: 1, metering_point_count: 0, active_metering_point_count: 0, created_at: '2026-10-01T10:00:00Z' }
}
function site(siteId = SITE_A, customerId = A, companyId = COMPANY): Row {
  return { id: siteId, company_id: companyId, customer_id: customerId, site_name: 'Anläggning', facility_id: null, status: 'active', grid_owner_id: null, grid_area_code: null, price_area_code: null, created_at: '2026-10-01T10:00:00Z', updated_at: '2026-10-01T10:00:00Z' }
}
function request(extra: Row = {}): Row {
  return { id: REQUEST_A, company_id: COMPANY, customer_id: A, site_id: SITE_A, metering_point_id: null, request_type: 'switch', status: 'submitted', external_reference: null, failure_reason: null, submitted_at: null, completed_at: null, failed_at: null, lifecycle_blocked: false, lifecycle_block_source: null, lifecycle_block_id: null, inbound_z04_message_id: id(7), confirmed_start_date: '2026-10-01', requested_start_date: '2026-10-01', created_at: '2026-10-01T10:00:00Z', updated_at: '2026-10-01T10:00:00Z', ...extra }
}
function outbound(extra: Row = {}): Row {
  return { id: id(8), company_id: COMPANY, customer_id: A, site_id: SITE_A, metering_point_id: null, request_type: 'supplier_switch', source_type: 'supplier_switch_request', source_id: REQUEST_A, status: 'sent', channel_type: 'ediel', external_reference: null, failure_reason: null, queued_at: null, prepared_at: null, sent_at: null, acknowledged_at: null, failed_at: null, created_at: '2026-10-01T10:00:00Z', updated_at: '2026-10-01T10:00:00Z', ...extra }
}
async function html(ops = 'all') {
  return renderToStaticMarkup(await AdminCustomersPage({ searchParams: Promise.resolve({ ops }) }))
}
function row(markup: string, customerId = A) {
  const result = [...markup.matchAll(/<tr[\s\S]*?<\/tr>/g)].map(match => match[0]).find(value => value.includes(`href="/admin/customers/${customerId}"`))
  expect(result, 'customer remains visible').toBeDefined()
  return result!
}
function unknown(markup: string, customerId = A) {
  expect(row(markup, customerId)).toMatch(/Underlaget är ofullständigt|Ärendestatusen kunde inte läsas/)
  expect(row(markup, customerId)).not.toContain('Ingen aktiv')
  expect(row(markup, customerId)).not.toContain('· Blockerade 0')
}
beforeEach(() => {
  vi.stubGlobal('React', React)
  vi.useFakeTimers(); vi.setSystemTime(new Date('2026-10-14T10:00:00Z'))
  vi.spyOn(console, 'warn').mockImplementation(() => undefined)
  port.parents = [parent()]; port.company = COMPANY; port.platform = false
  port.tables = { customer_sites: [], supplier_switch_requests: [], outbound_requests: [], customers: [], customer_contracts: [], powers_of_attorney: [], metering_points: [] }
  port.queries = []; port.failures = {}; port.counts = {}; port.bodies = {}; port.guardError = null
})
afterEach(() => { vi.useRealTimers(); vi.restoreAllMocks(); vi.unstubAllGlobals() })

describe('actual selected-customer summary coverage and canonical lifecycle', () => {
  it('retains true empty as no active signal and keeps exactly three bounded operational reads', async () => {
    expect(row(await html())).toContain('Ingen aktiv')
    expect(port.queries.filter(query => ['customer_sites', 'supplier_switch_requests', 'outbound_requests'].includes(query.table))).toHaveLength(3)
    for (const query of port.queries) expect(new URLSearchParams(query.params).get('limit')).toBe('150')
  })
  it.each(['customer_sites', 'supplier_switch_requests', 'outbound_requests'])('does not let many A children hide B behind the %s cap', async table => {
    port.parents = [parent(), parent(B)]
    port.tables.customer_sites = [site(), site(SITE_B, B)]
    port.tables.supplier_switch_requests = [request(), request({ id: REQUEST_B, customer_id: B, site_id: SITE_B })]
    port.tables.outbound_requests = [outbound(), outbound({ id: id(9), customer_id: B, site_id: SITE_B, source_id: REQUEST_B })]
    const exemplar = port.tables[table][0]
    port.tables[table] = [...Array.from({ length: 150 }, (_, n) => ({ ...exemplar, id: id(100 + n), created_at: '2026-10-10T10:00:00Z' })), port.tables[table][1]]
    unknown(await html(), B)
  })
  it.each(['42P01', 'PGRST204', 'NETWORK'])('does not convert %s read failure into a healthy empty signal', async code => {
    port.failures.supplier_switch_requests = { code, message: 'PRIVATE_DATABASE_DETAIL' }
    const markup = await html()
    unknown(markup)
    expect(markup).not.toContain('PRIVATE_DATABASE_DETAIL')
  })
  it.each([null, '*', '-1', 'NaN'])('does not certify empty from unavailable or malformed SDK count %s', async count => {
    port.counts.customer_sites = count
    unknown(await html())
  })
  // The SDK parseInt-normalizes HTTP count strings; fractional numbers must
  // therefore be exercised at the real adapter's typed response boundary.
  it.each([undefined, null, -1, 0.5, Number.NaN])('real adapter refuses unavailable or malformed numeric count %s', async count => {
    const result = await readCustomerOperationsRows(() => Promise.resolve({ data: [], count, error: null }), [], 'sites')
    expect(result.kind).toBe('unavailable')
  })
  it.each([null, {}, ['invalid'], [{}]])('does not certify malformed source body %j as empty', async body => {
    port.bodies.customer_sites = body
    unknown(await html())
  })
  it('holds duplicate source identity despite an apparently matching row count', async () => {
    port.tables.customer_sites = [site(), site()]
    unknown(await html())
  })
  it.each([null, id(999)])('holds owned legacy request with unresolved site %s instead of losing it', async siteId => {
    port.tables.supplier_switch_requests = [request({ site_id: siteId })]
    unknown(await html())
  })
  it.each(['company_id', 'customer_id', 'site_id', 'source_type', 'source_id'])('does not borrow an outbound with different %s', async field => {
    port.tables.customer_sites = [site()]; port.tables.supplier_switch_requests = [request()]
    port.bodies.outbound_requests = [outbound({ [field]: 'other' })]
    port.counts.outbound_requests = '1'
    unknown(await html())
  })
  it('does not use a foreign-company child even when a transport returns its ID', async () => {
    port.bodies.customer_sites = [site(SITE_A, A, OTHER)]; port.counts.customer_sites = '1'
    unknown(await html())
  })
  it('keeps platform-global composite parents distinct without ambient company inference', async () => {
    port.company = null; port.platform = true; port.parents = [parent(), parent(B, OTHER)]
    port.tables.customer_sites = [site(), site(SITE_B, B, OTHER)]
    port.tables.supplier_switch_requests = [request({ status: 'completed' }), request({ id: REQUEST_B, company_id: OTHER, customer_id: B, site_id: SITE_B, status: 'failed' })]
    const markup = await html()
    expect(row(markup)).toContain('Historik finns')
    expect(row(markup, B)).toContain('Kräver åtgärd')
  })
  it('does not infer selected parent company from ambient tenant when it is missing', async () => {
    port.parents = [parent(A, null)]
    unknown(await html())
  })
  it('does not trust a valid foreign-company parent returned under a tenant scope', async () => {
    port.parents = [parent(A, OTHER)]
    unknown(await html())
  })
  it('all three real child queries preserve canonical tenant company and selected customer IDs', async () => {
    await html()
    expect(port.queries).toHaveLength(3)
    for (const query of port.queries) {
      const params = new URLSearchParams(query.params)
      expect(params.get('company_id')).toBe(`eq.${COMPANY}`)
      expect(params.get('customer_id')).toBe(`in.(${A})`)
    }
  })
  it('platform-global reads are bound to both selected companies and never reassign a crossed request', async () => {
    port.company = null; port.platform = true; port.parents = [parent(), parent(B, OTHER)]
    port.tables.customer_sites = [site(), site(SITE_B, B, OTHER)]
    port.bodies.supplier_switch_requests = [request({ company_id: OTHER })]
    port.counts.supplier_switch_requests = '1'
    const markup = await html()
    unknown(markup)
    for (const query of port.queries) {
      expect(new URLSearchParams(query.params).get('company_id')).toBe(`in.(${COMPANY},${OTHER})`)
    }
  })
  it.each(['all', 'no_signal', 'ready_to_execute', 'active_open'])('keeps an unknown customer reviewable under filter %s without treating it as no signal', async ops => {
    port.counts.customer_sites = '151'
    const markup = await html(ops)
    unknown(markup)
    expect(markup).toContain('ärendestatus kunde inte fastställas')
  })
  it.each([
    ['blocked', 'accepted', null, null, 'Blockerad'],
    ['queued_for_outbound', 'submitted', null, null, 'Saknar utskick'],
    ['awaiting_dispatch', 'submitted', 'prepared', null, 'Väntar utskick'],
    ['awaiting_response', 'submitted', 'sent', null, 'Väntar kvittens'],
    ['awaiting_market_confirmation', 'submitted', 'acknowledged', null, 'Väntar på nätägarens bekräftelse'],
    ['awaiting_effective_date', 'accepted', null, '2099-01-01', 'Väntar på startdatum'],
    ['ready_to_execute', 'accepted', null, '2026-10-01', 'Redo att slutföra'],
    ['completed', 'completed', null, null, 'Historik finns'],
    ['failed', 'failed', null, null, 'Kräver åtgärd'],
  ] as const)('renders actual canonical %s without collapsing it into no signal', async (_stage, status, outboundStatus, date, label) => {
    port.tables.customer_sites = [site()]
    port.tables.supplier_switch_requests = [request({ status, inbound_z04_message_id: status === 'accepted' && date === null ? null : id(7), confirmed_start_date: date ?? '2026-10-01' })]
    port.tables.outbound_requests = outboundStatus ? [outbound({ status: outboundStatus })] : []
    expect(row(await html())).toContain(label)
  })
  it.each(['awaiting_market_confirmation', 'awaiting_effective_date'] as const)('actual %s has one open chain, is included in active_open and excluded from no_signal', async stage => {
    port.tables.customer_sites = [site()]
    port.tables.supplier_switch_requests = [request({ status: stage === 'awaiting_effective_date' ? 'accepted' : 'submitted', confirmed_start_date: stage === 'awaiting_effective_date' ? '2099-01-01' : '2026-10-01' })]
    port.tables.outbound_requests = stage === 'awaiting_market_confirmation' ? [outbound({ status: 'acknowledged' })] : []
    const active = await html('active_open')
    expect(row(active)).toContain('1 öppna')
    expect(active).toMatch(/<option value="no_signal">[^<]*\(0\)<\/option>/)
    expect(await html('no_signal')).not.toContain(`href="/admin/customers/${A}"`)
  })
  it('retains canonical permission refusal before any child query', async () => {
    port.guardError = new Error('permission refused')
    await expect(html()).rejects.toThrow('permission refused')
    expect(port.queries).toEqual([])
  })
  it('actual normalized company parent retains the selected row company', async () => {
    port.tables.customers = [parent()]
    const actual = await vi.importActual<typeof import('@/lib/customers/getCustomers')>('@/lib/customers/getCustomers')
    const result = await actual.listCustomersPageForCompany({ companyId: COMPANY })
    expect(result.rows[0]).toMatchObject({ id: A, company_id: COMPANY })
  })
})
