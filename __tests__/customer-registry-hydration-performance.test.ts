import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const sdk = vi.hoisted(() => ({ fetch: vi.fn<typeof fetch>() }))
vi.mock('@/lib/supabase/service', async () => {
  const { createClient } = await import('@supabase/supabase-js')
  return { supabaseService: createClient('https://fixture.invalid', 'fixture-only-key', {
    auth: { persistSession: false, autoRefreshToken: false },
    global: { fetch: (...args) => sdk.fetch(...args) },
  }) }
})
import { listCustomersPage } from '@/lib/customers/getCustomers'

function deferred() {
  let release!: () => void
  const wait = new Promise<void>(resolve => { release = resolve })
  return { wait, release }
}
const gates = new Map<string, ReturnType<typeof deferred>>()
const missing = new Set<string>()
const started: string[] = []
let listeners: Array<() => void> = []
function whenStarted(...tables: string[]) {
  return new Promise<void>(resolve => {
    const check = () => { if (tables.every(table => started.includes(table))) resolve() }
    listeners.push(check); check()
  })
}
const runList = () => listCustomersPage({ companyId: 'company-a', query: 'Fixture' })

beforeEach(() => {
  gates.clear(); missing.clear(); started.length = 0; listeners = []
  sdk.fetch.mockReset().mockImplementation(async input => {
    const url = new URL(input instanceof Request ? input.url : String(input))
    const table = url.pathname.split('/').pop()!
    started.push(table); listeners.forEach(notify => notify())
    await gates.get(table)?.wait
    if (missing.has(table)) return new Response(JSON.stringify({ code: '42P01', message: 'fixture relation is missing' }), { status: 404 })
    const rows: Record<string, unknown>[] = table === 'customers'
      ? [{ id: 'customer-a', company_id: 'company-a', full_name: 'Fixture Customer', status: 'active', created_at: '2026-11-16T00:00:00Z' }]
      : table === 'customer_sites' ? [{ id: 'site-a', customer_id: 'customer-a', status: 'active', grid_owner_id: 'grid-a' }]
        : table === 'customer_contracts' ? [{ id: 'contract-a', company_id: 'company-a', customer_id: 'customer-a', consolidated_invoice: true, billing_level: 'customer' }]
          : table === 'powers_of_attorney' ? [{ id: 'poa-a', customer_id: 'customer-a', status: 'signed' }]
            : table === 'metering_points' ? [{ id: 'point-a', site_id: 'site-a', status: 'active' }] : []
    return new Response(JSON.stringify(rows), { status: 200, headers: { 'Content-Type': 'application/json', 'Content-Range': rows.length ? `0-${rows.length - 1}/${rows.length}` : '*/0' } })
  })
})
afterEach(() => { gates.forEach(gate => gate.release()) })

describe('customer registry hydration performance invariants', () => {
  it('starts independent site, contract and authorization reads while all three responses are held', async () => {
    for (const table of ['customer_sites', 'customer_contracts', 'powers_of_attorney']) gates.set(table, deferred())
    const result = runList()
    try {
      await whenStarted('customer_sites', 'customer_contracts', 'powers_of_attorney')
      expect(started).not.toContain('metering_points')
    } finally { gates.forEach(gate => gate.release()) }
    expect((await result).rows[0]).toMatchObject({ site_count: 1, contract_count: 1, metering_point_count: 1, has_signed_power_of_attorney: true })
  })

  it('starts metering-point hydration after sites resolve while contracts and authorizations remain held', async () => {
    for (const table of ['customer_sites', 'customer_contracts', 'powers_of_attorney']) gates.set(table, deferred())
    const result = runList()
    try {
      await whenStarted('customer_sites', 'customer_contracts', 'powers_of_attorney')
      gates.get('customer_sites')!.release()
      await whenStarted('metering_points')
      expect(started.indexOf('metering_points')).toBeGreaterThan(started.indexOf('customer_sites'))
    } finally { gates.forEach(gate => gate.release()) }
    expect((await result).rows[0].metering_point_count).toBe(1)
  })

  it.each([
    ['customer_sites', { site_count: 0, metering_point_count: 0, has_signed_power_of_attorney: true }],
    ['metering_points', { site_count: 1, metering_point_count: 0, has_signed_power_of_attorney: true }],
    ['powers_of_attorney', { site_count: 1, metering_point_count: 1, has_signed_power_of_attorney: false }],
  ] as const)('retains the optional %s fallback without losing the contract summary', async (table, expected) => {
    missing.add(table)
    expect((await runList()).rows[0]).toMatchObject({ ...expected, contract_count: 1 })
  })

  it('represents an unavailable contract relation honestly and rejects contract-dependent filtering', async () => {
    missing.add('customer_contracts')
    expect((await runList()).rows[0]).toMatchObject({ site_count: 1, metering_point_count: 1, contract_count: null,
      contract_billing_summary: { consolidatedInvoice: { state: 'unavailable' } } })
    await expect(listCustomersPage({ companyId: 'company-a', query: 'Fixture', contractFilter: 'none' })).rejects.toThrow('customer_list_contract_filter_complete_read_required')
  })
})
