// masterplan: AT-Z13V-ESCO, AT-Z13VH-ESCO
// Required/dependent field sweep over the ACTUAL service renderer output for
// both Z13 variants (V/S17 ongoing reporting, VH/S18 bounded history). Origin,
// route, actor and version are declared finite synthetic inputs; the database
// client is an IO boundary that must never be reached. Native intake, ACK and
// Z14 effects are proven separately in scripts/ediel-at-z13v-z13vh-esco-native.test.ts.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
const io = vi.hoisted(() => ({ rpc: vi.fn(), from: vi.fn() }))
vi.mock('@/lib/supabase/service', () => ({ supabaseService: io }))
vi.mock('@/lib/ediel/core/versionRegistry', () => ({ resolveCanonicalOutboundVersion: async () => '26.A' }))
import { buildServicePermissionDraft } from '@/lib/ediel/intent/renderers/servicePermission'
import { buildServiceReportingContext } from '@/lib/ediel/services/reporting'
import { resolveCanonicalRuntimeDecision } from '@/lib/ediel/core/runtimeDecision'
import { preflightEdielMessageRow } from '@/lib/ediel/core/messageBuilder/payloadPreflight'
import { validateProdatReportingPermission } from '@/lib/ediel/rulebook/prodatReportingPermissionPolicy'
import { segmentComposite, tokenizeEdifact } from '@/lib/ediel/core/edifactTokenizer'
import { serializeUna } from '@/lib/ediel/core/una'
import { createProdatRegisterEvidence } from '@/lib/ediel/prodat/prodatRegisterEvidence'
import { omitPermissionField, permissionRequiredFields, type PermissionField } from '../scripts/helpers/ediel-permission-field-omissions'
import type { ServicePermissionOriginBasis } from '@/lib/ediel/services/permissionOrigin'
import type { EdielMessageIntent } from '@/lib/ediel/intent/types'
import type { resolveCanonicalOutboundContext } from '@/lib/ediel/core/kernel'
import type { ProdatDependentConditionFacts } from '@/lib/ediel/prodat/prodatDependentConditionEngine'
import type { CreateEdielMessageInput, EdielMessageRow } from '@/lib/ediel/types'

type Mode = 'V' | 'VH'
const now = Date.parse('2026-10-05T10:00:00Z')
const uid = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`

function fixture(mode: Mode) {
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
// The persisted outbound row shape the send preflight and canonical decision read.
function messageRow(d: CreateEdielMessageInput): EdielMessageRow {
  return { id: uid(30), company_id: d.companyId, environment: d.environment ?? null, direction: 'outbound', message_standard: 'edifact',
    message_family: 'PRODAT', message_code: d.messageCode, status: 'queued', raw_payload: d.rawPayload ?? null, parsed_payload: d.parsedPayload ?? {},
    mime_type: d.mimeType ?? null, sender_ediel_id: d.senderEdielId ?? null, receiver_ediel_id: d.receiverEdielId ?? null,
    sender_sub_address: null, receiver_sub_address: null, application_reference: d.applicationReference ?? null,
    transport_type: d.transportType ?? null, mailbox: null, receiver_email: d.receiverEmail ?? null,
    communication_route_id: d.communicationRouteId ?? null, route_profile_id: d.routeProfileId ?? null,
    transaction_reference: d.transactionReference ?? null, created_at: '2026-10-05T10:00:00.000Z' } as unknown as EdielMessageRow
}
async function rendered(mode: Mode) {
  const input = fixture(mode), draft = await buildServicePermissionDraft(input)
  const raw = draft.rawPayload!, wire = tokenizeEdifact(raw)
  const facts = (draft.parsedPayload!.prodatEngine as { registerEvidence: { facts: ProdatDependentConditionFacts } }).registerEvidence.facts
  const context = buildServiceReportingContext(input.basis, input.intent, input.routeContext, input.actorUserId)
  return { input, draft, raw, wire, facts, context, row: messageRow(draft) }
}
// Independent P26.A Z13 field locators for the Z13-own fields the shared
// permission omission oracle does not cover (dates and characteristics).
const z13Own = {
  '302': (s: string) => s.startsWith('DTM+90:'), '321': (s: string) => s.startsWith('DTM+91:'),
  '217': (s: string) => s === 'CCI++Z04' || s === 'CAV+Z04', '222': (s: string) => s === 'CCI++Z12' || s === 'CAV+:::D',
  '506': (s: string) => s === 'CCI++Z14' || s === 'CAV+::::8716867000030', '513': (s: string) => s === 'CCI++Z22' || s === 'CAV+E19',
  '323': (s: string) => s === 'CCI++Z24' || s === 'CAV+B72', '261': (s: string) => s === 'RFF+ANJ:SOURCE-AGREEMENT',
} as const
type Z13OwnField = keyof typeof z13Own
function drop(raw: string, field: Z13OwnField) {
  const wire = tokenizeEdifact(raw), segments = wire.segments.map(s => s.raw), kept = segments.filter(s => !z13Own[field](s))
  expect(segments.length - kept.length, field).toBe(['302', '321', '261'].includes(field) ? 1 : 2)
  const head = kept.findIndex(s => s.startsWith('UNH+')), tail = kept.findIndex(s => s.startsWith('UNT+'))
  kept[tail] = kept[tail].replace(/^UNT\+\d+/, 'UNT+' + (tail - head + 1))
  return serializeUna(wire.una) + kept.join(wire.una.segmentTerminator) + wire.una.segmentTerminator
}
function omit(raw: string, field: string) {
  return field in z13Own ? drop(raw, field as Z13OwnField) : omitPermissionField(raw, field as PermissionField)
}
// Persisted bytes AND their stored register evidence rewritten together.
function withEvidence(f: Awaited<ReturnType<typeof rendered>>, raw: string): EdielMessageRow {
  const business = tokenizeEdifact(raw).segments.filter(s => !['UNA', 'UNB', 'UNH', 'UNT', 'UNZ'].includes(s.tag)).map(s => s.raw)
  const parsed = f.draft.parsedPayload as { prodatEngine: Record<string, unknown> }
  return { ...f.row, raw_payload: raw, parsed_payload: { ...parsed, prodatEngine: { ...parsed.prodatEngine, registerEvidence: createProdatRegisterEvidence({ code: 'Z13', rawSegments: business, facts: f.facts }) } } } as EdielMessageRow
}
const reasonOf = (raw: string) => {
  const wire = tokenizeEdifact(raw), i = wire.segments.findIndex(s => s.tag === 'CCI' && segmentComposite(s, 2, wire.una)[0] === 'Z13')
  return segmentComposite(wire.segments[i + 1], 1, wire.una)[0]
}

// P26.A annex 2: R for Z13 (common header/parties/line + Z13-own), excluding
// the D fields 321/323 and the installation id 209 Z13 does not need.
const syntaxMandatory = ['207', '208', '227'] as const
const policyFields = ['202', '223'] as const
const applicationRequired = ['311', '312', '203', '313', '205', '206', '314', '302', '217', '222', '506', '513', '261', '226', '228', '316'] as const
const required = [...applicationRequired, ...policyFields, ...syntaxMandatory]

beforeEach(() => {
  vi.useFakeTimers(); vi.setSystemTime(now); vi.clearAllMocks()
  io.rpc.mockImplementation(() => { throw Error('UNEXPECTED_DB') })
  io.from.mockImplementation(() => { throw Error('UNEXPECTED_DB') })
})
afterEach(() => { vi.useRealTimers(); expect(io.rpc).not.toHaveBeenCalled(); expect(io.from).not.toHaveBeenCalled() })

it('the independent required-field oracle covers every Z13 R field that is not D or the absent installation id', () => {
  // Shared-oracle fields that Z13 does not carry (Z15/Z18 own) stay out.
  const shared = permissionRequiredFields.filter(f => !['327', '322', '324', '260', '325', '209'].includes(f))
  expect([...shared].sort()).toEqual(required.filter(f => !Object.keys(z13Own).includes(f)).sort())
  expect(new Set(required).size).toBe(required.length)
})

describe.each([['V', 'S17'], ['VH', 'S18']] as const)('Z13%s/%s actual rendered request', (mode, reason) => {
  it('baseline is a complete DGI Z13 the canonical decision and source-bound send preflight both accept', async () => {
    const f = await rendered(mode)
    expect(segmentComposite(f.wire.segments.find(s => s.tag === 'UNB')!, 7, f.wire.una)).toEqual(['23-DGI-PRODAT'])
    expect(segmentComposite(f.wire.segments.find(s => s.tag === 'BGM')!, 1, f.wire.una)).toEqual(['Z13'])
    expect(reasonOf(f.raw)).toBe(reason)
    expect(f.wire.segments.filter(s => s.tag === 'LIN').map(s => s.raw)).toEqual(['LIN+1'])
    const decision = resolveCanonicalRuntimeDecision(f.row)
    expect([decision.syntaxDecision, decision.applicationDecision], JSON.stringify(decision.issues)).toEqual(['accepted', 'accepted'])
    expect(decision.policy).toMatchObject({ code: 'Z13', direction: 'outbound', transactionReasonCode: reason, applicationReference: '23-DGI-PRODAT' })
    const preflight = preflightEdielMessageRow(f.row, 'send', undefined, f.context)
    expect(preflight.issues.filter(i => i.severity === 'error')).toEqual([]); expect(preflight.ok).toBe(true)
    expect(validateProdatReportingPermission({ code: 'Z13', rawSegments: f.wire.segments.map(s => s.raw), una: f.wire.una, facts: f.facts, reportingContext: f.context })).toEqual([])
  })

  it.each(applicationRequired)('missing R field %s is rejected with its own field diagnostic and cannot be sent', async field => {
    const f = await rendered(mode), raw = omit(f.raw, field)
    expect(raw).not.toBe(f.raw)
    const decision = resolveCanonicalRuntimeDecision({ ...f.row, raw_payload: raw })
    expect(decision.syntaxDecision).toBe('accepted')
    expect(decision.applicationDecision).toBe('rejected')
    expect(decision.issues).toEqual(expect.arrayContaining([expect.objectContaining({ severity: 'error', prodatDiagnostic: expect.objectContaining({ fieldNumber: field, errorKind: 'missing' }) })]))
    expect(preflightEdielMessageRow({ ...f.row, raw_payload: raw }, 'send', undefined, f.context).ok).toBe(false)
  })

  it.each(policyFields)('missing R field %s holds canonical policy selection and is rejected with its own diagnostic', async field => {
    const f = await rendered(mode), raw = omit(f.raw, field)
    const decision = resolveCanonicalRuntimeDecision({ ...f.row, raw_payload: raw })
    expect(decision.applicationDecision).toBe('rejected')
    expect(decision.issues).toEqual(expect.arrayContaining([
      expect.objectContaining({ code: 'CANONICAL_POLICY_RESOLUTION_FAILED' }),
      expect.objectContaining({ prodatDiagnostic: expect.objectContaining({ fieldNumber: field, errorKind: 'missing' }) })]))
    expect(preflightEdielMessageRow({ ...f.row, raw_payload: raw }, 'send', undefined, f.context).ok).toBe(false)
  })

  it.each(syntaxMandatory)('missing R party identifier %s violates the UNSM mandatory component before application assessment', async field => {
    const f = await rendered(mode), decision = resolveCanonicalRuntimeDecision({ ...f.row, raw_payload: omit(f.raw, field) })
    expect(decision.syntaxDecision).toBe('rejected')
    expect(decision.applicationDecision).toBe('not_applicable')
    expect(decision.issues).toEqual(expect.arrayContaining([expect.objectContaining({ code: 'UNSM_MANDATORY_ELEMENT_MISSING' })]))
  })

  it('Z13 needs no installation id (209): an empty LIN identity stays a complete request with LIN+1', async () => {
    const f = await rendered(mode)
    // The actual renderer already emits the identityless LIN+1; an explicitly
    // emptied C212 identity element is equally a complete Z13 request.
    expect(f.wire.segments.filter(s => s.tag === 'LIN').map(s => s.raw)).toEqual(['LIN+1'])
    const raw = omitPermissionField(f.raw, '209'), wire = tokenizeEdifact(raw)
    expect(wire.segments.filter(s => s.tag === 'LIN').map(s => s.raw)).toEqual(['LIN+1++'])
    const decision = resolveCanonicalRuntimeDecision({ ...f.row, raw_payload: raw })
    expect([decision.syntaxDecision, decision.applicationDecision], JSON.stringify(decision.issues)).toEqual(['accepted', 'accepted'])
  })

  it('the dependent purpose field 323 may be absent on the wire', async () => {
    const f = await rendered(mode), decision = resolveCanonicalRuntimeDecision({ ...f.row, raw_payload: omit(f.raw, '323') })
    expect([decision.syntaxDecision, decision.applicationDecision], JSON.stringify(decision.issues)).toEqual(['accepted', 'accepted'])
  })

  it('a bounded request missing its dependent end (321) is refused by the source-bound reporting validator and preflight', async () => {
    const f = await rendered(mode), raw = omit(f.raw, '321'), wire = tokenizeEdifact(raw)
    const issues = validateProdatReportingPermission({ code: 'Z13', rawSegments: wire.segments.map(s => s.raw), una: wire.una, facts: f.facts, reportingContext: f.context })
    expect(issues.map(i => [i.code, i.blocking, i.fieldPath])).toEqual([['PRODAT_REPORTING_REQUIRED', true, 'DTM+91']])
    expect(issues[0].description).toContain('Z13:321')
    // Stale stored evidence no longer binds the changed bytes.
    const stale = preflightEdielMessageRow({ ...f.row, raw_payload: raw }, 'send', undefined, f.context)
    expect(stale.ok).toBe(false); expect(stale.issues.map(i => i.code)).toContain('PRODAT_REGISTER_EVIDENCE_INVALID')
    if (mode === 'VH') expect(stale.issues.map(i => i.code)).toContain('PRODAT_Z13VH_DTM_91_MISSING')
    // Evidence regenerated over the changed bytes: the independent source context refuses it.
    const rewritten = preflightEdielMessageRow(withEvidence(f, raw), 'send', undefined, f.context)
    expect(rewritten.ok).toBe(false)
    expect(rewritten.issues.map(i => i.code)).toContain('PRODAT_DEPENDENT_PREFLIGHT_PRODAT_REPORTING_REQUIRED')
  })

  it('a swapped S17/S18 reason is refused by the source-bound reporting validator and preflight', async () => {
    const f = await rendered(mode), other = reason === 'S17' ? 'S18' : 'S17'
    const raw = f.raw.replace(`CCI++Z13'CAV+${reason}'`, `CCI++Z13'CAV+${other}'`), wire = tokenizeEdifact(raw)
    expect(reasonOf(raw)).toBe(other)
    const issues = validateProdatReportingPermission({ code: 'Z13', rawSegments: wire.segments.map(s => s.raw), una: wire.una, facts: f.facts, reportingContext: f.context })
    // The source object expects its own reason: with the other reason no
    // request/LI/UD/ANJ basis, no assessed purpose and no source object match.
    expect(issues.map(i => [i.code, i.blocking])).toEqual([
      ['PRODAT_REPORTING_UNDETERMINED', true], ['PRODAT_REPORTING_UNDETERMINED', true], ['PRODAT_REPORTING_SOURCE_OBJECT_MISSING', true]])
    expect(issues.map(i => i.description.slice(0, 7))).toEqual(['Z13:321', 'Z13:323', 'Z13:321'])
    const stale = preflightEdielMessageRow({ ...f.row, raw_payload: raw }, 'send', undefined, f.context)
    expect(stale.ok).toBe(false); expect(stale.issues.map(i => i.code)).toContain('PRODAT_REGISTER_EVIDENCE_INVALID')
    const rewritten = preflightEdielMessageRow(withEvidence(f, raw), 'send', undefined, f.context)
    expect(rewritten.ok).toBe(false)
    expect(rewritten.issues.map(i => i.code)).toEqual(expect.arrayContaining(['PRODAT_DEPENDENT_PREFLIGHT_PRODAT_REPORTING_UNDETERMINED', 'PRODAT_DEPENDENT_PREFLIGHT_PRODAT_REPORTING_SOURCE_OBJECT_MISSING']))
  })
})
