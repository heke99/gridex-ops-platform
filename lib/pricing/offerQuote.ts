import type { IntegrationApiClient } from '@/lib/integrations/apiAuth'
import { calculateBasePrice } from '@/lib/pricing/basePriceCalculator'
import { buildCanonicalContractSnapshot } from '@/lib/pricing/contractSnapshot'
import { finalizePricingPreview } from '@/lib/pricing/pricePreviewBuilder'
import { calculatePriceComponents } from '@/lib/pricing/priceComponentCalculator'
import { resolveBasePriceSourceValues, resolvePricingConfiguration } from '@/lib/pricing/priceSourceResolver'
import { isPriceArea, type BillingUnderlayInput, type PriceArea } from '@/lib/pricing/types'
import { resolvePublicContractOffer } from '@/lib/website/publicContracts'

export class OfferQuoteError extends Error {
  readonly code: string
  readonly status: number
  readonly field?: string

  constructor(message: string, code: string, status = 422, field?: string) {
    super(message)
    this.name = 'OfferQuoteError'
    this.code = code
    this.status = status
    this.field = field
  }
}

function dateOnly(value: string | null | undefined): string {
  const candidate = value?.trim() || new Date().toISOString().slice(0, 10)
  if (!/^\d{4}-\d{2}-\d{2}$/.test(candidate) || Number.isNaN(new Date(`${candidate}T00:00:00Z`).getTime())) {
    throw new OfferQuoteError('Startdatum måste anges som YYYY-MM-DD.', 'invalid_start_date', 400, 'start_date')
  }
  return candidate
}

function monthPeriod(startDate: string) {
  const billingMonth = startDate.slice(0, 7)
  const [year, month] = billingMonth.split('-').map(Number)
  const periodStart = `${billingMonth}-01`
  const periodEnd = new Date(Date.UTC(year, month, 1)).toISOString().slice(0, 10)
  return { billingMonth, periodStart, periodEnd }
}

function positiveNumber(value: unknown, field: string): number {
  const parsed = typeof value === 'number' ? value : Number(String(value ?? '').replace(',', '.'))
  if (!Number.isFinite(parsed) || parsed <= 0) {
    throw new OfferQuoteError(`${field === 'annual_consumption_kwh' ? 'Årsförbrukning' : field} måste vara större än 0.`, 'invalid_quote_input', 400, field)
  }
  return parsed
}

export async function calculateOfferQuote(input: {
  client: IntegrationApiClient
  offerReference: string
  priceArea: string
  annualConsumptionKwh: number
  startDate?: string | null
  customerType?: string | null
}) {
  const offerReference = input.offerReference.trim()
  if (!offerReference) throw new OfferQuoteError('offer_reference saknas.', 'offer_reference_missing', 400, 'offer_reference')
  if (!isPriceArea(input.priceArea)) throw new OfferQuoteError('price_area måste vara SE1, SE2, SE3 eller SE4.', 'invalid_price_area', 400, 'price_area')

  const annualConsumptionKwh = positiveNumber(input.annualConsumptionKwh, 'annual_consumption_kwh')
  const startDate = dateOnly(input.startDate)
  const { billingMonth, periodStart, periodEnd } = monthPeriod(startDate)
  const offer = await resolvePublicContractOffer({
    client: input.client,
    offerReference,
    customerType: input.customerType,
  })
  if (!offer) throw new OfferQuoteError('Avtalet hittades inte eller är inte publicerat för denna tenant.', 'offer_not_found', 404, 'offer_reference')

  const canonical = buildCanonicalContractSnapshot({
    contractType: offer.contract_type,
    billingModel: offer.billing_model,
    productCode: offer.product_code,
    monthlyFeeSek: offer.monthly_fee_sek,
    invoiceFeeSek: offer.invoice_fee_sek,
    markupOrePerKwh: offer.markup_ore_per_kwh,
    spotMarkupOrePerKwh: offer.spot_markup_ore_per_kwh,
    variableFeeOrePerKwh: offer.variable_fee_ore_per_kwh,
    fixedPriceOrePerKwh: offer.fixed_price_ore_per_kwh,
    greenFeeMode: offer.green_fee_mode,
    greenFeeValue: offer.green_fee_value,
    spotWeightPercent: offer.spot_weight_percent,
    portfolioWeightPercent: offer.portfolio_weight_percent,
    fixedWeightPercent: offer.fixed_weight_percent,
    validFrom: startDate,
    validTo: offer.valid_to,
  })

  const monthlyConsumptionKwh = annualConsumptionKwh / 12
  const pricingSnapshot = {
    snapshot_schema: 'gridex_contract_pricing_v2',
    pricing_model: canonical.pricingModel,
    vat_rate: canonical.vatRate,
    base_price_components_snapshot: canonical.basePriceComponents,
    price_components_snapshot: canonical.priceComponents,
  }
  const underlay: BillingUnderlayInput = {
    companyId: input.client.company_id,
    customerId: null,
    meteringPointId: null,
    priceArea: input.priceArea as PriceArea,
    quantityKwh: monthlyConsumptionKwh,
    periodStart,
    periodEnd,
    activeFrom: startDate,
    pricingSnapshot,
  }

  const config = await resolvePricingConfiguration({ companyId: input.client.company_id, underlay, contract: null })
  const sourceValues = await resolveBasePriceSourceValues({
    companyId: input.client.company_id,
    priceArea: input.priceArea as PriceArea,
    billingMonth,
    fixedSekPerKwh: offer.fixed_price_ore_per_kwh !== null ? offer.fixed_price_ore_per_kwh / 100 : null,
  })
  const base = calculateBasePrice({ underlay, components: config.baseComponents, sourceValues })
  const spotAmountExVat = base.lines
    .filter((line) => line.metadata?.source_type === 'spot')
    .reduce((sum, line) => sum + line.amountExVat, 0)
  const components = calculatePriceComponents({
    underlay,
    components: config.priceComponents,
    baseAmountExVat: base.lines.reduce((sum, line) => sum + line.amountExVat, 0),
    spotAmountExVat: base.lines.some((line) => line.metadata?.source_type === 'spot') ? spotAmountExVat : null,
    vatRate: config.vatRate,
  })
  const preview = finalizePricingPreview({
    lines: [...base.lines, ...components.lines],
    warnings: [...config.warnings, ...base.warnings, ...components.warnings],
    errors: [...base.errors, ...components.errors],
    vatRate: config.vatRate,
  })

  if (preview.status === 'failed') {
    const missingPortfolio = preview.errors.some((message) => message.includes('Portföljpris saknas'))
    throw new OfferQuoteError(
      missingPortfolio
        ? `Portföljpris saknas för ${input.priceArea} och ${billingMonth}. Avtalet kan inte beräknas innan tenantens pris är bekräftat.`
        : preview.errors.join(' '),
      missingPortfolio ? 'portfolio_price_missing' : 'quote_calculation_failed',
      422,
    )
  }

  const annualFactor = annualConsumptionKwh / monthlyConsumptionKwh
  return {
    offer: {
      id: offer.id,
      offer_reference: offerReference,
      public_name: offer.public_name,
      product_code: offer.product_code,
      contract_type: offer.contract_type,
      pricing_model: canonical.pricingModel,
    },
    input: {
      price_area: input.priceArea,
      annual_consumption_kwh: annualConsumptionKwh,
      estimated_monthly_consumption_kwh: monthlyConsumptionKwh,
      start_date: startDate,
      billing_month: billingMonth,
    },
    estimate: {
      monthly_ex_vat: preview.totalExVat,
      monthly_vat: preview.vatAmount,
      monthly_inc_vat: preview.totalIncVat,
      annual_ex_vat: Math.round(preview.totalExVat * annualFactor * 100) / 100,
      annual_vat: Math.round(preview.vatAmount * annualFactor * 100) / 100,
      annual_inc_vat: Math.round(preview.totalIncVat * annualFactor * 100) / 100,
    },
    lines: preview.lines,
    warnings: preview.warnings,
    assumptions: [
      'Årsförbrukningen fördelas jämnt över 12 månader i förhandskalkylen.',
      'Rörligt spot- och portföljpris hämtas för valt elområde och startmånad.',
      'Slutlig faktura använder verkliga mätvärden och prisperiodens låsta underlag.',
    ],
    snapshot_schema: 'gridex_contract_pricing_v2',
  }
}
