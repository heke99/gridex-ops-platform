// Actual installed scoped-permission/actor/AI phase bodies, bounded to a
// synthetic surrounding catalogue and legal-purpose owner. This proves SQL
// control flow/current grants; it is NOT genuine Supabase/issuer/AI acceptance.
import {readFileSync} from 'node:fs'
import {pathToFileURL} from 'node:url'
import assert from 'node:assert/strict'

const {PGlite}=await import(pathToFileURL(process.env.EDIEL_PGLITE_MODULE).href)
const db=new PGlite(),uid=n=>`00000000-0000-4000-8000-${String(n).padStart(12,'0')}`
const migrations=new URL('../supabase/migrations/',import.meta.url)
const source=name=>readFileSync(new URL(name,migrations),'utf8')
function installedFunction(bytes,name){
 const expression=new RegExp(`CREATE (?:OR REPLACE )?FUNCTION ${name.replaceAll('.','\\.')}\\([\\s\\S]*?END\\$\\$;`)
 const match=bytes.match(expression);assert.ok(match,`actual installed ${name} body required`);return match[0]
}
const company=uid(1),actor=uid(2),other=uid(3),role=uid(4)
let count=0
async function run(){try{
 await db.exec(`CREATE ROLE service_role;CREATE SCHEMA auth;CREATE SCHEMA gridex_ediel_ack_replay;CREATE SCHEMA gridex_requested_changes;CREATE SCHEMA gridex_bilateral_customer_sources;CREATE SCHEMA gridex_ai_processing;CREATE SCHEMA gridex_ai_purpose_sources;
 CREATE TABLE auth.users(id uuid PRIMARY KEY,deleted_at timestamptz,banned_until timestamptz);
 CREATE TABLE public.user_profiles(id uuid PRIMARY KEY,user_status text);
 CREATE TABLE public.companies(id uuid PRIMARY KEY,status text,is_active bool);
 CREATE TABLE public.company_memberships(company_id uuid,user_id uuid,status text,is_active bool,accepted_at timestamptz);
 CREATE TABLE public.permissions(id uuid PRIMARY KEY DEFAULT gen_random_uuid(),key text UNIQUE,is_active bool,name text,description text,category text);
 CREATE TABLE public.user_permissions(id uuid PRIMARY KEY DEFAULT gen_random_uuid(),user_id uuid,company_id uuid,permission_id uuid,permission_key text,is_active bool,status text,effect text);
 CREATE TABLE public.user_permission_overrides(id uuid PRIMARY KEY DEFAULT gen_random_uuid(),user_id uuid,company_id uuid,is_active bool,effect text,permission_key text,valid_from timestamptz,valid_to timestamptz);
 CREATE TABLE public.user_roles(id uuid PRIMARY KEY DEFAULT gen_random_uuid(),user_id uuid,company_id uuid,role_id uuid,is_active bool,status text);
 CREATE TABLE public.roles(id uuid PRIMARY KEY,is_active bool);
 CREATE TABLE public.role_permissions(id uuid PRIMARY KEY DEFAULT gen_random_uuid(),role_id uuid,permission_id uuid,permission_key text,effect text);
 CREATE FUNCTION gridex_ediel_ack_replay.lock_current_graph_v2() RETURNS void LANGUAGE plpgsql AS $$BEGIN LOCK TABLE auth.users,public.user_profiles,public.companies,public.company_memberships,public.permissions,public.user_permissions,public.user_permission_overrides,public.user_roles,public.roles,public.role_permissions IN SHARE MODE;END$$;
 CREATE FUNCTION gridex_ai_purpose_sources.legal_scope_v1(uuid,text) RETURNS void LANGUAGE plpgsql AS $$BEGIN IF current_setting('fixture.legal_scope',true)='held' THEN RAISE EXCEPTION 'synthetic_legal_scope_held';ELSIF current_setting('fixture.legal_scope',true)='wait' THEN PERFORM pg_sleep(0.15);END IF;END$$;
 CREATE FUNCTION gridex_ai_purpose_sources.current_for_scope_v1(uuid,text,text,text) RETURNS jsonb LANGUAGE sql AS $$SELECT CASE WHEN current_setting('fixture.purpose',true)='held' THEN '{"status":"held","blocker":"synthetic_purpose_source_missing"}'::jsonb ELSE '{"status":"authorized"}'::jsonb END$$;
 INSERT INTO auth.users VALUES('${actor}',NULL,NULL);INSERT INTO public.user_profiles VALUES('${actor}','active');INSERT INTO public.companies VALUES('${company}','active',true),('${other}','active',true);INSERT INTO public.company_memberships VALUES('${company}','${actor}','active',true,clock_timestamp());INSERT INTO public.roles VALUES('${role}',true);`)
 const permissionKeys=['communication.send','ediel.send','communication.read','metering.read','customers.read','contracts.read']
 for(const [index,key]of permissionKeys.entries())await db.query('INSERT INTO public.permissions(id,key,is_active) VALUES($1,$2,true)',[uid(20+index),key])
 await db.exec(source('20261001103735_ediel_canonical_preparation_permission_catalog.sql'));assert.equal((await db.query('SELECT count(*)::int n FROM public.user_permissions')).rows[0].n,0);count++
 const bilateral=source('20261001010758_ediel_bilateral_customer_source_owner.sql')
 await db.exec(installedFunction(bilateral,'gridex_requested_changes.scoped_permission_v1'))
 await db.exec(installedFunction(bilateral,'gridex_requested_changes.actor_v1'))
 // Execute the actual92425 native port body, narrowed only to its two
 // permission/actor entries. Its clock and callee transformations are intact.
 const wallclock=source('20261001092425_ediel_classified_customer_wallclock_source_qualification.sql')
 const start=wallclock.indexOf('DO $ports$'),end=wallclock.indexOf('END$ports$;')+'END$ports$;'.length
 const ports=wallclock.slice(start,end).replace(/FOR original,replacement IN SELECT \* FROM\(VALUES[\s\S]*?\)ports\(original,replacement\) LOOP/,`FOR original,replacement IN SELECT * FROM(VALUES
  ('gridex_requested_changes.scoped_permission_v1(uuid,uuid,text)','gridex_bilateral_customer_sources.classified_scoped_permission_wallclock_v1'),
  ('gridex_requested_changes.actor_v1(uuid,uuid,text,text)','gridex_bilateral_customer_sources.classified_actor_wallclock_v1')
 )ports(original,replacement) LOOP`)
 assert.notEqual(ports,wallclock.slice(start,end));await db.exec(ports)
 const purpose=source('20261001020550_ediel_ai_purpose_source_owner.sql')
 const consumer=installedFunction(purpose,'gridex_ai_purpose_sources.consumer_v1')
 const composition=source('20261001092522_ediel_ai_legal_technical_party_composition.sql')
 await db.exec(consumer)
 await db.exec(composition.slice(composition.indexOf('DO $permission$'),composition.indexOf('END$permission$;')+'END$permission$;'.length))
 await db.exec(installedFunction(composition,'gridex_ai_processing.authorize_original_actor_v1'))
 await db.exec(installedFunction(composition,'gridex_ai_processing.authorize_original_read_v1'))
 await db.exec(installedFunction(purpose,'public.ediel_ai_export_decision_v2'))
 const grant=async(key,effect='allow',c=company)=>db.query("INSERT INTO public.user_permissions(user_id,company_id,permission_key,is_active,status,effect) VALUES($1,$2,$3,true,'active',$4)",[actor,c,key,effect])
 const phase=async(phase='origination',env='test',c=company,a=actor)=>db.query('SELECT gridex_ai_purpose_sources.consumer_v1($1,$2,$3,$4)',[c,a,phase,env])
 const read=async()=>db.query('SELECT gridex_ai_processing.authorize_original_read_v1($1,$2)',[company,actor])
 const forbidden=async(operation,reason=/ai_purpose_current_consumer_forbidden|ediel_tenant_actor_forbidden/)=>{await assert.rejects(operation,reason);count++}
 await grant('communication.write')
 await forbidden(()=>phase());console.log('RED actual AI consumer: original WRITE-only preparer rejected by unrelated READ/SEND dependencies')
 if(process.env.EDIEL_AI_PHASE_LEGACY_CONTROL==='1'){process.exitCode=2;return}
 const metadata=async()=>(await db.query("SELECT oid,proacl::text,proowner,proconfig::text,prosecdef,provolatile FROM pg_proc WHERE oid='gridex_ai_purpose_sources.consumer_v1(uuid,uuid,text,text)'::regprocedure")).rows[0]
 const before=await metadata(),forward=source('20261001103439_ediel_registry_current_actor_source_guards.sql')
 await db.exec(forward.slice(forward.indexOf('DO $ai_phase$'),forward.indexOf('END $ai_phase$;')+'END $ai_phase$;'.length))
 assert.deepEqual(await metadata(),before);count++
 await phase();await phase('origination','production');count++;await forbidden(()=>phase('send'));await grant('communication.send');await phase('send');count++
 await forbidden(()=>read());await forbidden(()=>phase('review'));await forbidden(()=>phase('origination','sandbox'));await forbidden(()=>phase('origination',null));await forbidden(()=>phase(null));
 await forbidden(()=>phase('send','test',other));await forbidden(()=>phase('send','test',company,other));await forbidden(()=>phase('send','test',null));
 async function mutation(sql,restore){await db.exec(sql);await forbidden(()=>phase());await db.exec(restore);await phase();count++}
 await mutation("UPDATE public.company_memberships SET status='revoked'","UPDATE public.company_memberships SET status='active'")
 await mutation('UPDATE public.company_memberships SET is_active=false','UPDATE public.company_memberships SET is_active=true')
 await mutation('UPDATE public.company_memberships SET accepted_at=NULL','UPDATE public.company_memberships SET accepted_at=clock_timestamp()')
 await mutation("UPDATE public.user_profiles SET user_status='blocked'","UPDATE public.user_profiles SET user_status='active'")
 await mutation("UPDATE public.companies SET status='inactive'","UPDATE public.companies SET status='active'")
 await mutation('UPDATE public.companies SET is_active=false','UPDATE public.companies SET is_active=true')
 await mutation('UPDATE auth.users SET deleted_at=clock_timestamp()','UPDATE auth.users SET deleted_at=NULL')
 await mutation("UPDATE auth.users SET banned_until=clock_timestamp()+interval '1 hour'",'UPDATE auth.users SET banned_until=NULL')
 await mutation('UPDATE public.user_permissions SET is_active=false','UPDATE public.user_permissions SET is_active=true')
 await mutation('UPDATE public.permissions SET is_active=false','UPDATE public.permissions SET is_active=true')
 await grant('communication.write','deny');await forbidden(()=>phase());await db.exec("DELETE FROM public.user_permissions WHERE effect='deny'")
 await db.exec(`INSERT INTO public.user_permission_overrides(user_id,company_id,is_active,effect,permission_key) VALUES('${actor}',NULL,true,'deny','communication.write')`);await forbidden(()=>phase());await db.exec('DELETE FROM public.user_permission_overrides')
 await db.exec(`INSERT INTO public.user_roles(user_id,company_id,role_id,is_active,status) VALUES('${actor}','${company}','${role}',true,'active');INSERT INTO public.role_permissions(role_id,permission_key,effect) VALUES('${role}','communication.write','deny')`);await forbidden(()=>phase());await db.exec("UPDATE public.role_permissions SET effect='allow';DELETE FROM public.user_permissions");await phase();count++
 await db.exec('DELETE FROM public.role_permissions;DELETE FROM public.user_roles')
 await grant('communication.send');await forbidden(()=>phase());await phase('send');count++;await db.exec('DELETE FROM public.user_permissions')
 await grant('ediel.send');await forbidden(()=>phase());await phase('send');count++
 await db.exec('DELETE FROM public.user_permissions');await grant('communication.write');await forbidden(()=>phase('send'));await grant('communication.read');await read();count++
 await db.exec("UPDATE public.user_permissions SET effect='deny' WHERE permission_key='communication.read'");await forbidden(()=>read());await grant('metering.read');await read();count++
 await db.exec("UPDATE public.user_permissions SET effect='deny' WHERE permission_key='metering.read'");await forbidden(()=>read());await phase();count++
 await db.exec("SET fixture.legal_scope='held'");await forbidden(()=>phase(),/synthetic_legal_scope_held/);await db.exec("SET fixture.legal_scope='authorized'")
 await db.exec('SET ROLE service_role');try{
  const decision=async()=>(await db.query('SELECT public.ediel_ai_export_decision_v2($1,$2,$3) q',[company,actor,'test'])).rows[0].q
  assert.equal((await decision()).status,'authorized');count++
  await db.exec("SET fixture.purpose='held'");assert.deepEqual(await decision(),{status:'held',blocker:'synthetic_purpose_source_missing'});count++
 }finally{await db.exec('RESET ROLE')}
 await db.exec("SET fixture.purpose='authorized';BEGIN;INSERT INTO public.user_permission_overrides(user_id,company_id,is_active,effect,permission_key,valid_from) VALUES('"+actor+"','"+company+"',true,'deny','communication.write',clock_timestamp()+interval '100 milliseconds');SELECT pg_sleep(0.15)")
 assert.equal((await db.query("SELECT gridex_requested_changes.scoped_permission_v1($1,$2,'communication.write') q",[company,actor])).rows[0].q,true);count++
 await forbidden(()=>phase());await db.exec('ROLLBACK')
 await phase();count++
 const body=(await db.query("SELECT pg_get_functiondef('gridex_ai_purpose_sources.consumer_v1(uuid,uuid,text,text)'::regprocedure) body")).rows[0].body
 assert.ok(body.includes('authorize_original_actor_v1'));assert.ok(!body.includes('classified_actor_wallclock_v1'));assert.ok(body.includes('legal_scope_v1'));assert.ok(body.includes('communication.write'));assert.equal(body.split(' PERFORM gridex_ai_processing.authorize_original_actor_v1(c,actor);').length-1,2);count++
 // Exact native consumer with ONLY its terminal check removed is the RED
 // control. A deny becoming effective while the declared legal-owner boundary
 // waits is invisible to the initial actor/phase check; execution must recheck.
 const phaseGuard=forward.split('phase_guard:=$phase$')[1].split('$phase$;')[0]
 const legalCall=' PERFORM gridex_ai_purpose_sources.legal_scope_v1(c,env);'
 const terminal=legalCall+'\n PERFORM gridex_ai_processing.authorize_original_actor_v1(c,actor);\n'+phaseGuard
 assert.ok(body.includes(terminal));count++
 const withoutTerminal=body.replace(terminal,legalCall);assert.notEqual(withoutTerminal,body)
 const waitDeny=async()=>db.exec("SET fixture.legal_scope='wait';BEGIN;INSERT INTO public.user_permission_overrides(user_id,company_id,is_active,effect,permission_key,valid_from) VALUES('"+actor+"','"+company+"',true,'deny','communication.write',clock_timestamp()+interval '100 milliseconds')")
 await db.exec(withoutTerminal);await waitDeny();await phase();await db.exec('ROLLBACK');count++
 console.log('RED actual initial-only phase: future current DENY becomes effective during legal-source wait but preparation still returns')
 await db.exec(body);await waitDeny();await forbidden(()=>phase());await db.exec("ROLLBACK;SET fixture.legal_scope='authorized'");await phase();count++
 console.log(`PASS ${count} bounded actual AI phase/current-tenant/scoped-grant/deny/wallclock/original-read/legal-purpose/metadata checks; NOT genuine native issuer/AI/masterplan acceptance`)
}finally{await db.close()}}
await run()
