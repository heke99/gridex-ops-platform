import { supabaseService } from '@/lib/supabase/service'
import { PRICE_AREAS, isPriceArea, type PriceArea, type SpotPriceInterval } from '@/lib/pricing/types'
import { fetchElprisetJustNuDay } from '@/lib/pricing/spot/elprisetJustNuClient'
import { aggregateMonthlySpotPrices } from '@/lib/pricing/spot/monthlySpotAggregator'

function monthDates(billingMonth: string): string[] {
  if (!/^\d{4}-\d{2}$/.test(billingMonth)) throw new Error('Fakturamånad måste anges som YYYY-MM.')
  const [yearRaw, monthRaw] = billingMonth.split('-')
  const year = Number(yearRaw)
  const month = Number(monthRaw)
  const days = new Date(Date.UTC(year, month, 0)).getUTCDate()
  return Array.from({ length: days }, (_, index) => `${yearRaw}-${monthRaw}-${String(index + 1).padStart(2, '0')}`)
}

function toIntervalRow(row: SpotPriceInterval) {
  return {
    source: row.source,
    price_area: row.priceArea,
    time_start: row.timeStart,
    time_end: row.timeEnd,
    sek_per_kwh: row.sekPerKwh,
    eur_per_kwh: row.eurPerKwh,
    exchange_rate: row.exchangeRate,
    resolution: row.resolution,
    source_payload: row.sourcePayload ?? {},
  }
}

export async function importSpotPricesForMonth(input: {
  billingMonth: string
  priceAreas?: PriceArea[]
  createdBy?: string | null
  fetchImpl?: typeof fetch
  triggerSource?: 'manual' | 'cron' | 'pricing_preview' | 'billing_underlay' | 'manual_retry'
}) {
  const priceAreas = input.priceAreas?.length ? input.priceAreas : PRICE_AREAS
  for (const area of priceAreas) {
    if (!isPriceArea(area)) throw new Error(`Ogiltigt elområde: ${area}`)
  }

  const startedAt = new Date().toISOString()
  const { data: run, error: runError } = await supabaseService
    .from('spot_price_import_runs')
    .insert({
      source: 'elprisetjustnu',
      billing_month: input.billingMonth,
      price_areas: priceAreas,
      status: 'running',
      started_at: startedAt,
      created_by: input.createdBy ?? null,
      trigger_source: input.triggerSource ?? 'manual',
      requested_by: input.triggerSource ?? 'manual',
      metadata: { automatic: input.triggerSource === 'cron' || input.triggerSource === 'pricing_preview' || input.triggerSource === 'billing_underlay' },
    })
    .select('id')
    .single()

  if (runError) throw runError

  const result: Record<PriceArea, { imported: number; status: string }> = {} as Record<PriceArea, { imported: number; status: string }>
  const errors: string[] = []

  try {
    for (const priceArea of priceAreas) {
      const intervals: SpotPriceInterval[] = []
      for (const date of monthDates(input.billingMonth)) {
        try {
          const day = await fetchElprisetJustNuDay({ date, priceArea, fetchImpl: input.fetchImpl })
          intervals.push(...day)
          if (day.length > 0) {
            const prices = day.map((row) => row.sekPerKwh)
            await supabaseService.from('spot_price_daily_summaries').upsert({
              source: 'elprisetjustnu',
              price_area: priceArea,
              price_date: date,
              average_sek_per_kwh: prices.reduce((sum, value) => sum + value, 0) / prices.length,
              min_sek_per_kwh: Math.min(...prices),
              max_sek_per_kwh: Math.max(...prices),
              interval_count: day.length,
              status: 'complete',
            }, { onConflict: 'source,price_area,price_date' })
          }
        } catch (error) {
          const message = error instanceof Error ? error.message : 'Okänt importfel'
          errors.push(`${priceArea} ${date}: ${message}`)
        }
      }

      if (intervals.length > 0) {
        const { error: intervalError } = await supabaseService
          .from('spot_price_intervals')
          .upsert(intervals.map(toIntervalRow), { onConflict: 'source,price_area,time_start,time_end' })
        if (intervalError) throw intervalError

        const summary = aggregateMonthlySpotPrices({ priceArea, billingMonth: input.billingMonth, intervals })
        const { error: summaryError } = await supabaseService.from('spot_price_monthly_summaries').upsert({
          source: summary.source,
          price_area: summary.priceArea,
          billing_month: summary.billingMonth,
          average_sek_per_kwh: summary.averageSekPerKwh,
          min_sek_per_kwh: summary.minSekPerKwh,
          max_sek_per_kwh: summary.maxSekPerKwh,
          interval_count: summary.intervalCount,
          expected_interval_count: summary.expectedIntervalCount,
          status: summary.status,
        }, { onConflict: 'source,price_area,billing_month' })
        if (summaryError) throw summaryError

        result[priceArea] = { imported: intervals.length, status: summary.status }
      } else {
        result[priceArea] = { imported: 0, status: 'incomplete' }
      }
    }

    const status = errors.length > 0 ? 'completed_with_warnings' : 'completed'
    await supabaseService
      .from('spot_price_import_runs')
      .update({ status, finished_at: new Date().toISOString(), result_summary: result, error_log: errors })
      .eq('id', run.id)

    return { runId: run.id as string, status, result, errors }
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Spotprisimporten misslyckades.'
    await supabaseService
      .from('spot_price_import_runs')
      .update({ status: 'failed', finished_at: new Date().toISOString(), error_log: [...errors, message] })
      .eq('id', run.id)
    throw error
  }
}
