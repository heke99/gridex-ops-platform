// masterplan: SC-068
import { createHash } from 'node:crypto'
import { beforeEach, expect, it, vi } from 'vitest'
import type { EdielMessageRow } from '@/lib/ediel/types'
import { processInboundUtiltsMessageByCanonicalPolicy } from '@/lib/ediel/flows/utiltsInboundPolicyProcessor'
import { resolveCanonicalRuntimeDecisionWithRegistry } from '@/lib/ediel/core/runtimeDecision'
import { resolveCanonicalEdielPolicy } from '@/lib/ediel/rulebook/canonicalEdielPolicy'
import { sendEdielMessageViaSmtp } from '@/lib/ediel/transport/index.part-2'
import { energyHandoffMessage } from './helpers/utiltsObservationHandoff'
import { receivedUtiltsOwnerFixture, resetUtiltsCanonicalOwnerIo } from './helpers/utiltsCanonicalOwnerIo'
import { createUtiltsFinalValidationIo, currentUtiltsActorQuery, qualifyUtiltsFixtureSource, UTILTS_FIXTURE_ACTOR } from './helpers/utiltsCurrentOwnerFixture'

const io = vi.hoisted(() => ({ get: vi.fn(), update: vi.fn(), event: vi.fn(), link: vi.fn(), ack: vi.fn(), rpc: vi.fn(), from: vi.fn(), meter: vi.fn(), bill: vi.fn(), provider: vi.fn(), complete: vi.fn() }))
vi.mock('@/lib/supabase/service', () => ({ supabaseService: { from: io.from, rpc: io.rpc } }))
vi.mock('@/lib/ediel/db', () => ({ getEdielMessageById: io.get, updateEdielMessageStatus: io.update, createEdielMessageEvent: io.event, linkEdielMessage: io.link, listEdielTestRuns: vi.fn().mockResolvedValue([]) }))
vi.mock('@/lib/ediel/core/kernel', () => ({ createCanonicalAckMessage: io.ack }))
vi.mock('@/lib/ediel/flows/shared', () => ({ ensureActorUserId: (id: string) => id }))
vi.mock('@/lib/email/sendEdielEmail', () => ({ sendEdielEmail: io.provider }))
vi.mock('@/lib/metering/normalizeMeteringValues', () => ({ normalizeAndStoreMeteringValue: io.meter }))
vi.mock('@/lib/billing/meterValueBillingMatcher', () => ({ updateMeterValueBillingReadiness: vi.fn() }))
vi.mock('@/lib/cis/db', () => ({ ingestBillingUnderlay: io.bill, findOpenOutboundBySource: vi.fn().mockResolvedValue(null), syncGridOwnerDataRequestReceivedFromEdiel: io.complete }))
vi.mock('@/lib/ediel/matching', () => ({
  matchMeteringPointIdByIdentifier: vi.fn().mockResolvedValue('point-a'), matchMeteringPointForEdielMessage: vi.fn().mockResolvedValue('point-a'),
  matchSiteAndCustomerForMeteringPoint: vi.fn().mockResolvedValue({ customerId: 'customer-a', siteId: 'site-a', gridOwnerId: 'owner-a' }),
  findMatchingGridOwnerDataRequest: vi.fn().mockResolvedValue({ id: 'request-a', request_scope: 'billing_underlay', response_payload: {}, customer_id: 'customer-a', metering_point_id: 'point-a' }),
}))

// Public SMTP and inbound consumers/opaque owners are real. Current identity,
// registry/original birth and accepted journal are explicit finite DB ports.
// A copied diagnostic decision below is deliberately NOT a genuine operative
// historical_replay decision: the current public owner has no such mode field.
beforeEach(() => {
  vi.clearAllMocks(); resetUtiltsCanonicalOwnerIo()
  const canonical = createUtiltsFinalValidationIo()
  io.rpc.mockImplementation((name: string, args: Record<string, unknown>) => name === 'gridex_ediel_accepted_transport_projection_v1'
    ? Promise.resolve({ data: null, error: null })
    : canonical(name, args) ?? Promise.resolve({ data: null, error: { message: `undeclared_sc068_port:${name}` } }))
  io.from.mockImplementation((table: string) => {
    const actor = currentUtiltsActorQuery(table); if (actor) return actor
    if (table !== 'ediel_counterparties') throw new Error(`undeclared_sc068_table:${table}`)
    const q = { select: () => q, eq: () => q, or: async () => ({ error: null, data: [] }) }
    return q
  })
})

function productionMessage(): EdielMessageRow {
  return { id: 'sc068-reference', company_id: 'own-company', environment: 'production', direction: 'outbound', status: 'queued', test_flag: 0,
    message_family: 'PRODAT', message_code: 'Z13', message_version: 'E2SE6A', message_standard: 'edifact',
    sender_ediel_id: '21660', receiver_ediel_id: '54321', receiver_email: 'dso@example.invalid', application_reference: '23-DGI-PRODAT',
    communication_route_id: 'declared-route', raw_payload: 'DECLARED UNCHANGED REFERENCE ORIGINAL' } as EdielMessageRow
}
function expectNoProductionEffect() {
  expect(io.provider).not.toHaveBeenCalled(); expect(io.meter).not.toHaveBeenCalled(); expect(io.bill).not.toHaveBeenCalled()
  expect(io.complete).not.toHaveBeenCalled(); expect(io.ack).not.toHaveBeenCalled(); expect(io.update).not.toHaveBeenCalled()
}

it.each([{ sender_ediel_id: '91100' }, { receiver_ediel_id: '91109' }, { application_reference: '23-TGT-PRODAT' }])(
  'SC-068 actual public production send holds a test reference identity %j before any new authority/provider', async testIdentity => {
    const message = { ...productionMessage(), ...testIdentity }, before = structuredClone(message)
    await expect(sendEdielMessageViaSmtp(message, { actorUserId: 'own-actor' })).rejects.toThrow(/TGT/)
    expect(io.rpc.mock.calls.map(([name]) => name)).toEqual(['gridex_ediel_accepted_transport_projection_v1'])
    expect(io.from).not.toHaveBeenCalled(); expect(io.event).not.toHaveBeenCalled(); expect(io.link).not.toHaveBeenCalled()
    expectNoProductionEffect(); expect(message).toEqual(before)
  })

it.each(['catalog_evidence', 'historical_replay'] as const)(
  'SC-068 a copied %s diagnostic policy cannot mint an operative final owner through the public inbound consumer', async mode => {
    const message = energyHandoffMessage('2026-10-01')
    message.raw_payload = message.raw_payload!.replace("23-DDQ-E66-T++1'", "23-DDQ-E66-T++1++1'")
    Object.assign(message, receivedUtiltsOwnerFixture(message)); qualifyUtiltsFixtureSource(message); io.get.mockResolvedValue(message)
    const original = structuredClone(message)
    const initial = await resolveCanonicalRuntimeDecisionWithRegistry(message)
    const diagnosticPolicy = resolveCanonicalEdielPolicy({ family: 'UTILTS', messageCode: 'E66', direction: 'inbound', referenceDate: '2026-10-01',
      associationAssignedCode: 'E5SE5A', applicationReference: message.application_reference, mode })
    // This real catalogue resolver returns semantics, not private original
    // authority. Attaching them to a copied genuine initial object loses its
    // opaque ownership; no invented wire/row/mode authority is supplied.
    const copiedDiagnostic = { ...initial, policy: diagnosticPolicy }
    io.rpc.mockClear()
    await expect(processInboundUtiltsMessageByCanonicalPolicy({ actorUserId: UTILTS_FIXTURE_ACTOR, edielMessageId: message.id,
      canonicalDecision: copiedDiagnostic, canonicalPolicy: diagnosticPolicy })).rejects.toThrow('ediel_initial_utilts_owner_unavailable')
    expect(io.rpc.mock.calls.some(([name]) => ['gridex_record_utilts_source_validation_v4', 'gridex_persist_utilts_consumption_v1'].includes(name))).toBe(false)
    expectNoProductionEffect(); expect(message).toEqual(original)
    // Matching may link diagnostic message metadata before denial; this does
    // not claim a zero-write DB snapshot or a valid historical-mode producer.
  })

it('SC-068 actual historical accepted-original repair cannot re-enter the provider after today changes to a test identity', async () => {
  const message = { ...productionMessage(), status: 'acknowledged' as const, sender_ediel_id: '91100' }, before = structuredClone(productionMessage())
  const observedAt = '2026-09-29T10:00:00.123Z'
  const accepted = { status: 'accepted_projection', companyId: message.company_id, environment: message.environment, messageId: message.id,
    attemptId: '40000000-0000-4000-8000-000000000001', lane: 'generic_journal', originalHash: createHash('sha256').update(message.raw_payload!).digest('hex'),
    observedAt, frozenRecipient: 'original@example.invalid', providerReceipt: { accepted: ['original@example.invalid'], rejected: [], messageId: '<frozen@example.invalid>', response: '250 declared' },
    businessExpectationPlan: { version: 1 }, authorizesProviderEntry: false, deliveryProven: false, projectionStatus: 'acknowledged' }
  const original = structuredClone(message)
  io.rpc.mockImplementation(async (name: string) => {
    if (name === 'gridex_ediel_accepted_transport_projection_v1' || name === 'gridex_ediel_repair_accepted_transport_projection_v1') return { data: accepted, error: null }
    throw new Error(`undeclared_historical_port:${name}`)
  })
  const result = await sendEdielMessageViaSmtp(message, { actorUserId: 'own-actor' })
  expect(result).toMatchObject({ accepted: ['original@example.invalid'], messageId: '<frozen@example.invalid>', dispatchObservedAt: observedAt })
  expect(io.rpc.mock.calls.map(([name]) => name)).toEqual(['gridex_ediel_accepted_transport_projection_v1', 'gridex_ediel_repair_accepted_transport_projection_v1'])
  expect(io.rpc.mock.calls[1][1]).toEqual({ p_company_id: before.company_id, p_environment: 'production', p_actor_user_id: 'own-actor', p_message_id: before.id })
  expect(io.from).not.toHaveBeenCalled(); expectNoProductionEffect(); expect(message).toEqual(original)
  // The private repair port may repair the SAME original's projection; this is
  // neither external send nor the missing no-production-mutation replay mode.
})

it('SC-068 historical sent status without an actual accepted journal never creates new production traffic', async () => {
  const message = { ...productionMessage(), status: 'sent' as const }, original = structuredClone(productionMessage())
  await expect(sendEdielMessageViaSmtp(message, { actorUserId: 'own-actor' })).rejects.toThrow('ediel_historical_transport_receipt_unavailable')
  expect(io.rpc.mock.calls.map(([name]) => name)).toEqual(['gridex_ediel_accepted_transport_projection_v1'])
  expect(io.from).not.toHaveBeenCalled(); expectNoProductionEffect(); expect(message.raw_payload).toEqual(original.raw_payload)
})
