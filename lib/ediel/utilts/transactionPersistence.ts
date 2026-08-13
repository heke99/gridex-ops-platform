import { supabaseService } from '@/lib/supabase/service'
import { resolveUtiltsTransactionId } from '@/lib/ediel/utilts/transactionIdentity'
import type {
  UtiltsRuntimeTransaction,
  UtiltsTransactionDisposition,
} from '@/lib/ediel/utiltsEngine'
import type { EdielEnvironment } from '@/lib/ediel/types'

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
  periodStart: string | null
  periodEnd: string | null
  registrationDate: string | null
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
}): UtiltsTransactionPersistenceItem[] {
  const seriesKind = utiltsSeriesKind(input.messageCode)

  return input.dispositions.map((disposition, dispositionIndex) => {
    const transactionId = resolveUtiltsTransactionId(disposition.transactionId, dispositionIndex)
    const transaction =
      transactionById(input.transactions, disposition.transactionId) ??
      transactionById(input.transactions, transactionId) ??
      (input.transactions.length === 1 ? input.transactions[0] ?? null : null)
    const match =
      byTransactionReference(input.matches, disposition.transactionId) ??
      byTransactionReference(input.matches, transactionId)

    return {
      transactionId,
      disposition: disposition.disposition,
      responseType: disposition.responseType,
      issueCodes: [...disposition.issueCodes],
      seriesKind,
      meteringPointId: match?.meteringPointId ?? null,
      externalMeteringPointId: match?.externalMeteringPointId ?? transaction?.meterPointId ?? null,
      gridAreaId: match?.externalGridAreaId ?? transaction?.gridAreaId ?? null,
      periodStart: transaction?.deliveryPeriodStart ?? null,
      periodEnd: transaction?.deliveryPeriodEnd ?? null,
      registrationDate: transaction?.registrationTime ?? null,
      resolution: transaction?.resolution ?? null,
      unit: transaction?.unit ?? null,
      reasonForTransaction: transaction?.transactionReason ?? null,
      quantities: (transaction?.quantities ?? []).map((quantity, index) => ({
        qualifier: quantity.qualifier,
        value: quantity.value,
        raw: quantity.raw,
        observationId: String(index + 1),
      })),
    }
  })
}

export async function persistUtiltsTransactionResults(input: {
  companyId: string
  environment: EdielEnvironment
  sourceMessageId: string
  messageCode: string
  transactions: readonly UtiltsTransactionPersistenceItem[]
}): Promise<UtiltsTransactionPersistenceResult[]> {
  const { data, error } = await supabaseService.rpc('gridex_persist_utilts_transactions_v1', {
    p_company_id: input.companyId,
    p_environment: input.environment,
    p_source_message_id: input.sourceMessageId,
    p_message_code: input.messageCode,
    p_transactions: input.transactions,
  })

  if (error) throw new Error(`utilts_transaction_persistence_failed:${error.message}`)
  if (!Array.isArray(data)) throw new Error('utilts_transaction_persistence_invalid_result')
  return data as UtiltsTransactionPersistenceResult[]
}

export async function finalizeUtiltsTransactionAck(input: {
  companyId: string
  environment: EdielEnvironment
  sourceMessageId: string
  transactionId: string
  responseType: 'positive_aperak' | 'negative_aperak' | 'utilts_err'
  responseMessageId: string
}): Promise<void> {
  const { error } = await supabaseService
    .from('ediel_ack_transaction_results')
    .update({
      final_response_type: input.responseType,
      response_message_id: input.responseMessageId,
      finalized_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    })
    .eq('company_id', input.companyId)
    .eq('environment', input.environment)
    .eq('source_message_id', input.sourceMessageId)
    .eq('source_transaction_id', input.transactionId)

  if (error) throw new Error(`utilts_transaction_ack_finalization_failed:${error.message}`)
}
