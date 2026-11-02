import {currentStockholmCalendarDate} from '@/lib/time/stockholm'
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

type AmendmentMeteringChoice={meteringPointId:string;rootContractId:string;contractId:string;priceSnapshotId:string|null;priceSHA256:string|null}
async function amendmentMeteringChoices(companyId:string,ids:string[],onDate:string) {
  const excluded=new Set<string>(),choices:AmendmentMeteringChoice[]=[]
  const uuid=/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/
  const validId=(value:unknown):value is string=>typeof value==='string'&&uuid.test(value)&&value!=='00000000-0000-0000-0000-000000000000'
  for(let offset=0;offset<ids.length;offset+=500) {
    const batch=ids.slice(offset,offset+500)
    const {data,error}=await supabaseService.rpc('gridex_read_contract_amendment_choices_v1',{
      p_company_id:companyId,p_metering_point_ids:batch,p_on_date:onDate,
    })
    if(error) throw error
    const result=record(data)
    if(result.schema!=='gridex-contract-amendment-metering-choices-v1'||result.companyId!==companyId||result.onDate!==onDate
      ||!Array.isArray(result.excludedAmendmentContractIds)||!Array.isArray(result.choices)
      ||result.excludedAmendmentContractIds.some(x=>!validId(x))) throw new Error('amendment_metering_choice_invalid')
    for(const id of result.excludedAmendmentContractIds) excluded.add(id as string)
    for(const value of result.choices) {
      const choice=record(value)
      if(!validId(choice.meteringPointId)||!batch.includes(choice.meteringPointId)||!validId(choice.rootContractId)||!validId(choice.contractId)
        ||choices.some(x=>x.meteringPointId===choice.meteringPointId)
        ||(choice.contractId===choice.rootContractId?(choice.priceSnapshotId!==null||choice.priceSHA256!==null):
          (!validId(choice.priceSnapshotId)||typeof choice.priceSHA256!=='string'||!/^[0-9a-f]{64}$/.test(choice.priceSHA256)))) {
        throw new Error('amendment_metering_choice_invalid')
      }
      choices.push(choice as AmendmentMeteringChoice)
    }
  }
  return {excluded,choices}
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

  const onDate=input.onDate??currentStockholmCalendarDate()
  const [pointsResult, contractsResult,amendments] = await Promise.all([
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
    amendmentMeteringChoices(input.companyId,ids,onDate),
  ])
  if (pointsResult.error) throw pointsResult.error
  if (contractsResult.error) throw contractsResult.error

  const frequencyById = new Map<string, string | null>()
  for (const row of (pointsResult.data ?? []) as Array<{ id: string; reading_frequency: string | null }>) {
    frequencyById.set(row.id, row.reading_frequency)
  }
  const contractByPoint = new Map<string, ContractRow>()
  for (const row of (contractsResult.data ?? []) as ContractRow[]) {
    if (!row.metering_point_id || amendments.excluded.has(row.id) || !contractCoversDate(row,input.onDate??null)) continue
    const current = contractByPoint.get(row.metering_point_id)
    contractByPoint.set(row.metering_point_id, current ? preferContract(current, row) : row)
  }

  const allContracts=(contractsResult.data??[]) as ContractRow[]
  const missing=amendments.choices.filter(x=>!allContracts.some(c=>c.id===x.contractId)).map(x=>x.contractId)
  if(missing.length) {
    const {data,error}=await supabaseService.from('customer_contracts')
      .select('id, metering_point_id, contract_type, price_snapshot, status, starts_at, ends_at, created_at')
      .eq('company_id',input.companyId).in('metering_point_id',ids).in('id',missing)
    if(error) throw error
    allContracts.push(...(data??[]) as ContractRow[])
  }
  const priceIds=amendments.choices.flatMap(x=>x.priceSnapshotId?[x.priceSnapshotId]:[])
  let prices:Array<{id:string;contract_id:string;company_id:string;snapshot_hash:string;snapshot_json:unknown}>=[]
  if(priceIds.length) {
    const {data,error}=await supabaseService.from('contract_price_snapshots').select('id,contract_id,company_id,snapshot_hash,snapshot_json')
      .eq('company_id',input.companyId).in('id',priceIds)
    if(error) throw error
    prices=(data??[]) as typeof prices
  }
  for(const choice of amendments.choices) {
    const rows=allContracts.filter(c=>c.id===choice.contractId&&c.metering_point_id===choice.meteringPointId)
    if(rows.length!==1||allContracts.some(c=>c.metering_point_id===choice.meteringPointId
      &&CURRENT_CONTRACT_STATUSES.includes(c.status)&&c.id!==choice.rootContractId&&!amendments.excluded.has(c.id))) {
      throw new Error('amendment_metering_contract_scope_conflict')
    }
    const selected={...rows[0]}
    if(choice.priceSnapshotId) {
      const snapshots=prices.filter(p=>p.id===choice.priceSnapshotId&&p.contract_id===choice.contractId
        &&p.company_id===input.companyId&&p.snapshot_hash===choice.priceSHA256)
      if(snapshots.length!==1) throw new Error('amendment_metering_price_snapshot_mismatch')
      selected.price_snapshot=snapshots[0].snapshot_json
    }
    contractByPoint.delete(choice.meteringPointId)
    if(contractCoversDate(selected,onDate)) contractByPoint.set(choice.meteringPointId,selected)
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
