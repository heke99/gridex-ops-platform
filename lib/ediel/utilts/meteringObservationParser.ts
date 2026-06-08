import type { ParsedUtilts } from '@/lib/ediel/utilts/parseUtilts'

export type ParsedMeteringObservation = {
  timestamp: string | null
  periodStart: string | null
  periodEnd: string | null
  quantity: number | null
  unit: string | null
  qualityStatus: string | null
  registerCode: string | null
  meterNumber: string | null
  transactionReference: string | null
  meteringPointExternalId: string | null
  gridAreaId: string | null
  measurementResolution: string | null
  utiltsSubtype: ParsedUtilts['utiltsSubtype']
  sourceOrder: number
}

function dateAddMinutes(value: string | null, minutes: number): string | null {
  if (!value) return null
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return value
  return new Date(date.getTime() + minutes * 60000).toISOString()
}

function resolutionMinutes(value: string | null | undefined): number | null {
  const normalized = String(value ?? '').trim().toUpperCase()
  if (normalized === 'PT15M') return 15
  if (normalized === 'PT60M') return 60
  const parsed = Number(normalized.replace(',', '.'))
  return Number.isFinite(parsed) && parsed > 0 ? parsed : null
}

function intervalPeriod(params: {
  start: string | null
  end: string | null
  resolution: string | null
  index: number
}): { periodStart: string | null; periodEnd: string | null; timestamp: string | null } {
  const minutes = resolutionMinutes(params.resolution)
  if (!minutes || !params.start) {
    return {
      periodStart: params.start,
      periodEnd: params.end,
      timestamp: params.end ?? params.start,
    }
  }

  const periodStart = dateAddMinutes(params.start, params.index * minutes)
  const periodEnd = periodStart ? dateAddMinutes(periodStart, minutes) : params.end
  return {
    periodStart,
    periodEnd,
    timestamp: periodEnd ?? periodStart,
  }
}

export function parseMeteringObservations(parsed: ParsedUtilts): ParsedMeteringObservation[] {
  const transactions = parsed.transactions.length > 0 ? parsed.transactions : [{
    transactionId: parsed.transactionId,
    meterPointId: parsed.meterPointId,
    gridAreaId: parsed.gridAreaId,
    deliveryPeriodStart: parsed.deliveryPeriodStart,
    deliveryPeriodEnd: parsed.deliveryPeriodEnd,
    registrationTime: parsed.registrationTime,
    resolution: parsed.resolution,
    unit: parsed.unit,
    quantities: parsed.quantities,
  }]

  return transactions.flatMap((transaction, transactionIndex) =>
    transaction.quantities.map((quantity, quantityIndex) => {
      const period = intervalPeriod({
        start: transaction.deliveryPeriodStart ?? parsed.deliveryPeriodStart,
        end: transaction.deliveryPeriodEnd ?? parsed.deliveryPeriodEnd,
        resolution: transaction.resolution ?? parsed.resolution,
        index: quantityIndex,
      })

      return {
        timestamp: period.timestamp ?? transaction.registrationTime ?? parsed.registrationTime,
        periodStart: period.periodStart,
        periodEnd: period.periodEnd,
        quantity: quantity.value,
        unit: transaction.unit ?? parsed.unit ?? 'KWH',
        qualityStatus: quantity.qualifier,
        registerCode: parsed.references.find((reference) => reference.qualifier === 'AES')?.value ?? null,
        meterNumber: null,
        transactionReference: transaction.transactionId ?? parsed.transactionId,
        meteringPointExternalId: transaction.meterPointId ?? parsed.meterPointId,
        gridAreaId: transaction.gridAreaId ?? parsed.gridAreaId,
        measurementResolution: transaction.resolution ?? parsed.resolution,
        utiltsSubtype: parsed.utiltsSubtype,
        sourceOrder: transactionIndex * 10000 + quantityIndex,
      }
    })
  )
}
