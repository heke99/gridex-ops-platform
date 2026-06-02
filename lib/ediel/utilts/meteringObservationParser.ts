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
  measurementResolution: string | null
  utiltsSubtype: ParsedUtilts['utiltsSubtype']
  sourceOrder: number
}

export function parseMeteringObservations(parsed: ParsedUtilts): ParsedMeteringObservation[] {
  const transactions = parsed.transactions.length > 0 ? parsed.transactions : [{
    transactionId: parsed.transactionId,
    deliveryPeriodStart: parsed.deliveryPeriodStart,
    deliveryPeriodEnd: parsed.deliveryPeriodEnd,
    registrationTime: parsed.registrationTime,
    resolution: parsed.resolution,
    unit: parsed.unit,
    quantities: parsed.quantities,
  }]

  return transactions.flatMap((transaction, transactionIndex) =>
    transaction.quantities.map((quantity, quantityIndex) => ({
      timestamp: transaction.deliveryPeriodStart ?? parsed.deliveryPeriodStart,
      periodStart: transaction.deliveryPeriodStart ?? parsed.deliveryPeriodStart,
      periodEnd: transaction.deliveryPeriodEnd ?? parsed.deliveryPeriodEnd,
      quantity: quantity.value,
      unit: transaction.unit ?? parsed.unit ?? 'KWH',
      qualityStatus: quantity.qualifier,
      registerCode: parsed.references.find((reference) => reference.qualifier === 'AES')?.value ?? null,
      meterNumber: null,
      transactionReference: transaction.transactionId ?? parsed.transactionId,
      measurementResolution: transaction.resolution ?? parsed.resolution,
      utiltsSubtype: parsed.utiltsSubtype,
      sourceOrder: transactionIndex * 10000 + quantityIndex,
    }))
  )
}
