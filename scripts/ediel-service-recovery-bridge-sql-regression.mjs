// Focused PostgreSQL wrapper composition, with declared private authority fixtures.
// Native actual ACK/hash/owner qualification remains a separate final criterion.
import{readFileSync}from'node:fs';import{pathToFileURL}from'node:url';import assert from'node:assert/strict'
if(!process.env.EDIEL_PGLITE_MODULE)throw Error('EDIEL_PGLITE_MODULE required')
const{PGlite}=await import(pathToFileURL(process.env.EDIEL_PGLITE_MODULE).href),db=new PGlite(),id=n=>`00000000-0000-4000-8000-${String(n).padStart(12,'0')}`
let checks=0
try{
 await db.exec(`CREATE ROLE anon;CREATE ROLE authenticated;CREATE ROLE service_role;CREATE SCHEMA gridex_service_permission;CREATE SCHEMA gridex_received_sources;
 CREATE TABLE gridex_service_permission.fixture(company_id uuid,message_id uuid,current boolean);CREATE TABLE gridex_service_permission.calls(message_id uuid);
 CREATE TABLE gridex_received_sources.prodat_recovery_operations(id uuid PRIMARY KEY,company_id uuid,actor_user_id uuid,original_message_id uuid);CREATE TABLE gridex_received_sources.prodat_recovery_messages(operation_id uuid,message_id uuid,qualified boolean);
 CREATE FUNCTION public.ediel_require_service_permission_origin_current_v1(c uuid,m uuid) RETURNS void LANGUAGE plpgsql AS $$BEGIN IF EXISTS(SELECT FROM gridex_service_permission.fixture WHERE company_id=c AND message_id=m AND NOT current) THEN RAISE EXCEPTION 'current_original_service_held';END IF;INSERT INTO gridex_service_permission.calls VALUES(m);END$$;
 CREATE FUNCTION public.ediel_prodat_recovery_operation_basis_v1(c uuid,op uuid,actor uuid) RETURNS jsonb LANGUAGE sql AS $$SELECT jsonb_build_object('operationId',id,'originalMessageId',original_message_id) FROM gridex_received_sources.prodat_recovery_operations WHERE company_id=c AND id=op AND actor_user_id=actor$$;
 CREATE FUNCTION public.ediel_prodat_recovery_original_basis_v1(c uuid,m uuid,actor uuid) RETURNS jsonb LANGUAGE plpgsql AS $$DECLARE op uuid;BEGIN SELECT operation_id INTO op FROM gridex_received_sources.prodat_recovery_messages link JOIN gridex_received_sources.prodat_recovery_operations operation ON operation.id=link.operation_id WHERE message_id=m AND operation.company_id=c AND link.qualified;IF op IS NULL THEN RAISE EXCEPTION 'exact_message_hash_held';END IF;RETURN public.ediel_prodat_recovery_operation_basis_v1(c,op,actor);END$$;`)
 await db.exec(readFileSync(new URL('../supabase/migrations/20260930194512_ediel_service_recovery_current_origin_bridge.sql',import.meta.url),'utf8'));checks++
 await db.exec(`INSERT INTO gridex_service_permission.fixture VALUES('${id(1)}','${id(2)}',true);INSERT INTO gridex_received_sources.prodat_recovery_operations VALUES('${id(3)}','${id(1)}','${id(4)}','${id(2)}');INSERT INTO gridex_received_sources.prodat_recovery_messages VALUES('${id(3)}','${id(5)}',true);`)
 await db.query(`SELECT ediel_require_service_permission_origin_current_v1('${id(1)}','${id(2)}')`);assert.equal((await db.query('SELECT count(*) n FROM gridex_service_permission.calls')).rows[0].n,1);checks++
 await db.query(`SELECT ediel_require_service_permission_origin_current_v1('${id(1)}','${id(5)}')`);assert.equal((await db.query(`SELECT count(*) n FROM gridex_service_permission.calls WHERE message_id='${id(2)}'`)).rows[0].n,3);checks++
 await db.exec(`UPDATE gridex_service_permission.fixture SET current=false`)
 await assert.rejects(db.query(`SELECT ediel_prodat_recovery_operation_basis_v1('${id(1)}','${id(3)}','${id(4)}')`),/current_original_service_held/);checks++
 await assert.rejects(db.query(`SELECT ediel_require_service_permission_origin_current_v1('${id(1)}','${id(5)}')`),/current_original_service_held/);checks++
 await db.exec(`UPDATE gridex_service_permission.fixture SET current=true;UPDATE gridex_received_sources.prodat_recovery_messages SET qualified=false`)
 await assert.rejects(db.query(`SELECT ediel_require_service_permission_origin_current_v1('${id(1)}','${id(5)}')`),/exact_message_hash_held/);checks++
 await assert.rejects(db.query(`SELECT ediel_require_service_permission_origin_current_v1(NULL,'${id(5)}')`),/scope_required/);checks++
 assert.equal((await db.query(`SELECT has_function_privilege('service_role','gridex_service_permission.require_original_current_v1(uuid,uuid)','EXECUTE') allowed`)).rows[0].allowed,false);checks++
 assert.equal((await db.query(`SELECT has_function_privilege('authenticated','public.ediel_require_service_permission_origin_current_v1(uuid,uuid)','EXECUTE') allowed`)).rows[0].allowed,false);checks++
 console.log(`PASS ${checks} focused service recovery bridge PostgreSQL checks; private helper fixtures, not native/authentic evidence`)
}finally{await db.close()}
