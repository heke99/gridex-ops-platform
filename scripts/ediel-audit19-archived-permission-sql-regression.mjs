// Actual SQL bodies in isolated PGlite. Registry rows and graph-lock port are SYNTHETIC.
// No SDK, auth.uid seam, GoTrue, backend, live policy or native evidence.
// Fixture-admin setup/seed is separate from actual NOSUPER/NOINHERIT installation.
// Direct private permission observations use the declared installer SET capability only.
import {readFileSync} from 'node:fs'
import {join} from 'node:path'
import {createHash} from 'node:crypto'
import assert from 'node:assert/strict'
import {test,before,beforeEach,after} from 'node:test'
import {PGlite} from '@electric-sql/pglite'
const root=process.env.DB05_PERMISSION_RECEIVER_ROOT||process.cwd()
const forwardPath=process.env.DB05_PERMISSION_FORWARD||join(root,'supabase/migrations/20261019180500_db05_audit19_archived_permission.sql')
const sql=readFileSync(forwardPath,'utf8'),schema=readFileSync(join(root,'supabase/schema.sql'),'utf8'),source6=readFileSync(join(root,'supabase/migrations/20261019180000_db05_completed_decision_review_reason_retention.sql'),'utf8')
const beforeHash='6bedde3f4c01c504eae815ba0895b0872603dd2f6d8adace45669b640db689c7',afterHash='b4027dcae1ce6e709fd37afb329589649197104c801aeb4110454a60045cc0fa'
const key='ediel.retention.audit_normalized19_cleanup',reason='ediel.retention.completed_review_reason',business='customers.write'
const c='10000000-0000-4000-8000-000000000001',foreign='10000000-0000-4000-8000-000000000002',actor='20000000-0000-4000-8000-000000000001',superactor='20000000-0000-4000-8000-000000000002'
const ids=['30000000-0000-4000-8000-000000000001','30000000-0000-4000-8000-000000000002','30000000-0000-4000-8000-000000000003']
const sha=s=>createHash('sha256').update(s).digest('hex')
function extract(name){const tail=schema.slice(schema.indexOf('CREATE FUNCTION '+name+'('));const m=/\bAS\s+(\$[A-Za-z0-9_]*\$)/i.exec(tail);assert(m,name);const start=m.index+m[0].length,end=tail.indexOf(m[1]+';',start);return{definition:tail.slice(0,end+m[1].length+1),body:tail.slice(start,end),start,end}}
const original=extract('gridex_ediel_retention.permission_v1'),spec=JSON.parse(source6.split('$specs$')[1]).find(x=>x.name==='gridex_ediel_retention.permission_v1')
let body=original.body
if(sha(body)===spec.before){for(const change of spec.changes){assert.equal(body.split(change.old).length-1,change.count);body=body.split(change.old).join(change.new)}}
else if(sha(body)===afterHash)body=body.replace("'ediel.retention.completed_review_reason','ediel.retention.audit_normalized19_cleanup'","'ediel.retention.completed_review_reason'")
assert.equal(sha(body),beforeHash,'only known actual Source6 predecessor or exact generated successor')
const oldDefinition=original.definition.slice(0,original.start)+body+original.definition.slice(original.end)
const deps=['public.gridex_normalize_platform_role','public.gridex_get_user_permissions_in_company','public.gridex_actor_has_company_permission','public.ediel_retention_lock_auth_actor_v1','gridex_requested_changes.scoped_permission_v1'].map(extract)
const phase=process.env.AUDIT_PERMISSION_PHASE||'after';assert(['before','after'].includes(phase))
const authoritySQL=`SELECT jsonb_build_object('memberships',(SELECT jsonb_agg(to_jsonb(m) ORDER BY m.oid) FROM pg_auth_members m),'roles',(SELECT jsonb_agg(to_jsonb(r)-'rolpassword' ORDER BY r.oid) FROM pg_roles r),'namespaces',(SELECT jsonb_agg(to_jsonb(n) ORDER BY n.oid) FROM pg_namespace n WHERE n.nspname IN('public','gridex_ediel_retention'))) v`
async function installer(d){
 const identity=(await d.query(`SELECT current_user c,session_user s,rolsuper,rolinherit,rolcreaterole,rolbypassrls,pg_has_role('postgres','gridex_ediel_retention_owner','USAGE') inherited,pg_has_role('postgres','gridex_ediel_retention_owner','SET') can_set FROM pg_roles WHERE rolname=current_user`)).rows[0]
 assert.deepEqual(identity,{c:'postgres',s:'postgres',rolsuper:false,rolinherit:true,rolcreaterole:true,rolbypassrls:true,inherited:false,can_set:true})
 const edges=(await d.query(`SELECT jsonb_agg(jsonb_build_array(g.rolname,m.admin_option,m.inherit_option,m.set_option) ORDER BY g.rolname COLLATE "C") v FROM pg_auth_members m JOIN pg_roles g ON g.oid=m.grantor WHERE roleid='gridex_ediel_retention_owner'::regrole AND member='postgres'::regrole`)).rows[0].v
 assert.deepEqual(edges,[['postgres',false,false,true],['supabase_admin',true,false,false]])
 assert.equal((await d.query(`SELECT nspowner='gridex_ediel_retention_owner'::regrole::oid v FROM pg_namespace WHERE nspname='gridex_ediel_retention'`)).rows[0].v,true)
 assert.equal((await d.query(`SELECT has_schema_privilege('gridex_ediel_retention_owner','auth','USAGE') v`)).rows[0].v,false)
}
async function fresh(apply=false){
 const d=new PGlite()
 // PGlite's bootstrap OID10 stays superuser under the genuine bootstrap name.
 // Only this explicit GIVEN setup/seed principal is privileged; never apply SQL as it.
 await d.exec(`CREATE ROLE fixture_setup_admin LOGIN SUPERUSER;SET SESSION AUTHORIZATION fixture_setup_admin;ALTER ROLE postgres RENAME TO supabase_admin;SET SESSION AUTHORIZATION supabase_admin;
 CREATE ROLE postgres LOGIN NOSUPERUSER INHERIT CREATEROLE BYPASSRLS;
 CREATE ROLE anon;CREATE ROLE authenticated;CREATE ROLE service_role;CREATE ROLE gridex_ediel_retention_owner NOLOGIN NOINHERIT BYPASSRLS;
 ALTER DATABASE postgres OWNER TO postgres;ALTER SCHEMA public OWNER TO postgres;
 CREATE SCHEMA auth AUTHORIZATION supabase_admin;CREATE SCHEMA gridex_ediel_ack_replay AUTHORIZATION postgres;CREATE SCHEMA gridex_requested_changes AUTHORIZATION postgres;CREATE SCHEMA gridex_ediel_retention AUTHORIZATION gridex_ediel_retention_owner;
 CREATE TABLE auth.users(id uuid PRIMARY KEY,deleted_at timestamptz,banned_until timestamptz,email_confirmed_at timestamptz);
 CREATE TABLE public.user_profiles(id uuid PRIMARY KEY,user_status text,disabled_at timestamptz);
 CREATE TABLE public.companies(id uuid PRIMARY KEY,status text,is_active boolean);
 CREATE TABLE public.company_memberships(company_id uuid,user_id uuid,status text,is_active boolean,accepted_at timestamptz);
 CREATE TABLE public.permissions(id uuid PRIMARY KEY,key text,name text,is_active boolean);
 CREATE TABLE public.user_permissions(id uuid DEFAULT gen_random_uuid(),user_id uuid,company_id uuid,permission_id uuid,permission_key text,is_active boolean,status text,effect text);
 CREATE TABLE public.roles(id uuid,key text,name text,is_active boolean);
 CREATE TABLE public.user_roles(id uuid DEFAULT gen_random_uuid(),user_id uuid,company_id uuid,role_id uuid,role text,status text,is_active boolean);
 CREATE TABLE public.role_permissions(id uuid DEFAULT gen_random_uuid(),role_id uuid,permission_id uuid,permission_key text,effect text);
 CREATE TABLE public.user_permission_overrides(user_id uuid,company_id uuid,permission_key text,is_active boolean,effect text,valid_from timestamptz,valid_to timestamptz);
 CREATE TABLE public.admin_users(user_id uuid,role text,is_active boolean);
 -- Declared lock-only port: no authority/identity decision is replaced.
 CREATE FUNCTION gridex_ediel_ack_replay.lock_current_graph_v2() RETURNS void LANGUAGE sql AS $$SELECT$$;`)
 for(const x of deps)await d.exec(x.definition)
 await d.exec(oldDefinition)
 // Public dependency owners can use their genuine auth-locking bodies; the
 // private retention owner receives no auth-schema/table access.
 await d.exec(`DO $$DECLARE r record;BEGIN FOR r IN SELECT c.relname FROM pg_class c WHERE c.relnamespace='public'::regnamespace AND c.relkind='r' LOOP EXECUTE format('ALTER TABLE public.%I OWNER TO postgres',r.relname);END LOOP;FOR r IN SELECT p.oid::regprocedure target FROM pg_proc p WHERE p.pronamespace IN('public'::regnamespace,'gridex_requested_changes'::regnamespace,'gridex_ediel_ack_replay'::regnamespace) LOOP EXECUTE format('ALTER FUNCTION %s OWNER TO postgres',r.target);END LOOP;END$$;
 GRANT USAGE ON SCHEMA auth TO postgres;GRANT SELECT,UPDATE ON auth.users TO postgres;
 GRANT USAGE ON SCHEMA public,gridex_requested_changes,gridex_ediel_ack_replay,gridex_ediel_retention TO gridex_ediel_retention_owner;
 GRANT USAGE ON SCHEMA gridex_ediel_retention TO postgres;
 GRANT SELECT ON ALL TABLES IN SCHEMA public TO gridex_ediel_retention_owner;
 ALTER FUNCTION gridex_ediel_retention.permission_v1(uuid,uuid,text) OWNER TO gridex_ediel_retention_owner;REVOKE ALL ON FUNCTION gridex_ediel_retention.permission_v1(uuid,uuid,text) FROM PUBLIC;
 GRANT gridex_ediel_retention_owner TO postgres WITH ADMIN TRUE,INHERIT FALSE,SET FALSE GRANTED BY supabase_admin;
 SET SESSION AUTHORIZATION postgres;GRANT gridex_ediel_retention_owner TO postgres WITH ADMIN FALSE,INHERIT FALSE,SET TRUE GRANTED BY postgres;`)
 await installer(d)
 if(apply){const authority=(await d.query(authoritySQL)).rows[0].v;await d.exec(sql);await installer(d);assert.deepEqual((await d.query(authoritySQL)).rows[0].v,authority,'actual forward restores installer roles/edges/namespaces')}
 return d
}
async function seed(d){
 // Declared fixture-admin registry seeding; every test/installer resumes postgres.
 await d.exec('SET SESSION AUTHORIZATION supabase_admin')
 try{await d.exec(`TRUNCATE auth.users,public.user_profiles,public.companies,public.company_memberships,public.permissions,public.user_permissions,public.roles,public.user_roles,public.role_permissions,public.user_permission_overrides,public.admin_users;
 INSERT INTO auth.users VALUES('${actor}',NULL,NULL,clock_timestamp()),('${superactor}',NULL,NULL,clock_timestamp());
 INSERT INTO public.user_profiles VALUES('${actor}','active',NULL),('${superactor}','active',NULL);
 INSERT INTO public.companies VALUES('${c}','archived',true),('${foreign}','active',true);
 INSERT INTO public.company_memberships VALUES('${c}','${actor}','active',true,clock_timestamp()),('${c}','${superactor}','active',true,clock_timestamp());
 INSERT INTO public.permissions VALUES('${ids[0]}','${key}','audit',true),('${ids[1]}','${reason}','reason',true),('${ids[2]}','${business}','business',true);
 INSERT INTO public.user_permissions(user_id,company_id,permission_id,permission_key,is_active,status,effect) SELECT u,'${c}',p.id,p.key,true,'active','allow' FROM unnest(ARRAY['${actor}','${superactor}']::uuid[]) u CROSS JOIN public.permissions p;
 INSERT INTO public.admin_users VALUES('${superactor}','super_admin',true);`)}finally{await d.exec('SET SESSION AUTHORIZATION postgres')}
 await installer(d)
}
let db
before(async()=>{db=await fresh(phase==='after')});beforeEach(async()=>seed(db));after(async()=>db?.close())
async function allowed(wanted=key,who=actor,company=c,d=db){
 // This private predicate has no application EXECUTE grant. Observe it through
 // the real SET=true installer edge, then restore the noninheriting installer.
 await d.exec('SET ROLE gridex_ediel_retention_owner')
 try{return(await d.query('SELECT gridex_ediel_retention.permission_v1($1,$2,$3) AS v',[company,who,wanted])).rows[0].v}finally{await d.exec('RESET ROLE')}
}
async function businessOwner(wanted=key,who=actor){return(await db.query('SELECT public.gridex_actor_has_company_permission($1,$2,$3) AS v',[who,c,wanted])).rows[0].v}
for(const status of ['archived','pending_deletion','closed'])test(`current explicit audit grant survives ${status} through genuine retention owner`,async()=>{
 await db.query('UPDATE public.companies SET status=$1 WHERE id=$2',[status,c])
 const actual=await allowed();assert.equal(actual,true,`actual permission_v1(${status})=${actual}; no fabricated allow port`)
 if(status!=='closed')assert.equal(await businessOwner(),false,'ordinary company-owner remains restrictive')
})
test('active ordinary audit grant remains permitted',async()=>{await db.query('UPDATE public.companies SET status=$1 WHERE id=$2',['active',c]);assert.equal(await allowed(),true)})
for(const status of ['suspended','deleted'])test(`company ${status} still refuses audit retention`,async()=>{await db.query('UPDATE public.companies SET status=$1 WHERE id=$2',[status,c]);assert.equal(await allowed(),false)})
test('missing explicit grant cannot be substituted by membership or a superadmin label',async()=>{await db.exec(`DELETE FROM public.user_permissions WHERE permission_key='${key}'`);assert.equal(await allowed(),false);assert.equal(await allowed(key,superactor),false)})
test('inactive or unaccepted membership still refuses',async()=>{await db.exec(`UPDATE public.company_memberships SET is_active=false WHERE user_id='${actor}'`);assert.equal(await allowed(),false);await db.exec(`UPDATE public.company_memberships SET is_active=true,accepted_at=NULL WHERE user_id='${actor}'`);assert.equal(await allowed(),false)})
test('actual current auth deletion, ban and profile revocation still refuse',async()=>{await db.exec(`UPDATE auth.users SET deleted_at=clock_timestamp() WHERE id='${actor}'`);assert.equal(await allowed(),false);await db.exec(`UPDATE auth.users SET deleted_at=NULL,banned_until=clock_timestamp()+interval '1 hour' WHERE id='${actor}'`);assert.equal(await allowed(),false);await db.exec(`UPDATE auth.users SET banned_until=NULL WHERE id='${actor}';UPDATE public.user_profiles SET user_status='inactive' WHERE id='${actor}'`);assert.equal(await allowed(),false)})
test('own grant has no foreign tenant authority',async()=>{assert.equal(await allowed(key,actor,foreign),false)})
test('explicit current DENY beats the matching direct grant',async()=>{await db.exec(`INSERT INTO public.user_permission_overrides VALUES('${actor}','${c}','${key}',true,'deny',clock_timestamp()-interval '1 minute',clock_timestamp()+interval '1 hour')`);assert.equal(await allowed(),false)})
test('expired allow is not current authority; current role grant is explicit own authority',async()=>{await db.exec(`DELETE FROM public.user_permissions WHERE user_id='${actor}' AND permission_key='${key}';INSERT INTO public.user_permission_overrides VALUES('${actor}','${c}','${key}',true,'allow',NULL,clock_timestamp()-interval '1 second')`);assert.equal(await allowed(),false);await db.exec(`INSERT INTO public.roles VALUES('${ids[0]}','synthetic_retention','synthetic',true);INSERT INTO public.user_roles(user_id,company_id,role_id,role,status,is_active) VALUES('${actor}','${c}','${ids[0]}','member','active',true);INSERT INTO public.role_permissions(role_id,permission_id,permission_key,effect) VALUES('${ids[0]}','${ids[0]}','${key}','allow')`);assert.equal(await allowed(),true)})
test('inactive audit catalogue key still refuses',async()=>{await db.exec(`UPDATE public.permissions SET is_active=false WHERE key='${key}'`);assert.equal(await allowed(),false)})
test('Source6 completed-review class is preserved and unrelated business fallback is unchanged',async()=>{assert.equal(await allowed(reason),true);assert.equal(await allowed(business),false);assert.equal(await businessOwner(business),false);assert.equal(await allowed(business,superactor),true,'existing explicit-grant superadmin business fallback unchanged')})
test('new audit key follows ordinary explicit retention rules even for superadmin',async()=>{assert.equal(await allowed(key,superactor),true);await db.exec(`UPDATE public.company_memberships SET is_active=false WHERE user_id='${superactor}'`);assert.equal(await allowed(key,superactor),false);assert.equal(await allowed(business,superactor),true,'unrelated business superadmin path unchanged')})
test('forward changes only body literal and preserves OID/owner/ACL/security/search_path and all five genuine dependency bodies',async()=>{
 if(phase!=='after')return
 const d=await fresh(false)
 try{const old=(await d.query(`SELECT to_jsonb(p)-'prosrc' AS meta,prosrc FROM pg_proc p WHERE oid='gridex_ediel_retention.permission_v1(uuid,uuid,text)'::regprocedure`)).rows[0]
 const others=await d.query(`SELECT oid,prosrc,to_jsonb(p)-'prosrc' AS meta FROM pg_proc p WHERE pronamespace IN('public'::regnamespace,'gridex_requested_changes'::regnamespace) ORDER BY oid`)
 await d.exec(sql);const next=(await d.query(`SELECT to_jsonb(p)-'prosrc' AS meta,prosrc FROM pg_proc p WHERE oid='gridex_ediel_retention.permission_v1(uuid,uuid,text)'::regprocedure`)).rows[0]
 assert.deepEqual(next.meta,old.meta);assert.equal(sha(old.prosrc),beforeHash);assert.equal(sha(next.prosrc),afterHash);assert.equal(next.prosrc.replace("'ediel.retention.completed_review_reason','ediel.retention.audit_normalized19_cleanup'","'ediel.retention.completed_review_reason'"),old.prosrc)
 assert.deepEqual((await d.query(`SELECT oid,prosrc,to_jsonb(p)-'prosrc' AS meta FROM pg_proc p WHERE pronamespace IN('public'::regnamespace,'gridex_requested_changes'::regnamespace) ORDER BY oid`)).rows,others.rows)
 }finally{await d.close()}
})
test('late installed postimage assertion failure rolls the entire actual forward back',async()=>{
 if(phase!=='after')return
 const d=await fresh(false)
 try{const old=(await d.query(`SELECT to_jsonb(p) AS v FROM pg_proc p WHERE oid='gridex_ediel_retention.permission_v1(uuid,uuid,text)'::regprocedure`)).rows[0].v
 const anchor=`IS DISTINCT FROM '${afterHash}'\n THEN RAISE EXCEPTION 'audit19_permission_catalog_or_body_changed'`
 assert.equal(sql.split(anchor).length,2)
 await assert.rejects(d.exec(sql.replace(anchor,`IS DISTINCT FROM '${'0'.repeat(64)}'\n THEN RAISE EXCEPTION 'audit19_permission_catalog_or_body_changed'`)),/audit19_permission_catalog_or_body_changed/)
 await d.exec('ROLLBACK');assert.deepEqual((await d.query(`SELECT to_jsonb(p) AS v FROM pg_proc p WHERE oid='gridex_ediel_retention.permission_v1(uuid,uuid,text)'::regprocedure`)).rows[0].v,old)
 }finally{await d.close()}
})
