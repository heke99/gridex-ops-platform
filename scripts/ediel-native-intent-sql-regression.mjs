// Actual native intent helper/wrapper SQL; prior native journal and B authority
// are declared fixtures. This checks rollback/qualification, not full replay.
import {readFileSync} from 'node:fs'
import {pathToFileURL} from 'node:url'
import assert from 'node:assert/strict'
const {PGlite}=await import(pathToFileURL(process.env.EDIEL_PGLITE_MODULE).href),db=new PGlite()
const id=n=>`00000000-0000-0000-0000-${String(n).padStart(12,'0')}`
const fn=(file,name)=>{const s=readFileSync(new URL(file,import.meta.url),'utf8'),a=s.indexOf(`CREATE FUNCTION ${name}`),b=s.indexOf('$$;',a);return s.slice(a,b+3)}
const wire="UNB+UNOC:3+12345:14+54321:14+260930:1200+I++23-DDQ-PRODAT'UNH+M+PRODAT:D:97A:UN:E2SE6A'BGM+Z03+DOC+9'LIN+1++735123456789012345:::9'RFF+LI:LI'UNT+5+M'UNZ+1+I'"
const command={action:'prepare',companyId:id(1),messageId:id(2),environment:'test'}
const call=()=>db.query('SELECT gridex_ediel_transport.mutate_v1($1::jsonb) b',[JSON.stringify(command)])
let checks=0
try{
 await db.exec(`CREATE ROLE anon;CREATE ROLE authenticated;CREATE ROLE service_role;CREATE SCHEMA gridex_ediel_transport;CREATE SCHEMA gridex_outbound_dispatch;CREATE SCHEMA gridex_received_sources;
 CREATE TABLE ediel_messages(id uuid PRIMARY KEY,company_id uuid,environment text,direction text,message_family text,message_code text,intent_id uuid,outbound_request_id uuid,route_profile_id uuid,communication_route_id uuid,rule_profile_version_id uuid,canonical_rule_pack_id uuid,rule_profile_version text,customer_id uuid,site_id uuid,metering_point_id uuid,switch_request_id uuid,raw_payload text);
 CREATE TABLE ediel_message_intents(id uuid PRIMARY KEY,company_id uuid,environment text,market text,message_family text,message_code text,direction text,validation_status text,validation_result jsonb,blocking_reasons jsonb,ediel_message_id uuid,outbound_request_id uuid,route_profile_id uuid,communication_route_id uuid,customer_id uuid,customer_site_id uuid,supplier_switch_request_id uuid,metering_point_id text,grid_area_code text,expected_rule_version text,expected_field_matrix_version text,payload jsonb,message_reference text,interchange_reference text,application_reference text,sender_ediel_id text,receiver_ediel_id text,sender_subaddress text,receiver_subaddress text,transaction_reference text);
 CREATE TABLE ediel_message_profiles(id uuid PRIMARY KEY,rule_pack_id uuid,message_code text,transaction_subtype text,is_enabled bool);
 CREATE TABLE ediel_rule_packs(id uuid PRIMARY KEY,family text,field_matrix_version text);
 CREATE TABLE communication_routes(id uuid PRIMARY KEY,company_id uuid,is_active bool);
 CREATE TABLE ediel_route_profiles(id uuid PRIMARY KEY,company_id uuid,is_enabled bool,environment text,communication_route_id uuid);
 CREATE TABLE metering_points(id uuid PRIMARY KEY,company_id uuid,customer_id uuid,site_id uuid,meter_point_id text,ediel_metering_point_id text,grid_area_code text);
 CREATE TABLE journal_effects(n integer);
 CREATE FUNCTION gridex_ediel_transport.mutate_v1(i jsonb) RETURNS jsonb LANGUAGE plpgsql AS $$BEGIN IF i->>'frozen'='true' THEN RETURN '{"proceed":false,"classification":"accepted","providerReceipt":{"old":true}}'::jsonb;END IF;INSERT INTO public.journal_effects VALUES(1);RETURN '{"proceed":true}'::jsonb;END$$;
 CREATE FUNCTION gridex_outbound_dispatch.mutate_v1(i jsonb) RETURNS jsonb LANGUAGE plpgsql AS $$BEGIN RETURN '{"scoped":true,"proceed":true}'::jsonb;END$$;
 CREATE FUNCTION public.ediel_require_brp_change_source_current_v1(uuid,uuid) RETURNS void LANGUAGE plpgsql AS $$BEGIN RETURN;END$$;`)
 for(const name of ['gridex_received_sources.wire_tokens_bounded_v1','gridex_received_sources.closure_wire_tokens_v2'])await db.exec(fn('../supabase/migrations/20260930144205_ediel_permission_source_atomic_transitions.sql',name))
 const migration=readFileSync(new URL('../supabase/migrations/20260930204728_ediel_native_intent_and_source_request_guards.sql',import.meta.url),'utf8')
 await db.exec(migration.slice(0,migration.indexOf('-- Forward UUID-safe'))+'COMMIT;');checks++
 await db.query("INSERT INTO ediel_messages VALUES($1,$2,'test','outbound','PRODAT','Z03',NULL,$3,$4,$5,$6,$7,'26.A:r3',$8,$9,$10,$11,$12)",[id(2),id(1),id(4),id(5),id(6),id(7),id(8),id(9),id(10),id(11),id(12),wire])
 await assert.rejects(call(),/validated_intent_required/);assert.equal((await db.query('SELECT count(*)::int n FROM journal_effects')).rows[0].n,0);checks++
 await db.exec(`INSERT INTO ediel_message_profiles(id,rule_pack_id,message_code,transaction_subtype,is_enabled) VALUES('${id(7)}','${id(8)}','Z03','L',true);INSERT INTO ediel_rule_packs VALUES('${id(8)}','PRODAT','26.A');INSERT INTO communication_routes VALUES('${id(6)}','${id(1)}',true);INSERT INTO ediel_route_profiles VALUES('${id(5)}','${id(1)}',true,'test','${id(6)}');INSERT INTO metering_points VALUES('${id(11)}','${id(1)}','${id(9)}','${id(10)}','735123456789012345','735123456789012345','TES');
 INSERT INTO ediel_message_intents VALUES('${id(3)}','${id(1)}','test','electricity','PRODAT','Z03','outbound','validated','{"ok":true,"status":"validated"}','[]','${id(2)}','${id(4)}','${id(5)}','${id(6)}','${id(9)}','${id(10)}','${id(12)}','735123456789012345','TES','26.A:r3','26.A','{"transactionSubtype":"L"}','M','I','23-DDQ-PRODAT','12345','54321',NULL,NULL,'LI');UPDATE ediel_messages SET intent_id='${id(3)}';`)
 assert.equal((await call()).rows[0].b.proceed,true);checks++
 for(const [column,value]of [['company_id',id(99)],['customer_site_id',id(99)],['message_reference','WRONG'],['interchange_reference','WRONG'],['sender_subaddress','wrong'],['transaction_reference','wrong'],['metering_point_id','wrong'],['validation_status','draft'],['expected_rule_version','future']]){
  const before=(await db.query(`SELECT ${column} v FROM ediel_message_intents`)).rows[0].v;await db.query(`UPDATE ediel_message_intents SET ${column}=$1`,[value]);await assert.rejects(call(),/ediel_native_/);await db.query(`UPDATE ediel_message_intents SET ${column}=$1`,[before]);checks++
 }
 await db.exec("UPDATE ediel_route_profiles SET is_enabled=false");await assert.rejects(call(),/validated_intent_required/);checks++
 const frozen=(await db.query('SELECT gridex_ediel_transport.mutate_v1($1::jsonb) b',[JSON.stringify({...command,frozen:true})])).rows[0].b;assert.deepEqual(frozen,{proceed:false,classification:'accepted',providerReceipt:{old:true}});checks++
 await db.exec(`UPDATE ediel_messages SET message_family='APERAK',message_code='APERAK',intent_id=NULL`);assert.equal((await call()).rows[0].b.proceed,true);checks++
 assert.equal((await db.query("SELECT has_function_privilege('service_role','gridex_ediel_transport.require_message_intent_v1(public.ediel_messages)','EXECUTE') allowed")).rows[0].allowed,false);checks++
 console.log(`PASS ${checks} focused mandatory native intent qualification/rollback/frozen replay/ACK separation/ACL PostgreSQL checks; declared journal fixture, not native replay`)
}finally{await db.close()}
