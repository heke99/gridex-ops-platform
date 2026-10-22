// reality-defects: J2 (reality scenario J2 "inbound UTILTS", J2-04 a monthly E66 for part of a month is accepted by the runtime but never consumed)
// The real UTILTS runtime (lib/ediel/utiltsEngine runUtiltsRuntimeForMessage) and the real consumption preparation
// (lib/ediel/utilts/consumptionPreparation prepareUtiltsConsumptionContracts), which processInboundUtiltsMessage
// runs before persistence and before any APERAK (lib/ediel/flows/utiltsDataRequest.part-2.ts:490). A supply that
// starts or ends mid-month, or a meter change, gives a monthly energy value (DTM+354 1:802) for a period shorter
// than a month. The runtime plans a positive APERAK for it, but preparation throws, so the source is never
// persisted, never acknowledged and the value never stored. The defect is open (approved U-09/U-10 area, patch in
// the J2 report): the first case is it.fails until it is fixed. Synthetic wire only.
import { expect, it, vi } from 'vitest'
import { prepareUtiltsConsumptionContracts } from '@/lib/ediel/utilts/consumptionPreparation'
import { resolveCanonicalMessagePolicy } from '@/lib/ediel/core/messagePolicy'
import { runUtiltsRuntimeForMessage } from '@/lib/ediel/utiltsEngine'
import { energyHandoffMessage } from './helpers/utiltsObservationHandoff'
vi.mock('@/lib/ediel/matching', () => ({ matchMeteringPointIdByIdentifier: vi.fn().mockResolvedValue('point'), matchSiteAndCustomerForMeteringPoint: vi.fn().mockResolvedValue({ customerId: 'customer', siteId: 'site', gridOwnerId: 'owner' }) }))

/** One monthly energy value (QTY+136) for the period start..end (fixed +0100), registered after the period. */
async function monthly(periodEnd: string, registered: string) {
  const message = energyHandoffMessage()
  message.raw_payload = message.raw_payload!.replace('?+0200:406', '?+0100:406').replace('15:806', '1:802')
    .replace('202607010000202607010015:719', `202607010000${periodEnd}:719`).replace('DTM+597:202607010020:203', `DTM+597:${registered}:203`)
  const runtime = runUtiltsRuntimeForMessage(message), policy = resolveCanonicalMessagePolicy(message)!
  const prepare = () => prepareUtiltsConsumptionContracts({ message, runtime, policy, matches: [], dataRequest: null,
    fallback: { customerId: 'customer', siteId: 'site', meteringPointId: 'point', gridOwnerId: 'owner' }, allowConsumption: true })
  return { runtime, prepare }
}

it.fails('J2-04: a monthly value for 1–16 July (supply end or meter change on the 16th) is prepared for its own period', async () => {
  const { runtime, prepare } = await monthly('202607160000', '202607160600')
  expect(runtime.transactionDispositions).toMatchObject([{ disposition: 'accepted', responseType: 'positive_aperak' }])
  // Today: utilts_consumption_binding_conflict:observation_interval_unresolved (start + 1 month > declared end).
  const contracts = await prepare()
  expect(contracts[0].observations).toMatchObject([{ quantity: '500', periodStart: '2026-06-30T23:00:00.000Z', periodEnd: '2026-07-15T23:00:00.000Z' }])
})

it('J2-04 evidence: the runtime promises a positive APERAK while preparation refuses the same transaction', async () => {
  const { runtime, prepare } = await monthly('202607160000', '202607160600')
  expect(runtime.validation.ok).toBe(true)
  expect(runtime.transactionDispositions).toMatchObject([{ disposition: 'accepted', responseType: 'positive_aperak' }])
  await expect(prepare()).rejects.toThrow('utilts_consumption_binding_conflict:observation_interval_unresolved')
})

it('control: the full month is prepared', async () => {
  const { prepare } = await monthly('202608010000', '202608010600')
  const contracts = await prepare()
  expect(contracts[0].observations).toMatchObject([{ quantity: '500', periodStart: '2026-06-30T23:00:00.000Z', periodEnd: '2026-07-31T23:00:00.000Z', resolution: 'P1M' }])
})
