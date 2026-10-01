// Bounded PostgreSQL role regression, not a Supabase/native replay receipt.
import {readFileSync} from 'node:fs'
import {pathToFileURL} from 'node:url'
import assert from 'node:assert/strict'
if(!process.env.EDIEL_PGLITE_MODULE)throw Error('EDIEL_PGLITE_MODULE required')
const {PGlite}=await import(pathToFileURL(process.env.EDIEL_PGLITE_MODULE).href)
const db=new PGlite({database:'postgres'})
const prerequisite=readFileSync(new URL('../supabase/migrations/20261001000459_ediel_retention_migration_owner_prerequisite.sql',import.meta.url),'utf8')
const schemaPrerequisite=readFileSync(new URL('../supabase/migrations/20261001000460_ediel_retention_migration_schema_privileges.sql',import.meta.url),'utf8')
for(const sql of ['CREATE ROLE anon NOLOGIN','CREATE ROLE authenticated NOLOGIN','CREATE ROLE service_role NOLOGIN','CREATE ROLE bounded_migrator NOLOGIN NOINHERIT NOSUPERUSER CREATEROLE','CREATE ROLE gridex_ediel_retention_owner NOLOGIN NOINHERIT BYPASSRLS','GRANT gridex_ediel_retention_owner TO bounded_migrator WITH ADMIN TRUE, INHERIT FALSE, SET FALSE','CREATE SCHEMA bounded_schema AUTHORIZATION bounded_migrator','GRANT USAGE,CREATE ON SCHEMA bounded_schema TO gridex_ediel_retention_owner','SET ROLE bounded_migrator','CREATE TABLE bounded_schema.ownership_probe(id int)'])await db.exec(sql)
assert.equal((await db.query('SELECT rolsuper FROM pg_roles WHERE rolname=current_user')).rows[0].rolsuper,false)
// Same native ownership SET ROLE check as CREATE SCHEMA AUTHORIZATION, without
// PGlite's database-ACL catalog limitation. The real schema replay belongs to CI.
await assert.rejects(()=>db.exec('ALTER TABLE bounded_schema.ownership_probe OWNER TO gridex_ediel_retention_owner'),/must be able to SET ROLE|must be member of role/)
await db.exec(prerequisite)
await db.exec('ALTER TABLE bounded_schema.ownership_probe OWNER TO gridex_ediel_retention_owner')
assert.equal((await db.query("SELECT pg_has_role(current_user,'gridex_ediel_retention_owner','MEMBER') value")).rows[0].value,true)
assert.equal((await db.query("SELECT pg_get_userbyid(relowner) owner FROM pg_class WHERE oid='bounded_schema.ownership_probe'::regclass")).rows[0].owner,'gridex_ediel_retention_owner')
await db.exec(prerequisite)
await db.exec('RESET ROLE')
// The next historical migration creates the schema for this private owner,
// then executes table/function DDL without SET ROLE. Reproduce that ownership
// and prove both prerequisites are required for the un-switched migrator.
await db.exec('CREATE SCHEMA gridex_ediel_retention AUTHORIZATION gridex_ediel_retention_owner')
await db.exec('SET ROLE bounded_migrator')
await assert.rejects(()=>db.exec('CREATE TABLE gridex_ediel_retention.un_switched_probe(id int)'),/permission denied for schema/)
await db.exec(schemaPrerequisite)
await db.exec('REVOKE ALL ON SCHEMA gridex_ediel_retention FROM PUBLIC,anon,authenticated,service_role; CREATE TABLE gridex_ediel_retention.un_switched_probe(id int); ALTER TABLE gridex_ediel_retention.un_switched_probe OWNER TO gridex_ediel_retention_owner; CREATE FUNCTION gridex_ediel_retention.un_switched_probe_v1() RETURNS int LANGUAGE sql SET search_path=pg_catalog AS $$SELECT 1$$; ALTER FUNCTION gridex_ediel_retention.un_switched_probe_v1() OWNER TO gridex_ediel_retention_owner; REVOKE ALL ON FUNCTION gridex_ediel_retention.un_switched_probe_v1() FROM PUBLIC,anon,authenticated,service_role;')
assert.equal((await db.query('SELECT gridex_ediel_retention.un_switched_probe_v1() value')).rows[0].value,1)
await db.exec(schemaPrerequisite)
await db.exec('RESET ROLE')
for(const role of ['anon','authenticated','service_role']){
 assert.equal((await db.query(`SELECT pg_has_role('${role}','gridex_ediel_retention_owner','MEMBER') value`)).rows[0].value,false)
 await db.exec(`SET ROLE ${role}`)
 await assert.rejects(()=>db.exec(prerequisite),/ediel_retention_migration_role_required/)
 await db.exec('ROLLBACK; RESET ROLE')
 await db.exec(`SET ROLE ${role}`)
 await assert.rejects(()=>db.exec(schemaPrerequisite),/ediel_retention_migration_role_required/)
 await db.exec('ROLLBACK; RESET ROLE')
 assert.equal((await db.query(`SELECT has_schema_privilege('${role}','gridex_ediel_retention','USAGE') value`)).rows[0].value,false)
}
assert.deepEqual((await db.query("SELECT member::regrole::text member,admin_option,inherit_option,set_option FROM pg_auth_members WHERE roleid='gridex_ediel_retention_owner'::regrole AND grantor='bounded_migrator'::regrole")).rows,[{member:'bounded_migrator',admin_option:false,inherit_option:true,set_option:true}])
assert.equal((await db.query("SELECT count(*)::int n FROM pg_auth_members WHERE roleid='gridex_ediel_retention_owner'::regrole AND admin_option")).rows[0].n,1)
await db.close()
process.stdout.write('PASS existing-owner non-super migration ownership, idempotence, private owner, application-role denial and unchanged migrator administration\n')
