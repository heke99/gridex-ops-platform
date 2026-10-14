import React from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { writeFileSync } from 'node:fs'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

type Row = Record<string, unknown>
type Read = { resource: string; query: string; args?: Row; responseBytes: number }
const io = vi.hoisted(() => ({
  user: null as { id: string; email: string } | null,
  tables: {} as Record<string, Row[]>,
  reads: [] as Read[],
  failures: {} as Record<string, { code: string; message: string }>,
  months: [] as Row[],
  authCalls: 0,
}))

vi.mock('server-only', () => ({}))
vi.mock('next/navigation', () => ({ redirect: (url: string) => { throw new Error(`redirect:${url}`) } }))
vi.mock('next/link', () => ({
  default: ({ href, children, ...props }: { href: string; children: React.ReactNode }) =>
    React.createElement('a', { href, ...props }, children),
}))
vi.mock('@/lib/supabase/server', () => ({
  createSupabaseServerClient: async () => ({
    auth: { getUser: async () => { io.authCalls++; return { data: { user: io.user }, error: null } } },
  }),
}))
vi.mock('@/lib/supabase/service', async () => {
  const { createClient } = await import('@supabase/supabase-js')
  return {
    supabaseService: createClient('http://127.0.0.1:54321', 'synthetic-unit-key', {
      auth: { persistSession: false, autoRefreshToken: false },
      global: {
        // Production context/loaders and SDK query construction remain real.
        // The finite transport enforces ordinary equality, order, scope and cap.
        fetch: async (input, init) => {
          const url = new URL(input instanceof Request ? input.url : String(input))
          const resource = url.pathname.split('/').at(-1)!
          const read: Read = { resource, query: url.searchParams.toString(), responseBytes: 0 }
          io.reads.push(read)
          const reply = (value: unknown, status = 200) => {
            const body = JSON.stringify(value)
            read.responseBytes = Buffer.byteLength(body)
            return new Response(body, { status, headers: { 'content-type': 'application/json' } })
          }
          if (io.failures[resource]) return reply(io.failures[resource], 500)
          if (url.pathname.includes('/rpc/')) {
            if (resource !== 'gridex_portal_monthly_consumption_v1') throw new Error(`Unexpected RPC: ${resource}`)
            read.args = JSON.parse(String(init?.body)) as Row
            if (read.args.p_company_id !== company || JSON.stringify(read.args.p_customer_ids) !== JSON.stringify([customer])) {
              return reply({ code: '42501', message: 'Synthetic monthly scope refused' }, 403)
            }
            return reply(io.months)
          }
          if (init?.method && init.method !== 'GET') throw new Error(`Unexpected write: ${resource}`)
          if (!Object.hasOwn(io.tables, resource)) throw new Error(`Unexpected table: ${resource}`)
          let rows = [...io.tables[resource]]
          for (const [field, expression] of url.searchParams) {
            if (['select', 'order', 'limit'].includes(field)) continue
            const dot = expression.indexOf('.')
            const operator = expression.slice(0, dot), value = expression.slice(dot + 1)
            rows = rows.filter(row => {
              if (row[field] == null) return false
              if (operator === 'eq') return String(row[field]) === value
              if (operator === 'in') return value.slice(1, -1).split(',').includes(String(row[field]))
              throw new Error(`Unexpected query operator: ${operator}`)
            })
          }
          const order = url.searchParams.get('order')?.split(',') ?? []
          rows.sort((a, b) => {
            for (const term of order) {
              const [field, direction, nullOrder] = term.split('.')
              const left = a[field], right = b[field]
              if (left == null && right == null) continue
              const nullFirst = nullOrder === 'nullsfirst' || (nullOrder === undefined && direction === 'desc')
              if (left == null) return nullFirst ? -1 : 1
              if (right == null) return nullFirst ? 1 : -1
              const difference = String(left).localeCompare(String(right)) * (direction === 'desc' ? -1 : 1)
              if (difference) return difference
            }
            return 0
          })
          const limit = url.searchParams.get('limit')
          if (limit) rows = rows.slice(0, Number(limit))
          const select = url.searchParams.get('select')
          if (select && select !== '*') rows = rows.map(row => Object.fromEntries(select.split(',').map(field => [field, row[field] ?? null])))
          return reply(rows)
        },
      },
    }),
  }
})

import * as portalDb from '@/lib/customer-portal/db'
import PortalPage from '@/app/portal/page'
import ConsumptionPage from '@/app/portal/forbrukning/page'

const uuid = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`
const company = uuid(1), customer = uuid(2), user = uuid(3), site = uuid(4), point = uuid(5), gridOwner = uuid(6)
const foreignCompany = uuid(7), foreignCustomer = uuid(8)
const timestamp = '2026-10-01T12:00:00.000Z'

function rawRows(count: number): Row[] {
  return Array.from({ length: count }, (_, n) => ({
    id: uuid(1000 + n), company_id: company, customer_id: customer, site_id: site,
    metering_point_id: point, source_request_id: null, grid_owner_id: gridOwner,
    reading_type: 'consumption', value_kwh: 1, quality_code: 'measured',
    read_at: new Date(Date.UTC(2026, 9, 1, 0, n * 15)).toISOString(),
    period_start: new Date(Date.UTC(2026, 9, 1, 0, n * 15)).toISOString(),
    period_end: new Date(Date.UTC(2026, 9, 1, 0, (n + 1) * 15)).toISOString(),
    source_system: 'synthetic', created_at: timestamp,
  }))
}

beforeEach(() => {
  vi.stubGlobal('React', React)
  vi.useFakeTimers({ toFake: ['Date'] })
  vi.setSystemTime(new Date('2026-10-14T12:00:00.000Z'))
  io.authCalls = 0
  io.reads = []
  io.failures = {}
  io.user = { id: user, email: 'synthetic@example.test' }
  io.months = [{ month_key: '2026-10', total_kwh: 700, value_count: 2500, is_complete: false }]
  io.tables = {
    customer_portal_accounts: [{ user_id: user, customer_id: customer, company_id: company, is_active: true, activated_at: timestamp }],
    customers: [{ id: customer, company_id: company, customer_number: 'TEST-1', customer_type: 'private', status: 'active', full_name: 'Anna Test', email: 'synthetic@example.test', created_at: timestamp }],
    companies: [{ id: company, name: 'Testbolag', branding: {}, support_email: null, primary_contact_email: null, website: null }],
    customer_invoices: [{ id: uuid(10), company_id: company, customer_id: customer, invoice_number: 'TEST-1', status: 'sent', amount_inc_vat: 1000, total_kwh: 120, period_start: '2026-09-01', period_end: '2026-10-01', issued_at: timestamp, created_at: timestamp }],
    customer_sites: [{ id: site, company_id: company, customer_id: customer, facility_id: '735999000000000001', grid_owner_id: gridOwner, status: 'active', created_at: timestamp }],
    metering_points: [{ id: point, site_id: site, meter_point_id: '735999000000000001', grid_owner_id: gridOwner, status: 'active', created_at: timestamp }],
    metering_values: rawRows(250),
    customer_contracts: [{ id: uuid(11), company_id: company, customer_id: customer, site_id: site, status: 'signed', contract_name: 'Elavtal', contract_type: 'spot', created_at: timestamp }],
    powers_of_attorney: [{ id: uuid(12), company_id: company, customer_id: customer, site_id: site, status: 'signed', scope: 'supplier_switch', signed_at: timestamp, created_at: timestamp }],
    customer_legal_acceptances: ['terms', 'privacy_policy', 'withdrawal_info'].map((acceptance, n) => ({ id: uuid(20 + n), company_id: company, customer_id: customer, acceptance_type: acceptance, accepted_at: timestamp, created_at: timestamp })),
    website_customer_applications: [{ id: uuid(30), company_id: company, customer_id: customer, customer_site_id: site, metering_point_id: point, facility_data_verified_at: timestamp, payload: {}, response_payload: {}, created_at: timestamp }],
  }
})
afterEach(() => { vi.useRealTimers(); vi.unstubAllGlobals() })

async function overview() {
  const read = Reflect.get(portalDb, 'getPortalOverviewData') as (() => ReturnType<typeof portalDb.getPortalDashboardData>) | undefined
  // RED exercises the existing public loader rather than failing module import.
  // After implementation this always executes the new public overview export.
  return read ? read() : portalDb.getPortalDashboardData()
}

function observe(data: unknown) {
  const path = process.env.GRIDEX_P21_OBSERVATION_PATH
  if (!path) return
  if (!/^quality\/system-build-execution-2026-10-14\/A\/p21-(before|after)\.json$/.test(path)) throw new Error('Invalid finite observation path')
  writeFileSync(path, JSON.stringify({
    scope: 'Actual public loader and installed SDK against the same finite external transport fixture. Server loader JSON and adapter response bytes only; not browser/RSC/live latency.',
    fixed_clock: '2026-10-14T12:00:00.000Z', raw_fixture_rows: 250,
    auth_calls: io.authCalls, service_reads: io.reads.length,
    raw_metering_reads: io.reads.filter(read => read.resource === 'metering_values').length,
    loader_json_bytes: Buffer.byteLength(JSON.stringify(data)),
    transport_response_bytes: io.reads.reduce((total, read) => total + read.responseBytes, 0),
    reads: io.reads,
  }, null, 2) + '\n')
}

describe('actual portal overview query budget and preserved detail consumers', () => {
  it('reads no raw detail on overview while retaining native monthly totals and status basis', async () => {
    const data = await overview()
    observe(data)
    expect(io.reads.filter(read => read.resource === 'metering_values')).toEqual([])
    expect(data.consumptionMonths).toEqual([{ monthKey: '2026-10', label: '2026-10', totalKwh: 700, valueCount: 2500, complete: false }])
    expect(data.customerStatus).toMatchObject({
      code: 'pending_supplier_switch', issues: [],
      supplier_switch: { can_create_request: true, can_dispatch: true, blockers: [], next_action: 'dispatch_request' },
    })
    expect(data.portalDisplayName).toBe('Anna Test')
  })

  it('returns the fields consumed by the overview without raw rows or internal status-source arrays', async () => {
    const data = await overview()
    expect(Object.keys(data).sort()).toEqual([
      'consumptionMonths', 'context', 'customerStatus', 'invoices', 'meteringPoints', 'portalDisplayName', 'sites',
    ])
  })

  it('renders overview cards and readiness with the actual minimal loader and no raw query', async () => {
    const html = renderToStaticMarkup(await PortalPage({}))
    expect(html).toContain('Välkommen, Anna Test')
    expect(html).toContain('700 kWh')
    expect(html).toContain('Leverantörsbyte förbereds')
    expect(html).toContain('Faktura TEST-1')
    expect(io.reads.filter(read => read.resource === 'metering_values')).toEqual([])
  })

  it('does not make overview availability depend on an unused raw-detail transport', async () => {
    io.failures.metering_values = { code: '08006', message: 'Synthetic unused detail failure' }
    await expect(overview()).resolves.toMatchObject({ portalDisplayName: 'Anna Test' })
    expect(io.reads.some(read => read.resource === 'metering_values')).toBe(false)
  })

  it.each([
    ['powers_of_attorney', 'missing_power_of_attorney'],
    ['customer_legal_acceptances', 'missing_legal_acceptance'],
  ])('retains the operational status effect of %s', async (table, blocker) => {
    io.tables[table] = []
    const data = await overview()
    expect(data.customerStatus.supplier_switch.can_dispatch).toBe(false)
    expect(data.customerStatus.supplier_switch.blockers).toContain(blocker)
  })

  it.each([
    'customer_invoices', 'customer_sites', 'metering_points', 'customer_contracts',
    'powers_of_attorney', 'customer_legal_acceptances', 'website_customer_applications',
    'gridex_portal_monthly_consumption_v1',
  ])('still propagates a required %s read failure', async resource => {
    io.failures[resource] = { code: '08006', message: 'Synthetic required source unavailable' }
    await expect(overview()).rejects.toMatchObject({ code: '08006' })
  })

  it('keeps the existing compatibility dashboard export and its raw250/detail inputs', async () => {
    const data = await portalDb.getPortalDashboardData()
    expect(data.meteringValues).toHaveLength(250)
    expect(data.contracts).toHaveLength(1)
    expect(data.powersOfAttorney).toHaveLength(1)
    expect(data.legalAcceptances).toHaveLength(3)
    expect(data.websiteApplications).toHaveLength(1)
    expect(data.consumptionMonths[0].totalKwh).toBe(700)
  })

  it('preserves the independent consumption page raw500 cap and native totals', async () => {
    io.tables.metering_values = rawRows(600)
    const html = renderToStaticMarkup(await ConsumptionPage())
    expect(html).toContain('Senaste 500 värden.')
    expect(html).toContain('700 kWh')
    const raw = io.reads.filter(read => read.resource === 'metering_values')
    expect(raw).toHaveLength(1)
    expect(new URLSearchParams(raw[0].query).get('limit')).toBe('500')
    expect(io.reads.filter(read => read.resource === 'gridex_portal_monthly_consumption_v1')).toHaveLength(1)
  })

  it('uses the existing active-tenant selection without mixing a less recent foreign account', async () => {
    io.tables.customer_portal_accounts.push({ user_id: user, customer_id: foreignCustomer, company_id: foreignCompany, is_active: true, activated_at: '2026-09-01T00:00:00.000Z' })
    io.tables.customers.push({ id: foreignCustomer, company_id: foreignCompany, full_name: 'Foreign customer', created_at: '2026-09-01T00:00:00.000Z' })
    io.tables.customer_invoices.push({ id: uuid(40), company_id: foreignCompany, customer_id: foreignCustomer, status: 'paid', invoice_number: 'FOREIGN', issued_at: timestamp })
    const data = await overview()
    expect(data.context.companyId).toBe(company)
    expect(data.context.customerIds).toEqual([customer])
    expect(data.invoices.map(invoice => invoice.id)).toEqual([uuid(10)])
    expect(io.reads.find(read => read.resource === 'gridex_portal_monthly_consumption_v1')?.args).toMatchObject({ p_company_id: company, p_customer_ids: [customer] })
  })

  it('keeps the unlinked empty page and skips downstream customer reads', async () => {
    io.tables.customer_portal_accounts = []
    const html = renderToStaticMarkup(await PortalPage({}))
    expect(html).toContain('Ingen kundkoppling hittades')
    expect(io.reads.map(read => read.resource)).toEqual(['customer_portal_accounts'])
  })

  it('preserves authentication redirect before any service data query', async () => {
    io.user = null
    await expect(overview()).rejects.toThrow('redirect:/login')
    expect(io.authCalls).toBe(1)
    expect(io.reads).toEqual([])
  })
})
