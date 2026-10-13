// masterplan: AT-Z01L-SUPPLIER, AT-Z01LK-SUPPLIER
// Prepared native supplement, NOT_EXECUTED. Signed/legal/counterparty/SMTP
// fixtures are declared synthetic ports; all existing producers/intake stay real.
// Existing C1 Z02/readiness and cb17 already-correct-data evidence are separate.
import { createHash, randomUUID } from 'node:crypto'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { getEdielMessageById } from '@/lib/ediel/db'
import { prodatNowDate203 } from '@/lib/ediel/prodat/render/dates'
import { nativeSql as sql, literal } from './helpers/ediel-normal-switch-native-fixture'
import { createZ01SupplierNativeFixture, originateZ01SupplierRequest, receiveZ01SupplierReply,
  exerciseZ01SupplierOutboundField, type Z01OutboundField } from './helpers/ediel-z02-supplier-native-fixture'
import { externalZ01Contrl, externalZ02Reply } from './helpers/ediel-z02-supplier-native-wire'

const smtp = vi.hoisted(() => ({ send: vi.fn() }))
vi.mock('nodemailer', () => ({ default: { createTransport: () => ({ sendMail: smtp.send }) } }))
beforeEach(() => {
  vi.stubEnv('EDIEL_SHARED_MAILBOX_ADDRESS', 'synthetic@example.invalid')
  vi.stubEnv('EDIEL_APP_DKIM_ENABLED', 'false')
  vi.stubEnv('EMAIL_PROVIDER', 'resend'); vi.stubEnv('EDIEL_EMAIL_PROVIDER', 'strato')
  vi.stubEnv('EDIEL_SMTP_FROM', 'synthetic@example.invalid'); vi.stubEnv('EDIEL_SMTP_USER', 'synthetic@example.invalid')
  vi.stubEnv('EDIEL_SMTP_PASS', 'synthetic-only')
  vi.stubEnv('GRIDEX_CUSTOMER_DATA_EDIEL_ENVIRONMENT', 'test')
  smtp.send.mockReset()
})
afterEach(() => { vi.unstubAllEnvs(); vi.restoreAllMocks() })
const provider = (email: string) => smtp.send.mockImplementation(async () => ({ accepted: [email], rejected: [],
  messageId: `<synthetic-z01-${randomUUID()}@example.invalid>`, response: '250 explicitly synthetic SMTP acceptance' }))
type Fixture = Awaited<ReturnType<typeof createZ01SupplierNativeFixture>>
type Original = Awaited<ReturnType<typeof originateZ01SupplierRequest>>
type Row = Record<string, unknown>
const hash = (raw: string) => createHash('sha256').update(raw, 'utf8').digest('hex')
const refs = () => ({ interchangeReference: randomUUID().replaceAll('-', '').slice(0, 14),
  messageReference: randomUUID().replaceAll('-', '').slice(0, 14) })

// Capture BEFORE origination, rather than treating a post-Z01 state as baseline.
// Customer verification may legitimately change on Z02; supply/contract/start
// authority and confirmed switches may not. An active metering identity is not
// supply activation. Preserve all existing switch rows, even unconfirmed ones.
function nonActivation(f: Fixture) {
  return sql(`SELECT jsonb_build_object(
    'periods',(SELECT coalesce(jsonb_agg(to_jsonb(p) ORDER BY id),'[]') FROM public.customer_supply_periods p WHERE company_id=${literal(f.companyId)}),
    'contracts',(SELECT coalesce(jsonb_agg(to_jsonb(c) ORDER BY id),'[]') FROM public.customer_contracts c WHERE company_id=${literal(f.companyId)}),
    'customers',(SELECT coalesce(jsonb_agg(jsonb_build_object('id',id,'activatedAt',activated_at) ORDER BY id),'[]') FROM public.customers WHERE company_id=${literal(f.companyId)}),
    'switches',(SELECT coalesce(jsonb_agg(to_jsonb(s) ORDER BY id),'[]') FROM public.supplier_switch_requests s WHERE company_id=${literal(f.companyId)}),
    'z04',(SELECT count(*) FROM public.ediel_messages WHERE company_id=${literal(f.companyId)} AND message_family='PRODAT' AND message_code='Z04'))`)
}
function sealedOriginal(id: string) {
  return sql(`SELECT jsonb_build_object('id',id,'company',company_id,'environment',environment,'raw',raw_payload,
    'hash',immutable_payload_hash,'renderedAt',immutable_rendered_at,'direction',direction,
    'operation',operation_id,'sourceOperation',source_operation_id,'intent',intent_id,'route',communication_route_id,'profile',route_profile_id,
    'interchange',interchange_reference,'message',message_reference,'transaction',transaction_reference,
    'rulePack',canonical_rule_pack_id,'checksum',rule_pack_checksum,'snapshot',rule_pack_snapshot)
    FROM public.ediel_messages WHERE id=${literal(id)}`)
}
function request(f: Fixture, o: Original) {
  return sql<Row>(`SELECT to_jsonb(r) FROM public.customer_info_requests r WHERE id=${literal(o.requestId)} AND company_id=${literal(f.companyId)}`)
}
function watches(f: Fixture, originalId: string) {
  return sql<Row[]>(`SELECT coalesce(jsonb_agg(to_jsonb(e) ORDER BY id),'[]') FROM public.ediel_business_expectations e
    WHERE company_id=${literal(f.companyId)} AND environment='test' AND source_message_id=${literal(originalId)}`)
}
function otherWatches(originalId: string) {
  return sql(`SELECT coalesce(jsonb_agg(to_jsonb(e) ORDER BY id),'[]') FROM public.ediel_business_expectations e
    WHERE source_message_id<>${literal(originalId)}`)
}
const requiredFields = ['311', '312', '202', '203', '205', '206', '207', '208', '314', '209', '210',
  '223', '260', '261', '226', 'END_USER_GROUP', '227', '228', '231', '232', '316', '229', '233', '234'] as const satisfies readonly Z01OutboundField[]

describe.each(['L', 'LK'] as const)('prepared genuine Z01%s supplement (owner native execution required)', variant => {
  it('preserves pre-Z01 supply; binds the watch to actual provider time; own CONTRL satisfies only technical ACK, then own Z02 fulfils business without activation', async () => {
    const f = await createZ01SupplierNativeFixture(variant, provider)
    vi.stubEnv('GRIDEX_AUTOMATION_USER_ID', f.actorUserId)
    const before = nonActivation(f)
    const o = await originateZ01SupplierRequest(f), originalId = o.originalZ01.id
    expect(o.sendResult.status).toBe('sent')
    expect(o.originalZ01).toMatchObject({ company_id: f.companyId, environment: 'test', direction: 'outbound',
      message_family: 'PRODAT', message_code: 'Z01', immutable_payload_hash: hash(o.originalZ01.raw_payload!) })
    expect(o.wire).toMatchObject({ subtype: variant, reason: variant === 'L' ? 'Z22' : 'Z23', point: f.external,
      identityAgency: '9', customerIdentity: f.customerIdentity, gridAreaCode: f.gridAreaCode,
      agreedStartMinute: f.requestedStartDate.replaceAll('-', '') + '0000' })
    expect(o.wire.envelope.applicationReference).toBe('23-DDQ-PRODAT')
    expect(request(f, o)).toMatchObject({ id: o.requestId, company_id: f.companyId,
      customer_id: f.customerId, operation_id: o.operationId, ediel_message_id: originalId,
      status: 'waiting_for_z02', response_ediel_message_id: null })
    expect(nonActivation(f)).toEqual(before)
    const sealed = sealedOriginal(originalId), own = watches(f, originalId), foreign = otherWatches(originalId)
    expect(own).toHaveLength(1)
    expect(own[0]).toMatchObject({ company_id: f.companyId, environment: 'test', source_message_id: originalId,
      expected_family: 'PRODAT', expected_code: 'Z02', status: 'pending', fulfilled_by_message_id: null,
      metadata: { anchorType: 'actual_accepted_smtp_observed_at', remoteReceiptKnown: false, automaticResendAllowed: false } })
    const watchOperation = sql<string>(`SELECT to_jsonb(coalesce(nullif(source_operation_id,''),operation_id::text,
      'source_message:'||id::text)) FROM public.ediel_messages WHERE id=${literal(originalId)}
      AND company_id=${literal(f.companyId)} AND environment='test'`)
    expect(own[0].source_operation_id).toBe(watchOperation)
    const bindings = sql<Row[]>(`SELECT coalesce(jsonb_agg(to_jsonb(b) ORDER BY expectation_id),'[]') FROM gridex_business_expectations.bindings b
      WHERE expectation_id=${literal(own[0].id)} AND company_id=${literal(f.companyId)} AND source_message_id=${literal(originalId)}`)
    expect(bindings).toHaveLength(1)
    expect(bindings[0]).toMatchObject({ company_id: f.companyId, environment: 'test', source_message_id: originalId,
      source_payload_hash: hash(o.originalZ01.raw_payload!), dispatch_attempt_id: null,
      plan: { sourceCode: 'Z01', expectedCode: 'Z02', expectedSubtypes: [variant], offset: 30, unit: 'minutes',
        anchor: 'actual_accepted_smtp_observed_at', timerKind: 'internal_sender_watch', remoteReceiptKnown: false } })
    const attempt = sql<Row>(`SELECT to_jsonb(a) FROM gridex_ediel_transport.attempts a WHERE id=${literal(bindings[0].transport_attempt_id)}
      AND company_id=${literal(f.companyId)} AND message_id=${literal(originalId)}`)
    expect(attempt).toMatchObject({ company_id: f.companyId, environment: 'test', message_id: originalId,
      classification: 'accepted', binding: { originalHash: hash(o.originalZ01.raw_payload!) },
      provider_result: { accepted: [o.originalZ01.receiver_email], rejected: [] } })
    expect(attempt.entered_at).not.toBeNull()
    expect(Number.isFinite(Date.parse(String(attempt.observed_at)))).toBe(true)
    expect(bindings[0].observed_at).toBe(attempt.observed_at)
    expect(Date.parse(String(own[0].due_at)) - Date.parse(String(attempt.observed_at))).toBe(30 * 60_000)
    const deadlineBasis = sql<Row>(`SELECT jsonb_build_object('ownHash',b.source_payload_hash=m.immutable_payload_hash,
      'ownAttempt',b.transport_attempt_id=a.id,'providerClock',b.observed_at=a.observed_at,
      'metadataClock',(e.metadata->>'anchorAt')::timestamptz=a.observed_at,
      'businessDeadline',e.due_at=a.observed_at+interval '30 minutes')
      FROM gridex_business_expectations.bindings b JOIN public.ediel_business_expectations e ON e.id=b.expectation_id
      JOIN gridex_ediel_transport.attempts a ON a.id=b.transport_attempt_id AND a.company_id=b.company_id
      JOIN public.ediel_messages m ON m.id=b.source_message_id AND m.company_id=b.company_id
      WHERE e.id=${literal(own[0].id)}`)
    expect(deadlineBasis).toEqual({ ownHash: true, ownAttempt: true, providerClock: true, metadataClock: true, businessDeadline: true })

    const technicalRaw = externalZ01Contrl({ source: { rawPayload: o.originalZ01.raw_payload! }, ...refs() })
    const technical = await receiveZ01SupplierReply(f, technicalRaw)
    expect(technical.message).toMatchObject({ company_id: f.companyId, environment: 'test', direction: 'inbound',
      message_family: 'CONTRL', raw_payload: technicalRaw, related_message_id: originalId })
    const receipt = sql<Row>(`SELECT result FROM gridex_ack_authority.applied_receipts WHERE ack_message_id=${literal(technical.id)}`)
    expect(receipt).toMatchObject({ version: 1, outcome: 'positive', scope: 'interchange', wholeSourceRejected: false,
      sourceMessage: { id: originalId, company_id: f.companyId, environment: 'test', contrl_status: 'received' } })
    const sourceAfterTechnical = await getEdielMessageById(originalId, { companyId: f.companyId })
    expect(sourceAfterTechnical).toMatchObject({ contrl_status: 'received', immutable_payload_hash: hash(o.originalZ01.raw_payload!) })
    expect(watches(f, originalId)).toEqual(own)
    expect(request(f, o)).toMatchObject({ status: 'waiting_for_z02', response_ediel_message_id: null })
    expect(nonActivation(f)).toEqual(before); expect(sealedOriginal(originalId)).toEqual(sealed)
    expect(otherWatches(originalId)).toEqual(foreign)

    const businessRaw = externalZ02Reply({ source: { rawPayload: o.originalZ01.raw_payload! }, ...refs(),
      documentReference: `Z02-${randomUUID().slice(0, 8)}`, documentMinute: prodatNowDate203(),
      measurementMethod: 'Z04', customerAddress: f.customerAddress, installationAddress: f.installationAddress })
    const business = await receiveZ01SupplierReply(f, businessRaw)
    expect(business.message).toMatchObject({ company_id: f.companyId, environment: 'test', direction: 'inbound',
      message_family: 'PRODAT', message_code: 'Z02', raw_payload: businessRaw, related_message_id: originalId,
      customer_id: f.customerId, metering_point_id: f.pointId })
    const fulfilled = watches(f, originalId)
    expect(fulfilled).toHaveLength(1)
    const fulfilledMetadata = fulfilled[0].metadata as Row
    expect(fulfilledMetadata.resolvedBy).toBe('immutable_applied_business_source')
    expect(Number.isFinite(Date.parse(String(fulfilledMetadata.resolvedAt)))).toBe(true)
    expect(Date.parse(String(fulfilledMetadata.resolvedAt))).toBe(Date.parse(String(fulfilled[0].updated_at)))
    expect(fulfilled).toEqual([{ ...own[0], status: 'fulfilled', fulfilled_by_message_id: business.id,
      updated_at: fulfilled[0].updated_at, metadata: { ...(own[0].metadata as Row),
        resolvedBy: 'immutable_applied_business_source', resolvedAt: fulfilledMetadata.resolvedAt } }])
    expect(sql(`SELECT coalesce(jsonb_agg(to_jsonb(b) ORDER BY expectation_id),'[]') FROM gridex_business_expectations.bindings b
      WHERE expectation_id=${literal(own[0].id)} AND company_id=${literal(f.companyId)} AND source_message_id=${literal(originalId)}`)).toEqual(bindings)
    expect(request(f, o)).toMatchObject({ status: 'ready_for_switch', response_ediel_message_id: business.id })
    expect(nonActivation(f)).toEqual(before); expect(sealedOriginal(originalId)).toEqual(sealed)
    expect(otherWatches(originalId)).toEqual(foreign)
    expect((await getEdielMessageById(originalId, { companyId: f.companyId }))?.contrl_status).toBe('received')
  })

  it.each(requiredFields)('fresh outgoing omission %s reaches its own causal refusal and cannot persist an original or business effect', async field => {
    const f = await createZ01SupplierNativeFixture(variant, provider)
    vi.stubEnv('GRIDEX_AUTOMATION_USER_ID', f.actorUserId)
    const result = await exerciseZ01SupplierOutboundField(f, field)
    const diagnostic = JSON.stringify({ field, phase: result.phase, diagnostics: result.diagnostics,
      finalizerError: result.finalizerError, causalRefusal: result.causalRefusal })
    expect(result.positiveValidation.ok, diagnostic).toBe(true)
    expect(result.negativeValidation.ok, diagnostic).toBe(false)
    expect(result.rawOmitted, diagnostic).not.toBe(result.rawOriginal)
    expect(result.sameBoundSource, diagnostic).toBe(true)
    expect(result.noOriginal, diagnostic).toBe(true); expect(result.noBusinessEffects, diagnostic).toBe(true)
    expect(result.originalId, diagnostic).toBeNull(); expect(result.after, diagnostic).toEqual(result.before)
    expect(['target_field_rejected', 'source_bound_field_refused', 'causal_field_refused'], diagnostic).toContain(result.phase)
    expect(result.finalizerError, diagnostic).not.toBeNull()
    if (result.phase === 'causal_field_refused') {
      expect(result.causalRefusal?.proof).toMatchObject({ field, objectId: f.external, identityAgency: '9',
        positiveValidationAccepted: true, sameBoundSource: true, noOriginal: true, noBusinessEffects: true })
    } else if (result.phase === 'target_field_rejected') {
      const target = result.diagnostics.find(issue => issue.blocking && issue.fieldNumber === field)
      expect(target, diagnostic).toBeDefined()
      expect(result.finalizerError).toContain(`${target!.code} - ${target!.description}`)
    } else {
      expect(['227', '228', '229', '231', '232', '316']).toContain(field)
      const source = result.diagnostics.find(issue => issue.blocking && issue.code === 'PRODAT_CUSTOMER_MASTERDATA_SOURCE_UNQUALIFIED')
      expect(source, diagnostic).toBeDefined()
      expect(result.finalizerError).toContain(`${source!.code} - ${source!.description}`)
    }
  })

  it('omitting the optional installation parent is accepted without inventing child-field applicability or effects', async () => {
    const f = await createZ01SupplierNativeFixture(variant, provider)
    vi.stubEnv('GRIDEX_AUTOMATION_USER_ID', f.actorUserId)
    const result = await exerciseZ01SupplierOutboundField(f, 'INSTALLATION_GROUP')
    expect(result.positiveValidation.ok, JSON.stringify(result.diagnostics)).toBe(true)
    expect(result.negativeValidation.ok, JSON.stringify(result.diagnostics)).toBe(true)
    expect(result.phase).toBe('optional_parent_accepted')
    expect(result.noOriginal).toBe(true); expect(result.noBusinessEffects).toBe(true)
    expect(result.finalizerError).toBeNull(); expect(result.after).toEqual(result.before)
  })
})
