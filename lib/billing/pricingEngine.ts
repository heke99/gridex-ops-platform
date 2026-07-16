import { supabaseService } from '@/lib/supabase/service'
import { requireCompanyOperationalForWrites } from '@/lib/tenant/governance'
import type { ContractOfferRow } from '@/lib/customer-contracts/types'

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
    .from('canonical_internal_contract_offers_v')
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
      .from('canonical_internal_contract_offers_v')
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


// NOTE: The legacy calculation function `calculatePricingForBillingUnderlay`
// has been retired. All billing/export pricing now runs through the Pricing
// Core (lib/pricing/engine.ts) via lib/pricing/underlayPricingAdapter.ts, so
// preview, billing automation and partner export always share one calculation
// path and persisted pricing_runs. This module now only contains the admin
// helpers for managing pricing component rules, which the Pricing Core merges
// into its calculations via resolvePricingConfiguration.
