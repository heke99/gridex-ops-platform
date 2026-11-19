import { beforeEach, expect, it, vi } from 'vitest'
import { runZ01ResponseSlaWatchdog } from '@/lib/ediel/operations/z01ResponseSlaWatchdog'

const { fetchWatchdog } = vi.hoisted(() => ({ fetchWatchdog: vi.fn<typeof fetch>() }))
vi.mock('@/lib/supabase/service', async () => {
  const { createClient } = await vi.importActual<typeof import('@supabase/supabase-js')>('@supabase/supabase-js')
  return {
    supabaseService: createClient('https://z01-watchdog.test', 'synthetic-service-key', {
      auth: { autoRefreshToken: false, persistSession: false },
      global: { fetch: fetchWatchdog },
    }),
  }
})

const zero = { scanned: 0, contrl_overdue: 0, business_response_overdue: 0, automatic_resends: 0 }

function respond(data: unknown, limit: number | null = 100, status = 200) {
  fetchWatchdog.mockImplementationOnce(async (input, init) => {
    expect(String(input)).toBe('https://z01-watchdog.test/rest/v1/rpc/gridex_escalate_overdue_z01_responses')
    expect(init?.method).toBe('POST')
    expect(JSON.parse(String(init?.body))).toEqual({ p_limit: limit })
    return Response.json(data, { status })
  })
}

beforeEach(() => { fetchWatchdog.mockReset() })

it('returns a verified zero from all four native counters', async () => {
  respond(zero)
  await expect(runZ01ResponseSlaWatchdog()).resolves.toEqual({ ...zero, available: true })
  expect(fetchWatchdog).toHaveBeenCalledOnce()
})

it('allows both deadline dimensions to count the same case and preserves the bounded RPC input', async () => {
  const counts = { scanned: 1, contrl_overdue: 1, business_response_overdue: 1, automatic_resends: 0 }
  respond(counts, 1)
  await expect(runZ01ResponseSlaWatchdog({ limit: 0 })).resolves.toEqual({ ...counts, available: true })
  respond({ ...counts, scanned: 500 }, 500)
  await expect(runZ01ResponseSlaWatchdog({ limit: 900 })).resolves.toEqual({ ...counts, scanned: 500, available: true })
})

it('applies the native default bound when NaN is serialized as null', async () => {
  respond({ ...zero, scanned: 100 }, null)
  await expect(runZ01ResponseSlaWatchdog({ limit: Number.NaN })).resolves.toEqual({ ...zero, scanned: 100, available: true })
  respond({ ...zero, scanned: 101 }, null)
  await expect(runZ01ResponseSlaWatchdog({ limit: Number.NaN })).rejects.toThrow('z01_response_sla_invalid_result')
})

it.each([
  { name: 'null payload', data: null },
  { name: 'array payload', data: [zero] },
  { name: 'missing counters', data: { scanned: 0 } },
  { name: 'numeric strings', data: { ...zero, scanned: '0' } },
  { name: 'boolean counters', data: { ...zero, contrl_overdue: false } },
  { name: 'null counters', data: { ...zero, business_response_overdue: null } },
  { name: 'negative counters', data: { ...zero, scanned: -1 } },
  { name: 'fractional counters', data: { ...zero, scanned: 1, contrl_overdue: 0.5 } },
  { name: 'unsafe integer counters', data: { ...zero, scanned: Number.MAX_SAFE_INTEGER + 1 } },
  { name: 'scan above its limit', data: { ...zero, scanned: 4 } },
  { name: 'CONTRL count above scanned rows', data: { ...zero, scanned: 1, contrl_overdue: 2 } },
  { name: 'business response count above scanned rows', data: { ...zero, scanned: 1, business_response_overdue: 2 } },
  { name: 'reported automatic resends', data: { ...zero, scanned: 1, automatic_resends: 1 } },
])('rejects $name instead of certifying a completed watchdog result', async ({ data }) => {
  respond(data, 3)
  await expect(runZ01ResponseSlaWatchdog({ limit: 3 })).rejects.toThrow('z01_response_sla_invalid_result')
  expect(fetchWatchdog).toHaveBeenCalledOnce()
})

it('keeps the unavailable result on a real SDK missing-RPC error envelope', async () => {
  respond({ code: 'PGRST202', message: 'Could not find the function public.gridex_escalate_overdue_z01_responses in the schema cache' }, 100, 404)
  await expect(runZ01ResponseSlaWatchdog()).resolves.toEqual({ ...zero, available: false })
})

it('still propagates an unexpected database rejection', async () => {
  respond({ code: '42501', message: 'synthetic permission failure' }, 100, 403)
  await expect(runZ01ResponseSlaWatchdog()).rejects.toMatchObject({ code: '42501' })
})
