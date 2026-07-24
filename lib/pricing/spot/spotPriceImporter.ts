import { createHash } from 'node:crypto'
import { supabaseService } from '@/lib/supabase/service'
import { PRICE_AREAS, isPriceArea, type PriceArea, type SpotPriceInterval } from '@/lib/pricing/types'
import { fetchElprisetJustNuDay, SpotPriceProviderError } from '@/lib/pricing/spot/elprisetJustNuClient'
import { aggregateMonthlySpotPrices } from '@/lib/pricing/spot/monthlySpotAggregator'
import { validateSpotPriceDay } from '@/lib/pricing/spot/intervalCoverage'
import { claimSpotImportJob, completeSpotImportJob, failSpotImportJob } from '@/lib/pricing/spot/spotImportJobs'
import { rebuildMarketPreviews } from '@/lib/pricing/spot/marketPreviewBuilder'
import { stockholmMonthBounds } from '@/lib/time/stockholm'

const PROVIDER = 'elprisetjustnu'

function monthDates(billingMonth: string): string[] {
  if (!/^\d{4}-\d{2}$/.test(billingMonth)) throw new Error('Fakturamånad måste anges som YYYY-MM.')
  const [yearRaw, monthRaw] = billingMonth.split('-')
  const year = Number(yearRaw)
  const month = Number(monthRaw)
  const days = new Date(Date.UTC(year, month, 0)).getUTCDate()
  return Array.from({ length: days }, (_, index) => `${yearRaw}-${monthRaw}-${String(index + 1).padStart(2, '0')}`)
}

function checksum(value: string): string {
  return createHash('sha256').update(value).digest('hex')
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

function rowToInterval(row: Record<string, unknown>): SpotPriceInterval {
  return {
    source: String(row.source),
    priceArea: String(row.price_area) as PriceArea,
    timeStart: String(row.time_start),
    timeEnd: String(row.time_end),
    sekPerKwh: Number(row.sek_per_kwh),
    eurPerKwh: row.eur_per_kwh === null ? null : Number(row.eur_per_kwh),
    exchangeRate: row.exchange_rate === null ? null : Number(row.exchange_rate),
    resolution: String(row.resolution) as SpotPriceInterval['resolution'],
    sourcePayload: {},
  }
}

async function emitMarketEvent(input: {
  eventType: string
  correlationId: string
  payload: Record<string, unknown>
}): Promise<void> {
  const { error } = await supabaseService.from('canonical_energy_flow_events').insert({
    event_type: input.eventType,
    correlation_id: input.correlationId,
    source: PROVIDER,
    payload_version: '1',
    payload: input.payload,
    actor_type: 'system',
  })
  if (error) console.error('[spot-price-import] audit_event_failed', { eventType: input.eventType, error })
}


async function verifyStoredCompleteDay(input: {
  calendarDate: string
  priceArea: PriceArea
}): Promise<{ verified: boolean; intervalCount: number; checksum: string | null }> {
  const { data: summary, error: summaryError } = await supabaseService
    .from('spot_price_daily_summaries')
    .select('status,source_checksum,interval_count')
    .eq('source', PROVIDER)
    .eq('price_area', input.priceArea)
    .eq('price_date', input.calendarDate)
    .maybeSingle()
  if (summaryError) throw summaryError
  if (summary?.status === 'verified' || summary?.status === 'locked') {
    return {
      verified: true,
      intervalCount: Number(summary.interval_count ?? 0),
      checksum: typeof summary.source_checksum === 'string' ? summary.source_checksum : null,
    }
  }
  if (summary?.status !== 'complete') return { verified: false, intervalCount: 0, checksum: null }

  const emptyCoverage = validateSpotPriceDay({
    calendarDate: input.calendarDate,
    priceArea: input.priceArea,
    intervals: [],
  })
  const { data: stored, error: intervalError } = await supabaseService
    .from('spot_price_intervals')
    .select('source,price_area,time_start,time_end,sek_per_kwh,eur_per_kwh,exchange_rate,resolution')
    .eq('source', PROVIDER)
    .eq('price_area', input.priceArea)
    .gte('time_start', emptyCoverage.periodStart)
    .lt('time_start', emptyCoverage.periodEnd)
    .order('time_start', { ascending: true })
  if (intervalError) throw intervalError

  const intervals = ((stored ?? []) as Array<Record<string, unknown>>).map(rowToInterval)
  const coverage = validateSpotPriceDay({
    calendarDate: input.calendarDate,
    priceArea: input.priceArea,
    intervals,
  })
  if (coverage.status !== 'complete') return { verified: false, intervalCount: intervals.length, checksum: null }

  const sourceChecksum = checksum(coverage.sourceChecksumInput)
  const verifiedAt = new Date().toISOString()
  const { error: updateError } = await supabaseService
    .from('spot_price_daily_summaries')
    .update({
      period_start: coverage.periodStart,
      period_end: coverage.periodEnd,
      average_sek_per_kwh: coverage.averageSekPerKwh,
      min_sek_per_kwh: coverage.minSekPerKwh,
      max_sek_per_kwh: coverage.maxSekPerKwh,
      interval_count: coverage.intervalCount,
      expected_interval_count: coverage.expectedIntervalCount,
      covered_duration_minutes: coverage.coveredDurationMinutes,
      expected_duration_minutes: coverage.expectedDurationMinutes,
      resolution: coverage.resolution,
      quality_issues: [],
      verified_at: verifiedAt,
      status: 'verified',
      source_checksum: sourceChecksum,
      updated_at: verifiedAt,
    })
    .eq('source', PROVIDER)
    .eq('price_area', input.priceArea)
    .eq('price_date', input.calendarDate)
    .eq('status', 'complete')
  if (updateError) throw updateError

  return { verified: true, intervalCount: coverage.intervalCount, checksum: sourceChecksum }
}

export async function importSpotPricesForDayArea(input: {
  calendarDate: string
  priceArea: PriceArea
  fetchImpl?: typeof fetch
  force?: boolean
}): Promise<{ imported: number; status: string; error?: string }> {
  if (input.force !== true) {
    const stored = await verifyStoredCompleteDay({
      calendarDate: input.calendarDate,
      priceArea: input.priceArea,
    })
    if (stored.verified) {
      return { imported: 0, status: 'verified' }
    }
  }

  const job = await claimSpotImportJob({
    provider: PROVIDER,
    priceArea: input.priceArea,
    calendarDate: input.calendarDate,
    force: input.force ?? false,
  })
  if (!job.claimed) return { imported: 0, status: job.status }

  const started = Date.now()
  await emitMarketEvent({
    eventType: 'market_price.import.started',
    correlationId: job.correlationId,
    payload: { provider: PROVIDER, price_area: input.priceArea, calendar_date: input.calendarDate, attempt_count: job.attemptCount },
  })

  try {
    const { data: existing, error: existingError } = await supabaseService
      .from('spot_price_daily_summaries')
      .select('status,source_checksum')
      .eq('source', PROVIDER)
      .eq('price_area', input.priceArea)
      .eq('price_date', input.calendarDate)
      .maybeSingle()
    if (existingError) throw existingError
    if (existing?.status === 'locked') {
      await completeSpotImportJob({
        jobId: job.id,
        checksum: String(existing.source_checksum ?? ''),
        resultSummary: { skipped: true, reason: 'locked_day_immutable' },
      })
      return { imported: 0, status: 'completed' }
    }

    const intervals = await fetchElprisetJustNuDay({
      date: input.calendarDate,
      priceArea: input.priceArea,
      fetchImpl: input.fetchImpl,
    })
    const coverage = validateSpotPriceDay({
      calendarDate: input.calendarDate,
      priceArea: input.priceArea,
      intervals,
    })
    const sourceChecksum = checksum(coverage.sourceChecksumInput)
    const fetchedAt = new Date().toISOString()

    if (intervals.length > 0) {
      const { error: intervalError } = await supabaseService
        .from('spot_price_intervals')
        .upsert(intervals.map(toIntervalRow), { onConflict: 'source,price_area,time_start,time_end' })
      if (intervalError) throw intervalError
    }

    const dailyStatus = coverage.status === 'complete' ? 'verified' : 'incomplete'
    const { error: dailyError } = await supabaseService.from('spot_price_daily_summaries').upsert({
      source: PROVIDER,
      price_area: input.priceArea,
      price_date: input.calendarDate,
      period_start: coverage.periodStart,
      period_end: coverage.periodEnd,
      average_sek_per_kwh: coverage.averageSekPerKwh,
      min_sek_per_kwh: coverage.minSekPerKwh,
      max_sek_per_kwh: coverage.maxSekPerKwh,
      interval_count: coverage.intervalCount,
      expected_interval_count: coverage.expectedIntervalCount,
      covered_duration_minutes: coverage.coveredDurationMinutes,
      expected_duration_minutes: coverage.expectedDurationMinutes,
      resolution: coverage.resolution,
      quality_issues: coverage.issues,
      provider_fetched_at: fetchedAt,
      verified_at: dailyStatus === 'verified' ? fetchedAt : null,
      status: dailyStatus,
      source_checksum: sourceChecksum,
      updated_at: fetchedAt,
    }, { onConflict: 'source,price_area,price_date' })
    if (dailyError) throw dailyError

    if (coverage.status !== 'complete') {
      const message = `Ofullständig intervalldata: ${coverage.issues.map((issue) => issue.code).join(', ') || 'okänd kvalitetsbrist'}`
      await failSpotImportJob({
        jobId: job.id,
        errorCode: 'market_price_incomplete',
        message,
        retryable: true,
        attemptCount: job.attemptCount,
      })
      await emitMarketEvent({
        eventType: 'market_price.import.failed',
        correlationId: job.correlationId,
        payload: { provider: PROVIDER, price_area: input.priceArea, calendar_date: input.calendarDate, error_code: 'market_price_incomplete', quality_issues: coverage.issues },
      })
      return { imported: intervals.length, status: 'incomplete', error: message }
    }

    await completeSpotImportJob({
      jobId: job.id,
      checksum: sourceChecksum,
      resultSummary: {
        interval_count: coverage.intervalCount,
        expected_interval_count: coverage.expectedIntervalCount,
        covered_duration_minutes: coverage.coveredDurationMinutes,
        expected_duration_minutes: coverage.expectedDurationMinutes,
        provider_latency_ms: Date.now() - started,
      },
    })
    await emitMarketEvent({
      eventType: 'market_price.import.completed',
      correlationId: job.correlationId,
      payload: { provider: PROVIDER, price_area: input.priceArea, calendar_date: input.calendarDate, source_checksum: sourceChecksum, interval_count: intervals.length, provider_latency_ms: Date.now() - started },
    })
    await emitMarketEvent({
      eventType: 'market_price.day.completed',
      correlationId: job.correlationId,
      payload: { provider: PROVIDER, price_area: input.priceArea, calendar_date: input.calendarDate, source_checksum: sourceChecksum, interval_count: intervals.length },
    })
    await emitMarketEvent({
      eventType: 'market_price.period.verified',
      correlationId: job.correlationId,
      payload: { provider: PROVIDER, price_area: input.priceArea, calendar_date: input.calendarDate, verified_at: fetchedAt },
    })
    console.info('[spot-price-import] completed', {
      provider: PROVIDER,
      priceArea: input.priceArea,
      calendarDate: input.calendarDate,
      intervalCount: intervals.length,
      latencyMs: Date.now() - started,
      correlationId: job.correlationId,
    })
    return { imported: intervals.length, status: 'verified' }
  } catch (error) {
    const providerError = error instanceof SpotPriceProviderError ? error : null
    const message = error instanceof Error ? error.message : 'Okänt importfel'
    const errorCode = providerError?.code ?? 'market_price_import_failed'
    const providerNotPublished = errorCode === 'provider_not_published'
    const status = await failSpotImportJob({
      jobId: job.id,
      errorCode,
      message,
      retryable: providerNotPublished ? true : (providerError?.retryable ?? true),
      attemptCount: job.attemptCount,
      retryAfterMs: providerNotPublished ? 60 * 60_000 : providerError?.retryAfterMs,
    })
    await emitMarketEvent({
      eventType: 'market_price.import.failed',
      correlationId: job.correlationId,
      payload: { provider: PROVIDER, price_area: input.priceArea, calendar_date: input.calendarDate, error_code: errorCode, retryable: providerNotPublished ? true : (providerError?.retryable ?? true) },
    })
    console.error('[spot-price-import] failed', {
      provider: PROVIDER,
      priceArea: input.priceArea,
      calendarDate: input.calendarDate,
      errorCode,
      status,
      latencyMs: Date.now() - started,
      correlationId: job.correlationId,
    })
    return { imported: 0, status, error: message }
  }
}

async function aggregateMonth(priceArea: PriceArea, billingMonth: string): Promise<{ imported: number; status: string }> {
  const bounds = stockholmMonthBounds(billingMonth)
  const { data, error } = await supabaseService
    .from('spot_price_intervals')
    .select('source,price_area,time_start,time_end,sek_per_kwh,eur_per_kwh,exchange_rate,resolution')
    .eq('source', PROVIDER)
    .eq('price_area', priceArea)
    .gte('time_start', bounds.start)
    .lt('time_start', bounds.end)
    .order('time_start', { ascending: true })
  if (error) throw error
  const intervals = ((data ?? []) as Array<Record<string, unknown>>).map(rowToInterval)
  if (intervals.length === 0) return { imported: 0, status: 'incomplete' }

  const summary = aggregateMonthlySpotPrices({ priceArea, billingMonth, intervals })
  const now = new Date().toISOString()
  const sourceChecksum = checksum(JSON.stringify(intervals.map((row) => [row.timeStart, row.timeEnd, row.sekPerKwh])))
  const verified = summary.status === 'complete'
  const { error: summaryError } = await supabaseService.from('spot_price_monthly_summaries').upsert({
    source: summary.source,
    price_area: summary.priceArea,
    billing_month: summary.billingMonth,
    period_start: bounds.start,
    period_end: bounds.end,
    average_sek_per_kwh: summary.averageSekPerKwh,
    min_sek_per_kwh: summary.minSekPerKwh,
    max_sek_per_kwh: summary.maxSekPerKwh,
    interval_count: summary.intervalCount,
    expected_interval_count: summary.expectedIntervalCount,
    covered_duration_minutes: verified ? (Date.parse(bounds.end) - Date.parse(bounds.start)) / 60_000 : null,
    expected_duration_minutes: (Date.parse(bounds.end) - Date.parse(bounds.start)) / 60_000,
    quality_issues: verified ? [] : [{ code: 'incomplete_month_coverage' }],
    provider_fetched_at: now,
    verified_at: verified ? now : null,
    status: verified ? 'verified' : 'incomplete',
    source_checksum: sourceChecksum,
    updated_at: now,
  }, { onConflict: 'source,price_area,billing_month' })
  if (summaryError) throw summaryError
  return { imported: intervals.length, status: verified ? 'verified' : 'incomplete' }
}

export async function importSpotPricesForDay(input: {
  calendarDate: string
  priceAreas?: PriceArea[]
  fetchImpl?: typeof fetch
  force?: boolean
}) {
  const priceAreas = input.priceAreas?.length ? input.priceAreas : PRICE_AREAS
  for (const area of priceAreas) if (!isPriceArea(area)) throw new Error(`Ogiltigt elområde: ${area}`)

  const result: Record<PriceArea, { imported: number; status: string; error?: string }> = {} as Record<PriceArea, { imported: number; status: string; error?: string }>
  const errors: string[] = []
  for (const priceArea of priceAreas) {
    const day = await importSpotPricesForDayArea({
      calendarDate: input.calendarDate,
      priceArea,
      fetchImpl: input.fetchImpl,
      force: input.force ?? false,
    })
    result[priceArea] = day
    if (day.error) errors.push(`${priceArea} ${input.calendarDate}: ${day.error}`)
    if (day.status === 'verified' || day.status === 'completed') {
      try {
        await rebuildMarketPreviews({ priceArea, provider: PROVIDER })
      } catch (error) {
        errors.push(`${priceArea} preview: ${error instanceof Error ? error.message : 'kunde inte byggas'}`)
      }
    }
  }
  return {
    calendarDate: input.calendarDate,
    status: errors.length > 0 ? 'completed_with_warnings' as const : 'completed' as const,
    result,
    errors,
  }
}

export async function importSpotPricesForMonth(input: {
  billingMonth: string
  priceAreas?: PriceArea[]
  createdBy?: string | null
  fetchImpl?: typeof fetch
  force?: boolean
  triggerSource?: 'manual' | 'cron' | 'pricing_preview' | 'billing_underlay' | 'manual_retry'
}) {
  const priceAreas = input.priceAreas?.length ? input.priceAreas : PRICE_AREAS
  for (const area of priceAreas) if (!isPriceArea(area)) throw new Error(`Ogiltigt elområde: ${area}`)

  const startedAt = new Date().toISOString()
  const { data: run, error: runError } = await supabaseService
    .from('spot_price_import_runs')
    .insert({
      source: PROVIDER,
      billing_month: input.billingMonth,
      price_areas: priceAreas,
      status: 'running',
      started_at: startedAt,
      created_by: input.createdBy ?? null,
      trigger_source: input.triggerSource ?? 'manual',
      requested_by: input.triggerSource ?? 'manual',
      metadata: { canonical_jobs: true, automatic: input.triggerSource === 'cron' || input.triggerSource === 'pricing_preview' || input.triggerSource === 'billing_underlay' },
    })
    .select('id')
    .single()
  if (runError) throw runError

  const result: Record<PriceArea, { imported: number; status: string }> = {} as Record<PriceArea, { imported: number; status: string }>
  const errors: string[] = []

  try {
    for (const priceArea of priceAreas) {
      for (const calendarDate of monthDates(input.billingMonth)) {
        const day = await importSpotPricesForDayArea({ calendarDate, priceArea, fetchImpl: input.fetchImpl, force: input.force ?? false })
        if (day.error) errors.push(`${priceArea} ${calendarDate}: ${day.error}`)
      }
      result[priceArea] = await aggregateMonth(priceArea, input.billingMonth)
      try {
        await rebuildMarketPreviews({ priceArea, provider: PROVIDER })
      } catch (error) {
        errors.push(`${priceArea} preview: ${error instanceof Error ? error.message : 'kunde inte byggas'}`)
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


function dateRange(startDate: string, endDate: string): string[] {
  const start = Date.parse(`${startDate}T00:00:00Z`)
  const end = Date.parse(`${endDate}T00:00:00Z`)
  if (!Number.isFinite(start) || !Number.isFinite(end) || end < start) {
    throw new Error('Datumintervallet måste vara giltigt och startdatum får inte ligga efter slutdatum.')
  }
  const days: string[] = []
  for (let value = start; value <= end; value += 24 * 60 * 60_000) {
    days.push(new Date(value).toISOString().slice(0, 10))
  }
  return days
}

export async function ensureSpotPriceCoverage(input: {
  startDate: string
  endDate: string
  priceAreas?: PriceArea[]
  fetchImpl?: typeof fetch
  force?: boolean
}) {
  const priceAreas = input.priceAreas?.length ? input.priceAreas : PRICE_AREAS
  const dates = dateRange(input.startDate, input.endDate)
  const { data, error } = await supabaseService
    .from('spot_price_daily_summaries')
    .select('price_area,price_date,status')
    .eq('source', PROVIDER)
    .in('price_area', priceAreas)
    .gte('price_date', input.startDate)
    .lte('price_date', input.endDate)
  if (error) throw error

  const statusByKey = new Map<string, string>()
  for (const row of (data ?? []) as Array<Record<string, unknown>>) {
    statusByKey.set(`${String(row.price_area)}:${String(row.price_date)}`, String(row.status))
  }

  const report: Record<string, unknown> = {
    provider: PROVIDER,
    start_date: input.startDate,
    end_date: input.endDate,
    imported: [],
    already_verified: [],
    failed: [],
    previews: {},
  }

  for (const priceArea of priceAreas) {
    for (const calendarDate of dates) {
      const currentStatus = statusByKey.get(`${priceArea}:${calendarDate}`)
      if (!input.force && (currentStatus === 'verified' || currentStatus === 'locked')) {
        ;(report.already_verified as unknown[]).push({ price_area: priceArea, calendar_date: calendarDate, status: currentStatus })
        continue
      }
      const result = await importSpotPricesForDayArea({
        calendarDate,
        priceArea,
        fetchImpl: input.fetchImpl,
        force: input.force === true || currentStatus !== 'complete',
      })
      const item = { price_area: priceArea, calendar_date: calendarDate, ...result }
      if (result.error) (report.failed as unknown[]).push(item)
      else (report.imported as unknown[]).push(item)
    }
    report.previews = {
      ...(report.previews as Record<string, unknown>),
      [priceArea]: await rebuildMarketPreviews({ priceArea, provider: PROVIDER }),
    }
  }

  return report
}
