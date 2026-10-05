// masterplan: AT-Z13VH-ESCO
// Bounded historical renderer/consumer join. Origin, reviewed timing, actor,
// route and version are declared finite inputs, not private RPC/native proof.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
const io = vi.hoisted(() => ({ rpc: vi.fn(), from: vi.fn() }))
vi.mock('@/lib/supabase/service', () => ({ supabaseService: io }))
vi.mock('@/lib/ediel/core/versionRegistry', () => ({ resolveCanonicalOutboundVersion: async () => '26.A' }))
import { buildServicePermissionDraft } from '@/lib/ediel/intent/renderers/servicePermission'
import { buildServiceReportingContext } from '@/lib/ediel/services/reporting'
import { assertCapturedServiceRequestTiming } from '@/lib/ediel/services/requestTiming'
import { assertReportingAuthority } from '@/lib/ediel/prodat/prodatReportingPermissionAuthority'
import { validateProdatReportingPermission } from '@/lib/ediel/rulebook/prodatReportingPermissionPolicy'
import { resolveCanonicalEdielPolicy } from '@/lib/ediel/rulebook/canonicalEdielPolicy'
import { segmentComposite, tokenizeEdifact } from '@/lib/ediel/core/edifactTokenizer'
import type { ServicePermissionOriginBasis } from '@/lib/ediel/services/permissionOrigin'
import type { EdielMessageIntent } from '@/lib/ediel/intent/types'
import type { resolveCanonicalOutboundContext } from '@/lib/ediel/core/kernel'
import type { ProdatDependentConditionFacts } from '@/lib/ediel/prodat/prodatDependentConditionEngine'
import type { ProdatDateEventRow } from '@/lib/ediel/prodat/prodatDateEventAuthority'

const now = Date.parse('2026-10-05T10:00:00Z')
const uid = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`
function supplied<T>(value: T | undefined): T {
  if (value === undefined) throw Error('rendered authority field required')
  return value
}
function fixture() {
  // Existing service-origin input contract, with a genuinely bounded past
  // period. The test does not archive or approve the declared legal evidence.
  const basis: ServicePermissionOriginBasis = {
    status: 'authorized', companyId: uid(1), assignmentId: uid(2), assignmentVersion: 1,
    scopeBasisVersion: 1, permissionId: uid(3), permissionStateVersion: 0, code: 'Z13',
    environment: 'test', providerActorId: uid(4), dsoActorId: uid(5), legalSenderId: '21660',
    legalReceiverId: '54321', customerId: uid(6),
    customer: { org_number: 'SYNTHETIC-VH-CUSTOMER', company_name: 'Synthetic VH Customer', country: 'SE', birth_date: '1990-01-01' },
    mode: 'VH', requestedMethod: 'Z04', agreementReference: 'VH-AGREEMENT', purposeCode: 'B72',
    frequency: 'D', reportingTerm: 'bounded', customerClassification: 'nonprivate', terminationReason: null,
    evidenceId: uid(7), evidenceSha256: 'a'.repeat(64), evidenceVersion: 'DECLARED-HISTORY', li: null,
    requestTiming: { version: 1, evidenceId: uid(7), sourceHash: 'a'.repeat(64), sourceReference: 'DECLARED-NETWORK',
      sourceVersion: 'DECLARED-HISTORY', networkStart: '2025-01-01', networkEnd: '2027-01-01',
      reviewId: uid(20), reviewerUserId: uid(21), reviewSequence: 1, scopeBasisVersion: 1, requestDay: '2026-10-05' },
    objects: [{ point: null, permissionId: null, product: '8716867000030', gridArea: 'TES',
      reportStart: '2026-06-01T00:00:00+01:00', reportEnd: '2026-09-01T00:00:00+01:00' }],
  }
  const intent: EdielMessageIntent = {
    market: 'electricity', messageFamily: 'PRODAT', businessProcess: 'metering_permission', direction: 'outbound',
    senderEdielId: '99111', receiverEdielId: '54321', idempotencyKey: 'DECLARED-VH-INTENT',
    validationStatus: 'validated', renderStatus: 'not_rendered', outboxStatus: 'not_queued',
    id: uid(8), routeProfileId: uid(9), companyId: uid(1), environment: 'test', messageCode: 'Z13',
    transactionReference: 'VH-LI', interchangeReference: 'VH-UNB', messageReference: '1',
    applicationReference: '23-DGI-PRODAT', payload: { externalReference: 'VH-DOCUMENT', authorizationReference: 'VH-AGREEMENT' },
  }
  const routeContext = {
    companyId: uid(1), environment: 'test', actor: { tenantIdentity: { legalActorId: uid(4) }, legalActorEdielId: '21660' },
    senderEdielId: '99111', receiverEdielId: '54321', senderSubAddress: null, receiverSubAddress: null,
    receiverMessageSubAddress: null, applicationReference: '23-DGI-PRODAT', route: { id: uid(10) },
    routeRuntime: { route_profile_id: uid(9) }, mailbox: null, receiverEmail: 'dso@example.invalid',
  } as Awaited<ReturnType<typeof resolveCanonicalOutboundContext>>
  return { basis, intent, routeContext, actorUserId: uid(11), outboundRequestId: uid(12) }
}
async function rendered() {
  const input = fixture(), before = structuredClone(input)
  assertCapturedServiceRequestTiming(input.basis)
  const draft = await buildServicePermissionDraft(input), wire = tokenizeEdifact(draft.rawPayload!)
  const rawSegments = wire.segments.map(segment => segment.raw)
  const expected = buildServiceReportingContext(input.basis, input.intent, input.routeContext, input.actorUserId, now)
  const facts = (draft.parsedPayload!.prodatEngine as { registerEvidence: { facts: ProdatDependentConditionFacts } }).registerEvidence.facts
  const row: ProdatDateEventRow = { company_id: input.basis.companyId, environment: supplied(draft.environment),
    direction: draft.direction, message_code: draft.messageCode, sender_ediel_id: supplied(draft.senderEdielId),
    receiver_ediel_id: supplied(draft.receiverEdielId), sender_sub_address: null, receiver_sub_address: null,
    application_reference: supplied(draft.applicationReference), transport_type: supplied(draft.transportType),
    mailbox: null, receiver_email: supplied(draft.receiverEmail), communication_route_id: supplied(draft.communicationRouteId),
    route_profile_id: supplied(draft.routeProfileId) }
  return { input, before, draft, wire, rawSegments, expected, facts, row }
}
beforeEach(() => {
  vi.useFakeTimers(); vi.setSystemTime(now); vi.clearAllMocks()
  io.rpc.mockImplementation(() => { throw Error('UNEXPECTED_DB') })
  io.from.mockImplementation(() => { throw Error('UNEXPECTED_DB') })
})
afterEach(() => { vi.useRealTimers() })

describe('Z13VH bounded history profile with independent source and clock', () => {
  it('joins the historical timing guard, actual identityless S18 draft and source authority', async () => {
    const f = await rendered(), parts = (tag: string, position: number) => segmentComposite(f.wire.segments.find(s => s.tag === tag)!, position, f.wire.una)
    expect(parts('UNB', 7)).toEqual(['23-DGI-PRODAT']); expect(parts('BGM', 1)).toEqual(['Z13'])
    expect(f.rawSegments).toContain('LIN+1')
    expect(f.rawSegments).toEqual(expect.arrayContaining(['DTM+90:202606010000:203', 'DTM+91:202609010000:203']))
    const customers = f.wire.segments.filter(segment => segment.tag === 'NAD' && segmentComposite(segment, 1, f.wire.una)[0] === 'UD')
    expect(customers).toHaveLength(1)
    expect(segmentComposite(customers[0], 2, f.wire.una)).toEqual(['SYNTHETIC-VH-CUSTOMER', 'SE1', '260'])
    const reason = f.rawSegments.indexOf('CCI++Z13')
    expect(reason).toBeGreaterThanOrEqual(0); expect(f.rawSegments[reason + 1]).toBe('CAV+S18')
    expect(f.draft.rawPayload).not.toContain('DTM+329')
    for (const internalId of [f.input.basis.companyId, f.input.basis.assignmentId, f.input.basis.permissionId]) expect(f.draft.rawPayload).not.toContain(internalId)
    expect(f.draft).toMatchObject({ status: 'draft', processType: 'metering_access', requiresContrl: true, requiresAperak: true })
    expect(() => assertReportingAuthority({ code: 'Z13', rawSegments: f.rawSegments, una: f.wire.una, facts: f.facts, expected: f.expected, row: f.row })).not.toThrow()
    expect(validateProdatReportingPermission({ code: 'Z13', rawSegments: f.rawSegments, una: f.wire.una, facts: f.facts, reportingContext: f.expected })).toEqual([])
    const policy = resolveCanonicalEdielPolicy({ family: 'PRODAT', messageCode: 'Z13', subtypeOrReasonCode: 'VH', direction: 'outbound', referenceDate: '2026-10-05', applicationReference: '23-DGI-PRODAT', mode: 'catalog_evidence' })
    expect(policy.businessResponses).toEqual(['PRODAT:Z14:VH', 'PRODAT:Z14:N'])
    expect(f.input).toEqual(f.before); expect(io.rpc).not.toHaveBeenCalled(); expect(io.from).not.toHaveBeenCalled()
  })
  it.each(['missingEnd', 'changedEnd', 'ongoingReason'] as const)('holds %s against the independently declared history', async change => {
    const f = await rendered(), segments = f.rawSegments.flatMap(segment =>
      change === 'missingEnd' && segment === 'DTM+91:202609010000:203' ? [] :
        change === 'changedEnd' && segment === 'DTM+91:202609010000:203' ? ['DTM+91:202609020000:203'] :
          [change === 'ongoingReason' && segment === 'CAV+S18' ? 'CAV+S17' : segment])
    expect(segments).not.toEqual(f.rawSegments)
    expect(validateProdatReportingPermission({ code: 'Z13', rawSegments: segments, una: f.wire.una, facts: f.facts, reportingContext: f.expected }).some(issue => issue.blocking)).toBe(true)
    expect(f.input).toEqual(f.before); expect(io.rpc).not.toHaveBeenCalled(); expect(io.from).not.toHaveBeenCalled()
  })
  it('requires the independent evaluation clock rather than a stored parsed snapshot', async () => {
    const f = await rendered()
    expect(f.facts.reportingPermission).not.toHaveProperty('evaluationUtcMs')
    const held = validateProdatReportingPermission({ code: 'Z13', rawSegments: f.rawSegments, una: f.wire.una, facts: f.facts })
    expect(held).toEqual(expect.arrayContaining([expect.objectContaining({ code: 'PRODAT_REPORTING_CLOCK_INVALID', blocking: true })]))
    expect(validateProdatReportingPermission({ code: 'Z13', rawSegments: f.rawSegments, una: f.wire.una, facts: f.facts, reportingContext: f.expected })).toEqual([])
  })
  it('refuses an absent bounded end at the timing and actual service-source boundary', async () => {
    const input = fixture(), basis = { ...input.basis, objects: [{ ...input.basis.objects[0], reportEnd: null }] }
    expect(() => assertCapturedServiceRequestTiming(basis)).toThrow('source_period_outside_captured_bounds')
    await expect(buildServicePermissionDraft({ ...input, basis })).rejects.toThrow('reporting_term_unqualified')
    expect(io.rpc).not.toHaveBeenCalled(); expect(io.from).not.toHaveBeenCalled()
  })
})
