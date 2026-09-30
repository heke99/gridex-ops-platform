// Small embedded PostgreSQL journal checks. This is not native/replay or DSN evidence.
import { readFileSync } from 'node:fs'
import assert from 'node:assert/strict'
import { pathToFileURL } from 'node:url'
if (!process.env.EDIEL_PGLITE_MODULE) throw Error('EDIEL_PGLITE_MODULE required')
const { PGlite } = await import(pathToFileURL(process.env.EDIEL_PGLITE_MODULE).href)
const db = new PGlite(), uid = n => `00000000-0000-0000-0000-${String(n).padStart(12,'0')}`
let checks=0
const company=uid(1), actor=uid(2), message=uid(3), route=uid(4), mailbox=uid(5), attempt=uid(6)
const binding={originalHash:'',routeId:route,to:'dso@example.invalid',from:'esco@example.invalid',payloadHash:'a'.repeat(64),payloadLength:5,mimeSha256:'b'.repeat(64),mimeLength:123,mimeArchiveRef:'storage://synthetic.fixture/mime',rfcMessageId:'<synthetic@example.invalid>',mimeMode:'attachment',encoding:'latin1'}
const call=(action,extra={},aid=attempt)=>`set role service_role;select public.gridex_ediel_transport_attempt_v1('${JSON.stringify({companyId:company,environment:'test',messageId:message,actorUserId:actor,attemptId:aid,action,...extra})}'::jsonb) as receipt;reset role;`
async function query(sql){return (await db.exec(sql))[1].rows[0].receipt}
async function rejects(sql,re){try{await assert.rejects(db.exec(sql),re);checks++}finally{await db.exec('reset role')}}
try {
 await db.exec(`create role anon;create role authenticated;create role service_role;create schema auth;create table auth.users(id uuid primary key);create table companies(id uuid primary key);
 create table ediel_messages(id uuid primary key,company_id uuid,environment text,direction text,message_standard text,raw_payload text,immutable_rendered_at timestamptz,immutable_payload_hash text,communication_route_id uuid,receiver_email text,message_code text);
 create table company_memberships(company_id uuid,user_id uuid,status text,is_active boolean,accepted_at timestamptz);create table user_profiles(id uuid,user_status text);
 create function gridex_actor_has_company_permission(uuid,uuid,text) returns boolean language sql as 'select true';create function canonical_tenant_operation_decision(uuid,text) returns table(allowed boolean) language sql as 'select true';
 create table ediel_message_payloads(company_id uuid,ediel_message_id uuid,encrypted_payload_ref text,payload_kind text,metadata jsonb);
 create table ediel_outbox(id uuid,ediel_message_id uuid,company_id uuid,environment text,status text,current_send_attempt_id uuid,locked_by text);
 create table ediel_mailboxes(id uuid,company_id uuid,environment text,is_active boolean,is_shared_platform_mailbox boolean);
 create schema gridex_outbound_dispatch;
 -- Existing source owner's probe is isolated here: real H authority is separately tested.
 create function gridex_outbound_dispatch.mutate_v1(p jsonb) returns jsonb language plpgsql as $$begin
 if (select message_code='Z08' from public.ediel_messages where id=(p->>'messageId')::uuid) then raise exception 'outbound_dispatch_sealed_original_unavailable';end if;
 if p#>>'{owner,kind}' is distinct from 'transport_scope_probe' then raise exception 'scope_probe_required';end if;
 return '{"scoped":false}'::jsonb;end$$;`)
 await db.exec(readFileSync(new URL('../supabase/migrations/20260930145115_ediel_generic_transport_attempts_v1.sql',import.meta.url),'utf8'));checks++
 const acl=await db.query(`select has_function_privilege('anon','public.gridex_ediel_transport_attempt_v1(jsonb)','execute') as rpc,has_table_privilege('service_role','gridex_ediel_transport.attempts','update') as edit`)
 assert.deepEqual(acl.rows,[{rpc:false,edit:false}]);checks++
 await db.exec(`insert into companies values('${company}');insert into auth.users values('${actor}');insert into user_profiles values('${actor}','active');insert into company_memberships values('${company}','${actor}','active',true,now());
 insert into ediel_messages values('${message}','${company}','test','outbound','edifact','fixture',now(),encode(sha256(convert_to('fixture','UTF8')),'hex'),'${route}','dso@example.invalid','Z13');
 insert into ediel_mailboxes values('${mailbox}','${company}','test',true,false)`)
 binding.originalHash=(await db.query('select immutable_payload_hash as hash from ediel_messages')).rows[0].hash
 await rejects(call('prepare',{owner:{kind:'direct'},binding}),/ediel_transport_archive_not_qualified/)
 await db.exec(`insert into ediel_message_payloads values('${company}','${message}','${binding.mimeArchiveRef}','raw_mime','${JSON.stringify({archive_verified:true,archived_mime_sha256:binding.mimeSha256,archived_mime_bytes:binding.mimeLength,archived_rfc_message_id:binding.rfcMessageId})}')`)
 await rejects(call('prepare',{owner:{kind:'worker',outboxId:uid(8),sendAttemptId:uid(9),workerId:'fixture'},binding}),/ediel_transport_worker_fence_lost/)
 assert.equal((await query(call('prepare',{owner:{kind:'direct'},binding}))).proceed,true);checks++
 const dsn=()=>`set role service_role;select public.gridex_ediel_dsn_attempt_candidates_v1('${company}','test','${binding.rfcMessageId}','${binding.to}','${mailbox}') as receipt;reset role;`
 assert.deepEqual(await query(dsn()),[]);checks++
 assert.equal((await query(call('enter'))).proceed,true);checks++
 await rejects(call('release'),/ediel_transport_release_unsafe/)
 const suppressed=await query(call('prepare',{owner:{kind:'direct'},binding},uid(10)));assert.equal(suppressed.proceed,false);assert.equal(suppressed.classification,null);checks++
 const result={accepted:[binding.to],rejected:[],messageId:'<smtp-fixture>',response:'250 fixture'}
 assert.equal((await query(call('observe',{result}))).classification,'accepted');checks++
 await rejects(call('observe',{result:{accepted:[],rejected:[binding.to]}}),/ediel_transport_result_immutable/)
 const replay=await query(call('prepare',{owner:{kind:'direct'},binding},uid(11)));assert.equal(replay.proceed,false);assert.deepEqual(replay.providerReceipt,result);checks++
 const candidates=await query(dsn());assert.equal(candidates.length,1);assert.equal(candidates[0].correlationStatus,'unverified');checks++
 await db.exec(`update ediel_mailboxes set company_id='${uid(12)}' where id='${mailbox}'`)
 await rejects(dsn(),/ediel_dsn_mailbox_scope_invalid/)
 await db.exec(`update ediel_messages set message_code='Z08'`)
 await rejects(call('prepare',{owner:{kind:'direct'},binding},uid(13)),/outbound_dispatch_sealed_original_unavailable/)
 console.log(`PASS ${checks} targeted PostgreSQL transport journal checks; synthetic fixture, source-owner probe stub; not native/replay or authentic DSN evidence`)
} finally {await db.close()}
