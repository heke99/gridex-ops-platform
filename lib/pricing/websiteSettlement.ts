export type WebsiteSettlementModel =
  | 'fixed_price'
  | 'market_monthly'
  | 'market_hourly'
  | 'market_quarter_hour'
  | 'portfolio'
  | 'mixed'

export type WebsiteSettlementAcceptance =
  | 'fixed_energy_price'
  | 'pricing_model'
  | 'portfolio_pricing_model'
  | 'mixed_pricing_model'

export type WebsiteSettlementResolution =
  | 'fixed'
  | 'month'
  | 'hour'
  | 'quarter_hour'
  | 'portfolio_period'
  | 'mixed_components'

export type WebsiteSettlement = {
  model: WebsiteSettlementModel
  customer_accepts: WebsiteSettlementAcceptance
  energy_price_locked_at_signup: boolean
  uses_actual_metered_consumption: true
  market_data_role: 'not_applicable' | 'indicative_preview_only'
  settlement_resolution: WebsiteSettlementResolution
}

/**
 * Public, organization-neutral settlement semantics for a published contract.
 * Tenant identity is resolved by the authenticated API client; this model must
 * never contain company IDs or other internal tenant selectors.
 */
export function websiteSettlementForContract(input: {
  contractType: string
  pricingInterval?: string | null
}): WebsiteSettlement {
  const type = input.contractType.trim().toLowerCase()
  const interval = input.pricingInterval?.trim().toLowerCase() ?? ''

  if (type === 'fixed') {
    return {
      model: 'fixed_price',
      customer_accepts: 'fixed_energy_price',
      energy_price_locked_at_signup: true,
      uses_actual_metered_consumption: true,
      market_data_role: 'not_applicable',
      settlement_resolution: 'fixed',
    }
  }
  if (type === 'variable_hourly' || interval === 'hourly' || interval === 'hour') {
    return {
      model: 'market_hourly',
      customer_accepts: 'pricing_model',
      energy_price_locked_at_signup: false,
      uses_actual_metered_consumption: true,
      market_data_role: 'indicative_preview_only',
      settlement_resolution: 'hour',
    }
  }
  if (
    type === 'variable_quarterly' ||
    interval === 'quarterly' ||
    interval === 'quarter_hour'
  ) {
    return {
      model: 'market_quarter_hour',
      customer_accepts: 'pricing_model',
      energy_price_locked_at_signup: false,
      uses_actual_metered_consumption: true,
      market_data_role: 'indicative_preview_only',
      settlement_resolution: 'quarter_hour',
    }
  }
  if (type === 'portfolio' || interval === 'portfolio') {
    return {
      model: 'portfolio',
      customer_accepts: 'portfolio_pricing_model',
      energy_price_locked_at_signup: false,
      uses_actual_metered_consumption: true,
      market_data_role: 'indicative_preview_only',
      settlement_resolution: 'portfolio_period',
    }
  }
  if (type === 'mixed' || interval === 'mixed') {
    return {
      model: 'mixed',
      customer_accepts: 'mixed_pricing_model',
      energy_price_locked_at_signup: false,
      uses_actual_metered_consumption: true,
      market_data_role: 'indicative_preview_only',
      settlement_resolution: 'mixed_components',
    }
  }

  return {
    model: 'market_monthly',
    customer_accepts: 'pricing_model',
    energy_price_locked_at_signup: false,
    uses_actual_metered_consumption: true,
    market_data_role: 'indicative_preview_only',
    settlement_resolution: 'month',
  }
}
