// masterplan: AT-Z13V-ESCO
// Bounded profile/source projection: the origin, actor and version below are
// explicit synthetic inputs. No persisted request, native grant or send proof.
import { beforeEach, describe, expect, it, vi } from 'vitest'
const io = vi.hoisted(() => ({ rpc: vi.fn(), from: vi.fn() }))
vi.mock('@/lib/supabase/service', () => ({ supabaseService: io }))
vi.mock('@/lib/ediel/core/versionRegistry', () => ({ resolveCanonicalOutboundVersion: async () => '26.A' }))
import { buildServicePermissionDraft } from '@/lib/ediel/intent/renderers/servicePermission'
import { buildServiceReportingContext } from '@/lib/ediel/services/reporting'
import { assertReportingAuthority } from '@/lib/ediel/prodat/prodatReportingPermissionAuthority'
import { validateProdatReportingPermission } from '@/lib/ediel/rulebook/prodatReportingPermissionPolicy'
import { resolveCanonicalEdielPolicy } from '@/lib/ediel/rulebook/canonicalEdielPolicy'
import { tokenizeEdifact, segmentComposite } from '@/lib/ediel/core/edifactTokenizer'
import { applyPermissionEvent } from '@/lib/ediel/permissions/permissionEngine'
import type { ServicePermissionOriginBasis } from '@/lib/ediel/services/permissionOrigin'
import type { EdielMessageIntent } from '@/lib/ediel/intent/types'
import type { resolveCanonicalOutboundContext } from '@/lib/ediel/core/kernel'
import type { ProdatDependentConditionFacts } from '@/lib/ediel/prodat/prodatDependentConditionEngine'
import type { ProdatDateEventRow } from '@/lib/ediel/prodat/prodatDateEventAuthority'

const uid = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`
function supplied<T>(value: T | undefined): T {
  if (value === undefined) throw Error('rendered authority row field required')
  return value
}
function fixture() {
  // Same declared input contract used by the existing service-origin suite;
  // these values do not stand in for the private origin RPC's authorization.
  const basis: ServicePermissionOriginBasis = {
    status: 'authorized', companyId: uid(1), assignmentId: uid(2), assignmentVersion: 1,
    scopeBasisVersion: 1, permissionId: uid(3), permissionStateVersion: 0, code: 'Z13',
    environment: 'test', providerActorId: uid(4), dsoActorId: uid(5), legalSenderId: '21660',
    legalReceiverId: '54321', customerId: uid(6),
    customer: { org_number: 'SYNTHETIC-CUSTOMER', company_name: 'Synthetic Customer', country: 'SE', birth_date: '1990-01-01' },
    mode: 'V', requestedMethod: 'Z04', agreementReference: 'SOURCE-AGREEMENT', purposeCode: 'B72',
    frequency: 'D', reportingTerm: 'bounded', customerClassification: 'nonprivate', terminationReason: null,
    evidenceId: uid(7), evidenceSha256: 'a'.repeat(64), evidenceVersion: 'DECLARED-FIXTURE', li: null,
    objects: [{ point: null, permissionId: null, product: '8716867000030', gridArea: 'TES',
      reportStart: '2026-09-01T00:00:00+01:00', reportEnd: '2027-01-01T00:00:00+01:00' }],
  }
  const intent: EdielMessageIntent = {
    market: 'electricity', messageFamily: 'PRODAT', businessProcess: 'metering_permission', direction: 'outbound',
    senderEdielId: '99111', receiverEdielId: '54321', idempotencyKey: 'DECLARED-INTENT',
    validationStatus: 'validated', renderStatus: 'not_rendered', outboxStatus: 'not_queued',
    id: uid(8), routeProfileId: uid(9), companyId: uid(1), environment: 'test', messageCode: 'Z13',
    transactionReference: 'OWN-Z13-LI', interchangeReference: 'OWN-UNB', messageReference: '1',
    applicationReference: '23-DGI-PRODAT', payload: { externalReference: 'OWN-DOCUMENT', authorizationReference: 'SOURCE-AGREEMENT' },
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
  const input = fixture(), before = structuredClone(input), draft = await buildServicePermissionDraft(input)
  const wire = tokenizeEdifact(draft.rawPayload!), rawSegments = wire.segments.map(s => s.raw)
  const expected = buildServiceReportingContext(input.basis, input.intent, input.routeContext, input.actorUserId)
  const facts = (draft.parsedPayload!.prodatEngine as { registerEvidence: { facts: ProdatDependentConditionFacts } }).registerEvidence.facts
  if (!draft.environment) throw Error('rendered environment required')
  const row: ProdatDateEventRow = { company_id: input.basis.companyId, environment: draft.environment, direction: draft.direction,
    message_code: draft.messageCode, sender_ediel_id: supplied(draft.senderEdielId), receiver_ediel_id: supplied(draft.receiverEdielId),
    sender_sub_address: null, receiver_sub_address: null, application_reference: supplied(draft.applicationReference),
    transport_type: supplied(draft.transportType), mailbox: null, receiver_email: supplied(draft.receiverEmail),
    communication_route_id: supplied(draft.communicationRouteId), route_profile_id: supplied(draft.routeProfileId) }
  return { input, before, draft, wire, rawSegments, facts, expected, row }
}
beforeEach(() => { vi.clearAllMocks(); io.rpc.mockImplementation(() => { throw Error('UNEXPECTED_DB') }); io.from.mockImplementation(() => { throw Error('UNEXPECTED_DB') }) })

describe('Z13V source-bound profile and its permission boundary', () => {
  it('joins the actual DGI/S17 draft, identityless LIN and source authority without changing its input', async () => {
    const f = await rendered(), component = (tag: string, position: number) => segmentComposite(f.wire.segments.find(s => s.tag === tag)!, position, f.wire.una)
    expect(component('UNB', 7)).toEqual(['23-DGI-PRODAT'])
    expect(component('BGM', 1)).toEqual(['Z13'])
    expect(f.rawSegments).toContain('LIN+1')
    expect(f.rawSegments.slice(f.rawSegments.indexOf('CCI++Z13'), f.rawSegments.indexOf('CCI++Z13') + 2)).toEqual(['CCI++Z13', 'CAV+S17'])
    expect(f.draft.rawPayload).toContain('NAD+UD+SYNTHETIC-CUSTOMER:SE1:260')
    expect(f.draft.rawPayload).not.toContain('DTM+329')
    for (const internalId of [f.input.basis.companyId, f.input.basis.assignmentId, f.input.basis.permissionId]) expect(f.draft.rawPayload).not.toContain(internalId)
    expect(f.draft).toMatchObject({ requiresContrl: true, requiresAperak: true, processType: 'metering_access', status: 'draft' })
    expect(() => assertReportingAuthority({ code: 'Z13', rawSegments: f.rawSegments, una: f.wire.una, facts: f.facts, expected: f.expected, row: f.row })).not.toThrow()
    expect(validateProdatReportingPermission({ code: 'Z13', rawSegments: f.rawSegments, una: f.wire.una, facts: f.facts })).toEqual([])
    expect(f.input).toEqual(f.before)
    expect(io.rpc).not.toHaveBeenCalled(); expect(io.from).not.toHaveBeenCalled()
    const policy = resolveCanonicalEdielPolicy({ family: 'PRODAT', messageCode: 'Z13', subtypeOrReasonCode: 'V', direction: 'outbound', referenceDate: '2026-10-05', applicationReference: '23-DGI-PRODAT', mode: 'catalog_evidence' })
    expect(policy.businessResponses).toEqual(['PRODAT:Z14:V', 'PRODAT:Z14:N'])
    expect(applyPermissionEvent({ currentState: 'z13_sent', event: 'aperak_positive' })).toBe('aperak_positive')
  })
  it.each(['tenant', 'environment', 'direction', 'legalRecipient', 'technicalSender', 'application'] as const)('holds %s changes against the same rendered original', async change => {
    const f = await rendered(), row = { ...f.row }, segments = [...f.rawSegments]
    if (change === 'tenant') row.company_id = uid(99)
    if (change === 'environment') row.environment = 'production'
    if (change === 'direction') row.direction = 'inbound'
    if (change === 'legalRecipient') {
      const index = segments.findIndex(s => s.startsWith('NAD+DO+54321:160:SVK'))
      expect(index).toBeGreaterThanOrEqual(0)
      segments[index] = segments[index].replace('54321:160:SVK', '99999:160:SVK')
    }
    if (change === 'technicalSender') row.sender_ediel_id = '99999'
    if (change === 'application') row.application_reference = '23-DDQ-PRODAT'
    expect({ row, segments }).not.toEqual({ row: f.row, segments: f.rawSegments })
    expect(() => assertReportingAuthority({ code: 'Z13', rawSegments: segments, una: f.wire.una, facts: f.facts, expected: f.expected, row })).toThrow()
    expect(io.rpc).not.toHaveBeenCalled(); expect(io.from).not.toHaveBeenCalled()
  })
  it.each(['LI', 'ANJ', 'customer', 'end', 'purpose'] as const)('holds mutated %s in the actual draft against independent source facts', async change => {
    const f = await rendered(), segments = f.rawSegments.map(s => change === 'LI' && s === 'RFF+LI:OWN-Z13-LI' ? 'RFF+LI:OTHER' : change === 'ANJ' && s === 'RFF+ANJ:SOURCE-AGREEMENT' ? 'RFF+ANJ:OTHER' : change === 'customer' && s.startsWith('NAD+UD+') ? s.replace('SYNTHETIC-CUSTOMER', 'OTHER') : change === 'end' && s === 'DTM+91:202701010000:203' ? 'DTM+91:202801010000:203' : change === 'purpose' && s === 'CAV+B72' ? 'CAV+B73' : s)
    expect(segments).not.toEqual(f.rawSegments)
    expect(validateProdatReportingPermission({ code: 'Z13', rawSegments: segments, una: f.wire.una, facts: f.facts }).some(i => i.blocking)).toBe(true)
    expect(f.input).toEqual(f.before)
  })
  it('refuses birthdate-only identity and absent source method/agreement before a draft is returned', async () => {
    const f = fixture()
    await expect(buildServicePermissionDraft({ ...f, basis: { ...f.basis, customer: { birth_date: '1990-01-01', customer_number: 'INTERNAL', full_name: 'Synthetic', country: 'SE' } } })).rejects.toThrow('actual_customer_identity_required')
    await expect(buildServicePermissionDraft({ ...f, basis: { ...f.basis, requestedMethod: null } })).rejects.toThrow('source_requested_method_required')
    await expect(buildServicePermissionDraft({ ...f, basis: { ...f.basis, agreementReference: null } })).rejects.toThrow('source_agreement_reference_required')
    expect(io.rpc).not.toHaveBeenCalled(); expect(io.from).not.toHaveBeenCalled()
  })
})
