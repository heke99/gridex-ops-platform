import type { ParsedUtilts } from '@/lib/ediel/utilts/parseUtilts'
import { addNormalizedResolution, normalizeEdifactResolution } from '@/lib/ediel/utilts/resolution'
import {
  localEdifactDateTimeToUtc,
  parseEdifactTimezoneOffsetFromSegments,
} from '@/lib/ediel/utilts/timezone'

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

const E66_BILLING_ENERGY_QUALIFIERS = new Set(['136'])

function qualifier(value: string | null | undefined): string {
  return String(value ?? '').trim().toUpperCase()
}

function intervalPeriod(params: {
  start: string | null
  end: string | null
  resolution: string | null
  index: number
}): { periodStart: string | null; periodEnd: string | null; timestamp: string | null } {
  if (!params.resolution || !params.start) {
    return { periodStart: params.start, periodEnd: params.end, timestamp: params.end ?? params.start }
  }
  const periodStart = addNormalizedResolution(params.start, params.resolution, params.index)
  const periodEnd = periodStart ? addNormalizedResolution(periodStart, params.resolution) : null
  return {
    periodStart: periodStart ?? params.start,
    periodEnd: periodEnd ?? params.end,
    timestamp: periodEnd ?? params.end ?? periodStart ?? params.start,
  }
}

export function parseMeteringObservations(parsed: ParsedUtilts): ParsedMeteringObservation[] {
  const timezone = parseEdifactTimezoneOffsetFromSegments(parsed.rawSegments)
  const transactions = parsed.transactions.length > 0 ? parsed.transactions : [{
    transactionId: parsed.transactionId,
    meterPointId: parsed.meterPointId,
    gridAreaId: parsed.gridAreaId,
    deliveryPeriodStart: parsed.deliveryPeriodStart,
    deliveryPeriodEnd: parsed.deliveryPeriodEnd,
    registrationTime: parsed.registrationTime,
    resolution: parsed.resolution,
    resolutionFormat: null,
    unit: parsed.unit,
    quantities: parsed.quantities,
  }]

  return transactions.flatMap((transaction, transactionIndex) => {
    const measurementResolution = normalizeEdifactResolution({
      value: transaction.resolution ?? parsed.resolution,
      format: transaction.resolutionFormat,
    })
    const quantities = transaction.quantities.flatMap((quantity, sourceIndex) => {
      if (String(parsed.messageCode ?? '').toUpperCase() !== 'E66') return [{ quantity, sourceIndex }]
      return E66_BILLING_ENERGY_QUALIFIERS.has(qualifier(quantity.qualifier)) ? [{ quantity, sourceIndex }] : []
    })

    return quantities.map(({ quantity, sourceIndex }, quantityIndex) => {
      // Resolution arithmetic is intentionally done on the Ediel local wall-clock
      // values first. Calendar resolutions such as P1M must advance 1 July ->
      // 1 August before DTM+735 is applied; advancing the already converted UTC
      // instant would turn 30 June 22:00Z + one UTC month into 30 July 22:00Z.
      const localPeriod = intervalPeriod({
        start: transaction.deliveryPeriodStart ?? parsed.deliveryPeriodStart,
        end: transaction.deliveryPeriodEnd ?? parsed.deliveryPeriodEnd,
        resolution: measurementResolution,
        index: quantityIndex,
      })
      const periodStart = localEdifactDateTimeToUtc(localPeriod.periodStart, timezone) ?? localPeriod.periodStart
      const periodEnd = localEdifactDateTimeToUtc(localPeriod.periodEnd, timezone) ?? localPeriod.periodEnd
      const registrationTime = localEdifactDateTimeToUtc(
        transaction.registrationTime ?? parsed.registrationTime,
        timezone,
      ) ?? transaction.registrationTime ?? parsed.registrationTime
      const timestamp = periodEnd ?? registrationTime ?? periodStart

      return {
        timestamp,
        periodStart,
        periodEnd,
        quantity: quantity.value,
        unit: transaction.unit ?? parsed.unit ?? 'KWH',
        qualityStatus: quantity.qualifier,
        registerCode: parsed.references.find((reference) => reference.qualifier === 'AES')?.value ?? null,
        meterNumber: parsed.references.find((reference) => reference.qualifier === 'MG')?.value ?? null,
        transactionReference: transaction.transactionId ?? parsed.transactionId,
        meteringPointExternalId: transaction.meterPointId ?? parsed.meterPointId,
        gridAreaId: transaction.gridAreaId ?? parsed.gridAreaId,
        measurementResolution,
        utiltsSubtype: parsed.utiltsSubtype,
        sourceOrder: transactionIndex * 10000 + sourceIndex,
      }
    })
  })
}
