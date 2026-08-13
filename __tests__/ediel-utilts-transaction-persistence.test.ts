import { describe, expect, it } from 'vitest'

import {
  buildUtiltsTransactionPersistencePayload,
  resolveUtiltsTransactionId,
} from '@/lib/ediel/utilts/transactionPersistence'

describe('UTILTS transaction persistence payload', () => {
  it('synthesizes stable transaction ids that match the SQL persistence fallback', () => {
    expect(resolveUtiltsTransactionId(null, 0)).toBe('transaction-1')
    expect(resolveUtiltsTransactionId('  ', 1)).toBe('transaction-2')
    expect(resolveUtiltsTransactionId('TX-KEEP', 4)).toBe('TX-KEEP')

    const payload = buildUtiltsTransactionPersistencePayload({
      messageCode: 'E66',
      transactions: [
        {
          transactionId: null, meterPointId: '735999000000000001', gridAreaId: 'ABC',
          deliveryPeriodStart: null, deliveryPeriodEnd: null, registrationTime: null,
          resolution: null, unit: 'KWH', transactionReason: null, quantities: [],
          sourceOrder: 0, deliveryPeriodRaw: null, deliveryPeriodFormat: null, resolutionFormat: null,
        },
      ],
      dispositions: [
        { transactionId: null, disposition: 'accepted', responseType: 'positive_aperak', issueCodes: [] },
      ],
      matches: [],
    })

    expect(payload[0]?.transactionId).toBe('transaction-1')
  })

  it('keeps accepted siblings and rejected transaction dispositions independent', () => {
    const payload = buildUtiltsTransactionPersistencePayload({
      messageCode: 'S02',
      transactions: [
        {
          transactionId: 'TX-1', meterPointId: '735999000000000001', gridAreaId: 'ABC',
          deliveryPeriodStart: '2026-08-14T00:00:00Z', deliveryPeriodEnd: '2026-08-14T01:00:00Z',
          registrationTime: null, resolution: '15', unit: 'KWH', transactionReason: 'E03',
          quantities: [{ qualifier: '135', value: 1.5, raw: 'QTY+135:1.5' }], sourceOrder: 0,
          deliveryPeriodRaw: null, deliveryPeriodFormat: null, resolutionFormat: null,
        },
        {
          transactionId: 'TX-2', meterPointId: '735999000000000002', gridAreaId: 'ABC',
          deliveryPeriodStart: '2026-08-14T00:00:00Z', deliveryPeriodEnd: '2026-08-14T01:00:00Z',
          registrationTime: null, resolution: '15', unit: 'KWH', transactionReason: 'E03',
          quantities: [], sourceOrder: 1, deliveryPeriodRaw: null, deliveryPeriodFormat: null,
          resolutionFormat: null,
        },
      ],
      dispositions: [
        { transactionId: 'TX-1', disposition: 'accepted', responseType: 'positive_aperak', issueCodes: [] },
        { transactionId: 'TX-2', disposition: 'guide_rejected', responseType: 'negative_aperak', issueCodes: ['QTY_MISSING'] },
      ],
      matches: [
        { transactionReference: 'TX-1', externalMeteringPointId: '735999000000000001', externalGridAreaId: 'ABC', meteringPointId: '11111111-1111-4111-8111-111111111111' },
      ],
    })

    expect(payload).toHaveLength(2)
    expect(payload[0]).toMatchObject({
      transactionId: 'TX-1', disposition: 'accepted', responseType: 'positive_aperak',
      seriesKind: 'forecast', meteringPointId: '11111111-1111-4111-8111-111111111111',
      externalMeteringPointId: '735999000000000001', gridAreaId: 'ABC',
    })
    expect(payload[0]?.quantities).toEqual([{ qualifier: '135', value: 1.5, raw: 'QTY+135:1.5', observationId: '1' }])
    expect(payload[1]).toMatchObject({
      transactionId: 'TX-2', disposition: 'guide_rejected', responseType: 'negative_aperak', issueCodes: ['QTY_MISSING'],
    })
  })

  it.each([
    ['E66', 'actual'], ['E30', 'actual'], ['S07', 'actual'],
    ['S03', 'aggregate'], ['S04', 'aggregate'], ['E31', 'aggregate'], ['S05', 'aggregate'],
    ['E72', 'request'], ['E73', 'request'], ['E74', 'request'], ['S06', 'request'],
  ] as const)('maps %s to %s persistence', (messageCode, seriesKind) => {
    const [item] = buildUtiltsTransactionPersistencePayload({
      messageCode,
      transactions: [],
      dispositions: [{ transactionId: 'TX', disposition: 'accepted', responseType: 'positive_aperak', issueCodes: [] }],
      matches: [],
    })
    expect(item?.seriesKind).toBe(seriesKind)
  })
})
