// Focused actual outbound seal and source-basis SQL. Legal-context/dispatch
// callbacks are explicit boundary fixtures, not native or replay proof.
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
 await db.exec(`alter table ediel_messages add column execution_context_snapshot jsonb;
 create function gridex_ediel_inbound_context.derive(m public.ediel_messages,t timestamptz) returns jsonb language plpgsql as $$begin
 if m.company_id is null or m.raw_payload not like '%NAD+MS+LOCAL::9%' then raise exception 'ediel_inbound_legal_context_required';end if;
 return jsonb_build_object('basisKind','observed_source_persistence','family',m.message_family,'code',m.message_code,'subtype',null);end$$;
 create schema gridex_outbound_dispatch;
 create table gridex_outbound_dispatch.attempts(id uuid primary key,message_id uuid,company_id uuid,environment text,actor_user_id uuid,binding jsonb);
 create table gridex_outbound_dispatch.originals(message_id uuid primary key,company_id uuid,environment text,payload_hash text,raw_payload text);
 create table gridex_outbound_dispatch.reservations(message_id uuid primary key,attempt_id uuid,state text);
 create table gridex_outbound_dispatch.events(id uuid primary key,attempt_id uuid,kind text,company_id uuid,environment text,facts jsonb,observed_at timestamptz);
 create table gridex_outbound_dispatch.witnesses(event_id uuid);
 create function gridex_outbound_dispatch.mutate_v1(i jsonb) returns jsonb language plpgsql as $$begin
 if i->>'action'='prepare' then
 insert into gridex_outbound_dispatch.attempts values((i->>'attemptId')::uuid,(i->>'messageId')::uuid,(i->>'companyId')::uuid,i->>'environment',(i->>'actorUserId')::uuid,i->'binding');
 insert into gridex_outbound_dispatch.originals select id,company_id,environment,immutable_payload_hash,raw_payload from public.ediel_messages where id=(i->>'messageId')::uuid;
 insert into gridex_outbound_dispatch.reservations values((i->>'messageId')::uuid,(i->>'attemptId')::uuid,'prepared');end if;
 return jsonb_build_object('scoped',true,'proceed',true);end$$;`)
 await db.exec(readFileSync(new URL('../supabase/migrations/20260930184410_ediel_protected_technical_contrl_source_basis.sql',import.meta.url),'utf8'))
 await db.exec(readFileSync(new URL('../supabase/migrations/20260930193722_ediel_outbound_canonical_owner_witness.sql',import.meta.url),'utf8'));checks++
 const raw=ref=>`UNB+UNOC:3+LOCAL:14+REMOTE:14+260930:1200+${ref}++23-DDQ-E66-T++++1'UNH+1+UTILTS:D:04A:UN:E5SE5A'BGM+E66+D+9'NAD+MS+LOCAL::9'IDE+24+T'UNT+5+1'UNZ+1+${ref}'`
 const named=(await db.query("select jsonb_build_object('rulePack',(select to_jsonb(p) from ediel_rule_packs p),'messageProfile',(select to_jsonb(p) from ediel_message_profiles p),'guideSources',(select jsonb_agg(to_jsonb(s) order by id) from ediel_rule_pack_sources s)) s")).rows[0].s
 const original={profileKey:'DB:E66',messageProfileId:uid(101),rulePackId:uid(100),sourceHash:'a'.repeat(64),version:'25.A:r3',snapshot:named}
 const prepare=async(ref,e=original,actor=7,company=1)=>{await db.exec('set role service_role');try{return(await db.query('select public.ediel_prepare_outbound_owner_witness_v1($1) result',[{companyId:uid(company),actorUserId:uid(actor),environment:'test',rawPayload:raw(ref),rulePackEvidence:e}])).rows[0].result}finally{await db.exec('reset role')}}
 const create=async(id,ref,w,{company=1,version=original.version,token=w.witnessId}={})=>db.query("insert into ediel_messages(id,company_id,environment,direction,message_family,message_code,raw_payload,canonical_rule_pack_id,rule_profile_version_id,rule_profile_key,rule_profile_version,rule_pack_checksum,rule_pack_snapshot,execution_context_snapshot,immutable_payload_hash,immutable_rendered_at) values($1,$2,'test','outbound','UTILTS','E66',$3,$4,$5,'DB:E66',$6,$7,$8,$9,encode(sha256(convert_to($3,'UTF8')),'hex'),now())",[uid(id),uid(company),raw(ref),uid(100),uid(101),version,original.sourceHash,w.evidence.snapshot,{outboundOwnerWitnessId:token}])
 const legal=async(id)=>db.query('insert into gridex_ediel_inbound_context.receipts values($1,$2)',[uid(id),{basisKind:'observed_source_persistence',family:'UTILTS',code:'E66',subtype:null}])
 const require=async(id)=>(await db.query('select gridex_ediel_outbound_owner.require_v1($1,$2) e',[uid(1),uid(id)])).rows[0].e
 const capture=async(id)=>(await db.query('select gridex_ediel_source_rules.capture_v1($1,$2) e',[uid(1),uid(id)])).rows[0].e
 const w=await prepare('ACTUAL');assert.equal(w.evidence.version,'25.A:r3');assert.equal(w.evidence.snapshot.profileVersionId,uid(101));checks++
 await create(10,'ACTUAL',w);await legal(10);assert.deepEqual(await require(10),w.evidence);assert.deepEqual(await capture(10),w.evidence);checks++
 await assert.rejects(create(11,'ACTUAL',w),/ediel_outbound_owner_witness_already_consumed/);assert.equal((await db.query('select count(*)::int n from ediel_messages where id=$1',[uid(11)])).rows[0].n,0);checks++
 const changed=await prepare('CHANGED');await assert.rejects(create(12,'FORGED',changed),/ediel_outbound_owner_witness_scope_invalid/);assert.equal((await db.query('select count(*)::int n from gridex_ediel_outbound_owner.consumptions where witness_id=$1',[changed.witnessId])).rows[0].n,0);checks++
 await assert.rejects(create(13,'CHANGED',changed,{version:'forged'}),/ediel_outbound_owner_witness_scope_invalid/);checks++
 await assert.rejects(create(14,'CHANGED',changed,{company:99}),/ediel_outbound_owner_witness_scope_invalid/);checks++
 await assert.rejects(create(15,'CHANGED',changed,{token:uid(999)}),/ediel_historical_outbound_owner_witness_unavailable/);checks++
 await assert.rejects(prepare('X',{...original,version:'forged'}),/ediel_outbound_owner_witness_required/);checks++
 await assert.rejects(prepare('X',{...original,snapshot:{...named,messageProfile:{...named.messageProfile,profile:{forged:true}}}}),/ediel_outbound_owner_witness_required/);checks++
 await assert.rejects(prepare('X',{...original,snapshot:{...named,guideSources:[]}}),/ediel_outbound_owner_witness_required/);checks++
 await assert.rejects(prepare('X',original,99),/ediel_outbound_owner_actor_scope_required/);checks++
 const beforeDrift=await prepare('DRIFT');await create(20,'DRIFT',beforeDrift);await legal(20);await db.exec("update ediel_rule_packs set guide_revision='4'");await assert.rejects(capture(20),/ediel_outbound_owner_witness_scope_invalid/);assert.deepEqual(await capture(10),w.evidence);await db.exec("update ediel_rule_packs set guide_revision='3'");checks++
 await db.exec(`update ediel_messages set rule_profile_version='forged',rule_pack_snapshot=jsonb_set(rule_pack_snapshot,'{version}','"forged"') where id='${uid(20)}'`);await assert.rejects(capture(20),/ediel_outbound_owner_witness_scope_invalid/);checks++
 await db.exec('begin');const rollback=await prepare('ROLLBACK');await create(21,'ROLLBACK',rollback);await db.exec('rollback');assert.equal((await db.query('select count(*)::int n from gridex_ediel_outbound_owner.witnesses where id=$1',[rollback.witnessId])).rows[0].n,0);checks++
 await assert.rejects(db.exec('delete from gridex_ediel_outbound_owner.witnesses'),/ediel_outbound_owner_witness_immutable/);await assert.rejects(db.exec('truncate gridex_ediel_outbound_owner.consumptions'),/ediel_outbound_owner_witness_immutable/);checks++
 const acl=(await db.query("select has_function_privilege('authenticated','public.ediel_prepare_outbound_owner_witness_v1(jsonb)','execute') user_rpc,has_table_privilege('service_role','gridex_ediel_outbound_owner.witnesses','insert') direct_write")).rows[0];assert.deepEqual(acl,{user_rpc:false,direct_write:false});checks++
 const z=await prepare('Z08-LANE');await create(30,'Z08-LANE',z);await legal(30)
 const input={action:'prepare',companyId:uid(1),environment:'test',messageId:uid(30),attemptId:uid(40),actorUserId:uid(7),binding:{originalHash:(await db.query("select encode(sha256(convert_to($1,'UTF8')),'hex') h",[raw('Z08-LANE')])).rows[0].h}}
 await assert.rejects(db.query('select gridex_outbound_dispatch.mutate_v1($1)',[input]),/outbound_dispatch_original_basis_binding_required/);assert.equal((await db.query('select count(*)::int n from gridex_outbound_dispatch.attempts')).rows[0].n,0);checks++
 input.binding.sourceRulePackEvidence=z.evidence;assert.equal((await db.query('select gridex_outbound_dispatch.mutate_v1($1) r',[input])).rows[0].r.proceed,true);checks++
 await db.exec(`update gridex_outbound_dispatch.reservations set state='provider_call_entered';update ediel_rule_packs set status='retired'`);const replay=(await db.query('select gridex_outbound_dispatch.mutate_v1($1) r',[{...input,action:'enter'}])).rows[0].r;assert.equal(replay.proceed,false);assert.equal(replay.acceptedReceipt,null);checks++
 await assert.rejects(db.query('select gridex_outbound_dispatch.mutate_v1($1)',[{...input,action:'enter',attemptId:uid(999)}]),/outbound_dispatch_replay_scope_invalid/);checks++
 console.log(`Focused PostgreSQL outbound original owner seal/one-use atomic insertion/named version/raw scope/ACL/native Z08 binding checks: ${checks} PASS`)
} catch(e){console.error(e.message,e.where??'');process.exitCode=1} finally{await db.close()}
