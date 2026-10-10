// Server-side commercial sanity checks shared by the contract forms and the
// admin customer intake. Messages are Swedish and keyed by intake field name.

export type ContractPricingField =
  | 'fixedPriceOrePerKwh'
  | 'spotMarkupOrePerKwh'
  | 'overrideReason'
  | 'contractStartDate'
  | 'contractEndDate'

export type ContractPricingErrors = Partial<Record<ContractPricingField, string>>

export type CatalogPrices = {
  fixed_price_ore_per_kwh?: number | null
  spot_markup_ore_per_kwh?: number | null
  variable_fee_ore_per_kwh?: number | null
  monthly_fee_sek?: number | null
  invoice_fee_sek?: number | null
}

export type SubmittedPrices = {
  fixedPriceOrePerKwh?: number | null
  spotMarkupOrePerKwh?: number | null
  variableFeeOrePerKwh?: number | null
  monthlyFeeSek?: number | null
  invoiceFeeSek?: number | null
}

const SPOT_CONTRACT_TYPES = new Set(['variable_hourly', 'variable_monthly', 'variable_quarterly'])

function present(value: number | null | undefined): value is number {
  return typeof value === 'number' && Number.isFinite(value)
}

/** True when a submitted price differs from the catalog value it replaces. */
export function catalogPricesOverridden(catalog: CatalogPrices | null | undefined, submitted: SubmittedPrices): boolean {
  if (!catalog) return false
  const pairs: Array<[number | null | undefined, number | null | undefined]> = [
    [submitted.fixedPriceOrePerKwh, catalog.fixed_price_ore_per_kwh],
    [submitted.spotMarkupOrePerKwh, catalog.spot_markup_ore_per_kwh],
    [submitted.variableFeeOrePerKwh, catalog.variable_fee_ore_per_kwh],
    [submitted.monthlyFeeSek, catalog.monthly_fee_sek],
    [submitted.invoiceFeeSek, catalog.invoice_fee_sek],
  ]
  return pairs.some(([next, current]) => present(next) && (!present(current) || Math.abs(next - current) > 1e-9))
}

function dateOnly(value: string | null | undefined): string | null {
  const trimmed = (value ?? '').trim()
  return trimmed ? trimmed.slice(0, 10) : null
}

export function validateContractPricing(input: {
  contractType: string | null | undefined
  /** Prices are entered manually (no catalog offer backs them). */
  customPricing: boolean
  catalogOverridden: boolean
  fixedPriceOrePerKwh?: number | null
  spotMarkupOrePerKwh?: number | null
  overrideReason?: string | null
  startsAt?: string | null
  endsAt?: string | null
}): ContractPricingErrors {
  const errors: ContractPricingErrors = {}
  if (input.customPricing) {
    if (input.contractType === 'fixed' && !present(input.fixedPriceOrePerKwh)) {
      errors.fixedPriceOrePerKwh = 'Fastprisavtal kräver ett fast pris (öre/kWh).'
    }
    if (input.contractType && SPOT_CONTRACT_TYPES.has(input.contractType) && !present(input.spotMarkupOrePerKwh)) {
      errors.spotMarkupOrePerKwh = 'Rörligt avtal (spot) kräver ett påslag (öre/kWh).'
    }
  }
  if (input.catalogOverridden && !(input.overrideReason ?? '').trim()) {
    errors.overrideReason = 'Ange orsak när katalogpriser ändras.'
  }
  const start = dateOnly(input.startsAt)
  const end = dateOnly(input.endsAt)
  if (start && end && start > end) {
    errors.contractEndDate = 'Slutdatum kan inte vara före startdatum.'
  }
  return errors
}

export function firstContractPricingError(errors: ContractPricingErrors): string | null {
  const values = Object.values(errors).filter(Boolean)
  return values.length ? values.join(' ') : null
}
