// Focused actual generic journal + private recovery enqueue/cursor checks. Minimal inherited capability/archive/source-owner stubs are synthetic; not native replay, activation, authentic ACK or DSN evidence.
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
 create function public.ediel_require_scoped_capability_for_message_v1(uuid,uuid) returns void language sql as 'select null::void';
 create schema gridex_outbound_dispatch;
 -- Existing source owner's probe is isolated here: real H authority is separately tested.
 create function gridex_outbound_dispatch.mutate_v1(p jsonb) returns jsonb language plpgsql as $$begin
 if (select message_code='Z08' from public.ediel_messages where id=(p->>'messageId')::uuid) then raise exception 'outbound_dispatch_sealed_original_unavailable';end if;
 if p#>>'{owner,kind}' is distinct from 'transport_scope_probe' then raise exception 'scope_probe_required';end if;
 return '{"scoped":false}'::jsonb;end$$;`)
 await db.exec(readFileSync(process.env.EDIEL_JOURNAL_MIGRATION_PATH ?? new URL('../supabase/migrations/20260930145115_ediel_generic_transport_attempts_v1.sql',import.meta.url),'utf8'));checks++
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
 await db.exec(`alter table public.ediel_messages add column message_family text default 'PRODAT',add column original_message_id uuid,add column ack_outcome text,add column contrl_status text default 'pending',add column aperak_status text default 'pending',add column route_profile_id uuid,add column intent_id uuid,add column source_operation_id text;
 alter table public.ediel_outbox add primary key(id);alter table public.ediel_outbox alter column id set default gen_random_uuid();alter table public.ediel_outbox add column priority int,add column lock_key text unique,add column message_family text,add column message_code text,add column route_profile_id uuid,add column payload jsonb,add column queued_at timestamptz,add column created_by uuid,add column updated_by uuid;
 create schema gridex_received_sources;create schema gridex_ack_authority;create table gridex_received_sources.validation_assessments(id uuid,source_message_id uuid,company_id uuid,environment text,source_payload_hash text,facts_text text,previous_assessment_id uuid);
 create table gridex_ack_authority.source_correlations(ack_message_id uuid,source_message_id uuid,company_id uuid,environment text,ack_family text,ack_outcome text,ack_scope text,ack_payload_hash text,source_payload_hash text,scope_outcomes jsonb);`)
 const extract=(path,name)=>{const text=readFileSync(new URL(path,import.meta.url),'utf8'),start=text.indexOf('CREATE FUNCTION '+name),end=text.indexOf('$$;',start);if(start<0||end<0)throw Error(name);return text.slice(start,end+3)}
 for(const name of ['wire_tokens_bounded_v1','closure_wire_tokens_v2','permission_transition_immutable_v1']) await db.exec(extract('../supabase/migrations/20260930144205_ediel_permission_source_atomic_transitions.sql','gridex_received_sources.'+name))
 await db.exec(readFileSync(new URL('../supabase/migrations/20260930164804_ediel_prodat_retry_correction_authority.sql',import.meta.url),'utf8'));checks++
 await db.exec(readFileSync(process.env.EDIEL_RETRY_MIGRATION_PATH ?? new URL('../supabase/migrations/20260930175725_ediel_source_authorized_transport_retry_cursor.sql',import.meta.url),'utf8'));checks++
 const lost=uid(20),first=uid(21),operation=uid(22),next=uid(23),sendAttempt=uid(24)
 const raw="UNB+UNOC:3+12345:ZZ+54321:ZZ+260930:1200+I++23-DDQ-PRODAT++++1'UNH+1+PRODAT:D:97A:UN:E5SE2A'BGM+Z13+DOC+9'NAD+FR+12345:160:SVK'NAD+DO+54321:160:SVK'LIN+1'CCI++Z13'CAV+S17'RFF+LI:LI'UNT+9+1'UNZ+1+I'"
 await db.exec(`insert into ediel_messages(id,company_id,environment,direction,message_standard,raw_payload,immutable_rendered_at,immutable_payload_hash,communication_route_id,receiver_email,message_code,message_family) values('${lost}','${company}','test','outbound','edifact','${raw.replaceAll("'","''")}',now(),encode(sha256(convert_to('${raw.replaceAll("'","''")}','UTF8')),'hex'),'${route}','dso@example.invalid','Z13','PRODAT')`)
 const ownBinding={...binding,originalHash:(await db.query(`select immutable_payload_hash hash from ediel_messages where id='${lost}'`)).rows[0].hash,rfcMessageId:'<loss-fixture@example.invalid>',mimeArchiveRef:'storage://synthetic.fixture/loss.mime'}
 await db.exec(`insert into ediel_message_payloads values('${company}','${lost}','${ownBinding.mimeArchiveRef}','raw_mime','${JSON.stringify({archive_verified:true,archived_mime_sha256:ownBinding.mimeSha256,archived_mime_bytes:ownBinding.mimeLength,archived_rfc_message_id:ownBinding.rfcMessageId})}')`)
 const actual=(action,extra={},aid=first)=>`set role service_role;select public.gridex_ediel_transport_attempt_v1('${JSON.stringify({companyId:company,environment:'test',messageId:lost,actorUserId:actor,attemptId:aid,action,...extra})}'::jsonb) receipt;reset role;`
 assert.equal((await query(actual('prepare',{owner:{kind:'direct'},binding:ownBinding}))).proceed,true);checks++
 assert.equal((await query(actual('enter'))).proceed,true);checks++
 assert.equal((await query(actual('observe',{result:{accepted:[],rejected:[ownBinding.to],messageId:'<rejected>',response:'550 fixture'}}))).classification,'all_rejected');checks++
 const before=(await db.query(`select to_jsonb(a) old from gridex_ediel_transport.attempts a where id='${first}'`)).rows[0].old
 const auth=`set role service_role;select public.ediel_prepare_prodat_recovery_v1('${company}','${lost}','${actor}','${operation}',null,'${first}',null) receipt;reset role;`
 assert.equal((await query(auth)).status,'authorized');checks++
 const queue=`set role service_role;select public.ediel_queue_prodat_retry_v1('${company}','${lost}','${actor}','${operation}') receipt;reset role;`
 const queued=await query(queue);assert.equal(queued.status,'queued');assert.equal((await query(queue)).outboxId,queued.outboxId);checks++
 await db.exec(`update ediel_outbox set status='sending',current_send_attempt_id='${sendAttempt}',locked_by='worker' where id='${queued.outboxId}'`)
 const basis=await query(`set role service_role;select public.ediel_prodat_retry_outbox_basis_v1('${company}','${queued.outboxId}','${actor}') receipt;reset role;`)
 const owner={kind:'worker',outboxId:queued.outboxId,sendAttemptId:sendAttempt,workerId:'worker'},retryBinding={...ownBinding,recoveryAuthorization:basis}
 await rejects(actual('prepare',{owner,binding:{...retryBinding,mimeSha256:'c'.repeat(64)}},next),/archive_not_qualified/)
 assert.equal((await db.query(`select attempt_id,state from gridex_ediel_transport.reservations where message_id='${lost}'`)).rows[0].attempt_id,first);checks++
 assert.equal((await db.query(`select count(*) n from gridex_received_sources.prodat_recovery_attempts`)).rows[0].n,0);checks++
 await rejects(actual('prepare',{owner:{...owner,workerId:'wrong'},binding:retryBinding},next),/worker_fence_lost/)
 assert.equal((await query(actual('prepare',{owner,binding:retryBinding},next))).proceed,true);checks++
 assert.deepEqual((await db.query(`select to_jsonb(a) old from gridex_ediel_transport.attempts a where id='${first}'`)).rows[0].old,before);checks++
 const after=(await db.query(`select attempt_id,state from gridex_ediel_transport.reservations where message_id='${lost}'`)).rows[0];assert.deepEqual(after,{attempt_id:next,state:'prepared'});checks++
 assert.equal((await query(actual('prepare',{owner,binding:retryBinding},uid(25)))).proceed,false);checks++
 assert.equal((await db.query(`select count(*) n from gridex_received_sources.prodat_recovery_attempts`)).rows[0].n,1);checks++
 assert.equal((await query(actual('enter',{},next))).proceed,true);checks++
 await rejects(actual('release',{},next),/release_unsafe/)
 assert.equal((await query(actual('observe',{result:{accepted:[ownBinding.to],rejected:[],messageId:'<accepted>'}},next))).classification,'accepted');checks++
 const preserved=await query(actual('prepare',{owner,binding:retryBinding},uid(26)));assert.equal(preserved.proceed,false);assert.equal(preserved.classification,'accepted');assert.equal(preserved.providerReceipt.messageId,'<accepted>');checks++
 assert.equal((await query(queue)).outboxId,queued.outboxId);checks++
 assert.deepEqual((await db.query(`select to_jsonb(a) old from gridex_ediel_transport.attempts a where id='${first}'`)).rows[0].old,before);checks++
 console.log(`PASS ${checks} focused PostgreSQL actual transport/recovery enqueue/cursor/rollback/immutable checks; synthetic inherited source/capability/archive fixtures, not native/replay or DSN evidence`)
} finally {await db.close()}
