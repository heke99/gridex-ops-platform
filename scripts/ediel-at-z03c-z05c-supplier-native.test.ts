// Constructed native cancellation chains. Whole acceptance IDs are deliberately
// untagged until the literal contracts and this actual registered run are proved.
// Synthetic public tenant/mail inputs and one external SMTP provider double;
// all parsing, origination, archives, native owners, ACKs and consumers are real.
// Historical L4/L3 and LK-1 native cancellation boundaries remain unproved.
// Fresh Z03L origination requires 14 days; it cannot supply an L4 original.
import { randomUUID } from 'node:crypto'
import { afterEach, describe, expect, it, vi } from 'vitest'
const smtp = vi.hoisted(() => vi.fn())
vi.mock('nodemailer', () => ({ default: { createTransport: () => ({ sendMail: smtp }) } }))
import { seedNormalSwitchNativeFixture, futureNativeSupplyDate, nativeSql as sql, literal } from './helpers/ediel-normal-switch-native-fixture'
import { seedOriginalMailboxNative, recordOriginalMailboxNativeReception } from './helpers/originalMailboxNative'
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
import { resolveCanonicalRuntimeDecisionWithRegistry } from '@/lib/ediel/core/runtimeDecision'
import { recordReceivedSourceValidation } from '@/lib/ediel/core/receivedSourceValidationLedger'
import { buildContrlDraft, buildAperakDraft } from '@/lib/ediel/ack'
import { readCommittedInboundAck } from '@/lib/ediel/ack/committedInboundAck'
import { EdifactEnvelopeCodec } from '@/lib/ediel/core/edifactEnvelopeCodec'
import { tokenizeEdifact, segmentComposite } from '@/lib/ediel/core/edifactTokenizer'
import type { EdielMessageRow } from '@/lib/ediel/types'

type Fixture = Awaited<ReturnType<typeof seedNormalSwitchNativeFixture>> & { endMinute: string }
type Period = { id: string; company_id: string; customer_id: string; metering_point_id: string;
  status: string; start_date: string; end_date: string | null; market_end_at: string | null;
  source_message_id: string; source_end_message_id: string | null; metadata: Record<string, unknown>; market_state_version: number }
afterEach(() => { smtp.mockReset(); vi.unstubAllEnvs() })
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
async function receiveProdat(f: Fixture, wire: string, code: 'Z04' | 'Z05', subtype: 'L' | 'C') {
  const id = randomUUID(), receivedAt = new Date().toISOString(), config = assertEdielSmtpReadiness()
  const mail = await seedOriginalMailboxNative(sql, literal, { companyId: f.companyId, environment: 'test', raw: wire,
    receivedAt, smtpFrom: config.from })
  // Only public prospective input is supplied. INSERT triggers own immutable
  // source/context; the processor owns validation, effects and reply admission.
  sql(`INSERT INTO public.ediel_messages(id,company_id,environment,direction,message_standard,message_family,message_code,status,raw_payload,parsed_payload,message_received_at,application_reference,sender_ediel_id,receiver_ediel_id,interchange_reference,inbound_email_message_id,mailbox_message_id,canonical_rule_pack_id,rule_profile_key,rule_profile_version_id,rule_profile_version,rule_pack_checksum,rule_pack_snapshot)
    SELECT ${literal(id)},${literal(f.companyId)},'test','inbound','edifact','PRODAT',${literal(code)},'received',${literal(wire)},
      ${literal({ subtype, prodatDependentFacts: { market: 'electricity', meterReadingsSentInUtilts: false } })}::jsonb,
      ${literal(receivedAt)}::timestamptz,'23-DDQ-PRODAT',${literal(f.receiver)},${literal(f.sender)},${literal(mail.parsed.interchangeReference)},
      ${literal(mail.inboundEmailMessageId)},${literal(mail.inboundEmailMessageId)},pack.id,profile.profile_key,profile.id,
      pack.guide_version||':r'||pack.guide_revision,pack.source_hash,profile.profile
    FROM public.ediel_message_profiles profile JOIN public.ediel_rule_packs pack ON pack.id=profile.rule_pack_id
    WHERE profile.profile_key=${literal(`PRODAT:${code}:${subtype}:26.A:r3`)} AND profile.is_enabled;`)
  await recordOriginalMailboxNativeReception({ ...mail, companyId: f.companyId, sourceMessageId: id, actorUserId: f.actorUserId })
  const message = await getEdielMessageById(id); expect(message).not.toBeNull()
  return message!
}
async function process(f: Fixture, source: EdielMessageRow) {
  const decision = await resolveCanonicalRuntimeDecisionWithRegistry(source)
  expect([decision.syntaxDecision, decision.applicationDecision, decision.functionalDecision], JSON.stringify(decision.issues))
    .toEqual(['accepted', 'accepted', 'accepted'])
  await processInboundEdielMessage({ actorUserId: f.actorUserId, edielMessageId: source.id })
  return (await getEdielMessageById(source.id))!
}
const periods = (f: Fixture) => sql<Period[]>(`SELECT coalesce(jsonb_agg(to_jsonb(p) ORDER BY p.id),'[]') FROM public.customer_supply_periods p WHERE company_id=${literal(f.companyId)};`)
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
async function sendOwnAcks(f: Fixture, sourceId: string) {
  const { data, error } = await supabaseService.from('ediel_messages').select('*').eq('company_id', f.companyId)
    .eq('related_message_id', sourceId).eq('direction', 'outbound').order('message_family')
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
    await process(f, confirmation)
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
    await process(f,confirmation)
    const [baseline] = periods(f), beforeOriginal = original(f), beforePermission = permissions(f)
    const ending = await receiveProdat(f,z05(f),'Z05','L'); await process(f,ending)
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
    const confirmation = await receiveProdat(f,z04(f),'Z04','L'); await process(f,confirmation)
    const [baseline] = periods(f); expect(permissions(f)).toEqual(permissionBefore)
    const ending = await receiveProdat(f,z05(f),'Z05','L'); await process(f,ending)
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
    const confirmation = await receiveProdat(f,z04(f),'Z04','L'); await process(f,confirmation)
    const ending = await receiveProdat(f,z05(f),'Z05','L'); await process(f,ending)
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
    await process(f,confirmation)
    const [baseline] = periods(f)
    const endingA = await receiveProdat(f,z05(f),'Z05','L'); await process(f,endingA)
    expect(periods(f)[0]).toMatchObject({ id: baseline.id, status: 'ending', source_end_message_id: endingA.id })
    const restorationA = await receiveProdat(f,z05(f,'Z24'),'Z05','C'); await process(f,restorationA)
    expect(periods(f)[0]).toMatchObject({ id: baseline.id, status: baseline.status, source_end_message_id: null })
    const endBMinute = new Date(Date.UTC(Number(f.endMinute.slice(0,4)),Number(f.endMinute.slice(4,6))-1,
      Number(f.endMinute.slice(6,8))+1)).toISOString().slice(0,10).replaceAll('-','')+'0000'
    expect(endBMinute).not.toBe(f.endMinute)
    const endingB = await receiveProdat(f,z05({...f,endMinute:endBMinute}),'Z05','L'); await process(f,endingB)
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
    const f = await seed(), confirmation = await receiveProdat(f,z04(f),'Z04','L'); await process(f,confirmation)
    const ending = await receiveProdat(f,z05(f),'Z05','L'); await process(f,ending)
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
    const f = await seed(), confirmation = await receiveProdat(f,z04(f),'Z04','L'); await process(f,confirmation)
    const ending = await receiveProdat(f,z05(f),'Z05','L'); await process(f,ending)
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
    const held = await receiveProdat(f,wire,'Z05','C')
    const decision = await resolveCanonicalRuntimeDecisionWithRegistry(held)
    expect(decision.syntaxDecision,JSON.stringify(decision.issues)).toBe('accepted')
    expect(decision.issues).toContainEqual(expect.objectContaining({
      prodatDiagnostic:expect.objectContaining({fieldNumber,...(fieldNumber === '223' ? {errorKind:'missing'} : {})}),
    }))
    if (fieldNumber === '223') {
      await expect(processInboundEdielMessage({actorUserId:f.actorUserId,edielMessageId:held.id}))
        .rejects.toThrow(/^prodat_subtype_unknown:missing$/)
    } else await processInboundEdielMessage({actorUserId:f.actorUserId,edielMessageId:held.id})
    expect(periods(f)).toEqual(before); expect(permissions(f)).toEqual(permissionBefore)
    expect(transitions()).toEqual(historyBefore)
    // A valid syntax CONTRL is permitted; no positive business APERAK is.
    expect(sql(`SELECT to_jsonb(count(*)) FROM public.ediel_messages WHERE company_id=${literal(f.companyId)} AND related_message_id=${literal(held.id)} AND direction='outbound' AND message_family='APERAK' AND ack_outcome='positive';`)).toBe(0)
  }, 180000)

  it('concurrent invocation of the same received C restores once with one transition and one reply per family', async () => {
    const f = await seed(), confirmation = await receiveProdat(f,z04(f),'Z04','L'); await process(f,confirmation)
    const [baseline] = periods(f)
    const ending = await receiveProdat(f,z05(f),'Z05','L'); await process(f,ending)
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
    expect(sql(`SELECT coalesce(jsonb_agg(jsonb_build_object('family',message_family,'outcome',ack_outcome) ORDER BY message_family,id),'[]') FROM public.ediel_messages WHERE company_id=${literal(f.companyId)} AND related_message_id=${literal(continuation.id)} AND direction='outbound';`))
      .toEqual([{family:'APERAK',outcome:'positive'},{family:'CONTRL',outcome:'positive'}])
    expect(original(f)).toEqual(beforeOriginal); expect(endingHistory()).toEqual(historyBefore)
    expect(permissions(f)).toEqual(permissionBefore)
  }, 180000)

  it('a receiver supplier role expired after genuine C reception cannot restore the ending period', async () => {
    const f = await seed(), confirmation = await receiveProdat(f,z04(f),'Z04','L'); await process(f,confirmation)
    const ending = await receiveProdat(f,z05(f),'Z05','L'); await process(f,ending)
    const continuation = await receiveProdat(f,z05(f,'Z24'),'Z05','C'), before = supplyBusinessState(f)
    expect(sql(`WITH changed AS (UPDATE public.tenant_actor_roles SET valid_to=clock_timestamp() WHERE company_id=${literal(f.companyId)} AND actor_id=${literal(f.actorUserId)} AND environment='test' AND role_code='electricity_supplier' AND valid_to IS NULL RETURNING id) SELECT to_jsonb(count(*)) FROM changed;`)).toBe(1)
    await processInboundEdielMessage({actorUserId:f.actorUserId,edielMessageId:continuation.id})
    expect(supplyBusinessState(f)).toEqual(before)
    expect(positiveAperakCount(f,continuation.id)).toBe(0)
  }, 180000)

  it('a genuine foreign execution actor cannot apply the own fresh C source', async () => {
    const f = await seed(), foreign = await seed(), confirmation = await receiveProdat(f,z04(f),'Z04','L'); await process(f,confirmation)
    const ending = await receiveProdat(f,z05(f),'Z05','L'); await process(f,ending)
    const continuation = await receiveProdat(f,z05(f,'Z24'),'Z05','C')
    const before = supplyBusinessState(f), foreignBefore = supplyBusinessState(foreign), effectsBefore = ownedEffects(f,continuation.id)
    expect(await applySupplyMarketSource({actorUserId:foreign.actorUserId,message:continuation}))
      .toMatchObject({applied:false,reason:'supply_execution_actor_unqualified',periods:[],commits:[],effectReceiptIds:[]})
    expect(supplyBusinessState(f)).toEqual(before); expect(supplyBusinessState(foreign)).toEqual(foreignBefore)
    expect(ownedEffects(f,continuation.id)).toEqual(effectsBefore)
    expect(positiveAperakCount(f,continuation.id)).toBe(0)
  }, 180000)

  it('a sender grid-owner role revoked before fresh C reception cannot restore the ending period', async () => {
    const f = await seed(), confirmation = await receiveProdat(f,z04(f),'Z04','L'); await process(f,confirmation)
    const ending = await receiveProdat(f,z05(f),'Z05','L'); await process(f,ending)
    const before = supplyBusinessState(f)
    expect(sql(`WITH changed AS (UPDATE public.platform_actor_roles SET is_active=false WHERE actor_id=${literal(f.marketActorId)} AND actor_role='grid_owner' AND is_active RETURNING id) SELECT to_jsonb(count(*)) FROM changed;`)).toBe(1)
    const continuation = await receiveProdat(f,z05(f,'Z24'),'Z05','C')
    await processInboundEdielMessage({actorUserId:f.actorUserId,edielMessageId:continuation.id})
    expect(supplyBusinessState(f)).toEqual(before)
    expect(positiveAperakCount(f,continuation.id)).toBe(0)
  }, 180000)

  it('failure at the final C partition insert rolls back restoration and receipts and records the named held warning', async () => {
    const f = await seed(), confirmation = await receiveProdat(f,z04(f),'Z04','L'); await process(f,confirmation)
    const ending = await receiveProdat(f,z05(f),'Z05','L'); await process(f,ending)
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
    const f = await seed(), confirmation = await receiveProdat(f,z04(f),'Z04','L'); await process(f,confirmation)
    const ending = await receiveProdat(f,z05(f),'Z05','L'); await process(f,ending)
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
