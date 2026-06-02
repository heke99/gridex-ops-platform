import { parseUtilts } from '@/lib/ediel/utilts/parseUtilts'
import { parseMeteringObservations } from '@/lib/ediel/utilts/meteringObservationParser'
import { normalizeMeteringIngest } from '@/lib/ediel/metering/meteringEngine'
import { detectMeteringGaps } from '@/lib/ediel/metering/meteringGapDetection'
import { storeMeteringValueBatch } from '@/lib/ediel/metering/meteringValueStorage'

export async function ingestUtiltsE66MeteringValues(input: {
  companyId: string
  meteringPointId: string
  permissionId?: string | null
  utiltsMessageId: string
  rawPayload: string
  persist?: boolean
}) {
  const parsed = parseUtilts(input.rawPayload)
  if (parsed.messageCode !== 'E66') throw new Error('Endast UTILTS E66 kan ingestas som mätvärden.')

  const observations = parseMeteringObservations(parsed)
  const normalized = normalizeMeteringIngest({
    companyId: input.companyId,
    sourceMessageId: input.utiltsMessageId,
    meteringPointId: input.meteringPointId,
    periodStart: parsed.deliveryPeriodStart,
    periodEnd: parsed.deliveryPeriodEnd,
    resolution: parsed.resolution,
    values: observations.map((observation) => ({
      timestamp: observation.timestamp,
      quantity: observation.quantity,
      unit: observation.unit,
      quality: observation.qualityStatus,
      sourceOrder: observation.sourceOrder,
    })),
  })
  const gaps = detectMeteringGaps({
    periodStart: parsed.deliveryPeriodStart,
    periodEnd: parsed.deliveryPeriodEnd,
    resolution: normalized.resolution,
    actualCount: observations.length,
  })
  const batch = input.persist === false
    ? null
    : await storeMeteringValueBatch({
        companyId: input.companyId,
        meteringPointId: input.meteringPointId,
        permissionId: input.permissionId ?? null,
        utiltsMessageId: input.utiltsMessageId,
        observations,
      })

  return { parsed, observations, normalized, gaps, batch }
}
