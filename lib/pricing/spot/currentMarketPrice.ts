import type { IntegrationApiClient } from '@/lib/integrations/apiAuth'
import { loadBoundEnergyResolution } from '@/lib/energy/resolutionBinding'
import { loadMarketPriceSourcePolicies, policySupports } from '@/lib/pricing/marketPriceSources'
import { supabaseService } from '@/lib/supabase/service'
import { stockholmDateForInstant } from '@/lib/time/stockholm'

export type CurrentMarketPrice = {
  provider: string
  resolution_id: string
  price_area: 'SE1' | 'SE2' | 'SE3' | 'SE4'
  reference_type: 'current_interval'
  resolution: 'hourly' | 'quarterly'
  time_start: string
  time_end: string
  price_sek_per_kwh: number
  price_ore_per_kwh: number
  price_ex_vat_sek_per_kwh: number
  price_ex_vat_ore_per_kwh: number
  includes_vat: false
  includes_supplier_fees: false
  includes_grid_fees: false
  is_indicative: false
  is_stale: boolean
  source_as_of: string
  next_update_at: string
}

export class CurrentMarketPriceError extends Error {
  readonly code:
    | 'current_market_price_unavailable'
    | 'market_price_stale'
    | 'price_area_mismatch'
  readonly status: number
  readonly field: string | null
  readonly details: Record<string, unknown>

  constructor(input: {
    message: string
    code: CurrentMarketPriceError['code']
    status?: number
    field?: string | null
    details?: Record<string, unknown>
  }) {
    super(input.message)
    this.name = 'CurrentMarketPriceError'
    this.code = input.code
    this.status = input.status ?? 503
    this.field = input.field ?? null
    this.details = input.details ?? {}
  }
}

function text(value: unknown): string | null {
  return typeof value === 'string' && value.trim() ? value.trim() : null
}

function numberValue(value: unknown): number | null {
  const parsed = typeof value === 'number' ? value : Number(value)
  return Number.isFinite(parsed) ? parsed : null
}

export async function loadCurrentMarketPrice(input: {
  client: IntegrationApiClient
  resolutionId: string
  assertedPriceArea?: string | null
  now?: Date
}): Promise<CurrentMarketPrice> {
  const now = input.now ?? new Date()
  const resolution = await loadBoundEnergyResolution({
    client: input.client,
    resolutionId: input.resolutionId,
    now,
  })
  const asserted = input.assertedPriceArea?.trim().toUpperCase() || null
  if (asserted && asserted !== resolution.priceArea) {
    throw new CurrentMarketPriceError({
      message: 'Inskickat price_area motsäger OPS-resolutionen.',
      code: 'price_area_mismatch',
      status: 409,
      field: 'price_area',
      details: { asserted_price_area: asserted, canonical_price_area: resolution.priceArea },
    })
  }

  const policies = (await loadMarketPriceSourcePolicies(input.client.company_id))
    .filter((policy) => policySupports({
      policy,
      priceArea: resolution.priceArea,
      resolution: 'quarterly',
    }) || policySupports({
      policy,
      priceArea: resolution.priceArea,
      resolution: 'hourly',
    }))
    .sort((left, right) => left.priority - right.priority)
  if (policies.length === 0) {
    throw new CurrentMarketPriceError({
      message: `Ingen aktiv marknadspriskälla är konfigurerad för ${resolution.priceArea}.`,
      code: 'current_market_price_unavailable',
      details: { price_area: resolution.priceArea },
    })
  }

  const nowIso = now.toISOString()
  const providers = policies.map((policy) => policy.sourceKey)
  const { data: intervals, error: intervalError } = await supabaseService
    .from('spot_price_intervals')
    .select('source,price_area,time_start,time_end,sek_per_kwh,resolution')
    .in('source', providers)
    .eq('price_area', resolution.priceArea)
    .lte('time_start', nowIso)
    .gt('time_end', nowIso)
    .order('time_start', { ascending: false })
    .limit(20)
  if (intervalError) throw intervalError

  const rows = (intervals ?? []) as Array<Record<string, unknown>>
  const policyBySource = new Map(policies.map((policy) => [policy.sourceKey, policy]))
  rows.sort((left, right) => {
    const leftPolicy = policyBySource.get(String(left.source))
    const rightPolicy = policyBySource.get(String(right.source))
    return (leftPolicy?.priority ?? Number.MAX_SAFE_INTEGER) -
      (rightPolicy?.priority ?? Number.MAX_SAFE_INTEGER)
  })
  const selected = rows[0]
  if (!selected) {
    throw new CurrentMarketPriceError({
      message: `Aktuellt spotpris saknas för ${resolution.priceArea}.`,
      code: 'current_market_price_unavailable',
      status: 503,
      details: { price_area: resolution.priceArea, instant: nowIso },
    })
  }

  const provider = String(selected.source)
  const policy = policyBySource.get(provider)
  if (!policy) {
    throw new CurrentMarketPriceError({
      message: 'Det aktuella spotpriset kommer från en källa som inte är tillåten för tenant.',
      code: 'current_market_price_unavailable',
      status: 503,
    })
  }

  const calendarDate = stockholmDateForInstant(now)
  const { data: summary, error: summaryError } = await supabaseService
    .from('spot_price_daily_summaries')
    .select('provider_fetched_at,verified_at,updated_at,status,source_checksum')
    .eq('source', provider)
    .eq('price_area', resolution.priceArea)
    .eq('price_date', calendarDate)
    .in('status', ['verified', 'locked'])
    .maybeSingle()
  if (summaryError) throw summaryError
  const sourceAsOf = text(summary?.provider_fetched_at) ?? text(summary?.verified_at) ?? text(summary?.updated_at)
  if (!sourceAsOf) {
    throw new CurrentMarketPriceError({
      message: 'Aktuellt spotpris saknar verifierad provider-evidens.',
      code: 'current_market_price_unavailable',
      status: 503,
      details: { provider, price_area: resolution.priceArea, calendar_date: calendarDate },
    })
  }
  const effectiveStaleAt = Date.parse(sourceAsOf) + Math.max(1, policy.maxAgeMinutes) * 60_000
  const isStale = !Number.isFinite(effectiveStaleAt) || effectiveStaleAt <= now.getTime()
  if (isStale) {
    throw new CurrentMarketPriceError({
      message: `Aktuellt spotpris för ${resolution.priceArea} är stale enligt tenantens freshness-policy.`,
      code: 'market_price_stale',
      status: 409,
      details: {
        provider,
        price_area: resolution.priceArea,
        source_as_of: sourceAsOf,
        effective_stale_at: Number.isFinite(effectiveStaleAt) ? new Date(effectiveStaleAt).toISOString() : null,
      },
    })
  }

  const price = numberValue(selected.sek_per_kwh)
  const timeStart = text(selected.time_start)
  const timeEnd = text(selected.time_end)
  if (price === null || !timeStart || !timeEnd) {
    throw new CurrentMarketPriceError({
      message: 'Aktuellt spotprisintervall är ofullständigt.',
      code: 'current_market_price_unavailable',
      status: 503,
    })
  }
  const intervalResolution = text(selected.resolution) === 'quarter_hour' ? 'quarterly' : 'hourly'

  return {
    provider,
    resolution_id: resolution.id,
    price_area: resolution.priceArea,
    reference_type: 'current_interval',
    resolution: intervalResolution,
    time_start: timeStart,
    time_end: timeEnd,
    price_sek_per_kwh: price,
    price_ore_per_kwh: price * 100,
    price_ex_vat_sek_per_kwh: price,
    price_ex_vat_ore_per_kwh: price * 100,
    includes_vat: false,
    includes_supplier_fees: false,
    includes_grid_fees: false,
    is_indicative: false,
    is_stale: false,
    source_as_of: sourceAsOf,
    next_update_at: timeEnd,
  }
}
