// masterplan: AT-Z02L-SUPPLIER, AT-Z02LK-SUPPLIER
// Component probes only. Whole contracts/coverage remain unapproved.
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { createFakeSupabase, type Row } from './helpers/supabaseMock'
import { raw, line, characteristic, type Parts } from './fixtures/prodat-register'
import { head, source } from './fixtures/prodat-identity'

// Finite table IO reuses the existing helper. Worker/permission/audit ports are
// declared doubles; a returned atomic result is NOT execution of the SQL core.
// Parser, codec, policy, field matrix, linker and business-state consumers stay
// real. The two-consumer seam below does NOT execute the outer inbound pipeline.
const io = vi.hoisted(() => ({
  from: vi.fn(), tenantFrom: vi.fn(), enqueue: vi.fn(), authorize: vi.fn(), event: vi.fn(),
  supply: vi.fn(), permission: vi.fn(), notification: vi.fn(), workflow: vi.fn(), load: vi.fn(), identity: vi.fn(),
}))
vi.mock('@/lib/supabase/service', () => ({ supabaseService: { from: io.from } }))
vi.mock('@/lib/supabase/tenantDb', () => ({ tenantDb: (companyId: string) => ({
  from: (table: string) => io.tenantFrom(companyId, table),
}) }))
vi.mock('@/lib/customer-operations/automation', () => ({ enqueueInboundGridOwnerResponseAutomation: io.enqueue }))
vi.mock('@/lib/ediel/services/authorization', () => ({ assertEdielTenantActor: io.authorize }))
vi.mock('@/lib/ediel/db', () => ({ createEdielMessageEvent: io.event, getEdielMessageById: io.load }))
vi.mock('@/lib/ediel/tenant/tenantEdielIdentity', () => ({ resolveCanonicalTenantEdielIdentityWithEvidence: io.identity }))
vi.mock('@/lib/ediel/flows/supplyMarketTransition', () => ({ applySupplyMarketSource: io.supply }))
vi.mock('@/lib/ediel/permissions/permissionMarketTransition', () => ({ applyPermissionMarketSource: io.permission }))
vi.mock('@/lib/customer-notifications/notificationOrchestrator', () => ({ enqueueCustomerLifecycleNotification: io.notification }))
vi.mock('@/lib/website/customerApplicationWorkflowBridge', () => ({ transitionCorrelatedCustomerApplicationWorkflow: io.workflow }))

import { parseProdatMessage } from '@/lib/ediel/prodat/parser'
import { tokenizeEdifact } from '@/lib/ediel/core/edifactTokenizer'
import { validateEdifactSyntax } from '@/lib/ediel/core/syntaxValidator'
import { resolveCanonicalEdielPolicy } from '@/lib/ediel/rulebook/canonicalEdielPolicy'
import { validateCanonicalPolicyFields } from '@/lib/ediel/rulebook/canonicalPolicyFieldValidator'
import { decideProdatLifecycle } from '@/lib/ediel/stateMachines/prodatLifecycle'
import { applyInboundProdatZ02ToCustomerInfoRequest } from '@/lib/onboarding/inboundEdielLinking'
import { applyInboundBusinessStateMachine } from '@/lib/ediel/flows/inboundBusinessStateMachine'
import { processInboundEdielMessage } from '@/lib/ediel/flows/inboundProcessing'
import { extractMarketActorEdielIdFromRawPayload, resolveInboundTenantFromIdentifiers } from '@/lib/ediel/tenant/resolveInboundTenant'

const id = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`
const own = { company: id(1), actor: id(2), request: id(3), customer: id(4), site: id(5),
  point: id(6), message: id(7), operation: id(8), job: id(9), foreignCompany: id(90), foreignRequest: id(91) }
const pointId = '735123456789012345'
const li = 'OWN-Z01-LI'
const profiles = [{ subtype: 'L', reason: 'Z22' }, { subtype: 'LK', reason: 'Z23' }]
type Profile = typeof profiles[number]

function body(profile: Profile): Parts[] {
  return [...head(), line('1', pointId, undefined, '9'),
    ...characteristic('Z04', 'Z03'), ...characteristic('Z13', profile.reason),
    ['RFF', ['Z05', 'NET']], ['RFF', ['LI', li]],
    ['NAD', 'UD', ['199001011234', 'SE2', '260'], '', 'Synthetic Person', 'Street', 'City', '', '12345', 'SE'],
    ['NAD', 'IT', [pointId, '', '9'], '', '', 'Street', 'City', '', '12345', 'SE'],
  ]
}
function message(profile: Profile, parts = body(profile)) {
  const wire = raw(parts, 'Z02').replace('+S+R+', '+12345:14+54321:14+')
  return { ...source(wire, 'Z02'), id: own.message, company_id: own.company,
    message_received_at: '2026-10-05T12:00:00.000000Z', created_at: '2026-10-05T12:00:00.000000Z',
    message_version: 'E2SE6A', status: 'received' as const,
    // Deliberately misleading caches do not supply the app parser's facts.
    parsed_payload: { meteringPointId: 'CACHED-FOREIGN-POINT', gridAreaId: 'CACHED-FOREIGN-NET',
      lineItemReference: 'CACHED-FOREIGN-LI' },
  }
}
function policy(profile: Profile) {
  return resolveCanonicalEdielPolicy({ family: 'PRODAT', messageCode: 'Z02',
    subtypeOrReasonCode: profile.reason, direction: 'inbound', referenceDate: '2026-10-05',
    associationAssignedCode: 'E2SE6A', applicationReference: '23-DDQ-PRODAT', mode: 'parse' })
}
function fieldIssues(profile: Profile, parts = body(profile)) {
  const wire = message(profile, parts).raw_payload!
  const tokenized = tokenizeEdifact(wire)
  return validateCanonicalPolicyFields({ policy: policy(profile), rawPayload: wire,
    rawSegments: tokenized.segments.map(segment => segment.raw), una: tokenized.una })
}
const completeGate = () => ({ z02_correlation_status: 'exact', z02_payload_validation_status: 'valid',
  z02_snapshot_freshness_status: 'valid', z02_atomic_core_applied: true, z02_atomic_core: { ok: true, sourceMessageId: own.message } })
let tables: Record<string, Row[]>
let db: ReturnType<typeof createFakeSupabase>
let originalSnapshot: Row
const request = () => tables.customer_info_requests[0]
const verifiedEvents = () => tables.customer_info_request_events.filter(row => row.event_type === 'z02_market_verified')
const changes = () => db.calls.filter(call => call.operation !== 'select')
function assertNoBusinessWrites() {
  expect(changes().filter(call => !['customer_info_requests', 'customer_operation_jobs', 'customer_info_request_events'].includes(call.table))).toEqual([])
  for (const call of changes().filter(call => call.table === 'customer_info_requests')) {
    expect(call.payload).not.toHaveProperty('verified_payload')
    expect(call.payload).not.toHaveProperty('ediel_message_id')
    expect(call.payload).not.toHaveProperty('customer_id')
    expect(call.payload).not.toHaveProperty('site_id')
  }
  expect(io.supply).not.toHaveBeenCalled()
  expect(io.permission).not.toHaveBeenCalled()
  expect(io.notification).not.toHaveBeenCalled()
  expect(io.workflow).not.toHaveBeenCalled()
}
beforeEach(() => {
  vi.resetAllMocks()
  originalSnapshot = { sourceMessageId: id(20), lineItemReference: 'PRIOR-VERIFIED-LI', pointId, gridAreaId: 'PRIOR-NET' }
  tables = { customer_info_requests: [
    { id: own.request, company_id: own.company, customer_id: own.customer, site_id: own.site,
      metering_point_id: own.point, operation_id: own.operation, external_reference: li,
      status: 'z01_sent', verified_payload: structuredClone(originalSnapshot), ediel_message_id: id(20) },
    { id: own.foreignRequest, company_id: own.foreignCompany, external_reference: li,
      customer_id: id(92), site_id: id(93), status: 'z01_sent', verified_payload: { foreign: true } },
  ], customer_operation_jobs: [{ id: own.job, company_id: own.company, status: 'completed' }], customer_info_request_events: [],
    ediel_actor_settings: [], ediel_route_profiles: [],
    tenant_actor_identifiers: [{ company_id: own.company, environment: 'test', identifier_type: 'EdielId',
      identifier_value: '54321', valid_from: '2000-01-01', valid_to: null }],
  }
  db = createFakeSupabase({ tables })
  io.from.mockImplementation((table: string) => {
    if (!(table in tables)) throw new Error(`undeclared_table:${table}`)
    const query = db.client.from(table)
    // The unchanged finite query helper lacks this transport-only method.
    return Object.assign(query, { abortSignal: () => query })
  })
  io.tenantFrom.mockImplementation((companyId: string, table: string) => {
    expect(companyId).toBe(own.company)
    return io.from(table)
  })
  io.authorize.mockResolvedValue(undefined)
  io.event.mockResolvedValue(undefined)
  io.enqueue.mockResolvedValue({ id: own.job, status: 'completed', operationId: own.operation, result: completeGate() })
  io.identity.mockResolvedValue({ identity: { companyId: own.company, environment: 'test',
    legalActorId: id(50), legalEdielId: '54321', transportActorId: id(50), transportEdielId: '54321',
    roleCodes: ['electricity_supplier'], representedByTransportAgent: false, transportRelationId: null },
    evidence: { completeness: 'exact_count', origin: 'declared_finite_identity_dto' } })
  for (const port of [io.supply, io.permission, io.notification, io.workflow]) {
    port.mockImplementation(() => { throw new Error('unexpected_non_z02_effect') })
  }
})

describe.each(profiles)('AT-Z02 $subtype supplier ($reason)', profile => {
  it('decodes real DDQ/Z02/reason/object/LI/grid/customer bytes and never means supply activation', () => {
    const row = message(profile)
    expect(validateEdifactSyntax(row).issues.filter(issue => issue.severity === 'error')).toEqual([])
    expect(validateEdifactSyntax(row).ok).toBe(true)
    expect(fieldIssues(profile).filter(issue => issue.blocking)).toEqual([])
    expect(policy(profile)).toMatchObject({ code: 'Z02', subtype: profile.subtype, applicationReference: '23-DDQ-PRODAT' })
    const parsed = parseProdatMessage(row)
    expect(parsed.messageCode).toBe('Z02')
    expect(parsed.lineItems).toHaveLength(1)
    expect(parsed.lineItems[0]).toMatchObject({ meteringPointId: pointId, lineItemReference: li,
      gridAreaId: 'NET', reasonForTransaction: profile.reason, endUserId: '199001011234', installationId: pointId })
    expect(decideProdatLifecycle(row)).toMatchObject({ subtype: profile.subtype, outcome: 'grid_owner_information_received',
      createSupplyPeriod: false, endSupplyPeriod: false, requiresCorrelation: true })
  })

  it('the actual outer inbound entry skips an outbound Z02 before business processing', async () => {
    const row = { ...message(profile), direction: 'outbound' as const }
    io.load.mockResolvedValue(row)
    expect(await processInboundEdielMessage({ actorUserId: own.actor, edielMessageId: row.id })).toEqual(row)
    expect(db.calls).toEqual([])
    expect(io.enqueue).not.toHaveBeenCalled()
    expect(io.authorize).not.toHaveBeenCalled()
    expect(io.event).toHaveBeenCalledWith(expect.objectContaining({ eventType: 'manual_note', eventStatus: 'warning' }))
  })

  it.each(['supplier', 'esco-only', 'wrong-legal', 'wrong-transport'])('actual tenant resolver compares physical recipient with %s DTO', async kind => {
    const row = message(profile)
    const input = { environment: 'test', receiverEdielId: '54321', messageFamily: 'PRODAT', messageCode: 'Z02',
      marketActorEdielId: extractMarketActorEdielIdFromRawPayload(row.raw_payload) }
    const dto = await io.identity()
    if (kind === 'esco-only') dto.identity.roleCodes = ['energy_service_company']
    if (kind === 'wrong-legal') dto.identity.legalEdielId = '99999'
    if (kind === 'wrong-transport') dto.identity.transportEdielId = '99999'
    io.identity.mockResolvedValue(dto)
    expect(await resolveInboundTenantFromIdentifiers(input)).toMatchObject(kind === 'supplier'
      ? { status: 'resolved', companyId: own.company, source: 'verified_legal_identity' }
      : { status: 'unresolved', companyId: null })
    expect(io.enqueue).not.toHaveBeenCalled()
    expect(changes()).toEqual([])
  })

  it.each([['LIN', '314'], ['RFF:LI', '226'], ['RFF:Z05', '260'], ['NAD:UD', '227'], ['NAD:IT', '233']])('rejects missing required %s in the real field consumer', (selector, fieldNumber) => {
    const [tag, qualifier] = selector.split(':')
    const parts = body(profile).filter(part => !(part[0] === tag && (!qualifier || part[1] === qualifier || Array.isArray(part[1]) && part[1][0] === qualifier)))
    expect(fieldIssues(profile, parts)).toContainEqual(expect.objectContaining({ blocking: true,
      prodatDiagnostic: expect.objectContaining({ fieldNumber }) }))
  })

  it('refuses DGI application reference in the actual Z02 policy', () => {
    expect(() => resolveCanonicalEdielPolicy({ family: 'PRODAT', messageCode: 'Z02', subtypeOrReasonCode: profile.reason,
      direction: 'inbound', referenceDate: '2026-10-05', associationAssignedCode: 'E2SE6A',
      applicationReference: '23-DGI-PRODAT', mode: 'parse' })).toThrow('canonical_ediel_application_reference_not_allowed')
  })

  it('passes physical-LI-selected own scope to one worker, without waiting for an incoming ACK or prewriting verification', async () => {
    const foreign = structuredClone(tables.customer_info_requests[1])
    expect(await applyInboundProdatZ02ToCustomerInfoRequest({ actorUserId: own.actor, message: message(profile) })).toEqual({ applied: true, targetId: own.request })
    expect(io.enqueue).toHaveBeenCalledExactlyOnceWith({ companyId: own.company, customerId: own.customer, siteId: own.site,
      meteringPointId: own.point, requestId: own.request, edielMessageId: own.message, actorUserId: own.actor, operationId: own.operation })
    expect(io.authorize).toHaveBeenCalledExactlyOnceWith({ companyId: own.company, actorUserId: own.actor, permission: 'metering.write' })
    expect(verifiedEvents()).toHaveLength(1)
    expect(verifiedEvents()[0]).toMatchObject({ customer_info_request_id: own.request, customer_id: own.customer })
    expect(request().verified_payload).toEqual(originalSnapshot)
    expect(tables.customer_info_requests[1]).toEqual(foreign)
    expect(db.calls.filter(call => call.table === 'customer_info_requests' && call.operation === 'select').every(call =>
      call.filters.some(filter => filter.method === 'eq' && filter.column === 'company_id' && filter.value === own.company))).toBe(true)
    assertNoBusinessWrites()
  })

  it.each(['absent', 'ambiguous', 'foreign-only'])('holds %s candidate references without enqueuing or mutation', async kind => {
    if (kind === 'ambiguous') tables.customer_info_requests.push({ ...request(), id: id(30) })
    else tables.customer_info_requests = tables.customer_info_requests.filter(row => row.company_id !== own.company)
    if (kind === 'absent') tables.customer_info_requests = []
    const before = structuredClone(tables)
    expect(await applyInboundProdatZ02ToCustomerInfoRequest({ actorUserId: own.actor, message: message(profile) })).toEqual({ applied: false, targetId: null, reason: 'no_matching_customer_info_request' })
    expect(io.enqueue).not.toHaveBeenCalled()
    expect(tables).toEqual(before)
    expect(changes()).toEqual([])
  })

  it.each([
    ['correlation', { z02_correlation_status: 'ambiguous' }],
    ['payload', { z02_payload_validation_status: 'invalid' }],
    ['snapshot', { z02_snapshot_freshness_status: 'stale' }],
    ['atomic applied', { z02_atomic_core_applied: false }],
    ['atomic receipt', { z02_atomic_core: { ok: false } }],
  ])('holds incomplete %s proof and allows review only', async (_name, override) => {
    io.enqueue.mockResolvedValue({ id: own.job, status: 'completed', result: { ...completeGate(), ...override } })
    expect(await applyInboundProdatZ02ToCustomerInfoRequest({ actorUserId: own.actor, message: message(profile) })).toEqual({ applied: false, targetId: own.request, reason: 'z02_atomic_apply_not_confirmed' })
    expect(request().status).toBe('manual_review_required')
    expect(request().verified_payload).toEqual(originalSnapshot)
    expect(verifiedEvents()).toEqual([])
    assertNoBusinessWrites()
  })

  it.each(['blocked', 'needs_review'])('does not promote a %s job even with a complete-looking result', async status => {
    io.enqueue.mockResolvedValue({ id: own.job, status, result: completeGate() })
    expect(await applyInboundProdatZ02ToCustomerInfoRequest({ actorUserId: own.actor, message: message(profile) })).toMatchObject({ applied: false, targetId: own.request })
    expect(verifiedEvents()).toEqual([])
    expect(request().verified_payload).toEqual(originalSnapshot)
    assertNoBusinessWrites()
  })

  it('propagates a declared actor-port denial before any request query or worker effect', async () => {
    io.authorize.mockRejectedValue(new Error('declared_permission_denied'))
    await expect(applyInboundProdatZ02ToCustomerInfoRequest({ actorUserId: own.actor, message: message(profile) })).rejects.toThrow('declared_permission_denied')
    expect(db.calls).toEqual([])
    expect(io.enqueue).not.toHaveBeenCalled()
  })

  it('holds worker enqueue failure without replacing a verified snapshot', async () => {
    io.enqueue.mockRejectedValue(new Error('declared_worker_unavailable'))
    expect(await applyInboundProdatZ02ToCustomerInfoRequest({ actorUserId: own.actor, message: message(profile) })).toMatchObject({ applied: false, reason: 'z02_processing_enqueue_failed' })
    expect(request().verified_payload).toEqual(originalSnapshot)
    expect(verifiedEvents()).toEqual([])
    assertNoBusinessWrites()
  })

  // Ordinary failing assertions are retained if the source violates this gate.
  // This is a direct two-consumer seam probe. inboundProcessing itself is NOT
  // invoked; its null request input/fallback is independently statically mapped.
  it('a held real Z02 linker cannot be upgraded to verified by the downstream state consumer using a cached request hint', async () => {
    const row = { ...message(profile), parsed_payload: { customer_info_request_id: own.request } }
    io.enqueue.mockResolvedValue({ id: own.job, status: 'completed', result: { ...completeGate(), z02_atomic_core_applied: false } })
    const link = await applyInboundProdatZ02ToCustomerInfoRequest({ actorUserId: own.actor, message: row })
    expect(link.applied).toBe(false)
    expect(request().verified_payload).toEqual(originalSnapshot)
    await applyInboundBusinessStateMachine({ actorUserId: own.actor, message: row, customerInfoRequestId: null, source: 'prodat_without_strong_switch_match' })
    expect(request().verified_payload).toEqual(originalSnapshot)
    expect(request().status).toBe('manual_review_required')
    expect(verifiedEvents()).toEqual([])
    assertNoBusinessWrites()
  })

  it('the downstream state consumer preserves the source-owned snapshot after a complete declared atomic result', async () => {
    const row = { ...message(profile), parsed_payload: { customer_info_request_id: own.request } }
    const sourceOwned = { sourceMessageId: own.message, lineItems: [{ pointId, li, gridArea: 'NET' }], atomicCoreReceipt: id(40) }
    request().verified_payload = structuredClone(sourceOwned)
    expect(await applyInboundProdatZ02ToCustomerInfoRequest({ actorUserId: own.actor, message: row })).toMatchObject({ applied: true, targetId: own.request })
    expect(request().verified_payload).toEqual(sourceOwned)
    await applyInboundBusinessStateMachine({ actorUserId: own.actor, message: row, customerInfoRequestId: null, source: 'prodat_without_strong_switch_match' })
    expect(request().verified_payload).toEqual(sourceOwned)
    assertNoBusinessWrites()
  })
})
