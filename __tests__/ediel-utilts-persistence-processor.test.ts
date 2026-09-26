import { beforeEach, expect, it, vi } from 'vitest'
import { processInboundUtiltsMessage } from '@/lib/ediel/flows/utiltsDataRequest.part-2'
import { energyHandoffMessage, observationHandoffMessage } from './helpers/utiltsObservationHandoff'
import { bindingRpcRows } from './helpers/utiltsBoundFixture'
import type { UtiltsBoundPersistenceInput } from '@/lib/ediel/utilts/transactionPersistence'

const io = vi.hoisted(() => ({ get: vi.fn(), update: vi.fn(), event: vi.fn(), ack: vi.fn(), rpc: vi.fn(), from: vi.fn(), meter: vi.fn(), bill: vi.fn(), complete: vi.fn(), findOutbound: vi.fn() }))
vi.mock('@/lib/supabase/service', () => ({ supabaseService: { from: io.from, rpc: io.rpc } }))
vi.mock('@/lib/ediel/db', () => ({ getEdielMessageById: io.get, updateEdielMessageStatus: io.update, createEdielMessageEvent: io.event, linkEdielMessage: vi.fn(), listEdielTestRuns: vi.fn().mockResolvedValue([]) }))
vi.mock('@/lib/ediel/core/kernel', () => ({ createCanonicalAckMessage: io.ack }))
vi.mock('@/lib/ediel/flows/shared', () => ({ ensureActorUserId: (id: string) => id }))
vi.mock('@/lib/metering/normalizeMeteringValues', () => ({ normalizeAndStoreMeteringValue: io.meter }))
vi.mock('@/lib/billing/meterValueBillingMatcher', () => ({ updateMeterValueBillingReadiness: vi.fn() }))
vi.mock('@/lib/cis/db', () => ({ ingestBillingUnderlay: io.bill, findOpenOutboundBySource: io.findOutbound, syncGridOwnerDataRequestReceivedFromEdiel: io.complete }))
vi.mock('@/lib/ediel/matching', () => ({
  matchMeteringPointIdByIdentifier: vi.fn().mockResolvedValue('point-a'),
  matchMeteringPointForEdielMessage: vi.fn().mockResolvedValue('point-a'),
  matchSiteAndCustomerForMeteringPoint: vi.fn().mockResolvedValue({ customerId: 'customer-a', siteId: 'site-a', gridOwnerId: 'owner-a' }),
  findMatchingGridOwnerDataRequest: vi.fn().mockResolvedValue({ id: 'request-a', request_scope: 'billing_underlay', response_payload: {}, customer_id: 'customer-a', metering_point_id: 'point-a' }),
}))
// Parsing, matching orchestration, structural qualification, persistence payload,
// real sinks and ACK planning/drafts all run. Only external reads/writes are fake.
let results: unknown[]
beforeEach(() => {
  vi.clearAllMocks(); results = []; io.findOutbound.mockResolvedValue(null); io.complete.mockResolvedValue(null)
  io.update.mockResolvedValue(null); io.event.mockResolvedValue(null)
  io.meter.mockResolvedValue({ status: 'stored', meteringValue: { id: 'meter-value' } }); io.bill.mockResolvedValue({ id: 'underlay' })
  io.ack.mockImplementation(async ({ ackFamily }) => ({ id: `ack-${ackFamily}` }))
  io.rpc.mockImplementation((name, args) => {
    const input = name === 'gridex_persist_utilts_consumption_v1' ? { companyId: args.p_company_id, environment: args.p_environment, sourceMessageId: args.p_source_message_id, messageCode: args.p_message_code, rawPayload: args.p_raw_payload, transactions: args.p_transactions, contracts: args.p_transactions.map((t: { consumptionContract: unknown }) => t.consumptionContract) } as UtiltsBoundPersistenceInput : null
    const response = input ? { data: bindingRpcRows(input, results), error: null } : { data: null, error: { message: 'unavailable' } }
    return Object.assign(Promise.resolve(response), { abortSignal: () => Promise.resolve(response) })
  })
  io.from.mockImplementation(() => {
    const q = { select: () => q, eq: () => q, in: () => q, lte: () => q, limit: () => q, update: () => q,
      then: (resolve: (value: unknown) => unknown) => Promise.resolve({ data: [], count: 0, error: null }).then(resolve) }
    return q
  })
})
function incoming(held = false, mixed = false, date = '2026-10-01') {
  const message = held ? observationHandoffMessage(date) : energyHandoffMessage(date)
  if(date<'2026-10-01')message.raw_payload=message.raw_payload!.replace('QTY+220:11000','QTY+220:10500')
  message.sender_ediel_id = '91100'; message.receiver_ediel_id = '21660'
  if (mixed) {
    const lines = message.raw_payload!.split('\n')
    const energy = energyHandoffMessage().raw_payload!.split('\n')
    const second = energy.slice(energy.findIndex(line => line.startsWith('IDE+24')), energy.findIndex(line => line.startsWith('UNT+')))
      .map(line => line.replace('GRIDEX2607E66001', 'GRIDEX2607E66002').replace('QTY+136:500', 'QTY+136:7'))
    const close = lines.findIndex(line => line.startsWith('UNT+'))
    lines.splice(close, 0, ...second); lines[close + second.length] = `UNT+${lines.length - 2}+1'`
    message.raw_payload = lines.join('\n')
  }
  return message
}
const accepted = (id: string) => ({ transactionId: id, disposition: 'accepted', responseType: 'positive_aperak', persistenceStatus: 'persisted' })
const failed = { transactionId: 'GRIDEX2607E66001', disposition: 'processability_rejected', responseType: 'utilts_err', persistenceStatus: 'failed', issueCodes: ['UTILTS_PERSISTENCE_FAILED'] }
it('holds an S07 without BGM code-list qualifier SVK before business persistence', async () => {
  const message = observationHandoffMessage('2026-09-30')
  message.message_code = 'S07'; message.application_reference = '23-DDQ-S07-S'
  message.sender_ediel_id = '91100'; message.receiver_ediel_id = '21660'
  message.raw_payload = message.raw_payload!.replace('BGM+E66::260', 'BGM+S07::260')
    .replace('23-DDQ-E66-S', '23-DDQ-S07-S')
  io.get.mockResolvedValue(message)
  results = [{ transactionId: 'GRIDEX2607E66001', disposition: 'guide_rejected', responseType: 'negative_aperak', persistenceStatus: 'not_applicable' }]

  await processInboundUtiltsMessage({ actorUserId: 'actor', edielMessageId: message.id })
  const persisted = io.rpc.mock.calls.find(([name]) => name === 'gridex_persist_utilts_consumption_v1')?.[1]
  expect(persisted?.p_transactions).toMatchObject([{ disposition: 'guide_rejected', responseType: 'negative_aperak' }])
  expect(io.meter).not.toHaveBeenCalled(); expect(io.bill).not.toHaveBeenCalled()
  expect(io.findOutbound).not.toHaveBeenCalled(); expect(io.complete).not.toHaveBeenCalled()
  expect(io.ack.mock.calls.map(([call]) => call.ackFamily)).toContain('APERAK')
  expect(io.ack.mock.calls.map(([call]) => call.ackFamily)).not.toContain('UTILTS_ERR')
  expect(JSON.stringify(io.ack.mock.calls.find(([call]) => call.ackFamily === 'APERAK')![0].draft)).toContain('202')
})
it('rejects a wrong E66 BGM document agency as field 202 before business persistence', async () => {
  const message = observationHandoffMessage('2026-09-30')
  message.sender_ediel_id = '91100'; message.receiver_ediel_id = '21660'
  message.raw_payload = message.raw_payload!.replace('BGM+E66::260', 'BGM+E66::999')
  io.get.mockResolvedValue(message)
  results = [{ transactionId: 'GRIDEX2607E66001', disposition: 'guide_rejected', responseType: 'negative_aperak', persistenceStatus: 'not_applicable' }]

  await processInboundUtiltsMessage({ actorUserId: 'actor', edielMessageId: message.id })
  const persisted = io.rpc.mock.calls.find(([name]) => name === 'gridex_persist_utilts_consumption_v1')?.[1]
  expect(persisted?.p_transactions).toMatchObject([{ transactionId: 'GRIDEX2607E66001', disposition: 'guide_rejected', responseType: 'negative_aperak' }])
  expect(io.meter).not.toHaveBeenCalled(); expect(io.bill).not.toHaveBeenCalled()
  expect(io.findOutbound).not.toHaveBeenCalled(); expect(io.complete).not.toHaveBeenCalled()
  expect(io.ack.mock.calls.map(([call]) => call.ackFamily)).toContain('APERAK')
  expect(io.ack.mock.calls.map(([call]) => call.ackFamily)).not.toContain('UTILTS_ERR')
  const negative = io.ack.mock.calls.find(([call]) => call.ackFamily === 'APERAK')![0]
  expect(JSON.stringify(negative.draft)).toContain('202')
})
it('routes wrong receiver NAD agency 208 to negative APERAK and persists guide rejection without business effects', async () => {
  const message = observationHandoffMessage('2026-09-30')
  message.sender_ediel_id = '91100'; message.receiver_ediel_id = '21660'
  message.raw_payload = message.raw_payload!.replace('NAD+MR+21660:SVK:260', 'NAD+MR+21660:SVK:999')
  io.get.mockResolvedValue(message)
  results = [{ transactionId: 'GRIDEX2607E66001', disposition: 'guide_rejected', responseType: 'negative_aperak', persistenceStatus: 'not_applicable' }]

  await processInboundUtiltsMessage({ actorUserId: 'actor', edielMessageId: message.id })
  const persisted = io.rpc.mock.calls.find(([name]) => name === 'gridex_persist_utilts_consumption_v1')?.[1]
  expect(persisted?.p_company_id).toBe(message.company_id)
  expect(persisted?.p_transactions).toMatchObject([{ disposition: 'guide_rejected', responseType: 'negative_aperak' }])
  expect(io.meter).not.toHaveBeenCalled(); expect(io.bill).not.toHaveBeenCalled(); expect(io.complete).not.toHaveBeenCalled()
  expect(io.ack.mock.calls.map(([call]) => call.ackFamily)).toContain('APERAK')
  expect(io.ack.mock.calls.map(([call]) => call.ackFamily)).not.toContain('UTILTS_ERR')
  expect(JSON.stringify(io.ack.mock.calls.find(([call]) => call.ackFamily === 'APERAK')![0].draft)).toContain('208')
})
it('routes six-digit receiver SVK identifier at 208 to negative APERAK without business effects', async () => {
  const message = observationHandoffMessage('2026-09-30')
  message.sender_ediel_id = '91100'; message.receiver_ediel_id = '21660'
  message.raw_payload = message.raw_payload!.replace('NAD+MR+21660:SVK:260', 'NAD+MR+216600:SVK:260')
  io.get.mockResolvedValue(message)
  results = [{ transactionId: 'GRIDEX2607E66001', disposition: 'guide_rejected', responseType: 'negative_aperak', persistenceStatus: 'not_applicable' }]
  await processInboundUtiltsMessage({ actorUserId: 'actor', edielMessageId: message.id })
  const persisted = io.rpc.mock.calls.find(([name]) => name === 'gridex_persist_utilts_consumption_v1')?.[1]
  expect(persisted?.p_company_id).toBe(message.company_id)
  expect(persisted?.p_transactions).toMatchObject([{ disposition: 'guide_rejected', responseType: 'negative_aperak' }])
  expect(io.meter).not.toHaveBeenCalled(); expect(io.bill).not.toHaveBeenCalled(); expect(io.complete).not.toHaveBeenCalled()
  expect(io.ack.mock.calls.map(([call]) => call.ackFamily)).toContain('APERAK')
  expect(io.ack.mock.calls.map(([call]) => call.ackFamily)).not.toContain('UTILTS_ERR')
  expect(JSON.stringify(io.ack.mock.calls.find(([call]) => call.ackFamily === 'APERAK')![0].draft)).toContain('208')
})
it('routes unknown subordinate header NAD role 509 to negative APERAK without business effects', async () => {
  const message = observationHandoffMessage('2026-09-30')
  message.sender_ediel_id = '91100'; message.receiver_ediel_id = '21660'
  message.raw_payload = message.raw_payload!.replace("NAD+DDQ'", "NAD+BAD'")
  io.get.mockResolvedValue(message)
  results = [{ transactionId: 'GRIDEX2607E66001', disposition: 'guide_rejected', responseType: 'negative_aperak', persistenceStatus: 'not_applicable' }]
  await processInboundUtiltsMessage({ actorUserId: 'actor', edielMessageId: message.id })
  const persisted = io.rpc.mock.calls.find(([name]) => name === 'gridex_persist_utilts_consumption_v1')?.[1]
  expect(persisted?.p_company_id).toBe(message.company_id)
  expect(persisted?.p_transactions).toMatchObject([{ disposition: 'guide_rejected', responseType: 'negative_aperak' }])
  expect(io.meter).not.toHaveBeenCalled(); expect(io.bill).not.toHaveBeenCalled(); expect(io.complete).not.toHaveBeenCalled()
  expect(io.ack.mock.calls.map(([call]) => call.ackFamily)).toContain('APERAK')
  expect(io.ack.mock.calls.map(([call]) => call.ackFamily)).not.toContain('UTILTS_ERR')
  expect(JSON.stringify(io.ack.mock.calls.find(([call]) => call.ackFamily === 'APERAK')![0].draft)).toContain('509')
})
it('rejects a blank E66 BGM document identifier as field 203 before business persistence', async () => {
  const message = observationHandoffMessage('2026-09-30')
  message.sender_ediel_id = '91100'; message.receiver_ediel_id = '21660'
  message.raw_payload = message.raw_payload!.replace('GRIDEX2607E66MSG001+9+AB', '+9+AB')
  io.get.mockResolvedValue(message)
  results = [{ transactionId: 'GRIDEX2607E66001', disposition: 'guide_rejected', responseType: 'negative_aperak', persistenceStatus: 'not_applicable' }]

  await processInboundUtiltsMessage({ actorUserId: 'actor', edielMessageId: message.id })
  const persisted = io.rpc.mock.calls.find(([name]) => name === 'gridex_persist_utilts_consumption_v1')?.[1]
  expect(persisted?.p_transactions).toMatchObject([{ transactionId: 'GRIDEX2607E66001', disposition: 'guide_rejected', responseType: 'negative_aperak' }])
  expect(io.meter).not.toHaveBeenCalled(); expect(io.bill).not.toHaveBeenCalled()
  expect(io.findOutbound).not.toHaveBeenCalled(); expect(io.complete).not.toHaveBeenCalled()
  expect(io.ack.mock.calls.map(([call]) => call.ackFamily)).toContain('APERAK')
  expect(io.ack.mock.calls.map(([call]) => call.ackFamily)).not.toContain('UTILTS_ERR')
  const negative = io.ack.mock.calls.find(([call]) => call.ackFamily === 'APERAK')![0]
  expect(JSON.stringify(negative.draft)).toContain('203')
})
it('rejects an invalid E66 message function as field 204 before business persistence', async () => {
  const message = observationHandoffMessage('2026-09-30')
  message.sender_ediel_id = '91100'; message.receiver_ediel_id = '21660'
  message.raw_payload = message.raw_payload!.replace('GRIDEX2607E66MSG001+9+AB', 'GRIDEX2607E66MSG001+XX+AB')
  io.get.mockResolvedValue(message)
  results = [{ transactionId: 'GRIDEX2607E66001', disposition: 'guide_rejected', responseType: 'negative_aperak', persistenceStatus: 'not_applicable' }]

  await processInboundUtiltsMessage({ actorUserId: 'actor', edielMessageId: message.id })
  const persisted = io.rpc.mock.calls.find(([name]) => name === 'gridex_persist_utilts_consumption_v1')?.[1]
  expect(persisted?.p_transactions).toMatchObject([{ transactionId: 'GRIDEX2607E66001', disposition: 'guide_rejected', responseType: 'negative_aperak' }])
  expect(io.meter).not.toHaveBeenCalled(); expect(io.bill).not.toHaveBeenCalled()
  expect(io.findOutbound).not.toHaveBeenCalled(); expect(io.complete).not.toHaveBeenCalled()
  expect(io.ack.mock.calls.map(([call]) => call.ackFamily)).toContain('APERAK')
  expect(io.ack.mock.calls.map(([call]) => call.ackFamily)).not.toContain('UTILTS_ERR')
  const negative = io.ack.mock.calls.find(([call]) => call.ackFamily === 'APERAK')![0]
  expect(JSON.stringify(negative.draft)).toContain('204')
})
it('rejects an impossible E66 message date as field 205 before business persistence', async () => {
  const message = observationHandoffMessage('2026-09-30')
  message.sender_ediel_id = '91100'; message.receiver_ediel_id = '21660'
  message.raw_payload = message.raw_payload!.replace('DTM+137:202609301811:203', 'DTM+137:202602301811:203')
  io.get.mockResolvedValue(message)
  results = [{ transactionId: 'GRIDEX2607E66001', disposition: 'guide_rejected', responseType: 'negative_aperak', persistenceStatus: 'not_applicable' }]

  await processInboundUtiltsMessage({ actorUserId: 'actor', edielMessageId: message.id })
  const persisted = io.rpc.mock.calls.find(([name]) => name === 'gridex_persist_utilts_consumption_v1')?.[1]
  expect(persisted?.p_transactions).toMatchObject([{ transactionId: 'GRIDEX2607E66001', disposition: 'guide_rejected', responseType: 'negative_aperak' }])
  expect(io.meter).not.toHaveBeenCalled(); expect(io.bill).not.toHaveBeenCalled()
  expect(io.findOutbound).not.toHaveBeenCalled(); expect(io.complete).not.toHaveBeenCalled()
  expect(io.ack.mock.calls.map(([call]) => call.ackFamily)).toContain('APERAK')
  expect(io.ack.mock.calls.map(([call]) => call.ackFamily)).not.toContain('UTILTS_ERR')
  const negative = io.ack.mock.calls.find(([call]) => call.ackFamily === 'APERAK')![0]
  expect(JSON.stringify(negative.draft)).toContain('205')
})
it('keeps an E66 without timezone out of meter and billing effects and emits only field 206 APERAK', async () => {
  const message = observationHandoffMessage('2026-09-30')
  message.sender_ediel_id = '91100'; message.receiver_ediel_id = '21660'
  message.raw_payload = message.raw_payload!.replace("DTM+735:?+0200:406'\n", '').replace('UNT+35+1', 'UNT+34+1')
  io.get.mockResolvedValue(message)
  results = [{ transactionId: 'GRIDEX2607E66001', disposition: 'guide_rejected', responseType: 'negative_aperak', persistenceStatus: 'not_applicable' }]

  await processInboundUtiltsMessage({ actorUserId: 'actor', edielMessageId: message.id })
  const persisted = io.rpc.mock.calls.find(([name]) => name === 'gridex_persist_utilts_consumption_v1')?.[1]
  expect(persisted?.p_transactions).toMatchObject([{ transactionId: 'GRIDEX2607E66001', disposition: 'guide_rejected', responseType: 'negative_aperak' }])
  expect(io.meter).not.toHaveBeenCalled(); expect(io.bill).not.toHaveBeenCalled()
  expect(io.findOutbound).not.toHaveBeenCalled(); expect(io.complete).not.toHaveBeenCalled()
  expect(io.ack.mock.calls.map(([call]) => call.ackFamily)).toContain('APERAK')
  expect(io.ack.mock.calls.map(([call]) => call.ackFamily)).not.toContain('UTILTS_ERR')
  const negative = io.ack.mock.calls.find(([call]) => call.ackFamily === 'APERAK')![0]
  expect(JSON.stringify(negative.draft)).toContain('206')
})
it('saves no E66 business effect and emits only field 313 negative APERAK for a bad header', async () => {
  const message = observationHandoffMessage('2026-09-30')
  message.sender_ediel_id = '91100'; message.receiver_ediel_id = '21660'
  message.raw_payload = message.raw_payload!.replace('GRIDEX2607E66MSG001+9+AB', 'GRIDEX2607E66MSG001+9+XX')
  io.get.mockResolvedValue(message)
  results = [{ transactionId: 'GRIDEX2607E66001', disposition: 'guide_rejected', responseType: 'negative_aperak', persistenceStatus: 'not_applicable' }]

  await processInboundUtiltsMessage({ actorUserId: 'actor', edielMessageId: message.id })
  const persisted = io.rpc.mock.calls.find(([name]) => name === 'gridex_persist_utilts_consumption_v1')?.[1]
  expect(persisted?.p_transactions).toMatchObject([{ transactionId: 'GRIDEX2607E66001', disposition: 'guide_rejected', responseType: 'negative_aperak' }])
  expect(persisted?.p_transactions[0].quantities).toHaveLength(3)
  expect(io.meter).not.toHaveBeenCalled(); expect(io.bill).not.toHaveBeenCalled()
  expect(io.findOutbound).not.toHaveBeenCalled(); expect(io.complete).not.toHaveBeenCalled()
  expect(io.ack.mock.calls.map(([call]) => call.ackFamily)).toContain('APERAK')
  expect(io.ack.mock.calls.map(([call]) => call.ackFamily)).not.toContain('UTILTS_ERR')
  const negative = io.ack.mock.calls.find(([call]) => call.ackFamily === 'APERAK')![0]
  expect(JSON.stringify(negative.draft)).toContain('313')
})
for (const mixed of [false, true]) it(`processor excludes failed persistence and retains ERR${mixed ? ' with accepted sibling' : ''}`, async () => {
  const message = incoming(false, mixed); io.get.mockResolvedValue(message)
  results = mixed ? [failed, accepted('GRIDEX2607E66002')] : [failed]
  const result = await processInboundUtiltsMessage({ actorUserId: 'actor', edielMessageId: message.id })
  expect(io.rpc).toHaveBeenCalledWith('gridex_persist_utilts_consumption_v1', expect.objectContaining({ p_company_id: 'tenant-a', p_source_message_id: message.id }))
  expect(io.ack.mock.calls.map(([call]) => call.ackFamily)).toContain('UTILTS_ERR')
  if (mixed) {
    expect(io.meter).toHaveBeenCalledTimes(1)
    expect(io.meter).toHaveBeenCalledWith(expect.objectContaining({ quantityKwh: 7, companyId: 'tenant-a', sourceTransactionReference: 'GRIDEX2607E66002' }))
    expect(io.bill).toHaveBeenCalledWith(expect.objectContaining({ totalKwh: 7, customerId: 'customer-a' }))
    expect(io.ack.mock.calls.map(([call]) => call.ackFamily)).toContain('APERAK')
  } else {
    expect(io.meter).not.toHaveBeenCalled(); expect(io.bill).not.toHaveBeenCalled()
    expect(result).toMatchObject({ ingestedMeterValueIds: [], billingUnderlayId: null })
    expect(io.findOutbound).not.toHaveBeenCalled(); expect(io.complete).not.toHaveBeenCalled()
    expect(io.update).toHaveBeenLastCalledWith(expect.objectContaining({ failureReason: 'utilts_transaction_persistence_failed', validationReport: expect.objectContaining({ utiltsRuntime: expect.objectContaining({ validation: expect.objectContaining({ ok: false, classification: 'functional_rejected' }) }) }) }))
    expect(io.ack.mock.calls.map(([call]) => call.ackFamily)).not.toContain('APERAK')
  }
})
for (const invalid of ['missing', 'duplicate', 'unrelated', 'contradictory']) it(`real processor rejects ${invalid} persistence evidence before ACK or completion`, async () => {
  const message = incoming(); io.get.mockResolvedValue(message)
  if (invalid === 'duplicate') results = [accepted('GRIDEX2607E66001'), accepted('GRIDEX2607E66001')]
  if (invalid === 'unrelated') results = [accepted('OTHER')]
  if (invalid === 'contradictory') results = [{ ...accepted('GRIDEX2607E66001'), disposition: 'internal_review' }]
  await expect(processInboundUtiltsMessage({ actorUserId: 'actor', edielMessageId: message.id })).rejects.toThrow('utilts_transaction_persistence_invalid_result')
  expect(io.meter).not.toHaveBeenCalled(); expect(io.bill).not.toHaveBeenCalled()
  expect(io.ack).not.toHaveBeenCalled(); expect(io.findOutbound).not.toHaveBeenCalled(); expect(io.complete).not.toHaveBeenCalled()
})
it('held sibling keeps its empty persisted quantities and no positive ACK while accepted sibling persists', async () => {
  const message = incoming(true, true); io.get.mockResolvedValue(message)
  results = [{ transactionId: 'GRIDEX2607E66001', disposition: 'internal_review', responseType: 'none', persistenceStatus: 'not_applicable' }, accepted('GRIDEX2607E66002')]
  const result = await processInboundUtiltsMessage({ actorUserId: 'actor', edielMessageId: message.id })
  expect(result.internalReviewRequired).toBe(true)
  const call = io.rpc.mock.calls.find(([name]) => name === 'gridex_persist_utilts_consumption_v1')!
  expect(call[1].p_transactions).toMatchObject([{ transactionId: 'GRIDEX2607E66001', disposition: 'internal_review', quantities: [] }, { transactionId: 'GRIDEX2607E66002', disposition: 'accepted', quantities: [{ value: 7 }] }])
  const aperaks = io.ack.mock.calls.filter(([call]) => call.ackFamily === 'APERAK')
  expect(aperaks).toHaveLength(1)
  expect(JSON.stringify(aperaks[0][0].draft)).toContain('GRIDEX2607E66002')
  expect(io.ack.mock.calls.map(([call]) => call.ackFamily)).not.toContain('UTILTS_ERR')
  expect(io.meter).not.toHaveBeenCalled(); expect(io.bill).not.toHaveBeenCalled()
})
it('real inbound keeps a guide-invalid E66 IDE separate from a valid sibling through persistence and ACK', async () => {
  const message = incoming(true, true)
  message.raw_payload = message.raw_payload!.replace('LOC+172+735999260731000007::9', 'LOC+175+735999260731000007::260')
  io.get.mockResolvedValue(message)
  results = [
    { transactionId: 'GRIDEX2607E66001', disposition: 'guide_rejected', responseType: 'negative_aperak', persistenceStatus: 'not_applicable' },
    accepted('GRIDEX2607E66002'),
  ]
  await processInboundUtiltsMessage({ actorUserId: 'actor', edielMessageId: message.id })
  const persisted = io.rpc.mock.calls.find(([name]) => name === 'gridex_persist_utilts_consumption_v1')![1].p_transactions
  expect(persisted).toMatchObject([
    { transactionId: 'GRIDEX2607E66001', disposition: 'guide_rejected', responseType: 'negative_aperak' },
    { transactionId: 'GRIDEX2607E66002', disposition: 'accepted', responseType: 'positive_aperak' },
  ])
  expect(io.ack.mock.calls.map(([call]) => call.ackFamily)).not.toContain('UTILTS_ERR')
  expect(io.ack.mock.calls.filter(([call]) => call.ackFamily === 'APERAK')).toHaveLength(2)
  expect(io.meter).not.toHaveBeenCalled(); expect(io.bill).not.toHaveBeenCalled()
})
it('prior applicable reading is held while an eligible 15-minute energy sibling stays independent in the actual processor',async()=>{
 const message=incoming(true,true,'2026-09-30');io.get.mockResolvedValue(message)
 results=[{transactionId:'GRIDEX2607E66001',disposition:'internal_review',responseType:'none',persistenceStatus:'not_applicable'},accepted('GRIDEX2607E66002')]
 const result=await processInboundUtiltsMessage({actorUserId:'actor',edielMessageId:message.id})
 expect(result.internalReviewRequired).toBe(true)
 const persisted=io.rpc.mock.calls.find(([name])=>name==='gridex_persist_utilts_consumption_v1')![1]
 expect(persisted.p_transactions).toMatchObject([{disposition:'internal_review',responseType:'none',quantities:[]},
  {disposition:'accepted',responseType:'positive_aperak',quantities:[{value:7}]}])
 const aperaks=io.ack.mock.calls.filter(([call])=>call.ackFamily==='APERAK')
 expect(aperaks).toHaveLength(1)
 expect(JSON.stringify(aperaks[0][0].draft)).not.toContain('GRIDEX2607E66001')
 expect(io.meter).not.toHaveBeenCalled();expect(io.bill).not.toHaveBeenCalled()
})
it('prior held reading, exempt energy and E19-rejected sibling retain three independent processor outcomes',async()=>{
 const message=incoming(true,true,'2026-09-30')
 const lines=message.raw_payload!.split('\n'),first=lines.findIndex(line=>line.startsWith('IDE+24+')),
  second=lines.findIndex((line,index)=>index>first&&line.startsWith('IDE+24+')),
  end=lines.findIndex(line=>line.startsWith('UNT+'))
 const rejected=lines.slice(first,second).map(line=>line.replace('GRIDEX2607E66001','GRIDEX2607E66003').replace('QTY+220:10500','QTY+220:11000'))
 lines.splice(end,0,...rejected);lines[end+rejected.length]=`UNT+${lines.length-2}+1'`
 message.raw_payload=lines.join('\n');io.get.mockResolvedValue(message)
 results=[{transactionId:'GRIDEX2607E66001',disposition:'internal_review',responseType:'none',persistenceStatus:'not_applicable'},
  accepted('GRIDEX2607E66002'),{transactionId:'GRIDEX2607E66003',disposition:'processability_rejected',responseType:'utilts_err',persistenceStatus:'not_applicable'}]
 await processInboundUtiltsMessage({actorUserId:'actor',edielMessageId:message.id})
 const persisted=io.rpc.mock.calls.find(([name])=>name==='gridex_persist_utilts_consumption_v1')![1].p_transactions
 expect(persisted).toMatchObject([{disposition:'internal_review',quantities:[]},
  {disposition:'accepted',quantities:[{value:7}]},{disposition:'processability_rejected',responseType:'utilts_err'}])
 expect(io.ack.mock.calls.filter(([call])=>call.ackFamily==='APERAK')).toHaveLength(1)
 expect(io.ack.mock.calls.filter(([call])=>call.ackFamily==='UTILTS_ERR')).toHaveLength(1)
 expect(io.meter).not.toHaveBeenCalled();expect(io.bill).not.toHaveBeenCalled()
})

for (const invalid of ['missing tenant', 'duplicate physical identities']) it(`processor stops ${invalid} before ACK, sinks or completion`, async () => {
  const message = incoming()
  if (invalid === 'missing tenant') message.company_id = null
  else message.raw_payload = message.raw_payload! + message.raw_payload!.slice(9)
  io.get.mockResolvedValue(message)
  results = [accepted('GRIDEX2607E66001'), accepted('GRIDEX2607E66001')]
  await expect(processInboundUtiltsMessage({ actorUserId: 'actor', edielMessageId: message.id })).rejects.toThrow(
    invalid === 'missing tenant' ? 'saknar tenantkoppling' : 'utilts_transaction_persistence_invalid_result',
  )
  expect(io.ack).not.toHaveBeenCalled(); expect(io.meter).not.toHaveBeenCalled(); expect(io.bill).not.toHaveBeenCalled()
  expect(io.findOutbound).not.toHaveBeenCalled(); expect(io.complete).not.toHaveBeenCalled()
})

it('failed persistence dominates the certified forced-positive ACK plan', async () => {
  const message = incoming(); io.get.mockResolvedValue(message); results = [failed]
  await processInboundUtiltsMessage({ actorUserId: 'actor', edielMessageId: message.id, testCaseCode: 'U3.1.1' })
  expect(io.ack.mock.calls.map(([call]) => call.ackFamily)).toContain('UTILTS_ERR')
  expect(io.ack.mock.calls.map(([call]) => call.ackFamily)).not.toContain('APERAK')
  expect(io.meter).not.toHaveBeenCalled(); expect(io.bill).not.toHaveBeenCalled()
  expect(io.findOutbound).not.toHaveBeenCalled(); expect(io.complete).not.toHaveBeenCalled()
  expect(io.update).toHaveBeenLastCalledWith(expect.objectContaining({ failureReason: 'utilts_transaction_persistence_failed' }))
})
