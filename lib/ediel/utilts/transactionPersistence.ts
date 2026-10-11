import { canonicalUtiltsDecimal } from './exactDecimal'
import { utiltsE30StandardEnergyUnit, utiltsPhysicalQuantityUnit } from './quantityUnitScope'
import { canonicalUtiltsTransactions, utiltsPhysicalQuantityQuality, type CanonicalUtiltsObservation } from './canonicalObservationScope'
import { tokenizeEdifact, segmentComposite } from '@/lib/ediel/core/edifactTokenizer'
import { supabaseService } from '@/lib/supabase/service'
import { resolveUtiltsTransactionId } from '@/lib/ediel/utilts/transactionIdentity'
import type {
  UtiltsRuntimeTransaction,
  UtiltsTransactionDisposition,
} from '@/lib/ediel/utiltsEngine'
import type { EdielEnvironment } from '@/lib/ediel/types'
import { createHash } from 'node:crypto'
import { localEdifactDateTimeToUtc, parseEdifactTimezoneOffsetFromSegments } from './timezone'
import { consumptionConflict, consumptionEqual, legacyUtiltsRetryComparison, validateUtiltsConsumptionContract, type UtiltsConsumptionContract } from './consumptionContract'

export { resolveUtiltsTransactionId } from '@/lib/ediel/utilts/transactionIdentity'

type UtiltsPersistenceMatch = {
  transactionReference: string | null
  externalMeteringPointId: string | null
  externalGridAreaId: string | null
  meteringPointId: string | null
}

export type UtiltsTransactionPersistenceItem = {
  transactionId: string | null
  disposition: UtiltsTransactionDisposition['disposition']
  responseType: UtiltsTransactionDisposition['responseType']
  issueCodes: string[]
  seriesKind: 'actual' | 'forecast' | 'aggregate' | 'request'
  meteringPointId: string | null
  externalMeteringPointId: string | null
  gridAreaId: string | null
  productId?: string | null
  periodStart: string | null
  periodEnd: string | null
  registrationDate: string | null
  latestUpdateDate: string | null
  resolution: string | null
  unit: string | null
  reasonForTransaction: string | null
  quantities: Array<{
    qualifier: string | null
    value: number | null
    raw: string
    observationId: string
  }>
}

export type UtiltsTransactionPersistenceResult = {
  transactionId: string
  disposition: UtiltsTransactionDisposition['disposition']
  responseType: UtiltsTransactionDisposition['responseType']
  persistenceStatus: 'not_applicable' | 'persisted' | 'failed'
  seriesId?: string
  idempotentReplay?: boolean
  issueCodes?: string[]
  consumptionContract?: UtiltsConsumptionContract
  contractHash?: string
  contractVersion?: number
  sourceBinding?: { sourceMessageId: string; rawHash: string; boundAt: string }
}

export type UtiltsBoundPersistenceInput = {
  companyId: string
  environment: EdielEnvironment
  sourceMessageId: string
  messageCode: string
  rawPayload: string
  contracts: readonly UtiltsConsumptionContract[]
  transactions: readonly UtiltsTransactionPersistenceItem[]
}
// Only the trusted persistence adapter registers write authority. JSON loaded
// from parsed_payload (or a caller's status/hash marker) cannot enter this map.
const returnedAuthority = new WeakMap<UtiltsTransactionPersistenceResult, { sourceMessageId: string; contract: UtiltsConsumptionContract }>()

export function storedUtiltsConsumption(result: UtiltsTransactionPersistenceResult, sourceMessageId: string): UtiltsConsumptionContract | null {
  const authority = returnedAuthority.get(result)
  if (!authority || authority.sourceMessageId !== sourceMessageId) return null
  return structuredClone(authority.contract)
}

/** Validate the actual service RPC boundary, including exact membership and
 * equality to prepared content. Hash authority is checked in PostgreSQL. */
export function validateUtiltsPersistenceResults(input: UtiltsBoundPersistenceInput, data: unknown): UtiltsTransactionPersistenceResult[] {
  if (!Array.isArray(data) || data.length !== input.transactions.length || input.contracts.length !== data.length) consumptionConflict('result_membership')
  const ids = input.transactions.map(item => item.transactionId)
  if (new Set(ids).size !== ids.length || ids.some(id => !id)) consumptionConflict('physical_membership')
  const rawHash = createHash('sha256').update(input.rawPayload, 'utf8').digest('hex')
  const results = data as UtiltsTransactionPersistenceResult[]
  for (const [index, item] of input.transactions.entries()) {
    const found = results.filter(row => row && row.transactionId === item.transactionId)
    if (found.length !== 1) consumptionConflict('result_membership')
    const row = found[0]
    const binding = row.sourceBinding
    if (!binding || binding.sourceMessageId !== input.sourceMessageId || binding.rawHash !== rawHash || !Number.isFinite(Date.parse(binding.boundAt))) consumptionConflict('source_binding')
    // A storage failure has no national ERR meaning. In particular, do not
    // consume a successful sibling or draft an ACK from a partially failed RPC.
    // The database rolls the entire reservation back; this also holds legacy
    // RPC implementations that still return a synthetic failed row.
    if (row.persistenceStatus === 'failed') consumptionConflict('persistence_failed')
    if (row.disposition !== item.disposition || row.responseType !== item.responseType || row.persistenceStatus !== (item.disposition === 'accepted' ? 'persisted' : 'not_applicable')) consumptionConflict('outcome')
    if (row.persistenceStatus !== 'persisted') {
      if (row.consumptionContract) consumptionConflict('nonaccepted_contract')
      continue
    }
    const contract = validateUtiltsConsumptionContract(row.consumptionContract)
    const prepared = input.contracts[index]
    const comparison = contract.version === 1 && prepared.version === 2 && row.idempotentReplay === true
      ? legacyUtiltsRetryComparison(prepared,input.rawPayload) : prepared
    if (contract.version===3 || !row.seriesId || row.contractVersion !== contract.version || !/^[a-f0-9]{64}$/.test(row.contractHash ?? '') || !consumptionEqual(contract, comparison) ||
      contract.companyId !== input.companyId || contract.environment !== input.environment || contract.messageCode !== input.messageCode || contract.transactionId !== item.transactionId) consumptionConflict('returned_contract')
    returnedAuthority.set(row, { sourceMessageId: input.sourceMessageId, contract: structuredClone(contract) })
  }
  return results
}

export function utiltsSeriesKind(messageCode: string | null | undefined): UtiltsTransactionPersistenceItem['seriesKind'] {
  const code = String(messageCode ?? '').trim().toUpperCase()
  if (code === 'S02') return 'forecast'
  if (['E72', 'E73', 'E74', 'S06'].includes(code)) return 'request'
  if (['S01', 'S03', 'S04', 'S05', 'S08', 'E31'].includes(code)) return 'aggregate'
  return 'actual'
}

function byTransactionReference<T extends { transactionReference: string | null }>(
  values: readonly T[],
  transactionId: string | null,
): T | null {
  if (!transactionId) return null
  return values.find((value) => value.transactionReference === transactionId) ?? null
}

function transactionById(
  transactions: readonly UtiltsRuntimeTransaction[],
  transactionId: string | null,
): UtiltsRuntimeTransaction | null {
  if (!transactionId) return transactions.length === 1 ? transactions[0] ?? null : null
  return transactions.find((transaction) => transaction.transactionId === transactionId) ?? null
}

export function buildUtiltsTransactionPersistencePayload(input: {
  messageCode: string | null | undefined
  transactions: readonly UtiltsRuntimeTransaction[]
  dispositions: readonly UtiltsTransactionDisposition[]
  matches: readonly UtiltsPersistenceMatch[]
  rawSegments?: readonly string[]
}): UtiltsTransactionPersistenceItem[] {
  const seriesKind = utiltsSeriesKind(input.messageCode)
  const timezone = parseEdifactTimezoneOffsetFromSegments(input.rawSegments)
  const wire = input.rawSegments?.length ? tokenizeEdifact(input.rawSegments.map(segment => segment.endsWith("'") ? segment : segment + "'").join('\n')) : null
  const physical = wire ? canonicalUtiltsTransactions(wire.segments.slice(wire.segments.findIndex(segment => segment.tag === 'UNH')), wire.una, 0) : []
  // The source fields are local wall-clock times. Without the wire's DTM+735,
  // do not invent a UTC instant for durable series evidence.
  const instant = (value: string | null | undefined) => timezone ? localEdifactDateTimeToUtc(value, timezone) : null

  return input.dispositions.map((disposition, dispositionIndex) => {
    const transactionId = resolveUtiltsTransactionId(disposition.transactionId, dispositionIndex)
    const transaction =
      transactionById(input.transactions, disposition.transactionId) ??
      transactionById(input.transactions, transactionId) ??
      (input.transactions.length === 1 ? input.transactions[0] ?? null : null)
    const match =
      byTransactionReference(input.matches, disposition.transactionId) ??
      byTransactionReference(input.matches, transactionId)
    const own = physical.find(value => value.transactionId === disposition.transactionId || value.transactionId === transactionId)
    const firstSequence = own?.segments.find(segment => segment.tag === 'SEQ')?.index ?? Infinity
    const products = own?.segments.filter(segment => segment.tag === 'LIN' && segment.index < firstSequence) ?? []
    const product = wire && products.length === 1 ? segmentComposite(products[0], 3, wire.una) : []
    const productId = product.length === 4 && product[1] === '' && product[2] === '' && product[3] === '9' ? product[0] || null : null
    // LOC+175 names a regulating object, never a metering point. A grid-area
    // or stale transaction match must not turn that IDE into a point identity.
    const regulatingObject = Boolean(transaction?.regulatingObjectPresent || transaction?.regulatingObjectId)

    return {
      transactionId,
      disposition: disposition.disposition,
      responseType: disposition.responseType,
      issueCodes: [...disposition.issueCodes],
      seriesKind,
      meteringPointId: regulatingObject ? null : match?.meteringPointId ?? null,
      externalMeteringPointId: regulatingObject ? null : match?.externalMeteringPointId ?? transaction?.meterPointId ?? null,
      gridAreaId: match?.externalGridAreaId ?? transaction?.gridAreaId ?? null,
      productId,
      periodStart: instant(transaction?.deliveryPeriodStart),
      periodEnd: instant(transaction?.deliveryPeriodEnd),
      registrationDate: instant(transaction?.registrationTime),
      latestUpdateDate: instant(transaction?.latestUpdateTime),
      resolution: transaction?.resolution ?? null,
      unit: transaction?.unit ?? null,
      reasonForTransaction: transaction?.transactionReason ?? null,
      quantities: (disposition.disposition === 'internal_review' ? [] : transaction?.quantities ?? []).map((quantity, index) => ({
        qualifier: quantity.qualifier,
        value: quantity.value,
        raw: quantity.raw,
        observationId: String(index + 1),
      })),
    }
  })
}

export async function persistUtiltsTransactionResults(input: UtiltsBoundPersistenceInput & {actorUserId:string}): Promise<UtiltsTransactionPersistenceResult[]> {
  if(!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(input.actorUserId)) consumptionConflict('execution_actor_required')
  if (!input.rawPayload || input.contracts.length !== input.transactions.length) consumptionConflict('prepared_contract_missing')
  input.contracts.forEach(validateUtiltsConsumptionContract)
  input.contracts.forEach((contract,index)=>{
    const item=input.transactions[index]
    if(contract.version===3 && (item.disposition!=='guide_rejected' || item.responseType!=='negative_aperak' || !item.issueCodes.includes('UTILTS_TRANSACTION_ID_INVALID'))) consumptionConflict('rejected_diagnostic_outcome')
  })
  // Narrow server-only boundary until the exact native-generated public types
  // arrive. No generated file is hand-edited or global client type weakened.
  const rpc = supabaseService.rpc.bind(supabaseService) as unknown as (name: 'gridex_persist_utilts_consumption_v1', args: {
    p_company_id: string; p_environment: string; p_source_message_id: string; p_message_code: string; p_raw_payload: string; p_transactions: unknown; p_actor_user_id:string
  }) => PromiseLike<{ data: unknown; error: { message: string } | null }>
  const wire = tokenizeEdifact(input.rawPayload)
  const physical = canonicalUtiltsTransactions(wire.segments.slice(wire.segments.findIndex(segment=>segment.tag==='UNH')),wire.una,0)
  const { data, error } = await rpc('gridex_persist_utilts_consumption_v1', {
    p_company_id: input.companyId,
    p_environment: input.environment,
    p_source_message_id: input.sourceMessageId,
    p_message_code: input.messageCode,
    p_raw_payload: input.rawPayload,
    p_actor_user_id: input.actorUserId,
    p_transactions: input.transactions.map((item, index) => ({ ...item,
      quantities: input.contracts[index].version !== 1 ? item.quantities.map((quantity,quantityIndex) => {
        const transaction=physical[index]
        const source=transaction?.observations.flatMap(observation=>observation.quantities)[quantityIndex]
        // SC-053: each stored value keeps its own source STS+8 quality, so a
        // missing (46) value and a verified zero (21) stay distinguishable.
        // PostgreSQL re-derives and compares it; the caller cannot invent it.
        const quality=(observation:CanonicalUtiltsObservation | null)=>
          item.disposition==='accepted' && source ? {quality:utiltsPhysicalQuantityQuality(observation,source,wire.una)} : {}
        if (quantity.value === null) {
          // The physical token keeps the literal NULL; the runtime value is null.
          if(!transaction || !source || (source.value!==null && source.value!=='NULL') || source.raw!==quantity.raw || source.qualifier!==quantity.qualifier) return quantity
          return {...quantity,...quality(transaction.observations.find(observation=>observation.quantities.includes(source)) ?? null)}
        }
        if(!transaction || !source || source.value===null || source.raw!==quantity.raw || source.qualifier!==quantity.qualifier) consumptionConflict('physical_quantity_membership')
        const observation=transaction.observations.find(observation=>observation.quantities.includes(source)) ?? null
        const unit=utiltsPhysicalQuantityUnit(transaction,observation,source,wire.una)
        const consumed = input.contracts[index].observations.some(observation=>observation.sourceOrdinal===quantityIndex)
        const consumerUnit=input.messageCode==='E30' ? utiltsE30StandardEnergyUnit(transaction,source,wire.una) : unit
        if(item.disposition === 'accepted' && (unit!==item.unit || (consumed && !consumerUnit))) consumptionConflict('physical_quantity_unit')
        // The contract's own observation interval positions the stored value
        // (series windows are [start,end)); a quantity no observation consumes
        // keeps no invented time.
        const readingAt=input.contracts[index].observations.find(observation=>observation.sourceOrdinal===quantityIndex)?.periodStart ?? null
        return {...quantity,value:canonicalUtiltsDecimal(source.value,wire.una.decimalMark),...quality(observation),...(readingAt?{readingAt}:{})}
      }) : item.quantities, consumptionContract: input.contracts[index] })),
  })

  if (error) throw new Error(`utilts_transaction_persistence_failed:${error.message}`)
  try { return validateUtiltsPersistenceResults(input, data) } catch (cause) {
    throw new Error(`utilts_transaction_persistence_invalid_result:${cause instanceof Error ? cause.message : 'unknown'}`, { cause })
  }
}

export async function finalizeUtiltsTransactionAck(input: {
  companyId: string
  environment: EdielEnvironment
  sourceMessageId: string
  transactionId: string
  responseType: 'positive_aperak' | 'negative_aperak' | 'utilts_err'
  responseMessageId: string
}): Promise<void> {
  const now = new Date().toISOString()
  const { data: updated, error } = await supabaseService
    .from('ediel_ack_transaction_results')
    .update({
      final_response_type: input.responseType,
      response_message_id: input.responseMessageId,
      finalized_at: now,
      updated_at: now,
    })
    .eq('company_id', input.companyId)
    .eq('environment', input.environment)
    .eq('source_message_id', input.sourceMessageId)
    .eq('source_transaction_id', input.transactionId)
    .is('finalized_at', null)
    .select('id')

  if (error) throw new Error(`utilts_transaction_ack_finalization_failed:${error.message}`)
  if (updated?.length === 1) return
  if (updated?.length) throw new Error('utilts_transaction_ack_finalization_ambiguous')

  // A concurrent finalizer or an identical retry can leave zero rows in the
  // conditional update. The stored response must be the same immutable ACK.
  const { data: existing, error: readError } = await supabaseService
    .from('ediel_ack_transaction_results')
    .select('final_response_type,response_message_id,finalized_at')
    .eq('company_id', input.companyId)
    .eq('environment', input.environment)
    .eq('source_message_id', input.sourceMessageId)
    .eq('source_transaction_id', input.transactionId)
    .maybeSingle()
  if (readError) throw new Error(`utilts_transaction_ack_finalization_failed:${readError.message}`)
  if (!existing?.finalized_at || existing.final_response_type !== input.responseType || existing.response_message_id !== input.responseMessageId) {
    throw new Error('utilts_transaction_ack_finalization_conflict')
  }
}
