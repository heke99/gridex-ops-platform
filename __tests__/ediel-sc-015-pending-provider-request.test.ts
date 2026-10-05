// masterplan: SC-015
import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { ServicePermissionOriginBasis } from '@/lib/ediel/services/permissionOrigin'
import type { EdielMessageIntent } from '@/lib/ediel/intent/types'
import type { resolveCanonicalOutboundContext } from '@/lib/ediel/core/kernel'
import type { createEdielMessageIntent } from '@/lib/ediel/intent/intentEngine'
import type { finalizeOutboundDraft } from '@/lib/ediel/flows/shared'

// Only authority/route and persistence ports are finite. The command adapters,
// captured-timing check, gateway, reporting context, renderer and codec run.
// Pending owner/timing decisions are finite RPC ports here; the companion SQL
// executes current coordinator/resolver/timing/archive/review owners. No native
// acceptance, external legal approval or automatic beneficiary grant is inferred.
const ports = vi.hoisted(() => ({ rpc: vi.fn(), from: vi.fn(), actor: vi.fn(), route: vi.fn(),
  createIntent: vi.fn(), loadIntent: vi.fn(), validate: vi.fn(), update: vi.fn(),
  createRequest: vi.fn(), finalize: vi.fn(), queue: vi.fn(), version: vi.fn() }))
vi.mock('@/lib/supabase/service', () => ({ supabaseService: { rpc: ports.rpc, from: ports.from } }))
vi.mock('@/lib/ediel/services/authorization', () => ({ assertEdielTenantActor: ports.actor }))
vi.mock('@/lib/ediel/core/kernel', () => ({ resolveCanonicalOutboundContext: ports.route }))
vi.mock('@/lib/ediel/core/versionRegistry', () => ({ resolveCanonicalOutboundVersion: ports.version }))
vi.mock('@/lib/ediel/intent/intentEngine', () => ({ createEdielMessageIntent: ports.createIntent,
  getEdielMessageIntentById: ports.loadIntent, evaluateIntentValidation: ports.validate, updateIntentLifecycle: ports.update }))
vi.mock('@/lib/cis/db', () => ({ createOutboundRequest: ports.createRequest }))
vi.mock('@/lib/ediel/flows/shared', () => ({ finalizeOutboundDraft: ports.finalize, queuePreparedEdielMessage: ports.queue }))
vi.mock('@/lib/ediel/db', () => ({ getEdielMessageById: vi.fn(() => { throw Error('unexpected retained-message read') }) }))
vi.mock('@/lib/supabase/tenantDb', () => ({ tenantDb: vi.fn(() => { throw Error('unexpected tenant mutation') }) }))

import { prepareAndQueueServicePermissionZ13 } from '@/lib/ediel/flows/prodatServicePermission'

const uid = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`
const ids = { provider: uid(1), beneficiary: uid(2), assignment: uid(3), actor: uid(4), permission: uid(5),
  legal: uid(6), dso: uid(7), customer: uid(8), evidence: uid(9), intent: uid(10), request: uid(11), message: uid(12) }
const command = { providerCompanyId: ids.provider, assignmentId: ids.assignment, actorUserId: ids.actor, expectedVersion: 2 }
const basis = (): ServicePermissionOriginBasis => ({ status: 'authorized', companyId: ids.provider,
  assignmentId: ids.assignment, assignmentVersion: 2, scopeBasisVersion: 1, permissionId: ids.permission,
  permissionStateVersion: 1, code: 'Z13', environment: 'test', providerActorId: ids.legal, dsoActorId: ids.dso,
  legalSenderId: '21660', legalReceiverId: '54321', customerId: ids.customer,
  customer: { org_number: 'SYNTHETIC-CUSTOMER', company_name: 'Synthetic contracted customer', country: 'SE' },
  mode: 'V', agreementReference: 'SYNTHETIC-REVIEWED-AGREEMENT', requestedMethod: 'Z04', purposeCode: 'B72',
  frequency: 'D', reportingTerm: 'bounded', customerClassification: 'nonprivate', terminationReason: null,
  evidenceId: ids.evidence, evidenceSha256: 'a'.repeat(64), evidenceVersion: 'SYNTHETIC-SOURCE-ONLY', li: null,
  requestTiming: { version: 1, evidenceId: ids.evidence, sourceHash: 'a'.repeat(64),
    sourceReference: 'synthetic://reviewed-network-contract', sourceVersion: 'SYNTHETIC-SOURCE-ONLY',
    networkStart: '2026-05-01', networkEnd: null, reviewId: uid(13), reviewerUserId: uid(14),
    reviewSequence: 1, scopeBasisVersion: 1, requestDay: '2026-10-01' },
  objects: [{ point: null, permissionId: null, product: '8716867000030', gridArea: 'TES',
    reportStart: '2026-09-01T00:00:00+01:00', reportEnd: '2027-01-01T00:00:00+01:00' }] })
const route = () => ({ companyId: ids.provider, environment: 'test',
  actor: { tenantIdentity: { legalActorId: ids.legal }, legalActorEdielId: '21660', marketRoles: ['energy_service_company'] },
  senderEdielId: '99111', receiverEdielId: '54321', senderSubAddress: null, receiverSubAddress: null,
  receiverMessageSubAddress: null, applicationReference: '23-DGI-PRODAT', route: { id: uid(15) },
  routeRuntime: { route_profile_id: uid(16) }, mailbox: null, receiverEmail: 'dso@example.invalid',
}) as Awaited<ReturnType<typeof resolveCanonicalOutboundContext>>
let origin: ServicePermissionOriginBasis | { status: 'held'; missing: string[] }
let coordinated: Record<string, unknown>, resolved: Record<string, unknown>, rendered = false
let intent: EdielMessageIntent

beforeEach(() => {
  vi.clearAllMocks(); origin = basis(); rendered = false
  coordinated = { status: 'permission_required', permissionId: ids.permission }
  resolved = { status: 'permission_required', permissionId: ids.permission }
  ports.actor.mockResolvedValue(undefined); ports.route.mockResolvedValue(route())
  ports.version.mockResolvedValue('26.A'); ports.validate.mockReturnValue({ ok: true }); ports.update.mockResolvedValue(undefined)
  ports.rpc.mockImplementation(async (name: string) => {
    if (name === 'ediel_coordinate_service_permission_v1') return { data: coordinated, error: null }
    if (name === 'ediel_resolve_service_permission_command_v1') return { data: resolved, error: null }
    if (name === 'ediel_service_permission_origin_v1') return { data: origin, error: null }
    if (name === 'ediel_reserve_service_permission_origin_v1') return { data: { status: 'reserved', messageId: rendered ? ids.message : null }, error: null }
    throw Error('unexpected authority RPC: ' + name)
  })
  ports.from.mockImplementation((table: string) => {
    if (table !== 'outbound_requests') throw Error('unexpected table access: ' + table)
    const query = { select: vi.fn(), eq: vi.fn(), contains: vi.fn(), order: vi.fn(), limit: vi.fn() }
    for (const key of ['select', 'eq', 'contains', 'order'] as const) query[key].mockReturnValue(query)
    query.limit.mockResolvedValue({ data: [], error: null }); return query
  })
  ports.createIntent.mockImplementation(async (input: Parameters<typeof createEdielMessageIntent>[0]) => {
    intent = { ...input, id: ids.intent, validationStatus: 'validated', renderStatus: 'not_rendered',
      outboxStatus: 'not_queued', direction: 'outbound' } as EdielMessageIntent
    return intent
  })
  ports.loadIntent.mockImplementation(async () => intent)
  ports.createRequest.mockResolvedValue({ id: ids.request })
  ports.finalize.mockImplementation(async ({ draft }: Parameters<typeof finalizeOutboundDraft>[0]) => {
    rendered = true
    return { id: ids.message, company_id: draft.companyId, intent_id: draft.intentId,
      outbound_request_id: draft.outboundRequestId, status: 'draft', external_reference: draft.externalReference }
  })
  ports.queue.mockResolvedValue(undefined)
})
const noWire = () => {
  expect(ports.route).not.toHaveBeenCalled(); expect(ports.from).not.toHaveBeenCalled()
  expect(ports.createIntent).not.toHaveBeenCalled(); expect(ports.createRequest).not.toHaveBeenCalled()
  expect(ports.finalize).not.toHaveBeenCalled(); expect(ports.queue).not.toHaveBeenCalled()
}

describe('SC015 pending P/customer/DSO permission coordination reaches the real command caller', () => {
  it('a same-object K2 request reuses the pending source without a new wire', async () => {
    // Age belongs to the source owner; the caller receives no clock, beneficiary
    // flag or day-count authority. SQL tests bind a declared two-day retained
    // original and current timing receipts, not this response fixture.
    const retained = { messageId: uid(100) }
    coordinated = { status: 'reuse_permission', permissionId: ids.permission }
    resolved = { status: 'reuse_permission', permissionId: ids.permission, messageId: retained.messageId,
      marketPermissionState: 'pending', accessGranted: false }
    expect(await prepareAndQueueServicePermissionZ13(command)).toEqual(resolved)
    expect(ports.rpc.mock.calls).toEqual([
      ['ediel_coordinate_service_permission_v1', { p_provider_company_id: ids.provider, p_assignment_id: ids.assignment,
        p_actor_user_id: ids.actor, p_expected_version: 2, p_command: 'request_access' }],
      ['ediel_resolve_service_permission_command_v1', { p_company_id: ids.provider, p_assignment_id: ids.assignment,
        p_actor_user_id: ids.actor, p_expected_version: 2, p_permission_id: ids.permission }],
    ])
    expect(ports.rpc.mock.calls.flatMap(([,args]) => Object.keys(args))).not.toContain('beneficiary_company_id')
    noWire()
  })
  it('a new internal mission identifier still obeys the selected pending original resolver', async () => {
    const other = { ...command, assignmentId: uid(101) }
    coordinated = { status: 'reuse_permission', permissionId: ids.permission }
    resolved = { status: 'reuse_permission', permissionId: ids.permission, marketPermissionState: 'pending', accessGranted: false }
    expect(await prepareAndQueueServicePermissionZ13(other)).toEqual(resolved)
    expect(ports.rpc).toHaveBeenCalledWith('ediel_resolve_service_permission_command_v1', expect.objectContaining({
      p_assignment_id: other.assignmentId, p_permission_id: ids.permission, p_company_id: ids.provider }))
    noWire()
  })
  it('explicitly selecting the same permission cannot bypass pending coordination into the renderer', async () => {
    resolved = { status: 'reuse_permission', permissionId: ids.permission, marketPermissionState: 'pending', accessGranted: false }
    expect(await prepareAndQueueServicePermissionZ13({ ...command, permissionId: ids.permission })).toEqual(resolved)
    expect(ports.rpc).toHaveBeenCalledOnce(); noWire()
  })
  it('a relevant new-object decision passes the real DGI gateway and scoped renderer immediately', async () => {
    // The backend's current semantic decision is tested by the SQL companion;
    // this consumer test must not turn it into a universal 21-day hold.
    const next = uid(102)
    coordinated = { status: 'permission_required', permissionId: next }
    resolved = { status: 'permission_required', permissionId: next }
    origin = { ...basis(), permissionId: next, objects: [{ ...basis().objects[0], point: '735123456789012345' }] }
    expect(await prepareAndQueueServicePermissionZ13(command)).toMatchObject({ status: 'queued', message: { id: ids.message } })
    expect(ports.createIntent).toHaveBeenCalledWith(expect.objectContaining({ operationId: next,
      idempotencyKey: `service-permission:${next}:Z13`, applicationReference: '23-DGI-PRODAT' }))
    const draft = ports.finalize.mock.calls[0][0].draft
    expect(draft.parsedPayload.sourcePermissionBasis.permissionId).toBe(next)
    expect(draft.rawPayload).toContain('735123456789012345')
    expect(draft.rawPayload).toContain('23-DGI-PRODAT')
    expect(draft.rawPayload).not.toContain(ids.beneficiary)
    expect(ports.queue).toHaveBeenCalledExactlyOnceWith(expect.objectContaining({ messageId: ids.message }))
  })
  it('a current timing hold prevents all origin, route, intent and wire effects', async () => {
    resolved = { status: 'held', missing: ['request_network_contract_period'] }
    expect(await prepareAndQueueServicePermissionZ13(command)).toEqual(resolved)
    expect(ports.rpc.mock.calls.map(([name]) => name)).toEqual([
      'ediel_coordinate_service_permission_v1', 'ediel_resolve_service_permission_command_v1'])
    noWire()
  })
  it('fails closed when reuse asserts beneficiary access instead of the protected no-access result', async () => {
    resolved = { status: 'reuse_permission', permissionId: ids.permission, marketPermissionState: 'pending', accessGranted: true }
    await expect(prepareAndQueueServicePermissionZ13(command)).rejects.toThrow('ediel_service_permission_resolution_invalid')
    noWire()
  })
  it('preserves exact source-owner denial without retry or a fabricated replacement request', async () => {
    const error = new Error('immutable_owned_pending_permission_original')
    ports.rpc.mockImplementation(async (name: string) => name === 'ediel_coordinate_service_permission_v1'
      ? { data: coordinated, error: null } : { data: null, error })
    await expect(prepareAndQueueServicePermissionZ13(command)).rejects.toBe(error)
    expect(ports.rpc).toHaveBeenCalledTimes(2); noWire()
  })
})
