import { createHash } from 'node:crypto'
import { supabaseService } from '@/lib/supabase/service'
import type { PriceArea } from '@/lib/pricing/types'
import { currentStockholmCalendarDate } from '@/lib/time/stockholm'

export type MarketPreviewReferencePeriod =
  | 'latest_complete_day'
  | 'rolling_7_days'
  | 'rolling_30_days'
  | 'month_to_date'

type DailyPreviewSourceRow = {
  id: string
  price_date: string
  average_sek_per_kwh: number | string | null
  status: string
  source_checksum: string | null
  updated_at: string | null
  provider_fetched_at: string | null
  verified_at: string | null
  locked_at: string | null
  covered_duration_minutes: number | string | null
  expected_duration_minutes: number | string | null
  resolution: string | null
}

export type MarketPreviewBuildResult = {
  referencePeriod: MarketPreviewReferencePeriod
  created: boolean
  unchanged: boolean
  previewId: string | null
  requestedDays: number
  includedDays: number
  fallbackUsed: boolean
  sourceChecksum: string
}

function text(value: unknown): string | null {
  return typeof value === 'string' && value.trim() ? value.trim() : null
}

function numberValue(value: unknown): number | null {
  const parsed = typeof value === 'number' ? value : Number(value)
  return Number.isFinite(parsed) ? parsed : null
}

function timestamp(value: unknown): number {
  const parsed = Date.parse(String(value ?? ''))
  return Number.isFinite(parsed) ? parsed : 0
}

function newestEvidenceTimestamp(rows: DailyPreviewSourceRow[]): string {
  const newest = rows.reduce((latest, row) => Math.max(
    latest,
    timestamp(row.provider_fetched_at),
    timestamp(row.verified_at),
    timestamp(row.locked_at),
    timestamp(row.updated_at),
  ), 0)
  if (!newest) throw new Error('Marknadsreferensen saknar source_as_of-evidens.')
  return new Date(newest).toISOString()
}

function requestedDays(referencePeriod: MarketPreviewReferencePeriod, now: Date): number {
  if (referencePeriod === 'latest_complete_day') return 1
  if (referencePeriod === 'rolling_7_days') return 7
  if (referencePeriod === 'rolling_30_days') return 30
  return Number(currentStockholmCalendarDate(now).slice(8, 10))
}

function sourceRowsForPeriod(
  rows: DailyPreviewSourceRow[],
  referencePeriod: MarketPreviewReferencePeriod,
  now: Date,
): DailyPreviewSourceRow[] {
  const limit = requestedDays(referencePeriod, now)
  if (referencePeriod !== 'month_to_date') return rows.slice(0, limit)
  const month = currentStockholmCalendarDate(now).slice(0, 7)
  return rows.filter((row) => row.price_date.startsWith(month)).slice(0, limit)
}

function weightedAverage(rows: DailyPreviewSourceRow[]): number {
  const totalMinutes = rows.reduce(
    (sum, row) => sum + Math.max(
      0,
      numberValue(row.covered_duration_minutes) ??
        numberValue(row.expected_duration_minutes) ??
        1440,
    ),
    0,
  )
  if (totalMinutes <= 0) {
    return rows.reduce((sum, row) => sum + (numberValue(row.average_sek_per_kwh) ?? 0), 0) / rows.length
  }
  return rows.reduce((sum, row) => {
    const minutes = Math.max(
      0,
      numberValue(row.covered_duration_minutes) ??
        numberValue(row.expected_duration_minutes) ??
        1440,
    )
    return sum + (numberValue(row.average_sek_per_kwh) ?? 0) * minutes
  }, 0) / totalMinutes
}

export async function rebuildMarketPreview(input: {
  priceArea: PriceArea
  provider?: string
  referencePeriod: MarketPreviewReferencePeriod
  maxAgeMinutes?: number
  now?: Date
}): Promise<MarketPreviewBuildResult | null> {
  const provider = input.provider ?? 'elprisetjustnu'
  const now = input.now ?? new Date()
  const desiredDays = requestedDays(input.referencePeriod, now)
  const queryLimit = Math.max(35, desiredDays)
  const { data, error } = await supabaseService
    .from('spot_price_daily_summaries')
    .select('id,price_date,average_sek_per_kwh,status,source_checksum,updated_at,provider_fetched_at,verified_at,locked_at,covered_duration_minutes,expected_duration_minutes,resolution')
    .eq('source', provider)
    .eq('price_area', input.priceArea)
    .in('status', ['verified', 'locked'])
    .order('price_date', { ascending: false })
    .limit(queryLimit)
  if (error) throw error

  const eligible = ((data ?? []) as DailyPreviewSourceRow[]).filter(
    (row) => numberValue(row.average_sek_per_kwh) !== null && text(row.source_checksum) !== null,
  )
  const rows = sourceRowsForPeriod(eligible, input.referencePeriod, now)
  if (rows.length === 0) return null

  const generatedAt = now.toISOString()
  const sourceAsOf = newestEvidenceTimestamp(rows)
  const staleAfter = new Date(
    now.getTime() + Math.max(30, input.maxAgeMinutes ?? 180) * 60_000,
  ).toISOString()
  const average = weightedAverage(rows)
  const periodEnd = String(rows[0].price_date)
  const periodStart = String(rows[rows.length - 1].price_date)
  const checksum = createHash('sha256')
    .update(JSON.stringify(rows.map((row) => [
      row.id,
      row.price_date,
      row.source_checksum,
      row.average_sek_per_kwh,
      row.covered_duration_minutes,
      row.expected_duration_minutes,
    ])))
    .digest('hex')
  const fallbackUsed = rows.length < desiredDays
  const sourceResolution = Array.from(new Set(rows.map((row) => text(row.resolution)).filter(Boolean))).join(',') || 'daily'

  const { data: result, error: publishError } = await supabaseService.rpc(
    'gridex_publish_market_price_preview_v2',
    {
      p_provider: provider,
      p_price_area: input.priceArea,
      p_reference_period: input.referencePeriod,
      p_period_start: periodStart,
      p_period_end: periodEnd,
      p_source_as_of: sourceAsOf,
      p_generated_at: generatedAt,
      p_price_sek_per_kwh: average,
      p_stale_after: staleAfter,
      p_requested_days: desiredDays,
      p_included_days: rows.length,
      p_fallback_used: fallbackUsed,
      p_fallback_reason: fallbackUsed ? 'partial_reference_window' : null,
      p_source_summary_ids: rows.map((row) => row.id),
      p_source_checksum: checksum,
      p_source_resolution: sourceResolution,
      p_metadata: {
        requested_days: desiredDays,
        included_days: rows.length,
        duration_weighted: true,
        source_resolution: sourceResolution,
        source_as_of: sourceAsOf,
        generated_at: generatedAt,
      },
    },
  )
  if (publishError) throw publishError
  const payload = result && typeof result === 'object' && !Array.isArray(result)
    ? result as Record<string, unknown>
    : {}

  return {
    referencePeriod: input.referencePeriod,
    created: payload.created === true,
    unchanged: payload.unchanged === true,
    previewId: text(payload.preview_id),
    requestedDays: desiredDays,
    includedDays: rows.length,
    fallbackUsed,
    sourceChecksum: checksum,
  }
}

export async function rebuildMarketPreviews(input: {
  priceArea: PriceArea
  provider?: string
  maxAgeMinutes?: number
  now?: Date
}): Promise<MarketPreviewBuildResult[]> {
  const periods: MarketPreviewReferencePeriod[] = [
    'latest_complete_day',
    'rolling_7_days',
    'rolling_30_days',
    'month_to_date',
  ]
  const results: MarketPreviewBuildResult[] = []
  for (const referencePeriod of periods) {
    const result = await rebuildMarketPreview({ ...input, referencePeriod })
    if (result) results.push(result)
  }
  return results
}

/** Compatibility wrapper retained for internal callers during the V1 rollout. */
export async function rebuildRollingMarketPreview(input: {
  priceArea: PriceArea
  provider?: string
  referencePeriod?: 'rolling_7_days' | 'rolling_30_days'
  maxAgeMinutes?: number
}): Promise<{ created: boolean; previewId: string | null }> {
  const result = await rebuildMarketPreview({
    ...input,
    referencePeriod: input.referencePeriod ?? 'rolling_30_days',
  })
  return { created: result?.created ?? false, previewId: result?.previewId ?? null }
}
