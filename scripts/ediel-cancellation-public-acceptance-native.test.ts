// Constructed native cancellation chains. Whole acceptance IDs are deliberately
// untagged until the literal contracts and this actual registered run are proved.
// Synthetic public tenant/mail inputs and one external SMTP provider double;
// all parsing, origination, archives, native owners, ACKs and consumers are real.
// Historical L4/L3 and LK-1 native cancellation boundaries remain unproved.
// Fresh Z03L origination requires 14 days; it cannot supply an L4 original.
import { createHash, randomUUID } from 'node:crypto'
import { afterEach, describe, expect, it, vi } from 'vitest'
const smtp = vi.hoisted(() => vi.fn())
vi.mock('nodemailer', () => ({ default: { createTransport: () => ({ sendMail: smtp }) } }))
import { seedNormalSwitchNativeFixture, futureNativeSupplyDate, nativeSql as sql, literal } from './helpers/ediel-normal-switch-native-fixture'
import { seedOriginalMailboxNative } from './helpers/originalMailboxNative'
import { buildCancellationProspectiveZ04 } from './helpers/ediel-cancellation-prospective-source-2ea'
import { ownerSource, OWNER } from '../__tests__/helpers/sourceOwnerFixtures'
import { closureFixture, CLOSURE_OBJECT } from '../__tests__/helpers/closureWireFixtures'
import { supabaseService } from '@/lib/supabase/service'
import { createMeteringPermissionDraft } from '@/lib/onboarding/infoRequests'
import { getEdielMessageById } from '@/lib/ediel/db'
import { assertEdielSmtpReadiness } from '@/lib/ediel/mailReadiness'
import { prepareAndQueueSwitchCancellation } from '@/lib/ediel/flows/prodatSwitchCancellation'
import { prepareAndQueueEdielZ03 } from '@/lib/ediel/flows/prodatSwitch'
import { readSwitchCancellationSource } from '@/lib/ediel/production/switchCancellationSource'
import { sendEdielMessageViaSmtp } from '@/lib/ediel/transport'
import { processInboundEdielMessage } from '@/lib/ediel/flows/inboundProcessing'
import { applySupplyMarketSource } from '@/lib/ediel/flows/supplyMarketTransition'
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
afterEach(() => { smtp.mockReset(); vi.unstubAllEnvs(); confirmedSupplyWitnesses.clear() })
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
// Preserves PR627/ac264's 30 case identities and original effect controls.
// Public intake replaces private catalog/false-reading setup; committed healthy
// period premises and literal missing223 refusal keep each boundary truthful.
// A failure keeps its original cause; later contract suffixes remain NOT_REACHED.
async function nativePhase<T>(phase: string, run: () => Promise<T>): Promise<T> {
  try { return await run() }
  catch (cause) { throw new Error('native_cancellation_phase:'+phase, { cause }) }
}
async function receiveProdat(f: Fixture, wire: string, code: 'Z04' | 'Z05', subtype: 'L' | 'C') {
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
  await processInboundEdielMessage({ actorUserId: f.actorUserId, edielMessageId: source.id })
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
// Refines peer donor6077035986: read the actual stored guard reason, then
// emit only fixed classifications/counts. Original messages and IDs stay local.
function aperakBlockedWarningDiagnostic(f: Fixture, sourceId: string, stage: 'sendOwnAcks' | 'concurrent601') {
  const warnings = sql<Array<{ message: string }>>(`SELECT coalesce(jsonb_agg(jsonb_build_object('message',e.message)
    ORDER BY e.created_at,e.id),'[]') FROM public.ediel_message_events e
    WHERE e.company_id=${literal(f.companyId)} AND e.ediel_message_id=${literal(sourceId)}
      AND e.event_type='manual_note' AND e.event_status='warning'
      AND e.event_payload->>'blockedBy'='canonical_inbound_ack_guard' AND e.event_payload->>'ackFamily'='APERAK'
      AND e.event_payload->>'sourceMessageId'=${literal(sourceId)};`)
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

describe('actual native supplier cancellation chains', () => {
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
    const settled = await Promise.allSettled([0,1].map(() => processInboundEdielMessage({actorUserId:f.actorUserId,edielMessageId:continuation.id})))
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
})
