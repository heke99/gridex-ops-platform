import { supabaseService } from '@/lib/supabase/service'
import { stockholmMonthBounds } from '@/lib/time/stockholm'

export type MeteringCompletenessIssue = {
  code: 'metering_values_missing' | 'metering_gap' | 'metering_overlap' | 'metering_estimated' | 'metering_total_mismatch'
  message: string
  severity: 'blocked' | 'warning'
  meteringPointId?: string | null
  details?: Record<string, unknown>
}

export type MeteringCompletenessResult = {
  billingMonth: string
  status: 'complete' | 'incomplete' | 'estimated_only' | 'no_data'
  meteringPointCount: number
  valueCount: number
  estimatedValueCount: number
  issues: MeteringCompletenessIssue[]
}

const ESTIMATED_QUALITY_STATUSES = new Set(['estimated', 'preliminary', 'temp', 'temporary', 'calculated'])
const COVERAGE_BLOCK_THRESHOLD = 0.999
const TOTAL_MISMATCH_TOLERANCE = 0.01

function schemaMissing(error: unknown): boolean {
  const code = (error as { code?: string } | null)?.code ?? ''
  const message = (error as { message?: string } | null)?.message ?? ''
  return ['42P01', '42703', 'PGRST204', 'PGRST205'].includes(code) || /does not exist|schema cache/i.test(message)
}

type NormalizedValueRow = {
  metering_point_id: string
  period_start: string
  period_end: string
  quantity_kwh: number | string | null
  quality_status: string | null
}

function toMs(value: string): number { return new Date(value).getTime() }
function chunk<T>(items: T[], size: number): T[][] {
  const output: T[][] = []
  for (let index = 0; index < items.length; index += size) output.push(items.slice(index, index + size))
  return output
}

async function loadNormalizedValues(input: { companyId: string; meteringPointIds: string[]; startIso: string; endIso: string }): Promise<NormalizedValueRow[] | null> {
  const rows: NormalizedValueRow[] = []
  for (const ids of chunk(input.meteringPointIds, 100)) {
    const { data, error } = await supabaseService
      .from('normalized_metering_values')
      .select('metering_point_id,period_start,period_end,quantity_kwh,quality_status')
      .eq('company_id', input.companyId)
      .in('metering_point_id', ids)
      .lt('period_start', input.endIso)
      .gt('period_end', input.startIso)
      .limit(50_000)
    if (error) {
      if (schemaMissing(error)) return null
      throw error
    }
    rows.push(...((data ?? []) as NormalizedValueRow[]))
  }
  return rows
}

export async function evaluateMeteringCompletenessForMonth(input: {
  companyId: string
  billingMonth: string
  meteringPoints: Array<{ meteringPointId: string; expectedKwh?: number | null }>
  allowEstimatedValues?: boolean
}): Promise<MeteringCompletenessResult> {
  const bounds = stockholmMonthBounds(input.billingMonth)
  const window = { startMs: toMs(bounds.start), endMs: toMs(bounds.end), startIso: bounds.start, endIso: bounds.end }
  const issues: MeteringCompletenessIssue[] = []
  const meteringPointIds = Array.from(new Set(input.meteringPoints.map((entry) => entry.meteringPointId).filter(Boolean)))
  if (meteringPointIds.length === 0) return { billingMonth: input.billingMonth, status: 'no_data', meteringPointCount: 0, valueCount: 0, estimatedValueCount: 0, issues: [] }

  const rows = await loadNormalizedValues({ companyId: input.companyId, meteringPointIds, startIso: window.startIso, endIso: window.endIso })
  if (rows === null) {
    return { billingMonth: input.billingMonth, status: 'no_data', meteringPointCount: meteringPointIds.length, valueCount: 0, estimatedValueCount: 0, issues: [{ code: 'metering_values_missing', message: 'Normaliserade mätvärden kan inte läsas (tabell saknas). Kör senaste migrationen.', severity: 'warning' }] }
  }

  const byMeteringPoint = new Map<string, NormalizedValueRow[]>()
  for (const row of rows) {
    const list = byMeteringPoint.get(row.metering_point_id) ?? []
    list.push(row)
    byMeteringPoint.set(row.metering_point_id, list)
  }

  let estimatedValueCount = 0
  for (const entry of input.meteringPoints) {
    const pointRows = byMeteringPoint.get(entry.meteringPointId) ?? []
    if (pointRows.length === 0) {
      issues.push({ code: 'metering_values_missing', message: 'Inga normaliserade mätvärden finns för mätpunkten i fakturaperioden.', severity: 'blocked', meteringPointId: entry.meteringPointId })
      continue
    }
    const intervals = pointRows.map((row) => ({
      start: Math.max(toMs(row.period_start), window.startMs),
      end: Math.min(toMs(row.period_end), window.endMs),
      estimated: ESTIMATED_QUALITY_STATUSES.has(String(row.quality_status ?? '').toLowerCase()),
      quantity: typeof row.quantity_kwh === 'string' ? Number(row.quantity_kwh) : row.quantity_kwh,
    })).filter((interval) => Number.isFinite(interval.start) && Number.isFinite(interval.end) && interval.end > interval.start).sort((a, b) => a.start - b.start)

    let coveredMs = 0
    let overlapMs = 0
    let cursor = window.startMs
    for (const interval of intervals) {
      if (interval.estimated) estimatedValueCount += 1
      if (interval.start < cursor) overlapMs += Math.min(cursor, interval.end) - interval.start
      const effectiveStart = Math.max(interval.start, cursor)
      if (interval.end > effectiveStart) { coveredMs += interval.end - effectiveStart; cursor = interval.end }
    }
    const windowMs = window.endMs - window.startMs
    const coverage = coveredMs / windowMs
    if (overlapMs > 0) issues.push({ code: 'metering_overlap', message: `Mätvärden överlappar varandra (${Math.round(overlapMs / 3_600_000)} h dubbeltäckning) och riskerar dubbelfakturering.`, severity: 'blocked', meteringPointId: entry.meteringPointId, details: { overlap_hours: overlapMs / 3_600_000 } })
    if (coverage < COVERAGE_BLOCK_THRESHOLD) issues.push({ code: 'metering_gap', message: `Mätvärden täcker bara ${(coverage * 100).toFixed(1)} % av perioden (${Math.round((windowMs - coveredMs) / 3_600_000)} h saknas).`, severity: 'blocked', meteringPointId: entry.meteringPointId, details: { coverage_percent: coverage * 100, missing_hours: (windowMs - coveredMs) / 3_600_000, time_zone: bounds.timeZone } })
    const estimatedForPoint = intervals.filter((interval) => interval.estimated).length
    if (estimatedForPoint > 0) issues.push({ code: 'metering_estimated', message: `${estimatedForPoint} mätvärde(n) är preliminära/estimerade. Slutfaktura kräver slutliga värden.`, severity: input.allowEstimatedValues ? 'warning' : 'blocked', meteringPointId: entry.meteringPointId, details: { estimated_count: estimatedForPoint } })
    const expectedKwh = typeof entry.expectedKwh === 'number' && Number.isFinite(entry.expectedKwh) ? entry.expectedKwh : null
    if (expectedKwh !== null && expectedKwh > 0) {
      const actualKwh = intervals.reduce((sum, interval) => sum + (typeof interval.quantity === 'number' && Number.isFinite(interval.quantity) ? interval.quantity : 0), 0)
      const difference = Math.abs(actualKwh - expectedKwh)
      if (difference > Math.max(expectedKwh * TOTAL_MISMATCH_TOLERANCE, 1)) issues.push({ code: 'metering_total_mismatch', message: `Summan av mätvärden (${actualKwh.toFixed(1)} kWh) avviker från underlagets kWh (${expectedKwh.toFixed(1)} kWh).`, severity: 'warning', meteringPointId: entry.meteringPointId, details: { actual_kwh: actualKwh, expected_kwh: expectedKwh } })
    }
  }

  const hasBlockingIssues = issues.some((issue) => issue.severity === 'blocked')
  const status: MeteringCompletenessResult['status'] = rows.length === 0 ? 'no_data' : hasBlockingIssues ? (issues.every((issue) => issue.code === 'metering_estimated') ? 'estimated_only' : 'incomplete') : 'complete'
  return { billingMonth: input.billingMonth, status, meteringPointCount: meteringPointIds.length, valueCount: rows.length, estimatedValueCount, issues }
}

export async function companyAllowsEstimatedMeteringValues(companyId: string): Promise<boolean> {
  try {
    const { data, error } = await supabaseService.from('companies').select('metadata').eq('id', companyId).maybeSingle()
    if (error || !data) return false
    const metadata = (data as { metadata?: Record<string, unknown> | null }).metadata
    if (!metadata || typeof metadata !== 'object') return false
    const billing = (metadata as Record<string, unknown>).billing
    if (billing && typeof billing === 'object' && !Array.isArray(billing)) return (billing as Record<string, unknown>).allow_estimated_metering_values === true
    return (metadata as Record<string, unknown>).allow_estimated_metering_values === true
  } catch { return false }
}
