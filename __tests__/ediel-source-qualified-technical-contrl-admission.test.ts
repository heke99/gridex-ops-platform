// masterplan: TR-09, AT-TR-09
// Component boundary: the real captured journal and constraints execute against
// declared private-source/permission ports. The V2 port below is a test double,
// not native qualification, a syntax oracle, or evidence of market activation.
// This PGlite build cannot execute LATIN1 conversion. The declared overload
// below accepts only ASCII (identical bytes in UTF8/LATIN1) and refuses all
// other LATIN1 input. Native original-21 must prove the actual conversion path.
import {execFileSync} from 'node:child_process'
import {createHash} from 'node:crypto'
import {existsSync, readFileSync} from 'node:fs'
import {PGlite} from '@electric-sql/pglite'
import {afterAll, beforeAll, beforeEach, expect, it} from 'vitest'

const schema = execFileSync('git', ['show', '9b013631afed0b7de5f704fdc759bc68624d92b5:supabase/schema.sql'], {encoding: 'utf8', maxBuffer: 32 * 1024 * 1024})
const forward = 'supabase/migrations/20261007154601_ediel_source_qualified_technical_contrl_admission.sql'
const signature = 'gridex_ediel_transport.mutate_before_service_origin_v1(jsonb)'
const db = new PGlite()
const uid = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`
const raw = "UNB+UNOC:3+99002+99001+261007:1200+ACK1'UNH+1+CONTRL:2:2:UN'UCI+SOURCE1+99001+99002+1'UNT+3+1'UNZ+1+ACK1'"
const hash = (s: string, encoding: 'utf8' | 'latin1' = 'utf8') => createHash('sha256').update(s, encoding).digest('hex')
const input = (action = 'prepare') => ({companyId: uid(1), environment: 'production', messageId: uid(3), actorUserId: uid(2), attemptId: uid(4), action, owner: {kind: 'direct'}, binding: {
  originalHash: hash(raw), routeId: uid(5), to: 'receiver@example.invalid', from: 'sender@example.invalid', payloadHash: hash(raw, 'latin1'), mimeSha256: hash('declared archived MIME'), rfcMessageId: '<component@example.invalid>', mimeArchiveRef: 'component/mime', mimeLength: 23, payloadLength: Buffer.byteLength(raw, 'latin1'), mimeMode: 'smime', encoding: 'latin1',
}})
function table(name: string) {
  const start = schema.indexOf(`CREATE TABLE ${name} (`), end = schema.indexOf('\n);', start)
  if (start < 0 || end <= start) throw new Error(`component_table_missing:${name}`)
  return schema.slice(start, end + 3)
}
function journalDefinition() {
  const start = schema.indexOf(`CREATE FUNCTION ${signature.split('(')[0]}(`)
  const marker = schema.slice(start).match(/\bAS (\$[^$]*\$)/)
  if (start < 0 || !marker || marker.index === undefined) throw new Error('component_journal_missing')
  const bodyStart = start + marker.index + marker[0].length
  const end = schema.indexOf(`${marker[1]};`, bodyStart)
  if (end < 0) throw new Error('component_journal_end_missing')
  expect(hash(schema.slice(bodyStart, end))).toBe('0c8f52291b620b8584a4182ba851f58fca1b30d1b7f3dbbc75e2700376fc5348')
  return schema.slice(start, end + marker[1].length + 1)
}
async function call(body: unknown) {
  return (await db.query<{result: Record<string, unknown>}>(`SELECT ${signature.split('(')[0]}($1::jsonb) result`, [JSON.stringify(body)])).rows[0].result
}
async function image() {
  const out: Record<string, unknown> = {}
  for (const name of ['public.ediel_messages', 'public.ediel_message_payloads', 'public.user_profiles', 'public.company_memberships', 'public.companies', 'component.controls', 'component.protected_source', 'gridex_ediel_transport.attempts', 'gridex_ediel_transport.reservations']) {
    out[name] = (await db.query(`SELECT to_jsonb(t) row FROM ${name} t ORDER BY to_jsonb(t)::text`)).rows
  }
  return out
}
async function refusal(body: unknown, reason: string) {
  const before = await image()
  await expect(call(body)).rejects.toThrow(reason)
  expect(await image()).toEqual(before)
}
const metadata = () => db.query("SELECT to_jsonb(p)-'prosrc' metadata FROM pg_proc p WHERE oid=$1::regprocedure", [signature])
let originalMetadata: unknown
let firstDefinitions: unknown

beforeAll(async () => {
  await db.exec(`CREATE ROLE service_role; CREATE SCHEMA component; CREATE SCHEMA gridex_ediel_transport;
    CREATE SCHEMA gridex_ediel_technical_ack; CREATE SCHEMA gridex_outbound_dispatch;
    CREATE TABLE public.user_profiles(id uuid PRIMARY KEY,user_status text);
    CREATE TABLE public.company_memberships(company_id uuid,user_id uuid,status text,is_active boolean,accepted_at timestamptz);
    CREATE TABLE public.companies(id uuid PRIMARY KEY,status text,is_active boolean);
    CREATE TABLE component.controls(id integer PRIMARY KEY,permission boolean,business_allowed boolean,qualified boolean,projection jsonb);
    CREATE TABLE component.protected_source(id uuid PRIMARY KEY,message jsonb,source_id uuid,syntax_decision text);
    CREATE FUNCTION pg_catalog.convert_to(payload text,encoding text) RETURNS bytea LANGUAGE plpgsql IMMUTABLE STRICT AS $$BEGIN
      IF encoding NOT IN('UTF8','LATIN1') OR encoding='LATIN1' AND payload ~ '[^\\x01-\\x7f]' THEN
        RAISE EXCEPTION 'component_ascii_conversion_scope_required'; END IF;
      RETURN pg_catalog.convert_to(payload,'UTF8'::name);
    END$$;
    CREATE FUNCTION public.gridex_actor_has_company_permission(uuid,uuid,text) RETURNS boolean LANGUAGE sql AS $$SELECT permission FROM component.controls$$;
    CREATE FUNCTION public.canonical_tenant_operation_decision(uuid,text) RETURNS TABLE(allowed boolean) LANGUAGE sql AS $$SELECT business_allowed FROM component.controls$$;
    CREATE FUNCTION public.ediel_require_scoped_capability_for_message_v1(uuid,uuid) RETURNS void LANGUAGE plpgsql AS $$BEGIN RETURN; END$$;
    CREATE FUNCTION gridex_ediel_transport.dsn_sending_mailbox_v1(uuid,text,text) RETURNS uuid LANGUAGE sql AS $$SELECT '00000000-0000-4000-8000-000000000008'::uuid$$;
    CREATE FUNCTION gridex_outbound_dispatch.mutate_v1(jsonb) RETURNS jsonb LANGUAGE sql AS $$SELECT '{"scoped":false}'::jsonb$$;
    CREATE FUNCTION gridex_ediel_technical_ack.read_persisted_contrl_v2(c uuid,env text,mid uuid,actor uuid,phase text) RETURNS jsonb LANGUAGE plpgsql AS $$
    DECLARE s component.protected_source%rowtype; overrides jsonb; BEGIN
      IF NOT EXISTS(SELECT FROM public.companies WHERE id=c AND status='active' AND is_active)
        OR NOT EXISTS(SELECT FROM public.user_profiles WHERE id=actor AND user_status='active')
        OR NOT EXISTS(SELECT FROM public.company_memberships WHERE company_id=c AND user_id=actor AND status='active' AND is_active AND accepted_at IS NOT NULL)
        OR public.gridex_actor_has_company_permission(actor,c,'ediel.send') IS DISTINCT FROM true THEN
        RAISE EXCEPTION 'component_current_source_actor_required'; END IF;
      SELECT * INTO s FROM component.protected_source WHERE id=mid;
      SELECT projection INTO overrides FROM component.controls;
      IF overrides='{"returnSqlNull":true}'::jsonb THEN RETURN NULL; END IF;
      IF s.id IS NULL OR NOT (SELECT qualified FROM component.controls) OR s.message->>'company_id' IS DISTINCT FROM c::text OR s.message->>'environment' IS DISTINCT FROM env THEN
        RAISE EXCEPTION 'component_protected_original_unavailable'; END IF;
      RETURN jsonb_build_object('version',2,'executionActorUserId',actor,'executionPhase',phase,
        'ackMessage',s.message||jsonb_build_object('related_message_id',s.source_id,'ack_outcome',CASE s.syntax_decision WHEN 'accepted' THEN 'positive' WHEN 'rejected' THEN 'negative' END),
        'technicalSyntaxAckEvidence',jsonb_build_object('kind','technical_syntax_ack','version',1,'companyId',c,'environment',env,'sourceMessageId',s.source_id,'syntaxDecision',s.syntax_decision))||coalesce(overrides,'{}');
    END$$;`)
  for (const name of ['public.ediel_messages', 'public.ediel_message_payloads', 'public.ediel_outbox', 'gridex_ediel_transport.attempts', 'gridex_ediel_transport.reservations']) await db.exec(table(name))
  await db.exec('ALTER TABLE gridex_ediel_transport.attempts ADD PRIMARY KEY(id); ALTER TABLE gridex_ediel_transport.reservations ADD PRIMARY KEY(message_id)')
  await db.exec(journalDefinition())
  await db.exec(`REVOKE ALL ON FUNCTION ${signature} FROM PUBLIC; GRANT EXECUTE ON FUNCTION ${signature} TO service_role`)
  originalMetadata = await metadata()
  // The first run intentionally executes the old journal before authoring the forward.
  if (existsSync(forward)) await db.exec(readFileSync(forward, 'utf8'))
  firstDefinitions = await db.query('SELECT pg_get_functiondef($1::regprocedure) definition', [signature])
}, 30_000)
afterAll(() => db.close())
beforeEach(async () => {
  await db.exec(`TRUNCATE public.ediel_messages,public.ediel_message_payloads,public.ediel_outbox,public.user_profiles,public.company_memberships,public.companies,component.controls,component.protected_source,gridex_ediel_transport.attempts,gridex_ediel_transport.reservations;
    INSERT INTO public.user_profiles VALUES('${uid(2)}','active');
    INSERT INTO public.companies VALUES('${uid(1)}','active',true);
    INSERT INTO public.company_memberships VALUES('${uid(1)}','${uid(2)}','active',true,now());
    INSERT INTO component.controls VALUES(1,true,false,true,NULL);`)
  await db.query(`INSERT INTO public.ediel_messages(id,company_id,environment,direction,message_standard,message_family,raw_payload,immutable_rendered_at,immutable_payload_hash,communication_route_id,receiver_email,related_message_id,ack_outcome)
    VALUES($1,$2,'production','outbound','edifact','CONTRL',$3,now(),$4,$5,'receiver@example.invalid',$6,'positive')`, [uid(3), uid(1), raw, hash(raw), uid(5), uid(6)])
  await db.query('INSERT INTO component.protected_source SELECT id,to_jsonb(m),$1,\'accepted\' FROM public.ediel_messages m', [uid(6)])
  await db.query(`INSERT INTO public.ediel_message_payloads(id,company_id,ediel_message_id,encrypted_payload_ref,payload_kind,metadata)
    VALUES($1,$2,$3,'component/mime','smime_enveloped',$4::jsonb)`, [uid(7), uid(1), uid(3), JSON.stringify({archive_verified: true, archived_mime_sha256: hash('declared archived MIME'), archived_rfc_message_id: '<component@example.invalid>', archived_mime_bytes: 23})])
})

it('admits source-qualified prescribed production CONTRL through prepare/enter/observe and safe retry while business stays denied', async () => {
  const before = await image()
  expect(await call(input())).toEqual({proceed: true, state: 'prepared'})
  expect(await call(input('enter'))).toEqual({proceed: true, state: 'entered'})
  const receipt = {accepted: ['receiver@example.invalid'], rejected: []}
  const observed = await call({...input('observe'), result: receipt})
  expect(observed).toMatchObject({state: 'observed', classification: 'accepted'})
  expect(await call(input())).toMatchObject({proceed: false, state: 'observed', classification: 'accepted', providerReceipt: receipt})
  const after = await image()
  for (const name of Object.keys(before).filter(x => !x.startsWith('gridex_ediel_transport.'))) expect(after[name]).toEqual(before[name])
  expect(after['gridex_ediel_transport.attempts']).toHaveLength(1)
  expect(after['gridex_ediel_transport.reservations']).toHaveLength(1)
})
it.each([null, uid(91)])('accepts qualified private relation/outcome with stale public caches %s without repairing them', async related => {
  await db.query("UPDATE public.ediel_messages SET related_message_id=$1,ack_outcome='negative'", [related])
  const before = (await image())['public.ediel_messages']
  expect(await call(input())).toEqual({proceed: true, state: 'prepared'})
  expect((await image())['public.ediel_messages']).toEqual(before)
})
it.each(['PRODAT', 'UTILTS', 'APERAK', 'UTILTS_ERR', 'AI_LIST'])('retains business operation denial for %s even with caller-supplied qualification', async family => {
  await db.query('UPDATE public.ediel_messages SET message_family=$1', [family])
  await refusal({...input(), technicalSyntaxAckEvidence: {qualified: true}, prescribedResponse: true}, 'ediel_transport_actor_not_authorized')
})
it('retains original test-environment operation denial for CONTRL', async () => {
  await db.exec("UPDATE public.ediel_messages SET environment='test'")
  await refusal({...input(), environment: 'test'}, 'ediel_transport_actor_not_authorized')
})
it.each([
  ['inactive company', "UPDATE public.companies SET is_active=false"],
  ['inactive actor', "UPDATE public.user_profiles SET user_status='inactive'"],
  ['revoked membership', "UPDATE public.company_memberships SET status='inactive'"],
  ['unaccepted membership', "UPDATE public.company_memberships SET accepted_at=NULL"],
  ['revoked permission', "UPDATE component.controls SET permission=false"],
  ['missing original', "DELETE FROM component.protected_source"],
  ['withdrawn original', "UPDATE component.controls SET qualified=false"],
])('refuses %s with zero effects', async (_name, sql) => {
  await db.exec(sql)
  await refusal(input(), 'component_')
})
it.each([
  ['version', {version: 1}], ['executor', {executionActorUserId: uid(99)}], ['phase', {executionPhase: 'read'}],
  ['missing basis', {ackMessage: null}], ['missing evidence', {technicalSyntaxAckEvidence: null}],
  ['SQL null basis', {returnSqlNull: true}],
])('rejects malformed protected-port %s even when global operation permits sending', async (_name, projection) => {
  await db.query('UPDATE component.controls SET business_allowed=true,projection=$1::jsonb', [JSON.stringify(projection)])
  await refusal(input(), 'ediel_transport_technical_contrl_basis_mismatch')
})
it.each(['company_id', 'environment', 'raw_payload', 'immutable_payload_hash', 'communication_route_id'])('rejects a changed locked %s rather than authorizing the earlier protected row', async field => {
  const value = field === 'company_id' ? uid(99) : field === 'environment' ? 'test' : field === 'communication_route_id' ? uid(98) : 'changed'
  await db.query(`UPDATE component.protected_source SET message=jsonb_set(message,$1::text[],to_jsonb($2::text))`, [[field], value])
  await refusal(input(), field === 'company_id' || field === 'environment' ? 'component_protected_original_unavailable' : 'ediel_transport_technical_contrl_basis_mismatch')
})
it('rejects an unsealed or changed original wire with zero journal effects', async () => {
  await db.exec("UPDATE public.ediel_messages SET raw_payload=raw_payload||'changed'")
  await refusal(input(), 'ediel_transport_sealed_message_required')
})
it('retains archive admission after protected technical qualification', async () => {
  await db.exec('DELETE FROM public.ediel_message_payloads')
  await refusal(input(), 'ediel_transport_archive_not_qualified')
})
it('retains exact original byte, owner and binding checks after protected qualification', async () => {
  await refusal({...input(), binding: {...input().binding, payloadHash: hash('wrong')}}, 'ediel_transport_original_bytes_required')
  await refusal({...input(), owner: {kind: 'direct', forged: true}}, 'ediel_transport_direct_owner_invalid')
})
it('preserves function OID/ACL/owner/security/config and performs an inert exact replay', async () => {
  expect(await metadata()).toEqual(originalMetadata)
  expect(existsSync(forward)).toBe(true)
  await db.exec(readFileSync(forward, 'utf8'))
  expect(await db.query('SELECT pg_get_functiondef($1::regprocedure) definition', [signature])).toEqual(firstDefinitions)
  expect(await metadata()).toEqual(originalMetadata)
})

it.each(['sourceMessageId','syntaxDecision','companyId','environment','kind','version'])('rejects corrupted private evidence %s with zero effects', async field => {
  await db.query(`UPDATE component.controls SET projection=jsonb_build_object('technicalSyntaxAckEvidence',
    jsonb_build_object('kind','technical_syntax_ack','version',1,'companyId',$1::text,'environment','production','sourceMessageId',$2::text,'syntaxDecision','accepted')
      ||jsonb_build_object($3::text,'corrupted'))`, [uid(1), uid(6), field])
  await refusal(input(), 'ediel_transport_technical_contrl_basis_mismatch')
})
it.each(['related_message_id','ack_outcome'])('rejects corrupted projected %s despite a qualified source', async field => {
  await db.query(`UPDATE component.controls SET projection=jsonb_build_object('ackMessage',
    (SELECT message||jsonb_build_object('related_message_id',source_id,'ack_outcome','positive')||jsonb_build_object($1::text,'corrupted') FROM component.protected_source))`, [field])
  await refusal(input(), 'ediel_transport_technical_contrl_basis_mismatch')
})
it('refuses non-ASCII in the explicitly declared conversion port', async () => {
  await expect(db.query("SELECT pg_catalog.convert_to('Å','LATIN1'::text)")).rejects.toThrow('component_ascii_conversion_scope_required')
  const bytes = (await db.query<{bytes: Uint8Array}>("SELECT pg_catalog.convert_to('ASCII','LATIN1'::text) bytes")).rows[0].bytes
  expect(Buffer.from(bytes)).toEqual(Buffer.from('ASCII','latin1'))
})
it('refuses unknown leaf source on migration replay and preserves the current definition', async () => {
  const before = await db.query<{definition: string}>('SELECT pg_get_functiondef($1::regprocedure) definition', [signature])
  const originalBody = (await db.query<{body: string}>('SELECT prosrc body FROM pg_proc WHERE oid=$1::regprocedure', [signature])).rows[0].body
  await db.exec('BEGIN')
  try {
    await db.exec(before.rows[0].definition.replace(originalBody, () => originalBody+'\n-- foreign source change\n'))
    await expect(db.exec(readFileSync(forward,'utf8'))).rejects.toThrow('ediel_transport_exact_original_private_leaf_required')
  } finally { await db.exec('ROLLBACK') }
  expect(await db.query('SELECT pg_get_functiondef($1::regprocedure) definition', [signature])).toEqual(before)
})
