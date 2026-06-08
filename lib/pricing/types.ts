export type PriceArea = 'SE1' | 'SE2' | 'SE3' | 'SE4'

export const PRICE_AREAS: PriceArea[] = ['SE1', 'SE2', 'SE3', 'SE4']

export type PricingModel = 'spot' | 'fixed' | 'portfolio' | 'mixed' | 'manual_override'

export type BasePriceSourceType = 'spot' | 'fixed' | 'portfolio' | 'manual'

export type PriceResolution = 'hourly' | 'quarter_hour' | 'daily' | 'monthly'

export type SpotPriceInterval = {
  source: string
  priceArea: PriceArea
  timeStart: string
  timeEnd: string
  sekPerKwh: number
  eurPerKwh: number | null
  exchangeRate: number | null
  resolution: 'hourly' | 'quarter_hour'
  sourcePayload?: Record<string, unknown>
}

export type MonthlySpotSummary = {
  source: string
  priceArea: PriceArea
  billingMonth: string
  averageSekPerKwh: number
  minSekPerKwh: number
  maxSekPerKwh: number
  intervalCount: number
  expectedIntervalCount: number
  status: 'incomplete' | 'complete' | 'locked'
}

export type PortfolioMonthlyPrice = {
  companyId: string
  priceArea: PriceArea
  billingMonth: string
  priceExVatSekPerKwh: number
  status: 'draft' | 'confirmed' | 'locked'
  source: 'manual' | 'api' | 'import'
}

export type BasePriceComponent = {
  sourceType: BasePriceSourceType
  weightPercent: number
  fixedPriceSekPerKwh?: number | null
  label?: string | null
  validFrom?: string | null
  validTo?: string | null
  metadata?: Record<string, unknown>
}

export type PriceComponentType =
  | 'markup_ore_per_kwh'
  | 'fixed_monthly_fee'
  | 'invoice_fee'
  | 'elcertificate_fee'
  | 'green_energy_fee'
  | 'balancing_fee'
  | 'admin_fee'
  | 'environmental_fee'
  | 'discount_ore_per_kwh'
  | 'discount_fixed_amount'
  | 'manual_adjustment'
  | 'rounding'
  | 'vat'
  | 'spot_markup'
  | 'fixed_markup'
  | 'fixed_price'
  | 'variable_fee'
  | 'campaign_discount'
  | 'custom_addon'
  | 'start_fee'
  | 'break_fee'

export type CalculationType =
  | 'per_kwh'
  | 'fixed_monthly'
  | 'fixed_once'
  | 'percentage'
  | 'discount_per_kwh'
  | 'discount_fixed'
  | 'rounding'
  | 'ore_per_kwh'
  | 'sek_month'
  | 'sek_once'

export type PriceComponent = {
  componentType: PriceComponentType | string
  name: string
  description?: string | null
  calculationType: CalculationType | string
  amount: number
  unit?: string | null
  vatApplicable?: boolean
  invoiceLineVisible?: boolean
  periodizationMode?: 'none' | 'active_days' | 'full_month' | string | null
  priority?: number | null
  validFrom?: string | null
  validTo?: string | null
  metadata?: Record<string, unknown>
}

export type BillingPeriod = {
  start: string
  end: string
  billingMonth: string
}

export type BillingUnderlayInput = {
  companyId: string
  billingUnderlayId?: string | null
  customerId: string | null
  customerSiteId?: string | null
  meteringPointId: string | null
  contractId?: string | null
  pricePlanId?: string | null
  campaignId?: string | null
  priceArea: PriceArea | null
  quantityKwh: number | null
  periodStart: string
  periodEnd: string
  activeFrom?: string | null
  activeTo?: string | null
  pricingSnapshot?: Record<string, unknown> | null
}

export type BasePriceSourceValues = {
  spotSekPerKwh?: number | null
  portfolioSekPerKwh?: number | null
  fixedSekPerKwh?: number | null
  manualSekPerKwh?: number | null
}

export type BasePriceResult = {
  status: 'success' | 'failed'
  baseSekPerKwh: number | null
  lines: PricingPreviewLine[]
  warnings: string[]
  errors: string[]
}

export type PricingPreviewLine = {
  lineType: string
  description: string
  quantity: number | null
  unit: string
  unitPriceExVat: number | null
  amountExVat: number
  vatRate: number
  vatAmount: number
  amountIncVat: number
  sortOrder: number
  metadata?: Record<string, unknown>
}

export type PricingPreviewResult = {
  status: 'success' | 'failed' | 'needs_review'
  billingUnderlayId?: string | null
  totalExVat: number
  vatAmount: number
  totalIncVat: number
  lines: PricingPreviewLine[]
  warnings: string[]
  errors: string[]
}

export function isPriceArea(value: string | null | undefined): value is PriceArea {
  return value === 'SE1' || value === 'SE2' || value === 'SE3' || value === 'SE4'
}

export function normalizeBillingMonth(value: string): string {
  const trimmed = value.trim()
  if (/^\d{4}-\d{2}$/.test(trimmed)) return trimmed
  if (/^\d{4}-\d{2}-\d{2}$/.test(trimmed)) return trimmed.slice(0, 7)
  throw new Error('Fakturamånad måste anges som YYYY-MM.')
}
