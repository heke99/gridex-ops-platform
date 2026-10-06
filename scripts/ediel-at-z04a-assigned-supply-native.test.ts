// Bounded A-native feedback only: neither whole AT-Z04A nor AT-Z04D is tagged.
// Real archived/reviewed ground, mailbox, reception and source-effect producers.
// Issuer trust and SMTP configuration are explicitly synthetic, not legal or
// market acceptance. The retained ground fixture prepares an UNSENT Z03: this
// proves no usable sent correlation, not literal absence of every Z03 row.
import { randomUUID } from 'node:crypto'
import { afterEach, expect, it, vi } from 'vitest'
import { guideOrderedFixtureRaw } from '../__tests__/helpers/prodatGuideOrderedFixture'
import { characteristic, line, qty, type Parts } from '../__tests__/fixtures/prodat-register'
import { createRegulatedSupplyGroundNativeFixture } from './helpers/ediel-regulated-supply-ground-native-fixture'
import { nativeSql as sql, literal } from './helpers/ediel-normal-switch-native-fixture'
import { seedOriginalMailboxNative, recordOriginalMailboxNativeReception } from './helpers/originalMailboxNative'
import { archiveRegulatedSupplyGround, reviewRegulatedSupplyGround } from '@/lib/ediel/production/regulatedSupplyGroundIntake'
import { createInboundEdielMessage } from '@/lib/inbound-mail/inboundStatusUpdater'
import { resolveCanonicalRuntimeDecisionWithRegistry } from '@/lib/ediel/core/runtimeDecision'
import { processInboundEdielMessage } from '@/lib/ediel/flows/inboundProcessing'
import { assertEdielSmtpReadiness } from '@/lib/ediel/mailReadiness'
import { supabaseService } from '@/lib/supabase/service'
import type { EdielMessageRow } from '@/lib/ediel/types'

const provider = vi.hoisted(() => vi.fn())
vi.mock('nodemailer', () => ({ default: { createTransport: () => ({ sendMail: provider }) } }))
afterEach(() => { vi.unstubAllEnvs(); vi.restoreAllMocks() })
type Ground = Awaited<ReturnType<typeof createRegulatedSupplyGroundNativeFixture>>

function assignedWire(f: Ground, reference: string) {
  // Independent literal P26.A wire facts, not the production renderer. Field
  // 223 is Z26 and 210 is the archived ground's exact Swedish standard time.
  const start = new Date(Date.parse(f.submission.startAt) + 3600000).toISOString().slice(0, 16).replace(/[-T:]/g, '')
  const body: Parts[] = [
    ['NAD', 'FR', [f.receiver, '160', 'SVK'], '', '', '', '', '', '', 'SE'],
    ['NAD', 'DO', [f.sender, '160', 'SVK'], '', '', '', '', '', '', 'SE'],
    line('1', f.external, undefined, '9'), ['DTM', ['92', start, '203']], ['DTM', ['354', '15', '806']], qty('1000'),
    ...characteristic('Z13', 'Z26'), ...characteristic('Z04', 'Z03'), ...characteristic('Z07', 'E22'),
    ...characteristic('Z12', 'D', 3), ...characteristic('Z15', 'D'), ['CCI', '', 'Z14'], ['CAV', ['', '', '', 'L917', '8716867000030']],
    ['RFF', ['MG', `METER-${f.external}`]], ['RFF', ['Z05', f.gridAreaCode]], ['RFF', ['LI', reference]],
    ['NAD', 'UD', [f.customerIdentity.id, f.customerIdentity.qualifier, f.customerIdentity.agency], '', 'Synthetic Own Customer', 'Street', 'City', '', '12345', 'SE'],
    ['NAD', 'IT', [f.external, '', '9'], '', '', 'Street', 'Town', '', '12345', 'SE'],
    ['NAD', 'Z02', [f.sender, '160', 'SVK']],
  ]
  return guideOrderedFixtureRaw(body, 'Z04')
    .replace('+S+R+', `+${f.receiver}:14+${f.sender}:14+`)
    .replace("+23-DDQ-PRODAT'", "+23-DDQ-PRODAT++1++1'")
    .replace('+I++23-DDQ-PRODAT', `+${reference}++23-DDQ-PRODAT`).replace("UNZ+1+I'", `UNZ+1+${reference}'`)
    .replace('UNH+M+', `UNH+${reference}+`).replace(/UNT\+(\d+)\+M'/, `UNT+$1+${reference}'`)
    .replace('BGM+Z04+D+', `BGM+Z04+${reference}+`)
}

async function ground() {
  for (const [key, value] of Object.entries({ EDIEL_SHARED_MAILBOX_ADDRESS: 'synthetic@example.invalid', EDIEL_APP_DKIM_ENABLED: 'false',
    EDIEL_SMTP_FROM: 'synthetic@example.invalid', EDIEL_SMTP_USER: 'synthetic@example.invalid', EDIEL_SMTP_PASS: 'synthetic-only', EDIEL_EMAIL_PROVIDER: 'strato' })) vi.stubEnv(key, value)
  provider.mockReset()
  const f = await createRegulatedSupplyGroundNativeFixture()
  const artifact = await archiveRegulatedSupplyGround({ companyId: f.companyId, actorUserId: f.actorUserId, ...f.signed() })
  const authorized = await reviewRegulatedSupplyGround({ companyId: f.companyId, actorUserId: f.reviewer,
    artifactId: String(artifact.artifactId), sourceHash: String(artifact.sourceHash), scopeHash: String(artifact.scopeHash),
    decision: 'approve', reason: 'Separate synthetic assigned-supply native review' })
  expect(authorized.status, JSON.stringify(authorized)).toBe('authorized')
  expect(sql(`SELECT to_jsonb(gridex_received_sources.sent_source_is_current_v1(m)) FROM public.ediel_messages m WHERE id=${literal(f.originalZ03.id)}`)).toBe(false)
  expect(provider).not.toHaveBeenCalled()
  const reference = `A${randomUUID().replaceAll('-', '').slice(0, 12).toUpperCase()}`
  expect(reference).not.toBe(f.caseReference)
  const wire = assignedWire(f, reference), smtp = assertEdielSmtpReadiness(), receivedAt = new Date().toISOString()
  const mail = await seedOriginalMailboxNative(sql, literal, { companyId: f.companyId, environment: 'test', raw: wire, receivedAt, smtpFrom: smtp.from })
  return { ...f, authorized, reference, wire, mail, smtp, receivedAt,
    beforeSwitch: sql(`SELECT to_jsonb(s) FROM public.supplier_switch_requests s WHERE id=${literal(f.switchId)}`),
    beforeContract: sql(`SELECT to_jsonb(c) FROM public.customer_contracts c WHERE id=${literal(f.contractId)}`),
    beforeCustomer: sql(`SELECT to_jsonb(c) FROM public.customers c WHERE id=${literal(f.customerId)}`) }
}

async function source() {
  const f = await ground(), sourceId = randomUUID(), ackRoute = randomUUID(), ackProfile = randomUUID()
  // Explicit narrower source path: prospective public INSERT chooses the real
  // canonical A profile. Private source/context/reception/validation/effects
  // are never seeded or patched. This does not qualify the mail adapter below.
  sql(`INSERT INTO public.communication_routes(id,company_id,route_name,route_scope,grid_owner_id,environment_type,is_active,target_email)
    VALUES(${literal(ackRoute)},${literal(f.companyId)},'Synthetic assigned ACK route','ediel_ack',${literal(f.gridId)},'bilateral_test',true,'recipient@example.invalid');
    INSERT INTO public.ediel_route_profiles(id,company_id,communication_route_id,route_name,environment,message_standard,payload_format,sender_ediel_id,receiver_ediel_id,application_reference,is_enabled,is_active,transport_security_mode,mailbox,smtp_host,smtp_port,smtp_to,receiver_email)
    VALUES(${literal(ackProfile)},${literal(f.companyId)},${literal(ackRoute)},'Synthetic assigned ACK profile','test','edifact','edifact',${literal(f.sender)},${literal(f.receiver)},'23-DDQ-PRODAT',true,true,'unencrypted',${literal(f.smtp.from)},${literal(f.smtp.host)},${f.smtp.port},'recipient@example.invalid','recipient@example.invalid');
    INSERT INTO public.ediel_messages(id,company_id,environment,direction,message_standard,message_family,message_code,status,raw_payload,parsed_payload,message_received_at,application_reference,sender_ediel_id,receiver_ediel_id,interchange_reference,inbound_email_message_id,mailbox_message_id,canonical_rule_pack_id,rule_profile_key,rule_profile_version_id,rule_profile_version,rule_pack_checksum,rule_pack_snapshot)
    SELECT ${literal(sourceId)},${literal(f.companyId)},'test','inbound','edifact','PRODAT','Z04','received',${literal(f.wire)},${literal({ ...f.mail.parsed, prodatDependentFacts: { market: 'electricity', meterReadingsSentInUtilts: false } })}::jsonb,
      ${literal(f.receivedAt)}::timestamptz,'23-DDQ-PRODAT',${literal(f.receiver)},${literal(f.sender)},${literal(f.mail.parsed.interchangeReference)},${literal(f.mail.inboundEmailMessageId)},${literal(f.mail.inboundEmailMessageId)},pack.id,profile.profile_key,profile.id,pack.guide_version||':r'||pack.guide_revision,pack.source_hash,profile.profile
    FROM public.ediel_message_profiles profile JOIN public.ediel_rule_packs pack ON pack.id=profile.rule_pack_id WHERE profile.profile_key='PRODAT:Z04:A:26.A:r3' AND profile.is_enabled;`)
  await recordOriginalMailboxNativeReception({ ...f.mail, companyId: f.companyId, sourceMessageId: sourceId, actorUserId: f.actorUserId })
  const { data, error } = await supabaseService.from('ediel_messages').select('*').eq('id', sourceId).single()
  expect(error).toBeNull()
  const decision = await resolveCanonicalRuntimeDecisionWithRegistry(data as EdielMessageRow)
  expect([decision.syntaxDecision, decision.applicationDecision, decision.functionalDecision], JSON.stringify(decision.issues)).toEqual(['accepted', 'accepted', 'accepted'])
  return { ...f, sourceId, ackRoute, ackProfile }
}

function state(f: Awaited<ReturnType<typeof source>>) {
  return sql<{ raw: string; periods: { customer: string; point: string; process: string; date: string; start: string; status: string; ground: string }[];
    effects: number; partitions: number; transitions: number; normalConfirmations: number;
    acks: { id: string; family: string; wire: string; company: string; route: string; profile: string }[];
    outbox: { message: string; company: string; source: string; status: string; hash: string }[] }>(`SELECT jsonb_build_object(
    'raw',(SELECT raw_payload FROM public.ediel_messages WHERE id=${literal(f.sourceId)}),
    'periods',(SELECT coalesce(jsonb_agg(jsonb_build_object('customer',customer_id,'point',metering_point_id,'process',source_process,'date',start_date,'start',market_start_at,'status',status,'ground',metadata->>'sourceGroundId')),'[]') FROM public.customer_supply_periods WHERE source_message_id=${literal(f.sourceId)}),
    'effects',(SELECT count(*) FROM gridex_received_sources.supply_object_effect_receipts WHERE source_message_id=${literal(f.sourceId)}),
    'partitions',(SELECT count(*) FROM gridex_received_sources.supply_object_partitions WHERE source_message_id=${literal(f.sourceId)}),
    'transitions',(SELECT count(*) FROM gridex_received_sources.supply_source_transitions WHERE source_message_id=${literal(f.sourceId)}),
    'normalConfirmations',(SELECT count(*) FROM gridex_received_sources.normal_switch_confirmations WHERE source_message_id=${literal(f.sourceId)}),
    'acks',(SELECT coalesce(jsonb_agg(jsonb_build_object('id',id,'family',message_family,'wire',raw_payload,'company',company_id,'route',communication_route_id,'profile',route_profile_id) ORDER BY message_family),'[]') FROM public.ediel_messages WHERE related_message_id=${literal(f.sourceId)}),
    'outbox',(SELECT coalesce(jsonb_agg(jsonb_build_object('message',ediel_message_id,'company',company_id,'source',source_message_id,'status',status,'hash',immutable_payload_hash) ORDER BY ediel_message_id),'[]') FROM public.ediel_outbox WHERE source_message_id=${literal(f.sourceId)}))`)
}
function preserves(f: Awaited<ReturnType<typeof ground>>) {
  expect(sql(`SELECT to_jsonb(s) FROM public.supplier_switch_requests s WHERE id=${literal(f.switchId)}`)).toEqual(f.beforeSwitch)
  expect(sql(`SELECT to_jsonb(c) FROM public.customer_contracts c WHERE id=${literal(f.contractId)}`)).toEqual(f.beforeContract)
  expect(sql(`SELECT to_jsonb(c) FROM public.customers c WHERE id=${literal(f.customerId)}`)).toEqual(f.beforeCustomer)
  expect(sql(`SELECT to_jsonb(gridex_received_sources.sent_source_is_current_v1(m)) FROM public.ediel_messages m WHERE id=${literal(f.originalZ03.id)}`)).toBe(false)
  expect(provider).not.toHaveBeenCalled()
}

it('actual unmatched mail adapter must admit physical A with genuine custody and no own sent Z03', async () => {
  const f = await ground()
  const id = await createInboundEdielMessage({ companyId: f.companyId, actorUserId: f.actorUserId, environment: 'test',
    inboundEmailMessageId: f.mail.inboundEmailMessageId, parseResultId: f.mail.parseResultId, parsed: f.mail.parsed,
    meteringPointMatch: { status: 'matched', entityType: 'metering_point', entityId: f.pointId, confidence: 1, reasons: ['Synthetic exact own physical point'],
      candidates: [{ customer_id: f.customerId, site_id: f.siteId, grid_owner_id: f.gridId }] } })
  preserves(f)
  // A failed canonical birth must never be reported as successful acceptance.
  const profiles = sql(`SELECT coalesce(jsonb_agg(profile_key ORDER BY profile_key),'[]') FROM public.ediel_message_profiles WHERE profile->>'family'='PRODAT' AND message_code='Z04' AND direction IN('inbound','both') AND is_enabled`)
  expect(id, JSON.stringify({ seam: 'actual_createInboundEdielMessage', profiles })).toMatch(/^[0-9a-f-]{36}$/)
  const row = sql<{ raw: string; mail: string; mailbox: string; profile: string }>(`SELECT jsonb_build_object('raw',raw_payload,'mail',inbound_email_message_id,'mailbox',mailbox_message_id,'profile',rule_profile_key) FROM public.ediel_messages WHERE id=${literal(id)}`)
  expect(row).toEqual({ raw: f.wire, mail: f.mail.inboundEmailMessageId, mailbox: f.mail.inboundEmailMessageId, profile: 'PRODAT:Z04:A:26.A:r3' })
}, 120000)

it('approved ground and genuine reception commit assigned start, own effects and routed ACKs, retry-stable without normal switch activation', async () => {
  const f = await source(), input = { actorUserId: f.actorUserId, edielMessageId: f.sourceId }
  await processInboundEdielMessage(input)
  const first = state(f)
  expect(first).toMatchObject({ raw: f.wire, effects: 1, partitions: 1, transitions: 1, normalConfirmations: 0 })
  expect(first.periods).toHaveLength(1)
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
  preserves(f)
}, 120000)

it('revoked separate reviewer permission holds current ground with no source effect or positive own APERAK', async () => {
  const f = await source()
  sql(`UPDATE public.user_permissions SET effect='deny' WHERE user_id=${literal(f.reviewer)} AND company_id=${literal(f.companyId)} AND permission_key='ediel.regulated_supply.review'`)
  expect(sql(`SELECT to_jsonb(gridex_regulated_supply.ground_current_v1(${literal(f.authorized.groundId)},${literal(f.companyId)},${literal(f.pointId)},${literal(f.submission.startAt)}))`)).toBe(false)
  await processInboundEdielMessage({ actorUserId: f.actorUserId, edielMessageId: f.sourceId })
  const result = state(f)
  expect(result).toMatchObject({ raw: f.wire, periods: [], effects: 0, transitions: 0, normalConfirmations: 0 })
  expect(result.acks.some(a => a.family === 'APERAK' && a.wire.includes('ERC+100'))).toBe(false)
  preserves(f)
}, 120000)

it('actual final partition failure rolls back assigned period/effect/audit before any positive own APERAK escapes', async () => {
  const f = await source(), constraint = `synthetic_assigned_partition_${randomUUID().replaceAll('-', '')}`
  sql(`ALTER TABLE gridex_received_sources.supply_object_partitions ADD CONSTRAINT ${constraint} CHECK(source_message_id<>${literal(f.sourceId)}::uuid) NOT VALID`)
  try {
    await processInboundEdielMessage({ actorUserId: f.actorUserId, edielMessageId: f.sourceId })
    const result = state(f)
    expect(result).toMatchObject({ raw: f.wire, periods: [], effects: 0, partitions: 0, transitions: 0, normalConfirmations: 0 })
    expect(result.acks.some(a => a.family === 'APERAK' && a.wire.includes('ERC+100'))).toBe(false)
    preserves(f)
  } finally { sql(`ALTER TABLE gridex_received_sources.supply_object_partitions DROP CONSTRAINT ${constraint}`) }
}, 120000)
