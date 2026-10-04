// Actual closed Auth-owner bridge expressions with distinct role/ACL owners.
// Synthetic users/company/grants only; not a Supabase/Auth/native replay receipt.
import {readFileSync} from 'node:fs'
import {pathToFileURL} from 'node:url'
import assert from 'node:assert/strict'
if(!process.env.EDIEL_PGLITE_MODULE)throw Error('EDIEL_PGLITE_MODULE required')
const{PGlite}=await import(pathToFileURL(process.env.EDIEL_PGLITE_MODULE).href),db=new PGlite(),uid=n=>`00000000-0000-0000-0000-${String(n).padStart(12,'0')}`
const actualFunction=(file,name)=>{const text=readFileSync(new URL(file,import.meta.url),'utf8'),start=Math.max(text.indexOf(`CREATE FUNCTION ${name}`),text.indexOf(`CREATE OR REPLACE FUNCTION ${name}`)),end=text.indexOf('$$;',start);if(start<0||end<0)throw Error(name);return text.slice(start,end+3)}
try{
 await db.exec(`CREATE ROLE anon NOLOGIN;CREATE ROLE authenticated NOLOGIN;CREATE ROLE service_role NOLOGIN;CREATE ROLE bounded_auth_owner NOLOGIN;CREATE ROLE bounded_migrator NOLOGIN NOINHERIT NOSUPERUSER CREATEROLE BYPASSRLS;CREATE ROLE gridex_ediel_retention_owner NOLOGIN NOINHERIT BYPASSRLS;GRANT gridex_ediel_retention_owner TO bounded_migrator WITH INHERIT TRUE,SET TRUE;
 CREATE SCHEMA auth AUTHORIZATION bounded_auth_owner;CREATE TABLE auth.users(id uuid PRIMARY KEY,deleted_at timestamptz,banned_until timestamptz);ALTER TABLE auth.users OWNER TO bounded_auth_owner;
 CREATE FUNCTION auth.uid() RETURNS uuid LANGUAGE sql STABLE AS $$SELECT nullif(current_setting('request.jwt.claim.sub',true),'')::uuid$$;ALTER FUNCTION auth.uid() OWNER TO bounded_auth_owner;
 GRANT USAGE ON SCHEMA auth TO bounded_migrator;GRANT SELECT,UPDATE ON auth.users TO bounded_migrator;
 CREATE SCHEMA gridex_ediel_retention AUTHORIZATION gridex_ediel_retention_owner;CREATE SCHEMA gridex_requested_changes;
 CREATE FUNCTION gridex_requested_changes.scoped_permission_v1(uuid,uuid,text) RETURNS bool LANGUAGE sql AS $$SELECT false$$;CREATE FUNCTION public.gridex_actor_has_company_permission(uuid,uuid,text) RETURNS bool LANGUAGE sql AS $$SELECT false$$;
 CREATE TABLE public.companies(id uuid PRIMARY KEY,status text);CREATE TABLE public.user_profiles(id uuid PRIMARY KEY,user_status text,disabled_at timestamptz);CREATE TABLE public.company_memberships(company_id uuid,user_id uuid,status text,is_active bool,accepted_at timestamptz);
 CREATE TABLE public.permissions(id uuid PRIMARY KEY,key text,is_active bool);CREATE TABLE public.roles(id uuid PRIMARY KEY,is_active bool);CREATE TABLE public.user_roles(user_id uuid,company_id uuid,role_id uuid,is_active bool,status text);CREATE TABLE public.role_permissions(role_id uuid,permission_id uuid,permission_key text,effect text);
 CREATE TABLE public.user_permissions(user_id uuid,company_id uuid,permission_id uuid,permission_key text,is_active bool,status text,effect text);CREATE TABLE public.user_permission_overrides(user_id uuid,company_id uuid,permission_key text,effect text,is_active bool,valid_from timestamptz,valid_to timestamptz);
 GRANT USAGE ON SCHEMA public TO gridex_ediel_retention_owner;GRANT CREATE ON SCHEMA public TO bounded_migrator;GRANT SELECT,UPDATE ON ALL TABLES IN SCHEMA public TO bounded_migrator,gridex_ediel_retention_owner;
 INSERT INTO public.companies VALUES('${uid(1)}','archived');INSERT INTO auth.users VALUES('${uid(2)}',NULL,NULL),('${uid(3)}',NULL,NULL);
 INSERT INTO public.user_profiles VALUES('${uid(2)}','active',NULL),('${uid(3)}','active',NULL);INSERT INTO public.company_memberships VALUES('${uid(1)}','${uid(2)}','active',true,now());INSERT INTO public.permissions VALUES('${uid(4)}','ediel.retention.review',true);INSERT INTO public.user_permissions VALUES('${uid(2)}','${uid(1)}','${uid(4)}','ediel.retention.review',true,'active','allow');`)
 await db.exec(actualFunction('../supabase/migrations/20261001000710_ediel_archived_tenant_retention_class_authority.sql','gridex_ediel_retention.permission_v1'))
 await db.exec(actualFunction('../supabase/migrations/20261001000500_ediel_artifact_retention_decision_and_purge.sql','gridex_ediel_retention.actor_v1'))
 await db.exec('ALTER FUNCTION gridex_ediel_retention.permission_v1(uuid,uuid,text) OWNER TO gridex_ediel_retention_owner;ALTER FUNCTION gridex_ediel_retention.actor_v1(uuid,uuid,text) OWNER TO gridex_ediel_retention_owner;REVOKE ALL ON ALL FUNCTIONS IN SCHEMA gridex_ediel_retention FROM PUBLIC,anon,authenticated,service_role;')
 // A private-owned outer call mirrors the installed class APIs without returning
 // source data or approving any deletion. The actual actor/permission body runs.
 await db.exec("CREATE FUNCTION public.ediel_bounded_retention_actor_probe_v1(c uuid,a uuid) RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$BEGIN PERFORM gridex_ediel_retention.actor_v1(c,a,'ediel.retention.review');END$$;ALTER FUNCTION public.ediel_bounded_retention_actor_probe_v1(uuid,uuid) OWNER TO gridex_ediel_retention_owner;REVOKE ALL ON FUNCTION public.ediel_bounded_retention_actor_probe_v1(uuid,uuid) FROM PUBLIC,anon,service_role;GRANT EXECUTE ON FUNCTION public.ediel_bounded_retention_actor_probe_v1(uuid,uuid) TO authenticated;")
 const call=async(actor=uid(2),company=uid(1),session=uid(2))=>{await db.exec(`SET ROLE authenticated;SELECT set_config('request.jwt.claim.sub','${session}',false)`);try{return await db.query(`SELECT public.ediel_bounded_retention_actor_probe_v1('${company}','${actor}')`)}finally{await db.exec('RESET ROLE')}}
 await assert.rejects(()=>call(),/permission denied for schema auth|permission denied for table users/)
 const before=(await db.query("SELECT oid,proowner,proacl,proconfig FROM pg_proc WHERE oid='gridex_ediel_retention.actor_v1(uuid,uuid,text)'::regprocedure")).rows[0]
 await db.exec('SET ROLE bounded_migrator')
 assert.equal((await db.query("SELECT has_table_privilege(current_user,'auth.users','UPDATE WITH GRANT OPTION') value")).rows[0].value,false)
 await db.exec(readFileSync(new URL('../supabase/migrations/20261001025642_ediel_retention_current_auth_owner_bridge.sql',import.meta.url),'utf8'))
 await db.exec('RESET ROLE')
 assert.deepEqual((await db.query("SELECT oid,proowner,proacl,proconfig FROM pg_proc WHERE oid='gridex_ediel_retention.actor_v1(uuid,uuid,text)'::regprocedure")).rows[0],before)
 assert.equal((await db.query("SELECT proowner::regrole::text owner FROM pg_proc WHERE oid='public.ediel_retention_lock_auth_actor_v1(uuid)'::regprocedure")).rows[0].owner,'bounded_migrator')
 assert.equal((await db.query("SELECT has_schema_privilege('gridex_ediel_retention_owner','auth','USAGE') value")).rows[0].value,false)
 assert.equal((await db.query("SELECT has_table_privilege('gridex_ediel_retention_owner','auth.users','UPDATE') value")).rows[0].value,false)
 await call()
 for(const [actor,company,session] of [[uid(2),uid(1),uid(3)],[uid(3),uid(1),uid(3)],[uid(2),uid(99),uid(2)]])await assert.rejects(()=>call(actor,company,session),/current_actor_forbidden/)
 for(const [deny,restore] of [
  [`UPDATE auth.users SET deleted_at=now() WHERE id='${uid(2)}'`,`UPDATE auth.users SET deleted_at=NULL WHERE id='${uid(2)}'`],
  [`UPDATE auth.users SET banned_until=now()+interval '1hour' WHERE id='${uid(2)}'`,`UPDATE auth.users SET banned_until=NULL WHERE id='${uid(2)}'`],
  [`UPDATE public.user_profiles SET disabled_at=now() WHERE id='${uid(2)}'`,`UPDATE public.user_profiles SET disabled_at=NULL WHERE id='${uid(2)}'`],
  ['UPDATE public.company_memberships SET accepted_at=NULL','UPDATE public.company_memberships SET accepted_at=now()'],
  ["UPDATE public.user_permissions SET effect='deny'","UPDATE public.user_permissions SET effect='allow'"]]){await db.exec(deny);await assert.rejects(()=>call(),/current_actor_forbidden/);await db.exec(restore);await call()}
 for(const role of ['anon','authenticated','service_role']){
  assert.equal((await db.query(`SELECT pg_has_role('${role}','gridex_ediel_retention_owner','MEMBER') value`)).rows[0].value,false)
  await db.exec(`SET ROLE ${role}`)
  for(const statement of ['SELECT public.ediel_retention_session_actor_v1()',`SELECT public.ediel_retention_lock_auth_actor_v1('${uid(2)}')`])await assert.rejects(()=>db.exec(statement),/permission denied for function/)
  await db.exec('RESET ROLE')
 }
 console.log('PASS closed auth owner red→green with no delegated Auth schema/UPDATE or role membership, unchanged actual consumer OID/owner/ACL/search_path, current deleted/ban/disabled/member/DENY/foreign/session rejection and app direct-call denial (bounded synthetic SQL; NOT authentic replay/issuer/session proof)')
}finally{await db.close()}
