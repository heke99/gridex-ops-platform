// Focused embedded PostgreSQL gate/ledger projection checks. Source canonical
// admission and legal-context capture are declared fixture contracts; not native
// replay, historical identity evidence or authentic legal approval.
import { readFileSync } from 'node:fs'
import { pathToFileURL } from 'node:url'
import assert from 'node:assert/strict'
const { PGlite } = await import(pathToFileURL(process.env.EDIEL_PGLITE_MODULE).href), db = new PGlite()
const uid=n=>`00000000-0000-0000-0000-${String(n).padStart(12,'0')}`
let checks=0
async function service(sql){await db.exec('set role service_role');try{return await db.query(sql)}finally{await db.exec('reset role')}}
try{
await db.exec(`create role anon;create role authenticated;create role service_role;create schema gridex_received_sources;
 create table ediel_messages(id uuid primary key,company_id uuid,environment text,direction text,message_family text,raw_payload text);
 create table customer_supply_periods(id uuid primary key,company_id uuid,customer_id uuid,metering_point_id uuid,market_start_at timestamptz,market_end_at timestamptz,market_state_version bigint,source_message_id uuid,source_end_message_id uuid,metadata jsonb);
 create table gridex_received_sources.supply_source_transitions(source_message_id uuid primary key,company_id uuid,payload_hash text,source_code text,resulting_states jsonb);
 create table gridex_received_sources.permission_transitions(source_message_id uuid primary key,company_id uuid,permission_id uuid,payload_hash text);
 create table gridex_received_sources.validation_assessments(id uuid,source_message_id uuid,company_id uuid,environment text,source_payload_hash text,facts_text text,previous_assessment_id uuid);
 create table gridex_received_sources.regulated_supply_ground_versions(id uuid primary key,company_id uuid,environment text,legal_actor_id uuid,source_reference text,source_sha256 text,legal_decision_reference text,registry_version text,valid_from timestamptz,valid_to timestamptz,revoked_at timestamptz);
 create table gridex_received_sources.prodat_recovery_operations(id uuid,company_id uuid,kind text,original_message_id uuid,source_ack_message_id uuid,corrected_raw_payload text,corrected_payload_hash text);
 create table gridex_received_sources.prodat_recovery_messages(operation_id uuid,message_id uuid);
 create schema gridex_ediel_inbound_context;create table captured_context_fixture(message_id uuid,context jsonb);create table effects_fixture(message_id uuid);
 create function gridex_ediel_inbound_context.require_v1(uuid,uuid) returns jsonb language plpgsql as $$declare c jsonb;begin select context into c from public.captured_context_fixture where message_id=$2;if c is null then raise exception 'genuine_captured_context_required';end if;return c;end$$;
 create function public.ediel_apply_supply_source_v1(uuid,uuid,uuid) returns jsonb language plpgsql as $$begin insert into public.effects_fixture values($2);return jsonb_build_object('applied',true);end$$;
 create function public.ediel_apply_permission_source_v1(uuid,uuid,uuid,uuid default null) returns jsonb language plpgsql as $$begin insert into public.effects_fixture values($2);return jsonb_build_object('applied',true);end$$;
 create function public.ediel_prepare_prodat_recovery_v1(uuid,uuid,uuid,uuid,uuid,uuid,text) returns jsonb language sql as $$select jsonb_build_object('status','authorized','operationId',$4)$$;
 create function public.ediel_require_prodat_recovery_current_v1(uuid,uuid) returns void language plpgsql as $$begin return;end$$;
 create function gridex_received_sources.prodat_recovery_wire_v1(text) returns jsonb language sql as $$select $1::jsonb$$;`)
await db.exec(readFileSync(new URL('../supabase/migrations/20260930181909_ediel_source_consumer_authority_bridges.sql',import.meta.url),'utf8'));checks++
await db.exec(`insert into ediel_messages values('${uid(1)}','${uid(2)}','test','inbound','PRODAT','SOURCE');`)
await assert.rejects(db.exec(`select ediel_apply_supply_source_v1('${uid(2)}','${uid(1)}','${uid(3)}')`),/captured_context_required/);checks++
assert.equal((await db.query('select count(*) n from effects_fixture')).rows[0].n,0);checks++
await db.exec(`insert into captured_context_fixture values('${uid(1)}',jsonb_build_object('legalActorId','${uid(4)}','actorRole','electricity_supplier'))`)
assert.equal((await service(`select ediel_apply_supply_source_v1('${uid(2)}','${uid(1)}','${uid(3)}') b`)).rows[0].b.applied,true);checks++
await db.exec(`insert into gridex_received_sources.supply_source_transitions values('${uid(1)}','${uid(2)}',encode(sha256(convert_to('SOURCE','UTF8')),'hex'),'Z04','[]');delete from captured_context_fixture;`)
assert.equal((await service(`select ediel_apply_supply_source_v1('${uid(2)}','${uid(1)}','${uid(3)}') b`)).rows[0].b.applied,true);checks++ // established own hash-qualified source outcome does not invent current historic identity
await assert.rejects(db.exec(`select ediel_apply_permission_source_v1('${uid(2)}','${uid(1)}','${uid(3)}')`),/captured_context_required/);checks++
await db.exec(`insert into gridex_received_sources.permission_transitions values('${uid(1)}','${uid(2)}','${uid(6)}',encode(sha256(convert_to('SOURCE','UTF8')),'hex'))`)
assert.equal((await service(`select ediel_apply_permission_source_v1('${uid(2)}','${uid(1)}','${uid(3)}','${uid(6)}') b`)).rows[0].b.applied,true);checks++
await assert.rejects(db.exec(`select ediel_apply_permission_source_v1('${uid(2)}','${uid(1)}','${uid(3)}','${uid(99)}')`),/captured_context_required/);checks++
await db.exec(`create function public.billing_consumer_fixture(uuid,uuid,timestamptz,timestamptz) returns jsonb language sql security definer set search_path=pg_catalog as $$select gridex_received_sources.billing_supply_basis_v1($1,$2,$3,$4)$$;revoke all on function public.billing_consumer_fixture(uuid,uuid,timestamptz,timestamptz) from public,anon,authenticated;grant execute on function public.billing_consumer_fixture(uuid,uuid,timestamptz,timestamptz) to service_role;`)
const billing=(company=uid(2),start='2026-10-01T00:00Z',end='2026-10-02T00:00Z')=>service(`select public.billing_consumer_fixture('${company}','${uid(7)}','${start}','${end}') b`)
assert.equal((await billing()).rows[0].b,null);checks++
await db.exec(`insert into customer_supply_periods values('${uid(7)}','${uid(2)}','${uid(8)}','${uid(9)}','2026-10-01T00:00Z',null,1,'${uid(1)}',null,jsonb_build_object('sourceGroundId','${uid(10)}'));
 update gridex_received_sources.supply_source_transitions set resulting_states=(select jsonb_build_array(to_jsonb(p)||jsonb_build_object('status','confirmed_by_grid_owner')) from customer_supply_periods p);
 insert into gridex_received_sources.regulated_supply_ground_versions values('${uid(10)}','${uid(2)}','test','${uid(4)}','SYNTHETIC NOT LEGAL',repeat('a',64),'SYNTHETIC DECISION','1','2026-01-01','2027-01-01',null);
 insert into gridex_received_sources.validation_assessments select '${uid(11)}',id,company_id,environment,encode(sha256(convert_to(raw_payload,'UTF8')),'hex'),'{"syntaxDecision":"accepted","applicationDecision":"accepted","functionalDecision":"accepted"}',null from ediel_messages;
 insert into captured_context_fixture values('${uid(1)}',jsonb_build_object('legalActorId','${uid(4)}','actorRole','electricity_supplier'));`)
assert.equal((await billing()).rows[0].b.qualified,true);checks++
assert.equal((await billing(uid(99))).rows[0].b,null);checks++
assert.equal((await billing(uid(2),'2026-09-01T00:00Z')).rows[0].b,null);checks++
await db.exec(`update customer_supply_periods set market_state_version=2`);assert.equal((await billing()).rows[0].b,null);checks++
await db.exec(`insert into ediel_messages values('${uid(12)}','${uid(2)}','test','inbound','PRODAT','CANCEL-END');insert into gridex_received_sources.supply_source_transitions select id,company_id,encode(sha256(convert_to(raw_payload,'UTF8')),'hex'),'Z05',(select jsonb_build_array(to_jsonb(p)||jsonb_build_object('status','active')) from customer_supply_periods p) from ediel_messages where id='${uid(12)}';
 insert into gridex_received_sources.validation_assessments select '${uid(13)}',id,company_id,environment,encode(sha256(convert_to(raw_payload,'UTF8')),'hex'),'{"syntaxDecision":"accepted","applicationDecision":"accepted","functionalDecision":"accepted"}',null from ediel_messages where id='${uid(12)}';`)
assert.equal((await billing()).rows[0].b.sourceMessageId,uid(12));checks++ // exact C-restored current version, never timestamp-based latest guess
await db.exec(`update gridex_received_sources.regulated_supply_ground_versions set revoked_at=now()`);assert.equal((await billing()).rows[0].b,null);checks++
await assert.rejects(db.exec(`update gridex_received_sources.regulated_supply_ground_versions set revoked_at=null`),/source_immutable/);checks++
const acl=(await db.query(`select has_function_privilege('service_role','gridex_received_sources.apply_supply_before_legal_context_v1(uuid,uuid,uuid)','execute') bypass,has_function_privilege('authenticated','public.ediel_apply_supply_source_v1(uuid,uuid,uuid)','execute') public_access`)).rows[0];assert.deepEqual(acl,{bypass:false,public_access:false});checks++
console.log(`PASS ${checks} focused source-consumer PostgreSQL bridge/bounds/replay/ACL checks; synthetic helper fixtures, not native/historical evidence`)
}finally{await db.close()}
