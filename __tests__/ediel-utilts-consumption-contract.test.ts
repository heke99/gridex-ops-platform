import { expect, it, vi } from 'vitest'
import { prepareUtiltsConsumptionContracts } from '@/lib/ediel/utilts/consumptionPreparation'
import { buildUtiltsTransactionPersistencePayload, validateUtiltsPersistenceResults } from '@/lib/ediel/utilts/transactionPersistence'
import { resolveCanonicalMessagePolicy } from '@/lib/ediel/core/messagePolicy'
import { runUtiltsRuntimeForMessage } from '@/lib/ediel/utiltsEngine'
import { energyHandoffMessage } from './helpers/utiltsObservationHandoff'
import { consumptionEqual, validateUtiltsConsumptionContract } from '@/lib/ediel/utilts/consumptionContract'
vi.mock('@/lib/ediel/matching', () => ({ matchMeteringPointIdByIdentifier: vi.fn().mockResolvedValue('point'), matchSiteAndCustomerForMeteringPoint: vi.fn().mockResolvedValue({ customerId: 'customer', siteId: 'site', gridOwnerId: 'owner' }) }))
async function preparedEnergy(code: 'E66' | 'E30' | 'S07' = 'E66') {
  const message = energyHandoffMessage()
  message.message_code = code
  message.application_reference = code === 'E30' ? '23-MDR-E30-T' : `23-DDQ-${code}-T`
  message.raw_payload = message.raw_payload!.replace('?+0200:406', '?+0100:406').replace('BGM+E66', `BGM+${code}`).replace('23-DDQ-E66-T', message.application_reference)
  const runtime = runUtiltsRuntimeForMessage(message), policy = resolveCanonicalMessagePolicy(message)!
  const contracts = await prepareUtiltsConsumptionContracts({ message, runtime, policy, matches: [], dataRequest: null,
    fallback: { customerId: 'customer', siteId: 'site', meteringPointId: 'point', gridOwnerId: 'owner' }, allowConsumption: code !== 'S07' })
  return { message, contracts, input: { companyId: message.company_id!, environment: message.environment, sourceMessageId: message.id, messageCode: code, rawPayload: message.raw_payload!, contracts,
    transactions: buildUtiltsTransactionPersistencePayload({ messageCode: code, transactions: runtime.facts.transactions, dispositions: runtime.transactionDispositions, matches: [] }) } }
}
it('prepares actual absolute observations and freezes resolved attribution before persistence', async () => {
  const { contracts } = await preparedEnergy()
  expect(contracts[0]).toMatchObject({ interpretation: { offsetMinutes: 60, resolutionFormat: '806' }, metering: { capability: 'write', customerId: 'customer', meteringPointId: 'point' }, observations: [{ quantity: 500, periodStart: '2026-06-30T23:00:00.000Z', periodEnd: '2026-06-30T23:15:00.000Z', readAt: '2026-06-30T23:15:00.000Z', resolution: 'PT15M' }] })
})
it('E30 projection resolves local interval arithmetic before extraction and S07 cannot consume', async () => {
  const e30 = await preparedEnergy('E30'), s07 = await preparedEnergy('S07')
  expect(e30.contracts[0]).toMatchObject({ messageCode: 'E30', observations: [{ quantity: 500, periodStart: '2026-06-30T23:00:00.000Z', periodEnd: '2026-06-30T23:15:00.000Z', resolution: 'PT15M' }] })
  expect(s07.contracts[0]).toMatchObject({ messageCode: 'S07', observations: [], metering: { capability: 'skip' }, billing: { capability: 'skip' }, interpretation: { timestampPolicy: 'no-consumption-v1' } })
})
it.each(['quantity', 'unknown version', 'missing offset', 'missing field', 'unordered observations'])('rejects invalid contract: %s', async kind => {
  const { contracts } = await preparedEnergy()
  const c = structuredClone(contracts[0]) as unknown as Record<string, unknown>
  if (kind === 'quantity') (c.observations as Record<string, unknown>[])[0].quantity = Number.NaN
  if (kind === 'unknown version') c.version = 2
  if (kind === 'missing field') delete c.attributionVersion
  if (kind === 'missing offset') (c.observations as Record<string, unknown>[])[0].periodStart = '2026-06-30T23:00:00'
  if (kind === 'unordered observations') (c.observations as Record<string, unknown>[])[0].ordinal = 9
  expect(() => validateUtiltsConsumptionContract(c)).toThrow('utilts_consumption_binding_conflict')
})
it('object key order is not semantic while observation order is', () => {
  expect(consumptionEqual({ a: 1, b: [1, 2] }, { b: [1, 2], a: 1 })).toBe(true)
  expect(consumptionEqual([1, 2], [2, 1])).toBe(false)
})
it('rejects the old successful RPC shape without any stored authority', async () => {
  const { input } = await preparedEnergy()
  expect(() => validateUtiltsPersistenceResults(input, [{ transactionId: input.transactions[0].transactionId, disposition: 'accepted', responseType: 'positive_aperak', persistenceStatus: 'persisted' }])).toThrow('source_binding')
})
