/**
 * Idempotent service-role repair for Elpriset Just Nu daily coverage.
 *
 * Usage:
 *   SUPABASE_URL=... SUPABASE_SERVICE_ROLE_KEY=... \
 *   node --experimental-strip-types scripts/backfill-spot-price-coverage.ts \
 *     --start-date=2026-06-24 --end-date=2026-07-24 --areas=SE1,SE2,SE3,SE4
 */
import { createHash } from 'node:crypto'
import { createClient } from '@supabase/supabase-js'

type PriceArea = 'SE1' | 'SE2' | 'SE3' | 'SE4'
type ProviderRow = {
  SEK_per_kWh?: number
  EUR_per_kWh?: number
  EXR?: number
  time_start?: string
  time_end?: string
}
type Interval = {
  source: 'elprisetjustnu'
  price_area: PriceArea
  time_start: string
  time_end: string
  sek_per_kwh: number
  eur_per_kwh: number | null
  exchange_rate: number | null
  resolution: 'hourly' | 'quarter_hour'
  source_payload: ProviderRow
}

const url = process.env.SUPABASE_URL ?? process.env.NEXT_PUBLIC_SUPABASE_URL
const key = process.env.SUPABASE_SERVICE_ROLE_KEY
if (!url || !key) {
  console.error('SUPABASE_URL (eller NEXT_PUBLIC_SUPABASE_URL) och SUPABASE_SERVICE_ROLE_KEY krävs.')
  process.exit(1)
}
const supabase = createClient(url, key, { auth: { persistSession: false } })

function arg(name: string): string | null {
  const prefix = `--${name}=`
  const direct = process.argv.find((value) => value.startsWith(prefix))
  if (direct) return direct.slice(prefix.length)
  const index = process.argv.indexOf(`--${name}`)
  return index >= 0 ? process.argv[index + 1] ?? null : null
}

function strictDate(value: string | null, name: string): string {
  if (!value || !/^\d{4}-\d{2}-\d{2}$/.test(value)) throw new Error(`${name} måste anges som YYYY-MM-DD.`)
  const parsed = new Date(`${value}T00:00:00Z`)
  if (Number.isNaN(parsed.getTime()) || parsed.toISOString().slice(0, 10) !== value) throw new Error(`${name} är ogiltigt.`)
  return value
}

function dateRange(start: string, end: string): string[] {
  const first = Date.parse(`${start}T00:00:00Z`)
  const last = Date.parse(`${end}T00:00:00Z`)
  if (last < first) throw new Error('start-date får inte ligga efter end-date.')
  const result: string[] = []
  for (let value = first; value <= last; value += 86_400_000) result.push(new Date(value).toISOString().slice(0, 10))
  return result
}

function parseAreas(value: string | null): PriceArea[] {
  const raw = (value ?? 'SE1,SE2,SE3,SE4').split(',').map((item) => item.trim().toUpperCase()).filter(Boolean)
  const areas = Array.from(new Set(raw))
  for (const area of areas) if (!['SE1', 'SE2', 'SE3', 'SE4'].includes(area)) throw new Error(`Ogiltigt elområde: ${area}`)
  return areas as PriceArea[]
}

const formatter = new Intl.DateTimeFormat('sv-SE', {
  timeZone: 'Europe/Stockholm', year: 'numeric', month: '2-digit', day: '2-digit',
  hour: '2-digit', minute: '2-digit', second: '2-digit', hourCycle: 'h23',
})
function partsFor(date: Date): Record<string, number> {
  const result: Record<string, number> = {}
  for (const part of formatter.formatToParts(date)) if (part.type !== 'literal') result[part.type] = Number(part.value)
  return result
}
function offsetMs(date: Date): number {
  const parts = partsFor(date)
  return Date.UTC(parts.year, parts.month - 1, parts.day, parts.hour, parts.minute, parts.second) - date.getTime()
}
function stockholmLocalToUtc(year: number, month: number, day: number): Date {
  const base = Date.UTC(year, month - 1, day)
  let candidate = new Date(base)
  for (let attempt = 0; attempt < 3; attempt += 1) candidate = new Date(base - offsetMs(candidate))
  return candidate
}
function dayBounds(calendarDate: string): { start: number; end: number } {
  const [year, month, day] = calendarDate.split('-').map(Number)
  const next = new Date(Date.UTC(year, month - 1, day + 1))
  return {
    start: stockholmLocalToUtc(year, month, day).getTime(),
    end: stockholmLocalToUtc(next.getUTCFullYear(), next.getUTCMonth() + 1, next.getUTCDate()).getTime(),
  }
}

function providerUrl(date: string, area: PriceArea): string {
  const [year, month, day] = date.split('-')
  return `https://www.elprisetjustnu.se/api/v1/prices/${year}/${month}-${day}_${area}.json`
}

async function fetchDay(date: string, area: PriceArea): Promise<Interval[]> {
  const response = await fetch(providerUrl(date, area), { headers: { accept: 'application/json' }, cache: 'no-store' })
  if (response.status === 404) throw new Error('provider_not_published')
  if (!response.ok) throw new Error(`provider_http_${response.status}`)
  const payload: unknown = await response.json()
  if (!Array.isArray(payload)) throw new Error('invalid_provider_payload')
  return payload.map((raw, index) => {
    if (!raw || typeof raw !== 'object' || Array.isArray(raw)) throw new Error(`invalid_provider_row_${index}`)
    const row = raw as ProviderRow
    const start = Date.parse(String(row.time_start ?? ''))
    const end = Date.parse(String(row.time_end ?? ''))
    const price = Number(row.SEK_per_kWh)
    const minutes = Math.round((end - start) / 60_000)
    if (!Number.isFinite(start) || !Number.isFinite(end) || end <= start || !Number.isFinite(price)) throw new Error(`invalid_provider_row_${index}`)
    if (minutes !== 15 && minutes !== 60) throw new Error(`invalid_interval_minutes_${minutes}`)
    return {
      source: 'elprisetjustnu', price_area: area,
      time_start: new Date(start).toISOString(), time_end: new Date(end).toISOString(),
      sek_per_kwh: price,
      eur_per_kwh: Number.isFinite(Number(row.EUR_per_kWh)) ? Number(row.EUR_per_kWh) : null,
      exchange_rate: Number.isFinite(Number(row.EXR)) ? Number(row.EXR) : null,
      resolution: minutes === 15 ? 'quarter_hour' : 'hourly', source_payload: row,
    }
  })
}

function validateDay(date: string, intervals: Interval[]) {
  const bounds = dayBounds(date)
  const sorted = [...intervals].sort((a, b) => Date.parse(a.time_start) - Date.parse(b.time_start))
  const issues: Array<Record<string, unknown>> = []
  let cursor = bounds.start
  let covered = 0
  let weighted = 0
  const prices: number[] = []
  const resolutions = new Set<string>()
  for (const row of sorted) {
    const start = Date.parse(row.time_start)
    const end = Date.parse(row.time_end)
    if (start !== cursor) issues.push({ code: start > cursor ? 'gap' : 'overlap', cursor: new Date(cursor).toISOString(), actual: row.time_start })
    const effectiveStart = Math.max(start, bounds.start, cursor)
    const effectiveEnd = Math.min(end, bounds.end)
    if (effectiveEnd > effectiveStart) {
      const duration = effectiveEnd - effectiveStart
      covered += duration
      weighted += row.sek_per_kwh * duration
      prices.push(row.sek_per_kwh)
    }
    cursor = Math.max(cursor, end)
    resolutions.add(row.resolution)
  }
  if (cursor !== bounds.end) issues.push({ code: cursor < bounds.end ? 'gap' : 'outside_day', cursor: new Date(cursor).toISOString() })
  if (resolutions.size !== 1) issues.push({ code: 'mixed_resolution' })
  const expectedMinutes = (bounds.end - bounds.start) / 60_000
  const resolution = resolutions.size === 1 ? Array.from(resolutions)[0] : null
  const expectedCount = resolution === 'quarter_hour' ? expectedMinutes / 15 : resolution === 'hourly' ? expectedMinutes / 60 : null
  const complete = issues.length === 0 && covered === bounds.end - bounds.start && intervals.length === expectedCount
  return {
    periodStart: new Date(bounds.start).toISOString(), periodEnd: new Date(bounds.end).toISOString(),
    expectedMinutes, coveredMinutes: covered / 60_000, expectedCount, complete, issues,
    average: covered ? Math.round((weighted / covered) * 1_000_000) / 1_000_000 : null,
    min: prices.length ? Math.min(...prices) : null, max: prices.length ? Math.max(...prices) : null,
    resolution,
  }
}

type BackfillDayResult = {
  date: string
  area: PriceArea
  action: 'skipped' | 'promoted' | 'imported' | 'busy'
  interval_count: number
  source_checksum: string | null
}

async function claimImportJob(date: string, area: PriceArea): Promise<{ id: string; claimed: boolean }> {
  const { data, error } = await supabase.rpc('gridex_claim_spot_price_import_job', {
    p_provider: 'elprisetjustnu',
    p_price_area: area,
    p_calendar_date: date,
    p_company_id: null,
    p_force: true,
  })
  if (error) throw error
  const row = Array.isArray(data) ? data[0] : data
  if (!row) throw new Error('spot_import_job_claim_missing')
  return { id: String(row.id), claimed: row.claimed === true }
}

async function completeImportJob(jobId: string, checksum: string, result: Record<string, unknown>) {
  const completedAt = new Date().toISOString()
  const { error } = await supabase.from('spot_price_import_jobs').update({
    status: 'completed',
    completed_at: completedAt,
    next_attempt_at: null,
    last_error_code: null,
    last_error_message: null,
    source_checksum: checksum,
    result_summary: result,
    updated_at: completedAt,
  }).eq('id', jobId)
  if (error) throw error
}

async function failImportJob(jobId: string, code: string, message: string) {
  const retryable = code === 'provider_not_published' || code.startsWith('provider_http_')
  const now = new Date()
  const { error } = await supabase.from('spot_price_import_jobs').update({
    status: retryable ? 'retry_wait' : 'failed',
    completed_at: retryable ? null : now.toISOString(),
    next_attempt_at: retryable ? new Date(now.getTime() + 60 * 60_000).toISOString() : null,
    last_error_code: code,
    last_error_message: message.slice(0, 2000),
    updated_at: now.toISOString(),
  }).eq('id', jobId)
  if (error) throw error
}

async function validateStoredDay(date: string, area: PriceArea): Promise<BackfillDayResult | null> {
  const { data: summary, error: summaryError } = await supabase
    .from('spot_price_daily_summaries')
    .select('status,source_checksum,interval_count')
    .eq('source', 'elprisetjustnu')
    .eq('price_area', area)
    .eq('price_date', date)
    .maybeSingle()
  if (summaryError) throw summaryError
  if (summary?.status === 'verified' || summary?.status === 'locked') {
    return {
      date,
      area,
      action: 'skipped',
      interval_count: Number(summary.interval_count ?? 0),
      source_checksum: typeof summary.source_checksum === 'string' ? summary.source_checksum : null,
    }
  }
  if (!summary) return null

  const bounds = dayBounds(date)
  const { data: stored, error: intervalError } = await supabase
    .from('spot_price_intervals')
    .select('source,price_area,time_start,time_end,sek_per_kwh,eur_per_kwh,exchange_rate,resolution,source_payload')
    .eq('source', 'elprisetjustnu')
    .eq('price_area', area)
    .gte('time_start', new Date(bounds.start).toISOString())
    .lt('time_start', new Date(bounds.end).toISOString())
    .order('time_start', { ascending: true })
  if (intervalError) throw intervalError
  const intervals = (stored ?? []).map((row) => ({
    source: 'elprisetjustnu' as const,
    price_area: area,
    time_start: String(row.time_start),
    time_end: String(row.time_end),
    sek_per_kwh: Number(row.sek_per_kwh),
    eur_per_kwh: row.eur_per_kwh === null ? null : Number(row.eur_per_kwh),
    exchange_rate: row.exchange_rate === null ? null : Number(row.exchange_rate),
    resolution: String(row.resolution) as Interval['resolution'],
    source_payload: (row.source_payload && typeof row.source_payload === 'object' ? row.source_payload : {}) as ProviderRow,
  }))
  if (!intervals.length) return null
  const coverage = validateDay(date, intervals)
  if (!coverage.complete) return null

  const sourceChecksum = createHash('sha256')
    .update(JSON.stringify(intervals.map((row) => [row.time_start, row.time_end, row.sek_per_kwh])))
    .digest('hex')
  const verifiedAt = new Date().toISOString()
  const { error: updateError } = await supabase.from('spot_price_daily_summaries').update({
    period_start: coverage.periodStart,
    period_end: coverage.periodEnd,
    average_sek_per_kwh: coverage.average,
    min_sek_per_kwh: coverage.min,
    max_sek_per_kwh: coverage.max,
    interval_count: intervals.length,
    expected_interval_count: coverage.expectedCount,
    covered_duration_minutes: coverage.coveredMinutes,
    expected_duration_minutes: coverage.expectedMinutes,
    resolution: coverage.resolution,
    quality_issues: [],
    verified_at: verifiedAt,
    status: 'verified',
    source_checksum: sourceChecksum,
    updated_at: verifiedAt,
  }).eq('source', 'elprisetjustnu').eq('price_area', area).eq('price_date', date).neq('status', 'locked')
  if (updateError) throw updateError
  return { date, area, action: 'promoted', interval_count: intervals.length, source_checksum: sourceChecksum }
}

async function importDay(date: string, area: PriceArea): Promise<BackfillDayResult> {
  const stored = await validateStoredDay(date, area)
  if (stored) return stored

  const job = await claimImportJob(date, area)
  if (!job.claimed) return { date, area, action: 'busy', interval_count: 0, source_checksum: null }
  try {
    const intervals = await fetchDay(date, area)
    const coverage = validateDay(date, intervals)
    const sourceChecksum = createHash('sha256').update(JSON.stringify(intervals.map((row) => [row.time_start, row.time_end, row.sek_per_kwh]))).digest('hex')
    const fetchedAt = new Date().toISOString()
    const intervalResult = await supabase.from('spot_price_intervals').upsert(intervals, { onConflict: 'source,price_area,time_start,time_end' })
    if (intervalResult.error) throw intervalResult.error
    const summaryResult = await supabase.from('spot_price_daily_summaries').upsert({
      source: 'elprisetjustnu', price_area: area, price_date: date,
      period_start: coverage.periodStart, period_end: coverage.periodEnd,
      average_sek_per_kwh: coverage.average, min_sek_per_kwh: coverage.min, max_sek_per_kwh: coverage.max,
      interval_count: intervals.length, expected_interval_count: coverage.expectedCount,
      covered_duration_minutes: coverage.coveredMinutes, expected_duration_minutes: coverage.expectedMinutes,
      resolution: coverage.resolution, quality_issues: coverage.issues,
      provider_fetched_at: fetchedAt, verified_at: coverage.complete ? fetchedAt : null,
      status: coverage.complete ? 'verified' : 'incomplete', source_checksum: sourceChecksum, updated_at: fetchedAt,
    }, { onConflict: 'source,price_area,price_date' })
    if (summaryResult.error) throw summaryResult.error
    if (!coverage.complete) throw new Error(`market_price_incomplete:${JSON.stringify(coverage.issues)}`)
    await completeImportJob(job.id, sourceChecksum, {
      backfill: true,
      interval_count: intervals.length,
      expected_interval_count: coverage.expectedCount,
      covered_duration_minutes: coverage.coveredMinutes,
      expected_duration_minutes: coverage.expectedMinutes,
    })
    return { date, area, action: 'imported', interval_count: intervals.length, source_checksum: sourceChecksum }
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    const code = message === 'provider_not_published' || message.startsWith('provider_http_')
      ? message
      : message.startsWith('market_price_incomplete') ? 'market_price_incomplete' : 'market_price_backfill_failed'
    await failImportJob(job.id, code, message)
    throw error
  }
}

async function buildPreview(area: PriceArea, period: 'latest_complete_day' | 'rolling_7_days' | 'rolling_30_days') {
  const requested = period === 'latest_complete_day' ? 1 : period === 'rolling_7_days' ? 7 : 30
  const query = await supabase.from('spot_price_daily_summaries')
    .select('id,price_date,average_sek_per_kwh,source_checksum,provider_fetched_at,verified_at,updated_at,covered_duration_minutes,expected_duration_minutes,resolution')
    .eq('source', 'elprisetjustnu').eq('price_area', area).in('status', ['verified', 'locked'])
    .order('price_date', { ascending: false }).limit(requested)
  if (query.error) throw query.error
  const rows = query.data ?? []
  if (!rows.length) return null
  const totalMinutes = rows.reduce((sum, row) => sum + Number(row.covered_duration_minutes ?? row.expected_duration_minutes ?? 1440), 0)
  const price = rows.reduce((sum, row) => sum + Number(row.average_sek_per_kwh) * Number(row.covered_duration_minutes ?? row.expected_duration_minutes ?? 1440), 0) / totalMinutes
  const sourceAsOf = new Date(Math.max(...rows.map((row) => Date.parse(String(row.provider_fetched_at ?? row.verified_at ?? row.updated_at))))).toISOString()
  const generatedAt = new Date().toISOString()
  const checksum = createHash('sha256').update(JSON.stringify(rows.map((row) => [row.id, row.price_date, row.source_checksum, row.average_sek_per_kwh]))).digest('hex')
  const rpc = await supabase.rpc('gridex_publish_market_price_preview_v2', {
    p_provider: 'elprisetjustnu', p_price_area: area, p_reference_period: period,
    p_period_start: rows[rows.length - 1].price_date, p_period_end: rows[0].price_date,
    p_source_as_of: sourceAsOf, p_generated_at: generatedAt, p_price_sek_per_kwh: price,
    p_stale_after: new Date(Date.now() + 180 * 60_000).toISOString(),
    p_requested_days: requested, p_included_days: rows.length,
    p_fallback_used: rows.length < requested, p_fallback_reason: rows.length < requested ? 'partial_reference_window' : null,
    p_source_summary_ids: rows.map((row) => row.id), p_source_checksum: checksum,
    p_source_resolution: Array.from(new Set(rows.map((row) => row.resolution).filter(Boolean))).join(',') || 'daily',
    p_metadata: { requested_days: requested, included_days: rows.length, duration_weighted: true, source_as_of: sourceAsOf, generated_at: generatedAt },
  })
  if (rpc.error) throw rpc.error
  return rpc.data
}

const startDate = strictDate(arg('start-date'), 'start-date')
const endDate = strictDate(arg('end-date'), 'end-date')
const areas = parseAreas(arg('areas'))
const dates = dateRange(startDate, endDate)
const report = {
  start_date: startDate,
  end_date: endDate,
  areas,
  imported: [] as BackfillDayResult[],
  promoted: [] as BackfillDayResult[],
  skipped: [] as BackfillDayResult[],
  busy: [] as BackfillDayResult[],
  not_published: [] as unknown[],
  failed: [] as unknown[],
  previews: {} as Record<string, unknown>,
}

for (const area of areas) {
  for (const date of dates) {
    try {
      const result = await importDay(date, area)
      report[result.action].push(result)
      console.log(`[${result.action}] ${area} ${date}`)
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error)
      if (message === 'provider_not_published') report.not_published.push({ area, date, error: message })
      else report.failed.push({ area, date, error: message })
      console.error(`[failed] ${area} ${date}: ${message}`)
    }
  }
  report.previews[area] = {
    latest_complete_day: await buildPreview(area, 'latest_complete_day'),
    rolling_7_days: await buildPreview(area, 'rolling_7_days'),
    rolling_30_days: await buildPreview(area, 'rolling_30_days'),
  }
}

console.log(JSON.stringify(report, null, 2))
if (report.failed.length || report.busy.length) process.exitCode = 1
