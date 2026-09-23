import { beforeEach, expect, it, vi } from 'vitest'

const io = vi.hoisted(() => ({ requests: [] as { url: URL; body: Record<string, unknown> }[], fail: false }))
vi.mock('@/lib/supabase/service', async () => {
  const { createClient } = await import('@supabase/supabase-js')
  return { supabaseService: createClient('http://127.0.0.1:54321', 'unit-test-key', {
    auth: { persistSession: false, autoRefreshToken: false },
    global: { fetch: async (input, init) => {
      io.requests.push({ url: new URL(String(input)), body: JSON.parse(String(init?.body ?? '{}')) })
      return new Response(JSON.stringify(io.fail ? { code: '23514', message: 'event_rejected' } : {
        id: 'case-a', company_id: 'company-a', customer_id: 'customer-a', status: 'resolved',
      }), { status: io.fail ? 400 : 200, headers: { 'Content-Type': 'application/json' } })
    } },
  }) }
})

beforeEach(() => { io.requests = []; io.fail = false })

it.each([['ediel_inbound_state_machine'], [undefined]])('commits status, event and audit through one scoped transaction (source %s)', async (expectedSource) => {
  const { updateCustomerCaseStatus } = await import('@/lib/customer-cases/db')
  const row = await updateCustomerCaseStatus({ caseId: 'case-a', companyId: 'company-a', status: 'resolved', actorUserId: 'actor-a', expectedSource, message: ' Support resolved. ' })
  expect(row).toMatchObject({ id: 'case-a', customer_id: 'customer-a', status: 'resolved' })
  expect(io.requests).toHaveLength(1)
  expect(io.requests[0].url.pathname).toBe('/rest/v1/rpc/gridex_update_customer_case_status')
  expect(io.requests[0].body).toEqual({ p_case_id: 'case-a', p_company_id: 'company-a', p_status: 'resolved', p_actor_user_id: 'actor-a', p_expected_source: expectedSource ?? null, p_message: ' Support resolved. ' })
})

it('propagates transaction rejection without a fallback status write', async () => {
  io.fail = true
  const { updateCustomerCaseStatus } = await import('@/lib/customer-cases/db')
  await expect(updateCustomerCaseStatus({ caseId: 'case-a', companyId: 'company-a', status: 'resolved', actorUserId: 'actor-a' })).rejects.toMatchObject({ code: '23514' })
  expect(io.requests).toHaveLength(1)
  expect(io.requests[0].url.pathname).toBe('/rest/v1/rpc/gridex_update_customer_case_status')
})
