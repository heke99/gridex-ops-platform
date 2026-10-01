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
 create schema gridex_ack_authority;create schema gridex_utilts_binding;create schema gridex_received_sources;create schema gridex_ediel_inbound_context;create schema gridex_ediel_source_rules;create schema gridex_ediel_wire_namespace;create schema gridex_ediel_transport;
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
 if m.message_family='APERAK' then return jsonb_build_object('basisKind','prescribed_outbound_ack','originalSourceMessageId',m.related_message_id);end if;
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
 await db.exec(`create schema extensions;create schema gridex_utilts_binding_storage_fixture;
 create function extensions.digest(bytea,text) returns bytea language sql immutable as 'select sha256($1)';
 create table gridex_utilts_binding.receipts(source_message_id uuid primary key,company_id uuid,environment text,message_code text,raw_hash text,source_context jsonb,membership jsonb);
 create table gridex_utilts_binding.contracts(series_id uuid primary key,company_id uuid,environment text,source_message_id uuid,transaction_id text,contract_version integer,contract jsonb,contract_hash text);
 create table public.meter_reading_series(id uuid primary key,company_id uuid,message_code text,source_transaction_reference text,source_ediel_message_id uuid,raw_transaction jsonb,immutable_hash text);
 create table public.ediel_ack_transaction_results(company_id uuid,environment text,source_message_id uuid,source_transaction_id text,disposition text,planned_response_type text,persistence_status text,persisted_series_id uuid,final_response_type text,response_message_id uuid,finalized_at timestamptz);
 -- Contract codec and full consumption source-context are separate tested
 -- boundaries; this harness executes the real U14 persisted joins/ACK scope.
 create function gridex_utilts_binding.source_context_v1(m public.ediel_messages) returns jsonb language sql immutable as $$select jsonb_build_object('id',m.id,'hash',encode(sha256(convert_to(m.raw_payload,'UTF8')),'hex'))$$;
 create function gridex_utilts_binding.validate_contract_v1(c jsonb) returns boolean language sql immutable as $$select c->>'version'='2' and c->>'fixtureBoundary'='contract_codec_separately_tested'$$;`)
 await db.exec(readFileSync(new URL('../supabase/migrations/20260930150622_utilts_positive_ack_own_dm_scope.sql',import.meta.url),'utf8'))
 await db.exec(readFileSync(new URL('../supabase/migrations/20260930200633_ediel_outbound_witness_ack_scope_and_time_guards.sql',import.meta.url),'utf8'));checks++
 const ackAuthority=readFileSync(new URL('../supabase/migrations/20260930170932_ediel_inbound_ack_source_atomic_authority.sql',import.meta.url),'utf8')
 await db.exec(ackAuthority.slice(ackAuthority.indexOf('CREATE FUNCTION gridex_ack_authority.wire_v1'),ackAuthority.indexOf('CREATE TABLE gridex_ack_authority.scope_outcomes')))
 await db.exec(readFileSync(new URL('../supabase/migrations/20260930202616_ediel_native_aperak_own_erc_scope.sql',import.meta.url),'utf8'));checks++
 await db.exec(`create schema gridex_ediel_common_header;create function gridex_ediel_common_header.require_ack_v1(public.ediel_messages) returns jsonb language plpgsql as $$begin raise exception 'explicit_common_header_boundary_fixture_unavailable';end$$;create function gridex_received_sources.require_utilts_header_v1(uuid,uuid) returns jsonb language sql as $$select jsonb_build_object('applicationErrors','[ {"ercCode":"42","fieldCode":"505","text":"INCORRECT DATA Bad"} ]'::jsonb)$$`)
 const receivedLedger=readFileSync(new URL('../supabase/migrations/20260922095911_ediel_received_source_ledger.sql',import.meta.url),'utf8');await db.exec(receivedLedger.slice(receivedLedger.indexOf('CREATE FUNCTION gridex_received_sources.reject_mutation'),receivedLedger.indexOf('REVOKE ALL ON FUNCTION gridex_received_sources.reject_mutation')))
 await db.exec(readFileSync(new URL('../supabase/migrations/20260930204944_ediel_source_generated_native_ack_guide_constraints.sql',import.meta.url),'utf8'));checks++
 const raw=ref=>`UNB+UNOC:3+LOCAL:14+REMOTE:14+260930:1200+${ref}++23-DDQ-E66-T++++1'UNH+1+UTILTS:D:04A:UN:E5SE5A'BGM+E66+D+9'NAD+MS+LOCAL::9'IDE+24+T'UNT+5+1'UNZ+1+${ref}'`
 const named=(await db.query("select jsonb_build_object('rulePack',(select to_jsonb(p) from ediel_rule_packs p),'messageProfile',(select to_jsonb(p) from ediel_message_profiles p),'guideSources',(select jsonb_agg(to_jsonb(s) order by id) from ediel_rule_pack_sources s)) s")).rows[0].s
 const original={profileKey:'DB:E66',messageProfileId:uid(101),rulePackId:uid(100),sourceHash:'a'.repeat(64),version:'25.A:r3',snapshot:named}
 const prepare=async(ref,e=original,actor=7,company=1)=>{await db.exec('set role service_role');try{return(await db.query('select public.ediel_prepare_outbound_owner_witness_v1($1) result',[{companyId:uid(company),actorUserId:uid(actor),environment:'test',rawPayload:raw(ref),rulePackEvidence:e}])).rows[0].result}finally{await db.exec('reset role')}}
 const create=async(id,ref,w,{company=1,version=original.version,token=w.witnessId}={})=>db.query("insert into ediel_messages(id,company_id,environment,direction,message_family,message_code,raw_payload,canonical_rule_pack_id,rule_profile_version_id,rule_profile_key,rule_profile_version,rule_pack_checksum,rule_pack_snapshot,execution_context_snapshot,immutable_payload_hash,immutable_rendered_at) values($1,$2,'test','outbound','UTILTS','E66',$3,$4,$5,'DB:E66',$6,$7,$8,$9,encode(sha256(convert_to($3,'UTF8')),'hex'),now())",[uid(id),uid(company),raw(ref),uid(100),uid(101),version,original.sourceHash,w.evidence.snapshot,{outboundOwnerWitnessId:token}])
 const legal=async(id)=>db.query('insert into gridex_ediel_inbound_context.receipts values($1,$2)',[uid(id),{basisKind:'observed_source_persistence',family:'UTILTS',code:'E66',subtype:null,observedAt:new Date().toISOString()}])
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
 await db.exec("update ediel_rule_packs set status='active'")
 const projected=await prepare('PROJECTION');await create(35,'PROJECTION',projected);await legal(35);await db.exec(`update ediel_messages set rule_pack_snapshot=jsonb_set(rule_pack_snapshot,'{rulePack}','{"forged":true}') where id='${uid(35)}'`);await assert.rejects(capture(35),/ediel_outbound_owner_witness_scope_invalid/);checks++
 const originalRaw="UNB+UNOC:3+REMOTE:14+LOCAL:14+260930:1200+SOURCE-U++23-DDQ-E66-T++++1'UNH+S1+UTILTS:D:04A:UN:E5SE5A'BGM+E66+D+9'NAD+MS+REMOTE::9'NAD+MR+LOCAL::9'IDE+24+T'IDE+24+NEG'UNT+7+S1'UNZ+1+SOURCE-U'"
 await db.query("insert into ediel_messages(id,company_id,environment,direction,message_family,message_code,raw_payload,message_received_at) values($1,$2,'test','inbound','UTILTS','E66',$3,now())",[uid(70),uid(1),originalRaw])
 await legal(70);await db.query("insert into gridex_ediel_source_rules.receipts(source_message_id,company_id,environment,direction,payload_sha256,evidence) values($1,$2,'test','inbound',encode(sha256(convert_to($3,'UTF8')),'hex'),$4)",[uid(70),uid(1),originalRaw,w.evidence])
 const ackRaw=(code='312',transaction='T')=>`UNB+UNOC:3+LOCAL:14+REMOTE:14+260930:1200+OWN-AP++23-DDQ-E66-T++++1'UNH+AP1+APERAK:D:04A:UN:E5SE5A'BGM+${code}+OWN-D+9'DTM+137:202609301200:203'DTM+735:?+0100:406'NAD+MS+LOCAL::9'NAD+MR+REMOTE::9'DOC+E66::260+D'ERC+${code==='312'?'100':'42'}::260'FTX+AAO++${code==='312'?'':'505::260'}+${code==='312'?'OK':'INCORRECT DATA Bad'}'RFF+DM:OWN-DM'RFF+ACW:${transaction}'UNT+12+AP1'UNZ+1+OWN-AP'`
 await db.query("select gridex_ediel_ack_guide.bind_source_v1(m,'national',$2) from ediel_messages m where id=$1",[uid(70),w.evidence])
 const prepareAck=async(code='312',transaction='T',wire=ackRaw(code,transaction))=>(await db.query('select gridex_ediel_outbound_owner.prepare_v1($1) r',[{companyId:uid(1),actorUserId:uid(7),environment:'test',rawPayload:wire,relatedMessageId:uid(70),rulePackEvidence:w.evidence}])).rows[0].r
 await assert.rejects(prepareAck(),/utilts_positive_ack_storage_unavailable/);checks++
 await db.exec(`insert into gridex_utilts_binding.receipts select id,company_id,environment,message_code,encode(sha256(convert_to(raw_payload,'UTF8')),'hex'),gridex_utilts_binding.source_context_v1(m),'["T","NEG"]' from public.ediel_messages m where id='${uid(70)}';
 insert into meter_reading_series values('${uid(71)}','${uid(1)}','E66','T','${uid(70)}','{"consumptionContract":{"version":2,"fixtureBoundary":"contract_codec_separately_tested"}}',encode(sha256(convert_to('{"consumptionContract": {"version": 2, "fixtureBoundary": "contract_codec_separately_tested"}}','UTF8')),'hex'));
 insert into gridex_utilts_binding.contracts values('${uid(71)}','${uid(1)}','test','${uid(70)}','T',2,'{"version":2,"fixtureBoundary":"contract_codec_separately_tested"}',encode(sha256(convert_to('{"version": 2, "fixtureBoundary": "contract_codec_separately_tested"}','UTF8')),'hex'));
 insert into ediel_ack_transaction_results values('${uid(1)}','test','${uid(70)}','T','accepted','positive_aperak','persisted','${uid(71)}',null,null,null);
 insert into ediel_ack_transaction_results values('${uid(1)}','test','${uid(70)}','NEG','instruction_rejected','negative_aperak','not_applicable',null,null,null,null);`)
 const positive=await prepareAck();const negative=await prepareAck('313','NEG');assert.equal(positive.evidence.version,w.evidence.version);assert.equal(negative.evidence.version,w.evidence.version);checks++
 await assert.rejects(prepareAck('312','OTHER-IDE'),/ediel_native_ack_guide_invalid/);checks++
 await assert.rejects(prepareAck('312','T',ackRaw().replace('ERC+100','ERC+42')),/ediel_native_ack_guide_invalid/);checks++
 await assert.rejects(prepareAck('313','NEG',ackRaw('313','NEG').replace('ERC+42','ERC+100')),/ediel_native_ack_guide_invalid/);checks++
 await assert.rejects(prepareAck('313','T'),/utilts_negative_ack_reservation_unavailable/);checks++
 const borrowed=ackRaw().replace("ERC+100::260'FTX+AAO+++OK'RFF+DM:OWN-DM'RFF+ACW:T'UNT+12+AP1","RFF+ACW:T'ERC+100::260'FTX+AAO+++OK'RFF+DM:OWN-DM'UNT+12+AP1");await assert.rejects(prepareAck('312','T',borrowed),/ediel_native_ack_guide_invalid/);checks++
 const ownMissing=ackRaw().replace("RFF+ACW:T'UNT+12+AP1","ERC+100::260'RFF+DM:SECOND-DM'RFF+ACW:T'UNT+14+AP1");await assert.rejects(prepareAck('312','T',ownMissing),/ediel_native_ack_guide_invalid/);checks++
 // Native direct-source guide rejects unsupported ERC and invented field/text
 // even when the source reservation itself is otherwise authentic.
 await assert.rejects(prepareAck('313','NEG',ackRaw('313','NEG').replace('ERC+42::260','ERC+999::260')),/ediel_native_ack_guide_invalid/);checks++
 await assert.rejects(prepareAck('313','NEG',ackRaw('313','NEG').replace('INCORRECT DATA Bad','INCORRECT DATA')),/ediel_native_ack_guide_invalid/);checks++
 await assert.rejects(prepareAck('313','NEG',ackRaw('313','NEG').replace('505::260','505::999')),/ediel_native_ack_guide_invalid/);checks++
 await assert.rejects(prepareAck('312','T',ackRaw().replace('202609301200','202602301200')),/ediel_native_ack_guide_invalid/);checks++
 await assert.rejects(prepareAck('312','T',ackRaw().replace('735:?+0100:406','735:?+0200:406')),/ediel_native_ack_guide_invalid/);checks++
 await assert.rejects(db.exec("update gridex_ediel_ack_guide.editions set projection='{}'"),/received_source_evidence_is_append_only/);checks++
 await assert.rejects(db.exec('delete from gridex_ediel_ack_guide.source_bindings'),/received_source_evidence_is_append_only/);checks++
 const guideAcl=(await db.query("select has_function_privilege('service_role','gridex_ediel_ack_guide.bind_source_v1(public.ediel_messages,text,jsonb)','execute') bind_authority,has_table_privilege('service_role','gridex_ediel_ack_guide.editions','insert') publish_edition")).rows[0];assert.deepEqual(guideAcl,{bind_authority:false,publish_edition:false});checks++
 const insertAck=async(id,code,sealed,transaction='T')=>db.query("insert into ediel_messages(id,company_id,environment,direction,message_family,message_code,raw_payload,related_message_id,canonical_rule_pack_id,rule_profile_version_id,rule_profile_key,rule_profile_version,rule_pack_checksum,rule_pack_snapshot,execution_context_snapshot,immutable_payload_hash,immutable_rendered_at) values($1,$2,'test','outbound','APERAK','APERAK',$3,$4,$5,$6,'DB:E66',$7,$8,$9,$10,encode(sha256(convert_to($3,'UTF8')),'hex'),now())",[uid(id),uid(1),ackRaw(code,transaction),uid(70),uid(100),uid(101),w.evidence.version,w.evidence.sourceHash,sealed.evidence.snapshot,{outboundOwnerWitnessId:sealed.witnessId}])
 await insertAck(74,'313',negative,'NEG');await db.query('insert into gridex_ediel_inbound_context.receipts values($1,$2)',[uid(74),{basisKind:'prescribed_outbound_ack',originalSourceMessageId:uid(70)}]);assert.equal((await require(74)).version,w.evidence.version);checks++
 const negativeInput={action:'prepare',companyId:uid(1),environment:'test',messageId:uid(74),attemptId:uid(75),actorUserId:uid(7),binding:{originalHash:(await db.query("select encode(sha256(convert_to($1,'UTF8')),'hex') h",[ackRaw('313','NEG')])).rows[0].h,sourceRulePackEvidence:negative.evidence}}
 await assert.rejects(db.query('select gridex_ediel_transport.mutate_v1($1)',[negativeInput]),/utilts_negative_ack_reservation_unavailable/);checks++
 await db.exec(`update ediel_ack_transaction_results set final_response_type='negative_aperak',response_message_id='${uid(74)}',finalized_at=now() where source_transaction_id='NEG'`);assert.equal((await db.query('select gridex_ediel_transport.mutate_v1($1) r',[negativeInput])).rows[0].r.proceed,true);checks++
 await insertAck(72,'312',positive);await db.query('insert into gridex_ediel_inbound_context.receipts values($1,$2)',[uid(72),{basisKind:'prescribed_outbound_ack',originalSourceMessageId:uid(70)}]);assert.equal((await require(72)).version,w.evidence.version);checks++
 const positiveInput={action:'prepare',companyId:uid(1),environment:'test',messageId:uid(72),attemptId:uid(73),actorUserId:uid(7),binding:{originalHash:(await db.query("select encode(sha256(convert_to($1,'UTF8')),'hex') h",[ackRaw()])).rows[0].h,sourceRulePackEvidence:positive.evidence}}
 await assert.rejects(db.query('select gridex_ediel_transport.mutate_v1($1)',[positiveInput]),/utilts_positive_ack_storage_unavailable/);assert.equal((await db.query('select count(*)::int n from gridex_ediel_transport.attempts where id=$1',[uid(73)])).rows[0].n,0);checks++
 await db.exec(`update ediel_ack_transaction_results set final_response_type='positive_aperak',response_message_id='${uid(72)}',finalized_at=now() where source_transaction_id='T'`);assert.equal((await db.query('select gridex_ediel_transport.mutate_v1($1) r',[positiveInput])).rows[0].r.proceed,true);checks++
 await db.exec(`update gridex_ediel_transport.reservations set state='entered';update ediel_ack_transaction_results set persistence_status='held' where source_transaction_id='T'`);assert.equal((await db.query('select gridex_ediel_transport.mutate_v1($1) r',[{...positiveInput,action:'enter'}])).rows[0].r.proceed,false);checks++
 // Explicit clock fixture only: execute the actual forward prepare body with
 // captured UTC22:30/StockholmOct1 and a source activation starting Oct1.
 await db.exec("update ediel_rule_packs set valid_from='2026-10-01'")
 const midnightSnapshot=(await db.query("select jsonb_build_object('rulePack',(select to_jsonb(p) from ediel_rule_packs p),'messageProfile',(select to_jsonb(p) from ediel_message_profiles p),'guideSources',(select jsonb_agg(to_jsonb(s) order by id) from ediel_rule_pack_sources s)) s")).rows[0].s
 const forward=readFileSync(new URL('../supabase/migrations/20260930200633_ediel_outbound_witness_ack_scope_and_time_guards.sql',import.meta.url),'utf8');const clockBody=forward.slice(forward.indexOf('CREATE OR REPLACE FUNCTION gridex_ediel_outbound_owner.prepare_v1'),forward.indexOf('CREATE OR REPLACE FUNCTION gridex_ediel_outbound_owner.assert_message_v1')).replace('observed timestamptz:=clock_timestamp();',"observed timestamptz:='2026-09-30T22:30:00Z';").replace('CREATE OR REPLACE FUNCTION gridex_ediel_outbound_owner.prepare_v1','CREATE OR REPLACE FUNCTION gridex_ediel_outbound_owner.prepare_before_native_ack_guide_v1')
 await db.exec(clockBody);assert.equal((await prepare('STOCKHOLM-OCT1',{...original,snapshot:midnightSnapshot})).evidence.version,'25.A:r3');checks++
 const stockholmForward=readFileSync(new URL('../supabase/migrations/20260930203322_ediel_z08_same_observed_stockholm_guide_date.sql',import.meta.url),'utf8');const captureClockBody=stockholmForward.slice(stockholmForward.indexOf('CREATE OR REPLACE FUNCTION gridex_ediel_source_rules.capture_before_outbound_owner_v1'),stockholmForward.indexOf('REVOKE ALL ON FUNCTION gridex_outbound_dispatch.mutate_before_observed_clock_v1')).replace('observed timestamptz:=clock_timestamp();',"observed timestamptz:='2026-09-30T22:30:00Z';")
 await db.exec(captureClockBody)
 await db.query("insert into ediel_messages(id,company_id,environment,direction,message_family,message_code,raw_payload,message_received_at) values($1,$2,'test','inbound','UTILTS','E66',$3,now())",[uid(90),uid(1),originalRaw]);await legal(90)
 const facts=JSON.stringify({owner:'canonical-runtime-with-registry-v1',rulePackEvidence:{...original,snapshot:midnightSnapshot}});await db.query("insert into gridex_received_sources.validation_assessments values($1,$2,$3,'test',encode(sha256(convert_to($4,'UTF8')),'hex'),null,'canonical-runtime-with-registry-v1',$5,encode(sha256(convert_to($5,'UTF8')),'hex'))",[uid(91),uid(90),uid(1),originalRaw,facts])
 assert.equal((await capture(90)).version,'25.A:r3');checks++
 console.log(`Focused PostgreSQL outbound original owner seal/one-use atomic insertion/named version/raw scope/ACL/native Z08 binding checks: ${checks} PASS`)
} catch(e){console.error(e.stack,e.where??'',e.position??'',e.routine??'');process.exitCode=1} finally{await db.close()}
