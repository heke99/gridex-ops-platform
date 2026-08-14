import fs from 'node:fs'
import path from 'node:path'
import { describe, expect, it } from 'vitest'

import { getUtiltsAckTransactionTargets } from '@/lib/ediel/ack'
import type { EdielMessageRow } from '@/lib/ediel/types'
import {
  buildUtiltsTransactionPersistencePayload,
  resolveUtiltsTransactionId,
} from '@/lib/ediel/utilts/transactionPersistence'
import { resolveUtiltsTransactionId as resolveFromIdentity } from '@/lib/ediel/utilts/transactionIdentity'

describe('UTILTS transaction persistence payload', () => {
  it('synthesizes stable transaction ids that match the SQL persistence fallback', () => {
    expect(resolveUtiltsTransactionId(null, 0)).toBe('transaction-1')
    expect(resolveUtiltsTransactionId('  ', 1)).toBe('transaction-2')
    expect(resolveUtiltsTransactionId('TX-KEEP', 4)).toBe('TX-KEEP')
    expect(resolveFromIdentity(null, 0)).toBe('transaction-1')

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

  it('fallback ACK targets keep null IDE+24 groups via transaction-N synthesis', () => {
    const message = {
      message_family: 'UTILTS',
      raw_payload:
        "UNA:+.? 'UNB+UNOC:3+SENDER:14+RECEIVER:14+260813:1200+REF1++E66++1'" +
        "UNH+1+UTILTS:D:09B:UN:E2SE1'BGM+E66+MSG1+9'" +
        "LOC+172+735999000000000001'QTY+220:1.5'UNT+5+1'UNZ+1+REF1'",
    } as EdielMessageRow

    expect(getUtiltsAckTransactionTargets(message)).toEqual([
      expect.objectContaining({
        reference: 'transaction-1',
        transactionId: null,
        meterPointId: '735999000000000001',
      }),
    ])
  })

  it('tenant match builder synthesizes the same null-id fallback used by persistence/ACK', () => {
    const source = fs.readFileSync(
      path.join(process.cwd(), 'lib/ediel/flows/utiltsDataRequest.ts'),
      'utf8',
    )
    const matchBuilder = source.match(
      /async function matchUtiltsTransactionsForTenant[\s\S]*?^async function /m,
    )?.[0]
    expect(matchBuilder).toBeTruthy()
    expect(matchBuilder).toMatch(
      /for \(const \[transactionIndex, transaction\] of transactions\.entries\(\)\)/,
    )
    expect(matchBuilder).toMatch(
      /resolveUtiltsTransactionId\(\s*transaction\.transactionId,\s*transactionIndex,\s*\)/,
    )
    expect(matchBuilder).not.toContain(
      'const transactionReference = stringOrNull(transaction.transactionId)',
    )
  })

  it('joins synthesized null-id matches so meteringPointId is retained', () => {
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
      matches: [
        {
          transactionReference: 'transaction-1',
          externalMeteringPointId: '735999000000000001',
          externalGridAreaId: 'ABC',
          meteringPointId: '11111111-1111-4111-8111-111111111111',
        },
      ],
    })

    expect(payload[0]).toMatchObject({
      transactionId: 'transaction-1',
      meteringPointId: '11111111-1111-4111-8111-111111111111',
      externalMeteringPointId: '735999000000000001',
    })
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
