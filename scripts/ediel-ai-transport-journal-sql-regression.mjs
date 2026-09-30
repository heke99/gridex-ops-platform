// Bounded mechanical transport tests with explicitly synthetic CSV/journal
// fixtures. The AI purpose/origin helper is a declared probe stub here; its real
// source owner is tested separately. This is not native or legal export proof.
import {readFileSync} from 'node:fs'
import {pathToFileURL} from 'node:url'
import assert from 'node:assert/strict'
if(!process.env.EDIEL_PGLITE_MODULE)throw Error('EDIEL_PGLITE_MODULE required')
const {PGlite}=await import(pathToFileURL(process.env.EDIEL_PGLITE_MODULE).href)
const db=new PGlite(),uid=n=>`00000000-0000-0000-0000-${String(n).padStart(12,'0')}`
const c=uid(1),actor=uid(2),message=uid(3),route=uid(4),mailbox=uid(5),attempt=uid(6)
const raw='12345;54321;AI;20260930;fixture.csv\r\n"Ångström";"a literal Z08 cell"\r\n'
const quote=s=>"'"+s.replaceAll("'","''")+"'"
let checks=0
const binding={originalHash:'',routeId:route,to:'dso@example.invalid',from:'sender@example.invalid',payloadHash:'',payloadLength:Buffer.byteLength(raw,'utf8'),mimeSha256:'b'.repeat(64),mimeLength:123,mimeArchiveRef:'storage://synthetic.fixture/mime',rfcMessageId:'<synthetic@example.invalid>',mimeMode:'attachment',encoding:'utf8',sourceMailboxId:uid(99)}
const call=(action,extra={},aid=attempt)=>`SET ROLE service_role;SELECT public.gridex_ediel_transport_attempt_v1(${quote(JSON.stringify({companyId:c,environment:'test',messageId:message,actorUserId:actor,attemptId:aid,action,...extra}))}::jsonb) receipt;RESET ROLE;`
const result=async sql=>(await db.exec(sql))[1].rows[0].receipt
async function refuses(sql,pattern){try{await assert.rejects(db.exec(sql),pattern);checks++}finally{await db.exec('RESET ROLE')}}
try{
 await db.exec(`CREATE ROLE anon;CREATE ROLE authenticated;CREATE ROLE service_role;CREATE SCHEMA auth;CREATE TABLE auth.users(id uuid PRIMARY KEY);CREATE TABLE companies(id uuid PRIMARY KEY);
 CREATE TABLE ediel_messages(id uuid PRIMARY KEY,company_id uuid,environment text,direction text,message_standard text,raw_payload text,immutable_rendered_at timestamptz,immutable_payload_hash text,communication_route_id uuid,receiver_email text,message_code text,message_family text);
 CREATE TABLE company_memberships(company_id uuid,user_id uuid,status text,is_active boolean,accepted_at timestamptz);CREATE TABLE user_profiles(id uuid,user_status text);
 CREATE TABLE synthetic_permissions(actor uuid,company uuid,permission text);
 CREATE FUNCTION gridex_actor_has_company_permission(uuid,uuid,text) RETURNS boolean LANGUAGE SQL AS 'SELECT EXISTS(SELECT 1 FROM public.synthetic_permissions WHERE actor=$1 AND company=$2 AND permission=$3)';CREATE FUNCTION canonical_tenant_operation_decision(uuid,text) RETURNS TABLE(allowed boolean) LANGUAGE SQL AS 'SELECT true';
 CREATE TABLE ediel_message_payloads(company_id uuid,ediel_message_id uuid,encrypted_payload_ref text,payload_kind text,metadata jsonb);
 CREATE TABLE ediel_outbox(id uuid,ediel_message_id uuid,company_id uuid,environment text,status text,current_send_attempt_id uuid,locked_by text);
 CREATE TABLE ediel_mailboxes(id uuid,company_id uuid,environment text,is_active boolean,is_shared_platform_mailbox boolean,email_address text);
 CREATE FUNCTION public.ediel_require_scoped_capability_for_message_v1(uuid,uuid) RETURNS void LANGUAGE SQL AS 'SELECT null::void';
 CREATE SCHEMA gridex_outbound_dispatch;CREATE TABLE gridex_outbound_dispatch.probes(id integer);
 CREATE FUNCTION gridex_outbound_dispatch.mutate_v1(p jsonb) RETURNS jsonb LANGUAGE plpgsql AS $$BEGIN
 INSERT INTO gridex_outbound_dispatch.probes VALUES(1);IF (SELECT message_code='Z08' FROM public.ediel_messages WHERE id=(p->>'messageId')::uuid) THEN RAISE EXCEPTION 'outbound_dispatch_sealed_original_unavailable';END IF;RETURN '{"scoped":false}'::jsonb;END$$;
 CREATE SCHEMA gridex_ai_processing;CREATE TABLE gridex_ai_processing.probes(id integer);
 CREATE TABLE gridex_ai_processing.synthetic_scope(enabled boolean);INSERT INTO gridex_ai_processing.synthetic_scope VALUES(true);
 CREATE FUNCTION gridex_ai_processing.require_ai_outbound_source_v1(company uuid,message uuid,actor uuid) RETURNS jsonb LANGUAGE plpgsql AS $$DECLARE hash text;BEGIN
 IF NOT(SELECT enabled FROM gridex_ai_processing.synthetic_scope) THEN RAISE EXCEPTION 'synthetic_ai_current_source_held';END IF;
 SELECT immutable_payload_hash INTO STRICT hash FROM public.ediel_messages WHERE id=message AND company_id=company;
 INSERT INTO gridex_ai_processing.probes VALUES(1);RETURN jsonb_build_object('sourceHash',hash);END$$;`)
 await db.exec(readFileSync(new URL('../supabase/migrations/20260930145115_ediel_generic_transport_attempts_v1.sql',import.meta.url),'utf8'))
 await db.exec('ALTER FUNCTION gridex_ediel_transport.mutate_v1(jsonb) RENAME TO mutate_before_service_origin_v1;CREATE FUNCTION gridex_ediel_transport.mutate_v1(p jsonb) RETURNS jsonb LANGUAGE SQL SECURITY DEFINER AS $$SELECT gridex_ediel_transport.mutate_before_service_origin_v1(p)$$;GRANT EXECUTE ON FUNCTION gridex_ediel_transport.mutate_v1(jsonb) TO service_role')
 const dsn=readFileSync(new URL('../supabase/migrations/20260930194905_ediel_dsn_source_observation_journal.sql',import.meta.url),'utf8')
 const mailboxFunction=dsn.match(/CREATE FUNCTION gridex_ediel_transport\.dsn_sending_mailbox_v1[\s\S]*?REVOKE ALL ON FUNCTION gridex_ediel_transport\.dsn_sending_mailbox_v1[^;]*;/)?.[0]
 assert.ok(mailboxFunction);await db.exec(mailboxFunction)
 await db.exec(readFileSync(new URL('../supabase/migrations/20260930203320_ediel_ai_shared_transport_journal.sql',import.meta.url),'utf8'));checks++
 await db.exec(`INSERT INTO companies VALUES('${c}');INSERT INTO auth.users VALUES('${actor}');INSERT INTO user_profiles VALUES('${actor}','active');INSERT INTO company_memberships VALUES('${c}','${actor}','active',true,now());
 INSERT INTO synthetic_permissions VALUES('${actor}','${c}','ediel.send');
 INSERT INTO ediel_messages VALUES('${message}','${c}','test','outbound','ai_list',${quote(raw)},now(),encode(sha256(convert_to(${quote(raw)},'UTF8')),'hex'),'${route}','dso@example.invalid','AI','AI_LIST');
 INSERT INTO ediel_mailboxes VALUES('${mailbox}','${c}','test',true,false,'sender@example.invalid');
 INSERT INTO ediel_message_payloads VALUES('${c}','${message}',${quote(binding.mimeArchiveRef)},'raw_mime',${quote(JSON.stringify({archive_verified:true,archived_mime_sha256:binding.mimeSha256,archived_mime_bytes:binding.mimeLength,archived_rfc_message_id:binding.rfcMessageId}))}::jsonb);`)
 binding.originalHash=binding.payloadHash=(await db.query('SELECT immutable_payload_hash hash FROM ediel_messages')).rows[0].hash
 await db.exec('DELETE FROM synthetic_permissions')
 await refuses(call('prepare',{owner:{kind:'direct'},binding}),/ediel_transport_actor_not_authorized/)
 await db.exec(`INSERT INTO synthetic_permissions VALUES('${actor}','${c}','ediel.send')`)
 await refuses(call('prepare',{owner:{kind:'direct'},binding:{...binding,encoding:'latin1'}}),/ediel_ai_transport_source_bytes_required/)
 await refuses(call('prepare',{owner:{kind:'direct'},binding:{...binding,payloadLength:raw.length}}),/ediel_ai_transport_source_bytes_required/)
 await refuses(call('prepare',{owner:{kind:'direct'},binding:{...binding,payloadHash:'a'.repeat(64)}}),/ediel_ai_transport_source_bytes_required/)
 assert.equal((await db.query('SELECT count(*) n FROM gridex_ediel_transport.attempts')).rows[0].n,0);checks++
 assert.equal((await result(call('prepare',{owner:{kind:'direct'},binding}))).proceed,true);checks++
 assert.equal((await db.query("SELECT binding->>'sourceMailboxId' mailbox FROM gridex_ediel_transport.attempts")).rows[0].mailbox,mailbox);checks++
 assert.equal((await db.query('SELECT count(*) n FROM gridex_outbound_dispatch.probes')).rows[0].n,0);checks++
 await db.exec('UPDATE gridex_ai_processing.synthetic_scope SET enabled=false')
 await refuses(call('enter'),/synthetic_ai_current_source_held/)
 assert.equal((await db.query('SELECT entered_at FROM gridex_ediel_transport.attempts')).rows[0].entered_at,null);checks++
 await db.exec('UPDATE gridex_ai_processing.synthetic_scope SET enabled=true')
 assert.equal((await result(call('enter'))).proceed,true);checks++
 assert.equal((await db.query('SELECT count(*) n FROM gridex_ai_processing.probes')).rows[0].n,2);checks++
 await refuses(call('release'),/ediel_transport_release_unsafe/)
 await db.exec('BEGIN')
 try{
  assert.equal((await result(call('observe',{result:{accepted:[],rejected:['other@example.invalid']}}))).classification,'unknown');checks++
  await assert.rejects(db.exec(call('observe',{result:{accepted:[],rejected:[binding.to]}})),/ediel_transport_result_immutable/);checks++
 }finally{await db.exec('ROLLBACK')}
 const provider={accepted:[binding.to],rejected:[],messageId:'<provider@example.invalid>'}
 assert.equal((await result(call('observe',{result:provider}))).classification,'accepted');checks++
 await refuses(call('observe',{result:{accepted:[],rejected:[binding.to]}}),/ediel_transport_result_immutable/)
 await db.exec(`UPDATE ediel_messages SET message_standard='edifact',message_family='PRODAT',message_code='Z08'`)
 await refuses(call('prepare',{owner:{kind:'direct'},binding},uid(20)),/outbound_dispatch_sealed_original_unavailable/)
 // PGlite's bundled WASM cannot execute native UTF8→LATIN1 conversion. Keep
 // that exact original-byte boundary for the later real PostgreSQL phase.
 await db.exec(`UPDATE user_profiles SET user_status='inactive'`)
 await refuses(call('prepare',{owner:{kind:'direct'},binding},uid(21)),/ediel_transport_actor_not_authorized/)
 const acl=(await db.query("SELECT has_function_privilege('service_role','gridex_ediel_transport.mutate_before_service_origin_v1(jsonb)','execute') base,has_table_privilege('service_role','gridex_ediel_transport.attempts','update') edit")).rows[0]
 assert.deepEqual(acl,{base:false,edit:false});checks++
 console.log(`PASS ${checks} bounded AI shared-journal/UTF8/mailbox/scope checks; synthetic AI-purpose probe, not native or authentic export evidence. EDIFACT native LATIN1 conversion check NOT RUN here.`)
}catch(error){console.error(`FAIL after ${checks} checks: ${error.message}`);process.exitCode=1}
finally{await db.close()}
