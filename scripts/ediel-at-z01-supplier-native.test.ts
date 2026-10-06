// Whole-contract candidates remain unapproved until authentic native evidence
// and independent literal review. No private accepted facts are fixture inputs.
// SMTP and counterparties are explicitly synthetic external ports.
import {createHash, randomUUID} from 'node:crypto'
import {afterEach, beforeEach, describe, expect, it, vi} from 'vitest'
import {getEdielMessageById} from '@/lib/ediel/db'
import {archiveCustomerAuthorizationDocument} from '@/lib/operations/db'
import {enqueueCustomerDataRequestAutomation} from '@/lib/customer-operations/automation'
import {readEdielBusinessExpectations} from '@/lib/ediel/businessExpectations'
import {processInboundEdielMessage} from '@/lib/ediel/flows/inboundProcessing'
import {resolveCanonicalRuntimeDecisionWithRegistry} from '@/lib/ediel/core/runtimeDecision'
import {prepareAndQueueEdielZ03} from '@/lib/ediel/flows/prodatSwitch'
import {PRODAT_APERAK_APPLICATION_TEXTS} from '@/lib/ediel/prodat/prodatAperakText'
import {prodatNowDate203} from '@/lib/ediel/prodat/render/dates'
import {segmentComposite, segmentElementCount, tokenizeEdifact} from '@/lib/ediel/core/edifactTokenizer'
import {EdifactEnvelopeCodec} from '@/lib/ediel/core/edifactEnvelopeCodec'
import {originalAckLegalNadSegment} from '@/lib/ediel/core/originalAckPartyIdentities'
import {nativeSql as sql, literal, seedNormalSwitchNativeFixture, futureNativeSupplyDate} from './helpers/ediel-normal-switch-native-fixture'
import {createZ01SupplierNativeFixture, originateZ01SupplierRequest, receiveZ01SupplierReply, exerciseZ01SupplierOutboundField} from './helpers/ediel-z01-info-request-native-fixture'
import {externalZ01Aperak, externalZ01Contrl, externalZ02Reply, type ExternalZ02Overrides} from './helpers/ediel-z01-info-request-native-wire'
import {createBilateralSourceOperator} from './helpers/ediel-bilateral-customer-native-fixture'

const external = vi.hoisted(() => ({send: vi.fn()}))
vi.mock('nodemailer', () => ({default: {createTransport: () => ({sendMail: external.send})}}))
beforeEach(() => {
  vi.stubEnv('EDIEL_SHARED_MAILBOX_ADDRESS', 'synthetic@example.invalid')
  vi.stubEnv('EDIEL_APP_DKIM_ENABLED', 'false')
  vi.stubEnv('EMAIL_PROVIDER', 'resend'); vi.stubEnv('EDIEL_EMAIL_PROVIDER', 'strato')
  vi.stubEnv('EDIEL_SMTP_FROM', 'synthetic@example.invalid'); vi.stubEnv('EDIEL_SMTP_USER', 'synthetic@example.invalid')
  vi.stubEnv('EDIEL_SMTP_PASS', 'synthetic-only'); external.send.mockReset()
  vi.stubEnv('GRIDEX_CUSTOMER_DATA_EDIEL_ENVIRONMENT', 'test')
})
afterEach(() => {vi.unstubAllEnvs(); vi.restoreAllMocks()})
const provider = (email: string) => external.send.mockResolvedValue({accepted: [email], rejected: [],
  messageId: `<synthetic-${randomUUID()}@example.invalid>`, response: '250 explicitly synthetic SMTP acceptance'})
type Fixture = Awaited<ReturnType<typeof createZ01SupplierNativeFixture>>
type Original = Awaited<ReturnType<typeof originateZ01SupplierRequest>>
const sha = (raw: string) => createHash('sha256').update(raw, 'utf8').digest('hex')
const minute = () => prodatNowDate203()
const references = () => ({interchangeReference: randomUUID().replaceAll('-', '').slice(0, 14),
  messageReference: randomUUID().replaceAll('-', '').slice(0, 14)})
async function sent(variant: 'L' | 'LK') {
  const f = await createZ01SupplierNativeFixture(variant, provider)
  vi.stubEnv('GRIDEX_AUTOMATION_USER_ID', f.actorUserId)
  return {f, original: await originateZ01SupplierRequest(f)}
}
function source(original: Original) {return {rawPayload: original.originalZ01.raw_payload!}}
function z02(f: Fixture, original: Original, overrides: ExternalZ02Overrides = {}, omitMethod = false) {
  return externalZ02Reply({source: source(original), ...references(), documentReference: `Z02-${randomUUID().slice(0, 8)}`,
    documentMinute: minute(), measurementMethod: 'Z04', customerAddress: f.customerAddress,
    installationAddress: f.installationAddress, overrides, omitFields: omitMethod ? ['217'] : []})
}
function sealedSource(id: string) {
  return sql(`SELECT jsonb_build_object('raw',raw_payload,'hash',immutable_payload_hash,
    'renderedAt',immutable_rendered_at,'direction',direction,'company',company_id,'environment',environment,
    'original',(SELECT to_jsonb(s) FROM gridex_received_sources.sources s WHERE s.source_message_id=m.id))
    FROM public.ediel_messages m WHERE m.id=${literal(id)}`)
}
function activation(f: {companyId: string}) {
  // Z01, acknowledgements and Z02 are information processing, not supply start.
  return sql(`SELECT jsonb_build_object(
    'periods',(SELECT coalesce(jsonb_agg(to_jsonb(p) ORDER BY p.id),'[]'::jsonb) FROM public.customer_supply_periods p WHERE p.company_id=${literal(f.companyId)}),
    'contracts',(SELECT coalesce(jsonb_agg(jsonb_build_object('id',c.id,'status',c.status,'starts_at',c.starts_at) ORDER BY c.id),'[]'::jsonb) FROM public.customer_contracts c WHERE c.company_id=${literal(f.companyId)}),
    'switches',(SELECT coalesce(jsonb_agg(jsonb_build_object('id',r.id,'status',r.status,'confirmed',r.confirmed_start_date) ORDER BY r.id),'[]'::jsonb) FROM public.supplier_switch_requests r WHERE r.company_id=${literal(f.companyId)}));`)
}
function customerState(f: Fixture) {
  return sql(`SELECT jsonb_build_object(
    'customers',(SELECT coalesce(jsonb_agg(to_jsonb(c) ORDER BY c.id),'[]'::jsonb) FROM public.customers c WHERE c.company_id=${literal(f.companyId)}),
    'sites',(SELECT coalesce(jsonb_agg(to_jsonb(s) ORDER BY s.id),'[]'::jsonb) FROM public.customer_sites s WHERE s.company_id=${literal(f.companyId)}),
    'points',(SELECT coalesce(jsonb_agg(to_jsonb(p) ORDER BY p.id),'[]'::jsonb) FROM public.metering_points p WHERE p.company_id=${literal(f.companyId)}),
    'activation',${literal(activation(f))}::jsonb);`)
}
function ownRequest(f: Fixture, original: Original) {
  return sql<{id: string; status: string; response_ediel_message_id: string | null}>(`SELECT to_jsonb(c)
    FROM public.customer_info_requests c WHERE c.id=${literal(original.requestId)} AND c.company_id=${literal(f.companyId)}`)
}
function ownSource(f: Fixture, original: Original) {
  return sql<{id: string; contrl_status: string | null; aperak_status: string | null; status: string;
    message_sent_at: string | null; ack_due_at: string | null; contrl_due_at: string | null; business_response_due_at: string | null}>(
    `SELECT to_jsonb(m) FROM public.ediel_messages m WHERE m.id=${literal(original.originalZ01.id)} AND m.company_id=${literal(f.companyId)}`)
}
async function watches(f: Fixture, original: Original) {
  return readEdielBusinessExpectations({companyId: f.companyId, environment: 'test', actorUserId: f.actorUserId,
    messageId: original.originalZ01.id})
}
function coreApplications(f: Fixture, requestId: string) {
  return sql<number>(`SELECT to_jsonb(count(*)) FROM gridex_received_sources.z02_core_applications
    WHERE company_id=${literal(f.companyId)} AND request_id=${literal(requestId)}`)
}
const protectedUdSlots: Readonly<Record<string, number>> = {'227': 2, '228': 4, '229': 5, '231': 8, '232': 6, '316': 9}
function assertOnlyOwnUdFieldOmitted(rawOriginal: string, rawOmitted: string, field: string) {
  // Independent tokenizer observation of the physical change. The fixture's
  // omission implementation and the projection's applicability flags cannot
  // assert this witness for themselves.
  const original = tokenizeEdifact(rawOriginal), omitted = tokenizeEdifact(rawOmitted), slot = protectedUdSlots[field]
  expect(slot).toBeDefined(); expect(omitted.una).toEqual(original.una)
  const decode = (wire: ReturnType<typeof tokenizeEdifact>) => wire.segments.filter(s => s.tag !== 'UNT')
    .map(s => Array.from({length: segmentElementCount(s, wire.una) + 1}, (_, index) => segmentComposite(s, index, wire.una)))
  const expected = decode(original), actual = decode(omitted)
  const endUsers = expected.filter(elements => elements[0][0] === 'NAD' && elements[1][0] === 'UD')
  expect(endUsers).toHaveLength(1)
  if (field === '227') {
    expect(endUsers[0][slot][0]).not.toBe(''); endUsers[0][slot][0] = ''
  } else {
    expect(endUsers[0][slot].some(value => value !== '')).toBe(true); endUsers[0][slot] = ['']
  }
  expect(actual).toEqual(expected)
}

describe.each(['L', 'LK'] as const)('actual SUPPLIER Z01%s information chain', variant => {
  it('normal operation, immutable DDQ source, SMTP projection and parallel watches never activate supply', async () => {
    const f = await createZ01SupplierNativeFixture(variant, provider), before = activation(f)
    vi.stubEnv('GRIDEX_AUTOMATION_USER_ID', f.actorUserId)
    const original = await originateZ01SupplierRequest(f), m = ownSource(f, original)
    expect(original.sendResult.status).toBe('sent')
    expect(original.wire).toMatchObject({subtype: variant, reason: variant === 'L' ? 'Z22' : 'Z23', point: f.external,
      customerIdentity: f.customerIdentity, gridAreaCode: f.gridAreaCode})
    expect(original.wire.envelope.applicationReference).toBe('23-DDQ-PRODAT')
    expect(original.wire.agreedStartMinute.slice(0, 8)).toBe(f.requestedStartDate.replaceAll('-', ''))
    expect(original.originalZ01).toMatchObject({direction: 'outbound', environment: 'test', message_family: 'PRODAT', message_code: 'Z01'})
    expect(original.originalZ01).toMatchObject({immutable_payload_hash: sha(original.originalZ01.raw_payload!)})
    expect(ownRequest(f, original)).toMatchObject({id: original.requestId, status: 'waiting_for_z02', response_ediel_message_id: null})
    expect(m.message_sent_at).not.toBeNull(); expect(m.ack_due_at).not.toBeNull(); expect(m.business_response_due_at).not.toBeNull()
    const accepted = sql<{observedAt: string; plan: {offset: number; unit: string; anchor: string}}>(`SELECT
      jsonb_build_object('observedAt',observed_at,'plan',binding->'technicalExpectationPlan')
      FROM gridex_ediel_transport.attempts WHERE company_id=${literal(f.companyId)} AND message_id=${literal(original.originalZ01.id)}
      AND classification='accepted' ORDER BY observed_at,id LIMIT 1`)
    expect(accepted.plan).toMatchObject({unit: 'minutes', anchor: 'actual_accepted_smtp_observed_at'})
    expect(accepted.plan.offset).toBeGreaterThan(0)
    expect(Date.parse(m.message_sent_at!)).toBe(Date.parse(accepted.observedAt))
    expect(Date.parse(m.ack_due_at!)).toBe(Date.parse(accepted.observedAt) + accepted.plan.offset * 60000)
    expect(Date.parse(m.contrl_due_at!)).toBe(Date.parse(m.ack_due_at!))
    const pending = await watches(f, original)
    expect(pending).toHaveLength(1); expect(pending[0]).toMatchObject({source_message_id: original.originalZ01.id, expected_code: 'Z02', status: 'pending'})
    expect(Date.parse(String(pending[0].metadata.anchorAt))).toBe(Date.parse(m.message_sent_at!))
    expect(pending[0].due_at).toBe(m.business_response_due_at)
    expect(coreApplications(f, original.requestId)).toBe(0); expect(activation(f)).toEqual(before)
  })

  it('physical CONTRL then genuine own Z02 apply without any positive APERAK or supply activation', async () => {
    const {f, original} = await sent(variant), before = activation(f), originalBytes = sealedSource(original.originalZ01.id)
    const technical = await receiveZ01SupplierReply(f, externalZ01Contrl({source: source(original), ...references()}))
    expect(technical.id).toBeTruthy(); expect(ownSource(f, original).contrl_status).toBe('received')
    expect(ownRequest(f, original).status).toBe('waiting_for_z02'); expect((await watches(f, original))[0].status).toBe('pending')
    const received = await receiveZ01SupplierReply(f, z02(f, original))
    expect(received.id).toBeTruthy()
    expect(ownRequest(f, original)).toMatchObject({status: 'ready_for_switch', response_ediel_message_id: received.id})
    expect(coreApplications(f, original.requestId)).toBe(1)
    expect((await watches(f, original))[0].status).toBe('fulfilled')
    expect(ownSource(f, original).aperak_status).not.toBe('received')
    expect(sql(`SELECT to_jsonb(count(*)) FROM public.ediel_inbound_cases WHERE ediel_message_id=${literal(received.id)}`)).toBe(1)
    expect(activation(f)).toEqual(before); expect(sealedSource(original.originalZ01.id)).toEqual(originalBytes)
    const applied = customerState(f), frozenReceived = sealedSource(received.id)
    await processInboundEdielMessage({actorUserId: f.actorUserId, edielMessageId: received.id})
    expect(coreApplications(f, original.requestId)).toBe(1); expect(customerState(f)).toEqual(applied)
    expect(sealedSource(received.id)).toEqual(frozenReceived); expect(sealedSource(original.originalZ01.id)).toEqual(originalBytes)
  })

  it('requested AB permits positive APERAK without fulfilling the separate Z02 watch', async () => {
    const {f, original} = await sent(variant), before = customerState(f), sealed = sealedSource(original.originalZ01.id)
    expect(original.originalZ01.raw_payload).toContain('+9+AB')
    await receiveZ01SupplierReply(f, externalZ01Aperak({source: source(original), ...references(), outcome: 'positive', documentMinute: minute()}))
    expect(ownSource(f, original).aperak_status).toBe('received')
    expect(ownRequest(f, original).status).toBe('waiting_for_z02'); expect((await watches(f, original))[0].status).toBe('pending')
    expect(coreApplications(f, original.requestId)).toBe(0); expect(customerState(f)).toEqual(before)
    expect(sealedSource(original.originalZ01.id)).toEqual(sealed)
  })

  it('actual negative object APERAK records the own rejected LI and cannot produce a Z02 application or supply', async () => {
    const {f, original} = await sent(variant), before = customerState(f)
    const received = await receiveZ01SupplierReply(f, externalZ01Aperak({source: source(original), ...references(), outcome: 'negative',
      documentMinute: minute(), error: {ercCode: '40', fieldCode: '107', text: PRODAT_APERAK_APPLICATION_TEXTS['107']}}))
    expect(ownSource(f, original).aperak_status).toBe('received')
    expect(sql(`SELECT coalesce(jsonb_agg(jsonb_build_object('ack',ack_message_id,'family',ack_family,'scope',ack_scope,
      'reference',transaction_reference,'outcome',outcome) ORDER BY id),'[]'::jsonb)
      FROM public.ediel_ack_chains WHERE company_id=${literal(f.companyId)} AND source_message_id=${literal(original.originalZ01.id)}`))
      .toEqual([{ack: received.id, family: 'APERAK', scope: 'object', reference: original.wire.lineReference, outcome: 'negative'}])
    expect(coreApplications(f, original.requestId)).toBe(0); expect(ownRequest(f, original).response_ediel_message_id).toBeNull()
    expect(customerState(f)).toEqual(before)
  })

  it.each([
    ['own LI', {lineReference: 'UNRELATED-Z01-OWN-LI'}],
    ['legal sender', {legalSender: '99999'}],
    ['legal receiver', {legalReceiver: '99999'}],
    ['transport sender', {transportSender: '99999'}],
    ['transport receiver', {transportReceiver: '99999'}],
    ['customer identity', {customerIdentity: {id: '198001011234', qualifier: 'SE2', agency: '260'}}],
  ] as const)('actual Z02 with wrong %s cannot borrow the sent source, alter customer state or activate supply', async (_label, override) => {
    const {f, original} = await sent(variant), before = customerState(f), sealed = sealedSource(original.originalZ01.id)
    // Every candidate starts from a genuinely sent original. A failed producer
    // stops this test; unrelated earlier refusal never counts as target proof.
    await receiveZ01SupplierReply(f, z02(f, original, override))
    expect(coreApplications(f, original.requestId)).toBe(0)
    expect(ownRequest(f, original).response_ediel_message_id).toBeNull()
    expect(customerState(f)).toEqual(before); expect(sealedSource(original.originalZ01.id)).toEqual(sealed)
  })

  it('actual inbound Z02 missing mandatory 217 cannot apply any information or activate supply', async () => {
    const {f, original} = await sent(variant), before = customerState(f)
    const received = await receiveZ01SupplierReply(f, z02(f, original, {}, true))
    const decision = await resolveCanonicalRuntimeDecisionWithRegistry(received.message)
    expect(decision.issues.some(issue => issue.prodatDiagnostic?.kind === 'field'
      && issue.prodatDiagnostic.fieldNumber === '217' && issue.prodatDiagnostic.errorKind === 'missing'), JSON.stringify(decision.issues)).toBe(true)
    expect(coreApplications(f, original.requestId)).toBe(0)
    expect(ownRequest(f, original).response_ediel_message_id).toBeNull(); expect(customerState(f)).toEqual(before)
  })

  it('full source-derived Z01 in the prohibited inbound SUPPLIER direction cannot execute customer or supply effects', async () => {
    const {f, original} = await sent(variant), before = customerState(f), wire = tokenizeEdifact(original.originalZ01.raw_payload!)
    const envelope = original.wire.envelope, parties = original.wire.parties
    const body = wire.segments.filter(segment => !['UNB', 'UNH', 'UNT', 'UNZ'].includes(segment.tag)).map(segment => {
      if (segment.tag === 'NAD' && segmentComposite(segment, 1, wire.una)[0] === 'FR') return originalAckLegalNadSegment('FR', parties.legalReceiver)
      if (segment.tag === 'NAD' && segmentComposite(segment, 1, wire.una)[0] === 'DO') return originalAckLegalNadSegment('DO', parties.legalSender)
      return segment.raw
    })
    const raw = EdifactEnvelopeCodec.encode({sender: envelope.receiver!, receiver: envelope.sender!,
      senderQualifier: envelope.receiverQualifier, receiverQualifier: envelope.senderQualifier,
      senderSubAddress: envelope.receiverSubAddress, receiverSubAddress: envelope.senderSubAddress,
      applicationReference: envelope.applicationReference, environment: 'test', acknowledgementRequest: true,
      ...references(), messages: [{messageReference: references().messageReference,
        messageTypeToken: original.wire.messageTypeToken, businessSegments: body}]})
    const received = await receiveZ01SupplierReply(f, raw), decision = await resolveCanonicalRuntimeDecisionWithRegistry(received.message)
    expect(decision.syntaxDecision).toBe('accepted')
    expect(decision.issues.some(issue => issue.code === 'PRODAT_CANONICAL_DIRECTION_NOT_ALLOWED'
      || issue.description.startsWith('canonical_source_direction_not_allowed:')), JSON.stringify(decision.issues)).toBe(true)
    expect(coreApplications(f, original.requestId)).toBe(0)
    expect(customerState(f)).toEqual(before)
  })

  it('native immutable original rejects raw-byte mutation and preserves all customer state', async () => {
    const {f, original} = await sent(variant), before = customerState(f), sealed = sealedSource(original.originalZ01.id)
    const changed = original.originalZ01.raw_payload!.replace('BGM+Z01', 'BGM+Z02')
    expect(changed).not.toBe(original.originalZ01.raw_payload)
    expect(() => sql(`UPDATE public.ediel_messages SET raw_payload=${literal(changed)} WHERE id=${literal(original.originalZ01.id)}`))
      .toThrow(/immutable|original|sealed/)
    expect(customerState(f)).toEqual(before); expect(sealedSource(original.originalZ01.id)).toEqual(sealed)
  })

  it('current acting SUPPLIER role revocation refuses fresh Z01 origination rather than using old authority', async () => {
    const f = await createZ01SupplierNativeFixture(variant, provider), before = customerState(f)
    vi.stubEnv('GRIDEX_AUTOMATION_USER_ID', f.actorUserId)
    sql(`UPDATE public.tenant_actor_roles SET valid_to=clock_timestamp() WHERE company_id=${literal(f.companyId)} AND environment='test' AND actor_id=${literal(f.actorUserId)} AND role_code='electricity_supplier'`)
    await expect(originateZ01SupplierRequest(f)).rejects.toThrow(/tenant_market_roles_missing/)
    expect(sql(`SELECT to_jsonb(count(*)) FROM public.ediel_messages WHERE company_id=${literal(f.companyId)} AND direction='outbound'`)).toBe(0)
    expect(external.send).not.toHaveBeenCalled(); expect(customerState(f)).toEqual(before)
  })

  it('public authorization-document archive and linked POA revocation refuse a fresh information request', async () => {
    const f = await createZ01SupplierNativeFixture(variant, provider)
    const operator = await createBilateralSourceOperator(f.companyId, ['customers.read', 'customers.write', 'operations.read', 'operations.write'])
    const revoked = await archiveCustomerAuthorizationDocument(operator.client, {documentId: f.authorizationDocumentId,
      reason: 'Synthetic current-authority refusal control', revokeLinkedPowerOfAttorney: true})
    expect(revoked.documentAfter.status).toBe('archived'); expect(revoked.revokedPowerOfAttorney?.status).toBe('revoked')
    const before = customerState(f)
    vi.stubEnv('GRIDEX_AUTOMATION_USER_ID', f.actorUserId)
    await expect(originateZ01SupplierRequest(f)).rejects.toThrow(/authorization|fullmakt|scope|Fullmakt/)
    expect(sql(`SELECT to_jsonb(count(*)) FROM public.ediel_messages WHERE company_id=${literal(f.companyId)} AND direction='outbound'`)).toBe(0)
    expect(external.send).not.toHaveBeenCalled(); expect(customerState(f)).toEqual(before)
  })

  it('real duplicate enqueue retains one operation, source and physical send', async () => {
    const {f, original} = await sent(variant), before = customerState(f), sealed = sealedSource(original.originalZ01.id)
    const calls = external.send.mock.calls.length
    const duplicate = await enqueueCustomerDataRequestAutomation({companyId: f.companyId, customerId: f.customerId,
      siteId: f.siteId, meteringPointId: f.pointId, actorUserId: f.actorUserId, source: 'synthetic_z01_native_retry'})
    expect(duplicate).toMatchObject({id: original.jobId, operationId: original.operationId, duplicate: true})
    expect(sql(`SELECT to_jsonb(count(*)) FROM public.ediel_messages WHERE company_id=${literal(f.companyId)} AND message_code='Z01'`)).toBe(1)
    expect(external.send.mock.calls.length).toBe(calls); expect(customerState(f)).toEqual(before)
    expect(sealedSource(original.originalZ01.id)).toEqual(sealed)
  })

  it('actual foreign tenant selection and actor cannot read or process the own immutable original', async () => {
    const {f, original} = await sent(variant), foreign = await createZ01SupplierNativeFixture(variant, provider)
    const before = customerState(f), foreignBefore = customerState(foreign), sealed = sealedSource(original.originalZ01.id)
    expect(await getEdielMessageById(original.originalZ01.id, {companyId: foreign.companyId})).toBeNull()
    const received = await receiveZ01SupplierReply(f, z02(f, original))
    // Establish a real own received source before attempting a different
    // company's current actor. First application and resulting state are frozen.
    const applied = customerState(f), applications = coreApplications(f, original.requestId)
    expect(applications).toBe(1)
    await expect(processInboundEdielMessage({actorUserId: foreign.actorUserId, edielMessageId: received.id}))
      .rejects.toThrow(/ediel_tenant_actor_forbidden|company_permission_required|company_membership/)
    expect(customerState(f)).toEqual(applied); expect(coreApplications(f, original.requestId)).toBe(applications)
    expect(customerState(foreign)).toEqual(foreignBefore); expect(sealedSource(original.originalZ01.id)).toEqual(sealed)
    expect(activation(f)).toEqual((before as {activation: unknown}).activation)
  })
})

it('already-correct supplier data can actually originate Z03 without any Z01 or positive APERAK gate', async () => {
  const f = await seedNormalSwitchNativeFixture({deferOriginal: true, requestedStartDate: futureNativeSupplyDate()})
  const before = activation(f)
  const original = await prepareAndQueueEdielZ03({actorUserId: f.actorUserId, switchRequestId: f.switchId,
    communicationRouteId: f.routeId, environment: 'test'})
  expect(original).toMatchObject({direction: 'outbound', message_code: 'Z03', company_id: f.companyId})
  expect(original).toMatchObject({immutable_payload_hash: sha(original.raw_payload!)})
  expect(sql(`SELECT to_jsonb(count(*)) FROM public.ediel_messages WHERE company_id=${literal(f.companyId)} AND message_code IN('Z01','APERAK')`)).toBe(0)
  expect(sql(`SELECT to_jsonb(count(*)) FROM public.customer_info_requests WHERE company_id=${literal(f.companyId)}`)).toBe(0)
  expect(activation(f)).toEqual(before); expect(external.send).not.toHaveBeenCalled()
})

// Run fresh before-original probes after the ordinary information chain.
// Their real queued operations are left genuine; no fake completion is seeded.
describe.each(['L', 'LK'] as const)('actual outbound Z01%s R/D refusal', variant => {
  it.each(['311', '312', '202', '203', '205', '206', '207', '208', '314', '209', '210', '223', '260', '261', '226',
    'END_USER_GROUP', '227', '228', '231', '232', '316', '229', '233', '234'] as const)(
    'fresh actual outbound finalizer refuses absent required/dependent %s without an original or effect', async field => {
      const f = await createZ01SupplierNativeFixture(variant, provider)
      const result = await exerciseZ01SupplierOutboundField(f, field)
      if (result.phase === 'source_bound_field_refused') {
        expect(Object.hasOwn(protectedUdSlots, field)).toBe(true)
        assertOnlyOwnUdFieldOmitted(result.rawOriginal, result.rawOmitted, field)
        expect(result.finalizerError).toContain('PRODAT_CUSTOMER_MASTERDATA_SOURCE_UNQUALIFIED')
      } else {
        // Other source/evidence/duplicate precedence remains honest RED.
        expect(result.phase, JSON.stringify(result)).toBe('target_field_rejected')
      }
      expect(result.positiveValidation?.ok).toBe(true)
      expect(result.noOriginal).toBe(true); expect(result.noBusinessEffects).toBe(true)
      expect(result.after).toEqual(result.before); expect(external.send).not.toHaveBeenCalled()
    })

  it('the actual validator accepts absent optional installation parent without inventing required IT children', async () => {
    const f = await createZ01SupplierNativeFixture(variant, provider)
    const result = await exerciseZ01SupplierOutboundField(f, 'INSTALLATION_GROUP')
    expect(result.phase, JSON.stringify(result)).toBe('optional_parent_accepted')
    expect(result.positiveValidation?.ok).toBe(true)
    expect(result.noBusinessEffects).toBe(true); expect(external.send).not.toHaveBeenCalled()
  })

})
