import { beforeEach, expect, it, vi } from 'vitest'
import { energyHandoffMessage } from './helpers/utiltsObservationHandoff'
import { runUtiltsRuntimeForMessage } from '@/lib/ediel/utiltsEngine'
import { resolveCanonicalEdielPolicy } from '@/lib/ediel/rulebook/canonicalEdielPolicy'
import { buildUtiltsTransactionPersistencePayload } from '@/lib/ediel/utilts/transactionPersistence'

const probe = vi.hoisted(() => ({ count: 0 }))
vi.mock('@/lib/ediel/utilts/resolution', async (importOriginal) => {
  const original = await importOriginal<typeof import('@/lib/ediel/utilts/resolution')>()
  return {
    ...original,
    expectedObservationCountForResolution: (...args: Parameters<typeof original.expectedObservationCountForResolution>) => {
      probe.count += 1
      return original.expectedObservationCountForResolution(...args)
    },
  }
})

beforeEach(() => { probe.count = 0 })

function runtime(agency: string) {
  const message = energyHandoffMessage('2026-10-01')
  message.raw_payload = message.raw_payload!.replace('LOC+172+735999260731000007::9', `LOC+175+735999260731000007::${agency}`)
  const canonicalPolicy = resolveCanonicalEdielPolicy({ family: 'UTILTS', messageCode: 'E66', direction: 'inbound',
    referenceDate: '2026-10-01', applicationReference: message.application_reference, mode: 'parse' })
  return runUtiltsRuntimeForMessage(message, { canonicalPolicy })
}

it('does not execute the functional interval-count check for a guide-rejected E66 IDE', () => {
  const rejected = runtime('260')
  expect(rejected.transactionDispositions).toMatchObject([{ disposition: 'guide_rejected', responseType: 'negative_aperak' }])
  expect(rejected.ackPlan.utiltsErrCodes).toEqual([])
  expect(probe.count).toBe(0)
  const accepted = runtime('9')
  expect(accepted.transactionDispositions).toMatchObject([{ disposition: 'accepted' }])
  expect(probe.count).toBeGreaterThan(0)
})

it('runs functional checks only for the valid sibling in a mixed E66 message', () => {
  runtime('9')
  const singleEligibleCount = probe.count
  probe.count = 0

  const message = energyHandoffMessage('2026-10-01')
  const lines = message.raw_payload!.split('\n')
  const start = lines.findIndex(line => line.startsWith('IDE+24+'))
  const end = lines.findIndex(line => line.startsWith('UNT+'))
  const first = lines.slice(start, end).map(line => line.replace('LOC+172+735999260731000007::9', 'LOC+175+735999260731000007::260'))
  const second = lines.slice(start, end).map(line => line.replace('GRIDEX2607E66001', 'GRIDEX2607E66002'))
  lines.splice(start, end - start, ...first, ...second)
  lines[lines.findIndex(line => line.startsWith('UNT+'))] = `UNT+${lines.length - 2}+1'`
  message.raw_payload = lines.join('\n')
  const policy = resolveCanonicalEdielPolicy({ family: 'UTILTS', messageCode: 'E66', direction: 'inbound',
    referenceDate: '2026-10-01', applicationReference: message.application_reference, mode: 'parse' })
  const result = runUtiltsRuntimeForMessage(message, { canonicalPolicy: policy })
  expect(probe.count).toBe(singleEligibleCount)
  expect(result.transactionDispositions).toMatchObject([
    { transactionId: 'GRIDEX2607E66001', disposition: 'guide_rejected', responseType: 'negative_aperak' },
    { transactionId: 'GRIDEX2607E66002', disposition: 'accepted', responseType: 'positive_aperak' },
  ])
  expect(result.ackPlan.aperakApplicationErrors).toEqual(expect.arrayContaining([
    expect.objectContaining({ fieldCode: '533', referenceNumber: 'GRIDEX2607E66001' }),
  ]))
  const persisted = buildUtiltsTransactionPersistencePayload({ messageCode: 'E66', transactions: result.facts.transactions,
    dispositions: result.transactionDispositions, matches: [] })
  expect(persisted.map(item => item.disposition)).toEqual(['guide_rejected', 'accepted'])
  expect(result.ackPlan.utiltsErrCodes).toEqual([])
})

it('does not run functional interval checks when the message header fails its guide', () => {
  const message = energyHandoffMessage('2026-10-01')
  message.raw_payload = message.raw_payload!.replace('GRIDEX2607E66MSG001+9+AB', 'GRIDEX2607E66MSG001+9+XX')
  const result = runUtiltsRuntimeForMessage(message, { referenceDate: '2026-10-01' })
  expect(result.transactionDispositions).toMatchObject([{ disposition: 'guide_rejected', responseType: 'negative_aperak' }])
  expect(result.ackPlan.utiltsErrCodes).toEqual([])
  expect(probe.count).toBe(0)
})
