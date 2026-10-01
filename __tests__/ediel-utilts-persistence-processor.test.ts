import { createUtiltsFinalValidationIo, qualifyUtiltsFixtureSource as registerFixtureSource, currentUtiltsActorQuery, UTILTS_FIXTURE_ACTOR } from './helpers/utiltsCurrentOwnerFixture'
import { beforeEach, expect, it, vi } from 'vitest'
import { processInboundUtiltsMessage } from '@/lib/ediel/flows/utiltsDataRequest.part-2'
import { runUtiltsRuntimeForMessage } from '@/lib/ediel/utiltsEngine'
import { energyHandoffMessage, observationHandoffMessage } from './helpers/utiltsObservationHandoff'
import { recountEdifactUnt } from './helpers/recountEdifactUnt'
import { e72PointRequestMessage } from './helpers/utiltsE72PointRequest'
import { bindingRpcRows } from './helpers/utiltsBoundFixture'
import {receivedUtiltsOwnerFixture,resetUtiltsCanonicalOwnerIo} from './helpers/utiltsCanonicalOwnerIo'
import {createHash} from 'node:crypto'
import type {EdielMessageRow} from '@/lib/ediel/types'
import {segmentUntrimmedRaw,tokenizeEdifact} from '@/lib/ediel/core/edifactTokenizer'
import { findMatchingGridOwnerDataRequest } from '@/lib/ediel/matching'
import type { UtiltsBoundPersistenceInput } from '@/lib/ediel/utilts/transactionPersistence'

const io = vi.hoisted(() => ({ get: vi.fn(), update: vi.fn(), event: vi.fn(), ack: vi.fn(), rpc: vi.fn(), from: vi.fn(), meter: vi.fn(), bill: vi.fn(), complete: vi.fn(), findOutbound: vi.fn() }))
vi.mock('@/lib/supabase/service', () => ({ supabaseService: { from: io.from, rpc: io.rpc } }))
vi.mock('@/lib/ediel/db', () => ({ getEdielMessageById: async(...args:unknown[])=>{const message=await io.get(...args);if(!message)return message;if(args[0]!==message.id||message.execution_context_snapshot.receivedUtiltsContext.payloadHash!==hash(message.raw_payload))throw Error('fixture_actual_immutable_source_scope_required');return message}, updateEdielMessageStatus: io.update, createEdielMessageEvent: io.event, linkEdielMessage: vi.fn(), listEdielTestRuns: vi.fn().mockResolvedValue([]) }))
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
// Actual parsing/national rules, opaque initial/final owner, matching
// orchestration, contracts and ACK renderer run. Native/registry/identity and
// sink IO is explicitly modeled; this grants no native/legal acceptance proof.
let sourceOrdinal=0
let declaredSources=new WeakSet<object>()
const hash=(value:string)=>createHash('sha256').update(value).digest('hex')
let results: unknown[] | undefined
beforeEach(() => {
  vi.clearAllMocks();resetUtiltsCanonicalOwnerIo();sourceOrdinal=0;declaredSources=new WeakSet();results = []; io.findOutbound.mockResolvedValue(null); io.complete.mockResolvedValue(null)
  io.update.mockResolvedValue(null); io.event.mockResolvedValue(null)
  io.meter.mockResolvedValue({ status: 'stored', meteringValue: { id: 'meter-value' } }); io.bill.mockResolvedValue({ id: 'underlay' })
  io.ack.mockImplementation(async ({ ackFamily }) => ({ id: `ack-${ackFamily}` }))
  const finalValidationIo = createUtiltsFinalValidationIo()
  io.rpc.mockImplementation((name, args) => {
    const canonical = finalValidationIo(name, args)
    if (canonical) return canonical
    const input = name === 'gridex_persist_utilts_consumption_v1' ? { companyId: args.p_company_id, environment: args.p_environment, sourceMessageId: args.p_source_message_id, messageCode: args.p_message_code, rawPayload: args.p_raw_payload, transactions: args.p_transactions, contracts: args.p_transactions.map((t: { consumptionContract: unknown }) => t.consumptionContract) } as UtiltsBoundPersistenceInput : null
    const response = input ? { data: bindingRpcRows(input, results), error: null } : { data: null, error: { message: 'unavailable' } }
    return Object.assign(Promise.resolve(response), { abortSignal: () => Promise.resolve(response) })
  })
  io.from.mockImplementation((table: string) => {
    const actor=currentUtiltsActorQuery(table);if(actor)return actor
    const q = { select: () => q, eq: () => q, is: () => q, in: () => q, lte: () => q, limit: () => q, update: () => q,
      then: (resolve: (value: unknown) => unknown) => Promise.resolve({ data: table === 'ediel_ack_transaction_results' ? [{ id: 'ack-row' }] : [], count: 0, error: null }).then(resolve) }
    return q
  })
})
/** Declare synthetic TEST original bytes before the modeled database insert.
 * Older wires had ACK-request1 at UNB/0031 but omitted TEST at UNB/0035;
 * row.env is not allowed to reinterpret that physical production original. */
function declaredTestSource(message:EdielMessageRow):EdielMessageRow{
 if(declaredSources.has(message))return message
 const missingTenant=message.company_id===null
 if(message.environment==='test'&&message.raw_payload){
  const tokens=tokenizeEdifact(message.raw_payload),unbs=tokens.segments.filter(t=>t.tag==='UNB')
  if(unbs.length===1){const raw=segmentUntrimmedRaw(unbs[0]);if(raw.endsWith('++1'))message.raw_payload=message.raw_payload.replace(raw,raw+'++1')}
 }
 // Each separate synthetic reception is its own immutable source row, including
 // the agency89/agency9 pair in one case. No hash-changing replay is fabricated.
 Object.assign(message,receivedUtiltsOwnerFixture(message))
 message.id='22222222-2222-4222-8222-'+String(++sourceOrdinal).padStart(12,'0')
 const captured=message.execution_context_snapshot as {receivedUtiltsContext:{sourceMessageId:string;companyId:string|null}}
 captured.receivedUtiltsContext.sourceMessageId=message.id
 if(missingTenant){message.company_id=null;captured.receivedUtiltsContext.companyId=null}
 registerFixtureSource(message)
 declaredSources.add(message)
 return message
}
function incoming(held = false, mixed = false, date = '2026-10-01') {
  const message = held ? observationHandoffMessage(date) : energyHandoffMessage(date)
  if(date<'2026-10-01')message.raw_payload=message.raw_payload!.replace('QTY+220:11000','QTY+220:10500')
  message.sender_ediel_id = '91100'; message.receiver_ediel_id = '21660'
  if (mixed) {
    if (held) {
      // U15 requires a compatible quarter batch. The reading-bearing IDE still
      // requires authentic structural inventory; equal resolution never grants it.
      message.application_reference = '23-DDQ-E66-T'
      message.raw_payload = message.raw_payload!.replace('23-DDQ-E66-S','23-DDQ-E66-T')
        .replace('DTM+354:1:802','DTM+354:15:806')
        .replace('202607010000202608010000:719','202607010000202607010015:719')
        .replace('DTM+597:202608010000:203','DTM+597:202607010020:203')
        .replace('DTM+597:202608010000:203','DTM+597:202607010015:203')
    }
    const lines = message.raw_payload!.split('\n')
    const energy = energyHandoffMessage().raw_payload!.split('\n')
    const second = energy.slice(energy.findIndex(line => line.startsWith('IDE+24')), energy.findIndex(line => line.startsWith('UNT+')))
      .map(line => line.replace('GRIDEX2607E66001', 'GRIDEX2607E66002').replace('QTY+136:500', 'QTY+136:7'))
    const close = lines.findIndex(line => line.startsWith('UNT+'))
    lines.splice(close, 0, ...second); lines[close + second.length] = `UNT+${lines.findIndex(line => line.startsWith('UNT+')) - lines.findIndex(line => line.startsWith('UNH+')) + 1}+1'`
    message.raw_payload = lines.join('\n')
  }
  return message
}
const accepted = (id: string) => ({ transactionId: id, disposition: 'accepted', responseType: 'positive_aperak', persistenceStatus: 'persisted' })
const failed = { transactionId: 'GRIDEX2607E66001', disposition: 'processability_rejected', responseType: 'utilts_err', persistenceStatus: 'failed', issueCodes: ['UTILTS_PERSISTENCE_FAILED'] }
it('persists an own QTY unit guide rejection before drafting its negative ACK',async()=>{
  const message=incoming()
  message.raw_payload=recountEdifactUnt(message.raw_payload!.replace("QTY+136:500'","QTY+136:500:MWH'"))
  io.get.mockResolvedValue(declaredTestSource(message))
  results=[{transactionId:'GRIDEX2607E66001',disposition:'guide_rejected',responseType:'negative_aperak',persistenceStatus:'not_applicable'}]
  await processInboundUtiltsMessage({actorUserId:UTILTS_FIXTURE_ACTOR,edielMessageId:message.id})
  expect(io.rpc).toHaveBeenCalledWith('gridex_persist_utilts_consumption_v1',expect.objectContaining({p_transactions:expect.arrayContaining([expect.objectContaining({disposition:'guide_rejected',responseType:'negative_aperak'})])}))
  expect(io.ack.mock.calls.filter(([call])=>call.ackFamily==='APERAK')).toHaveLength(1)
  expect(io.meter).not.toHaveBeenCalled();expect(io.bill).not.toHaveBeenCalled()
})
it('holds an S07 without BGM code-list qualifier SVK before business persistence', async () => {
  const message = observationHandoffMessage('2026-09-30')
  message.message_code = 'S07'; message.application_reference = '23-DDQ-S07-S'
  message.sender_ediel_id = '91100'; message.receiver_ediel_id = '21660'
  message.raw_payload = message.raw_payload!.replace('BGM+E66::260', 'BGM+S07::260')
    .replace('23-DDQ-E66-S', '23-DDQ-S07-S')
  io.get.mockResolvedValue(declaredTestSource(message))
  results = [{ transactionId: 'GRIDEX2607E66001', disposition: 'guide_rejected', responseType: 'negative_aperak', persistenceStatus: 'not_applicable' }]

  await processInboundUtiltsMessage({ actorUserId: UTILTS_FIXTURE_ACTOR, edielMessageId: message.id })
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
  io.get.mockResolvedValue(declaredTestSource(message))
  results = [{ transactionId: 'GRIDEX2607E66001', disposition: 'guide_rejected', responseType: 'negative_aperak', persistenceStatus: 'not_applicable' }]

  await processInboundUtiltsMessage({ actorUserId: UTILTS_FIXTURE_ACTOR, edielMessageId: message.id })
  const persisted = io.rpc.mock.calls.find(([name]) => name === 'gridex_persist_utilts_consumption_v1')?.[1]
  expect(persisted?.p_transactions).toMatchObject([{ transactionId: 'GRIDEX2607E66001', disposition: 'guide_rejected', responseType: 'negative_aperak' }])
  expect(io.meter).not.toHaveBeenCalled(); expect(io.bill).not.toHaveBeenCalled()
  expect(io.findOutbound).not.toHaveBeenCalled(); expect(io.complete).not.toHaveBeenCalled()
  expect(io.ack.mock.calls.map(([call]) => call.ackFamily)).toContain('APERAK')
  expect(io.ack.mock.calls.map(([call]) => call.ackFamily)).not.toContain('UTILTS_ERR')
  const negative = io.ack.mock.calls.find(([call]) => call.ackFamily === 'APERAK')![0]
  expect(JSON.stringify(negative.draft)).toContain('202')
})
it('keeps own field208 rejection but refuses an application ACK with unqualified physical legal agency', async () => {
  const message = observationHandoffMessage('2026-09-30')
  message.sender_ediel_id = '91100'; message.receiver_ediel_id = '21660'
  message.raw_payload = message.raw_payload!.replace('NAD+MR+21660:SVK:260', 'NAD+MR+21660:SVK:999')
  io.get.mockResolvedValue(declaredTestSource(message))
  results = [{ transactionId: 'GRIDEX2607E66001', disposition: 'guide_rejected', responseType: 'negative_aperak', persistenceStatus: 'not_applicable' }]

  const runtime = runUtiltsRuntimeForMessage(message)
  expect(runtime.validation.issues).toContainEqual(expect.objectContaining({aperakErcCode:'42', aperakFieldCode:'208', aperakText:'INCORRECT DATA 999'}))
  expect(runtime.transactionDispositions).toMatchObject([{disposition:'guide_rejected',responseType:'negative_aperak'}])
  await expect(processInboundUtiltsMessage({ actorUserId: UTILTS_FIXTURE_ACTOR, edielMessageId: message.id })).rejects.toThrow('ACK_APERAK_LEGAL_PARTY_INVALID')
  const persisted = io.rpc.mock.calls.find(([name]) => name === 'gridex_persist_utilts_consumption_v1')?.[1]
  expect(persisted?.p_company_id).toBe(message.company_id)
  expect(persisted?.p_transactions).toMatchObject([{ disposition: 'guide_rejected', responseType: 'negative_aperak' }])
  expect(io.ack.mock.calls).toHaveLength(1)
  expect(io.ack.mock.calls[0][0]).toMatchObject({ackFamily:'CONTRL',outcome:'positive',sourceMessage:{id:message.id,company_id:message.company_id,raw_payload:message.raw_payload}})
  expect(io.ack.mock.calls.some(([call]) => ['APERAK','UTILTS_ERR'].includes(call.ackFamily))).toBe(false)
  expect(io.from.mock.calls.some(([table]) => table === 'ediel_ack_transaction_results')).toBe(false)
  expect(io.meter).not.toHaveBeenCalled(); expect(io.bill).not.toHaveBeenCalled(); expect(io.complete).not.toHaveBeenCalled()
  const facet=JSON.parse(io.rpc.mock.calls.find(([name])=>name==='gridex_record_utilts_source_validation_v4')![1].p_header_facts_text)
  expect(facet.applicationErrors).toContainEqual(expect.objectContaining({ercCode:'42',fieldCode:'208',text:'INCORRECT DATA 999'}))
  expect(io.ack.mock.calls.map(([call])=>[call.ackFamily,call.outcome])).toEqual([['CONTRL','positive']])
  // The original bad legal agency cannot be rewritten to birth an application ACK.
})

it('routes six-digit receiver SVK identifier at 208 to negative APERAK without business effects', async () => {
  const message = observationHandoffMessage('2026-09-30')
  message.sender_ediel_id = '91100'; message.receiver_ediel_id = '21660'
  message.raw_payload = message.raw_payload!.replace('NAD+MR+21660:SVK:260', 'NAD+MR+216600:SVK:260')
  io.get.mockResolvedValue(declaredTestSource(message))
  results = [{ transactionId: 'GRIDEX2607E66001', disposition: 'guide_rejected', responseType: 'negative_aperak', persistenceStatus: 'not_applicable' }]
  await processInboundUtiltsMessage({ actorUserId: UTILTS_FIXTURE_ACTOR, edielMessageId: message.id })
  const persisted = io.rpc.mock.calls.find(([name]) => name === 'gridex_persist_utilts_consumption_v1')?.[1]
  expect(persisted?.p_company_id).toBe(message.company_id)
  expect(persisted?.p_transactions).toMatchObject([{ disposition: 'guide_rejected', responseType: 'negative_aperak' }])
  expect(io.meter).not.toHaveBeenCalled(); expect(io.bill).not.toHaveBeenCalled(); expect(io.complete).not.toHaveBeenCalled()
  expect(io.ack.mock.calls.map(([call]) => call.ackFamily)).toContain('APERAK')
  expect(io.ack.mock.calls.map(([call]) => call.ackFamily)).not.toContain('UTILTS_ERR')
  expect(JSON.stringify(io.ack.mock.calls.find(([call]) => call.ackFamily === 'APERAK')![0].draft)).toContain('208')
})
it('routes a bad agency-305 receiver GLN at 208 to negative APERAK without business effects', async () => {
  const message = observationHandoffMessage('2026-09-30')
  message.sender_ediel_id = '91100'; message.receiver_ediel_id = '21660'
  message.raw_payload = message.raw_payload!.replace('NAD+MR+21660:SVK:260', 'NAD+MR+7359990000014::305')
  io.get.mockResolvedValue(declaredTestSource(message))
  results = [{ transactionId: 'GRIDEX2607E66001', disposition: 'guide_rejected', responseType: 'negative_aperak', persistenceStatus: 'not_applicable' }]
  await processInboundUtiltsMessage({ actorUserId: UTILTS_FIXTURE_ACTOR, edielMessageId: message.id })
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
  io.get.mockResolvedValue(declaredTestSource(message))
  results = [{ transactionId: 'GRIDEX2607E66001', disposition: 'guide_rejected', responseType: 'negative_aperak', persistenceStatus: 'not_applicable' }]
  await processInboundUtiltsMessage({ actorUserId: UTILTS_FIXTURE_ACTOR, edielMessageId: message.id })
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
  io.get.mockResolvedValue(declaredTestSource(message))
  results = [{ transactionId: 'GRIDEX2607E66001', disposition: 'guide_rejected', responseType: 'negative_aperak', persistenceStatus: 'not_applicable' }]

  await processInboundUtiltsMessage({ actorUserId: UTILTS_FIXTURE_ACTOR, edielMessageId: message.id })
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
  io.get.mockResolvedValue(declaredTestSource(message))
  results = [{ transactionId: 'GRIDEX2607E66001', disposition: 'guide_rejected', responseType: 'negative_aperak', persistenceStatus: 'not_applicable' }]

  await processInboundUtiltsMessage({ actorUserId: UTILTS_FIXTURE_ACTOR, edielMessageId: message.id })
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
  io.get.mockResolvedValue(declaredTestSource(message))
  results = [{ transactionId: 'GRIDEX2607E66001', disposition: 'guide_rejected', responseType: 'negative_aperak', persistenceStatus: 'not_applicable' }]

  await processInboundUtiltsMessage({ actorUserId: UTILTS_FIXTURE_ACTOR, edielMessageId: message.id })
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
  io.get.mockResolvedValue(declaredTestSource(message))
  results = [{ transactionId: 'GRIDEX2607E66001', disposition: 'guide_rejected', responseType: 'negative_aperak', persistenceStatus: 'not_applicable' }]

  await processInboundUtiltsMessage({ actorUserId: UTILTS_FIXTURE_ACTOR, edielMessageId: message.id })
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
  io.get.mockResolvedValue(declaredTestSource(message))
  results = [{ transactionId: 'GRIDEX2607E66001', disposition: 'guide_rejected', responseType: 'negative_aperak', persistenceStatus: 'not_applicable' }]

  await processInboundUtiltsMessage({ actorUserId: UTILTS_FIXTURE_ACTOR, edielMessageId: message.id })
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
for (const mixed of [false, true]) it(`processor holds internal persistence failure${mixed ? ' with accepted sibling' : ''} before ACK or sinks`, async () => {
  const message = incoming(false, mixed); io.get.mockResolvedValue(declaredTestSource(message))
  results = mixed ? [failed, accepted('GRIDEX2607E66002')] : [failed]
  await expect(processInboundUtiltsMessage({ actorUserId: UTILTS_FIXTURE_ACTOR, edielMessageId: message.id })).rejects.toThrow('utilts_consumption_binding_conflict:persistence_failed')
  expect(io.rpc).toHaveBeenCalledWith('gridex_persist_utilts_consumption_v1', expect.objectContaining({ p_company_id: message.company_id, p_source_message_id: message.id }))
  expect(io.ack).not.toHaveBeenCalled(); expect(io.meter).not.toHaveBeenCalled(); expect(io.bill).not.toHaveBeenCalled()
  expect(io.findOutbound).not.toHaveBeenCalled(); expect(io.complete).not.toHaveBeenCalled()
})
for (const invalid of ['missing', 'duplicate', 'unrelated', 'contradictory']) it(`real processor rejects ${invalid} persistence evidence before ACK or completion`, async () => {
  const message = incoming(); io.get.mockResolvedValue(declaredTestSource(message))
  if (invalid === 'duplicate') results = [accepted('GRIDEX2607E66001'), accepted('GRIDEX2607E66001')]
  if (invalid === 'unrelated') results = [accepted('OTHER')]
  if (invalid === 'contradictory') results = [{ ...accepted('GRIDEX2607E66001'), disposition: 'internal_review' }]
  await expect(processInboundUtiltsMessage({ actorUserId: UTILTS_FIXTURE_ACTOR, edielMessageId: message.id })).rejects.toThrow('utilts_transaction_persistence_invalid_result')
  expect(io.meter).not.toHaveBeenCalled(); expect(io.bill).not.toHaveBeenCalled()
  expect(io.ack).not.toHaveBeenCalled(); expect(io.findOutbound).not.toHaveBeenCalled(); expect(io.complete).not.toHaveBeenCalled()
})
it('held sibling keeps its empty persisted quantities and no positive ACK while accepted sibling persists', async () => {
  const message = incoming(true, true); io.get.mockResolvedValue(declaredTestSource(message))
  results = [{ transactionId: 'GRIDEX2607E66001', disposition: 'internal_review', responseType: 'none', persistenceStatus: 'not_applicable' }, accepted('GRIDEX2607E66002')]
  const result = await processInboundUtiltsMessage({ actorUserId: UTILTS_FIXTURE_ACTOR, edielMessageId: message.id })
  expect(result.internalReviewRequired).toBe(true)
  const call = io.rpc.mock.calls.find(([name]) => name === 'gridex_persist_utilts_consumption_v1')!
  expect(call[1].p_transactions).toMatchObject([{ transactionId: 'GRIDEX2607E66001', disposition: 'internal_review', quantities: [] }, { transactionId: 'GRIDEX2607E66002', disposition: 'accepted', quantities: [{ value: '7' }] }])
  const aperaks = io.ack.mock.calls.filter(([call]) => call.ackFamily === 'APERAK')
  expect(aperaks).toHaveLength(1)
  expect(JSON.stringify(aperaks[0][0].draft)).toContain('GRIDEX2607E66002')
  expect(io.ack.mock.calls.map(([call]) => call.ackFamily)).not.toContain('UTILTS_ERR')
  expect(io.meter).not.toHaveBeenCalled(); expect(io.bill).not.toHaveBeenCalled()
})
it('real inbound keeps a guide-invalid E66 IDE separate from a valid sibling through persistence and ACK', async () => {
  const message = incoming(true, true)
  message.raw_payload = message.raw_payload!.replace('LOC+172+735999260731000007::9', 'LOC+175+735999260731000007::260')
  io.get.mockResolvedValue(declaredTestSource(message))
  results = [
    { transactionId: 'GRIDEX2607E66001', disposition: 'guide_rejected', responseType: 'negative_aperak', persistenceStatus: 'not_applicable' },
    accepted('GRIDEX2607E66002'),
  ]
  await processInboundUtiltsMessage({ actorUserId: UTILTS_FIXTURE_ACTOR, edielMessageId: message.id })
  const persisted = io.rpc.mock.calls.find(([name]) => name === 'gridex_persist_utilts_consumption_v1')![1].p_transactions
  expect(persisted).toMatchObject([
    { transactionId: 'GRIDEX2607E66001', disposition: 'guide_rejected', responseType: 'negative_aperak' },
    { transactionId: 'GRIDEX2607E66002', disposition: 'accepted', responseType: 'positive_aperak' },
  ])
  expect(io.ack.mock.calls.map(([call]) => call.ackFamily)).not.toContain('UTILTS_ERR')
  expect(io.ack.mock.calls.filter(([call]) => call.ackFamily === 'APERAK')).toHaveLength(2)
  expect(io.meter).toHaveBeenCalledTimes(1); expect(io.bill).toHaveBeenCalledTimes(1)
  expect(io.meter).toHaveBeenCalledWith(expect.objectContaining({ sourceTransactionReference: 'GRIDEX2607E66002', quantityKwh: '7' }))
  expect(io.complete).not.toHaveBeenCalled()
})
it('routes a supplied invalid E66 LOC+172 identity to 209 without consuming its IDE', async () => {
  const message = incoming(true, true, '2026-10-15')
  message.raw_payload = message.raw_payload!.replace('LOC+172+735999260731000007::9', 'LOC+172+735999260731000008::9')
  io.get.mockResolvedValue(declaredTestSource(message))
  results = [
    { transactionId: 'GRIDEX2607E66001', disposition: 'guide_rejected', responseType: 'negative_aperak', persistenceStatus: 'not_applicable' },
    accepted('GRIDEX2607E66002'),
  ]
  await processInboundUtiltsMessage({ actorUserId: UTILTS_FIXTURE_ACTOR, edielMessageId: message.id })
  const persisted = io.rpc.mock.calls.find(([name]) => name === 'gridex_persist_utilts_consumption_v1')![1]
  expect(persisted.p_company_id).toBe(message.company_id)
  expect(persisted.p_transactions).toMatchObject([
    { transactionId: 'GRIDEX2607E66001', disposition: 'guide_rejected', responseType: 'negative_aperak' },
    { transactionId: 'GRIDEX2607E66002', disposition: 'accepted', responseType: 'positive_aperak' },
  ])
  const aperaks = io.ack.mock.calls.filter(([call]) => call.ackFamily === 'APERAK')
  expect(aperaks).toHaveLength(2)
  expect(JSON.stringify(aperaks[0][0].draft)).toContain('209')
  expect(io.ack.mock.calls.map(([call]) => call.ackFamily)).not.toContain('UTILTS_ERR')
  expect(io.meter).toHaveBeenCalledTimes(1); expect(io.bill).toHaveBeenCalledTimes(1)
  expect(io.meter).toHaveBeenCalledWith(expect.objectContaining({ sourceTransactionReference: 'GRIDEX2607E66002', quantityKwh: '7' }))
  expect(io.complete).not.toHaveBeenCalled()
})
it.each([['E30', 'invalid'], ['E30', 'missing'], ['S07', 'invalid'], ['S07', 'missing']] as const)(
  'routes %s LOC+172 %s to 209 with no business effects', async (code, defect) => {
  const message = incoming(true, false, '2026-10-15')
  message.message_code = code
  message.application_reference = code === 'E30' ? '23-MDR-E30-S' : '23-DDQ-S07-S'
  message.raw_payload = message.raw_payload!
    .replace('BGM+E66::260', code === 'S07' ? 'BGM+S07:SVK:260' : 'BGM+E30::260')
    .replace('23-DDQ-E66-S', message.application_reference)
    .replace('LOC+172+735999260731000007::9', defect === 'invalid' ? 'LOC+172+735999260731000008::9' : '')
  message.raw_payload = recountEdifactUnt(message.raw_payload)
  io.get.mockResolvedValue(declaredTestSource(message))
  results = [{ transactionId: 'GRIDEX2607E66001', disposition: 'guide_rejected', responseType: 'negative_aperak', persistenceStatus: 'not_applicable' }]
  await processInboundUtiltsMessage({ actorUserId: UTILTS_FIXTURE_ACTOR, edielMessageId: message.id })
  const persisted = io.rpc.mock.calls.find(([name]) => name === 'gridex_persist_utilts_consumption_v1')![1]
  expect(persisted.p_company_id).toBe(message.company_id)
  expect(persisted.p_transactions).toMatchObject([{ transactionId: 'GRIDEX2607E66001', disposition: 'guide_rejected', responseType: 'negative_aperak' }])
  const aperak = io.ack.mock.calls.find(([call]) => call.ackFamily === 'APERAK')
  expect(JSON.stringify(aperak?.[0].draft)).toContain('209')
  expect(io.ack.mock.calls.map(([call]) => call.ackFamily)).not.toContain('UTILTS_ERR')
  expect(io.meter).not.toHaveBeenCalled(); expect(io.bill).not.toHaveBeenCalled(); expect(io.complete).not.toHaveBeenCalled()
  })
it('routes invalid October S01 LOC+175 to tenant-bound 533 negative APERAK without business effects', async () => {
  const message = incoming(true, false, '2026-10-15')
  message.message_code = 'S01'; message.application_reference = '23-DDK-S01-S'
  message.customer_id = null; message.site_id = null; message.metering_point_id = null
  message.raw_payload = message.raw_payload!
    .replace('BGM+E66::260', 'BGM+S01:SVK:260')
    .replace('23-DDQ-E66-S', '23-DDK-S01-S')
    .replace('LOC+172+735999260731000007::9', 'LOC+175+735999260731000008::9')
  io.get.mockResolvedValue(declaredTestSource(message))
  results = [{ transactionId: 'GRIDEX2607E66001', disposition: 'guide_rejected', responseType: 'negative_aperak', persistenceStatus: 'not_applicable' }]
  const { processInboundUtiltsMessageByCanonicalPolicy } = await import('@/lib/ediel/flows/utiltsInboundPolicyProcessor')
  await processInboundUtiltsMessageByCanonicalPolicy({ actorUserId: UTILTS_FIXTURE_ACTOR, edielMessageId: message.id })
  const persisted = io.rpc.mock.calls.find(([name]) => name === 'gridex_persist_utilts_consumption_v1')?.[1]
  expect(persisted?.p_company_id).toBe(message.company_id)
  expect(persisted?.p_transactions).toMatchObject([{ transactionId: 'GRIDEX2607E66001', disposition: 'guide_rejected', responseType: 'negative_aperak' }])
  expect(JSON.stringify(io.ack.mock.calls.find(([call]) => call.ackFamily === 'APERAK')?.[0].draft)).toContain('533')
  expect(io.ack.mock.calls.map(([call]) => call.ackFamily)).not.toContain('UTILTS_ERR')
  expect(io.meter).not.toHaveBeenCalled(); expect(io.bill).not.toHaveBeenCalled(); expect(io.complete).not.toHaveBeenCalled()
})
it('holds a guide-valid E72 agency-89 request before positive point authority, preserving agency-9 requests', async () => {
  const message = e72PointRequestMessage('tenant-a', '89')
  const runtime = runUtiltsRuntimeForMessage(message)
  expect(runtime.validation.ok, JSON.stringify(runtime.validation.issues)).toBe(true)
  expect(runtime.transactionDispositions).toMatchObject([{ disposition: 'accepted' }])
  io.get.mockResolvedValue(declaredTestSource(message)); results = undefined
  const { processInboundUtiltsMessageByCanonicalPolicy } = await import('@/lib/ediel/flows/utiltsInboundPolicyProcessor')
  const result = await processInboundUtiltsMessageByCanonicalPolicy({ actorUserId: UTILTS_FIXTURE_ACTOR, edielMessageId: message.id })
  expect(result.internalReviewRequired).toBe(true)
  const persisted = io.rpc.mock.calls.find(([name]) => name === 'gridex_persist_utilts_consumption_v1')?.[1]
  expect(persisted?.p_transactions).toMatchObject([{ disposition: 'internal_review', responseType: 'none', quantities: [],
    consumptionContract: { observations: [] } }])
  expect(io.ack.mock.calls.every(([call]) => call.ackFamily === 'CONTRL')).toBe(true)
  expect(io.meter).not.toHaveBeenCalled(); expect(io.bill).not.toHaveBeenCalled(); expect(io.complete).not.toHaveBeenCalled()
  const agency9Source=declaredTestSource(e72PointRequestMessage())
  io.get.mockResolvedValue(agency9Source)
  await processInboundUtiltsMessageByCanonicalPolicy({ actorUserId: UTILTS_FIXTURE_ACTOR, edielMessageId: agency9Source.id })
  const point = io.rpc.mock.calls.filter(([name]) => name === 'gridex_persist_utilts_consumption_v1').at(-1)?.[1]
  expect(point?.p_transactions).toMatchObject([{ disposition: 'accepted', responseType: 'positive_aperak', quantities: [] }])
  expect(io.ack.mock.calls.some(([call]) => call.ackFamily === 'APERAK' && call.outcome === 'positive')).toBe(true)
  expect(io.meter).not.toHaveBeenCalled(); expect(io.bill).not.toHaveBeenCalled(); expect(io.complete).not.toHaveBeenCalled()
})
it('holds a permitted inbound E72 request with unowned physical agency 89 before a positive ACK', async () => {
  const message = e72PointRequestMessage('tenant-a', '89')
  expect(runUtiltsRuntimeForMessage(message).transactionDispositions).toMatchObject([{ disposition: 'accepted' }])
  io.get.mockResolvedValue(declaredTestSource(message)); results = undefined
  const { processInboundUtiltsMessageByCanonicalPolicy } = await import('@/lib/ediel/flows/utiltsInboundPolicyProcessor')
  const result = await processInboundUtiltsMessageByCanonicalPolicy({ actorUserId: UTILTS_FIXTURE_ACTOR, edielMessageId: message.id })
  const persisted = io.rpc.mock.calls.find(([name]) => name === 'gridex_persist_utilts_consumption_v1')?.[1]
  expect(result.internalReviewRequired).toBe(true)
  expect(persisted?.p_transactions).toMatchObject([{ disposition: 'internal_review', responseType: 'none', quantities: [] }])
  expect(io.ack.mock.calls.map(([call]) => call.ackFamily)).not.toContain('APERAK')
  expect(io.ack.mock.calls.map(([call]) => call.ackFamily)).not.toContain('UTILTS_ERR')
  expect(io.meter).not.toHaveBeenCalled(); expect(io.bill).not.toHaveBeenCalled(); expect(io.complete).not.toHaveBeenCalled()
})
it('the real supplier-side admission refuses outbound-only E73 as an inbound fixture before effects', async () => {
  const message = e72PointRequestMessage()
  message.message_code = 'E73'; message.application_reference = '23-DDQ-E66-S'
  message.raw_payload = message.raw_payload!.replace('BGM+E72::260', 'BGM+E73::260')
    .replace('23-MDR-E30-S', '23-DDQ-E66-S').replace("NAD+MDR'", "NAD+DDQ'").replace("RFF+E30'", "RFF+E66'")
  declaredTestSource(message)
  const { resolveCanonicalRuntimeDecisionWithRegistry } = await import('@/lib/ediel/core/runtimeDecision')
  const decision = await resolveCanonicalRuntimeDecisionWithRegistry(message)
  expect(decision.applicationDecision).toBe('manual_review')
  expect(decision.issues).toContainEqual(expect.objectContaining({code:'CANONICAL_RULE_PACK_EVIDENCE_NOT_ACTIVE',
    description:'canonical_source_direction_not_allowed:E73:inbound:outbound'}))
  expect(decision.responsePlan.some(item => item.family === 'APERAK' && item.outcome === 'positive')).toBe(false)
  expect(io.rpc.mock.calls.some(([name]) => name === 'gridex_persist_utilts_consumption_v1')).toBe(false)
  expect(io.ack).not.toHaveBeenCalled(); expect(io.meter).not.toHaveBeenCalled(); expect(io.bill).not.toHaveBeenCalled()
})
it('holds a valid S01 LOC+175 without an owned regulating object and never reserves a positive point ACK', async () => {
  const message = incoming(false, false, '2026-10-01')
  message.message_code = 'S01'; message.application_reference = '23-DDK-S01-S'
  message.customer_id = null; message.site_id = null; message.metering_point_id = null
  message.raw_payload = message.raw_payload!
    .replace('BGM+E66::260', 'BGM+S01:SVK:260')
    .replace('23-DDQ-E66-T', '23-DDK-S01-S')
    .replace('LOC+172+735999260731000007::9', 'LOC+175+735999260731000007::9')
  expect(runUtiltsRuntimeForMessage(message).transactionDispositions).toMatchObject([{ disposition: 'accepted' }])
  io.get.mockResolvedValue(declaredTestSource(message))
  results = undefined // The RPC fixture echoes the actual prepared disposition.
  const { processInboundUtiltsMessageByCanonicalPolicy } = await import('@/lib/ediel/flows/utiltsInboundPolicyProcessor')
  const result = await processInboundUtiltsMessageByCanonicalPolicy({ actorUserId: UTILTS_FIXTURE_ACTOR, edielMessageId: message.id })
  const persisted = io.rpc.mock.calls.find(([name]) => name === 'gridex_persist_utilts_consumption_v1')?.[1]
  expect(result.internalReviewRequired).toBe(true)
  expect(persisted?.p_transactions).toMatchObject([{ disposition: 'internal_review', responseType: 'none',
    meteringPointId: null, externalMeteringPointId: null, quantities: [] }])
  expect(io.ack.mock.calls.filter(([call]) => call.ackFamily === 'APERAK' || call.ackFamily === 'UTILTS_ERR')).toHaveLength(0)
  expect(io.meter).not.toHaveBeenCalled(); expect(io.bill).not.toHaveBeenCalled(); expect(io.complete).not.toHaveBeenCalled()
})
it('holds E66 point consumption when a LOC+175 appears after SEQ in the same physical IDE', async () => {
  const message = incoming(false, false, '2026-10-01')
  message.raw_payload = message.raw_payload!
    .replace("SEQ++1'", "SEQ++1'\nLOC+175+735999260731000007::9'")
    .replace(/UNT\+(\d+)\+1'/, (_, count: string) => `UNT+${Number(count) + 1}+1'`)
  const runtime = runUtiltsRuntimeForMessage(message)
  expect(runtime.facts.transactions[0].regulatingObjectPresent).toBe(true)
  expect(runtime.transactionDispositions[0]).toMatchObject({disposition:'syntax_rejected',responseType:'negative_contrl'})
  io.get.mockResolvedValue(declaredTestSource(message)); results = undefined
  await expect(processInboundUtiltsMessage({ actorUserId: UTILTS_FIXTURE_ACTOR, edielMessageId: message.id })).rejects.toThrow('utilts_initial_canonical_owner_context_mismatch')
  expect(io.rpc.mock.calls.some(([name]) => name === 'gridex_persist_utilts_consumption_v1')).toBe(false)
  expect(io.ack).not.toHaveBeenCalled()
  expect(io.ack.mock.calls.filter(([call]) => call.ackFamily === 'APERAK' || call.ackFamily === 'UTILTS_ERR')).toHaveLength(0)
  expect(io.meter).not.toHaveBeenCalled(); expect(io.bill).not.toHaveBeenCalled(); expect(io.complete).not.toHaveBeenCalled()
})
it('holds E66 point consumption when a second LOC+172 appears after SEQ in the same physical IDE', async () => {
  const message = incoming(false, false, '2026-10-01')
  message.raw_payload = message.raw_payload!
    .replace("SEQ++1'", "SEQ++1'\nLOC+172+735999260731000014::9'")
    .replace(/UNT\+(\d+)\+1'/, (_, count: string) => `UNT+${Number(count) + 1}+1'`)
  io.get.mockResolvedValue(declaredTestSource(message)); results = undefined
  await expect(processInboundUtiltsMessage({ actorUserId: UTILTS_FIXTURE_ACTOR, edielMessageId: message.id })).rejects.toThrow('utilts_initial_canonical_owner_context_mismatch')
  expect(io.rpc.mock.calls.some(([name]) => name === 'gridex_persist_utilts_consumption_v1')).toBe(false)
  expect(io.ack).not.toHaveBeenCalled()
  expect(io.ack.mock.calls.filter(([call]) => call.ackFamily === 'APERAK' || call.ackFamily === 'UTILTS_ERR')).toHaveLength(0)
  expect(io.meter).not.toHaveBeenCalled(); expect(io.bill).not.toHaveBeenCalled(); expect(io.complete).not.toHaveBeenCalled()
})
it('holds an S01 point IDE with a second LOC+172 after SEQ before a market ACK', async () => {
  const message = incoming(false, false, '2026-10-01')
  message.message_code = 'S01'; message.application_reference = '23-DDK-S01-S'
  message.customer_id = null; message.site_id = null; message.metering_point_id = null
  message.raw_payload = message.raw_payload!
    .replace('BGM+E66::260', 'BGM+S01:SVK:260')
    .replace('23-DDQ-E66-T', '23-DDK-S01-S')
    .replace("SEQ++1'", "SEQ++1'\nLOC+172+735999260731000014::9'")
    .replace(/UNT\+(\d+)\+1'/, (_, count: string) => `UNT+${Number(count) + 1}+1'`)
  io.get.mockResolvedValue(declaredTestSource(message)); results = undefined
  const { processInboundUtiltsMessageByCanonicalPolicy } = await import('@/lib/ediel/flows/utiltsInboundPolicyProcessor')
  await expect(processInboundUtiltsMessageByCanonicalPolicy({ actorUserId: UTILTS_FIXTURE_ACTOR, edielMessageId: message.id })).rejects.toThrow('utilts_initial_canonical_owner_context_mismatch')
  expect(io.rpc.mock.calls.some(([name]) => name === 'gridex_persist_utilts_consumption_v1')).toBe(false)
  expect(io.ack).not.toHaveBeenCalled()
  expect(io.ack.mock.calls.filter(([call]) => call.ackFamily === 'APERAK' || call.ackFamily === 'UTILTS_ERR')).toHaveLength(0)
  expect(io.meter).not.toHaveBeenCalled(); expect(io.bill).not.toHaveBeenCalled(); expect(io.complete).not.toHaveBeenCalled()
})
it.each(['object-first', 'point-first'] as const)('holds both S01 %s object and late second-LOC+172 point IDEs without a market ACK', async order => {
  const message = incoming(false, true, '2026-10-01')
  message.message_code = 'S01'; message.application_reference = '23-DDK-S01-S'
  message.customer_id = null; message.site_id = null; message.metering_point_id = null
  const lines = message.raw_payload!
    .replace('BGM+E66::260', 'BGM+S01:SVK:260')
    .replace('23-DDQ-E66-T', '23-DDK-S01-S').split('\n')
  const ide = lines.flatMap((line, index) => line.startsWith('IDE+24+') ? [index] : [])
  const objectIndex = order === 'object-first' ? 0 : 1
  const pointIndex = 1 - objectIndex
  const objectLoc = lines.findIndex((line, index) => index > ide[objectIndex] && index < (ide[objectIndex + 1] ?? lines.length)
    && line.startsWith('LOC+172+'))
  lines[objectLoc] = lines[objectLoc].replace('LOC+172+', 'LOC+175+')
  const pointSeq = lines.findIndex((line, index) => index > ide[pointIndex] && line.startsWith('SEQ+'))
  lines.splice(pointSeq + 1, 0, "LOC+172+735999260731000014::9'")
  const unt = lines.findIndex(line => line.startsWith('UNT+'))
  const unh = lines.findIndex(line => line.startsWith('UNH+'))
  lines[unt] = `UNT+${unt - unh + 1}+1'`
  message.raw_payload = lines.join('\n')
  expect(runUtiltsRuntimeForMessage(message).transactionDispositions.map(item => item.disposition)).toEqual(['syntax_rejected', 'syntax_rejected'])
  io.get.mockResolvedValue(declaredTestSource(message)); results = undefined
  const { processInboundUtiltsMessageByCanonicalPolicy } = await import('@/lib/ediel/flows/utiltsInboundPolicyProcessor')
  await expect(processInboundUtiltsMessageByCanonicalPolicy({ actorUserId: UTILTS_FIXTURE_ACTOR, edielMessageId: message.id })).rejects.toThrow('utilts_initial_canonical_owner_context_mismatch')
  expect(io.rpc.mock.calls.some(([name]) => name === 'gridex_persist_utilts_consumption_v1')).toBe(false)
  expect(io.ack).not.toHaveBeenCalled()
  expect(io.ack.mock.calls.filter(([call]) => call.ackFamily === 'APERAK' || call.ackFamily === 'UTILTS_ERR')).toHaveLength(0)
  expect(io.meter).not.toHaveBeenCalled(); expect(io.bill).not.toHaveBeenCalled(); expect(io.complete).not.toHaveBeenCalled()
})
it.each(['object-first', 'point-first'] as const)('keeps the clean S01 sibling eligible with a valid %s regulating-object IDE', async order => {
  const message = incoming(false, true, '2026-10-01')
  message.message_code = 'S01'; message.application_reference = '23-DDK-S01-S'
  message.customer_id = null; message.site_id = null; message.metering_point_id = null
  const raw = message.raw_payload!
    .replace('BGM+E66::260', 'BGM+S01:SVK:260')
    .replace('23-DDQ-E66-T', '23-DDK-S01-S')
  const point = 'LOC+172+735999260731000007::9'
  const at = order === 'object-first' ? raw.indexOf(point) : raw.lastIndexOf(point)
  message.raw_payload = raw.slice(0, at) + raw.slice(at).replace(point, 'LOC+175+735999260731000007::9')
  expect(runUtiltsRuntimeForMessage(message).transactionDispositions.map(item => item.disposition)).toEqual(['accepted', 'accepted'])
  io.get.mockResolvedValue(declaredTestSource(message)); results = undefined
  const { processInboundUtiltsMessageByCanonicalPolicy } = await import('@/lib/ediel/flows/utiltsInboundPolicyProcessor')
  const result = await processInboundUtiltsMessageByCanonicalPolicy({ actorUserId: UTILTS_FIXTURE_ACTOR, edielMessageId: message.id })
  expect(result.internalReviewRequired).toBe(true)
  const persisted = io.rpc.mock.calls.find(([name]) => name === 'gridex_persist_utilts_consumption_v1')?.[1].p_transactions
  const expected = [
    { disposition: 'internal_review', responseType: 'none', meteringPointId: null, externalMeteringPointId: null, quantities: [] },
    { disposition: 'accepted', responseType: 'positive_aperak', externalMeteringPointId: '735999260731000007' },
  ]
  expect(persisted).toMatchObject(order === 'object-first' ? expected : expected.reverse())
  const aperaks = io.ack.mock.calls.filter(([call]) => call.ackFamily === 'APERAK')
  expect(aperaks).toHaveLength(1)
  const pointId = order === 'object-first' ? 'GRIDEX2607E66002' : 'GRIDEX2607E66001'
  expect(JSON.stringify(aperaks[0][0].draft)).toContain(pointId)
  expect(io.event.mock.calls.filter(([call]) => call.eventType === 'aperak_sent').map(([call]) => call.payload.relatedTransactionReference)).toEqual([pointId])
  expect(io.meter).not.toHaveBeenCalled(); expect(io.bill).not.toHaveBeenCalled(); expect(io.complete).not.toHaveBeenCalled()
})
it.each(['object-first', 'point-first'] as const)('keeps a valid S01 %s object held when its point sibling has a guide error', async order => {
  const message = incoming(false, true, '2026-10-01')
  message.message_code = 'S01'; message.application_reference = '23-DDK-S01-S'
  message.customer_id = null; message.site_id = null; message.metering_point_id = null
  const raw = message.raw_payload!
    .replace('BGM+E66::260', 'BGM+S01:SVK:260')
    .replace('23-DDQ-E66-T', '23-DDK-S01-S')
  const pointLocation = 'LOC+172+735999260731000007::9'
  const objectAt = order === 'object-first' ? raw.indexOf(pointLocation) : raw.lastIndexOf(pointLocation)
  const withObject = raw.slice(0, objectAt) + raw.slice(objectAt).replace(pointLocation, 'LOC+175+735999260731000007::9')
  const badGridArea = 'LOC+239+TES:SVK:260'
  const badAt = order === 'object-first' ? withObject.lastIndexOf(badGridArea) : withObject.indexOf(badGridArea)
  message.raw_payload = withObject.slice(0, badAt) + withObject.slice(badAt).replace(badGridArea, 'LOC+239+ABCD:SVK:260')
  expect(runUtiltsRuntimeForMessage(message).transactionDispositions.map(item => item.disposition))
    .toEqual(order === 'object-first' ? ['accepted', 'guide_rejected'] : ['guide_rejected', 'accepted'])
  io.get.mockResolvedValue(declaredTestSource(message)); results = undefined
  const { processInboundUtiltsMessageByCanonicalPolicy } = await import('@/lib/ediel/flows/utiltsInboundPolicyProcessor')
  const processed = await processInboundUtiltsMessageByCanonicalPolicy({ actorUserId: UTILTS_FIXTURE_ACTOR, edielMessageId: message.id })
  expect(processed.internalReviewRequired).toBe(true)
  const persisted = io.rpc.mock.calls.find(([name]) => name === 'gridex_persist_utilts_consumption_v1')?.[1].p_transactions
  const expected = [
    { disposition: 'internal_review', responseType: 'none', meteringPointId: null, externalMeteringPointId: null, quantities: [] },
    { disposition: 'guide_rejected', responseType: 'negative_aperak' },
  ]
  expect(persisted).toMatchObject(order === 'object-first' ? expected : expected.reverse())
  const acknowledgements = io.ack.mock.calls.filter(([call]) => call.ackFamily === 'APERAK' || call.ackFamily === 'UTILTS_ERR')
  expect(acknowledgements).toHaveLength(1)
  const rejectedId = order === 'object-first' ? 'GRIDEX2607E66002' : 'GRIDEX2607E66001'
  expect(acknowledgements[0][0]).toMatchObject({ ackFamily: 'APERAK', outcome: 'negative',
    draft: { parsedPayload: { ackScope: 'transaction', relatedTransactionReference: rejectedId } } })
  expect(JSON.stringify(acknowledgements[0][0].draft)).toContain('260a')
  expect(io.meter).not.toHaveBeenCalled(); expect(io.bill).not.toHaveBeenCalled(); expect(io.complete).not.toHaveBeenCalled()
})
it.each([
  ['E72', '23-MDR-E30-S', 'LOC+172', '209', 'invalid'],
  ['E72', '23-MDR-E30-S', 'LOC+172', '209', 'missing'],
  ['E73', '23-DDQ-E66-S', 'LOC+175', '533', 'invalid'],
  ['S06', '23-DDK-S01-S', 'LOC+175', '533', 'invalid'],
] as const)('persists %s request identity defect as tenant-bound negative APERAK', async (code, applicationReference, location, fieldCode, defect) => {
  const message = incoming(true, false, '2026-10-15')
  message.message_code = code; message.application_reference = applicationReference
  message.customer_id = null; message.site_id = null; message.metering_point_id = null
  message.raw_payload = message.raw_payload!
    .replace('BGM+E66::260', `BGM+${code}${code === 'S06' ? ':SVK' : ':'}:260`)
    .replace('23-DDQ-E66-S', applicationReference)
    .replace('LOC+172+735999260731000007::9', defect === 'missing' ? '' : `${location}+735999260731000008::9`)
  message.raw_payload = recountEdifactUnt(message.raw_payload)
  io.get.mockResolvedValue(declaredTestSource(message))
  results = [{ transactionId: 'GRIDEX2607E66001', disposition: 'guide_rejected', responseType: 'negative_aperak', persistenceStatus: 'not_applicable' }]
  const { processInboundUtiltsMessageByCanonicalPolicy } = await import('@/lib/ediel/flows/utiltsInboundPolicyProcessor')
  await processInboundUtiltsMessageByCanonicalPolicy({ actorUserId: UTILTS_FIXTURE_ACTOR, edielMessageId: message.id })
  const persisted = io.rpc.mock.calls.find(([name]) => name === 'gridex_persist_utilts_consumption_v1')?.[1]
  expect(persisted?.p_company_id).toBe(message.company_id)
  expect(persisted?.p_transactions).toMatchObject([{ transactionId: 'GRIDEX2607E66001', disposition: 'guide_rejected', responseType: 'negative_aperak' }])
  expect(JSON.stringify(io.ack.mock.calls.find(([call]) => call.ackFamily === 'APERAK')?.[0].draft)).toContain(fieldCode)
  expect(io.ack.mock.calls.map(([call]) => call.ackFamily)).not.toContain('UTILTS_ERR')
  expect(io.meter).not.toHaveBeenCalled(); expect(io.bill).not.toHaveBeenCalled(); expect(io.complete).not.toHaveBeenCalled()
})
it('routes an invalid IDE qualifier to field 505 APERAK while preserving its valid sibling', async () => {
  const message = incoming(true, true, '2026-09-30')
  message.raw_payload = message.raw_payload!.replace('IDE+24+GRIDEX2607E66001', 'IDE+25+GRIDEX2607E66001')
  io.get.mockResolvedValue(declaredTestSource(message))
  results = [
    { transactionId: 'GRIDEX2607E66001', disposition: 'guide_rejected', responseType: 'negative_aperak', persistenceStatus: 'not_applicable' },
    accepted('GRIDEX2607E66002'),
  ]
  await processInboundUtiltsMessage({ actorUserId: UTILTS_FIXTURE_ACTOR, edielMessageId: message.id })
  const persisted = io.rpc.mock.calls.find(([name]) => name === 'gridex_persist_utilts_consumption_v1')![1].p_transactions
  expect(persisted).toMatchObject([
    { transactionId: 'GRIDEX2607E66001', disposition: 'guide_rejected', responseType: 'negative_aperak', quantities: expect.arrayContaining([expect.objectContaining({ qualifier: '220' })]) },
    { transactionId: 'GRIDEX2607E66002', disposition: 'accepted', responseType: 'positive_aperak' },
  ])
  const aperaks = io.ack.mock.calls.filter(([call]) => call.ackFamily === 'APERAK')
  expect(aperaks).toHaveLength(2)
  expect(JSON.stringify(aperaks[0][0].draft)).toContain('505')
  expect(io.ack.mock.calls.map(([call]) => call.ackFamily)).not.toContain('UTILTS_ERR')
  expect(io.meter).toHaveBeenCalledTimes(1); expect(io.bill).toHaveBeenCalledTimes(1); expect(io.complete).not.toHaveBeenCalled()
  expect(io.meter).toHaveBeenCalledWith(expect.objectContaining({ sourceTransactionReference: 'GRIDEX2607E66002', quantityKwh: '7' }))
})
it('routes a malformed supplied grid-area composite to 260a without rejecting its valid IDE sibling', async () => {
  const message = incoming(true, true, '2026-09-30')
  message.raw_payload = message.raw_payload!.replace('LOC+239+TES:SVK:260', 'LOC+239+ABCD:SVK:260')
  io.get.mockResolvedValue(declaredTestSource(message))
  results = [
    { transactionId: 'GRIDEX2607E66001', disposition: 'guide_rejected', responseType: 'negative_aperak', persistenceStatus: 'not_applicable' },
    accepted('GRIDEX2607E66002'),
  ]
  await processInboundUtiltsMessage({ actorUserId: UTILTS_FIXTURE_ACTOR, edielMessageId: message.id })
  const persisted = io.rpc.mock.calls.find(([name]) => name === 'gridex_persist_utilts_consumption_v1')![1].p_transactions
  expect(persisted).toMatchObject([
    { transactionId: 'GRIDEX2607E66001', disposition: 'guide_rejected', responseType: 'negative_aperak' },
    { transactionId: 'GRIDEX2607E66002', disposition: 'accepted', responseType: 'positive_aperak' },
  ])
  const aperaks = io.ack.mock.calls.filter(([call]) => call.ackFamily === 'APERAK')
  expect(aperaks).toHaveLength(2)
  expect(JSON.stringify(aperaks[0][0].draft)).toContain('260a')
  expect(io.ack.mock.calls.map(([call]) => call.ackFamily)).not.toContain('UTILTS_ERR')
  expect(io.meter).toHaveBeenCalledTimes(1); expect(io.bill).toHaveBeenCalledTimes(1); expect(io.complete).not.toHaveBeenCalled()
  expect(io.meter).toHaveBeenCalledWith(expect.objectContaining({ sourceTransactionReference: 'GRIDEX2607E66002', quantityKwh: '7' }))
  expect(io.meter.mock.invocationCallOrder[0]).toBeLessThan(io.ack.mock.invocationCallOrder[0])
})
for (const [present, missing] of [['232', '260c'], ['233', '260b']] as const) it(`routes orphan LOC+${present} to missing ${missing} before E66 function and business writes`, async () => {
  const message = incoming(true, false, '2026-09-30')
  const lines = message.raw_payload!.replace("LOC+239+TES:SVK:260'", `LOC+239+TES:SVK:260'\nLOC+${present}+ABC:SVK:260'`).split('\n')
  lines[lines.findIndex(line => line.startsWith('UNT+'))] = `UNT+${lines.findIndex(line => line.startsWith('UNT+')) - lines.findIndex(line => line.startsWith('UNH+')) + 1}+1'`
  message.raw_payload = lines.join('\n')
  io.get.mockResolvedValue(declaredTestSource(message))
  results = [{ transactionId: 'GRIDEX2607E66001', disposition: 'guide_rejected', responseType: 'negative_aperak', persistenceStatus: 'not_applicable' }]
  await processInboundUtiltsMessage({ actorUserId: UTILTS_FIXTURE_ACTOR, edielMessageId: message.id })
  expect(io.rpc.mock.calls.find(([name]) => name === 'gridex_persist_utilts_consumption_v1')![1].p_transactions)
    .toMatchObject([{ disposition: 'guide_rejected', responseType: 'negative_aperak' }])
  expect(JSON.stringify(io.ack.mock.calls.find(([call]) => call.ackFamily === 'APERAK')![0].draft)).toContain(missing)
  expect(io.ack.mock.calls.map(([call]) => call.ackFamily)).not.toContain('UTILTS_ERR')
  expect(io.meter).not.toHaveBeenCalled(); expect(io.bill).not.toHaveBeenCalled(); expect(io.complete).not.toHaveBeenCalled()
})
it('holds a positive sibling before ACK when its bound point and customer differ from the linked request', async () => {
  const message = incoming(true, true, '2026-09-30')
  message.raw_payload = message.raw_payload!.replace('LOC+239+TES:SVK:260', 'LOC+239+ABCD:SVK:260')
  io.get.mockResolvedValue(declaredTestSource(message))
  vi.mocked(findMatchingGridOwnerDataRequest).mockResolvedValueOnce({
    id: 'request-a', request_scope: 'billing_underlay', response_payload: {},
    customer_id: 'other-customer', metering_point_id: 'other-point',
  } as Awaited<ReturnType<typeof findMatchingGridOwnerDataRequest>>)
  results = [
    { transactionId: 'GRIDEX2607E66001', disposition: 'guide_rejected', responseType: 'negative_aperak', persistenceStatus: 'not_applicable' },
    accepted('GRIDEX2607E66002'),
  ]
  await expect(processInboundUtiltsMessage({ actorUserId: UTILTS_FIXTURE_ACTOR, edielMessageId: message.id }))
    .rejects.toThrow('utilts_partial_request_scope_conflict')
  expect(io.meter).not.toHaveBeenCalled(); expect(io.bill).not.toHaveBeenCalled()
  expect(io.ack).not.toHaveBeenCalled(); expect(io.complete).not.toHaveBeenCalled()
})
it('prior applicable reading is held while an eligible 15-minute energy sibling stays independent in the actual processor',async()=>{
 const message=incoming(true,true,'2026-09-30');io.get.mockResolvedValue(declaredTestSource(message))
 results=[{transactionId:'GRIDEX2607E66001',disposition:'internal_review',responseType:'none',persistenceStatus:'not_applicable'},accepted('GRIDEX2607E66002')]
 const result=await processInboundUtiltsMessage({actorUserId:UTILTS_FIXTURE_ACTOR,edielMessageId:message.id})
 expect(result.internalReviewRequired).toBe(true)
 const persisted=io.rpc.mock.calls.find(([name])=>name==='gridex_persist_utilts_consumption_v1')![1]
 expect(persisted.p_transactions).toMatchObject([{disposition:'internal_review',responseType:'none',quantities:[]},
  {disposition:'accepted',responseType:'positive_aperak',quantities:[{value:'7'}]}])
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
 lines.splice(end,0,...rejected);lines[end+rejected.length]=`UNT+${lines.findIndex(line => line.startsWith('UNT+')) - lines.findIndex(line => line.startsWith('UNH+')) + 1}+1'`
 // This is a declared test reception: physical UNB/0035 must agree with the
 // source environment so its protected original capability reaches preflight.
 message.raw_payload=lines.join('\n').replace("+260831181101++23-DDQ-E66-T++1'","+260831181101++23-DDQ-E66-T++1++1'");io.get.mockResolvedValue(declaredTestSource(message))
 results=[{transactionId:'GRIDEX2607E66001',disposition:'internal_review',responseType:'none',persistenceStatus:'not_applicable'},
  accepted('GRIDEX2607E66002'),{transactionId:'GRIDEX2607E66003',disposition:'processability_rejected',responseType:'utilts_err',persistenceStatus:'not_applicable'}]
 const processed=await processInboundUtiltsMessage({actorUserId:UTILTS_FIXTURE_ACTOR,edielMessageId:message.id})
 expect(processed.internalReviewRequired).toBe(true)
 const persisted=io.rpc.mock.calls.find(([name])=>name==='gridex_persist_utilts_consumption_v1')![1].p_transactions
 expect(persisted).toMatchObject([{disposition:'internal_review',quantities:[]},
  {disposition:'accepted',quantities:[{value:'7'}]},{disposition:'processability_rejected',responseType:'utilts_err'}])
 expect(io.ack.mock.calls.filter(([call])=>call.ackFamily==='APERAK')).toHaveLength(1)
 const err=io.ack.mock.calls.filter(([call])=>call.ackFamily==='UTILTS_ERR')
 expect(err).toHaveLength(1)
 // Authentic prior guide scope retained by the real source qualification
 // admits E19; only the rejected third IDE may be correlated in its ERR.
 expect(err[0][0].draft.rawPayload).toContain('STS+E01::260+41+E19::260')
 expect(err[0][0].draft.rawPayload).toContain('RFF+TN:GRIDEX2607E66003')
 expect(err[0][0].draft.rawPayload).not.toContain('RFF+TN:GRIDEX2607E66001')
 expect(err[0][0].draft.rawPayload).not.toContain('RFF+TN:GRIDEX2607E66002')
 expect(io.complete).not.toHaveBeenCalled()
 expect(io.meter).not.toHaveBeenCalled();expect(io.bill).not.toHaveBeenCalled()
})

for (const invalid of ['missing tenant', 'duplicate physical identities']) it(`processor stops ${invalid} before ACK, sinks or completion`, async () => {
  const message = incoming()
  if (invalid === 'missing tenant') message.company_id = null
  else {
    const lines = message.raw_payload!.split('\n')
    const own = lines.slice(lines.findIndex(line => line.startsWith('IDE+')), lines.findIndex(line => line.startsWith('UNT+')))
    lines.splice(lines.findIndex(line => line.startsWith('UNT+')), 0, ...own)
    message.raw_payload = recountEdifactUnt(lines.join('\n'))
  }
  io.get.mockResolvedValue(declaredTestSource(message))
  results = [accepted('GRIDEX2607E66001'), accepted('GRIDEX2607E66001')]
  await expect(processInboundUtiltsMessage({ actorUserId: UTILTS_FIXTURE_ACTOR, edielMessageId: message.id })).rejects.toThrow(
    invalid === 'missing tenant' ? 'saknar tenantkoppling' : invalid === 'duplicate physical identities' ? 'utilts_transaction_persistence_invalid_result:utilts_consumption_binding_conflict:physical_membership' : 'utilts_transaction_persistence_invalid_result',
  )
  expect(io.ack).not.toHaveBeenCalled(); expect(io.meter).not.toHaveBeenCalled(); expect(io.bill).not.toHaveBeenCalled()
  expect(io.findOutbound).not.toHaveBeenCalled(); expect(io.complete).not.toHaveBeenCalled()
})

it('internal persistence failure holds even the certified forced-positive ACK plan', async () => {
  const message = incoming(); io.get.mockResolvedValue(declaredTestSource(message)); results = [failed]
  await expect(processInboundUtiltsMessage({ actorUserId: UTILTS_FIXTURE_ACTOR, edielMessageId: message.id, testCaseCode: 'U3.1.1' })).rejects.toThrow('utilts_consumption_binding_conflict:persistence_failed')
  expect(io.ack).not.toHaveBeenCalled()
  expect(io.meter).not.toHaveBeenCalled(); expect(io.bill).not.toHaveBeenCalled()
  expect(io.findOutbound).not.toHaveBeenCalled(); expect(io.complete).not.toHaveBeenCalled()
})
