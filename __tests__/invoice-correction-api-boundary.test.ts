import { NextRequest } from 'next/server'
import { beforeEach, expect, it, vi } from 'vitest'

const companyId = '00000000-0000-4000-8000-000000000001'
const actorId = '00000000-0000-4000-8000-000000000002'
const invoiceId = '00000000-0000-4000-8000-000000000003'
const originalUnderlayId = '00000000-0000-4000-8000-000000000004'
const correctedUnderlayId = '00000000-0000-4000-8000-000000000005'
const sourceValueId = '00000000-0000-4000-8000-000000000006'
const caseId = '00000000-0000-4000-8000-000000000007'
const io = vi.hoisted(() => ({ rpc: vi.fn() }))

vi.mock('@/lib/admin/apiGuards', () => ({
  requireAdminApiAccess: async () => ({ guard: { userId: actorId } }),
  requireAdminOperationalCompany: async () => companyId,
}))
vi.mock('@/lib/supabase/service', () => ({ supabaseService: { rpc: io.rpc } }))

beforeEach(() => {
  io.rpc.mockReset()
})

async function submitCorrection() {
  const { POST } = await import('@/app/api/internal/invoices/[id]/corrections/route')
  return POST(new NextRequest(`http://localhost/api/internal/invoices/${invoiceId}/corrections`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      original_underlay_id: originalUnderlayId,
      corrected_underlay_id: correctedUnderlayId,
      source_value_id: sourceValueId,
      reason: 'Korrigerat mätvärde',
    }),
  }), { params: Promise.resolve({ id: invoiceId }) })
}

it.each([
  ['invoice_group_correction_original_not_found', 'Den utfärdade samlingsfakturan hittades inte.'],
  ['invoice_correction_original_not_found', 'Den utfärdade fakturan hittades inte.'],
])('returns approved public text for %s', async (databaseMessage, publicMessage) => {
  io.rpc.mockResolvedValue({ data: null, error: { code: 'P0002', message: databaseMessage } })

  const response = await submitCorrection()

  expect(response.status).toBe(404)
  expect(await response.json()).toEqual({ error: publicMessage })
  expect(response.headers.get('Cache-Control')).toBe('no-store')
})

it('hides an unexpected database error behind the normal error code', async () => {
  io.rpc.mockResolvedValue({ data: null, error: { code: 'P0002', message: 'Internal test detail' } })

  const response = await submitCorrection()

  expect(response.status).toBe(500)
  expect(await response.json()).toEqual({
    error: 'Rättelseärendet kunde inte registreras.',
    code: 'invoice_correction_registration_failed',
    trace_id: expect.any(String),
  })
})

it('returns the receipt bound to the selected company and exact original invoice', async () => {
  io.rpc.mockResolvedValue({ data: { caseId, originalInvoiceId: invoiceId, replayed: false }, error: null })

  const response = await submitCorrection()

  expect(response.status).toBe(201)
  expect(await response.json()).toEqual({ case_id: caseId, original_invoice_id: invoiceId, replayed: false, approval_required: true })
  expect(io.rpc).toHaveBeenCalledExactlyOnceWith('gridex_register_invoice_correction_v1', {
    p_company_id: companyId,
    p_invoice_id: invoiceId,
    p_actor_user_id: actorId,
    p_original_underlay_id: originalUnderlayId,
    p_corrected_underlay_id: correctedUnderlayId,
    p_source_value_id: sourceValueId,
    p_reason: 'Korrigerat mätvärde',
  })
})
