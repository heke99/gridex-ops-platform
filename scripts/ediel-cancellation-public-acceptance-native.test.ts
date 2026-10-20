// Constructed native cancellation chains. Whole acceptance IDs are deliberately
// untagged until the literal contracts and this actual registered run are proved.
// Synthetic public tenant/mail inputs and one external SMTP provider double;
// all parsing, origination, archives, native owners, ACKs and consumers are real.
// Historical L4/L3 and LK-1 native cancellation boundaries remain unproved.
// Fresh Z03L origination requires 14 days; it cannot supply an L4 original.
import { approveEdielInboundCase } from '@/lib/ediel/inboundCases'
import { createHash, randomUUID } from 'node:crypto'
import { afterEach, describe, expect, it, vi, type MockInstance } from 'vitest'
const smtp = vi.hoisted(() => vi.fn())
vi.mock('nodemailer', () => ({ default: { createTransport: () => ({ sendMail: smtp }) } }))
import { seedNormalSwitchNativeFixture, futureNativeSupplyDate, nativeSql as sql, literal } from './helpers/ediel-normal-switch-native-fixture'
import { seedOriginalMailboxNative } from './helpers/originalMailboxNative'
import { buildCancellationProspectiveZ04 } from './helpers/ediel-cancellation-prospective-source-2ea'
import { ownerSource, OWNER } from '../__tests__/helpers/sourceOwnerFixtures'
import { closureFixture, CLOSURE_OBJECT } from '../__tests__/helpers/closureWireFixtures'
import { renderProdat } from '@/lib/ediel/prodatEngine'
import { supabaseService } from '@/lib/supabase/service'
import { createMeteringPermissionDraft } from '@/lib/onboarding/infoRequests'
import { getEdielMessageById } from '@/lib/ediel/db'
import * as edielDb from '@/lib/ediel/db'
import * as edielErrors from '@/lib/errors'
import { assertEdielSmtpReadiness } from '@/lib/ediel/mailReadiness'
import { prepareAndQueueSwitchCancellation } from '@/lib/ediel/flows/prodatSwitchCancellation'
import { prepareAndQueueEdielZ03 } from '@/lib/ediel/flows/prodatSwitch'
import { readSwitchCancellationSource } from '@/lib/ediel/production/switchCancellationSource'
import { sendEdielMessageViaSmtp } from '@/lib/ediel/transport'
import { processInboundEdielMessage } from '@/lib/ediel/flows/inboundProcessing'
import { applySupplyMarketSource } from '@/lib/ediel/flows/supplyMarketTransition'
import * as cancellationSupply from '@/lib/ediel/flows/supplyMarketTransition'
import { readPhysicalAckSourceCorrelation } from '@/lib/ediel/ack/sourceCorrelation'
import { processInboundAckMessage } from '@/lib/ediel/flows/inboundAckProcessing'
import { createInboundEdielMessage } from '@/lib/inbound-mail/inboundStatusUpdater'
import { matchOutboundRequestForInbound, matchMeteringPointForInbound } from '@/lib/inbound-mail/inboundMatcher'
import { resolveCanonicalRuntimeDecisionWithRegistry } from '@/lib/ediel/core/runtimeDecision'
import { recordReceivedSourceValidation } from '@/lib/ediel/core/receivedSourceValidationLedger'
import { buildContrlDraft, buildAperakDraft } from '@/lib/ediel/ack'
import { readCommittedInboundAck } from '@/lib/ediel/ack/committedInboundAck'
import { EdifactEnvelopeCodec } from '@/lib/ediel/core/edifactEnvelopeCodec'
import { tokenizeEdifact, segmentComposite } from '@/lib/ediel/core/edifactTokenizer'
import { evaluateProdatTransactionReason } from '@/lib/ediel/prodat/prodatTransactionReason'
import { isQualifiedProdatApplicationError } from '@/lib/ediel/prodat/prodatDiagnosticProjection'
import type { EdielMessageRow } from '@/lib/ediel/types'

type Fixture = Awaited<ReturnType<typeof seedNormalSwitchNativeFixture>> & { endMinute: string }
type Period = { id: string; company_id: string; customer_id: string; metering_point_id: string;
  status: string; start_date: string; end_date: string | null; market_end_at: string | null;
  source_message_id: string; source_end_message_id: string | null; metadata: Record<string, unknown>; market_state_version: number }
const ackErrorObservations = new Map<string, ReturnType<typeof createNativeAckErrorObservation>>()
afterEach(() => { smtp.mockReset(); vi.unstubAllEnvs(); confirmedSupplyWitnesses.clear(); ackErrorObservations.clear() })
function configureSmtp(email = 'recipient@example.invalid') {
  for (const [key, value] of Object.entries({ EDIEL_SHARED_MAILBOX_ADDRESS: 'synthetic@example.invalid',
    EDIEL_APP_DKIM_ENABLED: 'false', EMAIL_PROVIDER: 'resend', EDIEL_SMTP_FROM: 'synthetic@example.invalid',
    EDIEL_SMTP_USER: 'synthetic@example.invalid', EDIEL_SMTP_PASS: 'synthetic-only', EDIEL_EMAIL_PROVIDER: 'strato' })) vi.stubEnv(key, value)
  smtp.mockResolvedValue({ accepted: [email], rejected: [], messageId: randomUUID(), response: '250 synthetic accepted' })
}
async function seed() {
  configureSmtp()
  const endMinute = futureNativeSupplyDate(28).replaceAll('-', '') + '0000'
  const f = await seedNormalSwitchNativeFixture({ requestedStartDate: futureNativeSupplyDate(), provider: configureSmtp })
  const route = randomUUID(), profile = randomUUID(), config = assertEdielSmtpReadiness()
  sql(`INSERT INTO public.communication_routes(id,company_id,route_name,route_scope,grid_owner_id,environment_type,is_active,target_email)
    VALUES(${literal(route)},${literal(f.companyId)},'Synthetic cancellation ACK route','ediel_ack',${literal(f.gridId)},'bilateral_test',true,'recipient@example.invalid');
    INSERT INTO public.ediel_route_profiles(id,company_id,communication_route_id,route_name,environment,message_standard,sender_ediel_id,receiver_ediel_id,application_reference,is_enabled,is_active,payload_format,transport_security_mode,smtp_to,receiver_email,mailbox,smtp_host,smtp_port)
    VALUES(${literal(profile)},${literal(f.companyId)},${literal(route)},'Synthetic cancellation ACK profile','test','edifact',${literal(f.sender)},${literal(f.receiver)},'23-DDQ-PRODAT',true,true,'edifact','unencrypted','recipient@example.invalid','recipient@example.invalid',${literal(config.from)},${literal(config.host)},${config.port});`)
  return { ...f, endMinute }
}
function envelope(f: Fixture, source: string, code: 'Z04' | 'Z05') {
  const body = tokenizeEdifact(source).segments.filter(segment => !['UNA', 'UNB', 'UNH', 'UNT', 'UNZ'].includes(segment.tag))
    .map(segment => segment.tag === 'BGM' ? `BGM+${code}+${randomUUID().replaceAll('-', '').slice(0,20)}+9+AB` : segment.raw)
  return EdifactEnvelopeCodec.encode({ sender: f.receiver, receiver: f.sender, senderQualifier: '14', receiverQualifier: '14',
    applicationReference: '23-DDQ-PRODAT', acknowledgementRequest: true, environment: 'test',
    interchangeReference: randomUUID().replaceAll('-', '').slice(0,14), messages: [{ messageReference: randomUUID().replaceAll('-', '').slice(0,14),
      messageTypeToken: 'PRODAT:D:97A:UN:E2SE6A', businessSegments: body }] })
}
function z04(f: Fixture, reason = 'Z22') {
  if (reason === 'Z22') return buildCancellationProspectiveZ04(f)
  if (reason === 'Z24') return envelope(f, buildCancellationProspectiveZ04(f).replace('CAV+Z22', 'CAV+Z24'), 'Z04')
  const wire = ownerSource().raw_payload!.replaceAll(OWNER.external, f.external)
    .replaceAll('12345:160:SVK', `${f.receiver}:160:SVK`).replaceAll('54321:160:SVK', `${f.sender}:160:SVK`)
    .replaceAll('11111:160:SVK', `${f.brpEdielId}:160:SVK`).replaceAll('CUSTOMER-1::89', `${f.customerIdentity.id}:SE2:260`)
    .replaceAll('RFF+Z05:NET-1', `RFF+Z05:${f.gridAreaCode}`).replaceAll('RFF+LI:CASE-1', `RFF+LI:${f.caseReference}`)
    .replaceAll('202610010000', f.requestedStartDate.replaceAll('-', '') + '0000').replaceAll('CAV+Z22', `CAV+${reason}`)
  return envelope(f, wire, 'Z04')
}
function z05(f: Fixture, reason = 'Z22', mutate: (wire: string) => string = wire => wire) {
  const wire = closureFixture({ reason, minute: f.endMinute, li: f.caseReference }).wire
    .replaceAll(CLOSURE_OBJECT, f.external).replaceAll('12345:160:SVK', `${f.receiver}:160:SVK`)
    .replaceAll('54321:160:SVK', `${f.sender}:160:SVK`).replaceAll('11111:160:SVK', `${f.brpEdielId}:160:SVK`)
    .replaceAll('CUSTOMER-1::89', `${f.customerIdentity.id}:SE2:260`).replaceAll('RFF+Z05:NET-1', `RFF+Z05:${f.gridAreaCode}`)
  return envelope(f, mutate(wire), 'Z05')
}
// A genuine DGI/Z15C wire is a role-confusion control, not an ESCO authority.
// It deliberately names the supplier's same physical customer, point and LI.
function z15cForSupplier(f: Fixture) {
  const reference = randomUUID().replaceAll('-', '').slice(0,20)
  const rendered = renderProdat({ code:'Z15', variant:'C', mode:'test',
    actor:{senderEdielId:f.receiver,receiverEdielId:f.sender}, route:{applicationReference:'23-DGI-PRODAT'},
    version:{selectedVersion:'E2SE6A',messageTypeToken:'PRODAT:D:97A:UN:E2SE6A'},
    context:{code:'Z15',bgmReference:reference,transactionReference:f.caseReference,
      senderEdielId:f.receiver,receiverEdielId:f.sender,legalSenderId:f.receiver,legalReceiverId:f.sender,
      customerName:'Synthetic Own Customer',customerId:f.customerIdentity.id,customerIdCodeListQualifier:'SE2',
      customerIdAgency:'260',customerCountry:'SE',meterPointId:f.external,siteIdAgency:'9',gridAreaId:f.gridAreaCode,
      reasonForTransaction:'Z24',permissionStatus:'A74',permissionId:'NO-ESCO-'+reference,
      permissionEndDate:f.endMinute,permissionEndReason:'E37'} })
  expect(rendered.issues.filter(issue => issue.severity==='error' && !/_UNDETERMINED$/.test(issue.code))).toEqual([])
  expect(rendered.diagnostics).toMatchObject({profileKey:'prodat_z15_permission_ended',
    code:'Z15',variant:'C',rulebookApplicationReference:'23-DGI-PRODAT'})
  return EdifactEnvelopeCodec.encode({sender:f.receiver,receiver:f.sender,senderQualifier:'14',receiverQualifier:'14',
    applicationReference:'23-DGI-PRODAT',environment:'test',acknowledgementRequest:true,
    interchangeReference:randomUUID().replaceAll('-','').slice(0,14),messages:[{
      messageReference:randomUUID().replaceAll('-','').slice(0,14),messageTypeToken:'PRODAT:D:97A:UN:E2SE6A',
      businessSegments:rendered.segments}]})
}
// Preserves PR627/ac264's 30 case identities and original effect controls.
// Public intake replaces private catalog/false-reading setup; committed healthy
// period premises and literal missing223 refusal keep each boundary truthful.
// A failure keeps its original cause; later contract suffixes remain NOT_REACHED.
async function nativePhase<T>(phase: string, run: () => Promise<T>): Promise<T> {
  try { return await run() }
  catch (cause) { throw new Error('native_cancellation_phase:'+phase, { cause }) }
}
async function receiveProdat(f: Fixture, wire: string, code: 'Z04' | 'Z05' | 'Z15', subtype: 'L' | 'LK' | 'C') {
  return nativePhase('public_intake_'+code+subtype, async () => {
    const receivedAt = new Date().toISOString(), config = assertEdielSmtpReadiness()
    const mail = await seedOriginalMailboxNative(sql, literal, { companyId: f.companyId, environment: 'test', raw: wire,
      receivedAt, smtpFrom: config.from })
    const outboundMatch = await matchOutboundRequestForInbound({ companyId: f.companyId, parsed: mail.parsed,
      inboundEmailMessageId: mail.inboundEmailMessageId, parseResultId: mail.parseResultId })
    const meteringPointMatch = await matchMeteringPointForInbound({ companyId: f.companyId, parsed: mail.parsed })
    const id = await createInboundEdielMessage({ companyId: f.companyId, actorUserId: f.actorUserId, environment: 'test',
      inboundEmailMessageId: mail.inboundEmailMessageId, parseResultId: mail.parseResultId,
      parsed: mail.parsed, outboundMatch, meteringPointMatch })
    expect(typeof id, 'public_creator_must_return_actual_source').toBe('string')
    expect(id).toMatch(/^[a-f0-9-]{36}$/)
    const message = await getEdielMessageById(id!)
    expect(message).not.toBeNull()
    expect(message).toMatchObject({ id, company_id: f.companyId, environment: 'test', direction: 'inbound',
      message_code: code, raw_payload: wire, inbound_email_message_id: mail.inboundEmailMessageId,
      rule_profile_key: `PRODAT:${code}:${subtype}:26.A:r3` })
    // Public creator owns the first reception. Read it; never call its writer again.
    const receptions = sql<Record<string, unknown>[]>(`SELECT coalesce(jsonb_agg(to_jsonb(r) ORDER BY id),'[]')
      FROM gridex_ediel_inbound_receptions.receptions r WHERE company_id=${literal(f.companyId)}
      AND source_message_id=${literal(id)};`)
    const payloadHash = createHash('sha256').update(wire).digest('hex')
    expect(receptions).toHaveLength(1)
    expect(receptions[0]).toMatchObject({ source_message_id: id, company_id: f.companyId, environment: 'test',
      inbound_email_message_id: mail.inboundEmailMessageId, parse_result_id: mail.parseResultId,
      actor_user_id: f.actorUserId, classification: 'first_reception',
      canonical_payload_hash: payloadHash, received_payload_hash: payloadHash })
    const retainedMail = sql<{ received_at: string; raw_edifact_payload: string }>(`SELECT to_jsonb(m)
      FROM public.inbound_email_messages m WHERE company_id=${literal(f.companyId)} AND id=${literal(mail.inboundEmailMessageId)};`)
    expect(retainedMail.raw_edifact_payload).toBe(wire)
    expect(Date.parse(retainedMail.received_at)).toBe(Date.parse(receivedAt))
    expect(Date.parse(message!.message_received_at!)).toBe(Date.parse(retainedMail.received_at))
    expect(Date.parse(String(receptions[0].received_at))).toBe(Date.parse(retainedMail.received_at))
    return message!
  })
}
// Missing physical 223 cannot name a C profile. Observe the real public refusal
// and national diagnostic on the same retained mail, without inventing a source.
async function refuseMissingReasonAtPublicIntake(f: Fixture, wire: string) {
  const receivedAt = new Date().toISOString()
  const mail = await seedOriginalMailboxNative(sql, literal, { companyId:f.companyId, environment:'test', raw:wire,
    receivedAt, smtpFrom:assertEdielSmtpReadiness().from })
  expect(mail.parsed.rawPayload).toBe(wire)
  const tokens = tokenizeEdifact(mail.parsed.rawPayload)
  const diagnostic = evaluateProdatTransactionReason({rawSegments:tokens.segments.map(segment=>segment.raw),una:tokens.una,code:'Z05'})
  expect(diagnostic.code).toBe('Z05')
  expect(diagnostic.issues).toContainEqual(expect.objectContaining({code:'PRODAT_TRANSACTION_REASON_INVALID',
    prodatDiagnostic:expect.objectContaining({kind:'field',fieldNumber:'223',errorKind:'missing',
      occurrence:expect.objectContaining({objectId:f.external,identityAgency:'9'})})}))
  expect(diagnostic.applicationErrors).toHaveLength(1)
  expect(diagnostic.applicationErrors[0]).toMatchObject({ercCode:'41',fieldCode:'223',referenceNumber:f.external})
  expect(isQualifiedProdatApplicationError(diagnostic.applicationErrors[0])).toBe(true)
  const custody = () => sql(`SELECT jsonb_build_object(
    'mail',(SELECT to_jsonb(m) FROM public.inbound_email_messages m WHERE company_id=${literal(f.companyId)} AND id=${literal(mail.inboundEmailMessageId)}),
    'parse',(SELECT to_jsonb(p) FROM public.inbound_ediel_parse_results p WHERE company_id=${literal(f.companyId)} AND id=${literal(mail.parseResultId)}));`)
  const before = custody()
  const outboundMatch = await matchOutboundRequestForInbound({companyId:f.companyId,parsed:mail.parsed,
    inboundEmailMessageId:mail.inboundEmailMessageId,parseResultId:mail.parseResultId})
  const meteringPointMatch = await matchMeteringPointForInbound({companyId:f.companyId,parsed:mail.parsed})
  // Call-through observation only: the public creator and its database error
  // remain real. The spy neither returns a result nor supplies authority.
  const warning = vi.spyOn(console,'warn')
  try {
    const id = await createInboundEdielMessage({companyId:f.companyId,actorUserId:f.actorUserId,environment:'test',
      inboundEmailMessageId:mail.inboundEmailMessageId,parseResultId:mail.parseResultId,
      parsed:mail.parsed,outboundMatch,meteringPointMatch})
    expect(id).toBeNull()
    expect(warning.mock.calls).toContainEqual(['[inbound-mail] Kunde inte skapa/uppdatera inbound ediel_message',
      expect.objectContaining({code:'23514',message:expect.stringMatching(/^canonical_inbound_rule_profile_resolution_failed:PRODAT:Z05:\d{4}-\d{2}-\d{2}:(?:0|[2-9]|[1-9]\d+)$/)})])
  } finally { warning.mockRestore() }
  expect(custody()).toEqual(before)
  const retained = custody() as {mail:{raw_edifact_payload:string;received_at:string};parse:{inbound_email_message_id:string}}
  expect(retained.mail.raw_edifact_payload).toBe(wire)
  expect(Date.parse(retained.mail.received_at)).toBe(Date.parse(receivedAt))
  expect(retained.parse.inbound_email_message_id).toBe(mail.inboundEmailMessageId)
  const hash = createHash('sha256').update(wire).digest('hex')
  expect(sql(`SELECT jsonb_build_object(
    'sources',(SELECT count(*) FROM public.ediel_messages WHERE company_id=${literal(f.companyId)} AND environment='test'
      AND (inbound_email_message_id=${literal(mail.inboundEmailMessageId)} OR raw_payload=${literal(wire)})),
    'receptions',(SELECT count(*) FROM gridex_ediel_inbound_receptions.receptions WHERE company_id=${literal(f.companyId)}
      AND environment='test' AND inbound_email_message_id=${literal(mail.inboundEmailMessageId)}),
    'contexts',(SELECT count(*) FROM gridex_ediel_inbound_context.receipts WHERE company_id=${literal(f.companyId)}
      AND environment='test' AND payload_sha256=${literal(hash)}));`)).toEqual({sources:0,receptions:0,contexts:0})
}
// Observation only: no resolver, recorder, apply call or authority is added.
// Emit finite projections; source identities and complete facts stay private.
function observeProcessedSource(f: Fixture, source: EdielMessageRow) {
  const observation = sql(`WITH m AS (
    SELECT *, encode(sha256(convert_to(raw_payload,'UTF8')),'hex') AS observed_hash
    FROM public.ediel_messages WHERE id=${literal(source.id)} AND company_id=${literal(f.companyId)}
      AND environment=${literal(source.environment)}
  ), assessments AS (
    SELECT a.*, a.company_id=m.company_id AND a.environment=m.environment
      AND a.source_payload_hash=m.observed_hash AS bound,
      a.facts_hash=encode(sha256(convert_to(a.facts_text,'UTF8')),'hex') AS facts_match
    FROM gridex_received_sources.validation_assessments a JOIN m ON a.source_message_id=m.id
  ), leaves AS (
    SELECT a.* FROM assessments a WHERE NOT EXISTS (
      SELECT FROM gridex_received_sources.validation_assessments child WHERE child.previous_assessment_id=a.id)
  ), applications AS (
    SELECT p.*, a.bound AND a.facts_match AND p.company_id=m.company_id AND p.environment=m.environment
      AND p.source_message_id=m.id AND p.source_payload_hash=m.observed_hash
      AND p.application_facts_hash=encode(sha256(convert_to(p.application_facts_text,'UTF8')),'hex') AS bound
    FROM gridex_received_sources.prodat_application_facets p JOIN leaves a ON p.assessment_id=a.id CROSS JOIN m
  ), application_objects AS (
    SELECT x->>'applicationDecision' AS decision FROM applications p,
      jsonb_array_elements(p.application_facts_text::jsonb->'objects') x WHERE p.bound
  ), contexts AS (
    SELECT c.*, c.company_id=m.company_id AND c.environment=m.environment AND c.payload_sha256=m.observed_hash AS bound
    FROM gridex_ediel_inbound_context.receipts c JOIN m ON c.source_message_id=m.id
  ), partitions AS (
    SELECT p.*, p.company_id=m.company_id AND p.environment=m.environment AND p.payload_hash=m.observed_hash
      AND a.bound AND a.facts_match AS bound
    FROM gridex_received_sources.supply_object_partitions p JOIN m ON p.source_message_id=m.id
      LEFT JOIN assessments a ON a.id=p.canonical_assessment_id
  ), effects AS (
    SELECT e.*, e.company_id=m.company_id AND e.environment=m.environment AND e.payload_hash=m.observed_hash AS bound
    FROM gridex_received_sources.supply_object_effect_receipts e JOIN m ON e.source_message_id=m.id
  ), receptions AS (
    SELECT r.*, r.company_id=m.company_id AND r.environment=m.environment
      AND r.canonical_payload_hash=m.observed_hash AND r.received_payload_hash=m.observed_hash AS bound
    FROM gridex_ediel_inbound_receptions.receptions r JOIN m ON r.source_message_id=m.id
  ), events AS (
    SELECT e.* FROM public.ediel_message_events e JOIN m ON e.ediel_message_id=m.id AND e.company_id=m.company_id
  ) SELECT jsonb_build_object(
    'phase','after_actual_process','code',(SELECT CASE WHEN message_code IN ('Z04','Z05') THEN message_code ELSE 'unexpected' END FROM m),
    'sourceCount',(SELECT count(*) FROM m),'sourceHashMatches',
      (SELECT observed_hash=${literal(createHash('sha256').update(source.raw_payload!).digest('hex'))} FROM m),
    'status',(SELECT CASE WHEN status IN ('received','parsed','validated','processed','failed') THEN status ELSE 'unexpected' END FROM m),
    'hasFailureReason',(SELECT failure_reason IS NOT NULL FROM m),
    'assessments',(SELECT count(*) FROM assessments),'assessmentBindingMismatches',(SELECT count(*) FROM assessments WHERE bound IS DISTINCT FROM true OR facts_match IS DISTINCT FROM true),
    'leaves',(SELECT count(*) FROM leaves),'applicationFacets',(SELECT count(*) FROM applications),
    'applicationBindingMismatches',(SELECT count(*) FROM applications WHERE bound IS DISTINCT FROM true),
    'headerAccepted',(SELECT count(*) FROM applications WHERE bound AND application_facts_text::jsonb->>'headerDecision'='accepted'),
    'headerHeld',(SELECT count(*) FROM applications WHERE bound AND application_facts_text::jsonb->>'headerDecision'='held'),
    'headerRejected',(SELECT count(*) FROM applications WHERE bound AND application_facts_text::jsonb->>'headerDecision'='rejected'),
    'headerUnexpected',(SELECT count(*) FROM applications WHERE bound AND coalesce(application_facts_text::jsonb->>'headerDecision','') NOT IN ('accepted','held','rejected')),
    'objectsAccepted',(SELECT count(*) FROM application_objects WHERE decision='accepted'),
    'objectsHeld',(SELECT count(*) FROM application_objects WHERE decision='held'),
    'objectsRejected',(SELECT count(*) FROM application_objects WHERE decision='rejected'),
    'objectsUnexpected',(SELECT count(*) FROM application_objects WHERE coalesce(decision,'') NOT IN ('accepted','held','rejected')),
    'contextReady',(SELECT count(*) FROM contexts WHERE bound AND status='ready'),'contextHeld',(SELECT count(*) FROM contexts WHERE bound AND status='held'),
    'contextBindingMismatches',(SELECT count(*) FROM contexts WHERE bound IS DISTINCT FROM true),
    'partitions',(SELECT count(*) FROM partitions),'partitionBindingMismatches',(SELECT count(*) FROM partitions WHERE bound IS DISTINCT FROM true),
    'partitionsApplied',(SELECT count(*) FROM partitions WHERE bound AND result->'applied'='true'::jsonb),
    'partitionsFullyApplied',(SELECT count(*) FROM partitions WHERE bound AND result->'fullyApplied'='true'::jsonb),
    'partitionsReviewRequired',(SELECT count(*) FROM partitions WHERE bound AND result->'reviewRequired'='true'::jsonb),
    'effects',(SELECT count(*) FROM effects),'effectBindingMismatches',(SELECT count(*) FROM effects WHERE bound IS DISTINCT FROM true),
    'sourcePeriods',(SELECT count(*) FROM public.customer_supply_periods p JOIN m ON p.company_id=m.company_id AND p.source_message_id=m.id),
    'receptions',(SELECT count(*) FROM receptions),'receptionBindingMismatches',(SELECT count(*) FROM receptions WHERE bound IS DISTINCT FROM true),
    'validatedEvents',(SELECT count(*) FROM events WHERE event_type='validated'),
    'preBusinessActorTestingHandledEvents',(SELECT count(*) FROM events WHERE event_type='linked' AND event_status='success' AND payload->'actorTestingGlobalHook'='true'::jsonb AND payload->>'phase'='pre_business_processing'),
    'preBusinessActorTestingWarningEvents',(SELECT count(*) FROM events WHERE event_type='manual_note' AND event_status='warning' AND payload->'actorTestingGlobalHook'='true'::jsonb AND payload->>'phase'='pre_business_processing'),
    'validatedPartitionKeyEvents',(SELECT count(*) FROM events WHERE event_type='validated' AND payload ? 'sourceObjectPartition'),
    'validatedPartitionObjectEvents',(SELECT count(*) FROM events WHERE event_type='validated' AND jsonb_typeof(payload->'sourceObjectPartition')='object'),
    'validatedAppliedEvents',(SELECT count(*) FROM events WHERE event_type='validated' AND payload->'applied'='true'::jsonb),
    'validatedFullyAppliedEvents',(SELECT count(*) FROM events WHERE event_type='validated' AND payload->'fullyApplied'='true'::jsonb),
    'validatedReviewRequiredEvents',(SELECT count(*) FROM events WHERE event_type='validated' AND payload->'reviewRequired'='true'::jsonb),
    'canonicalSyntax',(SELECT CASE WHEN validation_report#>>'{canonicalRuntime,syntaxDecision}' IN ('accepted','rejected','not_applicable','manual_review') THEN validation_report#>>'{canonicalRuntime,syntaxDecision}' ELSE 'unknown' END FROM m),
    'canonicalApplication',(SELECT CASE WHEN validation_report#>>'{canonicalRuntime,applicationDecision}' IN ('accepted','rejected','not_applicable','manual_review') THEN validation_report#>>'{canonicalRuntime,applicationDecision}' ELSE 'unknown' END FROM m),
    'canonicalFunction',(SELECT CASE WHEN validation_report#>>'{canonicalRuntime,functionalDecision}' IN ('accepted','rejected','not_applicable','manual_review') THEN validation_report#>>'{canonicalRuntime,functionalDecision}' ELSE 'unknown' END FROM m),
    'warningEvents',(SELECT count(*) FROM events WHERE event_status='warning'),
    'rolledBackEvents',(SELECT count(*) FROM events WHERE payload->>'supplySourceApply'='rolled_back'),
    'registerReadingsUnknownIssueCount',(SELECT count(*) FROM m,jsonb_array_elements(coalesce(validation_report#>'{canonicalRuntime,issues}','[]'::jsonb)) x WHERE x->>'code'='PRODAT_DEPENDENT_CONDITION_UNDETERMINED' AND x#>>'{prodatDiagnostic,kind}'='local_unknown' AND x#>>'{prodatDiagnostic,sourceRule}'='PRODAT26A:register-readings'),
    'genericDependentUnknown214',(SELECT count(*) FROM m,jsonb_array_elements(coalesce(validation_report#>'{canonicalRuntime,issues}','[]'::jsonb)) x WHERE x->>'code'='PRODAT_DEPENDENT_CONDITION_UNDETERMINED' AND x#>>'{prodatDiagnostic,sourceRule}' IN ('Z04:214','Z05:214')),
    'genericDependentUnknown218',(SELECT count(*) FROM m,jsonb_array_elements(coalesce(validation_report#>'{canonicalRuntime,issues}','[]'::jsonb)) x WHERE x->>'code'='PRODAT_DEPENDENT_CONDITION_UNDETERMINED' AND x#>>'{prodatDiagnostic,sourceRule}' IN ('Z04:218','Z05:218')),
    'genericDependentUnknown259',(SELECT count(*) FROM m,jsonb_array_elements(coalesce(validation_report#>'{canonicalRuntime,issues}','[]'::jsonb)) x WHERE x->>'code'='PRODAT_DEPENDENT_CONDITION_UNDETERMINED' AND x#>>'{prodatDiagnostic,sourceRule}' IN ('Z04:259','Z05:259'))
  );`)
  console.info('C_NATIVE_OBSERVER', JSON.stringify(observation))
}
async function process(f: Fixture, source: EdielMessageRow) {
  const decision = await resolveCanonicalRuntimeDecisionWithRegistry(source, { actorUserId: f.actorUserId })
  expect([decision.syntaxDecision, decision.applicationDecision, decision.functionalDecision], JSON.stringify({ phase: 'runtime_decision_'+source.message_code, source: source.id, issues: decision.issues }))
    .toEqual(['accepted', 'accepted', 'accepted'])
  const ackErrorObservation = createNativeAckErrorObservation()
  await ackErrorObservation.run(() => processInboundEdielMessage({ actorUserId: f.actorUserId, edielMessageId: source.id }))
  ackErrorObservations.set(source.id, ackErrorObservation)
  observeProcessedSource(f, source)
  return (await getEdielMessageById(source.id))!
}
const periods = (f: Fixture) => sql<Period[]>(`SELECT coalesce(jsonb_agg(to_jsonb(p) ORDER BY p.id),'[]') FROM public.customer_supply_periods p WHERE company_id=${literal(f.companyId)};`)

// Test-only witnesses come from committed public processing, never source facts.
const confirmedSupplyWitnesses = new Map<string, Readonly<{periodId:string;confirmationId:string}>>()
function assertConfirmedSupplyPrecondition(f:Fixture, confirmation:EdielMessageRow) {
  const actual = periods(f)
  expect(actual, 'native_cancellation_confirmed_supply_precondition').toHaveLength(1)
  expect(actual[0]).toMatchObject({company_id:f.companyId,customer_id:f.customerId,
    metering_point_id:f.pointId,status:'confirmed_by_grid_owner',source_message_id:confirmation.id})
  confirmedSupplyWitnesses.set(f.companyId,Object.freeze({periodId:actual[0].id,confirmationId:confirmation.id}))
}
function assertEndingSupplyPrecondition(f:Fixture, ending:EdielMessageRow) {
  const confirmed = confirmedSupplyWitnesses.get(f.companyId)
  if (!confirmed) throw Error('native_cancellation_confirmed_supply_witness_required')
  const actual = periods(f)
  expect(actual, 'native_cancellation_ending_supply_precondition').toHaveLength(1)
  expect(actual[0]).toMatchObject({id:confirmed.periodId,company_id:f.companyId,customer_id:f.customerId,
    metering_point_id:f.pointId,status:'ending',source_message_id:confirmed.confirmationId,source_end_message_id:ending.id})
}

const switchState = (f: Fixture) => sql<{ status: string; original: string; li: string; inbound: string | null; completed: string | null }>(`SELECT jsonb_build_object('status',status,'original',outbound_z03_message_id,'li',rff_li_reference,'inbound',inbound_z04_message_id,'completed',completed_at) FROM public.supplier_switch_requests WHERE id=${literal(f.switchId)} AND company_id=${literal(f.companyId)};`)
const permissions = (f: Fixture) => sql(`SELECT jsonb_build_object('permissions',(SELECT coalesce(jsonb_agg(to_jsonb(p) ORDER BY p.id),'[]') FROM public.metering_permissions p WHERE company_id=${literal(f.companyId)}),'sites',(SELECT coalesce(jsonb_agg(to_jsonb(p) ORDER BY p.id),'[]') FROM public.metering_permission_sites p WHERE company_id=${literal(f.companyId)}));`)
async function createOwnPermissionDraft(f: Fixture) {
  const draft = await createMeteringPermissionDraft({ companyId:f.companyId,actorUserId:f.actorUserId,
    customerId:f.customerId,siteId:f.siteId,meteringPointId:f.pointId,gridOwnerId:f.gridId,
    requestedStartDate:f.requestedStartDate,requestedEndDate:futureNativeSupplyDate(28),
    caseReference:'C-PRESERVE-'+randomUUID(),lastBlocker:null })
  expect(draft).toMatchObject({ status:'draft',company_id:f.companyId,customer_id:f.customerId,
    site_id:f.siteId,metering_point_id:f.pointId,grid_owner_id:f.gridId,created_by:f.actorUserId })
  const before = permissions(f)
  expect(before).toEqual(expect.objectContaining({ permissions:expect.arrayContaining([expect.objectContaining({
    id:draft.id,status:'draft',company_id:f.companyId,customer_id:f.customerId,
    site_id:f.siteId,metering_point_id:f.pointId,grid_owner_id:f.gridId,case_reference:draft.case_reference })]) }))
  // This public writer creates a DRAFT parent, not an active grant or child sites.
  return before
}
function original(f: Fixture) {
  return sql(`SELECT jsonb_build_object('raw',raw_payload,'hash',immutable_payload_hash,'rendered',immutable_rendered_at,
    'archives',(SELECT coalesce(jsonb_agg(to_jsonb(p) ORDER BY p.id),'[]') FROM public.ediel_message_payloads p WHERE p.ediel_message_id=m.id))
    FROM public.ediel_messages m WHERE id=${literal(f.originalZ03.id)} AND company_id=${literal(f.companyId)};`)
}
function ownedEffects(f: Fixture, sourceId: string) {
  return sql(`SELECT jsonb_build_object('supply',(SELECT coalesce(jsonb_agg(to_jsonb(p) ORDER BY p.id),'[]') FROM public.customer_supply_periods p WHERE company_id=${literal(f.companyId)}),
    'transitions',(SELECT coalesce(jsonb_agg(to_jsonb(t) ORDER BY t.source_message_id),'[]') FROM gridex_received_sources.supply_source_transitions t WHERE company_id=${literal(f.companyId)}),
    'acks',(SELECT coalesce(jsonb_agg(jsonb_build_object('id',id,'family',message_family,'raw',raw_payload,'status',status,'hash',immutable_payload_hash) ORDER BY id),'[]') FROM public.ediel_messages WHERE related_message_id=${literal(sourceId)}),
    'outbox',(SELECT coalesce(jsonb_agg(to_jsonb(o) ORDER BY o.id),'[]') FROM public.ediel_outbox o WHERE source_message_id=${literal(sourceId)}),
    'tasks',(SELECT coalesce(jsonb_agg(to_jsonb(c) ORDER BY c.id),'[]') FROM public.customer_cases c WHERE company_id=${literal(f.companyId)}));`)
}
function supplyBusinessState(f: Fixture) {
  return { periods:periods(f),original:original(f),permissions:permissions(f),history:sql(`SELECT jsonb_build_object(
    'transitions',(SELECT coalesce(jsonb_agg(to_jsonb(t) ORDER BY t.source_message_id),'[]') FROM gridex_received_sources.supply_source_transitions t WHERE company_id=${literal(f.companyId)}),
    'effects',(SELECT coalesce(jsonb_agg(to_jsonb(t) ORDER BY t.id),'[]') FROM gridex_received_sources.supply_object_effect_receipts t WHERE company_id=${literal(f.companyId)}),
    'partitions',(SELECT coalesce(jsonb_agg(to_jsonb(t) ORDER BY t.source_message_id),'[]') FROM gridex_received_sources.supply_object_partitions t WHERE company_id=${literal(f.companyId)}));`) }
}
function positiveAperakCount(f: Fixture, sourceId: string) {
  return sql<number>(`SELECT to_jsonb(count(*)) FROM public.ediel_messages WHERE company_id=${literal(f.companyId)} AND related_message_id=${literal(sourceId)} AND direction='outbound' AND message_family='APERAK' AND ack_outcome='positive';`)
}
type NativeAckErrorIdentity = { companyId: string; sourceId: string; actorUserId: string }
type NativeAckErrorReturn = { value: string; shape: 'native_error' | 'plain_record' | 'string' | 'nullish' | 'other';
  sqlState: '23502' | '23503' | '23505' | '23514' | '42501' | '40001' | '42P01' | '42703' | '42883' | 'P0001' | 'unknown';
  postgrestCode: 'PGRST116' | 'PGRST202' | 'PGRST204' | 'PGRST205' | 'unknown';
  uniqueConstraint: 'ux_ediel_outbound_source' | 'ux_ediel_ack_related' | 'ediel_messages_pkey' | 'ediel_messages_company_id_id_uidx' | 'unknown';
  returnHash: string; returnLength: number }
// Raw calls, returns and event identities remain private. Even one exact full
// propagation match cannot establish causal ownership of a formatter input.
function createNativeAckErrorObservation() {
  let available = false, formatterCallCount = 0, formatterThrowCount = 0, eventCallCount = 0
  let returns: NativeAckErrorReturn[] = [], receipts: unknown[] = []
  const data = (value: unknown, key: string): unknown => {
    if (!value || typeof value !== 'object') return undefined
    try { return Object.getOwnPropertyDescriptor(value, key)?.value } catch { return undefined }
  }
  const classify = (value: unknown): Pick<NativeAckErrorReturn, 'shape' | 'sqlState' | 'postgrestCode' | 'uniqueConstraint'> => {
    let shape: NativeAckErrorReturn['shape'] = 'other'
    try {
      if (value instanceof Error) shape = 'native_error'
      else if (typeof value === 'string') shape = 'string'
      else if (value == null) shape = 'nullish'
      else if (typeof value === 'object' && [Object.prototype, null].includes(Object.getPrototypeOf(value))) shape = 'plain_record'
    } catch { /* Unknown objects remain a fixed class. */ }
    const code = data(value, 'code')
    const sqlStates = ['23502', '23503', '23505', '23514', '42501', '40001', '42P01', '42703', '42883', 'P0001'] as const
    const postgrestCodes = ['PGRST116', 'PGRST202', 'PGRST204', 'PGRST205'] as const
    // Exact public PostgreSQL message templates only; details stay private.
    // These fixed indexes are defined in the captured public schema. No name
    // is inferred from a substring, arbitrary property or non-23505 error.
    const uniqueConstraints = ['ux_ediel_outbound_source', 'ux_ediel_ack_related',
      'ediel_messages_pkey', 'ediel_messages_company_id_id_uidx'] as const
    const ownMessage = code === '23505' ? data(value, 'message') : undefined
    const uniqueConstraint = code === '23505' ? uniqueConstraints.find(name =>
      ownMessage === `duplicate key value violates unique constraint "${name}"`) : undefined
    return { shape, sqlState: sqlStates.find(state => state === code) ?? 'unknown',
      postgrestCode: postgrestCodes.find(state => state === code) ?? 'unknown', uniqueConstraint: uniqueConstraint ?? 'unknown' }
  }
  const cardinality = (count: number): 'zero' | 'one' | 'multiple' => count === 0 ? 'zero' : count === 1 ? 'one' : 'multiple'
  const qualified = (row: unknown, identity: NativeAckErrorIdentity) => {
    const payload = data(row, 'payload'), eventPayload = data(row, 'event_payload')
    return data(row, 'company_id') === identity.companyId && data(row, 'ediel_message_id') === identity.sourceId
      && data(row, 'message_id') === identity.sourceId && data(row, 'created_by') === identity.actorUserId
      && data(row, 'event_type') === 'manual_note' && data(row, 'event_status') === 'warning'
      && ['payload', 'event_payload'].every(column => {
        const value = column === 'payload' ? payload : eventPayload
        return data(value, 'blockedBy') === 'canonical_inbound_ack_guard' && data(value, 'ackFamily') === 'APERAK'
          && data(value, 'sourceMessageId') === identity.sourceId
      }) && typeof data(row, 'id') === 'string' && typeof data(row, 'message') === 'string'
  }
  return {
    async run<T>(run: () => Promise<T>): Promise<T> {
      let formatter: MockInstance<typeof edielErrors.formatErrorMessage> | undefined
      let event: MockInstance<typeof edielDb.createEdielMessageEvent> | undefined
      const restore = (spy: { mockRestore: () => void } | undefined) => {
        try { spy?.mockRestore() } catch { available = false }
      }
      try {
        formatter = vi.spyOn(edielErrors, 'formatErrorMessage')
        event = vi.spyOn(edielDb, 'createEdielMessageEvent')
      } catch { restore(event); restore(formatter); return await run() }
      try { return await run() }
      finally {
        try {
          formatterCallCount = formatter.mock.calls.length
          formatterThrowCount = formatter.mock.results.filter(result => result.type === 'throw').length
          returns = formatter.mock.results.flatMap((result, index) => result.type === 'return' && typeof result.value === 'string'
            ? [{ value: result.value, ...classify(formatter.mock.calls[index]?.[0]),
              returnHash: createHash('sha256').update(result.value).digest('hex'), returnLength: result.value.length }] : [])
          eventCallCount = event.mock.calls.length
          const settled = await Promise.allSettled(event.mock.results.filter(result => result.type === 'return').map(result => result.value))
          receipts = settled.flatMap(result => result.status === 'fulfilled' ? [result.value] : [])
          available = true
        } catch { available = false }
        finally { restore(event); restore(formatter) }
      }
    },
    diagnostic(identity: NativeAckErrorIdentity, readEvents: (ids: string[]) => unknown[]) {
      let persisted: unknown[] = [], readable = available
      const ownReceipts = receipts.filter(row => qualified(row, identity))
      try {
        if (readable && ownReceipts.length) {
          const rows = readEvents(ownReceipts.map(row => data(row, 'id') as string))
          persisted = rows.filter(row => qualified(row, identity) && ownReceipts.some(receipt =>
            ['id', 'company_id', 'ediel_message_id', 'message_id', 'created_by', 'event_type', 'event_status', 'message']
              .every(key => data(receipt, key) === data(row, key))))
        }
      } catch { readable = false; persisted = [] }
      const matchCounts = returns.map(result => persisted.filter(row => data(row, 'message') === 'APERAK skapades inte: ' + result.value).length)
      const matchingCandidateCount = matchCounts.filter(count => count > 0).length
      const matchingEventCount = persisted.filter(row => returns.some(result => data(row, 'message') === 'APERAK skapades inte: ' + result.value)).length
      const matchingPairCount = matchCounts.reduce((sum, count) => sum + count, 0)
      const state = !readable ? 'unavailable' : matchingPairCount === 0 ? 'zero'
        : returns.length === 1 && ownReceipts.length === 1 && matchingEventCount === 1 && matchingPairCount === 1 ? 'single_pair' : 'ambiguous'
      return { state, causalOwnership: 'unestablished', formatterCallCount, formatterReturnCount: returns.length,
        formatterThrowCount, eventCallCount, successfulEventReceiptCount: receipts.length,
        qualifiedEventReceiptCount: ownReceipts.length, persistedEventCount: persisted.length,
        matchingCandidateCount, matchingEventCount, matchingPairCount,
        formatterCardinality: cardinality(returns.length), receiptCardinality: cardinality(ownReceipts.length),
        candidateCardinality: cardinality(matchingCandidateCount), eventCardinality: cardinality(matchingEventCount),
        returns: returns.map((result, index) => ({ shape: result.shape, sqlState: result.sqlState, postgrestCode: result.postgrestCode,
          uniqueConstraint: result.uniqueConstraint,
          returnHash: result.returnHash, returnLength: result.returnLength, persistedMatches: matchCounts[index] })) }
    },
  }
}
function nativeAckErrorObservationDiagnostic(f: Fixture, sourceId: string, stage: 'sendOwnAcks' | 'concurrent601', events: unknown[]) {
  const observation = ackErrorObservations.get(sourceId) ?? createNativeAckErrorObservation()
  const diagnostic = observation.diagnostic({ companyId: f.companyId, sourceId, actorUserId: f.actorUserId }, () => events)
  console.error('C_NATIVE_ACK_FORMAT_OBSERVATION', JSON.stringify({ stage, ...diagnostic }))
}

// Refines peer donor6077035986: read the actual stored guard reason, then
// emit only fixed classifications/counts. Original messages and IDs stay local.
function aperakBlockedWarningDiagnostic(f: Fixture, sourceId: string, stage: 'sendOwnAcks' | 'concurrent601') {
  const warnings = sql<Array<{ message: string }>>(`SELECT coalesce(jsonb_agg(jsonb_build_object('message',e.message,'id',e.id,'company_id',e.company_id,
    'ediel_message_id',e.ediel_message_id,'message_id',e.message_id,'created_by',e.created_by,
    'event_type',e.event_type,'event_status',e.event_status,'payload',e.payload,'event_payload',e.event_payload)
    ORDER BY e.created_at,e.id),'[]') FROM public.ediel_message_events e
    WHERE e.company_id=${literal(f.companyId)} AND e.ediel_message_id=${literal(sourceId)}
      AND e.event_type='manual_note' AND e.event_status='warning'
      AND e.event_payload->>'blockedBy'='canonical_inbound_ack_guard' AND e.event_payload->>'ackFamily'='APERAK'
      AND e.event_payload->>'sourceMessageId'=${literal(sourceId)};`)
  nativeAckErrorObservationDiagnostic(f, sourceId, stage, warnings)
  const allowedGuards = ['ediel_existing_ack_original_read_unavailable', 'ediel_existing_ack_original_source_mismatch',
    'ediel_source_rule_pack_basis_required', 'ediel_historical_rule_pack_basis_unavailable',
    'prodat_bilateral_original_metadata_unqualified', 'prodat_bilateral_capability_required',
    'canonical_ack_actual_original_mismatch', 'prodat_response_original_owner_unavailable',
    'prodat_response_original_rule_witness_mismatch', 'prodat_response_frozen_owner_binding_unavailable',
    'prodat_response_frozen_owner_binding_changed', 'prodat_response_established_original_changed',
    'prodat_domain_response_frozen_owner_required', 'prodat_domain_response_frozen_owner_changed',
    'prodat_domain_response_source_required', 'prodat_domain_response_scope_required',
    'prodat_domain_response_own_effect_unavailable', 'prodat_domain_response_original_guide_unavailable',
    'prodat_domain_response_own_plan_unavailable', 'prodat_domain_response_own_effect_required',
    'prodat_structural_response_source_required', 'prodat_structural_response_scope_required',
    'prodat_structural_response_own_effect_unavailable', 'historical_rule_pack_basis_unavailable',
    'supply_final_response_scope_required', 'supply_final_response_source_changed',
    'supply_final_response_admitted_canonical_required', 'supply_final_response_own_effect_required',
    'supply_final_response_own_effect_uncommitted', 'ediel_existing_ack_original_object_scope_unavailable',
    'ediel_existing_ack_original_basis_unavailable', 'ediel_existing_ack_original_outcome_unavailable',
    'ack_source_scope_unavailable', 'ack_actual_original_unavailable',
    'ack_source_owner_qualification_required', 'historical_rule_pack_guide_scope_unavailable',
    'canonical_ack_original_family_mismatch', 'canonical_ack_source_scope_mismatch',
    'canonical_ack_draft_physical_outcome_mismatch', 'canonical_ack_prodat_source_code_profile_mismatch',
    'canonical_ack_owner_scope_required',
    'ediel_historical_ack_guide_basis_unavailable', 'ediel_ack_guide_original_basis_changed', 'ediel_native_ack_guide_invalid',
    // Exact b7 source-backed fresh/read/render/storage markers; this is finite diagnostic coverage.
    'ediel_inbound_legal_context_required', 'ediel_historical_identity_basis_unavailable', 'ediel_ack_current_captured_role_unavailable',
    'ediel_technical_endpoint_unqualified', 'ediel_ack_replay_actor_not_authorized', 'ediel_ack_replay_actual_source_unavailable',
    'ediel_ack_replay_legal_scope_invalid', 'ediel_business_ack_current_actor_required', 'ediel_fresh_ack_envelope_invalid',
    'ediel_message_reference_length_invalid', 'ediel_unh_unused_element', 'ediel_prodat_aperak_unused_document_element',
    'ediel_native_ack_guide_source_required', 'ediel_registered_original_guide_unavailable', 'prodat_response_native_scope_invalid',
    'ediel_ack_atomic_outcome_required', 'ediel_ack_atomic_wire_outcome_mismatch', 'ediel_ack_atomic_draft_whitelist_required',
    'ediel_ack_atomic_wire_required', 'ediel_ack_atomic_wire_family_mismatch', 'ediel_ack_atomic_owner_scope_mismatch',
    'ediel_ack_atomic_metadata_required', 'ediel_ack_atomic_route_changed', 'ediel_ack_atomic_foreign_source_resource',
    'ediel_ack_atomic_postwrite_owner_mismatch', 'canonical_ack_route_profile_required', 'canonical_ack_atomic_output_scope_mismatch',
    'canonical_ack_draft_outcome_scope_mismatch', 'canonical_ack_physical_scope_required', 'canonical_ack_duplicate_scope_mismatch',
    'canonical_ack_physical_scope_receipt_mismatch', 'ediel_existing_ack_original_current_actor_required', 'ediel_existing_ack_original_read_scope_invalid',
    'ack_source_qualification_scope_mismatch', 'ack_original_application_reference_ambiguous', 'aperak_prodat_document_reference_required',
    'aperak_original_legal_party_projection_conflict', 'aperak_prodat_selected_scope_invalid', 'aperak_prodat_requested_scope_unqualified',
    'aperak_prodat_own_line_reference_required', 'ediel_ack_route_profile_required', 'ediel_ack_route_profile_scope_mismatch',
    'ediel_ack_route_profile_basis_required', 'canonical_route_environment_mismatch', 'canonical_route_profile_environment_mismatch',
    'canonical_route_tenant_mismatch', 'ediel_tenant_actor_required', 'ediel_tenant_permission_required',
    'ediel_tenant_actor_forbidden', 'ediel_tenant_permission_forbidden', 'blocked_final_ack_exists',
    'outbound_ediel_canonical_policy_evidence_missing', 'ACK_GUIDE_ONE_MESSAGE_REQUIRED', 'ACK_ORIGINAL_TECHNICAL_ROUTE_MISMATCH',
    'ACK_SOURCE_FAMILY_MISMATCH', 'ACK_APERAK_PROFILE_INVALID', 'ACK_APERAK_BGM_CARDINALITY',
    'ACK_PRODAT_MESSAGE_FUNCTION_INVALID', 'ACK_PRODAT_UNUSED_DOCUMENT_ELEMENT', 'ACK_APERAK_DOCUMENT_DATE_INVALID',
    'ACK_APERAK_LEGAL_PARTY_INVALID', 'ACK_APERAK_ERROR_GROUP_MISSING', 'ACK_APERAK_ACCEPTANCE_CODE_INVALID',
    'ACK_APERAK_OWN_TEXT_INVALID', 'ACK_APERAK_POSITIVE_TEXT_INVALID', 'ACK_PRODAT_OWN_OBJECT_REFERENCE_INVALID',
    'ACK_PRODAT_ORIGINAL_DOCUMENT_INVALID', 'ACK_PRODAT_ORIGINAL_DOCUMENT_MISMATCH', 'ACK_PRODAT_OWN_OBJECT_SCOPE_MISMATCH',
    'ACK_PRODAT_OWN_OBJECT_REFERENCE_MISMATCH', 'ACK_PRODAT_OWN_OBJECT_OUTCOME_CONFLICT', 'ACK_APERAK_ORIGINAL_LEGAL_PARTY_MISMATCH',
    'CANONICAL_PAYLOAD_REQUIRED', 'CANONICAL_PROCESS_GROUP_MISMATCH', 'CANONICAL_EVIDENCE_DIRECTION_REQUIRED',
    'CANONICAL_ACK_SOURCE_EVIDENCE_UNAVAILABLE', 'CANONICAL_ACK_SOURCE_RULE_PACK_EVIDENCE_REQUIRED', 'CANONICAL_RULE_PACK_EVIDENCE_NOT_ACTIVE',
    // Additional exact SQL replay/owner/retention markers before ACK persistence.
    'ediel_ack_replay_scope_required', 'ediel_ack_replay_own_response_ambiguous', 'ediel_ack_replay_private_own_wire_unavailable',
    'ediel_ack_replay_original_basis_mismatch', 'ediel_ack_replay_physical_source_mismatch', 'ediel_ack_replay_physical_prodat_scope_required',
    'ediel_historical_prodat_ack_scope_basis_unavailable', 'ediel_prodat_ack_scope_conflicting_outcome', 'ediel_prodat_ack_scope_partially_fixed',
    'ediel_ack_actual_original_unavailable', 'ediel_original_bytes_retention_tombstoned', 'ediel_outbound_owner_witness_required',
    'ediel_outbound_owner_actor_scope_required', 'ediel_outbound_owner_preparation_permission_required', 'ediel_prodat_ack_physical_scope_required',
    'ediel_prodat_ack_contradictory_own_outcome', 'ediel_outbound_owner_witness_scope_invalid', 'ediel_historical_outbound_owner_witness_unavailable',
    'ediel_outbound_owner_witness_already_consumed', 'ediel_business_ack_private_relation_changed', 'prodat_structural_response_frozen_binding_changed'] as const
  const prefix = 'APERAK skapades inte: '
  const guards = warnings.map(event => {
    if (typeof event.message !== 'string' || !event.message.startsWith(prefix)) return null
    const reason = event.message.slice(prefix.length)
    // Only the actual leading reason or the exact canonical-policy wrapper supplies a code.
    // Never reclassify a details/hint mention as the primary failure or emit an unknown token.
    const reasonCode = /^([a-z][a-z0-9_]*)(?=$|[:\s])/.exec(reason)?.[1]
      ?? /^Outbound APERAK APERAK blockerades av canonical Ediel-policy: ([A-Z][A-Z0-9_]*) - /.exec(reason)?.[1]
    return allowedGuards.find(guard => guard === reasonCode) ?? null
  })
  console.error('C_NATIVE_APERAK_ACK_GATE', JSON.stringify({ stage, blockedAckEventCount: warnings.length,
    guardCounts: allowedGuards.map(guard => ({ guard, count: guards.filter(value => value === guard).length })),
    unknownGuardCount: guards.filter(guard => guard === null).length }))
}
async function sendOwnAcks(f: Fixture, sourceId: string) {
  const { data, error } = await supabaseService.from('ediel_messages').select('*').eq('company_id', f.companyId)
    .eq('related_message_id', sourceId).eq('direction', 'outbound').order('message_family')
  if (!data?.some(row => row.message_family === 'APERAK' && row.ack_outcome === 'positive')) aperakBlockedWarningDiagnostic(f, sourceId, 'sendOwnAcks')
  expect(error).toBeNull(); expect(data?.map(row => [row.message_family, row.ack_outcome])).toEqual([['APERAK','positive'],['CONTRL','positive']])
  for (const ack of data ?? []) {
    await sendEdielMessageViaSmtp(ack as EdielMessageRow, { actorUserId: f.actorUserId, smtpMimeMode: 'nodemailer-attachment' })
    expect((await getEdielMessageById(ack.id))?.status).toBe('sent')
    expect(sql(`SELECT to_jsonb(count(*)) FROM public.ediel_message_payloads WHERE ediel_message_id=${literal(ack.id)};`)).toBeGreaterThan(0)
  }
}
async function receivePhysicalAck(f: Fixture, sent: EdielMessageRow, family: 'CONTRL' | 'APERAK') {
  // Remote received view exists only as pure renderer input. It never replaces
  // the tenant's real immutable outbound original or mints a private receipt.
  const params = { actorUserId: f.actorUserId, sourceMessage: { ...sent, direction: 'inbound' as const }, outcome: 'positive' as const }
  const wire = (family === 'CONTRL' ? buildContrlDraft(params) : buildAperakDraft(params)).rawPayload!
  const mail = await seedOriginalMailboxNative(sql, literal, { companyId: f.companyId, environment: 'test', raw: wire,
    smtpFrom: assertEdielSmtpReadiness().from })
  const sourceId = await createInboundEdielMessage({ companyId: f.companyId, actorUserId: f.actorUserId, environment: 'test',
    inboundEmailMessageId: mail.inboundEmailMessageId, parseResultId: mail.parseResultId, parsed: mail.parsed })
  expect(sourceId).toBeTruthy()
  // The actual intake adapter already records/qualifies this first reception.
  const message = (await getEdielMessageById(sourceId!))!, decision = await resolveCanonicalRuntimeDecisionWithRegistry(message)
  expect([decision.syntaxDecision,decision.applicationDecision,decision.functionalDecision],JSON.stringify(decision.issues))
    .toEqual(['accepted','accepted','accepted'])
  expect(await recordReceivedSourceValidation({ original: message, validated: message, resolvedCompanyId: f.companyId, decision }))
    .toMatchObject({ status: 'recorded' })
  expect(await processInboundAckMessage({ actorUserId: f.actorUserId, message })).toMatchObject({ outcome: 'positive', sourceMessage: { id: sent.id } })
  expect(await readCommittedInboundAck({ actorUserId: f.actorUserId, message: (await getEdielMessageById(message.id))! }))
    .toMatchObject({ kind: 'exact_receipt', sourceMessageId: sent.id })
}

// Prospective test inputs only. Every resulting period, activation and end below
// is committed by its ordinary public source owner; no source/status/clock edit.
function endedCompensationSourceIdentity(f: Fixture, sourceId: string) {
  return sql(`SELECT jsonb_build_object('id',id,'company_id',company_id,'environment',environment,'direction',direction,
    'raw_payload',raw_payload,'hash',immutable_payload_hash,'received_at',message_received_at,'mail',inbound_email_message_id)
    FROM public.ediel_messages WHERE id=${literal(sourceId)} AND company_id=${literal(f.companyId)};`)
}
function endedCompensationNormalProof(f: Fixture) {
  return sql(`SELECT jsonb_build_object(
    'confirmations',(SELECT coalesce(jsonb_agg(to_jsonb(c) ORDER BY c.period_id),'[]') FROM gridex_received_sources.normal_switch_confirmations c WHERE c.company_id=${literal(f.companyId)}),
    'activations',(SELECT coalesce(jsonb_agg(to_jsonb(a) ORDER BY a.period_id),'[]') FROM gridex_received_sources.normal_supply_activations a WHERE a.company_id=${literal(f.companyId)}));`)
}
function endedCompensationGraph(f: Fixture, confirmationId: string, endingId: string) {
  return { business:supplyBusinessState(f),normal:endedCompensationNormalProof(f),
    confirmation:endedCompensationSourceIdentity(f,confirmationId),ending:endedCompensationSourceIdentity(f,endingId),
    switch:sql<Record<string,unknown>>(`SELECT to_jsonb(s) FROM public.supplier_switch_requests s WHERE id=${literal(f.switchId)} AND company_id=${literal(f.companyId)};`),
    graph:sql(`SELECT jsonb_build_object('customers',(SELECT jsonb_agg(to_jsonb(x) ORDER BY id) FROM public.customers x WHERE company_id=${literal(f.companyId)}),
      'sites',(SELECT jsonb_agg(to_jsonb(x) ORDER BY id) FROM public.customer_sites x WHERE company_id=${literal(f.companyId)}),
      'points',(SELECT jsonb_agg(to_jsonb(x) ORDER BY id) FROM public.metering_points x WHERE company_id=${literal(f.companyId)}),
      'contracts',(SELECT jsonb_agg(to_jsonb(x) ORDER BY id) FROM public.customer_contracts x WHERE company_id=${literal(f.companyId)}));`) }
}
function endedCompensationCases(f: Fixture) {
  return sql<Array<Record<string,unknown>>>(`SELECT coalesce(jsonb_agg(to_jsonb(c) ORDER BY c.id),'[]') FROM public.customer_cases c WHERE c.company_id=${literal(f.companyId)};`)
}
async function observeEndedCompensationApply(f: Fixture, source: EdielMessageRow) {
  const apply=vi.spyOn(cancellationSupply,'applySupplyMarketSource')
  try {
    await process(f,source)
    const own=apply.mock.calls.flatMap((args,index)=>args[0].message.id===source.id&&args[0].actorUserId===f.actorUserId?[apply.mock.results[index]]:[])
    expect(own,'actual_public_supply_owner_must_be_reached_once').toHaveLength(1)
    expect(own[0].type).toBe('return')
    return await own[0].value as cancellationSupply.SupplyMarketResult
  } finally { apply.mockRestore() }
}
async function seedGenuineEndedOwnStart(activate: boolean) {
  configureSmtp()
  // Real elapsed time only: run the same-day premise away from local midnight,
  // so the whole fixture stays within one Etc/GMT-1 day and its end follows start.
  for(;;){const minute=sql<number>(`SELECT to_jsonb((extract(hour FROM clock_timestamp() AT TIME ZONE 'Etc/GMT-1')*60+extract(minute FROM clock_timestamp() AT TIME ZONE 'Etc/GMT-1'))::int);`)
    if(minute>=2&&minute<23*60+50)break;await new Promise(resolve=>setTimeout(resolve,15000))}
  const today=sql<string>(`SELECT to_jsonb((clock_timestamp() AT TIME ZONE 'Etc/GMT-1')::date);`)
  const stage=await seedNormalSwitchNativeFixture({deferOriginal:true,requestedStartDate:today})
  // Select LK/day0 on the prospective request before its immutable Z03 exists.
  sql(`UPDATE public.supplier_switch_requests SET prodat_variant='LK',prodat_reason='Z23',request_type='move_in'
    WHERE id=${literal(stage.switchId)} AND company_id=${literal(stage.companyId)};`)
  const route=randomUUID(),profile=randomUUID(),config=assertEdielSmtpReadiness()
  sql(`INSERT INTO public.communication_routes(id,company_id,route_name,route_scope,grid_owner_id,environment_type,is_active,target_email)
    VALUES(${literal(route)},${literal(stage.companyId)},'Synthetic ended cancellation ACK route','ediel_ack',${literal(stage.gridId)},'bilateral_test',true,'recipient@example.invalid');
    INSERT INTO public.ediel_route_profiles(id,company_id,communication_route_id,route_name,environment,message_standard,sender_ediel_id,receiver_ediel_id,application_reference,is_enabled,is_active,payload_format,transport_security_mode,smtp_to,receiver_email,mailbox,smtp_host,smtp_port)
    VALUES(${literal(profile)},${literal(stage.companyId)},${literal(route)},'Synthetic ended cancellation ACK profile','test','edifact',${literal(stage.sender)},${literal(stage.receiver)},'23-DDQ-PRODAT',true,true,'edifact','unencrypted','recipient@example.invalid','recipient@example.invalid',${literal(config.from)},${literal(config.host)},${config.port});`)
  const queued=await prepareAndQueueEdielZ03({actorUserId:stage.actorUserId,switchRequestId:stage.switchId,communicationRouteId:stage.routeId,environment:'test'})
  await sendEdielMessageViaSmtp(queued,{actorUserId:stage.actorUserId,smtpMimeMode:'nodemailer-attachment'})
  const sent=(await getEdielMessageById(queued.id))!
  expect(sent).toMatchObject({company_id:stage.companyId,direction:'outbound',message_code:'Z03',status:'sent'})
  expect(sql(`SELECT to_jsonb(gridex_received_sources.sent_source_is_current_v1(m)) FROM public.ediel_messages m
    WHERE m.id=${literal(sent.id)} AND m.company_id=${literal(stage.companyId)};`)).toBe(true)
  const tokens=tokenizeEdifact(sent.raw_payload!),li=tokens.segments.find(segment=>segment.tag==='RFF'&&segmentComposite(segment,1,tokens.una)[0]==='LI')
  if(!li)throw Error('native_ended_compensation_genuine_sent_li_required')
  const f:Fixture={...stage,originalZ03:sent,caseReference:segmentComposite(li,1,tokens.una)[1],endMinute:''}
  const confirmation=await receiveProdat(f,envelope(f,buildCancellationProspectiveZ04(f).replace('CAV+Z22','CAV+Z23'),'Z04'),'Z04','LK')
  await process(f,confirmation);assertConfirmedSupplyPrecondition(f,confirmation)
  expect(sql(`SELECT to_jsonb((clock_timestamp() AT TIME ZONE 'Etc/GMT-1')::date);`)).toBe(today)
  if(activate)await cancellationSupply.advanceSupplyMarketDeadlines({actorUserId:f.actorUserId,companyId:f.companyId,limit:1})
  const witness=sql<Array<{period_id:string;original_message_id:string;original_payload_hash:string;source_message_id:string;switch_id:string;status:string;actual_start_date:string|null;due:boolean;activation:Record<string,unknown>|null}>>(`
    SELECT coalesce(jsonb_agg(jsonb_build_object('period_id',p.id,'original_message_id',c.original_message_id,'original_payload_hash',c.original_payload_hash,
      'source_message_id',c.source_message_id,'switch_id',c.switch_id,'status',p.status,'actual_start_date',p.actual_start_date,
      'due',c.market_start_at<=clock_timestamp(),'activation',to_jsonb(a))),'[]')
    FROM gridex_received_sources.normal_switch_confirmations c JOIN public.customer_supply_periods p ON p.id=c.period_id AND p.company_id=c.company_id
    LEFT JOIN gridex_received_sources.normal_supply_activations a ON a.period_id=p.id AND a.company_id=p.company_id
    WHERE c.company_id=${literal(f.companyId)} AND c.switch_id=${literal(f.switchId)};`)
  expect(witness).toHaveLength(1)
  expect(witness[0]).toMatchObject({original_message_id:sent.id,original_payload_hash:createHash('sha256').update(sent.raw_payload!).digest('hex'),
    source_message_id:confirmation.id,switch_id:f.switchId,due:true,
    status:activate?'active':'confirmed_by_grid_owner',...(activate?{actual_start_date:today,
      activation:{company_id:f.companyId,source_message_id:confirmation.id,actor_user_id:f.actorUserId,resulting_period:{id:witness[0].period_id,status:'active'}}}:{activation:null})})
  expect(switchState(f)).toMatchObject({status:activate?'completed':'accepted',original:sent.id,inbound:confirmation.id})
  expect(sql(`SELECT to_jsonb(count(*)) FROM gridex_received_sources.normal_supply_activations WHERE company_id=${literal(f.companyId)};`)).toBe(activate?1:0)
  const [beforeEnd]=periods(f),beforeOriginal=original(f),beforeNormal=endedCompensationNormalProof(f)
  const endMinute=sql<string>(`SELECT to_jsonb(to_char(clock_timestamp() AT TIME ZONE 'Etc/GMT-1','YYYYMMDDHH24MI'));`)
  const startMinute=f.requestedStartDate.replaceAll('-','')+'0000'
  // A failed actual-time premise is setup failure, never an early-hold PASS.
  // No fake timer, backdated original, period-status update or long sleep.
  expect(sql(`SELECT jsonb_build_object('sameStartDay',(clock_timestamp() AT TIME ZONE 'Etc/GMT-1')::date=${literal(today)}::date,
    'startBeforeEnd',gridex_received_sources.permission_time_v1(${literal(startMinute)})<gridex_received_sources.permission_time_v1(${literal(endMinute)}),
    'endDue',gridex_received_sources.permission_time_v1(${literal(endMinute)})<=clock_timestamp());`),
    'native_ended_compensation_actual_elapsed_same_day_required').toEqual({sameStartDay:true,startBeforeEnd:true,endDue:true})
  f.endMinute=endMinute
  const ending=await receiveProdat(f,z05(f),'Z05','L'),endingIdentity=endedCompensationSourceIdentity(f,ending.id)
  const endResult=await observeEndedCompensationApply(f,ending)
  expect(endResult).toMatchObject({applied:true,fullyApplied:true,reviewRequired:false,periods:[{id:witness[0].period_id,status:'ended'}],commits:[],switchIds:[],partition:[{
    object:{objectId:f.external,identityAgency:'9'},disposition:'applied'}]})
  expect(endResult.effectReceiptIds).toHaveLength(1)
  const actual=periods(f)
  expect(actual).toHaveLength(1)
  expect(actual[0]).toMatchObject({id:witness[0].period_id,company_id:f.companyId,customer_id:f.customerId,metering_point_id:f.pointId,
    status:'ended',start_date:today,source_message_id:confirmation.id,source_end_message_id:ending.id,
    market_state_version:beforeEnd.market_state_version+1})
  const endProof=sql<Array<{id:string;payload_bound:boolean;effect_bound:boolean;due:boolean;end_bound:boolean;effect:{previousStates:unknown[];resultingStates:unknown[]};transition:Record<string,unknown>}>>(`
    SELECT coalesce(jsonb_agg(jsonb_build_object('id',e.id,'payload_bound',e.payload_hash=encode(sha256(convert_to(m.raw_payload,'UTF8')),'hex'),
      'effect_bound',e.effect_hash=encode(sha256(convert_to(e.effect_text,'UTF8')),'hex'),'due',p.market_end_at<=clock_timestamp(),
      'end_bound',(e.effect_text::jsonb#>>'{plan,eventAt}')::timestamptz=p.market_end_at,
      'effect',e.effect_text::jsonb,'transition',to_jsonb(t))),'[]')
    FROM gridex_received_sources.supply_object_effect_receipts e JOIN public.ediel_messages m ON m.id=e.source_message_id AND m.company_id=e.company_id
    JOIN public.customer_supply_periods p ON p.id=${literal(actual[0].id)} AND p.company_id=e.company_id
    JOIN gridex_received_sources.supply_source_transitions t ON t.source_message_id=e.source_message_id AND t.company_id=e.company_id
    WHERE e.company_id=${literal(f.companyId)} AND e.source_message_id=${literal(ending.id)};`)
  expect(endProof).toHaveLength(1)
  expect(endProof[0]).toMatchObject({id:endResult.effectReceiptIds[0],payload_bound:true,effect_bound:true,due:true,end_bound:true,
    effect:{owner:'inbound-supply-object-v1',sourceMessageId:ending.id,sourcePayloadHash:createHash('sha256').update(ending.raw_payload!).digest('hex'),
      companyId:f.companyId,environment:'test',
      wire:{point:f.external,identityAgency:'9',customerIdentity:f.customerIdentity.id,li:f.caseReference,end:endMinute},
      plan:{kind:'end',periodId:actual[0].id},previousStates:[beforeEnd],resultingStates:[actual[0]]},
    transition:{source_message_id:ending.id,company_id:f.companyId,payload_hash:createHash('sha256').update(ending.raw_payload!).digest('hex'),source_code:'Z05',previous_states:[beforeEnd],resulting_states:[actual[0]],qualified_switch_ids:[]}})
  expect(endedCompensationNormalProof(f)).toEqual(beforeNormal)
  expect(original(f)).toEqual(beforeOriginal)
  expect(endedCompensationSourceIdentity(f,ending.id)).toEqual(endingIdentity)
  expect(switchState(f)).toMatchObject({status:activate?'completed':'accepted',original:sent.id,inbound:confirmation.id})
  await sendOwnAcks(f,ending.id)
  return {f,sent,confirmation,ending,period:actual[0],endProof:endProof[0]}
}

describe('actual native supplier cancellation chains', () => {

  // masterplan: AT-Z04C-SUPPLIER. An applied own cancellation is never an
  // onboarding source: approving its review case cannot mutate master data.
  it('refuses onboarding approval of an applied Z04C review case without mutating master data', async () => {
    const f = await seed()
    const confirmation = await receiveProdat(f, z04(f), 'Z04', 'L')
    await process(f, confirmation); assertConfirmedSupplyPrecondition(f, confirmation)
    const prepared = await prepareAndQueueSwitchCancellation({ companyId: f.companyId, switchRequestId: f.switchId, actorUserId: f.actorUserId, preferredRouteId: f.routeId, environment: 'test' as const })
    if (!('message' in prepared)) throw Error('genuine_cancellation_required')
    await sendEdielMessageViaSmtp(prepared.message, { actorUserId: f.actorUserId, smtpMimeMode: 'nodemailer-attachment' })
    const completion = await receiveProdat(f, z04(f,'Z24'), 'Z04', 'C')
    await process(f, completion)
    expect(switchState(f)).toMatchObject({ status: 'cancelled_before_start', inbound: completion.id })
    const graph=()=>sql(`SELECT jsonb_build_object('customers',(SELECT jsonb_agg(to_jsonb(x) ORDER BY id) FROM public.customers x WHERE company_id=${literal(f.companyId)}),
      'sites',(SELECT jsonb_agg(to_jsonb(x) ORDER BY id) FROM public.customer_sites x WHERE company_id=${literal(f.companyId)}),
      'points',(SELECT jsonb_agg(to_jsonb(x) ORDER BY id) FROM public.metering_points x WHERE company_id=${literal(f.companyId)}),
      'periods',(SELECT jsonb_agg(to_jsonb(x) ORDER BY id) FROM public.customer_supply_periods x WHERE company_id=${literal(f.companyId)}),
      'switches',(SELECT jsonb_agg(to_jsonb(x) ORDER BY id) FROM public.supplier_switch_requests x WHERE company_id=${literal(f.companyId)}),
      'contracts',(SELECT jsonb_agg(to_jsonb(x) ORDER BY id) FROM public.customer_contracts x WHERE company_id=${literal(f.companyId)}));`)
    const review=()=>sql<Array<{id:string;status:string;review_decision:unknown;updated_at:string}>>(`SELECT coalesce(jsonb_agg(to_jsonb(c)),'[]') FROM public.ediel_inbound_cases c
      WHERE c.company_id=${literal(f.companyId)} AND c.ediel_message_id=${literal(completion.id)};`)
    const [saved]=review(),before=graph()
    expect(saved).toMatchObject({status:'pending_review'})
    for(const mode of [undefined,'update_existing_customer','create_new_customer'] as const)
      await expect(approveEdielInboundCase({ actorUserId: f.actorUserId, caseId: saved.id, companyId: f.companyId, mode }))
        .rejects.toThrow('PRODAT_CANCELLATION_CASE_NOT_APPROVABLE')
    expect(graph()).toEqual(before); expect(review()).toEqual([saved])
  }, 180000)
  it('keeps requested after actual provider250 and physical ACKs; only causal Z04C completes the own future start', async () => {
    const f = await seed(), decoy = await seed(), decoyOriginal = original(decoy), decoySwitch = switchState(decoy)
    const confirmation = await receiveProdat(f, z04(f), 'Z04', 'L')
    await process(f, confirmation); assertConfirmedSupplyPrecondition(f, confirmation)
    const [period] = periods(f); expect(period).toMatchObject({ company_id: f.companyId, customer_id: f.customerId,
      metering_point_id: f.pointId, status: 'confirmed_by_grid_owner', source_message_id: confirmation.id })
    const beforeOriginal = original(f), beforePermission = permissions(f)
    const request = { companyId: f.companyId, switchRequestId: f.switchId, actorUserId: f.actorUserId,
      preferredRouteId: f.routeId, environment: 'test' as const }
    const prepared = await prepareAndQueueSwitchCancellation(request)
    expect(prepared.status).toBe('queued'); if (!('message' in prepared)) throw Error('genuine_cancellation_required')
    expect(prepared.message.original_message_id).toBe(f.originalZ03.id)
    expect(switchState(f)).toMatchObject({ status: 'cancellation_requested', original: f.originalZ03.id, li: f.caseReference, completed: null })
    await sendEdielMessageViaSmtp(prepared.message, { actorUserId: f.actorUserId, smtpMimeMode: 'nodemailer-attachment' })
    const sent = (await getEdielMessageById(prepared.message.id))!
    expect(sent.status).toBe('sent')
    expect(switchState(f)).toMatchObject({ status: 'cancellation_requested', completed: null })
    for (const family of ['CONTRL','APERAK'] as const) {
      await receivePhysicalAck(f, sent, family)
      expect(switchState(f)).toMatchObject({ status: 'cancellation_requested', completed: null })
      expect(periods(f)).toEqual([period])
    }
    const completion = await receiveProdat(f, z04(f,'Z24'), 'Z04', 'C')
    await process(f, completion)
    expect(switchState(f)).toMatchObject({ status: 'cancelled_before_start', original: f.originalZ03.id,
      li: f.caseReference, inbound: completion.id }); expect(switchState(f).completed).not.toBeNull()
    expect(periods(f)).toHaveLength(1); expect(periods(f)[0]).toMatchObject({ id: period.id, status: 'cancelled',
      source_message_id: confirmation.id, metadata: { startCancellationSource: completion.id } })
    await sendOwnAcks(f, completion.id)
    const settled = ownedEffects(f, completion.id)
    await processInboundEdielMessage({ actorUserId: f.actorUserId, edielMessageId: completion.id })
    expect(ownedEffects(f, completion.id)).toEqual(settled)
    expect(original(f)).toEqual(beforeOriginal); expect(permissions(f)).toEqual(beforePermission)
    expect(original(decoy)).toEqual(decoyOriginal); expect(switchState(decoy)).toEqual(decoySwitch); expect(periods(decoy)).toEqual([])
  }, 180000)

  it('restores the same native period from its exact ordinary Z05 end, preserves original history and replays without duplicate replies', async () => {
    const f = await seed(), decoy = await seed(), decoyOriginal = original(decoy), decoySwitch = switchState(decoy)
    const confirmation = await receiveProdat(f,z04(f),'Z04','L')
    await process(f,confirmation); assertConfirmedSupplyPrecondition(f, confirmation)
    const [baseline] = periods(f), beforeOriginal = original(f), beforePermission = permissions(f)
    const ending = await receiveProdat(f,z05(f),'Z05','L'); await process(f,ending); assertEndingSupplyPrecondition(f, ending)
    expect(periods(f)).toHaveLength(1); expect(periods(f)[0]).toMatchObject({ id: baseline.id, status: 'ending', source_end_message_id: ending.id })
    await sendOwnAcks(f,ending.id)
    const continuation = await receiveProdat(f,z05(f,'Z24'),'Z05','C'); await process(f,continuation)
    expect(periods(f)).toHaveLength(1); expect(periods(f)[0]).toMatchObject({ id: baseline.id, status: baseline.status,
      source_message_id: baseline.source_message_id, source_end_message_id: baseline.source_end_message_id,
      end_date: baseline.end_date, market_end_at: baseline.market_end_at,
      metadata: { ...baseline.metadata, endCancellationSource: continuation.id } })
    expect(sql(`SELECT to_jsonb(count(*)) FROM gridex_received_sources.supply_source_transitions WHERE source_message_id IN(${literal(ending.id)},${literal(continuation.id)}) AND company_id=${literal(f.companyId)};`)).toBe(2)
    await sendOwnAcks(f,continuation.id)
    const settled = ownedEffects(f,continuation.id)
    await processInboundEdielMessage({actorUserId:f.actorUserId,edielMessageId:continuation.id})
    expect(ownedEffects(f,continuation.id)).toEqual(settled)
    expect(original(f)).toEqual(beforeOriginal); expect(permissions(f)).toEqual(beforePermission)
    expect(original(decoy)).toEqual(decoyOriginal); expect(switchState(decoy)).toEqual(decoySwitch); expect(periods(decoy)).toEqual([])
  }, 180000)

  it('restoration, physical replies and replay preserve a real nonempty same-tenant permission draft', async () => {
    const f = await seed(), permissionBefore = await createOwnPermissionDraft(f), beforeOriginal = original(f)
    const confirmation = await receiveProdat(f,z04(f),'Z04','L'); await process(f,confirmation); assertConfirmedSupplyPrecondition(f, confirmation)
    const [baseline] = periods(f); expect(permissions(f)).toEqual(permissionBefore)
    const ending = await receiveProdat(f,z05(f),'Z05','L'); await process(f,ending); assertEndingSupplyPrecondition(f, ending)
    const [endingPeriod] = periods(f)
    expect(endingPeriod).toMatchObject({id:baseline.id,status:'ending',source_end_message_id:ending.id})
    expect(permissions(f)).toEqual(permissionBefore)
    const continuation = await receiveProdat(f,z05(f,'Z24'),'Z05','C'); await process(f,continuation)
    expect(periods(f)).toHaveLength(1)
    expect(periods(f)[0]).toMatchObject({id:baseline.id,status:baseline.status,source_message_id:baseline.source_message_id,
      source_end_message_id:baseline.source_end_message_id,end_date:baseline.end_date,market_end_at:baseline.market_end_at,
      market_state_version:endingPeriod.market_state_version+1,metadata:{...baseline.metadata,endCancellationSource:continuation.id}})
    expect(permissions(f)).toEqual(permissionBefore); expect(original(f)).toEqual(beforeOriginal)
    await sendOwnAcks(f,continuation.id)
    expect(permissions(f)).toEqual(permissionBefore)
    const settled = ownedEffects(f,continuation.id)
    await processInboundEdielMessage({actorUserId:f.actorUserId,edielMessageId:continuation.id})
    expect(ownedEffects(f,continuation.id)).toEqual(settled)
    expect(positiveAperakCount(f,continuation.id)).toBe(1)
    expect(permissions(f)).toEqual(permissionBefore); expect(original(f)).toEqual(beforeOriginal)
  }, 180000)

  it('holds public DGI Z15C for the supplier without restoring its end, then only DDQ Z05C restores the same period', async () => {
    const f = await seed(), foreign = await seed()
    await createOwnPermissionDraft(f); await createOwnPermissionDraft(foreign)
    const confirmation = await receiveProdat(f,z04(f),'Z04','L')
    await process(f,confirmation); assertConfirmedSupplyPrecondition(f,confirmation)
    const [baseline] = periods(f)
    const foreignConfirmation = await receiveProdat(foreign,z04(foreign),'Z04','L')
    await process(foreign,foreignConfirmation); assertConfirmedSupplyPrecondition(foreign,foreignConfirmation)
    const ending = await receiveProdat(f,z05(f),'Z05','L')
    await process(f,ending); assertEndingSupplyPrecondition(f,ending); await sendOwnAcks(f,ending.id)
    const [endingPeriod] = periods(f), before = supplyBusinessState(f), foreignBefore = supplyBusinessState(foreign)
    const endingEffects = ownedEffects(f,ending.id), providerCalls = smtp.mock.calls.length
    const permissionEffects = () => sql(`SELECT jsonb_build_object(
      'grants',(SELECT coalesce(jsonb_agg(to_jsonb(g) ORDER BY g.id),'[]') FROM public.ediel_data_access_grants g WHERE company_id IN(${literal(f.companyId)},${literal(foreign.companyId)})),
      'receipts',(SELECT coalesce(jsonb_agg(to_jsonb(r) ORDER BY r.id),'[]') FROM gridex_received_sources.permission_effect_receipts r WHERE company_id IN(${literal(f.companyId)},${literal(foreign.companyId)})),
      'transitions',(SELECT coalesce(jsonb_agg(to_jsonb(t) ORDER BY t.company_id,t.source_message_id,t.permission_id,t.applied_at),'[]') FROM gridex_received_sources.permission_effect_transitions_v1 t WHERE company_id IN(${literal(f.companyId)},${literal(foreign.companyId)})));`)
    const permissionBefore = permissionEffects()
    expect(sql(`SELECT jsonb_build_object('supplier',count(*) FILTER(WHERE role_code='electricity_supplier'),
      'esco',count(*) FILTER(WHERE role_code='energy_service_company')) FROM public.tenant_actor_roles
      WHERE company_id=${literal(f.companyId)} AND environment='test' AND actor_id=${literal(f.actorUserId)}
        AND valid_from<=clock_timestamp() AND (valid_to IS NULL OR clock_timestamp()<valid_to);`)).toEqual({supplier:1,esco:0})
    const wire = z15cForSupplier(f), held = await receiveProdat(f,wire,'Z15','C')
    expect(held.application_reference).toBe('23-DGI-PRODAT')
    const legalReceipt = () => sql(`SELECT to_jsonb(r) FROM gridex_ediel_inbound_context.receipts r
      WHERE company_id=${literal(f.companyId)} AND source_message_id=${literal(held.id)};`)
    const retained = legalReceipt()
    expect(retained).toMatchObject({source_message_id:held.id,company_id:f.companyId,environment:'test',direction:'inbound',
      payload_sha256:createHash('sha256').update(wire).digest('hex'),status:'held',reason:'ediel_inbound_legal_context_required',context:{}})
    for (let attempt=0; attempt<2; attempt++) {
      const result = await processInboundEdielMessage({actorUserId:f.actorUserId,edielMessageId:held.id})
      expect(result).toMatchObject({id:held.id,company_id:f.companyId,raw_payload:wire,message_code:'Z15',
        tenant_resolution_status:'tenant_ambiguous',business_match_status:'business_blocked',processing_status:'routing_unresolved'})
      expect(sql(`SELECT coalesce(jsonb_agg(payload ORDER BY id),'[]') FROM public.ediel_message_events
        WHERE company_id=${literal(f.companyId)} AND ediel_message_id=${literal(held.id)} AND event_type='manual_note'
          AND event_status='warning' AND payload->>'tenantResolutionStatus'='tenant_ambiguous';`))
        .toContainEqual(expect.objectContaining({tenantResolutionStatus:'tenant_ambiguous',ackDecision:'no_negative_contrl_for_routing_unresolved'}))
      expect(legalReceipt()).toEqual(retained)
      expect(supplyBusinessState(f)).toEqual(before); expect(supplyBusinessState(foreign)).toEqual(foreignBefore)
      expect(permissionEffects()).toEqual(permissionBefore); expect(ownedEffects(f,ending.id)).toEqual(endingEffects)
      expect(positiveAperakCount(f,held.id)).toBe(0); expect(smtp.mock.calls).toHaveLength(providerCalls)
    }
    // A technical CONTRL/diagnostic may exist; it cannot grant business effect.
    const continuation = await receiveProdat(f,z05(f,'Z24'),'Z05','C')
    expect(continuation.application_reference).toBe('23-DDQ-PRODAT')
    await process(f,continuation)
    expect(periods(f)).toHaveLength(1)
    expect(periods(f)[0]).toMatchObject({id:baseline.id,status:baseline.status,source_message_id:baseline.source_message_id,
      source_end_message_id:baseline.source_end_message_id,end_date:baseline.end_date,market_end_at:baseline.market_end_at,
      market_state_version:endingPeriod.market_state_version+1,metadata:{...baseline.metadata,endCancellationSource:continuation.id}})
    await sendOwnAcks(f,continuation.id)
    const settled = ownedEffects(f,continuation.id)
    await processInboundEdielMessage({actorUserId:f.actorUserId,edielMessageId:continuation.id})
    expect(ownedEffects(f,continuation.id)).toEqual(settled); expect(positiveAperakCount(f,continuation.id)).toBe(1)
    expect(original(f)).toEqual(before.original); expect(permissions(f)).toEqual(before.permissions)
    expect(permissionEffects()).toEqual(permissionBefore); expect(supplyBusinessState(foreign)).toEqual(foreignBefore)
    expect(legalReceipt()).toEqual(retained)
  }, 180000)

  it('final partition failure preserves the real nonempty permission draft and rolls back all supply business state', async () => {
    const f = await seed(), permissionBefore = await createOwnPermissionDraft(f)
    const confirmation = await receiveProdat(f,z04(f),'Z04','L'); await process(f,confirmation); assertConfirmedSupplyPrecondition(f, confirmation)
    const ending = await receiveProdat(f,z05(f),'Z05','L'); await process(f,ending); assertEndingSupplyPrecondition(f, ending)
    expect(permissions(f)).toEqual(permissionBefore)
    const continuation = await receiveProdat(f,z05(f,'Z24'),'Z05','C'), before = supplyBusinessState(f)
    const constraint = 'z05c_draft_final_partition_'+randomUUID().replaceAll('-','')
    sql(`ALTER TABLE gridex_received_sources.supply_object_partitions ADD CONSTRAINT ${constraint} CHECK(NOT(company_id=${literal(f.companyId)}::uuid AND source_message_id=${literal(continuation.id)}::uuid)) NOT VALID;`)
    try {
      await processInboundEdielMessage({actorUserId:f.actorUserId,edielMessageId:continuation.id})
      const warnings = sql(`SELECT coalesce(jsonb_agg(payload ORDER BY id),'[]') FROM public.ediel_message_events WHERE ediel_message_id=${literal(continuation.id)} AND company_id=${literal(f.companyId)} AND event_type='manual_note' AND event_status='warning' AND payload->>'supplySourceApply'='rolled_back';`)
      expect(warnings).toEqual(expect.arrayContaining([expect.objectContaining({supplySourceApply:'rolled_back',reason:expect.stringContaining(constraint)})]))
      expect(supplyBusinessState(f)).toEqual(before); expect(permissions(f)).toEqual(permissionBefore)
      expect(positiveAperakCount(f,continuation.id)).toBe(0)
    } finally {
      sql(`ALTER TABLE gridex_received_sources.supply_object_partitions DROP CONSTRAINT ${constraint};`)
    }
  }, 180000)

  it('a stale cancellation of restored end A cannot restore the current distinct end B', async () => {
    const f = await seed(), confirmation = await receiveProdat(f,z04(f),'Z04','L')
    await process(f,confirmation); assertConfirmedSupplyPrecondition(f, confirmation)
    const [baseline] = periods(f)
    const endingA = await receiveProdat(f,z05(f),'Z05','L'); await process(f,endingA); assertEndingSupplyPrecondition(f, endingA)
    expect(periods(f)[0]).toMatchObject({ id: baseline.id, status: 'ending', source_end_message_id: endingA.id })
    const restorationA = await receiveProdat(f,z05(f,'Z24'),'Z05','C'); await process(f,restorationA)
    expect(periods(f)[0]).toMatchObject({ id: baseline.id, status: baseline.status, source_end_message_id: null })
    const endBMinute = new Date(Date.UTC(Number(f.endMinute.slice(0,4)),Number(f.endMinute.slice(4,6))-1,
      Number(f.endMinute.slice(6,8))+1)).toISOString().slice(0,10).replaceAll('-','')+'0000'
    expect(endBMinute).not.toBe(f.endMinute)
    const endingB = await receiveProdat(f,z05({...f,endMinute:endBMinute}),'Z05','L'); await process(f,endingB); assertEndingSupplyPrecondition(f, endingB)
    expect(periods(f)[0]).toMatchObject({ id: baseline.id, status: 'ending', source_end_message_id: endingB.id })
    const before = periods(f), permissionBefore = permissions(f)
    const transitionCount = sql<number>(`SELECT to_jsonb(count(*)) FROM gridex_received_sources.supply_source_transitions WHERE company_id=${literal(f.companyId)};`)
    const staleA = await receiveProdat(f,z05(f,'Z24'),'Z05','C')
    await processInboundEdielMessage({actorUserId:f.actorUserId,edielMessageId:staleA.id})
    expect(periods(f)).toEqual(before); expect(permissions(f)).toEqual(permissionBefore)
    expect(sql(`SELECT to_jsonb(count(*)) FROM gridex_received_sources.supply_source_transitions WHERE company_id=${literal(f.companyId)};`)).toBe(transitionCount)
    expect(sql(`SELECT to_jsonb(count(*)) FROM gridex_received_sources.supply_source_transitions WHERE source_message_id=${literal(staleA.id)};`)).toBe(0)
    expect(sql(`SELECT to_jsonb(count(*)) FROM public.ediel_messages WHERE company_id=${literal(f.companyId)} AND related_message_id=${literal(staleA.id)} AND direction='outbound' AND message_family='APERAK' AND ack_outcome='positive';`)).toBe(0)
  }, 180000)

  it('refuses raw and direction rewrites of a genuinely received Z05C without changing source, reception or effects', async () => {
    const f = await seed(), confirmation = await receiveProdat(f,z04(f),'Z04','L'); await process(f,confirmation); assertConfirmedSupplyPrecondition(f, confirmation)
    const ending = await receiveProdat(f,z05(f),'Z05','L'); await process(f,ending); assertEndingSupplyPrecondition(f, ending)
    const continuation = await receiveProdat(f,z05(f,'Z24'),'Z05','C'); await process(f,continuation)
    const retained = () => sql(`SELECT jsonb_build_object('message',(SELECT to_jsonb(m) FROM public.ediel_messages m WHERE id=${literal(continuation.id)} AND company_id=${literal(f.companyId)}),
      'source',(SELECT to_jsonb(s) FROM gridex_received_sources.sources s WHERE source_message_id=${literal(continuation.id)} AND company_id=${literal(f.companyId)}),
      'receptions',(SELECT coalesce(jsonb_agg(to_jsonb(r) ORDER BY r.id),'[]') FROM gridex_ediel_inbound_receptions.receptions r WHERE source_message_id=${literal(continuation.id)} AND company_id=${literal(f.companyId)}),
      'responseRequests',(SELECT coalesce(jsonb_agg(to_jsonb(r) ORDER BY r.id),'[]') FROM gridex_ediel_inbound_receptions.response_requests r WHERE source_message_id=${literal(continuation.id)} AND company_id=${literal(f.companyId)}));`)
    expect(sql(`SELECT to_jsonb(count(*)) FROM gridex_ediel_inbound_receptions.receptions WHERE source_message_id=${literal(continuation.id)} AND classification='first_reception';`)).toBe(1)
    const before = retained(), effectsBefore = ownedEffects(f,continuation.id), permissionBefore = permissions(f)
    expect(continuation.raw_payload).toContain('CAV+Z24')
    const rawChange = await supabaseService.from('ediel_messages').update({raw_payload:continuation.raw_payload!.replace('CAV+Z24','CAV+Z22')})
      .eq('company_id',f.companyId).eq('id',continuation.id)
    expect(rawChange.error).toMatchObject({code:'23514',message:'immutable_ediel_payload_cannot_change'})
    expect(retained()).toEqual(before); expect(ownedEffects(f,continuation.id)).toEqual(effectsBefore)
    const directionChange = await supabaseService.from('ediel_messages').update({direction:'outbound'})
      .eq('company_id',f.companyId).eq('id',continuation.id)
    expect(directionChange.error).toMatchObject({code:'23514',message:'immutable_ediel_received_context_cannot_change'})
    expect(retained()).toEqual(before); expect(ownedEffects(f,continuation.id)).toEqual(effectsBefore)
    expect(permissions(f)).toEqual(permissionBefore)
  }, 180000)

  it.each(['226','260','223','227','228','232','231','316','233','234','262'])('holds individually omitted required Z05C field %s with its actual national diagnostic', async fieldNumber => {
    const f = await seed(), confirmation = await receiveProdat(f,z04(f),'Z04','L'); await process(f,confirmation); assertConfirmedSupplyPrecondition(f, confirmation)
    const ending = await receiveProdat(f,z05(f),'Z05','L'); await process(f,ending); assertEndingSupplyPrecondition(f, ending)
    const before = periods(f), permissionBefore = permissions(f)
    const transitions = () => sql(`SELECT coalesce(jsonb_agg(to_jsonb(t) ORDER BY t.source_message_id),'[]') FROM gridex_received_sources.supply_source_transitions t WHERE company_id=${literal(f.companyId)};`)
    const historyBefore = transitions()
    const wire = z05(f,'Z24', wire => {
      const parsed = tokenizeEdifact(wire)
      if (fieldNumber === '223') {
        const index = parsed.segments.findIndex(segment => segment.tag === 'CCI' && segmentComposite(segment,2,parsed.una)[0] === 'Z13')
        const characteristic = parsed.segments[index], value = parsed.segments[index+1]
        expect(index).toBeGreaterThanOrEqual(0); expect(value.tag).toBe('CAV')
        expect(segmentComposite(value,1,parsed.una)[0]).toBe('Z24')
        // The own field is absent, rather than an invalid CCI with no value.
        return wire.replace(characteristic.raw+parsed.una.segmentTerminator+value.raw+parsed.una.segmentTerminator,'')
      }
      if (['226','260'].includes(fieldNumber)) {
        const target = parsed.segments.find(segment => segment.tag === 'RFF' && segmentComposite(segment,1,parsed.una)[0] === (fieldNumber === '226' ? 'LI' : 'Z05'))
        expect(target).toBeDefined()
        return wire.replace(target!.raw+parsed.una.segmentTerminator,'')
      }
      const qualifier = ['233','234'].includes(fieldNumber) ? 'IT' : fieldNumber === '262' ? 'Z02' : 'UD'
      const party = parsed.segments.find(segment => segment.tag === 'NAD' && segmentComposite(segment,1,parsed.una)[0] === qualifier)
      expect(party).toBeDefined()
      const element = ({'227':2,'228':4,'232':6,'231':8,'316':9,'233':2,'234':5,'262':2} as Record<string,number>)[fieldNumber]
      // These shared synthetic NADs contain no released data separators.
      // Preserve all the other raw children of the actual selected parent.
      const children = party!.raw.split(parsed.una.dataElementSeparator)
      expect(children[element]).toBeTruthy()
      children[element] = ''
      return wire.replace(party!.raw,children.join(parsed.una.dataElementSeparator))
    })
    // z05 re-encodes the complete envelope after the single-field omission.
    if (fieldNumber === '223') {
      const businessBefore = supplyBusinessState(f), effectsBefore = ownedEffects(f,ending.id)
      const providerCallsBefore = smtp.mock.calls.length
      const positiveReplies = () => sql(`SELECT to_jsonb(count(*)) FROM public.ediel_messages WHERE company_id=${literal(f.companyId)}
        AND direction='outbound' AND message_family='APERAK' AND ack_outcome='positive';`)
      const positiveRepliesBefore = positiveReplies()
      await refuseMissingReasonAtPublicIntake(f,wire)
      expect(periods(f)).toEqual(before); expect(permissions(f)).toEqual(permissionBefore)
      expect(transitions()).toEqual(historyBefore)
      expect(supplyBusinessState(f)).toEqual(businessBefore); expect(ownedEffects(f,ending.id)).toEqual(effectsBefore)
      expect(smtp.mock.calls).toHaveLength(providerCallsBefore)
      expect(positiveReplies()).toBe(positiveRepliesBefore)
      return
    }
    const held = await receiveProdat(f,wire,'Z05','C')
    const decision = await resolveCanonicalRuntimeDecisionWithRegistry(held)
    expect(decision.syntaxDecision,JSON.stringify(decision.issues)).toBe('accepted')
    expect(decision.issues).toContainEqual(expect.objectContaining({
      prodatDiagnostic:expect.objectContaining({fieldNumber,...(fieldNumber === '223' ? {errorKind:'missing'} : {})}),
    }))
    await processInboundEdielMessage({actorUserId:f.actorUserId,edielMessageId:held.id})
    expect(periods(f)).toEqual(before); expect(permissions(f)).toEqual(permissionBefore)
    expect(transitions()).toEqual(historyBefore)
    // A valid syntax CONTRL is permitted; no positive business APERAK is.
    expect(sql(`SELECT to_jsonb(count(*)) FROM public.ediel_messages WHERE company_id=${literal(f.companyId)} AND related_message_id=${literal(held.id)} AND direction='outbound' AND message_family='APERAK' AND ack_outcome='positive';`)).toBe(0)
  }, 180000)

  it('concurrent invocation of the same received C restores once with one transition and one reply per family', async () => {
    const f = await seed(), confirmation = await receiveProdat(f,z04(f),'Z04','L'); await process(f,confirmation); assertConfirmedSupplyPrecondition(f, confirmation)
    const [baseline] = periods(f)
    const ending = await receiveProdat(f,z05(f),'Z05','L'); await process(f,ending); assertEndingSupplyPrecondition(f, ending)
    const [endingPeriod] = periods(f), beforeOriginal = original(f), permissionBefore = permissions(f)
    const endingHistory = () => sql(`SELECT to_jsonb(t) FROM gridex_received_sources.supply_source_transitions t WHERE source_message_id=${literal(ending.id)} AND company_id=${literal(f.companyId)};`)
    const historyBefore = endingHistory()
    const continuation = await receiveProdat(f,z05(f,'Z24'),'Z05','C')
    // Concurrent INVOCATION only: this does not attest observed lock overlap
    // or a transaction's final-write rollback boundary.
    const ackErrorObservation = createNativeAckErrorObservation()
    const settled = await ackErrorObservation.run(() => Promise.allSettled([0,1].map(() => processInboundEdielMessage({actorUserId:f.actorUserId,edielMessageId:continuation.id}))))
    ackErrorObservations.set(continuation.id, ackErrorObservation)
    const outcomes = settled.map(result => {
      if (result.status === 'fulfilled') return {status:result.status}
      const reason = result.reason as {code?:unknown;message?:unknown;details?:unknown} | null
      return {status:result.status,code:typeof reason?.code === 'string' ? reason.code : null,
        message:typeof reason?.message === 'string' ? reason.message : null,
        details:typeof reason?.details === 'string' ? reason.details : null}
    })
    const durable = sql(`SELECT jsonb_build_object(
      'inboundCases',(SELECT coalesce(jsonb_agg(id ORDER BY id),'[]') FROM public.ediel_inbound_cases WHERE company_id=${literal(f.companyId)} AND ediel_message_id=${literal(continuation.id)}),
      'routeCardinality',(SELECT coalesce(jsonb_agg(jsonb_build_object('routeId',r.communication_route_id,'count',r.n) ORDER BY r.communication_route_id),'[]') FROM (SELECT communication_route_id,count(*) n FROM public.ediel_route_runtime_v WHERE company_id=${literal(f.companyId)} GROUP BY communication_route_id) r),
      'transitions',(SELECT count(*) FROM gridex_received_sources.supply_source_transitions WHERE company_id=${literal(f.companyId)} AND source_message_id=${literal(continuation.id)}),
      'effectReceipts',(SELECT count(*) FROM gridex_received_sources.supply_object_effect_receipts WHERE company_id=${literal(f.companyId)} AND source_message_id=${literal(continuation.id)}),
      'partitions',(SELECT count(*) FROM gridex_received_sources.supply_object_partitions WHERE company_id=${literal(f.companyId)} AND source_message_id=${literal(continuation.id)}),
      'responseBindings',(SELECT count(*) FROM gridex_ediel_ack_guide.prodat_structural_response_bindings WHERE company_id=${literal(f.companyId)} AND source_message_id=${literal(continuation.id)}),
      'acks',(SELECT coalesce(jsonb_agg(jsonb_build_object('family',message_family,'outcome',ack_outcome) ORDER BY message_family,id),'[]') FROM public.ediel_messages WHERE company_id=${literal(f.companyId)} AND related_message_id=${literal(continuation.id)} AND direction='outbound'));`)
    const diagnostic = JSON.stringify({companyId:f.companyId,sourceId:continuation.id,outcomes,durable,periods:periods(f).map(p => ({id:p.id,status:p.status,
      version:p.market_state_version,endingSource:p.source_end_message_id}))})
    expect(outcomes.filter(result => result.status === 'rejected'),diagnostic).toEqual([])
    expect(periods(f)).toHaveLength(1)
    expect(periods(f)[0]).toMatchObject({ id:baseline.id,status:baseline.status,source_message_id:baseline.source_message_id,
      source_end_message_id:baseline.source_end_message_id,end_date:baseline.end_date,market_end_at:baseline.market_end_at,
      market_state_version:endingPeriod.market_state_version+1,metadata:{...baseline.metadata,endCancellationSource:continuation.id} })
    expect(sql(`SELECT to_jsonb(count(*)) FROM gridex_received_sources.supply_source_transitions WHERE source_message_id=${literal(continuation.id)} AND company_id=${literal(f.companyId)};`)).toBe(1)
    if (positiveAperakCount(f, continuation.id) === 0) aperakBlockedWarningDiagnostic(f, continuation.id, 'concurrent601')
    expect(sql(`SELECT coalesce(jsonb_agg(jsonb_build_object('family',message_family,'outcome',ack_outcome) ORDER BY message_family,id),'[]') FROM public.ediel_messages WHERE company_id=${literal(f.companyId)} AND related_message_id=${literal(continuation.id)} AND direction='outbound';`))
      .toEqual([{family:'APERAK',outcome:'positive'},{family:'CONTRL',outcome:'positive'}])
    expect(original(f)).toEqual(beforeOriginal); expect(endingHistory()).toEqual(historyBefore)
    expect(permissions(f)).toEqual(permissionBefore)
  }, 180000)

  it('a receiver supplier role expired after genuine C reception cannot restore the ending period', async () => {
    const f = await seed(), confirmation = await receiveProdat(f,z04(f),'Z04','L'); await process(f,confirmation); assertConfirmedSupplyPrecondition(f, confirmation)
    const ending = await receiveProdat(f,z05(f),'Z05','L'); await process(f,ending); assertEndingSupplyPrecondition(f, ending)
    const continuation = await receiveProdat(f,z05(f,'Z24'),'Z05','C'), before = supplyBusinessState(f)
    expect(sql(`WITH changed AS (UPDATE public.tenant_actor_roles SET valid_to=clock_timestamp() WHERE company_id=${literal(f.companyId)} AND actor_id=${literal(f.actorUserId)} AND environment='test' AND role_code='electricity_supplier' AND valid_to IS NULL RETURNING id) SELECT to_jsonb(count(*)) FROM changed;`)).toBe(1)
    await processInboundEdielMessage({actorUserId:f.actorUserId,edielMessageId:continuation.id})
    expect(supplyBusinessState(f)).toEqual(before)
    expect(positiveAperakCount(f,continuation.id)).toBe(0)
  }, 180000)

  it('a genuine foreign execution actor cannot apply the own fresh C source', async () => {
    const f = await seed(), foreign = await seed(), confirmation = await receiveProdat(f,z04(f),'Z04','L'); await process(f,confirmation); assertConfirmedSupplyPrecondition(f, confirmation)
    const ending = await receiveProdat(f,z05(f),'Z05','L'); await process(f,ending); assertEndingSupplyPrecondition(f, ending)
    const continuation = await receiveProdat(f,z05(f,'Z24'),'Z05','C')
    const before = supplyBusinessState(f), foreignBefore = supplyBusinessState(foreign), effectsBefore = ownedEffects(f,continuation.id)
    expect(await applySupplyMarketSource({actorUserId:foreign.actorUserId,message:continuation}))
      .toMatchObject({applied:false,reason:'supply_execution_actor_unqualified',periods:[],commits:[],effectReceiptIds:[]})
    expect(supplyBusinessState(f)).toEqual(before); expect(supplyBusinessState(foreign)).toEqual(foreignBefore)
    expect(ownedEffects(f,continuation.id)).toEqual(effectsBefore)
    expect(positiveAperakCount(f,continuation.id)).toBe(0)
  }, 180000)

  it('a sender grid-owner role revoked before fresh C reception cannot restore the ending period', async () => {
    const f = await seed(), confirmation = await receiveProdat(f,z04(f),'Z04','L'); await process(f,confirmation); assertConfirmedSupplyPrecondition(f, confirmation)
    const ending = await receiveProdat(f,z05(f),'Z05','L'); await process(f,ending); assertEndingSupplyPrecondition(f, ending)
    const before = supplyBusinessState(f)
    expect(sql(`WITH changed AS (UPDATE public.platform_actor_roles SET is_active=false WHERE actor_id=${literal(f.marketActorId)} AND actor_role='grid_owner' AND is_active RETURNING id) SELECT to_jsonb(count(*)) FROM changed;`)).toBe(1)
    const continuation = await receiveProdat(f,z05(f,'Z24'),'Z05','C')
    await processInboundEdielMessage({actorUserId:f.actorUserId,edielMessageId:continuation.id})
    expect(supplyBusinessState(f)).toEqual(before)
    expect(positiveAperakCount(f,continuation.id)).toBe(0)
  }, 180000)

  it('failure at the final C partition insert rolls back restoration and receipts and records the named held warning', async () => {
    const f = await seed(), confirmation = await receiveProdat(f,z04(f),'Z04','L'); await process(f,confirmation); assertConfirmedSupplyPrecondition(f, confirmation)
    const ending = await receiveProdat(f,z05(f),'Z05','L'); await process(f,ending); assertEndingSupplyPrecondition(f, ending)
    const continuation = await receiveProdat(f,z05(f,'Z24'),'Z05','C'), before = supplyBusinessState(f)
    const constraint = 'z05c_final_partition_'+randomUUID().replaceAll('-','')
    // A stricter disposable CHECK rejects only this own final INSERT. It
    // creates no receipt or business authority and leaves all other rows valid.
    sql(`ALTER TABLE gridex_received_sources.supply_object_partitions ADD CONSTRAINT ${constraint} CHECK(NOT(company_id=${literal(f.companyId)}::uuid AND source_message_id=${literal(continuation.id)}::uuid)) NOT VALID;`)
    try {
      await processInboundEdielMessage({actorUserId:f.actorUserId,edielMessageId:continuation.id})
      const warnings = sql(`SELECT coalesce(jsonb_agg(payload ORDER BY id),'[]') FROM public.ediel_message_events WHERE ediel_message_id=${literal(continuation.id)} AND company_id=${literal(f.companyId)} AND event_type='manual_note' AND event_status='warning' AND payload->>'supplySourceApply'='rolled_back';`)
      expect(warnings).toEqual(expect.arrayContaining([expect.objectContaining({supplySourceApply:'rolled_back',reason:expect.stringContaining(constraint)})]))
      expect(supplyBusinessState(f)).toEqual(before)
      expect(positiveAperakCount(f,continuation.id)).toBe(0)
    } finally {
      sql(`ALTER TABLE gridex_received_sources.supply_object_partitions DROP CONSTRAINT ${constraint};`)
    }
  }, 180000)

  it.each(['li','point','stop','required-date','required-user','selected-invoicee'])('holds Z05C %s without restoring its real ending decision', async variant => {
    const f = await seed(), confirmation = await receiveProdat(f,z04(f),'Z04','L'); await process(f,confirmation); assertConfirmedSupplyPrecondition(f, confirmation)
    const ending = await receiveProdat(f,z05(f),'Z05','L'); await process(f,ending); assertEndingSupplyPrecondition(f, ending)
    const before = periods(f), permissionBefore = permissions(f)
    const wire = z05(f,'Z24', wire => variant === 'li' ? wire.replace(`RFF+LI:${f.caseReference}`, 'RFF+LI:UNRELATED')
      : variant === 'point' ? wire.replaceAll(f.external, CLOSURE_OBJECT)
      : variant === 'stop' ? wire.replace(f.endMinute, new Date(Date.UTC(Number(f.endMinute.slice(0,4)),
        Number(f.endMinute.slice(4,6))-1,Number(f.endMinute.slice(6,8))+1)).toISOString().slice(0,10).replaceAll('-','')+'0000')
      : variant === 'required-date' ? wire.replace(/DTM\+93:[^']+'/, '')
      : variant === 'required-user' ? wire.replace(/NAD\+UD[^']+'/, '')
      : wire.replace('UNT+', "NAD+IV+199001011234:SE2:260++Synthetic+Street+City+++SE'UNT+"))
    const held = await receiveProdat(f,wire,'Z05','C')
    await processInboundEdielMessage({actorUserId:f.actorUserId,edielMessageId:held.id})
    expect(periods(f)).toEqual(before); expect(permissions(f)).toEqual(permissionBefore)
    expect(sql(`SELECT to_jsonb(count(*)) FROM gridex_received_sources.supply_source_transitions WHERE source_message_id=${literal(held.id)};`)).toBe(0)
  }, 180000)

  it('current sender-role revocation and a foreign actor cannot originate a cancellation of the preserved own original', async () => {
    const f = await seed(), before = original(f), states = switchState(f)
    const request = { companyId: f.companyId, switchRequestId: f.switchId, actorUserId: f.actorUserId,
      preferredRouteId: f.routeId, environment: 'test' as const }
    await expect(prepareAndQueueSwitchCancellation({...request,actorUserId:randomUUID()}))
      .rejects.toMatchObject({ code: '42501', message: 'switch_cancellation_actor_forbidden' })
    sql(`UPDATE public.tenant_actor_roles SET valid_to=clock_timestamp() WHERE company_id=${literal(f.companyId)} AND actor_id=${literal(f.actorUserId)} AND role_code='electricity_supplier';`)
    await expect(prepareAndQueueSwitchCancellation(request))
      .rejects.toMatchObject({ code: 'P0001', message: 'ediel_inbound_legal_context_required' })
    expect(switchState(f)).toEqual(states); expect(original(f)).toEqual(before)
    expect(sql(`SELECT to_jsonb(count(*)) FROM gridex_switch_cancellations.origins WHERE company_id=${literal(f.companyId)};`)).toBe(0)
  }, 180000)

  it('uses actual prospective LK public input at its zero-day cancellation boundary', async () => {
    configureSmtp()
    const cancellationDay = sql<string>(`SELECT to_jsonb((clock_timestamp()+interval '1 hour')::date);`)
    const f = await seedNormalSwitchNativeFixture({deferOriginal:true,requestedStartDate:cancellationDay})
    // Change prospective business input before origination; the actual renderer,
    // signature/legal source and native original producer must still qualify it.
    sql(`UPDATE public.supplier_switch_requests SET prodat_variant='LK',prodat_reason='Z23',request_type='move_in'
      WHERE id=${literal(f.switchId)} AND company_id=${literal(f.companyId)};`)
    const queued = await prepareAndQueueEdielZ03({actorUserId:f.actorUserId,switchRequestId:f.switchId,communicationRouteId:f.routeId,environment:'test'})
    await sendEdielMessageViaSmtp(queued,{actorUserId:f.actorUserId,smtpMimeMode:'nodemailer-attachment'})
    const sent = (await getEdielMessageById(queued.id))!
    const wire=tokenizeEdifact(sent.raw_payload!),li=wire.segments.find(segment=>segment.tag==='RFF'&&segmentComposite(segment,1,wire.una)[0]==='LI')
    expect(sql(`SELECT to_jsonb((clock_timestamp()+interval '1 hour')::date);`)).toBe(f.requestedStartDate)
    const source = await readSwitchCancellationSource({companyId:f.companyId,switchRequestId:f.switchId,actorUserId:f.actorUserId})
    expect(source).toMatchObject({status:'authorized',originalSubtype:'LK',originalMessageId:sent.id,
      li:segmentComposite(li,1,wire.una)[1],deadline:f.requestedStartDate})
    expect((await prepareAndQueueSwitchCancellation({companyId:f.companyId,switchRequestId:f.switchId,actorUserId:f.actorUserId,
      preferredRouteId:f.routeId,environment:'test'})).status).toBe('queued')
    expect(sql(`SELECT to_jsonb(status) FROM public.supplier_switch_requests WHERE id=${literal(f.switchId)};`)).toBe('cancellation_requested')
  },180000)

  // masterplan: AT-Z03C/Z04C-SUPPLIER. HB 26B 4.1.7/4.1.9: a Z04C of an own start
  // already executed is accepted and answered; the start is corrected in a
  // controlled process. LK/day0 is prospective public input. No original, period,
  // confirmation, activation receipt or database clock is rewritten.
  it('accepts cancellation of a genuinely activated own LK start with a source-bound compensation receipt and work case', async () => {
    configureSmtp()
    const today = sql<string>(`SELECT to_jsonb((clock_timestamp()+interval '1 hour')::date);`)
    const stage = await seedNormalSwitchNativeFixture({deferOriginal:true,requestedStartDate:today})
    sql(`UPDATE public.supplier_switch_requests SET prodat_variant='LK',prodat_reason='Z23',request_type='move_in'
      WHERE id=${literal(stage.switchId)} AND company_id=${literal(stage.companyId)};`)
    const route=randomUUID(),profile=randomUUID(),config=assertEdielSmtpReadiness()
    sql(`INSERT INTO public.communication_routes(id,company_id,route_name,route_scope,grid_owner_id,environment_type,is_active,target_email)
      VALUES(${literal(route)},${literal(stage.companyId)},'Synthetic cancellation ACK route','ediel_ack',${literal(stage.gridId)},'bilateral_test',true,'recipient@example.invalid');
      INSERT INTO public.ediel_route_profiles(id,company_id,communication_route_id,route_name,environment,message_standard,sender_ediel_id,receiver_ediel_id,application_reference,is_enabled,is_active,payload_format,transport_security_mode,smtp_to,receiver_email,mailbox,smtp_host,smtp_port)
      VALUES(${literal(profile)},${literal(stage.companyId)},${literal(route)},'Synthetic cancellation ACK profile','test','edifact',${literal(stage.sender)},${literal(stage.receiver)},'23-DDQ-PRODAT',true,true,'edifact','unencrypted','recipient@example.invalid','recipient@example.invalid',${literal(config.from)},${literal(config.host)},${config.port});`)
    const queued=await prepareAndQueueEdielZ03({actorUserId:stage.actorUserId,switchRequestId:stage.switchId,communicationRouteId:stage.routeId,environment:'test'})
    await sendEdielMessageViaSmtp(queued,{actorUserId:stage.actorUserId,smtpMimeMode:'nodemailer-attachment'})
    const sent=(await getEdielMessageById(queued.id))!
    expect(sent).toMatchObject({company_id:stage.companyId,direction:'outbound',message_code:'Z03',status:'sent'})
    expect(sql(`SELECT to_jsonb(gridex_received_sources.sent_source_is_current_v1(m)) FROM public.ediel_messages m
      WHERE m.id=${literal(sent.id)} AND m.company_id=${literal(stage.companyId)};`)).toBe(true)
    const tokens=tokenizeEdifact(sent.raw_payload!),li=tokens.segments.find(segment=>segment.tag==='RFF'&&segmentComposite(segment,1,tokens.una)[0]==='LI')
    if(!li)throw Error('native_compensation_genuine_sent_li_required')
    const f:Fixture={...stage,originalZ03:sent,caseReference:segmentComposite(li,1,tokens.una)[1],endMinute:futureNativeSupplyDate(28).replaceAll('-','')+'0000'}
    const confirmation=await receiveProdat(f,envelope(f,buildCancellationProspectiveZ04(f).replace('CAV+Z22','CAV+Z23'),'Z04'),'Z04','LK')
    await process(f,confirmation);assertConfirmedSupplyPrecondition(f,confirmation)
    expect(sql(`SELECT to_jsonb((clock_timestamp()+interval '1 hour')::date);`)).toBe(today)
    await cancellationSupply.advanceSupplyMarketDeadlines({actorUserId:f.actorUserId,companyId:f.companyId,limit:1})
    const witness=sql<Array<{period_id:string;original_message_id:string;source_message_id:string;switch_id:string;status:string;actual_start_date:string;due:boolean;activation:Record<string,unknown>}>>(`
      SELECT coalesce(jsonb_agg(jsonb_build_object('period_id',p.id,'original_message_id',c.original_message_id,
        'source_message_id',c.source_message_id,'switch_id',c.switch_id,'status',p.status,'actual_start_date',p.actual_start_date,
        'due',c.market_start_at<=clock_timestamp(),'activation',to_jsonb(a))),'[]')
      FROM gridex_received_sources.normal_switch_confirmations c JOIN public.customer_supply_periods p ON p.id=c.period_id AND p.company_id=c.company_id
      JOIN gridex_received_sources.normal_supply_activations a ON a.period_id=p.id AND a.company_id=p.company_id
      WHERE c.company_id=${literal(f.companyId)} AND c.switch_id=${literal(f.switchId)};`)
    expect(witness).toHaveLength(1)
    expect(witness[0]).toMatchObject({original_message_id:sent.id,source_message_id:confirmation.id,switch_id:f.switchId,status:'active',actual_start_date:today,due:true,
      activation:{company_id:f.companyId,source_message_id:confirmation.id,actor_user_id:f.actorUserId,resulting_period:{id:witness[0].period_id,status:'active'}}})
    expect(switchState(f)).toMatchObject({status:'completed',original:sent.id,inbound:confirmation.id})
    const protectedGraph=()=>({business:supplyBusinessState(f),switch:sql(`SELECT to_jsonb(s) FROM public.supplier_switch_requests s WHERE s.id=${literal(f.switchId)} AND s.company_id=${literal(f.companyId)};`),
      graph:sql(`SELECT jsonb_build_object('customers',(SELECT jsonb_agg(to_jsonb(x) ORDER BY id) FROM public.customers x WHERE company_id=${literal(f.companyId)}),
        'sites',(SELECT jsonb_agg(to_jsonb(x) ORDER BY id) FROM public.customer_sites x WHERE company_id=${literal(f.companyId)}),
        'points',(SELECT jsonb_agg(to_jsonb(x) ORDER BY id) FROM public.metering_points x WHERE company_id=${literal(f.companyId)}),
        'contracts',(SELECT jsonb_agg(to_jsonb(x) ORDER BY id) FROM public.customer_contracts x WHERE company_id=${literal(f.companyId)}),
        'activations',(SELECT jsonb_agg(to_jsonb(x) ORDER BY period_id) FROM gridex_received_sources.normal_supply_activations x WHERE company_id=${literal(f.companyId)}));`)})
    const before=protectedGraph(),source=await receiveProdat(f,z04(f,'Z24'),'Z04','C')
    const sourceIdentity=()=>sql(`SELECT jsonb_build_object('id',id,'company_id',company_id,'environment',environment,'direction',direction,
      'raw_payload',raw_payload,'hash',immutable_payload_hash,'received_at',message_received_at,'mail',inbound_email_message_id)
      FROM public.ediel_messages WHERE id=${literal(source.id)} AND company_id=${literal(f.companyId)};`)
    const birth=sourceIdentity(),apply=vi.spyOn(cancellationSupply,'applySupplyMarketSource')
    let result:cancellationSupply.SupplyMarketResult
    try{
      await process(f,source)
      const own=apply.mock.calls.flatMap((args,index)=>args[0].message.id===source.id&&args[0].actorUserId===f.actorUserId?[apply.mock.results[index]]:[])
      expect(own).toHaveLength(1);expect(own[0].type).toBe('return');result=await own[0].value as cancellationSupply.SupplyMarketResult
    }finally{apply.mockRestore()}
    expect(result!).toMatchObject({applied:true,fullyApplied:true,reviewRequired:false,periods:[],commits:[],switchIds:[],partition:[{
      object:{objectId:f.external,identityAgency:'9'},disposition:'applied'}]})
    expect(result!.effectReceiptIds).toHaveLength(1)
    const [receiptId]=result!.effectReceiptIds;expect(result!.partition?.[0]).toMatchObject({effectReceiptId:receiptId})
    const receipts=sql<Array<{id:string;payload_bound:boolean;effect_bound:boolean;effect:{plan:Record<string,unknown>;previousSwitches:Array<Record<string,unknown>>}}>>(`
      SELECT coalesce(jsonb_agg(jsonb_build_object('id',e.id,'payload_bound',e.payload_hash=encode(sha256(convert_to(m.raw_payload,'UTF8')),'hex'),
        'effect_bound',e.effect_hash=encode(sha256(convert_to(e.effect_text,'UTF8')),'hex'),'effect',e.effect_text::jsonb) ORDER BY e.id),'[]')
      FROM gridex_received_sources.supply_object_effect_receipts e JOIN public.ediel_messages m ON m.id=e.source_message_id AND m.company_id=e.company_id
      WHERE e.company_id=${literal(f.companyId)} AND e.source_message_id=${literal(source.id)};`)
    expect(receipts).toHaveLength(1);expect(receipts[0]).toMatchObject({id:receiptId,payload_bound:true,effect_bound:true})
    const plan=receipts[0].effect.plan
    expect(plan).toMatchObject({kind:'executed_start_compensation',switchId:null,periodId:null,disposition:'controlled_review',
      executedSwitchId:f.switchId,executedPeriodId:witness[0].period_id,originalId:sent.id,originalHash:sql<string>(`SELECT to_jsonb(immutable_payload_hash) FROM public.ediel_messages WHERE id=${literal(sent.id)} AND company_id=${literal(f.companyId)};`),
      confirmationSourceMessageId:confirmation.id,executedPeriod:{id:witness[0].period_id,status:'active'},object:{point:f.external,li:f.caseReference}})
    expect(receipts[0].effect.previousSwitches).toEqual([before.switch])
    // The correction is a real open tenant work case bound to the exact C,
    // original, switch and period; no review-required warning is recorded.
    const tasks=()=>sql<Array<Record<string,unknown>>>(`SELECT coalesce(jsonb_agg(to_jsonb(c) ORDER BY c.id),'[]') FROM public.customer_cases c
      WHERE c.company_id=${literal(f.companyId)} AND c.source_ediel_message_id=${literal(source.id)};`)
    const task=tasks();expect(task).toHaveLength(1)
    expect(task[0]).toMatchObject({id:plan.caseId,company_id:f.companyId,customer_id:f.customerId,metering_point_id:f.pointId,supplier_switch_request_id:f.switchId,
      case_type:'other',status:'manual_follow_up',source:'ediel_inbound_state_machine',cancellation_status:'not_required',billing_blocked:false,
      created_by:f.actorUserId,source_ediel_message_id:source.id,metadata:{review_intent:'executed_start_compensation',executed_switch_id:f.switchId,
        executed_period_id:witness[0].period_id,original_message_id:sent.id,confirmation_source_message_id:confirmation.id}})
    expect(sql(`SELECT to_jsonb(count(*)) FROM public.ediel_message_events WHERE company_id=${literal(f.companyId)} AND ediel_message_id=${literal(source.id)}
      AND event_type='validated' AND event_status='warning' AND (payload->>'reviewRequired')::boolean;`)).toBe(0)
    // Only the own C's receipt, partition and transition are new.
    const after=protectedGraph(),history=(state:typeof before)=>state.business.history as Record<'transitions'|'effects'|'partitions',Array<Record<string,unknown>>>
    expect({...after,business:{...after.business,history:null}}).toEqual({...before,business:{...before.business,history:null}})
    expect(history(after).effects.filter(row=>row.id!==receiptId)).toEqual(history(before).effects)
    for(const key of ['transitions','partitions'] as const)expect(history(after)[key].filter(row=>row.source_message_id!==source.id)).toEqual(history(before)[key])
    expect(history(after).transitions.filter(row=>row.source_message_id===source.id)).toEqual([expect.objectContaining({resulting_states:[],qualified_switch_ids:[]})])
    expect(sourceIdentity()).toEqual(birth)
    // Positive final response follows within the 30 minute deadline.
    await sendOwnAcks(f,source.id)
    const acks=sql<Array<{family:string;outcome:string;onTime:boolean}>>(`SELECT coalesce(jsonb_agg(jsonb_build_object('family',a.message_family,'outcome',a.ack_outcome,
      'onTime',a.message_sent_at<=s.message_received_at+interval '30 minutes') ORDER BY a.message_family),'[]')
      FROM public.ediel_messages a JOIN public.ediel_messages s ON s.id=a.related_message_id AND s.company_id=a.company_id
      WHERE a.company_id=${literal(f.companyId)} AND a.related_message_id=${literal(source.id)} AND a.direction='outbound';`)
    expect(acks).toEqual([{family:'APERAK',outcome:'positive',onTime:true},{family:'CONTRL',outcome:'positive',onTime:true}])
    // Replay keeps the same receipt, case and response and adds no effect.
    const settled=ownedEffects(f,source.id),graph=protectedGraph()
    await processInboundEdielMessage({actorUserId:f.actorUserId,edielMessageId:source.id})
    expect(ownedEffects(f,source.id)).toEqual(settled);expect(protectedGraph()).toEqual(graph);expect(tasks()).toEqual(task)
    expect(sourceIdentity()).toEqual(birth);expect(positiveAperakCount(f,source.id)).toBe(1)
    // A second distinct C for the same executed start is held: one correction.
    const second=await receiveProdat(f,z04(f,'Z24'),'Z04','C'),repeat=vi.spyOn(cancellationSupply,'applySupplyMarketSource')
    let held:cancellationSupply.SupplyMarketResult
    try{
      await process(f,second)
      const own=repeat.mock.calls.flatMap((args,index)=>args[0].message.id===second.id?[repeat.mock.results[index]]:[])
      expect(own).toHaveLength(1);expect(own[0].type).toBe('return');held=await own[0].value as cancellationSupply.SupplyMarketResult
    }finally{repeat.mockRestore()}
    expect(held!).toMatchObject({applied:false,reviewRequired:true,effectReceiptIds:[],commits:[],partition:[{
      object:{objectId:f.external,identityAgency:'9'},disposition:'held',reason:'z04c_executed_start_compensation_already_recorded'}]})
    expect(protectedGraph()).toEqual(graph);expect(ownedEffects(f,source.id)).toEqual(settled);expect(positiveAperakCount(f,second.id)).toBe(0)
  },180000)

  // Executed-start compensation after a genuine ordinary end.
  // ENDED is a later genuine state of this already activated own start. The
  // positive controlled correction must preserve the real ordinary end too.
  it('accepts exact Z04C after a genuinely activated own start was ended by its public Z05L source', async () => {
    const {f,sent,confirmation,ending,period,endProof}=await seedGenuineEndedOwnStart(true)
    const protectedGraph=()=>endedCompensationGraph(f,confirmation.id,ending.id)
    const before=protectedGraph(),beforeCases=endedCompensationCases(f)
    const source=await receiveProdat(f,z04(f,'Z24'),'Z04','C'),birth=endedCompensationSourceIdentity(f,source.id)
    const result=await observeEndedCompensationApply(f,source)
    expect(result).toMatchObject({applied:true,fullyApplied:true,reviewRequired:false,periods:[],commits:[],switchIds:[],partition:[{
      object:{objectId:f.external,identityAgency:'9'},disposition:'applied'}]})
    expect(result.effectReceiptIds).toHaveLength(1)
    const [receiptId]=result.effectReceiptIds
    expect(result.partition?.[0]).toMatchObject({effectReceiptId:receiptId})
    const receipts=sql<Array<{id:string;payload_bound:boolean;effect_bound:boolean;effect:{plan:Record<string,unknown>;previousSwitches:unknown[];previousStates:unknown[];resultingStates:unknown[]}}>>(`
      SELECT coalesce(jsonb_agg(jsonb_build_object('id',e.id,'payload_bound',e.payload_hash=encode(sha256(convert_to(m.raw_payload,'UTF8')),'hex'),
        'effect_bound',e.effect_hash=encode(sha256(convert_to(e.effect_text,'UTF8')),'hex'),'effect',e.effect_text::jsonb) ORDER BY e.id),'[]')
      FROM gridex_received_sources.supply_object_effect_receipts e JOIN public.ediel_messages m ON m.id=e.source_message_id AND m.company_id=e.company_id
      WHERE e.company_id=${literal(f.companyId)} AND e.source_message_id=${literal(source.id)};`)
    expect(receipts).toHaveLength(1)
    expect(receipts[0]).toMatchObject({id:receiptId,payload_bound:true,effect_bound:true,
      effect:{owner:'inbound-supply-object-v1',sourceMessageId:source.id,sourcePayloadHash:createHash('sha256').update(source.raw_payload!).digest('hex'),
        companyId:f.companyId,environment:'test',previousSwitches:[before.switch],previousStates:[],resultingStates:[]}})
    const plan=receipts[0].effect.plan
    expect(plan).toMatchObject({kind:'executed_start_compensation',switchId:null,periodId:null,disposition:'controlled_review',
      executedSwitchId:f.switchId,executedPeriodId:period.id,executedPeriod:period,originalId:sent.id,
      originalHash:sql<string>(`SELECT to_jsonb(immutable_payload_hash) FROM public.ediel_messages WHERE id=${literal(sent.id)} AND company_id=${literal(f.companyId)};`),
      confirmationSourceMessageId:confirmation.id,object:{point:f.external,li:f.caseReference}})
    const cases=endedCompensationCases(f),own=cases.filter(row=>row.source_ediel_message_id===source.id)
    expect(own).toHaveLength(1)
    expect(own[0]).toMatchObject({id:plan.caseId,company_id:f.companyId,customer_id:f.customerId,metering_point_id:f.pointId,supplier_switch_request_id:f.switchId,
      case_type:'other',status:'manual_follow_up',source:'ediel_inbound_state_machine',cancellation_status:'not_required',billing_blocked:false,
      created_by:f.actorUserId,source_ediel_message_id:source.id,metadata:{review_intent:'executed_start_compensation',executed_switch_id:f.switchId,
        executed_period_id:period.id,original_message_id:sent.id,original_payload_hash:plan.originalHash,confirmation_source_message_id:confirmation.id}})
    expect(cases.filter(row=>row.id!==plan.caseId)).toEqual(beforeCases)
    expect(sql(`SELECT to_jsonb(count(*)) FROM public.ediel_message_events WHERE company_id=${literal(f.companyId)} AND ediel_message_id=${literal(source.id)}
      AND event_type='validated' AND event_status='warning' AND (payload->>'reviewRequired')::boolean;`)).toBe(0)
    const after=protectedGraph(),history=(state:typeof before)=>state.business.history as Record<'transitions'|'effects'|'partitions',Array<Record<string,unknown>>>
    expect({...after,business:{...after.business,history:null}}).toEqual({...before,business:{...before.business,history:null}})
    expect(history(after).effects.filter(row=>row.id!==receiptId)).toEqual(history(before).effects)
    for(const key of ['transitions','partitions'] as const)expect(history(after)[key].filter(row=>row.source_message_id!==source.id)).toEqual(history(before)[key])
    expect(history(after).effects).toContainEqual(expect.objectContaining({id:endProof.id,source_message_id:ending.id}))
    expect(history(after).transitions.filter(row=>row.source_message_id===source.id)).toEqual([expect.objectContaining({resulting_states:[],qualified_switch_ids:[]})])
    expect(endedCompensationSourceIdentity(f,source.id)).toEqual(birth)
    await sendOwnAcks(f,source.id)
    const acks=sql<Array<{family:string;outcome:string;onTime:boolean}>>(`SELECT coalesce(jsonb_agg(jsonb_build_object('family',a.message_family,'outcome',a.ack_outcome,
      'onTime',a.message_sent_at<=s.message_received_at+interval '30 minutes') ORDER BY a.message_family),'[]')
      FROM public.ediel_messages a JOIN public.ediel_messages s ON s.id=a.related_message_id AND s.company_id=a.company_id
      WHERE a.company_id=${literal(f.companyId)} AND a.related_message_id=${literal(source.id)} AND a.direction='outbound';`)
    expect(acks).toEqual([{family:'APERAK',outcome:'positive',onTime:true},{family:'CONTRL',outcome:'positive',onTime:true}])
    const settled=ownedEffects(f,source.id),graph=protectedGraph()
    await processInboundEdielMessage({actorUserId:f.actorUserId,edielMessageId:source.id})
    expect(ownedEffects(f,source.id)).toEqual(settled)
    expect(protectedGraph()).toEqual(graph);expect(endedCompensationCases(f)).toEqual(cases)
    expect(endedCompensationSourceIdentity(f,source.id)).toEqual(birth);expect(positiveAperakCount(f,source.id)).toBe(1)
    const second=await receiveProdat(f,z04(f,'Z24'),'Z04','C'),secondBirth=endedCompensationSourceIdentity(f,second.id)
    const held=await observeEndedCompensationApply(f,second)
    expect(held).toMatchObject({applied:false,fullyApplied:false,reviewRequired:true,effectReceiptIds:[],periods:[],commits:[],partition:[{
      object:{objectId:f.external,identityAgency:'9'},disposition:'held',reason:'z04c_executed_start_compensation_already_recorded'}]})
    expect(protectedGraph()).toEqual(graph);expect(endedCompensationCases(f)).toEqual(cases);expect(ownedEffects(f,source.id)).toEqual(settled)
    expect(endedCompensationSourceIdentity(f,second.id)).toEqual(secondBirth);expect(positiveAperakCount(f,second.id)).toBe(0)
  },900000)

  // Same genuine ENDED premise, but the new C alone changes its original start.
  // Exact-original qualification must win before any compensation can be minted.
  it('holds a wrong-start Z04C against a genuinely activated and ended own start without changing its end or authority', async () => {
    const {f,confirmation,ending}=await seedGenuineEndedOwnStart(true)
    const wrongDate=sql<string>(`SELECT to_jsonb(${literal(f.requestedStartDate)}::date+1);`)
    expect(wrongDate).not.toBe(f.requestedStartDate)
    const before=endedCompensationGraph(f,confirmation.id,ending.id),beforeCases=endedCompensationCases(f)
    const source=await receiveProdat(f,z04({...f,requestedStartDate:wrongDate},'Z24'),'Z04','C'),birth=endedCompensationSourceIdentity(f,source.id)
    const result=await observeEndedCompensationApply(f,source)
    expect(result).toMatchObject({applied:false,fullyApplied:false,reviewRequired:true,effectReceiptIds:[],periods:[],commits:[],partition:[{
      object:{objectId:f.external,identityAgency:'9'},disposition:'held',reason:'z04c_exact_original_unavailable'}]})
    expect(endedCompensationGraph(f,confirmation.id,ending.id)).toEqual(before)
    expect(endedCompensationCases(f)).toEqual(beforeCases)
    expect(endedCompensationSourceIdentity(f,source.id)).toEqual(birth);expect(positiveAperakCount(f,source.id)).toBe(0)
  },900000)

  // ENDED alone is not execution authority. This actual public end followed a
  // confirmation before the activation sweep; its switch is still accepted.
  it('holds exact Z04C of a genuinely ended but never activated own start without manufacturing compensation', async () => {
    const {f,confirmation,ending}=await seedGenuineEndedOwnStart(false)
    const before=endedCompensationGraph(f,confirmation.id,ending.id),beforeCases=endedCompensationCases(f)
    const source=await receiveProdat(f,z04(f,'Z24'),'Z04','C'),birth=endedCompensationSourceIdentity(f,source.id)
    const result=await observeEndedCompensationApply(f,source)
    expect(result).toMatchObject({applied:false,fullyApplied:false,reviewRequired:true,effectReceiptIds:[],periods:[],commits:[],partition:[{
      object:{objectId:f.external,identityAgency:'9'},disposition:'held',reason:'z04c_effect_already_executed_compensation_required'}]})
    expect(endedCompensationGraph(f,confirmation.id,ending.id)).toEqual(before)
    expect(endedCompensationCases(f)).toEqual(beforeCases)
    expect(endedCompensationSourceIdentity(f,source.id)).toEqual(birth);expect(positiveAperakCount(f,source.id)).toBe(0)
    expect(sql(`SELECT to_jsonb(count(*)) FROM gridex_received_sources.normal_supply_activations WHERE company_id=${literal(f.companyId)};`)).toBe(0)
    expect(switchState(f)).toMatchObject({status:'accepted',original:f.originalZ03.id,inbound:confirmation.id})
  },900000)

  // Source-only SC039 supplement. Reuses public nativeB's C-first/late-L
  // controls; no C-before-future-outbound-original or executed-period premise.
  // Until a retained producer executes this exact source, this case is NOT_RUN.
  it('preserves C-before-matching-L custody and deadlines without activating the cancelled own start', async () => {
    const f = await seed(), foreign = await seed()
    const beforeOriginal = original(f), beforePermission = permissions(f)
    const foreignOriginal = original(foreign), foreignSwitch = switchState(foreign)
    expect(f.originalZ03).toMatchObject({ direction:'outbound',message_family:'PRODAT',message_code:'Z03',status:'sent' })
    expect(sql<string>(`SELECT to_jsonb(immutable_payload_hash) FROM public.ediel_messages
      WHERE id=${literal(f.originalZ03.id)} AND company_id=${literal(f.companyId)};`))
      .toBe(createHash('sha256').update(f.originalZ03.raw_payload!).digest('hex'))
    expect(sql(`SELECT to_jsonb(gridex_received_sources.sent_source_is_current_v1(m))
      FROM public.ediel_messages m WHERE id=${literal(f.originalZ03.id)} AND company_id=${literal(f.companyId)};`)).toBe(true)
    expect(periods(f)).toEqual([])
    const previousSwitch = sql<Record<string,unknown>>(`SELECT to_jsonb(s) FROM public.supplier_switch_requests s
      WHERE id=${literal(f.switchId)} AND company_id=${literal(f.companyId)};`)
    expect(previousSwitch).toMatchObject({ outbound_z03_message_id:f.originalZ03.id,rff_li_reference:f.caseReference,
      inbound_z04_message_id:null })

    // A call-through observer does not fabricate a return or repeat an apply.
    // The coordinator returns an EdielMessageRow; only this actual adapter
    // invocation can supply SupplyMarketResult/partition evidence.
    const observedProcess = async (source:EdielMessageRow) => {
      const actualApply = cancellationSupply.applySupplyMarketSource
      const apply = vi.spyOn(cancellationSupply,'applySupplyMarketSource').mockImplementation(async input => {
        if (input.message.id === source.id) expect(positiveAperakCount(f,source.id)).toBe(0)
        const result = await actualApply(input)
        // No final positive reply may precede the actual durable own receipt.
        if (input.message.id === source.id) expect(positiveAperakCount(f,source.id)).toBe(0)
        return result
      })
      try {
        const processed = await process(f,source)
        const own = apply.mock.calls.flatMap((args,index) => args[0].message.id === source.id
          && args[0].actorUserId === f.actorUserId ? [apply.mock.results[index]] : [])
        expect(own).toHaveLength(1)
        expect(own[0].type).toBe('return')
        const result = await own[0].value as cancellationSupply.SupplyMarketResult
        const events = sql<Array<{payload:{sourceObjectPartition:unknown}}>>(`SELECT coalesce(jsonb_agg(to_jsonb(e)
          ORDER BY e.created_at,e.id),'[]') FROM public.ediel_message_events e
          WHERE e.company_id=${literal(f.companyId)} AND e.ediel_message_id=${literal(source.id)}
          AND e.event_type='validated' AND e.payload ? 'sourceObjectPartition';`)
        expect(events.length).toBeGreaterThan(0)
        expect(events.at(-1)!.payload.sourceObjectPartition).toEqual(result.partition)
        return { processed,result }
      } finally { apply.mockRestore() }
    }
    const custody = (source:EdielMessageRow) => sql(`SELECT jsonb_build_object(
      'source',jsonb_build_object('id',m.id,'company_id',m.company_id,'environment',m.environment,'direction',m.direction,
        'raw_payload',m.raw_payload,'immutable_payload_hash',m.immutable_payload_hash,'message_received_at',m.message_received_at,
        'immutable_rendered_at',m.immutable_rendered_at,'execution_context_snapshot',m.execution_context_snapshot,
        'rule_profile_key',m.rule_profile_key,'canonical_rule_pack_id',m.canonical_rule_pack_id,'rule_pack_checksum',m.rule_pack_checksum,
        'rule_profile_version_id',m.rule_profile_version_id,'related_message_id',m.related_message_id,'outbound_request_id',m.outbound_request_id),
      'mail',(SELECT to_jsonb(x) FROM public.inbound_email_messages x WHERE id=m.inbound_email_message_id),
      'parse',(SELECT to_jsonb(x) FROM public.inbound_ediel_parse_results x WHERE id=(SELECT parse_result_id
        FROM gridex_ediel_inbound_receptions.receptions WHERE source_message_id=m.id AND classification='first_reception')),
      'captured',(SELECT to_jsonb(x) FROM gridex_received_sources.sources x WHERE source_message_id=m.id AND company_id=m.company_id),
      'context',(SELECT to_jsonb(x) FROM gridex_ediel_inbound_context.receipts x WHERE source_message_id=m.id AND company_id=m.company_id),
      'receptions',(SELECT coalesce(jsonb_agg(to_jsonb(x) ORDER BY id),'[]') FROM gridex_ediel_inbound_receptions.receptions x
        WHERE source_message_id=m.id AND company_id=m.company_id),
      'rawBirth',(SELECT to_jsonb(x) FROM gridex_unattributed_intake.raw_births x WHERE inbound_email_message_id=m.inbound_email_message_id),
      'parseBirth',(SELECT to_jsonb(x) FROM gridex_unattributed_intake.parse_births x WHERE parse_result_id=(SELECT parse_result_id
        FROM gridex_ediel_inbound_receptions.receptions WHERE source_message_id=m.id AND classification='first_reception')))
      FROM public.ediel_messages m WHERE m.id=${literal(source.id)} AND m.company_id=${literal(f.companyId)};`)
    const receipts = (source:EdielMessageRow) => sql<{
      effects:Array<{id:string;source_message_id:string;company_id:string;environment:string;payload_hash:string;
        effect_text:string;effect_hash:string;canonical_assessment_id:string}>;
      partitions:Array<{source_message_id:string;payload_hash:string;canonical_assessment_id:string;partition_text:string;partition_hash:string;result:unknown}>;
      transitions:Record<string,unknown>[];normal:Record<string,unknown>[]
    }>(`SELECT jsonb_build_object(
      'effects',(SELECT coalesce(jsonb_agg(to_jsonb(x) ORDER BY id),'[]') FROM gridex_received_sources.supply_object_effect_receipts x
        WHERE company_id=${literal(f.companyId)} AND source_message_id=${literal(source.id)}),
      'partitions',(SELECT coalesce(jsonb_agg(to_jsonb(x)),'[]') FROM gridex_received_sources.supply_object_partitions x
        WHERE company_id=${literal(f.companyId)} AND source_message_id=${literal(source.id)}),
      'transitions',(SELECT coalesce(jsonb_agg(to_jsonb(x)),'[]') FROM gridex_received_sources.supply_source_transitions x
        WHERE company_id=${literal(f.companyId)} AND source_message_id=${literal(source.id)}),
      'normal',(SELECT coalesce(jsonb_agg(to_jsonb(x)),'[]') FROM gridex_received_sources.normal_switch_confirmations x
        WHERE company_id=${literal(f.companyId)} AND source_message_id=${literal(source.id)}));`)
    const protocol = (source:EdielMessageRow) => sql(`SELECT jsonb_build_object(
      'acks',(SELECT coalesce(jsonb_agg(to_jsonb(a) ORDER BY a.id),'[]') FROM public.ediel_messages a
        WHERE a.company_id=${literal(f.companyId)} AND a.related_message_id=${literal(source.id)} AND a.direction='outbound'),
      'outbox',(SELECT coalesce(jsonb_agg(to_jsonb(o) ORDER BY o.id),'[]') FROM public.ediel_outbox o
        WHERE o.company_id=${literal(f.companyId)} AND o.source_message_id=${literal(source.id)}));`)
    const assertSentWithinOwnDeadline = (source:EdielMessageRow,ack:EdielMessageRow) => {
      expect(ack).toMatchObject({company_id:f.companyId,environment:'test',direction:'outbound',related_message_id:source.id,status:'sent'})
      expect(ack.ack_outcome).toBe('positive')
      expect(readPhysicalAckSourceCorrelation(ack,source).classification.outcome).toBe(ack.ack_outcome)
      const timerType = ack.message_family === 'CONTRL' ? 'contrl_due' : 'aperak_due'
      const timers = sql<Array<{due_at:string;payload:{receivedAt:string;anchorKind:string;anchorCertainty:string}}>>(`SELECT coalesce(jsonb_agg(to_jsonb(t)),'[]')
        FROM public.ediel_sla_timers t WHERE t.company_id=${literal(f.companyId)} AND t.ediel_message_id=${literal(source.id)}
        AND t.timer_type=${literal(timerType)};`)
      expect(timers).toHaveLength(1)
      expect(timers[0].payload).toMatchObject({anchorKind:'local_ingress_at',anchorCertainty:'observed'})
      expect(Date.parse(timers[0].payload.receivedAt)).toBe(Date.parse(source.message_received_at!))
      const received = Date.parse(source.message_received_at!),sent = Date.parse(ack.message_sent_at!),due = Date.parse(timers[0].due_at)
      expect(Number.isFinite(received) && Number.isFinite(sent) && Number.isFinite(due)).toBe(true)
      // The current national ACK deadline is 30 minutes, not an arbitrary
      // extended timer supplied by a malformed setup or later implementation.
      expect(due - received).toBe(30 * 60_000)
      expect(sent).toBeGreaterThanOrEqual(received); expect(sent).toBeLessThanOrEqual(due)
      expect(sql(`SELECT to_jsonb(count(*)) FROM public.ediel_message_payloads WHERE ediel_message_id=${literal(ack.id)};`)).toBeGreaterThan(0)
    }
    const physicalLi = (source:EdielMessageRow) => {
      const wire = tokenizeEdifact(source.raw_payload!)
      const li = wire.segments.filter(segment => segment.tag === 'RFF' && segmentComposite(segment,1,wire.una)[0] === 'LI')
      expect(li).toHaveLength(1)
      return segmentComposite(li[0],1,wire.una)[1]
    }

    const cancellation = await receiveProdat(f,z04(f,'Z24'),'Z04','C'),cBirth = custody(cancellation)
    expect(physicalLi(cancellation)).toBe(f.caseReference)
    expect(Date.parse(cancellation.message_received_at!)).toBeGreaterThanOrEqual(Date.parse(f.originalZ03.message_sent_at!))
    const applied = await observedProcess(cancellation)
    expect(applied.result).toMatchObject({applied:true,fullyApplied:true,reviewRequired:false,periods:[],commits:[]})
    const committed = receipts(cancellation)
    expect(committed.effects).toHaveLength(1); expect(committed.partitions).toHaveLength(1)
    expect(committed.transitions).toHaveLength(1); expect(committed.normal).toEqual([])
    const effect = committed.effects[0],partition = committed.partitions[0]
    expect(effect).toMatchObject({source_message_id:cancellation.id,company_id:f.companyId,environment:'test',
      payload_hash:createHash('sha256').update(cancellation.raw_payload!).digest('hex')})
    expect(createHash('sha256').update(effect.effect_text).digest('hex')).toBe(effect.effect_hash)
    expect(createHash('sha256').update(partition.partition_text).digest('hex')).toBe(partition.partition_hash)
    const facts = JSON.parse(effect.effect_text)
    expect(facts).toMatchObject({owner:'inbound-supply-object-v1',sourceMessageId:cancellation.id,sourcePayloadHash:effect.payload_hash,
      companyId:f.companyId,environment:'test',canonicalAssessmentId:effect.canonical_assessment_id,
      object:{objectId:f.external,identityAgency:'9'},plan:{kind:'cancel_start',switchId:f.switchId,periodId:null},
      resultingStates:[],wire:{li:f.caseReference,reason:'Z24'}})
    expect(Object.hasOwn(facts.plan,'periodId')).toBe(true)
    const cancelledSwitch = sql<Record<string,unknown>>(`SELECT to_jsonb(s) FROM public.supplier_switch_requests s
      WHERE id=${literal(f.switchId)} AND company_id=${literal(f.companyId)};`)
    expect(cancelledSwitch).toMatchObject({status:'cancelled_before_start',outbound_z03_message_id:f.originalZ03.id,
      inbound_z04_message_id:cancellation.id,rff_li_reference:f.caseReference})
    expect(cancelledSwitch.completed_at).not.toBeNull()
    expect(facts.previousSwitches).toEqual([previousSwitch]); expect(facts.resultingSwitches).toEqual([cancelledSwitch])
    expect(partition).toMatchObject({source_message_id:cancellation.id,payload_hash:effect.payload_hash,
      canonical_assessment_id:effect.canonical_assessment_id,result:{applied:true,periods:[],commits:[],effectReceiptIds:[effect.id]}})
    expect(periods(f)).toEqual([]); expect(custody(cancellation)).toEqual(cBirth)
    await sendOwnAcks(f,cancellation.id)
    const cAcks = sql<EdielMessageRow[]>(`SELECT coalesce(jsonb_agg(to_jsonb(a) ORDER BY message_family),'[]')
      FROM public.ediel_messages a WHERE a.company_id=${literal(f.companyId)} AND a.related_message_id=${literal(cancellation.id)} AND a.direction='outbound';`)
    expect(cAcks.map(ack => [ack.message_family,ack.ack_outcome])).toEqual([['APERAK','positive'],['CONTRL','positive']])
    for (const ack of cAcks) assertSentWithinOwnDeadline(cancellation,ack)
    const cProtocol = protocol(cancellation)

    const late = await receiveProdat(f,z04(f),'Z04','L'),lBirth = custody(late)
    expect(late.id).not.toBe(cancellation.id); expect(physicalLi(late)).toBe(f.caseReference)
    expect(Date.parse(late.message_received_at!)).toBeGreaterThanOrEqual(Date.parse(cancellation.message_received_at!))
    expect(positiveAperakCount(f,late.id)).toBe(0)
    const superseded = await observedProcess(late)
    expect(superseded.result).toMatchObject({applied:true,fullyApplied:true,reviewRequired:false,switchIds:[],periods:[],commits:[],
      partition:[{disposition:'applied'}]})
    const lateCommitted = receipts(late)
    expect(lateCommitted.effects).toHaveLength(1); expect(lateCommitted.partitions).toHaveLength(1)
    expect(lateCommitted.transitions).toHaveLength(1); expect(lateCommitted.normal).toEqual([])
    const lateEffect = lateCommitted.effects[0],latePartition = lateCommitted.partitions[0]
    expect(lateEffect).toMatchObject({source_message_id:late.id,company_id:f.companyId,environment:'test',
      payload_hash:createHash('sha256').update(late.raw_payload!).digest('hex')})
    expect(createHash('sha256').update(lateEffect.effect_text).digest('hex')).toBe(lateEffect.effect_hash)
    expect(createHash('sha256').update(latePartition.partition_text).digest('hex')).toBe(latePartition.partition_hash)
    const lateFacts = JSON.parse(lateEffect.effect_text)
    expect(lateFacts).toMatchObject({owner:'inbound-supply-object-v1',sourceMessageId:late.id,sourcePayloadHash:lateEffect.payload_hash,
      companyId:f.companyId,environment:'test',canonicalAssessmentId:lateEffect.canonical_assessment_id,
      object:{objectId:f.external,identityAgency:'9'},wire:{li:f.caseReference},
      plan:{kind:'superseded_by_cancellation',cancelledSwitchId:f.switchId,originalId:f.originalZ03.id,
        originalHash:createHash('sha256').update(f.originalZ03.raw_payload!).digest('hex'),
        cancellationSourceMessageId:cancellation.id,cancellationEffectReceiptId:effect.id},
      previousStates:[],resultingStates:[],previousSwitches:[],resultingSwitches:[]})
    expect(Object.hasOwn(lateFacts.plan,'switchId')).toBe(false)
    expect(lateEffect.id).not.toBe(effect.id)
    expect(latePartition).toMatchObject({source_message_id:late.id,payload_hash:lateEffect.payload_hash,
      canonical_assessment_id:lateEffect.canonical_assessment_id,
      result:{applied:true,switchIds:[],periods:[],commits:[],effectReceiptIds:[lateEffect.id]}})
    expect(superseded.result.effectReceiptIds).toEqual([lateEffect.id])
    const lateEvents = sql<Array<{payload:Record<string,unknown>}>>(`SELECT coalesce(jsonb_agg(to_jsonb(e) ORDER BY e.created_at,e.id),'[]')
      FROM public.ediel_message_events e WHERE e.company_id=${literal(f.companyId)} AND e.ediel_message_id=${literal(late.id)}
      AND e.event_type='validated' AND e.payload ? 'sourceObjectPartition';`)
    expect(lateEvents.at(-1)!.payload).toMatchObject({fullyApplied:true,reviewRequired:false,applied:true,
      committedEffectReceiptIds:[lateEffect.id],sourceObjectPartition:superseded.result.partition})
    expect(sql(`SELECT to_jsonb(count(*)) FROM public.ediel_message_events WHERE company_id=${literal(f.companyId)}
      AND ediel_message_id=${literal(late.id)} AND event_type='outcome';`)).toBe(0)
    expect(sql(`SELECT to_jsonb(s) FROM public.supplier_switch_requests s WHERE id=${literal(f.switchId)} AND company_id=${literal(f.companyId)};`)).toEqual(cancelledSwitch)
    expect(periods(f)).toEqual([])
    await sendOwnAcks(f,late.id)
    const lAcks = sql<EdielMessageRow[]>(`SELECT coalesce(jsonb_agg(to_jsonb(a) ORDER BY message_family),'[]')
      FROM public.ediel_messages a WHERE a.company_id=${literal(f.companyId)} AND a.related_message_id=${literal(late.id)} AND a.direction='outbound';`)
    expect(lAcks.map(ack => [ack.message_family,ack.ack_outcome])).toEqual([['APERAK','positive'],['CONTRL','positive']])
    for (const ack of lAcks) assertSentWithinOwnDeadline(late,ack)
    const lAperakWire = tokenizeEdifact(lAcks.find(ack => ack.message_family === 'APERAK')!.raw_payload!)
    expect(lAperakWire.segments.some(segment => segment.tag === 'ERC' && segmentComposite(segment,1,lAperakWire.una)[0] === '100')).toBe(true)
    const lProtocol = protocol(late)
    for (const source of [cancellation,late]) {
      await processInboundEdielMessage({actorUserId:f.actorUserId,edielMessageId:source.id})
      expect(receipts(cancellation)).toEqual(committed); expect(receipts(late)).toEqual(lateCommitted)
      expect(switchState(f)).toMatchObject({status:'cancelled_before_start',original:f.originalZ03.id,inbound:cancellation.id})
      expect(periods(f)).toEqual([]); expect(original(f)).toEqual(beforeOriginal); expect(permissions(f)).toEqual(beforePermission)
      expect(custody(cancellation)).toEqual(cBirth); expect(custody(late)).toEqual(lBirth)
      expect(protocol(cancellation)).toEqual(cProtocol); expect(protocol(late)).toEqual(lProtocol)
      // This is a genuine FOREIGN-company control, not a same-tenant sibling.
      expect(original(foreign)).toEqual(foreignOriginal); expect(switchState(foreign)).toEqual(foreignSwitch); expect(periods(foreign)).toEqual([])
    }
  },180000)
})
