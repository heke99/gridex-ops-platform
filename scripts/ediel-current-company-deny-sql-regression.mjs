// Real current company resolver + forward deny/graph functions. Finite synthetic
// auth/role rows, not native concurrency or real organization approval proof.
import {readFileSync} from 'node:fs'
import {pathToFileURL} from 'node:url'
import assert from 'node:assert/strict'
if(!process.env.EDIEL_PGLITE_MODULE)throw Error('EDIEL_PGLITE_MODULE required')
const {PGlite}=await import(pathToFileURL(process.env.EDIEL_PGLITE_MODULE).href),db=new PGlite()
const uid=n=>`00000000-0000-4000-8000-${String(n).padStart(12,'0')}`
const extract=(sql,prefix,end)=>{const start=sql.indexOf(prefix),stop=sql.indexOf(end,start);assert.ok(start>=0&&stop>start,prefix);return sql.slice(start,stop+end.length)}
let checks=0
try{
 await db.exec(`CREATE ROLE anon;CREATE ROLE authenticated;CREATE ROLE service_role;CREATE SCHEMA auth;CREATE SCHEMA gridex_ediel_ack_replay;
 CREATE TABLE auth.users(id uuid PRIMARY KEY,deleted_at timestamptz,banned_until timestamptz);
 CREATE TABLE companies(id uuid PRIMARY KEY,status text,is_active bool);
 CREATE TABLE company_memberships(user_id uuid,company_id uuid,status text,is_active bool);
 CREATE TABLE admin_users(user_id uuid,role text,is_active bool);
 CREATE TABLE user_roles(user_id uuid,role_id uuid,company_id uuid,role text,status text,is_active bool);
 CREATE TABLE roles(id uuid PRIMARY KEY,key text,name text,is_active bool);
 CREATE TABLE role_permissions(role_id uuid,permission_id uuid,effect text);
 CREATE TABLE permissions(id uuid PRIMARY KEY,key text,name text,is_active bool);
 CREATE TABLE user_permissions(user_id uuid,company_id uuid,permission_id uuid,permission_key text,effect text,status text,is_active bool);
 CREATE TABLE user_permission_overrides(user_id uuid,company_id uuid,permission_key text,effect text,is_active bool,valid_from timestamptz,valid_to timestamptz);
 CREATE FUNCTION gridex_ediel_ack_replay.lock_current_graph_v2() RETURNS void LANGUAGE plpgsql AS $$BEGIN RETURN;END$$;REVOKE ALL ON FUNCTION gridex_ediel_ack_replay.lock_current_graph_v2() FROM PUBLIC,anon,authenticated;GRANT EXECUTE ON FUNCTION gridex_ediel_ack_replay.lock_current_graph_v2() TO service_role;`)
 await db.exec(extract(readFileSync(new URL('../supabase/migrations/20260727010000_contract_flow_integrity_completion.sql',import.meta.url),'utf8'),'create or replace function public.gridex_normalize_platform_role','$$;'))
 await db.exec(extract(readFileSync(new URL('../supabase/migrations/20260924003724_company_direct_permission_scope_repair.sql',import.meta.url),'utf8'),'create or replace function public.gridex_get_user_permissions_in_company','$function$;'))
 await db.exec(extract(readFileSync(new URL('../supabase/migrations/20260902100000_rpc_surface_and_permission_scope_corrections.sql',import.meta.url),'utf8'),'create or replace function public.gridex_actor_has_company_permission','$function$;'))
 await db.exec('REVOKE ALL ON FUNCTION public.gridex_actor_has_company_permission(uuid,uuid,text) FROM PUBLIC,anon,authenticated;GRANT EXECUTE ON FUNCTION public.gridex_actor_has_company_permission(uuid,uuid,text) TO service_role')
 await db.query("INSERT INTO auth.users VALUES($1,NULL,NULL)",[uid(1)]);await db.query("INSERT INTO companies VALUES($1,'active',true),($2,'active',true)",[uid(2),uid(3)])
 await db.query("INSERT INTO company_memberships VALUES($1,$2,'active',true),($1,$3,'active',true)",[uid(1),uid(2),uid(3)]);await db.query("INSERT INTO permissions VALUES($1,'communication.write','Communication',true)",[uid(4)]);await db.query("INSERT INTO user_permissions VALUES($1,$2,$3,'communication.write','allow','active',true)",[uid(1),uid(2),uid(4)])
 const allowed=async(c=uid(2))=>(await db.query('SELECT public.gridex_actor_has_company_permission($1,$2,$3) r',[uid(1),c,'communication.write'])).rows[0].r
 assert.equal(await allowed(),true);checks++
 await db.query("INSERT INTO user_permission_overrides VALUES($1,$2,'communication.write','deny',true,NULL,NULL)",[uid(1),uid(2)])
 assert.equal(await allowed(),true);checks++ // Independent RED: actual old resolver ignores an active own deny.
 const metadata=async()=>(await db.query("SELECT p.oid,p.proacl,p.proowner,p.prosecdef,p.provolatile,p.proargtypes::text signature FROM pg_proc p WHERE p.oid='public.gridex_actor_has_company_permission(uuid,uuid,text)'::regprocedure")).rows[0]
 const before=await metadata();await db.exec(readFileSync(new URL('../supabase/migrations/20261001004953_ediel_current_company_permission_denies.sql',import.meta.url),'utf8'));assert.deepEqual(await metadata(),before);checks++
 assert.equal(await allowed(),false);checks++
 const override=(changes)=>db.exec('UPDATE user_permission_overrides SET '+changes)
 await override("company_id='"+uid(3)+"'");assert.equal(await allowed(),true);checks++
 await override('company_id=NULL');assert.equal(await allowed(),false);checks++
 await override('is_active=false');assert.equal(await allowed(),true);checks++
 await override("is_active=true,valid_from=now()+interval '1 day'");assert.equal(await allowed(),true);checks++
 await override("valid_from=NULL,valid_to=now()-interval '1 day'");assert.equal(await allowed(),true);checks++
 await override("valid_to=NULL,effect='allow'");assert.equal(await allowed(),true);checks++
 await db.exec('DELETE FROM user_permission_overrides')
 await db.query("INSERT INTO user_permissions VALUES($1,$2,$3,NULL,'deny','active',true)",[uid(1),uid(2),uid(4)]);assert.equal(await allowed(),false);checks++
 await db.exec("UPDATE user_permissions SET company_id='"+uid(3)+"' WHERE effect='deny'");assert.equal(await allowed(),true);checks++
 await db.exec("UPDATE user_permissions SET company_id=NULL WHERE effect='deny'");assert.equal(await allowed(),false);checks++
 await db.exec("UPDATE user_permissions SET is_active=false WHERE effect='deny'");assert.equal(await allowed(),true);checks++
 await db.exec("UPDATE user_permissions SET is_active=true,status='inactive' WHERE effect='deny'");assert.equal(await allowed(),true);checks++
 await db.exec("UPDATE user_permissions SET status='active',permission_key='different.permission' WHERE effect='deny'");assert.equal(await allowed(),true);checks++
 await db.exec("DELETE FROM user_permissions WHERE effect='deny';UPDATE company_memberships SET is_active=false WHERE company_id='"+uid(2)+"'");assert.equal(await allowed(),false);checks++
 await db.exec("UPDATE company_memberships SET is_active=true;UPDATE auth.users SET banned_until=now()+interval '1 day'");assert.equal(await allowed(),false);checks++
 await db.exec("UPDATE auth.users SET banned_until=NULL;INSERT INTO admin_users VALUES('"+uid(1)+"','super_admin',true);DELETE FROM user_permissions");assert.equal(await allowed(),true);checks++
 await db.query("INSERT INTO user_permission_overrides VALUES($1,NULL,'communication.write','deny',true,NULL,NULL)",[uid(1)]);assert.equal(await allowed(),false);checks++
 const forward=readFileSync(new URL('../supabase/migrations/20261001004953_ediel_current_company_permission_denies.sql',import.meta.url),'utf8'),storage=readFileSync(new URL('../supabase/migrations/20261001003807_ediel_utilts_esco_pre_storage_scope.sql',import.meta.url),'utf8')
 for(const source of [forward,storage])assert.match(source,/public\.permissions,public\.user_permissions,public\.user_permission_overrides,[\s\n]*public\.tenant_actor_identifiers/);checks++
 console.log('Current company native resolver/deny forward SQL: '+checks+' PASS incl independent RED; exact OID/ACL preserved, synthetic auth rows, NOT native/concurrency proof')
}finally{await db.close()}
