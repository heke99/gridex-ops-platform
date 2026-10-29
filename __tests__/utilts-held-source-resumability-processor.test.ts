// FINDINGS F80 (processor level): a held source's event says it is held, not rejected,
// and every rerun appends the previous validation_report.utiltsRuntime to an
// append-only utiltsRuntimeHistory. Harness copied from
// __tests__/ediel-utilts-persistence-processor.test.ts (real parser/engine/owner, modeled IO).
// Synthetic data only.
import { createUtiltsFinalValidationIo, qualifyUtiltsFixtureSource as registerFixtureSource, currentUtiltsActorQuery, UTILTS_FIXTURE_ACTOR } from './helpers/utiltsCurrentOwnerFixture'
import { beforeEach, expect, it, vi } from 'vitest'
import { processInboundUtiltsMessage } from '@/lib/ediel/flows/utiltsDataRequest.part-2'
import { energyHandoffMessage } from './helpers/utiltsObservationHandoff'
import { bindingRpcRows } from './helpers/utiltsBoundFixture'
import {receivedUtiltsOwnerFixture,resetUtiltsCanonicalOwnerIo} from './helpers/utiltsCanonicalOwnerIo'
import {createHash} from 'node:crypto'
import type {EdielMessageRow} from '@/lib/ediel/types'
import {segmentUntrimmedRaw,tokenizeEdifact} from '@/lib/ediel/core/edifactTokenizer'
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

const TX = 'GRIDEX2607E66001'
const heldRow = { transactionId: TX, disposition: 'internal_review', responseType: 'none', persistenceStatus: 'not_applicable' }
// Missing issuer-identity evidence: the protected read fails, the engine holds
// the own accepted transaction (UTILTS_ISSUER_IDENTITY_BASIS_UNAVAILABLE).
let approvedRpc: ((name: string, args: Record<string, unknown>) => unknown) | undefined
beforeEach(() => { approvedRpc = undefined })
function issuerEvidence(approved: boolean) {
  approvedRpc = approvedRpc ?? io.rpc.getMockImplementation()!
  const base = approvedRpc
  io.rpc.mockImplementation((name: string, args: Record<string, unknown>) =>
    !approved && name === 'gridex_read_utilts_issuer_identity_authority_v1'
      ? Promise.resolve({ data: null, error: { message: 'issuer evidence not approved (fixture)' } })
      : base(name, args))
}
function heldSource() {
  const message = energyHandoffMessage('2026-10-01')
  message.sender_ediel_id = '91100'; message.receiver_ediel_id = '21660'
  return declaredTestSource(message)
}
type Update = { validationReport?: Record<string, unknown> }
const reportsWritten = () => io.update.mock.calls.map(([call]) => (call as Update).validationReport).filter(Boolean) as Record<string, unknown>[]
const eventTexts = () => io.event.mock.calls.map(([call]) => String((call as { message?: unknown }).message ?? ''))

it('a held source is reported as held for internal review (no reply, no values), not as rejected', async () => {
  const message = heldSource(); io.get.mockResolvedValue(message); issuerEvidence(false)
  results = [heldRow]
  const result = await processInboundUtiltsMessage({ actorUserId: UTILTS_FIXTURE_ACTOR, edielMessageId: message.id })
  const persisted = io.rpc.mock.calls.find(([name]) => name === 'gridex_persist_utilts_consumption_v1')![1]
  expect(persisted.p_transactions).toMatchObject([{ transactionId: TX, disposition: 'internal_review', responseType: 'none',
    issueCodes: expect.arrayContaining(['UTILTS_ISSUER_IDENTITY_BASIS_UNAVAILABLE']) }])
  expect(result.ackIds.every((ackId) => ackId === 'ack-CONTRL')).toBe(true)
  expect(io.ack.mock.calls.map(([call]) => call.ackFamily)).not.toContain('APERAK')
  expect(io.ack.mock.calls.map(([call]) => call.ackFamily)).not.toContain('UTILTS_ERR')
  expect(io.meter).not.toHaveBeenCalled(); expect(io.bill).not.toHaveBeenCalled()
  // Main's Swedish UTILTS source-field enforcement (ca29ef3e0) also holds this fixture on its structure basis; that
  // event text then wins. Either text states a hold, with no reply sent and no values stored, never a rejection.
  const held = io.event.mock.calls.map(([call]) => call).find((call) => /hålls för intern granskning|väntar på godkänt strukturunderlag/.test(String(call.message)))
  expect(held).toMatchObject({ eventStatus: 'warning', payload: { heldTransactionIds: [TX] } })
  expect(String(held!.message)).toMatch(/Inget applikationssvar har skickats och inga mätvärden har lagrats; ingenting har avvisats\.|har inte kvitterats eller lagrats som mätvärden\./)
  expect(eventTexts().some((text) => text.includes('avvisades av produktionsruntime'))).toBe(false)
})

it('each rerun keeps the current runtime and appends the previous one to an append-only history', async () => {
  const message = heldSource(); io.get.mockResolvedValue(message); issuerEvidence(false)
  const original = { validation: { classification: 'synthetic_first_reception' }, ackPlan: { reason: 'first' } }
  message.validation_report = { ...(message.validation_report ?? {}), unrelatedKey: 'kept', utiltsRuntime: original }
  results = [heldRow]

  await processInboundUtiltsMessage({ actorUserId: UTILTS_FIXTURE_ACTOR, edielMessageId: message.id })
  const firstRun = reportsWritten()
  expect(firstRun.length).toBeGreaterThan(0)
  for (const report of firstRun) {
    expect(report.unrelatedKey).toBe('kept')
    expect(report.utiltsRuntimeHistory).toEqual([{ supersededAt: expect.any(String), supersededByActorUserId: UTILTS_FIXTURE_ACTOR, runtime: original }])
  }
  const heldReport = firstRun.at(-1)!
  expect(heldReport.utiltsRuntime).toMatchObject({ validation: { classification: 'internal_review' } })

  // Second attempt from the persisted state (evidence still not approved):
  // the held diagnosis is not lost; it is appended after the first entry.
  io.update.mockClear()
  message.validation_report = heldReport
  // An actor without current tenant authority cannot rerun it (no write at all).
  await expect(processInboundUtiltsMessage({ actorUserId: 'foreign-operator', edielMessageId: message.id })).rejects.toThrow('ediel_tenant_actor_required')
  expect(io.update).not.toHaveBeenCalled()
  await processInboundUtiltsMessage({ actorUserId: UTILTS_FIXTURE_ACTOR, edielMessageId: message.id })
  const secondRun = reportsWritten()
  expect(secondRun.length).toBeGreaterThan(0)
  for (const report of secondRun) {
    expect(report.utiltsRuntimeHistory).toEqual([
      { supersededAt: expect.any(String), supersededByActorUserId: UTILTS_FIXTURE_ACTOR, runtime: original },
      { supersededAt: expect.any(String), supersededByActorUserId: UTILTS_FIXTURE_ACTOR, runtime: heldReport.utiltsRuntime },
    ])
  }
})

it('after the issuer evidence is approved, the same preserved original resumes: the held transaction gets its own reply and values once', async () => {
  const message = heldSource(); io.get.mockResolvedValue(message); issuerEvidence(false)
  results = [heldRow]
  await processInboundUtiltsMessage({ actorUserId: UTILTS_FIXTURE_ACTOR, edielMessageId: message.id })
  expect(io.ack.mock.calls.map(([call]) => call.ackFamily)).not.toContain('APERAK')
  expect(io.meter).not.toHaveBeenCalled()
  const rawBefore = message.raw_payload
  message.validation_report = reportsWritten().at(-1)!

  io.ack.mockClear(); io.rpc.mockClear(); issuerEvidence(true)
  // Modeled persistence mirrors the request (the DB upgrades only an unfinalized held row).
  results = undefined
  await processInboundUtiltsMessage({ actorUserId: UTILTS_FIXTURE_ACTOR, edielMessageId: message.id })
  // The issuer basis is re-read for this exact source at run time.
  expect(io.rpc).toHaveBeenCalledWith('gridex_read_utilts_issuer_identity_authority_v1', { p_company_id: message.company_id, p_message_id: message.id })
  const persisted = io.rpc.mock.calls.find(([name]) => name === 'gridex_persist_utilts_consumption_v1')![1]
  expect(persisted).toMatchObject({ p_source_message_id: message.id, p_raw_payload: rawBefore, p_transactions: [{ transactionId: TX, disposition: 'accepted' }] })
  // Exactly one new application reply: the positive APERAK of the transaction
  // that left internal review. (This harness's ACK read models no stored
  // originals, so CONTRL reuse is proven by findExistingAckForSource, not here.)
  const aperaks = io.ack.mock.calls.filter(([call]) => call.ackFamily === 'APERAK')
  expect(aperaks.map(([call]) => call.outcome)).toEqual(['positive'])
  expect(JSON.stringify(aperaks[0][0].draft)).toContain(TX)
  expect(io.ack.mock.calls.map(([call]) => call.ackFamily)).not.toContain('UTILTS_ERR')
  expect(io.meter).toHaveBeenCalledTimes(1)
  const last = reportsWritten().at(-1)!
  expect((last.utiltsRuntimeHistory as { runtime: { validation: { classification: string } } }[]).at(-1)!.runtime.validation.classification).toBe('internal_review')
})
