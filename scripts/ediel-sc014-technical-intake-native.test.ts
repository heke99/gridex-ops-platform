// Prospective SC014 native component qualification; no approval tag. Actual
// PostgreSQL/full installed trigger graph, PostgREST service sessions and local
// GoTrue actors. Public endpoint/route/configuration and fetched MIME are
// SYNTHETIC transport fixtures. No external delivery, legal mandate or business
// verdict is supplied; no private birth/ACK/source authority is seeded.
import { createClient } from '@supabase/supabase-js'
import { createHash, randomUUID } from 'node:crypto'
import { spawn } from 'node:child_process'
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'
import { supabaseService } from '@/lib/supabase/service'
import { storeMailboxFetchMessage } from '@/lib/inbound-mail/edielMailboxPoller.part-2'
import { processInboundEmailMessage } from '@/lib/inbound-mail/edielInboundProcessor'
import { createParseResult } from '@/lib/inbound-mail/inboundStatusUpdater'
import { parseEdifactPayload } from '@/lib/inbound-mail/edielEmailParser'
import { processInboundEdielMessage } from '@/lib/ediel/flows/inboundProcessing'
import { resolveInboundTenantFromIdentifiers } from '@/lib/ediel/tenant/resolveInboundTenant'
import { validateEdifactSyntax } from '@/lib/ediel/core/syntaxValidator'
import { readPersistedEdielTechnicalContrlBasis } from '@/lib/ediel/ack/technicalSyntaxAuthority'
import type { EdielMessageRow } from '@/lib/ediel/types'
import type { EdielMailboxRow } from '@/lib/inbound-mail/edielMailboxPoller.part-1'
import { decisionNativeSql as sql, decisionUser, literal } from './helpers/ediel-decision-original-native-fixture'
import { ownerSource } from '../__tests__/helpers/sourceOwnerFixtures'

const attemptedDelivery = vi.hoisted(() => vi.fn(async () => { throw Error('SC014_native_external_delivery_forbidden') }))
vi.mock('nodemailer', () => ({ default: { createTransport: () => ({ sendMail: attemptedDelivery }) } }))
const digest = (value: string) => createHash('sha256').update(value, 'utf8').digest('hex')
type Json = Record<string, unknown>
type IntakeReceipt = {
  kind: 'unattributed_technical_intake'; version: 1; disposition: 'technical_only_unattributed'
  sourceMessageId: string; inboundEmailMessageId: string; parseResultId: string
  companyId: null; resolvedCompanyId: null; technicalCompanyId: string
  environment: 'production'; sourcePayloadHash: string; receivedAt: string
  executionActorUserId: string; authorizesBusinessEffect: false
}
const admitName = 'ediel_admit_unattributed_technical_source_v1'
const readName = 'ediel_read_unattributed_technical_intake_v1'
const privateTables = ['raw_births', 'attachment_births', 'parse_births', 'technical_births', 'physical_claims']

beforeAll(() => {
  const installation = sql<{ admission: boolean; reader: boolean; inserts: number; disabled: number }>(`SELECT jsonb_build_object(
    'admission',to_regprocedure('public.${admitName}(uuid,uuid,uuid,text,text)') IS NOT NULL,
    'reader',to_regprocedure('public.${readName}(uuid,uuid,uuid)') IS NOT NULL,
    'inserts',(SELECT count(*) FROM pg_trigger WHERE tgrelid='public.ediel_messages'::regclass AND NOT tgisinternal AND (tgtype & 4)=4),
    'disabled',(SELECT count(*) FROM pg_trigger WHERE tgrelid='public.ediel_messages'::regclass AND NOT tgisinternal AND tgenabled='D'))`)
  expect(installation).toMatchObject({ admission: true, reader: true, disabled: 0 })
  expect(installation.inserts).toBeGreaterThanOrEqual(48)
})
beforeEach(() => {
  attemptedDelivery.mockClear()
  for (const [key, value] of Object.entries({ EDIEL_EMAIL_PROVIDER: 'strato', EMAIL_PROVIDER: 'resend', EDIEL_SMTP_FROM: 'configured@example.invalid',
    EDIEL_SMTP_HOST: 'smtp.example.invalid', EDIEL_SMTP_PORT: '465', EDIEL_SMTP_USER: 'synthetic-local-only', EDIEL_SMTP_PASS: 'synthetic-not-a-credential' })) vi.stubEnv(key, value)
})
afterEach(() => { expect(attemptedDelivery).not.toHaveBeenCalled(); vi.unstubAllEnvs() })

async function fixture(options: { platformTransport?: boolean } = {}) {
  const companyId = randomUUID(), foreignCompanyId = randomUUID(), mailboxId = randomUUID(), routeId = randomUUID(), profileId = randomUUID()
  sql(`INSERT INTO public.companies(id,name,status) VALUES(${literal(companyId)},'SYNTHETIC SC014 technical tenant','active'),
    (${literal(foreignCompanyId)},'SYNTHETIC SC014 foreign tenant','active')`)
  const actor = await decisionUser(companyId, ['communication.write'], randomUUID() + 'Aa1!')
  sql(`INSERT INTO public.user_permission_overrides(company_id,user_id,permission_key,effect,is_active,valid_from,reason)
    SELECT ${literal(companyId)},${literal(actor.id)},permission,'deny',true,clock_timestamp()-interval '1 day','SYNTHETIC SC014 WRITE-only native control'
    FROM unnest(ARRAY['communication.read','communication.send'])permission`)
  expect(sql(`SELECT jsonb_build_object('write',public.gridex_actor_has_company_permission(${literal(actor.id)},${literal(companyId)},'communication.write'),
    'read',public.gridex_actor_has_company_permission(${literal(actor.id)},${literal(companyId)},'communication.read'),
    'send',public.gridex_actor_has_company_permission(${literal(actor.id)},${literal(companyId)},'communication.send'))`)).toEqual({ write: true, read: false, send: false })
  const transportActorId = options.platformTransport ? randomUUID() : actor.id
  if (options.platformTransport) sql(`INSERT INTO public.platform_market_actors(id,name,source)
    VALUES(${literal(transportActorId)},'SYNTHETIC initial SC014 transport agent','manual')`)
  const allocation = options.platformTransport
    ? `INSERT INTO public.platform_actor_identifiers(actor_id,identifier_type,identifier_value,source,valid_from)
       SELECT ${literal(transportActorId)},'EdielId',value,'manual',clock_timestamp()-interval '1 day' FROM available RETURNING identifier_value`
    : `INSERT INTO public.tenant_actor_identifiers(company_id,environment,actor_id,identifier_type,identifier_value,valid_from)
       SELECT ${literal(companyId)},'production',${literal(actor.id)},'EdielId',value,clock_timestamp()-interval '1 day' FROM available RETURNING identifier_value`
  // Allocate fixture transport identifiers against the actual local namespace.
  const receiver = sql<string>(`BEGIN;SELECT pg_advisory_xact_lock(214014);
    WITH available AS(SELECT n::text value FROM generate_series(50000,59999)n
      WHERE NOT EXISTS(SELECT FROM public.tenant_actor_identifiers WHERE identifier_type='EdielId' AND identifier_value=n::text)
       AND NOT EXISTS(SELECT FROM public.platform_actor_identifiers WHERE identifier_type='EdielId' AND identifier_value=n::text)
       AND NOT EXISTS(SELECT FROM public.tenant_actor_identifiers WHERE identifier_type='EdielId' AND identifier_value=(n+10000)::text)
       AND NOT EXISTS(SELECT FROM public.platform_actor_identifiers WHERE identifier_type='EdielId' AND identifier_value=(n+10000)::text)
      ORDER BY n LIMIT 1), allocated AS(${allocation})
    SELECT to_jsonb(identifier_value) FROM allocated;COMMIT;`)
  expect(receiver).toMatch(/^5\d{4}$/)
  if (options.platformTransport) sql(`INSERT INTO public.tenant_counterparty_relations(company_id,environment,counterparty_actor_id,relation_type,is_enabled,valid_from)
    VALUES(${literal(companyId)},'production',${literal(transportActorId)},'ediel_transport_agent',true,clock_timestamp()-interval '1 day')`)
  const legalReceiver = String(60000 + Number(receiver) - 50000)
  const interchange = randomUUID().replaceAll('-', '').slice(0, 14)
  const wire = ownerSource().raw_payload!.replace('+12345:14+54321:14+', `+12345:14+${receiver}:14+`)
    .replace('NAD+DO+54321:160:SVK', `NAD+DO+${legalReceiver}:160:SVK`)
    .replace(/UNB[^']*'/, segment => { const elements = segment.slice(0, -1).split('+'); elements[5] = interchange; return elements.join('+') + "'" })
    .replace(/UNZ\+1\+[^']*'/, `UNZ+1+${interchange}'`)
  const parsed = parseEdifactPayload(wire)
  expect(parsed).toMatchObject({ rawPayload: wire, receiverEdielId: receiver, interchangeReference: interchange, messageFamily: 'PRODAT' })
  sql(`INSERT INTO public.ediel_mailboxes(id,company_id,environment,mailbox_name,email_address,mailbox_type,is_active,is_shared_platform_mailbox)
    VALUES(${literal(mailboxId)},${literal(companyId)},'production','SYNTHETIC SC014 retained mailbox','configured@example.invalid','tenant',true,false);
    INSERT INTO public.communication_routes(id,company_id,route_name,route_scope,environment_type,target_email,is_active)
    VALUES(${literal(routeId)},${literal(companyId)},'SYNTHETIC SC014 current CONTRL route','ediel_ack','production','sender@example.invalid',true);
    INSERT INTO public.ediel_route_profiles(id,company_id,communication_route_id,environment,is_active,is_enabled,message_family,business_code,
      sender_ediel_id,receiver_ediel_id,application_reference,mailbox,smtp_host,smtp_port)
    VALUES(${literal(profileId)},${literal(companyId)},${literal(routeId)},'production',true,true,'CONTRL','CONTRL',${literal(receiver)},'12345',
      '23-DDQ-PRODAT','configured@example.invalid','smtp.example.invalid',465)`)
  const mailbox = sql<EdielMailboxRow>(`SELECT to_jsonb(m) FROM public.ediel_mailboxes m WHERE id=${literal(mailboxId)}`)
  const receivedAt = new Date().toISOString()
  const mime = (raw: string, messageId = randomUUID()) => `From: sender@example.invalid\r\nTo: configured@example.invalid\r\nMessage-ID: <${messageId}@example.invalid>\r\nContent-Type: application/edifact\r\n\r\n${raw}`
  const store = async (raw = wire, attached = false) => {
    const rawMime = attached
      ? `From: sender@example.invalid\r\nTo: configured@example.invalid\r\nMessage-ID: <${randomUUID()}@example.invalid>\r\nMIME-Version: 1.0\r\nContent-Type: multipart/mixed; boundary="sc014-plain"\r\n\r\n--sc014-plain\r\nContent-Type: text/plain\r\n\r\nSynthetic original attached below.\r\n--sc014-plain\r\nContent-Type: application/edifact\r\nContent-Disposition: attachment; filename="source.edi"\r\n\r\n${raw}\r\n--sc014-plain--\r\n`
      : mime(raw)
    const stored = await storeMailboxFetchMessage({ mailbox, actorUserId: actor.id, message: { source: Buffer.from(rawMime), internalDate: new Date(receivedAt) } })
    expect(stored.deduped).toBe(false)
    return { mailId: stored.id, rawMime, raw }
  }
  const parameters = (mailId: string, parseId: string, actorId: string | null = actor.id, raw = wire) => ({
    p_inbound_email_message_id: mailId, p_parse_result_id: parseId, p_actor_user_id: actorId,
    p_expected_payload_hash: digest(raw), p_expected_environment: 'production',
  })
  const prepare = async (raw = wire) => {
    const stored = await store(raw)
    const parseId = await createParseResult({ inboundEmailMessageId: stored.mailId, companyId: null, parsed: parseEdifactPayload(raw) })
    return { ...stored, parseId }
  }
  const read = (mailId: string | null, sourceId: string | null, actorId: string | null = actor.id) => supabaseService.rpc(readName, {
    p_inbound_email_message_id: mailId, p_source_message_id: sourceId, p_actor_user_id: actorId,
  })
  return { companyId, foreignCompanyId, mailboxId, routeId, profileId, actor, receiver, legalReceiver, wire, receivedAt, store, prepare, parameters, read }
}
type Fixture = Awaited<ReturnType<typeof fixture>>
// Exempt only the real technical queue entry bound to BOTH installed private
// creation custody and protected source birth. Its full row is asserted below.
const legitimateTechnicalOutbox = `EXISTS(SELECT FROM public.ediel_messages ack
  JOIN gridex_unattributed_intake.technical_births birth ON birth.source_message_id=ack.related_message_id
  JOIN gridex_ediel_ack_replay.creation_receipts receipt ON receipt.ack_message_id=ack.id AND receipt.source_message_id=birth.source_message_id
  WHERE ack.id=t.ediel_message_id AND ack.company_id=t.company_id AND ack.environment=t.environment
   AND ack.message_family='CONTRL' AND t.message_family='CONTRL' AND t.source_message_id=birth.source_message_id
   AND receipt.company_id=t.company_id AND receipt.environment=t.environment AND receipt.family='CONTRL' AND receipt.outcome=t.ack_outcome)`
const legitimateHeldAckContext = `EXISTS(SELECT FROM public.ediel_messages ack
  JOIN gridex_unattributed_intake.technical_births birth ON birth.source_message_id=ack.related_message_id
  JOIN gridex_ediel_ack_replay.creation_receipts receipt ON receipt.ack_message_id=ack.id AND receipt.source_message_id=birth.source_message_id
  WHERE t.source_message_id=ack.id AND ack.message_family='CONTRL' AND ack.company_id=t.company_id AND ack.environment=t.environment
   AND receipt.company_id=t.company_id AND receipt.environment=t.environment AND receipt.family='CONTRL' AND receipt.ack_payload_hash=t.payload_sha256
   AND t.direction='outbound' AND t.status='held' AND t.context='{}'::jsonb AND t.reason='ediel_historical_identity_basis_unavailable')`

// Full rows, not just counts, for every actual company-scoped public/gridex
// relation outside the narrowly expected transport/ACK diagnostics. This also
// preserves current actor grants, foreign tenant rows, domain state and outbox.
function businessSnapshot(f: Fixture): Json {
  return sql<Json>(`CREATE TEMP TABLE sc014_snapshot(key text PRIMARY KEY,value jsonb);
    DO $snapshot$ DECLARE r record;rows jsonb;extra text; BEGIN FOR r IN
      SELECT n.nspname,c.relname FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace
      WHERE c.relkind IN('r','p') AND (n.nspname='public' OR starts_with(n.nspname,'gridex_'))
       AND EXISTS(SELECT FROM pg_attribute a WHERE a.attrelid=c.oid AND a.attname='company_id' AND NOT a.attisdropped)
       AND n.nspname NOT IN('gridex_ediel_technical_ack','gridex_ediel_wire_namespace','gridex_unattributed_intake')
       AND NOT starts_with(n.nspname,'gridex_ediel_ack_')
       AND NOT(n.nspname='public' AND c.relname IN('ediel_messages','ediel_message_events','inbound_email_messages',
         'inbound_email_attachments','inbound_ediel_parse_results','inbound_ediel_match_attempts','inbound_processing_jobs')) ORDER BY n.nspname,c.relname
      LOOP extra:=CASE WHEN r.nspname='public' AND r.relname='ediel_outbox' THEN ${literal(' AND NOT ' + legitimateTechnicalOutbox)}
        WHEN r.nspname='gridex_ediel_inbound_context' AND r.relname='receipts' THEN ${literal(' AND NOT ' + legitimateHeldAckContext)} ELSE '' END;
       EXECUTE format('SELECT coalesce(jsonb_agg(to_jsonb(t) ORDER BY to_jsonb(t)::text),''[]''::jsonb)
        FROM %I.%I t WHERE t.company_id=ANY($1)%s',r.nspname,r.relname,extra) INTO rows
        USING ARRAY[${literal(f.companyId)}::uuid,${literal(f.foreignCompanyId)}::uuid];
       INSERT INTO sc014_snapshot VALUES(r.nspname||'.'||r.relname,rows); END LOOP;END $snapshot$;
    INSERT INTO sc014_snapshot SELECT 'public.current_actor_profiles',coalesce(jsonb_agg(to_jsonb(p) ORDER BY p.id),'[]') FROM public.user_profiles p
      WHERE p.id IN(SELECT user_id FROM public.company_memberships WHERE company_id=ANY(ARRAY[${literal(f.companyId)}::uuid,${literal(f.foreignCompanyId)}::uuid]));
    SELECT coalesce(jsonb_object_agg(key,value),'{}') FROM sc014_snapshot;`)
}
function custodySnapshot(mailId: string): Json {
  return sql<Json>(`SELECT jsonb_build_object(
    'raw',(SELECT to_jsonb(r) FROM gridex_unattributed_intake.raw_births r WHERE inbound_email_message_id=${literal(mailId)}),
    'attachments',(SELECT coalesce(jsonb_agg(to_jsonb(r) ORDER BY attachment_id),'[]') FROM gridex_unattributed_intake.attachment_births r WHERE inbound_email_message_id=${literal(mailId)}),
    'parses',(SELECT coalesce(jsonb_agg(to_jsonb(r) ORDER BY parse_result_id),'[]') FROM gridex_unattributed_intake.parse_births r WHERE inbound_email_message_id=${literal(mailId)}),
    'birth',(SELECT to_jsonb(r) FROM gridex_unattributed_intake.technical_births r WHERE inbound_email_message_id=${literal(mailId)}),
    'originalHeldContext',(SELECT to_jsonb(r) FROM gridex_ediel_inbound_context.receipts r
      JOIN gridex_unattributed_intake.technical_births b ON b.source_message_id=r.source_message_id WHERE b.inbound_email_message_id=${literal(mailId)}),
    'physicalClaims',(SELECT coalesce(jsonb_agg(to_jsonb(c) ORDER BY physical_key),'[]') FROM gridex_unattributed_intake.physical_claims c
      JOIN gridex_unattributed_intake.technical_births b ON b.source_message_id=c.protected_source_id WHERE b.inbound_email_message_id=${literal(mailId)}),
    'sources',(SELECT coalesce(jsonb_agg(to_jsonb(m) ORDER BY id),'[]') FROM public.ediel_messages m WHERE inbound_email_message_id=${literal(mailId)}))`)
}
// The actual SQL row also contains this custody field; the application row
// type intentionally does not expose it as application authority.
type NativeSourceRow = EdielMessageRow & { immutable_payload_hash: string | null }
function sourceRow(id: string) { return sql<NativeSourceRow>(`SELECT to_jsonb(m) FROM public.ediel_messages m WHERE id=${literal(id)}`) }
function repeatableReadSession() {
  if (process.env.NEXT_PUBLIC_SUPABASE_URL !== 'http://127.0.0.1:54321') throw Error('SC014_owned_local_session_required')
  const child = spawn('psql', ['postgresql://postgres:postgres@127.0.0.1:54322/postgres', '-XAtq', '-v', 'ON_ERROR_STOP=1', '-v', 'VERBOSITY=verbose'],
    { stdio: ['pipe', 'pipe', 'pipe'], timeout: 30_000 })
  let output = '', errors = ''
  child.stdout.on('data', chunk => { output += String(chunk) }); child.stderr.on('data', chunk => { errors += String(chunk) })
  const done = new Promise<{ code: number | null; output: string; errors: string }>((resolve, reject) => {
    child.on('error', reject); child.on('close', code => resolve({ code, output, errors }))
  })
  // A failed assertion must also close this real transaction/session.
  done.catch(() => undefined)
  const send = (statement: string) => child.stdin.write(statement + '\n')
  const finish = (statement: string) => child.stdin.end(statement + '\nROLLBACK;\n')
  const marker = async (value: string) => {
    for (let i = 0; i < 250 && !output.includes(value) && child.exitCode === null; i++) await new Promise(resolve => setTimeout(resolve, 20))
    expect(output, errors).toContain(value)
  }
  const close = async () => {
    if (child.exitCode === null && !child.killed) { child.stdin.end('ROLLBACK;\n'); child.kill('SIGTERM') }
    await done
  }
  return { send, finish, marker, done, close }
}
function ordinaryInsert(f: Fixture, id: string, companyId = f.foreignCompanyId) {
  // Actual ordinary known-company INSERT, without supplied private authority.
  return `INSERT INTO public.ediel_messages(id,company_id,environment,direction,message_standard,message_family,message_code,status,raw_payload,message_received_at,
    canonical_rule_pack_id,rule_profile_key,rule_profile_version_id,rule_profile_version,rule_pack_checksum,rule_pack_snapshot)
    SELECT ${literal(id)},${literal(companyId)},'production','inbound','edifact','PRODAT','Z04','received',${literal(f.wire)},clock_timestamp(),
      pack.id,profile.profile_key,profile.id,pack.guide_version||':r'||pack.guide_revision,pack.source_hash,profile.profile
    FROM public.ediel_message_profiles profile JOIN public.ediel_rule_packs pack ON pack.id=profile.rule_pack_id
    WHERE profile.profile_key='PRODAT:Z04:L:26.A:r3' AND profile.is_enabled AND pack.status IN('active','future')
      AND pack.valid_from<=current_date AND(pack.valid_to IS NULL OR pack.valid_to>=current_date);`
}
function technicalOutboxRows(sourceId: string) {
  return sql<Json[]>(`SELECT coalesce(jsonb_agg(to_jsonb(t) ORDER BY id),'[]') FROM public.ediel_outbox t WHERE source_message_id=${literal(sourceId)}`)
}
function technicalHeldAckRows(sourceId: string) {
  return sql<Json[]>(`SELECT coalesce(jsonb_agg(to_jsonb(t) ORDER BY t.source_message_id),'[]') FROM gridex_ediel_inbound_context.receipts t
    JOIN public.ediel_messages ack ON ack.id=t.source_message_id WHERE ack.related_message_id=${literal(sourceId)}`)
}
function assertTechnicalQueue(sourceId: string, ackId: string, f: Fixture) {
  expect(technicalOutboxRows(sourceId)).toEqual([expect.objectContaining({ source_message_id: sourceId, ediel_message_id: ackId,
    company_id: f.companyId, environment: 'production', status: 'queued', message_family: 'CONTRL', message_code: 'CONTRL',
    ack_outcome: 'positive', attempts: 0, send_attempt_count: 0, sent_at: null, intent_id: null,
    current_send_attempt_id: null, operation_decision_snapshot: null })])
  expect(sql(`SELECT to_jsonb(count(*)) FROM public.ediel_outbox t WHERE source_message_id=${literal(sourceId)} AND ${legitimateTechnicalOutbox}`)).toBe(1)
  // The installed generic context INSERT owner records a negative custody
  // receipt for the outbound ACK; it cannot grant legal/business authority.
  const held = technicalHeldAckRows(sourceId)
  expect(held).toHaveLength(1); expect(held[0].observed_at).toEqual(expect.any(String))
  expect(Number.isFinite(Date.parse(String(held[0].observed_at)))).toBe(true)
  expect(held).toEqual([{ source_message_id: ackId, company_id: f.companyId,
    environment: 'production', direction: 'outbound', status: 'held', context: {}, source_received_at: null,
    reason: 'ediel_historical_identity_basis_unavailable', payload_sha256: digest(sourceRow(ackId).raw_payload!), observed_at: held[0].observed_at }])
}
function currentEndpointSnapshot(f: Fixture) {
  return sql<Json>(`SELECT jsonb_build_object(
    'tenantIdentifiers',(SELECT coalesce(jsonb_agg(to_jsonb(i) ORDER BY id),'[]') FROM public.tenant_actor_identifiers i
      WHERE environment='production' AND identifier_type='EdielId' AND identifier_value=${literal(f.receiver)}),
    'platformIdentifiers',(SELECT coalesce(jsonb_agg(to_jsonb(i) ORDER BY id),'[]') FROM public.platform_actor_identifiers i
      WHERE identifier_type='EdielId' AND identifier_value=${literal(f.receiver)}),
    'relations',(SELECT coalesce(jsonb_agg(to_jsonb(r) ORDER BY r.id),'[]') FROM public.tenant_counterparty_relations r
      WHERE r.environment='production' AND r.relation_type='ediel_transport_agent' AND r.counterparty_actor_id IN
        (SELECT actor_id FROM public.platform_actor_identifiers WHERE identifier_type='EdielId' AND identifier_value=${literal(f.receiver)})))`)
}
function capturedTechnicalSource(sourceId: string) {
  return sql<Json>(`SELECT to_jsonb(s) FROM gridex_ediel_technical_ack.sources s WHERE source_message_id=${literal(sourceId)}`)
}
async function registerLaterLegalIdentity(f: Fixture, ownCompany: boolean) {
  const companyId = ownCompany ? f.companyId : f.foreignCompanyId
  const legalActor = ownCompany ? f.actor : await decisionUser(companyId, ['communication.write'], randomUUID() + 'Aa1!')
  // Real current public identity registration, declared SYNTHETIC registry
  // input; no private source approval, competence or legal mandate is seeded.
  sql(`INSERT INTO public.tenant_ediel_profiles(company_id,environment,market,is_enabled,valid_from)
    VALUES(${literal(companyId)},'production','electricity',true,clock_timestamp()-interval '1 day');
    INSERT INTO public.tenant_actor_identifiers(company_id,environment,actor_id,identifier_type,identifier_value,valid_from)
    VALUES(${literal(companyId)},'production',${literal(legalActor.id)},'EdielId',${literal(f.legalReceiver)},clock_timestamp()-interval '1 day');
    INSERT INTO public.tenant_actor_roles(company_id,environment,actor_id,role_code,valid_from)
    VALUES(${literal(companyId)},'production',${literal(legalActor.id)},'electricity_supplier',clock_timestamp()-interval '1 day')`)
  if (!ownCompany) {
    const transportActor = randomUUID()
    sql(`INSERT INTO public.platform_market_actors(id,name,source) VALUES(${literal(transportActor)},'SYNTHETIC competing legal transport agent','manual');
      INSERT INTO public.platform_actor_identifiers(actor_id,identifier_type,identifier_value,source,valid_from)
      VALUES(${literal(transportActor)},'EdielId',${literal(f.receiver)},'manual','2020-01-01');
      INSERT INTO public.tenant_counterparty_relations(company_id,environment,counterparty_actor_id,relation_type,is_enabled,valid_from)
      VALUES(${literal(companyId)},'production',${literal(transportActor)},'ediel_transport_agent',true,clock_timestamp()-interval '1 day')`)
  }
  const resolution = await resolveInboundTenantFromIdentifiers({ environment: 'production', senderEdielId: '12345', receiverEdielId: f.receiver,
    marketActorEdielId: f.legalReceiver, messageFamily: 'PRODAT', messageCode: 'Z04', applicationReference: '23-DDQ-PRODAT' })
  expect(resolution).toMatchObject({ status: 'resolved', companyId, source: 'verified_legal_identity' })
  return legalActor
}
async function admitted(f: Fixture) {
  const p = await f.prepare(), result = await supabaseService.rpc(admitName, f.parameters(p.mailId, p.parseId))
  expect(result.error).toBeNull()
  const receipt = result.data as IntakeReceipt
  expect(receipt).toMatchObject({ kind: 'unattributed_technical_intake', version: 1, disposition: 'technical_only_unattributed',
    companyId: null, resolvedCompanyId: null, technicalCompanyId: f.companyId, environment: 'production',
    inboundEmailMessageId: p.mailId, parseResultId: p.parseId, sourcePayloadHash: digest(f.wire),
    executionActorUserId: f.actor.id, authorizesBusinessEffect: false })
  expect(new Date(receipt.receivedAt).toISOString()).toBe(f.receivedAt)
  return { ...p, receipt, source: sourceRow(receipt.sourceMessageId) }
}
function assertNoBusinessOriginal(sourceId: string, f: Fixture) {
  const original = sourceRow(sourceId)
  expect(original).toMatchObject({ company_id: null, resolved_company_id: null, customer_id: null, site_id: null, metering_point_id: null,
    operation_id: null, intent_id: null, source_operation_id: null, outbound_request_id: null, canonical_rule_pack_id: null, execution_context_snapshot: {} })
  const negative = sql<Json>(`SELECT to_jsonb(r) FROM gridex_ediel_inbound_context.receipts r
    JOIN gridex_unattributed_intake.technical_births b ON b.source_message_id=r.source_message_id WHERE b.source_message_id=${literal(sourceId)}`)
  expect(negative.observed_at).toEqual(expect.any(String)); expect(Number.isFinite(Date.parse(String(negative.observed_at)))).toBe(true)
  expect(negative).toEqual({ source_message_id: sourceId, company_id: null, environment: 'production', direction: 'inbound',
    status: 'held', context: {}, reason: 'ediel_inbound_legal_context_required', payload_sha256: digest(original.raw_payload!),
    source_received_at: original.message_received_at, observed_at: negative.observed_at })
  expect(sql(`SELECT jsonb_build_object(
    'national',(SELECT count(*) FROM gridex_received_sources.sources WHERE source_message_id=${literal(sourceId)}),
    'validation',(SELECT count(*) FROM gridex_received_sources.validation_assessments WHERE source_message_id=${literal(sourceId)}),
    'legalAuthority',(SELECT count(*) FROM gridex_ediel_inbound_context.receipts WHERE source_message_id=${literal(sourceId)}
      AND(status='ready' OR context<>'{}'::jsonb OR company_id IS NOT NULL)),
    'ownerWitnesses',(SELECT count(*) FROM gridex_ediel_outbound_owner.witnesses WHERE company_id=${literal(f.companyId)}),
    'transport',(SELECT count(*) FROM gridex_ediel_transport.attempts WHERE company_id=${literal(f.companyId)}),
    'businessOutbox',(SELECT count(*) FROM public.ediel_outbox t WHERE company_id=${literal(f.companyId)} AND NOT ${legitimateTechnicalOutbox}))`))
    .toEqual({ national: 0, validation: 0, legalAuthority: 0, ownerWitnesses: 0, transport: 0, businessOutbox: 0 })
}

describe('SC014 actual native protected technical source birth', () => {
  it('uses actual MIME store/parser and complete installed guards to keep NULL legal original, create one current CONTRL and preserve all business/foreign rows', async () => {
    const f = await fixture(), before = businessSnapshot(f), stored = await f.store()
    const result = await processInboundEmailMessage({ inboundEmailMessageId: stored.mailId, actorUserId: f.actor.id })
    expect(result).toMatchObject({ status: 'manual_review', companyId: null })
    const read = await f.read(stored.mailId, null); expect(read.error).toBeNull()
    const receipt = read.data as IntakeReceipt, source = sourceRow(receipt.sourceMessageId)
    expect(receipt).toMatchObject({ disposition: 'technical_only_unattributed', technicalCompanyId: f.companyId, companyId: null,
      inboundEmailMessageId: stored.mailId, sourcePayloadHash: digest(f.wire), authorizesBusinessEffect: false })
    expect(source).toMatchObject({ company_id: null, resolved_company_id: null, raw_payload: f.wire, immutable_payload_hash: digest(f.wire),
      environment: 'production', inbound_email_message_id: stored.mailId, mailbox_message_id: stored.mailId })
    expect(validateEdifactSyntax({ ...source, status: 'received' })).toMatchObject({ ok: true, grammarQualification: 'qualified' })
    expect(custodySnapshot(stored.mailId)).toMatchObject({ raw: { inbound_email_message_id: stored.mailId },
      parses: [{ parse_result_id: result.parseResultId, selection_qualified: true }], birth: { source_message_id: source.id, actor_user_id: f.actor.id } })
    expect(sql(`SELECT to_jsonb(count(*)) FROM public.inbound_ediel_match_attempts WHERE inbound_email_message_id=${literal(stored.mailId)}`)).toBe(0)
    expect(technicalOutboxRows(source.id)).toEqual([])
    await processInboundEdielMessage({ actorUserId: f.actor.id, edielMessageId: source.id })
    const acks = sql<EdielMessageRow[]>(`SELECT coalesce(jsonb_agg(to_jsonb(a) ORDER BY id),'[]') FROM public.ediel_messages a
      WHERE related_message_id=${literal(source.id)} AND direction='outbound'`)
    expect(acks).toHaveLength(1)
    const ack = acks[0]
    expect(ack).toMatchObject({ company_id: f.companyId, environment: 'production', message_family: 'CONTRL', status: 'draft',
      related_message_id: source.id, ack_outcome: 'positive', customer_id: null, site_id: null, metering_point_id: null })
    const retained = await readPersistedEdielTechnicalContrlBasis({ companyId: f.companyId, environment: 'production', ackMessageId: ack.id,
      expectedRawPayload: ack.raw_payload!, actorUserId: f.actor.id, phase: 'prepare' })
    expect(retained.ackMessage.id).toBe(ack.id)
    expect(sql(`SELECT jsonb_build_object('creation',(SELECT count(*) FROM gridex_ediel_ack_replay.creation_receipts WHERE ack_message_id=${literal(ack.id)}),
      'namespace',(SELECT count(*) FROM gridex_ediel_wire_namespace.coverage WHERE company_id=${literal(f.companyId)}),
      'guide',(SELECT count(*) FROM gridex_ediel_ack_guide.source_bindings WHERE source_message_id=${literal(source.id)}))`))
      .toEqual({ creation: 1, namespace: 1, guide: 1 })
    assertTechnicalQueue(source.id, ack.id, f)
    assertNoBusinessOriginal(source.id, f); expect(businessSnapshot(f)).toEqual(before)
  })

  it('requires actual service transport role and current WRITE actor rather than claimed JWT, READ or SEND', async () => {
    const f = await fixture(), p = await f.prepare()
    const readOnly = await decisionUser(f.companyId, ['communication.read'], randomUUID() + 'Aa1!')
    const sendOnly = await decisionUser(f.companyId, ['communication.send'], randomUUID() + 'Aa1!')
    const foreign = await decisionUser(f.foreignCompanyId, ['communication.write'], randomUUID() + 'Aa1!')
    const before = businessSnapshot(f), custody = custodySnapshot(p.mailId)
    const anonymous = createClient('http://127.0.0.1:54321', process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!, { auth: { persistSession: false } })
    for (const client of [anonymous, f.actor.client]) {
      const result = await client.rpc(admitName, f.parameters(p.mailId, p.parseId)); expect(result.data).toBeNull(); expect(result.error?.code).toBe('42501')
    }
    for (const actor of [null, readOnly.id, sendOnly.id, foreign.id]) {
      const result = await supabaseService.rpc(admitName, f.parameters(p.mailId, p.parseId, actor))
      expect(result.data).toBeNull(); expect(result.error).not.toBeNull()
    }
    for (const prelude of ["SET request.jwt.claims='{}'", "SET request.jwt.claims='{" + '"role":"service_role"' + "}'",
      "SET ROLE service_role;SET request.jwt.claims='{" + '"role":"authenticated"' + "}'",
      "SET ROLE service_role;SET request.jwt.claim.role='service_role';SET request.jwt.claims='{" + '"role":"authenticated"' + "}'"]) {
      expect(() => sql(`${prelude};SELECT public.${admitName}(${literal(p.mailId)},${literal(p.parseId)},${literal(f.actor.id)},${literal(digest(f.wire))},'production')`))
        .toThrow(/ediel_technical_intake_service_required/)
    }
    expect(() => sql(`SET ROLE authenticated;SET request.jwt.claim.role='service_role';SET request.jwt.claims='{"role":"service_role"}';
      SELECT public.${admitName}(${literal(p.mailId)},${literal(p.parseId)},${literal(f.actor.id)},${literal(digest(f.wire))},'production')`))
      .toThrow(/permission denied|ediel_technical_intake_service_required/)
    expect(custodySnapshot(p.mailId)).toEqual(custody); expect(businessSnapshot(f)).toEqual(before)
    expect((await supabaseService.rpc(admitName, f.parameters(p.mailId, p.parseId))).error).toBeNull()
  })

  it('cannot mint private birth authority by direct grants/writes or an untrusted old raw INSERT and later UPDATE', async () => {
    const f = await fixture(), mailId = randomUUID(), raw = f.wire
    for (const table of privateTables) {
      expect(sql(`SELECT jsonb_build_object('rls',relrowsecurity,'forced',relforcerowsecurity,'authenticated',has_table_privilege('authenticated',oid,'INSERT,UPDATE,DELETE,TRUNCATE'),
        'anonymous',has_table_privilege('anon',oid,'INSERT,UPDATE,DELETE,TRUNCATE'),'service',has_table_privilege('service_role',oid,'INSERT,UPDATE,DELETE,TRUNCATE'))
        FROM pg_class WHERE oid=${literal('gridex_unattributed_intake.' + table)}::regclass`)).toEqual({ rls: true, forced: true, authenticated: false, anonymous: false, service: false })
      expect(() => sql(`SET ROLE service_role;INSERT INTO gridex_unattributed_intake.${table} DEFAULT VALUES`)).toThrow(/permission denied/)
    }
    // Genuine pre-attestation state: ordinary database-owner INSERT has no
    // actual service transport boundary. No private row is inserted/deleted.
    sql(`INSERT INTO public.inbound_email_messages(id,company_id,mailbox_id,environment,received_at,raw_email,raw_edifact_payload,body_text)
      VALUES(${literal(mailId)},${literal(f.companyId)},${literal(f.mailboxId)},'production',clock_timestamp(),${literal('Content-Type: application/edifact\r\n\r\n' + raw)},${literal(raw)},${literal(raw)});
      SET ROLE service_role;UPDATE public.inbound_email_messages SET raw_edifact_payload=${literal(raw)} WHERE id=${literal(mailId)};RESET ROLE;`)
    const parseId = await createParseResult({ inboundEmailMessageId: mailId, companyId: null, parsed: parseEdifactPayload(raw) })
    const before = custodySnapshot(mailId), result = await supabaseService.rpc(admitName, f.parameters(mailId, parseId))
    expect(before).toMatchObject({ raw: null, parses: [], birth: null, sources: [] })
    expect(result.data).toBeNull(); expect(result.error?.message).toContain('original_custody_required'); expect(custodySnapshot(mailId)).toEqual(before)
  })

  it('ignores the mutable public application hash and admits only the actual sealed original bytes', async () => {
    const f = await fixture(), p = await f.prepare(), before = custodySnapshot(p.mailId)
    sql(`UPDATE public.inbound_email_messages SET raw_message_sha256=${literal('0'.repeat(64))} WHERE id=${literal(p.mailId)}`)
    const result = await supabaseService.rpc(admitName, f.parameters(p.mailId, p.parseId))
    expect(result.error).toBeNull(); expect(result.data).toMatchObject({ sourcePayloadHash: digest(f.wire), companyId: null, authorizesBusinessEffect: false })
    expect(custodySnapshot(p.mailId).raw).toEqual(before.raw)
    expect(sourceRow((result.data as IntakeReceipt).sourceMessageId).immutable_payload_hash).toBe(digest(f.wire))
  })

  it('ordinary authenticated/anonymous RLS reads cannot expose the NULL-legal source while the actor-bound service reader can', async () => {
    const f = await fixture(), p = await admitted(f)
    const anonymous = createClient('http://127.0.0.1:54321', process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!, { auth: { persistSession: false } })
    for (const client of [anonymous, f.actor.client]) {
      const result = await client.from('ediel_messages').select('id,raw_payload').eq('id', p.source.id)
      expect(result.data ?? []).toEqual([])
    }
    const read = await f.read(null, p.source.id)
    expect(read.error).toBeNull(); expect(read.data).toEqual(p.receipt)
  })

  it.each([
    ['raw MIME', (f: Fixture, p: { mailId: string; parseId: string }) => `UPDATE public.inbound_email_messages SET raw_email='CHANGED' WHERE id=${literal(p.mailId)}`],
    ['retained EDI', (f: Fixture, p: { mailId: string; parseId: string }) => `UPDATE public.inbound_email_messages SET raw_edifact_payload=raw_edifact_payload||' ' WHERE id=${literal(p.mailId)}`],
    ['environment', (f: Fixture, p: { mailId: string; parseId: string }) => `UPDATE public.inbound_email_messages SET environment='test' WHERE id=${literal(p.mailId)}`],
    ['mailbox scope', (f: Fixture) => `UPDATE public.ediel_mailboxes SET is_shared_platform_mailbox=true WHERE id=${literal(f.mailboxId)}`],
    ['parse selection', (f: Fixture, p: { mailId: string; parseId: string }) => `UPDATE public.inbound_ediel_parse_results SET raw_payload='FORGED' WHERE id=${literal(p.parseId)}`],
    ['parse JSON', (f: Fixture, p: { mailId: string; parseId: string }) => `UPDATE public.inbound_ediel_parse_results SET parsed_payload=parsed_payload||'{"verified":true}' WHERE id=${literal(p.parseId)}`],
    ['late attachment', (f: Fixture, p: { mailId: string; parseId: string }) => `SET ROLE service_role;INSERT INTO public.inbound_email_attachments(inbound_email_message_id,filename,raw_text,is_edifact_candidate)
      VALUES(${literal(p.mailId)},'late.edi',${literal(f.wire)},true);RESET ROLE`],
  ])('refuses mutated %s without backfill, canonical source or business effects', async (_label, mutation) => {
    const f = await fixture(), p = await f.prepare(); sql(mutation(f, p))
    const before = businessSnapshot(f), custody = custodySnapshot(p.mailId), result = await supabaseService.rpc(admitName, f.parameters(p.mailId, p.parseId))
    expect(result.data).toBeNull(); expect(result.error?.message).toContain('original_custody_required')
    expect(custodySnapshot(p.mailId)).toEqual(custody); expect(custody.birth).toBeNull(); expect(custody.sources).toEqual([])
    expect(businessSnapshot(f)).toEqual(before)
  })

  it('never promotes a parse that selected an ambiguous original, even after the competing attachment disappears', async () => {
    const f = await fixture(), p = await f.store(), attachmentId = randomUUID(), competing = f.wire.replace('BGM+Z04+', 'BGM+Z03+')
    sql(`SET ROLE service_role;INSERT INTO public.inbound_email_attachments(id,inbound_email_message_id,filename,raw_text,is_edifact_candidate)
      VALUES(${literal(attachmentId)},${literal(p.mailId)},'competing.edi',${literal(competing)},true);RESET ROLE`)
    const parseId = await createParseResult({ inboundEmailMessageId: p.mailId, companyId: null, parsed: parseEdifactPayload(f.wire) })
    expect(custodySnapshot(p.mailId)).toMatchObject({ parses: [{ selection_qualified: false }] })
    sql(`DELETE FROM public.inbound_email_attachments WHERE id=${literal(attachmentId)}`)
    const result = await supabaseService.rpc(admitName, f.parameters(p.mailId, parseId))
    expect(result.data).toBeNull(); expect(result.error?.message).toContain('original_custody_required')
    expect(custodySnapshot(p.mailId)).toMatchObject({ parses: [{ selection_qualified: false }], birth: null, sources: [] })
  })

  it.each(['bytes', 'filename', 'delete'])('binds actual plaintext MIME attachment birth and refuses later attachment %s changes', async change => {
    const f = await fixture(), p = await f.store(f.wire, true)
    const parseId = await createParseResult({ inboundEmailMessageId: p.mailId, companyId: null, parsed: parseEdifactPayload(f.wire) })
    const attachment = sql<{ id: string; raw: string }>(`SELECT jsonb_build_object('id',id,'raw',raw_text)
      FROM public.inbound_email_attachments WHERE inbound_email_message_id=${literal(p.mailId)}`)
    expect(attachment.raw.trim()).toBe(f.wire)
    expect(custodySnapshot(p.mailId)).toMatchObject({ attachments: [{ attachment_id: attachment.id }], parses: [{ selection_qualified: true }] })
    const baseline = custodySnapshot(p.mailId)
    sql(change === 'delete' ? `DELETE FROM public.inbound_email_attachments WHERE id=${literal(attachment.id)}`
      : `UPDATE public.inbound_email_attachments SET ${change === 'bytes' ? "raw_text='FORGED'" : "filename='changed.edi'"} WHERE id=${literal(attachment.id)}`)
    const result = await supabaseService.rpc(admitName, f.parameters(p.mailId, parseId))
    expect(result.data).toBeNull(); expect(result.error?.message).toContain('original_custody_required'); expect(custodySnapshot(p.mailId)).toEqual(baseline)
  })

  it('same-mail retries/concurrent requests return one immutable source, while another physical delivery cannot duplicate its wire', async () => {
    const f = await fixture(), p = await f.prepare(), before = businessSnapshot(f)
    const concurrent = await Promise.all([1, 2, 3].map(() => supabaseService.rpc(admitName, f.parameters(p.mailId, p.parseId))))
    for (const result of concurrent) expect(result.error).toBeNull()
    const receipt = concurrent[0].data as IntakeReceipt
    expect(concurrent.map(result => (result.data as IntakeReceipt).sourceMessageId)).toEqual(Array(3).fill(receipt.sourceMessageId))
    const custody = custodySnapshot(p.mailId), retry = await supabaseService.rpc(admitName, f.parameters(p.mailId, p.parseId))
    expect(retry.data).toEqual(receipt); expect(custodySnapshot(p.mailId)).toEqual(custody)
    // Different body, identical physical sender/receiver/application/UCI. The
    // regular mailbox deduper cannot conceal this distinct retained delivery.
    const changed = f.wire.replace('Synthetic', 'Changed'), second = await f.prepare(changed)
    expect(second.mailId).not.toBe(p.mailId)
    const duplicate = await supabaseService.rpc(admitName, f.parameters(second.mailId, second.parseId, f.actor.id, changed))
    expect(duplicate.data).toBeNull(); expect(duplicate.error?.message).toContain('physical_original_exists')
    expect(custodySnapshot(second.mailId)).toMatchObject({ birth: null, sources: [] }); expect(custodySnapshot(p.mailId)).toEqual(custody)
    expect(businessSnapshot(f)).toEqual(before)
  })

  it('a real stale REPEATABLE READ ordinary writer cannot duplicate the later committed protected physical original', async () => {
    const f = await fixture(), p = await f.prepare(), session = repeatableReadSession(), duplicateId = randomUUID()
    try {
      session.send(`BEGIN ISOLATION LEVEL REPEATABLE READ;SELECT 'SC014_ORDINARY_RR_READY:'||count(*) FROM public.ediel_messages
        WHERE inbound_email_message_id=${literal(p.mailId)};`)
      await session.marker('SC014_ORDINARY_RR_READY:0')
      const birth = await supabaseService.rpc(admitName, f.parameters(p.mailId, p.parseId))
      expect(birth.error).toBeNull(); const sourceId = (birth.data as IntakeReceipt).sourceMessageId
      const before = businessSnapshot(f), custody = custodySnapshot(p.mailId)
      expect(custody.physicalClaims).toEqual([expect.objectContaining({ protected_source_id: sourceId })])
      // Prove this is a genuinely older snapshot in the still-open session.
      session.send(`SELECT 'SC014_ORDINARY_STILL_STALE:'||count(*) FROM public.ediel_messages WHERE id=${literal(sourceId)};`)
      await session.marker('SC014_ORDINARY_STILL_STALE:0')
      session.finish(ordinaryInsert(f, duplicateId))
      const result = await session.done
      expect(result.code).not.toBe(0)
      expect(result.errors).toMatch(/23505: ediel_technical_intake_physical_original_exists|40001:/)
      expect(sql(`SELECT to_jsonb(count(*)) FROM public.ediel_messages WHERE id=${literal(duplicateId)}`)).toBe(0)
      expect(custodySnapshot(p.mailId)).toEqual(custody); expect(businessSnapshot(f)).toEqual(before); assertNoBusinessOriginal(sourceId, f)
    } finally { await session.close() }
  })

  it('reverse-order stale REPEATABLE READ admission refuses before birth and preserves the already committed ordinary original', async () => {
    const f = await fixture(), p = await f.prepare(), session = repeatableReadSession(), ordinaryId = randomUUID()
    try {
      session.send(`BEGIN ISOLATION LEVEL REPEATABLE READ;SELECT 'SC014_ADMISSION_RR_READY:'||count(*) FROM public.ediel_messages
        WHERE id=${literal(ordinaryId)};`)
      await session.marker('SC014_ADMISSION_RR_READY:0')
      sql(ordinaryInsert(f, ordinaryId))
      const original = sourceRow(ordinaryId), before = businessSnapshot(f), custody = custodySnapshot(p.mailId)
      expect(original).toMatchObject({ company_id: f.foreignCompanyId, direction: 'inbound', raw_payload: f.wire })
      expect(sql(`SELECT to_jsonb(count(*)) FROM gridex_unattributed_intake.physical_claims
        WHERE physical_key=gridex_unattributed_intake.physical_key_v1(gridex_ediel_technical_ack.envelope(${literal(f.wire)}))`)).toBe(0)
      session.send(`SELECT 'SC014_ADMISSION_STILL_STALE:'||count(*) FROM public.ediel_messages WHERE id=${literal(ordinaryId)};`)
      await session.marker('SC014_ADMISSION_STILL_STALE:0')
      session.finish(`SET LOCAL ROLE service_role;SELECT public.${admitName}(${literal(p.mailId)},${literal(p.parseId)},${literal(f.actor.id)},
        ${literal(digest(f.wire))},'production');`)
      const result = await session.done
      expect(result.code).not.toBe(0); expect(result.errors).toContain('25000: ediel_technical_intake_read_committed_required')
      expect(custodySnapshot(p.mailId)).toEqual(custody); expect(custody).toMatchObject({ birth: null, physicalClaims: [], sources: [] })
      expect(sourceRow(ordinaryId)).toEqual(original); expect(businessSnapshot(f)).toEqual(before)
      // The normal current isolation also refuses that existing original.
      const current = await supabaseService.rpc(admitName, f.parameters(p.mailId, p.parseId))
      expect(current.data).toBeNull(); expect(current.error?.message).toContain('physical_original_exists')
      expect(sourceRow(ordinaryId)).toEqual(original); expect(custodySnapshot(p.mailId)).toEqual(custody)
    } finally { await session.close() }
  })

  it('direct NULL birth, retained legal reassignment, changed immutable source and reused selectors remain refused', async () => {
    const f = await fixture(), p = await admitted(f), before = custodySnapshot(p.mailId)
    expect(() => sql(`INSERT INTO public.ediel_messages(id,company_id,environment,direction,message_standard,message_family,message_code,status,raw_payload,message_received_at)
      VALUES(${literal(randomUUID())},NULL,'production','inbound','edifact','PRODAT','Z04','received',${literal(f.wire)},clock_timestamp())`)).toThrow(/canonical_ediel_company_required/)
    for (const change of [`company_id=${literal(f.companyId)}`, `resolved_company_id=${literal(f.companyId)}`, "raw_payload='FORGED'", `intent_id=${literal(randomUUID())}`]) {
      expect(() => sql(`UPDATE public.ediel_messages SET ${change} WHERE id=${literal(p.source.id)}`)).toThrow()
    }
    for (const mutation of [`UPDATE gridex_unattributed_intake.physical_claims SET protected_source_id=NULL WHERE protected_source_id=${literal(p.source.id)}`,
      `DELETE FROM gridex_unattributed_intake.physical_claims WHERE protected_source_id=${literal(p.source.id)}`,
      'TRUNCATE gridex_unattributed_intake.physical_claims']) {
      expect(() => sql(mutation)).toThrow(mutation.startsWith('TRUNCATE') ? /receipt_immutable/ : /physical_reservation_immutable/)
    }
    for (const selectors of [[p.mailId, p.source.id], [null, null]] as Array<[string | null, string | null]>) {
      expect((await f.read(...selectors)).error?.message).toContain('exact_selector_required')
    }
    const reused = await supabaseService.rpc(admitName, { ...f.parameters(p.mailId, p.parseId), p_expected_payload_hash: '0'.repeat(64) })
    expect(reused.data).toBeNull(); expect(reused.error?.message).toContain('replay_scope_conflict'); expect(custodySnapshot(p.mailId)).toEqual(before)
  })

  it('rechecks current WRITE permission on admission replay and read without changing receipt/source history', async () => {
    const f = await fixture(), p = await admitted(f), before = custodySnapshot(p.mailId)
    sql(`UPDATE public.company_memberships SET is_active=false,status='revoked' WHERE company_id=${literal(f.companyId)} AND user_id=${literal(f.actor.id)}`)
    const business = businessSnapshot(f)
    const retry = await supabaseService.rpc(admitName, f.parameters(p.mailId, p.parseId)), read = await f.read(null, p.source.id)
    for (const result of [retry, read]) { expect(result.data).toBeNull(); expect(result.error?.code).toBe('42501'); expect(result.error?.message).toContain('current_actor_required') }
    expect(custodySnapshot(p.mailId)).toEqual(before); expect(businessSnapshot(f)).toEqual(business)
  })

  it('allows later diagnostic UPDATE of the permanently protected original and does not intercept ordinary DELETE', async () => {
    const f = await fixture(), p = await admitted(f), before = custodySnapshot(p.mailId)
    // Each sql() is a new native session/transaction. Fresh birth authority
    // must remain valid for diagnostics after its original transaction ends.
    sql(`UPDATE public.ediel_messages SET status='parsed',failure_reason='SYNTHETIC protected review note' WHERE id=${literal(p.source.id)}`)
    const after = custodySnapshot(p.mailId)
    expect(after.birth).toEqual(before.birth); expect(after.raw).toEqual(before.raw); expect(after.parses).toEqual(before.parses)
    expect(after.originalHeldContext).toEqual(before.originalHeldContext)
    expect(sourceRow(p.source.id)).toMatchObject({ company_id: null, resolved_company_id: null, status: 'parsed',
      raw_payload: f.wire, immutable_payload_hash: digest(f.wire), failure_reason: 'SYNTHETIC protected review note' })
    expect((await f.read(null, p.source.id)).error).toBeNull()
    const ordinaryId = randomUUID()
    sql(`INSERT INTO public.ediel_messages(id,company_id,environment,direction,message_standard,message_family,message_code,status)
      VALUES(${literal(ordinaryId)},${literal(f.companyId)},'production','inbound','edifact','SC014_DIAGNOSTIC','SC014_DIAGNOSTIC','draft');
      DELETE FROM public.ediel_messages WHERE id=${literal(ordinaryId)}`)
    expect(sql(`SELECT to_jsonb(count(*)) FROM public.ediel_messages WHERE id=${literal(ordinaryId)}`)).toBe(0)
    expect(() => sql(`DELETE FROM public.ediel_messages WHERE id=${literal(p.source.id)}`)).toThrow(/original_immutable|foreign key/)
    assertNoBusinessOriginal(p.source.id, f)
  })

  it('holds the same technical original after genuine current resolver success and reprocesses the exact retained CONTRL without legal reassignment or duplicate wire', async () => {
    // The original technical endpoint is a real platform-agent relation from
    // birth. A second tenant identifier would make legal identity ambiguous.
    const f = await fixture({ platformTransport: true }), p = await admitted(f)
    await processInboundEdielMessage({ actorUserId: f.actor.id, edielMessageId: p.source.id })
    const ack = sql<EdielMessageRow>(`SELECT to_jsonb(a) FROM public.ediel_messages a WHERE related_message_id=${literal(p.source.id)} AND message_family='CONTRL'`)
    expect(ack).toMatchObject({ status: 'draft', company_id: f.companyId, ack_outcome: 'positive' })
    assertTechnicalQueue(p.source.id, ack.id, f)
    const endpoint = currentEndpointSnapshot(f), captured = capturedTechnicalSource(p.source.id), originalOutbox = technicalOutboxRows(p.source.id), heldContext = technicalHeldAckRows(p.source.id)
    const originalNegative = custodySnapshot(p.mailId).originalHeldContext
    const legalActor = await registerLaterLegalIdentity(f, true)
    expect(currentEndpointSnapshot(f)).toEqual(endpoint); expect(capturedTechnicalSource(p.source.id)).toEqual(captured)
    expect(custodySnapshot(p.mailId).originalHeldContext).toEqual(originalNegative)
    const before = businessSnapshot(f), custody = custodySnapshot(p.mailId), originalAck = sourceRow(ack.id)
    const reprocessed = await processInboundEmailMessage({ inboundEmailMessageId: p.mailId, actorUserId: f.actor.id })
    expect(reprocessed).toMatchObject({ status: 'manual_review', companyId: null, parseResultId: p.parseId })
    await processInboundEdielMessage({ actorUserId: f.actor.id, edielMessageId: p.source.id })
    expect(custodySnapshot(p.mailId)).toEqual(custody)
    expect(sourceRow(ack.id)).toEqual(originalAck)
    const retained = await readPersistedEdielTechnicalContrlBasis({ companyId: f.companyId, environment: 'production', ackMessageId: ack.id,
      expectedRawPayload: ack.raw_payload!, actorUserId: f.actor.id, phase: 'prepare' })
    expect(retained.ackMessage).toEqual(originalAck); expect(technicalOutboxRows(p.source.id)).toEqual(originalOutbox); expect(technicalHeldAckRows(p.source.id)).toEqual(heldContext)
    expect(sql(`SELECT jsonb_build_object('sources',(SELECT count(*) FROM public.ediel_messages WHERE inbound_email_message_id=${literal(p.mailId)}),
      'acks',(SELECT count(*) FROM public.ediel_messages WHERE related_message_id=${literal(p.source.id)}),
      'receipts',(SELECT count(*) FROM gridex_unattributed_intake.technical_births WHERE inbound_email_message_id=${literal(p.mailId)}))`))
      .toEqual({ sources: 1, acks: 1, receipts: 1 })
    assertNoBusinessOriginal(p.source.id, f); expect(businessSnapshot(f)).toEqual(before)

    // A different real mail now has a valid legal-company mailbox and an
    // actual matching public request. This forces the ordinary matched path;
    // the protected physical tuple must stop it before request/domain updates.
    const secondMailboxId = randomUUID(), requestId = randomUUID()
    sql(`INSERT INTO public.ediel_mailboxes(id,company_id,environment,mailbox_name,email_address,mailbox_type,is_active,is_shared_platform_mailbox)
      VALUES(${literal(secondMailboxId)},${literal(f.companyId)},'production','SYNTHETIC later legal mailbox','legal@example.invalid','tenant',true,false);
      INSERT INTO public.outbound_requests(id,company_id,request_type,source_type,status,external_reference,metadata)
      VALUES(${literal(requestId)},${literal(f.companyId)},'SC014_NATIVE_HELD','SC014_NATIVE_UNQUALIFIED','queued',
        ${literal(parseEdifactPayload(f.wire).interchangeReference)},'{"scope":"SYNTHETIC matching control, no source approval"}')`)
    const secondMailbox = sql<EdielMailboxRow>(`SELECT to_jsonb(m) FROM public.ediel_mailboxes m WHERE id=${literal(secondMailboxId)}`)
    const rawMime = `From: sender@example.invalid\r\nTo: legal@example.invalid\r\nMessage-ID: <${randomUUID()}@example.invalid>\r\nContent-Type: application/edifact\r\n\r\n${f.wire}`
    const second = await storeMailboxFetchMessage({ mailbox: secondMailbox, actorUserId: legalActor.id,
      message: { source: Buffer.from(rawMime), internalDate: new Date(f.receivedAt) } })
    expect(second.deduped).toBe(false); expect(second.id).not.toBe(p.mailId)
    const laterBefore = businessSnapshot(f)
    await expect(processInboundEmailMessage({ inboundEmailMessageId: second.id, actorUserId: legalActor.id }))
      .rejects.toThrow('ediel_inbound_original_persistence_required')
    const match = sql<Array<{ status: string; type: string; id: string | null }>>(`SELECT jsonb_agg(jsonb_build_object('status',match_status,
      'type',match_type,'id',matched_entity_id) ORDER BY match_type) FROM public.inbound_ediel_match_attempts WHERE inbound_email_message_id=${literal(second.id)}`)
    expect(match).toEqual(expect.arrayContaining([{ status: 'matched', type: 'outbound_request', id: requestId }]))
    expect(() => sql(ordinaryInsert(f, randomUUID(), f.companyId))).toThrow(/ediel_technical_intake_physical_original_exists/)
    expect(custodySnapshot(second.id)).toMatchObject({ birth: null, sources: [] })
    expect(custodySnapshot(p.mailId)).toEqual(custody); expect(sourceRow(ack.id)).toEqual(originalAck)
    const stillRetained = await readPersistedEdielTechnicalContrlBasis({ companyId: f.companyId, environment: 'production', ackMessageId: ack.id,
      expectedRawPayload: ack.raw_payload!, actorUserId: f.actor.id, phase: 'prepare' })
    expect(stillRetained.ackMessage).toEqual(originalAck); expect(technicalOutboxRows(p.source.id)).toEqual(originalOutbox)
    expect(technicalHeldAckRows(p.source.id)).toEqual(heldContext)
    expect(currentEndpointSnapshot(f)).toEqual(endpoint); expect(capturedTechnicalSource(p.source.id)).toEqual(captured)
    assertTechnicalQueue(p.source.id, ack.id, f); assertNoBusinessOriginal(p.source.id, f); expect(businessSnapshot(f)).toEqual(laterBefore)
  })

  it('a genuine competing foreign legal endpoint holds current ACK read while retaining original custody, NULL legal scope and exact old ACK/outbox', async () => {
    const f = await fixture(), p = await admitted(f)
    await processInboundEdielMessage({ actorUserId: f.actor.id, edielMessageId: p.source.id })
    const ack = sql<EdielMessageRow>(`SELECT to_jsonb(a) FROM public.ediel_messages a WHERE related_message_id=${literal(p.source.id)} AND message_family='CONTRL'`)
    const initiallyQualified = await readPersistedEdielTechnicalContrlBasis({ companyId: f.companyId, environment: 'production', ackMessageId: ack.id,
      expectedRawPayload: ack.raw_payload!, actorUserId: f.actor.id, phase: 'prepare' })
    expect(initiallyQualified.ackMessage).toEqual(sourceRow(ack.id)); assertTechnicalQueue(p.source.id, ack.id, f)
    const endpoint = currentEndpointSnapshot(f), captured = capturedTechnicalSource(p.source.id), originalAck = sourceRow(ack.id), outbox = technicalOutboxRows(p.source.id), heldContext = technicalHeldAckRows(p.source.id)
    const originalNegative = custodySnapshot(p.mailId).originalHeldContext
    await registerLaterLegalIdentity(f, false)
    expect(currentEndpointSnapshot(f)).not.toEqual(endpoint)
    expect(capturedTechnicalSource(p.source.id)).toEqual(captured)
    expect(custodySnapshot(p.mailId).originalHeldContext).toEqual(originalNegative)
    const before = businessSnapshot(f), custody = custodySnapshot(p.mailId)
    const reprocessed = await processInboundEmailMessage({ inboundEmailMessageId: p.mailId, actorUserId: f.actor.id })
    expect(reprocessed).toMatchObject({ status: 'manual_review', companyId: null, parseResultId: p.parseId })
    await processInboundEdielMessage({ actorUserId: f.actor.id, edielMessageId: p.source.id })
    const held = await supabaseService.rpc('ediel_read_persisted_technical_contrl_basis_v2', { p_company_id: f.companyId,
      p_environment: 'production', p_ack_message_id: ack.id, p_actor_user_id: f.actor.id, p_phase: 'prepare' })
    expect(held.data).toBeNull(); expect(held.error?.message).toContain('ediel_technical_endpoint_unqualified')
    expect(custodySnapshot(p.mailId)).toEqual(custody); expect(sourceRow(ack.id)).toEqual(originalAck)
    expect(technicalOutboxRows(p.source.id)).toEqual(outbox); expect(capturedTechnicalSource(p.source.id)).toEqual(captured)
    expect(technicalHeldAckRows(p.source.id)).toEqual(heldContext)
    expect(sql(`SELECT to_jsonb(count(*)) FROM public.ediel_messages WHERE related_message_id=${literal(p.source.id)}`)).toBe(1)
    expect(() => sql(ordinaryInsert(f, randomUUID()))).toThrow(/ediel_technical_intake_physical_original_exists/)
    assertTechnicalQueue(p.source.id, ack.id, f); assertNoBusinessOriginal(p.source.id, f); expect(businessSnapshot(f)).toEqual(before)
  })
})
