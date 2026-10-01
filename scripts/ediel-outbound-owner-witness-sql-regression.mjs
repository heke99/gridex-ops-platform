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
 if m.company_id is null or (m.raw_payload not like '%NAD+MS+LOCAL::9%' and m.raw_payload not like '%NAD+MS+52101:SVK:260%') then raise exception 'ediel_inbound_legal_context_required';end if;
 if m.message_family IN('APERAK','UTILTS_ERR') then return jsonb_build_object('basisKind','prescribed_outbound_ack','originalSourceMessageId',m.related_message_id);end if;
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
 // The functional-owner facet is an explicit separately-tested boundary. The
 // actual new native guard, sealed INSERT and journal fences execute below.
 await db.exec(`create function gridex_received_sources.require_utilts_functional_responses_v1(uuid,uuid) returns jsonb language sql as $$select jsonb_build_object('version',1,'assessmentId','${uid(96)}','sourcePayloadHash',encode(sha256(convert_to(m.raw_payload,'UTF8')),'hex'),'transactions','[ {"transactionIndex":0,"transactionId":"FUNC","errors":[{"code":"E51","referenceQualifier":"TN","referenceNumber":"FUNC"}],"errorCodes":["E51"]} ]'::jsonb) from public.ediel_messages m where id=$2$$`)
 await db.exec(readFileSync(new URL('../supabase/migrations/20260930214323_ediel_native_utilts_err_own_functional_source_authority.sql',import.meta.url),'utf8'));checks++
 const functionalSource=originalRaw.replace("IDE+24+T'IDE+24+NEG'UNT+7", "IDE+24+FUNC'UNT+6")
 await db.query("insert into ediel_messages(id,company_id,environment,direction,message_family,message_code,raw_payload,message_received_at) values($1,$2,'test','inbound','UTILTS','E66',$3,now())",[uid(93),uid(1),functionalSource]);await legal(93)
 await db.query("insert into gridex_ediel_source_rules.receipts(source_message_id,company_id,environment,direction,payload_sha256,evidence) values($1,$2,'test','inbound',encode(sha256(convert_to($3,'UTF8')),'hex'),$4)",[uid(93),uid(1),functionalSource,w.evidence])
 await db.exec(`insert into ediel_ack_transaction_results values('${uid(1)}','test','${uid(93)}','FUNC','processability_rejected','utilts_err','not_applicable',null,null,null,null)`)
 const errRaw=(code='E51',tx='FUNC')=>`UNB+UNOC:3+LOCAL:14+REMOTE:14+260930:1200+OWN-ERR++23-DDQ-E66-T++++1'UNH+ERR1+UTILTS:D:04A:UN:E5SE5A'BGM+ERR:SVK:260+OWN-ERR-D+9+AB'DTM+137:202609301200:203'DTM+735:?+0100:406'NAD+MS+LOCAL::9'NAD+MR+REMOTE::9'IDE+24+OWN-ERR-T'LOC+172+731000000000000001::9'STS+E01::260+41+${code}::260'RFF+TN:${tx}'RFF+E66:D'UNT+12+ERR1'UNZ+1+OWN-ERR'`
 const prepareErr=async(wire=errRaw())=>(await db.query('select gridex_ediel_outbound_owner.prepare_v1($1) r',[{companyId:uid(1),actorUserId:uid(7),environment:'test',rawPayload:wire,relatedMessageId:uid(93),rulePackEvidence:w.evidence}])).rows[0].r
 const functionalErr=await prepareErr();assert.equal(functionalErr.evidence.version,w.evidence.version);checks++
 await assert.rejects(prepareErr(errRaw('E999')),/utilts_err_own_functional_facet_required/);checks++
 await assert.rejects(prepareErr(errRaw('E51','T')),/utilts_err_own_source_unavailable/);checks++
 await assert.rejects(prepareErr(errRaw().replace('STS+E01::260+41','STS+E01::260+39')),/utilts_err_own_functional_facet_required/);checks++
 await assert.rejects(prepareErr(errRaw().replace('RFF+TN:FUNC','RFF+TN:FUNC:borrowed')),/utilts_err_own_functional_facet_required/);checks++
 await assert.rejects(prepareErr(errRaw().replace('RFF+E66:D','RFF+E66:OTHER')),/utilts_err_own_source_unavailable/);checks++
 await db.exec(`update ediel_ack_transaction_results set planned_response_type='positive_aperak' where source_message_id='${uid(93)}'`);await assert.rejects(prepareErr(),/utilts_err_own_reservation_unavailable/);await db.exec(`update ediel_ack_transaction_results set planned_response_type='utilts_err' where source_message_id='${uid(93)}'`);checks++
 await db.query("insert into ediel_messages(id,company_id,environment,direction,message_family,message_code,raw_payload,related_message_id,canonical_rule_pack_id,rule_profile_version_id,rule_profile_key,rule_profile_version,rule_pack_checksum,rule_pack_snapshot,execution_context_snapshot,immutable_payload_hash,immutable_rendered_at) values($1,$2,'test','outbound','UTILTS_ERR','ERR',$3,$4,$5,$6,'DB:E66',$7,$8,$9,$10,encode(sha256(convert_to($3,'UTF8')),'hex'),now())",[uid(94),uid(1),errRaw(),uid(93),uid(100),uid(101),w.evidence.version,w.evidence.sourceHash,functionalErr.evidence.snapshot,{outboundOwnerWitnessId:functionalErr.witnessId}]);await db.query('insert into gridex_ediel_inbound_context.receipts values($1,$2)',[uid(94),{basisKind:'prescribed_outbound_ack',originalSourceMessageId:uid(93)}]);checks++
 const errInput={action:'prepare',companyId:uid(1),environment:'test',messageId:uid(94),attemptId:uid(95),actorUserId:uid(7),binding:{originalHash:(await db.query("select encode(sha256(convert_to($1,'UTF8')),'hex') h",[errRaw()])).rows[0].h,sourceRulePackEvidence:functionalErr.evidence}}
 await assert.rejects(db.query('select gridex_ediel_transport.mutate_v1($1)',[errInput]),/utilts_err_own_reservation_unavailable/);assert.equal((await db.query('select count(*)::int n from gridex_ediel_transport.attempts where id=$1',[uid(95)])).rows[0].n,0);checks++
 await db.exec(`update ediel_ack_transaction_results set final_response_type='utilts_err',response_message_id='${uid(94)}',finalized_at=now() where source_message_id='${uid(93)}'`);assert.equal((await db.query('select gridex_ediel_transport.mutate_v1($1) r',[errInput])).rows[0].r.proceed,true);checks++
 await db.exec(`update gridex_ediel_transport.reservations set state='entered' where message_id='${uid(94)}';update ediel_ack_transaction_results set planned_response_type='positive_aperak' where source_message_id='${uid(93)}'`);assert.equal((await db.query('select gridex_ediel_transport.mutate_v1($1) r',[{...errInput,action:'enter'}])).rows[0].r.proceed,false);checks++
 // V2 is a separately tested protected canonical-owner boundary. These
 // explicit fixture alternatives model distinct owner projections, never a
 // mutable production facet or caller-authorized global error flag.
 await db.exec(readFileSync(new URL('../supabase/migrations/20260930220632_ediel_native_utilts_err_explicit_own_response_scope.sql',import.meta.url),'utf8'));checks++
 await db.query("insert into ediel_messages(id,company_id,environment,direction,message_family,message_code,raw_payload,message_received_at) values($1,$2,'test','inbound','UTILTS','E66',$3,now())",[uid(97),uid(1),functionalSource]);await legal(97)
 await db.query("insert into gridex_ediel_source_rules.receipts(source_message_id,company_id,environment,direction,payload_sha256,evidence) values($1,$2,'test','inbound',encode(sha256(convert_to($3,'UTF8')),'hex'),$4)",[uid(97),uid(1),functionalSource,w.evidence])
 await db.exec(`insert into ediel_ack_transaction_results values('${uid(1)}','test','${uid(97)}','FUNC','processability_rejected','utilts_err','not_applicable',null,null,null,null);create table gridex_received_sources.fixture_functional_facet(value jsonb);create or replace function gridex_received_sources.require_utilts_functional_responses_v1(uuid,uuid) returns jsonb language sql as $$select value||jsonb_build_object('sourcePayloadHash',encode(sha256(convert_to(m.raw_payload,'UTF8')),'hex')) from gridex_received_sources.fixture_functional_facet f,public.ediel_messages m where m.id=$2$$`)
 const globalError={code:'E51',ownerIssueCodes:['FIXTURE_ACTUAL_GLOBAL_PRECISION_ISSUE'],originalScope:'message',referenceQualifier:'TN',referenceNumber:null,responseReference:{qualifier:'TN',number:'FUNC'}}
 const globalFacet=error=>({version:2,assessmentId:uid(96),transactions:[{transactionIndex:0,transactionId:'FUNC',errors:[error],errorCodes:[error.code]}]})
 const setFunctionalFixture=async error=>{await db.exec('delete from gridex_received_sources.fixture_functional_facet');await db.query('insert into gridex_received_sources.fixture_functional_facet values($1)',[globalFacet(error)])}
 const prepareGlobalErr=async()=>(await db.query('select gridex_ediel_outbound_owner.prepare_v1($1) r',[{companyId:uid(1),actorUserId:uid(7),environment:'test',rawPayload:errRaw(),relatedMessageId:uid(97),rulePackEvidence:w.evidence}])).rows[0].r
 await setFunctionalFixture(globalError);assert.equal((await prepareGlobalErr()).evidence.version,w.evidence.version);checks++
 await setFunctionalFixture({...globalError,responseReference:{qualifier:'TN',number:'SIBLING'}});await assert.rejects(prepareGlobalErr(),/utilts_err_own_functional_facet_required/);checks++
 await setFunctionalFixture({...globalError,responseReference:{qualifier:'ACW',number:'FUNC'}});await assert.rejects(prepareGlobalErr(),/utilts_err_own_functional_facet_required/);checks++
 await setFunctionalFixture({...globalError,referenceNumber:'FUNC'});await assert.rejects(prepareGlobalErr(),/utilts_err_own_functional_facet_required/);checks++
 await setFunctionalFixture({...globalError,originalScope:'transaction'});await assert.rejects(prepareGlobalErr(),/utilts_err_own_functional_facet_required/);checks++
 await setFunctionalFixture({...globalError,originalScope:'transaction',referenceNumber:'FUNC'});assert.equal((await prepareGlobalErr()).evidence.version,w.evidence.version);checks++
 await setFunctionalFixture({...globalError,originalScope:'unknown'});await assert.rejects(prepareGlobalErr(),/utilts_err_own_functional_facet_required/);checks++
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
 // Full native guide source-knowledge is generated from the same TS owner.
 // Existing binding rows stay immutable; only exact original hashes and old
 // P/U/T constraint equality permit the additive knowledge extension.
 await db.exec(readFileSync(new URL('../supabase/migrations/20260930222834_ediel_registered_original_native_response_guides.sql',import.meta.url),'utf8'));checks++
 const projection=(await db.query("select projection from gridex_ediel_ack_guide.editions where projection ? 'utiltsErr' order by installed_at desc limit1".replace('limit1','limit 1'))).rows[0].projection
 const counted=async wire=>{const tokens=(await db.query('select gridex_utilts_binding.wire_tokens_v1($1) t',[wire])).rows[0].t;const count=tokens.find(t=>t.tag==='UNT').index-tokens.find(t=>t.tag==='UNH').index+1;return wire.replace(/UNT\+[0-9]+\+/,`UNT+${count}+`)}
 const sourceCopies="LOC+172+731000000000000001::9'LOC+239+AAA:SVK:260'NAD+DDK+52102:SVK:260'NAD+DDQ+52101:SVK:260'PIA+1+V1:PT:SVK:260'DTM+324:202609290000202609300000:719'STS+7++E03::260'"
 const qualifiedErrSource=await counted(functionalSource.replace('UTILTS:D:04A','UTILTS:D:02B').replace("NAD+MS+REMOTE::9", "MKS+23+E02::260'NAD+MS+52100:SVK:260").replace('NAD+MR+LOCAL::9','NAD+MR+52101:SVK:260').replace("IDE+24+FUNC'",`NAD+DDQ'IDE+24+FUNC'${sourceCopies}`))
 const qualifiedErr=await counted(errRaw().replace('UTILTS:D:04A','UTILTS:D:02B').replace('NAD+MS+LOCAL::9',"MKS+23+E02::260'NAD+MS+52101:SVK:260").replace('NAD+MR+REMOTE::9','NAD+MR+52100:SVK:260').replace("IDE+24+OWN-ERR-T'LOC+172+731000000000000001::9'",`NAD+DDQ'IDE+24+OWN-ERR-T'${sourceCopies}`))
 const guideCheck=async(wire=qualifiedErr,source=qualifiedErrSource)=>(await db.query('select gridex_ediel_ack_guide.validate_utilts_err_v1($1,$2,$3) ok',[await counted(wire),source,projection])).rows[0].ok
 assert.equal(await guideCheck(),true);checks++
 for(const wire of [qualifiedErr.replace('E51::260','E999::260'),qualifiedErr.replace('STS+E01::260+41','STS+E01::260+39'),qualifiedErr.replace('LOC+239+AAA','LOC+239+BBB'),qualifiedErr.replace("PIA+1+V1:PT:SVK:260'",''),qualifiedErr.replace('RFF+TN:FUNC','RFF+TN:SIBLING'),qualifiedErr.replace('RFF+E66:D','RFF+E66:OTHER'),qualifiedErr.replace('MKS+23+E02','MKS+23+E03'),qualifiedErr.replace("NAD+DDQ'","NAD+DDK'"),qualifiedErr.replace('NAD+MR+52100','NAD+MR+WRONG'),qualifiedErr.replace('202609301200','202602301200'),qualifiedErr.replace('735:?+0100:406','735:?+0200:406'),qualifiedErr.replace('RFF+TN:FUNC',"SEQ+1'QTY+136:1'RFF+TN:FUNC")]){assert.equal(await guideCheck(wire),false,wire);checks++}
 assert.equal(await guideCheck(qualifiedErr.replace('OWN-ERR-D+9+AB','OWN-ERR-D+5+NA')),true);checks++
 const altSource='UNA:*.! ~'+qualifiedErrSource.replaceAll('+','*').replaceAll('?','!').replaceAll("'",'~');assert.equal(await guideCheck(qualifiedErr,altSource),true);checks++
 await db.exec("update ediel_rule_packs set guide_version='25-A-3'")
 const registeredSnapshot=(await db.query("select jsonb_build_object('rulePack',(select to_jsonb(p) from ediel_rule_packs p),'messageProfile',(select to_jsonb(p) from ediel_message_profiles p),'guideSources',(select jsonb_agg(to_jsonb(s) order by id) from ediel_rule_pack_sources s)) s")).rows[0].s
 const registeredEvidence={...w.evidence,version:'25-A-3:r3',snapshot:{...w.evidence.snapshot,version:'25-A-3:r3',...registeredSnapshot}}
 await db.query("insert into ediel_messages(id,company_id,environment,direction,message_family,message_code,raw_payload,message_received_at) values($1,$2,'test','inbound','UTILTS','E66',$3,now())",[uid(98),uid(1),qualifiedErrSource]);await legal(98)
 await db.query("insert into gridex_ediel_source_rules.receipts(source_message_id,company_id,environment,direction,payload_sha256,evidence) values($1,$2,'test','inbound',encode(sha256(convert_to($3,'UTF8')),'hex'),$4)",[uid(98),uid(1),qualifiedErrSource,registeredEvidence])
 await db.query("select gridex_ediel_ack_guide.bind_source_v1(m,'national',$2) from ediel_messages m where id=$1",[uid(98),registeredEvidence]);await db.exec(`insert into ediel_ack_transaction_results values('${uid(1)}','test','${uid(98)}','FUNC','processability_rejected','utilts_err','not_applicable',null,null,null,null)`);await setFunctionalFixture(globalError)
 const prepareQualifiedErr=async(raw=qualifiedErr)=>(await db.query('select gridex_ediel_outbound_owner.prepare_v1($1) r',[{companyId:uid(1),actorUserId:uid(7),environment:'test',rawPayload:raw,relatedMessageId:uid(98),rulePackEvidence:registeredEvidence}])).rows[0].r
 assert.equal((await prepareQualifiedErr()).evidence.version,'25-A-3:r3');checks++
 await assert.rejects(prepareQualifiedErr(qualifiedErr.replace('LOC+239+AAA','LOC+239+BBB')),/ediel_native_ack_guide_invalid/);checks++
 await assert.rejects(prepareQualifiedErr(qualifiedErr.replace('202609301200','209909301200')),/ediel_native_err_document_date_future/);checks++
 await assert.rejects(db.query("select gridex_ediel_ack_guide.require_registered_basis_v1(m,'national',$2,$3) from ediel_messages m where id=$1",[uid(98),{...registeredEvidence,version:'999:r1',snapshot:{...registeredEvidence.snapshot,rulePack:{...registeredSnapshot.rulePack,guide_version:'999',guide_revision:'1'}}},projection]),/ediel_registered_original_guide_unavailable/);checks++
 await assert.rejects(db.exec("update gridex_ediel_ack_guide.edition_extensions set extended_source_version=original_source_version"),/received_source_evidence_is_append_only/);checks++
 const prodatScopeAcl=(await db.query("select has_table_privilege('service_role','gridex_ediel_ack_guide.edition_extensions','insert') mutate_extension,has_function_privilege('service_role','gridex_ediel_ack_guide.projection_for_original_v1(text)','execute') read_private")).rows[0];assert.deepEqual(prodatScopeAcl,{mutate_extension:false,read_private:false});checks++
 // A new stricter original-guide qualifier cannot reopen or deny established
 // provider entry whose immutable wrapper already returns proceed=false.
 assert.equal((await db.query('select gridex_ediel_transport.mutate_v1($1) r',[{...positiveInput,action:'enter'}])).rows[0].r.proceed,false);checks++
 await db.exec(readFileSync(new URL('../supabase/migrations/20260930225819_ediel_original_response_scope_opaque_version.sql',import.meta.url),'utf8'));checks++
 const opaqueEvidence={...registeredEvidence,version:'authentic-original-opaque-version',snapshot:{...registeredEvidence.snapshot,version:'authentic-original-opaque-version'}}
 assert.equal((await db.query("select gridex_ediel_ack_guide.require_registered_basis_v1(m,'national',$2,$3) is null ok from ediel_messages m where id=$1",[uid(98),opaqueEvidence,projection])).rows[0].ok,false);checks++
 await assert.rejects(db.query("select gridex_ediel_ack_guide.require_registered_basis_v1(m,'national',$2,$3) from ediel_messages m where id=$1",[uid(98),{...opaqueEvidence,snapshot:{...opaqueEvidence.snapshot,version:'changed'}},projection]),/ediel_registered_original_guide_unavailable/);checks++
 // Genuine ERR is logically UTILTS_ERR but its physical UNH and named inherited
 // pack both belong to UTILTS. No caller metadata becomes a new guide choice.
 await db.query("insert into ediel_messages(id,company_id,environment,direction,message_family,message_code,raw_payload,message_received_at) values($1,$2,'test','inbound','UTILTS_ERR','ERR',$3,now())",[uid(110),uid(1),qualifiedErr]);
 await db.query("select gridex_ediel_ack_guide.require_registered_basis_v1(m,'national',$2,$3) from ediel_messages m where id=$1",[uid(110),opaqueEvidence,projection]);checks++
 await db.exec(readFileSync(new URL('../supabase/migrations/20260930225411_ediel_source_generated_technical_expectation_plan.sql',import.meta.url),'utf8'));checks++
 const technicalProjection=(await db.query('select projection from gridex_ediel_transport.technical_expectation_editions')).rows[0].projection
 const originalGuide=technicalProjection.scopes.find(scope=>scope.version===registeredEvidence.version)
 const technicalPlan={...technicalProjection.constraints,policy:{guideRevision:originalGuide.canonicalGuideRevision,referenceDate:'2026-09-30',profileKey:technicalProjection.profiles.find(p=>p.family==='UTILTS_ERR').profileKey,sourceTrace:[{authority:'guide',document:originalGuide.documentName,section:'effective-dated guide registry'},{authority:'acknowledgement',document:originalGuide.documentName,section:'UTILTS/APERAK/UTILTS_ERR acknowledgement rules'}]}}
 // The protected basis getter is the explicitly declared earlier fixture. This
 // probe checks the actual derivative/helper, not original witness generation.
 await db.exec(`create function gridex_ediel_transport.fixture_plan(p jsonb,b jsonb default null,f text default 'UTILTS_ERR') returns jsonb language plpgsql as $$declare m public.ediel_messages;begin select * into m from ediel_messages where id='${uid(98)}';m.direction:='outbound';m.message_family:=f;m.message_code:=case when f='UTILTS_ERR' then 'ERR' when f='APERAK' then 'APERAK' when f='CONTRL' then 'CONTRL' else m.message_code end;if b is not null then return gridex_ediel_transport.require_technical_expectation_binding_v1(m,b);end if;return gridex_ediel_transport.require_technical_expectation_plan_v1(m,p);end$$`)
 const planCheck=async(plan=technicalPlan,binding=null,family='UTILTS_ERR')=>(await db.query('select gridex_ediel_transport.fixture_plan($1,$2,$3) r',[plan,binding,family])).rows[0].r
 assert.deepEqual(await planCheck(),technicalPlan);checks++
 for(const plan of [null,{...technicalPlan,offset:technicalPlan.offset+1},{...technicalPlan,remoteReceiptKnown:true},{...technicalPlan,clock:'caller-clock'},{...technicalPlan,policy:{...technicalPlan.policy,profileKey:'sibling-profile'}},{...technicalPlan,policy:{...technicalPlan.policy,guideRevision:'999'}},{...technicalPlan,policy:{...technicalPlan.policy,referenceDate:'2026-02-30'}},{...technicalPlan,policy:{...technicalPlan.policy,sourceTrace:[{authority:'guide',document:'invented',section:'missing basis'}]}}]){await assert.rejects(planCheck(plan),/ediel_technical_expectation/);checks++}
 const admissionDecision={version:1,family:'UTILTS_ERR',code:'ERR',profileKey:technicalPlan.policy.profileKey,referenceDate:technicalPlan.policy.referenceDate,guide:{guideRevision:technicalPlan.policy.guideRevision},sourceTrace:technicalPlan.policy.sourceTrace}
 const technicalBinding={technicalExpectationPlan:technicalPlan,admissionDecision};assert.deepEqual(await planCheck(technicalPlan,technicalBinding),technicalBinding);checks++
 await assert.rejects(planCheck(technicalPlan,{...technicalBinding,admissionDecision:{...admissionDecision,referenceDate:'2026-09-29'}}),/ediel_technical_expectation_same_admission_required/);checks++
 assert.equal(await planCheck(null,null,'CONTRL'),null);checks++;await assert.rejects(planCheck(technicalPlan,null,'CONTRL'),/ediel_technical_expectation_not_applicable/);checks++
 const technicalAcl=(await db.query("select has_function_privilege('service_role','gridex_ediel_transport.require_technical_expectation_plan_v1(public.ediel_messages,jsonb)','execute') private_exec,has_table_privilege('service_role','gridex_ediel_transport.technical_expectation_editions','insert') mutate_edition")).rows[0];assert.deepEqual(technicalAcl,{private_exec:false,mutate_edition:false});checks++
 await assert.rejects(db.exec('update gridex_ediel_transport.technical_expectation_editions set projection=projection'),/received_source_evidence_is_append_only/);checks++
 // Same canonical logical identity is source-generated; storage ACK status
 // values never select profiles. The actual owner assertion still binds bytes.
 await db.exec(readFileSync(new URL('../supabase/migrations/20260930232522_ediel_canonical_logical_ack_native_identity.sql',import.meta.url),'utf8'));checks++
 for(const code of ['12','312','313','APERAK','']){assert.equal((await db.query("select gridex_ediel_transport.canonical_message_code_v1('APERAK',$1) c",[code])).rows[0].c,'APERAK');checks++}
 assert.equal((await db.query("select gridex_ediel_transport.canonical_message_code_v1('PRODAT','Z14') c")).rows[0].c,'Z14');checks++
 await db.exec(`create function gridex_ediel_transport.fixture_ack_plan(code text,p jsonb,b jsonb default null) returns jsonb language plpgsql as $$declare m public.ediel_messages;begin select * into m from ediel_messages where id='${uid(98)}';m.direction:='outbound';m.message_family:='APERAK';m.message_code:=code;if b is not null then return gridex_ediel_transport.require_technical_expectation_binding_v1(m,b);end if;return gridex_ediel_transport.require_technical_expectation_plan_v1(m,p);end$$`)
 const ackPlan={...technicalPlan,policy:{...technicalPlan.policy,profileKey:null}}
 const ackAdmission={...admissionDecision,family:'APERAK',code:'APERAK',profileKey:null}
 for(const code of ['12','312','313','APERAK','']){assert.deepEqual((await db.query('select gridex_ediel_transport.fixture_ack_plan($1,$2,$3) r',[code,ackPlan,{technicalExpectationPlan:ackPlan,admissionDecision:ackAdmission}])).rows[0].r,{technicalExpectationPlan:ackPlan,admissionDecision:ackAdmission});checks++}
 await assert.rejects(db.query('select gridex_ediel_transport.fixture_ack_plan($1,$2,$3)', ['312',ackPlan,{technicalExpectationPlan:ackPlan,admissionDecision:{...ackAdmission,code:'312'}}]),/same_admission_required/);checks++
 // Real national PRODAT guide + actual seal + actual INSERT trigger. The
 // named protected source getter remains the explicit earlier boundary fixture.
 await db.exec(`create or replace function gridex_ediel_inbound_context.derive(m public.ediel_messages,t timestamptz) returns jsonb language plpgsql as $$begin
 if m.company_id is null or (m.raw_payload not like '%NAD+MS+LOCAL::9%' and m.raw_payload not like '%NAD+MS+52101:SVK:260%' and m.raw_payload not like '%NAD+FR+LOCAL:160:SVK%') then raise exception 'ediel_inbound_legal_context_required';end if;
 if m.message_family in('APERAK','UTILTS_ERR') then return jsonb_build_object('basisKind','prescribed_outbound_ack','originalSourceMessageId',m.related_message_id);end if;return jsonb_build_object('basisKind','observed_source_persistence','family',m.message_family,'code',m.message_code,'subtype',null);end$$;
 create table gridex_ediel_common_header.negative_witnesses(id uuid,company_id uuid,environment text,source_message_id uuid,actor_user_id uuid,payload_sha256 text,evidence jsonb);
 create table gridex_ediel_common_header.negative_consumptions(witness_id uuid,ack_message_id uuid,company_id uuid,environment text,payload_sha256 text);`)
 const pSource=await counted("UNB+UNOC:3+REMOTE:14+LOCAL:14+260930:1200+SOURCE-P++PRODAT++++1'UNH+P1+PRODAT:D:96B:UN:E2SE6A'BGM+Z14+SOURCE-P-D+9'NAD+FR+REMOTE:160:SVK+++++++SE'NAD+DO+LOCAL:160:SVK+++++++SE'LIN+1++OBJECT1'RFF+LI:L1'LIN+2++OBJECT2'RFF+LI:L2'UNT+10+P1'UNZ+1+SOURCE-P'")
 const pEvidence={...registeredEvidence,profileKey:'DB:Z14',version:'26.A:r3',snapshot:{...registeredEvidence.snapshot,profileKey:'DB:Z14',version:'26.A:r3',rulePack:{...registeredSnapshot.rulePack,family:'PRODAT',guide_version:'26.A',guide_revision:'3'},messageProfile:{...registeredSnapshot.messageProfile,profile_key:'DB:Z14',message_code:'Z14'}}}
 const pAck=async(ref,first='positive',second='negative',whole=false)=>counted(`UNB+UNOC:3+LOCAL:14+REMOTE:14+260930:1200+${ref}++PRODAT++++1'UNH+AP1+APERAK:D:96A:UN:E2SE6A'BGM+++${whole?'27':'34'}'DTM+137:202609301200:203'NAD+FR+LOCAL:160:SVK+++++++SE'NAD+DO+REMOTE:160:SVK+++++++SE'RFF+ACW:SOURCE-P-D'${whole?"ERC+41::260'FTX+AAO++202::260+Meddelandenamn saknas'": [first,second].map((outcome,index)=>`ERC+${outcome==='positive'?'100':'41'}::260'FTX+AAO++${outcome==='positive'?'':'209::260'}+${outcome==='positive'?'OK':'Anläggnings-id saknas'}'RFF+LI:L${index+1}'RFF+Z07:OBJECT${index+1}'`).join('')}UNT+1+AP1'UNZ+1+${ref}'`)
 await db.query("insert into ediel_messages(id,company_id,environment,direction,message_family,message_code,raw_payload,message_received_at) values($1,$2,'test','inbound','PRODAT','Z14',$3,now())",[uid(120),uid(1),pSource]);await legal(120)
 await db.query("insert into gridex_ediel_source_rules.receipts(source_message_id,company_id,environment,direction,payload_sha256,evidence) values($1,$2,'test','inbound',encode(sha256(convert_to($3,'UTF8')),'hex'),$4)",[uid(120),uid(1),pSource,pEvidence]);await db.query("select gridex_ediel_ack_guide.bind_source_v1(m,'national',$2) from ediel_messages m where id=$1",[uid(120),pEvidence])
 const prepareP=async(wire,source=120)=>(await db.query('select gridex_ediel_outbound_owner.prepare_v1($1) r',[{companyId:uid(1),actorUserId:uid(7),environment:'test',rawPayload:wire,relatedMessageId:uid(source),rulePackEvidence:pEvidence}])).rows[0].r
 const createP=async(id,wire,sealed,code='APERAK',source=120)=>db.query("insert into ediel_messages(id,company_id,environment,direction,message_family,message_code,raw_payload,related_message_id,canonical_rule_pack_id,rule_profile_version_id,rule_profile_key,rule_profile_version,rule_pack_checksum,rule_pack_snapshot,execution_context_snapshot,immutable_payload_hash,immutable_rendered_at) values($1,$2,'test','outbound','APERAK',$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,encode(sha256(convert_to($4,'UTF8')),'hex'),now())",[uid(id),uid(1),code,wire,uid(source),pEvidence.rulePackId,pEvidence.messageProfileId,pEvidence.profileKey,pEvidence.version,pEvidence.sourceHash,sealed.evidence.snapshot,{outboundOwnerWitnessId:sealed.witnessId}])
 // ACK-10 correction composed with the actual existing P guide, owner seal,
 // one-use consumption and INSERT. The apply delegates are declared boundary
 // fixtures only; their NEW guard mechanics have their own focused harness.
 await db.query("insert into ediel_messages(id,company_id,environment,direction,message_family,message_code,raw_payload,message_received_at) values($1,$2,'test','inbound','PRODAT','Z14',$3,now())",[uid(116),uid(1),pSource]);await legal(116)
 await db.query("insert into gridex_ediel_source_rules.receipts(source_message_id,company_id,environment,direction,payload_sha256,evidence) values($1,$2,'test','inbound',encode(sha256(convert_to($3,'UTF8')),'hex'),$4)",[uid(116),uid(1),pSource,pEvidence]);await db.query("select gridex_ediel_ack_guide.bind_source_v1(m,'national',$2) from ediel_messages m where id=$1",[uid(116),pEvidence])
 const oldUnusedWire=(await pAck('OLD-UNUSED')).replace('BGM+++34','BGM+APERAK+OLD-DOCUMENT+34')
 const oldUnusedSeal=await prepareP(oldUnusedWire,116);await createP(119,oldUnusedWire,oldUnusedSeal,'APERAK',116);checks++
 await db.exec(`create function gridex_ack_authority.read_committed_v1(uuid,text,uuid,uuid) returns jsonb language sql as 'select null::jsonb';create function gridex_ack_authority.apply_v1(uuid,text,uuid,uuid,uuid) returns jsonb language sql as $$select '{"explicitBoundary":"incoming_apply_tested_separately"}'::jsonb$$;`)
 await db.exec(readFileSync(new URL('../supabase/migrations/20261001034855_ediel_prodat_aperak_unused_document_fields.sql',import.meta.url),'utf8'));checks++
 for(const bgm of ['BGM+APERAK++34','BGM++NEW-DOCUMENT+34','BGM+::260++34']){
  const invalid=(await pAck('FRESH-UNUSED')).replace('BGM+++34',bgm)
  await assert.rejects(prepareP(invalid),/ediel_prodat_aperak_unused_document_element/)
  await assert.rejects(createP(118,invalid,oldUnusedSeal),/ediel_prodat_aperak_unused_document_element/)
  assert.equal((await db.query('select count(*)::int n from ediel_messages where id=$1',[uid(118)])).rows[0].n,0);checks++
 }
 // Published source knowledge does not rewrite a previously consumed original.
 assert.deepEqual((await db.query('select gridex_ediel_outbound_owner.require_v1($1,$2) r',[uid(1),uid(119)])).rows[0].r,oldUnusedSeal.evidence);checks++
 const mixedRaw=await pAck('MIXED');const mixedSeal=await prepareP(mixedRaw);assert.equal((await db.query('select code from gridex_ediel_outbound_owner.witnesses where id=$1',[mixedSeal.witnessId])).rows[0].code,'APERAK');checks++
 await db.exec(readFileSync(new URL('../supabase/migrations/20260930231746_ediel_native_prodat_ack_immutable_scope.sql',import.meta.url),'utf8'));checks++
 const ownPScopes=(await db.query('select gridex_ediel_ack_guide.prodat_outcomes_v1($1,$2) r',[mixedRaw,pSource])).rows[0].r;assert.deepEqual(ownPScopes.map(s=>s.outcome),['positive','negative']);checks++
 await createP(121,mixedRaw,mixedSeal,'12');assert.equal((await db.query('select count(*)::int n from gridex_ediel_ack_guide.outbound_prodat_scopes')).rows[0].n,2);checks++
 const sameRaw=await pAck('SAME');await assert.rejects(prepareP(sameRaw),/scope_already_fixed/);checks++
 const oppositeRaw=await pAck('OPPOSITE','negative','positive');await assert.rejects(prepareP(oppositeRaw),/scope_conflicting_outcome/);checks++
 const wholeRaw=await pAck('WHOLE','negative','negative',true);await assert.rejects(prepareP(wholeRaw),/scope_conflicting_outcome/);checks++
 await db.query('select gridex_ediel_ack_guide.require_v1(m) from ediel_messages m where id=$1',[uid(121)]);checks++
 // Two prospects can be prepared before first insertion. Only one immutable
 // scope can commit; the losing INSERT and one-use consumption roll back.
 await db.query("insert into ediel_messages(id,company_id,environment,direction,message_family,message_code,raw_payload,message_received_at) values($1,$2,'test','inbound','PRODAT','Z14',$3,now())",[uid(122),uid(1),pSource]);await legal(122)
 await db.query("insert into gridex_ediel_source_rules.receipts(source_message_id,company_id,environment,direction,payload_sha256,evidence) values($1,$2,'test','inbound',encode(sha256(convert_to($3,'UTF8')),'hex'),$4)",[uid(122),uid(1),pSource,pEvidence]);await db.query("select gridex_ediel_ack_guide.bind_source_v1(m,'national',$2) from ediel_messages m where id=$1",[uid(122),pEvidence])
 const race1=await pAck('RACE1'),race2=await pAck('RACE2','negative','positive');const seal1=await prepareP(race1,122),seal2=await prepareP(race2,122);await createP(123,race1,seal1,'APERAK',122)
 await assert.rejects(createP(124,race2,seal2,'APERAK',122),/scope_conflicting_outcome/);assert.equal((await db.query('select count(*)::int n from ediel_messages where id=$1',[uid(124)])).rows[0].n,0);assert.equal((await db.query('select count(*)::int n from gridex_ediel_outbound_owner.consumptions where witness_id=$1',[seal2.witnessId])).rows[0].n,0);checks++
 await assert.rejects(db.exec('update gridex_ediel_ack_guide.outbound_prodat_scopes set outcome=outcome'),/append_only/);checks++
 const scopeFenceAcl=(await db.query("select has_table_privilege('service_role','gridex_ediel_ack_guide.outbound_prodat_scopes','insert') write_scope,has_function_privilege('service_role','gridex_ediel_ack_guide.require_prodat_scope_v1(public.ediel_messages)','execute') invoke_private")).rows[0];assert.deepEqual(scopeFenceAcl,{write_scope:false,invoke_private:false});checks++
 // Actual original canonical append + P V2 ignore facade + prospective V3
 // sidecar. Registry/identity callbacks remain explicit earlier boundaries.
 await db.exec(`create table gridex_received_sources.sources(source_message_id uuid primary key,company_id uuid,environment text,payload_hash text,received_context jsonb,raw_payload text);
 alter table gridex_received_sources.validation_assessments alter column id set default gen_random_uuid();
 alter table gridex_received_sources.validation_assessments alter column owner set default 'canonical-runtime-with-registry-v1';
 create function public.gridex_read_inbound_ack_source_v1(uuid,text,uuid) returns jsonb language sql as $$select null::jsonb$$;grant usage on schema gridex_received_sources to service_role;`)
 await db.exec(readFileSync(new URL('../supabase/migrations/20260930193136_ediel_locked_original_rule_pack_witness.sql',import.meta.url),'utf8'))
 const ignoredForward=readFileSync(new URL('../supabase/migrations/20260930215244_ediel_prodat_ignored_field_source_projection.sql',import.meta.url),'utf8');await db.exec(ignoredForward.slice(0,ignoredForward.indexOf('CREATE FUNCTION public.gridex_read_prodat_ignored_fields_v1'))+'COMMIT;')
 await db.exec(readFileSync(new URL('../supabase/migrations/20260930234111_ediel_prodat_canonical_response_facets.sql',import.meta.url),'utf8'));checks++
 await db.exec(readFileSync(new URL('../supabase/migrations/20260930235457_ediel_native_prodat_planned_response_authority.sql',import.meta.url),'utf8'));checks++
 await db.exec(readFileSync(new URL('../supabase/migrations/20261001002444_ediel_prodat_positive_response_functional_parity.sql',import.meta.url),'utf8'));checks++
 await db.exec("update ediel_rule_packs set family='PRODAT',guide_version='26.A',guide_revision='3';update ediel_message_profiles set profile_key='DB:Z04',message_code='Z04'")
 const pNamed=(await db.query("select jsonb_build_object('rulePack',(select to_jsonb(p) from ediel_rule_packs p),'messageProfile',(select to_jsonb(p) from ediel_message_profiles p),'guideSources',(select jsonb_agg(to_jsonb(s) order by id) from ediel_rule_pack_sources s)) s")).rows[0].s
 const pFreshEvidence={...pEvidence,profileKey:'DB:Z04',snapshot:{...pEvidence.snapshot,profileKey:'DB:Z04',...pNamed}}
 const registerSource=await counted(pSource.replace('BGM+Z14','BGM+Z04').replace("LIN+1++OBJECT1'","LIN+1+1:7+OBJECT1:::9'").replace("LIN+2++OBJECT2'","LIN+2+2:7+OBJECT1:::9'").replace("RFF+LI:L2'",''))
 const ownLines=(await db.query('select gridex_utilts_binding.wire_tokens_v1($1) t',[registerSource])).rows[0].t.filter(t=>t.tag==='LIN')
 const ownRegister={version:1,owner:'validateProdatRegisterPolicy',coverage:'canonical_register_only',objects:[{messageIndex:0,messageReference:'P1',objectId:'OBJECT1',identityAgency:'9',disposition:'accepted',registers:ownLines.map((t,index)=>({lineIndex:index,lineNumber:String(index+1),registerIndex:String(index+1),registerPosition:index+1,segmentIndex:t.index})),reasons:[]}]}
 const ownResponse={scope:'object',lineIndex:ownLines[0].index,ercCode:'100',fieldCode:null,text:'OK',id:'OBJECT1',li:'L1'}
 const pFacet={version:1,sourcePayloadHash:(await db.query("select encode(sha256(convert_to($1,'UTF8')),'hex') h",[registerSource])).rows[0].h,objects:[{lineIndex:ownLines[0].index,registerLineIndices:ownLines.map(line=>line.index),id:'OBJECT1',li:'L1',outcome:'positive'}],responses:[ownResponse]}
 const pFacts={version:1,owner:'canonical-runtime-with-registry-v1',sourceDisposition:'not_established',objectDisposition:'not_checked',partyDisposition:'not_checked',coverage:'canonical_runtime_only',originalTenantMatch:'matched',syntaxDecision:'accepted',applicationDecision:'accepted',functionalDecision:'accepted',messageReference:'P1',reasonCodes:[],rulePackEvidence:{...pFreshEvidence,snapshot:pNamed},registerValidation:ownRegister}
 await db.query("insert into ediel_messages(id,company_id,environment,direction,message_family,message_code,raw_payload,message_received_at) values($1,$2,'test','inbound','PRODAT','Z04',$3,now())",[uid(130),uid(1),registerSource]);await legal(130)
 await db.query("insert into gridex_received_sources.sources values($1,$2,'test',$3,'{\"contextOrigin\":\"database_insert\"}',$4)",[uid(130),uid(1),pFacet.sourcePayloadHash,registerSource])
 await db.query("insert into gridex_ediel_source_rules.receipts(source_message_id,company_id,environment,direction,payload_sha256,evidence) values($1,$2,'test','inbound',$3,$4)",[uid(130),uid(1),pFacet.sourcePayloadHash,pFreshEvidence]);await db.query("select gridex_ediel_ack_guide.bind_source_v1(m,'national',$2) from ediel_messages m where id=$1",[uid(130),pFreshEvidence])
 const recordP=async(facet=pFacet,facts=pFacts)=>{await db.exec('set role service_role');try{return(await db.query('select public.gridex_record_prodat_source_validation_v3($1,$2,$3,$4,$5,$6,$7) r',[uid(1),'test',uid(130),pFacet.sourcePayloadHash,JSON.stringify(facts),null,facet===null?null:JSON.stringify(facet)])).rows[0].r}finally{await db.exec('reset role')}}
 const registeredReceipt=await recordP();assert.equal(registeredReceipt.version,3);assert.ok(registeredReceipt.responseFactsHash);checks++
 for(const functionalDecision of ['rejected','manual_review','not_applicable']){await assert.rejects(recordP(pFacet,{...pFacts,functionalDecision}),/same_owner_required/);checks++}
 const readOwnP=(await db.query('select gridex_received_sources.require_prodat_responses_v1($1,$2) r',[uid(1),uid(130)])).rows[0].r;assert.deepEqual(readOwnP.objects,pFacet.objects);checks++
 for(const facet of [{...pFacet,sourcePayloadHash:'f'.repeat(64)},{...pFacet,objects:[{...pFacet.objects[0],registerLineIndices:[ownLines[0].index]}]},{...pFacet,responses:[{...ownResponse,li:'SIBLING'}]},{...pFacet,objects:[{...pFacet.objects[0],outcome:'held'}]}]){await assert.rejects(recordP(facet),/same_owner_required/);checks++}
 const assessmentsBefore=(await db.query('select count(*)::int n from gridex_received_sources.validation_assessments where source_message_id=$1',[uid(130)])).rows[0].n
 await assert.rejects(recordP({...pFacet,responses:[{...ownResponse,ercCode:'41'}]}),/same_owner_required/);assert.equal((await db.query('select count(*)::int n from gridex_received_sources.validation_assessments where source_message_id=$1',[uid(130)])).rows[0].n,assessmentsBefore);checks++
 const positiveRegisterRaw=await counted((await pAck('REGISTER')).replace("ERC+41::260'FTX+AAO++209::260+Anläggnings-id saknas'RFF+LI:L2'RFF+Z07:OBJECT2'",''))
 const prepareRegister=async(raw=positiveRegisterRaw)=>(await db.query('select gridex_ediel_outbound_owner.prepare_v1($1) r',[{companyId:uid(1),actorUserId:uid(7),environment:'test',rawPayload:raw,relatedMessageId:uid(130),rulePackEvidence:pFreshEvidence}])).rows[0].r
 const registerSeal=await prepareRegister();assert.ok((await db.query('select assessment_id from gridex_ediel_ack_guide.prodat_response_owner_bindings where witness_id=$1',[registerSeal.witnessId])).rows[0]);checks++
 await assert.rejects(prepareRegister(positiveRegisterRaw.replace('ERC+100','ERC+41').replace('FTX+AAO+++OK','FTX+AAO++213::260+Uppskattad årsenergi saknas')),/native_ack_guide_invalid/);checks++
 // A later canonical leaf without a new response facet cannot authorize any
 // first response; it also cannot reinterpret the already sealed own plan.
 await recordP(null);await assert.rejects(prepareRegister(),/original_owner_unavailable/);checks++
 await db.query("insert into ediel_messages(id,company_id,environment,direction,message_family,message_code,raw_payload,related_message_id,canonical_rule_pack_id,rule_profile_version_id,rule_profile_key,rule_profile_version,rule_pack_checksum,rule_pack_snapshot,execution_context_snapshot,immutable_payload_hash,immutable_rendered_at) values($1,$2,'test','outbound','APERAK','APERAK',$3,$4,$5,$6,'DB:Z04',$7,$8,$9,$10,encode(sha256(convert_to($3,'UTF8')),'hex'),now())",[uid(131),uid(1),positiveRegisterRaw,uid(130),pFreshEvidence.rulePackId,pFreshEvidence.messageProfileId,pFreshEvidence.version,pFreshEvidence.sourceHash,registerSeal.evidence.snapshot,{outboundOwnerWitnessId:registerSeal.witnessId}]);checks++
 assert.equal((await db.query('select count(*)::int n from gridex_ediel_ack_guide.outbound_prodat_scopes where source_message_id=$1',[uid(130)])).rows[0].n,1);checks++
 await db.query('select gridex_ediel_ack_guide.require_v1(m) from ediel_messages m where id=$1',[uid(131)]);checks++
 // The authentic PRODAT guide permits an individual negative ACK for one
 // object. A held sibling has no fabricated positive or negative outcome.
 const partialSource=await counted(pSource.replace('BGM+Z14','BGM+Z04').replace("LIN+1++OBJECT1'","LIN+1+1:7+OBJECT1:::9'").replace("LIN+2++OBJECT2'","LIN+2+1:7+OBJECT2:::9'"))
 const partialLines=(await db.query('select gridex_utilts_binding.wire_tokens_v1($1) t',[partialSource])).rows[0].t.filter(t=>t.tag==='LIN')
 const partialHash=(await db.query("select encode(sha256(convert_to($1,'UTF8')),'hex') h",[partialSource])).rows[0].h
 const partialObjects=partialLines.map((line,index)=>({lineIndex:line.index,registerLineIndices:[line.index],id:`OBJECT${index+1}`,li:`L${index+1}`,outcome:index===0?'negative':'held'}))
 const partialRegister={...ownRegister,objects:partialLines.map((line,index)=>({...ownRegister.objects[0],objectId:`OBJECT${index+1}`,registers:[{lineIndex:index,lineNumber:String(index+1),registerIndex:'1',registerPosition:1,segmentIndex:line.index}]}))}
 const partialResponse={...ownResponse,lineIndex:partialLines[0].index,ercCode:'41',fieldCode:'209',text:'Anläggnings-id saknas'}
 const partialFacet={version:1,sourcePayloadHash:partialHash,objects:partialObjects,responses:[partialResponse]}
 const partialFacts={...pFacts,applicationDecision:'rejected',reasonCodes:['FIXTURE_SAME_OWNER_QUALIFIED_FIELD_209'],registerValidation:partialRegister}
 await db.query("insert into ediel_messages(id,company_id,environment,direction,message_family,message_code,raw_payload,message_received_at) values($1,$2,'test','inbound','PRODAT','Z04',$3,now())",[uid(140),uid(1),partialSource]);await legal(140)
 await db.query("insert into gridex_received_sources.sources values($1,$2,'test',$3,'{\"contextOrigin\":\"database_insert\"}',$4)",[uid(140),uid(1),partialHash,partialSource])
 await db.query("insert into gridex_ediel_source_rules.receipts(source_message_id,company_id,environment,direction,payload_sha256,evidence) values($1,$2,'test','inbound',$3,$4)",[uid(140),uid(1),partialHash,pFreshEvidence]);await db.query("select gridex_ediel_ack_guide.bind_source_v1(m,'national',$2) from ediel_messages m where id=$1",[uid(140),pFreshEvidence])
 await db.exec('set role service_role');try{await db.query('select public.gridex_record_prodat_source_validation_v3($1,$2,$3,$4,$5,$6,$7)',[uid(1),'test',uid(140),partialHash,JSON.stringify(partialFacts),null,JSON.stringify(partialFacet)])}finally{await db.exec('reset role')};checks++
 const partialRaw=await counted((await pAck('PARTIAL','negative','negative')).replace("ERC+41::260'FTX+AAO++209::260+Anläggnings-id saknas'RFF+LI:L2'RFF+Z07:OBJECT2'",''))
 const preparePartial=async(raw=partialRaw)=>(await db.query('select gridex_ediel_outbound_owner.prepare_v1($1) r',[{companyId:uid(1),actorUserId:uid(7),environment:'test',rawPayload:raw,relatedMessageId:uid(140),rulePackEvidence:pFreshEvidence}])).rows[0].r
 const partialSeal=await preparePartial();assert.ok(partialSeal.witnessId);checks++
 await assert.rejects(preparePartial(await pAck('UNASSESSED-SIBLING','negative','positive')),/native_ack_guide_invalid/);checks++
 await assert.rejects(preparePartial(await pAck('INVENTED-NEGATIVE','negative','negative')),/native_ack_guide_invalid/);checks++
 await assert.rejects(preparePartial(partialRaw.replace('RFF+LI:L1','RFF+LI:L2').replace('RFF+Z07:OBJECT1','RFF+Z07:OBJECT2')),/native_ack_guide_invalid/);checks++
 await assert.rejects(preparePartial(partialRaw.replace('209::260+Anläggnings-id saknas','213::260+Uppskattad årsenergi saknas')),/native_ack_guide_invalid/);checks++
 await db.query("insert into ediel_messages(id,company_id,environment,direction,message_family,message_code,raw_payload,related_message_id,canonical_rule_pack_id,rule_profile_version_id,rule_profile_key,rule_profile_version,rule_pack_checksum,rule_pack_snapshot,execution_context_snapshot,immutable_payload_hash,immutable_rendered_at) values($1,$2,'test','outbound','APERAK','APERAK',$3,$4,$5,$6,'DB:Z04',$7,$8,$9,$10,encode(sha256(convert_to($3,'UTF8')),'hex'),now())",[uid(141),uid(1),partialRaw,uid(140),pFreshEvidence.rulePackId,pFreshEvidence.messageProfileId,pFreshEvidence.version,pFreshEvidence.sourceHash,partialSeal.evidence.snapshot,{outboundOwnerWitnessId:partialSeal.witnessId}]);checks++
 assert.deepEqual((await db.query('select scope_reference,outcome from gridex_ediel_ack_guide.outbound_prodat_scopes where source_message_id=$1',[uid(140)])).rows,[{scope_reference:String(partialLines[0].index),outcome:'negative'}]);checks++
 await db.query('select gridex_ediel_ack_guide.require_v1(m) from ediel_messages m where id=$1',[uid(141)]);checks++
 // Missing field226 is a genuine negative object response. Execute the SAME
 // existing source/plan/seal/INSERT authority, with an explicitly modeled
 // canonical negative facet. No original LI alias or native rule is added.
 const missingLiSource=await counted(partialSource.replace("RFF+LI:L1'",''))
 const missingLiLines=(await db.query('select gridex_utilts_binding.wire_tokens_v1($1) t',[missingLiSource])).rows[0].t.filter(t=>t.tag==='LIN')
 const missingLiHash=(await db.query("select encode(sha256(convert_to($1,'UTF8')),'hex') h",[missingLiSource])).rows[0].h
 const missingLiRegister={...partialRegister,objects:partialRegister.objects.map((object,index)=>({...object,registers:[{...object.registers[0],segmentIndex:missingLiLines[index].index}]}))}
 const missingLiFacet={...partialFacet,sourcePayloadHash:missingLiHash,objects:partialObjects.map((object,index)=>({...object,lineIndex:missingLiLines[index].index,registerLineIndices:[missingLiLines[index].index],li:index===0?null:object.li})),
  responses:[{...partialResponse,lineIndex:missingLiLines[0].index,fieldCode:'226',text:'Ärendereferens saknas',li:null}]}
 const missingLiFacts={...partialFacts,registerValidation:missingLiRegister,reasonCodes:['FIXTURE_SAME_OWNER_QUALIFIED_FIELD_226']}
 await db.query("insert into ediel_messages(id,company_id,environment,direction,message_family,message_code,raw_payload,message_received_at) values($1,$2,'test','inbound','PRODAT','Z04',$3,now())",[uid(150),uid(1),missingLiSource]);await legal(150)
 await db.query("insert into gridex_received_sources.sources values($1,$2,'test',$3,'{\"contextOrigin\":\"database_insert\"}',$4)",[uid(150),uid(1),missingLiHash,missingLiSource])
 await db.query("insert into gridex_ediel_source_rules.receipts(source_message_id,company_id,environment,direction,payload_sha256,evidence) values($1,$2,'test','inbound',$3,$4)",[uid(150),uid(1),missingLiHash,pFreshEvidence]);await db.query("select gridex_ediel_ack_guide.bind_source_v1(m,'national',$2) from ediel_messages m where id=$1",[uid(150),pFreshEvidence])
 await db.exec('set role service_role');try{await db.query('select public.gridex_record_prodat_source_validation_v3($1,$2,$3,$4,$5,$6,$7)',[uid(1),'test',uid(150),missingLiHash,JSON.stringify(missingLiFacts),null,JSON.stringify(missingLiFacet)])}finally{await db.exec('reset role')};checks++
 const missingLiRaw=await counted(partialRaw.replaceAll('PARTIAL','MISSING-LI').replace("RFF+LI:L1'",'').replace('209::260+Anläggnings-id saknas','226::260+Ärendereferens saknas'))
 const prepareMissingLi=async(raw=missingLiRaw)=>(await db.query('select gridex_ediel_outbound_owner.prepare_v1($1) r',[{companyId:uid(1),actorUserId:uid(7),environment:'test',rawPayload:raw,relatedMessageId:uid(150),rulePackEvidence:pFreshEvidence}])).rows[0].r
 const missingLiSeal=await prepareMissingLi();assert.ok(missingLiSeal.witnessId);checks++
 await assert.rejects(prepareMissingLi(missingLiRaw.replace('RFF+Z07:OBJECT1','RFF+Z07:OBJECT2')),/native_ack_guide_invalid/);checks++
 await assert.rejects(prepareMissingLi(missingLiRaw.replace("ERC+41::260'FTX+AAO++226::260+Ärendereferens saknas'","ERC+100::260'FTX+AAO+++OK'")),/native_ack_guide_invalid/);checks++
 await assert.rejects(prepareMissingLi(await counted(missingLiRaw.replace("RFF+Z07:OBJECT1'","RFF+Z07:OBJECT1'RFF+LI:OBJECT1'"))),/native_ack_guide_invalid/);checks++
 await db.query("insert into ediel_messages(id,company_id,environment,direction,message_family,message_code,raw_payload,related_message_id,canonical_rule_pack_id,rule_profile_version_id,rule_profile_key,rule_profile_version,rule_pack_checksum,rule_pack_snapshot,execution_context_snapshot,immutable_payload_hash,immutable_rendered_at) values($1,$2,'test','outbound','APERAK','APERAK',$3,$4,$5,$6,'DB:Z04',$7,$8,$9,$10,encode(sha256(convert_to($3,'UTF8')),'hex'),now())",[uid(151),uid(1),missingLiRaw,uid(150),pFreshEvidence.rulePackId,pFreshEvidence.messageProfileId,pFreshEvidence.version,pFreshEvidence.sourceHash,missingLiSeal.evidence.snapshot,{outboundOwnerWitnessId:missingLiSeal.witnessId}]);checks++
 const missingLiScope=(await db.query('select scope_reference,physical_source_reference,outcome from gridex_ediel_ack_guide.outbound_prodat_scopes where source_message_id=$1',[uid(150)])).rows
 assert.deepEqual(missingLiScope,[{scope_reference:String(missingLiLines[0].index),physical_source_reference:{lineIndex:missingLiLines[0].index,id:'OBJECT1',li:null},outcome:'negative'}]);checks++
 await db.query('select gridex_ediel_ack_guide.require_v1(m) from ediel_messages m where id=$1',[uid(151)]);checks++
 await assert.rejects(prepareMissingLi(),/scope_already_fixed/);checks++
 // An authenticated pre-migration sealed response has its established own
 // scope checked before the new prospective response-plan requirement.
 await db.query('select gridex_ediel_ack_guide.require_v1(m) from ediel_messages m where id=$1',[uid(121)]);checks++
 const facetAcl=(await db.query("select has_table_privilege('service_role','gridex_received_sources.prodat_response_facets','insert') write_facet,has_function_privilege('service_role','gridex_received_sources.require_prodat_responses_v1(uuid,uuid)','execute') read_private")).rows[0];assert.deepEqual(facetAcl,{write_facet:false,read_private:false});checks++
 await assert.rejects(db.exec('update gridex_received_sources.prodat_response_facets set response_facts_text=response_facts_text'),/append_only/);checks++
 // Prospective V4 complete application facet: actual existing V3 owner and
 // all physical groups, not a borrowed register/ACK business verdict.
 await db.exec(readFileSync(new URL('../supabase/migrations/20261001010321_ediel_complete_prodat_own_application_facets.sql',import.meta.url),'utf8'));checks++
 const ownApplication={version:1,owner:'canonical-prodat-application-all-v1',coverage:'canonical_own_application_only',headerDecision:'accepted',sourcePayloadHash:partialHash,
  objects:partialRegister.objects.map((row,index)=>{const {disposition,reasons,...scope}=row;return {...scope,applicationDecision:index===0?'rejected':'accepted',reasonCodes:index===0?['FIXTURE_SAME_OWNER_QUALIFIED_FIELD_209']:[]}})}
 const recordOwnApplication=async(facet=ownApplication,canonical=partialFacts,response=partialFacet)=>{await db.exec('set role service_role');try{return(await db.query('select public.gridex_record_prodat_source_validation_v4($1,$2,$3,$4,$5,$6,$7,$8) r',[uid(1),'test',uid(140),partialHash,JSON.stringify(canonical),null,JSON.stringify(response),facet===null?null:JSON.stringify(facet)])).rows[0].r}finally{await db.exec('reset role')}}
 const appReceipt=await recordOwnApplication();assert.equal(appReceipt.version,4);assert.ok(appReceipt.applicationFactsHash);checks++
 const ownApp=(await db.query('select gridex_received_sources.require_prodat_application_objects_v1($1,$2) r',[uid(1),uid(140)])).rows[0].r
 assert.deepEqual(ownApp.objects.map(row=>row.applicationDecision),['rejected','accepted']);checks++
 const {disposition:unusedDisposition,reasons:unusedReasons,...goodScope}=partialRegister.objects[1]
 assert.equal((await db.query('select gridex_received_sources.prodat_application_object_accepted_v1($1,$2,$3,$4) ok',[uid(1),uid(140),appReceipt.assessmentId,goodScope])).rows[0].ok,true);checks++
 assert.equal((await db.query('select gridex_received_sources.prodat_application_object_accepted_v1($1,$2,$3,$4) ok',[uid(1),uid(140),appReceipt.assessmentId,{...goodScope,objectId:'SIBLING'}])).rows[0].ok,false);checks++
 const beforeAppCount=(await db.query('select count(*)::int n from gridex_received_sources.validation_assessments where source_message_id=$1',[uid(140)])).rows[0].n
 for(const facet of [{...ownApplication,sourcePayloadHash:'f'.repeat(64)},{...ownApplication,objects:[ownApplication.objects[1]]},{...ownApplication,objects:[ownApplication.objects[1],ownApplication.objects[1]]},
  {...ownApplication,headerDecision:'rejected'},{...ownApplication,objects:ownApplication.objects.map(row=>({...row,applicationDecision:'accepted',reasonCodes:[]}))},
  {...ownApplication,objects:ownApplication.objects.map(row=>({...row,businessAccepted:true}))}]){
  await assert.rejects(recordOwnApplication(facet),/same_owner_required/);assert.equal((await db.query('select count(*)::int n from gridex_received_sources.validation_assessments where source_message_id=$1',[uid(140)])).rows[0].n,beforeAppCount);checks++
 }
 await assert.rejects(recordOwnApplication(ownApplication,{...partialFacts,functionalDecision:'manual_review'}),/same_owner_required/);checks++
 await assert.rejects(db.exec('update gridex_received_sources.prodat_application_facets set application_facts_text=application_facts_text'),/append_only/);checks++
 const ownAppAcl=(await db.query("select has_table_privilege('service_role','gridex_received_sources.prodat_application_facets','insert') write_facet,has_function_privilege('authenticated','public.ediel_read_prodat_application_objects_v1(uuid,uuid)','execute') user_read")).rows[0];assert.deepEqual(ownAppAcl,{write_facet:false,user_read:false});checks++
 await recordOwnApplication(null);await assert.rejects(db.query('select gridex_received_sources.require_prodat_application_objects_v1($1,$2)',[uid(1),uid(140)]),/original_owner_unavailable/);checks++
 // The prospective envelope guard composes with the REAL already loaded
 // canonical owner, national guide, source scope and original consume stack.
 await db.exec(readFileSync(new URL('../supabase/migrations/20261001021545_ediel_fresh_ack_native_envelope_authority.sql',import.meta.url),'utf8'));checks++
 const witnessCount=(await db.query('select count(*)::int n from gridex_ediel_outbound_owner.witnesses')).rows[0].n
 await assert.rejects(prepareAck('312','T',ackRaw().replace('UNZ+1+OWN-AP','UNZ+1+OTHER')),/ediel_fresh_ack_envelope_invalid/)
 assert.equal((await db.query('select count(*)::int n from gridex_ediel_outbound_owner.witnesses')).rows[0].n,witnessCount);checks++
 await assert.rejects(db.query("insert into ediel_messages(id,company_id,environment,direction,message_family,message_code,raw_payload)values($1,$2,'test','outbound','APERAK','APERAK',$3)",[uid(199),uid(1),ackRaw().replace('UNZ+1+','UNZ+2+')]),/ediel_fresh_ack_envelope_invalid/)
 assert.equal((await db.query('select count(*)::int n from ediel_messages where id=$1',[uid(199)])).rows[0].n,0);checks++
 // The new birth guard does not replace the historical wire projector or
 // move today's envelope validation ahead of immutable provider-entry replay.
 assert.notEqual((await db.query('select gridex_ack_authority.wire_v1($1) r',[ackRaw().replace('UNZ+1+OWN-AP','UNZ+1+OTHER')])).rows[0].r,null);checks++
 assert.equal((await db.query('select gridex_ediel_transport.mutate_v1($1) r',[{...positiveInput,action:'enter'}])).rows[0].r.proceed,false);checks++
 await db.query('select gridex_ediel_ack_guide.require_v1(m) from ediel_messages m where id=$1',[uid(151)]);checks++
 console.log(`Focused PostgreSQL outbound original owner seal/one-use atomic insertion/named version/raw scope/ACL/native Z08 binding checks: ${checks} PASS`)
} catch(e){console.error(e.stack,e.where??'',e.position??'',e.routine??'');process.exitCode=1} finally{await db.close()}
