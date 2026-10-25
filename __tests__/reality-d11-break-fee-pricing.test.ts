// reality-defects: H3d
// H3d D11 / owner decision 28, slice 2 (TypeScript): a break-fee underlay (payload.charge_kind 'break_fee') is priced
// as exactly one line from its approved charge, with the charge's VAT and accounting classification, lifecycle
// 'event_only' and the charge as event (so gridex_lock_pricing_run records it once in contract_charge_ledger). It is
// never priced from metering values, and an invoiced or credited charge is never priced again.
import { describe, expect, it } from 'vitest'
import { breakFeeChargeProblems, buildBreakFeeLine, type ApprovedBreakFeeCharge } from '@/lib/pricing/breakFeePricing'

const charge = (patch: Partial<ApprovedBreakFeeCharge> = {}): ApprovedBreakFeeCharge => ({
  id: 'ch-1', company_id: 'co', customer_contract_id: 'ct', billing_underlay_id: 'bu', status: 'underlaid', amount_ex_vat: '300.00', currency: 'SEK',
  contract_basis: 'consumer_fixed_term_fixed_price', contract_rule_reference: null,
  vat_classification: { code: 'early_termination_compensation', vat_rate: 0.25, account: '3990', verified_by: 'acc', verified_at: '2026-10-25', source: 'advice' },
  ...patch,
})
const ctx = { companyId: 'co', billingUnderlayId: 'bu', contractId: 'ct' }

describe('D11 a break-fee underlay prices as one line from its approved charge', () => {
  it('one line with the approved amount, the classified VAT and the ledger event', () => {
    expect(breakFeeChargeProblems(charge(), ctx)).toEqual([])
    expect(buildBreakFeeLine(charge())).toMatchObject({ lineType: 'break_fee', quantity: 1, amountExVat: 300, vatRate: 0.25, vatAmount: 75, amountIncVat: 375,
      metadata: { component_key: 'break_fee', lifecycle: 'event_only', billing_event_id: 'ch-1', account: '3990', vat_code: 'early_termination_compensation', vat_rate_explicit: true } })
    expect(buildBreakFeeLine(charge({ vat_classification: { ...charge().vat_classification, vat_rate: 0 } }))).toMatchObject({ vatRate: 0, vatAmount: 0, amountIncVat: 300 })
  })

  it('never prices an invoiced, credited, foreign or unclassified charge', () => {
    for (const status of ['approved', 'invoiced', 'credited', 'cancelled']) expect(breakFeeChargeProblems(charge({ status }), ctx).join()).toMatch(/status/)
    expect(breakFeeChargeProblems(null, ctx)).toEqual(['Godkänd brytavgift saknas för fakturaunderlaget.'])
    expect(breakFeeChargeProblems(charge({ billing_underlay_id: 'other' }), ctx).join()).toMatch(/fakturaunderlag/)
    expect(breakFeeChargeProblems(charge({ company_id: 'x' }), ctx).join()).toMatch(/fakturaunderlag/)
    expect(breakFeeChargeProblems(charge({ customer_contract_id: 'other' }), ctx).join()).toMatch(/annat avtal/)
    expect(breakFeeChargeProblems(charge({ vat_classification: { code: 'x', vat_rate: 0.3, account: '1', verified_by: 'a' } }), ctx).join()).toMatch(/moms/)
    expect(breakFeeChargeProblems(charge({ vat_classification: { vat_rate: 0.25 } }), ctx).join()).toMatch(/moms/)
  })
})
