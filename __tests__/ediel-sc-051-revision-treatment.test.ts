// masterplan: SC-051
import { createHash } from 'node:crypto'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import type { EdielMessageRow } from '@/lib/ediel/types'
import type { UtiltsBoundPersistenceInput } from '@/lib/ediel/utilts/transactionPersistence'
import type { UtiltsConsumptionContract } from '@/lib/ediel/utilts/consumptionContract'
import { processInboundUtiltsMessageByCanonicalPolicy } from '@/lib/ediel/flows/utiltsInboundPolicyProcessor'
import { resolveCanonicalMessagePolicy } from '@/lib/ediel/core/messagePolicy'
import { assertRegistryRulebookAllowsSend } from '@/lib/ediel/rulebook/sendGuards'
import * as sendGuardConsumers from '@/lib/ediel/rulebook/sendGuards'
import { buildUtiltsOutboundDraft } from '@/lib/ediel/utilts'
import { sendOutboxItem } from '@/lib/ediel/outbox/sendOutboxItem'
import { bindingRpcRows } from './helpers/utiltsBoundFixture'
import { energyHandoffMessage } from './helpers/utiltsObservationHandoff'
import { receivedUtiltsOwnerFixture, resetUtiltsCanonicalOwnerIo } from './helpers/utiltsCanonicalOwnerIo'
import { createUtiltsFinalValidationIo, currentUtiltsActorQuery, qualifyUtiltsFixtureSource, UTILTS_FIXTURE_ACTOR } from './helpers/utiltsCurrentOwnerFixture'
import { createUtiltsFinalValidationIo as registryFixture } from './helpers/utiltsFinalValidationFixture'

const io = vi.hoisted(() => ({ get: vi.fn(), update: vi.fn(), event: vi.fn(), ack: vi.fn(), rpc: vi.fn(), from: vi.fn(), meter: vi.fn(), bill: vi.fn(), complete: vi.fn(), provider: vi.fn(), tenant: vi.fn(), readiness: vi.fn(), route: vi.fn() }))
vi.mock('@/lib/supabase/service', () => ({ supabaseService: { from: io.from, rpc: io.rpc } }))
vi.mock('@/lib/ediel/db', () => ({ getEdielMessageById: io.get, updateEdielMessageStatus: io.update, createEdielMessageEvent: io.event, linkEdielMessage: vi.fn(), listEdielTestRuns: vi.fn().mockResolvedValue([]) }))
vi.mock('@/lib/ediel/core/kernel', () => ({ createCanonicalAckMessage: io.ack }))
vi.mock('@/lib/ediel/core/versionRegistry', () => ({ resolveCanonicalOutboundVersion: vi.fn(async () => 'E5SE5A') }))
vi.mock('@/lib/email/sendEdielEmail', () => ({ sendEdielEmail: io.provider }))
vi.mock('@/lib/tenant/operationPolicy', () => ({ getTenantOperationDecision: io.tenant }))
vi.mock('@/lib/ediel/outbox/readinessGuard', () => ({ getEdielOutboundReadinessBlocker: io.readiness }))
vi.mock('@/lib/ediel/outbox/routeContract', () => ({ evaluateEdielRouteContract: io.route }))
vi.mock('@/lib/ediel/flows/shared', () => ({ ensureActorUserId: (id: string) => id }))
vi.mock('@/lib/metering/normalizeMeteringValues', () => ({ normalizeAndStoreMeteringValue: io.meter }))
vi.mock('@/lib/billing/meterValueBillingMatcher', () => ({ updateMeterValueBillingReadiness: vi.fn() }))
vi.mock('@/lib/cis/db', () => ({ ingestBillingUnderlay: io.bill, findOpenOutboundBySource: vi.fn().mockResolvedValue(null), syncGridOwnerDataRequestReceivedFromEdiel: io.complete }))
vi.mock('@/lib/ediel/matching', () => ({
  matchMeteringPointIdByIdentifier: vi.fn().mockResolvedValue('point-a'), matchMeteringPointForEdielMessage: vi.fn().mockResolvedValue('point-a'),
  matchSiteAndCustomerForMeteringPoint: vi.fn().mockResolvedValue({ customerId: 'customer-a', siteId: 'site-a', gridOwnerId: 'owner-a' }),
  findMatchingGridOwnerDataRequest: vi.fn().mockResolvedValue({ id: 'request-a', request_scope: 'billing_underlay', response_payload: {}, customer_id: 'customer-a', metering_point_id: 'point-a' }),
}))

// Current production dispatch/opaque owners/parser/contracts/ACK drafts execute.
// Original insertion, issuer/registry/current actor/matching and persistence/ACK
// sinks are declared finite IO. The retained seven cases do not prove native
// custody or worker retry; the additive case reaches the actual worker with
// explicitly declared public claim/route/tenant and denied original-source IO.
let duringRegistry: (() => void) | undefined
beforeEach(() => {
  vi.clearAllMocks(); resetUtiltsCanonicalOwnerIo(); duringRegistry = undefined
  io.update.mockImplementation(async input => input); io.event.mockResolvedValue(null)
  io.complete.mockResolvedValue(null); io.meter.mockResolvedValue({ status: 'stored', meteringValue: { id: 'meter-value' } }); io.bill.mockResolvedValue({ id: 'underlay' })
  io.ack.mockImplementation(async ({ ackFamily }) => ({ id: `ack-${ackFamily}` }))
  const inbound = createUtiltsFinalValidationIo(), registry = registryFixture()
  io.rpc.mockImplementation((name: string, args: Record<string, unknown>) => {
    if (name === 'resolve_canonical_ediel_rule_pack_with_witness_v1') { duringRegistry?.(); duringRegistry = undefined }
    const canonical = name === 'resolve_canonical_ediel_rule_pack_with_witness_v1' && args.p_direction === 'outbound'
      ? registry(name, args) : inbound(name, args)
    if (canonical) return canonical
    if (name === 'gridex_persist_utilts_consumption_v1') {
      const transactions = args.p_transactions as (UtiltsBoundPersistenceInput['transactions'][number] & { consumptionContract: UtiltsConsumptionContract })[]
      const input = { companyId: args.p_company_id, environment: args.p_environment, sourceMessageId: args.p_source_message_id,
        messageCode: args.p_message_code, rawPayload: args.p_raw_payload, transactions, contracts: transactions.map(t => t.consumptionContract) } as UtiltsBoundPersistenceInput
      const response = { data: bindingRpcRows(input), error: null }
      return Object.assign(Promise.resolve(response), { abortSignal: () => Promise.resolve(response) })
    }
    return Promise.resolve({ data: null, error: { message: `undeclared_sc051_port:${name}` } })
  })
  io.from.mockImplementation((table: string) => {
    const actor = currentUtiltsActorQuery(table); if (actor) return actor
    const q = { select: () => q, eq: () => q, is: () => q, in: () => q, lte: () => q, limit: () => q, update: () => q,
      then: (resolve: (value: unknown) => unknown) => Promise.resolve({ data: table === 'ediel_ack_transaction_results' ? [{ id: 'ack-row' }] : [], count: 0, error: null }).then(resolve) }
    return q
  })
})
afterEach(() => vi.useRealTimers())
afterEach(() => vi.restoreAllMocks())

function source(date: string, invalidPoint = false) {
  const message = energyHandoffMessage(date)
  // Fresh declared TEST original, before the source birth/hash capture. UNB/0031
  // ACK-request alone is not the physical TEST/0035 flag.
  message.raw_payload = message.raw_payload!.replace("23-DDQ-E66-T++1'", "23-DDQ-E66-T++1++1'")
  if (invalidPoint) message.raw_payload = message.raw_payload.replace('735999260731000007::9', '735999260731000008::9')
  Object.assign(message, receivedUtiltsOwnerFixture(message))
  qualifyUtiltsFixtureSource(message); io.get.mockResolvedValue(message)
  return message
}
const hash = (raw: string) => createHash('sha256').update(raw).digest('hex')

it.each([['2026-09-30', '25-A-3'], ['2026-10-01', '25-A-4']])('SC-051 actual receipt %s carries one %s through final owner, consumption and ACK', async (date, guide) => {
  const message = source(date), before = structuredClone(message)
  vi.useFakeTimers({ toFake: ['Date'] }); vi.setSystemTime(new Date('2026-10-20T12:00:00Z'))
  await processInboundUtiltsMessageByCanonicalPolicy({ actorUserId: UTILTS_FIXTURE_ACTOR, edielMessageId: message.id })
  const registryCalls = io.rpc.mock.calls.filter(([name]) => name === 'resolve_canonical_ediel_rule_pack_with_witness_v1')
  expect(registryCalls).toHaveLength(1); expect(registryCalls[0][1].p_business_date).toBe(date)
  const recorded = JSON.parse(io.rpc.mock.calls.find(([name]) => name === 'gridex_record_utilts_source_validation_v4')![1].p_facts_text)
  expect(recorded.rulePackEvidence.version).toBe(`${guide}:r${guide.at(-1)}`)
  const persisted = io.rpc.mock.calls.find(([name]) => name === 'gridex_persist_utilts_consumption_v1')![1]
  expect(persisted.p_transactions).toHaveLength(1)
  expect(persisted.p_transactions[0].consumptionContract.guideRevision).toBe(guide)
  expect(persisted.p_raw_payload).toBe(before.raw_payload)
  expect(io.meter).toHaveBeenCalledTimes(1); expect(io.bill).toHaveBeenCalledTimes(1)
  expect(io.ack.mock.calls.map(([call]) => [call.ackFamily, call.outcome])).toEqual([['CONTRL', 'positive'], ['APERAK', 'positive']])
  expect(message).toEqual(before)
})

it.each([['2026-09-30', true], ['2026-10-15', false]] as const)('SC-051 October field209 enforcement is not activated early at receipt %s', async (date, allowed) => {
  const message = source(date, true), original = hash(message.raw_payload!)
  await processInboundUtiltsMessageByCanonicalPolicy({ actorUserId: UTILTS_FIXTURE_ACTOR, edielMessageId: message.id })
  const persisted = io.rpc.mock.calls.find(([name]) => name === 'gridex_persist_utilts_consumption_v1')![1]
  expect(persisted.p_transactions[0].disposition).toBe(allowed ? 'accepted' : 'guide_rejected')
  expect(persisted.p_transactions[0].consumptionContract.guideRevision).toBe(allowed ? '25-A-3' : '25-A-4')
  expect(io.ack.mock.calls.map(([call]) => [call.ackFamily, call.outcome])).toEqual([['CONTRL', 'positive'], ['APERAK', allowed ? 'positive' : 'negative']])
  if (allowed) { expect(io.meter).toHaveBeenCalledTimes(1); expect(io.bill).toHaveBeenCalledTimes(1) }
  else {
    expect(io.meter).not.toHaveBeenCalled(); expect(io.bill).not.toHaveBeenCalled(); expect(io.complete).not.toHaveBeenCalled()
    expect(String(io.ack.mock.calls.find(([call]) => call.ackFamily === 'APERAK')![0].draft.rawPayload)).toContain('209')
  }
  expect(hash(message.raw_payload!)).toBe(original)
})

it('SC-051 an asynchronous clock rollover cannot reselect the receipt guide in downstream billing', async () => {
  const message = source('2026-09-30')
  vi.useFakeTimers({ toFake: ['Date'] }); vi.setSystemTime(new Date('2026-09-30T21:59:59Z'))
  duringRegistry = () => vi.setSystemTime(new Date('2026-10-01T00:01:00Z'))
  await processInboundUtiltsMessageByCanonicalPolicy({ actorUserId: UTILTS_FIXTURE_ACTOR, edielMessageId: message.id })
  const writes = io.rpc.mock.calls.filter(([name]) => name === 'gridex_persist_utilts_consumption_v1')
  expect(writes).toHaveLength(1)
  expect(writes[0][1].p_transactions[0].consumptionContract.guideRevision).toBe('25-A-3')
  expect(io.rpc.mock.calls.filter(([name]) => name === 'resolve_canonical_ediel_rule_pack_with_witness_v1')).toHaveLength(1)
  expect(io.meter).toHaveBeenCalledTimes(1); expect(io.bill).toHaveBeenCalledTimes(1)
})

it('SC-051 the real pre-send consumer captures its own fresh boundary before asynchronous registry IO', async () => {
  vi.useFakeTimers({ toFake: ['Date'] }); vi.setSystemTime(new Date('2026-09-30T10:00:00Z'))
  const draft = await buildUtiltsOutboundDraft({ code: 'E73', environment: 'test', senderEdielId: '11111', receiverEdielId: '22222',
    applicationReference: '23-DDQ-E66-S', externalReference: 'SC051-DOC', transactionReference: 'SC051-TX',
    payload: { legalSenderEdielId: '33333', legalReceiverEdielId: '44444', meterPointId: '735999100001686670', gridAreaId: 'TES',
      periodStart: '2026-09-30T00:00:00+01:00', periodEnd: '2026-10-01T00:00:00+01:00', registrationTime: '2026-10-01T10:00:00+01:00', siteType: 'Consumption' } })
  const message = { id: 'sc051-outbound', company_id: 'own-company', environment: 'test', direction: 'outbound', message_family: 'UTILTS', message_code: 'E73',
    message_version: 'E5SE5A', message_standard: 'edifact', application_reference: draft.applicationReference, raw_payload: draft.rawPayload, parsed_payload: {},
    created_at: '2026-09-01T00:00:00Z', message_sent_at: '2026-09-02T00:00:00Z' } as EdielMessageRow
  const original = hash(message.raw_payload!)
  duringRegistry = () => vi.setSystemTime(new Date('2026-10-01T00:01:00Z'))
  const before = await assertRegistryRulebookAllowsSend(message)
  expect(before?.canonicalPolicy?.guide.guideRevision).toBe('25-A-3')
  expect(before?.rulePackSnapshot?.version).toBe('25-A-3:r3')
  const after = await assertRegistryRulebookAllowsSend(message)
  expect(after?.canonicalPolicy?.guide.guideRevision).toBe('25-A-4')
  expect(after?.rulePackSnapshot?.version).toBe('25-A-4:r4')
  expect(io.rpc.mock.calls.filter(([name]) => name === 'resolve_canonical_ediel_rule_pack_with_witness_v1').map(([, args]) => args.p_business_date)).toEqual(['2026-09-30', '2026-10-01'])
  expect(hash(message.raw_payload!)).toBe(original)
})

it('SC-051 replay trace time preserves a stored receipt selection and original E5SE5A bytes', () => {
  const message = source('2026-09-30'), original = hash(message.raw_payload!)
  vi.useFakeTimers({ toFake: ['Date'] }); vi.setSystemTime(new Date('2026-10-20T12:00:00Z'))
  const policy = resolveCanonicalMessagePolicy(message, undefined, { replayAt: '2026-10-20T12:00:00Z' })!
  expect(policy.guide.guideRevision).toBe('25-A-3')
  expect(policy.timeAnchors).toMatchObject({ admissionDate: '2026-09-30', admissionSource: 'local_ingress', replayAt: '2026-10-20T12:00:00.000Z' })
  expect(message.raw_payload).toContain('UTILTS:D:02B:UN:E5SE5A')
  expect(hash(message.raw_payload!)).toBe(original)
  expect(io.rpc).not.toHaveBeenCalled(); expect(io.meter).not.toHaveBeenCalled(); expect(io.bill).not.toHaveBeenCalled(); expect(io.ack).not.toHaveBeenCalled()
  // This is trace-only policy inspection, not an operative historical replay.
})

it('SC-051 the actual queued worker reconsiders the unchanged September E5SE5A original with October admission and holds before provider entry', async () => {
  // Public claim/storage/tenant/route readiness and registry activation are
  // finite IO. The worker, claim adapter, SMTP admission and national validator
  // execute unchanged. No private original/capability or SMTP result is seeded.
  // An explicitly absent qualified original is a denied source port, not an
  // undeclared RPC failure or authority fabricated from the old public trace.
  vi.useFakeTimers({ toFake: ['Date'] }); vi.setSystemTime(new Date('2026-09-30T10:00:00Z'))
  const draft = await buildUtiltsOutboundDraft({ code: 'E73', environment: 'test', senderEdielId: '11111', receiverEdielId: '22222',
    applicationReference: '23-DDQ-E66-S', externalReference: 'SC051-RETRY-DOC', transactionReference: 'SC051-RETRY-TX',
    payload: { legalSenderEdielId: '33333', legalReceiverEdielId: '44444', meterPointId: '735999100001686670', gridAreaId: 'TES',
      periodStart: '2026-09-30T00:00:00+01:00', periodEnd: '2026-10-01T00:00:00+01:00', registrationTime: '2026-10-01T10:00:00+01:00', siteType: 'Consumption' } })
  const message = { id: 'sc051-retry-original', company_id: 'own-company', environment: 'test', direction: 'outbound', status: 'failed',
    message_family: 'UTILTS', message_code: 'E73', message_version: 'E5SE5A', message_standard: 'edifact',
    sender_ediel_id: '11111', receiver_ediel_id: '22222', receiver_email: 'recipient@example.invalid',
    application_reference: draft.applicationReference, raw_payload: draft.rawPayload, parsed_payload: {},
    created_at: '2026-09-30T10:00:00Z', message_sent_at: null } as EdielMessageRow
  const prior = await assertRegistryRulebookAllowsSend(message)
  expect(prior?.canonicalPolicy?.guide.guideRevision).toBe('25-A-3')
  expect(prior?.issues.filter(issue => issue.severity === 'error' || issue.blocking)).toEqual([])
  const retainedDecision = structuredClone({ policy: prior?.canonicalPolicy, snapshot: prior?.rulePackSnapshot })
  // Public historical trace is retained in the exact source row. It supplies
  // no original witness or capability to the later send/capture boundary.
  message.validation_report = { priorAdmissionDecision: structuredClone(retainedDecision) }
  const original = structuredClone(message), originalHash = hash(message.raw_payload!)
  const outbox = { id: 'sc051-outbox', company_id: message.company_id, environment: message.environment,
    ediel_message_id: message.id, status: 'queued', locked_by: null as string | null,
    current_send_attempt_id: 'sc051-prior-failed-attempt' }
  const updates: Array<{ filters: Array<[string, unknown]>; payload: Record<string, unknown> }> = []
  const inheritedRpc = io.rpc.getMockImplementation()!, inheritedFrom = io.from.getMockImplementation()!
  io.get.mockResolvedValue(message)
  io.tenant.mockResolvedValue({ allowed: true, company_status: 'active' })
  io.readiness.mockResolvedValue(null)
  io.route.mockResolvedValue({ blocker: null, fingerprint: 'declared-current-route', routeId: null,
    receiverEdielId: '22222', receiverSubaddress: null, receiverEmail: message.receiver_email, certificateId: null,
    certificateFingerprint: null, checks: { declaredFiniteReadiness: true } })
  io.rpc.mockImplementation((name: string, args: Record<string, unknown>) => {
    if (name === 'claim_ediel_outbox_item') {
      expect(args).toEqual({ p_outbox_item_id: outbox.id, p_worker_id: 'sc051-worker', p_actor_user_id: UTILTS_FIXTURE_ACTOR })
      expect(outbox.status).toBe('queued')
      Object.assign(outbox, { status: 'sending', locked_by: 'sc051-worker', current_send_attempt_id: 'sc051-new-attempt' })
      return Promise.resolve({ data: [structuredClone(outbox)], error: null })
    }
    if (['gridex_ediel_accepted_transport_projection_v1', 'gridex_ediel_negative_fixture_read_v1'].includes(name)) return Promise.resolve({ data: null, error: null })
    if (name === 'ediel_capture_source_rule_pack_basis_v1') {
      expect(args).toEqual({ p_company_id: message.company_id, p_message_id: message.id })
      return Promise.resolve({ data: null, error: { message: 'ediel_source_rule_pack_basis_required' } })
    }
    return inheritedRpc(name, args)
  })
  io.from.mockImplementation((table: string) => {
    if (!['ediel_outbox', 'ediel_send_locks'].includes(table)) return inheritedFrom(table)
    const filters: Array<[string, unknown]> = []; let payload: Record<string, unknown> | undefined
    const result = () => {
      if (payload) {
        expect(table).toBe('ediel_outbox')
        expect(filters).toEqual([['id', outbox.id], ['current_send_attempt_id', 'sc051-new-attempt']])
        updates.push({ filters: structuredClone(filters), payload: structuredClone(payload) }); Object.assign(outbox, payload)
      } else expect(filters).toEqual([['company_id', message.company_id]])
      return { data: payload ? { id: outbox.id } : [], error: null }
    }
    const query = { select: () => query, eq: (key: string, value: unknown) => { filters.push([key, value]); return query },
      limit: () => query, update: (value: Record<string, unknown>) => { payload = value; return query },
      maybeSingle: async () => result(), then: (resolve: (value: unknown) => unknown) => Promise.resolve(result()).then(resolve) }
    return query
  })
  vi.setSystemTime(new Date('2026-10-15T10:00:00Z'))
  const actualAdmission = vi.spyOn(sendGuardConsumers, 'assertRegistryRulebookAllowsSend')
  const result = await sendOutboxItem({ actorUserId: UTILTS_FIXTURE_ACTOR, outboxItemId: outbox.id, workerId: 'sc051-worker' })
  expect(result).toMatchObject({ status: 'failed', messageId: null })
  expect(result.error).toBe('ediel_source_rule_pack_basis_required')
  expect(actualAdmission).toHaveBeenCalledTimes(1)
  const currentAdmission = await actualAdmission.mock.results[0].value
  expect(currentAdmission?.canonicalPolicy?.guide.guideRevision).toBe('25-A-4')
  expect(currentAdmission?.rulePackSnapshot?.version).toBe('25-A-4:r4')
  expect(currentAdmission?.canonicalPolicy?.referenceDate).toBe('2026-10-15')
  expect(io.rpc.mock.calls.filter(([name]) => name === 'resolve_canonical_ediel_rule_pack_with_witness_v1')
    .map(([, args]) => args.p_business_date)).toEqual(['2026-09-30', '2026-10-15'])
  expect(io.rpc.mock.calls.filter(([name]) => name === 'claim_ediel_outbox_item')).toHaveLength(1)
  expect(io.rpc.mock.calls.filter(([name]) => name === 'gridex_ediel_accepted_transport_projection_v1')).toHaveLength(2)
  expect(updates.at(-1)?.payload).toMatchObject({ status: 'failed', locked_at: null, locked_by: null })
  expect(updates.at(-1)?.payload.last_error).toBe('ediel_source_rule_pack_basis_required')
  expect(message).toEqual(original); expect(hash(message.raw_payload!)).toBe(originalHash)
  expect(message.raw_payload).toContain('UTILTS:D:02B:UN:E5SE5A')
  expect(retainedDecision).toEqual({ policy: prior?.canonicalPolicy, snapshot: prior?.rulePackSnapshot })
  expect(retainedDecision.policy?.guide.guideRevision).toBe('25-A-3')
  expect(io.rpc.mock.calls.filter(([name]) => name === 'ediel_capture_source_rule_pack_basis_v1')).toHaveLength(1)
  expect(io.rpc.mock.calls.some(([name]) => /outbound_attempt|dispatch_enter|persist_utilts_consumption/.test(name))).toBe(false)
  expect(io.provider).not.toHaveBeenCalled(); expect(io.update).not.toHaveBeenCalled(); expect(io.event).not.toHaveBeenCalled()
  expect(io.meter).not.toHaveBeenCalled(); expect(io.bill).not.toHaveBeenCalled(); expect(io.complete).not.toHaveBeenCalled(); expect(io.ack).not.toHaveBeenCalled()
})
