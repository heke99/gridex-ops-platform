// Executable H proposals, NOT whole acceptance. Synthetic issuer configuration
// and counterparty/SMTP ports are GIVEN; archive, review, original, mail birth,
// current capability, kernel, effect receipts and ACK originals are real.
// A blocked producer/birth fails its case; later assertions are NOT REACHED.
// Z08H legal rescission and ordinary L/LK timers are separate contracts.
import { createHash, createHmac, randomUUID } from 'node:crypto'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { SupabaseClient } from '@supabase/supabase-js'
import { nationalRescissionNativeChain } from './helpers/nationalRescissionNative'
import { assertInvalid306NativeContract } from './helpers/ediel-h-invalid306-native-assertions'
import { createHNativeSourceInspection } from './helpers/ediel-h-native-source-inspection'
import { observeAckTransportRpcErrors } from './helpers/ediel-h-ack-rpc-observation-native'
import { nativeSql as sql, literal } from './helpers/ediel-normal-switch-native-fixture'
import { seedOriginalMailboxNative } from './helpers/originalMailboxNative'
import { assertEdielSmtpReadiness } from '@/lib/ediel/mailReadiness'
import { createBilateralProdatGroundNativeFixture } from './helpers/ediel-bilateral-prodat-profile-native-fixture'
import { archiveBilateralProdatGround, readBilateralProdatGroundBytes, readBilateralProdatGroundScope, readBilateralProdatGroundArtifact, reviewBilateralProdatGround } from '@/lib/ediel/production/bilateralProdatProfileIntake'
import { qualifyPersistedBilateralProdatOutboundOriginal } from '@/lib/ediel/production/bilateralProdatOutboundDraft'
import { readSourceQualifiedProdatBilateralCapability } from '@/lib/ediel/core/prodatBilateralSourceCapability'
import { buildContrlDraft, buildAperakDraft } from '@/lib/ediel/ack'
import { readCommittedInboundAck } from '@/lib/ediel/ack/committedInboundAck'
import { readPersistedEdielTechnicalContrlBasis } from '@/lib/ediel/ack/technicalSyntaxAuthority'
import { readAcceptedEdielTransportProjection } from '@/lib/ediel/transport/acceptedProjection'
import { getEdielMessageById } from '@/lib/ediel/db'
import { sendEdielMessageViaSmtp } from '@/lib/ediel/transport'
import { sendOutboxItem } from '@/lib/ediel/outbox/sendOutboxItem'
import { listBusinessAckMessagesForSource } from '@/lib/ediel/inbound/businessAckMessages'
import { processInboundEdielMessage } from '@/lib/ediel/flows/inboundProcessing'
import { resolveCanonicalRuntimeDecisionWithRegistry } from '@/lib/ediel/core/runtimeDecision'
import { validateCanonicalPolicyFields } from '@/lib/ediel/rulebook/canonicalPolicyFieldValidator'
import { validateRulebookMessageWithRegistry } from '@/lib/ediel/rulebook/validator'
import { EdifactEnvelopeCodec } from '@/lib/ediel/core/edifactEnvelopeCodec'
import { validateEdifactSyntax } from '@/lib/ediel/core/syntaxValidator'
import { segmentComposite, segmentElementCount, tokenizeEdifact } from '@/lib/ediel/core/edifactTokenizer'
import { originalAckPartyIdentities, originalAckLegalNadSegment } from '@/lib/ediel/core/originalAckPartyIdentities'
import { prodatRegisterGroups } from '@/lib/ediel/prodat/prodatRegisterGroups'
import { prodatRegisterReadingState } from '@/lib/ediel/prodat/prodatRegisterReadings'
import { matchMeteringPointForInbound, matchOutboundRequestForInbound } from '@/lib/inbound-mail/inboundMatcher'
import { inboundLegalReceiverEdielId, resolveInboundTenantFromIdentifiers } from '@/lib/ediel/tenant/resolveInboundTenant'
import { createInboundEdielMessage } from '@/lib/inbound-mail/inboundStatusUpdater'
import { supabaseService } from '@/lib/supabase/service'
import { prepareAndQueueEdielZ03 } from '@/lib/ediel/flows/prodatSwitch'
import { EDIEL_ACK_DEADLINE_MINUTES } from '@/lib/ediel/specRegistry'
import { createCanonicalOutboundMessage } from '@/lib/ediel/core/kernel'
import { loadCustomerMasterdataValidationContext, prepareCustomerMasterdataSource } from '@/lib/ediel/production/customerMasterdataSource'
import { applyCustomerSiteAddressCandidate } from '@/lib/customer-sites/addressIntake'
import { qualifyBilateralProdatSwitchPreparation } from '@/lib/ediel/production/bilateralProdatSwitchPreparation'
import { updateSupplierSwitchValidationSnapshot } from '@/lib/operations/db'
import { resolveBilateralSwitchBirthProfile } from '@/lib/inbound-mail/bilateralSwitchBirthProfile'
import { stockholmBusinessDate } from '@/lib/ediel/core/executionContext'
import { resolveCanonicalTenantEdielIdentityWithEvidence } from '@/lib/ediel/tenant/tenantEdielIdentity'
import { readRegistryDispatchSource } from '@/lib/actor-registry/registryMarketSource'
import { guideOrderedFixtureBody } from '../__tests__/helpers/prodatGuideOrderedFixture'
import { characteristic, common, line, qty, type Parts } from '../__tests__/fixtures/prodat-register'

const smtp = vi.hoisted(() => ({ send: vi.fn() }))
vi.mock('nodemailer', () => ({ default: { createTransport: () => ({ sendMail: smtp.send }) } }))
const sourceSession: { client: SupabaseClient | null } = { client: null }
// Intentionally never call receivedHStart or the national rescission methods:
// their direct catalog/source insertion is not a public H birth witness.
const { stage: prospective, authorized, originate } = nationalRescissionNativeChain({ provider: smtp.send, sourceSession })
type Fixture = Awaited<ReturnType<typeof authorized>>
type Original = Awaited<ReturnType<typeof originate>>
type Row = Record<string, unknown>
const digest = (value: string) => createHash('sha256').update(value, 'utf8').digest('hex')
const references = () => ({ interchange: randomUUID().replaceAll('-', '').slice(0, 14),
  message: randomUUID().replaceAll('-', '').slice(0, 14), document: randomUUID().replaceAll('-', '').slice(0, 14), createdAt: new Date() })
const { record, rows, business, sealed, durable, effectFailureDiagnostic } =
  createHNativeSourceInspection<Fixture, Original>(smtp)
beforeEach(() => {
  for (const [key, value] of Object.entries({ EDIEL_SHARED_MAILBOX_ADDRESS: 'synthetic@example.invalid',
    EDIEL_APP_DKIM_ENABLED: 'false', EMAIL_PROVIDER: 'resend', EDIEL_EMAIL_PROVIDER: 'strato',
    EDIEL_SMTP_FROM: 'synthetic@example.invalid', EDIEL_SMTP_USER: 'synthetic@example.invalid', EDIEL_SMTP_PASS: 'synthetic-only' })) vi.stubEnv(key, value)
  smtp.send.mockReset()
  smtp.send.mockImplementation(async () => ({ accepted: ['recipient@example.invalid'], rejected: [],
    messageId: `<synthetic-${randomUUID()}@example.invalid>`, response: '250 explicitly synthetic SMTP acceptance' }))
})
afterEach(() => { vi.unstubAllEnvs(); vi.restoreAllMocks() })

function assertFirstHBusinessDelta(f: Fixture, original: Original, sourceId: string, raw: string,
  before: ReturnType<typeof business>, after: ReturnType<typeof business>, startedAt: number, completedAt: number) {
  for (const key of ['customers', 'sites', 'points', 'contracts', 'permissions', 'activations'] as const)
    expect(after[key], key).toEqual(before[key])
  for (const key of ['periods', 'confirmations', 'transitions', 'bilateral'] as const) {
    expect(after[key], key).toHaveLength(before[key].length + 1)
    expect(after[key], key).toEqual(expect.arrayContaining(before[key]))
    expect(before[key].filter(r => r.source_message_id === sourceId), key).toEqual([])
    expect(after[key].filter(r => r.source_message_id === sourceId), key).toHaveLength(1)
  }
  const period = after.periods.find(r => r.source_message_id === sourceId)!
  expect(period).toMatchObject({ company_id: f.companyId, source_message_id: sourceId,
    source_switch_request_id: f.switchId, customer_id: f.customerId, metering_point_id: f.pointId,
    contract_id: f.contractId, start_date: f.requestedStartDate, status: 'confirmed_by_grid_owner', market_state_version: 1 })
  expect(after.confirmations.find(r => r.source_message_id === sourceId)).toMatchObject({ company_id: f.companyId,
    period_id: period.id, switch_id: f.switchId, original_message_id: original.id,
    original_payload_hash: digest(original.raw_payload!), contract_id: f.contractId, confirmed_period: period })
  expect(after.transitions.find(r => r.source_message_id === sourceId)).toMatchObject({ company_id: f.companyId,
    payload_hash: digest(raw), source_code: 'Z04', qualified_switch_ids: [f.switchId], actor_user_id: f.actorUserId })
  expect(after.bilateral.find(r => r.source_message_id === sourceId)).toMatchObject({ company_id: f.companyId,
    payload_hash: digest(raw), profiles: [expect.objectContaining({ profileVersionId: f.profileVersionId,
      process: 'normal_start_h', sourceHash: f.sourceHash })] })
  expect(after.switches).toHaveLength(before.switches.length)
  expect(before.switches.filter(r => r.id === f.switchId)).toHaveLength(1)
  expect(after.switches.filter(r => r.id === f.switchId)).toHaveLength(1)
  expect(after.switches.filter(r => r.id !== f.switchId)).toEqual(before.switches.filter(r => r.id !== f.switchId))
  const prior = before.switches.find(r => r.id === f.switchId)!, current = after.switches.find(r => r.id === f.switchId)!
  expect(current).toMatchObject({ status: 'accepted', site_id: f.siteId, inbound_z04_message_id: sourceId,
    confirmed_start_date: f.requestedStartDate, updated_by: f.actorUserId })
  const updatedAt = Date.parse(String(current.updated_at))
  expect(Number.isFinite(updatedAt)).toBe(true)
  expect(updatedAt).toBeGreaterThanOrEqual(startedAt); expect(updatedAt).toBeLessThanOrEqual(completedAt)
  const allowed = new Set(['status', 'site_id', 'inbound_z04_message_id', 'confirmed_start_date', 'updated_by', 'updated_at'])
  const unchanged = (r: Row) => Object.fromEntries(Object.entries(r).filter(([key]) => !allowed.has(key)))
  expect(unchanged(current)).toEqual(unchanged(prior))
}
function ackSendFailureDiagnostic(f: Fixture, sourceId: string, ack: Original, outboxId: string, providerMessageId: string | null, ordinal: number) {
  try {
    return sql(`WITH source AS (SELECT id FROM public.ediel_messages WHERE company_id=${literal(f.companyId)}
        AND environment='test' AND direction='inbound' AND id=${literal(sourceId)}),
      ack AS (SELECT * FROM public.ediel_messages WHERE company_id=${literal(f.companyId)}
        AND environment='test' AND direction='outbound' AND id=${literal(ack.id)}),
      own_requests AS (SELECT r.* FROM public.outbound_requests r JOIN ack m
        ON r.id=m.outbound_request_id AND r.company_id=m.company_id),
      outbox AS (SELECT * FROM public.ediel_outbox WHERE company_id=${literal(f.companyId)}
        AND environment='test' AND id=${literal(outboxId)}),
      attempts AS (SELECT * FROM gridex_ediel_transport.attempts WHERE company_id=${literal(f.companyId)}
        AND environment='test' AND message_id=${literal(ack.id)})
      SELECT jsonb_build_object('stage','after_existing_ack_send_result','ordinal',${ordinal},
        'family',${literal(ack.message_family)},'code',${literal(ack.message_code)},'sourceCount',(SELECT count(*) FROM source),
        'ack',(SELECT jsonb_build_object('status',m.status,'processingStatus',m.processing_status,
          'sentAt',m.message_sent_at,'relatedSourceMatches',m.related_message_id=${literal(sourceId)},
          'originalHashMatches',m.immutable_payload_hash=encode(sha256(convert_to(m.raw_payload,'UTF8')),'hex')) FROM ack m),
        'outboundRequestRelations',(SELECT jsonb_build_object('outboundRequestIdPresent',m.outbound_request_id IS NOT NULL,
          'ownRequestCount',(SELECT count(*) FROM own_requests),
          'ownCustomerMatches',(SELECT r.customer_id IS NOT DISTINCT FROM m.customer_id FROM own_requests r),
          'ownSiteMatches',(SELECT r.site_id IS NOT DISTINCT FROM m.site_id FROM own_requests r),
          'ownPointMatches',(SELECT r.metering_point_id IS NOT DISTINCT FROM m.metering_point_id FROM own_requests r),
          'ackCustomerPresent',m.customer_id IS NOT NULL,'ackSitePresent',m.site_id IS NOT NULL,
          'ackPointPresent',m.metering_point_id IS NOT NULL) FROM ack m),
        'outbox',(SELECT jsonb_build_object('status',o.status,'sentAt',o.sent_at,'attempts',o.attempts,
          'sendAttemptCount',o.send_attempt_count,'attemptIdPresent',o.current_send_attempt_id IS NOT NULL,
          'ackMatches',o.ediel_message_id=${literal(ack.id)},'sourceMatches',o.source_message_id=${literal(sourceId)},
          'originalHashMatches',o.immutable_payload_hash=(SELECT immutable_payload_hash FROM ack),
          'errorStored',o.last_error IS NOT NULL,
          'identifierError',CASE WHEN o.last_error ~ '^[a-z][a-z0-9_]{0,159}$' THEN o.last_error ELSE NULL END) FROM outbox o),
        'attemptCount',(SELECT count(*) FROM attempts),
        'attempts',(SELECT coalesce(jsonb_agg(jsonb_build_object('enteredAt',a.entered_at,'observedAt',a.observed_at,
          'classification',a.classification,'actorMatches',a.actor_user_id=${literal(f.actorUserId)},
          'workerOwner',a.owner->>'kind'='worker','outboxMatches',a.owner->>'outboxId'=${literal(outboxId)},
          'sendAttemptMatches',a.owner->>'sendAttemptId'=(SELECT current_send_attempt_id::text FROM outbox),
          'originalHashMatches',a.binding->>'originalHash'=(SELECT immutable_payload_hash FROM ack),
          'routeMatches',a.binding->>'routeId'=(SELECT communication_route_id::text FROM ack),
          'acceptedArray',jsonb_typeof(a.provider_result->'accepted')='array',
          'acceptedCount',CASE WHEN jsonb_typeof(a.provider_result->'accepted')='array' THEN jsonb_array_length(a.provider_result->'accepted') END,
          'rejectedCount',CASE WHEN jsonb_typeof(a.provider_result->'rejected')='array' THEN jsonb_array_length(a.provider_result->'rejected') END,
          'acceptedRecipientMatches',CASE WHEN jsonb_typeof(a.provider_result->'accepted')='array' THEN
            jsonb_array_length(a.provider_result->'accepted')>0 AND NOT EXISTS(SELECT FROM jsonb_array_elements_text(a.provider_result->'accepted') v(value)
              WHERE lower(v.value) IS DISTINCT FROM lower(a.binding->>'to')) ELSE NULL END,
          'returnedSelectorMatches',a.provider_result->>'messageId'=${literal(providerMessageId)},
          'sentClockMatches',a.observed_at=(SELECT message_sent_at FROM ack)) ORDER BY a.created_at,a.id),'[]')
          FROM (SELECT * FROM attempts ORDER BY created_at,id LIMIT 30) a),
        'events',(SELECT coalesce(jsonb_agg(jsonb_build_object('type',e.event_type,'status',e.event_status,'count',e.n)),'[]')
          FROM (SELECT event_type,event_status,count(*) n FROM public.ediel_message_events
            WHERE company_id=${literal(f.companyId)} AND ediel_message_id=${literal(ack.id)}
            GROUP BY event_type,event_status) e))`)
  } catch (error) {
    const code = record(error).code
    return { stage: 'diagnostic_select_failed', code: typeof code === 'string' && /^[0-9A-Z]{5}$/.test(code) ? code : null }
  }
}
async function observedStage<T>(stage: string, action: () => Promise<T>): Promise<T> {
  try { return await action() }
  catch (error) {
    const own=record(error),code=own.code,message=error instanceof Error?error.message:String(own.message??''),guard=message.split(':')[0]
    const diagnostic=stage.startsWith('critical_negative_')
      ? {stage,code:typeof code==='string'&&/^[0-9A-Z]{5}$/.test(code)?code:null,
        guard:['canonical_inbound_rule_profile_resolution_failed','ediel_inbound_legal_context_required','ediel_historical_rule_pack_basis_unavailable'].includes(guard)?guard:null,
        unknownError:!['canonical_inbound_rule_profile_resolution_failed','ediel_inbound_legal_context_required','ediel_historical_rule_pack_basis_unavailable'].includes(guard)}
      : {stage,code:own.code??null,message:error instanceof Error?error.message:own.message??String(error)}
    console.error('H_NATIVE_FAILURE_STAGE',JSON.stringify(diagnostic))
    throw error
  }
}
const rawParts = (raw: string): Parts[] => {
  const wire = tokenizeEdifact(raw)
  return wire.segments.map(s => [s.tag, ...Array.from({ length: segmentElementCount(s, wire.una) }, (_, i) => {
    const values = segmentComposite(s, i + 1, wire.una)
    return values.length === 1 ? values[0] : values
  })])
}
const render = (parts: Parts) => parts.map(value => (typeof value === 'string' ? [value] : value)
  .map(v => v.replace(/[?':+]/g, char => '?' + char)).join(':')).join('+')
const component = (parts: Parts, position: number, index = 0) => {
  const value = parts[position]; return typeof value === 'string' ? index === 0 ? value : '' : value?.[index] ?? ''
}
function frame(body: readonly Parts[], sender: string, receiver: string, refs = references(), environment: 'test' | 'production' = 'test') {
  return EdifactEnvelopeCodec.encode({ sender, receiver, senderQualifier: '14', receiverQualifier: '14',
    interchangeReference: refs.interchange, applicationReference: '23-DDQ-PRODAT', acknowledgementRequest: true,
    environment, createdAt: refs.createdAt, messages: [{ messageReference: refs.message,
      messageTypeToken: 'PRODAT:D:97A:UN:E2SE6A', businessSegments: body.map(render) }] })
}
function own(f: Fixture, original: Original) {
  const wire = sql<{ objects: { start: string; li: string; reason: string; point: string; agency: string }[] }>(
    `SELECT gridex_received_sources.normal_switch_wire_v1(${literal(original.raw_payload)})`)
  expect(wire.objects).toHaveLength(1); expect(wire.objects[0].reason).toBe('Z25')
  return wire.objects[0]
}
function replyBody(f: Fixture, original: Original, refs = references(), invoicee = false,
  meterTimeFrame: '101' | '201' = '101'): Parts[] {
  const observed = own(f, original), parties = originalAckPartyIdentities({ rawPayload: original.raw_payload, expectedFamily: 'PRODAT' })
  const now = refs.createdAt.toISOString().replace(/[-:T]/g, '').slice(0, 12)
  const body: Parts[] = [ ['BGM', 'Z04', refs.document, '9', 'AB'], ['DTM', ['137', now, '203']], ['DTM', ['ZZZ', '1', '805']],
    ...rawParts(originalAckLegalNadSegment('FR', parties.legalReceiver) + "'"),
    ...rawParts(originalAckLegalNadSegment('DO', parties.legalSender) + "'"),
    line('1', f.external, undefined, '9'), qty('1000'), ...common(f.external, 'Synthetic Own Customer', observed.start),
    // Prospective synthetic DSO declares daily balance settlement before mail birth.
    // This is incoming test data, not a receiver point or reporting-frequency fact.
    ...characteristic('Z07', 'Z12'), ...characteristic('Z12', 'D', 3), ...characteristic('Z15', 'Z32'),
    // Prospective DSO cumulative meter-stand channel, before physical mail birth.
    // Original RK v1.7: 101 is one single-tariff counter covering all time;
    // 201 is the high-load counter of the paired 201/202 scenario below.
    // These tariff counters are separate from interval-energy sampling. Only
    // future UTILTS stands are declared, not delivery, inventory or policy facts.
    ...characteristic('Z02', '10', 3), ...characteristic('Z05', '8', 3), ...characteristic('Z16', meterTimeFrame, 3),
    ['CCI', '', 'Z14'], ['CAV', ['', '', '', 'L917', '8716867000030']],
    ['NAD', 'IT', [f.external, '', '9'], '', '', 'Street', 'Town', '', '12345', 'SE'],
    ['NAD', 'Z02', [f.brpEdielId, '160', 'SVK'], '', '', '', '', '', '', 'SE'],
    ...(invoicee ? [['NAD', 'IV', ['5561234567', 'SE1', '260'], '', 'Synthetic Different Invoicee', 'Invoice Street', 'Invoice Town', '', '54321', 'SE'] as Parts] : []) ]
  return guideOrderedFixtureBody(body.map(p => p[0] === 'CAV' && component(p, 1) === 'Z22' ? ['CAV', ['Z25']]
    : p[0] === 'RFF' && component(p, 1) === 'LI' ? ['RFF', ['LI', observed.li]]
    : p[0] === 'RFF' && component(p, 1) === 'Z05' ? ['RFF', ['Z05', f.gridAreaCode]]
    : p[0] === 'NAD' && component(p, 1) === 'UD' ? ['NAD', 'UD', [f.customerIdentity.id, f.customerIdentity.qualifier, f.customerIdentity.agency], '', 'Synthetic Own Customer', 'Street', 'City', '', '12345', 'SE'] : p))
}
function reply(f: Fixture, original: Original, body = replyBody(f, original), refs = references(), environment: 'test' | 'production' = 'test') {
  const envelope = EdifactEnvelopeCodec.decode(original.raw_payload!)
  return frame(body, envelope.receiver!, envelope.sender!, refs, environment)
}
async function selectedInvoiceeProfile() {
  const staged=await prospective()
  const snapshot=sql<Row>(`SELECT validation_snapshot FROM public.supplier_switch_requests WHERE id=${literal(staged.switchId)}`)
  const portal=record(snapshot.portalData), facts=record(portal.dependentConditionFacts)
  const originalSelection=record((facts.invoiceeObjects as unknown[])[0]), invoicee=record(originalSelection.invoicee)
  const selection={...originalSelection,invoicee:{...invoicee,identity:{id:'5561234567',qualifier:'SE1',agency:'260'},
    nameLines:['Synthetic Different Invoicee'],address:{...record(invoicee.address),lines:['Invoice Street','',''],postalCode:'54321',city:'Invoice Town',country:'SE'}}}
  const renderInvoicee={id:'5561234567',idCodeListQualifier:'SE1',idAgency:'260',name:'Synthetic Different Invoicee',
    nameLines:['Synthetic Different Invoicee'],address:'Invoice Street',addressLines:['Invoice Street','',''],
    postalCode:'54321',city:'Invoice Town',country:'SE'}
  const desired={...snapshot,portalData:{...portal,invoicee:renderInvoicee,dependentConditionFacts:{...facts,invoiceeObjects:[selection]}}}
  const written=await updateSupplierSwitchValidationSnapshot(supabaseService,{requestId:staged.switchId,validationSnapshot:desired})
  expect(written.validation_snapshot).toEqual(desired)
  expect(sql<Row>(`SELECT validation_snapshot FROM public.supplier_switch_requests WHERE id=${literal(staged.switchId)}`)).toEqual(desired)
  // Both caller selection facts and actual render context precede the signed scope.
  const f=await createBilateralProdatGroundNativeFixture(staged)
  const artifact=await archiveBilateralProdatGround({companyId:f.companyId,actorUserId:f.actorUserId,...f.signed()})
  const review=await reviewBilateralProdatGround({companyId:f.companyId,actorUserId:f.reviewer,artifactId:String(artifact.artifactId),
    sourceHash:String(artifact.sourceHash),scopeHash:String(artifact.scopeHash),decision:'approve',reason:'Separate review; caller invoicee is prospective protocol input, not authority'})
  expect(review.status).toBe('authorized')
  return {...f,profileVersionId:String(review.profileVersionId)}
}
async function selectedInstallationProfile() {
  const staged=await prospective(), reference='SYNTHETIC H own-site caller address '+randomUUID()
  const address=await applyCustomerSiteAddressCandidate({companyId:staged.companyId,customerId:staged.customerId,siteId:staged.siteId,
    address:{street:'Installation Street 1',postalCode:'12345',city:'Installation Town',country:'SE',
      source:'manual_intake',sourceReference:reference,actorUserId:staged.actorUserId}})
  expect(address).toMatchObject({status:'updated',siteId:staged.siteId,addressHash:expect.stringMatching(/^[a-f0-9]{64}$/)})
  expect(sql<Row>(`SELECT to_jsonb(s) FROM public.customer_sites s WHERE id=${literal(staged.siteId)}
    AND company_id=${literal(staged.companyId)} AND customer_id=${literal(staged.customerId)}`))
    .toMatchObject({street:'Installation Street 1',postal_code:'12345',city:'Installation Town',country:'SE',
      address_hash:address.addressHash,address_source:'manual_intake',address_source_reference:reference})
  // Stage the public site address before deriving the actual legal/registry scope.
  const f=await createBilateralProdatGroundNativeFixture(staged)
  const artifact=await archiveBilateralProdatGround({companyId:f.companyId,actorUserId:f.actorUserId,...f.signed()})
  const review=await reviewBilateralProdatGround({companyId:f.companyId,actorUserId:f.reviewer,artifactId:String(artifact.artifactId),
    sourceHash:String(artifact.sourceHash),scopeHash:String(artifact.scopeHash),decision:'approve',reason:'Separate review of prospective own site address'})
  expect(review.status).toBe('authorized')
  return {...f,profileVersionId:String(review.profileVersionId)}
}
function configureProspectiveAcknowledgements(f: Fixture, original: Original) {
  // Public disposable GIVEN configuration, installed before any incoming birth.
  // The genuine outgoing original supplies the replies' direction; no source,
  // validation, capability, business effect or physical ACK is manufactured.
  expect(original).toMatchObject({ company_id: f.companyId, direction: 'outbound', environment: 'test',
    message_family: 'PRODAT', message_code: 'Z03', immutable_payload_hash: digest(original.raw_payload!) })
  const envelope = EdifactEnvelopeCodec.decode(original.raw_payload!), transport = assertEdielSmtpReadiness(),
    routeId = randomUUID(), profileId = randomUUID(), immutable = sealed(original.id)
  expect(envelope).toMatchObject({ sender: f.sender, receiver: f.receiver, applicationReference: '23-DDQ-PRODAT' })
  expect(sql<number>(`SELECT to_jsonb(count(*)) FROM public.communication_routes WHERE company_id=${literal(f.companyId)}
    AND route_scope='ediel_ack' AND environment_type='bilateral_test' AND is_active`)).toBe(0)
  sql(`INSERT INTO public.communication_routes(id,company_id,route_name,route_scope,environment_type,is_active,target_email)
    VALUES(${literal(routeId)},${literal(f.companyId)},'Synthetic prospective H ACK route','ediel_ack','bilateral_test',true,'recipient@example.invalid');
    INSERT INTO public.ediel_route_profiles(id,company_id,communication_route_id,route_name,environment,message_standard,payload_format,
      sender_ediel_id,receiver_ediel_id,sender_sub_address,receiver_sub_address,application_reference,is_enabled,is_active,
      transport_security_mode,smtp_to,receiver_email,message_family,business_code,mailbox,smtp_host,smtp_port)
    VALUES(${literal(profileId)},${literal(f.companyId)},${literal(routeId)},'Synthetic prospective H ACK profile','test','edifact','edifact',
      ${literal(envelope.sender)},${literal(envelope.receiver)},${literal(envelope.senderSubAddress??null)},${literal(envelope.receiverSubAddress??null)},
      ${literal(envelope.applicationReference)},true,true,'unencrypted','recipient@example.invalid','recipient@example.invalid',NULL,NULL,
      ${literal(transport.from)},${literal(transport.host)},${literal(transport.port)})`)
  const routes = sql<Row[]>(`SELECT coalesce(jsonb_agg(to_jsonb(r)),'[]') FROM public.communication_routes r
    WHERE r.company_id=${literal(f.companyId)} AND r.route_scope='ediel_ack' AND r.environment_type='bilateral_test' AND r.is_active`)
  expect(routes).toEqual([expect.objectContaining({ id: routeId, company_id: f.companyId, route_scope: 'ediel_ack',
    environment_type: 'bilateral_test', is_active: true, target_email: 'recipient@example.invalid' })])
  const profiles = sql<Row[]>(`SELECT coalesce(jsonb_agg(to_jsonb(p)),'[]') FROM public.ediel_route_profiles p
    WHERE p.company_id=${literal(f.companyId)} AND p.communication_route_id=${literal(routeId)} AND p.is_active AND p.is_enabled`)
  expect(profiles).toEqual([expect.objectContaining({ id: profileId, company_id: f.companyId, communication_route_id: routeId,
    environment: 'test', message_standard: 'edifact', payload_format: 'edifact', sender_ediel_id: envelope.sender,
    receiver_ediel_id: envelope.receiver, sender_sub_address: envelope.senderSubAddress??null,
    receiver_sub_address: envelope.receiverSubAddress??null, application_reference: '23-DDQ-PRODAT', is_active: true, is_enabled: true,
    transport_security_mode: 'unencrypted', smtp_to: 'recipient@example.invalid', receiver_email: 'recipient@example.invalid',
    message_family: null, business_code: null, mailbox: transport.from, smtp_host: transport.host, smtp_port: transport.port })])
  expect(sealed(original.id)).toEqual(immutable)
}
async function sent(selectedInvoicee=false,selectedInstallation=false) {
  const f = selectedInvoicee?await selectedInvoiceeProfile():selectedInstallation?await selectedInstallationProfile():await authorized(), before = business(f), original = await originate(f)
  expect(original).toMatchObject({ direction: 'outbound', environment: 'test', message_family: 'PRODAT', message_code: 'Z03',
    immutable_payload_hash: digest(original.raw_payload!) })
  expect(EdifactEnvelopeCodec.decode(original.raw_payload!).applicationReference).toBe('23-DDQ-PRODAT')
  const qualification = await qualifyPersistedBilateralProdatOutboundOriginal(original, f.actorUserId)
  expect(qualification.qualification?.objects).toEqual([expect.objectContaining({ profileVersionId: f.profileVersionId,
    process: 'normal_start_h', objectId: f.external, customerId: f.customerId, siteId: f.siteId, contractId: f.contractId })])
  configureProspectiveAcknowledgements(f, original)
  expect(business(f).periods).toEqual(before.periods)
  const immutable = sealed(original.id), result = await sendEdielMessageViaSmtp(original, { actorUserId: f.actorUserId, smtpMimeMode: 'nodemailer-attachment' })
  expect(result.accepted).toEqual(['recipient@example.invalid']); expect(result.rejected).toEqual([])
  expect(result.messageId).toMatch(/^<synthetic-/); expect(sealed(original.id)).toEqual(immutable)
  expect(sql<number>(`SELECT to_jsonb(count(*)) FROM gridex_ediel_transport.attempts WHERE company_id=${literal(f.companyId)}
    AND message_id=${literal(original.id)} AND classification='accepted' AND binding->>'originalHash'=${literal(digest(original.raw_payload!))}`)).toBe(1)
  expect(business(f).periods).toEqual(before.periods); expect(business(f).bilateral).toEqual([])
  expect(sql<number>(`SELECT to_jsonb(count(*)) FROM public.ediel_messages WHERE company_id=${literal(f.companyId)}
    AND direction='inbound' AND message_family IN('CONTRL','APERAK')`)).toBe(0)
  return { f, original }
}
// A qualified immutable outgoing original is a prospective premise, not an
// incoming invoicee-availability receipt or a billing-address signature claim.
async function selectedInvoiceeOriginal(f: Fixture, original: Original) {
  const qualified=await qualifyPersistedBilateralProdatOutboundOriginal(original,f.actorUserId)
  expect(qualified.qualification).toMatchObject({companyId:f.companyId,environment:'test',actorUserId:f.actorUserId,
    messageCode:'Z03',payloadHash:digest(original.raw_payload!),objects:[expect.objectContaining({
      objectId:f.external,identityAgency:'9',process:'normal_start_h',profileVersionId:f.profileVersionId,
      customerId:f.customerId,siteId:f.siteId,contractId:f.contractId,lineItemReference:own(f,original).li,sourceHash:f.sourceHash})]})
  const wire=tokenizeEdifact(original.raw_payload!),groups=prodatRegisterGroups(wire.segments,wire.una).groups.filter(g=>g.validRegisterChain&&g.lineIndex===g.firstLineIndex)
  expect(groups).toHaveLength(1);expect(groups[0]).toMatchObject({itemId:f.external,identityAgency:'9',firstLineIndex:qualified.qualification!.objects[0].firstLineIndex})
  const invoicee=groups[0].segments.filter(segment=>segment.tag==='NAD'&&segmentComposite(segment,1,wire.una)[0]==='IV')
  expect(invoicee).toHaveLength(1);expect(segmentComposite(invoicee[0],2,wire.una)).toEqual(['5561234567','SE1','260'])
  expect(segmentComposite(invoicee[0],4,wire.una)[0]).toBe('Synthetic Different Invoicee')
  expect(segmentComposite(invoicee[0],5,wire.una)[0]).toBe('Invoice Street')
  expect(segmentComposite(invoicee[0],6,wire.una)[0]).toBe('Invoice Town')
  expect(segmentComposite(invoicee[0],8,wire.una)[0]).toBe('54321');expect(segmentComposite(invoicee[0],9,wire.una)[0]).toBe('SE')
  const persisted=(await getEdielMessageById(original.id,{companyId:f.companyId}))!
  expect(persisted).toMatchObject({company_id:f.companyId,environment:'test',direction:'outbound',message_code:'Z03',
    raw_payload:original.raw_payload,immutable_payload_hash:digest(original.raw_payload!)})
  return sealed(original.id)
}
async function intake(f: Fixture, raw: string, environment: 'test' | 'production' = 'test', missingAssociation = false) {
  const mailbox = await seedOriginalMailboxNative(sql, literal, { companyId: f.companyId, environment, raw,
    smtpFrom: 'synthetic@example.invalid', senderEmail: 'recipient@example.invalid' }), parsed = mailbox.parsed
  if (missingAssociation) expect(parsed).toMatchObject({ messageFamily: 'PRODAT', messageCode: 'Z04',
    messageTypeVersion: { directoryVersion: 'D', release: '97A', controllingAgency: 'UN', associationAssignedCode: null } })
  const [outboundMatch, meteringPointMatch] = await Promise.all([
    matchOutboundRequestForInbound({ companyId: f.companyId, parsed, inboundEmailMessageId: mailbox.inboundEmailMessageId, parseResultId: mailbox.parseResultId }),
    matchMeteringPointForInbound({ companyId: f.companyId, parsed, inboundEmailMessageId: mailbox.inboundEmailMessageId, parseResultId: mailbox.parseResultId }) ])
  const tenant = await resolveInboundTenantFromIdentifiers({ mailboxCompanyId: f.companyId, mailboxId: mailbox.mailboxId, environment,
    senderEdielId: parsed.senderEdielId, senderSubaddress: parsed.senderSubAddress, receiverEdielId: parsed.receiverEdielId,
    receiverSubaddress: parsed.receiverSubAddress, marketActorEdielId: inboundLegalReceiverEdielId(raw, parsed.receiverEdielId),
    applicationReference: parsed.applicationReference, messageFamily: parsed.messageFamily, messageCode: parsed.messageCode,
    referenceCandidates: Object.values(parsed.references).flat() })
  const warnings=vi.spyOn(console,'warn')
  try {
    const id = await createInboundEdielMessage({ companyId: f.companyId, actorUserId: f.actorUserId, environment,
      inboundEmailMessageId: mailbox.inboundEmailMessageId, parseResultId: mailbox.parseResultId, parsed, outboundMatch, meteringPointMatch, tenantResolution: tenant })
    const birthErrors=warnings.mock.calls.filter(c=>c[0]==='[inbound-mail] Kunde inte skapa/uppdatera inbound ediel_message').map(c=>record(c[1]))
    return { id, mailbox, tenant, outboundMatch, meteringPointMatch, birthErrors }
  } finally { warnings.mockRestore() }
}
async function ready(f: Fixture, original: Original, raw = reply(f, original), expectedLi = own(f, original).li,
  expectedRegisters: 1 | 2 = 1) {
  // Original field306 declares installation status on the first object.
  // Qualify its prospective positive premise before immutable mailbox birth.
  expect(sql(`SELECT jsonb_build_object('pointStatus',p.status,'siteStatus',s.status,
    'companyId',p.company_id,'customerId',p.customer_id,'siteId',p.site_id,
    'customerSiteId',p.customer_site_id,'external',p.ediel_metering_point_id)
    FROM public.metering_points p JOIN public.customer_sites s ON s.id=p.site_id
    AND s.company_id=p.company_id AND s.customer_id=p.customer_id
    WHERE p.id=${literal(f.pointId)} AND p.company_id=${literal(f.companyId)}
    AND p.customer_id=${literal(f.customerId)} AND s.id=${literal(f.siteId)}`)).toEqual({
      pointStatus:'active',siteStatus:'active',companyId:f.companyId,customerId:f.customerId,
      siteId:f.siteId,customerSiteId:f.siteId,external:f.external})
  const installationWire=tokenizeEdifact(raw)
  const firstLineIndex=installationWire.segments.findIndex(s=>s.tag==='LIN')
  expect(firstLineIndex).toBeGreaterThanOrEqual(0)
  const firstLine=installationWire.segments[firstLineIndex]
  expect(segmentComposite(firstLine,3,installationWire.una)[0]).toBe(f.external)
  expect(segmentComposite(firstLine,3,installationWire.una)[3]).toBe('9')
  const boundary=installationWire.segments.slice(firstLineIndex+1).findIndex(s=>s.tag==='LIN'||s.tag==='UNT')
  expect(boundary).toBeGreaterThanOrEqual(0)
  const firstObject=installationWire.segments.slice(firstLineIndex,firstLineIndex+1+boundary)
  const installationCharacteristics=firstObject.filter(s=>s.tag==='CCI'&&segmentComposite(s,2,installationWire.una)[0]==='Z07')
  expect(installationCharacteristics).toHaveLength(1)
  const installationValue=firstObject[firstObject.indexOf(installationCharacteristics[0])+1]
  expect(installationValue?.tag).toBe('CAV')
  expect(segmentComposite(installationValue,1,installationWire.una)).toEqual(['Z12'])
  const settlementCharacteristics=firstObject.filter(s=>s.tag==='CCI'&&segmentComposite(s,2,installationWire.una)[0]==='Z15')
  expect(settlementCharacteristics).toHaveLength(1)
  const settlementValue=firstObject[firstObject.indexOf(settlementCharacteristics[0])+1]
  expect(settlementValue?.tag).toBe('CAV')
  expect(segmentComposite(settlementValue,1,installationWire.una)).toEqual(['Z32'])
  const expectedTimeFrames = expectedRegisters === 1 ? ['101'] : ['201', '202']
  const prospectiveRegisters = prodatRegisterGroups(installationWire.segments, installationWire.una)
  expect(prospectiveRegisters.problems).toEqual([])
  expect(prospectiveRegisters.groups).toHaveLength(expectedRegisters)
  for (const [index, group] of prospectiveRegisters.groups.entries()) {
    expect(group).toMatchObject({ messageIndex: 0, itemId: f.external, identityAgency: '9', validRegisterChain: true,
      registerCount: expectedRegisters, registerPosition: index + 1 })
    expect(group.registerIndex).toBe(expectedRegisters === 1 ? null : String(index + 1))
    // Each physical register supplies its own full C889, before immutable birth.
    const timeFrames = group.segments.filter(s => s.tag === 'CCI' && segmentComposite(s, 2, installationWire.una)[0] === 'Z16')
    expect(timeFrames).toHaveLength(1)
    const value = group.segments[group.segments.indexOf(timeFrames[0]) + 1]
    expect(value?.tag).toBe('CAV')
    expect(segmentComposite(value, 1, installationWire.una)).toEqual(['', '', '', expectedTimeFrames[index]])
  }
  const received = await intake(f, raw)
  expect(received.tenant, JSON.stringify(received)).toMatchObject({ status: 'resolved', companyId: f.companyId })
  expect(received.id, JSON.stringify(received)).not.toBeNull()
  const message = (await getEdielMessageById(received.id!))!
  expect(message).toMatchObject({ raw_payload: raw, immutable_payload_hash: digest(raw), direction: 'inbound', company_id: f.companyId,
    message_code: 'Z04', rule_profile_key: 'PRODAT:Z04:H:26.A:r3' })
  const wire = tokenizeEdifact(message.raw_payload!), physical = prodatRegisterGroups(wire.segments, wire.una)
  expect(physical.problems).toEqual([])
  expect(physical.groups).toHaveLength(expectedRegisters)
  for (const [index, group] of physical.groups.entries()) {
    expect(group).toMatchObject({ itemId: f.external, identityAgency: '9', validRegisterChain: true })
    // Read physical local segments, never inherited first-register evidence.
    expect(['214', '218', '259'].map(field => prodatRegisterReadingState(field, group.segments, wire.una)))
      .toEqual([
        { present: true, value: '10', malformed: false },
        { present: true, value: '8', malformed: false },
        { present: true, value: expectedTimeFrames[index], malformed: false },
      ])
  }
  const capability = await readSourceQualifiedProdatBilateralCapability(message)
  expect(capability).toMatchObject({ sourceMessageId: message.id, sourcePayloadHash: digest(raw), subtype: 'H',
    owner: 'immutable-bilateral-prodat-profile-v1', objects: [expect.objectContaining({ profileVersionId: f.profileVersionId,
      process: 'normal_start_h', objectId: f.external, lineItemReference: expectedLi })] })
  const decision = await resolveCanonicalRuntimeDecisionWithRegistry(message,{actorUserId:f.actorUserId})
  expect([decision.syntaxDecision, decision.applicationDecision, decision.functionalDecision], JSON.stringify(decision))
    .toEqual(['accepted', 'accepted', 'accepted'])
  expect(decision.policy?.prodatDependentFacts?.registerObjects).toEqual([
    { meteringPointId: f.external, identityAgency: '9', meterReadingsSentInUtilts: true },
  ])
  expect(record(sealed(message.id)).inbound).toMatchObject({ status: 'ready', reason: null })
  return { ...received, message, decision, capability }
}
async function acknowledgements(f: Fixture, original: Original, sourceId: string, raw: string) {
  const acks = await listBusinessAckMessagesForSource({ companyId: f.companyId, sourceMessageId: sourceId,
    actorUserId: f.actorUserId, environment: 'test' })
  expect(acks.map(a => a.message_family).sort(),acks.length===2 ? undefined
    : JSON.stringify(effectFailureDiagnostic(f.companyId,sourceId))).toEqual(['APERAK', 'CONTRL'])
  const source = tokenizeEdifact(raw), envelope = EdifactEnvelopeCodec.decode(raw), parties = originalAckPartyIdentities({ rawPayload: raw })
  const sourceSegment = (tag: string) => source.segments.find(s => s.tag === tag)!
  for (const ack of acks) {
    expect(ack).toMatchObject({ company_id: f.companyId, environment: 'test', direction: 'outbound',
      related_message_id: sourceId, ack_outcome: 'positive', immutable_payload_hash: digest(ack.raw_payload!) })
    const wire = tokenizeEdifact(ack.raw_payload!), reverse = EdifactEnvelopeCodec.decode(ack.raw_payload!)
    const single = (tag: string) => { const found = wire.segments.filter(s => s.tag === tag); expect(found).toHaveLength(1); return found[0] }
    const unb = single('UNB'), unh = single('UNH'), unt = single('UNT'), unz = single('UNZ')
    expect(wire.segments[0]).toBe(unb); expect(wire.segments.at(-1)).toBe(unz)
    expect(wire.segments.indexOf(unh)).toBe(1)
    expect(wire.segments.indexOf(unt)).toBeGreaterThan(wire.segments.indexOf(unh))
    expect(wire.segments.indexOf(unt)).toBe(wire.segments.length - 2)
    expect(segmentElementCount(unt, wire.una)).toBe(2); expect(segmentElementCount(unz, wire.una)).toBe(2)
    expect(segmentComposite(unt, 1, wire.una)).toEqual([String(wire.segments.indexOf(unt) - wire.segments.indexOf(unh) + 1)])
    expect(segmentComposite(unt, 2, wire.una)).toEqual(segmentComposite(unh, 1, wire.una))
    expect(segmentComposite(unz, 1, wire.una)).toEqual(['1'])
    expect(segmentComposite(unz, 2, wire.una)).toEqual(segmentComposite(unb, 5, wire.una))
    expect(segmentComposite(unh, 2, wire.una)).toEqual(ack.message_family === 'CONTRL'
      ? ['CONTRL', '2', '2', 'UN', 'EDIEL2'] : ['APERAK', 'D', '96A', 'UN', 'E2SE6A'])
    expect(reverse).toMatchObject({ sender: envelope.receiver, receiver: envelope.sender, environment: 'test', applicationReference: '23-DDQ-PRODAT' })
    if (ack.message_family === 'CONTRL') {
      const uci = wire.segments.filter(s => s.tag === 'UCI'); expect(uci).toHaveLength(1)
      expect(segmentComposite(uci[0], 1, wire.una)[0]).toBe(envelope.interchangeReference!.slice(0, 14))
      expect(segmentComposite(uci[0], 4, wire.una)[0]).toBe('1')
      for (const i of [2, 3]) expect(segmentComposite(uci[0], i, wire.una)).toEqual(segmentComposite(sourceSegment('UNB'), i, source.una))
      for (const ucm of wire.segments.filter(s => s.tag === 'UCM')) {
        expect(segmentComposite(ucm, 1, wire.una)[0]).toBe(segmentComposite(sourceSegment('UNH'), 1, source.una)[0])
        expect(segmentComposite(ucm, 3, wire.una)[0]).toBe('1')
      }
      const basis = await readPersistedEdielTechnicalContrlBasis({ companyId: f.companyId, environment: 'test',
        ackMessageId: ack.id, expectedRawPayload: ack.raw_payload!, actorUserId: f.actorUserId, phase: 'read' })
      expect(basis.evidence).toMatchObject({ sourceMessageId: sourceId, sourceHash: digest(raw),
        companyId: f.companyId, environment: 'test', syntaxDecision: 'accepted' })
    } else {
      const bgm = single('BGM')
      expect(segmentElementCount(bgm, wire.una)).toBe(3)
      expect(segmentComposite(bgm, 1, wire.una)).toEqual(['']); expect(segmentComposite(bgm, 2, wire.una)).toEqual([''])
      expect(segmentComposite(bgm, 3, wire.una)).toEqual(['34'])
      expect(sql<boolean>(`SELECT to_jsonb(EXISTS(SELECT FROM public.ediel_messages m
        JOIN gridex_ediel_outbound_owner.witnesses w ON w.id::text=m.execution_context_snapshot->>'outboundOwnerWitnessId'
        JOIN gridex_ediel_outbound_owner.consumptions c ON c.witness_id=w.id AND c.source_message_id=m.id
        WHERE m.id=${literal(ack.id)} AND m.company_id=${literal(f.companyId)} AND m.environment='test'
        AND m.direction='outbound' AND m.message_family='APERAK' AND m.related_message_id=${literal(sourceId)}
        AND w.company_id=m.company_id AND w.environment=m.environment AND w.family='APERAK'
        AND w.actor_user_id=${literal(f.actorUserId)} AND w.related_message_id=m.related_message_id
        AND w.payload_sha256=${literal(digest(ack.raw_payload!))} AND c.payload_sha256=w.payload_sha256
        AND c.company_id=m.company_id AND c.environment=m.environment AND (
          EXISTS(SELECT FROM gridex_ediel_ack_guide.prodat_response_owner_bindings b
            JOIN gridex_received_sources.prodat_response_facets r ON r.assessment_id=b.assessment_id
            WHERE b.witness_id=w.id AND b.source_message_id=m.related_message_id AND b.company_id=m.company_id
            AND b.environment=m.environment AND b.ack_hash=w.payload_sha256 AND b.facet_hash=r.response_facts_hash
            AND r.source_message_id=b.source_message_id AND r.company_id=b.company_id AND r.environment=b.environment
            AND r.source_payload_hash=${literal(digest(raw))}
            AND r.response_facts_hash=encode(sha256(convert_to(r.response_facts_text,'UTF8')),'hex'))
          OR EXISTS(SELECT FROM gridex_ediel_ack_guide.prodat_structural_response_bindings b
            WHERE b.witness_id=w.id AND b.source_message_id=m.related_message_id AND b.company_id=m.company_id
            AND b.environment=m.environment AND b.ack_hash=w.payload_sha256
            AND b.facet_hash=encode(sha256(convert_to(b.facet_text,'UTF8')),'hex')
            AND b.facet_text::jsonb->>'sourcePayloadHash'=${literal(digest(raw))}))))`)).toBe(true)
      for (const [role, party] of [['FR', parties.legalReceiver], ['DO', parties.legalSender]] as const) {
        const nad = wire.segments.filter(s => s.tag === 'NAD' && segmentComposite(s, 1, wire.una)[0] === role)
        expect(nad).toHaveLength(1); expect(segmentComposite(nad[0], 2, wire.una)).toEqual(party.identityComponents)
      }
      expect(wire.segments.filter(s => s.tag === 'ERC').map(s => segmentComposite(s, 1, wire.una))).toEqual([['100', '', '260']])
      for (const [q, value] of [['ACW', segmentComposite(sourceSegment('BGM'), 2, source.una)[0]], ['LI', own(f, original).li], ['Z07', f.external]]) {
        const reference = wire.segments.filter(s => s.tag === 'RFF' && segmentComposite(s, 1, wire.una)[0] === q)
        expect(reference).toHaveLength(1); expect(segmentComposite(reference[0], 1, wire.una)).toEqual([q, value])
      }
    }
    const outboxes = sql<Row[]>(`SELECT coalesce(jsonb_agg(to_jsonb(o) ORDER BY id),'[]') FROM public.ediel_outbox o
      WHERE company_id=${literal(f.companyId)} AND ediel_message_id=${literal(ack.id)}`)
    expect(outboxes).toHaveLength(1)
    expect(outboxes[0]).toMatchObject({ ediel_message_id: ack.id, company_id: f.companyId, environment: 'test',
      source_message_id: sourceId, message_family: ack.message_family, ack_outcome: 'positive', status: 'queued',
      immutable_payload_hash: digest(ack.raw_payload!), created_by: f.actorUserId, sent_at: null })
    expect(Number.isFinite(Date.parse(String(outboxes[0].queued_at)))).toBe(true)
    const bytes = sealed(ack.id), { result, rpcObservation } = await observeAckTransportRpcErrors(supabaseService,
      { companyId: f.companyId, environment: 'test', messageId: ack.id, actorUserId: f.actorUserId },
      () => sendOutboxItem({ actorUserId: f.actorUserId, outboxItemId: String(outboxes[0].id), smtpMimeMode: 'nodemailer-attachment' }))
    expect(result.status, JSON.stringify({ result, rpcObservation: result.status === 'sent' ? null : rpcObservation, diagnostic: result.status === 'sent' ? null
      : ackSendFailureDiagnostic(f, sourceId, ack, String(outboxes[0].id), result.messageId, acks.indexOf(ack) + 1) })).toBe('sent'); expect(sealed(ack.id)).toEqual(bytes)
  }
  return acks
}

// Independent frozen field list, not generated from implementation descriptors.
async function negativeAcknowledgement(f:Fixture,source:Original,decision:Awaited<ReturnType<typeof resolveCanonicalRuntimeDecisionWithRegistry>>,field:string) {
  const plans=decision.responsePlan.filter(p=>p.family==='APERAK'&&p.outcome==='negative')
  expect(plans).toHaveLength(1)
  const expected=plans.flatMap(p=>p.applicationErrors??[]).filter(e=>e.fieldCode===field)
  expect(expected.length).toBeGreaterThan(0)
  if(['210','260','226'].includes(field)) {
    // This is the actual rejected source's private negative decision. A control
    // or declared operational policy cannot substitute its original witness.
    expect(decision).toMatchObject({policy:null,syntaxDecision:'accepted',applicationDecision:'rejected',functionalDecision:'not_applicable'})
    expect(decision.validationReport.rulePackEvidence).toMatchObject({rulePackId:source.canonical_rule_pack_id,
      messageProfileId:source.rule_profile_version_id,version:source.rule_profile_version,sourceHash:source.rule_pack_checksum})
    expect(plans[0].applicationErrors).toHaveLength(1)
    expect(expected).toEqual([expect.objectContaining({fieldCode:field,ercCode:'41',
      prodatFieldDiagnostic:expect.objectContaining({kind:'field',fieldNumber:field,errorKind:'missing'})})])
  }
  const acks=await listBusinessAckMessagesForSource({companyId:f.companyId,sourceMessageId:source.id,actorUserId:f.actorUserId,environment:'test'})
  expect(acks.filter(a=>a.message_family==='APERAK'&&a.ack_outcome==='positive')).toEqual([])
  const negative=acks.filter(a=>a.message_family==='APERAK'&&a.ack_outcome==='negative')
  expect(negative).toHaveLength(1)
  const ack=negative[0], raw=source.raw_payload!, wire=tokenizeEdifact(ack.raw_payload!), original=tokenizeEdifact(raw)
  if(['311','314'].includes(field)) {
    const rejection=wire.segments.filter(t=>t.tag==='BGM')
    expect(rejection).toHaveLength(1); expect(segmentElementCount(rejection[0],wire.una)).toBe(3)
    expect([1,2,3].map(i=>segmentComposite(rejection[0],i,wire.una))).toEqual([[''],[''],['27']])
  }
  if(field==='209') {
    const customer=original.segments.filter(t=>t.tag==='NAD'&&segmentComposite(t,1,original.una)[0]==='UD')
    expect(customer).toHaveLength(1); const id=segmentComposite(customer[0],2,original.una)[0]
    expect(id).not.toBe('')
    const ownLines=original.segments.filter(t=>t.tag==='LIN');expect(ownLines).toHaveLength(1)
    const identity=segmentComposite(ownLines[0],3,original.una)
    expect(identity[0]).toBe('')
    for(const error of expected) {
      // P94 requires kundid for an actual ERC41 missing reference. A submitted
      // C212 with empty id but retained agency is the existing typed ERC42
      // invalid composite; retain its real failed value and exact own evidence.
      if(error.ercCode==='41') {
        expect(error.text).toContain(`kundid=${id}`)
        expect(error.prodatFieldDiagnostic).toMatchObject({kind:'field',fieldNumber:'209',errorKind:'missing'})
      } else {
        expect(error.ercCode).toBe('42');expect(identity).toHaveLength(4)
        expect(identity.slice(1,3)).toEqual(['','']);expect(['9','89']).toContain(identity[3])
        expect(error.text).toBe(`Felaktigt Anläggnings-id ${identity.join(':')}`)
        const diagnostic=error.prodatFieldDiagnostic
        expect(diagnostic).toMatchObject({kind:'field',fieldNumber:'209',errorKind:'invalid'})
        if(diagnostic?.kind!=='field')throw Error('actual_209_field_diagnostic_required')
        expect(diagnostic.failureEvidence).toEqual([{raw:ownLines[0].raw,locator:'LIN',content:identity.join(':')}])
      }
      expect(error.referenceNumber??'').toBe('')
    }
    expect(wire.segments.filter(t=>t.tag==='RFF'&&segmentComposite(t,1,wire.una)[0]==='Z07')).toEqual([])
  }
  expect(ack).toMatchObject({related_message_id:source.id,immutable_payload_hash:digest(ack.raw_payload!)})
  const envelope=EdifactEnvelopeCodec.decode(raw)
  expect(EdifactEnvelopeCodec.decode(ack.raw_payload!)).toMatchObject({sender:envelope.receiver,receiver:envelope.sender,
    environment:'test',applicationReference:'23-DDQ-PRODAT'})
  const parties=originalAckPartyIdentities({rawPayload:raw})
  for(const [role,party] of [['FR',parties.legalReceiver],['DO',parties.legalSender]] as const) {
    const nad=wire.segments.filter(t=>t.tag==='NAD'&&segmentComposite(t,1,wire.una)[0]===role)
    expect(nad).toHaveLength(1); expect(segmentComposite(nad[0],2,wire.una)).toEqual(party.identityComponents)
  }

  if(field==='226') {
    // The genuine own point can identify this error; the physically absent LI
    // cannot be inherited from the positive control or outgoing original.
    const ownLi=(segments:typeof wire.segments,una:typeof wire.una)=>segments.filter(t=>t.tag==='RFF'&&segmentComposite(t,1,una)[0]==='LI')
    expect(ownLi(original.segments,original.una)).toEqual([]);expect(ownLi(wire.segments,wire.una)).toEqual([])
    for(const error of expected)expect(error.lineItemReference??'').toBe('')
  }
  const bgm=original.segments.find(t=>t.tag==='BGM')!
  const acw=wire.segments.filter(t=>t.tag==='RFF'&&segmentComposite(t,1,wire.una)[0]==='ACW')
  expect(acw).toHaveLength(1); expect(segmentComposite(acw[0],1,wire.una)).toEqual(['ACW',segmentComposite(bgm,2,original.una)[0]])
  for(const error of expected) {
    const matching=wire.segments.flatMap((t,index)=>t.tag==='FTX'&&segmentComposite(t,3,wire.una)[0]===field?[index]:[])
    expect(matching.length).toBeGreaterThan(0)
    expect(matching.some(index=>{
      const erc=wire.segments[index-1]
      return erc?.tag==='ERC'&&JSON.stringify(segmentComposite(erc,1,wire.una))===JSON.stringify([error.ercCode,'','260'])
        &&JSON.stringify(segmentComposite(wire.segments[index],3,wire.una))===JSON.stringify([field,'','260'])
        &&segmentComposite(wire.segments[index],4,wire.una)[0]===error.text
    })).toBe(true)
    // Copy only references that the source-owned diagnostic actually knows;
    // a missing header/object/LI never gains a manufactured reference.
    for(const [qualifier,value] of [['Z07',error.referenceNumber],['LI',error.lineItemReference]] as const) if(value) {
      expect(wire.segments.some(t=>t.tag==='RFF'&&JSON.stringify(segmentComposite(t,1,wire.una))===JSON.stringify([qualifier,value]))).toBe(true)
      expect(original.segments.some(t=>qualifier==='Z07'?t.tag==='LIN'&&segmentComposite(t,3,original.una)[0]===value
        :t.tag==='RFF'&&JSON.stringify(segmentComposite(t,1,original.una))===JSON.stringify(['LI',value]))).toBe(true)
    }
  }
}

const required = { Z03: ['311','312','202','203','313','205','206','207','208','314','209','210','217','223','260','261','226','227','228','231','232','316','262'],
  Z04: ['311','312','202','203','313','205','206','207','208','314','209','210','508','213','217','306','222','223','254','242','224','260','226','227','228','231','232','316','233','234','262'] } as const
const chars: Record<string, string> = { '217': 'Z04', '223': 'Z13', '306': 'Z07', '222': 'Z12', '254': 'Z15', '242': 'Z14' }
const dtms: Record<string, string> = { '205': '137', '206': 'ZZZ', '210': '92', '508': '354' }
const rffs: Record<string, string> = { '260': 'Z05', '261': 'ANJ', '226': 'LI', '224': 'MG' }
const nads: Record<string, [string, number]> = { '207': ['FR',2], '208': ['DO',2], '227': ['UD',2], '228': ['UD',4],
  '229': ['UD',5], '231': ['UD',8], '232': ['UD',6], '316': ['UD',9], '233': ['IT',2], '234': ['IT',5],
  '250': ['IV',2], '251': ['IV',4], '252': ['IV',5], '253': ['IV',8], '317': ['IV',6], '318': ['IV',9], '262': ['Z02',2] }
function omit(raw: string, field: string) {
  const parts = rawParts(raw), out: Parts[] = []
  let removed = 0
  for (let i = 0; i < parts.length; i++) {
    const p = parts[i]
    if ((dtms[field] && p[0] === 'DTM' && component(p,1) === dtms[field]) || (rffs[field] && p[0] === 'RFF' && component(p,1) === rffs[field])
      || field === '213' && p[0] === 'QTY' && component(p,1) === '31') { removed++; continue }
    if (chars[field] && p[0] === 'CCI' && component(p,2) === chars[field]) {
      expect(parts[i+1][0]).toBe('CAV'); i++; removed++; continue
    }
    const copy: (string | readonly string[])[] = [...p]
    if (nads[field] && p[0] === 'NAD' && component(p,1) === nads[field][0]) {
      const position = nads[field][1]
      copy[position] = position === 2 ? ['', ...((typeof p[position] === 'string' ? [p[position]] : p[position]) as string[]).slice(1)] : ''
      removed++
    } else if (field === '311' && p[0] === 'UNB') { copy[7] = ''; removed++ }
    else if (field === '312' && p[0] === 'UNH') {
      const association = p[2]
      expect(association).toEqual(['PRODAT', 'D', '97A', 'UN', expect.any(String)])
      if (typeof association === 'string') throw Error('actual_312_composite_required')
      expect(association[4]).not.toBe('')
      copy[2] = [...association.slice(0,4), '']; removed++
    }
    else if (['202','203','313'].includes(field) && p[0] === 'BGM') { copy[{ '202':1,'203':2,'313':4 }[field]!]= ''; removed++ }
    else if (['314','209'].includes(field) && p[0] === 'LIN') {
      copy[field === '314' ? 1 : 3] = field === '314' ? '' : ['', ...(typeof p[3] === 'string' ? [p[3]] : p[3]).slice(1)]; removed++
    }
    out.push(copy)
  }
  expect(removed, `physical field ${field} must exist in baseline`).toBe(1)
  const unh = out.findIndex(p => p[0] === 'UNH'), unt = out.findIndex(p => p[0] === 'UNT')
  const count: (string | readonly string[])[] = [...out[unt]]; count[1] = String(unt - unh + 1); out[unt] = count
  const malformed = "UNA:+.? '" + out.map(render).join("'") + "'"
  if(['311','314','209','223'].includes(field)) {
    const expected=parts.filter((p,i)=>field!=='223'||!(p[0]==='CCI'&&component(p,2)==='Z13'
      ||p[0]==='CAV'&&parts[i-1]?.[0]==='CCI'&&component(parts[i-1],2)==='Z13')).map(p=>
      field==='311'&&p[0]==='UNB'?[...p.slice(0,7),'',...p.slice(8)]
      :field==='314'&&p[0]==='LIN'?[p[0],'',...p.slice(2)]
      :field==='209'&&p[0]==='LIN'?[...p.slice(0,3),['',...(typeof p[3]==='string'?[p[3]]:p[3]).slice(1)],...p.slice(4)]:p)
    expect(rawParts(malformed)).toEqual(expected.map(p=>p[0]==='UNT'?[p[0],String(expected.findIndex(t=>t[0]==='UNT')-expected.findIndex(t=>t[0]==='UNH')+1),...p.slice(2)]:p))
  }
  if (field === '312') {
    // 0057 alone is the national version. Family/directory/agency and all
    // other physical components, including UNT, remain the genuine control.
    expect(rawParts(malformed)).toEqual(parts.map(p => p[0] === 'UNH'
      ? [p[0], p[1], ['PRODAT', 'D', '97A', 'UN', ''], ...p.slice(3)] : p))
  }
  if (field === '202' || field === '203' || field === '207') {
    // These refusals change exactly one physical value; the qualified control
    // supplies every other component, including the declared segment counts.
    expect(rawParts(malformed)).toEqual(parts.map(p => field === '202' && p[0] === 'BGM'
      ? [p[0], '', ...p.slice(2)]
      : field === '203' && p[0] === 'BGM' ? [p[0],p[1],'',...p.slice(3)]
      : field === '207' && p[0] === 'NAD' && component(p, 1) === 'FR'
        ? [p[0], p[1], ['', '160', 'SVK'], ...p.slice(3)] : p))
  }
  if (['208','227','233','262','250'].includes(field)) {
    const role = nads[field][0], baseline = parts.filter(p => p[0] === 'NAD' && component(p,1) === role)
    expect(baseline).toHaveLength(1)
    expect(component(baseline[0],2)).not.toBe('')
    // Empty only 3039 in the actual present C082. Each role keeps its own
    // qualifier/agency, full parent and every other physical control byte.
    expect(rawParts(malformed)).toEqual(parts.map(p => p[0] === 'NAD' && component(p,1) === role
      ? [p[0], p[1], ['', ...(typeof p[2] === 'string' ? [p[2]] : p[2]).slice(1)], ...p.slice(3)] : p))
  }
  return malformed
}
function freshPhysicalIdentity(raw:string) {
  const refs=references()
  return "UNA:+.? '"+rawParts(raw).map(p=>{
    const copy:(string|readonly string[])[]=[...p]
    if(p[0]==='UNB')copy[5]=refs.interchange
    if(p[0]==='UNH'||p[0]==='UNT')copy[p[0]==='UNH'?1:2]=refs.message
    if(p[0]==='BGM')copy[2]=refs.document
    if(p[0]==='UNZ')copy[2]=refs.interchange
    return render(copy)
  }).join("'")+"'"
}
async function reread(f:Fixture,control:Awaited<ReturnType<typeof ready>>) {
  const row=(await getEdielMessageById(control.message.id))!
  expect(await readSourceQualifiedProdatBilateralCapability(row)).toEqual(control.capability)
  const decision=await resolveCanonicalRuntimeDecisionWithRegistry(row)
  expect([decision.syntaxDecision,decision.applicationDecision,decision.functionalDecision],JSON.stringify(decision)).toEqual(['accepted','accepted','accepted'])
  expect(record(sealed(row.id)).inbound).toMatchObject({status:'ready',reason:null})
}
function criticalRefusalGraph(f: Fixture, original: Original, controlId: string) {
  return { durable: durable(f, original, controlId), messages: rows('public.ediel_messages', f.companyId),
    requests: rows('public.outbound_requests', f.companyId),
    responses: rows('gridex_ediel_ack_guide.prodat_response_owner_bindings', f.companyId, 'witness_id'),
    structural: rows('gridex_ediel_ack_guide.prodat_structural_response_bindings', f.companyId, 'witness_id') }
}
type CriticalRefusalGraph = ReturnType<typeof criticalRefusalGraph>
function assertUnchangedCriticalRefusalGraph(before: CriticalRefusalGraph, after: CriticalRefusalGraph,
  newMessages: readonly unknown[] = [], newOutboxes: readonly unknown[] = []) {
  expect({ ...after, messages: after.messages.filter(m => !newMessages.includes(m.id)),
    durable: { ...after.durable,
      messages: (after.durable.messages as Row[]).filter(m => !newMessages.includes(m.id)),
      outboxes: after.durable.outboxes.filter(o => !newOutboxes.includes(o.id)) } }).toEqual(before)
}
async function actualSyntaxReply(f: Fixture, message: NonNullable<Awaited<ReturnType<typeof getEdielMessageById>>>,
  before: CriticalRefusalGraph, after: CriticalRefusalGraph, syntaxDecision:'accepted'|'rejected') {
  const priorIds = new Set(before.messages.map(m => m.id)), fresh = after.messages.filter(m => !priorIds.has(m.id))
  expect(fresh).toHaveLength(2)
  expect(fresh.filter(m => m.id === message.id)).toEqual([expect.objectContaining({ company_id: f.companyId,
    direction: 'inbound', environment: 'test', raw_payload: message.raw_payload, immutable_payload_hash: digest(message.raw_payload!) })])
  const replies = fresh.filter(m => m.id !== message.id)
  expect(replies).toHaveLength(1)
  const ack = replies[0]
  expect(ack).toMatchObject({ direction: 'outbound', company_id: f.companyId, environment: 'test',
    message_family: 'CONTRL', related_message_id: message.id,ack_outcome:syntaxDecision==='accepted'?'positive':'negative' })
  expect(typeof ack.raw_payload).toBe('string')
  const raw = String(ack.raw_payload), wire = tokenizeEdifact(raw), envelope = EdifactEnvelopeCodec.decode(raw),
    sourceWire = tokenizeEdifact(message.raw_payload!), sourceEnvelope = EdifactEnvelopeCodec.decode(message.raw_payload!),
    sourceUnb = sourceWire.segments.find(s => s.tag === 'UNB')!,
    only = (tag: string) => { const found = wire.segments.filter(s => s.tag === tag); expect(found).toHaveLength(1); return found[0] }
  const unb = only('UNB'), unh = only('UNH'), uci = only('UCI'), unt = only('UNT'), unz = only('UNZ'),
    first = wire.segments.indexOf(unh), last = wire.segments.indexOf(unt)
  expect(first).toBeGreaterThan(wire.segments.indexOf(unb)); expect(wire.segments.indexOf(uci)).toBeGreaterThan(first)
  expect(last).toBeGreaterThan(wire.segments.indexOf(uci)); expect(wire.segments.indexOf(unz)).toBe(last + 1)
  expect(wire.segments.indexOf(unz)).toBe(wire.segments.length - 1)
  expect(segmentComposite(unh, 2, wire.una)[0]).toBe('CONTRL')
  expect(segmentComposite(unt, 1, wire.una)).toEqual([String(last - first + 1)])
  expect(segmentComposite(unt, 2, wire.una)).toEqual(segmentComposite(unh, 1, wire.una))
  expect(segmentComposite(unz, 1, wire.una)).toEqual(['1'])
  expect(segmentComposite(unz, 2, wire.una)).toEqual([envelope.interchangeReference])
  expect(segmentComposite(unb, 2, wire.una)).toEqual(segmentComposite(sourceUnb, 3, sourceWire.una))
  expect(segmentComposite(unb, 3, wire.una)).toEqual(segmentComposite(sourceUnb, 2, sourceWire.una))
  expect(envelope).toMatchObject({ environment: 'test', testIndicator: '1', applicationReference: sourceEnvelope.applicationReference })
  expect(segmentComposite(uci, 1, wire.una)).toEqual([sourceEnvelope.interchangeReference!.slice(0, 14)])
  for (const i of [2, 3]) expect(segmentComposite(uci, i, wire.una)).toEqual(segmentComposite(sourceUnb, i, sourceWire.una))
  expect(segmentComposite(uci, 4, wire.una)).toEqual([syntaxDecision==='accepted'?'1':'4'])
  if(syntaxDecision==='accepted')for(const ucm of wire.segments.filter(segment=>segment.tag==='UCM')) {
    expect(segmentComposite(ucm,1,wire.una)).toEqual(segmentComposite(sourceWire.segments.find(segment=>segment.tag==='UNH'),1,sourceWire.una))
    expect(segmentComposite(ucm,3,wire.una)).toEqual(['1'])
  }
  expect(ack.immutable_payload_hash).toBe(digest(raw))
  const qualified = await readPersistedEdielTechnicalContrlBasis({ companyId: f.companyId, environment: 'test',
    ackMessageId: String(ack.id), expectedRawPayload: raw, actorUserId: f.actorUserId, phase: 'read' })
  expect(qualified.evidence).toMatchObject({ sourceMessageId: message.id, sourceHash: digest(message.raw_payload!),
    companyId: f.companyId, environment: 'test', syntaxDecision })
  const priorOutboxIds = new Set(before.durable.outboxes.map(o => o.id)), outboxes = after.durable.outboxes.filter(o => !priorOutboxIds.has(o.id))
  expect(outboxes).toHaveLength(1)
  expect(outboxes[0]).toMatchObject({ ediel_message_id: ack.id, company_id: f.companyId, environment: 'test',
    source_message_id: message.id, message_family: 'CONTRL', immutable_payload_hash: digest(raw), created_by: f.actorUserId })
  assertUnchangedCriticalRefusalGraph(before, after, [message.id, ack.id], [outboxes[0].id])
}
async function actualIncomingOmission(f:Fixture,original:Original,field:string,complete:string,control:Awaited<ReturnType<typeof ready>>) {
  expect(control.message.raw_payload).toBe(complete)
  await observedStage(`critical_negative_${field}_control_reread`,()=>reread(f,control))
  const originalBefore=sealed(original.id), controlBefore=sealed(control.message.id)
  const syntaxField=['207','208','227','233','262','250'].includes(field)
  const requiredPhysical=['311','314','209','223'].includes(field)
  const requiredHNegative=['210','260','226'].includes(field)
  const malformed=omit(freshPhysicalIdentity(complete),field), before=business(f),
    refusalBefore=field==='202'||field==='203'||syntaxField||requiredPhysical?criticalRefusalGraph(f,original,control.message.id):null,
    received=await observedStage(`critical_negative_${field}_public_intake`,()=>intake(f,malformed,'test',field==='312'))
  if(field==='202')expect(received.id).not.toBeNull()
  if(syntaxField||field==='203')expect(received.id).not.toBeNull()
  if(received.id===null) {
    console.error('H_NATIVE_FAILURE_STAGE',JSON.stringify({stage:'critical_negative_public_intake_returned_no_source',field,
      capturedErrorCount:received.birthErrors.length,parserFamilyProdat:received.mailbox.parsed.messageFamily==='PRODAT',
      parserCodeZ04:received.mailbox.parsed.messageCode==='Z04',parserCodeUnknown:received.mailbox.parsed.messageCode==='PRODAT_UNKNOWN',
      errors:received.birthErrors.slice(0,10).map(error=>{
        const own=record(error),code=own.code,message=String(own.message??''),guard=message.split(':')[0]
        return {code:typeof code==='string'&&/^[0-9A-Z]{5}$/.test(code)?code:null,
          guard:['canonical_inbound_rule_profile_resolution_failed','ediel_inbound_legal_context_required','ediel_historical_rule_pack_basis_unavailable'].includes(guard)?guard:null}
      })}))
    // No fabricated canonical source for a missing family/code/tenant header.
    // The positive before/after source and exact physical omission constrain
    // the actual first public owner; unrelated arbitrary errors never qualify.
    if(field==='312') {
      // Exact missing-version input has no prospective catalog witness. This
      // proves only its actual public birth refusal, never a born-source ACK.
      // The binder uses the retained receipt's database date, not Stockholm.
      const binderDate=sql<string>(`SELECT to_jsonb(received_at::date) FROM public.inbound_email_messages
        WHERE id=${literal(received.mailbox.inboundEmailMessageId)} AND company_id=${literal(f.companyId)}
          AND raw_edifact_payload=${literal(malformed)}`)
      expect(binderDate).toMatch(/^\d{4}-\d{2}-\d{2}$/)
      expect(received.birthErrors).toEqual([expect.objectContaining({code:'23514',
        message:`canonical_inbound_rule_profile_resolution_failed:PRODAT:Z04:${binderDate}:6`})])
      expect(sql<number>(`SELECT to_jsonb(count(*)) FROM public.ediel_messages
        WHERE company_id=${literal(f.companyId)} AND raw_payload=${literal(malformed)}`)).toBe(0)
    }
    else if(requiredPhysical) {
      expect(received.mailbox.parsed).toMatchObject({messageFamily:'PRODAT',messageCode:'Z04',rawPayload:malformed})
      expect(received.mailbox.sourcePayloadHash).toBe(digest(malformed))
      const custody=sql<{mail:Row;parse:Row;receiptDate:string}>(`SELECT jsonb_build_object('mail',to_jsonb(m),'parse',to_jsonb(p),
        'receiptDate',m.received_at::date) FROM public.inbound_email_messages m JOIN public.inbound_ediel_parse_results p
        ON p.inbound_email_message_id=m.id AND p.company_id=m.company_id
        WHERE m.id=${literal(received.mailbox.inboundEmailMessageId)} AND m.company_id=${literal(f.companyId)}
          AND p.id=${literal(received.mailbox.parseResultId)}`)
      expect(custody.mail).toMatchObject({id:received.mailbox.inboundEmailMessageId,mailbox_id:received.mailbox.mailboxId,
        company_id:f.companyId,environment:'test',raw_edifact_payload:malformed})
      expect(custody.parse).toMatchObject({id:received.mailbox.parseResultId,inbound_email_message_id:received.mailbox.inboundEmailMessageId,
        company_id:f.companyId,message_family:'PRODAT',message_code:'Z04',raw_payload:malformed})
      expect([digest(String(custody.mail.raw_edifact_payload)),digest(String(custody.parse.raw_payload))]).toEqual([digest(malformed),digest(malformed)])
      expect(custody.receiptDate).toMatch(/^\d{4}-\d{2}-\d{2}$/)
      expect(received.birthErrors).toEqual([expect.objectContaining({code:'23514',
        message:`canonical_inbound_rule_profile_resolution_failed:PRODAT:Z04:${custody.receiptDate}:6`})])
      expect(sql<number>(`SELECT to_jsonb(count(*)) FROM public.ediel_messages WHERE company_id=${literal(f.companyId)}
        AND raw_payload=${literal(malformed)}`)).toBe(0)
      expect(sql<number>(`SELECT to_jsonb(count(*)) FROM public.ediel_messages WHERE company_id=${literal(f.companyId)}
        AND inbound_email_message_id=${literal(received.mailbox.inboundEmailMessageId)}`)).toBe(0)
      assertUnchangedCriticalRefusalGraph(refusalBefore!,criticalRefusalGraph(f,original,control.message.id))
    }
    else if(field==='202') {
      expect(received.mailbox.parsed).toMatchObject({messageFamily:'PRODAT',messageCode:'PRODAT_UNKNOWN',rawPayload:malformed})
      expect(received.mailbox.sourcePayloadHash).toBe(digest(malformed))
      const custody=sql<{mail:Row;parse:Row;receiptDate:string}>(`SELECT jsonb_build_object('mail',to_jsonb(m),'parse',to_jsonb(p),
        'receiptDate',m.received_at::date) FROM public.inbound_email_messages m JOIN public.inbound_ediel_parse_results p
        ON p.inbound_email_message_id=m.id AND p.company_id=m.company_id
        WHERE m.id=${literal(received.mailbox.inboundEmailMessageId)} AND m.company_id=${literal(f.companyId)}
          AND p.id=${literal(received.mailbox.parseResultId)}`)
      expect(custody.mail).toMatchObject({id:received.mailbox.inboundEmailMessageId,mailbox_id:received.mailbox.mailboxId,
        company_id:f.companyId,environment:'test',raw_edifact_payload:malformed})
      expect(custody.parse).toMatchObject({id:received.mailbox.parseResultId,inbound_email_message_id:received.mailbox.inboundEmailMessageId,
        company_id:f.companyId,message_family:'PRODAT',message_code:'PRODAT_UNKNOWN',raw_payload:malformed})
      expect(custody.receiptDate).toMatch(/^\d{4}-\d{2}-\d{2}$/)
      expect(received.birthErrors).toEqual([expect.objectContaining({code:'23514',
        message:`canonical_inbound_rule_profile_resolution_failed:PRODAT:PRODAT_UNKNOWN:${custody.receiptDate}:0`})])
      expect(sql<number>(`SELECT to_jsonb(count(*)) FROM public.ediel_messages WHERE company_id=${literal(f.companyId)}
        AND raw_payload=${literal(malformed)}`)).toBe(0)
      expect(sql<number>(`SELECT to_jsonb(count(*)) FROM public.ediel_messages WHERE company_id=${literal(f.companyId)}
        AND inbound_email_message_id=${literal(received.mailbox.inboundEmailMessageId)}`)).toBe(0)
      assertUnchangedCriticalRefusalGraph(refusalBefore!,criticalRefusalGraph(f,original,control.message.id))
    }
    else {
      expect(['311','207','208','223','226','209','210','260']).toContain(field)
      expect(received.birthErrors).toEqual(expect.arrayContaining([expect.objectContaining({code:'P0001'})]))
      expect(received.birthErrors.every(e=>String(e.message)==='ediel_inbound_legal_context_required'
        ||String(e.message).startsWith('canonical_inbound_rule_profile_resolution_failed:'))).toBe(true)
    }
  } else {
    expect(received.id).not.toBe(control.message.id)
    const message=(await observedStage(`critical_negative_${field}_read_born_message`,()=>getEdielMessageById(received.id!)))!
    expect(message.raw_payload).toBe(malformed); expect(record(message).immutable_payload_hash).toBe(digest(malformed))
    if(requiredPhysical)expect(message).toMatchObject({company_id:f.companyId,environment:'test',direction:'inbound',inbound_email_message_id:received.mailbox.inboundEmailMessageId})
    if(field==='202') {
      const physical=tokenizeEdifact(message.raw_payload!),bgm=physical.segments.filter(segment=>segment.tag==='BGM')
      expect(bgm).toHaveLength(1);expect(segmentComposite(bgm[0],1,physical.una)).toEqual([''])
      expect(message).toMatchObject({company_id:f.companyId,environment:'test',direction:'inbound',message_code:'PRODAT_UNKNOWN',
        inbound_email_message_id:received.mailbox.inboundEmailMessageId})
      expect(received.mailbox.parsed).toMatchObject({messageFamily:'PRODAT',messageCode:'PRODAT_UNKNOWN',rawPayload:malformed})
      expect(message.parsed_payload).toEqual(received.mailbox.parsed)
      expect(sql(`SELECT jsonb_build_object('bound',gridex_ediel_header_negative_birth.is_bound_v1(m,false),
        'status',r.status,'field',r.evidence#>>'{negativeField,fieldCode}','authorizesBusinessEffect',r.evidence->'authorizesBusinessEffect')
        FROM public.ediel_messages m JOIN gridex_ediel_header_negative_birth.receipts r ON r.source_message_id=m.id
        WHERE m.id=${literal(message.id)} AND m.company_id=${literal(f.companyId)}`))
        .toEqual({bound:true,status:'consumed',field:'202',authorizesBusinessEffect:false})
    }
    const sourceBefore=syntaxField||field==='203'?sealed(message.id):null
    const decision=await observedStage(`critical_negative_${field}_canonical_decision`,()=>resolveCanonicalRuntimeDecisionWithRegistry(message,{actorUserId:f.actorUserId}))
    expect(decision.applicationDecision,JSON.stringify(decision)).not.toBe('accepted')
    const fieldError=decision.issues.some(i=>i.prodatDiagnostic?.kind==='field'&&i.prodatDiagnostic.fieldNumber===field)
    if(syntaxField)expect(fieldError).toBe(false)
    if(!fieldError) {
      if(['208','227','233','262','250'].includes(field)) {
        // Failure feedback from this already computed decision; planned replies
        // are not evidence that physical ACKs or later effects were reached.
        console.error('H_NATIVE_FAILURE_STAGE',JSON.stringify({
          stage:`critical_negative_${field}_canonical_summary`,field,
          syntaxRejected:decision.syntaxDecision==='rejected',
          applicationNotApplicable:decision.applicationDecision==='not_applicable',
          functionalNotApplicable:decision.functionalDecision==='not_applicable',
          issueCount:decision.issues.length,syntaxIssueCount:decision.issues.filter(i=>i.layer==='syntax').length,
          mandatoryNad3039:decision.issues.some(i=>i.layer==='syntax'&&i.severity==='error'
            &&i.code==='UNSM_MANDATORY_ELEMENT_MISSING'
            &&i.description==='PRODAT:D:97A:UN: obligatoriskt NAD/C082/3039[1] saknas.'),
          negativeContrlPlanCount:decision.responsePlan.filter(p=>p.family==='CONTRL'&&p.outcome==='negative').length,
          negativeAperakPlanCount:decision.responsePlan.filter(p=>p.family==='APERAK'&&p.outcome==='negative').length,
          positiveAperakPlanCount:decision.responsePlan.filter(p=>p.family==='APERAK'&&p.outcome==='positive').length,
          sourceHashMatches:record(message).immutable_payload_hash===digest(message.raw_payload!),
        }))
      }
    }
    if(syntaxField) {
      expect(message).toMatchObject({company_id:f.companyId,direction:'inbound',environment:'test',
        inbound_email_message_id:received.mailbox.inboundEmailMessageId})
      expect([decision.syntaxDecision,decision.applicationDecision,decision.functionalDecision]).toEqual(['rejected','not_applicable','not_applicable'])
      const syntax=validateEdifactSyntax(message),description='PRODAT:D:97A:UN: obligatoriskt NAD/C082/3039[1] saknas.'
      expect(syntax).toMatchObject({ok:false,grammarQualification:'qualified',issues:[expect.objectContaining({
        code:'UNSM_MANDATORY_ELEMENT_MISSING',severity:'error',description})]})
      expect(decision.issues).toEqual([expect.objectContaining({layer:'syntax',severity:'error',
        code:'UNSM_MANDATORY_ELEMENT_MISSING',description,source:'validateEdifactSyntax'})])
      expect(decision.responsePlan).toEqual([{family:'CONTRL',outcome:'negative',reason:description}])
      if(field==='208') {
        // The actual current protected reader denies missing local legal identity.
        // Keep that exact refusal; it is neither a NULL capability nor ACK proof.
        await expect(observedStage(`critical_negative_${field}_read_capability`,()=>readSourceQualifiedProdatBilateralCapability(message)))
          .rejects.toMatchObject({code:'P0001',message:'ediel_inbound_legal_context_required'})
      } else if(['227','233','262','250'].includes(field)) {
        const capability=await observedStage(`critical_negative_${field}_read_capability`,()=>readSourceQualifiedProdatBilateralCapability(message))
        expect(control.capability).not.toBeNull();expect(capability).not.toBeNull()
        expect(capability).toEqual({...control.capability,sourceMessageId:message.id,sourcePayloadHash:digest(message.raw_payload!)})
      } else {
        expect(await observedStage(`critical_negative_${field}_read_capability`,()=>readSourceQualifiedProdatBilateralCapability(message))).toBeNull()
      }
    } else if(!fieldError&&!requiredPhysical) {
      expect(['311','312','202','207','208','223','226','209','210','260']).toContain(field)
      expect(await observedStage(`critical_negative_${field}_read_capability`,()=>readSourceQualifiedProdatBilateralCapability(message))).toBeNull()
      expect(JSON.stringify(decision)).toContain('prodat_bilateral_capability_required:Z04:H')
    }
    if(field==='203') {
      // P p90 A255 is mandatory. An absent physical BGM1004 cannot be
      // replaced with UNH, UUID or a generated ACW; the original stays held.
      expect(decision).toMatchObject({syntaxDecision:'accepted',applicationDecision:'rejected'})
      expect(decision.prodatApplicationValidation?.headerDecision).not.toBe('accepted')
      expect(fieldError).toBe(true)
      const plans=decision.responsePlan.filter(plan=>plan.family==='APERAK'&&plan.outcome==='negative')
      expect(plans).toHaveLength(1)
      expect(plans[0].applicationErrors).toEqual(expect.arrayContaining([expect.objectContaining({fieldCode:'203',ercCode:'41',
        prodatFieldDiagnostic:expect.objectContaining({kind:'field',fieldNumber:'203',errorKind:'missing'})})]))
      expect(segmentComposite(tokenizeEdifact(malformed).segments.find(segment=>segment.tag==='BGM'),2)).toEqual([''])
      expect(()=>buildAperakDraft({actorUserId:f.actorUserId,sourceMessage:message,outcome:'negative',applicationErrors:plans[0].applicationErrors}))
        .toThrow('aperak_prodat_document_reference_required')
    }
    await observedStage(`critical_negative_${field}_actual_processor`,()=>processInboundEdielMessage({actorUserId:f.actorUserId,edielMessageId:message.id}))
    if(syntaxField) {
      expect(sealed(message.id)).toEqual(sourceBefore)
      await observedStage(`critical_negative_${field}_actual_technical_reply`,()=>actualSyntaxReply(f,message,refusalBefore!,
        criticalRefusalGraph(f,original,control.message.id),'rejected'))
    } else if(field==='203') {
      const custody=sql<{mail:Row;parse:Row}>(`SELECT jsonb_build_object('mail',to_jsonb(m),'parse',to_jsonb(p))
        FROM public.inbound_email_messages m JOIN public.inbound_ediel_parse_results p ON p.inbound_email_message_id=m.id
        WHERE m.id=${literal(received.mailbox.inboundEmailMessageId)} AND m.company_id=${literal(f.companyId)}
          AND p.id=${literal(received.mailbox.parseResultId)} AND p.company_id=m.company_id`)
      expect(custody.mail).toMatchObject({id:received.mailbox.inboundEmailMessageId,mailbox_id:received.mailbox.mailboxId,
        company_id:f.companyId,environment:'test',raw_edifact_payload:malformed})
      expect(custody.parse).toMatchObject({id:received.mailbox.parseResultId,inbound_email_message_id:received.mailbox.inboundEmailMessageId,
        company_id:f.companyId,message_family:'PRODAT',message_code:'Z04',raw_payload:malformed})
      expect(received.mailbox.parsed).toMatchObject({messageFamily:'PRODAT',messageCode:'Z04',rawPayload:malformed,bgmReference:null})
      expect(received.mailbox.sourcePayloadHash).toBe(digest(malformed))
      const originalProjection=(value:unknown)=>{const own=record(value);return Object.fromEntries(
        ['id','raw','hash','company','direction','environment','receivedAt','canonical','execution','inbound'].map(key=>[key,own[key]]))}
      expect(originalProjection(sealed(message.id))).toEqual(originalProjection(sourceBefore))
      expect(Date.parse(String(record(sealed(message.id)).receivedAt))).toBe(Date.parse(String(custody.mail.received_at)))
      await observedStage('critical_negative_203_actual_technical_reply',()=>actualSyntaxReply(f,message,refusalBefore!,
        criticalRefusalGraph(f,original,control.message.id),'accepted'))
      const acks=await observedStage('critical_negative_203_list_physical_ack',()=>listBusinessAckMessagesForSource({
        companyId:f.companyId,sourceMessageId:message.id,actorUserId:f.actorUserId,environment:'test'}))
      expect(acks.map(ack=>ack.message_family)).toEqual(['CONTRL'])
      const blocked=sql<Row[]>(`SELECT coalesce(jsonb_agg(to_jsonb(e)),'[]') FROM public.ediel_message_events e
        WHERE e.company_id=${literal(f.companyId)} AND e.ediel_message_id=${literal(message.id)}
          AND e.event_type='manual_note' AND e.event_status='warning'
          AND e.message='APERAK skapades inte: aperak_prodat_document_reference_required'
          AND e.event_payload->>'blockedBy'='canonical_inbound_ack_guard' AND e.event_payload->>'ackFamily'='APERAK'
          AND e.event_payload->>'sourceMessageId'=${literal(message.id)} AND e.created_by=${literal(f.actorUserId)}`)
      expect(blocked.length,'Actual missing203 retains its explicit A255 correlation hold').toBeGreaterThan(0)
      const after=criticalRefusalGraph(f,original,control.message.id),sourceAfter=sealed(message.id)
      await observedStage('critical_negative_203_actual_processor_replay',()=>processInboundEdielMessage({actorUserId:f.actorUserId,edielMessageId:message.id}))
      expect(await observedStage('critical_negative_203_replay_physical_ack',()=>listBusinessAckMessagesForSource({
        companyId:f.companyId,sourceMessageId:message.id,actorUserId:f.actorUserId,environment:'test'}))).toEqual(acks)
      expect(originalProjection(sealed(message.id))).toEqual(originalProjection(sourceAfter))
      assertUnchangedCriticalRefusalGraph(after,criticalRefusalGraph(f,original,control.message.id))
    } else if(requiredPhysical||requiredHNegative) {
      await observedStage(`critical_negative_${field}_assert_negative_ack`,()=>negativeAcknowledgement(f,message,decision,field))
    } else {
      const acks=await observedStage(`critical_negative_${field}_list_physical_ack`,()=>listBusinessAckMessagesForSource({companyId:f.companyId,sourceMessageId:message.id,actorUserId:f.actorUserId,environment:'test'}))
      expect(acks.filter(a=>a.message_family==='APERAK'&&a.ack_outcome==='positive')).toEqual([])
      if(fieldError) {
        // National refusal is not credited from a separately recomputed plan:
        // any prescribed negative APERAK must exist as protected physical bytes.
        if(decision.responsePlan.some(p=>p.family==='APERAK'&&p.outcome==='negative')) {
          await observedStage(`critical_negative_${field}_assert_negative_ack`,()=>negativeAcknowledgement(f,message,decision,field))
        }
      }
    }
  }
  expect(business(f)).toEqual(before); expect(sealed(original.id)).toEqual(originalBefore)
  // The control was not applied and must remain the same immutable source.
  expect(sealed(control.message.id)).toEqual(controlBefore); await observedStage(`critical_negative_${field}_final_control_reread`,()=>reread(f,control))
  // CV-P-HEADER still requires a physical negative P-APERAK for missing 202.
  // NULL custody/no effects prove refusal only; they cannot satisfy that reply.
  if(requiredHNegative)expect(received.id,
    `P26.A required${field} needs an actual source-bound physical ERC41 negative APERAK`).not.toBeNull()
  if(field==='202')expect(received.id,
    'CV-P-HEADER missing202 requires actual source-bound negative P-APERAK BGM27/ERC41/field202; public birth returned no source').not.toBeNull()
  if(requiredPhysical)expect(received.id,
    `CV-P-HEADER/P-17 or CV-P-OBJECT missing${field} requires actual source-bound physical negative P-APERAK; public birth returned no source`).not.toBeNull()
}
// Actual national value gate, followed by the separate physical/private/replay
// contract only when every strict source-owned rejection assertion succeeds.
async function actualIncomingInvalidInstallationStatusGate(f:Fixture,original:Original,complete:string,
  control:Awaited<ReturnType<typeof ready>>) {
  expect(control.message.raw_payload).toBe(complete)
  await reread(f,control)
  const before=business(f),originalBefore=sealed(original.id),controlBefore=sealed(control.message.id),sends=smtp.send.mock.calls.length
  const valid=freshPhysicalIdentity(complete),parts=rawParts(valid)
  const first=parts.findIndex(p=>p[0]==='LIN')
  expect(first).toBeGreaterThanOrEqual(0)
  expect(component(parts[first],3)).toBe(f.external)
  expect(component(parts[first],3,3)).toBe('9')
  const boundary=parts.slice(first+1).findIndex(p=>p[0]==='LIN'||p[0]==='UNT')
  expect(boundary).toBeGreaterThanOrEqual(0)
  const local=parts.slice(first,first+1+boundary)
  const statuses=local.flatMap((p,i)=>p[0]==='CCI'&&component(p,2)==='Z07'?[first+i]:[])
  expect(statuses).toHaveLength(1)
  const valueIndex=statuses[0]+1,cav=parts[valueIndex]
  expect(cav[0]).toBe('CAV');expect(component(cav,1)).toBe('Z12')
  const values=typeof cav[1]==='string'?[cav[1]]:[...cav[1]]
  const invalidParts=parts.map((p,i)=>i===valueIndex?['CAV',['E22',...values.slice(1)],...p.slice(2)] as Parts:p)
  const invalid="UNA:+.? '"+invalidParts.map(render).join("'")+"'"
  expect(rawParts(invalid)).toEqual(parts.map((p,i)=>i===valueIndex?['CAV',values.length===1?'E22':['E22',...values.slice(1)],...p.slice(2)]:p))
  expect("UNA:+.? '"+rawParts(invalid).map((p,i)=>render(i===valueIndex?cav:p)).join("'")+"'").toBe(valid)
  const received=await observedStage('critical_negative_invalid306_actual_public_intake',()=>intake(f,invalid))
  expect(received.tenant).toMatchObject({status:'resolved',companyId:f.companyId})
  expect(received.id).not.toBeNull()
  const message=(await getEdielMessageById(received.id!,{companyId:f.companyId}))!
  expect(message).toMatchObject({company_id:f.companyId,environment:'test',direction:'inbound',raw_payload:invalid,
    immutable_payload_hash:digest(invalid),inbound_email_message_id:received.mailbox.inboundEmailMessageId,
    rule_profile_key:'PRODAT:Z04:H:26.A:r3'})
  expect(received.mailbox.sourcePayloadHash).toBe(digest(invalid))
  const sourceBefore=sealed(message.id)
  const capability=await observedStage('critical_negative_invalid306_current_process_capability',()=>readSourceQualifiedProdatBilateralCapability(message))
  expect(capability).toMatchObject({companyId:f.companyId,environment:'test',sourceMessageId:message.id,sourcePayloadHash:digest(invalid),
    subtype:'H',owner:'immutable-bilateral-prodat-profile-v1',objects:[expect.objectContaining({profileVersionId:f.profileVersionId,
      process:'normal_start_h',objectId:f.external,identityAgency:'9',lineItemReference:own(f,original).li})]})
  const decision=await observedStage('critical_negative_invalid306_actual_application_gate',()=>resolveCanonicalRuntimeDecisionWithRegistry(message))
  const matching=decision.issues.filter(issue=>issue.layer==='application'&&issue.severity==='error'
    &&issue.prodatDiagnostic?.kind==='field'&&issue.prodatDiagnostic.fieldNumber==='306'&&issue.prodatDiagnostic.errorKind==='invalid')
  const errors=decision.responsePlan.filter(p=>p.family==='APERAK'&&p.outcome==='negative')
    .flatMap(p=>p.applicationErrors??[]).filter(e=>e.fieldCode==='306'&&e.ercCode==='42')
  const closed=(value:unknown)=>typeof value==='string'&&['accepted','rejected','not_applicable','manual_review'].includes(value)?value:null
  console.error('H_NATIVE_INVALID306_GATE',JSON.stringify({stage:'invalid306_actual_application_gate',
    syntax:closed(decision.syntaxDecision),application:closed(decision.applicationDecision),functional:closed(decision.functionalDecision),
    matchingInvalid306:matching.length>0,plannedERC42Count:errors.length}))
  expect(business(f)).toEqual(before);expect(sealed(original.id)).toEqual(originalBefore)
  expect(sealed(control.message.id)).toEqual(controlBefore);expect(sealed(message.id)).toEqual(sourceBefore)
  expect(smtp.send.mock.calls.length).toBe(sends)
  await reread(f,control)
  expect([decision.syntaxDecision,decision.applicationDecision,decision.functionalDecision],
    'Original field306 invalid E22 requires actual national application rejection; whole physical response/effects/replay remain separate unproved criteria')
    .toEqual(['accepted','rejected','accepted'])
  expect(matching.length).toBeGreaterThan(0)
  expect(errors).toEqual([expect.objectContaining({fieldCode:'306',ercCode:'42',text:'Felaktigt Installationsstatus E22',
    referenceNumber:f.external,lineItemReference:own(f,original).li})])
  // Downstream physical/private/effect/replay contract runs only after every
  // unchanged strict native invalid306 gate above has actually succeeded.
  await assertInvalid306NativeContract({companyId:f.companyId,actorUserId:f.actorUserId,point:f.external,
    li:own(f,original).li,source:message,decision,business:()=>business(f),
    durable:()=>durable(f,original,control.message.id),sourceSeal:()=>sealed(message.id),
    rereadControl:()=>reread(f,control),negativeAcknowledgement:()=>negativeAcknowledgement(f,message,decision,'306'),
    smtpCalls:()=>smtp.send.mock.calls.length})
}

async function actualOutboundOmission(f:Fixture,original:Original,field:string,malformed:string) {
  const qualified=await qualifyPersistedBilateralProdatOutboundOriginal(original,f.actorUserId)
  const context=await loadCustomerMasterdataValidationContext(original,f.actorUserId)
  expect(context).toBeDefined()
  const baseInput={...qualified.draft,customerId:f.customerId,meteringPointId:f.pointId,siteId:f.siteId,
    intentId:original.intent_id!,sourceOperationId:f.switchId,outboundRequestId:original.outbound_request_id!,
    communicationRouteId:original.communication_route_id!,routeProfileId:original.route_profile_id!,
    senderEdielId:original.sender_ediel_id,receiverEdielId:original.receiver_ediel_id,
    receiverEmail:original.receiver_email,applicationReference:original.application_reference,parsedPayload:original.parsed_payload??{}}
  const before=business(f), originalBefore=sealed(original.id), messages=rows('public.ediel_messages',f.companyId), outboxes=rows('public.ediel_outbox',f.companyId)
  // An actual public replay of the own positive source is the control. Its
  // immutable intent/context cannot be repurposed for a malformed draft.
  const replay=await createCanonicalOutboundMessage({actorUserId:f.actorUserId,requestType:'supplier_switch',baseInput,customerMasterdataContext:context})
  expect(replay.id).toBe(original.id)
  let refusal:unknown
  try {await createCanonicalOutboundMessage({actorUserId:f.actorUserId,requestType:'supplier_switch',baseInput:{...baseInput,rawPayload:malformed},customerMasterdataContext:context})}
  catch(error){refusal=error}
  expect(refusal,`R${field} must not persist`).toBeDefined()
  const message=refusal instanceof Error?refusal.message:String(record(refusal).message??'')
  if(field==='314')expect(message).toBe('bilateral_prodat_outbound_whole_physical_scope_required')
  else expect(message).toMatch(/^(bilateral_prodat_outbound_current_profile_required|customer_masterdata_source_context_mismatch|prodat_register_evidence_invalid|prodat_subtype_unknown:missing|Outbound PRODAT Z03 blockerades av canonical Ediel-policy:)/)
  expect(business(f)).toEqual(before); expect(sealed(original.id)).toEqual(originalBefore)
  expect(rows('public.ediel_messages',f.companyId)).toEqual(messages); expect(rows('public.ediel_outbox',f.companyId)).toEqual(outboxes)
}

describe('actual native H catalog component only; no admission or bilateral authority',()=>{
  const input=(multipleRegisters=false)=>{
    const refs=references(), body:Parts[]=[['BGM','Z04',refs.document,'9','AB'],line('1','735123456789012345',multipleRegisters?'1':undefined,'9'),
      ...characteristic('Z13','Z25'),...(multipleRegisters?[line('2','735123456789012345','2','9')]:[])]
    return {rawPayload:frame(body,'60000','40000',refs),receivedAt:refs.createdAt.toISOString()}
  }
  it('returns exactly six installed catalog witnesses equal to the independent current RPC',async()=>{
    const source=input(), actual=await resolveBilateralSwitchBirthProfile(source)
    expect(actual).not.toBeNull()
    const response=await supabaseService.rpc('resolve_canonical_ediel_rule_pack_with_witness_v1',{p_market:'electricity',p_family:'PRODAT',
      p_message_code:'Z04',p_transaction_subtype:'H',p_direction:'inbound',p_business_date:stockholmBusinessDate(new Date(source.receivedAt))})
    expect(response.error).toBeNull()
    const witnesses=Array.isArray(response.data)?response.data:response.data?[response.data]:[]
    expect(witnesses).toHaveLength(1); const witness=record(witnesses[0])
    expect(actual).toEqual({canonical_rule_pack_id:witness.rule_pack_id,rule_profile_key:witness.profile_key,
      rule_profile_version_id:witness.message_profile_id,rule_profile_version:witness.original_version,rule_pack_checksum:witness.source_hash,
      rule_pack_snapshot:{...record(witness.original_snapshot),profileKey:witness.profile_key,profileVersionId:witness.message_profile_id,
        version:witness.original_version,checksum:witness.source_hash}})
    const profile=await supabaseService.from('ediel_message_profiles').select('id,rule_pack_id,profile_key,message_code,is_enabled').eq('id',actual!.rule_profile_version_id).single()
    expect(profile.error).toBeNull(); expect(profile.data).toMatchObject({id:actual!.rule_profile_version_id,rule_pack_id:actual!.canonical_rule_pack_id,
      profile_key:'PRODAT:Z04:H:26.A:r3',message_code:'Z04',is_enabled:true})
  })
  it('uses actual physical later-register inheritance without a repeated reason',async()=>{
    const result=await resolveBilateralSwitchBirthProfile(input(true))
    expect(result).toMatchObject({rule_profile_key:'PRODAT:Z04:H:26.A:r3'})
  })
  it('qualifies neither a mixed object reason nor malformed physical object209',async()=>{
    const source=input(), refs=references(), body:Parts[]=[['BGM','Z04',refs.document,'9','AB'],line('1','735123456789012345',undefined,'9'),
      ...characteristic('Z13','Z25'),line('2','735123456789012346',undefined,'9'),...characteristic('Z13','Z22')]
    expect(await resolveBilateralSwitchBirthProfile({...source,rawPayload:frame(body,'60000','40000',refs)})).toBeNull()
    expect(await resolveBilateralSwitchBirthProfile({...source,rawPayload:omit(source.rawPayload,'209')})).toBeNull()
  })
  it('requires the actual UNH association to equal its independently selected catalog',async()=>{
    const source=input(); expect(await resolveBilateralSwitchBirthProfile(source)).not.toBeNull()
    await expect(resolveBilateralSwitchBirthProfile({...source,rawPayload:source.rawPayload.replace('PRODAT:D:97A:UN:E2SE6A','PRODAT:D:97A:UN:E2SE6B')}))
      .rejects.toThrow('bilateral_switch_birth_association_mismatch')
  })
})

describe('H actual public chain proposals; whole NOT_EXECUTED', () => {
  it('applies only the archived own H transition after SMTP request acceptance, then physical ACK and durable replay', async () => {
    const { f, original } = await sent(), received = await ready(f, original), before = business(f)
    const origin = sql<Row>(`SELECT to_jsonb(o) FROM gridex_bilateral_prodat.origins o WHERE ground_id=${literal(f.profileVersionId)}`)
    const artifact = await readBilateralProdatGroundBytes({ companyId:f.companyId,actorUserId:f.actorUserId,artifactId:String(origin.artifact_id) })
    expect(artifact.sourceHash).toBe(f.sourceHash); expect(Buffer.from(artifact.bytes)).toEqual(f.bytes)
    const profile = sql<Row>(`SELECT to_jsonb(p) FROM gridex_bilateral_prodat.profile_versions p WHERE id=${literal(f.profileVersionId)}`)
    expect(profile).toMatchObject({ process:'normal_start_h', approved_by:f.reviewer, environment:'test', source_sha256:f.sourceHash })
    expect(Date.parse(String(profile.approved_at))).toBeLessThanOrEqual(Date.parse(received.message.message_received_at!))
    expect(rows('gridex_bilateral_prodat.source_capability_receipts',f.companyId,'source_message_id')).toEqual([])
    const sourceBefore = sealed(received.message.id), originalBefore = sealed(original.id)
    const firstBefore = business(f), startedAt = Date.now()
    await processInboundEdielMessage({ actorUserId:f.actorUserId,edielMessageId:received.message.id })
    const completedAt = Date.now(), after = business(f)
    expect(after.periods,after.periods.length===before.periods.length+1 ? undefined
      : JSON.stringify(effectFailureDiagnostic(f.companyId,received.message.id))).toHaveLength(before.periods.length + 1)
    expect(after.periods).toEqual(expect.arrayContaining([expect.objectContaining({ source_message_id:received.message.id,
      source_switch_request_id:f.switchId,customer_id:f.customerId,metering_point_id:f.pointId,contract_id:f.contractId,
      status:'confirmed_by_grid_owner',start_date:f.requestedStartDate,market_state_version:1 })]))
    expect(after.bilateral).toEqual([expect.objectContaining({ source_message_id:received.message.id,payload_hash:digest(received.message.raw_payload!),
      profiles:[expect.objectContaining({ profileVersionId:f.profileVersionId,process:'normal_start_h',sourceHash:f.sourceHash })] })])
    expect(after.confirmations).toEqual([expect.objectContaining({ source_message_id:received.message.id,original_message_id:original.id,
      switch_id:f.switchId,original_payload_hash:digest(original.raw_payload!) })])
    expect(after.transitions).toHaveLength(1); expect(after.activations).toEqual(before.activations)
    assertFirstHBusinessDelta(f, original, received.message.id, received.message.raw_payload!, firstBefore, after, startedAt, completedAt)
    const capabilities=rows('gridex_bilateral_prodat.source_capability_receipts',f.companyId,'source_message_id')
    expect(capabilities,capabilities.length===1 ? undefined
      : JSON.stringify(effectFailureDiagnostic(f.companyId,received.message.id))).toEqual([expect.objectContaining({source_message_id:received.message.id,company_id:f.companyId,
      environment:'test',source_payload_hash:digest(received.message.raw_payload!),
      positive_objects:[expect.objectContaining({profileVersionId:f.profileVersionId,process:'normal_start_h',
        objectId:f.external,pointId:f.pointId,lineItemReference:own(f,original).li,
        supplyPeriodId:String(after.periods.find(p=>p.source_message_id===received.message.id)!.id)})]})])
    expect(sql<boolean>(`SELECT to_jsonb(r.assessment_id=a.id AND r.source_payload_hash=a.source_payload_hash
      AND r.object_facts_hash=f.facts_hash AND r.business_transition_hash=encode(sha256(convert_to(to_jsonb(t)::text,'UTF8')),'hex'))
      FROM gridex_bilateral_prodat.source_capability_receipts r
      JOIN gridex_received_sources.validation_assessments a ON a.id=r.assessment_id AND a.source_message_id=r.source_message_id
      JOIN gridex_received_sources.prodat_object_validation_facets f ON f.source_message_id=r.source_message_id AND f.assessment_id=r.assessment_id AND f.company_id=r.company_id AND f.environment=r.environment
      JOIN gridex_received_sources.supply_source_transitions t ON t.source_message_id=r.source_message_id
      WHERE r.source_message_id=${literal(received.message.id)} AND r.company_id=${literal(f.companyId)}`)).toBe(true)
    // Only technical ACK deadlines exist here. The signed scope supplies its
    // validity and grammar, not an invented L14/LK0 or Z04L3 business timer.
    const timers=sql<Row[]>(`SELECT coalesce(jsonb_agg(to_jsonb(t) ORDER BY timer_type),'[]') FROM public.ediel_sla_timers t
      WHERE ediel_message_id=${literal(received.message.id)}`)
    expect(timers.map(t=>t.timer_type).sort()).toEqual(['aperak_due','contrl_due'])
    for(const timer of timers) expect(Date.parse(String(timer.due_at))).toBe(Date.parse(received.message.message_received_at!)+EDIEL_ACK_DEADLINE_MINUTES*60000)
    expect(sealed(original.id)).toEqual(originalBefore)
    const sealedAfter = record(sealed(received.message.id)), prior = record(sourceBefore)
    for (const key of ['id','raw','hash','company','direction','environment','receivedAt','canonical','execution','inbound','source']) expect(sealedAfter[key]).toEqual(prior[key])
    await acknowledgements(f,original,received.message.id,received.message.raw_payload!)
    const frozen = durable(f,original,received.message.id)
    await processInboundEdielMessage({ actorUserId:f.actorUserId,edielMessageId:received.message.id })
    expect(durable(f,original,received.message.id)).toEqual(frozen)
    const outcomes = await Promise.allSettled([1,2].map(() => processInboundEdielMessage({ actorUserId:f.actorUserId,edielMessageId:received.message.id })))
    expect(outcomes.filter(o => o.status === 'rejected'), JSON.stringify(outcomes)).toEqual([])
    expect(durable(f,original,received.message.id)).toEqual(frozen)
  })

  it('known Z25 and catalog alone cannot originate an H request without the actual archived profile', async () => {
    const f = await prospective(), before = business(f), sends = smtp.send.mock.calls.length
    await expect(originate(f)).rejects.toThrow('bilateral_prodat_switch_current_profile_required')
    expect(business(f)).toEqual(before); expect(smtp.send.mock.calls.length).toBe(sends)
    expect(rows('public.ediel_messages',f.companyId)).toEqual([])
  })

  it('archive without independent review remains unable to originate the H request', async () => {
    const f = await createBilateralProdatGroundNativeFixture(await prospective())
    const archived = await archiveBilateralProdatGround({companyId:f.companyId,actorUserId:f.actorUserId,...f.signed()})
    expect(archived.status).toBe('archived')
    const before = business(f)
    await expect(originate(f)).rejects.toThrow('bilateral_prodat_switch_current_profile_required')
    expect(business(f)).toEqual(before); expect(rows('gridex_bilateral_prodat.profile_versions',f.companyId)).toEqual([])
  })

  it('rejected separate review authorizes no default H business transition', async () => {
    const f = await createBilateralProdatGroundNativeFixture(await prospective()), a = await archiveBilateralProdatGround({companyId:f.companyId,actorUserId:f.actorUserId,...f.signed()})
    const rejected = await reviewBilateralProdatGround({companyId:f.companyId,actorUserId:f.reviewer,artifactId:String(a.artifactId),
      sourceHash:String(a.sourceHash),scopeHash:String(a.scopeHash),decision:'reject',reason:'Explicit synthetic reviewer rejection'})
    expect(rejected.status).not.toBe('authorized')
    const before = business(f); await expect(originate(f)).rejects.toThrow('bilateral_prodat_switch_current_profile_required')
    expect(business(f)).toEqual(before); expect(rows('gridex_bilateral_prodat.profile_versions',f.companyId)).toEqual([])
  })

  for (const code of ['Z03','Z04'] as const) it.each(required[code])(`${code} R%s missing is a native registry field refusal with no business/provider effects`, async field => {
    const { f, original } = await sent(), baselineRaw = code === 'Z03' ? original.raw_payload! : reply(f,original)
    // This native negative seam is the actual selected registry field consumer.
    // It is not a claim that an already persisted original can be rewritten.
    const baseline = code==='Z04'? await ready(f,original,baselineRaw):await validateRulebookMessageWithRegistry({family:'PRODAT',code,direction:'outbound',
      environment:'test',companyId:f.companyId,rawPayload:baselineRaw,mode:'send',messageRow:original,executionActorUserId:f.actorUserId,
      parsedPayload:original.parsed_payload,customerMasterdataContext:await loadCustomerMasterdataValidationContext(original,f.actorUserId)})
    const policy='decision' in baseline?baseline.decision.policy:baseline.canonicalPolicy
    expect(policy,JSON.stringify(baseline)).toBeDefined(); if(!policy)throw Error('actual_h_field_policy_required')
    expect(validateCanonicalPolicyFields({policy,rawPayload:baselineRaw,rawSegments:tokenizeEdifact(baselineRaw).segments.map(s=>s.raw)}).filter(i=>i.blocking||i.severity==='error')).toEqual([])
    const malformed = omit(baselineRaw,field), before = business(f), immutable = sealed(original.id), sends = smtp.send.mock.calls.length
    const issues = validateCanonicalPolicyFields({policy,rawPayload:malformed,rawSegments:tokenizeEdifact(malformed).segments.map(s=>s.raw)})
    expect(issues,JSON.stringify(issues)).toEqual(expect.arrayContaining([expect.objectContaining({prodatDiagnostic:expect.objectContaining({kind:'field',fieldNumber:field})})]))
    expect(issues.some(i=>(i.blocking||i.severity==='error')&&i.prodatDiagnostic?.kind==='field'&&i.prodatDiagnostic.fieldNumber===field)).toBe(true)
    expect(business(f)).toEqual(before); expect(sealed(original.id)).toEqual(immutable); expect(smtp.send.mock.calls.length).toBe(sends)
    if(code==='Z04') {
      if(!('decision' in baseline))throw Error('actual_h_incoming_control_required')
      await actualIncomingOmission(f,original,field,baselineRaw,baseline)
      if(field==='306')await actualIncomingInvalidInstallationStatusGate(f,original,baselineRaw,baseline)
    } else await actualOutboundOmission(f,original,field,malformed)
  })

  it.each(['250','251','252','253','317','318'])('selected actual Z04 IV parent activates child %s and refuses its omission', async field => {
    const {f,original}=await sent(true), selectedOriginal=await selectedInvoiceeOriginal(f,original), refs=references(), complete=reply(f,original,replyBody(f,original,refs,true),refs)
    const baseline=await ready(f,original,complete)
    expect(baseline.decision.policy).toBeDefined(); const policy=baseline.decision.policy!
    expect(validateCanonicalPolicyFields({policy,rawPayload:complete,rawSegments:tokenizeEdifact(complete).segments.map(s=>s.raw)}).filter(i=>i.blocking||i.severity==='error')).toEqual([])
    const missing=omit(complete,field), before=business(f)
    const issues=validateCanonicalPolicyFields({policy,rawPayload:missing,rawSegments:tokenizeEdifact(missing).segments.map(s=>s.raw)})
    expect(issues.some(i=>(i.blocking||i.severity==='error')&&i.prodatDiagnostic?.kind==='field'&&i.prodatDiagnostic.fieldNumber===field),JSON.stringify(issues)).toBe(true)
    expect(business(f)).toEqual(before)
    await actualIncomingOmission(f,original,field,complete,baseline)
    expect(await selectedInvoiceeOriginal(f,original)).toEqual(selectedOriginal)
  })

  it.each(['233','234'])('actual source-selected Z03 IT makes child %s mandatory before another original can persist',async field=>{
    const {f,original}=await sent(false,true), body=rawParts(original.raw_payload!)
    const it=body.filter(p=>p[0]==='NAD'&&component(p,1)==='IT')
    expect(it).toHaveLength(1);expect(component(it[0],2)).toBe(f.external)
    expect(component(it[0],5)).toBe('Installation Street 1')
    expect(component(it[0],6)).toBe('Installation Town');expect(component(it[0],8)).toBe('12345')
    await actualOutboundOmission(f,original,field,omit(original.raw_payload!,field))
  })
  it.each(['250','251','252','253','317','318'])('public caller selection renders Z03 IV%s and blocks a malformed derivative original',async field=>{
    const {f,original}=await sent(true), iv=rawParts(original.raw_payload!).filter(p=>p[0]==='NAD'&&component(p,1)==='IV')
    expect(iv).toHaveLength(1); expect(component(iv[0],2)).toBe('5561234567')
    expect(component(iv[0],5)).toBe('Invoice Street')
    await actualOutboundOmission(f,original,field,omit(original.raw_payload!,field))
  })
  it('outbound D229 has actual protected available customer source before malformed persistence is refused',async()=>{
    const {f,original}=await sent(), context=await loadCustomerMasterdataValidationContext(original,f.actorUserId)
    expect(context).toBeDefined(); expect(context!.projection.endUserMasterdata.streetParts.some(v=>v&&v!=='.')).toBe(true)
    const before=business(f), malformed=omit(original.raw_payload!,'229')
    await actualOutboundOmission(f,original,'229',malformed)
    expect((await loadCustomerMasterdataValidationContext((await getEdielMessageById(original.id))!,f.actorUserId))!.projection).toEqual(context!.projection)
    expect(business(f)).toEqual(before)
  })
  it('incoming D229 is refused when its genuine accepted original independently supplies available own address',async()=>{
    const {f,original}=await sent(), control=await ready(f,original), originalContext=await loadCustomerMasterdataValidationContext(original,f.actorUserId)
    expect(originalContext).toBeDefined()
    const current=await prepareCustomerMasterdataSource({companyId:f.companyId,customerId:f.customerId,actorUserId:f.actorUserId,environment:'test',asOf:originalContext!.projection.asOf})
    const {messageBinding,...originalSource}=record(originalContext!.projection)
    expect(messageBinding).toEqual({id:original.id,environment:original.environment,intentId:original.intent_id,
      routeId:original.communication_route_id,payloadHash:digest(original.raw_payload!)})
    expect(current).toEqual(originalSource)
    const ud=rawParts(original.raw_payload!).find(p=>p[0]==='NAD'&&component(p,1)==='UD')!
    expect(component(ud,2)).toBe(current.customerIdentity.id)
    expect(typeof ud[5]==='string'?[ud[5]]:ud[5]).toEqual(current.endUserMasterdata.streetParts)
    // No parsed availability flag or copied original context enters the source.
    // This strict expectation exposes a missing incoming consumer if reached.
    const raw=omit(freshPhysicalIdentity(control.message.raw_payload!),'229'), before=business(f), staged=await intake(f,raw)
    expect(staged.id).not.toBeNull(); const message=(await getEdielMessageById(staged.id!))!
    const decision=await resolveCanonicalRuntimeDecisionWithRegistry(message,{actorUserId:f.actorUserId})
    expect(decision.issues).toEqual(expect.arrayContaining([expect.objectContaining({prodatDiagnostic:expect.objectContaining({kind:'field',fieldNumber:'229'})})]))
    expect(decision.applicationDecision).toBe('rejected')
    await processInboundEdielMessage({actorUserId:f.actorUserId,edielMessageId:message.id})
    await negativeAcknowledgement(f,message,decision,'229')
    expect(business(f)).toEqual(before); await reread(f,control)
    expect((await loadCustomerMasterdataValidationContext((await getEdielMessageById(original.id))!,f.actorUserId))!.projection).toEqual(originalContext!.projection)
  })
  it('actual two-register Z04 inheritance makes each declared physical subline258 necessary',async()=>{
    // Prospective cumulative tariff counters, original RK v1.7 normal-time convention:
    // 201 high-load 06–22 Mon–Fri Nov–Mar/Lista0; 202 low-load for all remaining time.
    const {f,original}=await sent(), refs=references(), first=replyBody(f,original,refs,false,'201').map((p):Parts=>p[0]==='LIN'?line('1',f.external,'1','9'):p)
    const body:Parts[]=[...first,line('2',f.external,'2','9'),qty('1200'),
      ...characteristic('Z02','10',3),...characteristic('Z05','8',3),...characteristic('Z16','202',3)]
    const complete=reply(f,original,body,refs), control=await ready(f,original,complete,own(f,original).li,2)
    expect(control.decision.prodatRegisterValidation?.objects).toHaveLength(1)
    const fresh=freshPhysicalIdentity(complete), parts=rawParts(fresh), lines=parts.filter(p=>p[0]==='LIN')
    expect(lines).toHaveLength(2); expect(component(lines[1],4,1)).toBe('2')
    const malformed="UNA:+.? '"+parts.map(p=>p[0]==='LIN'&&component(p,1)==='2'?render([...p.slice(0,4),['1','']]):render(p)).join("'")+"'"
    const before=business(f), staged=await intake(f,malformed)
    expect(staged.id,JSON.stringify({stage:'malformed_second_register_258_birth',birthErrors:staged.birthErrors})).not.toBeNull()
    expect(staged.id).not.toBe(control.message.id)
    const message=(await getEdielMessageById(staged.id!))!, decision=await resolveCanonicalRuntimeDecisionWithRegistry(message)
    expect(decision.issues).toEqual(expect.arrayContaining([expect.objectContaining({prodatDiagnostic:expect.objectContaining({kind:'field',fieldNumber:'258'})})]))
    expect(decision.applicationDecision).not.toBe('accepted')
    await processInboundEdielMessage({actorUserId:f.actorUserId,edielMessageId:message.id})
    await negativeAcknowledgement(f,message,decision,'258')
    expect(business(f)).toEqual(before); await reread(f,control)
  })

  it('fresh incoming H from a genuinely known SUPPLIER issuer cannot borrow the original DSO scope',async()=>{
    const {f,original}=await sent(), refs=references(), control=await ready(f,original,reply(f,original,replyBody(f,original,refs),refs))
    const supplier=await resolveCanonicalTenantEdielIdentityWithEvidence({companyId:f.companyId,environment:'test',requireExactCounts:true})
    expect(supplier.identity).toMatchObject({legalEdielId:f.sender,transportEdielId:f.sender,roleCodes:expect.arrayContaining(['electricity_supplier'])})
    expect(original.communication_route_id).toBe(f.routeId);expect(original.route_profile_id).toBeTruthy()
    const dispatchScope={companyId:f.companyId,communicationRouteId:original.communication_route_id!,routeProfileId:original.route_profile_id!,
      environment:'test' as const,messageFamily:'PRODAT',applicationReference:'23-DDQ-PRODAT'}
    // This GIVEN manual route is not a materialized EL registry dispatch.
    // The actual H owner is the archived, separately reviewed bilateral scope.
    expect(await readRegistryDispatchSource(dispatchScope)).toBeNull()
    const groundScope={companyId:f.companyId,actorUserId:f.actorUserId,environment:f.submission.environment,kind:f.submission.kind,
      rulePackId:f.submission.rulePackId,bilateralAgreementId:f.submission.bilateralAgreementId,gridAreaCode:f.submission.gridAreaCode,
      validFrom:f.submission.validFrom,validTo:f.submission.validTo}
    const ground=await readBilateralProdatGroundScope(groundScope)
    expect(ground).toMatchObject({status:'scoped',companyId:f.companyId,missing:[],scopeHash:f.scoped.scopeHash,
      scope:{companyId:f.companyId,environment:'test',kind:'normal_start_h',bilateralAgreementId:f.agreement,
        legalSenderId:f.sender,legalReceiverId:f.receiver,dsoActorId:record(f.scoped.scope).dsoActorId}})
    expect(ground.scope).toEqual(f.scoped.scope)
    const dsoActorId=String(record(ground.scope).dsoActorId)
    const currentDso=()=>sql<Row>(`SELECT jsonb_build_object('actorId',a.id,'status',a.status,'matchStatus',a.match_status,
      'identifiers',(SELECT jsonb_agg(to_jsonb(i) ORDER BY i.id) FROM public.platform_actor_identifiers i WHERE i.actor_id=a.id AND i.identifier_type='EdielId' AND i.is_verified),
      'roles',(SELECT jsonb_agg(r.actor_role ORDER BY r.actor_role) FROM public.platform_actor_roles r WHERE r.actor_id=a.id AND r.is_active))
      FROM public.platform_market_actors a WHERE a.id=${literal(dsoActorId)}`)
    const dso=currentDso()
    expect(dso).toMatchObject({actorId:dsoActorId,status:'active',matchStatus:'verified',
      identifiers:expect.arrayContaining([expect.objectContaining({identifier_type:'EdielId',identifier_value:f.receiver,is_verified:true})]),
      roles:expect.arrayContaining(['grid_owner'])})
    const parties=originalAckPartyIdentities({rawPayload:original.raw_payload})
    const body=replyBody(f,original,refs).map((p):Parts=>p[0]==='NAD'&&component(p,1)==='FR'
      ?rawParts(originalAckLegalNadSegment('FR',parties.legalSender)+"'")[0]:p)
    const before=business(f), raw=frame(body,supplier.identity.transportEdielId,f.sender,{...references(),createdAt:refs.createdAt}), staged=await intake(f,raw)
    expect(EdifactEnvelopeCodec.decode(raw).sender).toBe(supplier.identity.transportEdielId)
    expect(originalAckPartyIdentities({rawPayload:raw}).legalSender.identityComponents).toEqual(parties.legalSender.identityComponents)
    if(staged.id===null) {
      expect(staged.birthErrors).toEqual(expect.arrayContaining([expect.objectContaining({code:'P0001',message:'ediel_inbound_legal_context_required'})]))
    } else {
      expect(staged.id).not.toBe(control.message.id)
      const row=(await getEdielMessageById(staged.id))!
      expect(await readSourceQualifiedProdatBilateralCapability(row)).toBeNull()
      const decision=await resolveCanonicalRuntimeDecisionWithRegistry(row)
      expect(JSON.stringify(decision)).toContain('prodat_bilateral_capability_required:Z04:H')
      expect(decision.applicationDecision).not.toBe('accepted')
      await processInboundEdielMessage({actorUserId:f.actorUserId,edielMessageId:row.id})
    }
    expect(business(f)).toEqual(before); await reread(f,control)
    expect(await readBilateralProdatGroundScope(groundScope)).toEqual(ground)
    expect(currentDso()).toEqual(dso)
    expect(await readRegistryDispatchSource(dispatchScope)).toBeNull()
  })

  it('expiry of the actual SUPPLIER recipient role before a fresh H birth cannot rewrite the old ready source or authorize a new effect',async()=>{
    const {f,original}=await sent(), control=await ready(f,original), immutable=sealed(control.message.id)
    expect(sql<number>(`SELECT to_jsonb(count(*)) FROM public.tenant_actor_roles WHERE company_id=${literal(f.companyId)} AND environment='test'
      AND actor_id=${literal(f.actorUserId)} AND role_code='electricity_supplier' AND valid_from<=clock_timestamp() AND(valid_to IS NULL OR clock_timestamp()<valid_to)`)).toBe(1)
    sql(`UPDATE public.tenant_actor_roles SET valid_to=clock_timestamp() WHERE company_id=${literal(f.companyId)} AND environment='test'
      AND actor_id=${literal(f.actorUserId)} AND role_code='electricity_supplier';`)
    expect(sql<number>(`SELECT to_jsonb(count(*)) FROM public.tenant_actor_roles WHERE company_id=${literal(f.companyId)} AND environment='test'
      AND actor_id=${literal(f.actorUserId)} AND role_code='electricity_supplier' AND valid_from<=clock_timestamp() AND(valid_to IS NULL OR clock_timestamp()<valid_to)`)).toBe(0)
    const before=business(f), staged=await intake(f,freshPhysicalIdentity(control.message.raw_payload!))
    if(staged.id===null)expect(staged.birthErrors).toEqual(expect.arrayContaining([expect.objectContaining({code:'P0001',message:'ediel_inbound_legal_context_required'})]))
    else {
      expect(staged.id).not.toBe(control.message.id)
      expect(record(sealed(staged.id)).inbound).toMatchObject({status:'held',reason:'ediel_inbound_legal_context_required'})
    }
    expect(business(f)).toEqual(before); expect(sealed(control.message.id)).toEqual(immutable)
  })

  it.each(['raw_payload','direction','environment'] as const)('rejects immutable original %s mutation at its actual public SQL guard', async field => {
    const {f,original}=await sent(), before=business(f), immutable=sealed(original.id)
    const result=await supabaseService.from('ediel_messages').update({[field]:field==='raw_payload'?original.raw_payload+' ':field==='direction'?'inbound':'production'}).eq('id',original.id)
    expect(result.error).toMatchObject(field==='raw_payload'?{code:'23514',message:'immutable_ediel_payload_cannot_change'}
      :{code:'P0001',message:'switch_original_bound_message_immutable'})
    expect(sealed(original.id)).toEqual(immutable); expect(business(f)).toEqual(before)
  })

  it('a genuine outbound original is never interpreted as the incoming H confirmation', async () => {
    const {f,original}=await sent(), before=business(f), immutable=sealed(original.id)
    await processInboundEdielMessage({actorUserId:f.actorUserId,edielMessageId:original.id})
    expect(business(f)).toEqual(before); expect(sealed(original.id)).toEqual(immutable)
  })

  it('the same archived test profile cannot authorize a production-environment original', async()=>{
    const f=await authorized(), before=business(f), sends=smtp.send.mock.calls.length
    const scope={companyId:f.companyId,switchId:f.switchId,actorUserId:f.actorUserId,environment:'test' as const}
    const qualified=await qualifyBilateralProdatSwitchPreparation(scope)
    expect(qualified).toMatchObject({companyId:f.companyId,switchId:f.switchId,profileVersionId:f.profileVersionId,environment:'test'})
    await expect(qualifyBilateralProdatSwitchPreparation({...scope,environment:'production'}))
      .rejects.toThrow(/^bilateral_prodat_switch_current_profile_required$/)
    expect(await qualifyBilateralProdatSwitchPreparation(scope)).toEqual(qualified)
    let refusal:unknown
    try {await prepareAndQueueEdielZ03({actorUserId:f.actorUserId,switchRequestId:f.switchId,communicationRouteId:f.routeId,environment:'production'})}
    catch(error){refusal=error}
    expect(refusal).toBeDefined()
    const routeError=refusal instanceof Error?refusal.message:String(record(refusal).message??'')
    // Actual production route refusal precedes the separately proved profile
    // environment guard. A locked production route remains locked.
    for(const reason of ['production_send_locked','route_profile_missing','missing_receiver_subaddress'])expect(routeError).toContain(reason)
    expect(business(f)).toEqual(before); expect(rows('public.ediel_messages',f.companyId)).toEqual([])
    expect(rows('public.ediel_outbox',f.companyId)).toEqual([]);expect(rows('gridex_ediel_transport.attempts',f.companyId)).toEqual([])
    expect(smtp.send.mock.calls.length).toBe(sends)
  })

  it.each(['LI','customer','start'] as const)('fresh Z04 with wrong own %s cannot borrow the accepted H original', async facet=>{
    const {f,original}=await sent(), clock=references(), control=await ready(f,original,reply(f,original,replyBody(f,original,clock),clock))
    const wrongLi='WRONG-'+own(f,original).li.slice(0,29)
    expect(wrongLi).not.toBe(own(f,original).li);expect(wrongLi.length).toBeLessThanOrEqual(35)
    const body=replyBody(f,original,clock).map((p):Parts=> facet==='LI'&&p[0]==='RFF'&&component(p,1)==='LI'?['RFF',['LI',wrongLi]]
      :facet==='customer'&&p[0]==='NAD'&&component(p,1)==='UD'?['NAD','UD',['199002021234',f.customerIdentity.qualifier,f.customerIdentity.agency],...p.slice(3)]
      :facet==='start'&&p[0]==='DTM'&&component(p,1)==='92'?['DTM',['92','202610160000','203']]:p)
    const fresh={...references(),createdAt:clock.createdAt}, negative=await ready(f,original,reply(f,original,body,fresh),
      facet==='LI'?wrongLi:own(f,original).li)
    expect(negative.message.id).not.toBe(control.message.id)
    const before=business(f), immutable=sealed(original.id)
    await processInboundEdielMessage({actorUserId:f.actorUserId,edielMessageId:negative.message.id})
    const result=await supabaseService.rpc('ediel_apply_supply_source_v1',{p_company_id:f.companyId,p_source_message_id:negative.message.id,p_actor_user_id:f.actorUserId})
    expect(result.error).toBeNull(); expect(result.data).toMatchObject({applied:false,reason:'normal_z04_exact_sent_original_required'})
    expect(business(f)).toEqual(before); expect(sealed(original.id)).toEqual(immutable)
    const acks=await listBusinessAckMessagesForSource({companyId:f.companyId,sourceMessageId:negative.message.id,actorUserId:f.actorUserId,environment:'test'})
    expect(acks.filter(a=>a.message_family==='APERAK'&&a.ack_outcome==='positive')).toEqual([])
    expect(await readSourceQualifiedProdatBilateralCapability((await getEdielMessageById(control.message.id))!)).toEqual(control.capability)
  })

  it.each(['point','grid'] as const)('fresh Z04 wrong own %s fails the current profile physical scope without business effects', async facet=>{
    const {f,original}=await sent(), clock=references(), control=await ready(f,original,reply(f,original,replyBody(f,original,clock),clock))
    const changed='735123456789012345'
    expect(changed).not.toBe(f.external)
    const body=replyBody(f,original,clock).map((p):Parts=>facet==='point'&&p[0]==='LIN'?['LIN',p[1],p[2],[changed,'','','9']]
      :facet==='point'&&p[0]==='NAD'&&component(p,1)==='IT'?['NAD','IT',[changed,'','9'],...p.slice(3)]
      :facet==='grid'&&p[0]==='RFF'&&component(p,1)==='Z05'?['RFF',['Z05','FOREIGNGRID']]:p)
    const negative=await intake(f,reply(f,original,body,{...references(),createdAt:clock.createdAt}))
    expect(negative.id,JSON.stringify(negative)).not.toBeNull(); expect(negative.id).not.toBe(control.message.id)
    const row=(await getEdielMessageById(negative.id!))!, before=business(f), immutable=sealed(original.id)
    expect(await readSourceQualifiedProdatBilateralCapability(row)).toBeNull()
    const decision=await resolveCanonicalRuntimeDecisionWithRegistry(row)
    expect(decision.validationReport.failureDisposition,JSON.stringify(decision)).toMatchObject({kind:'internal_failure',code:'EDIEL_INTERNAL_EXECUTION_FAILURE'})
    expect(JSON.stringify(decision)).toContain('prodat_bilateral_capability_required:Z04:H')
    await processInboundEdielMessage({actorUserId:f.actorUserId,edielMessageId:row.id})
    expect(business(f)).toEqual(before); expect(sealed(original.id)).toEqual(immutable)
    expect(await readSourceQualifiedProdatBilateralCapability((await getEdielMessageById(control.message.id))!)).toEqual(control.capability)
  })

  it('a genuine foreign-company executor cannot apply the own bilateral source', async()=>{
    const {f,original}=await sent(), source=await ready(f,original), foreign=await prospective(), before=business(f)
    const result=await supabaseService.rpc('ediel_apply_supply_source_v1',{p_company_id:f.companyId,p_source_message_id:source.message.id,p_actor_user_id:foreign.actorUserId})
    expect(result.error).toBeNull(); expect(result.data).toMatchObject({applied:false,reason:'normal_z04_execution_actor_required'})
    expect(business(f)).toEqual(before)
    expect(await readSourceQualifiedProdatBilateralCapability((await getEdielMessageById(source.message.id))!)).toEqual(source.capability)
  })

  it.each(['raw_payload','direction','environment'] as const)('received H %s is immutable before and after its actual source read', async field=>{
    const {f,original}=await sent(), source=await ready(f,original), before=business(f), immutable=sealed(source.message.id)
    const result=await supabaseService.from('ediel_messages').update({[field]:field==='raw_payload'?source.message.raw_payload+' ':field==='direction'?'outbound':'production'}).eq('id',source.message.id)
    expect(result.error,JSON.stringify({stage:'received_immutable_update',field,error:result.error})).toMatchObject(field==='environment'
      ?{code:'P0001',message:'ediel_registered_reception_original_immutable'}:{code:'23514'})
    expect(sealed(source.message.id)).toEqual(immutable); expect(business(f)).toEqual(before)
    expect(await readSourceQualifiedProdatBilateralCapability((await getEdielMessageById(source.message.id))!)).toEqual(source.capability)
  })
})

// Own physical reading declarations214/218/259 now precede public mail birth.
// The current H consumer must still qualify their applicability from the
// immutable source and protected profile. These supplied values alone prove
// neither canonical TRUE nor actual UTILTS delivery. We never add
// meterReadingsSentInUtilts or accepted facts to the received source.
// D229 and258 above remain strict proposals if their actual intended owner is
// absent: a held baseline is FAIL/NOT_REACHED, not a green omission proof.
// A negotiated H business deadline needs explicit archived agreement evidence;
// current normal_start_h scope binds grammar/validity without a dedicated timer.
// Public birth also needs the retained common-owner H adapter integration.

// Two additional whole branches. The counterparty port only renders physical
// bytes from our actual sent original; it cannot persist remote authority.
describe('H original ACK receipt and current archive authority proposals',()=>{
  it('receives physical CONTRL and APERAK for the SMTP-accepted own Z03 without confirming supply, then replays immutable receipts',async()=>{
    const {f,original}=await sent(), immutable=sealed(original.id)
    // ACK may advance request status to submitted; it grants no market effect.
    const market=()=>Object.fromEntries(Object.entries(business(f)).filter(([key])=>key!=='switches')), before=market()
    const accepted=await readAcceptedEdielTransportProjection({companyId:f.companyId,environment:'test',actorUserId:f.actorUserId,messageId:original.id})
    expect(accepted).toMatchObject({status:'accepted_projection',messageId:original.id,originalHash:digest(original.raw_payload!),
      businessExpectationPlan:null,authorizesProviderEntry:false,deliveryProven:false})
    const attempt=sql<{plan:Row;policy:Row}>(`SELECT jsonb_build_object('plan',binding->'technicalExpectationPlan',
      'policy',jsonb_build_object('guideRevision',binding#>'{admissionDecision,guide,guideRevision}',
        'referenceDate',binding#>'{admissionDecision,referenceDate}','profileKey',binding#>'{admissionDecision,profileKey}',
        'sourceTrace',binding#>'{admissionDecision,sourceTrace}')) FROM gridex_ediel_transport.attempts
      WHERE id=${literal(accepted!.attemptId)} AND company_id=${literal(f.companyId)} AND message_id=${literal(original.id)}
      AND environment='test' AND classification='accepted' AND observed_at=${literal(accepted!.observedAt)}::timestamptz`)
    expect(attempt.plan).toEqual({version:1,ruleId:'TM-CONTRL',offset:EDIEL_ACK_DEADLINE_MINUTES,unit:'minutes',
      anchor:'actual_accepted_smtp_observed_at',timerKind:'internal_sender_watch',remoteReceiptKnown:false,policy:attempt.policy})
    expect(attempt.policy).toMatchObject({guideRevision:expect.any(String),referenceDate:expect.any(String),profileKey:expect.any(String),sourceTrace:expect.any(Array)})
    const projected=(await getEdielMessageById(original.id))!
    expect(Date.parse(projected.message_sent_at!)).toBe(Date.parse(accepted!.observedAt))
    for(const date of [projected.ack_due_at,projected.contrl_due_at]) expect(Date.parse(date!)).toBe(Date.parse(accepted!.observedAt)+EDIEL_ACK_DEADLINE_MINUTES*60000)
    const ids:string[]=[], originalWire=tokenizeEdifact(original.raw_payload!), envelope=EdifactEnvelopeCodec.decode(original.raw_payload!)
    const parties=originalAckPartyIdentities({rawPayload:original.raw_payload!})
    for(const family of ['CONTRL','APERAK'] as const) {
      // DSO view is solely the pure renderer input. Only actual mail intake
      // below produces the received source, context and validation receipts.
      const input={actorUserId:f.actorUserId,sourceMessage:{...original,direction:'inbound' as const},outcome:'positive' as const}
      const raw=(family==='CONTRL'?buildContrlDraft(input):buildAperakDraft(input)).rawPayload!
      const wire=tokenizeEdifact(raw)
      expect(EdifactEnvelopeCodec.decode(raw)).toMatchObject({sender:envelope.receiver,receiver:envelope.sender,
        environment:'test',applicationReference:envelope.applicationReference})
      if(family==='CONTRL') {
        const uci=wire.segments.filter(t=>t.tag==='UCI');expect(uci).toHaveLength(1)
        expect(segmentComposite(uci[0],1,wire.una)[0]).toBe(envelope.interchangeReference!.slice(0,14))
        expect(segmentComposite(uci[0],4,wire.una)[0]).toBe('1')
        for(const i of [2,3])expect(segmentComposite(uci[0],i,wire.una)).toEqual(segmentComposite(originalWire.segments.find(t=>t.tag==='UNB')!,i,originalWire.una))
        // The real renderer acknowledges the whole interchange with UCI.
        // Any optional message-level UCM must still name the exact own UNH.
        for(const ucm of wire.segments.filter(t=>t.tag==='UCM')) {
          expect(segmentComposite(ucm,1,wire.una)[0]).toBe(segmentComposite(originalWire.segments.find(t=>t.tag==='UNH')!,1,originalWire.una)[0])
          expect(segmentComposite(ucm,3,wire.una)[0]).toBe('1')
        }
      } else {
        for(const [role,party] of [['FR',parties.legalReceiver],['DO',parties.legalSender]] as const) {
          const nad=wire.segments.filter(t=>t.tag==='NAD'&&segmentComposite(t,1,wire.una)[0]===role)
          expect(nad).toHaveLength(1);expect(segmentComposite(nad[0],2,wire.una)).toEqual(party.identityComponents)
        }
        expect(wire.segments.filter(t=>t.tag==='ERC').map(t=>segmentComposite(t,1,wire.una))).toEqual([['100','','260']])
        for(const [qualifier,value] of [['ACW',segmentComposite(originalWire.segments.find(t=>t.tag==='BGM')!,2,originalWire.una)[0]],['LI',own(f,original).li],['Z07',f.external]]) {
          const refs=wire.segments.filter(t=>t.tag==='RFF'&&segmentComposite(t,1,wire.una)[0]===qualifier)
          expect(refs).toHaveLength(1);expect(segmentComposite(refs[0],1,wire.una)).toEqual([qualifier,value])
        }
      }
      const staged=await intake(f,raw)
      expect(staged.id,JSON.stringify(staged)).not.toBeNull()
      const message=(await getEdielMessageById(staged.id!))!
      expect(message).toMatchObject({message_family:family,direction:'inbound',company_id:f.companyId,raw_payload:raw,immutable_payload_hash:digest(raw)})
      const decision=await resolveCanonicalRuntimeDecisionWithRegistry(message)
      expect([decision.syntaxDecision,decision.applicationDecision,decision.functionalDecision],JSON.stringify(decision)).toEqual(['accepted','accepted','accepted'])
      await processInboundEdielMessage({actorUserId:f.actorUserId,edielMessageId:message.id})
      const current=(await getEdielMessageById(message.id))!, receipt=await readCommittedInboundAck({actorUserId:f.actorUserId,message:current})
      expect(receipt).toMatchObject({kind:'exact_receipt',sourceMessageId:original.id,result:{outcome:'positive',
        sourceMessage:{id:original.id,raw_payload:original.raw_payload,immutable_payload_hash:digest(original.raw_payload!)}}})
      expect(current).toMatchObject({ack_outcome:'positive'})
      ids.push(message.id)
      expect(sql<Row>(`SELECT to_jsonb(c) FROM gridex_ack_authority.source_correlations c WHERE ack_message_id=${literal(message.id)}`))
        .toMatchObject({company_id:f.companyId,environment:'test',source_message_id:original.id,
          source_payload_hash:digest(original.raw_payload!),ack_message_id:message.id,ack_payload_hash:digest(raw),ack_family:family,ack_outcome:'positive'})
      expect(market()).toEqual(before);expect(sealed(original.id)).toEqual(immutable)
    }
    expect(await getEdielMessageById(original.id)).toMatchObject({contrl_status:'received',aperak_status:'received'})
    const latest=await readCommittedInboundAck({actorUserId:f.actorUserId,message:(await getEdielMessageById(ids[1]))!})
    expect(latest).toMatchObject({kind:'exact_receipt',result:{finalAckReached:true,sourceAccepted:true,wholeSourceRejected:false}})
    const receiptRows=()=>sql(`SELECT jsonb_build_object(
      'correlations',(SELECT coalesce(jsonb_agg(to_jsonb(c) ORDER BY c.ack_message_id),'[]') FROM gridex_ack_authority.source_correlations c WHERE company_id=${literal(f.companyId)}),
      'receipts',(SELECT coalesce(jsonb_agg(to_jsonb(r) ORDER BY r.ack_message_id),'[]') FROM gridex_ack_authority.applied_receipts r JOIN gridex_ack_authority.source_correlations c USING(ack_message_id) WHERE c.company_id=${literal(f.companyId)}),
      'outcomes',(SELECT coalesce(jsonb_agg(to_jsonb(o) ORDER BY o.ack_family,o.ack_scope,o.source_reference),'[]') FROM gridex_ack_authority.scope_outcomes o WHERE source_message_id=${literal(original.id)}))`)
    const snapshot=()=>({durable:durable(f,original,ids[0]),second:sealed(ids[1]),receipts:receiptRows()})
    const frozen=snapshot()
    for(const id of ids)await processInboundEdielMessage({actorUserId:f.actorUserId,edielMessageId:id})
    expect(snapshot()).toEqual(frozen)
    const concurrent=await Promise.allSettled(ids.flatMap(id=>[1,2].map(()=>processInboundEdielMessage({actorUserId:f.actorUserId,edielMessageId:id}))))
    expect(concurrent.filter(r=>r.status==='rejected'),JSON.stringify(concurrent)).toEqual([])
    expect(snapshot()).toEqual(frozen)
    expect(await getEdielMessageById(original.id)).toMatchObject({contrl_status:'received',aperak_status:'received'})
  })

  it('denying the public separate reviewer grant removes current profile authority for a fresh H source without rewriting archive or history',async()=>{
    const {f,original}=await observedStage('withdrawal_setup_sent',()=>sent()), control=await observedStage('withdrawal_setup_ready',()=>ready(f,original)),
      origin=sql<Row>(`SELECT to_jsonb(o) FROM gridex_bilateral_prodat.origins o WHERE ground_id=${literal(f.profileVersionId)}`)
    const scope={companyId:f.companyId,actorUserId:f.actorUserId,artifactId:String(origin.artifact_id)}
    expect(await observedStage('withdrawal_setup_read_artifact',()=>readBilateralProdatGroundArtifact(scope))).toMatchObject({status:'authorized',sourceHash:f.sourceHash})
    const archive=()=>({profiles:rows('gridex_bilateral_prodat.profile_versions',f.companyId),artifacts:rows('gridex_bilateral_prodat.artifacts',f.companyId),
      origins:rows('gridex_bilateral_prodat.origins',f.companyId,'ground_id'),reviews:rows('gridex_bilateral_prodat.reviews',f.companyId)})
    const history=archive(), originalBefore=sealed(original.id), controlBefore=sealed(control.message.id), before=business(f)
    // Observe every physical outbound/custody row, including held or orphan
    // candidates. The public business reader cannot authorize this H source.
    const physical=()=>({messages:rows('public.ediel_messages',f.companyId).filter(m=>m.direction==='outbound'),
      outboxes:rows('public.ediel_outbox',f.companyId),witnesses:rows('gridex_ediel_outbound_owner.witnesses',f.companyId),
      consumptions:rows('gridex_ediel_outbound_owner.consumptions',f.companyId,'witness_id'),
      responses:rows('gridex_ediel_ack_guide.prodat_response_owner_bindings',f.companyId,'witness_id'),
      structural:rows('gridex_ediel_ack_guide.prodat_structural_response_bindings',f.companyId,'witness_id')})
    const physicalBefore=physical(),operatorCanWrite=()=>sql<boolean>(`SELECT to_jsonb(public.gridex_actor_has_company_permission(${literal(f.actorUserId)},${literal(f.companyId)},'communication.write'))`)
    expect(f.actorUserId).not.toBe(f.reviewer);expect(operatorCanWrite()).toBe(true)
    expect(sql<number>(`SELECT to_jsonb(count(*)) FROM public.user_permissions WHERE user_id=${literal(f.reviewer)} AND company_id=${literal(f.companyId)} AND permission_key='ediel.bilateral_profile.review' AND effect='allow'`)).toBe(1)
    sql(`UPDATE public.user_permissions SET effect='deny' WHERE user_id=${literal(f.reviewer)} AND company_id=${literal(f.companyId)} AND permission_key='ediel.bilateral_profile.review'`)
    expect(sql<number>(`SELECT to_jsonb(count(*)) FROM public.user_permissions WHERE user_id=${literal(f.reviewer)} AND company_id=${literal(f.companyId)} AND permission_key='ediel.bilateral_profile.review' AND effect='deny'`)).toBe(1)
    expect(await observedStage('withdrawal_read_current_artifact',()=>readBilateralProdatGroundArtifact(scope))).toMatchObject({status:'held',sourceHash:f.sourceHash})
    expect(await observedStage('withdrawal_read_existing_capability',async()=>readSourceQualifiedProdatBilateralCapability((await getEdielMessageById(control.message.id))!))).toBeNull()
    const fresh=await observedStage('withdrawal_fresh_physical_intake',()=>intake(f,freshPhysicalIdentity(control.message.raw_payload!)))
    expect(fresh.id,JSON.stringify(fresh)).not.toBeNull();expect(fresh.id).not.toBe(control.message.id)
    const message=(await observedStage('withdrawal_read_fresh_message',()=>getEdielMessageById(fresh.id!)))!
    expect(await observedStage('withdrawal_read_fresh_capability',()=>readSourceQualifiedProdatBilateralCapability(message))).toBeNull()
    const decision=await observedStage('withdrawal_fresh_canonical_decision',()=>resolveCanonicalRuntimeDecisionWithRegistry(message))
    expect(decision.validationReport.failureDisposition,JSON.stringify(decision)).toMatchObject({kind:'internal_failure',code:'EDIEL_INTERNAL_EXECUTION_FAILURE'})
    expect(JSON.stringify(decision)).toContain('prodat_bilateral_capability_required:Z04:H')
    await observedStage('withdrawal_actual_processor',()=>processInboundEdielMessage({actorUserId:f.actorUserId,edielMessageId:message.id}))
    await expect(observedStage('withdrawal_list_business_ack',()=>listBusinessAckMessagesForSource({companyId:f.companyId,sourceMessageId:message.id,actorUserId:f.actorUserId,environment:'test'})))
      .rejects.toMatchObject({code:'P0001',message:'ediel_historical_rule_pack_basis_unavailable'})
    expect(operatorCanWrite()).toBe(true)
    const after=physical(),technicalIds=new Set<unknown>(),technicalOutboxIds=new Set<unknown>(),
      baselineIds=new Set(physicalBefore.messages.map(m=>m.id)),sourceWire=tokenizeEdifact(message.raw_payload!),
      sourceEnvelope=EdifactEnvelopeCodec.decode(message.raw_payload!),sourceUnb=sourceWire.segments.find(t=>t.tag==='UNB')!
    expect(after.messages.filter(m=>!baselineIds.has(m.id)).length).toBeLessThanOrEqual(1)
    // Only an actually qualified NEW technical reply may coexist with this
    // business refusal. Never hide a row by its outcome, status or family.
    for(const ack of after.messages.filter(m=>!baselineIds.has(m.id))) {
      expect(ack).toMatchObject({direction:'outbound',company_id:f.companyId,environment:'test',message_family:'CONTRL',related_message_id:message.id})
      expect(typeof ack.raw_payload).toBe('string')
      const raw=String(ack.raw_payload),wire=tokenizeEdifact(raw),envelope=EdifactEnvelopeCodec.decode(raw),
        only=(tag:string)=>{const found=wire.segments.filter(t=>t.tag===tag);expect(found).toHaveLength(1);return found[0]}
      const unb=only('UNB'),unh=only('UNH'),uci=only('UCI'),unt=only('UNT'),unz=only('UNZ'),
        first=wire.segments.indexOf(unh),last=wire.segments.indexOf(unt)
      expect(first).toBeGreaterThan(wire.segments.indexOf(unb));expect(wire.segments.indexOf(uci)).toBeGreaterThan(first)
      expect(last).toBeGreaterThan(wire.segments.indexOf(uci));expect(wire.segments.indexOf(unz)).toBe(wire.segments.length-1)
      expect(wire.segments.indexOf(unz)).toBe(last+1)
      expect(segmentComposite(unh,2,wire.una)[0]).toBe('CONTRL')
      expect(segmentComposite(unt,1,wire.una)).toEqual([String(last-first+1)])
      expect(segmentComposite(unt,2,wire.una)).toEqual(segmentComposite(unh,1,wire.una))
      expect(segmentComposite(unz,1,wire.una)).toEqual(['1'])
      expect(segmentComposite(unz,2,wire.una)).toEqual([envelope.interchangeReference])
      expect(segmentComposite(unb,2,wire.una)).toEqual(segmentComposite(sourceUnb,3,sourceWire.una))
      expect(segmentComposite(unb,3,wire.una)).toEqual(segmentComposite(sourceUnb,2,sourceWire.una))
      expect(envelope).toMatchObject({environment:'test',testIndicator:'1',applicationReference:sourceEnvelope.applicationReference})
      expect(segmentComposite(uci,1,wire.una)).toEqual([sourceEnvelope.interchangeReference!.slice(0,14)])
      for(const i of [2,3])expect(segmentComposite(uci,i,wire.una)).toEqual(segmentComposite(sourceUnb,i,sourceWire.una))
      expect(segmentComposite(uci,4,wire.una)).toEqual(['1'])
      expect(ack.immutable_payload_hash).toBe(digest(raw))
      const qualified=await readPersistedEdielTechnicalContrlBasis({companyId:f.companyId,environment:'test',
        ackMessageId:String(ack.id),expectedRawPayload:raw,actorUserId:f.actorUserId,phase:'read'})
      expect(qualified.evidence).toMatchObject({sourceMessageId:message.id,sourceHash:digest(message.raw_payload!),companyId:f.companyId,environment:'test',syntaxDecision:'accepted'})
      const outboxes=after.outboxes.filter(o=>o.ediel_message_id===ack.id)
      expect(outboxes).toHaveLength(1)
      expect(outboxes[0]).toMatchObject({company_id:f.companyId,environment:'test',source_message_id:message.id,
        message_family:'CONTRL',immutable_payload_hash:digest(raw),created_by:f.actorUserId})
      expect(physicalBefore.outboxes.some(o=>o.id===outboxes[0].id)).toBe(false)
      technicalIds.add(ack.id);technicalOutboxIds.add(outboxes[0].id)
    }
    expect({...after,messages:after.messages.filter(m=>!technicalIds.has(m.id)),
      outboxes:after.outboxes.filter(o=>!technicalOutboxIds.has(o.id))}).toEqual(physicalBefore)
    expect(business(f)).toEqual(before);expect(archive()).toEqual(history)
    expect(sealed(original.id)).toEqual(originalBefore);expect(sealed(control.message.id)).toEqual(controlBefore)
  })
})

// The already sent original is a lawful baseline, never an authority shortcut
// for a fresh public producer call after loss of its real SUPPLIER role.
describe('H outgoing supplier role proposal',()=>{
  it('requires the current scoped SUPPLIER role before H qualification or original idempotent reuse',async()=>{
    const {f,original}=await sent()
    const snapshot=()=>({durable:durable(f,original,original.id),intents:rows('public.ediel_message_intents',f.companyId),
      requests:rows('public.outbound_requests',f.companyId),
      original:sql(`SELECT to_jsonb(m) FROM public.ediel_messages m WHERE id=${literal(original.id)} AND company_id=${literal(f.companyId)}`)})
    expect(sql<number>(`SELECT to_jsonb(count(*)) FROM public.tenant_actor_roles WHERE company_id=${literal(f.companyId)} AND environment='test'
      AND actor_id=${literal(f.actorUserId)} AND role_code='electricity_supplier' AND valid_from<=clock_timestamp() AND(valid_to IS NULL OR clock_timestamp()<valid_to)`)).toBe(1)
    const before=snapshot()
    sql(`UPDATE public.tenant_actor_roles SET valid_to=clock_timestamp() WHERE company_id=${literal(f.companyId)} AND environment='test'
      AND actor_id=${literal(f.actorUserId)} AND role_code='electricity_supplier'`)
    expect(sql<number>(`SELECT to_jsonb(count(*)) FROM public.tenant_actor_roles WHERE company_id=${literal(f.companyId)} AND environment='test'
      AND actor_id=${literal(f.actorUserId)} AND role_code='electricity_supplier' AND valid_from<=clock_timestamp() AND(valid_to IS NULL OR clock_timestamp()<valid_to)`)).toBe(0)
    await expect(originate(f)).rejects.toThrow(new RegExp('^tenant_market_roles_missing:'+f.companyId+':test$'))
    expect(snapshot()).toEqual(before)
  })
})

// These two additional branches do not alter the earlier 98 case criteria.
describe('H outgoing current-review authority and explicit controlled agreement proposals',()=>{
  it('withdrawal of the public reviewer grant prevents fresh H qualification and origination while preserving the sent original',async()=>{
    const {f,original}=await sent(), origin=sql<Row>(`SELECT to_jsonb(o) FROM gridex_bilateral_prodat.origins o WHERE ground_id=${literal(f.profileVersionId)}`)
    const artifactScope={companyId:f.companyId,actorUserId:f.actorUserId,artifactId:String(origin.artifact_id)}, scope={companyId:f.companyId,actorUserId:f.actorUserId,switchId:f.switchId,environment:'test' as const}
    expect(await readBilateralProdatGroundArtifact(artifactScope)).toMatchObject({status:'authorized',sourceHash:f.sourceHash})
    expect(await qualifyBilateralProdatSwitchPreparation(scope)).toMatchObject({profileVersionId:f.profileVersionId,sourceHash:f.sourceHash})
    const snapshot=()=>({durable:durable(f,original,original.id),intents:rows('public.ediel_message_intents',f.companyId),requests:rows('public.outbound_requests',f.companyId),
      original:sql(`SELECT to_jsonb(m) FROM public.ediel_messages m WHERE id=${literal(original.id)} AND company_id=${literal(f.companyId)}`)})
    const before=snapshot()
    expect(sql<number>(`SELECT to_jsonb(count(*)) FROM public.user_permissions WHERE user_id=${literal(f.reviewer)} AND company_id=${literal(f.companyId)} AND permission_key='ediel.bilateral_profile.review' AND effect='allow'`)).toBe(1)
    sql(`UPDATE public.user_permissions SET effect='deny' WHERE user_id=${literal(f.reviewer)} AND company_id=${literal(f.companyId)} AND permission_key='ediel.bilateral_profile.review'`)
    expect(sql<number>(`SELECT to_jsonb(count(*)) FROM public.user_permissions WHERE user_id=${literal(f.reviewer)} AND company_id=${literal(f.companyId)} AND permission_key='ediel.bilateral_profile.review' AND effect='deny'`)).toBe(1)
    expect(await readBilateralProdatGroundArtifact(artifactScope)).toMatchObject({status:'held',missing:['actual_current_qualified_ground'],sourceHash:f.sourceHash})
    await expect(qualifyBilateralProdatSwitchPreparation(scope)).rejects.toThrow(/^bilateral_prodat_switch_current_profile_required$/)
    await expect(originate(f)).rejects.toThrow(/^bilateral_prodat_switch_current_profile_required$/)
    expect(snapshot()).toEqual(before)
  })

  it('archives newly signed explicit controlled H agreement bytes and executes their current technical watches and own confirmation transition',async()=>{
    const staged=await prospective(), address=await applyCustomerSiteAddressCandidate({companyId:staged.companyId,customerId:staged.customerId,siteId:staged.siteId,
      address:{street:'Agreed Installation Street 1',postalCode:'12345',city:'Agreed Town',country:'SE',source:'manual_intake',sourceReference:'SYNTHETIC controlled H agreement',actorUserId:staged.actorUserId}})
    expect(address).toMatchObject({status:'updated',siteId:staged.siteId})
    expect(sql<Row>(`SELECT to_jsonb(s) FROM public.customer_sites s WHERE company_id=${literal(staged.companyId)} AND id=${literal(staged.siteId)}`))
      .toMatchObject({customer_id:staged.customerId,street:'Agreed Installation Street 1',postal_code:'12345',city:'Agreed Town',address_hash:address.addressHash})
    const configured=await createBilateralProdatGroundNativeFixture(staged), selector={environment:configured.submission.environment,kind:configured.submission.kind,
      rulePackId:configured.submission.rulePackId,bilateralAgreementId:configured.submission.bilateralAgreementId,gridAreaCode:configured.submission.gridAreaCode,
      validFrom:configured.submission.validFrom,validTo:configured.submission.validTo}
    const current=await readBilateralProdatGroundScope({companyId:configured.companyId,actorUserId:configured.actorUserId,...selector})
    expect(current).toMatchObject({status:'scoped',scope:configured.scoped.scope,scopeHash:configured.scoped.scopeHash})
    expect(current.scope).toMatchObject({companyId:configured.companyId,environment:'test',kind:'normal_start_h',legalSenderId:configured.sender,
      legalReceiverId:configured.receiver,gridArea:configured.gridAreaCode,rulePackId:selector.rulePackId,bilateralAgreementId:configured.agreement})
    // The actual RPC scope hashes legal/agreement/registry grammar and validity.
    // Public site/invoicee staging is not misrepresented as hashed by that RPC.
    const contractHash=sql<string>(`SELECT to_jsonb(gridex_received_sources.production_contract_hash_v1(c)) FROM public.customer_contracts c
      WHERE c.id=${literal(configured.contractId)} AND c.company_id=${literal(configured.companyId)} AND c.customer_id=${literal(configured.customerId)} AND c.metering_point_id=${literal(configured.pointId)}`)
    expect(contractHash).toMatch(/^[a-f0-9]{64}$/)
    const sourceReference=String(record(record(current.scope).agreementBinding).source_reference)
    expect(sourceReference).toBe(configured.submission.source.reference)
    expect(EDIEL_ACK_DEADLINE_MINUTES).toBe(30)
    const agreement={format:'SYNTHETIC_CONTROLLED_H_AGREEMENT_V1',boundary:'Declared issuer mechanism only; no real legal acceptance',scope:current.scope,
      ownOperation:{customerId:configured.customerId,siteId:configured.siteId,pointId:configured.pointId,objectId:configured.external,contractId:configured.contractId,contractHash,requestedStartDate:configured.requestedStartDate},
      original:{code:'Z03',reason:'Z25',requiredPhysicalReplies:['CONTRL','APERAK']},
      watches:{outgoing:{minutes:30,anchor:'actual_accepted_smtp_observed_at'},incoming:{minutes:30,anchor:'retained_message_received_at'},businessDeadline:null,nationalSubstitutions:[]},
      transition:{confirmation:'Z04',reason:'Z25',state:'confirmed_by_grid_owner',effectiveEvent:'own DTM92 at requestedStartDate',activation:'only after actual confirmation, current profile and effective event'}}
    const bytes=Buffer.from(JSON.stringify(agreement,null,2),'utf8'), sourceHash=createHash('sha256').update(bytes).digest('hex'), version='explicit-controlled-h-agreement-v1'
    const keyId=sql<string>(`SELECT to_jsonb(issuer_key_id) FROM gridex_bilateral_prodat.issuer_representations WHERE id=${literal(configured.representationId)} AND company_id=${literal(configured.companyId)}`)
    const payload=Buffer.from(JSON.stringify({format:'ediel_bilateral_prodat_ground_receipt_v1',issuerCode:'SYNTHETIC',receiptId:randomUUID(),companyId:configured.companyId,environment:'test',
      scope:current.scope,sourceHash,sourceReference,sourceVersion:version,legalDecisionReference:'SYNTHETIC DECLARED MECHANISM ONLY',issuedAt:new Date(Date.now()-1000).toISOString(),expiresAt:'2100-01-01T00:00:00Z'}))
    // GIVEN verifier key is the existing fixture's declared synthetic constant.
    // New JSON bytes/hash/receipt/signature are produced; no PDF signature reused.
    const artifact=await archiveBilateralProdatGround({companyId:configured.companyId,actorUserId:configured.actorUserId,...selector,
      source:{bytesBase64:bytes.toString('base64'),mimeType:'application/json',reference:sourceReference,version},
      issuerReceipt:{keyId,representationId:configured.representationId,payloadBase64:payload.toString('base64'),signatureHex:createHmac('sha256',Buffer.from('SYNTHETIC bilateral issuer verifier mechanism fixture only')).update(payload).digest('hex')}})
    expect(artifact).toMatchObject({status:'archived',sourceHash,scopeHash:current.scopeHash})
    const review=await reviewBilateralProdatGround({companyId:configured.companyId,actorUserId:configured.reviewer,artifactId:String(artifact.artifactId),sourceHash,scopeHash:String(artifact.scopeHash),decision:'approve',reason:'Separate controlled review adopts explicit source clauses; synthetic mechanism only'})
    expect(review.status,JSON.stringify(review)).toBe('authorized')
    const f={...configured,profileVersionId:String(review.profileVersionId),bytes,sourceHash}, artifactScope={companyId:f.companyId,actorUserId:f.actorUserId,artifactId:String(artifact.artifactId)}
    const retained=await readBilateralProdatGroundBytes(artifactScope)
    expect(retained).toMatchObject({mimeType:'application/json',sourceHash});expect(Buffer.from(retained.bytes)).toEqual(bytes)
    expect(createHash('sha256').update(retained.bytes).digest('hex')).toBe(sourceHash)
    expect(retained.bytes.byteLength).toBe(bytes.byteLength);expect(JSON.parse(Buffer.from(retained.bytes).toString('utf8'))).toEqual(agreement)
    expect(await readBilateralProdatGroundArtifact(artifactScope)).toMatchObject({status:'authorized',profileVersionId:f.profileVersionId,sourceHash,scopeHash:current.scopeHash,scope:current.scope,byteLength:bytes.byteLength,missing:[]})
    const q=await qualifyBilateralProdatSwitchPreparation({companyId:f.companyId,actorUserId:f.actorUserId,switchId:f.switchId,environment:'test'})
    expect(q).toMatchObject({profileVersionId:f.profileVersionId,sourceHash,sourceGrammarHash:record(current.scope).sourceGrammarHash,
      customerId:agreement.ownOperation.customerId,siteId:agreement.ownOperation.siteId,pointId:agreement.ownOperation.pointId,contractId:agreement.ownOperation.contractId,contractHash:agreement.ownOperation.contractHash,objectId:agreement.ownOperation.objectId,requestedStartDate:agreement.ownOperation.requestedStartDate})
    const original=await originate(f), physical=tokenizeEdifact(original.raw_payload!), dtm=physical.segments.filter(t=>t.tag==='DTM'&&segmentComposite(t,1,physical.una)[0]==='92')
    expect(dtm).toHaveLength(1);expect(segmentComposite(dtm[0],1,physical.una)).toEqual(['92',f.requestedStartDate.replaceAll('-','')+'0000','203'])
    expect(original).toMatchObject({requires_contrl:true,requires_aperak:true})
    expect((await qualifyPersistedBilateralProdatOutboundOriginal(original,f.actorUserId)).qualification?.objects)
      .toEqual([expect.objectContaining({profileVersionId:f.profileVersionId,sourceHash,sourceGrammarHash:q.sourceGrammarHash,
        contractId:q.contractId,contractHash:q.contractHash,customerId:q.customerId,siteId:q.siteId,objectId:q.objectId,
        lineItemReference:own(f,original).li})])
    configureProspectiveAcknowledgements(f,original)
    const immutable=sealed(original.id), before=business(f)
    expect(before.periods).toEqual([]);expect(before.activations).toEqual([])
    expect(sql<number>(`SELECT to_jsonb(count(*)) FROM public.ediel_messages WHERE company_id=${literal(f.companyId)} AND direction='inbound' AND message_family IN('CONTRL','APERAK')`)).toBe(0)
    expect((await sendEdielMessageViaSmtp(original,{actorUserId:f.actorUserId,smtpMimeMode:'nodemailer-attachment'})).accepted).toEqual(['recipient@example.invalid'])
    const accepted=await readAcceptedEdielTransportProjection({companyId:f.companyId,actorUserId:f.actorUserId,messageId:original.id,environment:'test'})
    expect(accepted).toMatchObject({status:'accepted_projection',originalHash:digest(original.raw_payload!),businessExpectationPlan:null,deliveryProven:false,authorizesProviderEntry:false})
    const sentRow=(await getEdielMessageById(original.id))!
    expect(Date.parse(sentRow.message_sent_at!)).toBe(Date.parse(accepted!.observedAt))
    for(const deadline of [sentRow.ack_due_at,sentRow.contrl_due_at])expect(Date.parse(deadline!)).toBe(Date.parse(accepted!.observedAt)+agreement.watches.outgoing.minutes*60000)
    expect(sql<number>(`SELECT to_jsonb(count(*)) FROM public.ediel_business_expectations WHERE company_id=${literal(f.companyId)} AND environment='test' AND source_message_id=${literal(original.id)}`)).toBe(0)
    expect(sql<Row>(`SELECT binding->'technicalExpectationPlan' FROM gridex_ediel_transport.attempts WHERE id=${literal(accepted!.attemptId)} AND company_id=${literal(f.companyId)}`))
      .toMatchObject({ruleId:'TM-CONTRL',offset:agreement.watches.outgoing.minutes,unit:'minutes',anchor:agreement.watches.outgoing.anchor,remoteReceiptKnown:false})
    expect(business(f).periods).toEqual([]);expect(sealed(original.id)).toEqual(immutable)
    // Archive/preparation/original/SMTP watch assertions above execute before
    // the retained common H mail-birth dependency. No downstream credit if blocked.
    const received=await ready(f,original)
    expect(received.capability!.objects).toEqual([expect.objectContaining({profileVersionId:f.profileVersionId,sourceHash,sourceGrammarHash:q.sourceGrammarHash})])
    expect(business(f).periods).toEqual([]);expect(business(f).activations).toEqual([])
    expect(Date.parse(f.requestedStartDate+'T00:00:00Z')).toBeGreaterThan(Date.now())
    const firstBefore=business(f), startedAt=Date.now()
    await processInboundEdielMessage({actorUserId:f.actorUserId,edielMessageId:received.message.id})
    const completedAt=Date.now(), after=business(f)
    expect(after.periods,after.periods.length===1 ? undefined
      : JSON.stringify(effectFailureDiagnostic(f.companyId,received.message.id))).toEqual([expect.objectContaining({source_message_id:received.message.id,source_switch_request_id:f.switchId,customer_id:f.customerId,metering_point_id:f.pointId,contract_id:f.contractId,start_date:f.requestedStartDate,status:agreement.transition.state})])
    expect(after.confirmations).toEqual([expect.objectContaining({source_message_id:received.message.id,original_message_id:original.id})]);expect(after.activations).toEqual([])
    expect(after.bilateral).toEqual([expect.objectContaining({source_message_id:received.message.id,payload_hash:digest(received.message.raw_payload!),
      profiles:[expect.objectContaining({profileVersionId:f.profileVersionId,process:'normal_start_h',sourceHash})]})])
    assertFirstHBusinessDelta(f,original,received.message.id,received.message.raw_payload!,firstBefore,after,startedAt,completedAt)
    const timers=sql<Row[]>(`SELECT coalesce(jsonb_agg(to_jsonb(t) ORDER BY timer_type),'[]') FROM public.ediel_sla_timers t WHERE ediel_message_id=${literal(received.message.id)}`)
    expect(timers.map(t=>t.timer_type).sort()).toEqual(['aperak_due','contrl_due'])
    for(const timer of timers)expect(Date.parse(String(timer.due_at))).toBe(Date.parse(received.message.message_received_at!)+agreement.watches.incoming.minutes*60000)
    await acknowledgements(f,original,received.message.id,received.message.raw_payload!)
    const frozen=durable(f,original,received.message.id)
    await processInboundEdielMessage({actorUserId:f.actorUserId,edielMessageId:received.message.id});expect(durable(f,original,received.message.id)).toEqual(frozen)
    const repeated=await Promise.allSettled([1,2].map(()=>processInboundEdielMessage({actorUserId:f.actorUserId,edielMessageId:received.message.id})))
    expect(repeated.filter(r=>r.status==='rejected'),JSON.stringify(repeated)).toEqual([]);expect(durable(f,original,received.message.id)).toEqual(frozen)
  })
})
