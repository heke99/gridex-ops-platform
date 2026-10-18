// masterplan: AT-Z13V-ESCO, AT-Z13VH-ESCO
// Request guards of the ACTUAL service Z13 renderer and the source-bound send
// preflight. The database client and canonical version lookup are IO
// boundaries; renderProdat is wrapped (not replaced) to observe that a refused
// request renders nothing. No supply/activation port may ever be reached.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
const io = vi.hoisted(() => ({ rpc: vi.fn(), from: vi.fn(), version: vi.fn(async () => '26.A'), render: vi.fn() }))
vi.mock('@/lib/supabase/service', () => ({ supabaseService: io }))
vi.mock('@/lib/ediel/core/versionRegistry', () => ({ resolveCanonicalOutboundVersion: io.version }))
vi.mock('@/lib/ediel/prodat/engine', async importOriginal => {
  const actual = await importOriginal<typeof import('@/lib/ediel/prodat/engine')>()
  io.render.mockImplementation(actual.renderProdat as never)
  return { ...actual, renderProdat: (...args: unknown[]) => io.render(...args) }
})
import { buildServicePermissionDraft } from '@/lib/ediel/intent/renderers/servicePermission'
import { buildServiceReportingContext } from '@/lib/ediel/services/reporting'
import { assertCapturedServiceRequestTiming } from '@/lib/ediel/services/requestTiming'
import { preflightEdielMessageRow } from '@/lib/ediel/core/messageBuilder/payloadPreflight'
import { assertReportingAuthority } from '@/lib/ediel/prodat/prodatReportingPermissionAuthority'
import { validateProdatReportingPermission } from '@/lib/ediel/rulebook/prodatReportingPermissionPolicy'
import { resolveCanonicalRuntimeDecision } from '@/lib/ediel/core/runtimeDecision'
import { resolveCanonicalEdielPolicy } from '@/lib/ediel/rulebook/canonicalEdielPolicy'
import { createProdatRegisterEvidence } from '@/lib/ediel/prodat/prodatRegisterEvidence'
import { segmentComposite, tokenizeEdifact } from '@/lib/ediel/core/edifactTokenizer'
import type { ServicePermissionOriginBasis } from '@/lib/ediel/services/permissionOrigin'
import type { EdielMessageIntent } from '@/lib/ediel/intent/types'
import type { resolveCanonicalOutboundContext } from '@/lib/ediel/core/kernel'
import type { ProdatDependentConditionFacts } from '@/lib/ediel/prodat/prodatDependentConditionEngine'
import type { ProdatDateEventRow } from '@/lib/ediel/prodat/prodatDateEventAuthority'
import type { CreateEdielMessageInput, EdielMessageRow } from '@/lib/ediel/types'

type Mode = 'V' | 'VH'
type Input = Parameters<typeof buildServicePermissionDraft>[0]
const now = Date.parse('2026-10-05T10:00:00Z')
const uid = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`
function supplied<T>(value: T | undefined | null): T {
  if (value === undefined || value === null) throw Error('rendered field required')
  return value
}
function fixture(mode: Mode): Input {
  const basis: ServicePermissionOriginBasis = {
    status: 'authorized', companyId: uid(1), assignmentId: uid(2), assignmentVersion: 1,
    scopeBasisVersion: 1, permissionId: uid(3), permissionStateVersion: 0, code: 'Z13',
    environment: 'test', providerActorId: uid(4), dsoActorId: uid(5), legalSenderId: '21660',
    legalReceiverId: '54321', customerId: uid(6),
    customer: { org_number: 'SYNTHETIC-CUSTOMER', company_name: 'Synthetic Customer', country: 'SE', birth_date: '1990-01-01' },
    mode, requestedMethod: 'Z04', agreementReference: 'SOURCE-AGREEMENT', purposeCode: 'B72',
    frequency: 'D', reportingTerm: 'bounded', customerClassification: 'nonprivate', terminationReason: null,
    evidenceId: uid(7), evidenceSha256: 'a'.repeat(64), evidenceVersion: 'DECLARED-FIXTURE', li: null,
    ...(mode === 'VH' ? { requestTiming: { version: 1, evidenceId: uid(7), sourceHash: 'a'.repeat(64), sourceReference: 'DECLARED-NETWORK',
      sourceVersion: 'DECLARED-HISTORY', networkStart: '2025-01-01', networkEnd: '2027-01-01',
      reviewId: uid(20), reviewerUserId: uid(21), reviewSequence: 1, scopeBasisVersion: 1, requestDay: '2026-10-05' } } : {}),
    objects: [{ point: null, permissionId: null, product: '8716867000030', gridArea: 'TES',
      reportStart: mode === 'V' ? '2026-09-01T00:00:00+01:00' : '2026-06-01T00:00:00+01:00',
      reportEnd: mode === 'V' ? '2027-01-01T00:00:00+01:00' : '2026-09-01T00:00:00+01:00' }],
  }
  const intent: EdielMessageIntent = {
    market: 'electricity', messageFamily: 'PRODAT', businessProcess: 'metering_permission', direction: 'outbound',
    senderEdielId: '99111', receiverEdielId: '54321', idempotencyKey: 'DECLARED-INTENT-' + mode,
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
function messageRow(d: CreateEdielMessageInput): EdielMessageRow {
  return { id: uid(30), company_id: d.companyId, environment: d.environment ?? null, direction: 'outbound', message_standard: 'edifact',
    message_family: 'PRODAT', message_code: d.messageCode, status: 'queued', raw_payload: d.rawPayload ?? null, parsed_payload: d.parsedPayload ?? {},
    mime_type: d.mimeType ?? null, sender_ediel_id: d.senderEdielId ?? null, receiver_ediel_id: d.receiverEdielId ?? null,
    sender_sub_address: null, receiver_sub_address: null, application_reference: d.applicationReference ?? null,
    transport_type: d.transportType ?? null, mailbox: null, receiver_email: d.receiverEmail ?? null,
    communication_route_id: d.communicationRouteId ?? null, route_profile_id: d.routeProfileId ?? null,
    transaction_reference: d.transactionReference ?? null, created_at: '2026-10-05T10:00:00.000Z' } as unknown as EdielMessageRow
}
async function rendered(input: Input) {
  const before = structuredClone(input), draft = await buildServicePermissionDraft(input)
  const raw = supplied(draft.rawPayload), wire = tokenizeEdifact(raw), rawSegments = wire.segments.map(s => s.raw)
  const facts = (draft.parsedPayload!.prodatEngine as { registerEvidence: { facts: ProdatDependentConditionFacts } }).registerEvidence.facts
  const context = buildServiceReportingContext(input.basis, input.intent, input.routeContext, input.actorUserId)
  const authorityRow: ProdatDateEventRow = { company_id: input.basis.companyId, environment: supplied(draft.environment), direction: draft.direction,
    message_code: draft.messageCode, sender_ediel_id: supplied(draft.senderEdielId), receiver_ediel_id: supplied(draft.receiverEdielId),
    sender_sub_address: null, receiver_sub_address: null, application_reference: supplied(draft.applicationReference),
    transport_type: supplied(draft.transportType), mailbox: null, receiver_email: supplied(draft.receiverEmail),
    communication_route_id: supplied(draft.communicationRouteId), route_profile_id: supplied(draft.routeProfileId) }
  return { before, draft, raw, wire, rawSegments, facts, context, authorityRow, row: messageRow(draft) }
}
const reasonOf = (wire: ReturnType<typeof tokenizeEdifact>) => {
  const i = wire.segments.findIndex(s => s.tag === 'CCI' && segmentComposite(s, 2, wire.una)[0] === 'Z13')
  return segmentComposite(wire.segments[i + 1], 1, wire.una)[0]
}

beforeEach(() => {
  vi.useFakeTimers(); vi.setSystemTime(now); vi.clearAllMocks()
  io.rpc.mockImplementation(() => { throw Error('UNEXPECTED_DB') })
  io.from.mockImplementation(() => { throw Error('UNEXPECTED_DB') })
})
// No request, guard or preflight path may reach a persistence, supply,
// activation or permission RPC: those effects belong to the native Z14 owner.
afterEach(() => { vi.useRealTimers(); expect(io.rpc).not.toHaveBeenCalled(); expect(io.from).not.toHaveBeenCalled() })

describe.each(['V', 'VH'] as const)('Z13%s route/legal/environment scope guard', mode => {
  it.each([
    ['wrong DSO receiver', (i: Input) => { i.routeContext.receiverEdielId = '99999' }],
    ['wrong legal sender', (i: Input) => { i.routeContext.actor.legalActorEdielId = '11111' }],
    ['wrong environment', (i: Input) => { i.routeContext.environment = 'production' }],
    ['foreign tenant route', (i: Input) => { i.routeContext.companyId = uid(99) }],
    ['foreign provider actor', (i: Input) => { i.routeContext.actor.tenantIdentity = { legalActorId: uid(98) } as never }],
  ] as const)('%s throws route_legal_scope_mismatch and renders nothing', async (_name, change) => {
    const input = fixture(mode)
    change(input)
    await expect(buildServicePermissionDraft(input)).rejects.toThrow('ediel_permission_route_legal_scope_mismatch')
    expect(io.render).not.toHaveBeenCalled(); expect(io.version).not.toHaveBeenCalled()
    // The source-bound reporting context refuses the same foreign scope independently.
    expect(() => buildServiceReportingContext(input.basis, input.intent, input.routeContext, input.actorUserId)).toThrow('ediel_service_reporting_source_unqualified')
  })

  it('the unchanged route renders exactly one object through the canonical renderer', async () => {
    const f = await rendered(fixture(mode))
    expect(io.render).toHaveBeenCalledTimes(1); expect(io.version).toHaveBeenCalledTimes(1)
    expect(f.draft).toMatchObject({ direction: 'outbound', messageFamily: 'PRODAT', messageCode: 'Z13', processType: 'metering_access', status: 'draft', requiresContrl: true, requiresAperak: true })
  })
})

describe('Z13 customer identity guards', () => {
  it.each(['V', 'VH'] as const)('Z13%s refuses an ambiguous organisation plus personal identity before rendering', async mode => {
    const input = fixture(mode)
    input.basis = { ...input.basis, customer: { ...input.basis.customer, personal_number: '199001011234' } }
    await expect(buildServicePermissionDraft(input)).rejects.toThrow('ediel_permission_customer_legal_identity_ambiguous')
    expect(io.render).not.toHaveBeenCalled()
  })
  it.each(['V', 'VH'] as const)('Z13%s refuses a birth-date-only customer: identity is never a birth date', async mode => {
    const input = fixture(mode)
    input.basis = { ...input.basis, customer: { birth_date: '1990-01-01', customer_number: 'INTERNAL', full_name: 'Synthetic', country: 'SE' } }
    await expect(buildServicePermissionDraft(input)).rejects.toThrow('ediel_permission_actual_customer_identity_required')
    expect(io.render).not.toHaveBeenCalled()
  })
  it.each(['V', 'VH'] as const)('Z13%s never renders the birth date even when the customer row carries one', async mode => {
    const f = await rendered(fixture(mode))
    expect(f.raw).not.toContain('1990-01-01'); expect(f.raw).not.toContain('19900101'); expect(f.raw).not.toContain('DTM+329')
    const customers = f.wire.segments.filter(s => s.tag === 'NAD' && segmentComposite(s, 1, f.wire.una)[0] === 'UD')
    expect(customers.map(s => segmentComposite(s, 2, f.wire.una))).toEqual([['SYNTHETIC-CUSTOMER', 'SE1', '260']])
  })
})

describe('Z13V open-ended ongoing reporting', () => {
  it('an indefinite V request renders S17 without an end and passes every source-bound check', async () => {
    const input = fixture('V')
    input.basis = { ...input.basis, reportingTerm: 'indefinite', objects: [{ ...input.basis.objects[0], reportEnd: null }] }
    const f = await rendered(input)
    expect(segmentComposite(f.wire.segments.find(s => s.tag === 'UNB')!, 7, f.wire.una)).toEqual(['23-DGI-PRODAT'])
    expect(segmentComposite(f.wire.segments.find(s => s.tag === 'BGM')!, 1, f.wire.una)).toEqual(['Z13'])
    expect(reasonOf(f.wire)).toBe('S17')
    expect(f.rawSegments).toContain('LIN+1'); expect(f.rawSegments.some(s => s.startsWith('DTM+91'))).toBe(false)
    expect(f.rawSegments).toContain('DTM+90:202609010000:203')
    expect(validateProdatReportingPermission({ code: 'Z13', rawSegments: f.rawSegments, una: f.wire.una, facts: f.facts, reportingContext: f.context })).toEqual([])
    expect(() => assertReportingAuthority({ code: 'Z13', rawSegments: f.rawSegments, una: f.wire.una, facts: f.facts, expected: f.context, row: f.authorityRow })).not.toThrow()
    const decision = resolveCanonicalRuntimeDecision(f.row)
    expect([decision.syntaxDecision, decision.applicationDecision], JSON.stringify(decision.issues)).toEqual(['accepted', 'accepted'])
    expect(preflightEdielMessageRow(f.row, 'send', undefined, f.context).ok).toBe(true)
    expect(input).toEqual(f.before)
  })
  it('an open-ended VH history request is refused by the captured timing guard and the source-bound validator', async () => {
    const input = fixture('VH')
    input.basis = { ...input.basis, reportingTerm: 'indefinite', objects: [{ ...input.basis.objects[0], reportEnd: null }] }
    expect(() => assertCapturedServiceRequestTiming(input.basis)).toThrow('source_period_outside_captured_bounds')
    // The wire renderer is not the authority for the history window; the
    // independent reporting validator and send preflight are.
    const f = await rendered(input)
    expect(reasonOf(f.wire)).toBe('S18'); expect(f.rawSegments.some(s => s.startsWith('DTM+91'))).toBe(false)
    expect(validateProdatReportingPermission({ code: 'Z13', rawSegments: f.rawSegments, una: f.wire.una, facts: f.facts, reportingContext: f.context }))
      .toEqual(expect.arrayContaining([expect.objectContaining({ code: 'PRODAT_REPORTING_FORBIDDEN', blocking: true })]))
    expect(preflightEdielMessageRow(f.row, 'send', undefined, f.context).ok).toBe(false)
  })
})

describe.each([['V', 'S17'], ['VH', 'S18']] as const)('Z13%s/%s persisted request mutation at send', (mode, reason) => {
  it('the unchanged persisted request passes the source-bound send preflight and only expects Z14 or Z14N', async () => {
    const f = await rendered(fixture(mode))
    expect(reasonOf(f.wire)).toBe(reason)
    expect(preflightEdielMessageRow(f.row, 'send', undefined, f.context)).toMatchObject({ ok: true, blocking: false })
    // The request is a metering-access permission request, never a supply (DDQ) message.
    expect(f.draft.applicationReference).toBe('23-DGI-PRODAT'); expect(f.draft.processType).toBe('metering_access')
    const policy = resolveCanonicalEdielPolicy({ family: 'PRODAT', messageCode: 'Z13', subtypeOrReasonCode: mode, direction: 'outbound', referenceDate: '2026-10-05', applicationReference: '23-DGI-PRODAT', mode: 'catalog_evidence' })
    expect(policy.businessResponses).toEqual([`PRODAT:Z14:${mode}`, 'PRODAT:Z14:N'])
  })

  const mutations = [
    ['transaction reason 223', `CCI++Z13'CAV+${reason}'`, `CCI++Z13'CAV+${reason === 'S17' ? 'S18' : 'S17'}'`],
    ['object line', "'LIN+1'", "'LIN+2'"],
    ['line reference', 'RFF+LI:OWN-Z13-LI', 'RFF+LI:OTHER-LI'],
    ['customer party', 'NAD+UD+SYNTHETIC-CUSTOMER:SE1:260', 'NAD+UD+OTHER-CUSTOMER:SE1:260'],
    ['legal DSO party', 'NAD+DO+54321:160:SVK', 'NAD+DO+99999:160:SVK'],
    ['legal requester party', 'NAD+FR+21660:160:SVK', 'NAD+FR+11111:160:SVK'],
    ['agreement reference', 'RFF+ANJ:SOURCE-AGREEMENT', 'RFF+ANJ:OTHER-AGREEMENT'],
  ] as const
  it.each(mutations)('a changed %s is refused by the send preflight with the source reporting context', async (_name, from, to) => {
    const f = await rendered(fixture(mode))
    expect(f.raw.split(from)).toHaveLength(2)
    const raw = f.raw.replace(from, to)
    // Persisted bytes changed alone: the stored register evidence no longer binds them.
    const stale = preflightEdielMessageRow({ ...f.row, raw_payload: raw }, 'send', undefined, f.context)
    expect(stale.ok).toBe(false); expect(stale.blocking).toBe(true)
    // Bytes AND the stored evidence rewritten together: the independent source context still refuses.
    const wire = tokenizeEdifact(raw), business = wire.segments.filter(s => !['UNA', 'UNB', 'UNH', 'UNT', 'UNZ'].includes(s.tag)).map(s => s.raw)
    const parsed = f.draft.parsedPayload as { prodatEngine: Record<string, unknown> }
    const rewritten = { ...f.row, raw_payload: raw, parsed_payload: { ...parsed, prodatEngine: { ...parsed.prodatEngine, registerEvidence: createProdatRegisterEvidence({ code: 'Z13', rawSegments: business, facts: f.facts }) } } }
    const result = preflightEdielMessageRow(rewritten as EdielMessageRow, 'send', undefined, f.context)
    expect(result.ok, JSON.stringify(result.issues.map(i => i.code))).toBe(false)
    expect(result.issues.some(i => i.severity === 'error' && /^PRODAT_(?:DEPENDENT_PREFLIGHT_PRODAT_REPORTING|REPORTING|REGISTER)_/.test(i.code))).toBe(true)
  })

  it('a send preflight without the independent source context never qualifies the request', async () => {
    const f = await rendered(fixture(mode))
    const result = preflightEdielMessageRow(f.row, 'send')
    expect(result.ok).toBe(false)
    expect(result.issues.map(i => i.code)).toEqual(expect.arrayContaining(['PRODAT_DEPENDENT_PREFLIGHT_PRODAT_REPORTING_SOURCE_UNQUALIFIED']))
  })
})
