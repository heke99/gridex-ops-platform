// masterplan: SC-003
import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { ServicePermissionOriginBasis } from '@/lib/ediel/services/permissionOrigin'
import type { EdielMessageIntent } from '@/lib/ediel/intent/types'
import type { resolveCanonicalOutboundContext } from '@/lib/ediel/core/kernel'
import type { createEdielMessageIntent } from '@/lib/ediel/intent/intentEngine'
import type { finalizeOutboundDraft } from '@/lib/ediel/flows/shared'

// Only authority/route and persistence ports are finite. The command adapters,
// captured-timing check, gateway, reporting context, renderer and codec run.
// This file does not mint legal authority or replace the genuine #497 proof.
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
import { segmentComposite, tokenizeEdifact } from '@/lib/ediel/core/edifactTokenizer'

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
  expect(ports.createIntent).not.toHaveBeenCalled(); expect(ports.createRequest).not.toHaveBeenCalled()
  expect(ports.finalize).not.toHaveBeenCalled(); expect(ports.queue).not.toHaveBeenCalled()
}

describe('SC003 provider command through actual source gateway and DGI renderer', () => {
  it('retains the K assignment internally while P alone is the legal DGI actor on the queued wire', async () => {
    // The assignment-to-K relationship is an explicit fixture fact here; its
    // genuine native publication/linkage is qualified separately from #497.
    const mission = { providerCompanyId: ids.provider, beneficiaryCompanyId: ids.beneficiary, assignmentId: ids.assignment }
    expect(await prepareAndQueueServicePermissionZ13(command)).toMatchObject({ status: 'queued', message: { id: ids.message } })
    expect(ports.rpc).toHaveBeenCalledWith('ediel_coordinate_service_permission_v1', expect.objectContaining({
      p_provider_company_id: mission.providerCompanyId, p_assignment_id: mission.assignmentId, p_actor_user_id: ids.actor }))
    expect(ports.createRequest).toHaveBeenCalledWith(expect.objectContaining({ customerId: ids.customer,
      operationId: ids.permission, payload: expect.objectContaining({ serviceAssignmentId: mission.assignmentId }) }))
    const draft = ports.finalize.mock.calls[0][0].draft
    expect(draft.companyId).toBe(ids.provider); expect(draft.parsedPayload.sourcePermissionBasis.assignmentId).toBe(mission.assignmentId)
    const wire = tokenizeEdifact(draft.rawPayload)
    const fr = wire.segments.find(s => s.tag === 'NAD' && segmentComposite(s, 1, wire.una)[0] === 'FR')!
    expect(segmentComposite(fr, 2, wire.una)).toEqual(['21660', '160', 'SVK'])
    expect(draft.rawPayload).toContain('23-DGI-PRODAT')
    expect(draft.rawPayload).toContain('UNB+UNOC:3+99111:ZZ+54321:ZZ')
    for (const id of Object.values(ids)) expect(draft.rawPayload).not.toContain(id)
    expect(ports.queue).toHaveBeenCalledExactlyOnceWith(expect.objectContaining({ messageId: ids.message,
      actorUserId: ids.actor, intentId: ids.intent, outboundRequestId: ids.request }))
  })
  it.each(['customer_contract_absent', 'dso_contract_absent', 'privacy_roles_absent'])('holds %s before route, intent or wire effects', async missing => {
    origin = { status: 'held', missing: [missing] }
    expect(await prepareAndQueueServicePermissionZ13(command)).toEqual(origin)
    expect(ports.route).not.toHaveBeenCalled(); noWire()
  })
  it('a SaaS-only mission cannot become a market permission merely by asking the provider', async () => {
    coordinated = { status: 'held', permissionId: null, missing: ['assignment_evidence_unqualified'] }
    expect(await prepareAndQueueServicePermissionZ13(command)).toMatchObject({ status: 'held', missing: ['assignment_evidence_unqualified'] })
    expect(ports.rpc).toHaveBeenCalledOnce(); noWire()
  })
  it('rejects a K UUID substituted for the legal ESCO even with an ESCO role label', async () => {
    const forged = route(); forged.actor.legalActorEdielId = ids.beneficiary; ports.route.mockResolvedValue(forged)
    await expect(prepareAndQueueServicePermissionZ13(command)).rejects.toThrow('ediel_permission_canonical_legal_esco_required')
    noWire()
  })
  it('compatible market-permission reuse grants no beneficiary access and creates no second request or wire', async () => {
    resolved = { status: 'reuse_permission', permissionId: ids.permission, marketPermissionState: 'approved', accessGranted: false }
    expect(await prepareAndQueueServicePermissionZ13(command)).toEqual(resolved)
    expect(ports.route).not.toHaveBeenCalled(); noWire()
    expect(ports.rpc.mock.calls.map(([name]) => name)).toEqual(['ediel_coordinate_service_permission_v1', 'ediel_resolve_service_permission_command_v1'])
  })
  it('rejects a malformed reuse response that claims unrestricted access', async () => {
    resolved = { status: 'reuse_permission', permissionId: ids.permission, marketPermissionState: 'approved', accessGranted: true }
    await expect(prepareAndQueueServicePermissionZ13(command)).rejects.toThrow('ediel_service_permission_resolution_invalid')
    noWire()
  })
})
