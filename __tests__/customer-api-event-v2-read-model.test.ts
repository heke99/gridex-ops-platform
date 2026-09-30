import { beforeEach, expect, it, vi } from 'vitest'

const fixture = vi.hoisted(() => ({ rpc: vi.fn(), insert: vi.fn() }))
vi.mock('server-only', () => ({}))
vi.mock('@/lib/supabase/service', () => ({
  supabaseService: { rpc: fixture.rpc, from: () => ({ insert: fixture.insert }) },
}))
vi.mock('@/lib/env/supabaseServer', () => ({
  getSupabaseServiceEnv: () => ({ serviceRoleKey: 'synthetic-cursor-key-for-unit-tests' }),
}))

import { listPortalEventsPage } from '@/lib/customer-portal/apiData'
import { decodePortalCursor, encodePortalCursor } from '@/lib/customer-portal/keysetPagination'
import { publicPortalEvent } from '@/lib/customer-portal/publicDto'
import { PlatformSchemaNotReadyError } from '@/lib/platform/schemaReadiness'

const context = {
  companyId: '11111111-1111-4111-8111-111111111111',
  customerId: '22222222-2222-4222-8222-222222222222',
  externalCustomerId: null, customerNumber: 'SYN-EVENT-A1', provider: 'tenant_portal',
}
const rows = [
  { id: '00000000-0000-4000-8000-000000000002', source_table: 'customer_events',
    source_rank: 2, event_type: 'customer.synthetic', event_version: 1,
    occurred_at: '2026-09-30T10:00:00.123456+00:00', source: 'synthetic' },
  { id: '00000000-0000-4000-8000-000000000002', source_table: 'domain_events',
    source_rank: 1, event_type: 'customer.synthetic', event_version: 7,
    occurred_at: '2026-09-30T10:00:00.123456+00:00', source: 'synthetic' },
  { id: '00000000-0000-4000-8000-000000000001', source_table: 'domain_events',
    source_rank: 1, event_type: 'customer.synthetic', event_version: 3,
    occurred_at: '2026-09-30T10:00:00.123456+00:00', source: 'synthetic' },
]

beforeEach(() => {
  vi.clearAllMocks()
  fixture.insert.mockResolvedValue({ error: null })
  fixture.rpc.mockResolvedValue({ data: rows, error: null })
})

it('calls v2 with the resolved tenant/customer and limit + 1, projecting the supplied versions', async () => {
  const result = await listPortalEventsPage(context, { limit: 2 })
  expect(fixture.rpc).toHaveBeenCalledExactlyOnceWith('portal_customer_events_page_v2', {
    p_company_id: context.companyId, p_customer_id: context.customerId,
    p_cursor_occurred_at: null, p_cursor_source_rank: null, p_cursor_id: null, p_limit: 3,
  })
  expect(result.page).toMatchObject({ limit: 2, returned: 2, has_more: true })
  const events = result.items.map(row => publicPortalEvent(context.companyId, row))
  expect(events.map(row => row.event_version)).toEqual([1, 7])
  expect(events[0].event_reference).not.toBe(events[1].event_reference)
  expect(events.map(row => Object.keys(row).sort())).toEqual([
    ['event_reference', 'event_type', 'event_version', 'occurred_at', 'source'],
    ['event_reference', 'event_type', 'event_version', 'occurred_at', 'source'],
  ])
})

it('passes the complete microsecond/rank/UUID cursor tuple on every replay', async () => {
  const first = await listPortalEventsPage(context, { limit: 2 })
  const cursor = first.page.next_cursor!
  expect(decodePortalCursor({ ...context, resource: 'events', cursor })).toEqual({
    orderValue: rows[1].occurred_at, sourceRank: 1, id: rows[1].id,
  })
  fixture.rpc.mockResolvedValue({ data: [rows[2]], error: null })
  const next = await listPortalEventsPage(context, { limit: 2, cursor })
  const replay = await listPortalEventsPage(context, { limit: 2, cursor })
  expect(next).toEqual(replay)
  expect(next.page).toEqual({ limit: 2, offset: 0, returned: 1, has_more: false, next_cursor: null })
  for (const call of fixture.rpc.mock.calls.slice(1)) expect(call).toEqual([
    'portal_customer_events_page_v2', {
      p_company_id: context.companyId, p_customer_id: context.customerId,
      p_cursor_occurred_at: rows[1].occurred_at, p_cursor_source_rank: 1,
      p_cursor_id: rows[1].id, p_limit: 3,
    },
  ])
})

it.each(['companyId', 'customerId', 'resource'] as const)('rejects a foreign %s cursor before the RPC', async key => {
  const binding = { companyId: context.companyId, customerId: context.customerId, resource: 'events' }
  const cursor = encodePortalCursor({ ...binding, [key]: 'foreign',
    tuple: { orderValue: rows[0].occurred_at, id: rows[0].id, sourceRank: 2 } })
  await expect(listPortalEventsPage(context, { cursor })).rejects.toMatchObject({ code: 'invalid_cursor', status: 400 })
  expect(fixture.rpc).not.toHaveBeenCalled()
})

it.each([[undefined, 51], [null, 51], [0, 2], [1000, 101]])('preserves default/clamped lookahead for %s', async (limit, expected) => {
  await listPortalEventsPage(context, { limit })
  expect(fixture.rpc.mock.calls[0][1].p_limit).toBe(expected)
})

it('fails closed on a missing v2 read model without retrying v1', async () => {
  fixture.rpc.mockResolvedValue({ data: null, error: { code: 'PGRST202', message: 'synthetic missing RPC' } })
  await expect(listPortalEventsPage(context, {})).rejects.toBeInstanceOf(PlatformSchemaNotReadyError)
  expect(fixture.rpc).toHaveBeenCalledTimes(1)
})
