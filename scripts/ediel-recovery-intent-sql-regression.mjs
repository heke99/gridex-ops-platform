// Focused embedded PostgreSQL correction-intent reservation/binding checks.
// Source/negative-ACK authority is a declared fixture contract, not native or
// authentic counterpart evidence. The actual source authorizer has its own suite.
import {readFileSync} from 'node:fs'
import {pathToFileURL} from 'node:url'
import assert from 'node:assert/strict'
const {PGlite}=await import(pathToFileURL(process.env.EDIEL_PGLITE_MODULE).href),db=new PGlite()
const uid=n=>`00000000-0000-0000-0000-${String(n).padStart(12,'0')}`
let checks=0
try{
 await db.exec(`create role anon;create role authenticated;create role service_role;create schema gridex_received_sources;
 create table companies(id uuid primary key);insert into companies values('${uid(1)}');
 create table ediel_message_intents(id uuid primary key,company_id uuid,environment text,message_family text,message_code text,direction text,customer_id uuid,operation_id uuid,validation_status text,interchange_reference text,message_reference text,sender_ediel_id text,receiver_ediel_id text,communication_route_id uuid,route_profile_id uuid);
 create table outbound_requests(id uuid primary key,company_id uuid,customer_id uuid,environment text,source_type text,source_id text,request_type text);
 create table ediel_messages(id uuid primary key,company_id uuid,environment text,direction text,message_family text,message_code text,customer_id uuid,intent_id uuid,outbound_request_id uuid,source_operation_id text,original_message_id uuid,raw_payload text,created_by uuid);
 create table gridex_received_sources.prodat_recovery_operations(id uuid primary key,company_id uuid,kind text,environment text,original_message_id uuid,corrected_raw_payload text);
 create table gridex_received_sources.prodat_recovery_messages(operation_id uuid primary key,message_id uuid);
 create function gridex_received_sources.permission_transition_immutable_v1() returns trigger language plpgsql as $$begin raise exception 'immutable';end$$;
 create function public.ediel_prodat_recovery_operation_basis_v1(uuid,uuid,uuid) returns jsonb language plpgsql as $$begin if $1<>'${uid(1)}' or $2<>'${uid(2)}' or $3<>'${uid(3)}' then raise exception 'actual_fixture_owner_basis_required';end if;return jsonb_build_object('operationId',$2);end$$;
 create function gridex_received_sources.prodat_recovery_wire_v1(text) returns jsonb language sql as $$select $1::jsonb$$;
 insert into ediel_messages values('${uid(4)}','${uid(1)}','test','outbound','PRODAT','Z01','${uid(5)}',null,null,null,null,'ORIGINAL','${uid(3)}');
 insert into gridex_received_sources.prodat_recovery_operations values('${uid(2)}','${uid(1)}','aperak_correction','test','${uid(4)}','{"code":"Z01","interchange":"NEW","messageReference":"1","transportSender":["111"],"transportReceiver":["222"]}');
 insert into ediel_message_intents values('${uid(6)}','${uid(1)}','test','PRODAT','Z01','outbound','${uid(5)}','${uid(2)}','validated','NEW','1','111','222','${uid(7)}','${uid(8)}');
 insert into outbound_requests values('${uid(9)}','${uid(1)}','${uid(5)}','test','manual','${uid(6)}','customer_masterdata'),('${uid(10)}','${uid(1)}','${uid(5)}','test','manual','${uid(6)}','customer_masterdata');`)
 await db.exec(readFileSync(new URL('../supabase/migrations/20260930190449_ediel_recovery_intent_source_gateway.sql',import.meta.url),'utf8'));checks++
 const reserve=(request=uid(9),intent=uid(6),actor=uid(3))=>db.query(`select ediel_reserve_prodat_recovery_origin_v1('${uid(1)}','${uid(2)}','${actor}','${intent}','${request}') b`)
 await assert.rejects(reserve(uid(9),uid(6),uid(99)),/owner_basis_required/);checks++
 await db.exec(`update ediel_message_intents set validation_status='draft'`);await assert.rejects(reserve(),/intent_scope_required/);checks++
 await db.exec(`update ediel_message_intents set validation_status='validated',interchange_reference='OLD'`);await assert.rejects(reserve(),/intent_scope_required/);checks++
 await db.exec(`update ediel_message_intents set interchange_reference='NEW';update outbound_requests set company_id='${uid(99)}' where id='${uid(9)}'`);await assert.rejects(reserve(),/owned_request_required/);checks++
 await db.exec(`update outbound_requests set company_id='${uid(1)}'`)
 assert.equal((await reserve()).rows[0].b.outboundRequestId,uid(9));checks++
 assert.equal((await reserve(uid(10))).rows[0].b.outboundRequestId,uid(9));checks++ // first private request wins
 await db.exec(`update outbound_requests set source_id='foreign' where id='${uid(9)}'`);await assert.rejects(reserve(uid(10)),/owned_request_required/);checks++
 await db.exec(`update outbound_requests set source_id='${uid(6)}' where id='${uid(9)}'`)
 const insert=(intent=uid(6),request=uid(9),wire=null)=>db.exec(`insert into ediel_messages select '${uid(11)}',company_id,environment,'outbound','PRODAT','Z01','${uid(5)}','${intent}','${request}',id::text,original_message_id,${wire===null?'corrected_raw_payload':`'${wire}'`},'${uid(3)}' from gridex_received_sources.prodat_recovery_operations;`)
 await assert.rejects(insert(uid(99)),/private_origin_required/);checks++
 await assert.rejects(insert(uid(6),uid(10)),/private_origin_required/);checks++
 await assert.rejects(insert(uid(6),uid(9),'MUTATED'),/private_origin_required/);checks++
 await insert();checks++
 await db.exec(`insert into gridex_received_sources.prodat_recovery_messages values('${uid(2)}','${uid(11)}')`)
 assert.equal((await reserve()).rows[0].b.messageId,uid(11));checks++
 await assert.rejects(db.exec('update gridex_received_sources.prodat_recovery_origins set actor_user_id=null'),/immutable/);checks++
 const acl=(await db.query(`select has_table_privilege('service_role','gridex_received_sources.prodat_recovery_origins','INSERT') directwrite,has_function_privilege('authenticated','public.ediel_reserve_prodat_recovery_origin_v1(uuid,uuid,uuid,uuid,uuid)','execute') publicexec`)).rows[0];assert.deepEqual(acl,{directwrite:false,publicexec:false});checks++
 console.log(`PASS ${checks} focused PostgreSQL correction intent/request/binding/ACL checks; declared synthetic source authority, not native/ACK evidence`)
}finally{await db.close()}
