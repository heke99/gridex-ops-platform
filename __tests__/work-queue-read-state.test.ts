import React from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import type { SupabaseClient } from '@supabase/supabase-js'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

type Row = Record<string, unknown>
const io = vi.hoisted(() => ({
  tables: {} as Record<string, Row[]>,
  tableErrors: {} as Record<string, unknown>,
  tableRejections: {} as Record<string, unknown>,
  tableData: {} as Record<string, unknown>,
  rpcData: [] as unknown,
  rpcError: null as unknown,
  rpcRejection: null as unknown,
  guardError: null as unknown,
  admin: { userId: 'operator', email: 'operator@example.test', roles: ['tenant_admin'], permissions: [], companyId: 'tenant-A', isPlatformAdmin: false } as {
    userId: string; email: string; roles: string[]; permissions: string[]; companyId: string | null; isPlatformAdmin: boolean
  },
  legacyScope: vi.fn(),
  rpc: vi.fn(),
  createClient: vi.fn(),
}))

vi.mock('@/lib/admin/guards', () => ({
  requireAdminPageKeyAccess: async () => { if (io.guardError) throw io.guardError; return io.admin },
  isPlatformAdminContext: (admin: { isPlatformAdmin?: boolean }) => admin.isPlatformAdmin === true,
}))
vi.mock('@/lib/tenant/scope', async importOriginal => ({
  ...await importOriginal<typeof import('@/lib/tenant/scope')>(),
  getOperationalCompanyScope: io.legacyScope,
}))
vi.mock('@/lib/ediel/operations/processNextAction', () => ({ readEdielProcessNextActions: async () => new Map() }))
vi.mock('@/lib/supabase/server', () => ({ createSupabaseServerClient: io.createClient }))
vi.mock('next/link', () => ({
  default: ({ href, children }: { href: string; children: React.ReactNode }) => React.createElement('a', { href }, children),
}))

import WorkQueuePage from '@/app/admin/work-queue/page'
import { listCompanyWorkQueue } from '@/lib/performance/companySummaries'

const customer = {
  id: 'customer-A', company_id: 'tenant-A', customer_number: 'TEST-A', full_name: 'Kund A',
  first_name: null, last_name: null, company_name: null, email: 'customer@example.test',
  status: 'active', source: 'manual', created_at: '2026-10-14T10:00:00Z',
}
const queueRow = {
  id: 'work-A', company_id: 'tenant-A', customer_id: customer.id, source: 'Ärende',
  customer_number: customer.customer_number, customer_label: customer.full_name,
  title: 'Kontrollera startdatum', description: 'Startdatum behöver granskas.', status: 'needs_review',
  priority: 'high', created_at: customer.created_at, href: '/admin/customers/customer-A', action_label: 'Öppna kundkort',
}

function client(): SupabaseClient {
  return {
    rpc: io.rpc,
    from: (table: string) => {
      const filters: Array<(row: Row) => boolean> = []
      let limit = Infinity
      const query = {
        select: () => query,
        eq: (key: string, value: unknown) => { filters.push(row => row[key] === value); return query },
        in: (key: string, values: unknown[]) => { filters.push(row => values.includes(row[key])); return query },
        not: () => query,
        or: () => query,
        order: () => query,
        limit: (value: number) => { limit = value; return query },
        then: (resolve: (value: unknown) => unknown, reject: (error: unknown) => unknown) => {
          if (io.tableRejections[table]) return Promise.reject(io.tableRejections[table]).then(resolve, reject)
          return Promise.resolve({
            data: io.tableErrors[table] ? null : Object.hasOwn(io.tableData, table) ? io.tableData[table] : (io.tables[table] ?? []).filter(row => filters.every(filter => filter(row))).slice(0, limit),
            error: io.tableErrors[table] ?? null,
          }).then(resolve, reject)
        },
      }
      return query
    },
  } as unknown as SupabaseClient
}

function stat(html: string, label: string): string {
  const match = html.match(new RegExp(`<div[^>]*>${label}</div>\\s*<div[^>]*>([^<]*)</div>`))
  expect(match, `missing visible KPI ${label}`).not.toBeNull()
  return match![1]
}

function expectUnknownCounts(html: string) {
  for (const label of ['Synliga kunder', 'Ärenden i kö', 'Hög prioritet', 'Saknar fullmakt']) {
    expect(stat(html, label)).not.toMatch(/^\d+$/)
  }
}

beforeEach(() => {
  vi.stubGlobal('React', React)
  io.tables = {}
  io.tableErrors = {}
  io.tableRejections = {}
  io.tableData = {}
  io.rpcData = []
  io.rpcError = null
  io.rpcRejection = null
  io.guardError = null
  io.admin = { userId: 'operator', email: 'operator@example.test', roles: ['tenant_admin'], permissions: [], companyId: 'tenant-A', isPlatformAdmin: false }
  io.legacyScope.mockReset().mockResolvedValue({ companyId: 'tenant-B', companyName: 'Bolag B' })
  io.rpc.mockReset().mockImplementation(async () => {
    if (io.rpcRejection) throw io.rpcRejection
    return { data: io.rpcData, error: io.rpcError }
  })
  io.createClient.mockReset().mockImplementation(async () => client())
  vi.spyOn(console, 'warn').mockImplementation(() => undefined)
})
afterEach(() => { vi.restoreAllMocks(); vi.unstubAllGlobals() })

describe('actual helper transport contract', () => {
  it('returns an empty array only for a successful empty row set', async () => {
    await expect(listCompanyWorkQueue(client(), 'tenant-A')).resolves.toEqual([])
  })
  it('retains the existing array DTO and actual action target for valid rows', async () => {
    io.rpcData = [queueRow]
    await expect(listCompanyWorkQueue(client(), 'tenant-A')).resolves.toMatchObject([
      { id: 'work-A', companyId: 'tenant-A', customerId: customer.id, status: 'needs_review', href: queueRow.href },
    ])
  })
  it.each(['42501', '42P01', 'PGRST202'])('does not convert actual RPC %s failure into a successful empty array', async code => {
    io.rpcError = { code, message: 'private-database-detail@example.test' }
    await expect(listCompanyWorkQueue(client(), 'tenant-A')).rejects.toMatchObject({ code })
  })
  it('propagates transport rejection instead of returning an empty array', async () => {
    io.rpcRejection = new Error('private transport detail')
    await expect(listCompanyWorkQueue(client(), 'tenant-A')).rejects.toThrow('private transport detail')
  })
  it.each([null, { rows: [queueRow] }, [null], [{ ...queueRow, company_id: 'tenant-B' }], [{ ...queueRow, customer_id: undefined }]])(
    'refuses an invalid or foreign response rather than making it a usable empty/partial queue: %j', async data => {
      io.rpcData = data
      await expect(listCompanyWorkQueue(client(), 'tenant-A')).rejects.toThrow()
    },
  )
})

describe('actual page read states', () => {
  it('keeps truthful healthy empty rendering and numeric zero KPIs', async () => {
    const html = renderToStaticMarkup(await WorkQueuePage())
    expect(html).toContain('Inga aktiva driftuppgifter hittades')
    for (const label of ['Synliga kunder', 'Ärenden i kö', 'Hög prioritet', 'Saknar fullmakt']) expect(stat(html, label)).toBe('0')
  })
  it.each(['permission', 'schema', 'transport', 'invalid'])('shows unavailable rather than healthy zero for a central %s read failure', async kind => {
    if (kind === 'permission') io.rpcError = { code: '42501', message: 'private-database-detail@example.test' }
    if (kind === 'schema') io.rpcError = { code: 'PGRST202', message: 'private function schema' }
    if (kind === 'transport') io.rpcRejection = new Error('private transport detail')
    if (kind === 'invalid') io.rpcData = { rows: [queueRow] }
    const html = renderToStaticMarkup(await WorkQueuePage())
    expect(html).toContain('Arbetskön kunde inte läsas')
    expect(html).toContain('Försök igen')
    expect(html).not.toContain('Inga aktiva driftuppgifter hittades')
    expect(html).not.toContain('Det betyder att det inte finns något som behöver åtgärdas')
    expect(html).not.toContain('private')
    expect(html).toMatch(/Referens: [a-f0-9-]{36}/)
    expectUnknownCounts(html)
  })
  it('keeps a verified manual action visible with partial coverage when the central source fails', async () => {
    io.rpcError = { code: '42501', message: 'private database detail' }
    io.tables.customers = [customer]
    io.tables.customer_operation_events = [{
      id: 'event-A', company_id: 'tenant-A', customer_id: customer.id, operation_id: 'operation-A',
      title: 'Kontrollera avtalets start', message: 'Granska kundens underlag.', action_required: true,
      status: 'future_review_state', severity: 'warning', action_url: queueRow.href, occurred_at: customer.created_at,
    }]
    const html = renderToStaticMarkup(await WorkQueuePage())
    expect(html).toContain('Arbetskön är ofullständig')
    expect(html).toContain('Kontrollera avtalets start')
    expect(html).toContain('href="/admin/customers/customer-A"')
    expect(html).not.toContain('Inga aktiva driftuppgifter hittades')
    expectUnknownCounts(html)
  })
  it.each(['customer_operation_events', 'customer_operation_jobs', 'customers'])('does not turn auxiliary %s schema failure into a healthy empty queue', async table => {
    io.tableErrors[table] = { code: '42P01', message: 'private schema detail' }
    const html = renderToStaticMarkup(await WorkQueuePage())
    expect(html).toContain('Arbetskön kunde inte läsas')
    expect(html).not.toContain('Inga aktiva driftuppgifter hittades')
    expectUnknownCounts(html)
  })
  it.each([null, { rows: [] }, [null]])('holds invalid successful auxiliary data instead of treating it as verified empty: %j', async data => {
    io.tableData.customers = data
    const html = renderToStaticMarkup(await WorkQueuePage())
    expect(html).toContain('Arbetskön kunde inte läsas')
    expect(html).not.toContain('Inga aktiva driftuppgifter hittades')
    expectUnknownCounts(html)
  })
  it.each([
    {}, { ...customer, id: '' }, { ...customer, company_id: null }, { ...customer, company_id: 'tenant-B' },
  ])('refuses invalid auxiliary customer identity before counts or related reads: %j', async row => {
    io.tableData.customers = [row]
    const html = renderToStaticMarkup(await WorkQueuePage())
    expect(html).toContain('Arbetskön kunde inte läsas')
    expect(html).not.toContain('Inga aktiva driftuppgifter hittades')
    expect(html).not.toContain('private')
    expectUnknownCounts(html)
  })
  it('preserves a central action but marks failed action-customer identity hydration as partial', async () => {
    io.rpcData = [queueRow]
    io.tables.customer_operation_events = [{
      id: 'event-A', company_id: 'tenant-A', customer_id: customer.id, operation_id: 'operation-A',
      title: 'Granska mottaget svar', message: 'Manuell kontroll krävs.', action_required: true,
      status: 'needs_review', severity: 'warning', action_url: queueRow.href, occurred_at: customer.created_at,
    }]
    io.tableData.customers = [{ ...customer, id: 'unrequested-customer' }]
    const html = renderToStaticMarkup(await WorkQueuePage())
    expect(html).toContain('Arbetskön är ofullständig')
    expect(html).toContain('Kontrollera startdatum')
    expect(html).not.toContain('Granska mottaget svar')
    expectUnknownCounts(html)
  })
  it.each(['customer_operation_events', 'customer_operation_jobs'])('refuses missing required identity in %s before it can silently disappear', async table => {
    io.tableData[table] = [{}]
    const html = renderToStaticMarkup(await WorkQueuePage())
    expect(html).toContain('Arbetskön kunde inte läsas')
    expect(html).not.toContain('Inga aktiva driftuppgifter hittades')
    expectUnknownCounts(html)
  })
  it.each([{}, { id: 'request-B', customer_id: 'unrequested-customer' }])('refuses invalid related-request identity in an owned parent query: %j', async row => {
    io.tables.customers = [customer]
    io.tableData.customer_info_requests = [row]
    const html = renderToStaticMarkup(await WorkQueuePage())
    expect(html).toContain('Arbetskön kunde inte läsas')
    expect(html).not.toContain('Inga aktiva driftuppgifter hittades')
    expectUnknownCounts(html)
  })
  it('keeps a valid central action visible when an independent auxiliary transport fails', async () => {
    io.rpcData = [queueRow]
    io.tableRejections.customer_operation_jobs = new Error('private auxiliary transport')
    const html = renderToStaticMarkup(await WorkQueuePage())
    expect(html).toContain('Arbetskön är ofullständig')
    expect(html).toContain('Kontrollera startdatum')
    expect(html).not.toContain('private')
    expectUnknownCounts(html)
  })
  it('holds a failed related-request read explicitly while preserving the owned central action', async () => {
    io.rpcData = [queueRow]
    io.tables.customers = [customer]
    io.tableErrors.customer_info_requests = { code: '42703', message: 'private missing column' }
    const html = renderToStaticMarkup(await WorkQueuePage())
    expect(html).toContain('Arbetskön är ofullständig')
    expect(html).toContain('Kontrollera startdatum')
    expectUnknownCounts(html)
  })
  it('uses canonical tenant A without drifting to legacy membership B', async () => {
    await WorkQueuePage()
    expect(io.rpc).toHaveBeenCalledWith('gridex_get_work_queue', { p_company_id: 'tenant-A', p_limit: 250 })
    expect(io.legacyScope).not.toHaveBeenCalled()
  })
  it('preserves platform-global reads even when the platform context has a selected company', async () => {
    io.admin.isPlatformAdmin = true
    io.rpcData = [{ ...queueRow, company_id: 'tenant-B' }]
    io.tables.customers = [{ ...customer, company_id: 'tenant-B' }]
    const html = renderToStaticMarkup(await WorkQueuePage())
    expect(io.rpc).toHaveBeenCalledWith('gridex_get_work_queue', { p_company_id: null, p_limit: 250 })
    expect(html).toContain('Kontrollera startdatum')
    expect(html).not.toContain('Arbetskön är ofullständig')
    expect(stat(html, 'Synliga kunder')).toBe('1')
  })
  it('refuses tenant-null scope before creating a data client', async () => {
    io.admin.companyId = null
    await expect(WorkQueuePage()).rejects.toThrow('saknar ett aktivt bolag')
    expect(io.createClient).not.toHaveBeenCalled()
    expect(io.rpc).not.toHaveBeenCalled()
  })
  it('preserves permission refusal instead of returning an unavailable data page', async () => {
    io.guardError = new Error('page permission denied')
    await expect(WorkQueuePage()).rejects.toThrow('page permission denied')
    expect(io.createClient).not.toHaveBeenCalled()
    expect(io.rpc).not.toHaveBeenCalled()
  })
})
