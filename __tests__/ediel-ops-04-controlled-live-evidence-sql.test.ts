// masterplan: OPS-04, AT-OPS-04
//
// Executes the actual OPS-04 forward migration in PGlite. The incident table,
// the shared business actor gate and the TRUNCATE guard are the captured
// definitions from supabase/schema.sql; companies, profiles, memberships,
// permissions, route profiles, counterparties, messages, the tenant operation
// decision and the fresh incident read are declared minimal host stubs. This
// proves the migration's own SQL logic (activation probe, evidence read,
// single-use consumption, immutability, final source/cert/relay/MIME matching).
// The graph lock is a declared no-op port; source freshness and entered attempt
// rows are declared ports, not qualified production entry/source receipts.
// It is not native Supabase/pgcrypto,
// concurrent locking, grants under real roles or a full-stack proof.
import {readFileSync} from 'node:fs'
import {createHash} from 'node:crypto'
import {PGlite} from '@electric-sql/pglite'
import {afterAll, beforeAll, describe, expect, it} from 'vitest'

const schema = readFileSync('supabase/schema.sql', 'utf8')
const migration = readFileSync('supabase/migrations/20261019140000_ediel_ops04_controlled_live_evidence.sql', 'utf8')
const uid = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`
const db = new PGlite()

const C = uid(1), OTHER = uid(2), REPORTER = uid(10), FIXER = uid(11), GRANTOR = uid(12), SENDER = uid(13)
const ROUTE = uid(20), COMM = uid(21), CP = uid(22), PROUTE = uid(23), PCOMM = uid(24), PCP = uid(25)
const INC = uid(30), PINC = uid(31), ORIGINAL = uid(32)
const M1 = uid(40), M2 = uid(41), RESEND = uid(42), P1 = uid(43), P2 = uid(44)
const headers = 'Received: from a.example.invalid by b.example.invalid with ESMTPS id x; Mon, 05 Oct 2026 10:00:01 +0200\r\nAuthentication-Results: b.example.invalid; spf=pass'

function captured(start: string, terminator = '\n--\n') {
  const from = schema.indexOf(start), end = schema.indexOf(terminator, from)
  if (from < 0 || end <= from) throw new Error(`captured_definition_missing:${start}`)
  return schema.slice(from, end + (terminator === '\n);' ? 3 : 0))
}
async function one<T = Record<string, unknown>>(sql: string, params: unknown[] = []) {return (await db.query<T>(sql, params)).rows[0]}
const json = async (sql: string, params: unknown[] = []) => (await one<{r: Record<string, unknown>}>(`SELECT (${sql}) r`, params)).r
async function fails(sql: string, params: unknown[], message: string) {
  if (sql === CONSUME) params = await consumeArgs(params)
  const before = await history()
  await expect(db.query(sql, params)).rejects.toMatchObject({message: expect.stringContaining(message)})
  expect(await history()).toEqual(before)
}
const counts = () => one(`SELECT (SELECT count(*) FROM gridex_ediel_ops04.consumptions)::int consumptions,
  (SELECT count(*) FROM gridex_ediel_ops04.counterparty_agreements)::int agreements,(SELECT count(*) FROM gridex_ediel_ops04.revocations)::int revocations`)
const iso = (ms: number) => new Date(Date.now() + ms).toISOString()
const record = (actor: string, input: Record<string, string>, company = C) =>
  json(`public.gridex_ediel_ops04_record_v1($1,$2,$3::jsonb)`, [company, actor, JSON.stringify(input)])
const probe = (message: string, comm: string | null, env = 'test', company = C) =>
  json(`public.gridex_ediel_ops04_controlled_flow_probe_v1($1,$2,$3,$4)`, [company, env, message, comm])
const evidence = (message: string, incident = INC, route = ROUTE, env = 'test') =>
  json(`public.gridex_ediel_ops04_controlled_live_evidence_v1($1,$2,$3,$4,$5,$6)`, [C, env, SENDER, message, incident, route])
const CONSUME = `SELECT public.gridex_ediel_ops04_consume_controlled_live_v1($1,$2,$3,$4,$5,$6,$7,$8,$9,$10::jsonb) r`
const consume = async (args: unknown[]) => (await one<{r: Record<string, unknown>}>(CONSUME, await consumeArgs(args))).r
let agreement = '', pAgreement = '', mandate = '', pFix = ''

// These are declared host ports, NOT calls to the real generic/Z08 entry RPCs.
// The actual migration must query and match these persisted rows; native entry,
// real source receipts/roles and concurrent waits are a separate producer proof.
type Binding = Record<string, unknown> & {
  message: Record<string, string | null>
  provider: Record<string, string | number>
}
// Exact declared columns read from the synthetic host ports above.
type MessagePort = Record<'id' | 'company_id' | 'direction' | 'environment' | 'communication_route_id' | 'raw_payload' | 'receiver_email' | 'sender_email', string>
  & Record<'original_message_id' | 'sender_ediel_id' | 'receiver_ediel_id', string | null>
type RoutePort = Record<string, unknown> & {id: string; receiver_certificate_id: string | null; certificate_id: string | null}
const hash = (text: string) => createHash('sha256').update(text, 'utf8').digest('hex')
async function bindingFor(messageId: string, lane: 'generic' | 'sealed' = 'generic'): Promise<Binding> {
  const m = await one<MessagePort>('SELECT * FROM public.ediel_messages WHERE id=$1', [messageId])
  const r = await one<RoutePort>('SELECT * FROM public.ediel_route_profiles WHERE communication_route_id=$1', [m.communication_route_id])
  const cert = await one<{id: string; fingerprint_sha256: string}>('SELECT * FROM public.ediel_certificates WHERE id=$1', [r.receiver_certificate_id ?? r.certificate_id])
  const fix = await one<{correction_ref: string}>(`SELECT x.* FROM gridex_ediel_ops04.incident_corrections x WHERE x.environment=$1
    AND NOT EXISTS(SELECT FROM gridex_ediel_ops04.revocations v WHERE v.correction_id=x.id)`, [m.environment])
  const cap = await one<{evidence_ref: string; raw_headers_sha256: string}>(`SELECT x.* FROM gridex_ediel_ops04.relay_captures x WHERE x.route_profile_id=$1
    AND NOT EXISTS(SELECT FROM gridex_ediel_ops04.revocations v WHERE v.capture_id=x.id)`, [r.id])
  const n = Number(messageId.slice(-12)), snapshotId = uid(1000 + n), attemptId = uid(2000 + n)
  const sourceHash = hash(m.raw_payload ?? '')
  const provider = {originalHash: sourceHash, routeId: m.communication_route_id, to: m.receiver_email, from: m.sender_email,
    payloadHash: sourceHash, payloadLength: Buffer.byteLength(m.raw_payload, 'utf8'), encoding: 'utf8', mimeMode: 'attachment',
    mimeSha256: hash(`declared-mime:${messageId}`), mimeLength: 100, mimeArchiveRef: `storage://declared/${messageId}.eml`,
    rfcMessageId: `<${messageId}@example.invalid>`, mimePayloadSnapshotId: snapshotId}
  await db.query(`INSERT INTO public.ediel_message_payloads(id,company_id,ediel_message_id,payload_kind,encrypted_payload_ref,metadata)
    VALUES($1,$2,$3,'raw_mime',$4,$5::jsonb) ON CONFLICT(id) DO NOTHING`, [snapshotId, m.company_id, messageId, provider.mimeArchiveRef,
      JSON.stringify({archive_verified: true, archived_mime_sha256: provider.mimeSha256, archived_mime_bytes: provider.mimeLength, archived_rfc_message_id: provider.rfcMessageId})])
  if (lane === 'generic') {
    await db.query(`INSERT INTO gridex_ediel_transport.attempts(id,message_id,company_id,environment,actor_user_id,binding,entered_at)
      VALUES($1,$2,$3,$4,$5,$6::jsonb,clock_timestamp()) ON CONFLICT(id) DO NOTHING`, [attemptId, messageId, m.company_id, m.environment, SENDER, JSON.stringify(provider)])
    await db.query(`INSERT INTO gridex_ediel_transport.reservations VALUES($1,$2,'entered') ON CONFLICT(message_id) DO NOTHING`, [messageId, attemptId])
  } else {
    await db.query(`INSERT INTO gridex_outbound_dispatch.attempts(id,message_id,company_id,environment,actor_user_id,binding)
      VALUES($1,$2,$3,$4,$5,$6::jsonb) ON CONFLICT(id) DO NOTHING`, [attemptId, messageId, m.company_id, m.environment, SENDER, JSON.stringify(provider)])
    await db.query(`INSERT INTO gridex_outbound_dispatch.reservations VALUES($1,$2,'provider_call_entered') ON CONFLICT(message_id) DO NOTHING`, [messageId, attemptId])
    await db.query(`INSERT INTO gridex_outbound_dispatch.events(id,message_id,attempt_id,company_id,environment,kind)
      VALUES($1,$2,$3,$4,$5,'provider_call_entered') ON CONFLICT(id) DO NOTHING`, [uid(3000 + n), messageId, attemptId, m.company_id, m.environment])
  }
  return {message: {id: m.id, companyId: m.company_id, environment: m.environment, direction: m.direction,
    communicationRouteId: m.communication_route_id, originalMessageId: m.original_message_id, sourcePayloadHash: sourceHash,
    recipient: m.receiver_email, senderEdielId: m.sender_ediel_id, receiverEdielId: m.receiver_ediel_id},
    routeProfile: r, certificateId: cert.id, certificateFingerprint: cert.fingerprint_sha256.replace(/[:\s]/g, '').toLowerCase(),
    correctionRef: fix?.correction_ref ?? 'missing', relayEvidenceRef: cap?.evidence_ref ?? 'missing', relayHeadersHash: cap?.raw_headers_sha256 ?? '0'.repeat(64), provider}
}
async function consumeArgs(args: unknown[]): Promise<unknown[]> {
  return args.length === 10 ? args : [...args, JSON.stringify(await bindingFor(String(args[3])))]
}
const history = () => one(`SELECT jsonb_build_object(
  'corrections',(SELECT coalesce(jsonb_agg(to_jsonb(x) ORDER BY id),'[]') FROM gridex_ediel_ops04.incident_corrections x),
  'agreements',(SELECT coalesce(jsonb_agg(to_jsonb(x) ORDER BY id),'[]') FROM gridex_ediel_ops04.counterparty_agreements x),
  'mandates',(SELECT coalesce(jsonb_agg(to_jsonb(x) ORDER BY id),'[]') FROM gridex_ediel_ops04.live_mandates x),
  'captures',(SELECT coalesce(jsonb_agg(to_jsonb(x) ORDER BY id),'[]') FROM gridex_ediel_ops04.relay_captures x),
  'revocations',(SELECT coalesce(jsonb_agg(to_jsonb(x) ORDER BY id),'[]') FROM gridex_ediel_ops04.revocations x),
  'consumptions',(SELECT coalesce(jsonb_agg(to_jsonb(x) ORDER BY id),'[]') FROM gridex_ediel_ops04.consumptions x)) snapshot`)


beforeAll(async () => {
  await db.exec(`CREATE ROLE anon; CREATE ROLE authenticated; CREATE ROLE service_role;
    CREATE SCHEMA auth; CREATE TABLE auth.users(id uuid PRIMARY KEY);
    CREATE TABLE public.companies(id uuid PRIMARY KEY,status text,is_active boolean);
    CREATE TABLE public.user_profiles(id uuid PRIMARY KEY,user_status text);
    CREATE TABLE public.company_memberships(company_id uuid,user_id uuid,status text,is_active boolean,accepted_at timestamptz);
    CREATE TABLE public.unit_permissions(actor uuid,company_id uuid,permission text);
    CREATE FUNCTION public.gridex_actor_has_company_permission(p_actor_user_id uuid,p_company_id uuid,p_permission text) RETURNS boolean LANGUAGE sql STABLE AS
     $$SELECT EXISTS(SELECT FROM public.unit_permissions WHERE actor=p_actor_user_id AND company_id=p_company_id AND permission=p_permission)$$;
    CREATE TABLE public.unit_live(company_id uuid PRIMARY KEY);
    CREATE FUNCTION public.canonical_tenant_operation_decision(p_company_id uuid,p_operation text) RETURNS TABLE(allowed boolean,reason_code text) LANGUAGE sql STABLE AS
     $$SELECT p_operation='ediel.production.send' AND EXISTS(SELECT FROM public.unit_live WHERE company_id=p_company_id),'unit'::text$$;
    CREATE SCHEMA gridex_ediel_ack_replay;
    CREATE FUNCTION gridex_ediel_ack_replay.lock_current_graph_v2() RETURNS void LANGUAGE plpgsql AS $$BEGIN RETURN;END$$;
    CREATE TABLE public.unit_unavailable_incident(incident_id uuid PRIMARY KEY);
    CREATE FUNCTION public.ediel_read_fresh_business_incident_v1(p_company_id uuid,p_actor_user_id uuid,p_incident_id uuid) RETURNS jsonb LANGUAGE plpgsql AS
     $$BEGIN IF EXISTS(SELECT FROM public.unit_unavailable_incident WHERE incident_id=p_incident_id) THEN RAISE EXCEPTION 'declared_incident_source_unavailable';END IF;RETURN '{}'::jsonb;END$$;
    CREATE TABLE public.ediel_counterparties(id uuid PRIMARY KEY,company_id uuid,environment text,is_active boolean,lifecycle_status text);
    CREATE TABLE public.ediel_route_profiles(id uuid PRIMARY KEY,company_id uuid,communication_route_id uuid,is_enabled boolean,is_active boolean,environment text,counterparty_id uuid,transport_profile_id uuid,receiver_certificate_id uuid,certificate_id uuid);
    CREATE TABLE public.ediel_messages(id uuid PRIMARY KEY,company_id uuid,direction text,environment text,communication_route_id uuid,route_profile_id uuid,original_message_id text,
      raw_payload text,receiver_email text,sender_email text,sender_ediel_id text,receiver_ediel_id text);
    CREATE TABLE public.ediel_certificates(id uuid PRIMARY KEY,company_id uuid,environment text,status text,fingerprint_sha256 text,certificate_fingerprint text,
      valid_from timestamptz,valid_to timestamptz,certificate_valid_from timestamptz,certificate_valid_to timestamptz);
    CREATE TABLE public.ediel_transport_profiles(id uuid PRIMARY KEY,company_id uuid,environment text,is_active boolean);
    CREATE TABLE public.ediel_message_payloads(id uuid PRIMARY KEY,company_id uuid,ediel_message_id uuid,payload_kind text,encrypted_payload_ref text,metadata jsonb);
    CREATE SCHEMA gridex_ediel_transport; CREATE SCHEMA gridex_outbound_dispatch;
    CREATE TABLE gridex_ediel_transport.attempts(id uuid PRIMARY KEY,message_id uuid,company_id uuid,environment text,actor_user_id uuid,binding jsonb,
      entered_at timestamptz,observed_at timestamptz,classification text);
    CREATE TABLE gridex_ediel_transport.reservations(message_id uuid PRIMARY KEY,attempt_id uuid,state text);
    CREATE TABLE gridex_outbound_dispatch.attempts(id uuid PRIMARY KEY,message_id uuid,company_id uuid,environment text,actor_user_id uuid,binding jsonb);
    CREATE TABLE gridex_outbound_dispatch.reservations(message_id uuid PRIMARY KEY,attempt_id uuid,state text);
    CREATE TABLE gridex_outbound_dispatch.events(id uuid PRIMARY KEY,message_id uuid,attempt_id uuid,company_id uuid,environment text,kind text);
    CREATE SCHEMA gridex_ediel_duplicate_responses; CREATE SCHEMA gridex_ediel_business_incidents;`)
  await db.exec(captured('CREATE FUNCTION gridex_ediel_duplicate_responses.require_business_read_actor_v1('))
  await db.exec(captured('CREATE FUNCTION public.gridex_guard_history_truncate_v1()'))
  await db.exec(captured('CREATE TABLE gridex_ediel_business_incidents.incidents (', '\n);'))
  await db.exec('ALTER TABLE gridex_ediel_business_incidents.incidents ADD PRIMARY KEY (id)')
  await db.exec(migration)

  const users = [REPORTER, FIXER, GRANTOR, SENDER]
  for (const u of users) {
    await db.query(`INSERT INTO auth.users VALUES($1)`, [u])
    await db.query(`INSERT INTO public.user_profiles VALUES($1,'active')`, [u])
  }
  await db.query(`INSERT INTO public.companies VALUES($1,'active',true),($2,'active',true)`, [C, OTHER])
  for (const u of users) await db.query(`INSERT INTO public.company_memberships VALUES($1,$2,'active',true,now())`, [C, u])
  for (const [u, p] of [[REPORTER, 'communication.write'], [FIXER, 'communication.write'], [GRANTOR, 'communication.send'], [GRANTOR, 'ediel.send'], [SENDER, 'communication.send']])
    await db.query(`INSERT INTO public.unit_permissions VALUES($1,$2,$3)`, [u, C, p])
  await db.query(`INSERT INTO public.unit_live VALUES($1)`, [C])
  await db.query(`INSERT INTO public.ediel_counterparties VALUES($1,$3,'test',true,'active'),($2,$3,'production',true,'active')`, [CP, PCP, C])
  await db.query(`INSERT INTO public.ediel_route_profiles(id,company_id,communication_route_id,is_enabled,is_active,environment,counterparty_id) VALUES($1,$5,$2,true,true,'test',$3),($4,$5,$6,true,true,'production',$7)`, [ROUTE, COMM, CP, PROUTE, C, PCOMM, PCP])
  await db.query(`INSERT INTO public.ediel_messages(id,company_id,direction,environment,communication_route_id,route_profile_id,original_message_id) VALUES($1,$5,'outbound','test',$6,NULL,NULL),($2,$5,'outbound','test',$6,NULL,NULL),($3,$5,'outbound','test',$6,NULL,$7),
    ($4,$5,'outbound','production',$8,NULL,NULL),($9,$5,'outbound','production',$8,NULL,NULL)`, [M1, M2, RESEND, P1, C, COMM, ORIGINAL, PCOMM, P2])
  await db.query(`INSERT INTO public.ediel_certificates(id,company_id,environment,status,fingerprint_sha256,certificate_fingerprint,valid_from,valid_to)
    VALUES($1,$3,'test','active',$4,$4,now()-interval '1 day',now()+interval '1 day'),($2,$3,'production','active',$4,$4,now()-interval '1 day',now()+interval '1 day')`, [uid(50),uid(51),C,'b'.repeat(64)])
  await db.query(`INSERT INTO public.ediel_transport_profiles VALUES($1,$3,'test',true),($2,$3,'production',true)`, [uid(52),uid(53),C])
  await db.query(`UPDATE public.ediel_route_profiles SET receiver_certificate_id=CASE environment WHEN 'test' THEN $1::uuid ELSE $2::uuid END,
    transport_profile_id=CASE environment WHEN 'test' THEN $3::uuid ELSE $4::uuid END`, [uid(50),uid(51),uid(52),uid(53)])
  await db.query(`UPDATE public.ediel_messages SET raw_payload='UNB+declared-original',receiver_email='receiver@example.invalid',sender_email='sender@example.invalid',sender_ediel_id='sender',receiver_ediel_id='receiver'`)
  const hash = 'a'.repeat(64)
  await db.query(`INSERT INTO gridex_ediel_business_incidents.incidents(id,company_id,environment,command_id,actor_user_id,source_message_id,ack_message_id,source_hash,ack_hash,scope,source_context,transport_receipt,input)
    VALUES($1,$3,'test',gen_random_uuid(),$4,$5,gen_random_uuid(),$6,$6,'{}','{}','{}','{}'),($2,$3,'production',gen_random_uuid(),$4,$5,gen_random_uuid(),$6,$6,'{}','{}','{}','{}')`, [INC, PINC, C, REPORTER, ORIGINAL, hash])
})
afterAll(async () => db.close())

describe('OPS-04 controlled live evidence migration (PGlite, declared host stubs)', () => {
  it('starts empty: nothing is seeded and no route is controlled', async () => {
    expect(await counts()).toEqual({consumptions: 0, agreements: 0, revocations: 0})
    expect(await probe(M1, COMM)).toEqual({companyId: C, environment: 'test', messageId: M1, controlled: false})
  })

  it('records independent evidence; the reporter cannot correct its own incident', async () => {
    await expect(record(REPORTER, {kind: 'incident_correction', commandId: uid(100), incidentId: INC, correctionRef: 'fix'})).rejects.toThrow('ediel_ops04_independent_correction_actor_required')
    await record(FIXER, {kind: 'incident_correction', commandId: uid(101), incidentId: INC, correctionRef: 'fix-1'})
    agreement = String((await record(FIXER, {kind: 'counterparty_agreement', commandId: uid(102), routeProfileId: ROUTE, counterpartyId: CP,
      agreementRef: 'agr-1', validFrom: iso(-3600e3), validTo: iso(3600e3)})).id)
    await record(FIXER, {kind: 'relay_capture', commandId: uid(103), routeProfileId: ROUTE, evidenceRef: 'relay-1', rawHeaders: headers})
    await expect(record(FIXER, {kind: 'relay_capture', commandId: uid(104), routeProfileId: PROUTE, evidenceRef: 'relay-x', rawHeaders: `Authorization: Bearer x\r\n${headers}`}))
      .rejects.toThrow()
  })

  it('activation is server-side: the bound route is controlled, other routes and companies are not', async () => {
    expect((await probe(M1, COMM)).controlled).toBe(true)
    expect((await probe(M1, null)).controlled).toBe(true) // stored message route still binds
    expect((await probe(P1, PCOMM, 'production')).controlled).toBe(false)
    expect((await probe(M1, COMM, 'test', OTHER)).controlled).toBe(false)
  })

  it('the evidence read returns the bound, unconsumed agreement with its id', async () => {
    const read = await evidence(M1)
    expect(read).toMatchObject({companyId: C, environment: 'test', incidentId: INC, routeProfileId: ROUTE,
      incidentCorrection: {companyId: C, incidentId: INC, correctionRef: 'fix-1'},
      counterpartyAgreement: {id: agreement, routeId: ROUTE, counterpartyId: CP, consumedByMessageId: null}, liveMandate: null,
      relayCapture: {evidenceRef: 'relay-1', rawHeaders: headers}})
  })

  it('holds stale or unentered final bindings without changing any evidence history', async () => {
    const bound = await bindingFor(M2)
    const args = [C, 'test', SENDER, M2, INC, ROUTE, agreement, null, false]
    const held = (binding: Binding, error: string) => fails(CONSUME, [...args, JSON.stringify(binding)], error)
    const changed = (edit: (copy: Binding) => void) => {const copy = structuredClone(bound); edit(copy); return copy}
    await held({...bound, ready: true}, 'ediel_ops04_binding_invalid')
    await held(changed(b => {b.provider.rawBase64 = 'untrusted'}), 'ediel_ops04_binding_invalid')
    await held(changed(b => {b.message.originalMessageId = ORIGINAL}), 'ediel_ops04_source_binding_changed')
    await db.query(`UPDATE public.ediel_messages SET raw_payload='changed-source' WHERE id=$1`, [M2])
    await held(bound, 'ediel_ops04_source_binding_changed')
    await db.query(`UPDATE public.ediel_messages SET raw_payload='UNB+declared-original' WHERE id=$1`, [M2])
    await db.query(`UPDATE public.ediel_route_profiles SET certificate_id=$1 WHERE id=$2`, [uid(51), ROUTE])
    await held(bound, 'ediel_ops04_source_binding_changed')
    await db.query(`UPDATE public.ediel_route_profiles SET certificate_id=NULL WHERE id=$1`, [ROUTE])
    await db.query(`UPDATE public.ediel_certificates SET fingerprint_sha256=$1 WHERE id=$2`, ['c'.repeat(64), uid(50)])
    await held(bound, 'ediel_ops04_current_certificate_required')
    await db.query(`UPDATE public.ediel_certificates SET fingerprint_sha256=$1 WHERE id=$2`, ['b'.repeat(64), uid(50)])
    await db.query(`UPDATE public.ediel_certificates SET valid_to=clock_timestamp()-interval '1 second' WHERE id=$1`, [uid(50)])
    await held(bound, 'ediel_ops04_current_certificate_required')
    await db.query(`UPDATE public.ediel_certificates SET valid_to=clock_timestamp()+interval '1 day' WHERE id=$1`, [uid(50)])
    await db.query(`UPDATE public.ediel_transport_profiles SET is_active=false WHERE id=$1`, [uid(52)])
    await held(bound, 'ediel_ops04_current_transport_profile_required')
    await db.query(`UPDATE public.ediel_transport_profiles SET is_active=true WHERE id=$1`, [uid(52)])
    await db.query(`UPDATE public.ediel_counterparties SET is_active=false WHERE id=$1`, [CP])
    await held(bound, 'ediel_ops04_route_counterparty_required')
    await db.query(`UPDATE public.ediel_counterparties SET is_active=true WHERE id=$1`, [CP])
    await db.query(`INSERT INTO public.unit_unavailable_incident VALUES($1)`, [INC])
    await held(bound, 'declared_incident_source_unavailable')
    await db.query(`DELETE FROM public.unit_unavailable_incident`)
    await held(changed(b => {b.correctionRef = 'different-correction'}), 'ediel_ops04_correction_binding_changed')
    await held(changed(b => {b.relayHeadersHash = 'c'.repeat(64)}), 'ediel_ops04_capture_binding_changed')
    await held(changed(b => {b.provider.mimeSha256 = 'c'.repeat(64)}), 'ediel_ops04_entered_archive_required')
    await held(changed(b => {b.provider.payloadHash = 'c'.repeat(64)}), 'ediel_ops04_entered_attempt_required')
    await db.query(`UPDATE gridex_ediel_transport.reservations SET state='prepared' WHERE message_id=$1`, [M2])
    await held(bound, 'ediel_ops04_entered_attempt_required')
    await db.query(`UPDATE gridex_ediel_transport.reservations SET state='entered' WHERE message_id=$1`, [M2])
    for (const classification of ['accepted', 'unknown']) {
      await db.query(`UPDATE gridex_ediel_transport.attempts SET observed_at=clock_timestamp(),classification=$2 WHERE message_id=$1`, [M2, classification])
      await held(bound, 'ediel_ops04_entered_attempt_required')
    }
    await db.query(`UPDATE gridex_ediel_transport.attempts SET observed_at=NULL,classification=NULL WHERE message_id=$1`, [M2])
  })

  it('rechecks a relay revoked after assessment and rejects replacement of its issued identity', async () => {
    const bound = await bindingFor(M2)
    const cap = await one<{id: string}>(`SELECT id FROM gridex_ediel_ops04.relay_captures WHERE route_profile_id=$1`, [ROUTE])
    await db.query(`SELECT public.gridex_ediel_ops04_revoke_v1($1,$2,$3::jsonb)`, [C, FIXER,
      JSON.stringify({commandId: uid(105), subjectKind: 'relay_capture', subjectId: cap.id, reasonRef: 'withdrawn-before-final-use'})])
    const args = [C, 'test', SENDER, M2, INC, ROUTE, agreement, null, false, JSON.stringify(bound)]
    await fails(CONSUME, args, 'ediel_ops04_current_capture_required')
    await record(FIXER, {kind: 'relay_capture', commandId: uid(106), routeProfileId: ROUTE, evidenceRef: 'relay-2', rawHeaders: headers})
    await fails(CONSUME, args, 'ediel_ops04_capture_binding_changed')
  })

  it('consumes the agreement exactly once; a retry of the same message is idempotent; a second message is refused', async () => {
    const first = await consume([C, 'test', SENDER, M1, INC, ROUTE, agreement, null, false])
    expect(first).toMatchObject({messageId: M1, agreementId: agreement, mandateId: null, replayed: false})
    expect(await consume([C, 'test', SENDER, M1, INC, ROUTE, agreement, null, false])).toMatchObject({consumptionId: first.consumptionId, replayed: true})
    await fails(CONSUME, [C, 'test', SENDER, M2, INC, ROUTE, agreement, null, false], 'ediel_ops04_authorization_consumed')
    expect((await evidence(M2)).counterpartyAgreement).toMatchObject({consumedByMessageId: M1})
    await fails(CONSUME, [C, 'test', SENDER, M1, INC, ROUTE, agreement, null, true], 'ediel_ops04_resend_original_mismatch')
  })

  it('consumption rows are immutable', async () => {
    await expect(db.query('UPDATE gridex_ediel_ops04.consumptions SET resend=true')).rejects.toThrow('ediel_ops04_evidence_immutable')
    await expect(db.query('DELETE FROM gridex_ediel_ops04.consumptions')).rejects.toThrow('ediel_ops04_evidence_immutable')
  })

  it('revocation ends activation; a resend must be the incident source original; refusals write nothing', async () => {
    await db.query(`SELECT public.gridex_ediel_ops04_revoke_v1($1,$2,$3::jsonb)`, [C, FIXER, JSON.stringify({commandId: uid(110), subjectKind: 'counterparty_agreement', subjectId: agreement, reasonRef: 'used'})])
    expect((await probe(M2, COMM)).controlled).toBe(false)
    expect((await probe(M1, COMM)).controlled).toBe(true) // a consumed message stays controlled
    const next = String((await record(FIXER, {kind: 'counterparty_agreement', commandId: uid(111), routeProfileId: ROUTE, counterpartyId: CP,
      agreementRef: 'agr-2', validFrom: iso(-60e3), validTo: iso(3600e3)})).id)
    await fails(CONSUME, [C, 'test', SENDER, M2, INC, ROUTE, next, null, true], 'ediel_ops04_resend_original_mismatch')
    // An already consumed message cannot be rebound to a fresh agreement.
    await fails(CONSUME, [C, 'test', SENDER, M1, INC, ROUTE, next, null, false], 'ediel_ops04_consumption_conflict')
    expect(await consume([C, 'test', SENDER, RESEND, INC, ROUTE, next, null, true])).toMatchObject({messageId: RESEND, agreementId: next, replayed: false})
    await fails(CONSUME, [C, 'test', SENDER, M2, INC, ROUTE, agreement, null, false], 'ediel_ops04_current_agreement_required')
  })

  it('production requires a current mandate from an independent live grantor and consumes it once', async () => {
    pFix = String((await record(FIXER, {kind: 'incident_correction', commandId: uid(120), incidentId: PINC, correctionRef: 'pfix'})).id)
    pAgreement = String((await record(FIXER, {kind: 'counterparty_agreement', commandId: uid(121), routeProfileId: PROUTE, counterpartyId: PCP,
      agreementRef: 'pagr', validFrom: iso(-60e3), validTo: iso(3600e3)})).id)
    await db.query(`INSERT INTO public.unit_permissions VALUES($1,$2,'ediel.send')`, [FIXER, C])
    await expect(record(FIXER, {kind: 'live_mandate', commandId: uid(122), incidentId: PINC, correctionId: pFix, mandateRef: 'm', validFrom: iso(-60e3), validTo: iso(3600e3)})).rejects.toThrow('ediel_ops04_independent_mandate_actor_required')
    await db.query(`DELETE FROM public.unit_permissions WHERE actor=$1 AND permission='ediel.send'`, [FIXER])
    mandate = String((await record(GRANTOR, {kind: 'live_mandate', commandId: uid(123), incidentId: PINC, correctionId: pFix, mandateRef: 'mandate-1',
      validFrom: iso(-60e3), validTo: iso(3600e3)})).id)
    await record(FIXER, {kind: 'relay_capture', commandId: uid(124), routeProfileId: PROUTE, evidenceRef: 'prelay', rawHeaders: headers})
    expect((await probe(P1, PCOMM, 'production')).controlled).toBe(true)
    expect((await evidence(P1, PINC, PROUTE, 'production')).liveMandate).toMatchObject({id: mandate, incidentId: PINC, consumedByMessageId: null})
    await fails(CONSUME, [C, 'production', SENDER, P1, PINC, PROUTE, pAgreement, null, false], 'ediel_ops04_scope_required')
    expect(await consume([C, 'production', SENDER, P1, PINC, PROUTE, pAgreement, mandate, false])).toMatchObject({mandateId: mandate, replayed: false})
    await fails(CONSUME, [C, 'production', SENDER, P2, PINC, PROUTE, pAgreement, mandate, false], 'ediel_ops04_authorization_consumed')
  })

  it('a grantor who lost LIVE authority no longer authorises consumption', async () => {
    await db.query(`DELETE FROM public.unit_live`)
    expect((await evidence(P1, PINC, PROUTE, 'production')).liveMandate).toBeNull()
    await fails(CONSUME, [C, 'production', SENDER, P2, PINC, PROUTE, pAgreement, mandate, false], 'ediel_ops04_current_mandate_required')
  })

  it('an actor without send authority cannot read or consume', async () => {
    await fails(CONSUME, [C, 'test', FIXER, M2, INC, ROUTE, agreement, null, false], 'ediel_ops04_actor_forbidden')
    await expect(db.query(`SELECT public.gridex_ediel_ops04_controlled_live_evidence_v1($1,'test',$2,$3,$4,$5)`, [C, FIXER, M2, INC, ROUTE])).rejects.toThrow('ediel_ops04_actor_forbidden')
  })
  it('uses the final current clock for already-expired persisted authority', async () => {
    // Declared historical fixture: this bypasses the record RPC intentionally
    // to represent an immutable agreement that has expired since it was issued.
    const expired = uid(400)
    await db.query(`INSERT INTO gridex_ediel_ops04.counterparty_agreements(id,company_id,environment,route_profile_id,counterparty_id,
      agreement_ref,valid_from,valid_to,command_id,actor_user_id,input)
      VALUES($1,$2,'test',$3,$4,'historical-expired',clock_timestamp()-interval '2 hours',clock_timestamp()-interval '1 hour',$5,$6,'{}')`,
      [expired, C, ROUTE, CP, uid(401), FIXER])
    await fails(CONSUME, [C, 'test', SENDER, M2, INC, ROUTE, expired, null, false], 'ediel_ops04_current_agreement_required')
    // Expiry DURING a concurrent lock wait needs two real connections; this
    // single-connection component does not claim to qualify that property.
  })

  it('qualifies declared sealed-entry ports and keeps a consumption after provider uncertainty', async () => {
    const current = await one<{id: string}>(`SELECT a.id FROM gridex_ediel_ops04.counterparty_agreements a WHERE a.route_profile_id=$1
      AND a.valid_to>clock_timestamp() AND NOT EXISTS(SELECT FROM gridex_ediel_ops04.revocations v WHERE v.agreement_id=a.id)`, [ROUTE])
    await db.query(`SELECT public.gridex_ediel_ops04_revoke_v1($1,$2,$3::jsonb)`, [C, FIXER,
      JSON.stringify({commandId: uid(410), subjectKind: 'counterparty_agreement', subjectId: current.id, reasonRef: 'next-declared-trial'})])
    const next = String((await record(FIXER, {kind: 'counterparty_agreement', commandId: uid(411), routeProfileId: ROUTE, counterpartyId: CP,
      agreementRef: 'sealed-trial', validFrom: iso(-60e3), validTo: iso(3600e3)})).id)
    // Replace declared host entry rows, not production history. The real
    // sealed/generic entry RPCs and their immutable history are native scope.
    await db.query(`DELETE FROM gridex_ediel_transport.reservations WHERE message_id=$1`, [M2])
    await db.query(`DELETE FROM gridex_ediel_transport.attempts WHERE message_id=$1`, [M2])
    const bound = await bindingFor(M2, 'sealed')
    const args = [C, 'test', SENDER, M2, INC, ROUTE, next, null, false, JSON.stringify(bound)]
    await db.query(`UPDATE gridex_outbound_dispatch.reservations SET state='prepared' WHERE message_id=$1`, [M2])
    await fails(CONSUME, args, 'ediel_ops04_entered_attempt_required')
    await db.query(`UPDATE gridex_outbound_dispatch.reservations SET state='provider_call_entered' WHERE message_id=$1`, [M2])
    const first = await consume(args)
    expect(first).toMatchObject({messageId: M2, agreementId: next, replayed: false})
    const durable = await one<{binding: Record<string, unknown>}>(`SELECT binding FROM gridex_ediel_ops04.consumptions WHERE message_id=$1`, [M2])
    expect(durable.binding).toMatchObject({lane: 'sealed_z08', attemptId: uid(2041), relayEvidenceRef: 'relay-2', provider: bound.provider})
    expect(durable.binding).not.toHaveProperty('routeProfile')
    expect(durable.binding).not.toHaveProperty('rawHeaders')
    const before = await history()
    await db.query(`INSERT INTO gridex_outbound_dispatch.events VALUES($1,$2,$3,$4,'test','provider_result')`, [uid(420), M2, uid(2041), C])
    await fails(CONSUME, args, 'ediel_ops04_entered_attempt_required')
    expect(await history()).toEqual(before) // provider uncertainty cannot undo consumption or grant a second use
  })

})
