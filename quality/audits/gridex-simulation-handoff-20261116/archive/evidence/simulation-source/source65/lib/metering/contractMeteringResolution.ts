import { supabaseService } from '@/lib/supabase/service'

/**
 * Metering resolution a customer's contract needs, so metering requests and
 * billing completeness follow the agreement instead of a hard-coded default.
 *
 * Source of truth, in order:
 *  1. the contract's locked price snapshot (`interval_resolution`);
 *  2. the contract type (fixed / monthly / hourly / quarter-hour / portfolio / mixed).
 * Portfolio and mixed contracts without an explicit interval need the finest
 * resolution (quarter-hour, the Swedish imbalance-settlement interval) because
 * their price is built from interval volumes. Finer data can always be
 * aggregated; coarser data never can.
 *
 * The metering point only caps what can be delivered: a meter the grid owner
 * reports monthly (Ediel reading frequency M) has no interval values.
 */
export type MeteringResolution = 'month' | 'day' | 'hour' | 'quarter_hour'

const RESOLUTION_MINUTES: Record<MeteringResolution, number> = {
  month: 28 * 24 * 60,
  day: 24 * 60,
  hour: 60,
  quarter_hour: 15,
}

/** Contract statuses that make a contract the one billed/requested for. */
const CURRENT_CONTRACT_STATUSES = ['active', 'signed', 'pending_signature']

function text(value: unknown): string | null {
  return typeof value === 'string' && value.trim() ? value.trim().toLowerCase() : null
}

function record(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' && !Array.isArray(value) ? (value as Record<string, unknown>) : {}
}

export function normalizeMeteringResolution(value: unknown): MeteringResolution | null {
  const normalized = text(value)
  if (!normalized) return null
  if (['quarter_hour', 'quarter-hour', 'quarterly', 'quarter', 'pt15m', '15', 'kvart'].includes(normalized)) return 'quarter_hour'
  if (['hour', 'hourly', 'pt60m', 'pt1h', '60', 'tim'].includes(normalized)) return 'hour'
  if (['day', 'daily', 'p1d', '1440'].includes(normalized)) return 'day'
  if (['month', 'monthly', 'p1m', 'manad', 'månad'].includes(normalized)) return 'month'
  return null
}

export function resolutionMinutes(resolution: MeteringResolution): number {
  return RESOLUTION_MINUTES[resolution]
}

/** True when `candidate` is coarser (longer intervals) than `required`. */
export function isCoarserThan(candidate: MeteringResolution, required: MeteringResolution): boolean {
  return RESOLUTION_MINUTES[candidate] > RESOLUTION_MINUTES[required]
}

export function meteringResolutionForContract(input: {
  contractType: string | null | undefined
  priceSnapshot?: unknown
}): MeteringResolution {
  const snapshot = record(input.priceSnapshot)
  const explicit =
    normalizeMeteringResolution(snapshot.interval_resolution) ??
    normalizeMeteringResolution(record(snapshot.pricing).interval_resolution)
  if (explicit) return explicit

  switch (text(input.contractType)) {
    case 'variable_quarterly':
      return 'quarter_hour'
    case 'variable_hourly':
    case 'hourly_spot':
      return 'hour'
    case 'portfolio':
    case 'mixed':
      return 'quarter_hour'
    case 'fixed':
    case 'variable':
    case 'variable_monthly':
    case 'variable_spot':
    case 'spot':
      return 'month'
    default:
      // Unknown or manual contract: request the finest data rather than guess low.
      return 'quarter_hour'
  }
}

/** Finest resolution the metering point can deliver, from its grid-owner reading frequency. */
export function meterDeliverableResolution(readingFrequency: string | null | undefined): MeteringResolution {
  return text(readingFrequency) === 'monthly' ? 'month' : 'quarter_hour'
}

export type MeteringResolutionRequirement = {
  meteringPointId: string
  contractId: string | null
  contractType: string | null
  /** What the contract needs. */
  contractResolution: MeteringResolution
  /** What to request from the grid owner (contract need capped by the meter). */
  requestResolution: MeteringResolution
  /** The meter cannot deliver what the contract needs (e.g. hourly contract on a monthly-read meter). */
  meterCannotDeliver: boolean
  source: 'price_snapshot' | 'contract_type' | 'no_contract'
}

export function evaluateMeteringResolutionRequirement(input: {
  meteringPointId: string
  readingFrequency: string | null | undefined
  contract: { id: string; contract_type: string | null; price_snapshot?: unknown } | null
}): MeteringResolutionRequirement {
  const deliverable = meterDeliverableResolution(input.readingFrequency)
  if (!input.contract) {
    // No contract yet (e.g. masterdata collection): request what the meter has.
    return {
      meteringPointId: input.meteringPointId,
      contractId: null,
      contractType: null,
      contractResolution: deliverable,
      requestResolution: deliverable,
      meterCannotDeliver: false,
      source: 'no_contract',
    }
  }
  const snapshot = record(input.contract.price_snapshot)
  const fromSnapshot =
    normalizeMeteringResolution(snapshot.interval_resolution) ??
    normalizeMeteringResolution(record(snapshot.pricing).interval_resolution)
  const contractResolution = meteringResolutionForContract({
    contractType: input.contract.contract_type,
    priceSnapshot: input.contract.price_snapshot,
  })
  const meterCannotDeliver = isCoarserThan(deliverable, contractResolution)
  return {
    meteringPointId: input.meteringPointId,
    contractId: input.contract.id,
    contractType: input.contract.contract_type,
    contractResolution,
    requestResolution: meterCannotDeliver ? deliverable : contractResolution,
    meterCannotDeliver,
    source: fromSnapshot ? 'price_snapshot' : 'contract_type',
  }
}

type ContractRow = {
  id: string
  metering_point_id: string | null
  contract_type: string | null
  price_snapshot: unknown
  status: string
  starts_at: string | null
  ends_at: string | null
  created_at: string | null
}

function contractCoversDate(row: ContractRow, onDate: string | null): boolean {
  if (!onDate) return true
  if (row.starts_at && row.starts_at > onDate) return false
  if (row.ends_at && row.ends_at < onDate) return false
  return true
}

function preferContract(a: ContractRow, b: ContractRow): ContractRow {
  const rank = (row: ContractRow) => CURRENT_CONTRACT_STATUSES.indexOf(row.status)
  if (rank(a) !== rank(b)) return rank(a) < rank(b) ? a : b
  return String(a.created_at ?? '') >= String(b.created_at ?? '') ? a : b
}

/**
 * Batched, tenant-scoped lookup of the resolution each metering point's current
 * contract requires. `onDate` (YYYY-MM-DD) picks the contract in force then.
 */
export async function loadMeteringResolutionRequirements(input: {
  companyId: string
  meteringPointIds: string[]
  onDate?: string | null
}): Promise<Map<string, MeteringResolutionRequirement>> {
  const ids = Array.from(new Set(input.meteringPointIds.filter(Boolean)))
  const result = new Map<string, MeteringResolutionRequirement>()
  if (ids.length === 0) return result

  const [pointsResult, contractsResult] = await Promise.all([
    supabaseService
      .from('metering_points')
      .select('id, reading_frequency')
      .eq('company_id', input.companyId)
      .in('id', ids),
    supabaseService
      .from('customer_contracts')
      .select('id, metering_point_id, contract_type, price_snapshot, status, starts_at, ends_at, created_at')
      .eq('company_id', input.companyId)
      .in('metering_point_id', ids)
      .in('status', CURRENT_CONTRACT_STATUSES),
  ])
  if (pointsResult.error) throw pointsResult.error
  if (contractsResult.error) throw contractsResult.error

  const frequencyById = new Map<string, string | null>()
  for (const row of (pointsResult.data ?? []) as Array<{ id: string; reading_frequency: string | null }>) {
    frequencyById.set(row.id, row.reading_frequency)
  }
  const contractByPoint = new Map<string, ContractRow>()
  for (const row of (contractsResult.data ?? []) as ContractRow[]) {
    if (!row.metering_point_id || !contractCoversDate(row, input.onDate ?? null)) continue
    const current = contractByPoint.get(row.metering_point_id)
    contractByPoint.set(row.metering_point_id, current ? preferContract(current, row) : row)
  }

  for (const id of ids) {
    result.set(
      id,
      evaluateMeteringResolutionRequirement({
        meteringPointId: id,
        readingFrequency: frequencyById.get(id) ?? null,
        contract: contractByPoint.get(id) ?? null,
      }),
    )
  }
  return result
}

/** Ediel UTILTS resolution code (minutes, DTM+354) for a resolution. */
export function utiltsResolutionCode(resolution: MeteringResolution): '15' | '60' | '1440' {
  if (resolution === 'quarter_hour') return '15'
  if (resolution === 'hour') return '60'
  return '1440'
}
