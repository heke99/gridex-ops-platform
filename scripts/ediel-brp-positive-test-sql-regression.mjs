// Explicit mechanical source-owner port probes. Not authentic test originals,
// native replay or supplier/BRP/DSO legal approval evidence.
import{readFileSync}from'node:fs';import{pathToFileURL}from'node:url';import assert from'node:assert/strict'
if(!process.env.EDIEL_PGLITE_MODULE)throw Error('EDIEL_PGLITE_MODULE required')
const{PGlite}=await import(pathToFileURL(process.env.EDIEL_PGLITE_MODULE).href),db=new PGlite(),id=n=>`00000000-0000-4000-8000-${String(n).padStart(12,'0')}`
const quote=s=>"'"+s.replaceAll("'","''")+"'",json=x=>quote(JSON.stringify(x))+'::jsonb';let checks=0
try{
 await db.exec(`CREATE ROLE anon;CREATE ROLE authenticated;CREATE ROLE service_role;CREATE TABLE ediel_messages(id uuid PRIMARY KEY,company_id uuid,environment text,direction text,message_standard text,message_family text,message_code text,raw_payload text);
 CREATE SCHEMA gridex_brp_changes;CREATE TABLE gridex_brp_changes.origins(company_id uuid,message_id uuid);CREATE TABLE gridex_brp_changes.probes(company_id uuid,message_id uuid);
 CREATE FUNCTION public.ediel_require_brp_change_source_current_v1(c uuid,m uuid) RETURNS void LANGUAGE plpgsql AS $$BEGIN INSERT INTO gridex_brp_changes.probes VALUES(c,m);RAISE EXCEPTION 'production_source_held';END$$;
 CREATE SCHEMA gridex_utilts_binding;CREATE FUNCTION gridex_utilts_binding.wire_tokens_v1(raw text) RETURNS jsonb LANGUAGE sql AS $$SELECT CASE WHEN raw='B' THEN '[{"tag":"BGM","elements":[[],["Z09"]]},{"tag":"CAV","elements":[[],["Z27"]]}]'::jsonb ELSE '[]'::jsonb END$$;
 CREATE SCHEMA gridex_negative_fixtures;CREATE TABLE gridex_negative_fixtures.synthetic_port(q jsonb);CREATE TABLE gridex_negative_fixtures.probes(company_id uuid,message_id uuid,code text);
 CREATE FUNCTION gridex_negative_fixtures.require_positive_message_v1(c uuid,m uuid,code text) RETURNS jsonb LANGUAGE plpgsql AS $$DECLARE q jsonb;BEGIN INSERT INTO gridex_negative_fixtures.probes VALUES(c,m,code);SELECT s.q INTO q FROM gridex_negative_fixtures.synthetic_port s;IF q IS NULL THEN RAISE EXCEPTION 'positive_original_unavailable';END IF;RETURN q;END$$;`)
 await db.exec(readFileSync(new URL('../supabase/migrations/20260930213308_ediel_brp_positive_test_original_bridge.sql',import.meta.url),'utf8'));checks++
 const q={kind:'source_qualified_positive_fixture',version:1,companyId:id(1),roleCode:'supplier',suite:'PRODAT',expectedOutcome:'positive',expectedDiagnosticCodes:[],authorizesBusinessEffect:false}
 await db.exec(`INSERT INTO ediel_messages VALUES('${id(2)}','${id(1)}','test','outbound','edifact','PRODAT','Z09','B');INSERT INTO gridex_negative_fixtures.synthetic_port VALUES(${json(q)})`)
 const call=()=>db.exec(`SET ROLE service_role;SELECT ediel_require_brp_change_source_current_v1('${id(1)}','${id(2)}');RESET ROLE`)
 await call();checks++;assert.deepEqual((await db.query('SELECT * FROM gridex_negative_fixtures.probes')).rows,[{company_id:id(1),message_id:id(2),code:'Z09'}]);checks++
 assert.equal((await db.query('SELECT count(*) n FROM gridex_brp_changes.origins')).rows[0].n,0);checks++
 for(const [key,value]of [['kind','forged'],['version',2],['companyId',id(9)],['roleCode','esco'],['suite','UTILTS'],['expectedOutcome','negative'],['expectedDiagnosticCodes',['error']],['authorizesBusinessEffect',true]]){
  await db.exec(`UPDATE gridex_negative_fixtures.synthetic_port SET q=${json({...q,[key]:value})}`);await assert.rejects(call(),/brp_change_positive_test_original_required/);await db.exec('RESET ROLE');checks++
 }
 await db.exec('UPDATE gridex_negative_fixtures.synthetic_port SET q=NULL');await assert.rejects(call(),/positive_original_unavailable/);await db.exec('RESET ROLE');checks++
 await db.exec(`UPDATE gridex_negative_fixtures.synthetic_port SET q=${json(q)}`)
 for(const [key,value]of [['environment','production'],['direction','inbound'],['message_standard','xml'],['message_family','UTILTS'],['message_code','Z03'],['raw_payload','non-B']]){
  await db.exec(`UPDATE ediel_messages SET ${key}=${quote(value)}`);await assert.rejects(call(),/production_source_held/);await db.exec('RESET ROLE');checks++;await db.exec(`UPDATE ediel_messages SET environment='test',direction='outbound',message_standard='edifact',message_family='PRODAT',message_code='Z09',raw_payload='B'`)
 }
 await db.exec(`INSERT INTO gridex_brp_changes.origins VALUES('${id(1)}','${id(2)}')`);await assert.rejects(call(),/production_source_held/);await db.exec('RESET ROLE');checks++
 assert.deepEqual((await db.query("SELECT has_function_privilege('service_role','ediel_require_brp_change_source_current_v1(uuid,uuid)','execute') public,has_function_privilege('service_role','gridex_brp_changes.require_current_before_positive_test_v1(uuid,uuid)','execute') private")).rows[0],{public:true,private:false});checks++
 console.log(`PASS ${checks} bounded B positive-test source-owner port checks; synthetic port, no native/authentic evidence`)
}finally{await db.close()}
