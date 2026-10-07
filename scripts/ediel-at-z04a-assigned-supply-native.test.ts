// Bounded A-native feedback only: neither whole AT-Z04A nor AT-Z04D is tagged.
// Real archived/reviewed ground, mailbox, reception and source-effect producers.
// Issuer trust and SMTP configuration are explicitly synthetic, not legal or
// market acceptance. The retained ground fixture prepares an UNSENT Z03: this
// proves no usable sent correlation, not literal absence of every Z03 row.
import { createHash, createHmac, randomUUID } from 'node:crypto'
import { afterEach, expect, it, vi } from 'vitest'
import { guideOrderedFixtureRaw } from '../__tests__/helpers/prodatGuideOrderedFixture'
import { characteristic, line, qty, type Parts } from '../__tests__/fixtures/prodat-register'
import { createRegulatedSupplyGroundNativeFixture } from './helpers/ediel-regulated-supply-ground-native-fixture'
import { seedNormalSwitchNativeFixture, nativeActorRoleSql, nativeSql as sql, literal } from './helpers/ediel-normal-switch-native-fixture'
import { seedOriginalMailboxNative, recordOriginalMailboxNativeReception } from './helpers/originalMailboxNative'
import { archiveRegulatedSupplyGround, reviewRegulatedSupplyGround, readRegulatedSupplyGroundScope, type RegulatedSupplySubmission } from '@/lib/ediel/production/regulatedSupplyGroundIntake'
import { createInboundEdielMessage } from '@/lib/inbound-mail/inboundStatusUpdater'
import { resolveCanonicalRuntimeDecisionWithRegistry } from '@/lib/ediel/core/runtimeDecision'
import { buildReceivedSourceValidationEvidence } from '@/lib/ediel/core/receivedSourceValidationEvidence'
import { createCanonicalOutboundMessage } from '@/lib/ediel/core/kernel'
import { processInboundEdielMessage } from '@/lib/ediel/flows/inboundProcessing'
import { assertEdielSmtpReadiness } from '@/lib/ediel/mailReadiness'
import { supabaseService } from '@/lib/supabase/service'
import { readSourceQualifiedProdatBilateralCapability } from '@/lib/ediel/core/prodatBilateralSourceCapability'
import type { EdielMessageRow } from '@/lib/ediel/types'
import { tokenizeEdifact, segmentComposite } from '@/lib/ediel/core/edifactTokenizer'

const provider = vi.hoisted(() => vi.fn())
vi.mock('nodemailer', () => ({ default: { createTransport: () => ({ sendMail: provider }) } }))
afterEach(() => { vi.unstubAllEnvs(); vi.restoreAllMocks() })
type Ground = (Awaited<ReturnType<typeof createRegulatedSupplyGroundNativeFixture>> & { z03Mode: 'legacy_unsent' })
  | (Awaited<ReturnType<typeof createAssignedGroundWithoutOwnZ03>> & { z03Mode: 'absent' })
type WireOptions = { withoutOwnZ03?: boolean; omitStart?: boolean; omitAnnualVolume?: boolean; omitReadingField?: '214' | '218'; invoiceeIdentity?: string; startOffsetMinutes?: number; revokeSupplierRole?: boolean }

// Proposed local A-test producer, same original legal/archive/review mechanism.
// Sole change: existing real normal-stage producer deferOriginal:true; no delete or privately minted acceptance.
async function createAssignedGroundWithoutOwnZ03(){
 const f=await seedNormalSwitchNativeFixture({requestedStartDate:'2026-10-15',deferOriginal:true}),reviewer=randomUUID(),agreement=randomUUID(),keyId=randomUUID(),representationId=randomUUID(),key=Buffer.from('SYNTHETIC regulated issuer verifier mechanism fixture only')
 sql(`INSERT INTO auth.users(instance_id,confirmation_token,recovery_token,email_change_token_new,email_change,id,aud,role,email,email_confirmed_at,raw_app_meta_data,raw_user_meta_data,created_at,updated_at,is_sso_user,is_anonymous) VALUES('00000000-0000-0000-0000-000000000000','','','','',${literal(reviewer)},'authenticated','authenticated',${literal(`${reviewer}@example.invalid`)},now(),'{}','{}',now(),now(),false,false);
 INSERT INTO public.user_profiles(id,email,full_name,user_status) VALUES(${literal(reviewer)},${literal(`${reviewer}@example.invalid`)},'Synthetic separate regulated reviewer','active') ON CONFLICT(id) DO UPDATE SET user_status='active';
 INSERT INTO public.company_memberships(company_id,user_id,membership_role,status,accepted_at,metadata,role,is_active,joined_at,role_key) VALUES(${literal(f.companyId)},${literal(reviewer)},'company_admin','active',now(),'{}','company_admin',true,now(),'company_admin');
 ${nativeActorRoleSql(f.companyId,reviewer)}
 INSERT INTO public.user_permissions(user_id,company_id,permission_id,permission_key,effect,is_active,status) SELECT own.actor,${literal(f.companyId)},p.id,p.key,'allow',true,'active' FROM (VALUES(${literal(reviewer)}::uuid)) own(actor) CROSS JOIN public.permissions p WHERE p.key IN('communication.read','communication.write','contracts.read','metering.read','metering.write');
 INSERT INTO public.user_permissions(user_id,company_id,permission_id,permission_key,effect,is_active,status) SELECT ${literal(reviewer)},${literal(f.companyId)},id,key,'allow',true,'active' FROM public.permissions WHERE key='ediel.regulated_supply.review';`)
 const dso=sql<string>(`SELECT to_jsonb(actor_id) FROM public.platform_actor_identifiers WHERE identifier_type='EdielId' AND identifier_value=${literal(f.receiver)} AND is_verified`)
 sql(`INSERT INTO public.tenant_bilateral_agreements(id,company_id,environment,counterparty_actor_id,capability_code,terms,is_enabled,valid_from,valid_to,source_reference) VALUES(${literal(agreement)},${literal(f.companyId)},'test',${literal(dso)},'PRODAT:Z04:A','{"synthetic_fixture_only":true}',true,clock_timestamp()-interval '1 day','2100-01-01','SYNTHETIC NATIVE LEGAL ORIGINAL');`)
 const selector={environment:'test' as const,kind:'assigned_supply' as const,contractId:f.contractId,meteringPointId:f.pointId,identityAgency:'9' as const,bilateralAgreementId:agreement,startAt:'2026-10-14T23:00:00Z'},owner={companyId:f.companyId,actorUserId:f.actorUserId}
 const scoped=await readRegulatedSupplyGroundScope({...owner,...selector});expect(scoped.status,JSON.stringify(scoped)).toBe('scoped')
 const bytes=Buffer.from('%PDF-1.7\nSYNTHETIC test legal original; no real decision\n%%EOF'),sourceHash=createHash('sha256').update(bytes).digest('hex'),submission:RegulatedSupplySubmission={...selector,source:{bytesBase64:bytes.toString('base64'),mimeType:'application/pdf',reference:'SYNTHETIC NATIVE LEGAL ORIGINAL',version:'1'}}
 sql(`INSERT INTO gridex_regulated_supply.issuer_keys(id,company_id,environment,issuer_code,legal_issuer_reference,legal_authority_source_hash,receipt_signing_key,valid_from,valid_to) VALUES(${literal(keyId)},${literal(f.companyId)},'test','SYNTHETIC','DECLARED VERIFIER BOUNDARY; NOT LEGAL ACCEPTANCE',${literal('a'.repeat(64))},decode(${literal(key.toString('hex'))},'hex'),clock_timestamp()-interval '1 day','2100-01-01');
 INSERT INTO gridex_regulated_supply.issuer_representations(id,company_id,environment,issuer_key_id,legal_actor_id,dso_actor_id,grid_area_code,permitted_kind,bilateral_agreement_id,legal_representation_reference,legal_authority_source_hash,valid_from,valid_to) VALUES(${literal(representationId)},${literal(f.companyId)},'test',${literal(keyId)},${literal(f.actorUserId)},${literal(dso)},'TES','assigned_supply',${literal(agreement)},'SYNTHETIC NON LEGAL REPRESENTATION',${literal('b'.repeat(64))},clock_timestamp()-interval '1 day','2100-01-01');`)
 expect(sql(`SELECT to_jsonb(count(*)) FROM public.ediel_messages WHERE company_id=${literal(f.companyId)} AND message_code='Z03'`)).toBe(0)
 const signed=(version='1')=>{const payload=Buffer.from(JSON.stringify({format:'ediel_regulated_supply_ground_receipt_v1',issuerCode:'SYNTHETIC',receiptId:randomUUID(),companyId:f.companyId,environment:'test',scope:scoped.scope,sourceHash,sourceReference:submission.source.reference,sourceVersion:version,legalDecisionReference:'SYNTHETIC DECLARED MECHANISM ONLY',issuedAt:new Date(Date.now()-1000).toISOString(),expiresAt:'2099-01-01T00:00:00Z'}));return {...submission,source:{...submission.source,version},issuerReceipt:{keyId,representationId,payloadBase64:payload.toString('base64'),signatureHex:createHmac('sha256',key).update(payload).digest('hex')}}}
 return {...f,...owner,reviewer,agreement,representationId,scoped,bytes,sourceHash,submission,signed}
}

type SourceGuard = { raw: string; direction: string; receipt: string; created: string; document: string | null; context: unknown }
function readSourceGuard(id: string, company: string, wire: string) {
  const snapshot = sql<SourceGuard>(`SELECT jsonb_build_object('raw',raw_payload,'direction',direction,
    'receipt',message_received_at,'created',created_at,'document',message_created_at,'context',execution_context_snapshot)
    FROM public.ediel_messages WHERE id=${literal(id)} AND company_id=${literal(company)}`)
  expect(snapshot).toMatchObject({ raw: wire, direction: 'inbound' })
  expect(snapshot.receipt).not.toBeNull()
  return snapshot
}

function assignedWire(f: Ground, reference: string, options: WireOptions = {}) {
  // Independent literal P26.A wire facts, not the production renderer. Field
  // 223 is Z26 and 210 is the archived ground's exact Swedish standard time.
  const start = new Date(Date.parse(f.submission.startAt) + 3600000 + (options.startOffsetMinutes ?? 0) * 60000).toISOString().slice(0, 16).replace(/[-T:]/g, '')
  const body: Parts[] = [
    ['NAD', 'FR', [f.receiver, '160', 'SVK'], '', '', '', '', '', '', 'SE'],
    ['NAD', 'DO', [f.sender, '160', 'SVK'], '', '', '', '', '', '', 'SE'],
    line('1', f.external, undefined, '9'), ['DTM', ['92', start, '203']], ['DTM', ['354', '15', '806']], qty('1000'),
    ...characteristic('Z13', 'Z26'), ...characteristic('Z04', 'Z04'), ...characteristic('Z07', 'Z12'),
    ...characteristic('Z12', 'D', 3), ...characteristic('Z15', 'Z32'), ['CCI', '', 'Z14'], ['CAV', ['', '', '', 'L639Q']],
    // Independent physical register input; the source owner derives TRUE.
    // This does not assert that any UTILTS reading has already arrived.
    ...characteristic('Z02', '1', 3), ...characteristic('Z05', '6', 3), ...characteristic('Z16', '111', 3),
    ['RFF', ['MG', `METER-${f.external}`]], ['RFF', ['Z05', f.gridAreaCode]], ['RFF', ['LI', reference]],
    ['NAD', 'UD', [f.customerIdentity.id, f.customerIdentity.qualifier, f.customerIdentity.agency], '', 'Synthetic Own Customer', 'Street', 'City', '', '12345', 'SE'],
    ['NAD', 'IT', [f.external, '', '9'], '', '', 'Street', 'Town', '', '12345', 'SE'],
    ['NAD', 'Z02', [f.brpEdielId, '160', 'SVK']],
  ]
  if (options.omitStart) body.splice(body.findIndex(part => part[0] === 'DTM' && Array.isArray(part[1]) && part[1][0] === '92'), 1)
  if (options.omitAnnualVolume) body.splice(body.findIndex(part => part[0] === 'QTY'), 1)
  if (options.omitReadingField) {
    const qualifier = options.omitReadingField === '214' ? 'Z02' : 'Z05'
    // Remove only this physical CCI/CAV pair before source birth. Own259 stays
    // supplied and lets the actual source owner qualify the readings condition.
    const index = body.findIndex(part => part[0] === 'CCI' && part[2] === qualifier)
    expect(index).toBeGreaterThan(-1)
    body.splice(index, 2)
  }
  // Optional C082 must be wholly absent when testing national missing250;
  // supplying qualifier/agency with blank3039 fails full UNSM before that owner.
  if (options.invoiceeIdentity !== undefined) body.push(['NAD', 'IV', options.invoiceeIdentity === '' ? '' : [options.invoiceeIdentity, f.customerIdentity.qualifier, f.customerIdentity.agency],
    '', 'Synthetic Own Invoicee', 'Street', 'City', '', '12345', 'SE'])
  return guideOrderedFixtureRaw(body, 'Z04')
    .replace('+S+R+', `+${f.receiver}:14+${f.sender}:14+`)
    .replace("+23-DDQ-PRODAT'", "+23-DDQ-PRODAT++1++1'")
    .replace('+I++23-DDQ-PRODAT', `+${reference}++23-DDQ-PRODAT`).replace("UNZ+1+I'", `UNZ+1+${reference}'`)
    .replace('UNH+M+', `UNH+${reference}+`).replace(/UNT\+(\d+)\+M'/, `UNT+$1+${reference}'`)
    .replace('BGM+Z04+D+', `BGM+Z04+${reference}+`)
}

async function ground(options: WireOptions = {}) {
  for (const [key, value] of Object.entries({ EDIEL_SHARED_MAILBOX_ADDRESS: 'synthetic@example.invalid', EDIEL_APP_DKIM_ENABLED: 'false',
    EDIEL_SMTP_FROM: 'synthetic@example.invalid', EDIEL_SMTP_USER: 'synthetic@example.invalid', EDIEL_SMTP_PASS: 'synthetic-only', EDIEL_EMAIL_PROVIDER: 'strato' })) vi.stubEnv(key, value)
  provider.mockReset()
  const f: Ground = options.withoutOwnZ03
    ? { ...await createAssignedGroundWithoutOwnZ03(), z03Mode: 'absent' }
    : { ...await createRegulatedSupplyGroundNativeFixture(), z03Mode: 'legacy_unsent' }
  const artifact = await archiveRegulatedSupplyGround({ companyId: f.companyId, actorUserId: f.actorUserId, ...f.signed() })
  const authorized = await reviewRegulatedSupplyGround({ companyId: f.companyId, actorUserId: f.reviewer,
    artifactId: String(artifact.artifactId), sourceHash: String(artifact.sourceHash), scopeHash: String(artifact.scopeHash),
    decision: 'approve', reason: 'Separate synthetic assigned-supply native review' })
  expect(authorized.status, JSON.stringify(authorized)).toBe('authorized')
  if (f.z03Mode === 'legacy_unsent') expect(sql(`SELECT to_jsonb(gridex_received_sources.sent_source_is_current_v1(m)) FROM public.ediel_messages m WHERE id=${literal(f.originalZ03.id)}`)).toBe(false)
  else expect(sql(`SELECT to_jsonb(count(*)) FROM public.ediel_messages WHERE company_id=${literal(f.companyId)} AND message_code='Z03'`)).toBe(0)
  expect(provider).not.toHaveBeenCalled()
  const reference = `A${randomUUID().replaceAll('-', '').slice(0, 12).toUpperCase()}`
  if (f.z03Mode === 'legacy_unsent') expect(reference).not.toBe(f.caseReference)
  if (options.revokeSupplierRole) sql(`UPDATE public.tenant_actor_roles SET valid_to=clock_timestamp()-interval '1 second'
    WHERE company_id=${literal(f.companyId)} AND environment='test' AND actor_id=${literal(f.actorUserId)} AND role_code='electricity_supplier'`)
  const wire = assignedWire(f, reference, options), smtp = assertEdielSmtpReadiness(), receivedAt = new Date().toISOString()
  const mail = await seedOriginalMailboxNative(sql, literal, { companyId: f.companyId, environment: 'test', raw: wire, receivedAt, smtpFrom: smtp.from })
  const ackRoute = randomUUID(), ackProfile = randomUUID()
  sql(`INSERT INTO public.communication_routes(id,company_id,route_name,route_scope,grid_owner_id,environment_type,is_active,target_email)
    VALUES(${literal(ackRoute)},${literal(f.companyId)},'Synthetic assigned ACK route','ediel_ack',${literal(f.gridId)},'bilateral_test',true,'recipient@example.invalid');
    INSERT INTO public.ediel_route_profiles(id,company_id,communication_route_id,route_name,environment,message_standard,payload_format,sender_ediel_id,receiver_ediel_id,application_reference,is_enabled,is_active,transport_security_mode,mailbox,smtp_host,smtp_port,smtp_to,receiver_email)
    VALUES(${literal(ackProfile)},${literal(f.companyId)},${literal(ackRoute)},'Synthetic assigned ACK profile','test','edifact','edifact',${literal(f.sender)},${literal(f.receiver)},'23-DDQ-PRODAT',true,true,'unencrypted',${literal(smtp.from)},${literal(smtp.host)},${smtp.port},'recipient@example.invalid','recipient@example.invalid');
`)
  return { ...f, authorized, reference, wire, mail, smtp, receivedAt, ackRoute, ackProfile,
    beforeSwitch: sql(`SELECT to_jsonb(s) FROM public.supplier_switch_requests s WHERE id=${literal(f.switchId)}`),
    beforeContract: sql(`SELECT to_jsonb(c) FROM public.customer_contracts c WHERE id=${literal(f.contractId)}`),
    beforeCustomer: sql(`SELECT to_jsonb(c) FROM public.customers c WHERE id=${literal(f.customerId)}`),
    beforePoint: sql(`SELECT to_jsonb(p) FROM public.metering_points p WHERE id=${literal(f.pointId)} AND company_id=${literal(f.companyId)}`) }
}

async function source(options: WireOptions = {}) {
  const f = await ground(options)
  const sourceId: string = randomUUID()
  // Explicit narrower source path: prospective public INSERT chooses the real
  // canonical A profile. Private source/context/reception/validation/effects
  // are never seeded or patched. This does not qualify the mail adapter below.
  // Retained legacy FALSE metadata supplies no authority: the qualified own
  // physical259 declaration now establishes TRUE independently.
  sql(`INSERT INTO public.ediel_messages(id,company_id,environment,direction,message_standard,message_family,message_code,status,raw_payload,parsed_payload,message_received_at,application_reference,sender_ediel_id,receiver_ediel_id,interchange_reference,inbound_email_message_id,mailbox_message_id,canonical_rule_pack_id,rule_profile_key,rule_profile_version_id,rule_profile_version,rule_pack_checksum,rule_pack_snapshot)
    SELECT ${literal(sourceId)},${literal(f.companyId)},'test','inbound','edifact','PRODAT','Z04','received',${literal(f.wire)},${literal({ ...f.mail.parsed, prodatDependentFacts: { market: 'electricity', meterReadingsSentInUtilts: false } })}::jsonb,
      ${literal(f.receivedAt)}::timestamptz,'23-DDQ-PRODAT',${literal(f.receiver)},${literal(f.sender)},${literal(f.mail.parsed.interchangeReference)},${literal(f.mail.inboundEmailMessageId)},${literal(f.mail.inboundEmailMessageId)},pack.id,profile.profile_key,profile.id,pack.guide_version||':r'||pack.guide_revision,pack.source_hash,profile.profile
    FROM public.ediel_message_profiles profile JOIN public.ediel_rule_packs pack ON pack.id=profile.rule_pack_id WHERE profile.profile_key='PRODAT:Z04:A:26.A:r3' AND profile.is_enabled;`)
  await recordOriginalMailboxNativeReception({ ...f.mail, companyId: f.companyId, sourceMessageId: sourceId, actorUserId: f.actorUserId })
  const { data, error } = await supabaseService.from('ediel_messages').select('*').eq('id', sourceId).single()
  expect(error).toBeNull()
  const decision = await resolveCanonicalRuntimeDecisionWithRegistry(data as EdielMessageRow)
  expect([decision.syntaxDecision, decision.applicationDecision, decision.functionalDecision], JSON.stringify(decision.issues)).toEqual(['accepted', 'accepted', 'accepted'])
  return { ...f, sourceId, sourceGuard: readSourceGuard(sourceId, f.companyId, f.wire) }
}

function state(f: Awaited<ReturnType<typeof source>>) {
  return sql<{ raw: string; periods: { customer: string; point: string; process: string; date: string; start: string; status: string; ground: string }[];
    effects: number; partitions: number; transitions: number; normalConfirmations: number; companyPeriodCount: number;
    acks: { id: string; family: string; wire: string; company: string; route: string; profile: string }[];
    outbox: { message: string; company: string; source: string; status: string; hash: string }[] }>(`SELECT jsonb_build_object(
    'raw',(SELECT raw_payload FROM public.ediel_messages WHERE id=${literal(f.sourceId)}),
    'periods',(SELECT coalesce(jsonb_agg(jsonb_build_object('customer',customer_id,'point',metering_point_id,'process',source_process,'date',start_date,'start',market_start_at,'status',status,'ground',metadata->>'sourceGroundId')),'[]') FROM public.customer_supply_periods WHERE source_message_id=${literal(f.sourceId)}),
    'companyPeriodCount',(SELECT count(*) FROM public.customer_supply_periods WHERE company_id=${literal(f.companyId)}),
    'effects',(SELECT count(*) FROM gridex_received_sources.supply_object_effect_receipts WHERE source_message_id=${literal(f.sourceId)}),
    'partitions',(SELECT count(*) FROM gridex_received_sources.supply_object_partitions WHERE source_message_id=${literal(f.sourceId)}),
    'transitions',(SELECT count(*) FROM gridex_received_sources.supply_source_transitions WHERE source_message_id=${literal(f.sourceId)}),
    'normalConfirmations',(SELECT count(*) FROM gridex_received_sources.normal_switch_confirmations WHERE source_message_id=${literal(f.sourceId)}),
    'acks',(SELECT coalesce(jsonb_agg(jsonb_build_object('id',id,'family',message_family,'wire',raw_payload,'company',company_id,'route',communication_route_id,'profile',route_profile_id) ORDER BY message_family),'[]') FROM public.ediel_messages WHERE related_message_id=${literal(f.sourceId)}),
    'outbox',(SELECT coalesce(jsonb_agg(jsonb_build_object('message',ediel_message_id,'company',company_id,'source',source_message_id,'status',status,'hash',immutable_payload_hash) ORDER BY ediel_message_id),'[]') FROM public.ediel_outbox WHERE source_message_id=${literal(f.sourceId)}))`)
}

function assertSourceGuard(f: Awaited<ReturnType<typeof source>>) {
  expect(readSourceGuard(f.sourceId, f.companyId, f.wire)).toEqual(f.sourceGuard)
  expect(provider).not.toHaveBeenCalled()
}
function assertOwnedAckOutputs(f: Awaited<ReturnType<typeof source>>, result: ReturnType<typeof state>) {
  expect(result.outbox.map(item => item.message).sort()).toEqual(result.acks.map(ack => ack.id).sort())
  expect(new Set(result.outbox.map(item => item.message)).size).toBe(result.outbox.length)
  for (const item of result.outbox) {
    const ack = result.acks.find(candidate => candidate.id === item.message)
    expect(ack).toBeDefined()
    expect(item).toMatchObject({ company: f.companyId, source: f.sourceId, status: 'queued',
      hash: createHash('sha256').update(ack!.wire, 'utf8').digest('hex') })
  }
  const source = tokenizeEdifact(f.wire), originalUNB = source.segments.filter(token => token.tag === 'UNB')
  const originalUNH = source.segments.filter(token => token.tag === 'UNH')
  expect(originalUNB).toHaveLength(1)
  expect(originalUNH).toHaveLength(1)
  for (const ack of result.acks.filter(candidate => candidate.family === 'CONTRL')) {
    const physical = tokenizeEdifact(ack.wire), uci = physical.segments.filter(token => token.tag === 'UCI')
    expect(uci).toHaveLength(1)
    expect(segmentComposite(uci[0], 1, physical.una)).toEqual(segmentComposite(originalUNB[0], 5, source.una))
    expect(segmentComposite(uci[0], 2, physical.una)).toEqual(segmentComposite(originalUNB[0], 2, source.una))
    expect(segmentComposite(uci[0], 3, physical.una)).toEqual(segmentComposite(originalUNB[0], 3, source.una))
    // These existing sources all have accepted full syntax, including sources
    // rejected by the separate application owner. The UCI result remains1.
    expect(segmentComposite(uci[0], 4, physical.una)).toEqual(['1'])
    const ucm = physical.segments.filter(token => token.tag === 'UCM')
    expect(ucm.length).toBeLessThanOrEqual(1)
    for (const message of ucm) {
      expect(segmentComposite(message, 1, physical.una)).toEqual(segmentComposite(originalUNH[0], 1, source.una))
      expect(segmentComposite(message, 2, physical.una)).toEqual(segmentComposite(originalUNH[0], 2, source.una))
    }
  }
}

function preserves(f: Awaited<ReturnType<typeof ground>>) {
  expect(sql(`SELECT to_jsonb(s) FROM public.supplier_switch_requests s WHERE id=${literal(f.switchId)}`)).toEqual(f.beforeSwitch)
  expect(sql(`SELECT to_jsonb(c) FROM public.customer_contracts c WHERE id=${literal(f.contractId)}`)).toEqual(f.beforeContract)
  expect(sql(`SELECT to_jsonb(c) FROM public.customers c WHERE id=${literal(f.customerId)}`)).toEqual(f.beforeCustomer)
  expect(sql(`SELECT to_jsonb(p) FROM public.metering_points p WHERE id=${literal(f.pointId)} AND company_id=${literal(f.companyId)}`)).toEqual(f.beforePoint)
  if (f.z03Mode === 'legacy_unsent') expect(sql(`SELECT to_jsonb(gridex_received_sources.sent_source_is_current_v1(m)) FROM public.ediel_messages m WHERE id=${literal(f.originalZ03.id)}`)).toBe(false)
  else expect(sql(`SELECT to_jsonb(count(*)) FROM public.ediel_messages WHERE company_id=${literal(f.companyId)} AND message_code='Z03'`)).toBe(0)
  expect(provider).not.toHaveBeenCalled()
}

async function adapterSource(options: WireOptions = {}) {
  const f = await ground(options)
  const id = await createInboundEdielMessage({ companyId: f.companyId, actorUserId: f.actorUserId, environment: 'test',
    inboundEmailMessageId: f.mail.inboundEmailMessageId, parseResultId: f.mail.parseResultId, parsed: f.mail.parsed,
    meteringPointMatch: { status: 'matched', entityType: 'metering_point', entityId: f.pointId, confidence: 1, reasons: ['Synthetic exact own physical point'],
      candidates: [{ customer_id: f.customerId, site_id: f.siteId, grid_owner_id: f.gridId }] } })
  preserves(f)
  // A failed canonical birth must never be reported as successful acceptance.
  const profiles = sql(`SELECT coalesce(jsonb_agg(profile_key ORDER BY profile_key),'[]') FROM public.ediel_message_profiles WHERE profile->>'family'='PRODAT' AND message_code='Z04' AND direction IN('inbound','both') AND is_enabled`)
  expect(typeof id, JSON.stringify({ seam: 'actual_createInboundEdielMessage', profiles })).toBe('string')
  expect(id).toMatch(/^[0-9a-f-]{36}$/)
  const row = sql<{ raw: string; mail: string; mailbox: string; profile: string }>(`SELECT jsonb_build_object('raw',raw_payload,'mail',inbound_email_message_id,'mailbox',mailbox_message_id,'profile',rule_profile_key) FROM public.ediel_messages WHERE id=${literal(id)}`)
  expect(row).toEqual({ raw: f.wire, mail: f.mail.inboundEmailMessageId, mailbox: f.mail.inboundEmailMessageId, profile: 'PRODAT:Z04:A:26.A:r3' })
  return { ...f, sourceId: id!, sourceGuard: readSourceGuard(id!, f.companyId, f.wire) }
}

it('actual unmatched mail adapter must admit physical A with genuine custody and no own sent Z03', async () => {
  await assertAssignedEffects(await adapterSource())
}, 120000)

it('actual unmatched A registers assigned supply and routed ACKs without any own Z03 original', async () => {
  const f = await adapterSource({ withoutOwnZ03: true })
  expect('originalZ03' in f).toBe(false)
  expect(sql(`SELECT to_jsonb(count(*)) FROM public.ediel_messages WHERE company_id=${literal(f.companyId)} AND message_code='Z03'`)).toBe(0)
  await assertAssignedEffects(f)
  expect(sql(`SELECT to_jsonb(count(*)) FROM public.ediel_messages WHERE company_id=${literal(f.companyId)} AND message_code='Z03'`)).toBe(0)
}, 120000)

async function diagnoseSourceValidation(f: Awaited<ReturnType<typeof source>>) {
  const { data, error } = await supabaseService.from('ediel_messages').select('*').eq('id', f.sourceId).single()
  if (error || !data) throw error ?? Error('actual_original_diagnostic_read_required')
  const original = data as EdielMessageRow
  const decision = await resolveCanonicalRuntimeDecisionWithRegistry(original)
  const evidence = buildReceivedSourceValidationEvidence({ original, validated: original, resolvedCompanyId: f.companyId, decision })
  console.info('ASSIGNED_SOURCE_DIAGNOSTIC', JSON.stringify({
    decisions: [decision.syntaxDecision, decision.applicationDecision, decision.functionalDecision],
    issues: decision.issues.map(issue => issue.code), registerValidation: decision.prodatRegisterValidation,
    evidenceBuilt: evidence !== null,
  }))
  if (!evidence) return
  // Explicit diagnostic recording through the existing public owner, using
  // only fresh genuine facets. This never continues business processing.
  const result = await supabaseService.rpc('gridex_record_prodat_source_validation_v6', {
    p_company_id: evidence.companyId, p_environment: evidence.environment, p_source_message_id: evidence.sourceMessageId,
    p_source_payload_hash: evidence.sourcePayloadHash, p_facts_text: evidence.factsText,
    p_source_function_facts_text: evidence.prodatSourceFunctionValidation ? JSON.stringify(evidence.prodatSourceFunctionValidation) : null,
    p_object_facts_text: evidence.prodatObjectValidation ? JSON.stringify(evidence.prodatObjectValidation) : null,
    p_application_facts_text: evidence.prodatApplicationValidation ? JSON.stringify(evidence.prodatApplicationValidation) : null,
    p_ignored_fields_text: evidence.prodatIgnoredFields ? JSON.stringify(evidence.prodatIgnoredFields) : null,
    p_response_facts_text: evidence.prodatResponseValidation ? JSON.stringify(evidence.prodatResponseValidation) : null,
  }).abortSignal(AbortSignal.timeout(2000))
  console.info('ASSIGNED_SOURCE_OWNER_DIAGNOSTIC', JSON.stringify({
    error: result.error ? { code: result.error.code, message: result.error.message } : null,
    receiptPresent: result.data !== null, response: evidence.prodatResponseValidation,
  }))
}

async function processWithDiagnostics(f: Awaited<ReturnType<typeof source>>) {
  try { await processInboundEdielMessage({ actorUserId: f.actorUserId, edielMessageId: f.sourceId }) }
  catch (error) {
    try { await diagnoseSourceValidation(f) }
    catch (diagnosticError) { console.info('ASSIGNED_SOURCE_DIAGNOSTIC_FAILURE', diagnosticError instanceof Error ? diagnosticError.message : typeof diagnosticError) }
    throw error // Preserve the original failed oracle, regardless of diagnostics.
  }
}

async function assertAssignedEffects(f: Awaited<ReturnType<typeof source>>) {
  assertSourceGuard(f)
  const input = { actorUserId: f.actorUserId, edielMessageId: f.sourceId }
  await processWithDiagnostics(f)
  const first = state(f)
  assertSourceGuard(f)
  assertOwnedAckOutputs(f, first)
  expect(first).toMatchObject({ raw: f.wire, effects: 1, partitions: 1, transitions: 1, normalConfirmations: 0 })
  expect(first.periods).toHaveLength(1)
  expect(first.companyPeriodCount).toBe(1)
  expect(first.periods[0]).toMatchObject({ customer: f.customerId, point: f.pointId, process: 'assigned_supply', date: f.requestedStartDate,
    status: 'confirmed_by_grid_owner', ground: f.authorized.groundId })
  expect(Date.parse(first.periods[0].start)).toBe(Date.parse(f.submission.startAt))
  expect(first.acks.map(a => a.family)).toEqual(['APERAK', 'CONTRL'])
  expect(first.acks.every(a => a.company === f.companyId && a.route === f.ackRoute && a.profile === f.ackProfile)).toBe(true)
  expect(first.acks[0].wire).toContain('ERC+100::260')
  expect(first.acks[0].wire).toContain(`RFF+LI:${f.reference}`)
  expect(first.acks[0].wire).toContain(`RFF+Z07:${f.external}`)
  expect(first.outbox).toHaveLength(2)
  expect(first.outbox.every(o => o.company === f.companyId && o.source === f.sourceId && o.status === 'queued' && o.hash.length === 64)).toBe(true)
  preserves(f)
  await processInboundEdielMessage(input)
  expect(state(f)).toEqual(first)
  assertSourceGuard(f)
  assertOwnedAckOutputs(f, state(f))
  preserves(f)
}

it('approved ground and genuine reception commit assigned start, own effects and routed ACKs, retry-stable without normal switch activation', async () => {
  await assertAssignedEffects(await source())
}, 120000)

it.each(['raw', 'direction', 'clock'] as const)('actual A original rejects %s mutation without new effects or custody changes', async kind => {
  const f = await adapterSource(), before = sql(`SELECT to_jsonb(m) FROM public.ediel_messages m WHERE id=${literal(f.sourceId)}`)
  const patch: Partial<EdielMessageRow> = kind === 'raw' ? { raw_payload: f.wire.replace('BGM+Z04', 'BGM+Z06') }
    : kind === 'direction' ? { direction: 'outbound' } : { message_received_at: '2026-10-01T00:00:00Z' }
  const expected = kind === 'raw' ? 'immutable_ediel_payload_cannot_change'
    : kind === 'direction' ? 'immutable_ediel_received_context_cannot_change' : 'immutable_ediel_receipt_time_cannot_change'
  const { error } = await supabaseService.from('ediel_messages').update(patch).eq('id', f.sourceId)
  expect(error).toMatchObject({ code: '23514', message: expected })
  expect(sql(`SELECT to_jsonb(m) FROM public.ediel_messages m WHERE id=${literal(f.sourceId)}`)).toEqual(before)
  expect(state(f)).toMatchObject({ raw: f.wire, periods: [], effects: 0, partitions: 0, transitions: 0, normalConfirmations: 0, acks: [], outbox: [] })
  expect(state(f).companyPeriodCount).toBe(0)
  preserves(f)
}, 120000)

function holds(f: Awaited<ReturnType<typeof source>>) {
  assertSourceGuard(f)
  const result = state(f)
  expect(result).toMatchObject({ raw: f.wire, periods: [], effects: 0, partitions: 0, transitions: 0, normalConfirmations: 0 })
  assertOwnedAckOutputs(f, result)
  expect(result.companyPeriodCount).toBe(0)
  expect(result.acks.some(a => a.family === 'APERAK' && a.wire.includes('ERC+100'))).toBe(false)
  preserves(f)
}

it.each([
  { name: 'missing own required start field210', options: { omitStart: true }, field: '210' },
  { name: 'missing own required annual volume field213', options: { omitAnnualVolume: true }, field: '213' },
  { name: 'missing identity field250 activated by physical invoicee', options: { invoiceeIdentity: '' }, field: '250' },
  { name: 'missing own constant field214 required by physical259', options: { omitReadingField: '214' as const }, field: '214' },
  { name: 'missing own number of digits field218 required by physical259', options: { omitReadingField: '218' as const }, field: '218' },
])('actual adapter/processor holds $name without an invented dependency fact', async ({ options, field }) => {
  const f = await adapterSource(options)
  const { data, error } = await supabaseService.from('ediel_messages').select('*').eq('id', f.sourceId).single()
  expect(error).toBeNull()
  const decision = await resolveCanonicalRuntimeDecisionWithRegistry(data as EdielMessageRow)
  if (field === '214' || field === '218') {
    expect(decision.policy?.prodatDependentFacts?.registerObjects).toEqual([
      { meteringPointId: f.external, identityAgency: '9', meterReadingsSentInUtilts: true },
    ])
    const readings = decision.policy?.prodatDependentConditions.filter(condition => ['214', '218', '259'].includes(condition.fieldNumber))
    expect(readings).toHaveLength(3)
    expect(readings?.every(condition => condition.status === 'required')).toBe(true)
    expect(decision.issues.some(issue => issue.code === 'PRODAT_DEPENDENT_CONDITION_UNDETERMINED')).toBe(false)
  }
  await processWithDiagnostics(f)
  holds(f)
  expect(decision.issues.some(issue => issue.prodatDiagnostic?.kind === 'field' && issue.prodatDiagnostic.fieldNumber === field), JSON.stringify(decision.issues)).toBe(true)
  expect(decision.syntaxDecision).toBe('accepted')
  expect(decision.applicationDecision).not.toBe('accepted')
  const first = state(f)
  expect(first.acks.filter(ack => ack.family === 'CONTRL')).toHaveLength(1)
  expect(first.acks.some(a => a.family === 'APERAK' && /ERC\+(?:41|42)::260/.test(a.wire)
    && a.wire.includes(`RFF+LI:${f.reference}`) && a.wire.includes(`RFF+Z07:${f.external}`))).toBe(true)
  expect(first.acks.every(a => a.company === f.companyId && a.route === f.ackRoute && a.profile === f.ackProfile)).toBe(true)
  await processWithDiagnostics(f)
  expect(state(f)).toEqual(first)
  assertSourceGuard(f)
  assertOwnedAckOutputs(f, state(f))
}, 120000)

it('physically complete invoicee is accepted by the declared prospective-source control, without billing/customer mutation', async () => {
  // This public/profile INSERT remains narrower than actual adapter intake.
  // Its legacy FALSE hint is overridden by qualified physical259, not credited.
  await assertAssignedEffects(await source({ invoiceeIdentity: '199001011234' }))
}, 120000)

it('actual A source cannot borrow the archived ground start one minute away', async () => {
  const f = await adapterSource({ startOffsetMinutes: 1 })
  const actualStart = sql<string>(`SELECT to_jsonb(gridex_received_sources.permission_time_v1(
    gridex_received_sources.normal_switch_wire_v1(raw_payload)#>>'{objects,0,start}')) FROM public.ediel_messages WHERE id=${literal(f.sourceId)}`)
  expect(Date.parse(actualStart)).toBe(Date.parse(f.submission.startAt) + 60000)
  expect(sql(`SELECT to_jsonb(gridex_regulated_supply.ground_current_v1(${literal(f.authorized.groundId)},${literal(f.companyId)},${literal(f.pointId)},${literal(f.submission.startAt)}))`)).toBe(true)
  expect(sql(`SELECT to_jsonb(gridex_regulated_supply.ground_current_v1(${literal(f.authorized.groundId)},${literal(f.companyId)},${literal(f.pointId)},${literal(actualStart)}))`)).toBe(false)
  const own = await supabaseService.from('ediel_messages').select('*').eq('id', f.sourceId).eq('company_id', f.companyId).single()
  expect(own.error).toBeNull()
  expect(own.data).toMatchObject({ id: f.sourceId, company_id: f.companyId, direction: 'inbound' })
  const original = own.data as EdielMessageRow
  expect(await readSourceQualifiedProdatBilateralCapability(original)).toBeNull()
  const decision = await resolveCanonicalRuntimeDecisionWithRegistry(original)
  expect(decision.policy).toBeNull()
  expect(decision.syntaxDecision).toBe('accepted')
  expect(decision.applicationDecision).toBe('manual_review')
  expect(decision.issues).toContainEqual(expect.objectContaining({
    code: 'CANONICAL_POLICY_RESOLUTION_FAILED', description: 'prodat_bilateral_capability_required:Z04:A',
  }))
  const ruleReceipts = () => sql(`SELECT to_jsonb(count(*)) FROM gridex_ediel_source_rules.receipts
    WHERE company_id=${literal(f.companyId)} AND source_message_id=${literal(f.sourceId)}`)
  expect(ruleReceipts()).toBe(0)
  await processWithDiagnostics(f)
  holds(f)
  expect(ruleReceipts()).toBe(0)
  const { data, error } = await supabaseService.rpc('ediel_apply_supply_source_v1', {
    p_company_id: f.companyId, p_source_message_id: f.sourceId, p_actor_user_id: f.actorUserId,
  })
  // This source never obtained a bilateral policy or frozen rule receipt.
  // The public effect owner refuses at that exact earlier barrier; it cannot
  // reach a ground partition. Other errors and timeouts are not this refusal.
  expect(error).toMatchObject({ code: 'P0001', message: 'ediel_historical_rule_pack_basis_unavailable' })
  expect(data).toBeNull()
  expect(ruleReceipts()).toBe(0)
  holds(f)
  const first = state(f)
  await processWithDiagnostics(f)
  expect(state(f)).toEqual(first)
  expect(ruleReceipts()).toBe(0)
  holds(f)
}, 120000)

it('dated supplier role loss before actual source birth holds the original legal scope without removing user permission', async () => {
  const f = await adapterSource({ revokeSupplierRole: true })
  expect(sql(`SELECT to_jsonb(count(*)) FROM public.tenant_actor_roles WHERE company_id=${literal(f.companyId)} AND actor_id=${literal(f.actorUserId)} AND environment='test' AND role_code='electricity_supplier' AND (valid_to IS NULL OR clock_timestamp()<valid_to)`)).toBe(0)
  const scope = await readRegulatedSupplyGroundScope({ companyId: f.companyId, actorUserId: f.actorUserId, environment: 'test', kind: 'assigned_supply',
    contractId: f.contractId, meteringPointId: f.pointId, identityAgency: '9', bilateralAgreementId: f.agreement, startAt: f.submission.startAt })
  expect(scope).toMatchObject({ status: 'held', missing: ['actual_current_own_contract_point_legal_registry_and_bilateral_scope'] })
  await processWithDiagnostics(f)
  holds(f)
  const first = state(f)
  await processWithDiagnostics(f)
  expect(state(f)).toEqual(first)
  holds(f)
}, 120000)

it('real public outbound owner rejects supplier-originated physical A before any draft, outbox or source effects', async () => {
  const f = await ground()
  const raw = assignedWire({ ...f, sender: f.receiver, receiver: f.sender }, f.reference)
  const counts = () => sql(`SELECT jsonb_build_object(
    'messages',(SELECT count(*) FROM public.ediel_messages WHERE company_id=${literal(f.companyId)}),
    'outbox',(SELECT count(*) FROM public.ediel_outbox WHERE company_id=${literal(f.companyId)}),
    'periods',(SELECT count(*) FROM public.customer_supply_periods WHERE company_id=${literal(f.companyId)}),
    'effects',(SELECT count(*) FROM gridex_received_sources.supply_object_effect_receipts WHERE company_id=${literal(f.companyId)}),
    'partitions',(SELECT count(*) FROM gridex_received_sources.supply_object_partitions WHERE company_id=${literal(f.companyId)}),
    'transitions',(SELECT count(*) FROM gridex_received_sources.supply_source_transitions WHERE company_id=${literal(f.companyId)}))`)
  const before = counts()
  await expect(createCanonicalOutboundMessage({ actorUserId: f.actorUserId, requestType: 'supplier_switch', baseInput: {
    actorUserId: f.actorUserId, companyId: f.companyId, environment: 'test', direction: 'outbound', messageStandard: 'edifact',
    messageFamily: 'PRODAT', messageCode: 'Z04', messageVersion: 'E2SE6A', applicationReference: '23-DDQ-PRODAT', rawPayload: raw,
    senderEdielId: f.sender, receiverEdielId: f.receiver, communicationRouteId: f.routeId, routeProfileId: f.routeProfileId,
  } })).rejects.toThrow('canonical_source_direction_not_allowed:Z04:outbound:inbound')
  expect(counts()).toEqual(before)
  preserves(f)
}, 120000)

it('revoked separate reviewer permission holds current ground with no source effect or positive own APERAK', async () => {
  const f = await source()
  sql(`UPDATE public.user_permissions SET effect='deny' WHERE user_id=${literal(f.reviewer)} AND company_id=${literal(f.companyId)} AND permission_key='ediel.regulated_supply.review'`)
  expect(sql(`SELECT to_jsonb(gridex_regulated_supply.ground_current_v1(${literal(f.authorized.groundId)},${literal(f.companyId)},${literal(f.pointId)},${literal(f.submission.startAt)}))`)).toBe(false)
  await processInboundEdielMessage({ actorUserId: f.actorUserId, edielMessageId: f.sourceId })
  const result = state(f)
  assertSourceGuard(f)
  assertOwnedAckOutputs(f, result)
  expect(result).toMatchObject({ raw: f.wire, periods: [], effects: 0, transitions: 0, normalConfirmations: 0 })
  expect(result.companyPeriodCount).toBe(0)
  expect(result.acks.some(a => a.family === 'APERAK' && a.wire.includes('ERC+100'))).toBe(false)
  preserves(f)
  const first = state(f)
  await processWithDiagnostics(f)
  expect(state(f)).toEqual(first)
  holds(f)
}, 120000)

it('actual final partition failure rolls back assigned period/effect/audit before any positive own APERAK escapes', async () => {
  const f = await source(), constraint = `synthetic_assigned_partition_${randomUUID().replaceAll('-', '')}`
  sql(`ALTER TABLE gridex_received_sources.supply_object_partitions ADD CONSTRAINT ${constraint} CHECK(source_message_id<>${literal(f.sourceId)}::uuid) NOT VALID`)
  try {
    await processInboundEdielMessage({ actorUserId: f.actorUserId, edielMessageId: f.sourceId })
    const rollbacks = sql<{ reason: string }[]>(`SELECT coalesce(jsonb_agg(payload),'[]') FROM public.ediel_message_events
      WHERE ediel_message_id=${literal(f.sourceId)} AND payload->>'supplySourceApply'='rolled_back'`)
    expect(rollbacks).toHaveLength(1)
    expect(rollbacks[0].reason).toContain(constraint)
    const result = state(f)
    assertSourceGuard(f)
    assertOwnedAckOutputs(f, result)
    expect(result).toMatchObject({ raw: f.wire, periods: [], effects: 0, partitions: 0, transitions: 0, normalConfirmations: 0 })
    expect(result.companyPeriodCount).toBe(0)
    expect(result.acks.some(a => a.family === 'APERAK' && a.wire.includes('ERC+100'))).toBe(false)
    preserves(f)
  } finally { sql(`ALTER TABLE gridex_received_sources.supply_object_partitions DROP CONSTRAINT ${constraint}`) }
}, 120000)

it('actual unmatched A adapter accepts a physically complete invoicee without changing customer, contract or point', async () => {
  await assertAssignedEffects(await adapterSource({ invoiceeIdentity: '199001011234', withoutOwnZ03: true }))
}, 120000)
