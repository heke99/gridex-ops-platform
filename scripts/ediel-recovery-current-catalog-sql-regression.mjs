// Bounded actual migration mechanics. Auth/catalog rows and delegate bodies
// below are declared synthetic; this is not native Supabase or market evidence.
import assert from 'node:assert/strict'
import {readFileSync} from 'node:fs'
import {pathToFileURL} from 'node:url'
if(!process.env.EDIEL_PGLITE_MODULE)throw Error('EDIEL_PGLITE_MODULE required')
const {PGlite}=await import(pathToFileURL(process.env.EDIEL_PGLITE_MODULE).href)
const db=new PGlite(),id=n=>`00000000-0000-4000-8000-${String(n).padStart(12,'0')}`
const c=id(1),writer=id(2),sender=id(3),migration='20261001103438_ediel_recovery_current_execution_catalog_and_lock_order.sql'
let checks=0
const equal=(a,b)=>{assert.deepEqual(a,b);checks++}
const denied=async(actor,phase)=>{await assert.rejects(db.query('SELECT gridex_received_sources.require_recovery_execution_actor_v1($1,$2,$3)',[c,actor,phase]),/execution_actor_forbidden/);checks++}
try{
 await db.exec(`CREATE ROLE anon;CREATE ROLE authenticated;CREATE ROLE service_role;
 CREATE SCHEMA auth;CREATE SCHEMA gridex_received_sources;CREATE SCHEMA gridex_ediel_ack_replay;CREATE SCHEMA gridex_service_permission;CREATE SCHEMA gridex_customer_life_events;CREATE SCHEMA gridex_ediel_transport;
 CREATE TABLE auth.users(id uuid PRIMARY KEY,deleted_at timestamptz,banned_until timestamptz);
 CREATE TABLE public.user_profiles(id uuid PRIMARY KEY,user_status text,disabled_at timestamptz);
 CREATE TABLE public.companies(id uuid PRIMARY KEY,status text);
 CREATE TABLE public.company_memberships(company_id uuid,user_id uuid,status text,is_active boolean,accepted_at timestamptz);
 CREATE TABLE public.permissions(key text PRIMARY KEY,is_active boolean);
 CREATE TABLE public.synthetic_grants(company_id uuid,user_id uuid,key text,allowed boolean);
 CREATE TABLE public.ediel_messages(id uuid PRIMARY KEY);
 CREATE FUNCTION public.gridex_actor_has_company_permission(a uuid,c uuid,k text) RETURNS boolean LANGUAGE sql AS $$SELECT coalesce((SELECT allowed FROM public.synthetic_grants WHERE company_id=c AND user_id=a AND key=k),false)$$;
 CREATE FUNCTION gridex_ediel_ack_replay.lock_current_graph_v2() RETURNS void LANGUAGE plpgsql AS $$BEGIN LOCK TABLE auth.users,public.user_profiles,public.companies,public.company_memberships,public.permissions,public.synthetic_grants IN SHARE MODE;END$$;
 CREATE FUNCTION gridex_received_sources.require_recovery_execution_actor_v1(c uuid,actor uuid,phase text) RETURNS void LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path=pg_catalog AS $$BEGIN RETURN;END$$;
 REVOKE ALL ON FUNCTION gridex_received_sources.require_recovery_execution_actor_v1(uuid,uuid,text) FROM PUBLIC,anon,authenticated,service_role;`)
 const targets=['gridex_service_permission.recovery_operation_before_current_service_v1','public.ediel_require_prodat_recovery_current_v1','public.ediel_require_service_permission_origin_current_v1','public.ediel_prepare_prodat_recovery_v1','public.ediel_queue_prodat_retry_v1','public.ediel_prodat_retry_outbox_basis_v1','public.ediel_consume_prodat_retry_authorization_v1','gridex_customer_life_events.recovery_basis_v1','gridex_ediel_transport.mutate_v1']
 for(const target of targets)await db.exec(`CREATE FUNCTION ${target}(input jsonb DEFAULT '{}') RETURNS jsonb LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path=pg_catalog AS $$BEGIN
 RETURN input||'{"synthetic_delegate_retained":true}'::jsonb;END$$;REVOKE ALL ON FUNCTION ${target}(jsonb) FROM PUBLIC,anon,authenticated,service_role;GRANT EXECUTE ON FUNCTION ${target}(jsonb) TO service_role;`)
 const metadata=()=>db.query(`SELECT oid::regprocedure::text signature,to_jsonb(p)-'prosrc' metadata FROM pg_proc p WHERE oid=ANY(ARRAY[${targets.map(n=>`'${n}'::regproc`).join(',')}]) ORDER BY oid`)
 const before=(await metadata()).rows
 await db.exec(readFileSync(new URL('../supabase/migrations/'+migration,import.meta.url),'utf8'))
 equal((await metadata()).rows,before)
 await db.exec(`INSERT INTO public.permissions VALUES('communication.write',true),('communication.send',true);
 INSERT INTO public.companies VALUES('${c}','active');
 INSERT INTO auth.users(id) VALUES('${writer}'),('${sender}');
 INSERT INTO public.user_profiles VALUES('${writer}','active',NULL),('${sender}','active',NULL);
 INSERT INTO public.company_memberships VALUES('${c}','${writer}','active',true,clock_timestamp()),('${c}','${sender}','active',true,clock_timestamp());
 INSERT INTO public.synthetic_grants VALUES('${c}','${writer}','communication.write',true),('${c}','${sender}','communication.send',true);`)
 const permit=async(actor,phase)=>{await db.query('SELECT gridex_received_sources.require_recovery_execution_actor_v1($1,$2,$3)',[c,actor,phase]);checks++}
 await permit(writer,'prepare');await permit(sender,'send');await denied(writer,'send');await denied(sender,'prepare')
 for(const mutation of [
  `UPDATE auth.users SET banned_until=clock_timestamp()+interval '1 hour' WHERE id='${sender}'`,
  `UPDATE auth.users SET deleted_at=clock_timestamp() WHERE id='${sender}'`,
  `UPDATE public.user_profiles SET disabled_at=clock_timestamp() WHERE id='${sender}'`,
  `UPDATE public.company_memberships SET is_active=false WHERE user_id='${sender}'`,
  `UPDATE public.companies SET status='suspended' WHERE id='${c}'`,
  `UPDATE public.permissions SET is_active=false WHERE key='communication.send'`,
  `UPDATE public.synthetic_grants SET allowed=false WHERE user_id='${sender}'`,
 ]){
  await db.exec('BEGIN;'+mutation);await denied(sender,'send');await db.exec('ROLLBACK;')
 }
 await assert.rejects(db.query('SELECT gridex_received_sources.require_recovery_execution_actor_v1($1,$2,$3)',[c,sender,'invalid']),/execution_scope_required/);checks++
 for(const role of ['anon','authenticated','service_role']){equal((await db.query(`SELECT has_function_privilege('${role}','gridex_received_sources.require_recovery_execution_actor_v1(uuid,uuid,text)','EXECUTE') e`)).rows[0].e,false)}
 for(const target of targets){
  equal((await db.query(`SELECT ${target}('{"original":"immutable"}') receipt`)).rows[0].receipt,{original:'immutable',synthetic_delegate_retained:true})
  equal((await db.query(`SELECT strpos(prosrc,'lock_current_graph_v2')<strpos(prosrc,'LOCK TABLE public.ediel_messages') ok FROM pg_proc WHERE oid='${target}'::regproc`)).rows[0].ok,true)
 }
 console.log(`PASS ${checks} bounded current-phase/catalog/revocation/delegate/authority mechanics; synthetic actor and delegate ports, not native or original-source evidence`)
}finally{await db.close()}
