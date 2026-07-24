import { createHash } from 'node:crypto'
import { supabaseService } from '@/lib/supabase/service'
import type { PriceArea } from '@/lib/pricing/types'

type DailyPreviewSourceRow = {
  id: string
  price_date: string
  average_sek_per_kwh: number | string | null
  status: string
  source_checksum: string | null
  updated_at: string | null
  verified_at: string | null
  locked_at: string | null
  covered_duration_minutes: number | string | null
  expected_duration_minutes: number | string | null
}

function text(value: unknown): string | null {
  return typeof value === 'string' && value.trim() ? value.trim() : null
}

function number(value: unknown): number | null {
  const parsed = typeof value === 'number' ? value : Number(value)
  return Number.isFinite(parsed) ? parsed : null
}

export async function rebuildRollingMarketPreview(input: {
  priceArea: PriceArea
  provider?: string
  referencePeriod?: 'rolling_7_days' | 'rolling_30_days'
  maxAgeMinutes?: number
}): Promise<{ created: boolean; previewId: string | null }> {
  const provider = input.provider ?? 'elprisetjustnu'
  const referencePeriod = input.referencePeriod ?? 'rolling_30_days'
  const limit = referencePeriod === 'rolling_7_days' ? 7 : 30
  const { data, error } = await supabaseService
    .from('spot_price_daily_summaries')
    .select('id,price_date,average_sek_per_kwh,status,source_checksum,updated_at,verified_at,locked_at,covered_duration_minutes,expected_duration_minutes')
    .eq('source', provider)
    .eq('price_area', input.priceArea)
    .in('status', ['verified', 'locked'])
    .order('price_date', { ascending: false })
    .limit(limit)
  if (error) throw error
  const rows = ((data ?? []) as DailyPreviewSourceRow[]).filter(
    (row) => number(row.average_sek_per_kwh) !== null,
  )
  if (rows.length === 0) return { created: false, previewId: null }

  const asOf = new Date().toISOString()
  const staleAfter = new Date(Date.now() + Math.max(30, input.maxAgeMinutes ?? 180) * 60_000).toISOString()
  const totalMinutes = rows.reduce((sum, row) => sum + Math.max(0, number(row.covered_duration_minutes) ?? number(row.expected_duration_minutes) ?? 1440), 0)
  const average = totalMinutes > 0
    ? rows.reduce((sum, row) => {
        const minutes = Math.max(0, number(row.covered_duration_minutes) ?? number(row.expected_duration_minutes) ?? 1440)
        return sum + (number(row.average_sek_per_kwh) ?? 0) * minutes
      }, 0) / totalMinutes
    : rows.reduce((sum, row) => sum + (number(row.average_sek_per_kwh) ?? 0), 0) / rows.length
  const periodEnd = String(rows[0].price_date)
  const periodStart = String(rows[rows.length - 1].price_date)
  const checksum = createHash('sha256')
    .update(JSON.stringify(rows.map((row) => [row.id, row.source_checksum, row.average_sek_per_kwh])))
    .digest('hex')

  const { data: previewId, error: publishError } = await supabaseService.rpc('gridex_publish_market_price_preview', {
    p_provider: provider,
    p_price_area: input.priceArea,
    p_reference_period: referencePeriod,
    p_period_start: periodStart,
    p_period_end: periodEnd,
    p_as_of: asOf,
    p_price_sek_per_kwh: average,
    p_stale_after: staleAfter,
    p_fallback_used: rows.length < limit,
    p_fallback_reason: rows.length < limit ? 'partial_reference_window' : null,
    p_source_summary_ids: rows.map((row) => row.id),
    p_source_checksum: checksum,
    p_metadata: { requested_days: limit, included_days: rows.length, duration_weighted: true },
  })
  if (publishError) throw publishError
  return { created: true, previewId: text(previewId) }
}
