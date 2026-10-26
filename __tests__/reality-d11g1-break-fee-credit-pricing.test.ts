// reality-defects: D11-G1
// D11-G1 / owner decision 33 (TypeScript): a break-fee credit underlay (payload.charge_kind 'break_fee_credit') is priced
// as exactly one negative line from its credit row, with the VAT and accounting classification of the original debit
// (copied at request time), lifecycle 'event_only' with the credit as event. An invoiced credit is never priced again.
// The general credit endpoint stays closed (409) in this stage.
import { describe, expect, it, vi } from 'vitest'
import { breakFeeCreditProblems, buildBreakFeeCreditLine, type BreakFeeCredit } from '@/lib/pricing/breakFeePricing'

vi.mock('@/lib/admin/apiGuards', () => ({ requireAdminApiAccess: vi.fn(async () => ({ response: null })) }))

const credit = (patch: Partial<BreakFeeCredit> = {}): BreakFeeCredit => ({
  id: 'cr-1', company_id: 'co', break_fee_charge_id: 'ch-1', credit_underlay_id: 'cu', original_invoice_id: 'inv-1', status: 'underlaid',
  amount_ex_vat: '120.00', currency: 'SEK', kind: 'partial', reason: 'Bestriden',
  vat_classification: { code: 'early_termination_compensation', vat_rate: 0.25, account: '3990', verified_by: 'acc', verified_at: '2026-10-25', source: 'advice' },
  ...patch,
})
const ctx = { companyId: 'co', billingUnderlayId: 'cu' }

describe('D11-G1 a break-fee credit prices as one negative line from the original debit', () => {
  it('one negative line with the original VAT and account, referencing the original invoice', () => {
    expect(breakFeeCreditProblems(credit(), ctx)).toEqual([])
    expect(buildBreakFeeCreditLine(credit())).toMatchObject({ lineType: 'break_fee_credit', quantity: 1, amountExVat: -120, vatRate: 0.25, vatAmount: -30, amountIncVat: -150,
      description: 'Delkreditering av brytavgift',
      metadata: { component_key: 'break_fee_credit', lifecycle: 'event_only', billing_event_id: 'cr-1', break_fee_charge_id: 'ch-1', credit_of_invoice_id: 'inv-1',
        account: '3990', vat_code: 'early_termination_compensation', vat_rate_explicit: true, source_of_truth: 'break_fee_credits' } })
    // The original debit's 0 % classification stays 0 %: never today's rate.
    expect(buildBreakFeeCreditLine(credit({ kind: 'full', vat_classification: { ...credit().vat_classification, vat_rate: 0 } }))).toMatchObject({ vatRate: 0, vatAmount: 0, amountIncVat: -120, description: 'Kreditering av brytavgift' })
  })

  it('never prices an invoiced, foreign or unclassified credit', () => {
    expect(breakFeeCreditProblems(credit({ status: 'invoiced' }), ctx).join()).toMatch(/status invoiced/)
    expect(breakFeeCreditProblems(null, ctx)).toEqual(['Kreditering av brytavgift saknas för fakturaunderlaget.'])
    expect(breakFeeCreditProblems(credit({ credit_underlay_id: 'other' }), ctx).join()).toMatch(/fakturaunderlag/)
    expect(breakFeeCreditProblems(credit({ company_id: 'x' }), ctx).join()).toMatch(/fakturaunderlag/)
    expect(breakFeeCreditProblems(credit({ vat_classification: { vat_rate: 0.25 } }), ctx).join()).toMatch(/moms/)
    expect(breakFeeCreditProblems(credit({ amount_ex_vat: 0 }), ctx).join()).toMatch(/belopp/)
  })

  it('the general credit endpoint stays closed', async () => {
    const { POST } = await import('@/app/api/internal/invoices/[id]/credit/route')
    const response = await POST(new Request('http://x/api/internal/invoices/inv-1/credit', { method: 'POST' }), { params: Promise.resolve({ id: 'inv-1' }) })
    expect(response.status).toBe(409)
  })
})
