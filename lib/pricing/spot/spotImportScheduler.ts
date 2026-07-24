import { supabaseService } from '@/lib/supabase/service'
import { PRICE_AREAS, isPriceArea, type PriceArea } from '@/lib/pricing/types'
import { importSpotPricesForMonth } from '@/lib/pricing/spot/spotPriceImporter'

export type SpotAutoImportReason = 'cron' | 'pricing_preview' | 'billing_underlay' | 'manual_retry'

type SpotMonthlySummaryRow = {
  price_area: string
  billing_month: string
  status: string
  interval_count: number | null
  expected_interval_count: number | null
}

export function previousBillingMonth(now: Date = new Date()): string {
  const year = now.getUTCFullYear()
  const monthIndex = now.getUTCMonth()
  const previous = new Date(Date.UTC(year, monthIndex - 1, 1))
  return `${previous.getUTCFullYear()}-${String(previous.getUTCMonth() + 1).padStart(2, '0')}`
}

export function normalizeSpotAutoImportMonth(value?: string | null, now: Date = new Date()): string {
  if (!value || value === 'previous') return previousBillingMonth(now)
  if (/^\d{4}-\d{2}$/.test(value)) return value
  throw new Error('billing_month måste anges som YYYY-MM eller previous.')
}

export function normalizeSpotAutoImportAreas(values?: unknown): PriceArea[] {
  if (!values) return PRICE_AREAS
  const rawValues = Array.isArray(values) ? values : String(values).split(',')
  const areas = rawValues.map((value) => String(value).trim()).filter(Boolean)
  if (areas.length === 0) return PRICE_AREAS
  for (const area of areas) {
    if (!isPriceArea(area)) throw new Error(`Ogiltigt elområde: ${area}`)
  }
  return Array.from(new Set(areas)) as PriceArea[]
}

function isSummaryComplete(row: SpotMonthlySummaryRow | undefined): boolean {
  if (!row) return false
  if (row.status === 'locked') return true
  if (!['complete', 'verified'].includes(row.status)) return false
  const intervalCount = Number(row.interval_count ?? 0)
  const expected = Number(row.expected_interval_count ?? 0)
  return expected > 0 && intervalCount >= expected
}

export async function listMissingSpotPriceAreas(input: {
  billingMonth: string
  priceAreas?: PriceArea[]
}): Promise<PriceArea[]> {
  const areas = input.priceAreas?.length ? input.priceAreas : PRICE_AREAS
  const { data, error } = await supabaseService
    .from('spot_price_monthly_summaries')
    .select('price_area,billing_month,status,interval_count,expected_interval_count')
    .eq('source', 'elprisetjustnu')
    .eq('billing_month', input.billingMonth)
    .in('price_area', areas)

  if (error && error.code !== '42P01' && error.code !== 'PGRST205') throw error
  if (error) return areas

  const byArea = new Map<string, SpotMonthlySummaryRow>()
  for (const row of (data ?? []) as SpotMonthlySummaryRow[]) byArea.set(row.price_area, row)
  return areas.filter((area) => !isSummaryComplete(byArea.get(area)))
}

export async function ensureSpotPricesForBillingMonth(input: {
  billingMonth?: string | null
  priceAreas?: PriceArea[]
  force?: boolean
  reason?: SpotAutoImportReason
  createdBy?: string | null
  fetchImpl?: typeof fetch
}) {
  const billingMonth = normalizeSpotAutoImportMonth(input.billingMonth)
  const priceAreas = input.priceAreas?.length ? input.priceAreas : PRICE_AREAS
  const missingAreas = input.force ? priceAreas : await listMissingSpotPriceAreas({ billingMonth, priceAreas })

  if (missingAreas.length === 0) {
    return {
      status: 'already_available' as const,
      billingMonth,
      imported: false,
      priceAreas,
      missingAreas: [],
      result: null,
    }
  }

  const result = await importSpotPricesForMonth({
    billingMonth,
    priceAreas: missingAreas,
    createdBy: input.createdBy ?? null,
    fetchImpl: input.fetchImpl,
    force: input.force ?? false,
    triggerSource: input.reason ?? 'pricing_preview',
  })

  return {
    status: result.status,
    billingMonth,
    imported: true,
    priceAreas,
    missingAreas,
    result,
  }
}
