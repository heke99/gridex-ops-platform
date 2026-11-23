import { NextRequest, NextResponse } from 'next/server'
import { expect, it, vi } from 'vitest'
import { publicReference } from '@/lib/integrations/publicReferences'

const state = vi.hoisted(() => ({
  companyId: 'company-one',
  customerId: 'customer-one',
  query: vi.fn(),
  rpc: vi.fn(),
}))

vi.mock('@/lib/integrations/apiResponseProfile', () => ({
  withApiContractRepresentation: (_surface: string, handler: unknown) => handler,
}))
vi.mock('@/lib/customer-portal/externalApi', () => ({
  requireCustomerPortalApiContext: async () => ({
    ok: true, client: { company_id: state.companyId, id: 'api-client' },
    identity: { customer_id: state.customerId },
  }),
  customerPortalJson: (body: unknown) => NextResponse.json(body),
  logCustomerPortalSuccess: async () => {},
  handleCustomerPortalRouteError: ({ error }: { error: unknown }) => { throw error },
}))
vi.mock('@/lib/api/strictRequest', () => ({
  readJsonObject: (request: Request) => request.json(),
  executeIdempotentPortalWrite: async ({ execute }: { execute: () => Promise<{ body: unknown }> }) => ({
    ...await execute(), replayed: false,
  }),
  ApiInputError: Error,
}))
vi.mock('@/lib/supabase/service', () => ({
  supabaseService: { from: (table: string) => state.query(table), rpc: (...args: unknown[]) => state.rpc(...args) },
}))

it('confirms simultaneous notification reads under different operation keys without resetting the saved time', async () => {
  const row = { id: 'synthetic-notification', company_id: state.companyId, customer_id: state.customerId, read_at: null as string | null }
  const reference = publicReference('notification', state.companyId, row.id)
  state.rpc.mockImplementation(async (name, parameters) => {
    expect(name).toBe('gridex_resolve_customer_notification_references_v1')
    expect(parameters).toEqual({ p_company_id: state.companyId, p_customer_id: state.customerId, p_references: [reference] })
    return { data: [{ id: row.id, notification_reference: reference }], error: null }
  })
  const filters: string[] = []
  let updates = 0
  let arrivals = 0
  const gate = Promise.withResolvers<void>()
  state.query.mockImplementation((table: string) => {
    expect(table).toBe('customer_notifications')
    let patch: { read_at: string } | undefined
    const predicates: ((row: Record<string, unknown>) => boolean)[] = []
    const query = {
      select: () => query,
      update(value: { read_at: string }) { patch = value; return query },
      eq(key: string, value: unknown) { predicates.push(candidate => candidate[key] === value); return query },
      in(key: string, ids: string[]) { predicates.push(candidate => ids.includes(String(candidate[key]))); return query },
      is(key: string, value: null) { filters.push(key); predicates.push(candidate => candidate[key] === value); return query },
      then: (resolve: (result: unknown) => unknown) => (async () => {
        if (patch) {
          if (++arrivals === 2) gate.resolve()
          await gate.promise
        }
        if (!predicates.every(check => check(row))) return { data: [], error: null }
        if (patch) { row.read_at = patch.read_at; updates++ }
        return { data: [{ id: row.id, read_at: row.read_at }], error: null }
      })().then(resolve),
    }
    return query
  })
  const { POST } = await import('@/app/api/v1/customer/notifications/read/route')
  const invoke = async (key: string) => {
    const response = await POST(new NextRequest('https://synthetic.example/api/v1/customer/notifications/read', {
      method: 'POST',
      headers: { 'Idempotency-Key': key, 'Content-Type': 'application/json' },
      body: JSON.stringify({ notification_references: [reference] }),
    }))
    expect(response.status).toBe(200)
    return (await response.json()).data
  }
  const results = await Promise.all([invoke('operation-first'), invoke('operation-second')])
  expect(results.map(result => result.updated_count).sort()).toEqual([0, 1])
  expect(results.map(result => result.read_at)).toEqual([row.read_at, row.read_at])
  expect(row.read_at).toBeTruthy()
  expect(updates).toBe(1)
  expect(filters).toEqual(['read_at', 'read_at'])
})
