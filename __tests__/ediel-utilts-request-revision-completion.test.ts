import { createUtiltsFinalValidationIo, qualifyUtiltsFixtureSource as registerFixtureSource, currentUtiltsActorQuery, UTILTS_FIXTURE_ACTOR } from '@/__tests__/helpers/utiltsCurrentOwnerFixture'
import { beforeEach, expect, it, vi } from 'vitest'
import { processInboundUtiltsMessage } from '@/lib/ediel/flows/utiltsDataRequest.part-2'
import { energyHandoffMessage } from '@/__tests__/helpers/utiltsObservationHandoff'
import { recountEdifactUnt } from '@/__tests__/helpers/recountEdifactUnt'
import { bindingRpcRows } from '@/__tests__/helpers/utiltsBoundFixture'
import {receivedUtiltsOwnerFixture,resetUtiltsCanonicalOwnerIo} from '@/__tests__/helpers/utiltsCanonicalOwnerIo'
import {createHash} from 'node:crypto'
import type {EdielMessageRow} from '@/lib/ediel/types'
import {segmentUntrimmedRaw,tokenizeEdifact} from '@/lib/ediel/core/edifactTokenizer'
import type { UtiltsBoundPersistenceInput } from '@/lib/ediel/utilts/transactionPersistence'

const io = vi.hoisted(() => ({ get: vi.fn(), update: vi.fn(), event: vi.fn(), ack: vi.fn(), rpc: vi.fn(), from: vi.fn(), meter: vi.fn(), bill: vi.fn(), complete: vi.fn(), findOutbound: vi.fn(), updateOutbound: vi.fn() }))
vi.mock('@/lib/supabase/service', () => ({ supabaseService: { from: io.from, rpc: io.rpc } }))
vi.mock('@/lib/ediel/db', () => ({ getEdielMessageById: async(...args:unknown[])=>{const message=await io.get(...args);if(!message)return message;if(args[0]!==message.id||message.execution_context_snapshot.receivedUtiltsContext.payloadHash!==hash(message.raw_payload))throw Error('fixture_actual_immutable_source_scope_required');return message}, updateEdielMessageStatus: io.update, createEdielMessageEvent: io.event, linkEdielMessage: vi.fn(), listEdielTestRuns: vi.fn().mockResolvedValue([]) }))
vi.mock('@/lib/ediel/core/kernel', () => ({ createCanonicalAckMessage: io.ack }))
vi.mock('@/lib/ediel/flows/shared', () => ({ ensureActorUserId: (id: string) => id }))
vi.mock('@/lib/metering/normalizeMeteringValues', () => ({ normalizeAndStoreMeteringValue: io.meter }))
vi.mock('@/lib/billing/meterValueBillingMatcher', () => ({ updateMeterValueBillingReadiness: vi.fn() }))
vi.mock('@/lib/cis/db', async () => {
  const actual = await import('@/lib/cis/db-data')
  return {
    ingestBillingUnderlay: io.bill,
    findOpenOutboundBySource: io.findOutbound,
    syncGridOwnerDataRequestFromOutbound: actual.syncGridOwnerDataRequestFromOutbound,
    updateOutboundRequestStatus: io.updateOutbound,
    syncGridOwnerDataRequestReceivedFromEdiel: async (args: Parameters<typeof actual.syncGridOwnerDataRequestReceivedFromEdiel>[0]) => {
      io.complete(args)
      return actual.syncGridOwnerDataRequestReceivedFromEdiel(args)
    },
  }
})
vi.mock('@/lib/ediel/matching', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/lib/ediel/matching')>()),
  matchMeteringPointIdByIdentifier: vi.fn().mockResolvedValue('point-a'),
  matchMeteringPointForEdielMessage: vi.fn().mockResolvedValue('point-a'),
  matchSiteAndCustomerForMeteringPoint: vi.fn().mockResolvedValue({ customerId: 'customer-a', siteId: 'site-a', gridOwnerId: 'owner-a' }),
}))
// Actual parsing/national rules, opaque initial/final owner, matching
// orchestration, contracts and ACK renderer run. Native/registry/identity and
// sink IO is explicitly modeled; this grants no native/legal acceptance proof.
let sourceOrdinal=0
let declaredSources=new WeakSet<object>()
const hash=(value:string)=>createHash('sha256').update(value).digest('hex')
let results: unknown[] | undefined
type Request = Record<string, unknown>
let requests: Request[] = []
function requestPort() {
  const filters: Array<(row: Request) => boolean>=[]
  let descending=false, cap=Infinity
  let patch: Request | null=null
  function execute() {
    const selected = requests.filter(row=>filters.every(filter=>filter(row)))
    if(descending) selected.sort((a,b)=>String(b.created_at).localeCompare(String(a.created_at)))
    const page=selected.slice(0,cap)
    if(patch) for(const row of page) Object.assign(row,patch)
    return page
  }
  const q = {
    select:()=>q,
    eq:(column:string,value:unknown)=>{filters.push(row=>row[column]===value);return q},
    in:(column:string,values:unknown[])=>{filters.push(row=>values.includes(row[column]));return q},
    order:()=>{descending=true;return q},
    limit:(n:number)=>{cap=n;return q},
    update:(values:Request)=>{patch=values;return q},
    maybeSingle:async()=>({data:execute()[0]??null,error:null}),
    single:async()=>({data:execute()[0]??null,error:null}),
    then:(resolve:(value:unknown)=>unknown)=>Promise.resolve({data:execute(),count:0,error:null}).then(resolve),
  }
  return q
}
beforeEach(() => {
  vi.clearAllMocks();resetUtiltsCanonicalOwnerIo();sourceOrdinal=0;declaredSources=new WeakSet();results = []; io.findOutbound.mockResolvedValue(null); io.complete.mockResolvedValue(null)
  io.update.mockResolvedValue(null)
  io.event.mockResolvedValue(null)
  io.updateOutbound.mockImplementation(async args => ({
    id: 'outbound-source', source_type: 'grid_owner_data_request', source_id: 'july',
    status: args.status, external_reference: args.externalReference, response_payload: args.responsePayload,
  }))
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
    if(table==='grid_owner_data_requests') return requestPort()
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

const outbound = { id: 'outbound-source', source_type: 'grid_owner_data_request', source_id: 'july', status: 'sent' }

function selectJulyRequest(versionState: 'current' | 'late_older_history', withCurrentSibling = false) {
  const message = energyHandoffMessage('2026-11-18')
  message.sender_ediel_id = '91100'
  message.receiver_ediel_id = '21660'
  message.metering_point_id = 'point-a'
  message.grid_owner_data_request_id = 'july'
  message.external_reference = 'GRIDEX2607E66MSG001'
  if (withCurrentSibling) {
    const segments = message.raw_payload!.split('\n')
    const firstIde = segments.findIndex(segment => segment.startsWith('IDE+'))
    const trailer = segments.findIndex(segment => segment.startsWith('UNT+'))
    const sibling = segments.slice(firstIde, trailer).map(segment => segment
      .replace('GRIDEX2607E66001', 'GRIDEX2607E66002')
      .replace('202607010000202607010015', '202607010015202607010030')
      .replace('DTM+597:202607010020', 'DTM+597:202607010035')
      .replace('DTM+597:202607010000', 'DTM+597:202607010015'))
    segments.splice(trailer, 0, ...sibling)
    message.raw_payload = recountEdifactUnt(segments.join('\n'))
  }
  const scoped = declaredTestSource(message)
  requests = [{
    id: 'july', company_id: scoped.company_id, customer_id: 'customer-a', site_id: 'site-a', metering_point_id: 'point-a',
    status: 'sent', request_scope: 'meter_values', response_payload: { prior: 'outgoing-receipt' }, external_reference: 'JULY-REQUEST',
    created_at: '2026-07-01', requested_period_start: '2026-07-01', requested_period_end: '2026-07-31',
  }]
  io.get.mockResolvedValue(scoped)
  const first = {
    transactionId: 'GRIDEX2607E66001', disposition: 'accepted', responseType: 'positive_aperak', persistenceStatus: 'persisted', versionState,
  }
  results = withCurrentSibling ? [first, { ...first, transactionId: 'GRIDEX2607E66002', versionState: 'current' }] : [first]
  return scoped
}

it.each(['with outbound', 'without outbound'])('keeps the explicitly linked request open for historical-only E66 (%s)', async variant => {
  const source = selectJulyRequest('late_older_history')
  if (variant === 'with outbound') io.findOutbound.mockResolvedValue(outbound)
  const outcome = await processInboundUtiltsMessage({ actorUserId: UTILTS_FIXTURE_ACTOR, edielMessageId: source.id })

  expect(outcome.matchedDataRequest?.id).toBe('july')
  expect(outcome.ingestedMeterValueIds).toEqual([])
  expect(io.ack).toHaveBeenCalledWith(expect.objectContaining({ ackFamily: 'APERAK', outcome: 'positive' }))
  expect(io.meter).not.toHaveBeenCalled()
  expect(io.bill).not.toHaveBeenCalled()
  expect(requests[0]).toMatchObject({ status: 'sent', external_reference: 'JULY-REQUEST', response_payload: { prior: 'outgoing-receipt' } })
  expect(requests[0]).not.toHaveProperty('received_at')
  expect(io.updateOutbound).not.toHaveBeenCalled()
  expect(io.complete).not.toHaveBeenCalled()
})

it('retains the ordinary status and write behavior when the exact response owner reports a current E66 value', async () => {
  const source = selectJulyRequest('current')
  io.findOutbound.mockResolvedValue(outbound)
  const outcome = await processInboundUtiltsMessage({ actorUserId: UTILTS_FIXTURE_ACTOR, edielMessageId: source.id })

  expect(outcome.matchedDataRequest?.id).toBe('july')
  expect(outcome.ingestedMeterValueIds).toEqual(['meter-value'])
  expect(io.meter).toHaveBeenCalledWith(expect.objectContaining({ sourceRequestId: 'july', sourceMessageId: source.id }))
  expect(io.ack).toHaveBeenCalledWith(expect.objectContaining({ ackFamily: 'APERAK', outcome: 'positive' }))
  expect(io.updateOutbound).toHaveBeenCalledWith(expect.objectContaining({ outboundRequestId: 'outbound-source', status: 'acknowledged' }))
  expect(io.complete).toHaveBeenCalledWith(expect.objectContaining({ requestId: 'july', edielMessageId: source.id }))
  expect(requests[0]).toMatchObject({ status: 'received' })
})

it('keeps a current sibling eligible when another accepted E66 transaction was retained as history', async () => {
  const source = selectJulyRequest('late_older_history', true)
  const outcome = await processInboundUtiltsMessage({ actorUserId: UTILTS_FIXTURE_ACTOR, edielMessageId: source.id })

  expect(outcome.ingestedMeterValueIds).toEqual(['meter-value'])
  expect(io.meter).toHaveBeenCalledExactlyOnceWith(expect.objectContaining({ sourceTransactionReference: 'GRIDEX2607E66002' }))
  expect(io.complete).toHaveBeenCalledWith(expect.objectContaining({ requestId: 'july', edielMessageId: source.id }))
  expect(requests[0]).toMatchObject({ status: 'received' })
})
