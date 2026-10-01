import type { EdielMessageRow } from '@/lib/ediel/types'
import type { UtiltsRuntimeResult } from '@/lib/ediel/utiltsEngine'
import { runUtiltsRuntimeForMessage } from '@/lib/ediel/utiltsEngine'
import { normalizeMeteringIngest } from '@/lib/ediel/metering/meteringEngine'
import {inferEdielFamilyAndCodeFromRawPayload} from '@/lib/ediel/classify'

export type UtiltsOperationsEngineResult = UtiltsRuntimeResult & {
  meteringPreview: ReturnType<typeof normalizeMeteringIngest>
  /** Explicit observed admission only; preview supplies no persisted ingress proof. */
  previewEvaluationAt:string
}

export function runUtiltsOperationsEngine(params: {
  rawPayload: string
  companyId?: string | null
  sourceMessageId?: string | null
  /** Observed source admission, required to select the actual dated guide. */
  admissionAt?: string | null
}): UtiltsOperationsEngineResult {
  if (!params.admissionAt || !Number.isFinite(Date.parse(params.admissionAt))) throw new Error('ediel_admission_time_missing')
  const physical=inferEdielFamilyAndCodeFromRawPayload(params.rawPayload)
  const runtime = runUtiltsRuntimeForMessage({
    id: params.sourceMessageId ?? 'utilts-operations-preview',
    raw_payload: params.rawPayload,
    message_family: 'UTILTS',
    message_code: physical.messageFamily==='UTILTS' ? physical.messageCode : null,
    direction:'inbound',
    validation_report: null,
    syntax_check_status: 'not_checked',
    message_received_at: params.admissionAt,
    created_at: params.admissionAt,
  } as unknown as EdielMessageRow)
  const firstTransaction = runtime.facts.transactions[0] ?? null
  const meteringPreview = normalizeMeteringIngest({
    companyId: params.companyId ?? null,
    sourceMessageId: params.sourceMessageId ?? runtime.facts.messageReference ?? null,
    meteringPointId: runtime.facts.meterPointId ?? firstTransaction?.meterPointId ?? null,
    gridAreaId: runtime.facts.gridAreaId ?? firstTransaction?.gridAreaId ?? null,
    periodStart: runtime.facts.deliveryPeriodStart ?? firstTransaction?.deliveryPeriodStart ?? null,
    periodEnd: runtime.facts.deliveryPeriodEnd ?? firstTransaction?.deliveryPeriodEnd ?? null,
    resolution: runtime.facts.resolution ?? firstTransaction?.resolution ?? null,
    values: runtime.facts.quantities.map((quantity, index) => ({
      timestamp: runtime.facts.deliveryPeriodStart,
      quantity: quantity.value,
      unit: runtime.facts.unit,
      quality: quantity.qualifier,
      sourceOrder: index,
    })),
  })

  return {
    ...runtime,
    meteringPreview,
    previewEvaluationAt:new Date(params.admissionAt).toISOString(),
  }
}
