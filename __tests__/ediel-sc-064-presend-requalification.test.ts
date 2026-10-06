import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { buildUtiltsOutboundDraft } from '@/lib/ediel/utilts'
import { assertRegistryRulebookAllowsSend } from '@/lib/ediel/rulebook/sendGuards'
import { createUtiltsFinalValidationIo as registryFixture } from './helpers/utiltsFinalValidationFixture'
import { source } from './fixtures/prodat-identity'
import type { EdielMessageRow } from '@/lib/ediel/types'

// SC-064 component proof. Real worker and route evaluator execute; current
// route/tenant reads and the outbox persistence sink are explicit finite IO.
// This file does not prove native decisions or authorize whole-ID approval.
const io = vi.hoisted(() => ({
  get: vi.fn(), from: vi.fn(), runtime: vi.fn(), rpc: vi.fn(), send: vi.fn(),
  readiness: vi.fn(), project: vi.fn(), provider: vi.fn(), realTransport: false,
}))
vi.mock('@/lib/supabase/service', () => ({ supabaseService: { from: io.from, rpc: io.rpc } }))
vi.mock('@/lib/ediel/db', () => ({ getEdielMessageById: io.get }))
vi.mock('@/lib/ediel/config', async importOriginal => ({
  ...await importOriginal<typeof import('@/lib/ediel/config')>(),
  getEdielRouteRuntimeByCommunicationRouteId: io.runtime,
}))
vi.mock('@/lib/ediel/outbox/readinessGuard', () => ({ getEdielOutboundReadinessBlocker: io.readiness }))
vi.mock('@/lib/ediel/transport', () => ({ sendEdielMessageViaSmtp: async (...args: Parameters<typeof import('@/lib/ediel/transport')['sendEdielMessageViaSmtp']>) => {
  if (io.realTransport) return (await import('@/lib/ediel/transport/index.part-2')).sendEdielMessageViaSmtp(...args)
  return io.send(...args)
} }))
vi.mock('@/lib/email/sendEdielEmail', () => ({ sendEdielEmail: io.provider }))
vi.mock('@/lib/ediel/core/versionRegistry', () => ({ resolveCanonicalOutboundVersion: async () => 'E5SE5A' }))
vi.mock('@/lib/ediel/transport/acceptedProjection', () => ({ readAcceptedEdielTransportProjection: async () => null }))
vi.mock('@/lib/ediel/outbox/projectSentSources', () => ({ projectSentEdielSourceState: io.project }))
import { sendOutboxItem } from '@/lib/ediel/outbox/sendOutboxItem'

const at = '2026-10-06T12:00:00.000Z'
let message: EdielMessageRow
let queued: Record<string, unknown>
let route: Record<string, unknown>
let writes: Array<{ filters: Array<[string, unknown]>; patch: Record<string, unknown> }>
const oldDecision = { allowed: true, policyVersion: 1, routeFingerprint: 'old-route', evaluatedAt: '2026-10-05T12:00:00Z' }
const allowed = { allowed: true, company_status: 'active', reason_code: 'allowed', capability_status: 'ready', production_status: 'active', state_version: 1 }
const revoked = { allowed: false, company_status: 'suspended', reason_code: 'tenant_suspended', capability_status: 'ready', production_status: 'active', state_version: 2 }
const send = () => sendOutboxItem({ actorUserId: 'own-worker', outboxItemId: 'own-outbox', workerId: 'own-worker', alreadyClaimed: true })

beforeEach(() => {
  vi.clearAllMocks()
  io.realTransport = false
  vi.useFakeTimers({ toFake: ['Date'] }).setSystemTime(new Date(at))
  message = { ...source("UNB+immutable-original'", 'Z03'), id: 'own-message', company_id: 'own-company', environment: 'test', direction: 'outbound', status: 'queued',
    communication_route_id: 'own-route', message_family: 'PRODAT', message_code: 'Z03', application_reference: '23-DDQ-PRODAT',
    receiver_ediel_id: '22222', receiver_email: 'old@example.invalid', raw_payload: "UNB+immutable-original'",
    validation_report: { priorAdmissionDecision: structuredClone(oldDecision) } }
  queued = { id: 'own-outbox', company_id: message.company_id, environment: 'test', ediel_message_id: message.id,
    status: 'sending', locked_by: 'own-worker', locked_at: at, current_send_attempt_id: 'own-attempt',
    operation_decision_snapshot: structuredClone(oldDecision), route_contract_fingerprint: 'old-route' }
  route = { id: 'own-runtime', is_enabled: true, communication_route_active: true, environment: 'test', receiver_ediel_id: '22222',
    target_email: 'old@example.invalid', message_family: 'PRODAT', business_code: 'Z03', application_reference: '23-DDQ-PRODAT',
    encryption_mode: 'none', certificate_required: false }
  writes = []
  io.runtime.mockImplementation(async () => route)
  io.get.mockImplementation(async () => message)
  io.rpc.mockImplementation(async (name: string, args: Record<string, unknown>) => {
    if (name !== 'canonical_tenant_operation_decision') throw Error(`undeclared_sc064_rpc:${name}`)
    expect(args).toEqual({ p_company_id: 'own-company', p_operation: 'ediel.test.process' })
    return { data: [allowed], error: null }
  })
  io.readiness.mockResolvedValue(null)
  io.project.mockResolvedValue(undefined)
  io.send.mockImplementation(async () => {
    message = { ...message, status: 'sent', message_sent_at: at }
    return { messageId: '<own@example.invalid>', dispatchObservedAt: at }
  })
  io.from.mockImplementation((table: string) => {
    if (!['ediel_outbox', 'ediel_send_locks'].includes(table)) throw Error(`undeclared_sc064_table:${table}`)
    const filters: Array<[string, unknown]> = []
    let patch: Record<string, unknown> | null = null
    const result = () => {
      if (table === 'ediel_send_locks') return { data: [], error: null }
      if (!filters.every(([key, value]) => queued[key] === value)) return { data: null, error: null }
      if (patch) { writes.push({ filters: [...filters], patch: structuredClone(patch) }); Object.assign(queued, patch) }
      return { data: structuredClone(queued), error: null }
    }
    const q = { select: () => q, eq: (key: string, value: unknown) => { filters.push([key, value]); return q },
      update: (value: Record<string, unknown>) => { patch = value; return q }, maybeSingle: async () => result(), limit: async () => result() }
    return q
  })
})
afterEach(() => vi.useRealTimers())

function expectNoDispatch(original: EdielMessageRow) {
  expect(io.send).not.toHaveBeenCalled()
  expect(io.project).not.toHaveBeenCalled()
  expect(message).toEqual(original)
  expect(queued.locked_by).toBeNull()
  expect(queued.locked_at).toBeNull()
  expect(writes.every(write => write.filters.some(([key, value]) => key === 'current_send_attempt_id' && value === 'own-attempt'))).toBe(true)
}

describe('SC-064 current queue reconsideration at the actual worker boundary', () => {
  it.each([
    ['SMTP destination changes', { target_email: 'new@example.invalid' }, 'route_receiver_email_mismatch'],
    ['route is disabled', { is_enabled: false }, 'route_not_active'],
    ['message scope changes', { business_code: 'Z08' }, 'route_message_code_mismatch'],
  ])('blocks when %s despite the stored version-1 decision', async (_name, change, blocker) => {
    const original = structuredClone(message)
    Object.assign(route, change)
    expect(await send()).toEqual({ status: 'blocked', messageId: null, error: blocker })
    expect(queued).toMatchObject({ status: 'blocked', last_error: blocker, operation_decision_snapshot: oldDecision })
    expect(io.runtime).toHaveBeenCalledExactlyOnceWith('own-route', { companyId: 'own-company' })
    expectNoDispatch(original)
  })

  it('records the new tenant refusal instead of using the old grant', async () => {
    const original = structuredClone(message)
    io.rpc.mockResolvedValue({ data: [revoked], error: null })
    expect(await send()).toEqual({ status: 'blocked', messageId: null, error: 'tenant_suspended' })
    expect(queued).toMatchObject({ status: 'blocked_tenant_state', blocked_reason: 'tenant_suspended', blocked_at: at,
      company_status_snapshot: 'suspended', operation_decision_snapshot: revoked })
    expect(io.runtime).not.toHaveBeenCalled()
    expectNoDispatch(original)
  })

  it('blocks a revocation observed after route readiness and retains the fresh route trace', async () => {
    const original = structuredClone(message)
    io.rpc.mockResolvedValueOnce({ data: [allowed], error: null }).mockResolvedValueOnce({ data: [revoked], error: null })
    expect(await send()).toEqual({ status: 'blocked', messageId: null, error: 'tenant_suspended' })
    expect(io.rpc.mock.calls).toEqual(Array.from({ length: 2 }, () => ['canonical_tenant_operation_decision', { p_company_id: 'own-company', p_operation: 'ediel.test.process' }]))
    expect(queued).toMatchObject({ status: 'blocked_tenant_state', operation_decision_snapshot: revoked,
      route_contract_snapshot: { route_id: 'own-route', receiver_email: 'old@example.invalid', evaluated_at: at } })
    expect(queued.route_contract_fingerprint).not.toBe('old-route')
    expectNoDispatch(original)
  })


  it('the actual transport rejects a complete old protected basis after real current registry requalification', async () => {
    vi.setSystemTime(new Date('2026-09-30T10:00:00Z'))
    const draft = await buildUtiltsOutboundDraft({ code: 'E73', environment: 'test', senderEdielId: '11111', receiverEdielId: '22222',
      applicationReference: '23-DDQ-E66-S', externalReference: 'SC064-DOC', transactionReference: 'SC064-TX',
      payload: { legalSenderEdielId: '33333', legalReceiverEdielId: '44444', meterPointId: '735999100001686670', gridAreaId: 'TES',
        periodStart: '2026-09-30T00:00:00+01:00', periodEnd: '2026-10-01T00:00:00+01:00', registrationTime: '2026-10-01T10:00:00+01:00', siteType: 'Consumption' } })
    message = { ...message, message_family: 'UTILTS', message_code: 'E73', message_version: 'E5SE5A', message_standard: 'edifact',
      raw_payload: draft.rawPayload, parsed_payload: {}, application_reference: draft.applicationReference,
      sender_ediel_id: '11111', receiver_ediel_id: '22222', created_at: '2026-09-30T10:00:00Z', message_sent_at: null }
    const registry = registryFixture(), tenantRpc = io.rpc.getMockImplementation()!
    let protectedBasis: Record<string, unknown> | undefined
    io.rpc.mockImplementation((name: string, args: Record<string, unknown>) => {
      if (name === 'ediel_capture_source_rule_pack_basis_v1') {
        expect(args).toEqual({ p_company_id: message.company_id, p_message_id: message.id })
        expect(protectedBasis).toBeDefined()
        return Promise.resolve({ data: structuredClone(protectedBasis), error: null })
      }
      if (name === 'gridex_ediel_negative_fixture_read_v1') return Promise.resolve({ data: null, error: null })
      const result = registry(name, args)
      if (result) return result
      return tenantRpc(name, args)
    })
    const previous = await assertRegistryRulebookAllowsSend(message)
    expect(previous?.canonicalPolicy?.guide.guideRevision).toBe('25-A-3')
    const old = previous!.rulePackSnapshot!
    protectedBasis = { rulePackId: '33333333-3333-4333-8333-333333333333', messageProfileId: old.profileVersionId,
      profileKey: old.profileKey, version: old.version, sourceHash: old.checksum,
      snapshot: { profileKey: old.profileKey, profileVersionId: old.profileVersionId, version: old.version, checksum: old.checksum } }
    message.validation_report = { priorAdmissionDecision: { version: old.version, profileKey: old.profileKey } }
    const original = structuredClone(message)
    vi.setSystemTime(new Date(at))
    const current = await assertRegistryRulebookAllowsSend(message)
    expect(current?.canonicalPolicy?.guide.guideRevision).toBe('25-A-4')
    Object.assign(route, { message_family: 'UTILTS', business_code: 'E73', application_reference: '23-DDQ-E66-S' })
    io.realTransport = true
    expect(await send()).toEqual({ status: 'failed', messageId: null, error: 'ediel_send_original_rule_pack_mismatch' })
    expect(queued).toMatchObject({ status: 'failed', last_error: 'ediel_send_original_rule_pack_mismatch' })
    expect(io.rpc.mock.calls.filter(([name]) => name === 'ediel_capture_source_rule_pack_basis_v1')).toHaveLength(1)
    expect(io.provider).not.toHaveBeenCalled(); expectNoDispatch(original)
  })

  it('an unchanged allowed route reaches transport once with a fresh trace and the same bytes', async () => {
    const original = structuredClone(message)
    expect(await send()).toEqual({ status: 'sent', messageId: '<own@example.invalid>' })
    expect(io.send).toHaveBeenCalledExactlyOnceWith(original, { actorUserId: 'own-worker', smtpMimeMode: null,
      dispatchOwner: { kind: 'worker', outboxId: 'own-outbox', sendAttemptId: 'own-attempt', workerId: 'own-worker' } })
    expect(queued).toMatchObject({ status: 'sent', route_contract_snapshot: { receiver_email: 'old@example.invalid', evaluated_at: at } })
    expect(queued.route_contract_fingerprint).not.toBe('old-route')
    expect(message.raw_payload).toBe(original.raw_payload)
  })
})
