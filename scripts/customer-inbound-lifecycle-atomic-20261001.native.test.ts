import { afterAll, beforeAll, expect, it, vi } from 'vitest'
import { createHash, randomUUID } from 'node:crypto'
import { createClient } from '@supabase/supabase-js'
const transport = vi.hoisted(() => ({ calls: 0, encrypted: 0 }))
vi.mock('server-only', () => ({}))
vi.mock('next/headers', () => ({ cookies: async () => ({ get: () => undefined }) }))
// Exactly the external Nodemailer boundary is controlled. No production
// readiness, source, status, receipt, sender or storage owner is substituted.
vi.mock('nodemailer', () => ({ default: { createTransport: (options: { host?: string }) => {
  if (options.host !== '127.0.0.1') throw new Error('inbound_native_external_smtp_forbidden')
  return { sendMail: async (mail: { envelope?: { to?: string[] }; raw?: Buffer }) => {
    expect(mail.envelope?.to).toEqual(['recipient@example.invalid'])
    expect(Buffer.isBuffer(mail.raw)).toBe(true)
    expect(mail.raw!.toString('ascii', 0, 8192)).toMatch(/application\/(?:x-)?pkcs7-mime/i)
    transport.calls++; transport.encrypted++
    return { accepted: ['recipient@example.invalid'], rejected: [], messageId: `<synthetic-${transport.calls}@example.invalid>`, response: '250 synthetic local transport accepted' }
  } }
} } }))
import { supabaseService } from '@/lib/supabase/service'
import { createEdielMessage } from '@/lib/ediel/db'
import { buildInboundAckMessageInput, buildInboundProdatMessageInput } from '@/lib/ediel/transport/index.part-2'
import { sendOutboxItem } from '@/lib/ediel/outbox/sendOutboxItem'
import { tokenizeEdifact, segmentComposite } from '@/lib/ediel/core/edifactTokenizer'
import { parseEdifactPayload } from '@/lib/inbound-mail/edielEmailParser'
import { classifyCanonicalInboundAck } from '@/lib/ediel/ack/inboundAckOutcome'
import { smimeArchiveStoragePathFromReference } from '@/lib/ediel/transport/smimeTransportArchive'
import { processInboundAckMessage } from '@/lib/ediel/flows/inboundAckProcessing'
import { applyInboundBusinessStateMachine } from '@/lib/ediel/flows/inboundBusinessStateMachine'
import { processInboundResponse } from '@/lib/customer-operations/automation.part-2'
import { processJob, processSupplierSwitch } from '@/lib/customer-operations/automation.part-3'
import { updateJob, type JobRow } from '@/lib/customer-operations/automation.part-1'
import type { EdielMessageRow } from '@/lib/ediel/types'
import { proofSql as sql, quote } from './customer-read-proof-native'
import { createPositiveSiteFixture, createHeldPositiveSiteRoutes, signPositiveSiteAgreement, preparePositiveZ01AndCaptureZ02, type PositiveSiteFixture } from './customer-site-positive-continuation-20261001.fixture'
const companies: string[] = []
const actualFetch = globalThis.fetch
let forbidden = 0
beforeAll(() => {
  globalThis.fetch = ((input: string | URL | Request, init?: RequestInit) => {
    const url = new URL(input instanceof Request ? input.url : String(input))
    if (url.origin !== 'http://127.0.0.1:54321') { forbidden++; throw new Error('inbound_native_external_http_forbidden') }
    return actualFetch(input, init)
  }) as typeof fetch
})
afterAll(() => {
  globalThis.fetch = actualFetch
  sql(`DROP TRIGGER IF EXISTS native_inbound_final_fault ON public.customer_operation_jobs;
    DROP TRIGGER IF EXISTS native_inbound_receipt_fault ON private.gridex_inbound_switch_lifecycle_receipts;
    DROP FUNCTION IF EXISTS private.native_inbound_final_fault(); DROP FUNCTION IF EXISTS private.native_inbound_receipt_fault();
    ${companies.length ? `UPDATE public.customer_operation_jobs SET status='cancelled',locked_at=NULL,locked_by=NULL,lock_token=NULL WHERE company_id IN(${companies.map(quote).join(',')}) AND status IN('queued','running','waiting_response');
    UPDATE public.tenant_email_outbox SET status='cancelled' WHERE company_id IN(${companies.map(quote).join(',')}) AND status='queued';
    UPDATE public.ediel_outbox SET status='blocked' WHERE company_id IN(${companies.map(quote).join(',')}) AND status='queued';` : ''}
    SELECT to_jsonb(true);`)
})
function rows(f: PositiveSiteFixture) {
  const tables = ['ediel_messages','supplier_switch_requests','customer_supply_periods','customer_cases','ediel_message_events',
    'ediel_ack_chains','supplier_switch_events','outbound_requests','outbound_dispatch_events','customer_application_workflows',
    'customer_application_workflow_events','domain_events','event_outbox','customer_operation_events','customer_operation_jobs','tenant_email_outbox','ediel_outbox','audit_logs']
  return sql<Record<string, Array<Record<string, unknown>>>>(`SELECT jsonb_build_object(${tables.map(t => `${quote(t)},(SELECT coalesce(jsonb_agg(to_jsonb(x) ORDER BY id),'[]') FROM public.${t} x WHERE company_id=${quote(f.company)})`).join(',')},
    'receipts',(SELECT coalesce(jsonb_agg(to_jsonb(x) ORDER BY source_message_id),'[]') FROM private.gridex_inbound_switch_lifecycle_receipts x WHERE company_id=${quote(f.company)}),
    'process_facts',(SELECT coalesce(jsonb_agg(to_jsonb(x) ORDER BY id),'[]') FROM gridex_correction_process.facts x WHERE company_id=${quote(f.company)}),
    'process_gaps',(SELECT coalesce(jsonb_agg(to_jsonb(x) ORDER BY fact_id),'[]') FROM gridex_correction_process.gaps x JOIN gridex_correction_process.facts f ON f.id=x.fact_id WHERE f.company_id=${quote(f.company)}),
    'process_witnesses',(SELECT coalesce(jsonb_agg(to_jsonb(x) ORDER BY fact_id),'[]') FROM gridex_correction_process.witnesses x WHERE company_id=${quote(f.company)}));`)
}
function makeTestTransportEncrypted(f: PositiveSiteFixture) {
  const cert = randomUUID()
  sql(`INSERT INTO public.ediel_certificates(id,company_id,environment,certificate_fingerprint,secret_reference,status,encryption_status,public_certificate_pem,
    fingerprint_sha256,owner_ediel_id,message_family,purpose,usage,valid_from,valid_to,certificate_valid_from,certificate_valid_to,source)
    SELECT ${quote(cert)},company_id,'test',certificate_fingerprint,'synthetic:public-certificate-only',status,encryption_status,public_certificate_pem,
      fingerprint_sha256,owner_ediel_id,message_family,purpose,usage,valid_from,valid_to,certificate_valid_from,certificate_valid_to,'synthetic_local_inbound_transport'
      FROM public.ediel_certificates WHERE id=${quote(f.cert)} AND company_id=${quote(f.company)};
    UPDATE public.ediel_route_profiles SET encryption_mode='smime',transport_security_mode='smime',certificate_required=true,receiver_certificate_id=${quote(cert)}
      WHERE company_id=${quote(f.company)} AND environment='test' AND message_code='Z03'; SELECT to_jsonb(true);`)
}
async function currentLocalUser(email: string) {
  const password = randomUUID() + randomUUID()
  const created = await supabaseService.auth.admin.createUser({ email, password, email_confirm: true })
  expect(created.error).toBeNull(); expect(created.data.user).toBeTruthy()
  const client = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    { auth: { persistSession: false, autoRefreshToken: false } })
  const session = await client.auth.signInWithPassword({ email, password })
  expect(session.error).toBeNull(); expect(session.data.session).toBeTruthy()
  const current = await client.auth.getUser()
  expect(current.error).toBeNull(); expect(current.data.user?.id).toBe(created.data.user!.id)
  expect(current.data.user?.email_confirmed_at).toBeTruthy()
  return { client, id: current.data.user!.id }
}
async function prepared(f: PositiveSiteFixture) {
  createHeldPositiveSiteRoutes(f); makeTestTransportEncrypted(f); await signPositiveSiteAgreement(f)
  sql(`UPDATE public.companies SET customer_portal_url='https://portal.example.invalid' WHERE id=${quote(f.company)};
    INSERT INTO public.company_email_templates(company_id,template_key,name,subject,body_html,body_text,is_active) VALUES
    (${quote(f.company)},'switch.confirmed','Synthetic confirmed','Byte bekräftat','<p>{{company_name}} {{customer_name}}</p>','{{company_name}} {{customer_name}}',true),
    (${quote(f.company)},'switch.action_required','Synthetic action','Åtgärd behövs','<p>{{company_name}} {{customer_name}}</p>','{{company_name}} {{customer_name}}',true);
    INSERT INTO public.email_event_rules(company_id,event_key,template_key,enabled,delay_minutes,send_to_customer) VALUES
    (${quote(f.company)},'switch.confirmed','switch.confirmed',true,1440,true),(${quote(f.company)},'switch.action_required','switch.action_required',true,1440,true); SELECT to_jsonb(true);`)
  const inbound = await preparePositiveZ01AndCaptureZ02(f)
  expect(inbound.result).toMatchObject({ z02_correlation_status: 'exact', z02_payload_validation_status: 'valid', z02_snapshot_freshness_status: 'valid', z02_atomic_core_applied: true })
  const applied = await processInboundResponse(inbound); expect(applied.status).toBe('completed'); await updateJob(inbound, applied)
  const job = sql<JobRow>(`SELECT to_jsonb(j) FROM public.customer_operation_jobs j WHERE id=${quote(String(applied.result?.supplier_switch_job_id))} AND company_id=${quote(f.company)};`)
  const result = await processSupplierSwitch(job); expect(result.status).toBe('completed'); await updateJob(job, result)
  const switchId = String(result.result?.supplier_switch_request_id)
  const origin = sql<EdielMessageRow>(`SELECT to_jsonb(m) FROM public.ediel_messages m JOIN public.supplier_switch_requests s ON s.outbound_z03_message_id=m.id
    WHERE s.id=${quote(switchId)} AND s.company_id=${quote(f.company)} AND m.company_id=s.company_id;`)
  expect(origin).toMatchObject({ message_code: 'Z03', direction: 'outbound', status: 'queued', message_sent_at: null, switch_request_id: switchId })
  // Own customer Auth identity, distinct from the operational actor. Obtain
  // its real current local GoTrue session before the enabled website owners
  // create the paired tenant identity/account; never change the tenant policy.
  const portalUser = (await currentLocalUser(f.email)).id
  expect(portalUser).not.toBe(f.actor)
  const app = randomUUID(), workflow = randomUUID()
  sql(`INSERT INTO public.website_customer_applications(id,company_id,customer_id,customer_site_id,metering_point_id,contract_id,external_customer_id,application_number,customer_number,contract_number,next_step,payload)
    VALUES(${quote(app)},${quote(f.company)},${quote(f.customer)},${quote(f.site)},${quote(f.point)},${quote(f.contract)},${quote(f.reference)},'SYNTHETIC-APP','SYNTHETIC-CUSTOMER','SYNTHETIC-CONTRACT','waiting_response',
      jsonb_build_object('auth_user_id',${quote(portalUser)},'customer_portal_user_id',${quote(portalUser)},'customer',jsonb_build_object('email',${quote(f.email)})));
    INSERT INTO public.customer_application_workflows(id,company_id,customer_application_id,customer_id,customer_site_id,metering_point_id,contract_id,operation_id,state)
    VALUES(${quote(workflow)},${quote(f.company)},${quote(app)},${quote(f.customer)},${quote(f.site)},${quote(f.point)},${quote(f.contract)},${quote(f.operation)},'waiting_for_switch_response'); SELECT to_jsonb(true);`)
  expect(sql<boolean>(`SELECT to_jsonb(EXISTS(SELECT 1 FROM public.customer_portal_identities i
    JOIN public.customer_portal_accounts a ON a.company_id=i.company_id AND a.customer_id=i.customer_id AND a.portal_user_id=i.auth_user_id
    JOIN public.website_customer_applications w ON w.company_id=i.company_id AND w.id=${quote(app)}
    WHERE i.company_id=${quote(f.company)} AND i.customer_id=${quote(f.customer)} AND i.auth_user_id=${quote(portalUser)}
      AND i.customer_portal_user_id=i.auth_user_id AND i.status='active' AND i.match_strength='strong'
      AND a.status='active' AND a.is_active AND a.role='owner' AND w.portal_identity_required
      AND w.portal_identity_submission_mode='pre_auth_required'));`)).toBe(true)
  return { origin, switchId, workflow }
}
async function ordinaryWriterCannotCapture(f: PositiveSiteFixture, origin: EdielMessageRow, family: 'PRODAT' | 'CONTRL' | 'APERAK', positive: boolean) {
  const ordinary = await currentLocalUser(`ordinary-switch-${randomUUID()}@example.invalid`)
  expect(ordinary.id).not.toBe(f.actor)
  sql(`INSERT INTO public.company_memberships(company_id,user_id,membership_role,status,role,is_active,accepted_at)
    VALUES(${quote(f.company)},${quote(ordinary.id)},'operations','active','operations',true,now()); SELECT to_jsonb(true);`)
  const authority = await ordinary.client.rpc('gridex_can_write_company', { p_company_id: f.company })
  expect(authority.error).toBeNull(); expect(authority.data).toBe(true)
  const before = rows(f)
  const forgedSend = await ordinary.client.from('ediel_messages').update({ status: 'sent', message_sent_at: new Date().toISOString() }).eq('id', origin.id)
  expect(forgedSend.error).toMatchObject({ code: '42501', message: 'inbound_switch_dispatch_service_required' })
  expect(rows(f)).toEqual(before)
  const source = randomUUID()
  const legacyRaw = await ordinary.client.from('ediel_messages').insert({ id: source, company_id: f.company,
    direction: 'inbound', message_family: family, message_code: family === 'PRODAT' ? 'Z04' : family,
    raw_payload: wire(origin, f, family, positive), message_received_at: new Date().toISOString(), related_message_id: origin.id,
    switch_request_id: origin.switch_request_id, customer_id: f.customer, site_id: f.site, metering_point_id: f.point })
  expect(legacyRaw.error).toBeNull()
  expect(sql<number>(`SELECT to_jsonb(count(*)) FROM private.gridex_inbound_switch_received_sources WHERE source_message_id=${quote(source)};`)).toBe(0)
  const rawState = rows(f)
  const rejected = await supabaseService.rpc('gridex_apply_inbound_switch_lifecycle_v1', { p_source_message_id: source, p_actor_user_id: f.actor })
  expect(rejected.error).toMatchObject({ code: '23514', message: 'inbound_switch_trusted_receive_required' })
  expect(rows(f)).toEqual(rawState)
  await ordinary.client.auth.signOut()
}
async function dispatch(f: PositiveSiteFixture, origin: EdielMessageRow) {
  const outbox = sql<string>(`SELECT to_jsonb(id) FROM public.ediel_outbox WHERE company_id=${quote(f.company)} AND ediel_message_id=${quote(origin.id)};`)
  const before = transport.calls
  await expect(sendOutboxItem({ actorUserId: f.actor, outboxItemId: outbox, smtpMimeMode: 'ediel-smime-enveloped' })).resolves.toMatchObject({ status: 'sent' })
  expect(transport.calls).toBe(before + 1)
  const sent = sql<EdielMessageRow>(`SELECT to_jsonb(m) FROM public.ediel_messages m WHERE id=${quote(origin.id)};`)
  expect(sent).toMatchObject({ status: 'sent', was_smime_encrypted: true, message_sent_at: expect.any(String) })
  expect(sql<number>(`SELECT to_jsonb(count(*)) FROM private.gridex_inbound_switch_dispatch_sources WHERE source_message_id=${quote(sent.id)} AND company_id=${quote(f.company)};`)).toBe(1)
  const stored = sql<{ ref: string; hash: string }>(`SELECT jsonb_build_object('ref',encrypted_payload_ref,'hash',metadata->>'archived_mime_sha256') FROM public.ediel_message_payloads
    WHERE company_id=${quote(f.company)} AND ediel_message_id=${quote(sent.id)} AND payload_kind='smime_enveloped' ORDER BY created_at DESC LIMIT 1;`)
  const path = smimeArchiveStoragePathFromReference(stored.ref); expect(path).toBeTruthy()
  const file = await supabaseService.storage.from('ediel-files').download(path!); expect(file.error).toBeNull()
  expect(createHash('sha256').update(Buffer.from(await file.data!.arrayBuffer())).digest('hex')).toBe(stored.hash)
  return sent
}
function wire(origin: EdielMessageRow, f: PositiveSiteFixture, family: 'PRODAT' | 'CONTRL' | 'APERAK', positive = false) {
  const source = tokenizeEdifact(origin.raw_payload), unb = source.segments.find(s => s.tag === 'UNB')!, bgm = source.segments.find(s => s.tag === 'BGM')!
  const reference = `N${randomUUID().replaceAll('-', '').slice(0, 12)}`, date = new Date().toISOString().replace(/[-:TZ.]/g, '').slice(0, 12)
  const body = family === 'PRODAT' ? [`BGM+Z04+${reference}+9`, `DTM+137:${date}:203`, 'DTM+ZZZ:1:805',
    `NAD+FR+${origin.receiver_ediel_id}:160:SVK`, `NAD+DO+${origin.sender_ediel_id}:160:SVK`, `LIN+1++${f.meter}:::9`, `DTM+92:${f.start.replaceAll('-', '')}0000:203`,
    'CCI++Z13', `CAV+${origin.parsed_payload?.prodatVariant === 'LK' ? 'Z23' : 'Z22'}`, ...source.segments.filter(s => s.tag === 'RFF' && segmentComposite(s, 1, source.una)[0] === 'LI').map(s => s.raw)] :
    family === 'APERAK' ? [`BGM++${reference}+${positive ? '34' : '27'}`, `DTM+137:${date}:203`, `RFF+ACW:${bgm.elements[2]}`, `ERC+${positive ? '100' : '42'}::260`] :
      [`UCI+${unb.elements[5]}+${unb.elements[2]}+${unb.elements[3]}+${positive ? '1' : '4'}`]
  const envelope = [...unb.elements]
  envelope[2] = unb.elements[3]; envelope[3] = unb.elements[2]
  envelope[4] = `${date.slice(2, 8)}:${date.slice(8)}`; envelope[5] = reference
  envelope[7] = origin.application_reference ?? '23-DDQ-PRODAT'; envelope[11] = '1'
  return envelope.join('+') + "'" +
    [`UNH+1+${family}:D:${family === 'CONTRL' ? '96A:UN' : family === 'APERAK' ? '96A:UN:E2SE6A' : '96B:UN:E2SE6A'}`, ...body, `UNT+${body.length + 2}+1`, `UNZ+1+${reference}`].join("'") + "'"
}
async function receive(f: PositiveSiteFixture, origin: EdielMessageRow, family: 'PRODAT' | 'CONTRL' | 'APERAK', positive: boolean) {
  const raw = wire(origin, f, family, positive)
  if (family !== 'PRODAT') expect(classifyCanonicalInboundAck(parseEdifactPayload(raw))).toMatchObject({ outcome: positive ? 'positive' : 'negative', profile: family === 'APERAK' ? 'PRODAT_16_B' : null })
  const draft = family === 'PRODAT' ? buildInboundProdatMessageInput({ rawPayload: raw }) : await buildInboundAckMessageInput({ family, rawPayload: raw })
  return createEdielMessage({ ...draft, actorUserId: f.actor, companyId: f.company, environment: origin.environment,
    relatedMessageId: origin.id, switchRequestId: origin.switch_request_id, customerId: f.customer, siteId: f.site, meteringPointId: f.point, gridOwnerId: f.grid })
}
async function apply(f: PositiveSiteFixture, message: EdielMessageRow) {
  if (message.message_family !== 'PRODAT') {
    const ack = await processInboundAckMessage({ actorUserId: f.actor, message })
    expect(ack.sourceMessage?.id).toBe(message.related_message_id)
  }
  return applyInboundBusinessStateMachine({ actorUserId: f.actor, message, matchedSwitchRequestId: message.switch_request_id,
    source: message.message_family === 'PRODAT' ? 'prodat_with_strong_switch_match' : 'ack_processing' })
}
for (const [family, positive] of [['PRODAT', false], ['APERAK', false], ['CONTRL', false], ['CONTRL', true]] as const) {
  it(`actual ${family} ${positive ? 'positive technical' : 'business'} owner late rollback, concurrent retry and terminal replay`, async () => {
    const f = createPositiveSiteFixture(companies), { origin, switchId, workflow } = await prepared(f)
    await ordinaryWriterCannotCapture(f, origin, family, positive)
    const inbound = await receive(f, origin, family, positive)
    const held = rows(f)
    await expect(apply(f, inbound)).rejects.toMatchObject({ message: 'inbound_switch_origin_unsent' }); expect(rows(f)).toEqual(held)
    const sent = await dispatch(f, origin)
    expect(sql<boolean>(`SELECT to_jsonb(m.immutable_payload_hash=w.payload_hash) FROM public.ediel_messages m
      JOIN private.gridex_inbound_switch_dispatch_sources w ON w.source_message_id=m.id WHERE m.id=${quote(sent.id)};`)).toBe(true)
    sql(positive ? `CREATE FUNCTION private.native_inbound_receipt_fault() RETURNS trigger LANGUAGE plpgsql AS $$BEGIN IF NEW.company_id=${quote(f.company)}::uuid THEN RAISE EXCEPTION 'synthetic_final_receipt_fault'; END IF; RETURN NEW; END$$;
      CREATE TRIGGER native_inbound_receipt_fault BEFORE INSERT ON private.gridex_inbound_switch_lifecycle_receipts FOR EACH ROW EXECUTE FUNCTION private.native_inbound_receipt_fault(); SELECT to_jsonb(true);` :
      `CREATE FUNCTION private.native_inbound_final_fault() RETURNS trigger LANGUAGE plpgsql AS $$BEGIN IF NEW.company_id=${quote(f.company)}::uuid AND NEW.job_type='dispatch_lifecycle_notification' THEN RAISE EXCEPTION 'synthetic_final_intent_fault'; END IF; RETURN NEW; END$$;
      CREATE TRIGGER native_inbound_final_fault BEFORE INSERT ON public.customer_operation_jobs FOR EACH ROW EXECUTE FUNCTION private.native_inbound_final_fault(); SELECT to_jsonb(true);`)
    const before = rows(f)
    await expect(apply(f, inbound)).rejects.toMatchObject({ message: positive ? 'synthetic_final_receipt_fault' : 'synthetic_final_intent_fault' })
    expect(rows(f)).toEqual(before)
    sql(`DROP TRIGGER IF EXISTS native_inbound_final_fault ON public.customer_operation_jobs; DROP FUNCTION IF EXISTS private.native_inbound_final_fault();
      DROP TRIGGER IF EXISTS native_inbound_receipt_fault ON private.gridex_inbound_switch_lifecycle_receipts; DROP FUNCTION IF EXISTS private.native_inbound_receipt_fault(); SELECT to_jsonb(true);`)
    await Promise.all(Array.from({ length: 4 }, () => apply(f, inbound)))
    const after = rows(f)
    const intent = after.customer_operation_jobs.filter(j => String(j.idempotency_key).includes(`ediel:${inbound.id}:`))
    expect(intent).toHaveLength(positive ? 0 : 1)
    expect(after.receipts).toHaveLength(1)
    expect(after.customer_supply_periods).toHaveLength(family === 'PRODAT' ? 1 : 0)
    expect(after.customer_cases).toHaveLength(family !== 'PRODAT' && !positive ? 1 : 0)
    expect(after.supplier_switch_requests.find(s => s.id === switchId)?.status).toBe(positive ? before.supplier_switch_requests.find(s => s.id === switchId)?.status : family === 'PRODAT' ? 'accepted' : 'failed')
    expect(after.customer_application_workflows.find(w => w.id === workflow)?.state).toBe(positive ? 'waiting_for_switch_response' : family === 'PRODAT' ? 'switch_confirmed' : 'switch_rejected')
    expect(after.domain_events.length - before.domain_events.length).toBe(positive ? 0 : 3)
    expect(after.event_outbox.length - before.event_outbox.length).toBe(positive ? 0 : 3)
    expect(after.customer_operation_events.length - before.customer_operation_events.length).toBe(positive ? 0 : 1)
    expect(after.ediel_message_events.length - before.ediel_message_events.length).toBe(family === 'PRODAT' ? 1 : positive ? 2 : 3)
    if (!positive) {
      expect(intent[0]).toMatchObject({ status: 'queued', attempts: 0, metering_point_id: f.point })
      const notification = sql<JobRow>(`SELECT to_jsonb(j) FROM public.customer_operation_jobs j WHERE id=${quote(String(intent[0].id))};`)
      const result = await processJob(notification)
      expect(result).toMatchObject({ status: 'completed', result: { queued: true, eventKey: family === 'PRODAT' ? 'switch.confirmed' : 'switch.action_required' } })
      await updateJob(notification, { status: result.status, result: result.result })
      expect(rows(f).tenant_email_outbox).toEqual([expect.objectContaining({ status: 'queued', attempts: 0, provider_message_id: null })])
    } else {
      // Current Z03 requires both technical CONTRL and application APERAK.
      // The first positive ACK remains partial; only the actual second valid
      // positive response may create a final technical receipt.
      expect(after.ediel_messages.find(s => s.id === origin.id)?.status).toBe('sent')
      const applicationAck = await receive(f, origin, 'APERAK', true)
      await apply(f, applicationAck)
      const complete = rows(f)
      expect(complete.receipts).toHaveLength(2)
      expect(complete.ediel_messages.find(s => s.id === origin.id)?.status).toBe('acknowledged')
      expect(complete.supplier_switch_requests.find(s => s.id === switchId)?.status).toBe('submitted')
      expect(complete.customer_supply_periods).toHaveLength(0); expect(complete.customer_cases).toHaveLength(0)
      expect(complete.domain_events).toEqual(before.domain_events)
      expect(complete.customer_operation_jobs).toEqual(before.customer_operation_jobs)
    }
    const terminal = rows(f); await apply(f, inbound); expect(rows(f)).toEqual(terminal)
    // Revoke an actual current registry prerequisite once. This is a legitimate
    // state transition; no malformed ownership row or forbidden restore is used.
    sql(`UPDATE public.grid_owners SET is_active=false WHERE id=${quote(f.grid)} AND company_id=${quote(f.company)}; SELECT to_jsonb(true);`)
    const changed = rows(f); await expect(apply(f, inbound)).rejects.toBeTruthy(); expect(rows(f)).toEqual(changed)
    expect(transport.encrypted).toBe(transport.calls); expect(forbidden).toBe(0)
    expect(sql<number>(`SELECT to_jsonb(count(*)) FROM public.customer_supply_periods WHERE company_id=${quote(f.company)} AND status='active';`)).toBe(0)
    console.log(`INBOUND_SWITCH_ATOMIC_NATIVE_PASS family=${family} positive=${positive} actual_canonical_producer=true actual_dispatch_owner=true actual_ordinary_writer_capture_denied=true synthetic_nodemailer_only=true smime_storage_hash=true unsent_source_denied=true late_rollback=true concurrent_retry_once=true terminal_replay=true current_graph_recheck=true real_provider_calls=0 supply_activation=0`)
  })
}
