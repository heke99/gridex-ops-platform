import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { POST } from '@/app/api/internal/billing/generate-underlay/route'

const io = vi.hoisted(() => ({
  access: vi.fn(), company: vi.fn(), engine: vi.fn(), rpc: vi.fn(),
}))
vi.mock('@/lib/admin/apiGuards', () => ({
  requireAdminApiAccess: io.access, requireAdminOperationalCompany: io.company,
}))
vi.mock('@/lib/billing/underlayEngine', () => ({ generateBillingUnderlaysForMonth: io.engine }))
vi.mock('@/lib/supabase/service', () => ({ supabaseService: { rpc: io.rpc } }))

const companyId = '00170102-0000-4000-8000-000000000001'
const actorUserId = '00170102-0000-4000-8000-000000000009'
const underlayId = '00170102-0000-4000-8000-000000000010'
const intentKey = 'receipt-race-local'
const billingMonth = '2026-09'
const saved = {
  billingMonth, scope: { customerId: null, meteringPointId: null },
  sourceTable: 'normalized_metering_values', sourceRows: 96, underlays: 1,
  readyForPricing: 1, needsReview: 0,
  results: [{ underlayId, status: 'ready_for_pricing', sourceTable: 'normalized_metering_values', sourceRows: 96, warnings: [] }],
}
const empty = { data: null, error: null }
const locked = () => new Error('Fakturaperioden 2026-09 är locked. Skapa kredit/omräkning eller lås upp perioden innan du ändrar underlag.')
const request = (key: string | null = intentKey, scope: Record<string, unknown> = {}) => new Request('http://unit.invalid/api/internal/billing/generate-underlay', {
  method: 'POST',
  headers: key === null ? undefined : { 'Idempotency-Key': key },
  body: JSON.stringify({ billingMonth, ...scope }),
})

function expectOneAttemptThenLookups() {
  expect(io.engine).toHaveBeenCalledExactlyOnceWith({ companyId, billingMonth, createdBy: actorUserId, intentKey })
  const read = ['gridex_read_underlay_generation_receipt_v1', {
    p_company_id: companyId, p_actor_user_id: actorUserId, p_intent_key: intentKey,
    p_scope: { billingMonth, customerId: null, meteringPointId: null },
  }]
  expect(io.rpc.mock.calls).toEqual([read, read])
}

beforeEach(() => {
  vi.resetAllMocks()
  io.access.mockResolvedValue({ guard: { userId: actorUserId } })
  io.company.mockResolvedValue(companyId)
  io.rpc.mockResolvedValue(empty)
  vi.spyOn(console, 'info').mockImplementation(() => undefined)
  vi.spyOn(console, 'error').mockImplementation(() => undefined)
  vi.spyOn(globalThis, 'fetch').mockRejectedValue(new Error('unexpected network'))
})
afterEach(() => {
  expect(fetch).not.toHaveBeenCalled()
  vi.restoreAllMocks()
})

describe('underlay generation after a failed outcome for the same intent', () => {
  it.each([locked, () => new Error('RPC response lost')])('returns the native receipt when it commits after the first lookup', async (failure) => {
    io.rpc.mockResolvedValueOnce(empty).mockResolvedValueOnce({ data: saved, error: null })
    io.engine.mockRejectedValue(failure())
    const response = await POST(request())
    expect(response.status).toBe(200)
    expect(await response.json()).toEqual({ data: saved })
    expectOneAttemptThenLookups()
  })

  it('keeps the original period conflict when no exact receipt exists', async () => {
    io.engine.mockRejectedValue(locked())
    const response = await POST(request())
    expect(response.status).toBe(409)
    expect(await response.json()).toMatchObject({ code: 'billing_underlay_generate_failed' })
    expectOneAttemptThenLookups()
  })

  it('keeps the original period conflict when the second lookup is unavailable', async () => {
    io.rpc.mockResolvedValueOnce(empty).mockRejectedValueOnce(new Error('lookup unavailable'))
    io.engine.mockRejectedValue(locked())
    const response = await POST(request())
    expect(response.status).toBe(409)
    expect(await response.json()).toMatchObject({ code: 'billing_underlay_generate_failed' })
    expectOneAttemptThenLookups()
  })

  it('does not reveal a completed receipt whose source was removed', async () => {
    io.rpc.mockResolvedValueOnce(empty).mockResolvedValueOnce({
      data: null, error: { code: '23514', message: 'finance_copy_retention_tombstoned' },
    })
    io.engine.mockRejectedValue(locked())
    const response = await POST(request())
    expect(response.status).toBe(410)
    const body = await response.json()
    expect(body).toMatchObject({ code: 'billing_underlay_receipt_retained' })
    expect(JSON.stringify(body)).not.toContain(underlayId)
    expectOneAttemptThenLookups()
  })

  it('returns the exact scope conflict when another request binds the key first', async () => {
    io.rpc.mockResolvedValueOnce(empty).mockResolvedValueOnce({
      data: null, error: { code: '22023', message: 'billing_underlay_intent_scope_conflict' },
    })
    io.engine.mockRejectedValue(locked())
    const response = await POST(request())
    expect(response.status).toBe(409)
    expect(await response.json()).toMatchObject({ code: 'billing_underlay_intent_scope_conflict' })
    expectOneAttemptThenLookups()
  })

  it('does no second read when the first read finds the durable receipt', async () => {
    io.rpc.mockResolvedValue({ data: saved, error: null })
    const response = await POST(request())
    expect(await response.json()).toEqual({ data: saved })
    expect(io.rpc).toHaveBeenCalledOnce()
    expect(io.engine).not.toHaveBeenCalled()
  })

  it('accepts an ordinary browser request with the matching authenticated scope', async () => {
    io.rpc.mockResolvedValue({ data: saved, error: null })
    const response = await POST(request(intentKey, {
      expected_company_id: companyId, expected_actor_user_id: actorUserId,
    }))
    expect(response.status).toBe(200)
    expect(await response.json()).toEqual({ data: saved })
    expect(io.rpc).toHaveBeenCalledOnce()
    expect(io.engine).not.toHaveBeenCalled()
  })

  it.each([
    { expected_company_id: 'another-company', expected_actor_user_id: actorUserId },
    { expected_company_id: companyId, expected_actor_user_id: 'another-operator' },
    { expected_company_id: companyId },
  ])('stops a stale browser scope before reading a receipt or generating', async scope => {
    const response = await POST(request(intentKey, scope))
    expect(response.status).toBe(409)
    expect(await response.json()).toMatchObject({ code: 'billing_underlay_client_scope_changed' })
    expect(io.rpc).not.toHaveBeenCalled()
    expect(io.engine).not.toHaveBeenCalled()
  })

  it('does no receipt reads for legacy requests or denied callers', async () => {
    io.engine.mockRejectedValue(locked())
    expect((await POST(request(null))).status).toBe(409)
    expect(io.engine).toHaveBeenCalledOnce()
    io.access.mockResolvedValue({ response: new Response('forbidden', { status: 403 }) })
    expect((await POST(request())).status).toBe(403)
    expect(io.engine).toHaveBeenCalledOnce()
    expect(io.rpc).not.toHaveBeenCalled()
  })
})
