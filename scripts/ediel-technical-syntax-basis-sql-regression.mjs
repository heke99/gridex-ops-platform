// Focused actual forward SQL. Named legal-context and transport adapters below
// are explicit boundary fixtures; this is not native or migration replay proof.
import { readFileSync } from 'node:fs'
import { pathToFileURL } from 'node:url'
import assert from 'node:assert/strict'
if (!process.env.EDIEL_PGLITE_MODULE) throw Error('EDIEL_PGLITE_MODULE required; pinned @electric-sql/pglite@0.3.14')
const { PGlite } = await import(pathToFileURL(process.env.EDIEL_PGLITE_MODULE).href)
const db = new PGlite(); const uid=n=>`00000000-0000-0000-0000-${String(n).padStart(12,'0')}`
let checks=0
try {
 await db.exec(`create role anon;create role authenticated;create role service_role;
 create schema gridex_utilts_binding;create schema gridex_received_sources;create schema gridex_ediel_inbound_context;create schema gridex_ediel_source_rules;create schema gridex_ediel_wire_namespace;create schema gridex_ediel_transport;
 create table public.ediel_messages(id uuid primary key,company_id uuid,environment text,direction text,message_family text,message_code text,raw_payload text,message_received_at timestamptz,message_sent_at timestamptz,related_message_id uuid,canonical_rule_pack_id uuid,rule_profile_version_id uuid,rule_profile_key text,rule_profile_version text,rule_pack_checksum text,rule_pack_snapshot jsonb,immutable_payload_hash text,immutable_rendered_at timestamptz);
 create table public.tenant_actor_identifiers(id uuid,company_id uuid,environment text,actor_id uuid,identifier_type text,identifier_value text,valid_from timestamptz,valid_to timestamptz);
 create table public.tenant_counterparty_relations(id uuid,company_id uuid,environment text,counterparty_actor_id uuid,relation_type text,is_enabled boolean,valid_from timestamptz,valid_to timestamptz);
 create table public.platform_actor_identifiers(id uuid,actor_id uuid,identifier_type text,identifier_value text,valid_from date,valid_to date);
 create table public.ediel_message_profiles(id uuid primary key,rule_pack_id uuid,profile_key text,message_code text,transaction_subtype text,direction text,is_enabled boolean,profile jsonb);
 create table public.ediel_rule_packs(id uuid primary key,family text,market text,source_hash text,status text,valid_from date,valid_to date,guide_version text,guide_revision text);
 create table public.ediel_rule_pack_sources(id uuid primary key,rule_pack_id uuid,source_hash text,title text);
 create table public.ediel_rule_pack_snapshots(company_id uuid,ediel_message_id uuid unique,profile_key text,rule_profile_version_id uuid,profile_version text,checksum text,snapshot jsonb);
 create table gridex_received_sources.validation_assessments(id uuid primary key,source_message_id uuid,company_id uuid,environment text,source_payload_hash text,previous_assessment_id uuid,owner text,facts_text text,facts_hash text);
 create table gridex_ediel_source_rules.receipts(source_message_id uuid primary key,company_id uuid,environment text,direction text,payload_sha256 text,canonical_assessment_id uuid,original_source_message_id uuid,evidence jsonb);
 create table gridex_ediel_inbound_context.receipts(source_message_id uuid primary key,context jsonb);
 create function gridex_ediel_inbound_context.require_v1(uuid,uuid) returns jsonb language plpgsql as $$declare c jsonb;begin select context into c from gridex_ediel_inbound_context.receipts where source_message_id=$2;if c is null then raise exception 'ediel_historical_identity_basis_unavailable';end if;return c;end$$;
 create function gridex_ediel_source_rules.require_v1(uuid,uuid) returns jsonb language plpgsql as $$declare e jsonb;begin select evidence into e from gridex_ediel_source_rules.receipts where source_message_id=$2 and company_id=$1;if e is null then raise exception 'ediel_historical_rule_pack_basis_unavailable';end if;return e;end$$;
 create table gridex_ediel_transport.attempts(id uuid primary key,message_id uuid,company_id uuid,environment text,actor_user_id uuid,binding jsonb);
 create table gridex_ediel_transport.reservations(message_id uuid primary key,attempt_id uuid,state text);
 create table public.company_memberships(company_id uuid,user_id uuid,status text,is_active boolean,accepted_at timestamptz);
 create table public.user_profiles(id uuid,user_status text);
 create function public.gridex_actor_has_company_permission(uuid,uuid,text) returns boolean language sql as 'select true';
 create function gridex_ediel_transport.mutate_v1(i jsonb) returns jsonb language plpgsql as $$begin
 if i->>'action'='prepare' then insert into gridex_ediel_transport.attempts values((i->>'attemptId')::uuid,(i->>'messageId')::uuid,(i->>'companyId')::uuid,i->>'environment',(i->>'actorUserId')::uuid,i->'binding');insert into gridex_ediel_transport.reservations values((i->>'messageId')::uuid,(i->>'attemptId')::uuid,'prepared');end if;
 return jsonb_build_object('proceed',true);end$$;
 insert into tenant_actor_identifiers values('${uid(4)}','${uid(1)}','test','${uid(2)}','EdielId','LOCAL','2000-01-01',null);
 insert into company_memberships values('${uid(1)}','${uid(7)}','active',true,now());insert into user_profiles values('${uid(7)}','active');
 insert into ediel_rule_packs values('${uid(100)}','UTILTS','electricity',repeat('a',64),'active','2000-01-01',null,'25.A','3');
 insert into ediel_message_profiles values('${uid(101)}','${uid(100)}','DB:E66','E66','','both',true,'{"exact":"source"}');
 insert into ediel_rule_pack_sources values('${uid(102)}','${uid(100)}',repeat('b',64),'actual guide');`)
 const inherited=readFileSync(new URL('../supabase/migrations/20260923135706_ediel_utilts_consumption_binding_v1.sql',import.meta.url),'utf8')
 await db.exec(inherited.slice(inherited.indexOf('CREATE FUNCTION gridex_utilts_binding.wire_tokens_v1'),inherited.indexOf('REVOKE ALL ON FUNCTION gridex_utilts_binding.wire_tokens_v1')))
 const source=(ref,{app='',receiver='LOCAL:14:L',sender='REMOTE:14:R'}={})=>`UNB+UNOC:3+${sender}+${receiver}+260930:1200+${ref}++${app}++++1'UNH+S1+UTILTS:D:04A:UN:E5SE5A'BGM+E66+D+9'UNT+3+S1'UNZ+1+${ref}'`
 const ack=(ref,{app='',sender='LOCAL:14:L',receiver='REMOTE:14:R',action='4',count='3',messageRef='A1'}={})=>`UNB+UNOC:3+${sender}+${receiver}+260930:1200+ACK-I++${app}++++1'UNH+${messageRef}+CONTRL:2:2:UN'UCI+${ref.slice(0,14)}+${receiver}+${sender}+${action}'UNT+${count}+${messageRef}'UNZ+1+ACK-I'`
 const insert=async(id,raw,{company=1,direction='inbound',family='UTILTS',code='E66',related=null}={})=>db.query('insert into ediel_messages(id,company_id,environment,direction,message_family,message_code,raw_payload,message_received_at,related_message_id,immutable_payload_hash,immutable_rendered_at) values($1,$2,\'test\',$3,$4,$5,$6,now(),$7,encode(sha256(convert_to($6,\'UTF8\')),\'hex\'),now())',[uid(id),company===null?null:uid(company),direction,family,code,raw,related?uid(related):null])
 await insert(9,source('OLD')) // Preserved original predates prospective capture.
 await db.exec(readFileSync(new URL('../supabase/migrations/20260930184410_ediel_protected_technical_contrl_source_basis.sql',import.meta.url),'utf8'));checks++
 const hash=raw=>(db.query("select encode(sha256(convert_to($1,'UTF8')),'hex') h",[raw])).then(r=>r.rows[0].h)
 const syntax=async(id,decision='rejected')=>db.query('select gridex_ediel_technical_ack.record_syntax_v1($1,$2,$3,$4) result',[uid(1),uid(id),await hash(sourceRaw.get(id)),JSON.stringify({version:1,owner:'canonical-runtime-syntax-v1',syntaxDecision:decision,reasonCodes:decision==='rejected'?['SYNTAX_INVALID']:[]})])
 const capture=async(id,company=1)=>(await db.query('select gridex_ediel_technical_ack.capture_reply_v1($1,$2) evidence',[uid(company),uid(id)])).rows[0].evidence
 const sourceRaw=new Map();const add=async(id,ref,opts={})=>{const raw=source(ref,opts);sourceRaw.set(id,raw);await insert(id,raw,opts)}
 await assert.rejects(capture(9),/ediel_historical_technical_ack_basis_unavailable/);checks++
 await add(10,'ORIGINAL-REF-LONG-OWN');const endpoint=(await db.query('select gridex_ediel_technical_ack.read_endpoint_v1($1) e',[uid(10)])).rows[0].e
 assert.equal(endpoint.companyId,uid(1));assert.equal(endpoint.authorizesBusinessEffect,false);assert.deepEqual(endpoint.originalUNB.receiver,['LOCAL','14','L']);checks++
 await assert.rejects(capture(10),/ediel_technical_ack_basis_required/);checks++
 await assert.rejects(db.query('select gridex_ediel_technical_ack.record_syntax_v1($1,$2,$3,$4)',[uid(1),uid(10),await hash(sourceRaw.get(10)),JSON.stringify({version:1,owner:'canonical-runtime-syntax-v1',reasonCodes:[]})]),/ediel_technical_syntax_owner_required/);checks++
 await syntax(10);const basis=await capture(10);assert.equal(basis.syntaxDecision,'rejected');assert.equal(basis.originalUNB.uciReference,'ORIGINAL-REF-L');assert.equal(basis.originalUNB.applicationReference,'');assert.equal(Object.hasOwn(basis,'rulePackId'),false);checks++
 const guarded=async(id)=>(await db.query('select gridex_ediel_technical_ack.require_contrl_v1(m) evidence from ediel_messages m where id=$1',[uid(id)])).rows[0].evidence
 await insert(20,ack('ORIGINAL-REF-LONG-OWN'),{direction:'outbound',family:'CONTRL',code:'CONTRL',related:10});assert.deepEqual(await guarded(20),basis);checks++
 await db.exec(readFileSync(new URL('../supabase/migrations/20260930200005_ediel_persisted_technical_contrl_basis_read.sql',import.meta.url),'utf8'));
 await db.exec('set role service_role');const persisted=(await db.query('select public.ediel_read_persisted_technical_contrl_basis_v1($1,$2,$3) result',[uid(1),'test',uid(20)])).rows[0].result;await db.exec('reset role');assert.equal(persisted.ackMessage.related_message_id,uid(10));assert.deepEqual(persisted.technicalSyntaxAckEvidence,basis);checks++
 await assert.rejects(db.query('select gridex_ediel_technical_ack.read_persisted_contrl_v1($1,$2,$3)',[uid(99),'test',uid(20)]),/ediel_technical_ack_basis_required/);checks++
 await insert(21,ack('ORIGINAL-REF-LONG-OWN',{action:'1'}),{direction:'outbound',family:'CONTRL',related:10});await assert.rejects(guarded(21),/ediel_technical_ack_basis_required/);checks++
 await insert(22,ack('ORIGINAL-REF-LONG-OWN',{sender:'LOCAL:14:OTHER'}),{direction:'outbound',family:'CONTRL',related:10});await assert.rejects(guarded(22),/ediel_technical_ack_basis_required/);checks++
 await insert(23,ack('ORIGINAL-REF-LONG-OWN',{app:'GUESSED'}),{direction:'outbound',family:'CONTRL',related:10});await assert.rejects(guarded(23),/ediel_technical_ack_basis_required/);checks++
 await insert(24,ack('ORIGINAL-REF-LONG-OWN',{count:'4'}),{direction:'outbound',family:'CONTRL',related:10});await assert.rejects(guarded(24),/ediel_technical_ack_basis_required/);checks++
 await add(11,'ORIGINAL-REF-LONG-DIFFERENT');await assert.rejects(guarded(20),/ediel_technical_ack_original_ambiguous/);await db.exec(`delete from ediel_messages where id='${uid(11)}'`);checks++
 await assert.rejects(syntax(10,'accepted'),/ediel_technical_syntax_outcome_immutable/);assert.deepEqual(await capture(10),basis);checks++
 await add(12,'NULL-TENANT',{company:null});await syntax(12);assert.equal((await capture(12)).companyId,uid(1));assert.equal((await db.query('select company_id from ediel_messages where id=$1',[uid(12)])).rows[0].company_id,null);checks++
 await add(13,'UNQUALIFIED',{receiver:'OTHER:14'});await assert.rejects(capture(13),/ediel_technical_ack_basis_required/);checks++
 await db.exec(`insert into tenant_actor_identifiers values('${uid(40)}','${uid(41)}','test','${uid(42)}','EdielId','LOCAL','2000-01-01',null)`);await add(14,'AMBIGUOUS');await assert.rejects(capture(14),/ediel_technical_ack_basis_required/);await assert.rejects(guarded(20),/ediel_technical_endpoint_unqualified/);await db.exec(`delete from tenant_actor_identifiers where id='${uid(40)}'`);checks++
 await db.exec(`begin`);await add(15,'UNCOMMITTED');await syntax(15);await assert.rejects(capture(15),/ediel_technical_ack_basis_required/);await db.exec('rollback');checks++
 await assert.rejects(db.exec('delete from gridex_ediel_technical_ack.replies'),/ediel_technical_ack_basis_immutable/);await assert.rejects(db.exec('truncate gridex_ediel_technical_ack.sources'),/ediel_technical_ack_basis_immutable/);checks++
 const acl=(await db.query("select has_function_privilege('authenticated','public.ediel_record_technical_syntax_facet_v1(uuid,uuid,text,text)','execute') user_rpc,has_table_privilege('service_role','gridex_ediel_technical_ack.syntax_facets','insert') direct_write")).rows[0];assert.deepEqual(acl,{user_rpc:false,direct_write:false});checks++
 await db.exec("update tenant_actor_identifiers set valid_to=now() where identifier_value='LOCAL'");await assert.rejects(guarded(20),/ediel_technical_endpoint_unqualified/);await db.exec("update tenant_actor_identifiers set valid_to=null");assert.deepEqual(await capture(10),basis);checks++
 const input={action:'prepare',companyId:uid(1),environment:'test',messageId:uid(20),attemptId:uid(50),actorUserId:uid(7),binding:{originalHash:await hash(ack('ORIGINAL-REF-LONG-OWN'))}}
 await assert.rejects(db.query('select gridex_ediel_transport.mutate_v1($1)',[input]),/ediel_technical_ack_basis_required/);assert.equal((await db.query('select count(*)::int n from gridex_ediel_transport.attempts')).rows[0].n,0);checks++
 input.binding.technicalSyntaxAckEvidence=basis;assert.equal((await db.query('select gridex_ediel_transport.mutate_v1($1) result',[input])).rows[0].result.proceed,true);checks++
 await db.exec(`update gridex_ediel_transport.reservations set state='entered';update tenant_actor_identifiers set valid_to=now()`);assert.equal((await db.query('select gridex_ediel_transport.mutate_v1($1) result',[{...input,action:'enter'}])).rows[0].result.proceed,false);await db.exec("update tenant_actor_identifiers set valid_to=null");checks++
 // Inbound authority comes from the committed immutable named witness; public
 // message pack columns intentionally remain NULL, as in the real consumer.
 await add(60,'BUSINESS-ORIGINAL',{app:'23-DDQ-E66-T'});await db.query('insert into gridex_ediel_inbound_context.receipts values($1,$2)',[uid(60),{basisKind:'observed_source_persistence',family:'UTILTS',code:'E66',subtype:null}])
 const named=(await db.query("select jsonb_build_object('rulePack',(select to_jsonb(p) from ediel_rule_packs p),'messageProfile',(select to_jsonb(p) from ediel_message_profiles p),'guideSources',(select jsonb_agg(to_jsonb(s) order by id) from ediel_rule_pack_sources s)) s")).rows[0].s
 const evidence={profileKey:'DB:E66',messageProfileId:uid(101),rulePackId:uid(100),sourceHash:'a'.repeat(64),version:'actual-selected-version',snapshot:named}
 const text=JSON.stringify({owner:'canonical-runtime-with-registry-v1',syntaxDecision:'accepted',functionalDecision:'rejected',rulePackEvidence:evidence})
 await db.query("insert into gridex_received_sources.validation_assessments values($1,$2,$3,'test',$4,null,'canonical-runtime-with-registry-v1',$5,encode(sha256(convert_to($5,'UTF8')),'hex'))",[uid(61),uid(60),uid(1),await hash(sourceRaw.get(60)),text])
 const captured=(await db.query('select gridex_ediel_source_rules.capture_v1($1,$2) e',[uid(1),uid(60)])).rows[0].e;assert.equal(captured.version,'actual-selected-version');assert.equal(captured.messageProfileId,uid(101));assert.equal(captured.snapshot.originalMessageSnapshot,null);checks++
 await add(62,'BUSINESS-DRIFT',{app:'23-DDQ-E66-T'});await db.query('insert into gridex_ediel_inbound_context.receipts values($1,$2)',[uid(62),{basisKind:'observed_source_persistence',family:'UTILTS',code:'E66',subtype:null}]);await db.query("insert into gridex_received_sources.validation_assessments values($1,$2,$3,'test',$4,null,'canonical-runtime-with-registry-v1',$5,encode(sha256(convert_to($5,'UTF8')),'hex'))",[uid(63),uid(62),uid(1),await hash(sourceRaw.get(62)),text]);await db.exec("update ediel_message_profiles set profile='{}'");await assert.rejects(db.query('select gridex_ediel_source_rules.capture_v1($1,$2)',[uid(1),uid(62)]),/ediel_historical_rule_pack_basis_unavailable/);checks++
 console.log(`Focused PostgreSQL technical syntax-only source/endpoint/CONTRL scope/native binding/immutable original named witness checks: ${checks} PASS`)
} catch(e){console.error(e.message,e.where??'');process.exitCode=1} finally{await db.close()}
