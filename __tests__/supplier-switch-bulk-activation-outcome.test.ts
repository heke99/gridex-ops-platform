import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

type Row = Record<string, unknown>
type RpcError = { code: string; message: string }
const data = vi.hoisted(() => ({
  requests: [] as Row[],
  attempts: [] as string[],
  audit: [] as Row[],
  refusal: null as RpcError | null,
  switchEvent: vi.fn(),
  refresh: vi.fn(),
  revalidate: vi.fn(),
}))

vi.mock('next/cache', () => ({ revalidatePath: data.revalidate }))
vi.mock('@/lib/admin/guards', () => ({
  requireAdminActionAccess: async () => ({ userId: actor, companyId: company, roles: [], permissions: [] }),
  isPlatformAdminContext: () => false,
}))
vi.mock('@/lib/operations/db', async () => ({
  finalizeSupplierSwitchExecution: (await import('@/lib/operations/db.part-2')).finalizeSupplierSwitchExecution,
  createSupplierSwitchEvent: data.switchEvent,
  syncCustomerOperationsForCustomer: data.refresh,
}))
vi.mock('@/lib/supabase/service', async () => {
  const { createClient } = await import('@supabase/supabase-js')
  const supabaseService = createClient('http://127.0.0.1:54321', 'synthetic-unit-key', {
    auth: { persistSession: false, autoRefreshToken: false },
    global: { fetch: async (input, init) => {
      const url = new URL(input instanceof Request ? input.url : String(input))
      const path = url.pathname
      if (path === '/rest/v1/audit_logs' && init?.method === 'POST') {
        data.audit.push(JSON.parse(String(init.body)) as Row)
        return new Response(null, { status: 201 })
      }
      if (path === '/rest/v1/supplier_switch_requests') {
        const id = url.searchParams.get('id')?.slice(3)
        if (id) return Response.json(data.requests.filter(row => row.id === id))
        expect(url.searchParams.get('company_id')).toBe(`eq.${company}`)
        expect(url.searchParams.get('status')).toBe('eq.accepted')
        const accepted = data.requests.filter(row => row.status === 'accepted')
        return Response.json(accepted, { headers: { 'content-range': `*/${accepted.length}` } })
      }
      if (path === '/rest/v1/customer_sites') {
        const request = data.requests.find(row => `eq.${row.site_id}` === url.searchParams.get('id'))!
        return Response.json([{ id: request.site_id, customer_id: request.customer_id, company_id: company }])
      }
      if (path === '/rest/v1/rpc/gridex_finalize_supplier_switch_v1' && init?.method === 'POST') {
        const params = JSON.parse(String(init.body)) as { p_request_id: string; p_company_id: string; p_actor_user_id: string }
        expect(params).toMatchObject({ p_company_id: company, p_actor_user_id: actor })
        const id = params.p_request_id
        data.attempts.push(id)
        if (id === waiting && Date.now() < Date.parse('2026-07-01T00:00:00Z')) {
          return Response.json(data.refusal ?? notDue, { status: 400 })
        }
        const row = data.requests.find(request => request.id === id)!
        row.status = 'completed'
        return Response.json({ request: row })
      }
      throw new Error(`Unexpected fixture route ${path}`)
    } },
  })
  supabaseService.auth.getUser = async () => ({ data: { user: { id: actor } }, error: null }) as Awaited<ReturnType<typeof supabaseService.auth.getUser>>
  return { supabaseService }
})
vi.mock('@/lib/supabase/server', async () => {
  const { supabaseService } = await import('@/lib/supabase/service')
  return { createSupabaseServerClient: async () => supabaseService }
})

import { bulkFinalizeReadySupplierSwitchesAction as run } from '@/app/admin/operations/actions'

const uuid = (suffix: number) => `00000000-0000-4000-8000-${String(suffix).padStart(12, '0')}`
const [first, waiting, last] = [uuid(1), uuid(2), uuid(3)]
const company = uuid(4)
const actor = uuid(5)
const notDue = { code: 'P0001', message: 'normal_supply_activation_not_due' }
const summaryAction = 'supplier_switch_ready_queue_bulk_execution_ran'
const waitingAction = 'supplier_switch_request_execution_waiting'

beforeEach(() => {
  vi.clearAllMocks()
  vi.useFakeTimers({ toFake: ['Date'] })
  vi.setSystemTime(new Date('2026-06-30T23:30:00Z'))
  data.attempts = []
  data.audit = []
  data.refusal = null
  data.requests = [first, waiting, last].map((id, index) => ({
    id, company_id: company, customer_id: uuid(11 + index), site_id: uuid(21 + index), metering_point_id: null,
    status: 'accepted', inbound_z04_message_id: uuid(31 + index),
    confirmed_start_date: '2026-07-01', requested_start_date: '2026-07-01', created_at: `2026-06-01T00:00:0${index}Z`,
  }))
})
afterEach(() => vi.useRealTimers())

describe('manual bulk switch finalization', () => {
  it('audits a wait and keeps going, then completes only the remaining request at market start', async () => {
    await expect(run()).resolves.toBeUndefined()
    expect(data.attempts).toEqual([first, waiting, last])
    expect(data.requests.map(row => row.status)).toEqual(['completed', 'accepted', 'completed'])
    expect(data.switchEvent.mock.calls.map(([, event]) => event.switchRequestId)).toEqual([first, last])
    expect(data.refresh.mock.calls.map(([, customerId]) => customerId)).toEqual([uuid(11), uuid(13)])
    expect(data.audit.map(row => row.action)).toEqual([
      'supplier_switch_request_execution_completed', 'customer_site_updated_from_supplier_switch_execution',
      waitingAction,
      'supplier_switch_request_execution_completed', 'customer_site_updated_from_supplier_switch_execution', summaryAction,
    ])
    expect(data.audit.find(row => row.action === waitingAction)).toMatchObject({
      actor_user_id: actor, entity_type: 'supplier_switch_request', entity_id: waiting,
      metadata: { customerId: uuid(12), siteId: uuid(22), reasonCode: notDue.message, executionSource: 'bulk_admin_ready_queue' },
    })
    expect(data.audit.at(-1)).toMatchObject({ action: summaryAction, metadata: { scannedAcceptedCount: 3, readyCount: 3, completedCount: 2, waitingCount: 1 } })
    expect(data.revalidate).toHaveBeenCalledWith(`/admin/operations/switches/${last}`)

    vi.setSystemTime(new Date('2026-07-01T00:00:00Z'))
    await run()
    expect(data.attempts).toEqual([first, waiting, last, waiting])
    expect(data.requests.map(row => row.status)).toEqual(['completed', 'completed', 'completed'])
    expect(data.switchEvent.mock.calls.map(([, event]) => event.switchRequestId)).toEqual([first, last, waiting])
    expect(data.audit.filter(row => row.action === waitingAction)).toHaveLength(1)
    expect(data.audit.at(-1)).toMatchObject({ action: summaryAction, metadata: { scannedAcceptedCount: 1, completedCount: 1, waitingCount: 0 } })
  })

  it.each([
    { code: 'P0001', message: 'normal_supply_activation_source_missing' },
    { code: '42501', message: notDue.message },
  ])('stops and propagates $code $message', async error => {
    data.refusal = error
    await expect(run()).rejects.toMatchObject(error)
    expect(data.attempts).toEqual([first, waiting])
    expect(data.requests.map(row => row.status)).toEqual(['completed', 'accepted', 'accepted'])
    expect(data.audit.map(row => row.action)).toEqual(['supplier_switch_request_execution_completed', 'customer_site_updated_from_supplier_switch_execution'])
  })

  it('propagates a post-activation refresh failure even if it has the same code and message', async () => {
    data.refresh.mockRejectedValueOnce(notDue)
    await expect(run()).rejects.toMatchObject(notDue)
    expect(data.attempts).toEqual([first])
    expect(data.requests.map(row => row.status)).toEqual(['completed', 'accepted', 'accepted'])
    expect(data.audit.map(row => row.action)).toEqual(['supplier_switch_request_execution_completed', 'customer_site_updated_from_supplier_switch_execution'])
  })
})
