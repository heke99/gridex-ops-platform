import { describe, expect, it } from 'vitest'
import { energyHandoffMessage } from './helpers/utiltsObservationHandoff'
import { runUtiltsRuntimeForMessage } from '@/lib/ediel/utiltsEngine'
import { buildUtiltsTransactionPersistencePayload } from '@/lib/ediel/utilts/transactionPersistence'
import { flattenUtiltsTransactionSeries } from '@/lib/ediel/flows/utiltsDataRequest.part-1'

describe('successful retry actual projection counterexamples', () => {
  it('runtime timezone mutation changes consumption while legacy transaction payload stays equal', () => {
    const original = energyHandoffMessage()
    const changed = { ...original, raw_payload: original.raw_payload!.replace('?+0200:406', '?+0100:406') }
    const a = runUtiltsRuntimeForMessage(original)
    const b = runUtiltsRuntimeForMessage(changed)
    expect(a.validation.ok).toBe(true)
    expect(b.validation.ok).toBe(true)
    const legacy = (runtime: typeof a) => buildUtiltsTransactionPersistencePayload({ messageCode: 'E66', transactions: runtime.facts.transactions, dispositions: runtime.transactionDispositions, matches: [] })
    expect(legacy(a)).toEqual(legacy(b))
    expect(flattenUtiltsTransactionSeries(a.normalizedPayload, original)[0]).toMatchObject({ quantity: 500, periodStart: '2026-06-30T22:00:00.000Z', periodEnd: '2026-06-30T22:15:00.000Z' })
    expect(flattenUtiltsTransactionSeries(b.normalizedPayload, changed)[0]).toMatchObject({ quantity: 500, periodStart: '2026-06-30T23:00:00.000Z', periodEnd: '2026-06-30T23:15:00.000Z' })
  })
  it('characterizes the actual runtime format surface without claiming national qualification', () => {
    const message = energyHandoffMessage()
    message.raw_payload = message.raw_payload!.replace('15:806', '15:805').replace('?+0200:406', '?+0100:406')
    const runtime = runUtiltsRuntimeForMessage(message)
    expect(runtime.validation.ok).toBe(true)
    expect(runtime.normalizedPayload.resolution).toBe('PT15H')
  })
  it('separately valid equivalent hour/minute spellings retain their distinct source inputs', () => {
    const original = energyHandoffMessage()
    const hour = { ...original, raw_payload: original.raw_payload!.replace('?+0200:406', '?+0100:406').replace('15:806', '1:805').replace('202607010000202607010015:719', '202607010000202607010100:719') }
    const minute = { ...hour, raw_payload: hour.raw_payload!.replace('1:805', '60:806') }
    const a = runUtiltsRuntimeForMessage(hour), b = runUtiltsRuntimeForMessage(minute)
    expect(a.validation.ok).toBe(true); expect(b.validation.ok).toBe(true)
    expect(a.normalizedPayload.resolution).toBe('PT1H'); expect(b.normalizedPayload.resolution).toBe('PT60M')
    expect(flattenUtiltsTransactionSeries(a.normalizedPayload, hour)[0].periodEnd).toBe(flattenUtiltsTransactionSeries(b.normalizedPayload, minute)[0].periodEnd)
    expect(a.facts.transactions[0].resolutionFormat).toBe('805'); expect(b.facts.transactions[0].resolutionFormat).toBe('806')
  })
})
