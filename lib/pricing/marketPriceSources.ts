import { supabaseService } from '@/lib/supabase/service'

export type MarketPriceSourcePolicy = {
  sourceKey: string
  priority: number
  maxAgeMinutes: number
  allowIndicativeLatest: boolean
  supportedResolutions: string[]
  priceAreas: string[]
  forecastPolicy: 'latest_available_indication' | 'require_forecast' | 'disabled'
  portfolioPolicy: 'require_locked_period_price' | 'indicative_until_locked' | 'disabled'
}

function forecastPolicy(value: unknown): MarketPriceSourcePolicy['forecastPolicy'] {
  return value === 'require_forecast' || value === 'disabled'
    ? value
    : 'latest_available_indication'
}

function portfolioPolicy(value: unknown): MarketPriceSourcePolicy['portfolioPolicy'] {
  return value === 'indicative_until_locked' || value === 'disabled'
    ? value
    : 'require_locked_period_price'
}

export async function loadMarketPriceSourcePolicies(companyId: string): Promise<MarketPriceSourcePolicy[]> {
  const { data, error } = await supabaseService
    .from('company_market_price_sources')
    .select('source_key,priority,max_age_minutes,allow_indicative_latest,supported_resolutions,price_areas,forecast_policy,portfolio_policy')
    .eq('company_id', companyId)
    .eq('enabled', true)
    .order('priority', { ascending: true })
  if (error) throw error
  const rows = (data ?? []) as Array<Record<string, unknown>>
  return rows.map((row) => ({
    sourceKey: String(row.source_key),
    priority: Number(row.priority ?? 100),
    maxAgeMinutes: Number(row.max_age_minutes ?? 180),
    allowIndicativeLatest: row.allow_indicative_latest === true,
    supportedResolutions: Array.isArray(row.supported_resolutions) ? row.supported_resolutions.map(String) : [],
    priceAreas: Array.isArray(row.price_areas) ? row.price_areas.map((area) => String(area).toUpperCase()) : ['SE1', 'SE2', 'SE3', 'SE4'],
    forecastPolicy: forecastPolicy(row.forecast_policy),
    portfolioPolicy: portfolioPolicy(row.portfolio_policy),
  }))
}

export type MarketPriceSelectionOptions = {
  requiredResolution?: string
  priceArea?: string
  enforceFreshness?: boolean
  now?: Date
  allowStaleLocked?: boolean
  dataKind?: 'preview' | 'historical_period' | 'settlement'
}

export function policySupports(input: {
  policy: MarketPriceSourcePolicy
  priceArea?: string | null
  resolution?: string | null
}): boolean {
  if (input.priceArea && !input.policy.priceAreas.includes(input.priceArea.toUpperCase())) return false
  if (input.resolution && !input.policy.supportedResolutions.includes(input.resolution)) return false
  return true
}

export function selectMarketPriceRow<T extends Record<string, unknown>>(
  rows: T[],
  policies: MarketPriceSourcePolicy[],
  options: MarketPriceSelectionOptions = {},
): T | null {
  const policyBySource = new Map(policies.map((policy) => [policy.sourceKey, policy]))
  const nowMs = (options.now ?? new Date()).getTime()
  const eligible = rows.filter((row) => {
    const policy = policyBySource.get(String(row.source))
    if (!policy) return false
    if (!policySupports({ policy, priceArea: options.priceArea, resolution: options.requiredResolution })) return false
    if (options.dataKind === 'settlement') {
      if (row.status !== 'locked' || row.is_indicative === true) return false
      const periodStart = Date.parse(String(row.period_start ?? ''))
      const periodEnd = Date.parse(String(row.period_end ?? ''))
      const verifiedAt = Date.parse(String(row.verified_at ?? ''))
      const lockedAt = Date.parse(String(row.locked_at ?? ''))
      const coveredMinutes = Number(row.covered_duration_minutes)
      const expectedMinutes = Number(row.expected_duration_minutes)
      const qualityIssues = Array.isArray(row.quality_issues) ? row.quality_issues : null
      const sourceChecksum = typeof row.source_checksum === 'string' ? row.source_checksum.trim() : ''
      if (
        !Number.isFinite(periodStart) || !Number.isFinite(periodEnd) || periodEnd <= periodStart ||
        !Number.isFinite(verifiedAt) || !Number.isFinite(lockedAt) || lockedAt < verifiedAt ||
        !Number.isFinite(coveredMinutes) || !Number.isFinite(expectedMinutes) ||
        coveredMinutes !== expectedMinutes || qualityIssues === null || qualityIssues.length > 0 ||
        !sourceChecksum
      ) return false
    }
    if (options.dataKind === 'historical_period' && !['verified', 'locked'].includes(String(row.status))) return false
    // Locked evidence is immutable historical/final input. Non-locked market
    // evidence must be fresh enough for the tenant's configured policy.
    const historicalFinal = options.dataKind === 'settlement' || options.dataKind === 'historical_period'
    if (options.enforceFreshness && row.status !== 'locked' && !historicalFinal) {
      const timestampMs = Date.parse(String(row.updated_at ?? row.created_at ?? ''))
      if (!Number.isFinite(timestampMs)) return false
      const ageMinutes = Math.max(0, nowMs - timestampMs) / 60_000
      if (ageMinutes > policy.maxAgeMinutes) return false
    }
    return true
  })
  return eligible.sort((a, b) => {
    const aPolicy = policyBySource.get(String(a.source))
    const bPolicy = policyBySource.get(String(b.source))
    const priority = (aPolicy?.priority ?? Number.MAX_SAFE_INTEGER) - (bPolicy?.priority ?? Number.MAX_SAFE_INTEGER)
    if (priority !== 0) return priority
    const aLocked = a.status === 'locked' ? 0 : 1
    const bLocked = b.status === 'locked' ? 0 : 1
    if (aLocked !== bLocked) return aLocked - bLocked
    return Date.parse(String(b.updated_at ?? b.created_at ?? 0)) - Date.parse(String(a.updated_at ?? a.created_at ?? 0))
  })[0] ?? null
}

export type MarketPricePreviewSelection<T extends Record<string, unknown>> = {
  row: T
  policy: MarketPriceSourcePolicy
  effectiveStaleAt: string | null
  isStale: boolean
  requestedDays: number | null
  includedDays: number | null
  windowComplete: boolean
}

function previewNumber(value: unknown): number | null {
  const parsed = typeof value === 'number' ? value : Number(value)
  return Number.isFinite(parsed) ? parsed : null
}

function previewMetadata(row: Record<string, unknown>): Record<string, unknown> {
  return row.metadata && typeof row.metadata === 'object' && !Array.isArray(row.metadata)
    ? row.metadata as Record<string, unknown>
    : {}
}

function sourceKey(row: Record<string, unknown>): string {
  return String(row.provider ?? row.source ?? '')
}

function effectivePreviewStaleAt(
  row: Record<string, unknown>,
  policy: MarketPriceSourcePolicy,
): number | null {
  const globalStale = Date.parse(String(row.stale_after ?? ''))
  const sourceAsOf = Date.parse(String(row.source_as_of ?? row.as_of ?? row.updated_at ?? ''))
  const tenantStale = Number.isFinite(sourceAsOf)
    ? sourceAsOf + Math.max(1, policy.maxAgeMinutes) * 60_000
    : Number.NaN
  const candidates = [globalStale, tenantStale].filter(Number.isFinite)
  return candidates.length ? Math.min(...candidates) : null
}

export function selectMarketPricePreviewRow<T extends Record<string, unknown>>(
  rows: T[],
  policies: MarketPriceSourcePolicy[],
  options: {
    requiredResolution?: string
    priceArea: string
    now?: Date
    referencePeriods?: string[]
  },
): MarketPricePreviewSelection<T> | null {
  const nowMs = (options.now ?? new Date()).getTime()
  const policyBySource = new Map(policies.map((policy) => [policy.sourceKey, policy]))
  const periodRank = new Map<string, number>(
    (options.referencePeriods ?? ['rolling_30_days', 'rolling_7_days', 'latest_complete_day'])
      .map((period, index): [string, number] => [period, index]),
  )

  const eligible = rows.flatMap((row) => {
    const policy = policyBySource.get(sourceKey(row))
    if (!policy) return []
    if (!policySupports({
      policy,
      priceArea: options.priceArea,
      resolution: options.requiredResolution,
    })) return []
    if (String(row.status ?? '') !== 'active') return []
    if (previewNumber(row.price_sek_per_kwh) === null) return []

    const metadata = previewMetadata(row)
    const requestedDays = previewNumber(row.requested_days ?? metadata.requested_days)
    const includedDays = previewNumber(row.included_days ?? metadata.included_days)
    const fallbackUsed = row.fallback_used === true || (
      requestedDays !== null && includedDays !== null && includedDays < requestedDays
    )
    if (fallbackUsed && !policy.allowIndicativeLatest) return []

    const effectiveStaleMs = effectivePreviewStaleAt(row, policy)
    const isStale = effectiveStaleMs === null || effectiveStaleMs <= nowMs
    if (isStale) return []

    return [{
      row,
      policy,
      effectiveStaleAt: effectiveStaleMs === null ? null : new Date(effectiveStaleMs).toISOString(),
      isStale,
      requestedDays,
      includedDays,
      windowComplete: requestedDays !== null && includedDays !== null
        ? includedDays >= requestedDays
        : !fallbackUsed,
      fallbackUsed,
    }]
  })

  eligible.sort((left, right) => {
    const priority = left.policy.priority - right.policy.priority
    if (priority !== 0) return priority
    if (left.windowComplete !== right.windowComplete) return left.windowComplete ? -1 : 1
    const leftRank = periodRank.get(String(left.row.reference_period)) ?? Number.MAX_SAFE_INTEGER
    const rightRank = periodRank.get(String(right.row.reference_period)) ?? Number.MAX_SAFE_INTEGER
    if (leftRank !== rightRank) return leftRank - rightRank
    return Date.parse(String(right.row.source_as_of ?? right.row.as_of ?? 0)) -
      Date.parse(String(left.row.source_as_of ?? left.row.as_of ?? 0))
  })

  const selected = eligible[0]
  if (!selected) return null
  return {
    row: selected.row,
    policy: selected.policy,
    effectiveStaleAt: selected.effectiveStaleAt,
    isStale: selected.isStale,
    requestedDays: selected.requestedDays,
    includedDays: selected.includedDays,
    windowComplete: selected.windowComplete,
  }
}
