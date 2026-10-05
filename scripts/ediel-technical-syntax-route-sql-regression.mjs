// Executes actual route forward with explicit technical-basis/permission fixtures.
// This bounded synthetic PostgreSQL probe is not native or migration replay proof.
import {readFileSync} from 'node:fs'
import {pathToFileURL} from 'node:url'
import assert from 'node:assert/strict'
import {createHash} from 'node:crypto'
if(!process.env.EDIEL_PGLITE_MODULE)throw Error('EDIEL_PGLITE_MODULE required')
const {PGlite}=await import(pathToFileURL(process.env.EDIEL_PGLITE_MODULE).href)
const db=new PGlite();const uid=n=>`00000000-0000-0000-0000-${String(n).padStart(12,'0')}`;let checks=0
try{
 await db.exec(`create role anon;create role authenticated;create role service_role;create schema gridex_ediel_technical_ack;
 create table public.company_memberships(company_id uuid,user_id uuid,status text,is_active boolean,accepted_at timestamptz);
 create table public.user_profiles(id uuid,user_status text);
 create table public.communication_routes(id uuid primary key,company_id uuid,is_active boolean,route_scope text,environment_type text,target_email text,route_name text,route_type text,grid_owner_id uuid,target_system text,endpoint text,supported_payload_version text,notes text,auth_config jsonb);
 create table public.ediel_route_profiles(id uuid primary key,communication_route_id uuid,company_id uuid,environment text,is_enabled boolean,is_active boolean,message_standard text,payload_format text,message_family text,business_code text,sender_ediel_id text,receiver_ediel_id text,sender_subaddress text,sender_sub_address text,receiver_subaddress text,receiver_sub_address text,application_reference text,mailbox text,transport_profile_id uuid,smtp_host text,smtp_port integer,notes text);
 create table public.ediel_transport_profiles(id uuid primary key,company_id uuid,environment text,is_active boolean,transport_channel text,direction text,sender_email text,host text,port integer);
 create table public.test_evidence(company_id uuid,message_id uuid,evidence jsonb);
 create function gridex_ediel_technical_ack.require_source_v1(uuid,uuid) returns jsonb language plpgsql as $$declare e jsonb;begin select evidence into e from public.test_evidence where company_id=$1 and message_id=$2;if e is null then raise exception 'ediel_technical_ack_basis_required';end if;return e;end$$;
 create function gridex_ediel_technical_ack.require_current_endpoint_v1(jsonb) returns void language plpgsql as $$begin if $1->>'transportEdielId'<>'LOCAL' then raise exception 'ediel_technical_endpoint_unqualified';end if;end$$;
 create function public.gridex_actor_has_company_permission(uuid,uuid,text) returns boolean language sql as 'select $3=''communication.send''';
 insert into company_memberships values('${uid(1)}','${uid(2)}','active',true,now());insert into user_profiles values('${uid(2)}','active');
 insert into communication_routes(id,company_id,is_active,route_scope,environment_type,target_email,route_name,route_type,target_system,auth_config) values('${uid(3)}','${uid(1)}',true,'ediel_ack','tgt_test','remote@example.test','actual','smtp','remote','{"secret":"masked"}');
 insert into ediel_route_profiles(id,communication_route_id,company_id,environment,is_enabled,is_active,message_standard,payload_format,sender_ediel_id,receiver_ediel_id,sender_subaddress,receiver_subaddress,application_reference,mailbox,smtp_host,smtp_port) values('${uid(4)}','${uid(3)}','${uid(1)}','test',true,true,'edifact','edifact','LOCAL','REMOTE','L','R','','current@example.test','smtp.example.test',465);`)
 const e={companyId:uid(1),sourceMessageId:uid(10),sourceHash:'a'.repeat(64),environment:'test',transportEdielId:'LOCAL',originalUNB:{sender:['REMOTE','14','R'],receiver:['LOCAL','14','L'],applicationReference:''}}
 await db.query('insert into test_evidence values($1,$2,$3)',[uid(1),uid(10),e])
 await db.exec(readFileSync(new URL('../supabase/migrations/20260930203034_ediel_technical_syntax_ack_transport_route.sql',import.meta.url),'utf8'));checks++
 const read=async(c=1,a=2,from='current@example.test',host='smtp.example.test',port=465)=>(await db.query('select gridex_ediel_technical_ack.read_route_v1($1,$2,$3,$4,$5,$6) r',[uid(c),uid(a),uid(10),from,host,port])).rows[0].r
 const r=await read();assert.equal(r.route.id,uid(3));assert.equal(r.routeRuntime.route_profile_id,uid(4));assert.equal(r.applicationReference,'');assert.equal(r.authorizesBusinessEffect,false);assert.deepEqual(r.route.auth_config,{});assert.equal(r.senderSubAddress,'L');assert.equal(r.receiverSubAddress,'R');checks++
 await assert.rejects(read(1,99),/ediel_tenant_actor_forbidden/);checks++
 await assert.rejects(read(99,2),/ediel_tenant_actor_forbidden/);checks++
 for(const update of ["sender_subaddress='WRONG'","receiver_subaddress='WRONG'","sender_sub_address='CONFLICT'","application_reference=NULL","application_reference='DEFAULT'","mailbox='old@example.test'","smtp_host='old.example.test'","smtp_port=25","environment='production'","message_family='PRODAT'","business_code='Z01'","is_enabled=false","payload_format='xml'"]){
  await db.exec('begin');await db.exec('update ediel_route_profiles set '+update);await assert.rejects(read(),/ediel_technical_ack_route_count:0/);await db.exec('rollback');checks++
 }
 for(const update of ["environment_type='production'","target_email='two@example.test,three@example.test'","route_scope='business'","is_active=false"]){await db.exec('begin');await db.exec('update communication_routes set '+update);await assert.rejects(read(),/ediel_technical_ack_route_count:0/);await db.exec('rollback');checks++}
 // A second weaker match must not displace the exact SMTP-account-qualified pair.
 await db.exec(`insert into ediel_route_profiles select '${uid(5)}',communication_route_id,company_id,environment,is_enabled,is_active,message_standard,payload_format,message_family,business_code,sender_ediel_id,receiver_ediel_id,sender_subaddress,sender_sub_address,receiver_subaddress,receiver_sub_address,application_reference,mailbox,transport_profile_id,'other.example.test',25,notes from ediel_route_profiles where id='${uid(4)}'`);assert.equal((await read()).routeRuntime.route_profile_id,uid(4));checks++
 await db.exec(`update ediel_route_profiles set smtp_host='smtp.example.test',smtp_port=465 where id='${uid(5)}'`);await assert.rejects(read(),/ediel_technical_ack_route_count:2/);await db.exec(`delete from ediel_route_profiles where id='${uid(5)}'`);checks++
 await db.exec(`insert into ediel_transport_profiles values('${uid(6)}','${uid(1)}','test',true,'smtp','outbound','current@example.test','smtp.example.test',465);update ediel_route_profiles set transport_profile_id='${uid(6)}',smtp_host=null,smtp_port=null`);assert.equal((await read()).routeRuntime.route_profile_id,uid(4));checks++
 await db.exec("update ediel_transport_profiles set sender_email='old@example.test'");await assert.rejects(read(),/ediel_technical_ack_route_count:0/);await db.exec("update ediel_transport_profiles set sender_email='current@example.test'");checks++
 await assert.rejects(read(1,2,'old@example.test'),/ediel_technical_ack_route_count:0/);checks++
 const acl=(await db.query("select has_function_privilege('authenticated','public.ediel_read_technical_syntax_ack_route_v1(uuid,uuid,uuid,text,text,integer)','execute') user_rpc")).rows[0];assert.equal(acl.user_rpc,false);checks++
 // New forward reuses the actual configured-route predicate for common APERAK27.
 // Common receipt / syntax / ACK-guide functions below are explicit owner-boundary
 // fixtures; their full implementations have separate bounded source tests.
 await db.exec(`create schema gridex_ediel_common_header;create schema gridex_ediel_ack_guide;create schema gridex_negative_fixtures;
 create table public.ediel_messages(id uuid primary key,company_id uuid,environment text,related_message_id uuid,direction text,message_family text,message_code text,raw_payload text,communication_route_id uuid,route_profile_id uuid,sender_email text,receiver_email text,mailbox text,sender_ediel_id text,receiver_ediel_id text,sender_sub_address text,receiver_sub_address text,application_reference text,execution_context_snapshot jsonb);
 create table gridex_ediel_common_header.negative_witnesses(id uuid primary key default gen_random_uuid(),company_id uuid,environment text,source_message_id uuid,actor_user_id uuid,payload_sha256 text,evidence jsonb);
 create function gridex_ediel_common_header.immutable() returns trigger language plpgsql as $$begin raise exception 'immutable';end$$;
 create function gridex_ediel_common_header.require_v1(c uuid,env text,msg uuid) returns jsonb language plpgsql as $$declare e jsonb;begin e:=gridex_ediel_technical_ack.require_source_v1(c,msg);if e->>'environment' is distinct from env then raise exception 'scope';end if;return e;end$$;
 create function gridex_ediel_common_header.require_current_scope_v1(e jsonb) returns void language plpgsql as $$begin if coalesce((e->>'legalNamespaceCurrent')::boolean,false) is not true then raise exception 'ediel_common_header_current_identity_unavailable';end if;end$$;
 create function gridex_ediel_common_header.assert_ack_v1(m public.ediel_messages,e jsonb) returns void language plpgsql as $$begin if m.raw_payload<>'owned-source-ACK' then raise exception 'ediel_common_header_negative_scope_invalid';end if;end$$;
 create function gridex_ediel_ack_guide.bind_source_v1(m public.ediel_messages,kind text,e jsonb) returns void language plpgsql as $$begin if kind<>'common' or m.id::text<>e->>'sourceMessageId' then raise exception 'owner-basis';end if;end$$;
 create function gridex_negative_fixtures.assert_actor_v1(actor uuid,c uuid,permission text) returns void language plpgsql as $$begin if not exists(select from public.company_memberships where company_id=c and user_id=actor and is_active) or not public.gridex_actor_has_company_permission(actor,c,permission) then raise exception 'ediel_tenant_actor_forbidden';end if;end$$;
 create function gridex_negative_fixtures.assert_prepare_actor_v1(actor uuid,c uuid) returns void language plpgsql as $$begin if not exists(select from public.company_memberships where company_id=c and user_id=actor and is_active) or not(public.gridex_actor_has_company_permission(actor,c,'communication.write') or public.gridex_actor_has_company_permission(actor,c,'ediel_testing.write')) then raise exception 'ediel_tenant_actor_forbidden';end if;end$$;
 create function gridex_ediel_common_header.witness_v1(m public.ediel_messages) returns gridex_ediel_common_header.negative_witnesses language plpgsql as $$declare w gridex_ediel_common_header.negative_witnesses%rowtype;begin select * into w from gridex_ediel_common_header.negative_witnesses where id=(m.execution_context_snapshot->>'prodatCommonHeaderNegativeWitnessId')::uuid;if w.id is null or w.company_id<>m.company_id or w.source_message_id<>m.related_message_id or w.payload_sha256<>encode(sha256(convert_to(m.raw_payload,'UTF8')),'hex') then raise exception 'ediel_common_header_negative_witness_required';end if;return w;end$$;
 create or replace function public.gridex_actor_has_company_permission(uuid,uuid,text) returns boolean language sql as 'select $3 in(''communication.write'',''ediel_testing.write'')';
 insert into public.ediel_messages(id,company_id,environment,raw_payload) values('${uid(10)}',null,'test','owned-source');
 update ediel_route_profiles set message_family='APERAK',business_code='APERAK';`)
 e.syntaxAssessmentId=uid(80);e.legalNamespaceCurrent=true
 await db.query('update test_evidence set evidence=$1',[e])
 await db.exec(readFileSync(new URL('../supabase/migrations/20260930215206_ediel_common_negative_source_route.sql',import.meta.url),'utf8'));checks++
 const apread=async(a=2)=>(await db.query('select gridex_ediel_common_header.read_negative_route_v1($1,$2,$3,$4,$5,$6) r',[uid(1),uid(a),uid(10),'current@example.test','smtp.example.test',465])).rows[0].r
 const ar=await apread();assert.equal(ar.kind,'prodat_common_header_negative_ack_route');assert.equal(ar.routeRuntime.message_family,'APERAK');assert.equal(ar.smtpHost,'smtp.example.test');checks++
 await assert.rejects(read(),/ediel_technical_ack_route_count:0/);checks++
 for(const update of ["message_family='CONTRL'","business_code='CONTRL'","application_reference='DEFAULT'","sender_subaddress='WRONG'","mailbox='other@example.test'"]){await db.exec('begin');await db.exec('update ediel_route_profiles set '+update);await assert.rejects(apread(),/ediel_technical_ack_route_count:0/);await db.exec('rollback');checks++}
 await assert.rejects(apread(99),/ediel_tenant_actor_forbidden/);checks++
 await db.exec('begin');await db.query('update test_evidence set evidence=jsonb_set(evidence,\'{legalNamespaceCurrent}\',\'false\')');await assert.rejects(apread(),/ediel_common_header_current_identity_unavailable/);await db.exec('rollback');checks++
 const prep=(await db.query('select gridex_ediel_common_header.prepare_with_route_v2($1,$2,$3,$4,$5,$6,$7,$8) p',[uid(1),'test',uid(10),uid(2),'owned-source-ACK','current@example.test','smtp.example.test',465])).rows[0].p;checks++
 const message={id:uid(20),company_id:uid(1),environment:'test',related_message_id:uid(10),direction:'outbound',message_family:'APERAK',message_code:'APERAK',raw_payload:'owned-source-ACK',communication_route_id:ar.route.id,route_profile_id:ar.routeRuntime.route_profile_id,sender_email:ar.senderEmail,receiver_email:ar.receiverEmail,mailbox:ar.mailbox,sender_ediel_id:ar.senderEdielId,receiver_ediel_id:ar.receiverEdielId,sender_sub_address:ar.senderSubAddress,receiver_sub_address:ar.receiverSubAddress,application_reference:ar.applicationReference,execution_context_snapshot:{prodatCommonHeaderNegativeWitnessId:prep.witnessId}}
 const witness=async(m=message)=>(await db.query('select (gridex_ediel_common_header.witness_v1(jsonb_populate_record(null::public.ediel_messages,$1::jsonb))).id id',[m])).rows[0].id
 assert.equal(await witness(),prep.witnessId);checks++
 for(const field of ['communication_route_id','route_profile_id','sender_email','receiver_email','mailbox','sender_ediel_id','receiver_ediel_id','sender_sub_address','receiver_sub_address','application_reference']){await assert.rejects(witness({...message,[field]:field.endsWith('_id')&&['communication_route_id','route_profile_id'].includes(field)?uid(999):'wrong'}),/ediel_common_header_negative_route_binding_required/);checks++}
 await db.exec('begin');await db.exec("update communication_routes set target_email='new@example.test'");await assert.rejects(witness(),/ediel_common_header_negative_current_route_required/);await db.exec('rollback');checks++
 await db.exec('begin');await db.exec("update ediel_route_profiles set is_enabled=false");await assert.rejects(witness(),/ediel_technical_ack_route_count:0/);await db.exec('rollback');checks++
 await db.exec('begin');await db.exec("update test_evidence set evidence=jsonb_set(evidence,'{environment}','\"production\"');update communication_routes set environment_type='production';update ediel_route_profiles set environment='production';update ediel_transport_profiles set environment='production';create or replace function public.gridex_actor_has_company_permission(uuid,uuid,text) returns boolean language sql as 'select $3=''ediel_testing.write''' ");await assert.rejects(apread(),/ediel_tenant_actor_forbidden/);await db.exec('rollback');checks++
 const routeAcl=(await db.query("select has_function_privilege('authenticated','public.ediel_read_common_header_negative_ack_route_v1(uuid,uuid,uuid,text,text,integer)','execute') rpc,has_table_privilege('service_role','gridex_ediel_common_header.negative_route_bindings','INSERT') direct")).rows[0];assert.equal(routeAcl.rpc,false);assert.equal(routeAcl.direct,false);checks++
 // IMP05 extends this SAME database with the actual prospective reception
 // writer. Technical source/permission owner boundaries above stay explicit;
 // no private reception or readiness verdict is inserted by the fixture.
 const sqlSource=name=>readFileSync(new URL(`../supabase/migrations/${name}`,import.meta.url),'utf8')
 await db.exec(`create schema auth;create table auth.users(id uuid primary key);insert into auth.users values('${uid(2)}');
 create table public.companies(id uuid primary key);insert into companies values('${uid(1)}');
 create schema gridex_received_sources;create table gridex_received_sources.validation_assessments(id uuid,source_message_id uuid,company_id uuid,environment text,source_payload_hash text,previous_assessment_id uuid);
 alter table public.ediel_messages add column message_standard text,add column interchange_reference text,add column message_received_at timestamptz,add column mailbox_message_id text;
 create table public.ediel_mailboxes(id uuid primary key,company_id uuid,email_address text,environment text,is_active boolean,is_shared_platform_mailbox boolean);
 create table public.inbound_email_messages(id uuid primary key,company_id uuid,mailbox_id uuid,environment text,received_at timestamptz,raw_edifact_payload text,body_text text,raw_email text,to_address text,internet_message_id text,raw_message_sha256 text,processing_status text,match_status text,error_message text,match_payload jsonb default '{}',updated_at timestamptz);
 create table public.inbound_ediel_parse_results(id uuid primary key,inbound_email_message_id uuid,company_id uuid,raw_payload text,sender_ediel_id text,receiver_ediel_id text,application_reference text,interchange_reference text,message_family text,message_code text);
 create table public.inbound_email_attachments(id uuid,company_id uuid,inbound_email_message_id uuid,raw_text text);`)
 const transition=sqlSource('20260930144205_ediel_permission_source_atomic_transitions.sql')
 await db.exec(transition.slice(transition.indexOf('CREATE FUNCTION gridex_received_sources.permission_transition_immutable_v1()'),transition.indexOf('CREATE TRIGGER permission_transition_immutable')))
 await db.exec(sqlSource('20261001000459_ediel_immutable_inbound_reception_response_requests.sql'))
 await db.exec(sqlSource('20261001060131_ediel_inbound_reception_actual_original_columns.sql'))
 await db.exec("create or replace function public.gridex_actor_has_company_permission(uuid,uuid,text) returns boolean language sql as 'select $3 in(''communication.send'',''communication.write'',''communication.read'',''ediel_testing.write'')'")
 await db.exec("update ediel_route_profiles set message_family='CONTRL',business_code='CONTRL';update ediel_transport_profiles set sender_email='current@example.test'")
 const receive=async(n,address,boxCompany=uid(1),shared=false,application='')=>{
  const box=uid(n),mail=uid(n+1),parse=uid(n+2),message=uid(n+3)
  const raw=`UNB+UNOC:3+REMOTE:14:R+LOCAL:14:L+261005:1200+I++${application}'UNH+1+PRODAT:D:97A:UN:E2SE6A'BGM+Z01+DOC+9'`
  const hash=createHash('sha256').update(raw).digest('hex')
  await db.query('insert into ediel_mailboxes values($1,$2,$3,$4,true,$5)',[box,boxCompany,address,'test',shared])
  await db.query("insert into inbound_email_messages(id,company_id,mailbox_id,environment,received_at,raw_edifact_payload,raw_email,to_address,internet_message_id,raw_message_sha256) values($1,$2,$3,'test','2026-10-05T12:00Z',$4,$4,'forged-to@example.test',$5,$6)",[mail,uid(1),box,raw,`fixture-${n}`,hash])
  await db.query("insert into inbound_ediel_parse_results values($1,$2,$3,$4,'REMOTE','LOCAL',$5,'I','PRODAT','Z01')",[parse,mail,uid(1),raw,application])
  await db.query("insert into ediel_messages(id,company_id,environment,direction,message_standard,message_family,message_code,raw_payload,sender_ediel_id,receiver_ediel_id,application_reference,interchange_reference,message_received_at,mailbox_message_id) values($1,$2,'test','inbound','edifact','PRODAT','Z01',$3,'REMOTE','LOCAL',$5,'I','2026-10-05T12:00Z',$4)",[message,uid(1),raw,mail,application])
  await db.query('insert into test_evidence values($1,$2,$3)',[uid(1),message,{...e,sourceMessageId:message,sourceHash:hash,originalUNB:{...e.originalUNB,applicationReference:application}}])
  const recorded=(await db.query('select public.ediel_record_inbound_reception_v1($1,$2,$3,$4,$5) result',[uid(1),message,uid(2),mail,parse])).rows[0].result
  return{box,mail,parse,message,hash,recorded}
 }
 const mailboxRead=async(s,from='current@example.test')=>(await db.query('select gridex_ediel_technical_ack.read_route_v1($1,$2,$3,$4,$5,$6) result',[uid(1),uid(2),s.message,from,'smtp.example.test',465])).rows[0].result
 const legacy=await receive(800,'old-original@example.test')
 if(process.env.EDIEL_IMP05_MAILBOX_LEGACY_CONTROL==='1'){
  // Genuine RED: the unchanged installed reader currently returns the new
  // configured SMTP account for an old original mailbox, contrary to §5.4.4.
  await assert.rejects(mailboxRead(legacy),/ediel_original_mailbox_smtp_custody_required/)
  throw Error('IMP05 old-reader control unexpectedly passed')
 }
 const legacyRow=(await db.query('select to_jsonb(r)::text row from gridex_ediel_inbound_receptions.receptions r where id=$1',[legacy.recorded.receptionId])).rows
 await db.exec(sqlSource('20261005130401_ediel_imp05_original_mailbox_return_route.sql'))
 const mailboxChecks=[]
 await assert.rejects(mailboxRead(legacy),/ediel_original_mailbox_smtp_custody_required/)
 const replay=(await db.query('select public.ediel_record_inbound_reception_v1($1,$2,$3,$4,$5) result',[uid(1),legacy.message,uid(2),legacy.mail,legacy.parse])).rows[0].result
 assert.equal(replay.isReplay,true)
 assert.deepEqual((await db.query('select to_jsonb(r)::text row from gridex_ediel_inbound_receptions.receptions r where id=$1',[legacy.recorded.receptionId])).rows,legacyRow)
 mailboxChecks.push('legacy-receipt-without-birth-smtp-held-without-replay-backfill');checks++
 const current=await receive(810,'current@example.test')
 const originalRows=async()=>(await db.query('select to_jsonb(r)::text row from gridex_ediel_inbound_receptions.receptions r where id=$1',[current.recorded.receptionId])).rows
 const immutable=await originalRows()
 const reply=await mailboxRead(current)
 assert.equal(reply.senderEmail,'current@example.test');assert.equal(reply.senderEdielId,'LOCAL');assert.equal(reply.receiverEdielId,'REMOTE')
 assert.equal(reply.senderSubAddress,'L');assert.equal(reply.receiverSubAddress,'R');assert.equal(reply.applicationReference,'')
 assert.equal(reply.sourceHash,current.hash);assert.equal(reply.authorizesBusinessEffect,false)
 mailboxChecks.push('actual-public-reception-birth-smtp-hash-and-original-reversal-pass');checks++
 await db.query('update ediel_mailboxes set email_address=$1 where id=$2',['changed-mutable@example.test',current.box])
 assert.deepEqual(await mailboxRead(current),reply);assert.deepEqual(await originalRows(),immutable)
 mailboxChecks.push('mutable-mailbox-address-cannot-move-original-smtp-custody');checks++
 const replacementOriginal=await receive(850,'new-current@example.test')
 await db.exec('begin')
 await db.exec("update ediel_route_profiles set mailbox='new-current@example.test';update ediel_transport_profiles set sender_email='new-current@example.test'")
 await db.exec('savepoint old_original_hold')
 await assert.rejects(mailboxRead(current,'new-current@example.test'),/ediel_original_mailbox_smtp_custody_required/)
 await db.exec('rollback to savepoint old_original_hold')
 const replacementReply=await mailboxRead(replacementOriginal,'new-current@example.test')
 assert.equal(replacementReply.senderEmail,'new-current@example.test');assert.equal(replacementReply.sourceHash,replacementOriginal.hash)
 assert.equal(replacementReply.senderEdielId,'LOCAL');assert.equal(replacementReply.receiverEdielId,'REMOTE')
 await db.exec('rollback');assert.deepEqual(await originalRows(),immutable)
 mailboxChecks.push('new-current-smtp-refuses-old-original-with-zero-history-effects');checks++
 mailboxChecks.push('new-original-mailbox-reception-qualifies-the-new-current-smtp');checks++
 await db.exec('begin');await db.exec("update ediel_route_profiles set message_family='APERAK',business_code='APERAK'")
 const aperakRead=async(from='current@example.test')=>(await db.query('select gridex_ediel_common_header.read_negative_route_v1($1,$2,$3,$4,$5,$6) result',[uid(1),uid(2),current.message,from,'smtp.example.test',465])).rows[0].result
 assert.equal((await aperakRead()).senderEmail,'current@example.test')
 await db.exec("update ediel_route_profiles set mailbox='new-current@example.test';update ediel_transport_profiles set sender_email='new-current@example.test'")
 await assert.rejects(aperakRead('new-current@example.test'),/ediel_original_mailbox_smtp_custody_required/)
 await db.exec('rollback')
 const application=await receive(840,'current@example.test',uid(1),false,'23-DDQ-PRODAT')
 await db.exec('begin');await db.exec("update ediel_route_profiles set application_reference='23-DDQ-PRODAT'")
 assert.equal((await mailboxRead(application)).applicationReference,'23-DDQ-PRODAT')
 await db.exec("update ediel_route_profiles set sender_ediel_id='OTHER'")
 await assert.rejects(mailboxRead(application),/ediel_technical_ack_route_count:0/)
 await db.exec('rollback')
 mailboxChecks.push('both-contrl-and-aperak-share-birth-smtp-guard-and-original-app-actor');checks++
 for(const update of ["environment='production'","company_id='"+uid(999)+"'","is_active=false"]){
  await db.exec('begin');await db.exec('update ediel_mailboxes set '+update+` where id='${current.box}'`)
  await assert.rejects(mailboxRead(current),/ediel_original_mailbox_source_required/);await db.exec('rollback')
 }
 await db.exec('begin');await db.query('update inbound_email_messages set mailbox_id=$1 where id=$2',[legacy.box,current.mail])
 await assert.rejects(mailboxRead(current),/ediel_original_mailbox_source_required/);await db.exec('rollback')
 await db.exec('begin');await db.query("update test_evidence set evidence=jsonb_set(evidence,'{sourceHash}',to_jsonb($1::text)) where message_id=$2",['f'.repeat(64),current.message])
 await assert.rejects(mailboxRead(current),/ediel_original_mailbox_source_required/);await db.exec('rollback')
 await assert.rejects(db.query('update ediel_messages set mailbox_message_id=$1 where id=$2',[legacy.mail,current.message]),/ediel_registered_reception_original_immutable/)
 mailboxChecks.push('foreign-environment-mailbox-selector-and-hash-refused');checks++
 const shared=await receive(820,'current@example.test',uid(999),true)
 assert.equal((await mailboxRead(shared)).senderEmail,'current@example.test')
 await db.query('update ediel_mailboxes set is_shared_platform_mailbox=false where id=$1',[shared.box])
 await assert.rejects(mailboxRead(shared),/ediel_original_mailbox_source_required/)
 await assert.rejects(receive(830,'current@example.test',uid(999),false),/ediel_real_reception_source_scope_required/)
 mailboxChecks.push('explicit-shared-platform-mailbox-qualified-foreign-unshared-held');checks++
 await assert.rejects(db.query('delete from gridex_ediel_inbound_receptions.receptions where id=$1',[current.recorded.receptionId]),/permission_transition_is_immutable/)
 assert.deepEqual(await originalRows(),immutable)
 const currentReplay=(await db.query('select public.ediel_record_inbound_reception_v1($1,$2,$3,$4,$5) result',[uid(1),current.message,uid(2),current.mail,current.parse])).rows[0].result
 assert.equal(currentReplay.receptionId,current.recorded.receptionId);assert.equal(currentReplay.isReplay,true)
 assert.deepEqual(await originalRows(),immutable)
 mailboxChecks.push('original-snapshot-immutable-and-replay-preserves-exact-receipt');checks++
 console.log(`IMP05_ORIGINAL_MAILBOX_RESULT ${JSON.stringify({checks:mailboxChecks,wholeRule:'NOT_APPROVED',externalActivation:'NOT_EXERCISED',fixture:'ONE_EXISTING_EMBEDDED_DATABASE'})}`)
 console.log(`Focused configured CONTRL/common-APERAK source-only route/binding/actor checks: ${checks} PASS`)
}catch(error){console.error(error.message,error.where??'');process.exitCode=1}finally{await db.close()}
