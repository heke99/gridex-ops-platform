// Real forward atomic/native common source/guide/namespace/witness functions,
// declared synthetic schema, not Supabase native or market activation proof.
import {readFileSync,writeFileSync,unlinkSync} from 'node:fs'
import {spawnSync} from 'node:child_process'
import {fileURLToPath} from 'node:url'
import assert from 'node:assert/strict'
const base=readFileSync(new URL('./ediel-prodat-common-header-sql-regression.mjs',import.meta.url),'utf8')
const prior=readFileSync(new URL('./ediel-outbound-ack-replay-sql-regression.mjs',import.meta.url),'utf8')
const previous=prior.slice(prior.indexOf('const extension=String.raw`')+27,prior.indexOf('\n`\nconst generated='))
assert.ok(previous.startsWith('\n // Install'))
const extra=String.raw`
 // Unrelated graph tables are declared fixtures. Their authority paths are
 // not selected by this genuine common-header rejection scenario.
 await db.exec('create schema gridex_service_administration;create table gridex_service_administration.scope_versions(id uuid);create table gridex_received_sources.permission_transitions(id uuid);create table gridex_utilts_binding.receipts(id uuid);create table gridex_utilts_binding.contracts(id uuid);')
 for(const name of ['ediel_service_assignments','ediel_service_evidence','ediel_data_access_grants','ediel_assignment_permission_links','metering_permissions','metering_permission_sites','ediel_ack_transaction_results','meter_reading_series'])await db.exec('create table public.'+name+'(id uuid)')
 await db.exec('create table tenant_actor_roles(id uuid,company_id uuid,environment text,actor_id uuid,role_code text,valid_from timestamptz,valid_to timestamptz);create table tenant_ediel_profiles(id uuid,company_id uuid,environment text,market text,is_enabled boolean,valid_from timestamptz,valid_to timestamptz);')
 const migration=readFileSync(new URL('../supabase/migrations/20260930231958_ediel_atomic_ack_owner_persistence.sql',import.meta.url),'utf8')
 const columns=migration.match(/INSERT INTO public.ediel_messages\(([\s\S]*?)\)\n VALUES/)[1].replaceAll(/\s/g,'').split(',')
 const existingColumns=(await db.query("select column_name from information_schema.columns where table_schema='public' and table_name='ediel_messages'")).rows.map(x=>x.column_name)
 const json=new Set(['parsed_payload','validation_report','execution_context_snapshot','rule_pack_snapshot'])
 const booleans=new Set(['requires_contrl','requires_aperak'])
 for(const col of columns.filter(x=>!existingColumns.includes(x))){const type=json.has(col)?'jsonb':booleans.has(col)?'boolean':col==='test_flag'?'integer':(col.endsWith('_id')&&!['source_operation_id','original_message_id','original_transaction_id','sender_ediel_id','receiver_ediel_id'].includes(col))||col==='created_by'||col==='updated_by'?'uuid':col.endsWith('_at')?'timestamptz':'text';await db.exec('alter table ediel_messages add '+col+' '+type)}
 await db.exec('alter table gridex_ediel_outbound_owner.witnesses add actor_user_id uuid,add family text,add code text,add related_message_id uuid,add context jsonb;create table ediel_message_events(id uuid primary key default gen_random_uuid(),company_id uuid,ediel_message_id uuid,message_id uuid,event_type text,event_status text,message text,payload jsonb,event_payload jsonb,created_by uuid);create table ediel_business_references(company_id uuid,source_message_id uuid,reference_type text,reference_value text,message_family text,message_code text,business_object_type text,business_object_id uuid,customer_id uuid,customer_site_id uuid,metering_point_id uuid,unique(company_id,reference_type,reference_value,business_object_type,business_object_id));')
 await db.exec('create table communication_routes(id uuid primary key,company_id uuid,route_name text,route_scope text,environment_type text,is_active boolean,target_email text,route_type text,grid_owner_id uuid,target_system text,endpoint text,supported_payload_version text,notes text,auth_config jsonb);create table ediel_route_profiles(id uuid primary key,company_id uuid,communication_route_id uuid,transport_profile_id uuid,environment text,is_enabled boolean,is_active boolean,message_standard text,payload_format text,message_family text,business_code text,sender_ediel_id text,receiver_ediel_id text,sender_subaddress text,sender_sub_address text,receiver_subaddress text,receiver_sub_address text,application_reference text,mailbox text,smtp_host text,smtp_port integer,notes text);create table ediel_transport_profiles(id uuid primary key,company_id uuid,environment text,is_active boolean,transport_channel text,direction text,sender_email text,host text,port integer);')
 await db.query("insert into communication_routes(id,company_id,route_name,route_scope,environment_type,is_active,target_email)values($1,$2,'Actual common atomic fixture','ediel_ack','bilateral_test',true,'reply@example.invalid')",[uid(400),uid(1)])
 await db.query("insert into ediel_route_profiles(id,company_id,communication_route_id,environment,is_enabled,is_active,message_standard,payload_format,message_family,business_code,sender_ediel_id,receiver_ediel_id,application_reference,mailbox,smtp_host,smtp_port)values($1,$2,$3,'test',true,true,'edifact','edifact','APERAK','APERAK','LOCAL','REMOTE','23-DDQ-PRODAT','local@example.invalid','smtp.example.invalid',587)",[uid(401),uid(1),uid(400)])
 await db.exec('create schema gridex_negative_fixtures')
 for(const [file,name] of [['20260930171839_ediel_source_qualified_negative_fixture_v1.sql','assert_actor_v1'],['20260930212435_ediel_source_qualified_positive_fixture_v1.sql','assert_prepare_actor_v1']]){const actual=readFileSync(new URL('../supabase/migrations/'+file,import.meta.url),'utf8');const start=actual.indexOf('CREATE FUNCTION gridex_negative_fixtures.'+name+'(');const end=actual.indexOf('$$;',start);await db.exec(actual.slice(start,end+3))}
 await db.exec(readFileSync(new URL('../supabase/migrations/20260930215206_ediel_common_negative_source_route.sql',import.meta.url),'utf8'))
 await db.query('select gridex_ediel_technical_ack.capture_reply_v1($1,$2)',[uid(1),uid(10)])
 // RED: reproduce the old split mint / public INSERT / created-event calls.
 // A failed final audit write leaves the real witness/consumption/message.
 // This establishes the atomicity bug independently of the new function.
 const legacyRaw=ack().replaceAll('ACKI','LEGACY-SPLIT-I').replaceAll('ACKD','LEGACY-SPLIT-D')
 const legacyBefore=(await db.query('select (select count(*) from gridex_ediel_common_header.negative_witnesses) witnesses,(select count(*) from ediel_messages) messages')).rows[0]
 const legacy=(await db.query('select gridex_ediel_common_header.prepare_with_route_v2($1,$2,$3,$4,$5,$6,$7,587) r',[uid(1),'test',uid(10),uid(7),legacyRaw,'local@example.invalid','smtp.example.invalid'])).rows[0].r
 await db.query("insert into ediel_messages(id,company_id,environment,direction,message_family,message_code,raw_payload,related_message_id,execution_context_snapshot,communication_route_id,route_profile_id,sender_ediel_id,receiver_ediel_id,sender_email,receiver_email,mailbox,application_reference)values($1,$2,'test','outbound','APERAK','APERAK',$3,$4,$5,$6,$7,'LOCAL','REMOTE','local@example.invalid','reply@example.invalid','local@example.invalid','23-DDQ-PRODAT')",[uid(450),uid(1),legacyRaw,uid(10),{prodatCommonHeaderNegativeWitnessId:legacy.witnessId},uid(400),uid(401)])
 await db.exec("create function fail_legacy_audit()returns trigger language plpgsql as $$begin raise exception 'legacy_last_audit_failure';end$$;create trigger fail_legacy_audit before insert on ediel_message_events for each row execute function fail_legacy_audit()")
 await assert.rejects(db.query('insert into ediel_message_events(company_id,ediel_message_id,event_type)values($1,$2,$3)',[uid(1),uid(450),'created']),/legacy_last_audit_failure/)
 const legacyAfter=(await db.query('select (select count(*) from gridex_ediel_common_header.negative_witnesses) witnesses,(select count(*) from ediel_messages) messages')).rows[0]
 assert.equal(Number(legacyAfter.witnesses),Number(legacyBefore.witnesses)+1);assert.equal(Number(legacyAfter.messages),Number(legacyBefore.messages)+1)
 await db.exec('drop trigger fail_legacy_audit on ediel_message_events');await db.query('update ediel_messages set status=$1 where id=$2',['cancelled',uid(450)]);checks++
 console.log('RED split-transaction baseline: genuine mint + public message survive failed created audit; atomic no-effect requirement FAIL as expected')
 await db.exec(migration)
 await db.query('update ediel_messages set status=$1 where id=$2',['cancelled',uid(30)])
 const atomicRaw=ack().replaceAll('ACKI','ATOMIC-I').replaceAll('ACKD','ATOMIC-D')
 const draft={rawPayload:atomicRaw,communicationRouteId:uid(400),routeProfileId:uid(401),senderEmail:'local@example.invalid',receiverEmail:'reply@example.invalid',mailbox:'local@example.invalid',parsedPayload:{display:'fixture',serviceAssignment:{fake:true}},validationReport:{}}
 const smtp={from:'local@example.invalid',host:'smtp.example.invalid',port:587}
 const sourceHash=(await db.query("select encode(sha256(convert_to(raw_payload,'UTF8')),'hex') h from ediel_messages where id=$1",[uid(10)])).rows[0].h
 const create=async(body=draft,decision='negative',hash=sourceHash,actor=7)=>(await db.query('select gridex_ediel_ack_replay.create_v1($1,$2,$3,$4,$5,$6,null,null,$7,$8,$9) r',[uid(1),'test',uid(10),hash,uid(actor),'APERAK',decision,body,smtp])).rows[0].r
 const atomicEffects=async()=>(await db.query('select (select count(*) from ediel_messages) messages,(select count(*) from gridex_ediel_common_header.negative_witnesses) witnesses,(select count(*) from gridex_ediel_common_header.negative_consumptions) consumptions,(select count(*) from gridex_ediel_common_header.negative_route_bindings) bindings,(select count(*) from ediel_message_events) events,(select count(*) from gridex_ediel_ack_replay.creation_receipts) receipts,(select count(*) from gridex_ediel_wire_namespace.reservations) namespaces,(select count(*) from gridex_ediel_transport.attempts) attempts')).rows[0]
 const clean=await atomicEffects()
 await assert.rejects(create({...draft,executionContextSnapshot:{outboundOwnerWitnessId:uid(999)}}),/draft_whitelist_required/);assert.deepEqual(await atomicEffects(),clean);checks++
 await assert.rejects(create(draft,'negative','0'.repeat(64)),/actual_original_mismatch/);assert.deepEqual(await atomicEffects(),clean);checks++
 await db.exec("update user_permissions set is_active=false");await assert.rejects(create(),/actor_not_authorized/);await db.exec("update user_permissions set is_active=true");assert.deepEqual(await atomicEffects(),clean);checks++
 // Fail at the LAST public write, after actual mint, message INSERT and genuine
 // private consumption/namespace/guide capture. Entire transaction rolls back.
 await db.exec("create function fail_atomic_last_write()returns trigger language plpgsql as $$begin raise exception 'atomic_last_write_failure';end$$;create trigger fail_atomic_event before insert on ediel_message_events for each row execute function fail_atomic_last_write()")
 await assert.rejects(create(),/atomic_last_write_failure/);assert.deepEqual(await atomicEffects(),clean);checks++
 await db.exec('drop trigger fail_atomic_event on ediel_message_events')
 const created=await create();assert.equal(created.replayed,false);assert.equal(created.sourceMessage.id,uid(10));assert.equal(created.ackMessage.raw_payload,atomicRaw);assert.equal(created.ackMessage.ack_outcome,'negative');assert.equal(created.ackMessage.parsed_payload.serviceAssignment,undefined)
 const afterAtomic=await atomicEffects();assert.equal(Number(afterAtomic.witnesses),Number(clean.witnesses)+1);assert.equal(Number(afterAtomic.consumptions),Number(clean.consumptions)+1);assert.equal(Number(afterAtomic.events),1);assert.equal(Number(afterAtomic.receipts),1);assert.equal(afterAtomic.attempts,clean.attempts);checks++
 // Changing the current route does not change the immutable own replay proof.
 await db.exec("update communication_routes set is_active=false,target_email='changed@example.invalid';update ediel_route_profiles set is_enabled=false,smtp_host='changed.example.invalid'")
 const repeated=await create({foreignOwnerId:uid(999)});assert.equal(repeated.replayed,true);assert.equal(repeated.ackMessage.id,created.ackMessage.id);assert.deepEqual(await atomicEffects(),afterAtomic);checks++
 await assert.rejects(create(draft,'positive'),/conflicting_ack_draft_exists/);assert.deepEqual(await atomicEffects(),afterAtomic);checks++
 await db.exec('update company_memberships set is_active=false');await assert.rejects(create(),/actor_not_authorized/);await db.exec('update company_memberships set is_active=true');assert.deepEqual(await atomicEffects(),afterAtomic);checks++
 await db.exec('update tenant_actor_identifiers set valid_to=now()');await assert.rejects(create(),/current_identity_unavailable/);await db.exec('update tenant_actor_identifiers set valid_to=null');assert.deepEqual(await atomicEffects(),afterAtomic);checks++
 const atomicAcl=(await db.query("select has_function_privilege('authenticated','public.ediel_create_outbound_ack_atomic_v1(uuid,text,uuid,text,uuid,text,text,text,text,jsonb,jsonb)','execute') authenticated,has_function_privilege('anon','public.ediel_create_outbound_ack_atomic_v1(uuid,text,uuid,text,uuid,text,text,text,text,jsonb,jsonb)','execute') anon,has_table_privilege('service_role','gridex_ediel_ack_replay.creation_receipts','insert') direct")).rows[0];assert.deepEqual(atomicAcl,{authenticated:false,anon:false,direct:false});checks++
 console.log('Atomic ACK real common source/guide/namespace/one-TX last-write rollback/no-route-reselect/no-effects/current revoke: 11 PASS; bounded synthetic schema, no native/race proof')
`
const marker=' console.log(`Focused actual common-header'
assert.equal(base.split(marker).length,2)
const temp=fileURLToPath(new URL('./.ediel-atomic-ack-bounded.tmp.mjs',import.meta.url))
writeFileSync(temp,base.replace(marker,()=>previous+extra+marker))
try{const run=spawnSync(process.execPath,[temp],{stdio:'inherit',env:{...process.env,EDIEL_NATIVE_ACK_GUIDE_FORWARD:fileURLToPath(new URL('../supabase/migrations/20260930204944_ediel_source_generated_native_ack_guide_constraints.sql',import.meta.url))}});if(run.error)throw run.error;process.exitCode=run.status??1}finally{unlinkSync(temp)}
