import { supabaseService } from '@/lib/supabase/service'
import { requireCompanyOperationalForWrites } from '@/lib/tenant/governance'
import type { ContractOfferRow } from '@/lib/customer-contracts/types'
import type { BillingUnderlayRow } from '@/lib/cis/types'

export type PricingComponentRuleRow = {
  id: string
  company_id: string
  contract_offer_id: string | null
  component_code: string
  component_label: string
  component_type: string
  calculation_unit: string
  value_amount: number | null
  currency: string
  applies_to: string
  valid_from: string | null
  valid_to: string | null
  priority: number
  is_active: boolean
  metadata: Record<string, unknown>
  created_at: string
  updated_at: string
  created_by: string | null
}

export type PricingReadinessIssue = {
  code: string
  label: string
  severity: 'info' | 'warning' | 'blocked'
}

function isMissingRelationError(error: unknown): boolean {
  const maybe = error as { code?: string; message?: string } | null
  return Boolean(
    maybe &&
      (maybe.code === '42P01' ||
        maybe.code === '42703' ||
        maybe.code === 'PGRST205' ||
        /does not exist|schema cache|relation .* does not exist/i.test(maybe.message ?? ''))
  )
}

export async function listContractOffersForPricing(companyId: string): Promise<Pick<ContractOfferRow, 'id' | 'name' | 'status' | 'contract_type' | 'is_active'>[]> {
  const { data, error } = await supabaseService
    .from('contract_offers')
    .select('id, name, status, contract_type, is_active')
    .eq('company_id', companyId)
    .order('created_at', { ascending: false })
    .limit(80)

  if (error) {
    if (isMissingRelationError(error)) return []
    throw error
  }

  return (data ?? []) as Pick<ContractOfferRow, 'id' | 'name' | 'status' | 'contract_type' | 'is_active'>[]
}

export async function listPricingComponentRules(companyId: string): Promise<PricingComponentRuleRow[]> {
  try {
    const { data, error } = await supabaseService
      .from('pricing_component_rules')
      .select('*')
      .eq('company_id', companyId)
      .order('priority', { ascending: true })
      .order('created_at', { ascending: false })
      .limit(120)

    if (error) {
      if (isMissingRelationError(error)) return []
      throw error
    }

    return (data ?? []) as PricingComponentRuleRow[]
  } catch (error) {
    if (isMissingRelationError(error)) return []
    throw error
  }
}

export async function createPricingComponentRule(input: {
  companyId: string
  actorUserId: string
  contractOfferId?: string | null
  componentCode: string
  componentLabel: string
  componentType: string
  calculationUnit: string
  valueAmount?: number | null
  currency?: string | null
  appliesTo: string
  validFrom?: string | null
  validTo?: string | null
  priority?: number | null
  isActive: boolean
  metadata?: Record<string, unknown>
}) {
  await requireCompanyOperationalForWrites(input.companyId)

  const code = input.componentCode.trim().toLowerCase().replace(/[^a-z0-9_]+/g, '_').replace(/^_+|_+$/g, '')
  if (!code) throw new Error('Komponentkod krävs.')
  if (!input.componentLabel.trim()) throw new Error('Komponentnamn krävs.')

  if (input.contractOfferId) {
    const { data: offer, error: offerError } = await supabaseService
      .from('contract_offers')
      .select('id, company_id')
      .eq('id', input.contractOfferId)
      .eq('company_id', input.companyId)
      .maybeSingle()

    if (offerError) throw offerError
    if (!offer?.id) throw new Error('Avtalsmallen tillhör inte valt bolag.')
  }

  const { data, error } = await supabaseService
    .from('pricing_component_rules')
    .insert({
      company_id: input.companyId,
      contract_offer_id: input.contractOfferId ?? null,
      component_code: code,
      component_label: input.componentLabel.trim(),
      component_type: input.componentType,
      calculation_unit: input.calculationUnit,
      value_amount: input.valueAmount ?? null,
      currency: input.currency || 'SEK',
      applies_to: input.appliesTo,
      valid_from: input.validFrom ?? null,
      valid_to: input.validTo ?? null,
      priority: input.priority ?? 100,
      is_active: input.isActive,
      metadata: input.metadata ?? {},
      created_by: input.actorUserId,
      updated_by: input.actorUserId,
    })
    .select('*')
    .single()

  if (error) throw error
  return data as PricingComponentRuleRow
}

export function evaluatePricingReadiness(input: {
  offers: Pick<ContractOfferRow, 'id' | 'name' | 'status' | 'is_active'>[]
  rules: PricingComponentRuleRow[]
}): PricingReadinessIssue[] {
  const issues: PricingReadinessIssue[] = []
  const activeOffers = input.offers.filter((offer) => offer.is_active && offer.status === 'active')
  const activeRules = input.rules.filter((rule) => rule.is_active)

  if (activeOffers.length === 0) {
    issues.push({ code: 'no_active_contract_offer', label: 'Ingen aktiv avtalsmall finns för kundintag.', severity: 'blocked' })
  }

  if (activeRules.length === 0) {
    issues.push({ code: 'no_pricing_components', label: 'Inga prismotorkomponenter är registrerade ännu.', severity: 'warning' })
  }

  const hasMonthlyFee = activeRules.some((rule) => rule.component_type === 'fixed_monthly_fee')
  const hasMarkup = activeRules.some((rule) => ['spot_markup', 'variable_fee', 'fixed_markup'].includes(rule.component_type))

  if (!hasMonthlyFee) {
    issues.push({ code: 'missing_monthly_fee_component', label: 'Fast månadsavgift saknas som prismotorkomponent.', severity: 'warning' })
  }

  if (!hasMarkup) {
    issues.push({ code: 'missing_markup_component', label: 'Påslag/rörlig avgift saknas som prismotorkomponent.', severity: 'warning' })
  }

  return issues
}


export type PricingCalculationLine = {
  componentRuleId: string
  componentCode: string
  componentLabel: string
  componentType: string
  calculationUnit: string
  valueAmount: number | null
  quantity: number | null
  amountSekExVat: number
  currency: string
  appliesTo: string
}

export type PricingCalculationResult = {
  underlayId: string
  totalKwh: number | null
  subtotalSekExVat: number
  vatSek: number
  totalSekIncVat: number
  lines: PricingCalculationLine[]
  warnings: string[]
}

function roundMoney(value: number): number {
  return Math.round(value * 100) / 100
}

function isRuleActiveForPeriod(rule: PricingComponentRuleRow, periodDate: string | null): boolean {
  if (!rule.is_active) return false
  if (!periodDate) return true
  if (rule.valid_from && periodDate < rule.valid_from) return false
  if (rule.valid_to && periodDate > rule.valid_to) return false
  return true
}

function periodDateFromUnderlay(underlay: BillingUnderlayRow): string | null {
  if (!underlay.underlay_year || !underlay.underlay_month) return null
  return `${underlay.underlay_year}-${String(underlay.underlay_month).padStart(2, '0')}-01`
}

export function calculatePricingForBillingUnderlay(params: {
  underlay: BillingUnderlayRow
  rules: PricingComponentRuleRow[]
  vatRate?: number
}): PricingCalculationResult {
  const { underlay } = params
  const vatRate = params.vatRate ?? 0.25
  const totalKwh = typeof underlay.total_kwh === 'number' ? underlay.total_kwh : null
  const periodDate = periodDateFromUnderlay(underlay)
  const warnings: string[] = []

  const activeRules = params.rules
    .filter((rule) => isRuleActiveForPeriod(rule, periodDate))
    .sort((a, b) => a.priority - b.priority)

  const lines: PricingCalculationLine[] = []

  for (const rule of activeRules) {
    let amount = 0
    let quantity: number | null = null

    if (rule.calculation_unit === 'ore_per_kwh') {
      quantity = totalKwh
      if (totalKwh === null || rule.value_amount === null) {
        warnings.push(`${rule.component_label}: kan inte beräknas utan kWh eller värde.`)
        continue
      }
      amount = (totalKwh * rule.value_amount) / 100
    } else if (rule.calculation_unit === 'sek_month') {
      quantity = 1
      if (rule.value_amount === null) {
        warnings.push(`${rule.component_label}: månadsbelopp saknas.`)
        continue
      }
      amount = rule.value_amount
    } else if (rule.calculation_unit === 'sek_once') {
      quantity = 1
      if (rule.value_amount === null) {
        warnings.push(`${rule.component_label}: engångsbelopp saknas.`)
        continue
      }
      amount = rule.value_amount
    } else if (rule.calculation_unit === 'percent_of_spot') {
      warnings.push(`${rule.component_label}: procent av spot kräver spotprisunderlag och flaggas för senare motorsteg.`)
      continue
    } else {
      warnings.push(`${rule.component_label}: okänd beräkningsenhet ${rule.calculation_unit}.`)
      continue
    }

    lines.push({
      componentRuleId: rule.id,
      componentCode: rule.component_code,
      componentLabel: rule.component_label,
      componentType: rule.component_type,
      calculationUnit: rule.calculation_unit,
      valueAmount: rule.value_amount,
      quantity,
      amountSekExVat: roundMoney(amount),
      currency: rule.currency,
      appliesTo: rule.applies_to,
    })
  }

  const componentTotal = lines.reduce((sum, line) => sum + line.amountSekExVat, 0)
  const baseUnderlayAmount = typeof underlay.total_sek_ex_vat === 'number' ? underlay.total_sek_ex_vat : 0
  const subtotal = roundMoney(baseUnderlayAmount + componentTotal)
  const vat = roundMoney(subtotal * vatRate)

  return {
    underlayId: underlay.id,
    totalKwh,
    subtotalSekExVat: subtotal,
    vatSek: vat,
    totalSekIncVat: roundMoney(subtotal + vat),
    lines,
    warnings,
  }
}
