/** Declared mechanical SQL probe: actual bounded lexer + same generated
 * field209 projection and new physical scope guard. The unchanged canonical
 * witness/source append implementation is a synthetic boundary here. This
 * does not prove native replay, source authenticity or business acceptance. */
import {readFileSync} from 'node:fs'
import assert from 'node:assert/strict'
if(!process.env.PGLITE_MODULE_URL)throw Error('PGLITE_MODULE_URL required')
const {PGlite}=await import(process.env.PGLITE_MODULE_URL),db=new PGlite()
let checks=0
try{
 await db.exec(`CREATE ROLE anon;CREATE ROLE authenticated;CREATE ROLE service_role;CREATE SCHEMA gridex_received_sources;
 CREATE TABLE public.synthetic_raw(raw text);CREATE TABLE public.ediel_messages(id uuid,company_id uuid,environment text,direction text,raw_payload text);CREATE SCHEMA gridex_ediel_ack_guide;CREATE FUNCTION gridex_ediel_ack_guide.require_message_reference_profile_v1(text) RETURNS void LANGUAGE sql AS $$SELECT NULL::void$$;
 CREATE FUNCTION gridex_received_sources.append_validation(p_company_id uuid,p_environment text,p_source_message_id uuid,p_source_payload_hash text,p_facts_text text) RETURNS jsonb LANGUAGE plpgsql AS $fn$
 DECLARE obj jsonb:=p_facts_text::jsonb;src record;BEGIN
 SELECT raw AS raw_payload INTO src FROM public.synthetic_raw;
 IF obj->>'disposition'<>'unavailable' AND ((obj->>'messageIndex')::int<>0 OR jsonb_typeof(obj->'messageReference')<>'string'
        OR jsonb_typeof(obj->'objectId')<>'string' OR coalesce(obj->>'identityAgency','') NOT IN ('9','89')) THEN
 RAISE EXCEPTION 'received_register_unvalidated_scope';END IF;RETURN obj;END$fn$;`)
 const decoder=readFileSync(new URL('../supabase/migrations/20260930144205_ediel_permission_source_atomic_transitions.sql',import.meta.url),'utf8')
 await db.exec(decoder.slice(0,decoder.indexOf('CREATE FUNCTION gridex_received_sources.permission_wire_v1'))+'\nCOMMIT;')
 const reference=readFileSync(new URL('../supabase/migrations/20261001044856_ediel_source_profile_message_reference_bounds.sql',import.meta.url),'utf8')
 await db.exec(reference.slice(reference.indexOf('ALTER FUNCTION gridex_received_sources.append_validation'),reference.indexOf('ALTER FUNCTION gridex_ack_authority.apply_v1')))
 const unused=readFileSync(process.env.EDIEL_UNUSED_UNH_MIGRATION_PATH??new URL('../supabase/migrations/20261001053253_ediel_source_owned_unused_unh_elements.sql',import.meta.url),'utf8')
 await db.exec(unused.slice(unused.indexOf('ALTER FUNCTION gridex_received_sources.append_validation'),unused.indexOf('ALTER FUNCTION gridex_ack_authority.apply_v1')))
 await db.exec(readFileSync(new URL('../supabase/migrations/20261001053815_ediel_identityless_permission_register_scope.sql',import.meta.url),'utf8'))
 const raw=(code='Z14',reason='Z96',line='LIN+1',tail="RFF+LI:OWN'",alphabet='default')=>{
  const s=`UNH+M+PRODAT:D:97A:UN:E2SE6A'BGM+${code}+D+9+AB'${line}'CCI++Z13'CAV+${reason}'${tail}UNT+7+M'`
  return alphabet==='alternate'?'UNA*;.! ~'+s.replaceAll(':','*').replaceAll('+',';').replaceAll("'",'~'):s
 }
 const scope={messageIndex:0,messageReference:'M',objectId:null,identityAgency:null,disposition:'accepted',reasons:[],registers:[{lineIndex:0,lineNumber:'1',registerIndex:null,registerPosition:1,segmentIndex:2}]}
 const qualify=async(wire,object=scope)=>Boolean((await db.query('SELECT gridex_received_sources.identity_omission_scope_v1($1,$2::jsonb) ok',[wire,JSON.stringify(object)])).rows[0].ok)
 for(const [code,reason] of [['Z14','Z96'],['Z13','S17'],['Z13','S18']]){assert.equal(await qualify(raw(code,reason)),true);checks++}
 assert.equal(await qualify(raw('Z14','Z96','LIN+1',"RFF+LI:OWN'",'alternate')),true);checks++
 for(const [name,wire] of [
  ['positive',raw('Z14','S17')],['wrongcode',raw('Z04','Z22')],['unknown',raw('Z14','N')],['padded',raw('Z14',' Z96')],
  ['partial',raw('Z14','Z96','LIN+1++:::9')],['register',raw('Z14','Z96','LIN+1+++1:1')],['zero',raw('Z14','Z96','LIN+0')],['skipped',raw('Z14','Z96','LIN+2')],
  ['duplicate',raw('Z14','Z96','LIN+1',"CCI++Z13'CAV+Z96'")],['parent',raw('Z14','Z96','LIN+1',"RFF+LI:OWN'").replace("CCI++Z13'","RFF+LI:EARLY'CCI++Z13'")],
  ['wrongfamily',raw().replace('PRODAT:','UTILTS:')],['secondmessage',raw()+raw()],['dangling',raw()+"BROKEN?"],
 ]){assert.equal(await qualify(wire),false,name);checks++}
 for(const changed of [{objectId:'FAKE'},{identityAgency:'9'},{messageReference:'WRONG'},{messageIndex:1},
  {registers:[{...scope.registers[0],segmentIndex:3}]},{registers:[{...scope.registers[0],lineIndex:1}]},
  {registers:[{...scope.registers[0],registerPosition:2}]},{registers:[{...scope.registers[0],registerIndex:'1'}]},
 ]){assert.equal(await qualify(raw(),{...scope,...changed}),false);checks++}
 const append=async(object)=>db.query('SELECT gridex_received_sources.append_validation(NULL,NULL,NULL,NULL,$1) outcome',[JSON.stringify(object)])
 await db.query('INSERT INTO synthetic_raw VALUES($1)',[raw()]);assert.deepEqual((await append(scope)).rows[0].outcome,scope);checks++
 await assert.rejects(append({...scope,identityAgency:'9'}),/received_register_unvalidated_scope/);checks++
 await db.query('UPDATE synthetic_raw SET raw=$1',[raw('Z14','S17')]);await assert.rejects(append(scope),/received_register_unvalidated_scope/);checks++
 await db.exec('SET ROLE service_role');await assert.rejects(db.query('SELECT gridex_received_sources.identity_omission_cases_v1()'),/permission denied/);checks++
 console.log(`PASS ${checks} declared mechanical SQL checks; canonical/source/party/effect/native replay remain NOT RUN`)
}finally{await db.close()}
