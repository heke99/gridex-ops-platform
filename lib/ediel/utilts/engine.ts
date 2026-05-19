import type { EdielMessageRow } from '@/lib/ediel/types'
import type { UtiltsRuntimeResult } from '@/lib/ediel/utiltsEngine'
import { runUtiltsRuntimeForMessage } from '@/lib/ediel/utiltsEngine'
import { normalizeMeteringIngest } from '@/lib/ediel/metering/meteringEngine'

export type UtiltsOperationsEngineResult = UtiltsRuntimeResult & {
  meteringPreview: ReturnType<typeof normalizeMeteringIngest>
}

export function runUtiltsOperationsEngine(params: {
  rawPayload: string
  companyId?: string | null
  sourceMessageId?: string | null
}): UtiltsOperationsEngineResult {
  const runtime = runUtiltsRuntimeForMessage({
    id: params.sourceMessageId ?? 'utilts-operations-preview',
    raw_payload: params.rawPayload,
    message_family: 'UTILTS',
    message_code: null,
    validation_report: null,
    syntax_check_status: 'not_checked',
    message_received_at: null,
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
  }
}
