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

/**
 * A break-fee credit (FINDINGS D11-G1, owner decision 33; public.break_fee_credits, gridex_request_break_fee_credit_v1).
 * Its amount and VAT/accounting classification were copied from the original charge when the credit was requested, so
 * the credit derives from the original debit and is never re-priced with today's prices.
 */
export type BreakFeeCredit = {
  id: string
  company_id: string
  break_fee_charge_id: string
  credit_underlay_id: string
  original_invoice_id: string
  status: string
  amount_ex_vat: number | string
  currency: string
  kind: string
  reason: string
  vat_classification: ApprovedBreakFeeCharge['vat_classification']
}

export function breakFeeCreditProblems(credit: BreakFeeCredit | null, input: { companyId: string; billingUnderlayId: string }): string[] {
  if (!credit) return ['Kreditering av brytavgift saknas för fakturaunderlaget.']
  const problems: string[] = []
  if (credit.company_id !== input.companyId || credit.credit_underlay_id !== input.billingUnderlayId) problems.push('Krediteringen hör inte till detta fakturaunderlag.')
  // Only a credit still waiting for its invoice is priced; an invoiced one is never credited again.
  if (credit.status !== 'underlaid') problems.push(`Krediteringen kan inte prissättas i status ${credit.status}.`)
  const vat = credit.vat_classification ?? {}
  const rate = Number(vat.vat_rate)
  if (!vat.code || !vat.account || !Number.isFinite(rate) || rate < 0 || rate > 0.25) problems.push('Krediteringen saknar ursprungsdebiteringens moms- och konteringsklassificering.')
  if (!(Number(credit.amount_ex_vat) > 0)) problems.push('Krediteringens belopp saknas.')
  return problems
}

export function buildBreakFeeCreditLine(credit: BreakFeeCredit): PricingPreviewLine {
  const amountExVat = -round(Number(credit.amount_ex_vat))
  const vatRate = Number(credit.vat_classification.vat_rate)
  // `+ 0` turns a 0 % credit's -0 into 0.
  const vatAmount = round(amountExVat * vatRate) + 0
  return {
    lineType: 'break_fee_credit',
    description: credit.kind === 'full' ? 'Kreditering av brytavgift' : 'Delkreditering av brytavgift',
    quantity: 1,
    unit: 'st',
    unitPriceExVat: amountExVat,
    amountExVat,
    vatRate,
    vatAmount,
    amountIncVat: round(amountExVat + vatAmount),
    sortOrder: 10,
    metadata: {
      component_key: 'break_fee_credit',
      lifecycle: 'event_only',
      billing_event_id: credit.id,
      break_fee_credit_id: credit.id,
      break_fee_charge_id: credit.break_fee_charge_id,
      credit_of_invoice_id: credit.original_invoice_id,
      credit_reason: credit.reason,
      vat_code: credit.vat_classification.code,
      account: credit.vat_classification.account,
      vat_rate_explicit: true,
      source_of_truth: 'break_fee_credits',
    },
  }
}
