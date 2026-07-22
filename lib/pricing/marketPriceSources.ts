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
    // Locked evidence is immutable historical/final input. Non-locked market
    // evidence must be fresh enough for the tenant's configured policy.
    if (options.enforceFreshness && row.status !== 'locked') {
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
