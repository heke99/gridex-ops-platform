import type { PricingPreviewLine } from '@/lib/pricing/types'

/**
 * The single invoice line of an approved break fee (FINDINGS H3d D11, owner decision 28). The amount and the VAT and
 * accounting classification come only from the approved charge (public.break_fee_charges, gridex_approve_break_fee_v1);
 * nothing is recomputed here. lifecycle 'event_only' with the charge as event makes gridex_lock_pricing_run record it in
 * contract_charge_ledger once per contract, component and event.
 */
export type ApprovedBreakFeeCharge = {
  id: string
  company_id: string
  customer_contract_id: string
  billing_underlay_id: string | null
  status: string
  amount_ex_vat: number | string
  currency: string
  contract_basis: string
  contract_rule_reference: string | null
  vat_classification: { code?: string; vat_rate?: number | string; account?: string; verified_by?: string; verified_at?: string; source?: string }
}

const round = (value: number) => Math.round(value * 100) / 100

export function breakFeeChargeProblems(charge: ApprovedBreakFeeCharge | null, input: { companyId: string; billingUnderlayId: string; contractId: string | null }): string[] {
  if (!charge) return ['Godkänd brytavgift saknas för fakturaunderlaget.']
  const problems: string[] = []
  if (charge.company_id !== input.companyId || charge.billing_underlay_id !== input.billingUnderlayId) problems.push('Brytavgiften hör inte till detta fakturaunderlag.')
  if (input.contractId && charge.customer_contract_id !== input.contractId) problems.push('Brytavgiften hör till ett annat avtal.')
  // Only an underlaid charge is priced; an invoiced or credited one is never charged again.
  if (charge.status !== 'underlaid') problems.push(`Brytavgiften kan inte prissättas i status ${charge.status}.`)
  const vat = charge.vat_classification ?? {}
  const rate = Number(vat.vat_rate)
  if (!vat.code || !vat.account || !vat.verified_by || !Number.isFinite(rate) || rate < 0 || rate > 0.25) problems.push('Brytavgiften saknar verifierad moms- och konteringsklassificering.')
  if (!(Number(charge.amount_ex_vat) > 0)) problems.push('Brytavgiftens belopp saknas.')
  return problems
}

export function buildBreakFeeLine(charge: ApprovedBreakFeeCharge): PricingPreviewLine {
  const amountExVat = round(Number(charge.amount_ex_vat))
  const vatRate = Number(charge.vat_classification.vat_rate)
  const vatAmount = round(amountExVat * vatRate)
  return {
    lineType: 'break_fee',
    description: 'Brytavgift vid förtida avslut av tidsbestämt avtal',
    quantity: 1,
    unit: 'st',
    unitPriceExVat: amountExVat,
    amountExVat,
    vatRate,
    vatAmount,
    amountIncVat: round(amountExVat + vatAmount),
    sortOrder: 10,
    metadata: {
      component_key: 'break_fee',
      lifecycle: 'event_only',
      billing_event_id: charge.id,
      break_fee_charge_id: charge.id,
      contract_basis: charge.contract_basis,
      contract_rule_reference: charge.contract_rule_reference,
      vat_code: charge.vat_classification.code,
      account: charge.vat_classification.account,
      vat_rate_explicit: true,
      source_of_truth: 'break_fee_charges',
    },
  }
}
