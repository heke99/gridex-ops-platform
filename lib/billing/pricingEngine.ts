import { supabaseService } from '@/lib/supabase/service'
import { requireCompanyOperationalForWrites } from '@/lib/tenant/governance'
import type { ContractOfferRow, CustomerContractRow } from '@/lib/customer-contracts/types'
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
  const hasMarkup = activeRules.some((rule) => ['spot_markup', 'variable_fee', 'fixed_markup', 'fixed_price'].includes(rule.component_type))

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
  contractId?: string | null
  pricingVersion?: string | null
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


function numberFromRecord(record: Record<string, unknown>, key: string): number | null {
  const value = record[key]
  return typeof value === 'number' && Number.isFinite(value) ? value : null
}

function stringFromRecord(record: Record<string, unknown>, key: string): string | null {
  const value = record[key]
  return typeof value === 'string' && value.trim().length > 0 ? value.trim() : null
}

function addContractLine(params: {
  lines: PricingCalculationLine[]
  contractId: string | null
  code: string
  label: string
  type: string
  unit: string
  value: number | null
  quantity: number | null
  amount: number
  currency?: string | null
}) {
  if (params.value === null && params.amount === 0) return
  params.lines.push({
    componentRuleId: params.contractId ? `contract:${params.contractId}:${params.code}` : `contract:${params.code}`,
    componentCode: params.code,
    componentLabel: params.label,
    componentType: params.type,
    calculationUnit: params.unit,
    valueAmount: params.value,
    quantity: params.quantity,
    amountSekExVat: roundMoney(params.amount),
    currency: params.currency || 'SEK',
    appliesTo: 'contract',
  })
}

function addContractPricingLines(params: {
  lines: PricingCalculationLine[]
  warnings: string[]
  contract?: (Partial<CustomerContractRow> & Record<string, unknown>) | null
  totalKwh: number | null
  isFirstPeriod?: boolean
}) {
  const contract = params.contract
  if (!contract) {
    params.warnings.push('Avtal saknas för faktureringsraden. Prismotor kan inte verifiera kampanj, påslag eller bindningstid.')
    return
  }

  const contractId = typeof contract.id === 'string' ? contract.id : null
  const totalKwh = params.totalKwh
  const fixedPrice = typeof contract.fixed_price_ore_per_kwh === 'number' ? contract.fixed_price_ore_per_kwh : null
  const spotMarkup = typeof contract.spot_markup_ore_per_kwh === 'number' ? contract.spot_markup_ore_per_kwh : null
  const variableFee = typeof contract.variable_fee_ore_per_kwh === 'number' ? contract.variable_fee_ore_per_kwh : null
  const monthlyFee = typeof contract.monthly_fee_sek === 'number' ? contract.monthly_fee_sek : null
  const greenMode = typeof contract.green_fee_mode === 'string' ? contract.green_fee_mode : 'none'
  const greenValue = typeof contract.green_fee_value === 'number' ? contract.green_fee_value : null
  const record = contract as Record<string, unknown>
  const discountValue = numberFromRecord(record, 'discount_value')
  const discountUnit = stringFromRecord(record, 'discount_unit') ?? 'sek_month'
  const startFee = numberFromRecord(record, 'start_fee_sek')
  const adminFee = numberFromRecord(record, 'admin_fee_sek')

  if (fixedPrice !== null) {
    if (totalKwh === null) params.warnings.push('Fast pris kräver kWh för perioden.')
    else addContractLine({ lines: params.lines, contractId, code: 'contract_fixed_price', label: 'Fast pris enligt avtal', type: 'fixed_price', unit: 'ore_per_kwh', value: fixedPrice, quantity: totalKwh, amount: (totalKwh * fixedPrice) / 100 })
  }

  if (spotMarkup !== null) {
    if (totalKwh === null) params.warnings.push('Spotpåslag kräver kWh för perioden.')
    else addContractLine({ lines: params.lines, contractId, code: 'contract_spot_markup', label: 'Spotpåslag enligt avtal', type: 'spot_markup', unit: 'ore_per_kwh', value: spotMarkup, quantity: totalKwh, amount: (totalKwh * spotMarkup) / 100 })
  }

  if (variableFee !== null) {
    if (totalKwh === null) params.warnings.push('Rörlig avgift kräver kWh för perioden.')
    else addContractLine({ lines: params.lines, contractId, code: 'contract_variable_fee', label: 'Rörlig avgift enligt avtal', type: 'variable_fee', unit: 'ore_per_kwh', value: variableFee, quantity: totalKwh, amount: (totalKwh * variableFee) / 100 })
  }

  if (monthlyFee !== null) {
    addContractLine({ lines: params.lines, contractId, code: 'contract_monthly_fee', label: 'Fast månadsavgift enligt avtal', type: 'fixed_monthly_fee', unit: 'sek_month', value: monthlyFee, quantity: 1, amount: monthlyFee })
  }

  if (greenMode === 'sek_month' && greenValue !== null) {
    addContractLine({ lines: params.lines, contractId, code: 'green_electricity_fee', label: 'Grön el enligt avtal', type: 'green_electricity_fee', unit: 'sek_month', value: greenValue, quantity: 1, amount: greenValue })
  }
  if (greenMode === 'ore_per_kwh' && greenValue !== null) {
    if (totalKwh === null) params.warnings.push('Grön el-avgift kräver kWh för perioden.')
    else addContractLine({ lines: params.lines, contractId, code: 'green_electricity_fee', label: 'Grön el enligt avtal', type: 'green_electricity_fee', unit: 'ore_per_kwh', value: greenValue, quantity: totalKwh, amount: (totalKwh * greenValue) / 100 })
  }

  if (discountValue !== null) {
    if (discountUnit === 'ore_per_kwh') {
      if (totalKwh === null) params.warnings.push('Kampanjrabatt öre/kWh kräver kWh för perioden.')
      else addContractLine({ lines: params.lines, contractId, code: 'campaign_discount', label: 'Kampanjrabatt', type: 'campaign_discount', unit: 'ore_per_kwh', value: discountValue, quantity: totalKwh, amount: -((totalKwh * discountValue) / 100) })
    } else {
      addContractLine({ lines: params.lines, contractId, code: 'campaign_discount', label: 'Kampanjrabatt', type: 'campaign_discount', unit: discountUnit, value: discountValue, quantity: 1, amount: -discountValue })
    }
  }

  if (params.isFirstPeriod && startFee !== null) {
    addContractLine({ lines: params.lines, contractId, code: 'start_fee', label: 'Startavgift', type: 'start_fee', unit: 'sek_once', value: startFee, quantity: 1, amount: startFee })
  }

  if (adminFee !== null) {
    addContractLine({ lines: params.lines, contractId, code: 'admin_fee', label: 'Administrativ avgift', type: 'admin_fee', unit: 'sek_month', value: adminFee, quantity: 1, amount: adminFee })
  }

  const optional = Array.isArray(contract.optional_fee_lines) ? contract.optional_fee_lines : []
  for (const [index, line] of optional.entries()) {
    if (!line || typeof line !== 'object') continue
    const row = line as Record<string, unknown>
    const label = typeof row.label === 'string' && row.label.trim() ? row.label.trim() : `Övrig avgift ${index + 1}`
    const amount = typeof row.amount === 'number' && Number.isFinite(row.amount) ? row.amount : null
    const unit = typeof row.unit === 'string' && row.unit.trim() ? row.unit.trim() : 'sek'
    if (amount === null) continue
    if (unit === 'ore_per_kwh') {
      if (totalKwh === null) params.warnings.push(`${label} kräver kWh för perioden.`)
      else addContractLine({ lines: params.lines, contractId, code: `optional_fee_${index + 1}`, label, type: 'custom_addon', unit, value: amount, quantity: totalKwh, amount: (totalKwh * amount) / 100 })
    } else {
      addContractLine({ lines: params.lines, contractId, code: `optional_fee_${index + 1}`, label, type: 'custom_addon', unit, value: amount, quantity: 1, amount })
    }
  }
}

export function calculatePricingForBillingUnderlay(params: {
  underlay: BillingUnderlayRow
  rules: PricingComponentRuleRow[]
  vatRate?: number
  contract?: (Partial<CustomerContractRow> & Record<string, unknown>) | null
  isFirstPeriod?: boolean
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

    if (['campaign_discount', 'customer_discount', 'discount'].includes(rule.component_type)) {
      amount = -Math.abs(amount)
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

  addContractPricingLines({
    lines,
    warnings,
    contract: params.contract ?? null,
    totalKwh,
    isFirstPeriod: params.isFirstPeriod,
  })

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
    contractId: params.contract?.id ?? null,
    pricingVersion: params.contract ? stringFromRecord(params.contract as Record<string, unknown>, 'price_version') : null,
  }
}
